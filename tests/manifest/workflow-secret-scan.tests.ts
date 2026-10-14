import { readFileSync } from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Guards against the secret scan silently going vacuous again.
 *
 * TruffleHog is given an explicit `base` — on a pull request the base branch's commit, on a push
 * `github.event.before`. The validate job checks the repository out with the default shallow clone, which holds
 * only HEAD, so that base commit is absent from the checkout and the scan diffs nothing. Fetching the full
 * history is what makes the scan real.
 */
const WORKFLOW_PATH = path.resolve(__dirname, '../../.github/workflows/publish.yml');

/** Indentation of a job key (`  validate:`) and of a step (`      - uses: ...`) in this workflow. */
const JOB_INDENT = 2;
const STEP_INDENT = 6;

function readWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

/** Everything after `startIndex` until a non-blank line indented at or above `indent`. */
function readBlock(lines: string[], startIndex: number, indent: number): string[] {
  const block: string[] = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() !== '' && indentOf(line) <= indent) break;
    block.push(line);
  }
  return block;
}

/** The lines of a top-level job, up to the next job. */
function readJob(workflow: string, jobName: string): string[] {
  const lines = workflow.split('\n');
  const start = lines.findIndex(line => indentOf(line) === JOB_INDENT && line.trim() === `${jobName}:`);
  if (start < 0) throw new Error(`Job '${jobName}' not found in ${WORKFLOW_PATH}`);

  return readBlock(lines, start + 1, JOB_INDENT);
}

/** The steps of a job, each starting at a `- ` line indented exactly STEP_INDENT. */
function readSteps(jobLines: string[]): string[][] {
  const starts = jobLines.reduce<number[]>((indexes, line, index) => {
    if (indentOf(line) === STEP_INDENT && line.trim().startsWith('- ')) indexes.push(index);
    return indexes;
  }, []);

  return starts.map((start, position) => jobLines.slice(start, starts[position + 1] ?? jobLines.length));
}

/** The content of a step line, without its leading `- ` when it starts the step. */
function stepLine(line: string): string {
  return line.trim().replace(/^-\s+/, '');
}

/** The step of this job that uses an action whose `uses` starts with `action`. */
function readStepUsing(jobLines: string[], action: string): string[] {
  const step = readSteps(jobLines).find(stepLines => stepLines.some(line => stepLine(line).startsWith(`uses: ${action}`)));
  if (step == null) throw new Error(`Step using '${action}' not found in ${WORKFLOW_PATH}`);

  return step;
}

/** The value of a `name: value` line inside a step, with any YAML quotes removed. */
function readInput(stepLines: string[], inputName: string): string | undefined {
  const line = stepLines.find(candidate => candidate.trim().startsWith(`${inputName}:`));
  if (line == null) return undefined;

  return line.slice(line.indexOf(':') + 1).trim().replace(/^['"]|['"]$/g, '');
}

describe('secret detection workflow', () => {
  it('fetches the full history in the job that runs TruffleHog', () => {
    const validate = readJob(readWorkflow(), 'validate');
    const checkout = readStepUsing(validate, 'actions/checkout@');

    expect(readInput(checkout, 'fetch-depth')).toBe('0');
  });

  it('scans the pushed range with TruffleHog and only fails on verified secrets', () => {
    const validate = readJob(readWorkflow(), 'validate');
    const scan = readStepUsing(validate, 'trufflesecurity/trufflehog@');

    // The base is the commit fetched above; if it is missing the scan has an empty range to diff.
    expect(readInput(scan, 'base')).toContain('github.event.pull_request.base.sha');
    expect(readInput(scan, 'base')).toContain('github.event.before');
    expect(readInput(scan, 'head')).toContain('github.sha');
    expect(readInput(scan, 'extra_args')).toBe('--only-verified');
  });

  it('runs the secret scan on pull requests, not only on pushes', () => {
    const workflow = readWorkflow();
    const validate = readJob(workflow, 'validate');
    const scan = readStepUsing(validate, 'trufflesecurity/trufflehog@');

    expect(workflow.split('\n').some(line => line.trim() === 'pull_request:')).toBe(true);
    expect(readInput(scan, 'if')).toContain('workflow_dispatch');
  });
});
