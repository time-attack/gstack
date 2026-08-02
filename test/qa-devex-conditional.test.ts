import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

// The /qa DX audit is the single largest module in the tree. It was once
// mandated by depth, so a backend or CLI target with no developer-experience
// surface paid for it on every Standard and Deep pass. The gate is now the
// surface, not the depth. These two checks fail if that inverts again.

const ROOT = path.resolve(import.meta.dir, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

describe('qa devex-review loads on surface, not depth', () => {
  const sysFunctional = read('skills/qa/references/SYSTEM-FUNCTIONAL.md');
  const skillMd = read('skills/qa/SKILL.md');

  test('SYSTEM-FUNCTIONAL does not make it mandatory at a depth', () => {
    const bullet = sysFunctional
      .split('\n')
      .find((l) => l.trim().startsWith('- `devex-review`'));
    expect(bullet).toBeDefined();
    expect(bullet!).not.toMatch(/mandatory at .*depth/i);
    expect(bullet!).toMatch(/developer-experience surface/i);
  });

  test('a purely functional non-browser pass records the skip', () => {
    for (const doc of [sysFunctional, skillMd]) {
      expect(doc).toContain('`no developer-experience surface`');
    }
    expect(skillMd).toMatch(/devex-review\.md` audits developer experience, not function/);
  });
});
