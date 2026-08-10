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

  // Fully retired aliases carry no dispatcher route on purpose: their job is
  // to say so and point at the surviving surface. Each must name the installer
  // fallback and reproduce no judgment.
  const retired = new Set(['gstack']);

  for (const name of aliases.filter((n) => retired.has(n))) {
    test(`/${name} declares retirement and points at the surviving surface`, () => {
      const body = fs.readFileSync(path.join(COMPAT, name, 'SKILL.md'), 'utf-8');
      expect(body).toMatch(/retired/i);
      expect(body).toContain('npx skills add time-attack/gstack/skills');
      for (const d of ['$plan', '$qa', '$debug', '$review', '$ship']) expect(body).toContain(d);
      // No route means no module to copy from; the body must stay a pointer.
      expect(body.length).toBeLessThan(1500);
    });
  }

  for (const name of aliases.filter((n) => !retired.has(n))) {
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

  /**
   * The aliases are only half the surface. A legacy module's own prose also
   * tells the agent to dispatch ("User asks about X -> invoke `$qa --mode
   * Report --module benchmark`"). When a module is cut, those sentences are
   * what strand the agent mid-dispatch, and no alias test sees them.
   *
   * Five were live when the 1.x tree came out: benchmark, skillify and
   * gstack-upgrade pointed at cut modules, and canary pointed at $qa after
   * the module moved to $ship.
   */
  test('every $dispatcher --module route in skills/ points at a module that exists', () => {
    const routes = new Map<string, string[]>();

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.md')) {
          const body = fs.readFileSync(full, 'utf-8');
          const re = /\$(plan|qa|debug|review|ship)\s+--mode\s+[A-Za-z-]+\s+--module\s+([a-z0-9-]+)/g;
          for (const m of body.matchAll(re)) {
            const [, dispatcher, moduleName] = m;
            const target = path.join(ROOT, 'skills', dispatcher, 'references', 'legacy', `${moduleName}.md`);
            if (!fs.existsSync(target)) {
              const key = `$${dispatcher} --module ${moduleName}`;
              routes.set(key, [...(routes.get(key) ?? []), path.relative(ROOT, full)]);
            }
          }
        }
      }
    };
    walk(path.join(ROOT, 'skills'));

    const dangling = [...routes.entries()].map(([r, files]) => `${r}  (in ${files.join(', ')})`);
    expect(dangling, `routes point at modules that do not exist:\n  ${dangling.join('\n  ')}`).toEqual([]);
  });

  test('an alias naming a module that does not exist is rejected, not skipped', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat-bogus-'));
    try {
      expect(() => installLegacySkill(dir, 'no-such-alias-xyz')).toThrow(/no compat alias/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
