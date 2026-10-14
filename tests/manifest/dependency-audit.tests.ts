import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * nexus is published to GitHub Packages and installed by vision and the other repos, so a high or critical
 * advisory in its resolved dependency tree reaches every consumer. Two things have to stay true for that: the
 * Dependency audit step in the validate job must be able to fail the run and block the merge — it is the only
 * automated check on advisories that have no fix listed in the filesystem scan Trivy does (VIS-4, epic E3) —
 * and package.json with pnpm-lock.yaml must keep the overrides that clear the audit (TK-8).
 */
const ROOT = path.resolve(__dirname, '../..');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const LOCKFILE_PATH = path.join(ROOT, 'pnpm-lock.yaml');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/publish.yml');
const AUDIT_STEP = 'Dependency audit';

interface PackageManifest {
  devDependencies?: Record<string, string>;
  pnpm?: {
    overrides?: Record<string, string>;
    auditConfig?: {
      ignore?: unknown[];
    };
  };
}

interface WorkflowStep {
  indent: number;
  name: string;
  text: string;
}

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function readManifest(): PackageManifest {
  return JSON.parse(readText(PACKAGE_PATH)) as PackageManifest;
}

function readWorkflow(): string {
  return readText(WORKFLOW_PATH);
}

function unquote(value: string): string {
  return value.replace(/^(['"])(.*)\1$/, '$2');
}

function indentOf(line: string): number {
  return /^(\s*)/.exec(line)![1].length;
}

/**
 * Every step of a workflow (or job) fragment, named or anonymous. A list item starts a step when it carries a
 * `name:` or sits at the indentation of the step list; a deeper `- ` inside a `run: |` block stays in the step.
 */
function parseSteps(fragment: string): WorkflowStep[] {
  const steps: { indent: number; name: string; lines: string[] }[] = [];
  let current: (typeof steps)[number] | undefined;

  for (const line of fragment.split(/\r?\n/)) {
    const marker = /^(\s*)- (.*)$/.exec(line);
    const named = marker === null ? null : /^name:\s*(.+?)\s*$/.exec(marker[2]);

    if (marker !== null && (named !== null || current === undefined || indentOf(line) <= current.indent)) {
      current = { indent: indentOf(line), name: named === null ? '' : unquote(named[1]), lines: [line] };
      steps.push(current);
      continue;
    }

    if (current === undefined) continue;
    if (line.trim() === '' || indentOf(line) > current.indent) current.lines.push(line);
    else current = undefined;
  }

  return steps.map(step => ({ indent: step.indent, name: step.name, text: step.lines.join('\n') }));
}

/** The single step with this name; more than one would make the gate ambiguous. */
function findStep(fragment: string, name: string): WorkflowStep {
  const matches = parseSteps(fragment).filter(step => step.name === name);

  expect(matches, `expected exactly one "${name}" step, found ${matches.length}`).toHaveLength(1);
  return matches[0];
}

/** The lines of one job of the `jobs:` map, up to the next job key. */
function findJob(workflow: string, job: string): string {
  const lines = workflow.split(/\r?\n/);
  const jobsAt = lines.findIndex(line => /^jobs:\s*$/.test(line));

  expect(jobsAt, 'workflow has no jobs: key').toBeGreaterThan(-1);

  const start = lines.findIndex((line, index) => index > jobsAt && line === `  ${job}:`);

  expect(start, `workflow has no "${job}" job`).toBeGreaterThan(-1);

  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

/** The workflow's `on:` block, up to the next top-level key. */
function findTriggers(workflow: string): string {
  const lines = workflow.split(/\r?\n/);
  const start = lines.findIndex(line => /^on:\s*$/.test(line));

  expect(start, 'workflow has no on: key').toBeGreaterThan(-1);

  const end = lines.findIndex((line, index) => index > start && /^\S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

describe('dependency audit gate', () => {
  const workflow = readWorkflow();
  const audit = findStep(findJob(workflow, 'validate'), AUDIT_STEP);

  it('runs pnpm audit at --audit-level=high', () => {
    expect(audit.text).toMatch(/^\s+run: pnpm audit --audit-level=high$/m);
  });

  it('does not set continue-on-error, so a high or critical advisory fails the run', () => {
    expect(audit.text).not.toMatch(/continue-on-error/);
  });

  it('does not swallow a failing audit exit code', () => {
    expect(audit.text).not.toMatch(/\|\|\s*true/);
    expect(audit.text).not.toMatch(/\|\|\s*exit 0/);
    expect(audit.text).not.toMatch(/;\s*exit 0/);
  });

  it('is not skipped by a condition', () => {
    expect(audit.text).not.toMatch(/^\s+if:/m);
  });

  it('still gates publish through the validate job', () => {
    expect(findJob(workflow, 'validate')).toContain(`name: ${AUDIT_STEP}`);
    expect(findJob(workflow, 'publish')).toMatch(/needs: \[validate, e2e\]/);
  });

  it('still runs on every push to main and on every pull request to main', () => {
    const triggers = findTriggers(workflow);

    expect(triggers).toMatch(/^ {2}push:\n {4}branches: \[main\]$/m);
    expect(triggers).toMatch(/^ {2}pull_request:\n {4}branches: \[main\]$/m);
  });

  it.each([
    ['Type check', 'tsc --project tsconfig.ci.json --noEmit'],
    ['Secret scan', 'trufflesecurity/trufflehog@main'],
    ['Vulnerability scan', 'aquasecurity/trivy-action'],
    ['Run tests', 'pnpm run test-ci'],
    ['Run E2E tests', 'pnpm run test:e2e'],
  ])('keeps the %s step as before', (stepName, expected) => {
    expect(findStep(workflow, stepName).text).toContain(expected);
  });
});

describe('dependency audit overrides', () => {
  it('overrides or bumps every high and critical advisory without ignoring any', () => {
    const { pnpm } = readManifest();

    expect(pnpm?.overrides ?? {}).toEqual(expect.objectContaining({
      'node-forge': 'https://github.com/digitalbazaar/forge/archive/ceba34402e329f0365134f23fe19898756527d65.tar.gz',
      'brace-expansion': '>=5.0.11',
      'engine.io': '>=6.6.10',
      'source-map-js': '>=1.2.2',
      'qs': '>=6.16.0',
      '@capacitor/core': '>=8.5.3',
      '@capacitor/ios': '>=8.5.3',
      '@capacitor/android': '>=8.5.3',
    }));

    expect(pnpm?.auditConfig?.ignore ?? []).toHaveLength(0);
  });

  it('removes the dev-only paths that pulled in unpatched braces', () => {
    const { devDependencies = {} } = readManifest();
    const lockfile = readText(LOCKFILE_PATH);

    expect(devDependencies).not.toHaveProperty('nodemon-webpack-plugin');
    expect(devDependencies['ts-loader']).toBe('^9.6.2');
    expect(lockfile).not.toContain('nodemon-webpack-plugin');
    expect(lockfile).not.toContain('braces@');
  });

  it('commits a lockfile resolved to the patched versions', () => {
    const lockfile = readText(LOCKFILE_PATH);

    expect(lockfile).toContain('node-forge@https://github.com/digitalbazaar/forge/archive/ceba34402e329f0365134f23fe19898756527d65.tar.gz:');
    expect(lockfile).toContain('brace-expansion@5.0.12:');
    expect(lockfile).toContain('engine.io@6.6.11:');
    expect(lockfile).toContain('source-map-js@1.2.2:');
    expect(lockfile).toContain('qs@6.16.0:');
    expect(lockfile).toContain("'@capacitor/core@8.5.3':");
    expect(lockfile).toContain("'@capacitor/ios@8.5.3(@capacitor/core@8.5.3)':");
    expect(lockfile).toContain("'@capacitor/android@8.5.3(@capacitor/core@8.5.3)':");
  });
});
