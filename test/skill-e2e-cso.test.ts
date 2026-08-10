import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  describeIfSelected, installLegacySkill, logCost, recordE2E,
  createEvalCollector, finalizeEvalCollector,
} from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e-cso');

afterAll(() => {
  finalizeEvalCollector(evalCollector);
});

/**
 * Install /cso the way a user reaches it today, in a temp dir of its own.
 *
 * /cso is retired: the name now resolves to `skills/.compat/cso/SKILL.md`, a
 * routing stub that dispatches to `$review --mode Security --module cso`, and the
 * review dispatcher lazily reads `references/legacy/cso.md`, which in turn defers
 * the scope-gated phases to `references/sections/cso/audit-phases.md`.
 * `installLegacySkill` lays down the alias plus the whole dispatcher tree, and
 * throws if any link in that chain is missing.
 *
 * Deliberately NOT installed inside the repo under audit — these tests point at an
 * absolute path, exactly as they did when they read the 1.x `cso/SKILL.md` from the
 * repo root. Copying gstack's own review tree into the fixture would hand the audit
 * ~2500 extra lines to scan, including `references/support/lib/redact-patterns.ts`
 * (a catalog of live-format credential prefixes). A security test must see the
 * planted vulnerabilities and nothing else.
 */
function installCsoSkill(): { dir: string; route: ReturnType<typeof installLegacySkill> } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-cso-skill-'));
  return { dir, route: installLegacySkill(dir, 'cso') };
}

/**
 * The routing preamble every /cso prompt needs now that the specialist is three
 * lazy reads deep. Naming `audit-phases.md` is load-bearing, not convenience:
 * Phases 2-11 live there, and Phases 2 (secrets/.env), 4 (unpinned actions),
 * 5 (Dockerfile USER) and 6 (webhook signatures) are the exact phases these tests
 * assert on. An agent that stops at cso.md reads the mode resolution and the
 * findings format but never the checks.
 */
function csoRoutingPreamble(skillDir: string, route: ReturnType<typeof installLegacySkill>): string {
  return `Read the file ${skillDir}/cso/SKILL.md for the CSO skill instructions. It is a
routing alias, not the audit: follow its dispatch (\`${route.invocation}\`) into
${skillDir}/skills/${route.dispatcher}/SKILL.md, then read that dispatcher's
references/legacy/${route.module}.md module. That module defers its scope-gated phases
(2-11) to references/sections/cso/audit-phases.md — read that too, for the phases your
resolved scope selects. All three are required; the audit checks live in the last one.
Paths written inside those files are relative to ${skillDir}/skills/${route.dispatcher}/.`;
}

// --- CSO v2 E2E Tests ---

describeIfSelected('CSO v2 — full audit', ['cso-full-audit'], () => {
  let csoDir: string;
  let skill: ReturnType<typeof installCsoSkill>;

  beforeAll(() => {
    skill = installCsoSkill();
    csoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-cso-'));

    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: csoDir, stdio: 'pipe', timeout: 5000 });

    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);

    // Create a minimal app with a planted vulnerability
    fs.writeFileSync(path.join(csoDir, 'package.json'), JSON.stringify({
      name: 'cso-test-app',
      version: '1.0.0',
      dependencies: { express: '4.18.0' },
    }, null, 2));

    // Planted vuln: hardcoded API key
    fs.writeFileSync(path.join(csoDir, 'server.ts'), `
import express from 'express';
const app = express();
const API_KEY = "sk-1234567890abcdef1234567890abcdef";
app.get('/api/data', (req, res) => {
  const id = req.query.id;
  res.json({ data: \`result for \${id}\` });
});
app.listen(3000);
`);

    // Planted vuln: .env tracked by git
    fs.writeFileSync(path.join(csoDir, '.env'), 'DATABASE_URL=postgres://admin:secretpass@prod.db.example.com:5432/myapp\n');

    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);
  });

  afterAll(() => {
    try { fs.rmSync(csoDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(skill.dir, { recursive: true, force: true }); } catch {}
  });

  test('/cso finds planted vulnerabilities', async () => {
    const result = await runSkillTest({
      prompt: `${csoRoutingPreamble(skill.dir, skill.route)}

Run /cso on this repo (full daily audit, no flags) — that is every phase, 0 through 14.

IMPORTANT:
- Do NOT use AskUserQuestion — skip any interactive prompts.
- Focus on finding the planted vulnerabilities in this small repo.
- Produce the SECURITY FINDINGS table.
- Save the report to .gstack/security-reports/.`,
      workingDirectory: csoDir,
      // 30 -> 45, 300s -> 480s: the audit is now four lazy reads deep (alias,
      // review dispatcher, cso module, audit-phases) plus the per-invocation
      // references, where 1.x was one monolith read. ~8 Read turns before Phase 0.
      maxTurns: 45,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Agent'],
      timeout: 480_000,
    });

    logCost('cso', result);
    expect(result.exitReason).toBe('success');

    // Should detect hardcoded API key
    const output = result.output.toLowerCase();
    expect(
      output.includes('sk-') || output.includes('hardcoded') || output.includes('api key') || output.includes('api_key')
    ).toBe(true);

    // Should detect .env tracked by git
    expect(
      output.includes('.env') && (output.includes('tracked') || output.includes('gitignore'))
    ).toBe(true);

    // Should produce a findings table
    expect(
      output.includes('security findings') || output.includes('SECURITY FINDINGS')
    ).toBe(true);

    // Should save a report. Not existsSync-guarded: `if (fs.existsSync(dir))` let an
    // agent that wrote NOTHING pass this check, so the Phase 14 half of the test was
    // worth nothing. Safe to harden — every line here runs only after
    // `expect(result.exitReason).toBe('success')` above, so an agent that reached
    // this point finished cleanly and had every turn it needed for Phase 14, which
    // always runs regardless of scope flag.
    const reportDir = path.join(csoDir, '.gstack', 'security-reports');
    expect(
      fs.existsSync(reportDir),
      `no report directory at ${reportDir} — the audit skipped Phase 14 (Save Report).`,
    ).toBe(true);
    const reports = fs.readdirSync(reportDir).filter(f => f.endsWith('.json'));
    expect(reports.length).toBeGreaterThanOrEqual(1);

    recordE2E(evalCollector, 'cso-full-audit', 'e2e-cso', result);
  }, 480_000);
});

describeIfSelected('CSO v2 — diff mode', ['cso-diff-mode'], () => {
  let csoDiffDir: string;
  let skill: ReturnType<typeof installCsoSkill>;

  beforeAll(() => {
    skill = installCsoSkill();
    csoDiffDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-cso-diff-'));

    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: csoDiffDir, stdio: 'pipe', timeout: 5000 });

    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);

    // Clean initial commit
    fs.writeFileSync(path.join(csoDiffDir, 'package.json'), JSON.stringify({
      name: 'cso-diff-test', version: '1.0.0',
    }, null, 2));
    fs.writeFileSync(path.join(csoDiffDir, 'app.ts'), 'console.log("hello");\n');
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);

    // Feature branch with a vuln
    run('git', ['checkout', '-b', 'feat/add-webhook']);
    fs.writeFileSync(path.join(csoDiffDir, 'webhook.ts'), `
import express from 'express';
const app = express();
// No signature verification!
app.post('/webhook/stripe', (req, res) => {
  const event = req.body;
  processPayment(event);
  res.sendStatus(200);
});
`);
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'feat: add webhook']);
  });

  afterAll(() => {
    try { fs.rmSync(csoDiffDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(skill.dir, { recursive: true, force: true }); } catch {}
  });

  test('/cso --diff scopes to branch changes', async () => {
    const result = await runSkillTest({
      prompt: `${csoRoutingPreamble(skill.dir, skill.route)}

Run /cso --diff on this repo. The base branch is "main".

IMPORTANT:
- Do NOT use AskUserQuestion — skip any interactive prompts.
- Focus on changes in the current branch vs main.
- The webhook.ts file was added on this branch — it should be analyzed.
- This is a scoped security audit, not a general diff review: the dispatcher's
  trivial-change fast path does not apply, because the alias above selects the
  Security mode and the cso module explicitly. Read the module chain.`,
      workingDirectory: csoDiffDir,
      // 25 -> 40, 240s -> 420s: same four-read dispatch chain as the full audit,
      // against a smaller scope.
      maxTurns: 40,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob', 'Agent'],
      timeout: 420_000,
    });

    logCost('cso', result);
    expect(result.exitReason).toBe('success');

    const output = result.output.toLowerCase();
    // Should mention webhook and missing signature verification
    expect(
      output.includes('webhook') && (output.includes('signature') || output.includes('verify'))
    ).toBe(true);

    recordE2E(evalCollector, 'cso-diff-mode', 'e2e-cso', result);
  }, 420_000);
});

describeIfSelected('CSO v2 — infra scope', ['cso-infra-scope'], () => {
  let csoInfraDir: string;
  let skill: ReturnType<typeof installCsoSkill>;

  beforeAll(() => {
    skill = installCsoSkill();
    csoInfraDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-cso-infra-'));

    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: csoInfraDir, stdio: 'pipe', timeout: 5000 });

    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);

    // CI workflow with unpinned action
    fs.mkdirSync(path.join(csoInfraDir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(csoInfraDir, '.github', 'workflows', 'ci.yml'), `
name: CI
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: some-third-party/action@main
      - run: echo "Building..."
`);

    // Dockerfile running as root
    fs.writeFileSync(path.join(csoInfraDir, 'Dockerfile'), `
FROM node:20
WORKDIR /app
COPY . .
RUN npm install
EXPOSE 3000
CMD ["node", "server.js"]
`);

    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);
  });

  afterAll(() => {
    try { fs.rmSync(csoInfraDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(skill.dir, { recursive: true, force: true }); } catch {}
  });

  test('/cso --infra runs infrastructure phases only', async () => {
    const result = await runSkillTest({
      prompt: `${csoRoutingPreamble(skill.dir, skill.route)}

Run /cso --infra on this repo. This should run infrastructure-only phases (0-6, 12-14).

IMPORTANT:
- Do NOT use AskUserQuestion — skip any interactive prompts.
- This is a TINY repo with only 3 files: .github/workflows/ci.yml, Dockerfile, and package.json. Do NOT waste turns exploring — just read those files directly and audit them.
- The Dockerfile has no USER directive (runs as root). The CI workflow uses an unpinned third-party GitHub Action (some-third-party/action@main).
- Focus on infrastructure findings, NOT code-level OWASP scanning.
- The audit-phases file holds phases 2-11; under --infra you run only 2 through 6 from it, per the scope gate at the top of that file.
- Skip the optional-runtime capability setup in references/RUNTIME.md — no bootstrap, no browser, no doctor. Go straight to the audit.
- Do NOT use the Agent tool for exploration or verification — read the files yourself. This repo is too small to need subagents.`,
      workingDirectory: csoInfraDir,
      // 30 -> 45, 360s -> 480s: same four-read dispatch chain before Phase 0.
      maxTurns: 45,
      allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob'],
      timeout: 480_000,
    });

    logCost('cso', result);
    expect(result.exitReason).toBe('success');

    const output = result.output.toLowerCase();
    // Should mention unpinned action or Dockerfile issues
    expect(
      output.includes('unpinned') || output.includes('third-party') ||
      output.includes('user directive') || output.includes('root')
    ).toBe(true);

    recordE2E(evalCollector, 'cso-infra-scope', 'e2e-cso', result);
  }, 480_000);
});
