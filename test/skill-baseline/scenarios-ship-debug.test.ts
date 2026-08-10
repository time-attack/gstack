/**
 * Free, deterministic self-check for the ship + debug ablation scenarios.
 *
 * No API key, no model call, no network. Everything here is fs + git.
 *
 * The load-bearing assertion is `materialize writes every file the ground truth
 * names`. A scenario whose `expected` regex points at a file it never wrote
 * scores every arm as a miss, which drags the whole study toward the false
 * conclusion that the modules are dead weight. A finding about a file that is
 * MISSING on purpose (no baseline captured, no regression test) must therefore
 * be phrased without a path token, so absence is still expressible.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ROOT, walkFiles } from './tree';
import { shipScenarios } from './scenarios-ship';
import { debugScenarios } from './scenarios-debug';
import type { Scenario } from './scenarios';

const all: Scenario[] = [...shipScenarios, ...debugScenarios];

const tmpRoots: string[] = [];
afterAll(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

function materializeOnce(s: Scenario): { dir: string; files: string[] } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-baseline-'));
  tmpRoots.push(dir);
  s.materialize(dir);
  return { dir, files: walkFiles(dir) };
}

/**
 * File paths named inside a regex source. `\.` is the only escape that matters
 * for path shapes; the extension list is what keeps version strings like
 * `1\.5\.0\.0` from being read as paths.
 */
const EXTS = 'ts|tsx|js|jsx|json|jsonl|md|sh|swift|sql|yml|yaml|txt|log|png|rb|py|css|html|toml|out';
const PATH_IN_REGEX = new RegExp(`[\\w./-]+\\.(?:${EXTS})\\b`, 'g');

export function pathsNamedBy(regexSource: string): string[] {
  const plain = regexSource.split('\\.').join('.');
  return [...new Set(plain.match(PATH_IN_REGEX) ?? [])];
}

/** Lenient on purpose: a suffix match resolves, a typo does not. */
function resolves(cited: string, files: string[]): boolean {
  const norm = cited.replace(/^[./]+/, '');
  return files.some((f) => f === cited || f.endsWith(norm) || f.includes(norm));
}

describe('ship + debug scenario shape', () => {
  test('every scenario has a unique id, prefixed by its family', () => {
    const ids = all.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of all) expect(s.id.startsWith(`${s.skill}-`)).toBe(true);
  });

  test('every scenario is a ship or debug scenario with a real task', () => {
    for (const s of all) {
      expect(['ship', 'debug']).toContain(s.skill);
      expect(s.task.trim().length).toBeGreaterThan(40);
      // The task must not name an arm, a module, or the skill tree: the arms
      // differ only in the tree, never in the prompt.
      expect(s.task).not.toMatch(/gstack|skill tree|ablat|legacy\//i);
    }
  });

  test('every scenario names an ablation target that exists in the repo', () => {
    for (const s of all) {
      expect(s.source.length).toBeGreaterThan(0);
      for (const rel of s.source) {
        expect(fs.existsSync(path.join(ROOT, rel))).toBe(true);
      }
    }
  });

  test('every scenario has at least one expected finding and at least one trap', () => {
    for (const s of all) {
      expect(s.truth.expected.length).toBeGreaterThan(0);
      expect(s.truth.traps.length).toBeGreaterThan(0);
    }
  });

  test('expected and trap ids are unique within a scenario', () => {
    for (const s of all) {
      const ids = [...s.truth.expected.map((e) => e.id), ...s.truth.traps.map((t) => t.id)];
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('every match compiles as a case-insensitive regex', () => {
    for (const s of all) {
      for (const m of [...s.truth.expected, ...s.truth.traps]) {
        expect(() => new RegExp(m.match, 'i')).not.toThrow();
        expect(m.match.length).toBeGreaterThan(2);
      }
    }
  });

  test('every trap carries a note saying why the seeded finding is correct', () => {
    for (const s of all) {
      for (const t of s.truth.traps) expect((t.note ?? '').length).toBeGreaterThan(10);
    }
  });
});

describe('ship + debug fixtures materialize what the ground truth names', () => {
  // One materialization per scenario, reused by every assertion below.
  const fixtures = new Map<string, { dir: string; files: string[] }>();
  for (const s of all) fixtures.set(s.id, materializeOnce(s));

  test('materialize writes a real fixture into the directory', () => {
    for (const s of all) {
      // Only files outside .git count: a bare `git init` must not pass as a fixture.
      const real = fixtures.get(s.id)!.files.filter((x) => !x.startsWith('.git/'));
      expect(real.length).toBeGreaterThanOrEqual(3);
    }
  });

  test('every file path named by an expected or trap regex was written', () => {
    const broken: string[] = [];
    for (const s of all) {
      const { files } = fixtures.get(s.id)!;
      for (const m of [...s.truth.expected, ...s.truth.traps]) {
        for (const cited of pathsNamedBy(m.match)) {
          if (!resolves(cited, files)) broken.push(`${s.id} / ${m.id}: ${cited}`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test('every trap regex actually matches something in the fixture it guards', () => {
    // A trap nobody can trip measures nothing. The trap token must appear in a
    // fixture path or in a fixture file's contents.
    const inert: string[] = [];
    for (const s of all) {
      const { dir, files } = fixtures.get(s.id)!;
      const haystack = files
        .filter((rel) => !rel.startsWith('.git/'))
        .map((rel) => rel + '\n' + fs.readFileSync(path.join(dir, rel), 'utf-8'))
        .join('\n');
      for (const t of s.truth.traps) {
        if (!new RegExp(t.match, 'i').test(haystack)) inert.push(`${s.id} / ${t.id}`);
      }
    }
    expect(inert).toEqual([]);
  });
});
