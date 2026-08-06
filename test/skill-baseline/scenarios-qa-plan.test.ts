/**
 * Free, deterministic self-check for the qa and plan ablation scenarios.
 *
 * No API key, no model call, no network. Every assertion here is a function of
 * the scenario data plus what `materialize` actually writes into a temp dir.
 *
 * The assertion that earns this file's existence is `materialize writes every
 * file the ground truth names`. A scenario whose `expected` regex points at a
 * file the fixture never wrote scores as a miss in EVERY arm, which reads as
 * "this module changed nothing" and drags the study toward "it is all dead
 * weight". That failure is silent in the study and loud here.
 */

import { describe, test, expect, afterAll } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { qaPlusScenarios, QA_PLUS_MODULE_COVERAGE } from './scenarios-qa-plus';
import { planPlusScenarios, PLAN_PLUS_MODULE_COVERAGE } from './scenarios-plan-plus';
import { scoreReport, trapFired, phantomPaths } from './score';
import { walkFiles } from './tree';
import type { Scenario } from './scenarios';

const scenarios: Scenario[] = [...qaPlusScenarios, ...planPlusScenarios];
const coverage = { ...QA_PLUS_MODULE_COVERAGE, ...PLAN_PLUS_MODULE_COVERAGE };

const tmpRoots: string[] = [];

/** Materialize once per scenario and cache the file list. */
const built = new Map<string, { dir: string; files: string[] }>();

function build(s: Scenario): { dir: string; files: string[] } {
  const cached = built.get(s.id);
  if (cached) return cached;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `sbl-${s.id}-`));
  tmpRoots.push(dir);
  s.materialize(dir);
  const out = { dir, files: walkFiles(dir) };
  built.set(s.id, out);
  return out;
}

afterAll(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * Pull path-looking literals out of a regex source.
 *
 * Regex sources carry `\.` escapes, so unescape first. Only tokens ending in a
 * source-file extension count, which is the same shape `PATH_RE` in score.ts
 * matches, so this checks exactly the paths a report could be charged for.
 */
const PATH_IN_REGEX =
  /(?:^|[^\w./-])((?:[\w-]+\/)*[\w-]+\.(?:ts|tsx|js|jsx|py|rb|sql|css|html|md|json|sh|yml|yaml|swift|plist|log|csv|jsonl|txt))(?![\w])/g;

function pathsNamedBy(source: string): string[] {
  const unescaped = source.split('\\.').join('.');
  const out = new Set<string>();
  for (const m of unescaped.matchAll(PATH_IN_REGEX)) out.add(m[1]);
  return [...out];
}

/** Mirror of phantomPaths' resolution rule: exact, basename, or suffix. */
function resolves(cited: string, files: string[]): boolean {
  const known = new Set<string>();
  for (const f of files) {
    known.add(f);
    known.add(f.split('/').pop() as string);
  }
  if (known.has(cited) || known.has(cited.split('/').pop() as string)) return true;
  return [...known].some((k) => k.endsWith('/' + cited) || cited.endsWith('/' + k));
}

describe('scenario set integrity', () => {
  test('ids are unique across both files and the existing set', () => {
    const ids = scenarios.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('ids are namespaced so they cannot collide with the shipped scenarios', () => {
    for (const s of scenarios) {
      expect(s.id.startsWith('qa-plus-') || s.id.startsWith('plan-plus-')).toBe(true);
    }
  });

  test('every scenario declares the right skill', () => {
    for (const s of qaPlusScenarios) expect(s.skill).toBe('qa');
    for (const s of planPlusScenarios) expect(s.skill).toBe('plan');
  });

  test('every scenario has at least one expected finding and one trap', () => {
    for (const s of scenarios) {
      expect(s.truth.expected.length).toBeGreaterThan(0);
      expect(s.truth.traps.length).toBeGreaterThan(0);
    }
  });

  test('expected and trap ids are unique within a scenario', () => {
    for (const s of scenarios) {
      const ids = [...s.truth.expected, ...s.truth.traps].map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  test('every regex compiles', () => {
    for (const s of scenarios) {
      for (const e of [...s.truth.expected, ...s.truth.traps]) {
        expect(() => new RegExp(e.match, 'i')).not.toThrow();
      }
    }
  });

  test('no trap regex matches the empty string', () => {
    // A trap that matches everything fires on every line of every report.
    for (const s of scenarios) {
      for (const t of s.truth.traps) {
        expect(new RegExp(t.match, 'i').test('')).toBe(false);
      }
    }
  });

  test('tasks do not carry the report instruction, which the runner appends', () => {
    for (const s of scenarios) {
      expect(s.task).not.toContain('report.md');
    }
  });

  test('every trap carries a note saying why the code is correct', () => {
    for (const s of scenarios) {
      for (const t of s.truth.traps) {
        expect(t.note && t.note.length > 20).toBe(true);
      }
    }
  });
});

describe('materialize is hermetic and complete', () => {
  test('every scenario writes at least two files into the temp dir', () => {
    for (const s of scenarios) {
      const { files } = build(s);
      expect(files.length).toBeGreaterThan(1);
    }
  });

  test('materialize writes every file the ground truth names', () => {
    const missing: string[] = [];
    for (const s of scenarios) {
      const { files } = build(s);
      for (const e of [...s.truth.expected, ...s.truth.traps]) {
        for (const cited of pathsNamedBy(e.match)) {
          if (!resolves(cited, files)) missing.push(`${s.id} / ${e.id} -> ${cited}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test('materialize writes nothing outside its dir', () => {
    for (const s of scenarios) {
      const { dir, files } = build(s);
      for (const rel of files) {
        const full = path.resolve(dir, rel);
        expect(full.startsWith(path.resolve(dir) + path.sep)).toBe(true);
      }
    }
  });

  test('materialize is idempotent, so a re-run cannot poison a later arm', () => {
    for (const s of scenarios) {
      const { dir, files } = build(s);
      s.materialize(dir);
      expect(walkFiles(dir).sort()).toEqual([...files].sort());
    }
  });
});

describe('scenarios are scoreable in both directions', () => {
  test('an empty report scores zero recall and no fabrication', () => {
    for (const s of scenarios) {
      const { files } = build(s);
      const score = scoreReport({
        scenarioId: s.id,
        arm: 'test',
        truth: s.truth,
        report: '',
        workspaceFiles: files,
      });
      expect(score.noReport).toBe(true);
      expect(score.recall).toBe(0);
      expect(score.fabrications).toEqual([]);
    }
  });

  test('a report echoing every expected pattern reaches full recall', () => {
    // Proves the expected regexes are satisfiable at all: a scenario whose
    // ground truth no text can match scores every arm as a miss.
    for (const s of scenarios) {
      const { files } = build(s);
      const report = s.truth.expected
        .map((e) => `finding ${e.id}: ${sampleFor(e.match)}`)
        .join('\n');
      const score = scoreReport({
        scenarioId: s.id,
        arm: 'test',
        truth: s.truth,
        report,
        workspaceFiles: files,
      });
      expect(score.misses).toEqual([]);
      expect(score.recall).toBe(1);
    }
  });

  test('each trap fires on a defect-shaped line and not on a cleared one', () => {
    for (const s of scenarios) {
      for (const t of s.truth.traps) {
        const token = sampleFor(t.match);
        expect(trapFired(`This is a bug in ${token} and must be fixed.`, t)).toBe(true);
        expect(trapFired(`Checked ${token}: it is correct, not a bug.`, t)).toBe(false);
      }
    }
  });

  test('a fabricated path is caught for every scenario', () => {
    for (const s of scenarios) {
      const { files } = build(s);
      const phantoms = phantomPaths('The real defect is in src/ghost/never-written.ts:42', files);
      expect(phantoms).toContain('src/ghost/never-written.ts');
    }
  });
});

describe('module coverage', () => {
  test('every declared module exists on disk', () => {
    const root = path.resolve(import.meta.dir, '..', '..');
    for (const mod of Object.keys(coverage)) {
      const [skill, file] = mod.split('/');
      const abs = path.join(root, 'skills', skill, 'references', 'legacy', file);
      if (!fs.existsSync(abs)) throw new Error(`coverage names a missing module: ${mod}`);
    }
  });

  test('all 23 qa and plan modules are covered', () => {
    const root = path.resolve(import.meta.dir, '..', '..');
    const onDisk: string[] = [];
    for (const skill of ['qa', 'plan']) {
      const dir = path.join(root, 'skills', skill, 'references', 'legacy');
      for (const f of fs.readdirSync(dir)) {
        if (f.endsWith('.md')) onDisk.push(`${skill}/${f}`);
      }
    }
    const uncovered = onDisk.filter((m) => !coverage[m]);
    expect(uncovered).toEqual([]);
    expect(onDisk.length).toBe(23);
  });

  test('every module names at least one scenario, and every named scenario exists', () => {
    const ids = new Set(scenarios.map((s) => s.id));
    for (const [mod, list] of Object.entries(coverage)) {
      expect(list.length).toBeGreaterThan(0);
      for (const id of list) {
        if (!ids.has(id)) throw new Error(`${mod} names unknown scenario ${id}`);
      }
    }
  });

  test('every scenario is claimed by at least one module', () => {
    const claimed = new Set(Object.values(coverage).flat());
    const orphans = scenarios.map((s) => s.id).filter((id) => !claimed.has(id));
    expect(orphans).toEqual([]);
  });
});

/**
 * Build a string that satisfies a regex source, for the satisfiability checks
 * above. Takes the first alternative of the top-level alternation and strips
 * regex syntax down to the literal text.
 *
 * ponytail: literal-extraction beats pulling in a regex-generator dependency for
 * a test whose only job is "is this pattern matchable at all". If a future
 * pattern uses a construct this cannot reduce, the satisfiability test fails
 * loudly rather than silently passing, which is the safe direction.
 */
function sampleFor(source: string): string {
  // Escaped parens are LITERAL text and must survive group collapsing, so they
  // go behind sentinels first and come back at the end.
  const OPEN = '';
  const CLOSE = '';
  let work = source.split('\\(').join(OPEN).split('\\)').join(CLOSE);

  // Drop lookaheads, then collapse each innermost group to its first
  // alternative until no groups are left. Doing this before the top-level split
  // is what makes `start(s|ing)? (on|work)` reduce to `starts on` rather than
  // leaving inner pipes behind.
  work = work.replace(/\(\?[!=][^()]*\)/g, '');
  for (let guard = 0; guard < 50 && /\([^()]*\)/.test(work); guard++) {
    work = work.replace(/\((?:\?:)?([^()]*)\)/g, (_m, body: string) =>
      splitTopLevelAlternation(body)[0] ?? '',
    );
  }

  const firstAlt = splitTopLevelAlternation(work)[0] ?? work;
  const literal = firstAlt
    .split('\\d').join('7')
    .split('\\s').join(' ')
    .split('\\w').join('x')
    .split('\\b').join('')
    .split('\\.').join('.')
    .split('\\+').join('+')
    .split('\\*').join('*')
    .split('\\|').join('|')
    .split('\\$').join('$')
    .replace(/\{\d+(,\d+)?\}/g, '')
    .replace(/\[\^?([^\]]*)\]/g, (_m, cls: string) => {
      if (cls.includes('0-9')) return '7';
      if (cls.includes('a-z')) return 'x';
      if (cls.includes('A-Z')) return 'X';
      return cls.replace(/\\/g, '')[0] ?? 'a';
    })
    .replace(/([a-z0-9 ])\?/gi, '$1')
    .replace(/[?*+]/g, '')
    .split(OPEN).join('(')
    .split(CLOSE).join(')');
  return literal.trim() || 'placeholder';
}

/** Split on `|` that is not inside a group or a character class. */
function splitTopLevelAlternation(source: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inClass = false;
  let current = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      current += ch + (source[i + 1] ?? '');
      i++;
      continue;
    }
    if (ch === '[') inClass = true;
    else if (ch === ']') inClass = false;
    else if (!inClass && ch === '(') depth++;
    else if (!inClass && ch === ')') depth--;
    else if (!inClass && depth === 0 && ch === '|') {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts.filter((p) => p.trim().length > 0);
}
