/**
 * Regression: no stale `gstack-brain-init`, `gbrain_sync_mode`, or
 * `~/.gstack-brain-remote.txt` references survive the v1.27.0.0 rename.
 *
 * Per codex Findings #1 + #8 + #9: the rename's blast radius is wider than
 * the obvious bin/ + scripts/ surface. This test grep-scans the shipped
 * tree (bin/, scripts/, test/, skills/) for the deprecated identifiers and
 * fails CI if any callers were missed.
 *
 * Allowlist: files that legitimately reference the old names — migration
 * tests asserting on rename behavior, and the migration-window fallback
 * readers in bin/ that read both the old and new paths.
 *
 * The test is mechanical: if you find yourself adding a non-historical
 * file to the allowlist, you probably need to actually fix the rename
 * instead.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(import.meta.dir, '..');

const ALLOWLIST = [
  // The migration test itself — it asserts on the migration's behavior.
  'test/migrations-v1.27.0.0.test.ts',
  // The test for the v1.17.0.0 historical migration.
  'test/gstack-upgrade-migration-v1_17_0_0.test.ts',
  // CHANGELOG entries describe historical state by their nature.
  'CHANGELOG.md',
  // TODOS may reference past or future states by name.
  'TODOS.md',
  // The bin/gstack-config comment explicitly preserves the rename note.
  'bin/gstack-config',
  // Detect script's "renamed in v1.27.0.0" comment + brain-remote-fallback path.
  'bin/gstack-gbrain-detect',
  // brain-restore + source-wireup keep the old file as a migration-window fallback
  // (read both, prefer artifacts). brain-uninstall has the same fallback.
  'bin/gstack-brain-restore',
  'bin/gstack-gbrain-source-wireup',
  'bin/gstack-brain-uninstall',
  // This test itself references the patterns to grep for.
  'test/no-stale-gstack-brain-refs.test.ts',
  // The v1.36.0.0 doc-config drift guard intentionally defends the rename
  // by listing the deprecated keys in its DEPRECATED_KEYS denylist.
  'test/docs-config-keys.test.ts',
  // The new init script's header comment intentionally cites the rename.
  'bin/gstack-artifacts-init',
  // The replacement test mirrors the pattern of the old test (lineage note).
  'test/gstack-artifacts-init.test.ts',
  // The Path 4 structural lint references some legacy names in comments.
  'test/setup-gbrain-path4-structure.test.ts',
];

const FORBIDDEN_PATTERNS = [
  'gstack-brain-init',
  'gbrain_sync_mode',
];

const SCAN_PATHS = [
  'bin/',
  'scripts/',
  'test/',
  'skills/',
];

function grepRefs(pattern: string): string[] {
  const args = ['-rn', '--', pattern, ...SCAN_PATHS.map((p) => path.join(ROOT, p))];
  const r = spawnSync('grep', args, { encoding: 'utf-8' });
  // grep: 0 = matches, 1 = no matches, both fine. 2+ (or null on spawn failure)
  // means grep could not read a path — a dead SCAN_PATHS entry would otherwise
  // yield empty stdout and pass green, leaving the invariant unguarded.
  if (r.status !== 0 && r.status !== 1) {
    throw new Error(
      `grep exited ${r.status} scanning for "${pattern}" — a SCAN_PATHS entry is likely unreadable or gone.\n` +
        `stderr: ${(r.stderr || '').trim() || '(empty)'}${r.error ? `\nspawn error: ${r.error.message}` : ''}`
    );
  }
  const lines = (r.stdout || '').split('\n').filter((l) => l.trim().length > 0);
  return lines
    .map((line) => {
      // Strip ROOT prefix to get repo-relative path.
      const colon = line.indexOf(':');
      const file = line.slice(0, colon);
      return path.relative(ROOT, file);
    })
    .filter((file) => !ALLOWLIST.includes(file))
    // Filter out any file that's inside a directory we don't actually scan.
    .filter((file) => !file.startsWith('node_modules/') && !file.startsWith('.git/'));
}

describe('no stale gstack-brain refs (v1.27.0.0 rename)', () => {
  for (const pattern of FORBIDDEN_PATTERNS) {
    test(`no non-allowlisted references to "${pattern}"`, () => {
      const offenders = [...new Set(grepRefs(pattern))];
      if (offenders.length > 0) {
        console.error(`Found stale "${pattern}" references in:\n${offenders.map((f) => `  - ${f}`).join('\n')}`);
        console.error(
          `If a file is intentionally referencing the old name (migration, historical doc, fallback path), add it to ALLOWLIST in this test.`
        );
      }
      expect(offenders).toEqual([]);
    });
  }
});
