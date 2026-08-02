/**
 * The fast paths must be able to fill every header field they mandate.
 *
 * Field failure: each SKILL.md says "print these exact labels in this exact
 * order" over a 7-to-10-field block, and each FAST-PATH.md then says "this file
 * is the whole path, nothing else is read on it". The two together demanded
 * fields no file on the path defines — /debug's `Web context` enum lives in no
 * debug file at all, and /plan's `Verification` line was owned by
 * VERIFICATION-CONTRACT.md, which the plain trivial entry never reads. Runs
 * printed all ten fields against a three-file diff, or invented values.
 *
 * The fix: the fast path prints a reduced header that its own file names, and
 * every rule needed to fill it is inlined. This test pins both halves
 * statically, so a future edit that re-mandates the full block fails free.
 */
import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const DISPATCHERS = ['plan', 'qa', 'review', 'ship', 'debug'] as const;

/** Fields no fast path can honestly answer: it reads no module and rates no depth. */
const FORBIDDEN_ON_FAST_PATH = ['Mode', 'Depth', 'Scale', 'Role', 'Active modules', 'Skipped modules', 'Web context'];

const read = (...p: string[]) => fs.readFileSync(path.join(ROOT, ...p), 'utf-8');

/** Labels inside the first ```text fenced block after `heading`. */
function headerFields(md: string, heading: string): string[] {
  const from = md.indexOf(heading);
  expect(from, `missing section: ${heading}`).toBeGreaterThan(-1);
  const open = md.indexOf('```text', from);
  const close = md.indexOf('```', open + 7);
  expect(open, `no fenced header block under ${heading}`).toBeGreaterThan(-1);
  return md
    .slice(open + 7, close)
    .split('\n')
    .map((l) => l.split(':')[0].trim())
    .filter(Boolean);
}

describe('fast-path header contract', () => {
  for (const skill of DISPATCHERS) {
    const fastPath = read('skills', skill, 'references', 'FAST-PATH.md');
    const fields = headerFields(fastPath, '## The fast-path header');

    test(`/${skill} fast path names its own reduced header`, () => {
      // Target and Mutation are always answerable and always load-bearing:
      // what was worked on, and what this run was allowed to change.
      expect(fields).toContain('Target');
      expect(fields).toContain('Mutation');
      expect(fields.length).toBeLessThanOrEqual(3);
    });

    test(`/${skill} fast path drops fields it cannot answer`, () => {
      for (const forbidden of FORBIDDEN_ON_FAST_PATH) {
        expect(
          fields,
          `${skill} fast path mandates "${forbidden}", which nothing on the path defines`,
        ).not.toContain(forbidden);
      }
    });

    test(`/${skill} fast path is self-contained`, () => {
      // "Nothing else is read on it" has to be true, so the file may not send
      // the run off to another reference for a rule it mandates.
      const escapes = fastPath.match(/references\/[A-Z][A-Z-]*\.md/g) ?? [];
      expect(escapes, `${skill} fast path directs a read of ${escapes.join(', ')}`).toEqual([]);
    });

    test(`/${skill} SKILL.md exempts the fast path from the exact-labels rule`, () => {
      const skillMd = read('skills', skill, 'SKILL.md');
      const full = headerFields(skillMd, '## Required execution header');
      const exemption = skillMd.slice(skillMd.indexOf('## Required execution header'));
      expect(
        /does not bind the .*fast path/.test(exemption.split('## Dispatch protocol')[0]),
        `${skill}/SKILL.md mandates every label with no fast-path carve-out`,
      ).toBe(true);
      // The reduced header is a subset, not a second vocabulary.
      for (const f of fields) expect(full, `${skill} fast path invents field "${f}"`).toContain(f);
    });
  }

  test('/plan fast path inlines the Verification rule it mandates', () => {
    const fastPath = read('skills', 'plan', 'references', 'FAST-PATH.md');
    expect(headerFields(fastPath, '## The fast-path header')).toContain('Verification');
    // The three things that make the line honest, per VERIFICATION-CONTRACT.md,
    // must survive on a path that never reads it.
    expect(fastPath).toMatch(/before the first edit/);
    expect(fastPath).toMatch(/may not edit/);
    expect(fastPath).toMatch(/not covered/);
    expect(fastPath).toMatch(/`none`/);
  });
});
