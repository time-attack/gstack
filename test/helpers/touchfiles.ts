/**
 * Diff-based test selection for E2E and LLM-judge evals.
 *
 * Each test declares which source files it depends on ("touchfiles").
 * The test runner checks `git diff` and only runs tests whose
 * dependencies were modified. Override with EVALS_ALL=1 to run everything.
 *
 * GStack 2 (f19d6cda) deleted the 1.x skill tree at the repo root, so every
 * pattern here MUST point at a path that still exists. A glob that can never
 * match is worse than a missing entry: the paid test silently stops being
 * selected and the suite reports a clean skip forever. `test/touchfiles.test.ts`
 * pins live selection counts for exactly that reason.
 */

import { spawnSync } from 'child_process';

// --- Glob matching ---

/**
 * Match a file path against a glob pattern.
 * Supports:
 *   ** — match any number of path segments
 *   *  — match within a single segment (no /)
 */
export function matchGlob(file: string, pattern: string): boolean {
  const regexStr = pattern
    .replace(/\./g, '\\.')
    .replace(/\*\*/g, '{{GLOBSTAR}}')
    .replace(/\*/g, '[^/]*')
    .replace(/\{\{GLOBSTAR\}\}/g, '.*');
  return new RegExp(`^${regexStr}$`).test(file);
}

// --- Shipped-path shorthands ---
//
// The 1.x layout gave every skill its own root directory, so `plan-ceo-review/**`
// was a complete dependency. GStack 2 splits the same judgment three ways:
//   - the dispatcher that routes to it   skills/<dispatcher>/SKILL.md
//   - the preserved module               skills/<dispatcher>/references/legacy/<name>.md
//   - its carved phases (when carved)    skills/<dispatcher>/references/sections/<name>/
//   - the old slash-name alias           skills/.compat/<name>/
// A specialist test depends on all of them, including the dispatcher — that is
// the file which decides whether the module is ever reached.

const CEO = [
  'skills/plan/SKILL.md',
  'skills/plan/references/legacy/plan-ceo-review.md',
  'skills/plan/references/sections/plan-ceo-review/**',
  'skills/.compat/plan-ceo-review/**',
];

const ENG = [
  'skills/plan/SKILL.md',
  'skills/plan/references/legacy/plan-eng-review.md',
  'skills/plan/references/sections/plan-eng-review/**',
  'skills/.compat/plan-eng-review/**',
];

const DEVEX = [
  'skills/plan/SKILL.md',
  'skills/plan/references/legacy/plan-devex-review.md',
  'skills/plan/references/sections/plan-devex-review/**',
  'skills/.compat/plan-devex-review/**',
];

const OFFICE_HOURS = [
  'skills/plan/SKILL.md',
  'skills/plan/references/legacy/office-hours.md',
  'skills/plan/references/sections/office-hours/**',
  'skills/.compat/office-hours/**',
];

const CONTEXT_SAVE = [
  'skills/plan/references/legacy/context-save.md',
  'skills/.compat/context-save/**',
];

const CONTEXT_RESTORE = [
  'skills/plan/references/legacy/context-restore.md',
  'skills/.compat/context-restore/**',
];

const LAND_AND_DEPLOY = [
  'skills/ship/references/legacy/land-and-deploy.md',
  'skills/.compat/land-and-deploy/**',
];

const DOCUMENT_RELEASE = [
  'skills/ship/references/legacy/document-release.md',
  'skills/ship/references/sections/document-release/**',
  'skills/.compat/document-release/**',
];

const CODEX = [
  'skills/review/references/legacy/codex.md',
  'skills/.compat/codex/**',
];

const SETUP_GBRAIN = [
  'skills/plan/references/legacy/setup-gbrain.md',
  'skills/.compat/setup-gbrain/**',
];

const PLAN_TUNE = [
  'skills/plan/references/legacy/plan-tune.md',
  'skills/.compat/plan-tune/**',
];

/**
 * The AskUserQuestion format + shared judgment prose that the deleted
 * `scripts/resolvers/preamble*` used to inject into every generated SKILL.md.
 * In GStack 2 it ships as a per-dispatcher reference doc, so key on all of them.
 */
const SHARED_PREAMBLE = [
  'skills/*/references/QUESTION-FORMAT.md',
  'skills/*/references/SHARED-JUDGMENT.md',
];

// --- Touchfile maps ---

/**
 * E2E test touchfiles — keyed by testName (the string passed to runSkillTest).
 * Each test lists the file patterns that, if changed, require the test to run.
 */
export const E2E_TOUCHFILES: Record<string, string[]> = {
  // Browse core (+ test-server dependency)
  'browse-basic':    ['browse/src/**', 'browse/test/test-server.ts'],
  'browse-snapshot': ['browse/src/**', 'browse/test/test-server.ts'],

  // Hermetic isolation canaries (hermetic-env.ts is also a GLOBAL touchfile;
  // these entries exist so the canaries themselves stay tier-classified)
  'hermetic-canary':   ['test/helpers/hermetic-env.ts', 'test/helpers/session-runner.ts', 'test/skill-e2e-hermetic-canary.test.ts', 'lib/conductor-env-shim.ts'],
  'hermetic-sentinel': ['test/helpers/hermetic-env.ts', 'test/helpers/session-runner.ts', 'test/skill-e2e-hermetic-canary.test.ts', 'lib/conductor-env-shim.ts'],

  // P4 first-run scaffold (activation lift) — the detection binary end-to-end
  // through the real runner. The two preamble resolvers that used to gate it
  // (generate-first-run-guidance.ts, generate-preamble-bash.ts) died with the
  // generator and have no surviving surface under skills/.
  'first-task-scaffold': ['bin/gstack-first-task-detect', 'test/skill-e2e-first-task-scaffold.test.ts', 'test/helpers/session-runner.ts'],

  // Setup + discovery probes. These read browse/SKILL.md (the root router
  // SKILL.md was deleted with the 1.x tree; the setup block lives in browse).
  'skillmd-setup-discovery':  ['browse/SKILL.md', 'test/skill-e2e-bws.test.ts'],
  'skillmd-no-local-binary':  ['browse/SKILL.md', 'test/skill-e2e-bws.test.ts'],
  'skillmd-outside-git':      ['browse/SKILL.md', 'test/skill-e2e-bws.test.ts'],

  'session-awareness':        ['skills/*/references/QUESTION-FORMAT.md', 'test/skill-e2e-bws.test.ts'],
  'operational-learning':     ['bin/gstack-learnings-log', 'bin/gstack-learnings-search', 'lib/jsonl-store.ts', 'skills/plan/references/legacy/learn.md'],

  // QA (+ test-server dependency)
  'qa-quick':       ['skills/qa/**', 'browse/src/**', 'browse/test/test-server.ts'],
  'qa-b6-static':   ['skills/qa/**', 'browse/src/**', 'browse/test/test-server.ts', 'test/helpers/llm-judge.ts', 'browse/test/fixtures/qa-eval.html', 'test/fixtures/qa-eval-ground-truth.json'],
  'qa-b7-spa':      ['skills/qa/**', 'browse/src/**', 'browse/test/test-server.ts', 'test/helpers/llm-judge.ts', 'browse/test/fixtures/qa-eval-spa.html', 'test/fixtures/qa-eval-spa-ground-truth.json'],
  'qa-b8-checkout': ['skills/qa/**', 'browse/src/**', 'browse/test/test-server.ts', 'test/helpers/llm-judge.ts', 'browse/test/fixtures/qa-eval-checkout.html', 'test/fixtures/qa-eval-checkout-ground-truth.json'],
  'qa-only-no-fix': ['skills/qa/SKILL.md', 'skills/qa/references/legacy/qa-only.md', 'skills/.compat/qa-only/**', 'skills/qa/references/artifacts/qa/**'],
  'qa-fix-loop':    ['skills/qa/**', 'browse/src/**', 'browse/test/test-server.ts'],
  'qa-bootstrap':   ['skills/qa/**', 'skills/ship/**'],
  'qa-ask-contract': ['skills/qa/**', 'test/skill-e2e-qa-ask-contract.test.ts'],

  // Review
  'review-sql-injection':     ['skills/review/**', 'test/fixtures/review-eval-vuln.rb'],
  'review-enum-completeness': ['skills/review/**', 'test/fixtures/review-eval-enum*.rb'],
  'review-base-branch':       ['skills/review/**'],
  'review-design-lite':       ['skills/review/**', 'test/fixtures/review-eval-design-slop.*'],
  // Precision contract (judgment.review.precision-contract): seeded FP corpus +
  // planted TPs against the INSTALLED GStack 2 dispatcher (skills/review tree).
  'review-precision':         ['skills/review/**', 'test/fixtures/review-precision/**', 'test/skill-e2e-review-precision.test.ts'],

  // Review Army (specialist dispatch). scripts/resolvers/review-army.ts is gone;
  // the dispatch prose now ships at skills/ship/references/sections/ship/review-army.md.
  'review-army-migration-safety': ['skills/review/**', 'skills/ship/references/sections/ship/review-army.md', 'bin/gstack-diff-scope'],
  'review-army-perf-n-plus-one':  ['skills/review/**', 'skills/ship/references/sections/ship/review-army.md', 'bin/gstack-diff-scope'],
  'review-army-delivery-audit':   ['skills/review/**', 'skills/ship/references/sections/ship/review-army.md'],
  'review-army-quality-score':    ['skills/review/**', 'skills/ship/references/sections/ship/review-army.md'],
  'review-army-json-findings':    ['skills/review/**', 'skills/ship/references/sections/ship/review-army.md'],
  'review-army-red-team':         ['skills/review/**', 'skills/ship/references/sections/ship/review-army.md'],
  'review-army-consensus':        ['skills/review/**', 'skills/ship/references/sections/ship/review-army.md'],

  // Office Hours
  'office-hours-spec-review':      [...OFFICE_HOURS],
  'office-hours-forcing-energy':   [...OFFICE_HOURS, ...SHARED_PREAMBLE, 'test/fixtures/mode-posture/**', 'test/helpers/llm-judge.ts'],
  'office-hours-builder-wildness': [...OFFICE_HOURS, ...SHARED_PREAMBLE, 'test/fixtures/mode-posture/**', 'test/helpers/llm-judge.ts'],

  // Plan reviews
  'plan-ceo-review':                  [...CEO],
  'plan-ceo-review-selective':        [...CEO],
  'plan-ceo-review-benefits':         [...CEO],
  'plan-ceo-review-expansion-energy': [...CEO, ...SHARED_PREAMBLE, 'test/fixtures/mode-posture/**', 'test/helpers/llm-judge.ts'],
  'plan-eng-review':           [...ENG],
  'plan-eng-review-artifact':  [...ENG],
  'plan-review-report':        [...ENG],

  // Plan-mode smoke tests — gate-tier safety regression tests. Each test file
  // contains TWO test cases as of v1.21: the baseline plan-mode case and the
  // AskUserQuestion-blocked regression case (--disallowedTools AskUserQuestion
  // parameterized — the flag set Conductor uses by default). Touchfiles include
  // the shared QUESTION-FORMAT/SHARED-JUDGMENT references because the AUTO_DECIDE
  // instruction lives there now and changes can flip the regression test outcome
  // between 'asked' and 'auto_decided'.
  'plan-ceo-review-plan-mode':    [...CEO, ...SHARED_PREAMBLE, 'test/helpers/claude-pty-runner.ts'],
  'plan-eng-review-plan-mode':    [...ENG, ...SHARED_PREAMBLE, 'test/helpers/claude-pty-runner.ts'],
  // 'plan-design-review-plan-mode' removed: plan-design-review/ was deleted in
  // d8b4a061 and no design specialist survives in skills/ (no module under
  // skills/plan/references/legacy/, no routing alias, no skills/.compat entry),
  // so there is no judgment left to smoke-test.
  'plan-devex-review-plan-mode':  [...DEVEX, ...SHARED_PREAMBLE, 'test/helpers/claude-pty-runner.ts'],
  'plan-mode-no-op':              [...CEO, ...SHARED_PREAMBLE, 'test/helpers/claude-pty-runner.ts'],

  // v1.21+ AskUserQuestion-blocked regression tests — Conductor launches
  // claude with `--disallowedTools AskUserQuestion --permission-mode default`
  // (verified via `ps`); skills must still surface user-decisions through a
  // fallback path (mcp__conductor__AskUserQuestion or plan-file flow) rather
  // than silently auto-deciding. Parameterized regression test cases live
  // INSIDE the existing plan-X-review-plan-mode test files (covered
  // transitively by the entries above). Two standalone files exist for
  // skills with no prior plan-mode test:
  'office-hours-auto-mode':       [...OFFICE_HOURS, ...SHARED_PREAMBLE, 'test/helpers/claude-pty-runner.ts'],
  'office-hours-phase4-fork':     [...OFFICE_HOURS, ...SHARED_PREAMBLE, 'test/helpers/llm-judge.ts', 'test/skill-e2e-office-hours-phase4.test.ts'],
  'llm-judge-recommendation':     ['test/helpers/llm-judge.ts', 'test/llm-judge-recommendation.test.ts', 'skills/*/references/QUESTION-FORMAT.md', 'skills/review/references/legacy/codex.md'],
  // v1.21+ AUTO_DECIDE preserve eval (periodic). Verifies the Tool resolution
  // fix doesn't trip the legitimate /plan-tune opt-in path: when the user has
  // written a never-ask preference, AUQ should still auto-decide rather than
  // surfacing the question. Touches the question-tuning + preference
  // infrastructure plus the shared question-format references.
  'auto-decide-preserved':        [...SHARED_PREAMBLE, ...CEO, ...PLAN_TUNE, 'bin/gstack-question-preference', 'bin/gstack-config', 'bin/gstack-slug', 'hosts/claude/hooks/question-preference-hook.ts', 'lib/is-conductor.ts', 'test/helpers/claude-pty-runner.ts'],

  // Conductor → prose decision brief (Conductor signal makes prose the default;
  // the PreToolUse hook denies the flaky tool). Touches the shared question
  // format, the hook, and the detection helper.
  'conductor-prose':              [...SHARED_PREAMBLE, ...ENG, 'hosts/claude/hooks/question-preference-hook.ts', 'lib/is-conductor.ts', 'test/helpers/claude-pty-runner.ts', 'test/skill-e2e-conductor-prose.test.ts'],

  // Real-PTY E2E batch (#6 new tests on the harness).
  // Each one tests behavior the SDK harness can't observe (rendered TTY,
  // numbered-option lists, multi-phase ordering, idempotency state echo).
  'auq-format-gate':             [...CEO, ...SHARED_PREAMBLE, 'skills/plan/references/TOTAL-CRITERIA-EXAMPLES.md', 'test/helpers/auq-sdk-capture.ts', 'test/helpers/session-runner.ts', 'test/helpers/llm-judge.ts'],
  'plan-ceo-mode-routing':       [...CEO, ...SHARED_PREAMBLE, 'test/helpers/claude-pty-runner.ts'],
  // 'plan-design-with-ui-scope' removed with test/skill-e2e-plan-design-with-ui.test.ts:
  // it drove the retired design skill's rating AUQ and had been unparseable
  // (dangling brace, same class 629a1348 cleaned up) since the design retirement.
  'budget-regression-pty':       ['test/helpers/eval-store.ts', 'test/skill-budget-regression.test.ts'],
  'ship-idempotency-pty':        ['skills/ship/**', 'bin/gstack-next-version', 'bin/gstack-version-bump', 'lib/worktree.ts', 'test/helpers/claude-pty-runner.ts'],
  'ship-section-loading':        ['skills/ship/**', 'test/helpers/auq-sdk-capture.ts', 'test/helpers/session-runner.ts'],
  'plan-ceo-section-loading':    [...CEO, 'test/helpers/auq-sdk-capture.ts', 'test/helpers/session-runner.ts'],
  // 'carve-section-loading' removed: test/carve-section-loading.test.ts and
  // test/helpers/carve-guards.ts were deleted with the carve harness, so the
  // entry could never select a runnable test again.
  'autoplan-chain-pty':          ['skills/plan/references/legacy/autoplan.md', 'skills/.compat/autoplan/**', ...CEO, ...ENG, ...DEVEX, 'test/fixtures/plans/ui-heavy-feature.md', 'test/helpers/claude-pty-runner.ts'],
  // 'e2e-harness-audit' removed: test/e2e-harness-audit.test.ts was deleted and
  // no surviving test file declares the name.

  // Per-finding AskUserQuestion count + review-report-at-bottom assertion.
  // Each test drives its skill end-to-end; touchfiles include the shared
  // question-format references because they affect question cadence and
  // terminal output (the regression surface this test catches).
  'plan-ceo-finding-count':      [...CEO, ...SHARED_PREAMBLE, 'test/helpers/claude-pty-runner.ts', 'test/skill-e2e-plan-ceo-finding-count.test.ts'],
  'plan-eng-finding-count':      [...ENG, ...SHARED_PREAMBLE, 'test/helpers/claude-pty-runner.ts', 'test/skill-e2e-plan-eng-finding-count.test.ts'],
  // No design specialist survives under skills/, so this one hangs off the
  // shared question format and its own test file only.
  'plan-design-finding-count':   [...SHARED_PREAMBLE, 'test/helpers/claude-pty-runner.ts', 'test/skill-e2e-plan-design-finding-count.test.ts'],
  'plan-devex-finding-count':    [...DEVEX, ...SHARED_PREAMBLE, 'test/helpers/claude-pty-runner.ts', 'test/skill-e2e-plan-devex-finding-count.test.ts'],

  // Gate-tier reviewCount-floor counterparts. Catch the May 2026 transcript
  // bug (model wrote a plan-mode plan and ExitPlanMode'd without firing any
  // review-phase AskUserQuestion). Uses runPlanSkillFloorCheck — minimal
  // "did agent fire ANY AUQ?" observer that exits early on first non-permission
  // numbered-option render. ~1-3 min typical wall time per test, ~$2-6 total.
  'plan-eng-finding-floor':      [...ENG, ...SHARED_PREAMBLE, 'skills/review/references/legacy/review.md', 'test/helpers/claude-pty-runner.ts', 'test/fixtures/forcing-finding-seeds.ts', 'test/skill-e2e-plan-eng-finding-floor.test.ts'],
  // Drives the public /plan surface (Product mode -> ceo specialist), so it
  // depends on the whole dispatcher tree, not one module.
  'plan-ceo-finding-floor':      ['skills/plan/**', 'test/helpers/claude-pty-runner.ts', 'test/fixtures/forcing-finding-seeds.ts', 'test/skill-e2e-plan-ceo-finding-floor.test.ts'],
  // 'plan-design-finding-floor' removed: no test/skill-e2e-plan-design-finding-floor.test.ts
  // exists and plan-design-review/ was deleted in d8b4a061 — nothing to select.
  'plan-devex-finding-floor':    [...DEVEX, ...SHARED_PREAMBLE, 'skills/review/references/legacy/review.md', 'test/helpers/claude-pty-runner.ts', 'test/fixtures/forcing-finding-seeds.ts', 'test/skill-e2e-plan-devex-finding-floor.test.ts'],

  // Multi-finding batching regression — periodic tier complement to the
  // gate-tier finding-floor. Catches the May 2026 transcript shape where
  // a model fires one AUQ then batches the rest into a "## Decisions to
  // confirm" plan write. runPlanSkillFloorCheck cannot detect that shape
  // (it exits on first AUQ); runPlanSkillCounting can.
  'plan-eng-multi-finding-batching': [...ENG, ...SHARED_PREAMBLE, 'skills/review/references/legacy/review.md', 'test/helpers/claude-pty-runner.ts', 'test/fixtures/forcing-finding-seeds.ts', 'test/skill-e2e-plan-eng-multi-finding-batching.test.ts'],
  'plan-ceo-split-overflow': [...CEO, ...SHARED_PREAMBLE, 'skills/plan/references/support/docs/askuserquestion-split.md', 'bin/gstack-question-preference', 'test/helpers/claude-pty-runner.ts', 'test/fixtures/forcing-finding-seeds.ts', 'test/skill-e2e-plan-ceo-split-overflow.test.ts'],
  'brain-privacy-gate':           ['skills/plan/references/legacy/sync-gbrain.md', 'skills/.compat/sync-gbrain/**', 'bin/gstack-brain-sync', 'bin/gstack-artifacts-init', 'bin/gstack-config', 'test/helpers/agent-sdk-runner.ts'],

  // /setup-gbrain Path 4 (Remote MCP) — happy + bad-token end-to-end via
  // Agent SDK. Gate-tier (deterministic stub server, fixed inputs); fires
  // when the preserved module, the verify helper, the artifacts-init helper,
  // or the detect script changes.
  'setup-gbrain-remote':          [...SETUP_GBRAIN, 'bin/gstack-gbrain-mcp-verify', 'bin/gstack-artifacts-init', 'bin/gstack-gbrain-detect', 'test/helpers/agent-sdk-runner.ts'],
  'setup-gbrain-bad-token':       [...SETUP_GBRAIN, 'bin/gstack-gbrain-mcp-verify', 'test/helpers/agent-sdk-runner.ts'],
  // v1.34.0.0 split-engine Path 4 + Step 4.5 Yes (local PGLite for code).
  // Periodic-tier per codex #12 (AgentSDK harness is non-deterministic).
  'setup-gbrain-path4-local-pglite': [...SETUP_GBRAIN, 'bin/gstack-gbrain-mcp-verify', 'bin/gstack-gbrain-install', 'bin/gstack-gbrain-detect', 'lib/gbrain-local-status.ts', 'test/helpers/agent-sdk-runner.ts'],

  // AskUserQuestion format regression (RECOMMENDATION + Completeness: N/10)
  // Fires when either module OR the shared question-format references change.
  'plan-ceo-review-format-mode':      [...CEO, ...SHARED_PREAMBLE, 'skills/plan/references/TOTAL-CRITERIA-EXAMPLES.md', 'test/helpers/llm-judge.ts'],
  'plan-ceo-review-format-approach':  [...CEO, ...SHARED_PREAMBLE, 'skills/plan/references/TOTAL-CRITERIA-EXAMPLES.md', 'test/helpers/llm-judge.ts'],
  'plan-eng-review-format-coverage':  [...ENG, ...SHARED_PREAMBLE, 'skills/plan/references/TOTAL-CRITERIA-EXAMPLES.md', 'test/helpers/llm-judge.ts'],
  'plan-eng-review-format-kind':      [...ENG, ...SHARED_PREAMBLE, 'skills/plan/references/TOTAL-CRITERIA-EXAMPLES.md', 'test/helpers/llm-judge.ts'],

  // v1.7.0.0 Pros/Cons format cadence + format + negative-escape evals.
  // All periodic-tier (non-deterministic model behavior).
  'plan-ceo-review-prosons-cadence':  [...CEO, ...ENG, ...DEVEX, ...SHARED_PREAMBLE],
  'plan-review-prosons-format':       [...CEO, ...ENG, ...DEVEX, ...SHARED_PREAMBLE],
  'plan-review-prosons-hardstop-neg': [...CEO, ...SHARED_PREAMBLE],
  'plan-review-prosons-neutral-neg':  [...CEO, ...SHARED_PREAMBLE],

  // Expanded coverage (CT3) — non-plan-review skills inherit Pros/Cons via the
  // shared question-format reference each dispatcher ships.
  'ship-prosons-format':              ['skills/ship/**', ...SHARED_PREAMBLE],
  'office-hours-prosons-format':      [...OFFICE_HOURS, ...SHARED_PREAMBLE],
  'investigate-prosons-format':       ['skills/debug/references/legacy/investigate.md', 'skills/.compat/investigate/**', ...SHARED_PREAMBLE],
  'qa-prosons-format':                ['skills/qa/**', ...SHARED_PREAMBLE],
  'review-prosons-format':            ['skills/review/**', ...SHARED_PREAMBLE],
  'document-release-prosons-format':  [...DOCUMENT_RELEASE, ...SHARED_PREAMBLE],

  // /plan proportionality on trivial asks (#886 field failure — trivial-change
  // fast path must not load the specialist stack or hard-block)
  'plan-proportionality':      ['skills/plan/**', 'test/skill-e2e-plan-proportionality.test.ts'],

  // Same fast path in the other four dispatchers (one parameterized file)
  'qa-fast-path':              ['skills/qa/**', 'test/skill-e2e-dispatcher-fast-path.test.ts'],
  'review-fast-path':          ['skills/review/**', 'test/skill-e2e-dispatcher-fast-path.test.ts'],
  'ship-fast-path':            ['skills/ship/**', 'test/skill-e2e-dispatcher-fast-path.test.ts'],
  'debug-fast-path':           ['skills/debug/**', 'test/skill-e2e-dispatcher-fast-path.test.ts'],

  // /plan-tune (v1 observational)
  'plan-tune-inspect':         [...PLAN_TUNE, 'scripts/question-registry.ts', 'scripts/psychographic-signals.ts', 'scripts/one-way-doors.ts', 'bin/gstack-question-log', 'bin/gstack-question-preference', 'bin/gstack-developer-profile'],

  // /plan-tune cathedral (T16 — 5 E2E scenarios, all gate per D12)
  'plan-tune-hook-capture':      ['hosts/claude/hooks/**', 'bin/gstack-question-log', 'bin/gstack-developer-profile', ...PLAN_TUNE],
  'plan-tune-enforcement':       ['hosts/claude/hooks/**', 'bin/gstack-question-preference', 'scripts/question-registry.ts'],
  'plan-tune-annotation':        ['hosts/claude/hooks/**', 'scripts/declared-annotation.ts', 'scripts/psychographic-signals.ts', 'scripts/question-registry.ts'],
  'plan-tune-codex-import':      ['bin/gstack-codex-session-import', 'bin/gstack-question-log', 'docs/spikes/codex-session-format.md'],
  'plan-tune-dream-cycle':       ['bin/gstack-distill-free-text', 'bin/gstack-distill-apply', 'hosts/claude/hooks/**', ...PLAN_TUNE],

  // Codex offering verification
  'codex-offered-office-hours':  [...OFFICE_HOURS, ...CODEX],
  'codex-offered-ceo-review':    [...CEO, ...CODEX],
  // 'codex-offered-design-review' removed: no design specialist survives in skills/.
  'codex-offered-eng-review':    [...ENG, ...CODEX],

  // Ship
  'ship-base-branch': ['skills/ship/**', 'bin/gstack-repo-mode'],
  'ship-local-workflow': ['skills/ship/**', 'test/skill-e2e-workflow.test.ts'],
  'review-dashboard-via': ['skills/ship/**', 'skills/review/references/legacy/review.md', 'skills/plan/references/sections/review-dashboard.md', ...CODEX, 'skills/plan/references/legacy/autoplan.md', ...LAND_AND_DEPLOY],
  // 'ship-plan-completion' / 'ship-plan-verification' / 'review-plan-completion'
  // removed: no surviving test file declares any of the three names (they were
  // also duplicate keys in this map, so only the second copy ever applied).

  // Retro — retired as a public skill, reached via $plan --mode Discovery --module retro
  'retro':             ['skills/plan/references/legacy/retro.md', 'skills/.compat/retro/**'],
  'retro-base-branch': ['skills/plan/references/legacy/retro.md', 'skills/.compat/retro/**', 'skills/plan/references/BASE-DETECTION.md'],

  // Global discover
  'global-discover':   ['bin/gstack-global-discover.ts', 'test/global-discover.test.ts'],

  // CSO
  'cso-full-audit':   ['skills/review/references/legacy/cso.md', 'skills/review/references/sections/cso/**', 'skills/.compat/cso/**'],
  'cso-diff-mode':    ['skills/review/references/legacy/cso.md', 'skills/review/references/sections/cso/**', 'skills/.compat/cso/**'],
  'cso-infra-scope':  ['skills/review/references/legacy/cso.md', 'skills/review/references/sections/cso/**', 'skills/.compat/cso/**'],

  // Learnings
  'learnings-show': ['skills/plan/references/legacy/learn.md', 'skills/.compat/learn/**', 'bin/gstack-learnings-search', 'bin/gstack-learnings-log'],

  // Session Intelligence (timeline, context recovery, /context-save + /context-restore)
  'timeline-event-flow':            ['bin/gstack-timeline-log', 'bin/gstack-timeline-read'],
  'context-recovery-artifacts':     ['skills/*/references/SHARED-JUDGMENT.md', 'bin/gstack-timeline-log', 'bin/gstack-slug', 'skills/plan/references/legacy/learn.md', 'skills/.compat/learn/**'],
  'context-save-writes-file':       [...CONTEXT_SAVE, 'bin/gstack-slug'],
  'context-restore-loads-latest':   [...CONTEXT_RESTORE, 'bin/gstack-slug'],

  // Context skills E2E (live-fire, Skill-tool routing path) — see
  // test/skill-e2e-context-skills.test.ts. These are periodic-tier because
  // each one spawns claude -p and costs ~$0.20-$0.40.
  'context-save-routing':                  [...CONTEXT_SAVE, 'skills/*/references/SHARED-JUDGMENT.md'],
  'context-save-then-restore-roundtrip':   [...CONTEXT_SAVE, ...CONTEXT_RESTORE, 'bin/gstack-slug'],
  'context-restore-fragment-match':        [...CONTEXT_RESTORE],
  'context-restore-empty-state':           [...CONTEXT_RESTORE],
  'context-restore-list-delegates':        [...CONTEXT_RESTORE],
  'context-restore-legacy-compat':         [...CONTEXT_RESTORE],
  'context-save-list-current-branch':      [...CONTEXT_SAVE],
  'context-save-list-all-branches':        [...CONTEXT_SAVE],

  // Document-release
  'document-release': [...DOCUMENT_RELEASE],

  // Codex (Claude E2E — tests the codex module via Claude)
  'codex-review': [...CODEX],

  // Codex E2E (tests skills via Codex CLI + worktree). The generated
  // .agents/skills/ tree is gitignored, so key on the skills/ source it is
  // built from — a gitignored path can never appear in a diff. Discovery
  // rides on the frontmatter descriptions, so the SKILL.md files are the
  // dependency, not the reference bodies underneath them.
  'codex-discover-skill':  [...CODEX, 'skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/helpers/codex-session-runner.ts', 'lib/worktree.ts'],
  'codex-review-findings': ['skills/review/**', ...CODEX, 'test/helpers/codex-session-runner.ts', 'lib/worktree.ts'],

  // Gemini E2E — smoke test only (Gemini gets lost in worktrees on complex tasks)
  'gemini-smoke':  ['skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/helpers/gemini-session-runner.ts', 'lib/worktree.ts'],


  // Coverage audit (shared fixture) + triage + gates
  'ship-coverage-audit': ['skills/ship/**', 'test/fixtures/coverage-audit-fixture.ts', 'bin/gstack-repo-mode'],
  'review-coverage-audit': ['skills/review/**', 'test/fixtures/coverage-audit-fixture.ts'],
  'plan-eng-coverage-audit': [...ENG, 'test/fixtures/coverage-audit-fixture.ts'],
  'ship-triage': ['skills/ship/**', 'bin/gstack-repo-mode'],
  'ship-idempotency': ['skills/ship/**', 'bin/gstack-next-version', 'bin/gstack-version-bump'],

  // gstack-upgrade — COVERAGE HOLE. The skill was cut in a9399ad3 (no
  // skills/ship/references/legacy/gstack-upgrade.md, no compat alias): ./setup
  // delegates placement to `npx skills add` and runtime/migrations.js owns 2.0
  // state versioning. The E2E testName still exists in skill-e2e-workflow.test.ts
  // (which still reads the deleted gstack-upgrade/SKILL.md), so the entry has to
  // stay for the completeness check. The only live surfaces left are the test
  // file itself and the runtime that replaced the prose.
  'gstack-upgrade-happy-path': ['test/skill-e2e-workflow.test.ts', 'runtime/upgrade.js', 'runtime/migrations.js'],

  // Deploy skills
  'land-and-deploy-workflow':      [...LAND_AND_DEPLOY],
  'land-and-deploy-first-run':     [...LAND_AND_DEPLOY, 'bin/gstack-slug'],
  'land-and-deploy-review-gate':   [...LAND_AND_DEPLOY, 'bin/gstack-review-read'],
  'canary-workflow':               ['skills/ship/references/legacy/canary.md', 'skills/.compat/canary/**', 'browse/src/**'],
  // 'benchmark-workflow' removed: commit a9399ad3 cut the benchmark module and
  // its compat alias, and test/skill-e2e-deploy.test.ts no longer declares the
  // testName. Nothing to select and nothing to point at.
  'setup-deploy-workflow':         ['skills/ship/references/legacy/setup-deploy.md', 'skills/.compat/setup-deploy/**'],

  // Autoplan. 'autoplan-core' removed: no surviving test file declares it
  // (test/skill-e2e-autoplan-chain.test.ts is covered by 'autoplan-chain-pty').
  'autoplan-dual-voice': ['skills/plan/references/legacy/autoplan.md', 'skills/.compat/autoplan/**', ...CODEX, 'bin/gstack-codex-probe', 'skills/review/references/legacy/review.md'],

  // Multi-provider benchmark adapters — live API smoke against real claude/codex/gemini CLIs
  'benchmark-providers-live': ['bin/gstack-model-benchmark', 'lib/model-benchmark/**', 'test/benchmark-production-boundary.test.ts'],

  // Browser-skills Phase 2a — /scrape + /skillify entries removed: all five
  // testNames (scrape-match-path, scrape-prototype-path, skillify-happy-path,
  // skillify-provenance-refusal, skillify-approval-reject) lived in
  // test/skill-e2e-skillify.test.ts, which was deleted with the scrape/ and
  // skillify/ skills. The browse-side runtime (browser-skills.ts,
  // browser-skill-write.ts) is still covered by browse/test/.

  // Skill routing — journey-stage tests. They depend on every shipped skill
  // description: the five dispatchers plus the compat aliases that carry the
  // old slash-names a user might type.
  'journey-ideation':       ['skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/skill-routing-e2e.test.ts'],
  'journey-plan-eng':       ['skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/skill-routing-e2e.test.ts'],
  'journey-debug':          ['skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/skill-routing-e2e.test.ts'],
  'journey-qa':             ['skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/skill-routing-e2e.test.ts'],
  'journey-code-review':    ['skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/skill-routing-e2e.test.ts'],
  'journey-ship':           ['skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/skill-routing-e2e.test.ts'],
  'journey-docs':           ['skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/skill-routing-e2e.test.ts'],
  'journey-retro':          ['skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/skill-routing-e2e.test.ts'],
  'journey-design-system':  ['skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/skill-routing-e2e.test.ts'],
  'journey-visual-qa':      ['skills/*/SKILL.md', 'skills/.compat/*/SKILL.md', 'test/skill-routing-e2e.test.ts'],

  // /ios-qa — agent flow E2E. Daemon + stub StateServer + codegen
  // exercised end-to-end. The no-device path is gate-tier; the with-device
  // path requires GSTACK_HAS_IOS_DEVICE=1 and is periodic-tier.
  'ios-qa-e2e':       ['ios-qa/**', 'skills/qa/references/legacy/ios-qa.md', 'skills/debug/references/legacy/ios-fix.md', 'skills/ship/references/legacy/ios-clean.md', 'skills/ship/references/legacy/ios-sync.md', 'test/skill-e2e-ios.test.ts'],
  // Swift-build invariant test — requires the Swift toolchain. Renders the
  // SHIPPED templates + gen-accessors output into a fresh package and builds
  // it (the gstack#1735 first-run gate), plus compiles the fixture SPM
  // package + runs the XCTest suite that validates the real Swift
  // StateServer implementation (loopback bind, boot token rotation,
  // session lock).
  'ios-qa-swift-build': ['ios-qa/templates/**', 'ios-qa/scripts/gen-accessors.ts', 'ios-qa/scripts/gen-accessors-tool/**', 'test/fixtures/ios-qa/FixtureApp/**', 'test/skill-e2e-ios-swift-build.test.ts'],
  // Real-device path — only runs with GSTACK_HAS_IOS_DEVICE=1 + a paired
  // iPhone. Validates the CoreDevice agent + iOS SDK toolchain. Periodic-tier.
  'ios-qa-device':    ['ios-qa/templates/**', 'test/fixtures/ios-qa/FixtureApp/**', 'test/skill-e2e-ios-device.test.ts'],

  // /spec end-to-end via PTY — exercises the full Phase 1→5 pipeline
  // including --execute spawn. Periodic-tier — paid + non-deterministic.
  'spec-execute':     ['skills/plan/references/legacy/spec.md', 'skills/.compat/spec/**', 'test/skill-e2e-spec-execute.test.ts'],

  // /office-hours brain-writeback path under fake gbrain CLI (v1.50.0.0
  // T7). Drives /office-hours with a fake gbrain on PATH; asserts the agent
  // calls `gbrain put office-hours/<slug>` with valid YAML frontmatter.
  // Touched by anything that changes the gbrain write surface, the detection
  // helper, or the office-hours module itself.
  'office-hours-brain-writeback': [
    'skills/plan/references/legacy/sync-gbrain.md',
    'skills/.compat/sync-gbrain/**',
    'bin/gstack-gbrain-detect',
    'bin/gstack-config',
    ...OFFICE_HOURS,
    'docs/gbrain-write-surfaces.md',
    'test/fixtures/office-hours-brain-writeback/**',
    'test/skill-e2e-office-hours-brain-writeback.test.ts',
  ],

  // gbrain CLI real round-trip against a local PGLite store (v1.50.0.0
  // T11). Proves the gbrain CLI persistence contract gstack relies on —
  // a `gbrain put` followed by `gbrain get` returns the body. Skips if
  // VOYAGE_API_KEY is unset OR gbrain CLI not on PATH.
  'gbrain-roundtrip-local': [
    'skills/plan/references/legacy/sync-gbrain.md',
    'skills/.compat/sync-gbrain/**',
    'test/skill-e2e-gbrain-roundtrip-local.test.ts',
  ],

};

/**
 * E2E test tiers — 'gate' blocks PRs, 'periodic' runs weekly/on-demand.
 * Must have exactly the same keys as E2E_TOUCHFILES.
 */
export const E2E_TIERS: Record<string, 'gate' | 'periodic'> = {
  // Browse core — gate (if browse breaks, everything breaks)
  'browse-basic': 'gate',
  'browse-snapshot': 'gate',

  // Hermetic isolation — gate (deterministic env/config assertions; if the
  // clean room breaks, every other eval's signal is contaminated)
  'hermetic-canary': 'gate',
  'hermetic-sentinel': 'gate',

  // SKILL.md setup — gate (if setup breaks, no skill works)
  'skillmd-setup-discovery': 'gate',
  'skillmd-no-local-binary': 'gate',
  'skillmd-outside-git': 'gate',
  'session-awareness': 'gate',
  'operational-learning': 'gate',

  // P4 first-run scaffold — periodic (onboarding, non-safety, model-touched marker)
  'first-task-scaffold': 'periodic',

  // QA — gate for functional, periodic for quality/benchmarks
  'qa-quick': 'gate',
  'qa-b6-static': 'periodic',
  'qa-b7-spa': 'periodic',
  'qa-b8-checkout': 'periodic',
  'qa-only-no-fix': 'gate',     // CRITICAL guardrail: Edit tool forbidden
  'qa-fix-loop': 'periodic',
  'qa-bootstrap': 'gate',
  'qa-ask-contract': 'gate',    // Contract guardrail: never RUN test commands to probe; ask instead

  // Review — gate for functional/guardrails, periodic for quality
  'review-sql-injection': 'gate',     // Security guardrail
  'review-enum-completeness': 'gate',
  'review-base-branch': 'gate',
  'review-design-lite': 'periodic',   // 4/7 threshold is subjective
  // Precision contract benchmark — quality benchmark, non-deterministic model
  // judgment (FP calibration + recall thresholds), full dispatcher run ~$2-4.
  'review-precision': 'periodic',
  'review-coverage-audit': 'gate',
  'review-dashboard-via': 'gate',

  // Review Army — gate for core functionality, periodic for multi-specialist
  'review-army-migration-safety': 'gate',   // Specialist activation guardrail
  'review-army-perf-n-plus-one': 'gate',    // Specialist activation guardrail
  'review-army-delivery-audit': 'gate',     // Delivery integrity guardrail
  'review-army-quality-score': 'gate',      // Score computation
  'review-army-json-findings': 'gate',      // JSON schema compliance
  'review-army-red-team': 'periodic',       // Multi-agent coordination
  'review-army-consensus': 'periodic',      // Multi-specialist agreement

  // Office Hours
  'office-hours-spec-review': 'gate',
  // Brain-writeback E2E — periodic per cost (claude -p) + non-deterministic
  // (model interprets the gbrain instruction). Matches nearby
  // setup-gbrain-path4-* tier classification.
  'office-hours-brain-writeback': 'periodic',
  // GBrain CLI round-trip — periodic per Voyage embedding cost (~$0.001/run)
  // and external-API-dependency (skips cleanly if VOYAGE_API_KEY unset).
  'gbrain-roundtrip-local': 'periodic',
  'office-hours-forcing-energy': 'gate',       // V1.1 mode-posture regression gate (Sonnet generator)
  // 'office-hours-builder-wildness' retiered to periodic in v1.32 contributor
  // wave: this is an LLM-judge creativity score (axis_a ≥4 on a "wildness"
  // posture). Per CLAUDE.md tier-classification rules, non-deterministic
  // quality benchmarks belong in periodic, not gate. The wave's +21-line
  // CJK preamble cascade (#1205) pushed the score from 5/5 → 3/3 on the
  // same /office-hours BUILDER prompt — same model, same fixture — proving
  // the bar is sensitive to preamble-byte changes that have nothing to do
  // with the test's intent (creativity, not preamble compliance).
  'office-hours-builder-wildness': 'periodic',

  // Plan reviews — gate for cheap functional, periodic for Opus quality
  'plan-ceo-review': 'periodic',
  'plan-ceo-review-selective': 'periodic',
  'plan-ceo-review-benefits': 'gate',
  'plan-ceo-review-expansion-energy': 'gate',  // V1.1 mode-posture regression gate (Opus generator, Sonnet judge)
  'plan-eng-review': 'periodic',
  'plan-eng-review-artifact': 'periodic',
  'plan-eng-coverage-audit': 'gate',
  'plan-review-report': 'gate',

  // Plan-mode handshake. plan-ceo/plan-devex ask-first reliably (gate-tier);
  // plan-eng runs a long explore/audit before its first AskUserQuestion, so
  // whether it reaches a terminal outcome within the 300s budget hinges on
  // stochastic ask-first compliance (~50-67%/run measured). Per the
  // "non-deterministic -> periodic" tiering rule it is periodic: the hardened
  // ask-first gate + the collapsed-form detector lifted it from always-failing
  // to mostly-passing, but it is not a deterministic gate.
  'plan-ceo-review-plan-mode': 'gate',
  'plan-eng-review-plan-mode': 'periodic',
  'plan-devex-review-plan-mode': 'gate',
  'plan-mode-no-op': 'gate',
  // v1.21+ auto-mode regression tests
  'office-hours-auto-mode': 'gate',
  'auto-decide-preserved': 'periodic',
  'conductor-prose': 'periodic',

  // Real-PTY E2E batch — tier classification:
  //   gate: cheap, deterministic, run on every PR
  //   periodic: long-running or expensive (>$3/run), run weekly
  // periodic pending a green baseline: this check measured the REAL 2.0
  // surface for the first time on 2026-08-09 (it read a dead 1.x path and
  // threw before that) and found the first AUQ missing template elements.
  // A gate needs a passing history to guard; promote back once the
  // decision-brief adherence work lands and this passes N consecutive runs.
  'auq-format-gate':                         'periodic',  // ~$0.50/run, SDK capture, single skill probe
  'plan-ceo-mode-routing':     'periodic',   // ~$3/run, deep navigation through 8-12 prior AskUserQuestions
  'budget-regression-pty':     'gate',       // free, library-only assertion
  'ship-idempotency-pty':      'periodic',   // ~$3/run, real /ship in plan mode
  'ship-section-loading':      'periodic',   // ~$3/run, real /ship; asserts section reads
  'plan-ceo-section-loading':  'periodic',   // ~$3-5/run, real /plan-ceo-review; asserts section read
  'autoplan-chain-pty':        'periodic',   // ~$8/run, all 3 phases sequential

  // Per-finding count + review-report-at-bottom — periodic because each
  // run drives a full skill end-to-end (~25 min, ~$5/run). Sequential
  // execution during calibration; concurrent opt-in only after measured
  // comparison agrees (plan §D15).
  'plan-ceo-finding-count':    'periodic',
  'plan-eng-finding-count':    'periodic',
  'plan-design-finding-count': 'periodic',
  'plan-devex-finding-count':  'periodic',
  'plan-eng-finding-floor':    'periodic',  // stochastic ask-first (see plan-mode-handshake note); periodic
  'plan-ceo-finding-floor':    'gate',
  'plan-devex-finding-floor':  'gate',
  'plan-eng-multi-finding-batching': 'periodic',
  'plan-ceo-split-overflow': 'periodic',

  // Privacy gate for gstack-brain-sync — periodic (non-deterministic LLM call,
  // costs ~$0.30-$0.50 per run, not needed on every commit)
  'brain-privacy-gate': 'periodic',

  // /setup-gbrain Path 4 (Remote MCP) — periodic-tier. The stub HTTP
  // server is deterministic but the model's interpretation of "follow
  // Path 4 only" is not — assertions on which steps the model ran are
  // flaky. The deterministic gate-tier coverage for Path 4 lives in
  // test/setup-gbrain-path4-structure.test.ts (free, <200ms). These
  // E2E tests stay available for on-demand verification of the live
  // model's behavior against a stub MCP server.
  'setup-gbrain-remote': 'periodic',
  'setup-gbrain-bad-token': 'periodic',
  'setup-gbrain-path4-local-pglite': 'periodic',

  // AskUserQuestion format regression — periodic (non-deterministic benchmark)
  'plan-ceo-review-format-mode': 'periodic',
  'plan-ceo-review-format-approach': 'periodic',
  'plan-eng-review-format-coverage': 'periodic',
  'plan-eng-review-format-kind': 'periodic',

  // Office-hours Phase 4 silent-auto-decide regression — periodic (Phase 4
  // requires the agent to invent 2-3 architectures, more open-ended than the
  // 4 plan-format cases above). Reclassify to gate if it turns out stable.
  'office-hours-phase4-fork': 'periodic',
  // judgeRecommendation rubric sanity (fixture-based, ~$0.04/run via Haiku)
  'llm-judge-recommendation': 'periodic',

  // v1.7.0.0 Pros/Cons format — cadence + negative-escape evals (all periodic)
  'plan-ceo-review-prosons-cadence': 'periodic',
  'plan-review-prosons-format': 'periodic',
  'plan-review-prosons-hardstop-neg': 'periodic',
  'plan-review-prosons-neutral-neg': 'periodic',

  // CT3 expanded coverage — non-plan-review skills inheriting Pros/Cons (all periodic)
  'ship-prosons-format': 'periodic',
  'office-hours-prosons-format': 'periodic',
  'investigate-prosons-format': 'periodic',
  'qa-prosons-format': 'periodic',
  'review-prosons-format': 'periodic',
  'document-release-prosons-format': 'periodic',

  // /plan proportionality — gate (deterministic functional guardrail: trivial
  // rename must stay on the fast path, not hard-block or load the module stack)
  'plan-proportionality': 'gate',

  // Same fast path in the other four dispatchers — gate for the same reason
  'qa-fast-path': 'gate',
  'review-fast-path': 'gate',
  'ship-fast-path': 'gate',
  'debug-fast-path': 'gate',

  // /plan-tune — gate (core v1 DX promise: plain-English intent routing)
  'plan-tune-inspect': 'gate',

  // /plan-tune cathedral (T16 per D12 — all gate)
  'plan-tune-hook-capture': 'gate',
  'plan-tune-enforcement': 'gate',
  'plan-tune-annotation': 'gate',
  'plan-tune-codex-import': 'gate',
  'plan-tune-dream-cycle': 'gate',

  // Codex offering verification — periodic: needs the external Codex CLI and
  // judges a multi-file dispatch flow whose natural turn cost moves with the
  // routing prose (6689e9f6 grew it from ~8 to 18+ turns). Non-deterministic
  // external-service quality checks are periodic per the tiering policy.
  'codex-offered-office-hours': 'periodic',
  'codex-offered-ceo-review': 'periodic',
  'codex-offered-eng-review': 'periodic',

  // Session Intelligence — gate for data flow, periodic for agent integration
  'timeline-event-flow': 'gate',                   // Binary data flow (no LLM needed)
  'context-recovery-artifacts': 'gate',            // Shared judgment reads seeded artifacts
  'context-save-writes-file': 'gate',              // /context-save writes a file
  'context-restore-loads-latest': 'gate',          // Cross-branch newest-by-filename restore

  // Context skills live-fire — periodic (each test spawns claude -p, ~$0.20-$0.40)
  'context-save-routing': 'periodic',              // Proves /context-save routes via Skill tool
  'context-save-then-restore-roundtrip': 'periodic', // Full cycle in one session
  'context-restore-fragment-match': 'periodic',    // /context-restore <fragment>
  'context-restore-empty-state': 'periodic',       // Graceful zero-saves message
  'context-restore-list-delegates': 'periodic',    // /context-restore list redirect
  'context-restore-legacy-compat': 'periodic',     // Pre-rename files still load
  'context-save-list-current-branch': 'periodic',  // Default branch filter
  'context-save-list-all-branches': 'periodic',    // --all flag

  // Ship — gate (end-to-end ship path)
  'ship-base-branch': 'gate',
  'ship-local-workflow': 'gate',
  'ship-coverage-audit': 'gate',
  'ship-triage': 'gate',
  'ship-idempotency': 'periodic',

  // Retro — gate for cheap branch detection, periodic for full Opus retro
  'retro': 'periodic',
  'retro-base-branch': 'gate',

  // Global discover
  'global-discover': 'gate',

  // CSO — gate for security guardrails, periodic for quality
  'cso-full-audit': 'gate',      // Hardcoded secrets detection
  'cso-diff-mode': 'gate',
  'cso-infra-scope': 'periodic',

  // Learnings — gate (functional guardrail: seeded learnings must appear)
  'learnings-show': 'gate',

  // Document-release — gate (CHANGELOG guardrail)
  'document-release': 'gate',

  // Codex — periodic (Opus, requires codex CLI)
  'codex-review': 'periodic',

  // Multi-AI — periodic (require external CLIs)
  'codex-discover-skill': 'periodic',
  'codex-review-findings': 'periodic',
  'gemini-smoke': 'periodic',


  // gstack-upgrade
  'gstack-upgrade-happy-path': 'gate',

  // Deploy skills
  'land-and-deploy-workflow': 'gate',
  'land-and-deploy-first-run': 'gate',
  'land-and-deploy-review-gate': 'gate',
  'canary-workflow': 'gate',
  'setup-deploy-workflow': 'gate',

  // Autoplan — periodic (not yet implemented)
  'autoplan-dual-voice': 'periodic',

  // Multi-provider benchmark — periodic (requires external CLIs + auth, paid)
  'benchmark-providers-live': 'periodic',

  // Skill routing — periodic (LLM routing is non-deterministic)
  'journey-ideation': 'periodic',
  'journey-plan-eng': 'periodic',
  'journey-debug': 'periodic',
  'journey-qa': 'periodic',
  'journey-code-review': 'periodic',
  'journey-ship': 'periodic',
  'journey-docs': 'periodic',
  'journey-retro': 'periodic',
  'journey-design-system': 'periodic',
  'journey-visual-qa': 'periodic',

  // /ios-qa daemon + codegen — no-device path runs every PR (no hardware
  // dependency, deterministic). with-device path requires GSTACK_HAS_IOS_DEVICE.
  'ios-qa-e2e': 'gate',
  // Swift toolchain only, no device required. Gate-tier: it is the only
  // check that builds what consumers actually get (the shipped templates,
  // not the fixture) — gstack#1735 shipped broken for months because this
  // ran nowhere. Skips loudly (typed reason) on hosts without Swift.
  'ios-qa-swift-build': 'gate',
  // Requires a real connected + paired iPhone. Manual-trigger only.
  'ios-qa-device': 'periodic',
  // /spec end-to-end PTY pipeline (paid, non-deterministic — periodic-tier).
  'spec-execute': 'periodic',
};

/**
 * LLM-judge test touchfiles — keyed by test description string.
 *
 * Every key here must still be reachable from test/skill-llm-eval.test.ts.
 * Cases the GStack 2 cut removed (benchmark, gstack-upgrade, plan-design-review,
 * design-review, design-consultation, voice directive, /spec authored quality,
 * the two office-hours rubrics) are deleted rather than repointed — that file
 * documents, per case, what judged quality is no longer measured.
 */
export const LLM_JUDGE_TOUCHFILES: Record<string, string[]> = {
  'command reference table':          ['browse/SKILL.md', 'browse/src/commands.ts'],
  'snapshot flags reference':         ['browse/SKILL.md', 'browse/src/snapshot.ts'],
  'browse/SKILL.md reference':        ['browse/SKILL.md', 'browse/src/**'],
  'setup block':                      ['browse/SKILL.md'],
  'regression vs baseline':           ['browse/SKILL.md', 'browse/src/commands.ts', 'test/fixtures/eval-baselines.json'],
  'qa/SKILL.md workflow':             ['skills/qa/references/legacy/qa.md'],
  'qa/SKILL.md health rubric':        ['skills/qa/references/legacy/qa.md'],
  'qa/SKILL.md anti-refusal':         ['skills/qa/references/legacy/qa.md', 'skills/qa/SKILL.md', 'skills/qa/references/legacy/qa-only.md'],
  'cross-skill greptile consistency': [
    'skills/review/references/legacy/review.md',
    'skills/ship/references/legacy/ship.md',
    'skills/ship/references/sections/ship/greptile.md',
    'skills/review/references/artifacts/review/greptile-triage.md',
    'skills/plan/references/legacy/retro.md',
  ],
  'baseline score pinning':           ['browse/SKILL.md', 'test/fixtures/eval-baselines.json'],

  // Ship & Release
  'ship/SKILL.md workflow':               ['skills/ship/references/legacy/ship.md', 'skills/ship/references/sections/ship/**'],
  'document-release/SKILL.md workflow':   ['skills/ship/references/legacy/document-release.md', 'skills/ship/references/sections/document-release/**'],

  // Plan Reviews
  'plan-ceo-review/SKILL.md modes':       ['skills/plan/references/legacy/plan-ceo-review.md', 'skills/plan/references/sections/plan-ceo-review/**'],
  'plan-eng-review/SKILL.md sections':    ['skills/plan/references/legacy/plan-eng-review.md', 'skills/plan/references/sections/plan-eng-review/**'],

  // Deploy skills
  'land-and-deploy/SKILL.md workflow':    ['skills/ship/references/legacy/land-and-deploy.md'],
  'canary/SKILL.md monitoring loop':      ['skills/ship/references/legacy/canary.md'],
  'setup-deploy/SKILL.md platform setup': ['skills/ship/references/legacy/setup-deploy.md'],

  // Other skills
  'retro/SKILL.md instructions':          ['skills/plan/references/legacy/retro.md'],
  'qa-only/SKILL.md workflow':            ['skills/qa/references/legacy/qa-only.md'],
};

/**
 * Changes to any of these files trigger ALL tests (both E2E and LLM-judge).
 *
 * Keep this list minimal — only files that genuinely affect every test.
 * Scoped dependencies (llm-judge, test-server, worktree, codex/gemini
 * session runners) belong in individual test entries instead.
 */
export const GLOBAL_TOUCHFILES = [
  'test/helpers/session-runner.ts',  // All E2E tests use this runner
  'test/helpers/hermetic-env.ts',    // Changes every E2E child's environment
  'test/helpers/eval-store.ts',      // All E2E tests store results here
  'test/helpers/touchfiles.ts',      // Self-referential — reclassifying wrong is dangerous
];

// --- Base branch detection ---

/**
 * Detect the base branch by trying refs in order.
 * Returns the first valid ref, or null if none found.
 */
export function detectBaseBranch(cwd: string): string | null {
  for (const ref of ['origin/main', 'origin/master', 'main', 'master']) {
    const result = spawnSync('git', ['rev-parse', '--verify', ref], {
      cwd, stdio: 'pipe', timeout: 3000,
    });
    if (result.status === 0) return ref;
  }
  return null;
}

/**
 * Get list of files changed between base branch and HEAD.
 */
export function getChangedFiles(baseBranch: string, cwd: string): string[] {
  const result = spawnSync('git', ['diff', '--name-only', `${baseBranch}...HEAD`], {
    cwd, stdio: 'pipe', timeout: 5000,
  });
  if (result.status !== 0) return [];
  return result.stdout.toString().trim().split('\n').filter(Boolean);
}

// --- Test selection ---

/**
 * Select tests to run based on changed files.
 *
 * Algorithm:
 * 1. If any changed file matches a global touchfile → run ALL tests
 * 2. Otherwise, for each test, check if any changed file matches its patterns
 * 3. Return selected + skipped lists with reason
 */
export function selectTests(
  changedFiles: string[],
  touchfiles: Record<string, string[]>,
  globalTouchfiles: string[] = GLOBAL_TOUCHFILES,
): { selected: string[]; skipped: string[]; reason: string } {
  const allTestNames = Object.keys(touchfiles);

  // Global touchfile hit → run all
  for (const file of changedFiles) {
    if (globalTouchfiles.some(g => matchGlob(file, g))) {
      return { selected: allTestNames, skipped: [], reason: `global: ${file}` };
    }
  }

  // Per-test matching
  const selected: string[] = [];
  const skipped: string[] = [];
  for (const [testName, patterns] of Object.entries(touchfiles)) {
    const hit = changedFiles.some(f => patterns.some(p => matchGlob(f, p)));
    (hit ? selected : skipped).push(testName);
  }

  return { selected, skipped, reason: 'diff' };
}
