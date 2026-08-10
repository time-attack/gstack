import { beforeAll, afterAll, expect } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, runId,
  describeIfSelected, testConcurrentIfSelected,
  copyDirSync, installLegacySkill, logCost, recordE2E,
  createEvalCollector, finalizeEvalCollector,
} from './helpers/e2e-helpers';
import type { LegacyRoute } from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e-plan-tune');

// ---------------------------------------------------------------------------
// /plan-tune E2E: verify the skill recognizes plain-English intent and hits
// the right binary paths without CLI subcommand syntax.
//
// This is a gate-tier test — if /plan-tune requires memorized subcommands or
// fails on plain English, that is a regression of the core v1 DX promise.
// ---------------------------------------------------------------------------

describeIfSelected('PlanTune E2E', ['plan-tune-inspect'], () => {
  let workDir: string;
  let gstackHome: string;
  let route: LegacyRoute;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-plan-tune-'));
    gstackHome = path.join(workDir, '.gstack-home');

    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: workDir, stdio: 'pipe', timeout: 5000 });
    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(workDir, 'README.md'), '# test\n');
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);

    // The 1.x `plan-tune/` monolith is gone. A user who types /plan-tune now
    // lands on the compat alias, which routes to $plan --mode Discovery
    // --module plan-tune. Install that whole path so this test exercises what
    // actually ships. The alias still lands at ./plan-tune/SKILL.md.
    route = installLegacySkill(workDir, 'plan-tune');

    // The module binds GSTACK_BIN="$GSTACK_HOME/bin" and reads its helpers from
    // there, so the fixture mirrors the real managed-runtime layout instead of
    // asking the agent to rewrite paths. The bins are thin adapters that import
    // ../runtime/*.js, so runtime/ has to come along or every one of them dies
    // with ERR_MODULE_NOT_FOUND.
    const homeBin = path.join(gstackHome, 'bin');
    const homeScripts = path.join(gstackHome, 'scripts');
    fs.mkdirSync(homeBin, { recursive: true });
    fs.mkdirSync(homeScripts, { recursive: true });
    copyDirSync(path.join(ROOT, 'runtime'), path.join(gstackHome, 'runtime'));
    for (const script of [
      'gstack-slug',
      'gstack-config',
      'gstack-question-log',
      'gstack-question-preference',
      'gstack-developer-profile',
      'gstack-builder-profile',
    ]) {
      const src = path.join(ROOT, 'bin', script);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(homeBin, script));
        fs.chmodSync(path.join(homeBin, script), 0o755);
      }
    }

    // gstack-developer-profile resolves scripts/ relative to its own parent dir.
    for (const src of ['question-registry.ts', 'psychographic-signals.ts', 'archetypes.ts', 'one-way-doors.ts']) {
      fs.copyFileSync(path.join(ROOT, 'scripts', src), path.join(homeScripts, src));
    }

    // The module keys project state on PROJECT_ID from gstack-slug, not on a
    // basename slug. Ask the real binary rather than reimplementing its hash —
    // guess wrong and the seeded log is invisible, which reads as NO_LOG and
    // quietly turns this test into a check that the agent can improvise.
    const slugOut = spawnSync(path.join(ROOT, 'bin', 'gstack-slug'), [], {
      cwd: workDir, encoding: 'utf-8', timeout: 10_000,
    }).stdout || '';
    const projectId = (slugOut.match(/^PROJECT_ID=(.+)$/m)?.[1] || '').trim();
    expect(projectId, `gstack-slug emitted no PROJECT_ID:\n${slugOut}`).toBeTruthy();

    // Seed a few question-log entries so "review questions" has something to show.
    const projectDir = path.join(gstackHome, 'projects', projectId);
    fs.mkdirSync(projectDir, { recursive: true });
    const entries = [
      {
        ts: '2026-04-10T10:00:00Z',
        skill: 'plan-ceo-review',
        question_id: 'plan-ceo-review-mode',
        question_summary: 'Which review mode?',
        category: 'routing',
        door_type: 'two-way',
        options_count: 4,
        user_choice: 'expand',
        recommended: 'selective',
        followed_recommendation: false,
        session_id: 's1',
      },
      {
        ts: '2026-04-11T10:00:00Z',
        skill: 'ship',
        question_id: 'ship-test-failure-triage',
        question_summary: 'Test failed',
        category: 'approval',
        door_type: 'one-way',
        options_count: 3,
        user_choice: 'fix-now',
        recommended: 'fix-now',
        followed_recommendation: true,
        session_id: 's2',
      },
      {
        ts: '2026-04-12T10:00:00Z',
        skill: 'ship',
        question_id: 'ship-changelog-voice-polish',
        question_summary: 'Polish changelog voice',
        category: 'approval',
        door_type: 'two-way',
        options_count: 2,
        user_choice: 'skip',
        recommended: 'accept',
        followed_recommendation: false,
        session_id: 's3',
      },
    ];
    fs.writeFileSync(
      path.join(projectDir, 'question-log.jsonl'),
      entries.map((e) => JSON.stringify(e)).join('\n') + '\n',
    );

    // Pre-set question_tuning=true so the skill doesn't enter the first-time setup flow.
    fs.mkdirSync(gstackHome, { recursive: true });
    fs.writeFileSync(path.join(gstackHome, 'config.yaml'), 'question_tuning: true\n');

    // Step 0's setup gate fires on question_tuning=true + empty declared profile +
    // a missing marker, and it runs the 5-Q setup through AskUserQuestion — which
    // this prompt forbids. 1.x read that marker from a literal ~/.gstack, so the
    // operator's real home usually suppressed it; the host-neutral module reads
    // "${GSTACK_HOME:-$HOME/.gstack}", which now points inside this fixture where
    // nothing exists. Seed the marker: this test's user is an established one
    // reviewing their log, not a first-timer.
    fs.writeFileSync(path.join(gstackHome, '.declared-setup-prompted'), '');
  });

  afterAll(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    finalizeEvalCollector(evalCollector);
  });

  // -------------------------------------------------------------------------
  // Plain-English intent: "review my questions"
  // -------------------------------------------------------------------------
  testConcurrentIfSelected('plan-tune-inspect', async () => {
    const result = await runSkillTest({
      prompt: `Read ./plan-tune/SKILL.md. It is a compatibility alias that routes to
\`${route.invocation}\`. Follow that route: the specialist workflow lives in
skills/${route.dispatcher}/references/legacy/${route.module}.md — read that module and work from it.

The user has invoked /plan-tune and says: "Review the questions I've been asked recently."

IMPORTANT:
- Use GSTACK_HOME="${gstackHome}" as an environment variable for all bin calls.
  The module's own runtime bindings resolve GSTACK_BIN from GSTACK_HOME, and the
  helper binaries are already installed there. Do NOT rewrite the module's bin paths.
- Do NOT use AskUserQuestion.
- Do NOT implement code changes.
- Route the user's intent to the right section of the module (Review question log).
- Show them the logged questions with counts and the follow/override ratio.`,
      workingDirectory: workDir,
      maxTurns: 15,
      allowedTools: ['Bash', 'Read', 'Grep', 'Glob'],
      timeout: 120_000,
      testName: 'plan-tune-inspect',
      runId,
    });

    logCost('/plan-tune review', result);

    const output = result.output.toLowerCase();

    // Agent must have surfaced at least 2 of the 3 logged question_ids
    const mentionsCEO = output.includes('plan-ceo-review-mode') || output.includes('review mode');
    const mentionsShipTest = output.includes('ship-test-failure-triage') || output.includes('test failed');
    const mentionsChangelog = output.includes('changelog') || output.includes('ship-changelog-voice-polish');
    const foundCount = [mentionsCEO, mentionsShipTest, mentionsChangelog].filter(Boolean).length;

    // Agent should note override behavior (user overrode CEO review and changelog polish)
    const noticedOverride =
      output.includes('overrid') ||
      output.includes('skip') ||
      output.includes('expand');

    const exitOk = ['success', 'error_max_turns'].includes(result.exitReason);

    recordE2E(evalCollector, '/plan-tune', 'Plan-tune inspection flow (plain English)', result, {
      passed: exitOk && foundCount >= 2,
    });

    expect(exitOk).toBe(true);
    expect(foundCount).toBeGreaterThanOrEqual(2);

    if (!noticedOverride) {
      console.warn('Agent did not surface override/skip behavior from the log');
    }
  }, 180_000);
});
