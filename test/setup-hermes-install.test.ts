import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const SETUP = readFileSync(join(ROOT, 'setup'), 'utf8');
const UNINSTALL = readFileSync(join(ROOT, 'bin', 'gstack-uninstall'), 'utf8');

describe('Hermes install ownership', () => {
  test('generates Hermes skills and preserves unowned collisions', () => {
    expect(SETUP).toContain('bun run gen:skill-docs --host hermes');
    expect(SETUP).toContain('warning: preserving unowned Hermes skill');
    expect(SETUP).toContain('.gstack-install-owner');
  });

  test('uninstall removes only demonstrably owned Hermes entries', () => {
    expect(UNINSTALL).toContain('HERMES_SKILLS="$HOME/.hermes/skills"');
    expect(UNINSTALL).toContain('if is_owned_skill_link "$_ITEM"; then');
    expect(UNINSTALL).toContain('.gstack-install-owner');
  });
});
