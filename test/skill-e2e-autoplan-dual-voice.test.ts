import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, runId, evalsEnabled,
  describeIfSelected, logCost, recordE2E,
  copyDirSync, installLegacySkill,
  createEvalCollector, finalizeEvalCollector,
} from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// E2E for /autoplan's dual-voice (Claude subagent + Codex). Periodic tier:
// non-deterministic, costs ~$1/run, not a gate. The purpose is to catch
// regressions where one of the two voices fails silently post-hardening.

const evalCollector = createEvalCollector('e2e-autoplan-dual-voice');

describeIfSelected('Autoplan dual-voice E2E', ['autoplan-dual-voice'], () => {
  let workDir: string;
  let planPath: string;
  let route: ReturnType<typeof installLegacySkill>;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-autoplan-dv-'));

    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: workDir, stdio: 'pipe', timeout: 10000 });

    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(workDir, 'README.md'), '# test repo\n');
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);

    // Install /autoplan the way a user reaches it today: the compat alias under
    // its old name, plus the plan dispatcher it routes into. The five 1.x trees
    // this used to copy (autoplan/, plan-ceo-review/, plan-eng-review/,
    // plan-design-review/, plan-devex-review/) are all gone.
    //
    // The four separate review-skill copies collapse into the dispatcher copy:
    // the autoplan module's "Load skill files from disk" step now names
    // `references/legacy/plan-ceo-review.md`, `plan-eng-review.md`, and
    // `plan-devex-review.md`, all of which installLegacySkill already puts on
    // disk under skills/plan/.
    //
    // plan-design-review is NOT restored. It has no compat alias, and the
    // shipped autoplan module retired it in place — the load list reads "the
    // retired plan design phase (removed from the five public skills; skip it)"
    // and the sequencing rule is "CEO → Eng → DX". No assertion in this file
    // ever named the design voice, so this drops dead fixture setup, not a check.
    route = installLegacySkill(workDir, 'autoplan');

    // `Full chain` is two words, so installLegacySkill's route regex stops at
    // `Full` and reports no --module (the alias is `$plan --mode Full chain
    // --module autoplan`). Resolve the module ourselves and fail loudly if it
    // dangles, rather than letting the test run against a missing specialist.
    const moduleName = route.module ?? 'autoplan';
    const modulePath = path.join(ROOT, 'skills', route.dispatcher, 'references', 'legacy', `${moduleName}.md`);
    if (!fs.existsSync(modulePath)) {
      throw new Error(`autoplan-dual-voice: no preserved module at ${modulePath}. Dangling route.`);
    }

    // Register as project-level skills. The workdir copies above are NOT enough
    // on their own: claude -p only discovers skills under .claude/skills/, and an
    // unregistered slash command short-circuits with "Unknown command: /autoplan"
    // (0 turns, ~1s) on claude >= 2.x — the model never runs, so both voice
    // assertions fail. Same install pattern as installSkills() in
    // skill-routing-e2e.test.ts, with one addition: the plan dispatcher is
    // registered as a whole directory, not a lone SKILL.md, because the alias
    // dispatches to `$plan` and the dispatcher reads its own references/ tree.
    const skillsBase = path.join(workDir, '.claude', 'skills');
    fs.mkdirSync(path.join(skillsBase, 'autoplan'), { recursive: true });
    fs.copyFileSync(
      path.join(ROOT, 'skills', '.compat', 'autoplan', 'SKILL.md'),
      path.join(skillsBase, 'autoplan', 'SKILL.md'),
    );
    copyDirSync(path.join(ROOT, 'skills', route.dispatcher), path.join(skillsBase, route.dispatcher));

    // Write a tiny plan file for /autoplan to review.
    planPath = path.join(workDir, 'TEST_PLAN.md');
    fs.writeFileSync(planPath, `# Test Plan: add /greet skill

## Context
Add a new /greet skill that prints a welcome message.

## Scope
- Create greet/SKILL.md with a simple "hello" flow
- Add to gen-skill-docs pipeline
- One unit test
`);
  });

  afterAll(() => {
    finalizeEvalCollector(evalCollector);
    if (workDir && fs.existsSync(workDir)) {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  // Skip entirely unless evals enabled (periodic tier).
  test.skipIf(!evalsEnabled)(
    'both Claude + Codex voices produce output in Phase 1 (within timeout)',
    async () => {
      // Fire /autoplan with a 10-min hard timeout on the spawn itself.
      // The skill itself has 10-min phase timeouts + auth-gate failfast.
      // If Codex is unavailable on the test machine, the skill should print
      // [codex-unavailable] and still complete the Claude subagent half.
      // Budget note: 5 min / 30 turns was enough at v1.0-era skill sizes, but
      // the full-depth Phase 1 (registered skill + CEO review subagent) now
      // needs longer — at 300s the run was killed mid-CEO-review with both
      // voices already fired but no Phase-1-complete marker yet. Raised again
      // (600s/40 turns → 900s/50 turns) for the 2.0 routing depth: /autoplan is
      // a compat alias now, so before Phase 0.5 even starts the agent reads the
      // alias, skills/plan/SKILL.md, SHARED-JUDGMENT.md + AUTHORITY-POLICY.md,
      // and the 1072-line autoplan module — where 1.x landed it in autoplan/SKILL.md
      // on the first read. Assertion thresholds are unchanged.
      const result = await runSkillTest({
        testName: 'autoplan-dual-voice',
        workingDirectory: workDir,
        prompt: `/autoplan ${planPath}

The /autoplan skill is a routing alias. Follow its dispatch (\`${route.invocation} chain --module autoplan\`)
into .claude/skills/${route.dispatcher}/SKILL.md and read that dispatcher's
references/legacy/autoplan.md module — \`$${route.dispatcher}\` is a placeholder, not a
resolvable command name, so use the path.`,
        timeout: 900_000, // 15 min
        // /autoplan spawns subagents and calls codex via Bash; it needs the
        // full tool set to get past Phase 1. Bash+Read+Write alone wasn't
        // enough — the skill stalled trying to invoke Agent/Skill.
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Agent', 'Skill'],
        maxTurns: 50,
        runId,
      });

      // Accept EITHER outcome as success:
      //   (a) Both voices produced output (ideal case)
      //   (b) Codex unavailable + Claude voice produced output (graceful degrade)
      // Search ONLY the tool-call structure — NOT the prompt string that went in.
      // Matching against full transcript is risky because the prompt itself
      // contains "plan-ceo-review" and other marker strings that would produce
      // false positives regardless of skill behavior. Filter to tool_result
      // content + assistant messages emitted DURING execution.
      const transcript = Array.isArray(result.transcript) ? result.transcript : [];
      // The transcript holds RAW stream-json events: tool_use blocks live
      // INSIDE assistant events' message.content, and tool_results inside
      // user events — no top-level entry ever has type 'tool_use'. Filtering
      // on that shape matched nothing, silently reducing `out` to
      // result.output alone, so a run killed at the spawn timeout (no result
      // event) had NOTHING to match and every assertion failed.
      const executionContent = transcript
        .filter((entry: any) => entry && (entry.type === 'assistant' || entry.type === 'user'))
        .map((entry: any) => JSON.stringify(entry))
        .join('\n');
      const out = (result.output ?? '') + '\n' + executionContent;

      // Claude voice: require evidence of a dispatched Agent subagent, not
      // merely the literal string "Agent(" (which could appear in any text).
      // Task/Agent tool_use entries have name:"Agent" or subagent_type:"..."
      const claudeVoiceFired = /"name":\s*"Agent"|"subagent_type":\s*"[^"]/.test(out) ||
                               /Claude\s+(CEO|subagent)\s+(review|complete|finished)|claude-subagent\s/i.test(out);
      // Codex voice: require evidence of codex CLI invocation (command string in
      // a Bash tool_use), not prompt-text mentions.
      const codexVoiceFired = /"command":\s*"[^"]*codex\s+(exec|review)/.test(out) ||
                              /CODEX SAYS\s*\(/i.test(out);
      // Unavailable markers: the exact probe-failure strings the shipped Phase 0.5
      // preflight emits. Re-pinned against skills/plan/references/legacy/autoplan.md
      // — it prints `[codex-unavailable: binary not found]`,
      // `[codex-unavailable: auth missing]`, and `[codex disabled by config — ...]`.
      // The old alternation required a literal `[codex-unavailable]` with the
      // bracket closing immediately, plus three strings (CODEX_NOT_AVAILABLE,
      // codex_cli_missing, "Codex CLI not found") that appear nowhere in the
      // shipped tree, so every real degradation path failed to match and forced
      // the run to prove codexVoiceFired instead. This narrows to what ships; it
      // does not loosen what counts as the codex voice actually firing.
      const codexUnavailable = /\[codex-unavailable[:\]]|\[codex disabled by config|AUTH_FAILED\b/i.test(out);

      expect(claudeVoiceFired).toBe(true);
      expect(codexVoiceFired || codexUnavailable).toBe(true);

      // Hang protection: require pipeline-progress evidence, not name mentions.
      // Full Phase 1 COMPLETION (three parallel review subagents, each loading a
      // 25-35K-token skill) routinely exceeds 10 minutes on sonnet, so requiring
      // the "Phase 1 complete" banner would force a 20-minute test for no extra
      // dual-voice signal. Accept EITHER the completion banner (the
      // "**PHASE 1 COMPLETE.**" mandatory output in
      // skills/plan/references/legacy/autoplan.md) OR structural evidence that the
      // Phase 1 review dispatch actually happened: an Agent tool_use whose input
      // carries review instructions (execution artifact built by the skill, not
      // an echo of our prompt).
      const reachedPhase1 = /Phase\s+1\s+(complete|done|finished)|CEO\s+Review\s+(complete|done|approved)|Strategy\s*&\s*Scope\s+(complete|done)|Phase\s+2\s+(started|begin)/i.test(out);
      const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls : [];
      const reviewDispatched = toolCalls.some((tc: any) =>
        (tc?.tool === 'Agent' || tc?.tool === 'Task') &&
        /review|ceo|eng manager|strategy/i.test(JSON.stringify(tc?.input ?? {})));
      expect(reachedPhase1 || reviewDispatched).toBe(true);

      logCost('autoplan-dual-voice', result);
      recordE2E(evalCollector, 'autoplan-dual-voice', 'Autoplan dual-voice E2E', result, {
        passed: claudeVoiceFired && (codexVoiceFired || codexUnavailable) && (reachedPhase1 || reviewDispatched),
      });
    },
    960_000, // per-test timeout slightly > spawn timeout so cleanup can run
  );
});
