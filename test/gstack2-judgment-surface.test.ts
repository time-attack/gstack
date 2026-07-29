/**
 * Static tripwires for the generator judgment surface (gstack2-judgment-surface
 * branch). Each describe block greps the RENDERED tree (skills/, compat/) for a
 * forbidden shape that a generator regression could silently reintroduce. These
 * are free static tests; they read files and never spawn model calls.
 *
 * Covered classes:
 *   #1 Codex portable dispatch (#2370/#2372): mktemp suffix templates and
 *      argv-cat prompt dispatch fail on macOS/Alpine masquerading as a stall.
 *   #2 setup-deploy key echo (#1078/#1096) + update-check retirement (#1081):
 *      no rendered module echoes credential bytes; the 2.0 runtime ships no
 *      passive release-check helper.
 */
import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');

function markdownFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const child = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(child));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(child);
  }
  return out.sort();
}

const RENDERED_MARKDOWN = [
  ...markdownFiles(path.join(ROOT, 'skills')),
  ...markdownFiles(path.join(ROOT, 'compat')),
];

function findings(matcher: (line: string) => boolean): string[] {
  const hits: string[] = [];
  for (const file of RENDERED_MARKDOWN) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (matcher(line)) hits.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim()}`);
    });
  }
  return hits;
}

describe('codex portable dispatch (#2370)', () => {
  test('rendered tree is discoverable', () => {
    expect(RENDERED_MARKDOWN.length).toBeGreaterThan(50);
  });

  test('no mktemp template carries a suffix after its X run', () => {
    // BSD/BusyBox mktemp require trailing Xs. Extract the template argument
    // from every `mktemp <template>` invocation and require any X-run template
    // to END with that run — `codex-err-XXXXXX.txt` fails on macOS from the
    // second run and on Alpine from the first.
    const bad = findings((line) => {
      const match = line.match(/mktemp\s+(?:"([^"]+)"|([^\s)"'`]+))/);
      if (!match) return false;
      const template = match[1] ?? match[2];
      if (!template.includes('XXX')) return false;
      return !/X{6,}$/.test(template);
    });
    expect(bad).toEqual([]);
  });

  test('no outside-voice dispatch inlines a prompt file into argv via $(cat ...)', () => {
    const bad = findings((line) => /(?:codex exec|codex review|claude -p)[^\n]*\$\(cat /.test(line));
    expect(bad).toEqual([]);
  });

  test('the portable-dispatch judgment port is anchored in both outside-voice modules', () => {
    for (const module of ['codex', 'claude']) {
      const rendered = fs.readFileSync(
        path.join(ROOT, 'skills', 'review', 'references', 'legacy', `${module}.md`),
        'utf8',
      );
      expect(rendered).toContain('anchor=GSTACK2_FIX_2370_PORTABLE_DISPATCH');
    }
  });
});

describe('credential echo + update-check retirement (#1078, #1081)', () => {
  test('no rendered module echoes credential bytes into the transcript', () => {
    // Presence checks are fine; printing any part of a key/token/secret
    // (including `| head -c 4` prefixes) is not.
    const bad = findings((line) => {
      if (!/(?:echo|printf)\b/.test(line)) return false;
      if (/\[ -n /.test(line)) return false; // presence-only check, no bytes printed
      // Escaped `\$VAR` in user-facing prose never expands; an unescaped
      // `$VAR` on an echo/printf line does.
      return /(?<!\\)\$\{?[A-Za-z_]*(?:API_KEY|_TOKEN|_SECRET)\b/.test(line);
    });
    expect(bad).toEqual([]);
  });

  test('setup-deploy verifies the Render key by presence only', () => {
    const setupDeploy = fs.readFileSync(
      path.join(ROOT, 'skills', 'ship', 'references', 'legacy', 'setup-deploy.md'),
      'utf8',
    );
    expect(setupDeploy).not.toContain('echo $RENDER_API_KEY');
    expect(setupDeploy).toContain('[ -n "$RENDER_API_KEY" ]');
    expect(setupDeploy).toContain('anchor=GSTACK2_FIX_1078_NO_KEY_ECHO');
  });

  test('the rendered tree never names or invokes gstack-update-check', () => {
    const bad = findings((line) => line.includes('gstack-update-check'));
    expect(bad).toEqual([]);
  });

  test('the 2.0 managed runtime helper set excludes gstack-update-check', () => {
    const install = fs.readFileSync(path.join(ROOT, 'runtime', 'install.js'), 'utf8');
    expect(install).not.toContain('"gstack-update-check": helper(');
    const closure = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'evals', 'parity', 'runtime-helper-closure.json'), 'utf8'),
    );
    expect(closure.helpers.map((entry: { name: string }) => entry.name)).not.toContain('gstack-update-check');
  });
});
