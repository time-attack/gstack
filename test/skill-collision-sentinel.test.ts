/**
 * Collision Sentinel — insurance policy against upstream slash-command collisions.
 *
 * History: in April 2026 Claude Code shipped /checkpoint as a native alias
 * for /rewind, silently shadowing the gstack /checkpoint skill. Users
 * typed /checkpoint expecting to save state; agents routed to the built-in
 * or confabulated "this is a built-in you need to type directly" and nothing
 * was saved. We found out from users, not from tests.
 *
 * This file is the "never again" test. It enumerates every gstack skill name
 * from the SHIPPED surface (`skills/<name>/SKILL.md` plus the compatibility
 * aliases in `skills/.compat/<name>/SKILL.md`) and cross-checks against a
 * per-host list of known built-in slash commands. If any gstack skill name
 * collides with a host built-in, this test fails and names the collision.
 *
 * Maintenance: when Claude Code (or any other host we support) ships a new
 * built-in slash command, add the name to the host's KNOWN_BUILTINS list
 * below. If a gstack skill needs to coexist with a built-in anyway (e.g.,
 * we decide the semantic overlap is acceptable), add it to
 * KNOWN_COLLISIONS_TOLERATED with a written justification.
 *
 * Free tier. ~50ms runtime.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');

// ─── Host built-in registries ──────────────────────────────────────────────
//
// One const per host we support. Names are the slash-command identifier WITHOUT
// the leading slash. Keep sorted alphabetically within each host so diffs are
// reviewable. Cite the source (docs URL, release notes, or "observed") in the
// comment next to each entry — future maintainers need to know why an entry
// is on the list.

const KNOWN_BUILTINS: Record<string, string[]> = {
  'claude-code': [
    // Slash commands observed in 'claude --help' or cited in docs as of 2026-04.
    // Sources:
    //   https://code.claude.com/docs/en/checkpointing
    //   https://claudelog.com/mechanics/rewind/
    //   claude --help output
    //   Claude Code skill list dumps from live sessions
    'agents',         // Agent config
    'bare',           // Minimal mode
    'checkpoint',     // Alias of /rewind (the collision that started this file)
    'clear',          // Clear the conversation
    'compact',        // Context compaction
    'config',         // Config UI
    'context',        // Context usage display
    'continue',       // --continue / resume last conversation
    'cost',           // Cost display
    'debug',          // Native debugging command (cited as shipped in CLAUDE.md's
                      // GStack 2 canonical contract alongside /verify and /batch)
    'exit',           // Exit shell
    'help',           // Help
    'init',           // Initialize a new CLAUDE.md file
    'mcp',            // MCP server config
    'model',          // Model selection
    'permissions',    // Permission config
    'plan',           // Plan mode toggle (also Shift+Tab)
    'quit',           // Quit
    'review',         // Review a pull request (BUILT-IN shipped in 2026)
    'rewind',         // Conversation rewind
    'security-review', // Security audit of pending changes
    'stats',          // Session stats
    'usage',          // API usage stats
  ],
  // Add codex/kiro/opencode/slate/cursor/openclaw/hermes/factory/gbrain
  // built-in lists when we encounter collisions. Claude Code is the primary
  // shadow risk because it's the biggest audience and ships the most
  // frequently; other hosts collide less often.
  // TODO: codex CLI built-ins (login, logout, exec, review, etc. — but we
  // invoke codex from gstack, we don't install skills INTO codex the same
  // way, so this is lower priority).
};

// Collisions we know about and have consciously decided to tolerate. The
// justification is mandatory — reviewers need the context next time the
// user reports confusion, and blind additions to this map should fail code
// review.
const KNOWN_COLLISIONS_TOLERATED: Record<string, string> = {
  // skill name → one-line justification + action plan
  'debug': 'gstack /debug is one of the five judgment dispatchers the CLAUDE.md canonical contract names deliberately, and it is reached by Skill-tool routing on the request ("this is failing, find the cause") rather than by a typed slash command, so it coexists with the native /debug the same way /plan does. COST, stated plainly: a user who TYPES /debug gets the host built-in, not gstack — same shadowing shape as the 2026 /checkpoint incident, minus the silent-data-loss part. Watch for user reports of "I typed /debug and gstack never ran"; if they arrive, namespace to /gstack-debug.',
  'plan': 'gstack /plan is a canonical-contract dispatcher (six modes: Discovery, Product, Engineering, DX, Specification, Full chain) invoked through the Skill tool by request match, while Claude Code /plan is a mode toggle bound to Shift+Tab — both are live in the same session today, so the Skill-tool path is not blocked. COST, stated plainly: the TYPED /plan reaches the host toggle, not gstack. Watch for user reports; namespace to /gstack-plan if they arrive.',
  'review': 'gstack /review (pre-landing diff analysis) pre-dates the Claude Code built-in /review (Review a pull request). The gstack skill is much richer (SQL safety, LLM trust boundary, specialist dispatch). Watch for user confusion reports and consider renaming to /diff-review or /pre-land if the collision bites. TODO: track user-reported incidents in TODOS.md.',
};

// Generic-verb watchlist: skill names that are single common verbs, which
// are at higher risk of being claimed by a future host built-in. Advisory
// only — the test prints a warning but doesn't fail. If a name here stops
// being safe, move it to the appropriate host's KNOWN_BUILTINS list.
const GENERIC_VERB_WATCHLIST = [
  'save', 'load', 'run', 'test', 'build', 'deploy',
  'fork', 'branch', 'commit', 'push', 'pull', 'merge', 'rebase',
  'start', 'stop', 'restart', 'reset', 'pause', 'resume',
  'show', 'list', 'find', 'search', 'view',
  'create', 'delete', 'remove', 'update', 'rename',
  'login', 'logout', 'auth',
];

// ─── Enumerator ────────────────────────────────────────────────────────────

interface GstackSkill {
  name: string;
  skillPath: string;
}

function enumerateGstackSkills(): GstackSkill[] {
  const SKILLS = path.join(ROOT, 'skills');
  const skills: GstackSkill[] = [];
  // The shipped surface: skills/<name>/SKILL.md (six dispatchers) plus
  // skills/.compat/<name>/SKILL.md (old-name aliases). Aliases count — a
  // shadowed alias is exactly how the /checkpoint incident reached users.
  // Nothing here reads .tmpl files; the retired 1.x tree at ROOT is ignored.
  for (const dir of [SKILLS, path.join(SKILLS, '.compat')]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillFile = path.join(dir, entry.name, 'SKILL.md');
      if (!fs.existsSync(skillFile)) continue;
      const content = fs.readFileSync(skillFile, 'utf-8');
      // Parse the 'name:' field from YAML frontmatter.
      const frontmatter = content.match(/^---\n([\s\S]+?)\n---/);
      if (!frontmatter) continue;
      const nameMatch = frontmatter[1].match(/^name:\s*(\S+)/m);
      if (!nameMatch) continue;
      skills.push({ name: nameMatch[1].trim(), skillPath: skillFile });
    }
  }
  return skills;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('skill-collision-sentinel', () => {
  const skills = enumerateGstackSkills();

  test('at least one skill is discovered (sanity)', () => {
    // If this fails, the enumerator broke, not the collision check. Floor is
    // the six canonical dispatchers; the ~39 .compat aliases churn, so don't
    // pin a number that a single alias deletion turns red.
    expect(skills.length).toBeGreaterThanOrEqual(6);
  });

  test('no duplicate skill names within gstack', () => {
    const seen = new Map<string, string>();
    const dupes: string[] = [];
    for (const { name, skillPath } of skills) {
      if (seen.has(name)) {
        dupes.push(`${name} appears in both ${seen.get(name)} and ${skillPath}`);
      } else {
        seen.set(name, skillPath);
      }
    }
    if (dupes.length > 0) {
      throw new Error(`Duplicate skill names:\n  ${dupes.join('\n  ')}`);
    }
  });

  // Hard check: no gstack skill name collides with a known host built-in
  // unless the collision is explicitly tolerated. This is the test that
  // would have caught the /checkpoint bug in April 2026.
  for (const [host, builtins] of Object.entries(KNOWN_BUILTINS)) {
    test(`no skill name collides with a ${host} built-in (or has written justification)`, () => {
      const builtinSet = new Set(builtins);
      const collisions: Array<{ skill: string; builtin: string }> = [];
      for (const { name } of skills) {
        if (builtinSet.has(name) && !(name in KNOWN_COLLISIONS_TOLERATED)) {
          collisions.push({ skill: name, builtin: name });
        }
      }
      if (collisions.length > 0) {
        const msg = collisions.map(c =>
          `  /${c.skill} collides with ${host} built-in /${c.builtin}.\n` +
          `    Fix: rename the gstack skill (precedent: /checkpoint → /context-save+/context-restore),\n` +
          `    OR add an entry to KNOWN_COLLISIONS_TOLERATED with a written justification.`
        ).join('\n\n');
        throw new Error(`Found ${collisions.length} unresolved collision(s) with ${host} built-ins:\n\n${msg}`);
      }
    });
  }

  // Every KNOWN_COLLISIONS_TOLERATED entry must correspond to a real skill
  // AND a real built-in. Prevents the exception list from rotting with
  // stale entries after a rename.
  test('KNOWN_COLLISIONS_TOLERATED entries are all still active collisions', () => {
    const skillNames = new Set(skills.map(s => s.name));
    const allBuiltins = new Set<string>();
    for (const list of Object.values(KNOWN_BUILTINS)) {
      for (const name of list) allBuiltins.add(name);
    }
    const stale: string[] = [];
    for (const name of Object.keys(KNOWN_COLLISIONS_TOLERATED)) {
      if (!skillNames.has(name)) {
        stale.push(`  "${name}" is in KNOWN_COLLISIONS_TOLERATED but no gstack skill has that name — remove the exception`);
      } else if (!allBuiltins.has(name)) {
        stale.push(`  "${name}" is in KNOWN_COLLISIONS_TOLERATED but no host's KNOWN_BUILTINS lists it — remove the exception`);
      }
    }
    if (stale.length > 0) {
      throw new Error(`Stale tolerance entries:\n${stale.join('\n')}`);
    }
  });

  // Self-check: the /checkpoint rename actually landed. If someone reverts
  // the rename by accident, this catches it.
  test('the /checkpoint collision that started this file is actually resolved', () => {
    const names = new Set(skills.map(s => s.name));
    expect(names.has('checkpoint')).toBe(false);
    // And the replacements exist.
    expect(names.has('context-save')).toBe(true);
    expect(names.has('context-restore')).toBe(true);
  });

  // Advisory: print a warning for any skill whose name is a generic verb.
  // Doesn't fail — just informs reviewers.
  test('advisory: generic-verb watchlist (informational)', () => {
    const watchlist = new Set(GENERIC_VERB_WATCHLIST);
    const flagged: string[] = [];
    for (const { name } of skills) {
      if (watchlist.has(name)) flagged.push(name);
    }
    if (flagged.length > 0) {
      console.log(
        `\n⚠️  advisory: ${flagged.length} skill(s) use generic verbs that may be at risk ` +
        `of future host built-in collisions: ${flagged.map(n => `/${n}`).join(', ')}\n` +
        `   These are NOT current collisions — they're names to watch. If any become ` +
        `taken, the per-host test above will fail.\n`
      );
    }
    // Test always passes — this is advisory.
    expect(true).toBe(true);
  });
});
