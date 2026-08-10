#!/usr/bin/env bun
/**
 * Per-module ablation study runner.
 *
 * Ships the whole skill tree with exactly one legacy module gutted, and asks
 * whether the deterministic score moves against the `full` control. If it does
 * not, that module is prose the model already infers, and it goes.
 *
 *   bun scripts/ablate.ts --modules all --replicates 20 --dry-run
 *   bun scripts/ablate.ts --modules plan/office-hours --replicates 5 --concurrency 8
 *   bun scripts/ablate.ts --run-id 2026-08-06-full   # resumes; skips finished cells
 *
 * Two arms exist because single-module ablation alone produces false DEAD
 * verdicts (see the decision table in test/skill-baseline/cell.ts):
 *
 *   --solo all                     ships each module ALONE, scored against
 *                                  no-skill. Beats the signal-to-noise problem
 *                                  of perturbing a 1.7 MB tree by 11 KB.
 *   --set dead1:plan/retro,ship/canary   guts a proposed DEAD set at once, to
 *                                  catch mutual redundancy between members.
 *
 * Every finished cell is appended to ~/.gstack-dev/ablation/<runId>/cells.jsonl
 * before the next one starts, so a killed run keeps its work and resuming is
 * just re-running the same command with the same --run-id.
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseArgs } from 'util';
import type { Arm, Cell } from '../test/skill-baseline/cell';
import { selectScenarios } from '../test/skill-baseline/scenarios';
import { listLegacyModules } from '../test/skill-baseline/tree';
import {
  ABLATION_ROOT,
  appendCell,
  armModules,
  cellsFile,
  checkScenarioSkillMentions,
  enumerateCells,
  formatSkillMentionProblems,
  loadDoneKeys,
  pendingCells,
  runCell,
  type CellSpec,
  type SetRegistry,
} from '../test/skill-baseline/ablate-runner';

const CONTROLS: Arm[] = ['full', 'gutted', 'no-skill'];

/**
 * Fallback per-cell cost when no prior run exists to measure. A guess, labelled
 * as one in the output; once any run has cells, the median of its real
 * costUsd/durationMs replaces it.
 */
const ASSUMED_COST_USD = 0.25;
const ASSUMED_DURATION_MS = 120_000;

function list(v: string | undefined, all: () => string[]): string[] {
  if (!v) return [];
  if (v === 'all') return all();
  if (v === 'none') return []; // `--arms none` runs treatment arms only

  return v.split(',').map((s) => s.trim()).filter(Boolean);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

/** Real per-cell cost and duration from every run on disk, if any. */
function observed(): { costUsd: number | null; durationMs: number | null; cells: number } {
  const costs: number[] = [];
  const durations: number[] = [];
  let runs: string[] = [];
  try { runs = fs.readdirSync(ABLATION_ROOT); } catch { /* first run */ }
  for (const runId of runs) {
    const file = cellsFile(runId);
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, 'utf-8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const c = JSON.parse(line) as Cell;
        if (typeof c.costUsd === 'number' && c.costUsd > 0) costs.push(c.costUsd);
        if (typeof c.durationMs === 'number' && c.durationMs > 0) durations.push(c.durationMs);
      } catch { /* truncated tail */ }
    }
  }
  return { costUsd: median(costs), durationMs: median(durations), cells: costs.length };
}

async function pool<T>(items: T[], concurrency: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  // `next++` is atomic in a single-threaded event loop, so N workers sharing
  // the index need no lock.
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
      while (next < items.length) await work(items[next++]);
    }),
  );
}

/**
 * `--set <id>:<module,module>`, repeatable. Persisted next to the run's cells so
 * a resumed run resolves the same arm label to the same members — an arm id
 * whose meaning drifted between invocations would silently pool two different
 * treatments into one mean.
 */
function resolveSets(args: string[], runDir: string): SetRegistry {
  const file = path.join(runDir, 'sets.json');
  const sets: SetRegistry = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : {};
  for (const raw of args) {
    const at = raw.indexOf(':');
    if (at < 1) throw new Error(`--set wants <id>:<module,module>, got: ${raw}`);
    const id = raw.slice(0, at);
    const members = raw.slice(at + 1).split(',').map((s) => s.trim()).filter(Boolean);
    if (members.length === 0) throw new Error(`--set ${id} has no modules`);
    const prior = sets[id];
    if (prior && prior.join(',') !== members.join(',')) {
      throw new Error(
        `set "${id}" already ran in ${runDir} with different members ` +
          `(${prior.join(',')}). Use a new set id, or a new --run-id.`,
      );
    }
    sets[id] = members;
  }
  if (args.length > 0) {
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(file, JSON.stringify(sets, null, 2));
  }
  return sets;
}

/** yes / NO(what-ran-instead) / ? when no transcript arrived. Validity at a glance per cell. */
function skillTag(cell: Cell): string {
  if (cell.skillInvoked === null || cell.skillInvoked === undefined) return '?';
  if (cell.skillInvoked) return 'yes';
  return `NO(${(cell.skillsUsed ?? []).join('/') || 'none'})`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      modules: { type: 'string' },
      solo: { type: 'string' },
      set: { type: 'string', multiple: true, default: [] },
      scenarios: { type: 'string' },
      arms: { type: 'string' },
      replicates: { type: 'string', default: '1' },
      concurrency: { type: 'string', default: '4' },
      'run-id': { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  const modules = list(values.modules, listLegacyModules);
  const solos = list(values.solo, listLegacyModules);
  const scenarios = selectScenarios(list(values.scenarios, () => []));
  const replicates = Number(values.replicates);
  const concurrency = Number(values.concurrency);
  const runId = values['run-id'] ?? new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  const file = cellsFile(runId);
  const sets = resolveSets(values.set as string[], path.dirname(file));
  const arms: Arm[] = [
    ...(values.arms ? (list(values.arms, () => CONTROLS as string[]) as Arm[]) : CONTROLS),
    ...modules.map((m) => `ablate:${m}` as Arm),
    ...solos.map((m) => `solo:${m}` as Arm),
    ...Object.keys(sets).map((id) => `ablate-set:${id}` as Arm),
  ];

  const specs = enumerateCells(scenarios, arms, replicates, sets);
  const done = loadDoneKeys(file);
  const todo = pendingCells(specs, done);

  const obs = observed();
  const perCell = obs.costUsd ?? ASSUMED_COST_USD;
  const perCellMs = obs.durationMs ?? ASSUMED_DURATION_MS;
  const basis = obs.costUsd
    ? `median of ${obs.cells} cells already on disk`
    : `ASSUMED (no prior run to measure) $${ASSUMED_COST_USD}/cell`;

  console.log(`run          ${runId}`);
  console.log(`scenarios    ${scenarios.length}`);
  console.log(
    `arms         ${arms.length} (${CONTROLS.filter((c) => arms.includes(c)).join(', ') || 'no controls'} + ` +
      `${modules.length} ablate + ${solos.length} solo + ${Object.keys(sets).length} set)`,
  );
  console.log(`replicates   ${replicates}`);
  console.log(`cells        ${specs.length} total, ${done.size} done, ${todo.length} to run`);
  console.log(`cost basis   ${basis}`);
  console.log(`est cost     $${(todo.length * perCell).toFixed(2)}`);
  console.log(`est wall     ${((todo.length * perCellMs) / concurrency / 3_600_000).toFixed(1)}h at concurrency ${concurrency}`);

  // A module no scenario exercises cannot get a verdict. Saying so is the
  // difference between "measured, no effect" and "never measured".
  const requested = new Set(arms.flatMap((a) => armModules(a, sets)));
  const covered = new Set(specs.flatMap((s) => armModules(s.arm, sets)));
  const silent = [...requested].filter((m) => !covered.has(m)).sort();
  if (silent.length) {
    console.log('');
    console.log(`NO VERDICT POSSIBLE for ${silent.length} module(s) — no scenario covers their dispatcher:`);
    for (const m of silent) console.log(`  ${m}`);
    console.log('These are unmeasured, NOT dead weight. Add a scenario or leave them alone.');
  }

  // Precondition. A scenario that does not instruct the agent to use its skill
  // cannot distinguish `full` from `no-skill`, so it cannot contribute to any
  // module's verdict. Dry-run prints the offenders (that is how they get fixed);
  // a real run refuses to spend a cent until they are.
  const mentionProblems = checkScenarioSkillMentions(scenarios);
  if (mentionProblems.length > 0) {
    console.log('');
    console.log(formatSkillMentionProblems(mentionProblems));
  }

  if (values['dry-run']) return;
  if (mentionProblems.length > 0) {
    throw new Error('refusing to run: fix the scenario task text above, or select only scenarios that pass.');
  }
  if (todo.length === 0) {
    console.log('\nnothing to run.');
    return;
  }

  console.log(`\ncells -> ${file}\n`);
  let completed = 0;
  let running = 0;
  let failures = 0;
  let notInvoked = 0;
  let spent = 0;

  await pool(todo, concurrency, async (spec: CellSpec) => {
    running++;
    const cell = await runCell({ runId, spec, sets });
    running--;
    completed++;
    spent += cell.costUsd ?? 0;
    if (cell.noReport || cell.exitReason !== 'success') failures++;
    if (cell.skillInvoked === false && cell.arm !== 'no-skill') notInvoked++;
    appendCell(file, cell); // flushed before the next cell starts
    console.log(
      `[${completed}/${todo.length}] ${spec.key} recall=${cell.recall.toFixed(2)} ` +
        `fab=${cell.fabrications.length} skill=${skillTag(cell)} ` +
        `${cell.exitReason} (running ${running}, failures ${failures}, $${spent.toFixed(2)})`,
    );
  });

  console.log(`\ndone. ${completed} cells, ${failures} failures, $${spent.toFixed(2)}.`);
  if (notInvoked > 0) {
    // Not a footnote. These cells measured the raw model on a skill-bearing arm,
    // so they must be excluded from means rather than averaged in.
    console.log(
      `WARNING: ${notInvoked}/${completed} skill-bearing cells never invoked a gstack skill. ` +
        `Those arms have no verdict until that is fixed — see the kept reports.`,
    );
  }
  console.log(`cells: ${file}`);
  const reports = path.join(path.dirname(file), 'reports');
  if (fs.existsSync(reports)) console.log(`kept reports (no-report / fabrication cells): ${reports}`);
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
