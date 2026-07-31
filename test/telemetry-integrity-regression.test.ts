import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const LOGGER = path.join(ROOT, 'bin', 'gstack-telemetry-log');

let stateDir: string;

function run(args: string[]) {
  return spawnSync(LOGGER, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      GSTACK_DIR: ROOT,
      GSTACK_STATE_DIR: stateDir,
    },
    encoding: 'utf8',
  });
}

function enableTelemetry() {
  const result = spawnSync(path.join(ROOT, 'bin', 'gstack-config'), ['set', 'telemetry', 'anonymous'], {
    cwd: ROOT,
    env: { ...process.env, GSTACK_DIR: ROOT, GSTACK_STATE_DIR: stateDir },
    encoding: 'utf8',
  });
  expect(result.status).toBe(0);
}

function events(): Record<string, unknown>[] {
  const jsonl = path.join(stateDir, 'analytics', 'skill-usage.jsonl');
  if (!fs.existsSync(jsonl)) return [];
  return fs.readFileSync(jsonl, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-telemetry-integrity-'));
  enableTelemetry();
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

describe('telemetry logger integrity regressions', () => {
  test('malformed duration cannot corrupt the JSONL stream', () => {
    const result = run(['--skill', 'qa', '--duration', '1e3x', '--outcome', 'success']);

    expect(result.status).toBe(0);
    expect(events()).toEqual([expect.objectContaining({ skill: 'qa', duration_s: null, outcome: 'success' })]);
  });

  test('normalizes unrecognized categorical values', () => {
    const result = run([
      '--skill', 'totally-invented-skill',
      '--outcome', 'winner-winner',
      '--failed-step', 'made-up-stage',
    ]);

    expect(result.status).toBe(0);
    expect(events()).toEqual([
      expect.objectContaining({ skill: 'unknown', outcome: 'unknown', failed_step: null }),
    ]);
  });

  test('a flag missing its value remains a best-effort zero-exit no-op', () => {
    const result = run(['--skill']);

    expect(result.status).toBe(0);
    expect(events()).toEqual([]);
  });
});
