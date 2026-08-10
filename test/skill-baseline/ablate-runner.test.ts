/**
 * Free, deterministic tests for the ablation spine. No model calls.
 *
 * These guard the two ways this instrument can lie:
 *   1. Ablating nothing (bad path, bodyless target, collateral damage to a
 *      sibling module) and reading the flat score as "the module is dead
 *      weight".
 *   2. Losing or double-counting cells, which biases an arm.
 */

import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { buildAblatedTree, buildSoloTree, gutMarkdown, listLegacyModules, moduleTreePath, walkFiles } from './tree';
import {
  appendCell,
  armAppliesTo,
  armModules,
  checkScenarioSkillMentions,
  detectInvocation,
  dispatcherNames,
  enumerateCells,
  loadDoneKeys,
  pendingCells,
  scenarioSkillMention,
  treeSkillNames,
} from './ablate-runner';
import type { Arm, Cell } from './cell';
import type { Scenario, Skill } from './scenarios';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ablate-test-'));
}

const FM = (name: string) => `---\nname: ${name}\n---\n`;

/**
 * Two dispatchers, legacy modules routed from each SKILL.md exactly as the real
 * tree routes them, plus non-markdown tooling.
 */
function fakeTree(): string {
  const dir = tmp();
  const files: Record<string, string> = {
    'plan/SKILL.md':
      FM('plan') +
      '\n# Plan\n\n| `Discovery` | `references/legacy/office-hours.md` |\n' +
      '| `Retro` | `references/legacy/retro.md` |\n',
    'plan/references/legacy/office-hours.md': FM('office-hours') + '\n# Office hours\n\nFounder pressure.\n',
    'plan/references/legacy/retro.md': FM('retro') + '\n# Retro\n\nRetro prose.\n',
    'ship/SKILL.md': FM('ship') + '\n# Ship\n\n| `Canary` | `references/legacy/canary.md` |\n',
    'ship/references/legacy/canary.md': FM('canary') + '\n# Canary\n\nCanary prose.\n',
    'ship/references/support/scripts/jargon.json': '{"a":1}\n',
  };
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

function scenario(id: string, skill: Skill, task = `Use the /${skill} skill.`): Scenario {
  return { id, skill, source: [], task, materialize: () => {}, truth: { expected: [], traps: [] } };
}

/** One assistant event carrying the given tool calls, as the NDJSON parser emits them. */
function calls(...cs: Array<{ tool: string; input: any }>): Array<{ tool: string; input: any }> {
  return cs;
}

describe('moduleTreePath', () => {
  test('expands a module id and passes an expanded path through', () => {
    expect(moduleTreePath('plan/office-hours')).toBe('plan/references/legacy/office-hours.md');
    expect(moduleTreePath('plan/references/legacy/office-hours.md')).toBe('plan/references/legacy/office-hours.md');
  });

  test('listLegacyModules finds the real 42 modules as <dispatcher>/<module>', () => {
    const mods = listLegacyModules();
    expect(mods).toContain('plan/office-hours');
    expect(mods).toContain('ship/canary');
    expect(mods.length).toBeGreaterThan(30);
  });
});

describe('buildAblatedTree', () => {
  test('guts exactly the target and leaves every sibling byte-identical', () => {
    const src = fakeTree();
    const dest = path.join(tmp(), 'ablated');
    const res = buildAblatedTree(src, dest, 'plan/office-hours');

    expect(res.targets).toEqual(['plan/references/legacy/office-hours.md']);
    expect(res.bytesAfter).toBeLessThan(res.bytesBefore);

    const srcFiles = walkFiles(src).sort();
    expect(walkFiles(dest).sort()).toEqual(srcFiles);
    expect(res.files).toBe(srcFiles.length);

    // The target keeps its frontmatter and nothing else.
    expect(fs.readFileSync(path.join(dest, res.targets[0]), 'utf-8')).toBe(FM('office-hours'));

    // Everything else, including the sibling legacy module in the same
    // directory, is byte-for-byte the control tree.
    for (const rel of srcFiles) {
      if (res.targets.includes(rel)) continue;
      expect(fs.readFileSync(path.join(dest, rel))).toEqual(fs.readFileSync(path.join(src, rel)));
    }
  });

  test('a set guts exactly the named members and nothing else', () => {
    const src = fakeTree();
    const dest = path.join(tmp(), 'set');
    const res = buildAblatedTree(src, dest, ['plan/retro', 'ship/canary']);

    expect(res.targets.sort()).toEqual([
      'plan/references/legacy/retro.md',
      'ship/references/legacy/canary.md',
    ]);
    for (const rel of walkFiles(src)) {
      if (res.targets.includes(rel)) {
        expect(fs.readFileSync(path.join(dest, rel), 'utf-8')).toBe(gutMarkdown(fs.readFileSync(path.join(src, rel), 'utf-8')));
      } else {
        expect(fs.readFileSync(path.join(dest, rel))).toEqual(fs.readFileSync(path.join(src, rel)));
      }
    }
    // The set's non-members, including the third legacy module, survive intact.
    expect(fs.readFileSync(path.join(dest, 'plan/references/legacy/office-hours.md'), 'utf-8'))
      .toContain('Founder pressure');
  });

  test('one bad member fails the whole set and leaves no half-built tree', () => {
    const src = fakeTree();
    const dest = path.join(tmp(), 'set');
    expect(() => buildAblatedTree(src, dest, ['plan/retro', 'plan/nope'])).toThrow(/does not exist/);
    expect(fs.existsSync(dest)).toBe(false);
    expect(() => buildAblatedTree(src, dest, [])).toThrow(/at least one module/);
  });

  test('throws when the module does not exist — ablating nothing would fake a dead-weight verdict', () => {
    const src = fakeTree();
    const dest = path.join(tmp(), 'ablated');
    expect(() => buildAblatedTree(src, dest, 'plan/does-not-exist')).toThrow(/does not exist/);
    expect(() => buildAblatedTree(src, dest, 'nosuch/office-hours')).toThrow(/does not exist/);
    expect(fs.existsSync(dest)).toBe(false); // and it does not leave a half-built tree
  });

  test('throws when the target has no body to remove', () => {
    const src = fakeTree();
    fs.writeFileSync(path.join(src, 'plan/references/legacy/retro.md'), FM('retro'));
    expect(() => buildAblatedTree(src, path.join(tmp(), 'd'), 'plan/retro')).toThrow(/no body/);
  });

  test('a rebuild over an existing tree is idempotent', () => {
    const src = fakeTree();
    const dest = path.join(tmp(), 'ablated');
    buildAblatedTree(src, dest, 'plan/office-hours');
    fs.writeFileSync(path.join(dest, 'STALE.md'), 'left over from a previous arm\n');
    buildAblatedTree(src, dest, 'plan/office-hours');
    expect(walkFiles(dest)).not.toContain('STALE.md');
  });
});

describe('buildSoloTree', () => {
  test('leaves exactly one legacy module intact and the routing skeleton verbatim', () => {
    const src = fakeTree();
    const dest = path.join(tmp(), 'solo');
    const res = buildSoloTree(src, dest, 'plan/office-hours');

    expect(res.kept).toBe('plan/references/legacy/office-hours.md');
    expect(res.gutted).toBe(2); // plan/retro + ship/canary
    expect(walkFiles(dest).sort()).toEqual(walkFiles(src).sort());

    // The one module survives byte-for-byte.
    expect(fs.readFileSync(path.join(dest, res.kept))).toEqual(fs.readFileSync(path.join(src, res.kept)));
    // Every other legacy module is frontmatter only.
    expect(fs.readFileSync(path.join(dest, 'plan/references/legacy/retro.md'), 'utf-8')).toBe(FM('retro'));
    expect(fs.readFileSync(path.join(dest, 'ship/references/legacy/canary.md'), 'utf-8')).toBe(FM('canary'));
    // The dispatcher SKILL.md files and non-markdown tooling are untouched:
    // they are what makes the surviving module reachable.
    for (const rel of ['plan/SKILL.md', 'ship/SKILL.md', 'ship/references/support/scripts/jargon.json']) {
      expect(fs.readFileSync(path.join(dest, rel))).toEqual(fs.readFileSync(path.join(src, rel)));
    }
  });

  test('throws on a module path that does not exist', () => {
    const src = fakeTree();
    expect(() => buildSoloTree(src, path.join(tmp(), 'solo'), 'plan/nope')).toThrow(/does not exist/);
    expect(() => buildSoloTree(src, path.join(tmp(), 'solo'), 'nosuch/canary')).toThrow(/does not exist/);
  });

  test('throws when nothing routes to the surviving module', () => {
    const src = fakeTree();
    // Strip the routing row: the module is still on disk, but the dispatcher can
    // no longer reach it, so the arm would score inert and read as false DEAD.
    fs.writeFileSync(path.join(src, 'plan/SKILL.md'), FM('plan') + '\n# Plan\n\nNo routing table.\n');
    expect(() => buildSoloTree(src, path.join(tmp(), 'solo'), 'plan/office-hours')).toThrow(/routes to/);
  });

  test('every real module is reachable in its own solo tree', () => {
    // Cheap on 3 modules, and it is the assertion that would catch a routing
    // table that stops naming a module by path.
    const dest = path.join(tmp(), 'solo-real');
    for (const m of ['plan/office-hours', 'review/codex', 'ship/canary']) {
      expect(buildSoloTree(path.join(__dirname, '..', '..', 'skills'), dest, m).kept)
        .toBe(moduleTreePath(m));
    }
  });
});

describe('cell enumeration', () => {
  const scenarios = [scenario('r1', 'review'), scenario('r2', 'review'), scenario('s1', 'ship')];

  test('controls run against every scenario', () => {
    const cells = enumerateCells(scenarios, ['full', 'gutted', 'no-skill'], 1);
    expect(cells.length).toBe(9);
  });

  test('an ablation arm runs only against its own dispatcher scenarios', () => {
    const cells = enumerateCells(scenarios, ['ablate:ship/canary'], 1);
    expect(cells.map((c) => c.scenario.id)).toEqual(['s1']);
    expect(armAppliesTo('ablate:ship/canary', scenario('r1', 'review'))).toBe(false);
    expect(armAppliesTo('full', scenario('r1', 'review'))).toBe(true);
  });

  test('replicates multiply, and every key is unique', () => {
    const cells = enumerateCells(scenarios, ['full', 'ablate:review/codex'], 3);
    expect(cells.length).toBe(3 * 3 + 2 * 3);
    expect(new Set(cells.map((c) => c.key)).size).toBe(cells.length);
    expect(cells[0].key).toBe('r1|full|0');
  });

  test('a typo\'d module throws instead of enumerating zero cells', () => {
    expect(() => enumerateCells(scenarios, ['ablate:ship/canry' as Arm], 1)).toThrow(/unknown module/);
    expect(() => enumerateCells(scenarios, ['solo:ship/canry' as Arm], 1)).toThrow(/unknown module/);
  });

  test('solo pairs by dispatcher, same as ablate', () => {
    const cells = enumerateCells(scenarios, ['solo:ship/canary'], 1);
    expect(cells.map((c) => c.scenario.id)).toEqual(['s1']);
    expect(armAppliesTo('solo:ship/canary', scenario('r1', 'review'))).toBe(false);
  });

  test('a set runs against every dispatcher it touches', () => {
    const sets = { dead1: ['review/codex', 'ship/canary'] };
    const cells = enumerateCells(scenarios, ['ablate-set:dead1'], 1, sets);
    expect(cells.map((c) => c.scenario.id)).toEqual(['r1', 'r2', 's1']);
    expect(armModules('ablate-set:dead1', sets)).toEqual(sets.dead1);
  });

  test('an unregistered set throws rather than silently running nothing', () => {
    expect(() => enumerateCells(scenarios, ['ablate-set:dead1'], 1)).toThrow(/unregistered set/);
  });

  test('controls touch no modules', () => {
    expect(armModules('full')).toEqual([]);
    expect(armModules('gutted')).toEqual([]);
    expect(armModules('no-skill')).toEqual([]);
  });

  test('replicates below 1 throws', () => {
    expect(() => enumerateCells(scenarios, ['full'], 0)).toThrow(/replicates/);
  });
});

describe('skill invocation detection', () => {
  const treeSkills = ['plan', 'qa', 'review', 'ship', 'debug', 'office-hours'];

  test('a gstack Skill call counts as invoked and is named', () => {
    const got = detectInvocation(calls({ tool: 'Read', input: {} }, { tool: 'Skill', input: { skill: 'review' } }), 12, treeSkills);
    expect(got).toEqual({ skillInvoked: true, skillsUsed: ['review'] });
  });

  test('a leading slash and duplicate calls normalize', () => {
    const got = detectInvocation(
      calls({ tool: 'Skill', input: { skill: '/qa' } }, { tool: 'Skill', input: { skill: '/qa' } }),
      5,
      treeSkills,
    );
    expect(got).toEqual({ skillInvoked: true, skillsUsed: ['/qa'] });
  });

  test('a session that ran but called no skill is false, not null', () => {
    expect(detectInvocation(calls({ tool: 'Bash', input: {} }), 9, treeSkills))
      .toEqual({ skillInvoked: false, skillsUsed: [] });
    expect(detectInvocation([], 9, treeSkills)).toEqual({ skillInvoked: false, skillsUsed: [] });
  });

  test('no transcript at all is null — undeterminable, not a measurement', () => {
    expect(detectInvocation([], 0, treeSkills)).toEqual({ skillInvoked: null, skillsUsed: [] });
  });

  test('a host built-in is recorded but does not count as a gstack invocation', () => {
    const got = detectInvocation(calls({ tool: 'Skill', input: { skill: 'dataviz' } }), 7, treeSkills);
    expect(got).toEqual({ skillInvoked: false, skillsUsed: ['dataviz'] });
  });

  test('the no-skill arm owns no skills, so it can never report an invocation', () => {
    expect(treeSkillNames(null)).toEqual([]);
    expect(detectInvocation(calls({ tool: 'Skill', input: { skill: 'review' } }), 7, treeSkillNames(null)))
      .toEqual({ skillInvoked: false, skillsUsed: ['review'] });
  });

  test('mis-routing is visible: the wrong skill invoked is still recorded', () => {
    const got = detectInvocation(calls({ tool: 'Skill', input: { skill: 'qa' } }), 7, treeSkills);
    expect(got.skillsUsed).toEqual(['qa']); // a review scenario reading this is mis-routed
  });

  test('treeSkillNames reads the real tree, including compat aliases', () => {
    const names = treeSkillNames(path.join(__dirname, '..', '..', 'skills'));
    for (const n of ['plan', 'qa', 'review', 'debug', 'ship', 'make-pdf']) expect(names).toContain(n);
    expect(names).toContain('office-hours'); // .compat alias
  });
});

describe('scenario skill-mention precondition', () => {
  test('dispatcherNames finds the five judgment dispatchers', () => {
    const names = dispatcherNames();
    for (const n of ['plan', 'qa', 'review', 'debug', 'ship']) expect(names).toContain(n);
  });

  test('a task naming its own skill passes', () => {
    expect(scenarioSkillMention(scenario('r', 'review', 'Use the /review skill to audit this diff.')).ok).toBe(true);
    expect(checkScenarioSkillMentions([scenario('r', 'review')])).toEqual([]);
  });

  /**
   * The three cases that used to live here — task names no skill, names the
   * wrong one, names a bare word — can no longer occur. `scenarioPrompt()` now
   * adds the directive centrally, derived from `scenario.skill`, so a task
   * cannot omit or contradict it.
   *
   * Testing them anyway would be a test that cannot fail, which is the exact
   * pattern that let seven review specialists be retired without turning a
   * single assertion red. The directive itself is guarded instead by
   * scenario-invocation.test.ts, which disables it and watches this go red.
   *
   * What remains genuinely reachable is a stale dispatcher name.
   */
  test('a scenario declaring a dispatcher absent from the tree is reported', () => {
    // e.g. a leftover `skill: 'design'` after design was retired. The directive
    // would point at nothing, every cell would run raw, and the arm would read
    // inert for a reason unrelated to any module's content.
    const problems = checkScenarioSkillMentions([scenario('r', 'design' as never, 'Audit this.')]);
    expect(problems.length).toBe(1);
    expect(problems[0].scenarioId).toBe('r');
    expect(scenarioSkillMention(scenario('r', 'design' as never)).ok).toBe(false);
  });

  test('every real dispatcher passes the check', () => {
    for (const skill of ['plan', 'qa', 'debug', 'review', 'ship'] as const) {
      expect(scenarioSkillMention(scenario(`s-${skill}`, skill)).ok, `${skill} should pass`).toBe(true);
    }
  });
});

describe('resume', () => {
  const cell = (scenarioId: string, arm: Arm, replicate: number): Cell => ({
    runId: 'r', scenarioId, skill: 'review', arm, replicate,
    hits: [], misses: [], fabrications: [], recall: 0, noReport: false, reportChars: 0,
    turns: 1, costUsd: 0.1, durationMs: 10, exitReason: 'success', skillInvoked: true,
  });

  test('skips cells already in cells.jsonl and re-runs a truncated tail', () => {
    const file = path.join(tmp(), 'cells.jsonl');
    appendCell(file, cell('r1', 'full', 0));
    appendCell(file, cell('r1', 'gutted', 0));
    fs.appendFileSync(file, '{"runId":"r","scenarioId":"r1","arm":"no-sk'); // killed mid-append

    const done = loadDoneKeys(file);
    expect([...done].sort()).toEqual(['r1|full|0', 'r1|gutted|0']);

    const specs = enumerateCells([scenario('r1', 'review')], ['full', 'gutted', 'no-skill'], 1);
    expect(pendingCells(specs, done).map((s) => s.key)).toEqual(['r1|no-skill|0']);
  });

  test('a missing cells file means nothing is done', () => {
    expect(loadDoneKeys(path.join(tmp(), 'absent.jsonl')).size).toBe(0);
  });
});
