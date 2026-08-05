import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, runId, describeIfSelected, testConcurrentIfSelected,
  copyDirSync, logCost, recordE2E, createEvalCollector, finalizeEvalCollector,
  requireReportArtifact,
} from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e-review-army');

// ============================================================================
// THE REVIEW ARMY NO LONGER SHIPS. Read this before touching anything below.
//
// Every test in this file was built around `review/specialists/*.md` — seven
// checklists dispatched as subagents from a "Step 4.5 / Step 9.1-9.2 Specialist
// Dispatch". Nothing in that chain survives:
//
//   1. `review/specialists/{api-contract,data-migration,maintainability,
//      performance,red-team,security,testing}.md` were deleted with the 1.x
//      root tree (f19d6cda).
//   2. Their promised destination does NOT exist either.
//      `skills/review/references/ASSETS.md` lines 10-16 still map all seven to
//      `references/artifacts/review/specialists/<x>.md` as VERBATIM_PORT with
//      git blob hashes — and not one of those files is on disk. Dangling map.
//   3. `skills/review/references/legacy/review.md` has no Step 4.5. It goes
//      Step 4 (Critical pass) -> Step 5 (Fix-First). "Specialist" survives only
//      as log-schema prose that says "If no specialist pass was dispatched (as
//      in this module's default flow ...) use 10.0".
//   4. `skills/ship/references/sections/ship/review-army.md` keeps the NAME but
//      not the thing: it references "specialist review (Step 9.1-9.2)" twice
//      while containing Step 9 -> Confidence Calibration -> Step 9.3. Steps 9.1
//      and 9.2 are absent.
//   5. `skills/review/references/artifacts/review/checklist.md` settles it in
//      the severity table: "Every column is run by the reviewing agent. There
//      is no separate specialist pass." Pass 3 (SWEEP) absorbed Test Gaps,
//      Performance, Crypto, Dead Code, Magic Numbers, and Conditional Side
//      Effects for exactly this reason.
//
// So the fixtures below install the SHIPPED review dispatcher, and each prompt
// points at the surviving home of the judgment it used to exercise — or says
// plainly that there isn't one. Per-test provenance is in the comment on each
// describe block. Assertions are left at their original bar.
// ============================================================================

/**
 * Install the shipped review dispatcher at `<workDir>/skills/review/`.
 *
 * Replaces the old `copyReviewFiles`, which flattened review/SKILL.md,
 * checklist.md, greptile-triage.md and specialists/* into the workdir. A tree
 * copy is required now: the dispatcher lazily reads everything as
 * `references/...` relative to the skill root, so flat copies dead-end.
 */
function installDispatcher(workDir: string, name: string): string {
  const src = path.join(ROOT, 'skills', name);
  if (!fs.existsSync(src)) {
    throw new Error(`installDispatcher("${name}"): no dispatcher at skills/${name}/.`);
  }
  copyDirSync(src, path.join(workDir, 'skills', name));
  return `skills/${name}`;
}

/** Shared prompt preamble: how to reach the review judgment in the shipped tree. */
const DISPATCH_PREAMBLE = `Read skills/review/SKILL.md — the GStack review dispatcher.
Select the Normal mode, read the module it names (skills/review/references/legacy/review.md),
and read the checklist that module reads at skills/review/references/artifacts/review/checklist.md.
Resolve every other \`references/...\` path under skills/review/.

No gstack runtime is installed here, so skip the host-neutral runtime bindings block and
every optional \`$GSTACK_BIN\` helper, and skip the runtime, web-context, code-intelligence,
and third-party-action references — none apply in this sandbox.`;

// Helper: create a git repo with a feature branch
function setupRepo(prefix: string): { dir: string; run: (cmd: string, args: string[]) => void } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `skill-e2e-${prefix}-`));
  const run = (cmd: string, args: string[]) =>
    spawnSync(cmd, args, { cwd: dir, stdio: 'pipe', timeout: 5000 });
  run('git', ['init', '-b', 'main']);
  run('git', ['config', 'user.email', 'test@test.com']);
  run('git', ['config', 'user.name', 'Test']);
  return { dir, run };
}

// --- Review Army: Migration Safety ---
//
// RETIRED SPECIALIST, NO SURVIVING HOME. This exercised
// `review/specialists/data-migration.md`. The shipped checklist has no
// data-migration category: Pass 1 "SQL & Data Safety" covers interpolation,
// TOCTOU, validation bypass and N+1, not "DROP COLUMN is irreversible / needs a
// backfill / needs a rollback path". Nothing else picks it up.
//
// NOTE THE ASSERTION: `drop || data loss || reversib || migration || column`
// against a diff that IS a `DROP COLUMN` migration. It passes on any reviewer
// that names the file it just read, so deleting the specialist did not turn it
// red. It was keyword-echo of the fixture before this change too.
describeIfSelected('Review Army: Migration Safety', ['review-army-migration-safety'], () => {
  let dir: string;

  beforeAll(() => {
    const repo = setupRepo('army-migration');
    dir = repo.dir;

    // Base commit
    fs.writeFileSync(path.join(dir, 'app.rb'), '# base\n');
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'initial']);

    // Feature branch with unsafe migration
    repo.run('git', ['checkout', '-b', 'feature/drop-columns']);
    fs.mkdirSync(path.join(dir, 'db', 'migrate'), { recursive: true });
    const migrationContent = fs.readFileSync(
      path.join(ROOT, 'test', 'fixtures', 'review-army-migration.sql'), 'utf-8'
    );
    fs.writeFileSync(path.join(dir, 'db', 'migrate', '20260330_drop_columns.sql'), migrationContent);
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'drop email and phone columns']);

    installDispatcher(dir, 'review');
  });

  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  testConcurrentIfSelected('review-army-migration-safety', async () => {
    const result = await runSkillTest({
      prompt: `You are in a git repo on a feature branch with a database migration that drops columns.
${DISPATCH_PREAMBLE}

The base branch is main. Run Step 4 (Critical pass) against the diff (git diff main...HEAD),
applying the checklist's Pass 1 CRITICAL categories and its Pass 3 SWEEP categories —
Pass 3 says you run those yourself, nothing else picks them up.

This diff changes db/migrate/, so judge the migration itself: reversibility, data loss,
and whether anything still reads the dropped columns.

Write your findings to ${dir}/review-output.md`,
      workingDirectory: dir,
      maxTurns: 20,
      timeout: 180_000,
      testName: 'review-army-migration-safety',
      runId,
    });

    logCost('/review army migration', result);
    recordE2E(evalCollector, '/review army migration safety', 'Review Army', result);
    expect(result.exitReason).toBe('success');

    // Verify migration issues were caught (report artifact is a hard requirement)
    const outputPath = path.join(dir, 'review-output.md');
    const content = requireReportArtifact(outputPath).toLowerCase();
    const hasMigrationFinding =
      content.includes('drop') ||
      content.includes('data loss') ||
      content.includes('reversib') ||
      content.includes('migration') ||
      content.includes('column');
    expect(hasMigrationFinding).toBe(true);
  }, 210_000);
});

// --- Review Army: N+1 Performance ---
//
// COVERED BY THE SHIPPED CHECKLIST. `review/specialists/performance.md` is gone,
// but its judgment has two live homes: Pass 1 "SQL & Data Safety" ("N+1 queries:
// Missing eager loading ... for associations used in loops/views") and Pass 3
// SWEEP "Performance & Bundle Impact" ("Queries inside iteration that could
// batch"). The assertion still bites against shipped content.
describeIfSelected('Review Army: N+1 Performance', ['review-army-perf-n-plus-one'], () => {
  let dir: string;

  beforeAll(() => {
    const repo = setupRepo('army-n-plus-one');
    dir = repo.dir;

    fs.writeFileSync(path.join(dir, 'app.rb'), '# base\n');
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'initial']);

    repo.run('git', ['checkout', '-b', 'feature/add-posts-index']);
    const n1Content = fs.readFileSync(
      path.join(ROOT, 'test', 'fixtures', 'review-army-n-plus-one.rb'), 'utf-8'
    );
    fs.writeFileSync(path.join(dir, 'posts_controller.rb'), n1Content);
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'add posts controller']);

    installDispatcher(dir, 'review');
  });

  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  testConcurrentIfSelected('review-army-perf-n-plus-one', async () => {
    const result = await runSkillTest({
      prompt: `You are in a git repo on a feature branch with a Ruby controller that has N+1 queries.
${DISPATCH_PREAMBLE}

The base branch is main. Run Step 4 (Critical pass) against the diff (git diff main...HEAD),
applying the checklist's Pass 1 CRITICAL categories and its Pass 3 SWEEP categories —
Pass 3 says you run those yourself, nothing else picks them up.

Write your findings to ${dir}/review-output.md`,
      workingDirectory: dir,
      maxTurns: 20,
      timeout: 180_000,
      testName: 'review-army-perf-n-plus-one',
      runId,
    });

    logCost('/review army n+1', result);
    recordE2E(evalCollector, '/review army N+1 detection', 'Review Army', result);
    expect(result.exitReason).toBe('success');

    const outputPath = path.join(dir, 'review-output.md');
    const content = requireReportArtifact(outputPath).toLowerCase();
    const hasN1Finding =
      content.includes('n+1') ||
      content.includes('n + 1') ||
      content.includes('eager') ||
      content.includes('includes') ||
      content.includes('preload') ||
      content.includes('query') ||
      content.includes('loop');
    expect(hasN1Finding).toBe(true);
  }, 210_000);
});

// --- Review Army: Delivery Audit ---
//
// COVERED, BUT UNDER A DIFFERENT NAME. There is no "Plan Completion Audit"
// section any more. The judgment lives in `references/legacy/review.md`
// "Step 1.5: Scope Drift Detection" -> Plan File Discovery -> Actionable Item
// Extraction -> Cross-Reference Against Diff, and that step still defines the
// exact four labels this test asserts on: DONE / PARTIAL / NOT DONE / CHANGED
// (plus UNVERIFIABLE). Prompt renamed to the shipped section; assertion unchanged.
describeIfSelected('Review Army: Delivery Audit', ['review-army-delivery-audit'], () => {
  let dir: string;

  beforeAll(() => {
    const repo = setupRepo('army-delivery');
    dir = repo.dir;

    fs.writeFileSync(path.join(dir, 'app.rb'), '# base\n');
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'initial']);

    repo.run('git', ['checkout', '-b', 'feature/three-features']);

    // Write a plan file promising 3 features
    fs.writeFileSync(path.join(dir, 'PLAN.md'), `# Feature Plan

## Implementation Items
1. Add user authentication with login/logout
2. Add user profile page with avatar upload
3. Add email notification system for new signups

## Test Items
- Test login flow
- Test profile page rendering
- Test email sending
`);
    repo.run('git', ['add', 'PLAN.md']);
    repo.run('git', ['commit', '-m', 'add plan']);

    // Implement only 2 of 3 features
    fs.writeFileSync(path.join(dir, 'auth.rb'), `class AuthController
  def login
    # authenticate user
    session[:user_id] = user.id
  end

  def logout
    session.delete(:user_id)
  end
end
`);
    fs.writeFileSync(path.join(dir, 'profile.rb'), `class ProfileController
  def show
    @user = User.find(params[:id])
  end

  def update_avatar
    @user.avatar.attach(params[:avatar])
  end
end
`);
    // NOTE: email notification system is NOT implemented (intentionally missing)
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'implement auth and profile features']);

    installDispatcher(dir, 'review');
  });

  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  testConcurrentIfSelected('review-army-delivery-audit', async () => {
    const result = await runSkillTest({
      prompt: `You are in a git repo on branch feature/three-features.
There is a PLAN.md file that promises 3 features: auth, profile, and email notifications.
The diff (git diff main...HEAD) only implements 2 of them (auth and profile).

${DISPATCH_PREAMBLE}

Focus on that module's "Step 1.5: Scope Drift Detection" — Plan File Discovery,
Actionable Item Extraction, and Cross-Reference Against Diff.
The plan file is at ./PLAN.md. Cross-reference it against the diff.

For each plan item, classify as DONE, PARTIAL, NOT DONE, or CHANGED.
The email notification system should be classified as NOT DONE.

Write your completion audit to ${dir}/review-output.md`,
      workingDirectory: dir,
      maxTurns: 15,
      timeout: 120_000,
      testName: 'review-army-delivery-audit',
      runId,
    });

    logCost('/review army delivery', result);
    recordE2E(evalCollector, '/review army delivery audit', 'Review Army', result);
    expect(result.exitReason).toBe('success');

    const outputPath = path.join(dir, 'review-output.md');
    const content = requireReportArtifact(outputPath).toLowerCase();
    // Should identify email notifications as NOT DONE
    const hasNotDone =
      content.includes('not done') ||
      content.includes('not_done') ||
      content.includes('missing') ||
      content.includes('not implemented');
    const mentionsEmail =
      content.includes('email') ||
      content.includes('notification');
    expect(hasNotDone).toBe(true);
    expect(mentionsEmail).toBe(true);
  }, 150_000);
});

// --- Review Army: Quality Score ---
//
// THE PREMISE IS GONE; THE TEST STILL RUNS BECAUSE THE PROMPT CARRIES THE
// FORMULA. There is no "Review Army merge step" to describe the PR Quality
// Score. The only surviving mention is the review-log schema in
// `references/legacy/review.md`: "quality_score = the PR Quality Score if a
// specialist pass ran and computed one. If no specialist pass was dispatched
// (as in this module's default flow, or a small diff), use 10.0" — i.e. the
// shipped default is a constant 10.0, and the formula
// `10 - (critical*2 + informational*0.5)` is computed nowhere.
//
// The prompt hands the agent that formula inline, so this test measures whether
// the agent can do arithmetic it was just given, not whether gstack computes a
// quality score. The assertion (`quality score` or `N/10` appears) is left as
// is; it was never sensitive to the specialist pass. Removing the dead "as
// described in the Review Army merge step" citation is the only change — it
// pointed at a section that does not exist, which is a broken instruction, not
// a gate.
describeIfSelected('Review Army: Quality Score', ['review-army-quality-score'], () => {
  let dir: string;

  beforeAll(() => {
    const repo = setupRepo('army-quality');
    dir = repo.dir;

    fs.writeFileSync(path.join(dir, 'app.rb'), '# base\n');
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'initial']);

    repo.run('git', ['checkout', '-b', 'feature/add-controller']);
    // Code with obvious issues for quality score computation
    fs.writeFileSync(path.join(dir, 'user_controller.rb'), `class UserController
  def create
    # SQL injection
    User.where("name = '#{params[:name]}'")
    # Magic number
    if users.count > 42
      raise "too many"
    end
  end
end
`);
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'add user controller']);

    installDispatcher(dir, 'review');
  });

  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  testConcurrentIfSelected('review-army-quality-score', async () => {
    const result = await runSkillTest({
      prompt: `You are in a git repo with a vulnerable user controller.
${DISPATCH_PREAMBLE}

Run the Critical pass (Step 4) against the diff (git diff main...HEAD), applying the
checklist's Pass 1 CRITICAL categories and its Pass 3 SWEEP categories.
Then compute a PR Quality Score with this formula:
quality_score = max(0, 10 - (critical_count * 2 + informational_count * 0.5))

Write your findings AND the computed quality score to ${dir}/review-output.md
Include the line: "PR Quality Score: X/10" where X is the computed score.`,
      workingDirectory: dir,
      maxTurns: 15,
      timeout: 120_000,
      testName: 'review-army-quality-score',
      runId,
    });

    logCost('/review army quality', result);
    recordE2E(evalCollector, '/review army quality score', 'Review Army', result);
    expect(result.exitReason).toBe('success');

    const outputPath = path.join(dir, 'review-output.md');
    const content = requireReportArtifact(outputPath);
    // Should contain a quality score
    const hasScore =
      content.toLowerCase().includes('quality score') ||
      content.match(/\d+\/10/);
    expect(hasScore).toBeTruthy();
  }, 150_000);
});

// --- Review Army: JSON Findings ---
//
// SPECIALIST GONE, JUDGMENT MOSTLY SURVIVES. `review/specialists/security.md`
// is deleted; the security judgment for this fixture lives in the checklist's
// Pass 1 "SQL & Data Safety" (string interpolation in SQL) plus Pass 3
// "Access Control" and "Crypto & Entropy". The `specialist` field in the
// asserted JSON schema is now a label the prompt supplies, not something the
// shipped tree emits — no per-specialist finding schema ships anywhere.
describeIfSelected('Review Army: JSON Findings', ['review-army-json-findings'], () => {
  let dir: string;

  beforeAll(() => {
    const repo = setupRepo('army-json');
    dir = repo.dir;

    fs.writeFileSync(path.join(dir, 'app.rb'), '# base\n');
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'initial']);

    repo.run('git', ['checkout', '-b', 'feature/vuln']);
    fs.writeFileSync(path.join(dir, 'search.rb'), `class SearchController
  def index
    # SQL injection via string interpolation
    results = ActiveRecord::Base.connection.execute(
      "SELECT * FROM products WHERE name LIKE '%#{params[:q]}%'"
    )
    render json: results
  end
end
`);
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'add search']);

    installDispatcher(dir, 'review');
  });

  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  testConcurrentIfSelected('review-army-json-findings', async () => {
    const result = await runSkillTest({
      prompt: `You are reviewing a git diff with a SQL injection vulnerability.
Read skills/review/references/artifacts/review/checklist.md — its Pass 1 "SQL & Data
Safety" and Pass 3 "Access Control" / "Crypto & Entropy" categories are the security
checklist. No gstack runtime is installed, so skip every optional \`$GSTACK_BIN\` helper.

Apply the checklist against this diff (git diff main...HEAD).
Output your findings as JSON objects, one per line, following the schema:
{"severity":"CRITICAL","confidence":9,"path":"search.rb","line":4,"category":"injection","summary":"SQL injection via string interpolation","fix":"Use parameterized query","fingerprint":"search.rb:4:injection","specialist":"security"}

Write ONLY JSON findings (no preamble) to ${dir}/findings.json`,
      workingDirectory: dir,
      maxTurns: 12,
      timeout: 90_000,
      testName: 'review-army-json-findings',
      runId,
    });

    logCost('/review army json', result);
    recordE2E(evalCollector, '/review army JSON findings', 'Review Army', result);
    expect(result.exitReason).toBe('success');

    const findingsPath = path.join(dir, 'findings.json');
    const content = requireReportArtifact(findingsPath, 20).trim();
    const lines = content.split('\n').filter(l => l.trim());
    // At least one finding
    expect(lines.length).toBeGreaterThanOrEqual(1);
    // Each line should be valid JSON with required fields
    for (const line of lines) {
      let parsed: any;
      try { parsed = JSON.parse(line); } catch { continue; }
      // Required fields per schema
      expect(parsed).toHaveProperty('severity');
      expect(parsed).toHaveProperty('confidence');
      expect(parsed).toHaveProperty('path');
      expect(parsed).toHaveProperty('category');
      expect(parsed).toHaveProperty('summary');
      expect(parsed).toHaveProperty('specialist');
      break; // One valid line is enough for the gate test
    }
  }, 120_000);
});

// --- Review Army: Red Team (periodic) ---
//
// RETIRED SPECIALIST, NO SURVIVING HOME, AND THE ASSERTION NEVER MEASURED IT.
// `review/specialists/red-team.md` is gone and nothing replaced it — the only
// remaining string in skills/review/ is `references/FAST-PATH.md` telling the
// agent to suppress "no review-army roster". Adversarial review moved entirely
// to /ship's dashboard row, which reads a log rather than running a pass.
//
// The assertion is `/red team|adversarial/` on a report the prompt orders to
// start with the literal line "RED TEAM REVIEW". It has always passed on
// instruction-following, not on red-team judgment, so retiring the specialist
// leaves it green. Left at its original bar rather than invented anew — a new
// adversarial gate is a design decision, not a test repair.
describeIfSelected('Review Army: Red Team', ['review-army-red-team'], () => {
  let dir: string;

  beforeAll(() => {
    const repo = setupRepo('army-redteam');
    dir = repo.dir;

    fs.writeFileSync(path.join(dir, 'app.rb'), '# base\n');
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'initial']);

    repo.run('git', ['checkout', '-b', 'feature/large-change']);
    // Create a large diff (300+ lines)
    const lines: string[] = ['class LargeController'];
    for (let i = 0; i < 100; i++) {
      lines.push(`  def method_${i}`);
      lines.push(`    data = params[:input_${i}]`);
      lines.push(`    process(data)`);
      lines.push('  end');
      lines.push('');
    }
    lines.push('end');
    fs.writeFileSync(path.join(dir, 'large_controller.rb'), lines.join('\n'));
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'add large controller']);

    installDispatcher(dir, 'review');
  });

  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  testConcurrentIfSelected('review-army-red-team', async () => {
    const result = await runSkillTest({
      prompt: `You are reviewing a large diff (300+ lines).
${DISPATCH_PREAMBLE}

The diff is large, so the trivial-change fast path must NOT fire — run the full pass.
Review it adversarially against the diff (git diff main...HEAD): focus on the issues a
straight checklist sweep would miss.

Write your red team findings to ${dir}/review-output.md
Start the file with "RED TEAM REVIEW" on the first line.`,
      workingDirectory: dir,
      maxTurns: 20,
      timeout: 180_000,
      testName: 'review-army-red-team',
      runId,
    });

    logCost('/review army red-team', result);
    recordE2E(evalCollector, '/review army red team', 'Review Army', result);
    expect(result.exitReason).toBe('success');

    const outputPath = path.join(dir, 'review-output.md');
    const content = requireReportArtifact(outputPath);
    expect(content.toLowerCase()).toMatch(/red team|adversarial/);
  }, 210_000);
});

// --- Review Army: Consensus (periodic) ---
//
// PREMISE GONE. Multi-specialist confirmation needs two or more specialists to
// agree; there are zero. What survives is one-agent dedup —
// `references/legacy/review.md` "Step 5.0: Cross-review finding dedup", which
// merges repeat findings across runs, not across perspectives. There is no
// shipped "MULTI-SPECIALIST CONFIRMED" concept, so that instruction is left in
// the prompt only as the thing the test asks for, not as shipped behavior.
//
// The assertion only checks `sql || injection || interpolat`, which Pass 1 "SQL
// & Data Safety" covers on its own — so this stays green while measuring
// nothing about consensus. Reported, not rewritten.
describeIfSelected('Review Army: Consensus', ['review-army-consensus'], () => {
  let dir: string;

  beforeAll(() => {
    const repo = setupRepo('army-consensus');
    dir = repo.dir;

    fs.writeFileSync(path.join(dir, 'app.rb'), '# base\n');
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'initial']);

    repo.run('git', ['checkout', '-b', 'feature/vuln-auth']);
    // SQL injection that both security AND testing specialists should flag
    fs.writeFileSync(path.join(dir, 'auth_controller.rb'), `class AuthController
  def login
    user = User.find_by("email = '#{params[:email]}' AND password = '#{params[:password]}'")
    if user
      session[:user_id] = user.id
      redirect_to root_path
    else
      flash[:error] = "Invalid credentials"
      render :login
    end
  end
end
`);
    repo.run('git', ['add', '.']);
    repo.run('git', ['commit', '-m', 'add auth controller']);

    installDispatcher(dir, 'review');
  });

  afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });

  testConcurrentIfSelected('review-army-consensus', async () => {
    const result = await runSkillTest({
      prompt: `You are reviewing a git diff with a SQL injection in an auth controller.
${DISPATCH_PREAMBLE}

This vulnerability sits in two checklist categories at once: Pass 1 "SQL & Data Safety"
(the injection vector) and Pass 3 "Test Gaps" (no test for the auth-bypass denied case).

Run the review. In your output, if a finding is flagged by more than one category,
mark it as "MULTI-SPECIALIST CONFIRMED" with the confirming categories.

Write findings to ${dir}/review-output.md`,
      workingDirectory: dir,
      maxTurns: 20,
      timeout: 180_000,
      testName: 'review-army-consensus',
      runId,
    });

    logCost('/review army consensus', result);
    recordE2E(evalCollector, '/review army consensus', 'Review Army', result);
    expect(result.exitReason).toBe('success');

    const outputPath = path.join(dir, 'review-output.md');
    const content = requireReportArtifact(outputPath).toLowerCase();
    // Should catch the SQL injection
    const hasSqlFinding =
      content.includes('sql') ||
      content.includes('injection') ||
      content.includes('interpolat');
    expect(hasSqlFinding).toBe(true);
  }, 210_000);
});

// Finalize eval collector
afterAll(async () => {
  await finalizeEvalCollector(evalCollector);
});
