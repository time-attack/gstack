import { describe, test, expect } from 'bun:test';
import { validateSkill } from './helpers/skill-parser';
import { ALL_COMMANDS, COMMAND_DESCRIPTIONS, READ_COMMANDS, WRITE_COMMANDS, META_COMMANDS } from '../browse/src/commands';
import { SNAPSHOT_FLAGS } from '../browse/src/snapshot';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const PUBLIC_SKILLS = ['debug', 'plan', 'qa', 'review', 'ship'] as const;

function publicSkillPath(skill: string): string {
  return path.join(ROOT, 'skills', skill, 'SKILL.md');
}

describe('SKILL.md command validation', () => {
  test('root SKILL.md is absent and the public surface is five dispatchers plus the make-pdf tool skill', () => {
    expect(fs.existsSync(path.join(ROOT, 'SKILL.md'))).toBe(false);

    const discovered = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(publicSkillPath(entry.name)))
      .map((entry) => entry.name)
      .sort();
    expect(discovered).toEqual([...PUBLIC_SKILLS, 'make-pdf'].sort());

    for (const skill of PUBLIC_SKILLS) {
      const md = fs.readFileSync(publicSkillPath(skill), 'utf-8');
      expect(md).toMatch(new RegExp(`^---\\nname: ${skill}\\n`));
      expect(md).toContain('## Required execution header');
      const result = validateSkill(publicSkillPath(skill));
      expect(result.invalid).toHaveLength(0);
    }
  });

  test('all $B commands in browse/SKILL.md are valid browse commands', () => {
    const result = validateSkill(path.join(ROOT, 'browse', 'SKILL.md'));
    expect(result.invalid).toHaveLength(0);
    expect(result.valid.length).toBeGreaterThan(0);
  });

  test('all snapshot flags in browse/SKILL.md are valid', () => {
    const result = validateSkill(path.join(ROOT, 'browse', 'SKILL.md'));
    expect(result.snapshotFlagErrors).toHaveLength(0);
  });
});

describe('Command registry consistency', () => {
  test('COMMAND_DESCRIPTIONS covers all commands in sets', () => {
    const allCmds = new Set([...READ_COMMANDS, ...WRITE_COMMANDS, ...META_COMMANDS]);
    const descKeys = new Set(Object.keys(COMMAND_DESCRIPTIONS));
    for (const cmd of allCmds) {
      expect(descKeys.has(cmd)).toBe(true);
    }
  });

  test('COMMAND_DESCRIPTIONS has no extra commands not in sets', () => {
    const allCmds = new Set([...READ_COMMANDS, ...WRITE_COMMANDS, ...META_COMMANDS]);
    for (const key of Object.keys(COMMAND_DESCRIPTIONS)) {
      expect(allCmds.has(key)).toBe(true);
    }
  });

  test('ALL_COMMANDS matches union of all sets', () => {
    const union = new Set([...READ_COMMANDS, ...WRITE_COMMANDS, ...META_COMMANDS]);
    expect(ALL_COMMANDS.size).toBe(union.size);
    for (const cmd of union) {
      expect(ALL_COMMANDS.has(cmd)).toBe(true);
    }
  });

  test('SNAPSHOT_FLAGS option keys are valid SnapshotOptions fields', () => {
    const validKeys = new Set([
      'interactive', 'compact', 'depth', 'selector',
      'diff', 'annotate', 'outputPath', 'cursorInteractive',
      'heatmap',
    ]);
    for (const flag of SNAPSHOT_FLAGS) {
      expect(validKeys.has(flag.optionKey)).toBe(true);
    }
  });
});

describe('Usage string consistency', () => {
  // Normalize a usage string to its structural skeleton for comparison.
  // Replaces <param-names> with <>, [optional] with [], strips parenthetical hints.
  // This catches format mismatches (e.g., <name>:<value> vs <name> <value>)
  // without tripping on abbreviation differences (e.g., <sel> vs <selector>).
  function skeleton(usage: string): string {
    return usage
      .replace(/\(.*?\)/g, '')        // strip parenthetical hints like (e.g., Enter, Tab)
      .replace(/<[^>]*>/g, '<>')      // normalize <param-name> → <>
      .replace(/\[[^\]]*\]/g, '[]')   // normalize [optional] → []
      .replace(/\s+/g, ' ')           // collapse whitespace
      .trim();
  }

  // Cross-check Usage: patterns in implementation against COMMAND_DESCRIPTIONS
  test('implementation Usage: structural format matches COMMAND_DESCRIPTIONS', () => {
    const implFiles = [
      path.join(ROOT, 'browse', 'src', 'write-commands.ts'),
      path.join(ROOT, 'browse', 'src', 'read-commands.ts'),
      path.join(ROOT, 'browse', 'src', 'meta-commands.ts'),
    ];

    // Extract "Usage: browse <pattern>" from throw new Error(...) calls
    const usagePattern = /throw new Error\(['"`]Usage:\s*browse\s+(.+?)['"`]\)/g;
    const implUsages = new Map<string, string>();

    for (const file of implFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      let match;
      while ((match = usagePattern.exec(content)) !== null) {
        const usage = match[1].split('\\n')[0].trim();
        const cmd = usage.split(/\s/)[0];
        implUsages.set(cmd, usage);
      }
    }

    // Compare structural skeletons
    const mismatches: string[] = [];
    for (const [cmd, implUsage] of implUsages) {
      const desc = COMMAND_DESCRIPTIONS[cmd];
      if (!desc) continue;
      if (!desc.usage) continue;
      const descSkel = skeleton(desc.usage);
      const implSkel = skeleton(implUsage);
      if (descSkel !== implSkel) {
        mismatches.push(`${cmd}: docs "${desc.usage}" (${descSkel}) vs impl "${implUsage}" (${implSkel})`);
      }
    }

    expect(mismatches).toEqual([]);
  });
});

describe('Generated SKILL.md freshness', () => {
  test('no unresolved {{placeholders}} in the six public dispatchers', () => {
    for (const skill of PUBLIC_SKILLS) {
      const content = fs.readFileSync(publicSkillPath(skill), 'utf-8');
      const unresolved = content.match(/\{\{\w+\}\}/g);
      expect(unresolved).toBeNull();
    }
  });

  test('no unresolved {{placeholders}} in generated browse/SKILL.md', () => {
    const content = fs.readFileSync(path.join(ROOT, 'browse', 'SKILL.md'), 'utf-8');
    const unresolved = content.match(/\{\{\w+\}\}/g);
    expect(unresolved).toBeNull();
  });

  test('retired root stays absent and public dispatchers route to preserved judgment', () => {
    expect(fs.existsSync(path.join(ROOT, 'SKILL.md'))).toBe(false);
    for (const skill of PUBLIC_SKILLS) {
      const content = fs.readFileSync(publicSkillPath(skill), 'utf-8');
      expect(content).toContain('references/legacy/');
      expect(content).toContain('references/SHARED-JUDGMENT.md');
    }
  });
});

// --- Part 7: Planted-bug fixture validation (A4) ---

describe('Planted-bug fixture validation', () => {
  test('qa-eval ground truth has exactly 5 planted bugs', () => {
    const groundTruth = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'qa-eval-ground-truth.json'), 'utf-8')
    );
    expect(groundTruth.bugs).toHaveLength(5);
    expect(groundTruth.total_bugs).toBe(5);
  });

  test('qa-eval-spa ground truth has exactly 5 planted bugs', () => {
    const groundTruth = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'qa-eval-spa-ground-truth.json'), 'utf-8')
    );
    expect(groundTruth.bugs).toHaveLength(5);
    expect(groundTruth.total_bugs).toBe(5);
  });

  test('qa-eval-checkout ground truth has exactly 5 planted bugs', () => {
    const groundTruth = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'qa-eval-checkout-ground-truth.json'), 'utf-8')
    );
    expect(groundTruth.bugs).toHaveLength(5);
    expect(groundTruth.total_bugs).toBe(5);
  });

  test('qa-eval.html contains the planted bugs', () => {
    const html = fs.readFileSync(path.join(ROOT, 'browse', 'test', 'fixtures', 'qa-eval.html'), 'utf-8');
    // BUG 1: broken link
    expect(html).toContain('/nonexistent-404-page');
    // BUG 2: disabled submit
    expect(html).toContain('disabled');
    // BUG 3: overflow
    expect(html).toContain('overflow: hidden');
    // BUG 4: missing alt
    expect(html).toMatch(/<img[^>]*src="\/logo\.png"[^>]*>/);
    expect(html).not.toMatch(/<img[^>]*src="\/logo\.png"[^>]*alt=/);
    // BUG 5: console error
    expect(html).toContain("Cannot read properties of undefined");
  });

  test('review-eval-vuln.rb contains expected vulnerability patterns', () => {
    const content = fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'review-eval-vuln.rb'), 'utf-8');
    expect(content).toContain('params[:id]');
    expect(content).toContain('update_column');
  });
});

// --- gstack-slug helper ---

describe('gstack-slug', () => {
  const SLUG_BIN = path.join(ROOT, 'bin', 'gstack-slug');

  test('binary exists and is executable', () => {
    expect(fs.existsSync(SLUG_BIN)).toBe(true);
    const stat = fs.statSync(SLUG_BIN);
    expect(stat.mode & 0o111).toBeGreaterThan(0);
  });

  test('outputs display and canonical worktree identities in a git repo', () => {
    const result = Bun.spawnSync([SLUG_BIN], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toContain('SLUG=');
    expect(output).toContain('BRANCH=');
    expect(output).toContain('PROJECT_ID=project_');
    expect(output).toContain('REPO_ID=repo_');
    expect(output).toContain('WORKTREE_ID=worktree_');
  });

  test('SLUG does not contain forward slashes', () => {
    const result = Bun.spawnSync([SLUG_BIN], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
    const slug = result.stdout.toString().match(/SLUG=(.*)/)?.[1] ?? '';
    expect(slug).not.toContain('/');
    expect(slug.length).toBeGreaterThan(0);
  });

  test('BRANCH does not contain forward slashes', () => {
    const result = Bun.spawnSync([SLUG_BIN], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
    const branch = result.stdout.toString().match(/BRANCH=(.*)/)?.[1] ?? '';
    expect(branch).not.toContain('/');
    expect(branch.length).toBeGreaterThan(0);
  });

  test('output is eval-compatible (KEY=VALUE format)', () => {
    const result = Bun.spawnSync([SLUG_BIN], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
    const lines = result.stdout.toString().trim().split('\n');
    expect(lines.length).toBe(5);
    expect(lines[0]).toMatch(/^SLUG=.+/);
    expect(lines[1]).toMatch(/^BRANCH=.+/);
    expect(lines[2]).toMatch(/^PROJECT_ID=project_[a-f0-9]+$/);
    expect(lines[3]).toMatch(/^REPO_ID=repo_[a-f0-9]+$/);
    expect(lines[4]).toMatch(/^WORKTREE_ID=worktree_[a-f0-9]+$/);
  });

  test('output values contain only safe characters (no shell metacharacters)', () => {
    const result = Bun.spawnSync([SLUG_BIN], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
    const slug = result.stdout.toString().match(/SLUG=(.*)/)?.[1] ?? '';
    const branch = result.stdout.toString().match(/BRANCH=(.*)/)?.[1] ?? '';
    // Only alphanumeric, dot, dash, underscore are allowed (#133)
    expect(slug).toMatch(/^[a-zA-Z0-9._-]+$/);
    expect(branch).toMatch(/^[a-zA-Z0-9._-]+$/);
  });
  test('eval sets variables under bash with set -euo pipefail', () => {
    const result = Bun.spawnSync(
      ['bash', '-c', 'set -euo pipefail; eval "$(./bin/gstack-slug 2>/dev/null)"; echo "SLUG=$SLUG"; echo "BRANCH=$BRANCH"'],
      { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' }
    );
    expect(result.exitCode).toBe(0);
    const output = result.stdout.toString();
    expect(output).toMatch(/^SLUG=.+/m);
    expect(output).toMatch(/^BRANCH=.+/m);
  });

  test('no templates or bin scripts use source process substitution for gstack-slug', () => {
    const result = Bun.spawnSync(
      ['grep', '-r', 'source <(.*gstack-slug', '--include=*.tmpl', '--include=gstack-review-*', '.'],
      { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' }
    );
    // grep returns exit code 1 when no matches found — that's what we want
    expect(result.stdout.toString().trim()).toBe('');
  });
});

// ─── Doc-inventory cross-check ───────────────────────────────
//
// AGENTS.md must document exactly the five public dispatchers, and the shipped
// skills/ tree must contain exactly those five plus the make-pdf tool skill.

describe('Doc inventory cross-check', () => {
  test('AGENTS.md documents the exact five-skill public surface', () => {
    const agents = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf-8');
    expect(agents).toContain('GStack 2 exposes exactly five default public skills');
    for (const skill of PUBLIC_SKILLS) {
      expect(agents).toContain(`| \`/${skill}\` |`);
    }

    const publicDirs = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && fs.existsSync(publicSkillPath(entry.name)))
      .map((entry) => entry.name)
      .sort();
    // Five judgment dispatchers plus the make-pdf tool skill in the same tree.
    expect(publicDirs).toEqual([...PUBLIC_SKILLS, 'make-pdf'].sort());
  });
});

// --- Repo mode validation ---

describe('Repo mode preamble validation', () => {
  test('all public dispatchers require the ordered GStack 2 execution header', () => {
    const labels = ['Target:', 'Mode:', 'Depth:', 'Mutation:', 'Active modules:', 'Skipped modules:', 'Web context:'];
    for (const skill of PUBLIC_SKILLS) {
      const content = fs.readFileSync(publicSkillPath(skill), 'utf-8');
      let previous = -1;
      for (const label of labels) {
        const current = content.indexOf(label);
        expect(current).toBeGreaterThan(previous);
        previous = current;
      }
    }
  });
});

describe('no compiled binaries in git', () => {
  // Tracked files enumerated once and reused by both assertions. git ls-files -z
  // + split is ~ms; the previous xargs-per-file shell loops blew past 5s on CI.
  const trackedFiles: string[] = require('child_process')
    .execSync('git ls-files -z', { cwd: ROOT, encoding: 'utf-8' })
    .split('\0')
    .filter(Boolean);

  test('git tracks no Mach-O or ELF binaries', () => {
    // Only mode 100755 (executable) files can be binaries we care about. Pre-filter
    // via git ls-files -s to avoid running `file` on every text file.
    const lsOut: string = require('child_process').execSync('git ls-files -s', {
      cwd: ROOT,
      encoding: 'utf-8',
    });
    const executableFiles = lsOut
      .split('\n')
      .filter(Boolean)
      .map((line: string) => {
        const parts = line.split(/\s+/);
        return { mode: parts[0], file: line.split('\t')[1] };
      })
      .filter((e: { mode: string; file: string }) => e.mode === '100755')
      .map((e: { mode: string; file: string }) => e.file);

    if (executableFiles.length === 0) return;

    // Batch-invoke `file --mime-type` across all executable files at once.
    const result: string = require('child_process')
      .execSync(`file --mime-type -- ${executableFiles.map((f: string) => `'${f.replace(/'/g, "'\\''")}'`).join(' ')}`, {
        cwd: ROOT,
        encoding: 'utf-8',
      })
      .trim();

    const binaries = result
      .split('\n')
      .filter((l: string) =>
        /application\/(x-mach-binary|x-executable|x-pie-executable|x-sharedlib)/.test(l)
      )
      .map((l: string) => l.split(':')[0].trim());

    expect(binaries).toEqual([]);
  });

  test('warns about tracked files larger than 2MB', () => {
    // Large fixtures can be legitimate test infrastructure. Keep visibility on
    // repository size without blocking those fixtures from living in git.
    // Known-good fixtures are exempted from the warning to keep CI logs clean.
    const MAX_BYTES = 2 * 1024 * 1024;
    const knownLargeFixtures = new Set([
      // Deterministic replay fixture for BrowseSafe-Bench. The live bench is
      // expensive; this file is intentionally committed so the gate is free.
      'browse/test/fixtures/security-bench-haiku-responses.json',
    ]);
    const oversized = trackedFiles.flatMap((f: string) => {
      if (knownLargeFixtures.has(f)) return [];
      const full = path.join(ROOT, f);
      try {
        const size = fs.statSync(full).size;
        return size > MAX_BYTES ? [{ file: f, size }] : [];
      } catch {
        return [];
      }
    });

    if (oversized.length > 0) {
      const formatted = oversized
        .map(({ file, size }: { file: string; size: number }) => {
          const mib = (size / (1024 * 1024)).toFixed(1);
          return `${file} (${mib} MiB)`;
        })
        .join(', ');
      console.warn(`[size-warning] tracked files over 2 MiB: ${formatted}`);
    }

    expect(Array.isArray(oversized)).toBe(true);
  });
});

// `sidebar agent (#584)` describe block was here. sidebar-agent.ts and
// the entire chat-queue path were ripped in favor of the interactive
// claude PTY (terminal-agent.ts); these assertions had no target file.
// Terminal-pane invariants are covered by browse/test/sidebar-tabs.test.ts
// and browse/test/terminal-agent.test.ts.

// ─── Browser-skills validation ──────────────────────────────────
//
// Browser-skills are bundled in <gstack-root>/browser-skills/<name>/. Each
// must have a SKILL.md whose frontmatter satisfies the contract enforced by
// browse/src/browser-skills.ts:parseSkillFile (host required, args + triggers
// parseable as the right shape). This test catches malformed bundled skills
// at CI time, before they ship.

describe('Bundled browser-skills frontmatter contract', () => {
  const browserSkillsRoot = path.join(ROOT, 'browser-skills');

  function listBundledSkillDirs(): string[] {
    if (!fs.existsSync(browserSkillsRoot)) return [];
    return fs.readdirSync(browserSkillsRoot)
      .filter(name => !name.startsWith('.'))
      .map(name => path.join(browserSkillsRoot, name))
      .filter(dir => {
        try { return fs.statSync(dir).isDirectory(); } catch { return false; }
      });
  }

  test('each bundled skill has a SKILL.md', () => {
    for (const dir of listBundledSkillDirs()) {
      const skillFile = path.join(dir, 'SKILL.md');
      expect(fs.existsSync(skillFile)).toBe(true);
    }
  });

  test('each bundled skill SKILL.md frontmatter parses with required fields', async () => {
    const { parseSkillFile } = await import('../browse/src/browser-skills');
    for (const dir of listBundledSkillDirs()) {
      const name = path.basename(dir);
      const content = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
      // parseSkillFile throws on missing required fields; we just want to
      // make sure none of our shipped skills tripwire it.
      const { frontmatter } = parseSkillFile(content, { skillName: name });
      expect(frontmatter.name).toBe(name);
      expect(typeof frontmatter.host).toBe('string');
      expect(frontmatter.host.length).toBeGreaterThan(0);
      expect(Array.isArray(frontmatter.triggers)).toBe(true);
      expect(Array.isArray(frontmatter.args)).toBe(true);
    }
  });

  test('each bundled skill has a script.ts', () => {
    for (const dir of listBundledSkillDirs()) {
      expect(fs.existsSync(path.join(dir, 'script.ts'))).toBe(true);
    }
  });

  test('each bundled skill ships a sibling SDK at _lib/browse-client.ts', () => {
    for (const dir of listBundledSkillDirs()) {
      expect(fs.existsSync(path.join(dir, '_lib', 'browse-client.ts'))).toBe(true);
    }
  });

  test('each bundled skill has a script.test.ts', () => {
    for (const dir of listBundledSkillDirs()) {
      expect(fs.existsSync(path.join(dir, 'script.test.ts'))).toBe(true);
    }
  });

  test("each bundled skill's _lib/browse-client.ts matches the canonical SDK", () => {
    // If the canonical SDK changes, the bundled copy must be updated. This
    // test enforces that — the _lib copy should be byte-identical.
    const canonical = fs.readFileSync(path.join(ROOT, 'browse', 'src', 'browse-client.ts'), 'utf-8');
    for (const dir of listBundledSkillDirs()) {
      const sibling = fs.readFileSync(path.join(dir, '_lib', 'browse-client.ts'), 'utf-8');
      expect(sibling).toBe(canonical);
    }
  });

  test('script.ts imports browse from ./_lib/browse-client', () => {
    for (const dir of listBundledSkillDirs()) {
      const content = fs.readFileSync(path.join(dir, 'script.ts'), 'utf-8');
      expect(content).toMatch(/from\s+['"]\.\/_lib\/browse-client['"]/);
    }
  });
});
