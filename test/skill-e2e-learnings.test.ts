import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, runId,
  describeIfSelected, testConcurrentIfSelected,
  installLegacySkill, logCost, recordE2E,
  createEvalCollector, finalizeEvalCollector,
} from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e-learnings');

// --- Learnings E2E: seed learnings, run /learn, verify output ---

describeIfSelected('Learnings E2E', ['learnings-show'], () => {
  let workDir: string;
  let gstackHome: string;
  let route: ReturnType<typeof installLegacySkill>;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-learnings-'));
    gstackHome = path.join(workDir, '.gstack-home');

    // Init git repo
    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: workDir, stdio: 'pipe', timeout: 5000 });
    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(workDir, 'app.ts'), 'console.log("hello");\n');
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);

    // Install /learn the way a user reaches it today: the compat alias under its
    // old name, plus the plan dispatcher it routes into. The 1.x `learn/` tree at
    // the repo root is gone; this is the only path a user has.
    route = installLegacySkill(workDir, 'learn');

    // Install the managed runtime bundle where the shipped module looks for it:
    // $GSTACK_HOME/bin. The module's own bash blocks bind `GSTACK_BIN="$GSTACK_HOME/bin"`
    // and call `$GSTACK_BIN/gstack-slug` + `$GSTACK_BIN/gstack-learnings-search`.
    //
    // Symlinked, not cherry-picked. `bin/gstack-slug` imports `../runtime/identity.js`,
    // so copying three scripts into a bare directory leaves the runtime behind and
    // gstack-slug dies with ERR_MODULE_NOT_FOUND — silently, because the module runs
    // it as `eval "$(... 2>/dev/null)"`, and then gstack-learnings-search trips its own
    // `${PROJECT_ID:?}` guard and the module prints "No learnings yet."
    // fs.rmSync in afterAll unlinks the symlink; it does not descend into ROOT/bin.
    fs.mkdirSync(gstackHome, { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'bin'), path.join(gstackHome, 'bin'));

    // Seed learnings JSONL into the bucket gstack-learnings-search actually reads:
    // `$GSTACK_HOME/projects/$PROJECT_ID/learnings.jsonl`. PROJECT_ID is a
    // worktree-stable HASH, not basename(workDir). Seeding the basename put the
    // fixture in a bucket nothing reads: the module's flow does not pass
    // --cross-project, so the other-projects scan never runs, and a missing
    // LEARNINGS_FILE makes the search `exit 0` SILENTLY — not even the module's
    // `|| echo "No learnings yet."` fallback fires. Ask the binary, don't guess.
    const slugOut = spawnSync(path.join(gstackHome, 'bin', 'gstack-slug'), [], {
      cwd: workDir,
      env: { ...process.env, GSTACK_HOME: gstackHome },
      stdio: 'pipe',
      timeout: 15000,
    });
    const projectId = (slugOut.stdout?.toString() || '').match(/^PROJECT_ID=(.+)$/m)?.[1];
    if (!projectId) {
      throw new Error(
        `gstack-slug emitted no PROJECT_ID (exit ${slugOut.status}). ` +
          `The seeded learnings would have no bucket to land in.\n${slugOut.stderr?.toString() || ''}`,
      );
    }
    const projectDir = path.join(gstackHome, 'projects', projectId);
    fs.mkdirSync(projectDir, { recursive: true });

    const learnings = [
      {
        skill: 'review', type: 'pattern', key: 'n-plus-one-queries',
        insight: 'ActiveRecord associations in loops cause N+1 queries. Always use includes/preload.',
        confidence: 9, source: 'observed', ts: new Date().toISOString(),
        files: ['app/models/user.rb'],
      },
      {
        skill: 'investigate', type: 'pitfall', key: 'stale-cache-after-deploy',
        insight: 'Redis cache not invalidated on deploy causes stale data for 5 minutes.',
        confidence: 7, source: 'observed', ts: new Date().toISOString(),
        files: ['config/redis.yml'],
      },
      {
        skill: 'ship', type: 'preference', key: 'always-run-rubocop',
        insight: 'User wants rubocop to run before every commit, no exceptions.',
        confidence: 10, source: 'user-stated', ts: new Date().toISOString(),
      },
      {
        skill: 'qa', type: 'operational', key: 'test-timeout-flag',
        insight: 'bun test requires --timeout 30000 for E2E tests in this project.',
        confidence: 9, source: 'observed', ts: new Date().toISOString(),
      },
    ];

    fs.writeFileSync(
      path.join(projectDir, 'learnings.jsonl'),
      learnings.map(l => JSON.stringify(l)).join('\n') + '\n',
    );
  });

  afterAll(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    finalizeEvalCollector(evalCollector);
  });

  testConcurrentIfSelected('learnings-show', async () => {
    const result = await runSkillTest({
      prompt: `Read the file learn/SKILL.md for instructions. It is a routing alias — follow its
dispatch (\`${route.invocation}\`) into skills/${route.dispatcher}/SKILL.md and read that
dispatcher's references/legacy/${route.module}.md module. There is no skill registry in
this directory, so \`$${route.dispatcher}\` is not resolvable by name — use those paths.

Run the module's "Show recent" flow (no arguments — show recent learnings).

IMPORTANT:
- Use GSTACK_HOME="${gstackHome}" as an environment variable when running bin scripts.
- The managed runtime is installed at $GSTACK_HOME/bin, which is exactly where the
  module's own bash blocks look (\`GSTACK_BIN="$GSTACK_HOME/bin"\`). No path
  substitution is needed.
- Do NOT use AskUserQuestion.
- Do NOT implement code changes.
- Just show the learnings and summarize what you found.`,
      workingDirectory: workDir,
      // Budget raised from 15 turns / 120s. The specialist is 3 reads away now
      // (alias → skills/plan/SKILL.md → references/legacy/learn.md) where the 1.x
      // tree put it 1 read away, and the dispatcher directs a read of
      // SHARED-JUDGMENT.md + AUTHORITY-POLICY.md before substantive work.
      maxTurns: 22,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob'],
      timeout: 240_000,
      testName: 'learnings-show',
      runId,
    });

    logCost('/learn show', result);

    const output = result.output.toLowerCase();

    // The agent should have found and displayed the seeded learnings
    const mentionsNPlusOne = output.includes('n-plus-one') || output.includes('n+1');
    const mentionsCache = output.includes('stale') || output.includes('cache');
    const mentionsRubocop = output.includes('rubocop');

    // At least 2 of 3 learnings should appear in the output
    const foundCount = [mentionsNPlusOne, mentionsCache, mentionsRubocop].filter(Boolean).length;

    const exitOk = ['success', 'error_max_turns'].includes(result.exitReason);

    recordE2E(evalCollector, '/learn', 'Learnings show E2E', result, {
      passed: exitOk && foundCount >= 2,
    });

    expect(exitOk).toBe(true);
    expect(foundCount).toBeGreaterThanOrEqual(2);

    if (foundCount === 3) {
      console.log('All 3 seeded learnings found in output');
    } else {
      console.warn(`Only ${foundCount}/3 learnings found (N+1: ${mentionsNPlusOne}, cache: ${mentionsCache}, rubocop: ${mentionsRubocop})`);
    }
  }, 300_000);
});
