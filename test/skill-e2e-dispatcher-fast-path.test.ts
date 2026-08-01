/**
 * Trivial-change fast path regressions for /qa, /review, /ship, and /debug.
 *
 * The same field failure #886 pinned for /plan in
 * test/skill-e2e-plan-proportionality.test.ts applies to the other four
 * dispatchers: a one-line ask was answered with a full engagement — the
 * specialist module stack loaded, a multi-thousand-char report emitted, and in
 * the worst case a hard block instead of the small thing the user asked for.
 *
 * Each dispatcher's "Trivial-change fast path" section (skills/<skill>/SKILL.md)
 * is the fix, and only /plan's was under test. This file pins the other four the
 * same three ways, one case per dispatcher:
 *   1. Final assistant message stays under a sane ceiling (< 4000 chars).
 *   2. The session read at most 3 files under <skill>/references/ (the fast path
 *      says zero; 3 is slack, the field failure read the whole legacy stack).
 *   3. It produced the small result rather than hard-blocking — a per-case
 *      outcome check (the edit applied on disk, or the concrete answer in the
 *      final message).
 *
 * Each case gets a purpose-built one-or-two-file repo, and the dispatcher tree
 * is copied whole (SKILL.md + references/, including references/legacy/). The
 * legacy modules being PRESENT is the point: the failure mode under test is the
 * agent reading them for a trivial ask, so they must be available to read. Only
 * the ~80-line dispatcher is prompted for, so nothing large is read on the
 * passing path.
 */
import { afterAll, beforeAll, expect } from 'bun:test';
import { runSkillTest } from './helpers/session-runner';
import {
  ROOT, runId,
  describeIfSelected, testConcurrentIfSelected,
  copyDirSync, logCost, recordE2E,
  createEvalCollector, finalizeEvalCollector,
} from './helpers/e2e-helpers';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const evalCollector = createEvalCollector('e2e-dispatcher-fast-path');

/** The fast path says "it needs the check, not a report". The field failure produced 10K+. */
const OUTPUT_CEILING = 4000;

type Run = (cmd: string, args: string[]) => void;

interface FastPathCase {
  /** E2E test name — also the E2E_TOUCHFILES / E2E_TIERS key. */
  name: string;
  /** Dispatcher under test: skills/<skill>/ is copied into the fixture as <skill>/. */
  skill: 'qa' | 'review' | 'ship' | 'debug';
  /** Cost-log label. */
  label: string;
  /** Write the fixture repo. `run` executes git in the fixture dir. */
  seed: (dir: string, run: Run) => void;
  /** What the user said after invoking the skill. */
  ask: string;
  maxTurns?: number;
  /** Small result present? False means it hard-blocked or ceremonied instead. */
  outcome: (dir: string, output: string) => boolean;
  /** Human-readable form of `outcome`, used in the failure message. */
  outcomeDesc: string;
}

const PAGINATE = `export function paginate<T>(items: T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let p = 0; p < Math.floor(items.length / perPage); p++) {
    pages.push(items.slice(p * perPage, (p + 1) * perPage));
  }
  return pages;
}
`;

const CASES: FastPathCase[] = [
  {
    name: 'qa-fast-path',
    skill: 'qa',
    label: '/qa fast path (single-observation check)',
    seed: (dir) => {
      fs.writeFileSync(path.join(dir, 'server.js'), `const http = require('http');

http.createServer((req, res) => {
  res.setHeader('X-Request-Id', String(Date.now()));
  res.end('ok');
}).listen(3000);
`);
    },
    ask: 'Check one thing: does server.js still set the X-Request-Id response header? That is the whole check.',
    // Trivial check = report the observation. Naming the file and the header
    // means the probe ran and the verdict came back; ceremony instead of an
    // answer fails here.
    outcome: (_dir, output) =>
      output.includes('server.js') && /X-Request-Id/i.test(output),
    outcomeDesc: 'final message names server.js and the X-Request-Id header (the observation)',
  },
  {
    name: 'review-fast-path',
    skill: 'review',
    label: '/review fast path (typo-only diff)',
    seed: (dir, run) => {
      fs.writeFileSync(path.join(dir, 'usage.md'), 'Run the sever to start.\n');
      run('git', ['add', '.']);
      run('git', ['commit', '-m', 'docs: usage']);
      run('git', ['checkout', '-b', 'docs-typo']);
      fs.writeFileSync(path.join(dir, 'usage.md'), 'Run the server to start.\n');
      run('git', ['add', '.']);
      run('git', ['commit', '-m', 'docs: fix typo']);
    },
    ask: 'Review my branch diff against main.',
    // Reading a tiny diff IS the review: the findings (or "clean") must name
    // the one changed file.
    outcome: (_dir, output) => output.includes('usage.md'),
    outcomeDesc: 'final message names usage.md (the reviewed diff)',
  },
  {
    name: 'ship-fast-path',
    skill: 'ship',
    label: '/ship fast path (one-line doc change, local-only repo)',
    seed: (dir, run) => {
      fs.writeFileSync(path.join(dir, 'README.md'), 'A tiny tool.\n');
      run('git', ['add', '.']);
      run('git', ['commit', '-m', 'init readme']);
      run('git', ['checkout', '-b', 'readme-line']);
      fs.writeFileSync(path.join(dir, 'README.md'), 'A tiny tool. Install with npm.\n');
      run('git', ['add', '.']);
      run('git', ['commit', '-m', 'docs: install line']);
    },
    ask: 'One line added to README.md, already committed on this branch. There is no remote and no PR — take it as far as a local repo allows and tell me what landed.',
    maxTurns: 20,
    // The report is what changed and which checks ran. This repo declares no
    // checks, so naming the changed file is the whole deliverable.
    outcome: (_dir, output) => /README\.md/i.test(output),
    outcomeDesc: 'final message names README.md (what changed / what landed)',
  },
  {
    name: 'debug-fast-path',
    skill: 'debug',
    label: '/debug fast path (already-diagnosed off-by-one)',
    seed: (dir) => {
      fs.writeFileSync(path.join(dir, 'paginate.ts'), PAGINATE);
    },
    ask: 'Fix the off-by-one in paginate in paginate.ts — a trailing partial page is dropped.',
    // The prompt is affirmative mutation authority, so the ideal outcome is the
    // fix applied on disk. Naming file + the wrong-to-right value in one line
    // also passes. Neither is the regression.
    outcome: (dir, output) => {
      const source = fs.readFileSync(path.join(dir, 'paginate.ts'), 'utf-8');
      const appliedOnDisk = /Math\.ceil/.test(source) || !/Math\.floor/.test(source);
      const statedInOutput =
        output.includes('paginate.ts') && /Math\.floor|floor/.test(output);
      return appliedOnDisk || statedInOutput;
    },
    outcomeDesc: 'off-by-one fixed in paginate.ts, or the final message states the line (floor -> ceil)',
  },
];

for (const c of CASES) {
  describeIfSelected(`/${c.skill} Fast Path E2E`, [c.name], () => {
    let workDir: string;

    beforeAll(() => {
      workDir = fs.mkdtempSync(path.join(os.tmpdir(), `skill-e2e-${c.name}-`));
      const run: Run = (cmd, args) => {
        spawnSync(cmd, args, { cwd: workDir, stdio: 'pipe', timeout: 5000 });
      };

      run('git', ['init', '-b', 'main']);
      run('git', ['config', 'user.email', 'test@test.com']);
      run('git', ['config', 'user.name', 'Test']);

      c.seed(workDir, run);

      copyDirSync(path.join(ROOT, 'skills', c.skill), path.join(workDir, c.skill));
    });

    afterAll(() => {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    });

    testConcurrentIfSelected(c.name, async () => {
      const result = await runSkillTest({
        prompt: `Read ${c.skill}/SKILL.md for the /${c.skill} skill instructions and follow them.

The user has invoked /${c.skill} and says: "${c.ask}"

Do NOT use AskUserQuestion — this is non-interactive.`,
        workingDirectory: workDir,
        maxTurns: c.maxTurns ?? 15,
        allowedTools: ['Bash', 'Read', 'Write', 'Edit', 'Grep', 'Glob'],
        timeout: 240_000,
        testName: c.name,
        runId,
      });

      logCost(c.label, result);

      // --- Assertion 2: at most 3 distinct reference modules read. ---
      // Scan Read tool calls (file_path) and Bash commands (cat/sed reads) for
      // anything under <skill>/references/. The trivial fast path mandates
      // zero; <= 3 tolerates a partial dispatch-step-4 read without letting the
      // full legacy-module stack back in.
      const refRe = new RegExp(`${c.skill}/references/[^\\s"'\`)\\]]+`, 'g');
      const refsRead = new Set<string>();
      for (const call of result.toolCalls) {
        const haystack =
          call.tool === 'Read' ? String(call.input?.file_path ?? '') :
          call.tool === 'Bash' ? String(call.input?.command ?? '') : '';
        for (const m of haystack.match(refRe) ?? []) refsRead.add(m);
      }

      // --- Assertion 3: the small result, not a hard block. ---
      const producedResult = c.outcome(workDir, result.output);

      const exitOk = result.exitReason === 'success';
      recordE2E(evalCollector, `/${c.name}`, `${c.skill} trivial-change fast path`, result, {
        passed: exitOk && result.output.length < OUTPUT_CEILING && refsRead.size <= 3 && producedResult,
      });

      // A trivial ask that burns every turn is itself a proportionality
      // failure, so error_max_turns is NOT accepted here.
      expect(exitOk, `expected success, got ${result.exitReason}`).toBe(true);

      // --- Assertion 1: final assistant message under the ceiling. ---
      expect(
        result.output.length,
        `final message is ${result.output.length} chars — a trivial ask must not produce a report`,
      ).toBeLessThan(OUTPUT_CEILING);

      expect(
        refsRead.size,
        `read ${refsRead.size} ${c.skill}/references/ files for a trivial ask: ${[...refsRead].join(', ')}`,
      ).toBeLessThanOrEqual(3);

      expect(
        producedResult,
        `no small result: expected ${c.outcomeDesc}. Output: ${result.output.slice(0, 500)}`,
      ).toBe(true);
    }, 300_000);
  });
}

afterAll(async () => {
  await finalizeEvalCollector(evalCollector);
});
