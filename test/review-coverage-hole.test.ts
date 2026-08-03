/**
 * /review must not delegate categories to a pass that never runs.
 *
 * Field failure: checklist.md told the agent six categories were "handled by
 * parallel subagents, NOT this checklist" and pointed at `review/specialists/`.
 * No mode table, no lazy row, and no step in review.md ever dispatched a
 * specialist pass; review.md:694 says so outright ("If no specialist pass was
 * dispatched, as in this module's default flow"). So the checklist told the
 * reviewer to skip Test Gaps, Dead Code, Magic Numbers, Conditional Side
 * Effects, Performance and Bundle Impact, and Crypto and Entropy, and nothing
 * picked them up. A hostile-field persona planted an unauthenticated file-read
 * endpoint and it passed the Normal rubric clean.
 *
 * A rubric that names a category it never checks is worse than one that omits
 * it, because the omission is invisible to the reader.
 */
import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const CHECKLISTS = [
  path.join(ROOT, 'skills', 'review', 'references', 'artifacts', 'review', 'checklist.md'),
  path.join(ROOT, 'skills', 'ship', 'references', 'artifacts', 'review', 'checklist.md'),
];
const SPECIALIST_DIR = path.join(ROOT, 'skills', 'review', 'references', 'artifacts', 'review', 'specialists');

/** The six the checklist used to hand off, plus the one the field test caught escaping. */
const MUST_BE_COVERED = [
  'Test Gaps',
  'Dead Code',
  'Magic Numbers',
  'Conditional Side Effects',
  'Performance',
  'Crypto',
  'path traversal',
];

const read = (p: string) => fs.readFileSync(p, 'utf-8');

describe('review coverage hole', () => {
  for (const file of CHECKLISTS) {
    const name = file.replace(`${ROOT}/`, '');

    test(`${name} does not delegate to a pass that never runs`, () => {
      const md = read(file);
      // The exact escape hatch that created the hole.
      expect(md).not.toMatch(/handled by parallel subagents/i);
      expect(md).not.toMatch(/NOT this checklist/i);
    });

    test(`${name} covers every category it used to hand off`, () => {
      const md = read(file).toLowerCase();
      const missing = MUST_BE_COVERED.filter((c) => !md.includes(c.toLowerCase()));
      expect(missing, `checklist never mentions: ${missing.join(', ')}`).toEqual([]);
    });

    test(`${name} points only at paths that exist`, () => {
      const md = read(file);
      const refs = md.match(/`([a-z0-9._\/-]+\.md)`/gi) ?? [];
      const broken = refs
        .map((r) => r.replace(/`/g, ''))
        .filter((r) => r.includes('/'))
        .filter((r) => {
          const fromSkill = path.join(ROOT, 'skills', 'review', r);
          const fromHere = path.join(path.dirname(file), r);
          return !fs.existsSync(fromSkill) && !fs.existsSync(fromHere);
        });
      expect(broken, `checklist points at missing files: ${broken.join(', ')}`).toEqual([]);
    });
  }

  test('any surviving specialist file is reachable, or it is not shipped', () => {
    if (!fs.existsSync(SPECIALIST_DIR)) return; // deleting them is a legal fix
    const files = fs.readdirSync(SPECIALIST_DIR).filter((f) => f.endsWith('.md'));
    const reachableFrom = [
      read(path.join(ROOT, 'skills', 'review', 'SKILL.md')),
      read(path.join(ROOT, 'skills', 'review', 'references', 'legacy', 'review.md')),
      ...CHECKLISTS.map(read),
    ].join('\n');
    const orphans = files.filter((f) => !reachableFrom.includes(f));
    expect(orphans, `specialist files nothing routes to: ${orphans.join(', ')}`).toEqual([]);
  });
});
