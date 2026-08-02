/**
 * gstack-slug must never hand two different repositories the same state bucket.
 *
 * Every project-scoped writer resolves its directory the same way: run
 * `eval "$(gstack-slug 2>/dev/null)"`, then write under
 * `projects/${PROJECT_ID:-unknown}`. Because that eval discards stderr, a crash
 * inside gstack-slug is silent: PROJECT_ID stays unset, the `:-unknown` default
 * takes over, and every repository on the machine writes into one shared
 * `projects/unknown/` directory. Two repositories then read each other's state.
 *
 * These tests pin the two properties that keep the buckets apart: distinct
 * directories always get distinct IDs, and an identity that cannot be resolved
 * fails loudly instead of quietly collapsing to "unknown".
 */

import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'bun';
import fs from 'fs';
import os from 'os';
import path from 'path';

const ROOT = path.resolve(__dirname, '..');
const SLUG_BIN = path.join(ROOT, 'bin', 'gstack-slug');
const NODE = Bun.which('node');

/** Parse the KEY=value lines gstack-slug emits for eval. */
function parseSlugOutput(stdout: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const index = line.indexOf('=');
    if (index > 0) values[line.slice(0, index)] = line.slice(index + 1);
  }
  return values;
}

function runSlug(cwd: string, home: string, extraPath?: string) {
  const env: Record<string, string> = { ...process.env, HOME: home, GSTACK_HOME: path.join(home, '.gstack') };
  if (extraPath) env.PATH = extraPath;
  const result = spawnSync([NODE!, SLUG_BIN], { cwd, env });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    values: parseSlugOutput(result.stdout.toString()),
  };
}

/** A throwaway git repository with its own origin remote. */
function makeRepo(home: string, prefix: string, origin: string): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  const git = (...args: string[]) =>
    spawnSync(['git', ...args], { cwd: dir, env: { ...process.env, HOME: home } });
  git('init', '-q');
  git('remote', 'add', 'origin', origin);
  return dir;
}

describe('gstack-slug project isolation', () => {
  test('two repositories never share a state bucket', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gslug-home-'));
    const repoA = makeRepo(home, 'gslug-a-', 'https://example.com/acme/alpha.git');
    const repoB = makeRepo(home, 'gslug-b-', 'https://example.com/acme/beta.git');
    try {
      const a = runSlug(repoA, home);
      const b = runSlug(repoB, home);

      expect(a.exitCode).toBe(0);
      expect(b.exitCode).toBe(0);
      expect(a.values.PROJECT_ID).toBeTruthy();
      expect(b.values.PROJECT_ID).toBeTruthy();
      expect(a.values.PROJECT_ID).not.toBe(b.values.PROJECT_ID);
      expect(a.values.REPO_ID).not.toBe(b.values.REPO_ID);

      // The bucket name is the identity, so neither may be the shared default.
      expect(a.values.PROJECT_ID).not.toBe('unknown');
      expect(b.values.PROJECT_ID).not.toBe('unknown');

      // Re-running in the same repository must land in the same bucket.
      expect(runSlug(repoA, home).values.PROJECT_ID).toBe(a.values.PROJECT_ID);
    } finally {
      for (const dir of [home, repoA, repoB]) fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('an unresolvable identity emits no PROJECT_ID rather than a shared one', () => {
    // Broken git is the one case where no identity can be derived. Emitting any
    // placeholder here would be emitting the same placeholder in every
    // repository, so the contract is to emit nothing and exit nonzero. That is
    // what lets callers trip their own `${PROJECT_ID:?...}` guard.
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gslug-home-'));
    const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gslug-shim-'));
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gslug-nogit-')));
    try {
      fs.writeFileSync(path.join(shimDir, 'git'), '#!/bin/sh\necho "fatal: git is broken" >&2\nexit 2\n', {
        mode: 0o755,
      });

      const out = runSlug(dir, home, `${shimDir}:${path.dirname(NODE!)}`);

      expect(out.exitCode).not.toBe(0);
      expect(out.stdout).not.toContain('PROJECT_ID=');
      expect(out.stdout).not.toContain('unknown');
    } finally {
      for (const target of [home, shimDir, dir]) fs.rmSync(target, { recursive: true, force: true });
    }
  });

  // Static tripwires. The runtime tests above cannot reach the defaulting
  // branch, because a resolved identity is always a non-empty `project_<hex>`.
  // These pin the shape of the code instead, so reintroducing the placeholder
  // fails CI rather than waiting for a machine where the branch is live.
  test('gstack-slug never defaults an identity key to a placeholder', () => {
    const source = fs.readFileSync(SLUG_BIN, 'utf8');
    for (const key of ['PROJECT_ID', 'REPO_ID', 'WORKTREE_ID']) {
      const line = source.split('\n').find((l) => l.includes(`"${key}"`) && l.includes('identity.'));
      expect(line).toBeDefined();
      expect(line).not.toMatch(/\|\|\s*["']/);
    }
  });

  test('no project-state writer in bin or lib defaults PROJECT_ID', () => {
    // This is the cross-repo collision shape: `${PROJECT_ID:-unknown}` resolves
    // to the same directory name in every repository on the machine. Helpers
    // must use the failing `${PROJECT_ID:?...}` form instead.
    const offenders: string[] = [];
    for (const dir of ['bin', 'lib']) {
      for (const entry of fs.readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })) {
        if (!entry.isFile()) continue;
        const file = path.join(entry.parentPath ?? entry.path, entry.name);
        let source: string;
        try {
          source = fs.readFileSync(file, 'utf8');
        } catch {
          continue;
        }
        // `:-` supplies a default; `:?` fails. Only the second is safe here.
        if (/\$\{PROJECT_ID:-/.test(source)) offenders.push(path.relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  test('identity keys are never emitted as the shared "unknown" bucket', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gslug-home-'));
    // A bare directory with no remote and no branch: SLUG and BRANCH may fall
    // back to "unknown", but the three identity keys may not.
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gslug-bare-')));
    try {
      const out = runSlug(dir, home);
      expect(out.exitCode).toBe(0);
      for (const key of ['PROJECT_ID', 'REPO_ID', 'WORKTREE_ID']) {
        expect(out.values[key]).toBeTruthy();
        expect(out.values[key]).not.toBe('unknown');
      }
    } finally {
      for (const target of [home, dir]) fs.rmSync(target, { recursive: true, force: true });
    }
  });
});
