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

  /**
   * The checklist was only half the hole. `review.md` Step 4 enumerates the
   * categories the reviewer applies, and that enumeration stopped at
   * CRITICAL + INFORMATIONAL — it named none of Pass 3. So an agent following
   * the module literally still skipped every SWEEP category even after the
   * checklist was fixed. Two files have to agree or the fix is cosmetic.
   */
  test('review.md Step 4 names the Pass 3 categories it is responsible for', () => {
    const md = read(path.join(ROOT, 'skills', 'review', 'references', 'legacy', 'review.md'));
    const step4 = md.slice(md.indexOf('## Step 4'), md.indexOf('## Step 5'));
    expect(step4.length).toBeGreaterThan(0);

    const missing = ['Test Gaps', 'Performance', 'Crypto', 'Dead Code', 'Magic Numbers', 'Conditional Side Effects']
      .filter((c) => !step4.toLowerCase().includes(c.toLowerCase()));
    expect(missing, `Step 4 never names: ${missing.join(', ')}`).toEqual([]);
  });

  test('ASSETS.md promises no file that is missing from disk', () => {
    const skillsDir = path.join(ROOT, 'skills');
    const broken: string[] = [];
    for (const skill of fs.readdirSync(skillsDir)) {
      const assets = path.join(skillsDir, skill, 'references', 'ASSETS.md');
      if (!fs.existsSync(assets)) continue;
      for (const m of read(assets).matchAll(/`(references\/[a-zA-Z0-9_./-]+)`/g)) {
        if (!fs.existsSync(path.join(skillsDir, skill, m[1]))) broken.push(`${skill}: ${m[1]}`);
      }
    }
    expect(broken, `ASSETS.md rows point at missing files:\n  ${broken.join('\n  ')}`).toEqual([]);
  });

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
