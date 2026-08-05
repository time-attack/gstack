/**
 * Residual E2E tests from the original monolithic skill-e2e suite.
 *
 * HISTORY / WHY THIS FILE IS SMALL
 *
 * This file used to hold every skill E2E test. It was split by category into
 * `test/skill-e2e-<category>.test.ts` (see the header of
 * `test/helpers/e2e-helpers.ts`: "Extracted from the monolithic
 * skill-e2e.test.ts"), but the monolith itself was never deleted. That left 21
 * describe blocks duplicated verbatim between here and the category files —
 * same describe names, same test names, same assertions. Those duplicates are
 * gone now; the category file owns each one:
 *
 *   Skill E2E tests (browse/skillmd/session)  -> skill-e2e-bws.test.ts
 *   QA skill E2E / QA-Only / QA Fix Loop      -> skill-e2e-qa-workflow.test.ts
 *   Test Bootstrap E2E                        -> skill-e2e-qa-workflow.test.ts
 *   Planted-bug outcome evals                 -> skill-e2e-qa-bugs.test.ts
 *   Review skill E2E / enum completeness      -> skill-e2e-review.test.ts
 *   Base branch detection / Retro E2E         -> skill-e2e-review.test.ts
 *   Plan CEO / Eng review + artifact          -> skill-e2e-plan.test.ts
 *   Office Hours Spec Review / Benefits-From  -> skill-e2e-plan.test.ts
 *   Document-Release / Codex / ship-coverage  -> skill-e2e-workflow.test.ts
 *
 * READ THIS BEFORE ADDING A TEST HERE
 *
 * Nothing in this file currently runs. The paid runners glob
 * `test/skill-e2e-*.test.ts` (note the dash — see PAID_TEST_GLOBS in
 * scripts/test-paid-shards.ts and the test:gate/test:evals scripts in
 * package.json), and the free runner excludes `test/skill-e2e(-.*)?.test.ts`
 * outright (PAID_TEST_PATTERNS in scripts/test-free-shards.ts). This filename
 * has no dash, so it falls through both. `test/paid-shards.test.ts` pins that:
 * `expect(isPaidTestFile('test/skill-e2e.test.ts')).toBe(false)`.
 *
 * The three tests below are the only ones with no home in a category file, and
 * all three are registered in E2E_TIERS ('ship-triage': gate,
 * 'plan-eng-coverage-audit': gate, 'ship-idempotency': periodic) — i.e. they
 * are meant to run and don't. Renaming this file into the `skill-e2e-*` glob
 * (or moving these blocks into a category file) is what makes them live; that
 * touches package.json/paid-shards ownership, so it is not done here.
 *
 * INSTALL MODEL (post-1.x)
 *
 * The 1.x skill tree at the repo root is deleted. A live dispatcher (`ship`)
 * is installed as a TREE at `<workDir>/skills/ship/` — never flattened,
 * because the dispatcher addresses everything it lazily reads as
 * `references/...` relative to its own root. A retired name
 * (`plan-eng-review`) goes through `installLegacySkill`, which lays down the
 * compat alias under the old name plus the dispatcher it routes into, and
 * throws rather than silently installing nothing.
 */

import { test, expect, beforeAll, afterAll } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT,
  runId,
  copyDirSync,
  describeE2E,
  describeIfSelected,
  testIfSelected,
  installLegacySkill,
  logCost,
  recordE2E,
  requireReportArtifact,
  createEvalCollector,
  finalizeEvalCollector,
} from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e');

/**
 * Install a LIVE dispatcher (`qa`, `review`, `ship`) into an E2E workdir.
 *
 * These three are not retired and have no compat alias, so `installLegacySkill`
 * does not apply. Copied as a tree at `<workDir>/skills/<name>/`: the
 * dispatcher's SKILL.md points at `references/legacy/*.md` and
 * `references/sections/**` by relative path, so a flattened install dead-ends
 * every lazy read the workflow depends on.
 *
 * Throws on a missing dispatcher — an `existsSync`-guarded copy here is how a
 * test quietly installs nothing and then "passes" against an empty workdir.
 */
function installDispatcher(workDir: string, name: string): void {
  const src = path.join(ROOT, 'skills', name);
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
    throw new Error(
      `installDispatcher("${name}"): no dispatcher at skills/${name}/SKILL.md. ` +
        `The 1.x root tree is deleted, so there is no other source for this skill.`,
    );
  }
  copyDirSync(src, path.join(workDir, 'skills', name));
}

/**
 * Slice a named section out of a shipped module, and THROW when a marker is
 * missing.
 *
 * `indexOf` returning -1 makes `slice(-1, -1)` yield "" (or, worse, a tail
 * slice from the end of the file). A test that hands "" to the agent as its
 * instructions and then asserts "the agent didn't mutate VERSION" passes
 * vacuously — the agent had nothing to do. Section markers move (ship's
 * version-bump step was Step 4 in 1.x and is Step 12 now); the throw is what
 * turns that into a loud failure instead of a green no-op.
 */
function sliceSection(source: string, label: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  if (start < 0) {
    throw new Error(`${label}: start marker not found: ${JSON.stringify(startMarker)}. The section moved or was cut.`);
  }
  const end = source.indexOf(endMarker, start + startMarker.length);
  if (end < 0) {
    throw new Error(
      `${label}: end marker ${JSON.stringify(endMarker)} not found after ${JSON.stringify(startMarker)}. The section moved or was cut.`,
    );
  }
  return source.slice(start, end);
}

// --- Test Failure Triage E2E ---
//
// The Test Failure Ownership Triage (Steps T1-T4) moved out of the top-level
// ship workflow into ship's "tests" lazy specialist phase:
// skills/ship/references/sections/ship/tests.md. The agent now reaches it in
// three reads (dispatcher SKILL.md -> references/legacy/ship.md -> that
// section) where 1.x had it inline in one file.

describeIfSelected('Test Failure Triage E2E', ['ship-triage'], () => {
  let triageDir: string;

  beforeAll(() => {
    triageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-triage-'));

    // The ship dispatcher, as a tree. sections/ship/tests.md is only reachable
    // from skills/ship/references/..., so this must not be flattened.
    installDispatcher(triageDir, 'ship');

    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: triageDir, stdio: 'pipe', timeout: 5000 });

    // Init git repo
    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);

    // Create a project with a pre-existing test failure on main
    fs.writeFileSync(path.join(triageDir, 'package.json'), JSON.stringify({
      name: 'triage-test-app',
      version: '1.0.0',
      scripts: { test: 'node test/run.js' },
    }, null, 2));

    fs.mkdirSync(path.join(triageDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(triageDir, 'test'), { recursive: true });

    // Source with a bug that exists on main (pre-existing)
    fs.writeFileSync(path.join(triageDir, 'src', 'math.js'), `
module.exports = {
  add: (a, b) => a + b,
  divide: (a, b) => a / b,  // BUG: no zero-division check (pre-existing)
};
`);

    // Test file that catches the pre-existing bug
    fs.writeFileSync(path.join(triageDir, 'test', 'math.test.js'), `
const { add, divide } = require('../src/math');

// This test passes
if (add(2, 3) !== 5) { console.error('FAIL: add(2,3) should be 5'); process.exit(1); }
console.log('PASS: add');

// This test FAILS — pre-existing bug (divide by zero returns Infinity, not an error)
try {
  const result = divide(10, 0);
  if (result === Infinity) { console.error('FAIL: divide(10,0) should throw, got Infinity'); process.exit(1); }
} catch(e) {
  console.log('PASS: divide zero check');
}
`);

    // Test runner — each test in a subprocess so one failure doesn't kill the other
    fs.writeFileSync(path.join(triageDir, 'test', 'run.js'), `
const { execSync } = require('child_process');
const path = require('path');
let failures = 0;
for (const f of ['math.test.js', 'string.test.js']) {
  try {
    execSync('node ' + path.join(__dirname, f), { stdio: 'inherit' });
  } catch (e) {
    failures++;
  }
}
if (failures > 0) process.exit(1);
`);

    // Commit on main with the pre-existing bug
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial: math utils with tests']);

    // Create feature branch
    run('git', ['checkout', '-b', 'feature/string-utils']);

    // Add new code with a new bug (in-branch)
    fs.writeFileSync(path.join(triageDir, 'src', 'string.js'), `
module.exports = {
  capitalize: (s) => s.charAt(0).toUpperCase() + s.slice(1),
  reverse: (s) => s.split('').reverse().join(''),
  truncate: (s, len) => s.substring(0, len),  // BUG: no null check (in-branch)
};
`);

    // Add test that catches the in-branch bug
    fs.writeFileSync(path.join(triageDir, 'test', 'string.test.js'), `
const { capitalize, reverse, truncate } = require('../src/string');

if (capitalize('hello') !== 'Hello') { console.error('FAIL: capitalize'); process.exit(1); }
console.log('PASS: capitalize');

if (reverse('abc') !== 'cba') { console.error('FAIL: reverse'); process.exit(1); }
console.log('PASS: reverse');

// This test FAILS — in-branch bug (null input causes TypeError)
try {
  truncate(null, 5);
  console.log('PASS: truncate null');
} catch(e) {
  console.error('FAIL: truncate(null, 5) threw: ' + e.message);
  process.exit(1);
}
`);

    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'feat: add string utilities']);
  });

  afterAll(() => {
    try { fs.rmSync(triageDir, { recursive: true, force: true }); } catch {}
  });

  testIfSelected('ship-triage', async () => {
    const result = await runSkillTest({
      prompt: `The gstack ship dispatcher is installed at skills/ship/ in this working directory.

Read skills/ship/SKILL.md first. It is a LAZY DISPATCHER — it routes, it does not
carry the workflow. Follow its \`$ship --mode Prepare\` route into
skills/ship/references/legacy/ship.md, then read the section file that module's
"Lazy specialist phase: tests" names (skills/ship/references/sections/ship/tests.md).
The Test Failure Ownership Triage (Steps T1-T4) lives in that section file.

This is NOT a trivial change — do NOT take the trivial-change fast path.

You are on the feature/string-utils branch. The base branch is main.
This is a test project — there is no remote, no PR to create.

Run the tests first:
\`\`\`bash
cd ${triageDir} && node test/run.js
\`\`\`

The tests will fail. Now run ONLY the Test Failure Ownership Triage (Steps T1-T4).

For each failing test, classify it as:
- **In-branch**: caused by changes on this branch (feature/string-utils)
- **Pre-existing**: existed before this branch (present on main)

Use git diff origin/main...HEAD (or git diff main...HEAD since there's no remote) to determine which files changed on this branch.

Output your classification for each failure clearly, labeling each as "IN-BRANCH" or "PRE-EXISTING" with your reasoning.

This is a solo repo (REPO_MODE=solo). For pre-existing failures, recommend fixing now.`,
      workingDirectory: triageDir,
      // Raised 20 -> 30. In 1.x the triage was inline in the single ship/SKILL.md
      // the agent already read. It now costs three Reads (dispatcher SKILL.md,
      // references/legacy/ship.md, references/sections/ship/tests.md) before any
      // git work starts, and the run still has to execute the suite, diff the
      // branch, and classify two failures.
      maxTurns: 30,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
      // Raised 180s -> 300s for the same reason: legacy/ship.md is ~41KB and
      // sections/ship/tests.md ~20KB, so the read phase alone is slower.
      timeout: 300_000,
      testName: 'ship-triage',
      runId,
    });

    logCost('/ship triage', result);

    const output = result.output || '';
    const outputLower = output.toLowerCase();

    // The triage should identify the string/truncate failure as in-branch
    const hasInBranch = outputLower.includes('in-branch') || outputLower.includes('in branch') || outputLower.includes('introduced');
    // The triage should identify the math/divide failure as pre-existing
    const hasPreExisting = outputLower.includes('pre-existing') || outputLower.includes('pre existing') || outputLower.includes('existed before');

    console.log(`Output identifies IN-BRANCH failures: ${hasInBranch}`);
    console.log(`Output identifies PRE-EXISTING failures: ${hasPreExisting}`);

    // Check that the string/truncate bug is classified as in-branch
    const mentionsTruncate = outputLower.includes('truncate') || outputLower.includes('string');
    const mentionsDivide = outputLower.includes('divide') || outputLower.includes('math');

    console.log(`Mentions truncate/string (in-branch bug): ${mentionsTruncate}`);
    console.log(`Mentions divide/math (pre-existing bug): ${mentionsDivide}`);

    // Verify BOTH failure classes are exercised (not just detected):
    // The test runner must have actually run both test files
    const ranMathTest = output.includes('math.test') || output.includes('FAIL: divide');
    const ranStringTest = output.includes('string.test') || output.includes('FAIL: truncate');
    console.log(`Ran math test file (pre-existing failure): ${ranMathTest}`);
    console.log(`Ran string test file (in-branch failure): ${ranStringTest}`);

    recordE2E(evalCollector, '/ship triage', 'Test Failure Triage E2E', result, {
      passed: result.exitReason === 'success' && hasInBranch && hasPreExisting,
      has_in_branch_classification: hasInBranch,
      has_pre_existing_classification: hasPreExisting,
      mentions_truncate: mentionsTruncate,
      mentions_divide: mentionsDivide,
      ran_both_test_files: ranMathTest && ranStringTest,
    });

    expect(result.exitReason).toBe('success');
    // Must classify at least one failure as in-branch AND one as pre-existing
    expect(hasInBranch).toBe(true);
    expect(hasPreExisting).toBe(true);
    // Must mention the specific bugs
    expect(mentionsTruncate).toBe(true);
    expect(mentionsDivide).toBe(true);
    // Must have actually run both test files (exercises both failure classes)
    expect(ranMathTest).toBe(true);
    expect(ranStringTest).toBe(true);
  }, 360_000);
});

// --- Plan Eng Review Coverage Audit E2E ---
//
// The coverage audit + ASCII diagram ([GAP] / [★ TESTED] / "COVERAGE: N/M paths
// tested") survives verbatim in
// skills/plan/references/sections/plan-eng-review/review-sections.md, reached
// from the plan-eng-review module's "Lazy specialist phase: review-sections".
// Every token this test asserts on is still in the shipped section.

describeIfSelected('Plan Eng Review Coverage Audit E2E', ['plan-eng-coverage-audit'], () => {
  let planCoverageDir: string;
  let route: ReturnType<typeof installLegacySkill>;

  beforeAll(() => {
    planCoverageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-plan-coverage-'));

    // /plan-eng-review is retired. Install it the way a user reaches it today:
    // the compat alias under its old name (so `plan-eng-review/SKILL.md` in the
    // prompt still resolves) plus the plan dispatcher it routes into. Throws if
    // the alias, the dispatcher, or the routed module is missing.
    route = installLegacySkill(planCoverageDir, 'plan-eng-review');

    // Use shared fixture for billing project with coverage gaps
    const { createCoverageAuditFixture } = require('./fixtures/coverage-audit-fixture');
    createCoverageAuditFixture(planCoverageDir);
  });

  afterAll(() => {
    try { fs.rmSync(planCoverageDir, { recursive: true, force: true }); } catch {}
  });

  testIfSelected('plan-eng-coverage-audit', async () => {
    const result = await runSkillTest({
      prompt: `Read plan-eng-review/SKILL.md. It is a compatibility ROUTING ALIAS, not the
workflow. Follow its dispatch (\`${route.invocation}\`) into skills/${route.dispatcher}/SKILL.md,
then read that dispatcher's references/legacy/${route.module}.md module. The Test
Coverage Audit lives in the section file that module's "Lazy specialist phase:
review-sections" names — skills/${route.dispatcher}/references/sections/${route.module}/review-sections.md.

This is NOT a trivial change — do NOT take the trivial-change fast path.

You are on the feature/billing branch. The base branch is main.
This is a test project — there is no remote, no PR to create.

ONLY run the Test Coverage Audit section from the plan review workflow.
Skip all other steps (architecture, code quality, performance, etc.).

The source code is in ${planCoverageDir}/src/billing.ts.
Existing tests are in ${planCoverageDir}/test/billing.test.ts.

Produce the ASCII coverage diagram showing which code paths are tested and which have gaps.
Output the diagram directly.`,
      workingDirectory: planCoverageDir,
      // Raised 15 -> 26. The 1.x module was one self-contained SKILL.md read.
      // The shipped path is: compat alias -> skills/plan/SKILL.md ->
      // references/legacy/plan-eng-review.md (~28KB) ->
      // references/sections/plan-eng-review/review-sections.md (~39KB), plus the
      // dispatcher's mandatory SHARED-JUDGMENT.md / AUTHORITY-POLICY.md reads.
      // At 15 turns the run spends its whole budget getting to the section.
      maxTurns: 26,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
      // Raised 120s -> 300s: ~70KB of module reads before the audit begins.
      timeout: 300_000,
      testName: 'plan-eng-coverage-audit',
      runId,
    });

    logCost('/plan-eng-review coverage audit', result);
    recordE2E(evalCollector, '/plan-eng-review coverage audit', 'Plan Eng Review Coverage Audit E2E', result, {
      passed: result.exitReason === 'success',
    });

    expect(result.exitReason).toBe('success');

    // Check output contains coverage diagram elements
    const output = result.output || '';
    const outputLower = output.toLowerCase();
    const hasGap = outputLower.includes('gap') || outputLower.includes('no test');
    const hasTested = outputLower.includes('tested') || output.includes('✓') || output.includes('★');
    const hasCoverage = outputLower.includes('coverage') || outputLower.includes('paths tested');

    console.log(`Output has GAP markers: ${hasGap}`);
    console.log(`Output has TESTED markers: ${hasTested}`);
    console.log(`Output has coverage summary: ${hasCoverage}`);

    // The agent MUST produce a coverage diagram with gap and tested markers
    expect(hasGap || hasTested).toBe(true);

    // At minimum, the agent should have read the source and test files
    const readCalls = result.toolCalls.filter(tc => tc.tool === 'Read');
    expect(readCalls.length).toBeGreaterThan(0);
  }, 360_000);
});

// --- Ship idempotency (#649) ---
//
// Step renumbering, not behavior change: the version-bump idempotency check was
// "Step 4" in 1.x and is "Step 12" in the shipped ship module; the push check
// was "Step 7" and is "Step 17". ALREADY_BUMPED and ALREADY_PUSHED both still
// ship verbatim. sliceSection() throws if either anchor moves again, so the
// agent can never be handed an empty instruction file.
//
// There is a richer real-PTY sibling at test/skill-e2e-ship-idempotency.test.ts
// ('ship-idempotency-pty', periodic) that drives the real /ship workflow. This
// one is the cheap SDK-harness canary on the check text itself.

describeIfSelected('Ship idempotency', ['ship-idempotency'], () => {
  let idempDir: string;
  const gitRun = (args: string[], cwd: string) =>
    spawnSync('git', args, { cwd, stdio: 'pipe', timeout: 5000 });

  beforeAll(() => {
    idempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-ship-idemp-'));

    // Create git repo with initial commit on main
    gitRun(['init', '-b', 'main'], idempDir);
    gitRun(['config', 'user.email', 'test@test.com'], idempDir);
    gitRun(['config', 'user.name', 'Test'], idempDir);

    fs.writeFileSync(path.join(idempDir, 'app.ts'), 'console.log("v1");\n');
    fs.writeFileSync(path.join(idempDir, 'VERSION'), '0.1.0.0\n');
    fs.writeFileSync(path.join(idempDir, 'CHANGELOG.md'), '# Changelog\n');
    gitRun(['add', '.'], idempDir);
    gitRun(['commit', '-m', 'initial'], idempDir);

    // Create feature branch with changes
    gitRun(['checkout', '-b', 'feat/my-feature'], idempDir);
    fs.writeFileSync(path.join(idempDir, 'app.ts'), 'console.log("v2");\n');
    gitRun(['add', 'app.ts'], idempDir);
    gitRun(['commit', '-m', 'feat: update to v2'], idempDir);

    // Simulate prior /ship run: bump VERSION and write CHANGELOG entry
    fs.writeFileSync(path.join(idempDir, 'VERSION'), '0.2.0.0\n');
    fs.writeFileSync(path.join(idempDir, 'CHANGELOG.md'),
      '# Changelog\n\n## [0.2.0.0] — 2026-03-30\n\n- Updated app to v2\n');
    gitRun(['add', 'VERSION', 'CHANGELOG.md'], idempDir);
    gitRun(['commit', '-m', 'chore: bump version to 0.2.0.0'], idempDir);

    // Extract just the idempotency-relevant steps from the shipped ship module.
    const shipModule = path.join(ROOT, 'skills', 'ship', 'references', 'legacy', 'ship.md');
    const full = fs.readFileSync(shipModule, 'utf-8');
    const extracted = [
      sliceSection(full, 'skills/ship/references/legacy/ship.md', '## Step 12: Version bump', '## Lazy specialist phase: changelog'),
      sliceSection(full, 'skills/ship/references/legacy/ship.md', '## Step 17: Push', '## Lazy specialist phase: pr-body'),
    ].join('\n\n---\n\n');

    // Both idempotency verdicts must actually be in what we hand the agent —
    // otherwise the test asks for a detection the instructions never describe.
    for (const token of ['ALREADY_BUMPED', 'ALREADY_PUSHED']) {
      if (!extracted.includes(token)) {
        throw new Error(`ship-idempotency: extracted steps do not mention ${token}. The check moved or was cut.`);
      }
    }

    fs.writeFileSync(path.join(idempDir, 'ship-steps.md'), extracted);
  });

  afterAll(() => {
    try { fs.rmSync(idempDir, { recursive: true, force: true }); } catch {}
  });

  testIfSelected('ship-idempotency', async () => {
    const result = await runSkillTest({
      prompt: `You are in a git repo on branch feat/my-feature. A prior /ship run already:
- Bumped VERSION from 0.1.0.0 to 0.2.0.0
- Wrote a CHANGELOG entry for 0.2.0.0
- But the push/PR step failed

Read ship-steps.md for the idempotency check instructions from the ship workflow.
It holds Step 12 (Version bump) and Step 17 (Push), extracted verbatim.

The managed runtime is NOT installed here, so \$GSTACK_BIN is unset and the
gstack-version-bump helper is unavailable — take the NO_RUNTIME path the step
describes and classify by hand.

Run ONLY the idempotency checks described in those two steps. Do NOT actually push or create PRs (there is no remote).

After running the checks, write a report to ${idempDir}/idemp-result.md containing:
- Whether VERSION was detected as ALREADY_BUMPED or not
- Whether the push was detected as ALREADY_PUSHED or PUSH_NEEDED
- The current VERSION value (should still be 0.2.0.0)

Do NOT modify VERSION or CHANGELOG. Only run the detection checks and report.`,
      workingDirectory: idempDir,
      // Raised 10 -> 14 and 60s -> 120s. The extracted steps are ~8KB (the 1.x
      // Step 4 + Step 7 pair was smaller) and Step 12's classify now has a
      // runtime-probe branch to fall through before the hand classification.
      maxTurns: 14,
      timeout: 120_000,
      testName: 'ship-idempotency',
      runId,
    });

    logCost('/ship idempotency', result);
    recordE2E(evalCollector, '/ship idempotency guard', 'Ship idempotency', result);
    expect(result.exitReason).toBe('success');

    // Verify VERSION was NOT modified
    const version = fs.readFileSync(path.join(idempDir, 'VERSION'), 'utf-8').trim();
    expect(version).toBe('0.2.0.0');

    // Verify CHANGELOG was NOT duplicated
    const changelog = fs.readFileSync(path.join(idempDir, 'CHANGELOG.md'), 'utf-8');
    const versionEntries = (changelog.match(/## \[0\.2\.0\.0\]/g) || []).length;
    expect(versionEntries).toBe(1);

    // The report is the assertion, not an optional bonus. The old
    // `if (fs.existsSync(reportPath))` guard meant an agent that wrote nothing
    // passed every "don't mutate VERSION" check for free.
    const report = requireReportArtifact(path.join(idempDir, 'idemp-result.md'));
    expect(report.toLowerCase()).toContain('already_bumped');
  }, 180_000);
});

// --- Deferred skill E2E tests (destructive or require interactive UI) ---

// Deferred tests — only test.todo entries, no selection needed
describeE2E('Deferred skill E2E', () => {
  // Ship is destructive: pushes to remote, creates PRs, modifies VERSION/CHANGELOG
  test.todo('/ship completes full workflow');

  // Setup-browser-cookies requires interactive browser picker UI
  test.todo('/setup-browser-cookies imports cookies');
});

// Module-level afterAll — finalize eval collector after all tests complete
afterAll(async () => {
  await finalizeEvalCollector(evalCollector);
});
