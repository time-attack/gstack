import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Import-free by design: reads skills/*/SKILL.md directly. Do not import
// scripts/gstack2 modules here — this test must survive generator refactors.

const SKILLS_DIR = join(import.meta.dir, '..', 'skills');

// Canonical GStack 2 surface: five judgment dispatchers plus the make-pdf tool skill.
const CANONICAL_SKILLS = ['debug', 'make-pdf', 'plan', 'qa', 'review', 'ship'];

function skillDirsWithManifest(): string[] {
  return readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(SKILLS_DIR, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
}

function parseFrontmatter(body: string): { name: string; description: string } {
  const name = body.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? '';
  // Folded block scalar (description: >-) with two-space-indented continuation lines,
  // falling back to a single-line description.
  const folded = body.match(/^description:\s*>-?\r?\n((?:  .*\r?\n)+)/m)?.[1];
  const description = folded
    ? folded.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join(' ')
    : body.match(/^description:\s*(?!>-?\s*$)(.+)$/m)?.[1]?.trim() ?? '';
  return { name, description };
}

describe('GStack 2 skill surface', () => {
  test('ships exactly the six canonical skills, each with name + description frontmatter', () => {
    expect(skillDirsWithManifest()).toEqual(CANONICAL_SKILLS);
    for (const skill of CANONICAL_SKILLS) {
      const body = readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8');
      const { name, description } = parseFrontmatter(body);
      expect(name).toBe(skill);
      expect(description).not.toBe('');
    }
  });

  test('keeps the six-skill discovery surface at least 70 percent below the 1.x baseline', () => {
    // 1.x always-loaded catalog baseline. Re-derive it, do not trust the number:
    //   ref     bb57306d98c97011b0919c6132705a15b1579781 (the pre-2.0 tree audited
    //           in docs/gstack-2/BASELINE.md; 53 top-level `<skill>/SKILL.md` files)
    //   method  for each file, run parseFrontmatter() below and sum
    //           Buffer.byteLength(name) + Buffer.byteLength(description);
    //           token-equivalents = ceil(bytes / 4). Same parser both sides, so the
    //           comparison is apples-to-apples.
    //   result  4,371 bytes = 1,093 token-equivalents (measured 2026-08-01)
    // Do NOT measure a mid-migration ref. 228d8b72^ yields 3,810 bytes / 953
    // token-equivalents, but that tree has the 7 design skills already deleted and
    // carries dev-only `gstack-1-` name prefixes. It is not 1.x.
    // Current surface: 1,255 bytes = 314 token-equivalents = 71.3% below baseline.
    // The 30% cap is 327, so headroom is 13 token-equivalents (~4%). That is thin:
    // adding ~52 bytes of description across the six skills trips this gate.
    // make-pdf alone is 434 of the 1,255 bytes (35%) and its description is frozen.
    const baselineTokenEquivalents = 1_093;
    const surfaceBytes = CANONICAL_SKILLS
      .map((skill) => readFileSync(join(SKILLS_DIR, skill, 'SKILL.md'), 'utf8'))
      .reduce((total, body) => {
        const { name, description } = parseFrontmatter(body);
        return total + Buffer.byteLength(name) + Buffer.byteLength(description);
      }, 0);
    const estimatedTokens = Math.ceil(surfaceBytes / 4);
    expect(estimatedTokens).toBeLessThanOrEqual(Math.floor(baselineTokenEquivalents * 0.3));
  });

  test('keeps every SKILL.md under the 40K-token ceiling', () => {
    for (const skill of CANONICAL_SKILLS) {
      const bytes = statSync(join(SKILLS_DIR, skill, 'SKILL.md')).size;
      expect(Math.ceil(bytes / 4)).toBeLessThanOrEqual(40_000);
    }
  });
});
