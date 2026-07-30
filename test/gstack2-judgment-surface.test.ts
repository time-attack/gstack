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
 *   #3 Ship external effects (#1079/#1892): PR mutations use the canonical
 *      REST PATCH, never the GraphQL PR-edit subcommand; codex passes prove
 *      they ran via the sandbox canary; effects discipline defined without
 *      the runtime.
 *   #4 Question-format class (#1208/#1066/#2035): one packaged
 *      QUESTION-FORMAT reference, no dangling preamble-format pointers, and
 *      hooks emit only documented permissionDecision values.
 *   #6 Restored required ports #1777/#1920/#2189 (silently dropped with the
 *      /design retirement) anchored at their surviving dispatched modules.
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
    // The parity closure artifact (evals/parity/runtime-helper-closure.json) was
    // removed with the generation apparatus; install.js is the source of truth.
  });
});

describe('ship external effects (#1079, #1892)', () => {
  test('zero GraphQL PR-edit invocations anywhere in the rendered tree', () => {
    const bad = findings((line) => /gh pr edit/.test(line));
    expect(bad).toEqual([]);
  });

  test('EXTERNAL-EFFECTS carries the canonical REST block, canary, and no-runtime fallback', () => {
    const effects = fs.readFileSync(
      path.join(ROOT, 'skills', 'ship', 'references', 'EXTERNAL-EFFECTS.md'),
      'utf8',
    );
    expect(effects).toContain('gh api -X PATCH "repos/:owner/:repo/pulls/$(gh pr view --json number -q .number)"');
    expect(effects).toContain('gh api -X POST "repos/:owner/:repo/pulls"');
    expect(effects).toContain('_gstack_codex_sandbox_canary');
    expect(effects).toContain('CODEX_SANDBOX_UNAVAILABLE');
    expect(effects).toContain('## No-runtime fallback');
    expect(effects).toContain('Never retry automatically');
  });

  test('every rewritten PR-edit site uses the canonical REST PATCH form', () => {
    const canonical = 'gh api -X PATCH "repos/:owner/:repo/pulls/$(gh pr view --json number -q .number)"';
    const prBody = fs.readFileSync(
      path.join(ROOT, 'skills', 'ship', 'references', 'sections', 'ship', 'pr-body.md'),
      'utf8',
    );
    const releaseBody = fs.readFileSync(
      path.join(ROOT, 'skills', 'ship', 'references', 'sections', 'document-release', 'release-body.md'),
      'utf8',
    );
    expect(prBody).toContain(`${canonical} -F body=@"$PR_BODY_FILE"`);
    expect(prBody).toContain(`${canonical} -f title="$NEW_TITLE"`);
    expect(releaseBody).toContain(`${canonical} -F body=@/tmp/gstack-pr-body-$$.md`);
    expect(releaseBody).toContain(`${canonical} -f title="$NEW_TITLE"`);
  });

  test('the sandbox canary fails closed with a typed code and no model literal', () => {
    const probe = fs.readFileSync(path.join(ROOT, 'bin', 'gstack-codex-probe'), 'utf8');
    expect(probe).toContain('_gstack_codex_sandbox_canary()');
    expect(probe).toContain('CODEX_SANDBOX_UNAVAILABLE');
    expect(probe).toMatch(/bwrap\|bubblewrap\|user\[ _-\]\?namespace/);
    // Host-neutral: the canary invocation must not pin a model.
    const invocations = probe.split('\n').filter((line) => /codex exec/.test(line));
    expect(invocations.length).toBeGreaterThan(0);
    for (const line of invocations) expect(line).not.toContain('--model');
    const syntax = Bun.spawnSync({ cmd: ['bash', '-n', path.join(ROOT, 'bin', 'gstack-codex-probe')] });
    expect(syntax.exitCode).toBe(0);
  });

  test('the external-effects judgment port is anchored in all four targets', () => {
    for (const [tree, module] of [
      ['ship', 'ship'],
      ['ship', 'land-and-deploy'],
      ['ship', 'document-release'],
      ['review', 'codex'],
    ] as const) {
      const rendered = fs.readFileSync(
        path.join(ROOT, 'skills', tree, 'references', 'legacy', `${module}.md`),
        'utf8',
      );
      expect(rendered).toContain('anchor=GSTACK2_FIX_1079_EXTERNAL_EFFECTS');
    }
  });
});

describe('question-format class (#1208, #1066, #2035)', () => {
  const TREES = ['plan', 'qa', 'debug', 'review', 'ship'] as const;

  test('the packaged QUESTION-FORMAT reference exists in every dispatcher tree', () => {
    for (const tree of TREES) {
      const file = path.join(ROOT, 'skills', tree, 'references', 'QUESTION-FORMAT.md');
      expect(fs.existsSync(file)).toBe(true);
      const content = fs.readFileSync(file, 'utf8');
      expect(content).toContain('as direct assistant text');
      expect(content).toContain('ONE short sentence');
      expect(content).toContain('At most 4 options per call');
      expect(content).toContain('NEVER silently default');
    }
  });

  test('every dispatcher that asks questions loads the QUESTION-FORMAT reference', () => {
    for (const tree of TREES) {
      const skill = fs.readFileSync(path.join(ROOT, 'skills', tree, 'SKILL.md'), 'utf8');
      expect(skill).toContain('references/QUESTION-FORMAT.md');
    }
  });

  test('no module still references the excluded preamble format section', () => {
    const bad = findings((line) => /preamble(?:'s)? (?:AskUserQuestion )?[Ff]ormat/.test(line));
    expect(bad).toEqual([]);
  });

  test('SHARED-JUDGMENT carries the no-silent-default fallback rule', () => {
    for (const tree of TREES) {
      const shared = fs.readFileSync(
        path.join(ROOT, 'skills', tree, 'references', 'SHARED-JUDGMENT.md'),
        'utf8',
      );
      expect(shared).toContain('render the identical options as numbered prose');
      expect(shared).toContain('NEVER silently default');
    }
  });

  test('hooks emit only documented permissionDecision values', () => {
    const hooksDir = path.join(ROOT, 'hosts', 'claude', 'hooks');
    const hookSources = fs.readdirSync(hooksDir).filter((name) => name.endsWith('.ts'));
    expect(hookSources.length).toBeGreaterThan(0);
    for (const name of hookSources) {
      const source = fs.readFileSync(path.join(hooksDir, name), 'utf8');
      for (const match of source.matchAll(/permissionDecision:\s*'([^']+)'/g)) {
        expect(['allow', 'deny', 'ask']).toContain(match[1]);
      }
    }
  });
});

describe('restored design-judgment ports (#1777, #1920, #2189)', () => {
  test('each restored port is anchored in its surviving dispatched modules', () => {
    const anchors: Array<[string, string, string]> = [
      ['plan', 'office-hours', 'anchor=GSTACK2_FIX_1777_REJECTION_CONFIDENCE'],
      ['qa', 'qa', 'anchor=GSTACK2_FIX_1920_INFER_DESIGN_SYSTEM'],
      ['qa', 'qa-only', 'anchor=GSTACK2_FIX_1920_INFER_DESIGN_SYSTEM'],
      ['plan', 'plan-ceo-review', 'anchor=GSTACK2_FIX_2189_DESIGN_THESIS_EQUIVALENCE'],
      ['plan', 'office-hours', 'anchor=GSTACK2_FIX_2189_DESIGN_THESIS_EQUIVALENCE'],
    ];
    for (const [tree, module, anchor] of anchors) {
      const rendered = fs.readFileSync(
        path.join(ROOT, 'skills', tree, 'references', 'legacy', `${module}.md`),
        'utf8',
      );
      expect(rendered).toContain(anchor);
    }
  });

  test('each restored port ships an executable regression fixture', () => {
    for (const pr of [1777, 1920, 2189]) {
      const fixture = path.join(ROOT, 'evals', 'parity', 'regressions', `pr-${pr}.json`);
      expect(fs.existsSync(fixture)).toBe(true);
    }
  });
});
