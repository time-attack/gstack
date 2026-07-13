import { describe, test, expect } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';

// Static invariant for #900: re-running ./setup must REFRESH skill installs,
// not silently skip them. The old guard `[ -L "$target" ] || [ ! -e "$target" ]`
// skipped any target that existed as a real directory — which is exactly what
// _link_or_copy creates on Windows — so Windows (and migrated) installs never
// picked up new skill content after `git pull`.

const ROOT = path.resolve(import.meta.dir, '..');
const SETUP = fs.readFileSync(path.join(ROOT, 'setup'), 'utf-8');

function functionBody(name: string): string {
  const start = SETUP.indexOf(`${name}() {`);
  expect(start).toBeGreaterThan(-1);
  const end = SETUP.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return SETUP.slice(start, end);
}

describe('setup: per-skill link loops refresh stale installs (#900)', () => {
  for (const fn of ['link_codex_skill_dirs', 'link_factory_skill_dirs', 'link_opencode_skill_dirs']) {
    test(`${fn} replaces stale real dirs and relinks unconditionally`, () => {
      const body = functionBody(fn);
      // The old skip-guard must be gone…
      expect(body).not.toContain('if [ -L "$target" ] || [ ! -e "$target" ]; then');
      // …replaced by: remove real (non-symlink) targets, then always relink.
      const stale = body.indexOf('if [ ! -L "$target" ] && [ -e "$target" ]; then');
      const gate = body.indexOf(`grep -q '(gstack)' "$target/SKILL.md"`);
      const rm = body.indexOf('rm -rf "$target"');
      const link = body.indexOf('_link_or_copy "$skill_dir" "$target"');
      // Structural assertions, not just substring presence: rm -rf must sit
      // INSIDE the provenance gate, which sits inside the stale-dir branch,
      // and the relink through the helper comes after all of it.
      expect(stale).toBeGreaterThan(-1);
      expect(gate).toBeGreaterThan(stale);
      expect(rm).toBeGreaterThan(gate);
      expect(link).toBeGreaterThan(rm);
      // Deletion requires the generated-by-gstack marker, not bare SKILL.md —
      // a user-authored skill sharing the name is never destroyed.
      expect(body).toContain(`[ -f "$target/SKILL.md" ] && grep -q '(gstack)' "$target/SKILL.md"`);
    });
  }
});
