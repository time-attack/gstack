import { describe, test, expect } from 'bun:test';
import * as path from 'path';
import * as fs from 'fs';

// Static tripwires for dev-setup's static-skills contract. Skills are no
// longer generated: dev-setup links the worktree into .claude/skills and
// .agents/skills and must never invoke the retired render pipeline or the
// per-user runtime installer.
const ROOT = path.resolve(import.meta.dir, '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

describe('dev-setup: links the worktree, no rendering', () => {
  const devSetup = read('bin/dev-setup');

  test('does not invoke the user runtime installer from a development worktree', () => {
    expect(devSetup).not.toMatch(/\$GSTACK_LINK\/setup/);
    expect(devSetup).toContain('Do not call the user runtime installer');
  });

  test('does not call the retired skill-generation pipeline', () => {
    expect(devSetup).not.toContain('gen:skill-docs');
    expect(devSetup).not.toContain('--out-dir');
  });

  test('symlinks the repo root for Claude and agent hosts', () => {
    expect(devSetup).toContain('.claude/skills');
    expect(devSetup).toContain('.agents/skills');
    expect(devSetup).toMatch(/ln -s "\$REPO_ROOT"/);
  });

  test('cleans up any stale render dir from the retired pipeline', () => {
    expect(devSetup).toMatch(/rm -rf .*gstack-rendered/);
  });
});

describe('dev-teardown: removes the untracked render', () => {
  const teardown = read('bin/dev-teardown');

  test('rm -rf the gstack-rendered dir', () => {
    expect(teardown).toContain('gstack-rendered');
    expect(teardown).toMatch(/rm -rf .*RENDER_DIR/);
  });
});

describe('.gitignore: render dir stays declared untracked', () => {
  test('.claude/gstack-rendered/ is ignored', () => {
    expect(read('.gitignore')).toContain('.claude/gstack-rendered/');
  });
});
