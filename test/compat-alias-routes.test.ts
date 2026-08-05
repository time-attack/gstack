/**
 * Every compatibility alias must route somewhere that exists.
 *
 * The 1.x tree at the repo root is deleted, so `skills/.compat/<name>/SKILL.md`
 * is the only thing standing between a user who types an old command and a
 * dead end. Each alias claims a route like
 * `$plan --mode Discovery --module office-hours`. If the dispatcher or the
 * module behind that claim is missing, the user gets an agent confidently
 * dispatching into nothing.
 *
 * This is the check that would have caught the routes left dangling when a
 * legacy module was cut without its alias.
 */
import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { installLegacySkill } from './helpers/e2e-helpers';

const ROOT = path.resolve(import.meta.dir, '..');
const COMPAT = path.join(ROOT, 'skills', '.compat');

const aliases = fs.existsSync(COMPAT)
  ? fs
      .readdirSync(COMPAT, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .filter((n) => fs.existsSync(path.join(COMPAT, n, 'SKILL.md')))
      .sort()
  : [];

describe('compat alias routes', () => {
  test('there are aliases to check', () => {
    expect(aliases.length).toBeGreaterThan(0);
  });

  for (const name of aliases) {
    test(`/${name} routes to a dispatcher and module that exist`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `compat-${name}-`));
      try {
        // Throws with a precise message on a missing dispatcher or module.
        const route = installLegacySkill(dir, name);

        expect(route.name).toBe(name);
        expect(['plan', 'qa', 'debug', 'review', 'ship']).toContain(route.dispatcher);
        expect(route.mode.length).toBeGreaterThan(0);

        // The alias landed under its old name, so old prompts still resolve.
        expect(fs.existsSync(path.join(dir, name, 'SKILL.md'))).toBe(true);
        // And the dispatcher it points at came with it.
        expect(fs.existsSync(path.join(dir, 'skills', route.dispatcher, 'SKILL.md'))).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  test('an alias naming a module that does not exist is rejected, not skipped', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-bogus-'));
    try {
      expect(() => installLegacySkill(dir, 'no-such-alias-xyz')).toThrow(/no compat alias/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
