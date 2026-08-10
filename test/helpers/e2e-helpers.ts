/**
 * Shared helpers for E2E test files.
 *
 * Extracted from the monolithic skill-e2e.test.ts to support splitting
 * tests across multiple files by category.
 */

import '../../lib/conductor-env-shim';
import { describe, test, beforeAll, afterAll, expect } from 'bun:test';
import type { SkillTestResult } from './session-runner';
import { EvalCollector, judgePassed } from './eval-store';
import type { EvalTestEntry } from './eval-store';
import { judgeRecommendation, type RecommendationScore } from './llm-judge';
import { selectTests, detectBaseBranch, getChangedFiles, E2E_TOUCHFILES, E2E_TIERS, GLOBAL_TOUCHFILES } from './touchfiles';
import { WorktreeManager } from '../../lib/worktree';
import type { HarvestResult } from '../../lib/worktree';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const ROOT = path.resolve(import.meta.dir, '..', '..');

// Skip unless EVALS=1. Session runner strips CLAUDE* env vars to avoid nested session issues.
//
// BLAME PROTOCOL: When an eval fails, do NOT claim "pre-existing" or "not related
// to our changes" without proof. Run the same eval on main to verify. These tests
// have invisible couplings — preamble text, SKILL.md content, and timing all affect
// agent behavior. See CLAUDE.md "E2E eval failure blame protocol" for details.
export const evalsEnabled = !!process.env.EVALS;

// --- Diff-based test selection ---
// When EVALS_ALL is not set, only run tests whose touchfiles were modified.
// Set EVALS_ALL=1 to force all tests. Set EVALS_BASE to override base branch.
export let selectedTests: string[] | null = null; // null = run all

if (evalsEnabled && !process.env.EVALS_ALL) {
  const baseBranch = process.env.EVALS_BASE
    || detectBaseBranch(ROOT)
    || 'main';
  const changedFiles = getChangedFiles(baseBranch, ROOT);

  if (changedFiles.length > 0) {
    const selection = selectTests(changedFiles, E2E_TOUCHFILES, GLOBAL_TOUCHFILES);
    selectedTests = selection.selected;
    process.stderr.write(`\nE2E selection (${selection.reason}): ${selection.selected.length}/${Object.keys(E2E_TOUCHFILES).length} tests\n`);
    if (selection.skipped.length > 0) {
      process.stderr.write(`  Skipped: ${selection.skipped.join(', ')}\n`);
    }
    process.stderr.write('\n');
  }
  // If changedFiles is empty (e.g., on main branch), selectedTests stays null → run all
}

// EVALS_TIER: filter tests by tier after diff-based selection.
// 'gate' = gate tests only (CI default — blocks merge)
// 'periodic' = periodic tests only (weekly cron / manual)
// not set = run all selected tests (local dev default, backward compat)
if (evalsEnabled && process.env.EVALS_TIER) {
  const tier = process.env.EVALS_TIER as 'gate' | 'periodic';
  const tierTests = Object.entries(E2E_TIERS)
    .filter(([, t]) => t === tier)
    .map(([name]) => name);

  if (selectedTests === null) {
    selectedTests = tierTests;
  } else {
    selectedTests = selectedTests.filter(t => tierTests.includes(t));
  }
  process.stderr.write(`EVALS_TIER=${tier}: ${selectedTests.length} tests\n\n`);
}

export const describeE2E = evalsEnabled ? describe : describe.skip;

/** Wrap a describe block to skip entirely if none of its tests are selected. */
export function describeIfSelected(name: string, testNames: string[], fn: () => void) {
  const anySelected = selectedTests === null || testNames.some(t => selectedTests!.includes(t));
  (anySelected ? describeE2E : describe.skip)(name, fn);
}

// Unique run ID for this E2E session — used for heartbeat + per-run log directory
export const runId = new Date().toISOString().replace(/[:.]/g, '').replace('T', '-').slice(0, 15);

export const browseBin = path.resolve(ROOT, 'browse', 'dist', 'browse');

// Check if Anthropic API key is available (needed for outcome evals)
export const hasApiKey = !!process.env.ANTHROPIC_API_KEY;

/**
 * Copy a directory tree recursively (files only, follows structure).
 */
export function copyDirSync(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Install a retired 1.x skill name into an E2E workdir, the way a real user
 * reaches it today.
 *
 * The 1.x tree at the repo root is gone. A user who types `/office-hours` now
 * hits `skills/.compat/office-hours/SKILL.md`, a routing stub that dispatches
 * to `$plan --mode Discovery --module office-hours`, and the plan dispatcher
 * lazily reads `references/legacy/office-hours.md`. This installs that whole
 * path so an E2E test exercises what ships instead of a tree nobody gets.
 *
 * The alias lands at `<workDir>/<name>/SKILL.md`, so a prompt that already
 * says "Read office-hours/SKILL.md" keeps working unchanged.
 *
 * Returns the parsed route so a test can assert on the dispatch or build a
 * prompt from it. Throws if the alias or its module is missing — a silent
 * skip here is how a retired-name test rots into a no-op.
 */
export interface LegacyRoute {
  name: string;
  dispatcher: string;
  mode: string;
  module: string | null;
  invocation: string;
}

export function installLegacySkill(workDir: string, name: string): LegacyRoute {
  const aliasFile = path.join(ROOT, 'skills', '.compat', name, 'SKILL.md');
  if (!fs.existsSync(aliasFile)) {
    throw new Error(
      `installLegacySkill("${name}"): no compat alias at skills/.compat/${name}/SKILL.md. ` +
        `The 1.x root tree is deleted, so there is no other source for this skill.`,
    );
  }

  const alias = fs.readFileSync(aliasFile, 'utf-8');
  const route = alias.match(
    /\$(plan|qa|debug|review|ship)\s+--mode\s+([A-Za-z-]+)(?:\s+--module\s+([a-z0-9-]+))?/,
  );
  if (!route) {
    throw new Error(`installLegacySkill("${name}"): alias carries no $dispatcher --mode route.`);
  }
  const [, dispatcher, mode, moduleName = null] = route;

  // The alias, under its old name, so existing prompts resolve.
  fs.mkdirSync(path.join(workDir, name), { recursive: true });
  fs.copyFileSync(aliasFile, path.join(workDir, name, 'SKILL.md'));

  // The dispatcher it routes to. Copied whole: the agent reads it lazily
  // (SKILL.md, then the shared refs, then the one module), so disk size here
  // is not read size. Installing less would make the dispatch dead-end.
  const dispatcherDir = path.join(ROOT, 'skills', dispatcher);
  if (!fs.existsSync(dispatcherDir)) {
    throw new Error(`installLegacySkill("${name}"): routes to $${dispatcher}, which is not in skills/.`);
  }
  copyDirSync(dispatcherDir, path.join(workDir, 'skills', dispatcher));

  if (moduleName) {
    const moduleFile = path.join(dispatcherDir, 'references', 'legacy', `${moduleName}.md`);
    if (!fs.existsSync(moduleFile)) {
      throw new Error(
        `installLegacySkill("${name}"): alias routes to --module ${moduleName}, but ` +
          `skills/${dispatcher}/references/legacy/${moduleName}.md does not exist. Dangling route.`,
      );
    }
  }

  return {
    name,
    dispatcher,
    mode,
    module: moduleName,
    invocation: `$${dispatcher} --mode ${mode}${moduleName ? ` --module ${moduleName}` : ''}`,
  };
}

/**
 * Set up browse shims (binary symlink, remote-slug) in a tmpDir.
 */
export function setupBrowseShims(dir: string) {
  // Symlink browse binary
  const binDir = path.join(dir, 'browse', 'dist');
  fs.mkdirSync(binDir, { recursive: true });
  if (fs.existsSync(browseBin)) {
    fs.symlinkSync(browseBin, path.join(binDir, 'browse'));
  }

  const findBrowseDir = path.join(dir, 'browse', 'bin');
  fs.mkdirSync(findBrowseDir, { recursive: true });

  // remote-slug shim (returns test-project)
  fs.writeFileSync(
    path.join(findBrowseDir, 'remote-slug'),
    `#!/bin/bash\necho "test-project"\n`,
    { mode: 0o755 },
  );
}

/**
 * Print cost summary after an E2E test.
 */
export function logCost(label: string, result: { costEstimate: { turnsUsed: number; estimatedTokens: number; estimatedCost: number }; duration: number }) {
  const { turnsUsed, estimatedTokens, estimatedCost } = result.costEstimate;
  const durationSec = Math.round(result.duration / 1000);
  console.log(`${label}: $${estimatedCost.toFixed(2)} (${turnsUsed} turns, ${(estimatedTokens / 1000).toFixed(1)}k tokens, ${durationSec}s)`);
}

/**
 * Dump diagnostic info on planted-bug outcome failure (decision 1C).
 */
export function dumpOutcomeDiagnostic(dir: string, label: string, report: string, judgeResult: any) {
  try {
    const transcriptDir = path.join(dir, '.gstack', 'test-transcripts');
    fs.mkdirSync(transcriptDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(
      path.join(transcriptDir, `${label}-outcome-${timestamp}.json`),
      JSON.stringify({ label, report, judgeResult }, null, 2),
    );
  } catch { /* non-fatal */ }
}

/**
 * Create an EvalCollector for a specific suite. Returns null if evals are not enabled.
 */
export function createEvalCollector(suite: string): EvalCollector | null {
  return evalsEnabled ? new EvalCollector(suite) : null;
}

/** DRY helper to record an E2E test result into the eval collector. */
export function recordE2E(
  evalCollector: EvalCollector | null,
  name: string,
  suite: string,
  result: SkillTestResult,
  extra?: Partial<EvalTestEntry>,
) {
  // Derive last tool call from transcript for machine-readable diagnostics
  const lastTool = result.toolCalls.length > 0
    ? `${result.toolCalls[result.toolCalls.length - 1].tool}(${JSON.stringify(result.toolCalls[result.toolCalls.length - 1].input).slice(0, 60)})`
    : undefined;

  evalCollector?.addTest({
    name, suite, tier: 'e2e',
    passed: result.exitReason === 'success' && result.browseErrors.length === 0,
    duration_ms: result.duration,
    cost_usd: result.costEstimate.estimatedCost,
    transcript: result.transcript,
    output: result.output?.slice(0, 2000),
    turns_used: result.costEstimate.turnsUsed,
    browse_errors: result.browseErrors,
    exit_reason: result.exitReason,
    timeout_at_turn: result.exitReason === 'timeout' ? result.costEstimate.turnsUsed : undefined,
    last_tool_call: lastTool,
    model: result.model,
    first_response_ms: result.firstResponseMs,
    max_inter_turn_ms: result.maxInterTurnMs,
    ...extra,
  });
}

/**
 * Hard-require a report artifact from an E2E run.
 *
 * The old pattern — `if (fs.existsSync(reportPath)) { ...content asserts... }` —
 * let an agent that wrote NOTHING pass every content assertion: zero review
 * output was a green test. This helper makes the artifact itself the
 * assertion: missing or near-empty report = test failure, and callers get the
 * content back for their own checks.
 */
export function requireReportArtifact(filePath: string, minLength = 50): string {
  expect(
    fs.existsSync(filePath),
    `report artifact missing: ${filePath} — the agent produced no report. Zero output is a FAILURE, not a skip.`,
  ).toBe(true);
  const content = fs.readFileSync(filePath, 'utf-8');
  expect(
    content.trim().length,
    `report artifact nearly empty (<${minLength} chars): ${filePath}`,
  ).toBeGreaterThanOrEqual(minLength);
  return content;
}

/** One finding parsed from the canonical calibrated review format. */
export interface ReviewFinding {
  severity: string;
  confidence: number;
  file: string;
  line: number;
  description: string;
  raw: string;
}

/**
 * Parse findings in the canonical format the preserved review module mandates
 * (skills/review/references/legacy/review.md, "Finding format"):
 *
 *   [P1] (confidence: 9/10) app/models/user.rb:42 — SQL injection via ...
 *
 * Liberal on the severity token and dash flavor, strict on `(confidence: N/10)`
 * and `file:line` — those two are the contract ("calibrated findings with
 * file-and-line evidence"). Findings without them do not parse and do not count.
 */
export function parseReviewFindings(report: string): ReviewFinding[] {
  const findings: ReviewFinding[] = [];
  const re = /\[([A-Za-z][\w -]{0,15})\]\s*\(confidence:\s*(\d{1,2})\s*\/\s*10\)\s*`?([\w@./\\-]+\.\w{1,8}):(\d+)(?:-\d+)?`?\s*(?:—|–|--|-|:)\s*(.+)/g;
  for (const m of report.matchAll(re)) {
    findings.push({
      severity: m[1].trim(),
      confidence: parseInt(m[2], 10),
      file: m[3].replace(/^\.\//, ''),
      line: parseInt(m[4], 10),
      description: m[5].trim(),
      raw: m[0],
    });
  }
  return findings;
}

/**
 * Threshold for `reason_substance` (1-5 rubric) above which a recommendation
 * is considered substantive enough to ship. 4 = "concrete and option-specific";
 * 3 = generic ("because it's faster"). We want to catch generic. If Haiku
 * flakes at this bar in practice, lower the threshold rather than weakening
 * the gate (per design plan).
 */
export const RECOMMENDATION_SUBSTANCE_THRESHOLD = 4;

/**
 * Run judgeRecommendation on a captured AskUserQuestion text, record the score
 * into the eval collector, and assert all four quality dimensions. Replaces a
 * 22-line block previously duplicated across every E2E test that captures an
 * AskUserQuestion. Returns the score for tests that want to inspect it
 * further.
 */
export async function assertRecommendationQuality(opts: {
  captured: string;
  evalCollector: EvalCollector | null;
  evalId: string;
  evalTitle: string;
  result: SkillTestResult;
  passed: boolean;
}): Promise<RecommendationScore> {
  const recScore = await judgeRecommendation(opts.captured);
  recordE2E(opts.evalCollector, opts.evalId, opts.evalTitle, opts.result, {
    passed: opts.passed,
    judge_scores: {
      rec_present: recScore.present ? 1 : 0,
      rec_commits: recScore.commits ? 1 : 0,
      rec_has_because: recScore.has_because ? 1 : 0,
      rec_substance: recScore.reason_substance,
    },
    judge_reasoning: `${recScore.reasoning} | reason: "${recScore.reason_text}"`,
  });
  expect(recScore.present, recScore.reasoning).toBe(true);
  expect(recScore.commits, recScore.reasoning).toBe(true);
  expect(recScore.has_because, recScore.reasoning).toBe(true);
  expect(
    recScore.reason_substance,
    `${recScore.reasoning}\n  reason: "${recScore.reason_text}"`,
  ).toBeGreaterThanOrEqual(RECOMMENDATION_SUBSTANCE_THRESHOLD);
  return recScore;
}

/** Finalize an eval collector (write results). */
export async function finalizeEvalCollector(evalCollector: EvalCollector | null) {
  if (evalCollector) {
    try {
      await evalCollector.finalize();
    } catch (err) {
      console.error('Failed to save eval results:', err);
    }
  }
}

// Pre-seed preamble state files so E2E tests don't waste turns on lake intro + telemetry prompts.
// These are one-time interactive prompts that burn 3-7 turns per test if not pre-seeded.
if (evalsEnabled) {
  const gstackDir = path.join(os.homedir(), '.gstack');
  fs.mkdirSync(gstackDir, { recursive: true });
  for (const f of ['.completeness-intro-seen', '.telemetry-prompted', '.proactive-prompted']) {
    const p = path.join(gstackDir, f);
    if (!fs.existsSync(p)) fs.writeFileSync(p, '');
  }
}

// Fail fast if Anthropic API is unreachable — don't burn through tests getting ConnectionRefused
if (evalsEnabled) {
  const check = spawnSync('sh', ['-c', 'echo "ping" | claude -p --max-turns 1 --output-format stream-json --verbose --dangerously-skip-permissions'], {
    stdio: 'pipe', timeout: 30_000,
  });
  const output = check.stdout?.toString() || '';
  if (output.includes('ConnectionRefused') || output.includes('Unable to connect')) {
    throw new Error('Anthropic API unreachable — aborting E2E suite. Fix connectivity and retry.');
  }
}

/** Skip an individual test if not selected (for multi-test describe blocks). */
export function testIfSelected(testName: string, fn: () => Promise<void>, timeout: number) {
  const shouldRun = selectedTests === null || selectedTests.includes(testName);
  (shouldRun ? test : test.skip)(testName, fn, timeout);
}

/** Concurrent version — runs in parallel with other concurrent tests within the same describe block. */
export function testConcurrentIfSelected(testName: string, fn: () => Promise<void>, timeout: number) {
  const shouldRun = selectedTests === null || selectedTests.includes(testName);
  (shouldRun ? test.concurrent : test.skip)(testName, fn, timeout);
}

// --- Worktree isolation ---

let worktreeManager: WorktreeManager | null = null;

export function getWorktreeManager(): WorktreeManager {
  if (!worktreeManager) {
    worktreeManager = new WorktreeManager();
    worktreeManager.pruneStale();
  }
  return worktreeManager;
}

/** Create an isolated worktree for a test. Returns the worktree path. */
export function createTestWorktree(testName: string): string {
  return getWorktreeManager().create(testName);
}

/** Harvest changes and clean up. Call in afterAll(). Returns HarvestResult for eval integration. */
export function harvestAndCleanup(testName: string): HarvestResult | null {
  const mgr = getWorktreeManager();
  const result = mgr.harvest(testName);
  if (result) {
    if (result.isDuplicate) {
      process.stderr.write(`\n  HARVEST [${testName}]: duplicate patch (skipped)\n`);
    } else {
      process.stderr.write(`\n  HARVEST [${testName}]: ${result.changedFiles.length} files changed\n`);
      process.stderr.write(`  Patch: ${result.patchPath}\n`);
      process.stderr.write(`  ${result.diffStat}\n\n`);
    }
  }
  mgr.cleanup(testName);
  return result;
}

/**
 * Convenience: describe block with automatic worktree isolation + harvest.
 * Any test file can use this to get real repo context instead of a tmpdir.
 * Note: tests with planted-bug fixtures should NOT use this — they need their fixture repos.
 */
export function describeWithWorktree(
  name: string,
  testNames: string[],
  fn: (getWorktreePath: () => string) => void,
) {
  describeIfSelected(name, testNames, () => {
    let worktreePath: string;
    beforeAll(() => { worktreePath = createTestWorktree(name); });
    afterAll(() => { harvestAndCleanup(name); });
    fn(() => worktreePath);
  });
}

export { judgePassed } from './eval-store';
export { EvalCollector } from './eval-store';
export type { EvalTestEntry } from './eval-store';
export type { HarvestResult } from '../../lib/worktree';
