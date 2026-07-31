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
    // Measured 1.x always-loaded catalog: ~1,100 token-equivalents (bytes/4).
    // The six-skill surface (make-pdf's description is frozen and counted)
    // must stay at or below 30% of that.
    const baselineTokenEquivalents = 1_100;
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
