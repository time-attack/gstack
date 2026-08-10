/**
 * Execute one ablation cell, and enumerate the cells a run consists of.
 *
 * One cell = one `claude -p` session against one scenario with one arm's skill
 * tree installed. Cells share nothing mutable: each gets its own temp
 * workspace and its own GSTACK_HOME, so a decision log or config written by
 * one cell cannot reach another.
 *
 * Scoring is score.ts and only score.ts — regex against planted ground truth.
 * Nothing here asks a model to judge a model. That is the whole reason the
 * instrument is trustworthy: a cell cannot pass while measuring nothing.
 *
 * A cell that times out, crashes, or writes no report is still a cell. It is
 * recorded with noReport, scored all-miss, and given an exitReason. Dropping
 * it would bias the arm toward whatever the surviving sessions happened to do.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type Arm, type Cell, ablatedModule, cellKey, toCell } from './cell';
import { scoreReport } from './score';
import { REPORT_FILE, scenarioPrompt, type Scenario } from './scenarios';
import {
  type Arm as TreeArm,
  CURRENT_TREE,
  buildAblatedTree,
  buildGuttedTree,
  buildSoloTree,
  installArm,
  listLegacyModules,
  moduleDispatcher,
  walkFiles,
} from './tree';
import { runSkillTest } from '../helpers/session-runner';
import { buildSeedConfig } from '../helpers/hermetic-env';

/** Where built arm trees and per-run cell logs live. */
export const ABLATION_ROOT = path.join(os.homedir(), '.gstack-dev', 'ablation');
export const TREE_CACHE = path.join(ABLATION_ROOT, 'trees');

/**
 * Identical for every arm, so the only difference between arms is the tree.
 * Bash+Read+Glob+Grep to inspect the fixture, Write to produce the report,
 * Skill so the dispatchers are reachable at all, Task because several of them
 * fan out. AskUserQuestion is deliberately absent: GSTACK_HEADLESS=1 makes a
 * question a hard block rather than a prose stall no scorer can read.
 */
export const CELL_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Skill', 'Task', 'TodoWrite'];
export const CELL_MAX_TURNS = 30;
export const CELL_TIMEOUT_MS = 600_000;

// --- arm parsing --------------------------------------------------------------

/**
 * `ablate-set:<id>` names a set, not its members, so the members come from a
 * registry the run persists next to its cells. A resumed run reads the same
 * registry back, which is what keeps an arm label meaning the same thing across
 * two invocations.
 */
export type SetRegistry = Record<string, string[]>;

export function soloModule(arm: Arm): string | null {
  return arm.startsWith('solo:') ? arm.slice('solo:'.length) : null;
}

export function ablatedSetId(arm: Arm): string | null {
  return arm.startsWith('ablate-set:') ? arm.slice('ablate-set:'.length) : null;
}

/** Modules an arm touches. Empty for the three controls. */
export function armModules(arm: Arm, sets: SetRegistry = {}): string[] {
  const single = ablatedModule(arm) ?? soloModule(arm);
  if (single) return [single];
  const setId = ablatedSetId(arm);
  if (setId) {
    const members = sets[setId];
    if (!members || members.length === 0) {
      throw new Error(`arm ${arm} names an unregistered set: pass --set ${setId}:<module,module>`);
    }
    return members;
  }
  if (arm === 'full' || arm === 'no-skill' || arm === 'gutted') return [];
  throw new Error(`unknown arm: ${arm}`);
}

// --- arm trees ----------------------------------------------------------------

/**
 * Sync memo, so concurrent first callers in one process cannot race: there is
 * no await between the cache check and the build. Trees are read-only once
 * built, which is why sharing one across cells is not shared mutable state.
 */
const treeCache = new Map<string, string | null>();

export function armTreePath(arm: Arm, sets: SetRegistry = {}, cacheDir = TREE_CACHE): string | null {
  if (treeCache.has(arm)) return treeCache.get(arm) as string | null;
  const built = buildArmTree(arm, sets, cacheDir);
  treeCache.set(arm, built);
  return built;
}

function buildArmTree(arm: Arm, sets: SetRegistry, cacheDir: string): string | null {
  if (arm === 'no-skill') return null;
  if (arm === 'full') return CURRENT_TREE;
  if (arm === 'gutted') {
    const dest = path.join(cacheDir, 'gutted');
    buildGuttedTree(CURRENT_TREE, dest);
    return dest;
  }
  const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '__');

  const solo = soloModule(arm);
  if (solo) {
    const dest = path.join(cacheDir, 'solo', slug(solo));
    buildSoloTree(CURRENT_TREE, dest, solo); // throws if the module ends up unreachable
    return dest;
  }
  const setId = ablatedSetId(arm);
  if (setId) {
    const dest = path.join(cacheDir, 'ablate-set', slug(setId));
    buildAblatedTree(CURRENT_TREE, dest, armModules(arm, sets));
    return dest;
  }
  const moduleId = ablatedModule(arm);
  if (!moduleId) throw new Error(`unknown arm: ${arm}`);
  const dest = path.join(cacheDir, 'ablate', slug(moduleId));
  buildAblatedTree(CURRENT_TREE, dest, moduleId); // throws if the module is missing or bodyless
  return dest;
}

/** tree.ts's arm shape, so installArm keeps owning the link-or-copy decision. */
function treeArm(arm: Arm, treePath: string | null): TreeArm {
  const id = arm === 'full' ? 'current' : arm === 'no-skill' ? 'no-skill' : arm === 'gutted' ? 'gutted' : 'mutated';
  return { id, treePath, label: arm };
}

// --- invocation: the validity check, not telemetry ----------------------------

/**
 * Skill names a tree actually ships, derived from the tree rather than listed
 * here, so `.compat` aliases and any future dispatcher are covered for free.
 * `no-skill` ships none, which is why that arm can never report an invocation.
 */
export function treeSkillNames(treePath: string | null): string[] {
  if (!treePath) return [];
  return walkFiles(treePath)
    .filter((rel) => rel.endsWith('SKILL.md'))
    .map((rel) => rel.split('/').slice(-2)[0]);
}

/**
 * Which skills a session invoked, and whether any of them was a gstack skill.
 *
 * `skillsUsed` records EVERY skill the session called, including host built-ins,
 * because a cell that invoked `/qa` on a review scenario is mis-routing — a
 * different defect from not invoking at all, and invisible if you only keep a
 * boolean. `skillInvoked` is narrower: did a skill from THIS arm's tree run.
 *
 * null means undeterminable, which is only true when no transcript arrived at
 * all. An empty transcript from a session that ran is a real `false`.
 */
export function detectInvocation(
  toolCalls: Array<{ tool: string; input: any }>,
  transcriptEvents: number,
  treeSkills: string[],
): { skillInvoked: boolean | null; skillsUsed: string[] } {
  if (transcriptEvents === 0) return { skillInvoked: null, skillsUsed: [] };
  const used: string[] = [];
  for (const c of toolCalls) {
    if (c.tool !== 'Skill') continue;
    const name = c.input?.skill ?? c.input?.name ?? c.input?.command;
    if (typeof name === 'string' && name.length > 0 && !used.includes(name)) used.push(name);
  }
  const owned = new Set(treeSkills);
  return { skillInvoked: used.some((s) => owned.has(s.replace(/^\//, ''))), skillsUsed: used };
}

// --- precondition: the scenario must ask for the skill ------------------------

/** Dispatcher names in the shipped tree (`plan`, `qa`, `review`, `debug`, `ship`, ...). */
export function dispatcherNames(): string[] {
  return walkFiles(CURRENT_TREE)
    .filter((rel) => /^[^/]+\/SKILL\.md$/.test(rel))
    .map((rel) => rel.split('/')[0]);
}

/**
 * Does the task text tell the agent to use a skill, and the right one?
 *
 * Invocation must be instructed, not hoped for. If a scenario leaves it to the
 * model's mood, a `full` cell that happens not to invoke is indistinguishable
 * from `no-skill`, every ablation delta collapses to zero, and all 42 modules
 * read DEAD for a reason unrelated to any module's content.
 *
 * Naming the skill identically in every arm stays fair: `full` invokes and
 * reads the modules, `ablate:X` invokes and reads all but X, `no-skill` has
 * nothing to find and does the task raw. What it deliberately does NOT measure
 * is whether a user's own phrasing would reach the skill. That is
 * discoverability, a separate axis, and conflating the two would hide both.
 */
export function scenarioSkillMention(scenario: Scenario): { named: string[]; ok: boolean } {
  const names = dispatcherNames();
  // Check the PROMPT ACTUALLY SENT, not `scenario.task`. The directive is added
  // centrally in `scenarioPrompt()` so all 94 scenarios get it from one place,
  // and inspecting `task` alone reports every scenario as silent, which would
  // block every run. Whatever the runner sends is what this must validate.
  //
  // Because the directive is central and derived from `scenario.skill`, the
  // "prompt forgot to name a skill" case can no longer occur — the tripwire in
  // scenario-invocation.test.ts guards that, by disabling the directive and
  // watching this go red. What CAN still occur, and is what this now catches:
  // a scenario declaring a dispatcher that is not in the shipped tree. A stale
  // `skill: 'design'` after design was retired would produce a directive
  // pointing at nothing, every cell would run raw, and the arm would read
  // inert for a reason that has nothing to do with any module.
  const prompt = scenarioPrompt(scenario);
  const named = names.filter((n) => new RegExp(`/${n}\\b`, 'i').test(prompt));
  return { named, ok: named.includes(scenario.skill) && names.includes(scenario.skill) };
}

export interface SkillMentionProblem {
  scenarioId: string;
  skill: string;
  named: string[];
  reason: 'names-no-skill' | 'names-wrong-skill';
}

export function checkScenarioSkillMentions(scenarios: Scenario[]): SkillMentionProblem[] {
  return scenarios
    .map((s) => {
      const { named, ok } = scenarioSkillMention(s);
      if (ok) return null;
      return {
        scenarioId: s.id,
        skill: s.skill,
        named,
        reason: named.length === 0 ? 'names-no-skill' : 'names-wrong-skill',
      } as SkillMentionProblem;
    })
    .filter((p): p is SkillMentionProblem => p !== null);
}

export function formatSkillMentionProblems(problems: SkillMentionProblem[]): string {
  return [
    `${problems.length} scenario(s) do not instruct the agent to use their own skill.`,
    'Without that, a `full` cell that does not invoke IS a `no-skill` cell, every',
    'ablation delta goes to zero, and every module reads DEAD for a reason that has',
    'nothing to do with its content. Fix the task text in scenarios.ts first.',
    ...problems.map(
      (p) =>
        `  ${p.scenarioId} (skill=${p.skill}): ${
          p.reason === 'names-no-skill' ? 'names no skill' : `names /${p.named.join(', /')} instead`
        }`,
    ),
  ].join('\n');
}

/** Throws unless every scenario asks for its own skill. */
export function assertScenariosNameSkill(scenarios: Scenario[]): void {
  const problems = checkScenarioSkillMentions(scenarios);
  if (problems.length > 0) throw new Error(formatSkillMentionProblems(problems));
}

// --- cell enumeration ---------------------------------------------------------

export interface CellSpec {
  scenario: Scenario;
  arm: Arm;
  replicate: number;
  key: string;
}

/**
 * Relevance. `ablate:ship/canary` cannot change a `review` scenario's score, so
 * that cell is money spent measuring nothing. A treatment arm runs only against
 * scenarios owned by a dispatcher it touches — for `solo:` and `ablate:` that is
 * the module's own dispatcher, for `ablate-set:` it is any dispatcher with a
 * member in the set. The three controls run against everything, because they
 * are what the treatments are compared to (`ablate:X` against `full`,
 * `solo:X` against `no-skill`).
 */
export function armAppliesTo(arm: Arm, scenario: Scenario, sets: SetRegistry = {}): boolean {
  const modules = armModules(arm, sets);
  if (modules.length === 0) return true;
  return modules.some((m) => moduleDispatcher(m) === scenario.skill);
}

export function enumerateCells(
  scenarios: Scenario[],
  arms: Arm[],
  replicates: number,
  sets: SetRegistry = {},
): CellSpec[] {
  if (replicates < 1) throw new Error(`replicates must be >= 1, got ${replicates}`);
  const known = new Set(listLegacyModules());
  const out: CellSpec[] = [];
  for (const arm of arms) {
    // A typo'd module would enumerate zero cells and read as "no scenarios
    // touch it", which is indistinguishable from a real dead-weight verdict.
    for (const m of armModules(arm, sets)) {
      if (!known.has(m)) throw new Error(`unknown module in arm ${arm}: ${m}`);
    }
    for (const scenario of scenarios) {
      if (!armAppliesTo(arm, scenario, sets)) continue;
      for (let replicate = 0; replicate < replicates; replicate++) {
        out.push({ scenario, arm, replicate, key: cellKey({ scenarioId: scenario.id, arm, replicate }) });
      }
    }
  }
  return out;
}

// --- resume -------------------------------------------------------------------

export function cellsFile(runId: string, root = ABLATION_ROOT): string {
  return path.join(root, runId, 'cells.jsonl');
}

/**
 * Keys already on disk. A run killed mid-append leaves a truncated last line;
 * an unparseable line is skipped, so that cell simply gets re-run.
 */
export function loadDoneKeys(file: string): Set<string> {
  const done = new Set<string>();
  if (!fs.existsSync(file)) return done;
  for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
    if (!line.trim()) continue;
    try {
      done.add(cellKey(JSON.parse(line) as Cell));
    } catch { /* truncated tail — re-run that cell */ }
  }
  return done;
}

export function pendingCells(specs: CellSpec[], done: Set<string>): CellSpec[] {
  return specs.filter((s) => !done.has(s.key));
}

export function appendCell(file: string, cell: Cell): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(cell) + '\n');
}

// --- one cell -----------------------------------------------------------------

export interface RunCellOpts {
  runId: string;
  spec: CellSpec;
  /** Where to keep reports worth a human read. Default `<ABLATION_ROOT>/<runId>/reports`. */
  keepDir?: string;
  cacheDir?: string;
  maxTurns?: number;
  timeoutMs?: number;
  /** Required when the arm is `ablate-set:<id>`. */
  sets?: SetRegistry;
}

export async function runCell(opts: RunCellOpts): Promise<Cell> {
  const { runId, spec } = opts;
  const { scenario, arm, replicate } = spec;
  const keepDir = opts.keepDir ?? path.join(ABLATION_ROOT, runId, 'reports');
  const started = Date.now();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), `ablate-${process.pid}-`));
  const workspace = path.join(root, 'ws');
  // Per-cell GSTACK_HOME and CLAUDE_CONFIG_DIR. Both live OUTSIDE the workspace
  // so neither shows up in the file walk that phantom-path detection scores
  // against. The config dir is isolated rather than shared with the rest of the
  // eval suite because the first live smoke cell wrote three files into the
  // shared hermetic runRoot on its own initiative — one cell's scratch state
  // reaching the next is exactly what makes an arm's mean untrustworthy.
  const gstackHome = path.join(root, 'gstack-home');
  const configDir = path.join(root, '.claude');
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(gstackHome, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, '.claude.json'),
    JSON.stringify(buildSeedConfig({
      apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.GSTACK_ANTHROPIC_API_KEY,
      trustedDirs: [workspace],
    })),
  );

  let report = '';
  let telemetry = { turns: null as number | null, costUsd: null as number | null, exitReason: 'spawn_error' };
  let error: string | undefined;
  let finalOutput = '';
  let invocation = { skillInvoked: null as boolean | null, skillsUsed: [] as string[] };

  try {
    // Refuse before spawning, not after. A cell whose task never asks for the
    // skill measures the raw model with an unread directory on disk, and pooling
    // it into an arm's mean is how the study talks itself into deleting
    // everything. Recorded as a spawn_error cell, so it is visible and free.
    assertScenariosNameSkill([scenario]);
    scenario.materialize(workspace);
    const treePath = armTreePath(arm, opts.sets ?? {}, opts.cacheDir);
    installArm(treeArm(arm, treePath), workspace);

    const result = await runSkillTest({
      prompt: scenarioPrompt(scenario),
      workingDirectory: workspace,
      maxTurns: opts.maxTurns ?? CELL_MAX_TURNS,
      timeout: opts.timeoutMs ?? CELL_TIMEOUT_MS,
      allowedTools: CELL_TOOLS,
      testName: `ablate-${scenario.id}-${arm}-${replicate}`,
      env: { GSTACK_HOME: gstackHome, CLAUDE_CONFIG_DIR: configDir },
    });

    finalOutput = result.output;
    invocation = detectInvocation(result.toolCalls, result.transcript.length, treeSkillNames(treePath));
    telemetry = {
      turns: result.costEstimate.turnsUsed || null,
      // Exact from the result event; costEstimate rounds to cents, which floors
      // a sub-cent cell to zero and would understate the run total.
      costUsd: exactCost(result.transcript) ?? result.costEstimate.estimatedCost,
      exitReason: result.exitReason,
    };

    const reportPath = path.join(workspace, REPORT_FILE);
    if (fs.existsSync(reportPath)) report = fs.readFileSync(reportPath, 'utf-8');
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const score = scoreReport({
    scenarioId: scenario.id,
    arm,
    truth: scenario.truth,
    report,
    workspaceFiles: workspaceFiles(workspace),
  });

  // The cells a human will want to hand-read: no report at all, a claim the
  // scorer flagged as invented, or a skill-bearing arm that never invoked the
  // skill (expected on `no-skill`, a validity failure anywhere else).
  const didNotInvoke = invocation.skillInvoked === false && arm !== 'no-skill';
  if (score.noReport || score.fabrications.length > 0 || didNotInvoke) {
    try {
      fs.mkdirSync(keepDir, { recursive: true });
      const name = spec.key.replace(/[^A-Za-z0-9._-]/g, '_');
      fs.writeFileSync(
        path.join(keepDir, `${name}.txt`),
        [
          `cell: ${spec.key}`,
          `exitReason: ${telemetry.exitReason}`,
          `skillInvoked: ${invocation.skillInvoked} (used: ${invocation.skillsUsed.join(', ') || 'none'})`,
          `fabrications: ${score.fabrications.join(', ') || 'none'}`,
          error ? `error: ${error}` : '',
          '',
          `--- ${REPORT_FILE} (${report.length} chars) ---`,
          report,
          '',
          '--- final assistant output ---',
          finalOutput,
        ].join('\n'),
      );
    } catch { /* keeping the artifact is best-effort; the cell row is the record */ }
  }

  fs.rmSync(root, { recursive: true, force: true });

  return toCell(
    {
      runId,
      scenarioId: scenario.id,
      skill: scenario.skill,
      arm,
      replicate,
      turns: telemetry.turns,
      costUsd: telemetry.costUsd,
      durationMs: Date.now() - started,
      exitReason: telemetry.exitReason,
      skillInvoked: invocation.skillInvoked,
      ...(invocation.skillsUsed.length ? { skillsUsed: invocation.skillsUsed } : {}),
      ...(error ? { error } : {}),
      // cell.ts's toCell copies scenarioId/arm through the spread but Omits
      // them from its parameter type; the cast keeps them without touching it.
    } as Parameters<typeof toCell>[0],
    score,
  );
}

function exactCost(transcript: any[]): number | null {
  const result = transcript.find((e) => e?.type === 'result');
  return typeof result?.total_cost_usd === 'number' ? result.total_cost_usd : null;
}

/**
 * Fixture files the report is allowed to cite. `.claude` is excluded: the arm's
 * skill tree is not part of the fixture, and counting its 274 files as known
 * paths would let a report cite `skills/plan/SKILL.md` as evidence.
 */
export function workspaceFiles(workspace: string): string[] {
  return walkFiles(workspace).filter((f) => !f.startsWith('.claude/') && f !== REPORT_FILE);
}
