/**
 * Unit tests for diff-based test selection.
 * Free (no API calls), runs with `bun test`.
 */

import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  matchGlob,
  selectTests,
  detectBaseBranch,
  E2E_TOUCHFILES,
  E2E_TIERS,
  LLM_JUDGE_TOUCHFILES,
  GLOBAL_TOUCHFILES,
} from './helpers/touchfiles';

const ROOT = path.resolve(import.meta.dir, '..');

// --- matchGlob ---

describe('matchGlob', () => {
  test('** matches any depth of path segments', () => {
    expect(matchGlob('browse/src/commands.ts', 'browse/src/**')).toBe(true);
    expect(matchGlob('browse/src/deep/nested/file.ts', 'browse/src/**')).toBe(true);
    expect(matchGlob('browse/src/cli.ts', 'browse/src/**')).toBe(true);
  });

  test('** does not match unrelated paths', () => {
    expect(matchGlob('browse/src/commands.ts', 'qa/**')).toBe(false);
    expect(matchGlob('review/SKILL.md', 'qa/**')).toBe(false);
  });

  test('exact match works', () => {
    expect(matchGlob('SKILL.md', 'SKILL.md')).toBe(true);
    expect(matchGlob('SKILL.md.tmpl', 'SKILL.md')).toBe(false);
    expect(matchGlob('qa/SKILL.md', 'SKILL.md')).toBe(false);
  });

  test('* matches within a single segment', () => {
    expect(matchGlob('test/fixtures/review-eval-enum.rb', 'test/fixtures/review-eval-enum*.rb')).toBe(true);
    expect(matchGlob('test/fixtures/review-eval-enum-diff.rb', 'test/fixtures/review-eval-enum*.rb')).toBe(true);
    expect(matchGlob('test/fixtures/review-eval-vuln.rb', 'test/fixtures/review-eval-enum*.rb')).toBe(false);
  });

  test('dots in patterns are escaped correctly', () => {
    expect(matchGlob('SKILL.md', 'SKILL.md')).toBe(true);
    expect(matchGlob('SKILLxmd', 'SKILL.md')).toBe(false);
  });

  test('** at end matches files in the directory', () => {
    expect(matchGlob('qa/SKILL.md', 'qa/**')).toBe(true);
    expect(matchGlob('qa/SKILL.md.tmpl', 'qa/**')).toBe(true);
    expect(matchGlob('qa/templates/report.md', 'qa/**')).toBe(true);
  });
});

// --- selectTests ---

describe('selectTests', () => {
  test('browse/src change selects browse and qa tests', () => {
    const result = selectTests(['browse/src/commands.ts'], E2E_TOUCHFILES);
    expect(result.selected).toContain('browse-basic');
    expect(result.selected).toContain('browse-snapshot');
    expect(result.selected).toContain('qa-quick');
    expect(result.selected).toContain('qa-fix-loop');
    expect(result.reason).toBe('diff');
    // Should NOT include unrelated tests
    expect(result.selected).not.toContain('review-sql-injection');
    expect(result.selected).not.toContain('plan-ceo-review');
    expect(result.selected).not.toContain('retro');
    expect(result.selected).not.toContain('document-release');
  });

  test('module-specific change selects only that module and related tests', () => {
    // GStack 2 probe: the 1.x `plan-ceo-review/` dir is gone. The CEO judgment
    // now lives at skills/plan/references/legacy/plan-ceo-review.md, and that
    // file is what a CEO-review change actually touches.
    const result = selectTests(
      ['skills/plan/references/legacy/plan-ceo-review.md'],
      E2E_TOUCHFILES,
    );
    const expected = [
      'plan-ceo-review',
      'plan-ceo-review-selective',
      'plan-ceo-review-benefits',
      'plan-ceo-review-expansion-energy',
      'plan-ceo-review-plan-mode',
      'plan-mode-no-op',
      'auto-decide-preserved',
      'auq-format-gate',
      'plan-ceo-mode-routing',
      'plan-ceo-section-loading',
      'autoplan-chain-pty',
      'plan-ceo-finding-count',
      // Drives the public /plan surface via 'skills/plan/**', which the module
      // path is inside — so unlike in 1.x, the floor test IS selected here.
      'plan-ceo-finding-floor',
      'plan-ceo-split-overflow',
      'plan-ceo-review-format-mode',
      'plan-ceo-review-format-approach',
      'plan-ceo-review-prosons-cadence',
      'plan-review-prosons-format',
      'plan-review-prosons-hardstop-neg',
      'plan-review-prosons-neutral-neg',
      'plan-proportionality',
      'codex-offered-ceo-review',
    ];
    expect([...result.selected].sort()).toEqual([...expected].sort());
    expect(result.selected.length).toBe(22);
    expect(result.skipped.length).toBe(Object.keys(E2E_TOUCHFILES).length - 22);
    // Unrelated dispatchers stay out.
    expect(result.selected).not.toContain('retro');
    expect(result.selected).not.toContain('cso-full-audit');
    expect(result.selected).not.toContain('ship-base-branch');
  });

  test('global touchfile triggers ALL tests', () => {
    const result = selectTests(['test/helpers/session-runner.ts'], E2E_TOUCHFILES);
    expect(result.selected.length).toBe(Object.keys(E2E_TOUCHFILES).length);
    expect(result.skipped.length).toBe(0);
    expect(result.reason).toContain('global');
  });

  test('the shared question-format reference is scoped, not global', () => {
    // QUESTION-FORMAT.md is the GStack 2 successor to the deleted
    // scripts/resolvers/preamble/generate-ask-user-format.ts: many skills
    // inherit it, but it must not behave like a GLOBAL_TOUCHFILES entry.
    const result = selectTests(['skills/plan/references/QUESTION-FORMAT.md'], E2E_TOUCHFILES);
    expect(result.reason).toBe('diff');
    expect(result.selected.length).toBe(39);
    expect(result.selected.length).toBeLessThan(Object.keys(E2E_TOUCHFILES).length);
    // Tests whose question cadence the reference governs
    expect(result.selected).toContain('session-awareness');
    expect(result.selected).toContain('plan-ceo-review-plan-mode');
    expect(result.selected).toContain('qa-prosons-format');
    // Tests that do not read it
    expect(result.selected).not.toContain('retro');
    expect(result.selected).not.toContain('cso-full-audit');
    expect(result.selected).not.toContain('browse-basic');
  });

  test('unrelated file selects nothing', () => {
    const result = selectTests(['README.md'], E2E_TOUCHFILES);
    expect(result.selected).toEqual([]);
    expect(result.skipped.length).toBe(Object.keys(E2E_TOUCHFILES).length);
  });

  test('empty changed files selects nothing', () => {
    const result = selectTests([], E2E_TOUCHFILES);
    expect(result.selected).toEqual([]);
  });

  test('multiple changed files union their selections', () => {
    const result = selectTests(
      [
        'skills/plan/references/legacy/plan-ceo-review.md',
        'skills/plan/references/legacy/retro.md',
      ],
      E2E_TOUCHFILES,
    );
    expect(result.selected).toContain('plan-ceo-review');
    expect(result.selected).toContain('plan-ceo-review-selective');
    expect(result.selected).toContain('retro');
    expect(result.selected).toContain('retro-base-branch');
    // 22 from the CEO module + retro/retro-base-branch. The two /plan-wide
    // entries (plan-proportionality, plan-ceo-finding-floor) are already in
    // the CEO set, so the union is 24, not 26.
    expect(result.selected.length).toBe(24);
  });

  test('works with LLM_JUDGE_TOUCHFILES', () => {
    // The 1.x qa/SKILL.md monolith is gone; the three QA rubrics all judge
    // skills/qa/references/legacy/qa.md.
    const result = selectTests(['skills/qa/references/legacy/qa.md'], LLM_JUDGE_TOUCHFILES);
    expect(result.selected).toContain('qa/SKILL.md workflow');
    expect(result.selected).toContain('qa/SKILL.md health rubric');
    expect(result.selected).toContain('qa/SKILL.md anti-refusal');
    expect(result.selected.length).toBe(3);
  });

  test('a dispatcher SKILL.md selects every test routed through it', () => {
    const result = selectTests(['skills/plan/SKILL.md'], E2E_TOUCHFILES);
    // The dispatcher gates every /plan specialist, so its blast radius is wide
    // but bounded — it must not reach the other four dispatchers' tests.
    expect(result.selected.length).toBe(57);
    expect(result.selected).toContain('plan-ceo-review');
    expect(result.selected).toContain('plan-eng-review');
    expect(result.selected).toContain('office-hours-spec-review');
    expect(result.selected).toContain('journey-ideation');
    expect(result.selected).not.toContain('browse-basic');
    expect(result.selected).not.toContain('cso-full-audit');
    expect(result.selected).not.toContain('ship-base-branch');
    expect(result.selected).not.toContain('qa-quick');
  });

  test('global touchfiles work for LLM-judge tests too', () => {
    const result = selectTests(['test/helpers/session-runner.ts'], LLM_JUDGE_TOUCHFILES);
    expect(result.selected.length).toBe(Object.keys(LLM_JUDGE_TOUCHFILES).length);
  });
});

// --- detectBaseBranch ---

describe('detectBaseBranch', () => {
  test('detects local main branch', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touchfiles-test-'));
    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: dir, stdio: 'pipe', timeout: 5000 });

    run('git', ['init']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(dir, 'test.txt'), 'hello\n');
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'init']);

    const result = detectBaseBranch(dir);
    // Should find 'main' (or 'master' depending on git default)
    expect(result).toMatch(/^(main|master)$/);

    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test('returns null for empty repo with no branches', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touchfiles-test-'));
    const run = (cmd: string, args: string[]) =>
      spawnSync(cmd, args, { cwd: dir, stdio: 'pipe', timeout: 5000 });

    run('git', ['init']);
    // No commits = no branches
    const result = detectBaseBranch(dir);
    expect(result).toBeNull();

    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  test('returns null for non-git directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'touchfiles-test-'));
    const result = detectBaseBranch(dir);
    expect(result).toBeNull();

    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  });
});

// --- Completeness: every testName in skill-e2e-*.test.ts has a TOUCHFILES entry ---

describe('TOUCHFILES completeness', () => {
  // The failure this guards is silent and total: GStack 2 deleted the 1.x skill
  // tree at the repo root, and every entry here kept keying on `ship/**`,
  // `retro/**`, `plan-ceo-review/**`, `scripts/gen-skill-docs.ts` and friends.
  // Those globs can never match again, so `bun run test:evals` selected nothing
  // and reported a clean skip forever. A pattern that matches no tracked file is
  // dead weight at best and zeroed coverage at worst — fail on it.
  test('every touchfile pattern matches at least one tracked file', () => {
    const tracked = spawnSync('git', ['ls-files'], {
      cwd: ROOT, stdio: 'pipe', timeout: 20_000, maxBuffer: 64 * 1024 * 1024,
    }).stdout.toString().trim().split('\n').filter(Boolean);
    expect(tracked.length).toBeGreaterThan(0);

    const dead: string[] = [];
    const maps: [string, Record<string, string[]>][] = [
      ['E2E_TOUCHFILES', E2E_TOUCHFILES],
      ['LLM_JUDGE_TOUCHFILES', LLM_JUDGE_TOUCHFILES],
    ];
    for (const [mapName, map] of maps) {
      for (const [testName, patterns] of Object.entries(map)) {
        expect(patterns.length, `${mapName}['${testName}'] has no patterns`).toBeGreaterThan(0);
        for (const p of patterns) {
          if (!tracked.some(f => matchGlob(f, p))) dead.push(`${mapName}['${testName}'] -> ${p}`);
        }
      }
    }
    for (const p of GLOBAL_TOUCHFILES) {
      if (!tracked.some(f => matchGlob(f, p))) dead.push(`GLOBAL_TOUCHFILES -> ${p}`);
    }

    if (dead.length > 0) {
      throw new Error(
        `Touchfile patterns that can never match a tracked file:\n  ${dead.join('\n  ')}\n\n` +
        `Repoint them at the shipped path (skills/<dispatcher>/... ) or remove the entry. ` +
        `A dead pattern means the paid test it guards is never selected again.`,
      );
    }
  });

  test('every E2E testName has a TOUCHFILES entry', () => {
    // Read all split E2E test files
    const testDir = path.join(ROOT, 'test');
    const e2eFiles = fs.readdirSync(testDir).filter(f => f.startsWith('skill-e2e-') && f.endsWith('.test.ts'));
    let e2eContent = '';
    for (const f of e2eFiles) {
      e2eContent += fs.readFileSync(path.join(testDir, f), 'utf-8') + '\n';
    }

    // Extract all testName: 'value' entries
    const testNameRegex = /testName:\s*['"`]([^'"`]+)['"`]/g;
    const testNames: string[] = [];
    let match;
    while ((match = testNameRegex.exec(e2eContent)) !== null) {
      let name = match[1];
      // Handle template literals like `qa-${label}` — these expand to
      // qa-b6-static, qa-b7-spa, qa-b8-checkout
      if (name.includes('${')) continue; // skip template literals, check expanded forms below
      testNames.push(name);
    }

    // Add the template-expanded testNames from runPlantedBugEval calls
    const plantedBugRegex = /runPlantedBugEval\([^,]+,\s*[^,]+,\s*['"`]([^'"`]+)['"`]\)/g;
    while ((match = plantedBugRegex.exec(e2eContent)) !== null) {
      testNames.push(`qa-${match[1]}`);
    }

    expect(testNames.length).toBeGreaterThan(0);

    const missing = testNames.filter(name => !(name in E2E_TOUCHFILES));
    if (missing.length > 0) {
      throw new Error(
        `E2E tests missing TOUCHFILES entries: ${missing.join(', ')}\n` +
        `Add these to E2E_TOUCHFILES in test/helpers/touchfiles.ts`,
      );
    }
  });

  test('E2E_TIERS covers exactly the same tests as E2E_TOUCHFILES', () => {
    const touchfileKeys = new Set(Object.keys(E2E_TOUCHFILES));
    const tierKeys = new Set(Object.keys(E2E_TIERS));

    const missingFromTiers = [...touchfileKeys].filter(k => !tierKeys.has(k));
    const extraInTiers = [...tierKeys].filter(k => !touchfileKeys.has(k));

    if (missingFromTiers.length > 0) {
      throw new Error(
        `E2E tests missing TIER entries: ${missingFromTiers.join(', ')}\n` +
        `Add these to E2E_TIERS in test/helpers/touchfiles.ts`,
      );
    }
    if (extraInTiers.length > 0) {
      throw new Error(
        `E2E_TIERS has extra entries not in E2E_TOUCHFILES: ${extraInTiers.join(', ')}\n` +
        `Remove these from E2E_TIERS or add to E2E_TOUCHFILES`,
      );
    }
  });

  test('E2E_TIERS only contains valid tier values', () => {
    const validTiers = ['gate', 'periodic'];
    for (const [name, tier] of Object.entries(E2E_TIERS)) {
      if (!validTiers.includes(tier)) {
        throw new Error(`E2E_TIERS['${name}'] has invalid tier '${tier}'. Valid: ${validTiers.join(', ')}`);
      }
    }
  });

  test('every LLM-judge test has a TOUCHFILES entry', () => {
    const llmContent = fs.readFileSync(
      path.join(ROOT, 'test', 'skill-llm-eval.test.ts'),
      'utf-8',
    );

    // Extract test names from addTest({ name: '...' }) calls
    const nameRegex = /name:\s*['"`]([^'"`]+)['"`]/g;
    const testNames: string[] = [];
    let match;
    while ((match = nameRegex.exec(llmContent)) !== null) {
      testNames.push(match[1]);
    }

    // Deduplicate (some tests call addTest with the same name)
    const unique = [...new Set(testNames)];
    expect(unique.length).toBeGreaterThan(0);

    const missing = unique.filter(name => !(name in LLM_JUDGE_TOUCHFILES));
    if (missing.length > 0) {
      throw new Error(
        `LLM-judge tests missing TOUCHFILES entries: ${missing.join(', ')}\n` +
        `Add these to LLM_JUDGE_TOUCHFILES in test/helpers/touchfiles.ts`,
      );
    }
  });
});
