/**
 * v1.61.1.0 heal migration: retry the v1.27 gh repo rename for installs whose
 * earlier migration run hit the bare-name gh bug (rename silently failed,
 * remote.txt already rewritten to a repo that was never created).
 *
 * Hermetic: fake gh on PATH (logs calls, scriptable outcomes), tmp HOME.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawnSync } from 'child_process';

const ROOT = path.resolve(import.meta.dir, '..');
const MIGRATION = path.join(ROOT, 'gstack-upgrade', 'migrations', 'v1.61.1.0.sh');

let tmpHome: string;
let fakeBinDir: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-v1.61-'));
  fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-v1.61-fake-'));
  fs.mkdirSync(path.join(tmpHome, '.gstack'), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(fakeBinDir, { recursive: true, force: true });
});

function makeFakeGh(opts: { newExists?: boolean; oldExists?: boolean; renameSucceeds?: boolean } = {}) {
  const newExists = opts.newExists ?? false;
  const oldExists = opts.oldExists ?? true;
  const renameSucceeds = opts.renameSucceeds ?? true;
  const callLog = path.join(fakeBinDir, 'gh-calls.log');
  const script = `#!/bin/bash
echo "gh $@" >> "${callLog}"
case "$1" in
  auth) exit 0 ;;
  repo)
    shift
    case "$1" in
      view)
        case "$2" in
          */gstack-artifacts-*) ${newExists ? 'exit 0' : 'exit 1'} ;;
          */gstack-brain-*)     ${oldExists ? 'exit 0' : 'exit 1'} ;;
        esac
        exit 1
        ;;
      rename) ${renameSucceeds ? 'exit 0' : 'exit 1'} ;;
    esac
    ;;
esac
exit 0
`;
  fs.writeFileSync(path.join(fakeBinDir, 'gh'), script, { mode: 0o755 });
}

function ghLog(): string {
  const p = path.join(fakeBinDir, 'gh-calls.log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : '';
}

function run(): { code: number; stderr: string } {
  const r = spawnSync(MIGRATION, [], {
    env: {
      PATH: `${fakeBinDir}:/usr/bin:/bin:/opt/homebrew/bin`,
      HOME: tmpHome,
    },
    encoding: 'utf-8',
    cwd: tmpHome,
  });
  return { code: r.status ?? -1, stderr: r.stderr || '' };
}

const doneFile = () => path.join(tmpHome, '.gstack/.migrations/v1.61.1.0.done');
const remoteTxt = () => path.join(tmpHome, '.gstack-artifacts-remote.txt');

describe('v1.61.1.0 heal migration', () => {
  test('done touchfile short-circuits silently', () => {
    makeFakeGh();
    fs.mkdirSync(path.dirname(doneFile()), { recursive: true });
    fs.writeFileSync(doneFile(), '');
    const r = run();
    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');
    expect(ghLog()).toBe('');
  });

  test('no artifacts remote.txt → done, no gh calls', () => {
    makeFakeGh();
    const r = run();
    expect(r.code).toBe(0);
    expect(fs.existsSync(doneFile())).toBe(true);
    expect(ghLog()).toBe('');
  });

  test('non-GitHub remote → done, no gh calls', () => {
    makeFakeGh();
    fs.writeFileSync(remoteTxt(), 'https://gitlab.com/u/gstack-artifacts-u\n');
    const r = run();
    expect(r.code).toBe(0);
    expect(fs.existsSync(doneFile())).toBe(true);
    expect(ghLog()).toBe('');
  });

  test('stuck install (new 404s, old exists) → owner-qualified rename, done', () => {
    makeFakeGh({ newExists: false, oldExists: true, renameSucceeds: true });
    fs.writeFileSync(remoteTxt(), 'https://github.com/victim/gstack-artifacts-victim\n');
    const r = run();
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('healing the v1.27 artifacts rename');
    expect(ghLog()).toContain('gh repo rename gstack-artifacts-victim --repo victim/gstack-brain-victim --yes');
    expect(fs.existsSync(doneFile())).toBe(true);
  });

  test('artifacts repo already exists → done, no rename', () => {
    makeFakeGh({ newExists: true });
    fs.writeFileSync(remoteTxt(), 'https://github.com/u/gstack-artifacts-u.git\n');
    const r = run();
    expect(r.code).toBe(0);
    expect(fs.existsSync(doneFile())).toBe(true);
    expect(ghLog()).not.toContain('rename');
  });

  test('neither repo exists → done (out of scope), no rename', () => {
    makeFakeGh({ newExists: false, oldExists: false });
    fs.writeFileSync(remoteTxt(), 'https://github.com/u/gstack-artifacts-u\n');
    const r = run();
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('nothing to heal');
    expect(fs.existsSync(doneFile())).toBe(true);
    expect(ghLog()).not.toContain('rename');
  });

  test('rename failure is non-fatal and leaves the migration retryable', () => {
    makeFakeGh({ renameSucceeds: false });
    fs.writeFileSync(remoteTxt(), 'https://github.com/u/gstack-artifacts-u\n');
    const r = run();
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('WARNING: rename failed');
    expect(r.stderr).toContain('gh repo rename gstack-artifacts-u --repo u/gstack-brain-u --yes');
    expect(fs.existsSync(doneFile())).toBe(false);
  });
});
