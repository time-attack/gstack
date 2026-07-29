import { describe, test, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const ROOT = path.resolve(import.meta.dir, '..');
const CAREFUL_SCRIPT = path.join(ROOT, 'careful', 'bin', 'check-careful.sh');
const FREEZE_SCRIPT = path.join(ROOT, 'freeze', 'bin', 'check-freeze.sh');

function runHook(scriptPath: string, input: object, env?: Record<string, string>): { exitCode: number; output: any; raw: string } {
  const result = spawnSync('bash', [scriptPath], {
    input: JSON.stringify(input),
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    timeout: 5000,
  });
  const raw = result.stdout.toString().trim();
  let output: any = {};
  try {
    output = JSON.parse(raw);
  } catch {}
  return { exitCode: result.status ?? 1, output, raw };
}

function runHookRaw(scriptPath: string, rawInput: string, env?: Record<string, string>): { exitCode: number; output: any; raw: string } {
  const result = spawnSync('bash', [scriptPath], {
    input: rawInput,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    timeout: 5000,
  });
  const raw = result.stdout.toString().trim();
  let output: any = {};
  try {
    output = JSON.parse(raw);
  } catch {}
  return { exitCode: result.status ?? 1, output, raw };
}

function carefulInput(command: string) {
  return { tool_input: { command } };
}

function freezeInput(filePath: string) {
  return { tool_input: { file_path: filePath } };
}

function withFreezeDir(freezePath: string, fn: (stateDir: string) => void) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-freeze-test-'));
  fs.writeFileSync(path.join(stateDir, 'freeze-dir.txt'), freezePath);
  try {
    fn(stateDir);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
}

// ============================================================
// check-careful.sh tests
// ============================================================
describe('check-careful.sh', () => {

  // --- Destructive rm commands ---

  describe('rm -rf / rm -r', () => {
    test('rm -rf /var/data warns with recursive delete message', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('rm -rf /var/data'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('recursive delete');
    });

    test('rm -r ./some-dir warns', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('rm -r ./some-dir'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('recursive delete');
    });

    test('rm -rf node_modules allows (safe exception)', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('rm -rf node_modules'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBeUndefined();
    });

    test('rm -rf .next dist allows (multiple safe targets)', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('rm -rf .next dist'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBeUndefined();
    });

    test('rm -rf node_modules /var/data warns (mixed safe+unsafe)', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('rm -rf node_modules /var/data'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('recursive delete');
    });
  });

  // --- SQL destructive commands ---
  // The extractor JSON-parses the input (python3 first, ERE+awk fallback), so
  // embedded quotes no longer truncate the command value. SQL keywords are
  // matched against quote-preserved segment text because SQL payloads ride
  // inside quoted arguments (psql -c "DROP TABLE ...").

  describe('SQL destructive commands', () => {
    test('psql -c "DROP TABLE users;" (double-quoted) warns', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('psql -c "DROP TABLE users;"'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('DROP');
    });

    test("psql -c 'TRUNCATE orders;' (single-quoted) warns", () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput("psql -c 'TRUNCATE orders;'"));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('TRUNCATE');
    });

    test('psql DROP TABLE warns with DROP in message', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('psql -c DROP TABLE users;'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('DROP');
    });

    test('mysql drop database warns (case insensitive)', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('mysql -e drop database mydb'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message.toLowerCase()).toContain('drop');
    });

    test('psql TRUNCATE warns', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('psql -c TRUNCATE orders;'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('TRUNCATE');
    });
  });

  // --- Git destructive commands ---

  describe('git destructive commands', () => {
    test('git push --force warns with force-push', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('git push --force origin main'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('force-push');
    });

    test('git push -f warns', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('git push -f origin main'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('force-push');
    });

    test('git reset --hard warns with uncommitted', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('git reset --hard HEAD~3'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('uncommitted');
    });

    test('git checkout . warns', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('git checkout .'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('uncommitted');
    });

    test('git restore . warns', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('git restore .'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('uncommitted');
    });
  });

  // --- Container / infra destructive commands ---

  describe('container and infra commands', () => {
    test('kubectl delete warns with kubectl in message', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('kubectl delete pod my-pod'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('kubectl');
    });

    test('docker rm -f warns', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('docker rm -f container123'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('Docker');
    });

    test('docker system prune -a warns', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput('docker system prune -a'));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('Docker');
    });
  });

  // --- Safe commands ---

  describe('safe commands allow without warning', () => {
    const safeCmds = [
      'ls -la',
      'git status',
      'npm install',
      'cat README.md',
      'echo hello',
    ];

    for (const cmd of safeCmds) {
      test(`"${cmd}" allows`, () => {
        const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput(cmd));
        expect(exitCode).toBe(0);
        expect(output.permissionDecision).toBeUndefined();
      });
    }
  });

  // --- Edge cases ---

  describe('edge cases', () => {
    test('empty command allows gracefully', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput(''));
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBeUndefined();
    });

    test('missing command field allows gracefully', () => {
      const { exitCode, output } = runHook(CAREFUL_SCRIPT, { tool_input: {} });
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBeUndefined();
    });

    test('malformed JSON input allows gracefully (exit 0, output {})', () => {
      const { exitCode, raw } = runHookRaw(CAREFUL_SCRIPT, 'this is not json at all{{{{');
      expect(exitCode).toBe(0);
      expect(raw).toBe('{}');
    });

    test('Python fallback: grep fails on multiline JSON, Python parses it', () => {
      // Construct JSON where "command": and the value are on separate lines.
      // grep works line-by-line, so it cannot match "command"..."value" across lines.
      // This forces CMD to be empty, triggering the Python fallback which handles
      // the full JSON correctly.
      const rawJson = '{"tool_input":{"command":\n"rm -rf /tmp/important"}}';
      const { exitCode, output } = runHookRaw(CAREFUL_SCRIPT, rawJson);
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('recursive delete');
    });
  });

  // ============================================================
  // #2039: compound commands must fail CLOSED — the hook splits the
  // command into segments on unquoted ; & | ( ) newlines and command
  // substitutions, and checks every segment. A destructive segment
  // hiding behind a benign one (or behind a safe-exception one) warns.
  // ============================================================

  describe('compound commands fail closed (#2039)', () => {
    const destructive: Array<[string, string]> = [
      // chained
      ['cd /tmp && rm -rf ./data', 'recursive delete'],
      ['echo done; rm -rf /var/data', 'recursive delete'],
      ['true || rm -rf /var/data', 'recursive delete'],
      ['git commit -m "done" && git push -f origin main', 'force-push'],
      ['cd /srv && docker system prune -a', 'Docker'],
      // piped
      ['true | rm -rf /var/data', 'recursive delete'],
      ['cat list.txt | xargs rm -rf', 'recursive delete'], // pipe-fed targets are unverifiable
      // newline-separated
      ['ls\nrm -rf /var/data', 'recursive delete'],
      // backgrounded
      ['rm -rf /var/data &', 'recursive delete'],
      ['sleep 1 & rm -rf /var/data', 'recursive delete'],
      // subshells and command substitution
      ['echo $(rm -rf /var/data)', 'recursive delete'],
      ['echo "$(rm -rf /var/data)"', 'recursive delete'],
      ['echo `rm -rf /var/data`', 'recursive delete'],
      ['(cd /tmp && rm -rf ./x)', 'recursive delete'],
      // reordered: safe-exception segment must not launder a destructive one,
      // in either order, and flag position must not matter
      ['rm -rf /precious && rm -rf node_modules', 'recursive delete'],
      ['rm -rf node_modules; rm -rf /var/data', 'recursive delete'],
      ['rm -f -r /var/data', 'recursive delete'],
      // embedded double quotes no longer truncate JSON extraction
      ['echo "x" && rm -rf /var/data', 'recursive delete'],
      ['echo "a; b"; rm -rf /var/data', 'recursive delete'],
    ];

    for (const [cmd, msg] of destructive) {
      test(`${JSON.stringify(cmd)} warns`, () => {
        const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput(cmd));
        expect(exitCode).toBe(0);
        expect(output.permissionDecision).toBe('ask');
        expect(output.message).toContain(msg);
      });
    }

    // Quote-aware splitting: destructive text INSIDE a quoted string is data,
    // not a command. These must NOT trigger.
    const safeLookalikes: string[] = [
      'echo "a && b"',
      'echo "rm -rf /"',
      'grep "rm -rf" deploy.log',
      "grep 'rm -rf' deploy.log",
      'git commit -m "fix: remove rm -rf call"',
      'printf "%s" "drop table users"',
      'echo one \\&\\& two', // escaped separators are literal text
      'VAR=$(cat file.txt)',
      'perform -r cleanup', // "rm" inside a word is not the rm command
      'docker run --rm -it img sh',
      'rm -rf node_modules && rm -rf dist', // chained safe exceptions stay safe
    ];

    for (const cmd of safeLookalikes) {
      test(`${JSON.stringify(cmd)} allows`, () => {
        const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput(cmd));
        expect(exitCode).toBe(0);
        expect(output.permissionDecision).toBeUndefined();
      });
    }
  });

  // Shell executors run their quoted argument as a command, so the quoted
  // text gets the full destructive-pattern scan there (and only there).
  describe('shell executors scan their quoted argument', () => {
    const executorDestructive: string[] = [
      'bash -c "rm -rf /var/data"',
      "sh -c 'rm -rf /var/data'",
      'sudo bash -c "rm -rf /var/data"',
      'eval "rm -rf /var/data"',
      'ssh host "rm -rf /var/data"',
    ];
    for (const cmd of executorDestructive) {
      test(`${JSON.stringify(cmd)} warns`, () => {
        const { exitCode, output } = runHook(CAREFUL_SCRIPT, carefulInput(cmd));
        expect(exitCode).toBe(0);
        expect(output.permissionDecision).toBe('ask');
        expect(output.message).toContain('recursive delete');
      });
    }

    test('bash -c "ls -la" allows', () => {
      const { output } = runHook(CAREFUL_SCRIPT, carefulInput('bash -c "ls -la"'));
      expect(output.permissionDecision).toBeUndefined();
    });

    test('ssh host "git status" allows', () => {
      const { output } = runHook(CAREFUL_SCRIPT, carefulInput('ssh host "git status"'));
      expect(output.permissionDecision).toBeUndefined();
    });
  });

  // JSON escapes must decode before tokenizing: an encoded separator
  // (; = ";") must still create a segment boundary.
  describe('JSON escape decoding', () => {
    test('\\u003b-encoded semicolon still splits segments', () => {
      const rawJson = '{"tool_input":{"command":"echo hi\\u003brm -rf /var/data"}}';
      const { exitCode, output } = runHookRaw(CAREFUL_SCRIPT, rawJson);
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('recursive delete');
    });
  });

  // The grep+awk fallback extractor (used when python3 is unavailable) must
  // uphold the same guarantees: decode escaped quotes instead of truncating,
  // split segments, and stay quiet on quoted lookalikes.
  describe('no-python3 fallback extractor', () => {
    let noPyDir = '';

    function makeNoPythonPath(): string {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'careful-nopy-'));
      for (const tool of ['grep', 'sed', 'tr', 'awk', 'head', 'cat', 'mkdir', 'date', 'basename']) {
        const p = spawnSync('/bin/bash', ['-c', `command -v ${tool}`]).stdout.toString().trim();
        if (p) fs.symlinkSync(p, path.join(dir, tool));
      }
      return dir;
    }

    function runHookNoPython(command: string): { exitCode: number; output: any } {
      if (!noPyDir) noPyDir = makeNoPythonPath();
      const result = spawnSync('/bin/bash', [CAREFUL_SCRIPT], {
        input: JSON.stringify({ tool_input: { command } }),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { PATH: noPyDir, HOME: os.homedir() },
        timeout: 5000,
      });
      let output: any = {};
      try {
        output = JSON.parse(result.stdout.toString().trim());
      } catch {}
      return { exitCode: result.status ?? 1, output };
    }

    test('chained destructive command warns without python3', () => {
      const { exitCode, output } = runHookNoPython('echo done; rm -rf /var/data');
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('recursive delete');
    });

    test('embedded escaped quotes no longer truncate extraction', () => {
      const { exitCode, output } = runHookNoPython('echo "x" && rm -rf /var/data');
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBe('ask');
      expect(output.message).toContain('recursive delete');
    });

    test('quoted lookalike allows without python3', () => {
      const { exitCode, output } = runHookNoPython('grep "rm -rf" deploy.log');
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBeUndefined();
    });

    test('safe rm exception still allows without python3', () => {
      const { exitCode, output } = runHookNoPython('rm -rf node_modules');
      expect(exitCode).toBe(0);
      expect(output.permissionDecision).toBeUndefined();
    });
  });
});

// ============================================================
// check-freeze.sh tests
// ============================================================
describe('check-freeze.sh', () => {

  describe('edits inside freeze boundary', () => {
    test('edit inside freeze boundary allows', () => {
      withFreezeDir('/Users/dev/project/src/', (stateDir) => {
        const { exitCode, output } = runHook(
          FREEZE_SCRIPT,
          freezeInput('/Users/dev/project/src/index.ts'),
          { CLAUDE_PLUGIN_DATA: stateDir },
        );
        expect(exitCode).toBe(0);
        expect(output.permissionDecision).toBeUndefined();
      });
    });

    test('edit in subdirectory of freeze path allows', () => {
      withFreezeDir('/Users/dev/project/src/', (stateDir) => {
        const { exitCode, output } = runHook(
          FREEZE_SCRIPT,
          freezeInput('/Users/dev/project/src/components/Button.tsx'),
          { CLAUDE_PLUGIN_DATA: stateDir },
        );
        expect(exitCode).toBe(0);
        expect(output.permissionDecision).toBeUndefined();
      });
    });
  });

  describe('edits outside freeze boundary', () => {
    test('edit outside freeze boundary denies', () => {
      withFreezeDir('/Users/dev/project/src/', (stateDir) => {
        const { exitCode, output } = runHook(
          FREEZE_SCRIPT,
          freezeInput('/Users/dev/other-project/index.ts'),
          { CLAUDE_PLUGIN_DATA: stateDir },
        );
        expect(exitCode).toBe(0);
        expect(output.permissionDecision).toBe('deny');
        expect(output.message).toContain('freeze');
        expect(output.message).toContain('outside');
      });
    });

    test('write outside freeze boundary denies', () => {
      withFreezeDir('/Users/dev/project/src/', (stateDir) => {
        const { exitCode, output } = runHook(
          FREEZE_SCRIPT,
          freezeInput('/etc/hosts'),
          { CLAUDE_PLUGIN_DATA: stateDir },
        );
        expect(exitCode).toBe(0);
        expect(output.permissionDecision).toBe('deny');
        expect(output.message).toContain('freeze');
        expect(output.message).toContain('outside');
      });
    });
  });

  describe('trailing slash prevents prefix confusion', () => {
    test('freeze at /src/ denies /src-old/ (trailing slash prevents prefix match)', () => {
      withFreezeDir('/Users/dev/project/src/', (stateDir) => {
        const { exitCode, output } = runHook(
          FREEZE_SCRIPT,
          freezeInput('/Users/dev/project/src-old/index.ts'),
          { CLAUDE_PLUGIN_DATA: stateDir },
        );
        expect(exitCode).toBe(0);
        expect(output.permissionDecision).toBe('deny');
        expect(output.message).toContain('outside');
      });
    });
  });

  describe('no freeze file exists', () => {
    test('allows everything when no freeze file present', () => {
      const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-freeze-test-'));
      try {
        const { exitCode, output } = runHook(
          FREEZE_SCRIPT,
          freezeInput('/anywhere/at/all.ts'),
          { CLAUDE_PLUGIN_DATA: stateDir },
        );
        expect(exitCode).toBe(0);
        expect(output.permissionDecision).toBeUndefined();
      } finally {
        fs.rmSync(stateDir, { recursive: true, force: true });
      }
    });
  });

  describe('edge cases', () => {
    test('missing file_path field allows gracefully', () => {
      withFreezeDir('/Users/dev/project/src/', (stateDir) => {
        const { exitCode, output } = runHook(
          FREEZE_SCRIPT,
          { tool_input: {} },
          { CLAUDE_PLUGIN_DATA: stateDir },
        );
        expect(exitCode).toBe(0);
        expect(output.permissionDecision).toBeUndefined();
      });
    });
  });
});
