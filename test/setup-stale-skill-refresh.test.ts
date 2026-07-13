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
      expect(body).toContain('if [ ! -L "$target" ] && [ -e "$target" ]; then');
      expect(body).toContain('rm -rf "$target"');
      // Link sites must route through the helper (Windows fallback invariant).
      expect(body).toContain('_link_or_copy "$skill_dir" "$target"');
    });
  }
});
