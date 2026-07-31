import { expect, beforeAll, afterAll } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, runId,
  describeIfSelected, testConcurrentIfSelected,
  logCost, recordE2E,
  createEvalCollector, finalizeEvalCollector,
} from './helpers/e2e-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e-qa-ask-contract');

// --- /qa ask-contract E2E (regression for the field failure where /qa probed
// for a test command by RUNNING `npm test`/`jest`/`pytest`/`bun test` in a
// project with no test script and no CLAUDE.md, instead of asking the user) ---

/** True if any simple command in a shell line EXECUTES a test runner (probing).
 *  Read-only inspection (`ls jest.config.*`, `grep vitest package.json`) is
 *  allowed — only leading-token execution counts.
 *  ponytail: leading-token match per segment; env-prefixed probes (CI=1 npm test)
 *  slip through — extend the segment parse if that shows up in the field. */
export function isForbiddenTestProbe(cmd: string): boolean {
  const segments = cmd.split(/&&|\|\||[|;\n]/);
  return segments.some(seg => {
    const s = seg.trim();
    return (
      /^(npm|pnpm|yarn|bun)\s+(run\s+)?test\b/.test(s) ||
      /^npx\s+(jest|vitest|mocha|ava|playwright)\b/.test(s) ||
      /^(\S*\/)?(jest|vitest|mocha|pytest)(?![.\w-])/.test(s) ||
      /^(cargo|go)\s+test\b/.test(s)
    );
  });
}

/** Signals that the session asked for the test command or declined to assume one. */
const ASKED_OR_DECLINED = [
  /AskUserQuestion/i,
  /BLOCKED/,
  /(what|which)[^.\n]{0,60}(test\s+(command|framework|runner)|runtime)/i,
  /couldn'?t detect/i,
  /no test (framework|script|command|runner)/i,
  /(ask|confirm)[^.\n]{0,40}(test|command|framework)/i,
];

describeIfSelected('QA ask-contract E2E', ['qa-ask-contract'], () => {
  let projDir: string;

  beforeAll(() => {
    projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-qa-ask-'));

    // Minimal Node project: NO test script, NO test framework, NO CLAUDE.md.
    fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify({
      name: 'ask-contract-app',
      version: '1.0.0',
      type: 'module',
    }, null, 2));
    fs.mkdirSync(path.join(projDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(projDir, 'src', 'index.js'),
      'export function add(a, b) { return a + b; }\n');

    // Extract ONLY the Test Framework Bootstrap section (detection + ask
    // contract) — never copy the full 1700-line SKILL.md into a fixture.
    const full = fs.readFileSync(path.join(ROOT, 'qa', 'SKILL.md'), 'utf-8');
    const start = full.indexOf('## Test Framework Bootstrap');
    if (start < 0) throw new Error('qa/SKILL.md: "## Test Framework Bootstrap" section not found');
    const end = full.indexOf('\n## ', start);
    fs.mkdirSync(path.join(projDir, 'qa'), { recursive: true });
    fs.writeFileSync(
      path.join(projDir, 'qa', 'SKILL.md'),
      full.slice(start, end > start ? end : undefined),
    );
  });

  afterAll(() => {
    try { fs.rmSync(projDir, { recursive: true, force: true }); } catch {}
  });

  testConcurrentIfSelected('qa-ask-contract', async () => {
    const result = await runSkillTest({
      prompt: `Read the file qa/SKILL.md for the QA skill's test-framework workflow, then follow it for this request:

/qa this project`,
      workingDirectory: projDir,
      maxTurns: 15,
      allowedTools: ['Bash', 'Read', 'Write', 'Glob', 'Grep', 'AskUserQuestion'],
      timeout: 180_000,
      testName: 'qa-ask-contract',
      runId,
    });

    logCost('/qa ask-contract', result);

    // 1. THE contract: no Bash tool call may execute a test runner to probe.
    const probes = result.toolCalls
      .filter(tc => tc.tool === 'Bash')
      .map(tc => String(tc.input?.command ?? ''))
      .filter(isForbiddenTestProbe);
    if (probes.length > 0) {
      console.error('/qa ask-contract: forbidden test-command probes:', probes);
    }

    // 2. It must ask for the command or decline to assume one — via an
    // AskUserQuestion tool call (any mcp variant) or in assistant text.
    const asked = result.toolCalls.some(tc => /AskUserQuestion$/.test(tc.tool));
    const assistantText = result.transcript
      .filter((e: any) => e.type === 'assistant')
      .flatMap((e: any) => e.message?.content || [])
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .concat(result.output)
      .join('\n');
    const askedOrDeclined = asked || ASKED_OR_DECLINED.some(re => re.test(assistantText));

    recordE2E(evalCollector, '/qa ask-contract', 'QA ask-contract E2E', result, {
      passed: probes.length === 0 && askedOrDeclined,
    });

    expect(probes).toHaveLength(0);
    expect(askedOrDeclined).toBe(true);
    // Accept error_max_turns — stopping at the ask gate can burn turns on detection.
    expect(['success', 'error_max_turns']).toContain(result.exitReason);
  }, 240_000);
});

// Module-level afterAll — finalize eval collector after all tests complete
afterAll(async () => {
  await finalizeEvalCollector(evalCollector);
});
