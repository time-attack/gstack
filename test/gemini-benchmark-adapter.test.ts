import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// The adapter wraps the `gemini` CLI in plain-text mode (no stream-json
// parsing by design). We pin its public surface with a stub `gemini` binary.
// Bun caches PATH at startup, so each case runs the adapter in a child bun
// process whose PATH contains only the stub dir — no live API key needed,
// and the real gemini CLI is never reachable.

const ADAPTER = path.join(import.meta.dir, '..', 'lib', 'model-benchmark', 'providers', 'gemini.ts');
let stubDir: string;
let workdir: string;

beforeAll(() => {
  stubDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-stub-'));
  workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-work-'));
  // Stub needs sh + basic utils resolvable; symlink them into the stub dir.
  for (const bin of ['sh', 'echo', 'sleep']) {
    fs.symlinkSync(`/bin/${bin}`, path.join(stubDir, bin));
  }
});

afterAll(() => {
  fs.rmSync(stubDir, { recursive: true, force: true });
  fs.rmSync(workdir, { recursive: true, force: true });
});

function writeStub(script: string) {
  fs.writeFileSync(path.join(stubDir, 'gemini'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
}

/** Run `new GeminiAdapter().<method>(arg)` in a child bun with PATH = stubDir only. */
function runInChild(method: 'run' | 'available', arg?: unknown): any {
  const code = `
    import { GeminiAdapter } from ${JSON.stringify(ADAPTER)};
    const res = await new GeminiAdapter().${method}(${arg === undefined ? '' : JSON.stringify(arg)});
    console.log('__RESULT__' + JSON.stringify(res));
  `;
  const proc = spawnSync(process.execPath, ['-e', code], {
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, PATH: stubDir },
  });
  const m = proc.stdout.match(/__RESULT__(.*)/);
  if (!m) throw new Error(`child failed: ${proc.stderr}\n${proc.stdout}`);
  return JSON.parse(m[1]);
}

describe('GeminiAdapter.run', () => {
  test('captures trimmed stdout as the answer and passes the model flag', () => {
    writeStub('echo "model=$5"\necho "  real output  "');
    const res = runInChild('run', {
      prompt: 'q',
      workdir,
      timeoutMs: 5000,
      model: 'gemini-2.5-pro',
    });
    expect(res.error).toBeUndefined();
    expect(res.output).toBe('model=gemini-2.5-pro\n  real output');
    expect(res.modelUsed).toBe('gemini-2.5-pro');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('classifies auth failures from stderr', () => {
    writeStub('echo "error: api key invalid" >&2\nexit 1');
    const res = runInChild('run', { prompt: 'q', workdir, timeoutMs: 5000 });
    expect(res.error?.code).toBe('auth');
    expect(res.output).toBe('');
  });

  test('classifies rate-limit failures from stderr', () => {
    writeStub('echo "429 quota exceeded" >&2\nexit 1');
    const res = runInChild('run', { prompt: 'q', workdir, timeoutMs: 5000 });
    expect(res.error?.code).toBe('rate_limit');
  });

  test('classifies a timeout (SIGTERM) as timeout', () => {
    writeStub('sleep 10');
    const res = runInChild('run', { prompt: 'q', workdir, timeoutMs: 500 });
    expect(res.error?.code).toBe('timeout');
    expect(res.error?.reason).toBe('exceeded timeout');
  });
});

describe('GeminiAdapter.available', () => {
  test('reports not-ok when the gemini CLI is missing from PATH', () => {
    fs.rmSync(path.join(stubDir, 'gemini'), { force: true });
    const res = runInChild('available');
    expect(res.ok).toBe(false);
    expect(res.reason).toContain('not found');
  });
});
