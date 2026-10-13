import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

interface PackageManifest {
  devDependencies?: Record<string, string>;
  pnpm?: {
    overrides?: Record<string, string>;
    auditConfig?: {
      ignore?: unknown[];
    };
  };
}

const ROOT = path.resolve(__dirname, '../..');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const LOCKFILE_PATH = path.join(ROOT, 'pnpm-lock.yaml');
const WORKFLOW_PATH = path.join(ROOT, '.github/workflows/publish.yml');

function readText(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

function readManifest(): PackageManifest {
  return JSON.parse(readText(PACKAGE_PATH)) as PackageManifest;
}

/** Extract the YAML lines belonging to the named CI step (until the next same-level step or job marker). */
function extractStep(workflow: string, stepName: string): string[] {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => line.includes(`- name: ${stepName}`));
  expect(start).toBeGreaterThanOrEqual(0);

  const step: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s{6}- name:/.test(line) || /^\s{4}\S/.test(line)) break;
    step.push(line);
  }
  return step;
}

describe('dependency audit gates', () => {
  it('keeps the audit step failing closed (no continue-on-error)', () => {
    const step = extractStep(readText(WORKFLOW_PATH), 'Dependency audit');

    expect(step.join('\n')).toContain('run: pnpm audit --audit-level=high');
    expect(step.some(line => line.includes('continue-on-error'))).toBe(false);
  });

  it('overrides or bumps every high and critical advisory without ignoring any', () => {
    const { pnpm } = readManifest();
    const overrides = pnpm?.overrides ?? {};

    expect(overrides).toEqual(expect.objectContaining({
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
