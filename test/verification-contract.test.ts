/**
 * Static tripwires for the /plan verification contract (thesis: name the check,
 * skip the scaffolding). Free, file IO only.
 *
 * Pins three things a future edit could silently undo:
 *   1. The contract exists and the dispatcher actually routes to it.
 *   2. The anti-gaming clauses survive (author the check first; weakening,
 *      deleting, or regenerating it to pass is a violation; unrun is unverified)
 *      both in the /plan reference and in the SHARED-JUDGMENT rule mirrored to
 *      all five dispatchers.
 *   3. It added no seventh top-level /plan mode and touched no legacy module.
 */
import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const DISPATCHERS = ['plan', 'qa', 'debug', 'review', 'ship'] as const;
const CONTRACT = path.join(ROOT, 'skills', 'plan', 'references', 'VERIFICATION-CONTRACT.md');
const PLAN_SKILL = path.join(ROOT, 'skills', 'plan', 'SKILL.md');

const contract = fs.readFileSync(CONTRACT, 'utf8');
// Prose is hard-wrapped; match against a single-line view so wrapping is not load-bearing.
const flat = contract.replace(/\s+/g, ' ');
const planSkill = fs.readFileSync(PLAN_SKILL, 'utf8');

describe('verification contract: presence and wiring', () => {
  test('the contract reference exists outside references/legacy/', () => {
    expect(fs.existsSync(CONTRACT)).toBe(true);
    expect(CONTRACT).not.toContain(`${path.sep}legacy${path.sep}`);
  });

  test('the /plan dispatch protocol routes to it', () => {
    expect(planSkill).toContain('references/VERIFICATION-CONTRACT.md');
  });

  test('the execution header carries a Verification line after Mutation', () => {
    const mutation = planSkill.indexOf('Mutation: <');
    const verification = planSkill.indexOf('Verification: <');
    const active = planSkill.indexOf('Active modules: <');
    expect(mutation).toBeGreaterThan(-1);
    expect(verification).toBeGreaterThan(mutation);
    expect(active).toBeGreaterThan(verification);
  });

  test('`none` stays a legal header value so the line is not answered by bluffing', () => {
    expect(contract).toContain('`none`');
    expect(planSkill).toContain('`Verification: none`');
  });
});

describe('verification contract: falsifiable and anti-gameable', () => {
  test('the check must be authored before the work starts', () => {
    expect(flat).toMatch(/author the check before the work/i);
    expect(flat).toMatch(/before the first edit/i);
  });

  test('weakening, deleting, or regenerating the check to pass is a violation', () => {
    const clause = flat.match(/Weakening, deleting, regenerating[^.]*\./i)?.[0] ?? '';
    for (const move of ['deleting', 'regenerating', 're-thresholding', 'narrowing', 'skipping']) {
      expect(clause.toLowerCase()).toContain(move);
    }
    expect(clause).toMatch(/contract violation/i);
  });

  test('the check lives outside the mutation boundary and unrun is unverified', () => {
    expect(flat).toMatch(/outside the mutation boundary/i);
    expect(flat).toMatch(/unrun is unverified/i);
    expect(flat).toMatch(/exit code/i);
  });

  test('a check that cannot name input, observable, and threshold is rejected', () => {
    expect(flat).toMatch(/an input, an observable, and a threshold/i);
    expect(flat).toMatch(/"no regressions"/i);
    expect(flat).toMatch(/if no state of the world fails the check/i);
  });

  test('the uncovered axis is named, so a green check cannot stand in for the rest', () => {
    expect(contract).toMatch(/not covered:/);
    expect(flat).toMatch(/does not cover/i);
  });
});

describe('verification contract: the shared claim limit reaches all five dispatchers', () => {
  const rule = (text: string) => text.split('\n').find((l) => l.startsWith('15. ')) ?? '';

  test('SHARED-JUDGMENT rule 15 exists and stays byte-identical across dispatchers', () => {
    const bodies = DISPATCHERS.map((s) =>
      fs.readFileSync(path.join(ROOT, 'skills', s, 'references', 'SHARED-JUDGMENT.md'), 'utf8'),
    );
    expect(new Set(bodies).size).toBe(1);
    const r = rule(bodies[0]);
    expect(r).toMatch(/authored before the work/i);
    expect(r).toMatch(/contract violation/i);
    expect(r).toMatch(/exit code/i);
    expect(r).toMatch(/base branch/i);
    expect(r).toMatch(/not verified/i);
  });
});

describe('verification contract: adds no surface', () => {
  test('/plan still has exactly the six canonical top-level modes', () => {
    const table = planSkill.slice(planSkill.indexOf('## Top-level modes'));
    const modes = [...table.matchAll(/^\| `([A-Z][^`]*)` \|/gm)].map((m) => m[1]);
    expect(modes).toEqual(['Discovery', 'Product', 'Engineering', 'DX', 'Specification', 'Full chain']);
  });

  test('the contract lives at the dispatcher layer, never inside a legacy module', () => {
    const legacy = path.join(ROOT, 'skills', 'plan', 'references', 'legacy');
    const carriers = fs
      .readdirSync(legacy)
      .filter((f) => f.endsWith('.md'))
      .filter((f) => fs.readFileSync(path.join(legacy, f), 'utf8').includes('VERIFICATION-CONTRACT'));
    expect(carriers).toEqual([]);
  });
});
