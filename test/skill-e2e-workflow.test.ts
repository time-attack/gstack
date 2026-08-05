import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, runId,
  describeIfSelected, testConcurrentIfSelected,
  copyDirSync, installLegacySkill, logCost, recordE2E,
  createEvalCollector, finalizeEvalCollector, requireReportArtifact,
} from './helpers/e2e-helpers';
import type { LegacyRoute } from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e-workflow');

// --- Document-Release skill E2E ---

describeIfSelected('Document-Release skill E2E', ['document-release'], () => {
  let docReleaseDir: string;
  let docReleaseRoute: LegacyRoute;

  beforeAll(() => {
    docReleaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-doc-release-'));

    // /document-release is retired. A user who types it today hits the compat
    // alias, which dispatches to `$ship --mode Prepare --module document-release`.
    // Install that whole path (alias under its old name + the ship dispatcher);
    // throws if either end of the route is missing.
    docReleaseRoute = installLegacySkill(docReleaseDir, 'document-release');

    // Init git repo with initial docs
    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: docReleaseDir, stdio: 'pipe', timeout: 5000 });

    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);

    // Create initial README with a features list
    fs.writeFileSync(path.join(docReleaseDir, 'README.md'),
      '# Test Project\n\n## Features\n\n- Feature A\n- Feature B\n\n## Install\n\n```bash\nnpm install\n```\n');

    // Create initial CHANGELOG that must NOT be clobbered
    fs.writeFileSync(path.join(docReleaseDir, 'CHANGELOG.md'),
      '# Changelog\n\n## 1.0.0 — 2026-03-01\n\n- Initial release with Feature A and Feature B\n- Setup CI pipeline\n');

    // Create VERSION file (already bumped)
    fs.writeFileSync(path.join(docReleaseDir, 'VERSION'), '1.1.0\n');

    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);

    // Create feature branch with a code change
    run('git', ['checkout', '-b', 'feat/add-feature-c']);
    fs.writeFileSync(path.join(docReleaseDir, 'feature-c.ts'), 'export function featureC() { return "C"; }\n');
    fs.writeFileSync(path.join(docReleaseDir, 'VERSION'), '1.1.1\n');
    fs.writeFileSync(path.join(docReleaseDir, 'CHANGELOG.md'),
      '# Changelog\n\n## 1.1.1 — 2026-03-16\n\n- Added Feature C\n\n## 1.0.0 — 2026-03-01\n\n- Initial release with Feature A and Feature B\n- Setup CI pipeline\n');
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'feat: add feature C']);
  });

  afterAll(() => {
    try { fs.rmSync(docReleaseDir, { recursive: true, force: true }); } catch {}
  });

  testConcurrentIfSelected('document-release', async () => {
    const result = await runSkillTest({
      prompt: `Read the file document-release/SKILL.md. It is a routing alias, not the
workflow: follow its dispatch (\`${docReleaseRoute.invocation}\`) into
skills/${docReleaseRoute.dispatcher}/SKILL.md and read that dispatcher's
references/legacy/${docReleaseRoute.module}.md module, which carries the actual
workflow. There is no skill registry in this directory — use those literal paths.

Run that document-release workflow on this repo. The base branch is "main".

IMPORTANT:
- Do NOT use AskUserQuestion — auto-approve everything or skip if unsure.
- Do NOT push or create PRs (there is no remote).
- Do NOT run gh commands (no remote).
- Focus on updating README.md to reflect the new Feature C.
- Do NOT overwrite or regenerate CHANGELOG entries.
- Skip VERSION bump (it's already bumped).
- After editing, just commit the changes locally.`,
      workingDirectory: docReleaseDir,
      maxTurns: 30,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob'],
      timeout: 180_000,
      testName: 'document-release',
      runId,
    });

    logCost('/document-release', result);

    // Read CHANGELOG to verify it was NOT clobbered
    const changelog = fs.readFileSync(path.join(docReleaseDir, 'CHANGELOG.md'), 'utf-8');
    const hasOriginalEntries = changelog.includes('Initial release with Feature A and Feature B')
      && changelog.includes('Setup CI pipeline')
      && changelog.includes('1.0.0');
    if (!hasOriginalEntries) {
      console.warn('CHANGELOG CLOBBERED — original entries missing!');
    }

    // Check if README was updated
    const readme = fs.readFileSync(path.join(docReleaseDir, 'README.md'), 'utf-8');
    const readmeUpdated = readme.includes('Feature C') || readme.includes('feature-c') || readme.includes('feature C');

    const exitOk = ['success', 'error_max_turns'].includes(result.exitReason);
    recordE2E(evalCollector, '/document-release', 'Document-Release skill E2E', result, {
      passed: exitOk && hasOriginalEntries,
    });

    // Critical guardrail: CHANGELOG must not be clobbered
    expect(hasOriginalEntries).toBe(true);

    // Accept error_max_turns — thorough doc review is not a failure
    expect(['success', 'error_max_turns']).toContain(result.exitReason);

    // Informational: did it update README?
    if (readmeUpdated) {
      console.log('README updated to include Feature C');
    } else {
      console.warn('README was NOT updated — agent may not have found the feature');
    }
  }, 240_000);
});

// --- Ship workflow with local bare remote ---

describeIfSelected('Ship workflow E2E', ['ship-local-workflow'], () => {
  let shipWorkDir: string;
  let shipRemoteDir: string;

  beforeAll(() => {
    shipRemoteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-ship-remote-'));
    shipWorkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-ship-work-'));

    // Create bare remote
    spawnSync('git', ['init', '--bare'], { cwd: shipRemoteDir, stdio: 'pipe' });

    // Clone it as working repo
    spawnSync('git', ['clone', shipRemoteDir, shipWorkDir], { stdio: 'pipe' });

    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: shipWorkDir, stdio: 'pipe', timeout: 5000 });
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);

    // Initial commit on main
    fs.writeFileSync(path.join(shipWorkDir, 'app.ts'), 'console.log("v1");\n');
    fs.writeFileSync(path.join(shipWorkDir, 'VERSION'), '0.1.0.0\n');
    fs.writeFileSync(path.join(shipWorkDir, 'CHANGELOG.md'), '# Changelog\n');
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);
    run('git', ['push', '-u', 'origin', 'main']);

    // Feature branch
    run('git', ['checkout', '-b', 'feature/ship-test']);
    fs.writeFileSync(path.join(shipWorkDir, 'app.ts'), 'console.log("v2");\n');
    run('git', ['add', 'app.ts']);
    run('git', ['commit', '-m', 'feat: update to v2']);

  });

  afterAll(() => {
    try { fs.rmSync(shipWorkDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(shipRemoteDir, { recursive: true, force: true }); } catch {}
  });

  testConcurrentIfSelected('ship-local-workflow', async () => {
    const result = await runSkillTest({
      prompt: `You are in a git repo on branch feature/ship-test. Do these steps in order:
1. Read VERSION file and bump the last digit by 1 (e.g. 0.1.0.0 → 0.1.0.1). Write the new version back.
2. Add a CHANGELOG.md entry: "## [NEW_VERSION] - TODAY" with a bullet "- Ship test feature".
3. Stage all changes, commit with message "ship: vNEW_VERSION".
4. Push to origin: git push origin feature/ship-test`,
      workingDirectory: shipWorkDir,
      maxTurns: 8,
      timeout: 120_000,
      testName: 'ship-local-workflow',
      runId,
    });

    logCost('/ship local workflow', result);

    // Check push succeeded — verify the feature branch exists on the bare remote
    const branchCheck = spawnSync('git', ['branch', '--list', 'feature/ship-test'], { cwd: shipRemoteDir, stdio: 'pipe' });
    const branchExists = branchCheck.stdout.toString().trim().length > 0;

    // Check VERSION was bumped locally (even if push failed, this shows the LLM did the work)
    const versionContent = fs.existsSync(path.join(shipWorkDir, 'VERSION'))
      ? fs.readFileSync(path.join(shipWorkDir, 'VERSION'), 'utf-8').trim() : '';
    const versionBumped = versionContent !== '0.1.0.0';

    recordE2E(evalCollector, '/ship local workflow', 'Ship workflow E2E', result, {
      passed: branchExists && versionBumped && ['success', 'error_max_turns'].includes(result.exitReason),
    });

    expect(['success', 'error_max_turns']).toContain(result.exitReason);
    expect(branchExists).toBe(true);
    expect(versionBumped).toBe(true);
    console.log(`Branch pushed: ${branchExists}, VERSION: ${versionContent}, bumped: ${versionBumped}`);
  }, 150_000);
});

// setup-cookies-detect REMOVED: The cookie-import-browser module has 30+ thorough
// unit tests in browse/test/cookie-import-browser.test.ts (decryption, profile
// detection, error handling, path traversal). The E2E just tested LLM instruction-
// following ("write a file saying no browsers") on a CI box with no browsers.

// Removed: gstack-upgrade E2E ('gstack-upgrade-happy-path').
//
// /gstack-upgrade was CUT in a9399ad3 — there is no
// skills/*/references/legacy/gstack-upgrade.md and no skills/.compat/gstack-upgrade
// alias, so installLegacySkill('gstack-upgrade') correctly throws and the old
// gstack-upgrade/SKILL.md the test copied no longer exists. Nothing in the 2.0
// path executes an upgrade workflow.
//
// Coverage lost: the local-git upgrade happy path (fetch + reset --hard
// origin/main against a bare remote, run ./setup, surface CHANGELOG deltas) has
// no E2E assertion. The mechanics now live in runtime/upgrade.js and
// runtime/migrations.js and are covered, if at all, by their own unit tests —
// nothing verifies the end-to-end sequence.
//
// Its E2E_TOUCHFILES + E2E_TIERS entries in test/helpers/touchfiles.ts (already
// flagged there as a known hole) are now orphaned and need removing by whoever
// owns that file.

// --- Test Coverage Audit E2E ---

describeIfSelected('Test Coverage Audit E2E', ['ship-coverage-audit'], () => {
  let coverageDir: string;

  beforeAll(() => {
    coverageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-coverage-'));

    // /ship is a LIVE dispatcher with no compat alias — install its tree at
    // skills/ship/, never flattened: SKILL.md addresses references/... relatively,
    // and the coverage audit is a lazy phase reached through
    // references/legacy/ship.md → references/sections/ship/test-coverage.md.
    //
    // The 1.x copy of the `review` skill alongside it is dropped: under 2.0 the
    // pre-landing and adversarial review passes are sections INSIDE the ship tree
    // (references/sections/ship/review-army.md, greptile.md, adversarial.md), and
    // this prompt skips them anyway.
    const shipSrc = path.join(ROOT, 'skills', 'ship');
    if (!fs.existsSync(path.join(shipSrc, 'references', 'sections', 'ship', 'test-coverage.md'))) {
      throw new Error(
        'ship-coverage-audit fixture: skills/ship/references/sections/ship/test-coverage.md ' +
          'is missing — the step under test has moved or been cut. Fix the fixture, do not skip.',
      );
    }
    copyDirSync(shipSrc, path.join(coverageDir, 'skills', 'ship'));

    // Create a Node.js project WITH test framework but coverage gaps
    fs.writeFileSync(path.join(coverageDir, 'package.json'), JSON.stringify({
      name: 'test-coverage-app',
      version: '1.0.0',
      type: 'module',
      scripts: { test: 'echo "no tests yet"' },
      devDependencies: { vitest: '^1.0.0' },
    }, null, 2));

    // Create vitest config
    fs.writeFileSync(path.join(coverageDir, 'vitest.config.ts'),
      `import { defineConfig } from 'vitest/config';\nexport default defineConfig({ test: {} });\n`);

    fs.writeFileSync(path.join(coverageDir, 'VERSION'), '0.1.0.0\n');
    fs.writeFileSync(path.join(coverageDir, 'CHANGELOG.md'), '# Changelog\n');

    // Create source file with multiple code paths
    fs.mkdirSync(path.join(coverageDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(coverageDir, 'src', 'billing.ts'), `
export function processPayment(amount: number, currency: string) {
  if (amount <= 0) throw new Error('Invalid amount');
  if (currency !== 'USD' && currency !== 'EUR') throw new Error('Unsupported currency');
  return { status: 'success', amount, currency };
}

export function refundPayment(paymentId: string, reason: string) {
  if (!paymentId) throw new Error('Payment ID required');
  if (!reason) throw new Error('Reason required');
  return { status: 'refunded', paymentId, reason };
}
`);

    // Create a test directory with ONE test (partial coverage)
    fs.mkdirSync(path.join(coverageDir, 'test'), { recursive: true });
    fs.writeFileSync(path.join(coverageDir, 'test', 'billing.test.ts'), `
import { describe, test, expect } from 'vitest';
import { processPayment } from '../src/billing';

describe('processPayment', () => {
  test('processes valid payment', () => {
    const result = processPayment(100, 'USD');
    expect(result.status).toBe('success');
  });
  // GAP: no test for invalid amount
  // GAP: no test for unsupported currency
  // GAP: refundPayment not tested at all
});
`);

    // Init git repo with main branch
    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: coverageDir, stdio: 'pipe', timeout: 5000 });
    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial commit']);

    // Create feature branch
    run('git', ['checkout', '-b', 'feature/billing']);
  });

  afterAll(() => {
    try { fs.rmSync(coverageDir, { recursive: true, force: true }); } catch {}
  });

  testConcurrentIfSelected('ship-coverage-audit', async () => {
    const result = await runSkillTest({
      prompt: `The GStack ship dispatcher is installed at skills/ship/SKILL.md (there is no
skill registry in this directory — use that literal path). Its Prepare mode loads
skills/ship/references/legacy/ship.md, whose "Lazy specialist phase: test-coverage"
points at skills/ship/references/sections/ship/test-coverage.md.

Read skills/ship/references/sections/ship/test-coverage.md and run ONLY that step
(Step 7: Test Coverage Audit).

You are on the feature/billing branch. The base branch is main.
This is a test project — there is no remote, no PR to create.

Skip all other ship steps (tests, evals, review, version, changelog, commit, push, PR).
Do NOT dispatch this step as a subagent — run it inline and print the result.

The source code is in ${coverageDir}/src/billing.ts.
Existing tests are in ${coverageDir}/test/billing.test.ts.
The test command is: echo "tests pass" (mocked — just pretend tests pass).

Produce the ASCII coverage diagram showing which code paths are tested and which have gaps.
Do NOT generate new tests — just produce the diagram and coverage summary.
Output the diagram directly.`,
      workingDirectory: coverageDir,
      maxTurns: 15,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
      timeout: 120_000,
      testName: 'ship-coverage-audit',
      runId,
    });

    logCost('/ship coverage audit', result);
    recordE2E(evalCollector, '/ship Step 3.4 coverage audit', 'Test Coverage Audit E2E', result, {
      passed: result.exitReason === 'success',
    });

    expect(result.exitReason).toBe('success');

    // Check output contains coverage diagram elements
    const output = result.output || '';
    const hasGap = output.includes('GAP') || output.includes('gap') || output.includes('NO TEST');
    const hasTested = output.includes('TESTED') || output.includes('tested') || output.includes('✓');
    const hasCoverage = output.includes('COVERAGE') || output.includes('coverage') || output.includes('paths tested');

    console.log(`Output has GAP markers: ${hasGap}`);
    console.log(`Output has TESTED markers: ${hasTested}`);
    console.log(`Output has coverage summary: ${hasCoverage}`);

    // At minimum, the agent should have read the source and test files
    const readCalls = result.toolCalls.filter(tc => tc.tool === 'Read');
    expect(readCalls.length).toBeGreaterThan(0);
  }, 180_000);
});

// --- Codex skill E2E ---

describeIfSelected('Codex skill E2E', ['codex-review'], () => {
  let codexDir: string;
  let codexRoute: LegacyRoute;

  beforeAll(() => {
    codexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-codex-'));

    // /codex is retired: the compat alias dispatches to
    // `$review --mode Deep --module codex`. Install alias + review dispatcher;
    // throws if the alias, the dispatcher, or the module is missing.
    codexRoute = installLegacySkill(codexDir, 'codex');

    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: codexDir, stdio: 'pipe', timeout: 5000 });

    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);

    // Commit a clean base on main
    fs.writeFileSync(path.join(codexDir, 'app.rb'), '# clean base\nclass App\nend\n');
    run('git', ['add', 'app.rb']);
    run('git', ['commit', '-m', 'initial commit']);

    // Create feature branch with vulnerable code (reuse review fixture)
    run('git', ['checkout', '-b', 'feature/add-vuln']);
    const vulnContent = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'review-eval-vuln.rb'), 'utf-8');
    fs.writeFileSync(path.join(codexDir, 'user_controller.rb'), vulnContent);
    run('git', ['add', 'user_controller.rb']);
    run('git', ['commit', '-m', 'add vulnerable controller']);

    // Extract only the review-relevant prefix of the preserved codex module
    // (~333 of 919 lines). The whole module is ~14K tokens — 8 Read calls to
    // consume, which exhausts the turn budget before codex ever runs.
    //
    // Slice from the top rather than from the title: everything above it
    // (runtime bindings, Step 0 platform + base-branch detection, the binary /
    // auth / portable-root probes) is what Review Mode actually needs. One end
    // marker, and it THROWS when it stops resolving — the old two-marker version
    // fell back to `start >= 0 ? start : 0` and `end > start ? end : undefined`,
    // which quietly degrades to "whole file" or "" instead of failing.
    const modulePath = path.join(
      ROOT, 'skills', codexRoute.dispatcher, 'references', 'legacy', `${codexRoute.module}.md`,
    );
    const full = fs.readFileSync(modulePath, 'utf-8');
    const endMarker = '## Plan File Review Report';
    const end = full.indexOf(endMarker);
    if (end <= 0) {
      throw new Error(
        `codex fixture: marker "${endMarker}" no longer resolves in ${modulePath}. ` +
          `Silently slicing the whole file (or "") would make every assertion below vacuous.`,
      );
    }
    fs.writeFileSync(path.join(codexDir, 'codex-SKILL.md'), full.slice(0, end));
  });

  afterAll(() => {
    try { fs.rmSync(codexDir, { recursive: true, force: true }); } catch {}
  });

  testConcurrentIfSelected('codex-review', async () => {
    // Check codex is available — skip if not installed
    const codexCheck = spawnSync('which', ['codex'], { stdio: 'pipe', timeout: 3000 });
    if (codexCheck.status !== 0) {
      console.warn('codex CLI not installed — skipping E2E test');
      return;
    }

    const result = await runSkillTest({
      prompt: `You are in a git repo on branch feature/add-vuln with changes against main.
Read codex-SKILL.md — it is the Review Mode portion of the \`${codexRoute.invocation}\`
module, extracted so you don't have to read the whole thing.
Follow those instructions to run codex review against the diff on this branch.
Write the full output (including the GATE verdict) to ${codexDir}/codex-output.md`,
      workingDirectory: codexDir,
      maxTurns: 25,
      timeout: 300_000,
      testName: 'codex-review',
      runId,
      model: 'claude-opus-4-7',
    });

    logCost('/codex review', result);
    recordE2E(evalCollector, '/codex review', 'Codex skill E2E', result);
    expect(result.exitReason).toBe('success');

    // The output file IS the assertion. The old `if (fs.existsSync(...))` guard
    // meant an agent that wrote nothing passed the content check by skipping it.
    const output = requireReportArtifact(path.join(codexDir, 'codex-output.md'));
    // Should contain the CODEX SAYS header or GATE verdict
    const hasCodexOutput = output.includes('CODEX') || output.includes('GATE') || output.includes('codex');
    expect(hasCodexOutput, `codex-output.md has no CODEX/GATE verdict:\n${output.slice(0, 500)}`).toBe(true);
  }, 360_000);
});

// Module-level afterAll — finalize eval collector after all tests complete
afterAll(async () => {
  await finalizeEvalCollector(evalCollector);
});
