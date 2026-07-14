import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const FILES = ['investigate/SKILL.md.tmpl', 'investigate/SKILL.md'];

// #1871/#1873: Claude Code 2.1.162+ does not populate CLAUDE_SKILL_DIR for
// skill-frontmatter hooks, so investigate anchors to the $HOME install like
// careful/freeze/guard (see 'Claude hook frontmatter path resolution' in
// test/gen-skill-docs.test.ts). These pins guard the investigate-specific
// wiring: the hook command stays wired, no-ops gracefully when freeze is not
// installed, and the scope-lock availability check uses the same anchor.
describe('investigate freeze path resolution', () => {
  for (const rel of FILES) {
    const content = fs.readFileSync(path.join(ROOT, rel), 'utf-8');

    test(`${rel} hook anchors to the $HOME gstack install`, () => {
      expect(content).toContain('$HOME/.claude/skills/gstack/freeze/bin/check-freeze.sh');
      expect(content).toContain('[ -x "$S" ] && bash "$S" || exit 0');
      expect(content).toContain("command: 'bash -c ''");
      expect(content).not.toContain('CLAUDE_SKILL_DIR');
      expect(content).not.toContain('CLAUDE_PLUGIN_ROOT');
    });

    test(`${rel} scope lock availability check uses the $HOME anchor`, () => {
      expect(content).toContain('_FREEZE_SCRIPT="$HOME/.claude/skills/gstack/freeze/bin/check-freeze.sh"');
      expect(content).toContain('[ -x "$_FREEZE_SCRIPT" ] && echo "FREEZE_AVAILABLE" || echo "FREEZE_UNAVAILABLE"');
    });
  }
});
