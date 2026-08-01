/**
 * Base-branch detection tripwire (gate, free).
 *
 * The base-detection preamble used to be copy-pasted into 15+ legacy modules,
 * so every fix had to be applied 15+ times and drifted back to a hardcoded
 * `main`. The canonical order now lives in `references/BASE-DETECTION.md`
 * (byte-identical per skill, like EXECUTION-PROFILES.md). This test fails if a
 * module reintroduces a hardcoded base branch or remote in command position.
 */
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const SKILLS = path.join(ROOT, 'skills');
const REF = 'references/BASE-DETECTION.md';

// Skills whose modules compare against a base branch.
const OWNERS = ['plan', 'qa', 'review', 'ship'];

// Hardcoded base/remote in command position. Prose that forbids them (and Go's
// cmd/.../main.go) is fine, so anchor on git command shapes and shell fallbacks.
const BANNED = [
  /rev-parse\s+(--verify\s+)?['"]?(origin\/)?(main|master)\b/,
  /\|\|\s*echo\s+(main|master)\b/,
  /git\s+(diff|log|merge-base|shortlog|fetch|merge|rebase|checkout|switch|push)\b[^`\n]*\b(origin\/)?(main|master)\b(?!\.go)/,
  /refs\/remotes\/origin\//,
  /fall\s?back to `main`/i,
];

function legacyFiles(): string[] {
  return fs
    .readdirSync(SKILLS)
    .flatMap((skill) => {
      const dir = path.join(SKILLS, skill, 'references', 'legacy');
      return fs.existsSync(dir)
        ? fs.readdirSync(dir).map((f) => path.join(dir, f))
        : [];
    })
    .filter((f) => f.endsWith('.md'));
}

describe('base-branch detection (gate, free)', () => {
  test('BASE-DETECTION.md exists and is byte-identical across owning skills', () => {
    const bodies = OWNERS.map((s) => fs.readFileSync(path.join(SKILLS, s, REF), 'utf-8'));
    expect(new Set(bodies).size).toBe(1);
    // The order must survive: remote HEAD, local default, upstream, no-base.
    for (const marker of [
      'init.defaultBranch',
      'refs/remotes/<remote>/HEAD',
      '@{upstream}',
      'no separate base branch',
    ]) {
      expect(bodies[0]).toContain(marker);
    }
  });

  test('no legacy module hardcodes a base branch or remote in command position', () => {
    const offenders: string[] = [];
    for (const file of legacyFiles()) {
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        // Skip lines that only name the prohibition or a dangerous-command example.
        // Skip the prohibition prose, a dangerous-command example, and Go's main package.
        if (/Never substitute|never assume the remote|History rewrite|are guesses|main\\?\.go/.test(line)) return;
        if (BANNED.some((re) => re.test(line))) {
          offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  test('every module that resolves a base branch defers to the shared reference', () => {
    for (const file of legacyFiles()) {
      const body = fs.readFileSync(file, 'utf-8');
      if (!/^#+ Step \d[^\n]*base branch/m.test(body)) continue;
      expect(body).toContain(REF);
    }
  });
});
