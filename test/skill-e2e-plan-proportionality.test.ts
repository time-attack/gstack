/**
 * /plan proportionality regression test (field failure, #886 class).
 *
 * Field failure: /plan treated a trivial rename as a full planning engagement —
 * loaded the specialist module stack, produced a multi-thousand-char report,
 * and in the worst case hard-blocked in headless mode without ever emitting
 * the concrete edit list the user asked for.
 *
 * The dispatcher's "Trivial-change fast path" (skills/plan/SKILL.md) is the
 * fix: a mechanical, fully-specified rename must skip every specialist module
 * and every per-invocation reference, and answer with the edit list (or the
 * applied edit — the prompt is affirmative mutation authority).
 *
 * This test drives /plan against a one-file repo with a trivial rename prompt
 * and asserts proportionality three ways:
 *   1. Final assistant message stays under a sane ceiling (< 4000 chars).
 *   2. The session read at most 3 files under plan/references/ (the fast path
 *      says zero; 3 is slack, the field failure read the whole legacy stack).
 *   3. It did not hard-block: the rename is either applied on disk or the
 *      output contains the concrete edit plan (file + old symbol + new symbol).
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, runId,
  describeIfSelected, testConcurrentIfSelected,
  copyDirSync, logCost, recordE2E,
  createEvalCollector, finalizeEvalCollector,
} from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e-plan-proportionality');

const SOURCE_FILE = `export function calc(items: { price: number; qty: number }[]): number {
  return items.reduce((sum, item) => sum + item.price * item.qty, 0);
}

export function receiptLine(items: { price: number; qty: number }[]): string {
  return \`Total: $\${calc(items).toFixed(2)}\`;
}
`;

describeIfSelected('Plan Proportionality E2E', ['plan-proportionality'], () => {
  let workDir: string;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-plan-prop-'));
    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: workDir, stdio: 'pipe', timeout: 5000 });

    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);

    // One-file repo: the entire rename surface is a single small file.
    fs.writeFileSync(path.join(workDir, 'pricing.ts'), SOURCE_FILE);
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);

    // Copy the full /plan dispatcher tree (SKILL.md + references/, including
    // references/legacy/). The legacy modules being PRESENT is the point: the
    // failure mode under test is the agent reading them for a trivial rename,
    // so they must be available to read.
    copyDirSync(path.join(ROOT, 'skills', 'plan'), path.join(workDir, 'plan'));
  });

  afterAll(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  });

  testConcurrentIfSelected('plan-proportionality', async () => {
    const result = await runSkillTest({
      prompt: `Read plan/SKILL.md for the /plan skill instructions and follow them.

The user has invoked /plan and says: "Rename the function calc to computeTotal across this repo."

Do NOT use AskUserQuestion — this is non-interactive.`,
      workingDirectory: workDir,
      maxTurns: 15,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob'],
      timeout: 240_000,
      testName: 'plan-proportionality',
      runId,
    });

    logCost('/plan proportionality (trivial rename)', result);

    // --- Assertion 2: at most 3 distinct plan reference modules read. ---
    // Scan Read tool calls (file_path) and Bash commands (cat/sed reads) for
    // anything under plan/references/. The trivial fast path mandates zero;
    // <= 3 tolerates a partial dispatch-step-4 read without letting the full
    // legacy-module stack (6+ modules, 848K) back in.
    const refRe = /plan\/references\/[^\s"'`)\]]+/g;
    const refsRead = new Set<string>();
    for (const call of result.toolCalls) {
      const haystack =
        call.tool === 'Read' ? String(call.input?.file_path ?? '') :
        call.tool === 'Bash' ? String(call.input?.command ?? '') : '';
      for (const m of haystack.match(refRe) ?? []) refsRead.add(m);
    }

    // --- Assertion 3: no hard-block without a concrete edit plan. ---
    // The prompt is affirmative mutation authority, so the ideal outcome is
    // the rename applied on disk. A concrete edit plan in the final message
    // (file + before -> after symbols) also passes. A BLOCKED/refusal with
    // neither is the regression.
    const source = fs.readFileSync(path.join(workDir, 'pricing.ts'), 'utf-8');
    const appliedOnDisk = source.includes('computeTotal') && !/\bfunction calc\b/.test(source);
    const plannedInOutput =
      result.output.includes('pricing.ts') &&
      /\bcalc\b/.test(result.output) &&
      result.output.includes('computeTotal');

    const exitOk = result.exitReason === 'success';
    recordE2E(evalCollector, '/plan-proportionality', 'Plan proportionality on trivial rename', result, {
      passed: exitOk && result.output.length < 4000 && refsRead.size <= 3 && (appliedOnDisk || plannedInOutput),
    });

    // A trivial rename that burns all 15 turns is itself a proportionality
    // failure, so error_max_turns is NOT accepted here (unlike review suites).
    expect(exitOk, `expected success, got ${result.exitReason}`).toBe(true);

    // --- Assertion 1: final assistant message under the ceiling. ---
    // The fast path says "a rename does not need a report; it needs the
    // rename". 4000 chars is generous; the field failure produced 10K+.
    expect(
      result.output.length,
      `final message is ${result.output.length} chars — trivial rename must not produce a report`,
    ).toBeLessThan(4000);

    expect(
      refsRead.size,
      `read ${refsRead.size} plan/references/ files for a trivial rename: ${[...refsRead].join(', ')}`,
    ).toBeLessThanOrEqual(3);

    expect(
      appliedOnDisk || plannedInOutput,
      `no concrete rename outcome: not applied on disk and final message lacks the edit plan (pricing.ts, calc -> computeTotal). Output: ${result.output.slice(0, 500)}`,
    ).toBe(true);
  }, 300_000);
});

afterAll(async () => {
  await finalizeEvalCollector(evalCollector);
});
