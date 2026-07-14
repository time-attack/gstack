import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'gstack-upgrade', 'SKILL.md.tmpl'), 'utf-8');
const GENERATED = fs.readFileSync(path.join(ROOT, 'gstack-upgrade', 'SKILL.md'), 'utf-8');

function setupCommandLines(src: string): string[] {
  return src
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.includes('./setup'));
}

describe('/gstack-upgrade host refresh', () => {
  test('source template re-registers auto-detected hosts after every upgrade', () => {
    const lines = setupCommandLines(TEMPLATE);

    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines).toEqual(expect.arrayContaining([
      './setup --host auto',
      'cd "$INSTALL_DIR" && ./setup --host auto',
      'cd "$LOCAL_GSTACK" && ./setup --host auto',
    ]));
    expect(lines.filter(line => line === './setup' || line.endsWith('&& ./setup'))).toEqual([]);
  });

  test('generated skill matches the host-aware upgrade contract', () => {
    const lines = setupCommandLines(GENERATED);

    expect(lines).toEqual(expect.arrayContaining([
      './setup --host auto',
      'cd "$INSTALL_DIR" && ./setup --host auto',
      'cd "$LOCAL_GSTACK" && ./setup --host auto',
    ]));
    expect(lines.filter(line => line === './setup' || line.endsWith('&& ./setup'))).toEqual([]);
  });
});

describe('/gstack-upgrade git-install and backup safety', () => {
  // Static pins for the other two upgrade fixes shipped alongside --host auto:
  // ff-only-before-reset (guard-hook-friendly upgrades) and stale-.bak
  // clearing (recursive backup trees, #922). Both in template AND generated.
  for (const [name, src] of [['template', TEMPLATE], ['generated', GENERATED]] as const) {
    test(`${name} tries a fast-forward before falling back to reset --hard`, () => {
      expect(src).toContain('if ! git merge --ff-only origin/main');
      expect(src).toContain('git reset --hard origin/main');
    });

    test(`${name} clears stale .bak dirs before both backup mvs`, () => {
      expect(src).toContain('rm -rf "$INSTALL_DIR.bak"\nmv "$INSTALL_DIR" "$INSTALL_DIR.bak"');
      expect(src).toContain('rm -rf "$LOCAL_GSTACK.bak"\nmv "$LOCAL_GSTACK" "$LOCAL_GSTACK.bak"');
    });
  }
});
