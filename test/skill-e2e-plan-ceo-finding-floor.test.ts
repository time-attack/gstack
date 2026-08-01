/**
 * /plan Product-mode AskUserQuestion floor regression (gate, paid, real-PTY).
 *
 * The floor: a seeded forcing finding must make the agent fire at least one
 * AskUserQuestion. Catches the May 2026 transcript bug where a plan review
 * wrote a multi-section review plan and called ExitPlanMode with zero
 * questions asked. See
 * `.context/attachments/pasted_text_2026-05-06_10-25-23.txt`.
 *
 * Surface: `/plan-ceo-review` is NOT a host command in GStack 2. It is an
 * internal specialist alias the dispatcher refines from the `Product` mode
 * (skills/plan/SKILL.md, "Internal specialist routing aliases"). This test
 * used to send `/plan-ceo-review` from the repo root, where the host answered
 * "Unknown command:" — so it exercised nothing. It now installs the canonical
 * `skills/plan` tree as a project skill in a scratch repo and invokes `/plan`,
 * letting dispatch route the pricing-plan seed to Product mode and its
 * mandatory `references/legacy/plan-ceo-review.md` module. The behavioral
 * floor asserted is unchanged.
 *
 * The scratch repo carries a README so the dispatcher's empty-target fast
 * path (references/FAST-PATH.md) does not fire and skip specialist phases.
 *
 * Tier: gate. Budget: 10 min (early exit on success ~30-90s typical).
 * Cost: ~$0.50-$1.50 per run depending on early-exit timing.
 */

import { afterAll, beforeAll, describe, test } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runPlanSkillFloorCheck } from './helpers/claude-pty-runner';
import { FORCING_FLOOR_CEO } from './fixtures/forcing-finding-seeds';

const ROOT = path.resolve(import.meta.dir, '..');

const shouldRun = !!process.env.EVALS && process.env.EVALS_TIER === 'gate';
const describeE2E = shouldRun ? describe : describe.skip;

describeE2E('/plan Product-mode AskUserQuestion floor (gate)', () => {
  let workDir: string;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-plan-ceo-floor-'));
    const git = (args: string[]) =>
      spawnSync('git', args, { cwd: workDir, stdio: 'pipe', timeout: 5000 });

    git(['init', '-b', 'main']);
    git(['config', 'user.email', 'test@test.com']);
    git(['config', 'user.name', 'Test']);
    fs.writeFileSync(
      path.join(workDir, 'README.md'),
      '# Devtool\n\nA developer tool with a paid plan.\n',
    );
    git(['add', '.']);
    git(['commit', '-m', 'initial']);

    // Register /plan as a real project-level slash command. Only
    // `.claude/skills/<name>/` is discovered by the host; without this the
    // PTY session answers "Unknown command:" and the run tests nothing.
    // The whole tree is copied because dispatch reads its modules from
    // `references/` on demand.
    fs.cpSync(
      path.join(ROOT, 'skills', 'plan'),
      path.join(workDir, '.claude', 'skills', 'plan'),
      { recursive: true },
    );
  });

  afterAll(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  test(
    'seeded forcing finding causes the agent to fire at least one AskUserQuestion',
    async () => {
      // No QUESTION_TUNING / EXPLAIN_LEVEL env: the GStack 2 tree reads those
      // through gstack-config, which never looked at env (TODOS.md P3). The
      // hermetic GSTACK_HOME already yields the defaults this test wants.
      const obs = await runPlanSkillFloorCheck({
        skillName: 'plan (Product mode -> ceo specialist)',
        slashCommand: '/plan',
        followUpPrompt: FORCING_FLOOR_CEO,
        cwd: workDir,
        timeoutMs: 600_000,
      });

      if (obs.outcome !== 'auq_observed') {
        throw new Error(
          `floor test FAILED: outcome=${obs.outcome} elapsed=${obs.elapsedMs}ms\n` +
            `summary: ${obs.summary}\n` +
            `If outcome is plan_ready or silent_write, this is the transcript-bug ` +
            `regression — the agent reached terminal without firing AskUserQuestion. See ` +
            `.context/attachments/pasted_text_2026-05-06_10-25-23.txt.\n` +
            `If outcome is exited with "unknown command", /plan was not discovered from ` +
            `${workDir}/.claude/skills/plan.\n` +
            `If outcome is timeout, the agent may just be slow — re-run or increase budget.\n` +
            `--- evidence (last 3KB) ---\n${obs.evidence}`,
        );
      }
    },
    660_000,
  );
});
