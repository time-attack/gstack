/**
 * Spawn-stall guards for the three E2E child-spawn paths.
 *
 * Regression origin: a gate run executed 22 of 85 declared tests, went silent
 * for 2h08m (89% of wall clock), and died to an external SIGTERM with a
 * dangling child. A child that produces NO output trips no per-event timer, so
 * the awaiting helper never settles, the test never fails, and — because bun
 * runs test FILES serially in one process — every downstream file never runs.
 *
 * Each test here proves one path fails loudly and reaps its child instead:
 *   1. agent-sdk-runner — idle-stall abort + the concurrency slot comes back
 *   2. agent-sdk-runner — a leaked slot can never wedge later calls forever
 *   3. session-runner   — a silent `claude` is really dead after the timeout
 *   4. claude-pty-runner — a PTY child that never writes is killed with a reason
 *
 * Free tier: no API calls. The SDK path is driven through its queryProvider DI
 * hook; the subprocess paths spawn a local fixture script.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  runAgentSdkTest,
  ChildStallError,
  __resetSemaphoreForTests,
} from './helpers/agent-sdk-runner';
import { runSkillTest } from './helpers/session-runner';
import { launchClaudePty } from './helpers/claude-pty-runner';
import { isProcessAlive } from '../browse/src/error-handling';

/** How long the fixture child lingers. Long enough that "we killed it" is unambiguous. */
const LINGER_SECS = 60;

const SDK_BASE = {
  systemPrompt: '' as const,
  userPrompt: 'irrelevant',
  workingDirectory: os.tmpdir(),
  maxRetries: 0,
};

/** A query stream that connects and then never emits — the wedge we are guarding. */
function neverEmittingProvider(captured: { signal?: AbortSignal }) {
  return ((params: { options?: { abortController?: AbortController } }) => {
    captured.signal = params.options?.abortController?.signal;
    return (async function* () {
      await new Promise(() => { /* never resolves, never yields */ });
      yield undefined as never;
    })();
  }) as never;
}

/** A minimal healthy stream: one result event, immediately. */
const okProvider = (() =>
  (async function* () {
    yield { type: 'result', subtype: 'success', num_turns: 1, total_cost_usd: 0 } as never;
  })()) as never;

describe('agent-sdk-runner stall guards', () => {
  test('a never-emitting stream aborts on the idle ceiling and frees its slot', async () => {
    // Capacity 1 makes the slot-return assertion meaningful: if the stalled
    // call kept its token, the follow-up call could not acquire one.
    __resetSemaphoreForTests(1);
    const captured: { signal?: AbortSignal } = {};

    const started = Date.now();
    await expect(
      runAgentSdkTest({
        ...SDK_BASE,
        testName: 'stall-fixture',
        idleTimeoutMs: 300,
        timeoutMs: 5_000,
        queryProvider: neverEmittingProvider(captured),
      }),
    ).rejects.toThrow(ChildStallError);
    expect(Date.now() - started).toBeLessThan(5_000);

    // The child was told to die (SDK abort => stdin EOF, grace, kill).
    expect(captured.signal?.aborted).toBe(true);

    // ...and the slot is back, so one wedged child cannot stall the suite.
    const after = await runAgentSdkTest({
      ...SDK_BASE,
      timeoutMs: 5_000,
      queryProvider: okProvider,
    });
    expect(after.exitReason).toBe('success');
  }, 20_000);

  test('a leaked slot does not wedge later calls forever', async () => {
    // Capacity 0 simulates the worst case: every token permanently lost.
    __resetSemaphoreForTests(0);
    const result = await runAgentSdkTest({
      ...SDK_BASE,
      timeoutMs: 400, // doubles as the acquire ceiling
      queryProvider: okProvider,
    });
    expect(result.exitReason).toBe('success');
    __resetSemaphoreForTests(3);
  }, 20_000);
});

describe.skipIf(process.platform === 'win32')('subprocess stall guards', () => {
  let fixtureBin: string;
  let workDir: string;
  let pidFile: string;

  beforeAll(() => {
    fixtureBin = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-claude-bin-'));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-work-'));
    pidFile = path.join(workDir, 'child.pid');

    // A `claude` that connects and says NOTHING, ever. No stream-json, no
    // banner, no prompt. This is the shape that produced the silent gate run.
    const silentClaude = path.join(fixtureBin, 'claude');
    fs.writeFileSync(
      silentClaude,
      `#!/bin/sh
echo $$ > "${pidFile}"
exec sleep ${LINGER_SECS}
`,
      { mode: 0o755 },
    );
  });

  afterAll(() => {
    for (const dir of [fixtureBin, workDir]) {
      if (dir && fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('session-runner times out a silent child and the child is dead', async () => {
    const started = Date.now();
    const result = await runSkillTest({
      testName: 'spawn-stall-session-runner',
      workingDirectory: workDir,
      prompt: 'ignored by the fixture',
      timeout: 2_000,
      env: { PATH: `${fixtureBin}:${process.env.PATH ?? ''}` },
    });
    const wall = Date.now() - started;

    expect(result.exitReason).toBe('timeout');
    expect(wall).toBeLessThan(20_000); // not the fixture's full linger

    // The kill landed on the real child, not on a shell wrapper in front of it.
    const pid = Number(fs.readFileSync(pidFile, 'utf-8').trim());
    expect(Number.isInteger(pid)).toBe(true);
    expect(isProcessAlive(pid)).toBe(false);
  }, 40_000);

  test('claude-pty-runner kills a PTY child that never writes, with a reason', async () => {
    const session = await launchClaudePty({
      cwd: workDir,
      idleTimeoutMs: 1_000,
      timeoutMs: 60_000, // wall clock must NOT be what saves us here
      env: { BROWSE_TERMINAL_BINARY: path.join(fixtureBin, 'claude') },
      // The fixture ignores argv; keep the spawn minimal.
      permissionMode: null,
    });
    try {
      const started = Date.now();
      while (!session.exited() && Date.now() - started < 15_000) {
        await Bun.sleep(200);
      }
      expect(session.exited()).toBe(true);
      expect(session.stallReason()).toMatch(/no PTY output/);
      expect(Date.now() - started).toBeLessThan(15_000);
    } finally {
      await session.close();
    }
  }, 40_000);
});
