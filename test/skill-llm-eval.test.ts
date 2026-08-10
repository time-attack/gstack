/**
 * LLM-as-a-Judge evals for generated SKILL.md quality.
 *
 * Uses the Anthropic API directly (not Agent SDK) to evaluate whether
 * generated command docs are clear, complete, and actionable for an AI agent.
 *
 * Requires: ANTHROPIC_API_KEY env var (or EVALS=1 with key already set)
 * Run: EVALS=1 bun run test:eval
 *
 * Cost: ~$0.05-0.15 per run (sonnet)
 */

import { describe, test, expect, afterAll } from 'bun:test';
import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs';
import * as path from 'path';
import { callJudge, judge } from './helpers/llm-judge';
import type { JudgeScore } from './helpers/llm-judge';
import { EvalCollector } from './helpers/eval-store';
import { selectTests, detectBaseBranch, getChangedFiles, LLM_JUDGE_TOUCHFILES, GLOBAL_TOUCHFILES } from './helpers/touchfiles';

const ROOT = path.resolve(import.meta.dir, '..');
// Run when EVALS=1 is set (requires ANTHROPIC_API_KEY in env).
// Whole-file tier: every test here is an LLM-judge score-threshold check —
// a quality benchmark per the E2E tiering policy, so EVALS_TIER === 'periodic',
// never gate. The first completed gate run (2026-08-09) spent its failures on
// judge thresholds that had been failing on main since at least 2026-08-02;
// that is periodic signal, not a merge gate.
const evalsEnabled = !!process.env.EVALS && (!process.env.EVALS_TIER || process.env.EVALS_TIER === 'periodic');
const describeEval = evalsEnabled ? describe : describe.skip;

// Eval result collector
const evalCollector = evalsEnabled ? new EvalCollector('llm-judge') : null;

// --- Diff-based test selection ---
let selectedTests: string[] | null = null;

if (evalsEnabled && !process.env.EVALS_ALL) {
  const baseBranch = process.env.EVALS_BASE
    || detectBaseBranch(ROOT)
    || 'main';
  const changedFiles = getChangedFiles(baseBranch, ROOT);

  if (changedFiles.length > 0) {
    const selection = selectTests(changedFiles, LLM_JUDGE_TOUCHFILES, GLOBAL_TOUCHFILES);
    selectedTests = selection.selected;
    process.stderr.write(`\nLLM-judge selection (${selection.reason}): ${selection.selected.length}/${Object.keys(LLM_JUDGE_TOUCHFILES).length} tests\n`);
    if (selection.skipped.length > 0) {
      process.stderr.write(`  Skipped: ${selection.skipped.join(', ')}\n`);
    }
    process.stderr.write('\n');
  }
}

/** Wrap a describe block to skip if none of its tests are selected. */
function describeIfSelected(name: string, testNames: string[], fn: () => void) {
  const anySelected = selectedTests === null || testNames.some(t => selectedTests!.includes(t));
  (anySelected ? describeEval : describe.skip)(name, fn);
}

/** Skip an individual test if not selected (for multi-test describe blocks). */
function testIfSelected(testName: string, fn: () => Promise<void>, timeout: number) {
  const shouldRun = selectedTests === null || selectedTests.includes(testName);
  (shouldRun ? test.concurrent : test.skip)(testName, fn, timeout);
}

describeIfSelected('LLM-as-judge quality evals', [
  'command reference table', 'snapshot flags reference',
  'browse/SKILL.md reference', 'setup block', 'regression vs baseline',
], () => {
  testIfSelected('command reference table', async () => {
    const t0 = Date.now();
    // P2 (v1.2.0): the command reference moved from the root router to browse/SKILL.md.
    const content = fs.readFileSync(path.join(ROOT, 'browse', 'SKILL.md'), 'utf-8');
    const start = content.indexOf('## Full Command List');
    const section = content.slice(start);

    const scores = await judge('command reference table', section);
    console.log('Command reference scores:', JSON.stringify(scores, null, 2));

    // Completeness threshold is 3 (not 4) — the command reference table is
    // intentionally terse (quick-reference format). The judge consistently scores
    // completeness=3 because detailed argument docs live in per-command sections.
    evalCollector?.addTest({
      name: 'command reference table',
      suite: 'LLM-as-judge quality evals',
      tier: 'llm-judge',
      passed: scores.clarity >= 4 && scores.completeness >= 3 && scores.actionability >= 4,
      duration_ms: Date.now() - t0,
      cost_usd: 0.02,
      judge_scores: { clarity: scores.clarity, completeness: scores.completeness, actionability: scores.actionability },
      judge_reasoning: scores.reasoning,
    });

    expect(scores.clarity).toBeGreaterThanOrEqual(4);
    expect(scores.completeness).toBeGreaterThanOrEqual(3);
    expect(scores.actionability).toBeGreaterThanOrEqual(4);
  }, 30_000);

  testIfSelected('snapshot flags reference', async () => {
    const t0 = Date.now();
    // P2 (v1.2.0): snapshot flags moved from the root router to browse/SKILL.md.
    const content = fs.readFileSync(path.join(ROOT, 'browse', 'SKILL.md'), 'utf-8');
    const start = content.indexOf('## Snapshot Flags');
    const end = content.indexOf('## CSS Inspector');
    const section = content.slice(start, end);

    const scores = await judge('snapshot flags reference', section);
    console.log('Snapshot flags scores:', JSON.stringify(scores, null, 2));

    evalCollector?.addTest({
      name: 'snapshot flags reference',
      suite: 'LLM-as-judge quality evals',
      tier: 'llm-judge',
      passed: scores.clarity >= 4 && scores.completeness >= 4 && scores.actionability >= 4,
      duration_ms: Date.now() - t0,
      cost_usd: 0.02,
      judge_scores: { clarity: scores.clarity, completeness: scores.completeness, actionability: scores.actionability },
      judge_reasoning: scores.reasoning,
    });

    expect(scores.clarity).toBeGreaterThanOrEqual(4);
    expect(scores.completeness).toBeGreaterThanOrEqual(4);
    expect(scores.actionability).toBeGreaterThanOrEqual(4);
  }, 30_000);

  testIfSelected('browse/SKILL.md reference', async () => {
    const t0 = Date.now();
    const content = fs.readFileSync(path.join(ROOT, 'browse', 'SKILL.md'), 'utf-8');
    const start = content.indexOf('## Snapshot Flags');
    const section = content.slice(start);

    const scores = await judge('browse skill reference (flags + commands)', section);
    console.log('Browse SKILL.md scores:', JSON.stringify(scores, null, 2));

    evalCollector?.addTest({
      name: 'browse/SKILL.md reference',
      suite: 'LLM-as-judge quality evals',
      tier: 'llm-judge',
      passed: scores.clarity >= 4 && scores.completeness >= 4 && scores.actionability >= 4,
      duration_ms: Date.now() - t0,
      cost_usd: 0.02,
      judge_scores: { clarity: scores.clarity, completeness: scores.completeness, actionability: scores.actionability },
      judge_reasoning: scores.reasoning,
    });

    expect(scores.clarity).toBeGreaterThanOrEqual(4);
    expect(scores.completeness).toBeGreaterThanOrEqual(4);
    expect(scores.actionability).toBeGreaterThanOrEqual(4);
  }, 30_000);

  testIfSelected('setup block', async () => {
    const t0 = Date.now();
    // P2 (v1.2.0): the browse setup block moved from the root router to browse/SKILL.md.
    const content = fs.readFileSync(path.join(ROOT, 'browse', 'SKILL.md'), 'utf-8');
    const setupStart = content.indexOf('## SETUP');
    const setupEnd = content.indexOf('## Core QA Patterns');
    const section = content.slice(setupStart, setupEnd);

    const scores = await judge('setup/binary discovery instructions', section);
    console.log('Setup block scores:', JSON.stringify(scores, null, 2));

    evalCollector?.addTest({
      name: 'setup block',
      suite: 'LLM-as-judge quality evals',
      tier: 'llm-judge',
      passed: scores.actionability >= 3 && scores.clarity >= 3,
      duration_ms: Date.now() - t0,
      cost_usd: 0.02,
      judge_scores: { clarity: scores.clarity, completeness: scores.completeness, actionability: scores.actionability },
      judge_reasoning: scores.reasoning,
    });

    // Setup block is intentionally minimal (binary discovery only).
    // SKILL_DIR is inferred from context, so judge sometimes scores 3.
    expect(scores.actionability).toBeGreaterThanOrEqual(3);
    expect(scores.clarity).toBeGreaterThanOrEqual(3);
  }, 30_000);

  testIfSelected('regression vs baseline', async () => {
    const t0 = Date.now();
    // P2 (v1.2.0): the command reference moved from the root router to browse/SKILL.md.
    const generated = fs.readFileSync(path.join(ROOT, 'browse', 'SKILL.md'), 'utf-8');
    const genStart = generated.indexOf('## Full Command List');
    const genSection = generated.slice(genStart);

    const baseline = `## Command Reference

### Navigation
| Command | Description |
|---------|-------------|
| \`goto <url>\` | Navigate to URL |
| \`back\` / \`forward\` | History navigation |
| \`reload\` | Reload page |
| \`url\` | Print current URL |

### Interaction
| Command | Description |
|---------|-------------|
| \`click <sel>\` | Click element |
| \`fill <sel> <val>\` | Fill input |
| \`select <sel> <val>\` | Select dropdown |
| \`hover <sel>\` | Hover element |
| \`type <text>\` | Type into focused element |
| \`press <key>\` | Press key (Enter, Tab, Escape) |
| \`scroll [sel]\` | Scroll element into view |
| \`wait <sel>\` | Wait for element (max 10s) |
| \`wait --networkidle\` | Wait for network to be idle |
| \`wait --load\` | Wait for page load event |

### Inspection
| Command | Description |
|---------|-------------|
| \`js <expr>\` | Run JavaScript |
| \`css <sel> <prop>\` | Computed CSS |
| \`attrs <sel>\` | Element attributes |
| \`is <prop> <sel>\` | State check (visible/hidden/enabled/disabled/checked/editable/focused) |
| \`console [--clear\\|--errors]\` | Console messages (--errors filters to error/warning) |`;

    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `You are comparing two versions of CLI documentation for an AI coding agent.

VERSION A (baseline — hand-maintained):
${baseline}

VERSION B (auto-generated from source):
${genSection}

Which version is better for an AI agent trying to use these commands? Consider:
- Completeness (more commands documented? all args shown?)
- Clarity (descriptions helpful?)
- Coverage (missing commands in either version?)

Respond with ONLY valid JSON:
{"winner": "A" or "B" or "tie", "reasoning": "brief explanation", "a_score": N, "b_score": N}

Scores are 1-5 overall quality.`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error(`Judge returned non-JSON: ${text.slice(0, 200)}`);
    const result = JSON.parse(jsonMatch[0]);
    console.log('Regression comparison:', JSON.stringify(result, null, 2));

    evalCollector?.addTest({
      name: 'regression vs baseline',
      suite: 'LLM-as-judge quality evals',
      tier: 'llm-judge',
      passed: result.b_score >= result.a_score,
      duration_ms: Date.now() - t0,
      cost_usd: 0.02,
      judge_scores: { a_score: result.a_score, b_score: result.b_score },
      judge_reasoning: result.reasoning,
    });

    expect(result.b_score).toBeGreaterThanOrEqual(result.a_score);
  }, 30_000);
});

// --- Part 7: QA skill quality evals (C6) ---

// GStack 2 (f19d6cda): the root `qa/` monolith is gone. `skills/qa/SKILL.md` is a
// ~8KB lazy dispatcher that routes to preserved modules. Since the qa baseline
// dedup, the shared Phases 1-6 workflow, health rubric, and diff-aware/Important-
// Rules prose are specified ONCE in `qa-only.md`; `qa.md` keeps only its Fix-mode
// delta block and later phases. Judge the surface Fix mode actually executes:
// the qa-only baseline plus qa.md's delta block.
const QA_MODULE = 'skills/qa/references/legacy/qa.md';
const QA_BASELINE = 'skills/qa/references/legacy/qa-only.md';

/** slice with named markers that throws instead of silently judging "". */
function sliceBetween(content: string, file: string, startMarker: string, endMarker: string): string {
  const start = content.indexOf(startMarker);
  if (start === -1) throw new Error(`slice start marker not found in ${file}: ${startMarker}`);
  const end = content.indexOf(endMarker, start);
  if (end === -1) throw new Error(`slice end marker not found in ${file}: ${endMarker}`);
  return content.slice(start, end);
}

describeIfSelected('QA skill quality evals', ['qa/SKILL.md workflow', 'qa/SKILL.md health rubric', 'qa/SKILL.md anti-refusal'], () => {
  const qaContent = fs.readFileSync(path.join(ROOT, QA_MODULE), 'utf-8');
  const qaBaseline = fs.readFileSync(path.join(ROOT, QA_BASELINE), 'utf-8');

  testIfSelected('qa/SKILL.md workflow', async () => {
    const t0 = Date.now();
    // Fix mode's executed surface: the delta block in qa.md, then the shared
    // baseline workflow it delegates to.
    const section =
      sliceBetween(qaContent, QA_MODULE, '## Phases 1-6: QA Baseline', '## Output Structure') +
      '\n' +
      sliceBetween(qaBaseline, QA_BASELINE, '## Workflow', '## Health Score Rubric');

    const scores = await callJudge<JudgeScore>(`You are evaluating the quality of a QA testing workflow document for an AI coding agent.

The agent reads this document to learn how to systematically QA test a web application. The workflow references
a headless browser CLI ($B commands) that is documented separately — do NOT penalize for missing CLI definitions.
Instead, evaluate whether the workflow itself is clear, complete, and actionable.

Rate on three dimensions (1-5 scale):
- **clarity** (1-5): Can an agent follow the step-by-step phases without ambiguity?
- **completeness** (1-5): Are all phases, decision points, and outputs well-defined?
- **actionability** (1-5): Can an agent execute the workflow and produce the expected deliverables?

Respond with ONLY valid JSON:
{"clarity": N, "completeness": N, "actionability": N, "reasoning": "brief explanation"}

Here is the QA workflow to evaluate:

${section}`);
    console.log('QA workflow scores:', JSON.stringify(scores, null, 2));

    evalCollector?.addTest({
      name: 'qa/SKILL.md workflow',
      suite: 'QA skill quality evals',
      tier: 'llm-judge',
      passed: scores.clarity >= 4 && scores.completeness >= 3 && scores.actionability >= 4,
      duration_ms: Date.now() - t0,
      cost_usd: 0.02,
      judge_scores: { clarity: scores.clarity, completeness: scores.completeness, actionability: scores.actionability },
      judge_reasoning: scores.reasoning,
    });

    expect(scores.clarity).toBeGreaterThanOrEqual(4);
    // Completeness scores 3 when judge notes the health rubric is in a separate
    // section (the eval only passes the Workflow section, not the full document).
    expect(scores.completeness).toBeGreaterThanOrEqual(3);
    expect(scores.actionability).toBeGreaterThanOrEqual(4);
  }, 30_000);

  testIfSelected('qa/SKILL.md health rubric', async () => {
    const t0 = Date.now();
    // Bound at the next top-level heading. The old open-ended `.slice(start)` ran to
    // EOF, so "the rubric to evaluate" was 17KB that also carried Framework-Specific
    // Guidance, Important Rules, Phases 7-11 and the upstream judgment ports. The
    // score was not a rubric score. Thresholds below are unchanged.
    const section = sliceBetween(qaBaseline, QA_BASELINE, '## Health Score Rubric', '## Framework-Specific Guidance');

    const scores = await callJudge<JudgeScore>(`You are evaluating a health score rubric that an AI agent must follow to compute a numeric QA score.

The agent uses this rubric after QA testing a website. It needs to:
1. Understand each scoring category and what counts as a deduction
2. Apply the weights correctly to compute a final score out of 100
3. Produce a consistent, reproducible score

Rate on three dimensions (1-5 scale):
- **clarity** (1-5): Are the categories, deduction criteria, and weights unambiguous?
- **completeness** (1-5): Are all edge cases and scoring boundaries defined?
- **actionability** (1-5): Can an agent compute a correct score from this rubric alone?

Respond with ONLY valid JSON:
{"clarity": N, "completeness": N, "actionability": N, "reasoning": "brief explanation"}

Here is the rubric to evaluate:

${section}`);
    console.log('QA health rubric scores:', JSON.stringify(scores, null, 2));

    evalCollector?.addTest({
      name: 'qa/SKILL.md health rubric',
      suite: 'QA skill quality evals',
      tier: 'llm-judge',
      passed: scores.clarity >= 4 && scores.completeness >= 3 && scores.actionability >= 4,
      duration_ms: Date.now() - t0,
      cost_usd: 0.02,
      judge_scores: { clarity: scores.clarity, completeness: scores.completeness, actionability: scores.actionability },
      judge_reasoning: scores.reasoning,
    });

    expect(scores.clarity).toBeGreaterThanOrEqual(4);
    expect(scores.completeness).toBeGreaterThanOrEqual(3);
    expect(scores.actionability).toBeGreaterThanOrEqual(4);
  }, 30_000);

  testIfSelected('qa/SKILL.md anti-refusal', async () => {
    const t0 = Date.now();
    // Both sections live in the shared baseline since the qa dedup. qa-only.md's
    // heading after Important Rules is `## Output` (it never had Output Structure).
    const diffAwareSection = sliceBetween(qaBaseline, QA_BASELINE, '### Diff-aware', '### Full');
    const rulesSection = sliceBetween(qaBaseline, QA_BASELINE, '## Important Rules', '## Output');
    // GStack 2: /qa is lazy-dispatched. The agent reads the dispatcher BEFORE the
    // module, and the dispatcher is where the new refusal escape hatches live (the
    // trivial-check fast path, the "non-browser target does not load a browser-centric
    // module" hard rule). Judging only the module would measure 1.x behavior and miss
    // a refusal the shipped 2.0 routing could produce.
    const qaDispatcher = fs.readFileSync(path.join(ROOT, 'skills', 'qa', 'SKILL.md'), 'utf-8');

    const result = await callJudge<{ would_browse: boolean; fallback_behavior: string; confidence: number; reasoning: string }>(`You are evaluating whether a QA testing skill document would cause an AI agent to USE THE BROWSER or REFUSE to use the browser in a specific scenario.

SCENARIO:
A user runs /qa (a browser-based QA testing skill). The branch diff shows ONLY prompt template files and config file changes — no routes, views, controllers, components, or CSS were changed. The changes are "purely backend" with no obvious UI surface.

QUESTION: Based on the document excerpts below, would the agent open the browser and test the application, or would it decline/refuse to browse and suggest running evals or unit tests instead?

DOCUMENT EXCERPT 1 (Diff-aware mode instructions):
${diffAwareSection}

DOCUMENT EXCERPT 2 (Important Rules):
${rulesSection}

DOCUMENT EXCERPT 3 (the dispatcher the agent reads first, which decides whether the browser-based module above is loaded at all):
${qaDispatcher}

Respond with ONLY valid JSON:
{
  "would_browse": true or false,
  "fallback_behavior": "description of what the agent would do when no UI pages are identified from the diff",
  "confidence": N (1-5, how confident you are in your answer),
  "reasoning": "brief explanation"
}

Rules:
- would_browse should be true if the document instructs the agent to always use the browser regardless of diff content
- would_browse should be false if the document allows the agent to skip browser testing for non-UI changes
- confidence: 5 = document is unambiguous, 1 = document is unclear or contradictory`);

    console.log('QA anti-refusal result:', JSON.stringify(result, null, 2));

    evalCollector?.addTest({
      name: 'qa/SKILL.md anti-refusal',
      suite: 'QA skill quality evals',
      tier: 'llm-judge',
      passed: result.would_browse === true && result.confidence >= 4,
      duration_ms: Date.now() - t0,
      cost_usd: 0.02,
      judge_scores: { would_browse: result.would_browse ? 1 : 0, confidence: result.confidence },
      judge_reasoning: result.reasoning,
    });

    expect(result.would_browse).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(4);
  }, 30_000);
});

// --- Part 7: Cross-skill consistency judge (C7) ---

describeIfSelected('Cross-skill consistency evals', ['cross-skill greptile consistency'], () => {
  testIfSelected('cross-skill greptile consistency', async () => {
    const t0 = Date.now();
    // GStack 2 paths. The greptile-history architecture itself is unchanged (both
    // write paths still in review.md, the global read still in retro.md), so this
    // rubric still measures what it claims — but /ship carved its greptile mechanics
    // into a lazy phase file, so the module alone only contributes a "read the
    // section" pointer. Feed the section too or /ship looks silently inconsistent.
    const reviewContent = fs.readFileSync(path.join(ROOT, 'skills/review/references/legacy/review.md'), 'utf-8');
    const shipContent = fs.readFileSync(path.join(ROOT, 'skills/ship/references/legacy/ship.md'), 'utf-8')
      + '\n' + fs.readFileSync(path.join(ROOT, 'skills/ship/references/sections/ship/greptile.md'), 'utf-8');
    const triageContent = fs.readFileSync(path.join(ROOT, 'skills/review/references/artifacts/review/greptile-triage.md'), 'utf-8');
    const retroContent = fs.readFileSync(path.join(ROOT, 'skills/plan/references/legacy/retro.md'), 'utf-8');

    const extractGrepLines = (content: string, filename: string) => {
      const lines = content.split('\n')
        .filter(l => /greptile|history\.md|REMOTE_SLUG/i.test(l))
        .map(l => l.trim());
      return `--- ${filename} ---\n${lines.join('\n')}`;
    };

    const collected = [
      extractGrepLines(reviewContent, 'skills/review/references/legacy/review.md'),
      extractGrepLines(shipContent, 'skills/ship/references/legacy/ship.md (+ sections/ship/greptile.md)'),
      extractGrepLines(triageContent, 'references/artifacts/review/greptile-triage.md'),
      extractGrepLines(retroContent, 'skills/plan/references/legacy/retro.md'),
    ].join('\n\n');

    const result = await callJudge<{ consistent: boolean; issues: string[]; score: number; reasoning: string }>(`You are evaluating whether multiple skill configuration files implement the same data architecture consistently.

INTENDED ARCHITECTURE:
- greptile-history has TWO paths: per-project (~/.gstack/projects/{slug}/greptile-history.md) and global (~/.gstack/greptile-history.md)
- /review and /ship WRITE to BOTH paths (per-project for suppressions, global for retro aggregation)
- /review and /ship delegate write mechanics to greptile-triage.md
- /retro READS from the GLOBAL path only (it aggregates across all projects)
- REMOTE_SLUG derivation should be consistent across files that use it

Below are greptile-related lines extracted from each skill file:

${collected}

Evaluate consistency. Respond with ONLY valid JSON:
{
  "consistent": true/false,
  "issues": ["issue 1", "issue 2"],
  "score": N,
  "reasoning": "brief explanation"
}

score (1-5): 5 = perfectly consistent, 1 = contradictory`);

    console.log('Cross-skill consistency:', JSON.stringify(result, null, 2));

    evalCollector?.addTest({
      name: 'cross-skill greptile consistency',
      suite: 'Cross-skill consistency evals',
      tier: 'llm-judge',
      passed: result.consistent && result.score >= 4,
      duration_ms: Date.now() - t0,
      cost_usd: 0.02,
      judge_scores: { consistency_score: result.score },
      judge_reasoning: result.reasoning,
    });

    expect(result.consistent).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(4);
  }, 30_000);
});

// --- Part 7: Baseline score pinning (C9) ---

describeIfSelected('Baseline score pinning', ['baseline score pinning'], () => {
  const baselinesPath = path.join(ROOT, 'test', 'fixtures', 'eval-baselines.json');

  testIfSelected('baseline score pinning', async () => {
    const t0 = Date.now();
    if (!fs.existsSync(baselinesPath)) {
      console.log('No baseline file found — skipping pinning check');
      return;
    }

    const baselines = JSON.parse(fs.readFileSync(baselinesPath, 'utf-8'));
    const regressions: string[] = [];

    // P2 (v1.2.0): the command reference moved from the root router to browse/SKILL.md.
    const skillContent = fs.readFileSync(path.join(ROOT, 'browse', 'SKILL.md'), 'utf-8');
    const cmdStart = skillContent.indexOf('## Full Command List');
    const cmdSection = skillContent.slice(cmdStart);
    const cmdScores = await judge('command reference table', cmdSection);

    for (const dim of ['clarity', 'completeness', 'actionability'] as const) {
      if (cmdScores[dim] < baselines.command_reference[dim]) {
        regressions.push(`command_reference.${dim}: ${cmdScores[dim]} < baseline ${baselines.command_reference[dim]}`);
      }
    }

    if (process.env.UPDATE_BASELINES) {
      baselines.command_reference = {
        clarity: cmdScores.clarity,
        completeness: cmdScores.completeness,
        actionability: cmdScores.actionability,
      };
      fs.writeFileSync(baselinesPath, JSON.stringify(baselines, null, 2) + '\n');
      console.log('Updated eval baselines');
    }

    const passed = regressions.length === 0;
    evalCollector?.addTest({
      name: 'baseline score pinning',
      suite: 'Baseline score pinning',
      tier: 'llm-judge',
      passed,
      duration_ms: Date.now() - t0,
      cost_usd: 0.02,
      judge_scores: { clarity: cmdScores.clarity, completeness: cmdScores.completeness, actionability: cmdScores.actionability },
      judge_reasoning: passed ? 'All scores at or above baseline' : regressions.join('; '),
    });

    if (!passed) {
      throw new Error(`Score regressions detected:\n${regressions.join('\n')}`);
    }
  }, 60_000);
});

// --- Workflow SKILL.md quality evals (10 new tests for 100% coverage) ---

/**
 * DRY helper for workflow SKILL.md judge tests.
 * Extracts a section from a SKILL.md file and judges its quality as an agent workflow.
 */
async function runWorkflowJudge(opts: {
  testName: string;
  suite: string;
  skillPath: string;
  startMarker: string;
  endMarker: string | null;
  judgeContext: string;
  judgeGoal: string;
  thresholds?: { clarity: number; completeness: number; actionability: number };
}) {
  const t0 = Date.now();
  const defaults = { clarity: 4, completeness: 3, actionability: 4 };
  const thresholds = { ...defaults, ...opts.thresholds };

  // Read the module + sections UNION so carved skills still expose markers that
  // moved into sections/*.md (e.g. plan-eng's "## Review Sections" +
  // "## CRITICAL RULE"). Without this the slice markers vanish from the skeleton
  // and the judge scores empty content.
  //
  // GStack 2 layout: every skillPath here is a preserved module at
  // `skills/<dispatcher>/references/legacy/<module>.md`, and its carved phases sit
  // at `skills/<dispatcher>/references/sections/<module>/*.md` — a sibling of
  // `legacy/`, not a child of it. Derive that instead of `dirname(skillPath)/sections`.
  let content = fs.readFileSync(path.join(ROOT, opts.skillPath), 'utf-8');
  const secDir = path.join(
    ROOT,
    path.dirname(path.dirname(opts.skillPath)), // .../<dispatcher>/references
    'sections',
    path.basename(opts.skillPath, '.md'),
  );
  const sectionBodies: string[] = [];
  if (fs.existsSync(secDir)) {
    for (const f of fs.readdirSync(secDir).sort()) {
      if (f.endsWith('.md') && !f.endsWith('.md.tmpl')) {
        const body = fs.readFileSync(path.join(secDir, f), 'utf-8');
        sectionBodies.push(body);
        content += '\n' + body;
      }
    }
  }
  const startIdx = content.indexOf(opts.startMarker);
  if (startIdx === -1) throw new Error(`Start marker not found in ${opts.skillPath}: "${opts.startMarker}"`);

  let section: string;
  if (opts.endMarker) {
    const endIdx = content.indexOf(opts.endMarker, startIdx);
    if (endIdx === -1) throw new Error(`End marker not found in ${opts.skillPath}: "${opts.endMarker}"`);
    section = content.slice(startIdx, endIdx);
  } else {
    section = content.slice(startIdx);
  }

  // Two carve shapes exist. plan-eng/plan-design moved the MARKERS into the
  // section files, so the slice above already reaches the carved content.
  // document-release instead keeps its markers in the skeleton and carves the
  // workflow BODY (Steps 2-9 → sections/release-body.md) AFTER the endMarker,
  // so the marker slice drops it. Re-append any carved section the window
  // excluded, so the judge always sees the full workflow the agent executes.
  for (const body of sectionBodies) {
    const head = body.trim().slice(0, 120);
    if (head && !section.includes(head)) section += '\n' + body;
  }

  const scores = await callJudge<JudgeScore>(`You are evaluating the quality of ${opts.judgeContext} for an AI coding agent.

The agent reads this document to learn ${opts.judgeGoal}. It references external tools and files
that are documented separately — do NOT penalize for missing external definitions.

Rate on three dimensions (1-5 scale):
- **clarity** (1-5): Can an agent follow the instructions without ambiguity?
- **completeness** (1-5): Are all steps, decision points, and outputs well-defined?
- **actionability** (1-5): Can an agent execute this workflow and produce the expected deliverables?

Respond with ONLY valid JSON:
{"clarity": N, "completeness": N, "actionability": N, "reasoning": "brief explanation"}

Here is the document to evaluate:

${section}`);

  console.log(`${opts.testName} scores:`, JSON.stringify(scores, null, 2));

  evalCollector?.addTest({
    name: opts.testName,
    suite: opts.suite,
    tier: 'llm-judge',
    passed: scores.clarity >= thresholds.clarity && scores.completeness >= thresholds.completeness && scores.actionability >= thresholds.actionability,
    duration_ms: Date.now() - t0,
    cost_usd: 0.02,
    judge_scores: { clarity: scores.clarity, completeness: scores.completeness, actionability: scores.actionability },
    judge_reasoning: scores.reasoning,
  });

  expect(scores.clarity).toBeGreaterThanOrEqual(thresholds.clarity);
  expect(scores.completeness).toBeGreaterThanOrEqual(thresholds.completeness);
  expect(scores.actionability).toBeGreaterThanOrEqual(thresholds.actionability);
}

// Block 1: Ship & Release skills
describeIfSelected('Ship & Release skill evals', ['ship/SKILL.md workflow', 'document-release/SKILL.md workflow'], () => {
  testIfSelected('ship/SKILL.md workflow', async () => {
    await runWorkflowJudge({
      testName: 'ship/SKILL.md workflow',
      suite: 'Ship & Release skill evals',
      skillPath: 'skills/ship/references/legacy/ship.md',
      startMarker: '# Ship:',
      endMarker: '## Important Rules',
      judgeContext: 'a ship/release workflow document',
      judgeGoal: 'how to create a PR: merge base branch, run tests, review diff, bump version, update changelog, push, and open PR',
    });
  }, 30_000);

  testIfSelected('document-release/SKILL.md workflow', async () => {
    await runWorkflowJudge({
      testName: 'document-release/SKILL.md workflow',
      suite: 'Ship & Release skill evals',
      skillPath: 'skills/ship/references/legacy/document-release.md',
      startMarker: '# Document Release:',
      endMarker: '## Important Rules',
      judgeContext: 'a post-ship documentation update workflow',
      judgeGoal: 'how to audit and update project documentation after code ships: README, ARCHITECTURE, CONTRIBUTING, CLAUDE.md, CHANGELOG, TODOS',
    });
  }, 30_000);
});

// Block 2: Plan Review skills
describeIfSelected('Plan Review skill evals', [
  'plan-ceo-review/SKILL.md modes', 'plan-eng-review/SKILL.md sections',
], () => {
  testIfSelected('plan-ceo-review/SKILL.md modes', async () => {
    await runWorkflowJudge({
      testName: 'plan-ceo-review/SKILL.md modes',
      suite: 'Plan Review skill evals',
      skillPath: 'skills/plan/references/legacy/plan-ceo-review.md',
      startMarker: '## Step 0: Nuclear Scope Challenge',
      endMarker: '## Review Sections',
      judgeContext: 'a CEO/founder plan review framework with 4 scope modes',
      judgeGoal: 'how to conduct a CEO-perspective plan review: challenge scope, select a mode (Expansion, Selective Expansion, Hold Scope, Reduction), then review sections interactively',
    });
  }, 30_000);

  testIfSelected('plan-eng-review/SKILL.md sections', async () => {
    await runWorkflowJudge({
      testName: 'plan-eng-review/SKILL.md sections',
      suite: 'Plan Review skill evals',
      skillPath: 'skills/plan/references/legacy/plan-eng-review.md',
      startMarker: '## BEFORE YOU START:',
      endMarker: '## CRITICAL RULE',
      judgeContext: 'an engineering plan review framework with 4 review sections',
      judgeGoal: 'how to review a plan for architecture quality, code quality, test coverage, and performance — walking through each section interactively with AskUserQuestion',
    });
  }, 30_000);
});

// Block 3 (Design skill evals: 'plan-design-review/SKILL.md passes',
// 'design-review/SKILL.md fix loop', 'design-consultation/SKILL.md research') was
// deleted. /design was retired in 9053324a and its dirs, CLI, DESIGN.md and routing
// were cut in 5a9cca3c; no design module survives anywhere under skills/ (verified:
// `find skills -iname '*design*'` is empty, and skills/.compat/ has no design alias).
// These three had no repoint target. Judged quality no longer measured: the design
// audit severity-triage + atomic-fix + before/after re-verify loop, the 0-10
// rate/explain/edit/re-rate plan-review method, and the design-system proposal
// research pass (typography, color, spacing, motion).

// Block 4: Deploy skills
describeIfSelected('Deploy skill evals', [
  'land-and-deploy/SKILL.md workflow', 'canary/SKILL.md monitoring loop',
  'setup-deploy/SKILL.md platform setup',
], () => {
  testIfSelected('land-and-deploy/SKILL.md workflow', async () => {
    await runWorkflowJudge({
      testName: 'land-and-deploy/SKILL.md workflow',
      suite: 'Deploy skill evals',
      skillPath: 'skills/ship/references/legacy/land-and-deploy.md',
      startMarker: '## Step 1: Pre-flight',
      endMarker: '## Important Rules',
      judgeContext: 'a merge-deploy-verify workflow for landing PRs to production',
      judgeGoal: 'how to merge a PR via GitHub CLI, wait for CI and deploy workflows (with platform-specific strategies for Fly.io/Render/Vercel/Netlify), run canary health checks on production, and offer revert if something breaks — with timing data logged for retrospectives',
    });
  }, 30_000);

  testIfSelected('canary/SKILL.md monitoring loop', async () => {
    await runWorkflowJudge({
      testName: 'canary/SKILL.md monitoring loop',
      suite: 'Deploy skill evals',
      skillPath: 'skills/ship/references/legacy/canary.md',
      startMarker: '### Phase 2: Baseline Capture',
      endMarker: '## Important Rules',
      judgeContext: 'a post-deploy canary monitoring workflow using a headless browser daemon',
      judgeGoal: 'how to capture baseline screenshots and metrics before deploy, run a continuous monitoring loop checking each page every 60 seconds for console errors and performance regressions, fire alerts with evidence (screenshots), and produce a health report with per-page status and verdict',
    });
  }, 30_000);

  // 'benchmark/SKILL.md perf collection' was deleted. The benchmark module and its
  // compat alias were cut in a9399ad3 (skills/qa/references/legacy/benchmark.md,
  // skills/.compat/benchmark/). Judged quality no longer measured: browser-based
  // Core Web Vitals collection (TTFB, FCP, LCP, bundle sizes, request counts via
  // performance.getEntries()), baseline comparison with regression thresholds, and
  // delta/trend reporting. That commit calls this a real capability removal, not a
  // relocation — no page-timing coverage remains in skills/, and /review's
  // Performance mode is code-level (latency, memory, hot paths), not page timing.
  // The measurement ENGINE survives at bin/gstack-model-benchmark + lib/model-benchmark/
  // and is covered by test/benchmark-runner.test.ts and test/benchmark-cli.test.ts,
  // but that is model benchmarking, not the page-performance prose this scored.

  testIfSelected('setup-deploy/SKILL.md platform setup', async () => {
    await runWorkflowJudge({
      testName: 'setup-deploy/SKILL.md platform setup',
      suite: 'Deploy skill evals',
      skillPath: 'skills/ship/references/legacy/setup-deploy.md',
      startMarker: '### Step 2: Detect platform',
      endMarker: '## Important Rules',
      judgeContext: 'a deployment configuration setup workflow that detects deploy platforms and writes config to CLAUDE.md',
      judgeGoal: 'how to detect deploy platforms (Fly.io, Render, Vercel, Netlify, Heroku, GitHub Actions, custom), gather platform-specific configuration (URLs, status commands, health checks, custom hooks), and persist everything to CLAUDE.md for future automated use',
    });
  }, 30_000);
});

// Block 5: Other skills
describeIfSelected('Other skill evals', [
  'retro/SKILL.md instructions', 'qa-only/SKILL.md workflow',
], () => {
  testIfSelected('retro/SKILL.md instructions', async () => {
    await runWorkflowJudge({
      testName: 'retro/SKILL.md instructions',
      suite: 'Other skill evals',
      // /retro is retired as a public skill but survives whole as a module reached
      // via `$plan --mode Discovery --module retro`. This rubric scores the git-metric
      // gathering and analysis workflow, which lives ENTIRELY in the module — the
      // /plan dispatcher only names the route. Judge the module, not the dispatcher.
      skillPath: 'skills/plan/references/legacy/retro.md',
      startMarker: '## Instructions',
      endMarker: '## Compare Mode',
      judgeContext: 'an engineering retrospective data gathering and analysis workflow',
      judgeGoal: 'how to gather git metrics (commit history, test counts, work patterns), analyze them, produce a structured retro report with praise, growth areas, and trend tracking',
    });
  }, 30_000);

  testIfSelected('qa-only/SKILL.md workflow', async () => {
    await runWorkflowJudge({
      testName: 'qa-only/SKILL.md workflow',
      suite: 'Other skill evals',
      skillPath: 'skills/qa/references/legacy/qa-only.md',
      startMarker: '## Workflow',
      endMarker: '## Important Rules',
      judgeContext: 'a report-only QA testing workflow',
      judgeGoal: 'how to systematically QA test a web application and produce a structured report with health score, screenshots, and repro steps — without fixing anything',
    });
  }, 30_000);

  // 'gstack-upgrade/SKILL.md upgrade flow' was deleted. The module and its compat
  // alias were cut in a9399ad3 (skills/ship/references/legacy/gstack-upgrade.md,
  // skills/.compat/gstack-upgrade/) because nothing in the 2.0 path executed it:
  // ./setup delegates placement to `npx skills add` and runtime/migrations.js owns
  // 2.0 state versioning. Judged quality no longer measured: the install-type
  // detection, version comparison, pre-upgrade backup, git-vs-fresh-clone upgrade
  // branch, and what-changed summary as PROSE an agent follows. The executable
  // equivalent is runtime/upgrade.js, covered by test/gstack2-runtime-upgrade.test.ts.
});

// 'voice directive tone' was deleted. It read `## Voice` out of the generated
// review/SKILL.md, which the generator's scripts/resolvers/preamble.ts injected.
// Both are gone: no `## Voice` heading exists anywhere under skills/ (the only hit
// is land-and-deploy.md's unrelated "## Voice & Tone"), and scripts/resolvers/ does
// not exist. There is no repoint target — the rubric's five dimensions (directness,
// concreteness, avoids_corporate, avoids_ai_vocabulary, connects_user_outcomes)
// scored a specific directive document that GStack 2 does not ship.
// Judged quality no longer measured: whether the shipped skills carry an explicit,
// list-backed ban on corporate tone and AI-tell vocabulary and an instruction to
// connect technical work to user outcomes. This is a REAL uncovered regression risk,
// not a relocation. The nearest surviving artifacts are the per-dispatcher
// references/support/scripts/jargon-list.json (a gloss list, not a tone directive)
// and CLAUDE.md's CHANGELOG voice rules (docs, not skill content), and neither is a
// substitute. If a voice/writing-style directive is reintroduced under skills/,
// restore this eval against it rather than pointing it at a dispatcher.

// Module-level afterAll — finalize eval collector after all tests complete
afterAll(async () => {
  if (evalCollector) {
    try {
      await evalCollector.finalize();
    } catch (err) {
      console.error('Failed to save eval results:', err);
    }
  }
});
