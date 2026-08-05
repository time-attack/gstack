import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, runId, evalsEnabled,
  describeIfSelected, testConcurrentIfSelected,
  installLegacySkill, logCost, recordE2E,
  createEvalCollector, finalizeEvalCollector,
} from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e-session-intelligence');

// --- Session Intelligence E2E ---
// Tests the core contract: timeline events flow in, context recovery flows out,
// /context-save + /context-restore round-trip.

describeIfSelected('Session Intelligence E2E', [
  'timeline-event-flow', 'context-recovery-artifacts',
  'context-save-writes-file', 'context-restore-loads-latest',
], () => {
  let workDir: string;
  let gstackHome: string;
  let slug: string;

  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-session-intel-'));
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

    // Install the managed runtime bundle where the shipped skills look for it:
    // $GSTACK_HOME/bin (that is what `GSTACK_BIN` resolves to in every module's
    // host-neutral runtime bindings block).
    //
    // Symlinked, not hand-copied. `bin/gstack-slug` imports `../runtime/identity.js`,
    // so cherry-picking a few scripts into a bare directory leaves the runtime
    // behind and every identity-dependent binary dies with ERR_MODULE_NOT_FOUND —
    // which is silent, because callers run gstack-slug as `eval "$(... 2>/dev/null)"`
    // and then trip their own `${PROJECT_ID:?}` guard.
    // fs.rmSync in afterAll unlinks the symlink; it does not descend into ROOT/bin.
    fs.mkdirSync(gstackHome, { recursive: true });
    fs.symlinkSync(path.join(ROOT, 'bin'), path.join(gstackHome, 'bin'));

    // The local state bucket is keyed by PROJECT_ID — a worktree-stable hash, not
    // the directory basename (that changed when two repos sharing one GSTACK_HOME
    // stopped colliding in a single bucket). Ask the binary rather than guess.
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
          `Session-intelligence state has no bucket to land in.\n${slugOut.stderr?.toString() || ''}`,
      );
    }
    slug = projectId;
  });

  afterAll(() => {
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    finalizeEvalCollector(evalCollector);
  });

  // --- Test 1: Timeline event flow ---
  // Write a timeline event via gstack-timeline-log, read it back via gstack-timeline-read.
  // This is the foundational data flow test: events go in, they come back out.
  testConcurrentIfSelected('timeline-event-flow', async () => {
    // Own GSTACK_HOME. context-recovery-artifacts truncates timeline.jsonl in the
    // shared project bucket and runs concurrently with this test, so a shared home
    // makes the `lines.length === 2` assertion a coin flip.
    const timelineHome = path.join(workDir, '.gstack-timeline');
    const projectDir = path.join(timelineHome, 'projects', slug);
    fs.mkdirSync(projectDir, { recursive: true });

    // Write two events via the binary
    const logBin = path.join(gstackHome, 'bin', 'gstack-timeline-log');
    const readBin = path.join(gstackHome, 'bin', 'gstack-timeline-read');
    const env = { ...process.env, GSTACK_HOME: timelineHome };
    const opts = { cwd: workDir, env, stdio: 'pipe' as const, timeout: 10000 };

    spawnSync(logBin, [JSON.stringify({
      skill: 'review', event: 'started', branch: 'main', session: 'test-1',
    })], opts);
    spawnSync(logBin, [JSON.stringify({
      skill: 'review', event: 'completed', branch: 'main',
      outcome: 'success', duration_s: 120, session: 'test-1',
    })], opts);

    // Read via gstack-timeline-read
    const readResult = spawnSync(readBin, ['--branch', 'main'], opts);
    const readOutput = readResult.stdout?.toString() || '';

    // Verify timeline.jsonl exists and has content
    const timelinePath = path.join(projectDir, 'timeline.jsonl');
    expect(fs.existsSync(timelinePath)).toBe(true);

    const lines = fs.readFileSync(timelinePath, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);

    // Verify the events are valid JSON with expected fields
    const event1 = JSON.parse(lines[0]);
    expect(event1.skill).toBe('review');
    expect(event1.event).toBe('started');
    expect(event1.ts).toBeDefined();

    const event2 = JSON.parse(lines[1]);
    expect(event2.event).toBe('completed');
    expect(event2.outcome).toBe('success');

    // Verify gstack-timeline-read output includes the events
    expect(readOutput).toContain('review');

    recordE2E(evalCollector, 'timeline event flow', 'Session Intelligence E2E', {
      output: readOutput,
      exitReason: 'success',
      duration: 0,
      toolCalls: [],
      browseErrors: [],
      costEstimate: { inputChars: 0, outputChars: 0, estimatedTokens: 0, estimatedCost: 0, turnsUsed: 0 },
      transcript: [],
      model: 'direct',
      firstResponseMs: 0,
      maxInterTurnMs: 0,
    }, { passed: true });

    console.log(`Timeline flow: ${lines.length} events written, read output ${readOutput.length} chars`);
  }, 30_000);

  // --- Test 2: Context recovery with seeded artifacts ---
  // Seed CEO plans and timeline events, then run a skill and verify the preamble
  // outputs "RECENT ARTIFACTS" and "LAST_SESSION".
  testConcurrentIfSelected('context-recovery-artifacts', async () => {
    const projectDir = path.join(gstackHome, 'projects', slug);
    fs.mkdirSync(path.join(projectDir, 'ceo-plans'), { recursive: true });

    // Seed a CEO plan
    fs.writeFileSync(
      path.join(projectDir, 'ceo-plans', '2026-03-31-test-feature.md'),
      '---\nstatus: ACTIVE\n---\n# CEO Plan: Test Feature\nThis is a test plan.\n',
    );

    // Seed timeline with a completed event on main branch
    const timelineEntry = JSON.stringify({
      ts: new Date().toISOString(),
      skill: 'ship',
      event: 'completed',
      branch: 'main',
      outcome: 'success',
      duration_s: 60,
      session: 'prior-session',
    });
    fs.writeFileSync(path.join(projectDir, 'timeline.jsonl'), timelineEntry + '\n');

    // Install /learn the way a user reaches it today: the compat alias under its
    // old name, plus the dispatcher it routes into.
    const route = installLegacySkill(workDir, 'learn');

    const result = await runSkillTest({
      prompt: `Read the file learn/SKILL.md for instructions. It is a routing alias — follow its
dispatch (\`${route.invocation}\`) into skills/${route.dispatcher}/SKILL.md and read that
dispatcher's references/legacy/${route.module}.md module.

Run the context recovery check — the preamble should show recent artifacts.

IMPORTANT:
- Use GSTACK_HOME="${gstackHome}" as an environment variable when running bin scripts.
- The managed runtime is installed at $GSTACK_HOME/bin, which is exactly where the
  module's own bash blocks look (\`GSTACK_BIN="$GSTACK_HOME/bin"\`). No path
  substitution is needed.
- Do NOT use AskUserQuestion.
- Just run the preamble bash block and report what you see.
- Look for "RECENT ARTIFACTS" and "LAST_SESSION" in the output.`,
      workingDirectory: workDir,
      maxTurns: 10,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob'],
      timeout: 120_000,
      testName: 'context-recovery-artifacts',
      runId,
    });

    logCost('context recovery', result);

    const output = result.output.toLowerCase();

    // The preamble should have found the seeded artifacts
    const foundArtifacts = output.includes('recent artifacts') || output.includes('ceo-plans');
    const foundLastSession = output.includes('last_session') || output.includes('ship');
    const foundTimeline = output.includes('timeline') || output.includes('completed');

    // At least the CEO plan or timeline should be visible
    const foundCount = [foundArtifacts, foundLastSession, foundTimeline].filter(Boolean).length;

    const exitOk = ['success', 'error_max_turns'].includes(result.exitReason);

    recordE2E(evalCollector, 'context recovery', 'Session Intelligence E2E', result, {
      passed: exitOk && foundCount >= 1,
    });

    expect(exitOk).toBe(true);
    expect(foundCount).toBeGreaterThanOrEqual(1);

    console.log(`Context recovery: artifacts=${foundArtifacts}, lastSession=${foundLastSession}, timeline=${foundTimeline}`);
  }, 180_000);

  // --- Test 3: /context-save writes a file ---
  // Hand-feed the save section of context-save/SKILL.md to claude -p and verify
  // a file gets written to the project's checkpoints dir with valid frontmatter.
  testConcurrentIfSelected('context-save-writes-file', async () => {
    const projectDir = path.join(gstackHome, 'projects', slug);
    fs.mkdirSync(path.join(projectDir, 'checkpoints'), { recursive: true });

    // Install /context-save the way a user reaches it today (alias + dispatcher).
    const route = installLegacySkill(workDir, 'context-save');

    // Add a staged change so /context-save has something to capture
    fs.writeFileSync(path.join(workDir, 'feature.ts'), 'export function newFeature() { return true; }\n');
    spawnSync('git', ['add', 'feature.ts'], { cwd: workDir, stdio: 'pipe', timeout: 5000 });

    // Extract the save section from the preserved module the alias routes into
    // (before the List section).
    const modulePath = path.join(ROOT, 'skills', route.dispatcher, 'references', 'legacy', `${route.module}.md`);
    const full = fs.readFileSync(modulePath, 'utf-8');
    const saveStart = full.indexOf('## Save flow');
    const listStart = full.indexOf('## List flow');
    const saveSection = full.slice(saveStart, listStart > saveStart ? listStart : undefined);

    const result = await runSkillTest({
      prompt: `You are testing the /context-save skill. Follow these instructions to save a context file.

${saveSection.slice(0, 2000)}

IMPORTANT:
- Use GSTACK_HOME="${gstackHome}" as an environment variable when running bin scripts.
- The managed runtime is installed at $GSTACK_HOME/bin, which is exactly where the
  module's own bash blocks look (\`GSTACK_BIN="$GSTACK_HOME/bin"\`). No path
  substitution is needed.
- Save the file to ${projectDir}/checkpoints/ with a filename like "20260401-test-context.md".
- Include YAML frontmatter with status, branch, and timestamp.
- Include a summary of what's being worked on (you can see from git status).
- Do NOT use AskUserQuestion.`,
      workingDirectory: workDir,
      maxTurns: 10,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob'],
      timeout: 120_000,
      testName: 'context-save-writes-file',
      runId,
    });

    logCost('context-save', result);

    // Check that a context file was created
    const checkpointDir = path.join(projectDir, 'checkpoints');
    const files = fs.existsSync(checkpointDir)
      ? fs.readdirSync(checkpointDir).filter(f => f.endsWith('.md'))
      : [];

    const exitOk = ['success', 'error_max_turns'].includes(result.exitReason);
    const fileCreated = files.length > 0;

    let fileContent = '';
    if (fileCreated) {
      fileContent = fs.readFileSync(path.join(checkpointDir, files[0]), 'utf-8');
    }

    const hasYamlFrontmatter = fileContent.includes('---') && fileContent.includes('status:');
    const hasBranch = fileContent.includes('branch:') || fileContent.includes('main');

    recordE2E(evalCollector, 'context-save writes file', 'Session Intelligence E2E', result, {
      passed: exitOk && fileCreated && hasYamlFrontmatter,
    });

    expect(exitOk).toBe(true);
    expect(fileCreated).toBe(true);
    expect(hasYamlFrontmatter).toBe(true);

    console.log(`context-save: ${files.length} files created, YAML frontmatter: ${hasYamlFrontmatter}, branch: ${hasBranch}`);
  }, 180_000);

  // --- Test 4: /context-restore loads the newest file across branches ---
  // Seed two saved-context files with different YYYYMMDD-HHMMSS prefixes and
  // different branches in their frontmatter. Hand-feed the restore section to
  // claude -p. Verify the agent identifies the newer file (by filename prefix)
  // and presents its content, regardless of the current branch.
  testConcurrentIfSelected('context-restore-loads-latest', async () => {
    const projectDir = path.join(gstackHome, 'projects', slug);
    const checkpointDir = path.join(projectDir, 'checkpoints');
    fs.mkdirSync(checkpointDir, { recursive: true });

    // Install /context-restore the way a user reaches it today (alias + dispatcher).
    const route = installLegacySkill(workDir, 'context-restore');

    // Seed two files: older on branch-a (title "old-work"), newer on branch-b
    // (title "newer-wintermute-work"). Current branch (main) matches neither.
    const olderFile = path.join(checkpointDir, '20260101-120000-old-work.md');
    const newerFile = path.join(checkpointDir, '20260202-130000-newer-wintermute-work.md');
    fs.writeFileSync(olderFile, `---
status: in-progress
branch: branch-a
timestamp: 2026-01-01T12:00:00-07:00
---

## Working on: old work

### Summary
This is older work on branch-a.

### Remaining Work
1. Should NOT be loaded by default restore.
`);
    fs.writeFileSync(newerFile, `---
status: in-progress
branch: branch-b
timestamp: 2026-02-02T13:00:00-07:00
---

## Working on: newer wintermute work

### Summary
This is the newest saved context. Cross-branch restore should load THIS file.

### Remaining Work
1. Finish the wintermute integration.
`);

    // Deliberately scramble mtimes so filesystem mtime DISAGREES with filename
    // prefix — this proves we're using filename ordering, not ls -1t.
    const pastOlderMtime = Math.floor(Date.now() / 1000);       // now (newest mtime)
    const pastNewerMtime = pastOlderMtime - 60 * 60 * 24 * 30;  // 30 days ago
    fs.utimesSync(olderFile, pastOlderMtime, pastOlderMtime);
    fs.utimesSync(newerFile, pastNewerMtime, pastNewerMtime);

    // Extract the restore-flow section from the preserved module the alias routes into
    const modulePath = path.join(ROOT, 'skills', route.dispatcher, 'references', 'legacy', `${route.module}.md`);
    const full = fs.readFileSync(modulePath, 'utf-8');
    const restoreStart = full.indexOf('## Restore flow');
    const importantStart = full.indexOf('## Important Rules', restoreStart);
    const restoreSection = full.slice(restoreStart, importantStart > restoreStart ? importantStart : undefined);

    const result = await runSkillTest({
      prompt: `You are testing the /context-restore skill. Follow these instructions to restore the most recent saved context.

${restoreSection.slice(0, 2500)}

IMPORTANT:
- Use GSTACK_HOME="${gstackHome}" as an environment variable when running bin scripts.
- The managed runtime is installed at $GSTACK_HOME/bin, which is exactly where the
  module's own bash blocks look (\`GSTACK_BIN="$GSTACK_HOME/bin"\`).
- Look in ${checkpointDir} for saved context files.
- Current branch is "main" — do NOT filter by current branch. Load across all branches.
- The newest file by YYYYMMDD-HHMMSS prefix is the canonical "most recent". Filesystem mtime has been scrambled — do not use it.
- Do NOT use AskUserQuestion. Just present the content of the newest file.`,
      workingDirectory: workDir,
      maxTurns: 8,
      allowedTools: ['Bash', 'Read', 'Grep', 'Glob'],
      timeout: 120_000,
      testName: 'context-restore-loads-latest',
      runId,
    });

    logCost('context-restore', result);

    const output = result.output ?? '';
    const loadedNewer = output.includes('newer wintermute work') || output.includes('wintermute integration');
    const loadedOlder = output.includes('old work') && !output.includes('newer');
    const exitOk = ['success', 'error_max_turns'].includes(result.exitReason);

    recordE2E(evalCollector, 'context-restore loads latest', 'Session Intelligence E2E', result, {
      passed: exitOk && loadedNewer && !loadedOlder,
    });

    expect(exitOk).toBe(true);
    expect(loadedNewer).toBe(true);
    expect(loadedOlder).toBe(false);

    console.log(`context-restore: loadedNewer=${loadedNewer}, loadedOlder=${loadedOlder}`);
  }, 180_000);
});
