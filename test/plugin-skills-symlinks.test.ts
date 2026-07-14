/**
 * Plugin marketplace symlink integrity (.claude-plugin + skills/).
 *
 * The Claude Code plugin install discovers skills through the skills/
 * directory of symlinks. Two failure modes this pins:
 *   1. Drift — a new top-level skill lands without a skills/ symlink and
 *      silently never ships to plugin users.
 *   2. Breakage — a skill is renamed/removed and its symlink dangles.
 *
 * connect-chrome is deliberately excluded: it is a backwards-compat alias
 * whose SKILL.md frontmatter name is `open-gstack-browser`, so linking both
 * would create two plugin skills with the same name.
 */
import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(import.meta.dir, '..');
const SKILLS_DIR = path.join(ROOT, 'skills');
const EXCLUDED = new Set(['connect-chrome']);

const topLevelSkills = fs
  .readdirSync(ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory() || e.isSymbolicLink())
  .map((e) => e.name)
  .filter((n) => fs.existsSync(path.join(ROOT, n, 'SKILL.md')))
  .filter((n) => !EXCLUDED.has(n))
  .sort();

describe('plugin skills/ symlinks', () => {
  test('every top-level skill has a skills/ symlink (no silent plugin drift)', () => {
    const linked = fs.readdirSync(SKILLS_DIR).sort();
    expect(linked).toEqual(topLevelSkills);
  });

  test('every skills/ entry is a symlink resolving to a SKILL.md', () => {
    for (const entry of fs.readdirSync(SKILLS_DIR)) {
      const p = path.join(SKILLS_DIR, entry);
      expect(fs.lstatSync(p).isSymbolicLink()).toBe(true);
      expect(fs.existsSync(path.join(p, 'SKILL.md'))).toBe(true);
    }
  });

  test('no two plugin skills share a frontmatter name', () => {
    const seen = new Map<string, string>();
    for (const entry of fs.readdirSync(SKILLS_DIR)) {
      const head = fs.readFileSync(path.join(SKILLS_DIR, entry, 'SKILL.md'), 'utf-8').slice(0, 2000);
      const name = head.match(/^name:\s*(\S+)/m)?.[1] ?? entry;
      expect(seen.has(name) ? `${name} in both ${seen.get(name)} and ${entry}` : '').toBe('');
      seen.set(name, entry);
    }
  });
});
