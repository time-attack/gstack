/**
 * Review precision E2E — the behavioral test behind
 * judgment.review.precision-contract ("run seeded true-positive and
 * false-positive diffs and assert calibrated findings with file-and-line
 * evidence").
 *
 * One hermetic /review run over a single mixed-corpus diff:
 *   - test/fixtures/review-precision/feature/billing/* — 11 seeded FALSE
 *     POSITIVES: guarded-but-suspicious code that is CORRECT (DB-constraint-
 *     backed "race", hook-layer authz, the four #1539 Django classes, ...).
 *   - test/fixtures/review-precision/feature/rentals/* — 4 planted TRUE
 *     bugs (SQL injection, enum completeness, None crash, lost-update race).
 *
 * Unlike the 1.x review E2E tests, this one:
 *   1. installs and exercises the INSTALLED GStack 2 dispatcher
 *      (skills/review/SKILL.md + lazy references), not the 1.x review/SKILL.md;
 *   2. hard-requires the report artifact (zero output = fail);
 *   3. parses findings against the canonical calibrated format
 *      `[SEVERITY] (confidence: N/10) file:line — description`;
 *   4. asserts FP calibration (zero confidence>=7 findings on the FP corpus)
 *      and recall (>= threshold planted bugs caught with file:line evidence
 *      near the planted line) IN THE SAME RUN — a reviewer that says nothing
 *      fails recall, a reviewer that cries wolf fails calibration.
 *
 * Tier: periodic (quality benchmark, non-deterministic model judgment).
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, runId, describeIfSelected, testConcurrentIfSelected,
  copyDirSync, logCost, recordE2E, createEvalCollector, finalizeEvalCollector,
  requireReportArtifact, parseReviewFindings,
} from './helpers/e2e-helpers';
import type { ReviewFinding } from './helpers/e2e-helpers';
import { buildSeedConfig } from './helpers/hermetic-env';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e-review-precision');

const FIXTURE_DIR = path.join(ROOT, 'test', 'fixtures', 'review-precision');

interface AnswerKey {
  fp_confidence_bar: number;
  recall_threshold: number;
  fp_files: string[];
  fp_seeds: Array<{ id: string; class: string; file: string; trap: string; why_correct: string }>;
  planted_bugs: Array<{
    id: string;
    class: string;
    files: Array<{ file: string; anchor: string }>;
    match: string;
  }>;
}

const answerKey: AnswerKey = JSON.parse(
  fs.readFileSync(path.join(FIXTURE_DIR, 'answer-key.json'), 'utf-8'),
);

/** Basenames that appear in exactly one corpus side — safe to match without a dir. */
function unambiguousBasenames(ownFiles: string[], otherFiles: string[]): Set<string> {
  const other = new Set(otherFiles.map(f => path.basename(f)));
  return new Set(ownFiles.map(f => path.basename(f)).filter(b => !other.has(b)));
}

const tpFiles = answerKey.planted_bugs.flatMap(b => b.files.map(f => f.file));
const fpBasenames = unambiguousBasenames(answerKey.fp_files, tpFiles);
const tpBasenames = unambiguousBasenames(tpFiles, answerKey.fp_files);

/** Does a cited path refer to this corpus-relative path? */
function citesFile(cited: string, corpusPath: string, ownUnambiguous: Set<string>): boolean {
  const norm = cited.replace(/\\/g, '/').replace(/^\.\//, '');
  if (norm === corpusPath || norm.endsWith('/' + corpusPath)) return true;
  const base = path.basename(corpusPath);
  return norm === base && ownUnambiguous.has(base);
}

/** 1-based line of the first occurrence of `anchor` in a repo file, or -1. */
function anchorLine(repoDir: string, file: string, anchor: string): number {
  const p = path.join(repoDir, file);
  if (!fs.existsSync(p)) return -1;
  const lines = fs.readFileSync(p, 'utf-8').split('\n');
  const idx = lines.findIndex(l => l.includes(anchor));
  return idx === -1 ? -1 : idx + 1;
}

describeIfSelected('Review precision (FP calibration + recall) E2E', ['review-precision'], () => {
  let repoDir: string;
  let configDir: string;
  let rootDir: string;

  beforeAll(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-review-precision-'));
    repoDir = path.join(rootDir, 'siterent');
    fs.mkdirSync(repoDir, { recursive: true });

    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: repoDir, stdio: 'pipe', timeout: 5000 });

    // Base commit on main: rentals app with 4 statuses + consumers handling all 4.
    copyDirSync(path.join(FIXTURE_DIR, 'base'), repoDir);
    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'rentals app: models, status lifecycle']);

    // Feature branch: billing app (FP seeds) + rentals additions (planted bugs).
    // rentals/status.py is deliberately NOT touched — the enum-completeness bug
    // requires reading consumers outside the diff.
    run('git', ['checkout', '-b', 'feature/billing-and-search']);
    copyDirSync(path.join(FIXTURE_DIR, 'feature'), repoDir);
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'add billing app, rental search, deposit charges, returned status']);

    // Install the CANONICAL GStack 2 dispatcher tree into a fresh per-test
    // CLAUDE_CONFIG_DIR — the same skills/review payload users get from
    // `npx skills add time-attack/gstack/skills`. Per-test env overrides merge
    // last in runSkillTest, so the rest of the hermetic scrub stays intact.
    configDir = path.join(rootDir, 'claude-config');
    fs.mkdirSync(path.join(configDir, 'skills'), { recursive: true });
    copyDirSync(path.join(ROOT, 'skills', 'review'), path.join(configDir, 'skills', 'review'));
    const seed = buildSeedConfig({
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.GSTACK_ANTHROPIC_API_KEY,
      trustedDirs: [repoDir],
    });
    fs.writeFileSync(path.join(configDir, '.claude.json'), JSON.stringify(seed, null, 2));
  });

  afterAll(() => {
    try { fs.rmSync(rootDir, { recursive: true, force: true }); } catch {}
  });

  testConcurrentIfSelected('review-precision', async () => {
    const reportPath = path.join(repoDir, 'review-output.md');

    const result = await runSkillTest({
      prompt: `/review

Harness constraints for this run (environment facts, not review guidance):
- Non-interactive headless session. Never wait for user input. Where the workflow asks a question or reaches an approval gate, take the report-only default and continue.
- Mutation authorization: NONE. Report-only. The only file you may create or modify is the report file below.
- There is no remote, no PR, and no network. The base branch is the local branch "main" (diff scope: git diff main...HEAD). Skip gh/glab/Greptile/web steps silently.
- State persistence binaries are not installed; skip persistence steps silently.
- Write the COMPLETE review report to ${reportPath} — including every calibrated finding and the suppressed-findings appendix.
- Every finding MUST use the exact calibrated format the review module mandates: [SEVERITY] (confidence: N/10) file:line — description`,
      workingDirectory: repoDir,
      maxTurns: 70,
      allowedTools: ['Skill', 'Bash', 'Read', 'Write', 'Grep', 'Glob'],
      timeout: 1_500_000,
      testName: 'review-precision',
      runId,
      env: { CLAUDE_CONFIG_DIR: configDir },
    });

    logCost('/review precision', result);
    expect(result.exitReason).toBe('success');

    // --- Hard requirement 1: the dispatcher actually governed the run ---
    // The installed SKILL.md mandates the execution header before substantive
    // output. Accept either the header text (slash-command expansion path) or
    // an explicit Skill tool invocation.
    const assistantText = result.transcript
      .filter((e: any) => e.type === 'assistant')
      .flatMap((e: any) => (e.message?.content || []))
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n');
    const skillToolUsed = result.toolCalls.some(
      tc => tc.tool === 'Skill' && JSON.stringify(tc.input).includes('review'),
    );
    const reportContent = fs.existsSync(reportPath) ? fs.readFileSync(reportPath, 'utf-8') : '';
    const headerPrinted = /Active modules:/.test(assistantText + '\n' + reportContent);
    expect(
      skillToolUsed || headerPrinted,
      'no evidence the installed skills/review dispatcher ran (no Skill tool call, no execution header)',
    ).toBe(true);

    // --- Hard requirement 2: report artifact exists and is substantive ---
    const report = requireReportArtifact(reportPath, 200);

    // --- Hard requirement 3: findings parse in the canonical format ---
    const findings = parseReviewFindings(report);
    expect(
      findings.length,
      `no findings parsed in the canonical format "[SEVERITY] (confidence: N/10) file:line — desc". Report head:\n${report.slice(0, 800)}`,
    ).toBeGreaterThanOrEqual(1);

    const bar = answerKey.fp_confidence_bar;
    const shown = findings.filter(f => f.confidence >= bar);

    // --- Hard requirement 4: FP calibration — zero cried wolves ---
    // A confidence>=7 finding is "shown normally" per the calibration table;
    // one that targets a seeded-correct billing/ file is a false positive
    // presented to the user as fact.
    const fpHits = shown.filter(f =>
      answerKey.fp_files.some(fp => citesFile(f.file, fp, fpBasenames)),
    );
    if (fpHits.length > 0) {
      console.log('FALSE POSITIVES (confidence >= ' + bar + ' on seeded-correct code):');
      for (const f of fpHits) console.log('  ' + f.raw);
    }

    // --- Hard requirement 5: recall — silence does not pass ---
    const caught: string[] = [];
    const missed: string[] = [];
    for (const bug of answerKey.planted_bugs) {
      const matcher = new RegExp(bug.match, 'i');
      const hit = shown.find(f =>
        bug.files.some(bf => {
          if (!citesFile(f.file, bf.file, tpBasenames)) return false;
          const anchor = anchorLine(repoDir, bf.file, bf.anchor);
          // file:line evidence must point at the planted bug, not just the file
          return anchor > 0 && Math.abs(f.line - anchor) <= 15 && matcher.test(f.raw);
        }),
      );
      if (hit) {
        caught.push(`${bug.id} (${bug.class}) ← ${hit.raw}`);
      } else {
        missed.push(`${bug.id} (${bug.class}) in ${bug.files.map(f => f.file).join('|')}`);
      }
    }

    console.log(`Review precision scores: FP=${fpHits.length} (bar: 0), recall=${caught.length}/${answerKey.planted_bugs.length} (bar: ${answerKey.recall_threshold}), parsed findings=${findings.length}`);
    for (const c of caught) console.log('  CAUGHT ' + c);
    for (const m of missed) console.log('  MISSED ' + m);

    recordE2E(evalCollector, '/review precision (FP + recall)', 'Review precision E2E', result, {
      passed:
        fpHits.length === 0 &&
        caught.length >= answerKey.recall_threshold &&
        findings.length >= 1,
      judge_scores: {
        fp_high_conf: fpHits.length,
        recall_caught: caught.length,
        findings_parsed: findings.length,
      },
      judge_reasoning:
        `FP hits: ${fpHits.map(f => f.raw).join(' ; ') || 'none'} | ` +
        `caught: ${caught.join(' ; ') || 'none'} | missed: ${missed.join(' ; ') || 'none'}`,
    });

    expect(
      fpHits.length,
      `review cried wolf on seeded-correct code:\n${fpHits.map(f => '  ' + f.raw).join('\n')}`,
    ).toBe(0);
    expect(
      caught.length,
      `recall below threshold — missed: ${missed.join(', ')}`,
    ).toBeGreaterThanOrEqual(answerKey.recall_threshold);
  }, 1_800_000);
});

afterAll(async () => {
  await finalizeEvalCollector(evalCollector);
});
