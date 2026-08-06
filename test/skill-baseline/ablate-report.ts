/**
 * Statistics and verdict layer for the per-module ablation study.
 *
 * Pure functions over `cells.jsonl`. No model calls, no network, one optional
 * fs read (the real byte weight of a module on disk, so the bottom line says
 * how many KB the data licenses deleting rather than a guess).
 *
 * The asymmetry that drives every default in this file: calling a module DEAD
 * when the study merely lacked power deletes working judgment, and nobody finds
 * out until a user gets a worse plan six months later. Calling a module
 * INSUFFICIENT costs another eval run. So every ambiguous case resolves to
 * INSUFFICIENT, and DEAD requires the data to actively RULE OUT a degradation
 * worth caring about, not merely fail to detect one.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Cell } from './cell';
import { ablatedModule } from './cell';
import {
  summarizeArm,
  comparePair,
  resolvingPower,
  type ArmSummary,
  type PairVerdict,
  type ScenarioScore,
} from './score';

/** Repo root. Computed locally so this module imports nothing that writes files. */
export const REPO_ROOT = path.resolve(import.meta.dir, '..', '..');

export interface Options {
  /** Bootstrap resamples. 2000 is enough for a 95% percentile CI to be stable. */
  iterations: number;
  /** Fixed so two runs of the report over the same cells agree exactly. */
  seed: number;
  level: number;
  /** Fewer replicates than this in either arm and there is no verdict, only noise. */
  minReplicates: number;
  /**
   * Smallest recall degradation worth keeping a module for: 10 recall points,
   * matching score.ts's noise band. DEAD requires the CI to exclude a drop this
   * big (an equivalence claim), not merely to include zero.
   */
  minEffect: number;
  /** Same idea for fabrications: half an extra fabrication per scenario. */
  minFabEffect: number;
  /** Fraction of cells that may be timeouts / no-reports before the arm is triage, not data. */
  maxUnhealthy: number;
  /**
   * Share of a skill-bearing arm's cells that must have actually invoked a
   * skill. Below it the arm has a prompt problem, not a verdict — and if `full`
   * is below it, the whole run is invalid, because whatever separated `full`
   * from the controls was not the skill.
   */
  minInvocationRate: number;
  /** Passed through to score.ts comparePair for the validity gate. */
  noiseBand: number;
  root: string;
  /** Injectable for tests; defaults to reading skills/ off disk. */
  bytesOf?: (moduleId: string) => number | null;
}

export const DEFAULTS: Omit<Options, 'bytesOf'> = {
  iterations: 2000,
  seed: 20260801,
  level: 0.95,
  minReplicates: 3,
  minEffect: 0.1,
  minFabEffect: 0.5,
  maxUnhealthy: 1 / 3,
  minInvocationRate: 0.8,
  noiseBand: 0.1,
  root: REPO_ROOT,
};

// ─────────────────────────── byte weight ───────────────────────────

/** `plan/office-hours` → skills/plan/references/legacy/office-hours.md */
export function moduleFilePath(moduleId: string, root = REPO_ROOT): string | null {
  const candidates: string[] = [];
  const slash = moduleId.indexOf('/');
  if (slash > 0) {
    const dispatcher = moduleId.slice(0, slash);
    const name = moduleId.slice(slash + 1).replace(/\.md$/, '');
    candidates.push(path.join(root, 'skills', dispatcher, 'references', 'legacy', `${name}.md`));
  }
  candidates.push(path.join(root, 'skills', moduleId.endsWith('.md') ? moduleId : `${moduleId}.md`));
  candidates.push(path.join(root, moduleId));
  for (const p of candidates) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // not this candidate; try the next shape
    }
  }
  return null;
}

/** null, never 0, when the file cannot be found — a silent 0 fakes a free deletion. */
export function moduleBytes(moduleId: string, root = REPO_ROOT): number | null {
  const p = moduleFilePath(moduleId, root);
  if (!p) return null;
  try {
    return fs.statSync(p).size;
  } catch {
    return null;
  }
}

// ─────────────────────────── bootstrap ───────────────────────────

/** Deterministic PRNG (mulberry32) so a verdict is reproducible from the JSONL alone. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

export interface Interval {
  delta: number;
  lo: number;
  hi: number;
  /** hi - lo. A reader should be able to see width without doing the subtraction. */
  width: number;
  /** Resamples actually performed. 0 means no CI was computable. */
  iterations: number;
}

/**
 * Paired cluster bootstrap of (treatment - control) over shared scenarios.
 *
 * Assumptions, stated so a reader can reject them:
 *  1. Scenarios are exchangeable draws from the population of tasks the module
 *     could face. Resampled with replacement, so between-task difficulty is in
 *     the interval. With few scenarios this dominates and the interval is wide —
 *     that is the instrument telling the truth, not a bug to tune away.
 *  2. Replicates within a scenario are iid draws from the model's output
 *     distribution at fixed temperature. Resampled with replacement inside each
 *     drawn scenario, so model stochasticity is also in the interval.
 *  3. Nothing is assumed normal. Recall is a bounded ratio over ~10 findings and
 *     at 3 replicates its sampling distribution is lumpy and often skewed, which
 *     is exactly why this is a percentile bootstrap and not a t-test. A t-test
 *     here would report a tight symmetric interval it has not earned, and a
 *     tight interval is what turns an underpowered cell into a false DEAD.
 *
 * Pairing is within scenario: treatment and control are resampled on the same
 * drawn scenario, so scenario difficulty cancels the way it does in the
 * per-scenario W/L/T count score.ts already uses.
 */
export function bootstrapPairedDelta(
  treat: Map<string, number[]>,
  control: Map<string, number[]>,
  shared: string[],
  opts: Pick<Options, 'iterations' | 'seed' | 'level'>,
): Interval {
  const usable = shared.filter((s) => (treat.get(s)?.length ?? 0) > 0 && (control.get(s)?.length ?? 0) > 0);
  const point = usable.length === 0 ? 0 : mean(usable.map((s) => mean(treat.get(s)!) - mean(control.get(s)!)));
  if (usable.length === 0) {
    return { delta: 0, lo: -1, hi: 1, width: 2, iterations: 0 };
  }

  const rnd = mulberry32(opts.seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
  const deltas: number[] = [];
  for (let b = 0; b < opts.iterations; b++) {
    let acc = 0;
    for (let k = 0; k < usable.length; k++) {
      const sid = pick(usable);
      const t = treat.get(sid)!;
      const c = control.get(sid)!;
      let ts = 0;
      for (let i = 0; i < t.length; i++) ts += pick(t);
      let cs = 0;
      for (let i = 0; i < c.length; i++) cs += pick(c);
      acc += ts / t.length - cs / c.length;
    }
    deltas.push(acc / usable.length);
  }
  deltas.sort((a, b) => a - b);
  const tail = (1 - opts.level) / 2;
  const lo = percentile(deltas, tail);
  const hi = percentile(deltas, 1 - tail);
  return { delta: point, lo, hi, width: hi - lo, iterations: opts.iterations };
}

// ─────────────────────────── per-arm stats ───────────────────────────

/**
 * One pseudo-ScenarioScore per scenario, replicates concatenated, so score.ts's
 * `summarizeArm` / `comparePair` apply unchanged instead of being reimplemented.
 * Pooled recall = total hits / total expected across replicates.
 */
export function perScenarioScores(cells: Cell[]): ScenarioScore[] {
  const by = new Map<string, Cell[]>();
  for (const c of cells) (by.get(c.scenarioId) ?? by.set(c.scenarioId, []).get(c.scenarioId)!).push(c);
  return [...by.entries()].map(([scenarioId, cs]) => {
    const hits = cs.flatMap((c, i) => c.hits.map((h) => `${i}:${h}`));
    const misses = cs.flatMap((c, i) => c.misses.map((m) => `${i}:${m}`));
    return {
      scenarioId,
      arm: cs[0].arm,
      hits,
      misses,
      fabrications: cs.flatMap((c, i) => c.fabrications.map((f) => `${i}:${f}`)),
      recall: hits.length + misses.length === 0 ? 0 : hits.length / (hits.length + misses.length),
      // A scenario counts as no-report only if it never reported in any replicate.
      noReport: cs.every((c) => c.noReport),
      reportChars: cs.reduce((n, c) => n + c.reportChars, 0),
    };
  });
}

function groupValues(cells: Cell[], value: (c: Cell) => number): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const c of cells) (m.get(c.scenarioId) ?? m.set(c.scenarioId, []).get(c.scenarioId)!).push(value(c));
  return m;
}

export const recallOf = (c: Cell): number => c.recall;
export const fabricationsOf = (c: Cell): number => c.fabrications.length;

/** A cell that timed out or produced nothing is triage, not a measurement. */
export function isUnhealthy(c: Cell): boolean {
  return c.exitReason !== 'success' || c.noReport || Boolean(c.error);
}

/**
 * Arms whose entire point is that a gstack skill runs.
 *
 * `no-skill` is excluded because a non-invocation there is the arm working as
 * designed. `gutted` is excluded too: its skills are frontmatter-only, so
 * "invoked an empty body" and "never invoked" measure nearly the same thing,
 * and thinning the negative control would weaken the validity gate rather than
 * strengthen it.
 */
export function isSkillBearing(arm: string): boolean {
  return arm === 'full' || arm.startsWith('ablate:') || arm.startsWith('solo:') || arm.startsWith('ablate-set:');
}

/**
 * The cells that actually measure the arm.
 *
 * `skillInvoked === false` on a skill-bearing arm means the session never called
 * the Skill tool: the cell measures the raw model with an unread directory on
 * disk. Left in the mean it drags `full` toward the floor, and once `full` IS
 * `no-skill` every ablation delta collapses to zero and all 42 modules read
 * DEAD — a recommendation to delete everything, for a reason unrelated to any
 * module's content.
 *
 * `null` (older cells, missing transcript) stays IN the mean. Excluding it would
 * empty every arm written before the runner populated the field, turning a
 * usable run into a silent zero. It is instead excluded from the invocation
 * rate and counted, so a reader sees how much of the arm the rate covers.
 */
export function measuredCells(arm: string, cells: Cell[]): Cell[] {
  return isSkillBearing(arm) ? cells.filter((c) => c.skillInvoked !== false) : cells;
}

/** Invoked / known. null when no cell recorded the field: unmeasured, not zero. */
export function invocationRate(arm: string, cells: Cell[]): number | null {
  if (!isSkillBearing(arm)) return null;
  const known = cells.filter((c) => c.skillInvoked != null);
  return known.length === 0 ? null : known.filter((c) => c.skillInvoked === true).length / known.length;
}

export interface ArmStats {
  arm: string;
  /** Cells that MEASURE the arm — the ones every mean below is computed over. */
  cells: number;
  /** Cells written for this arm, including any excluded from the means. */
  cellsTotal: number;
  /** Skill-bearing cells that never invoked a skill. Excluded, never dropped silently. */
  notInvokedCells: number;
  /** Invoked / known. null on `no-skill`/`gutted`, or when no cell recorded it. */
  invocationRate: number | null;
  /** Cells with `skillInvoked === null`. Kept in the means, excluded from the rate. */
  invocationUnknownCells: number;
  scenarios: string[];
  skills: string[];
  /** Replicate count per scenario. A thin arm is visible here, never hidden. */
  replicatesMin: number;
  replicatesMax: number;
  /** Mean over scenarios of the mean over replicates. Scenario-weighted, not cell-weighted. */
  meanRecall: number;
  meanFabrications: number;
  noReportRate: number;
  unhealthyRate: number;
  exitReasons: Record<string, number>;
  errorCells: number;
  costUsd: number;
  costUnknownCells: number;
  durationMsTotal: number;
  /** score.ts's pooled hits/misses view of the same cells. */
  pooled: ArmSummary;
}

/** Takes RAW cells and excludes the non-measurements itself, so no caller can forget. */
export function armStats(arm: string, raw: Cell[]): ArmStats {
  const cells = measuredCells(arm, raw);
  const byScenario = groupValues(cells, recallOf);
  const counts = [...byScenario.values()].map((v) => v.length);
  const exitReasons: Record<string, number> = {};
  for (const c of cells) exitReasons[c.exitReason] = (exitReasons[c.exitReason] ?? 0) + 1;
  const scenarios = [...byScenario.keys()].sort();
  return {
    arm,
    cells: cells.length,
    cellsTotal: raw.length,
    notInvokedCells: raw.length - cells.length,
    invocationRate: invocationRate(arm, raw),
    invocationUnknownCells: raw.filter((c) => c.skillInvoked == null).length,
    scenarios,
    skills: [...new Set(cells.map((c) => c.skill))].sort(),
    replicatesMin: counts.length === 0 ? 0 : Math.min(...counts),
    replicatesMax: counts.length === 0 ? 0 : Math.max(...counts),
    meanRecall: mean([...byScenario.values()].map(mean)),
    meanFabrications: mean([...groupValues(cells, fabricationsOf).values()].map(mean)),
    noReportRate: cells.length === 0 ? 0 : cells.filter((c) => c.noReport).length / cells.length,
    unhealthyRate: cells.length === 0 ? 0 : cells.filter(isUnhealthy).length / cells.length,
    exitReasons,
    errorCells: cells.filter((c) => Boolean(c.error)).length,
    costUsd: cells.reduce((n, c) => n + (c.costUsd ?? 0), 0),
    costUnknownCells: cells.filter((c) => c.costUsd == null).length,
    durationMsTotal: cells.reduce((n, c) => n + c.durationMs, 0),
    pooled: summarizeArm(arm, perScenarioScores(cells)),
  };
}

// ─────────────────────────── validity gate ───────────────────────────

export interface GatePair {
  pair: string;
  /** control - full. Negative = the control is worse, which is what must happen. */
  recall: Interval;
  paired: PairVerdict;
  /** Both the bootstrap CI and score.ts's W/L majority must agree. */
  separates: boolean;
  note: string;
}

export interface ValidityGate {
  valid: boolean;
  missingArms: string[];
  pairs: GatePair[];
  /** `full`'s own stats, so a reader can check the invocation rate the gate used. */
  full: ArmStats;
  /** Set when `full` did not reliably invoke a skill: separation proves nothing. */
  invocationFailure: string | null;
  banner: string[];
}

/**
 * Computed FIRST, before any per-module verdict.
 *
 * `full` must be distinguishably better than BOTH negative controls:
 *   gutted   every module reduced to headings. If gutted ties full, the
 *            scenarios cannot see what the module bodies do, so they certainly
 *            cannot see what ONE body does.
 *   no-skill raw model. If no-skill ties full, the scenarios do not even
 *            distinguish "has gstack" from "has nothing".
 *
 * The two tests are ANDed (bootstrap CI excludes zero AND score.ts's
 * noise-band + per-scenario majority), because a gate that lets a blind run
 * through licenses deleting 40 modules on noise.
 */
export function validityGate(byArmRaw: Map<string, Cell[]>, opts: Options): ValidityGate {
  // Non-invoking cells are not measurements; the gate must not average them in
  // either, or a `full` that half-failed to load looks merely mediocre.
  const byArm = new Map([...byArmRaw].map(([arm, cs]) => [arm, measuredCells(arm, cs)] as const));
  const fullStats = armStats('full', byArmRaw.get('full') ?? []);
  const full = byArm.get('full') ?? [];
  const missingArms = ['full', 'gutted', 'no-skill'].filter((a) => (byArm.get(a) ?? []).length === 0);

  const invocationFailure =
    fullStats.invocationRate != null && fullStats.invocationRate < opts.minInvocationRate
      ? `\`full\` invoked a skill in only ${(fullStats.invocationRate * 100).toFixed(0)}% of its cells ` +
        `(${fullStats.notInvokedCells}/${fullStats.cellsTotal} never called one).`
      : null;

  const scores: Record<string, ScenarioScore[]> = {};
  if (full.length > 0) scores.current = perScenarioScores(full);
  for (const control of ['gutted', 'no-skill']) {
    const cs = byArm.get(control) ?? [];
    if (cs.length > 0) scores[control] = perScenarioScores(cs);
  }
  const power = resolvingPower(scores, opts.noiseBand);

  const fullRecall = groupValues(full, recallOf);
  const pairs: GatePair[] = [];
  for (const control of ['gutted', 'no-skill']) {
    const cs = byArm.get(control) ?? [];
    if (cs.length === 0 || full.length === 0) continue;
    const shared = [...groupValues(cs, recallOf).keys()].filter((s) => fullRecall.has(s));
    const recall = bootstrapPairedDelta(groupValues(cs, recallOf), fullRecall, shared, opts);
    const paired = comparePair(
      { arm: 'full', scores: scores.current },
      { arm: control, scores: scores[control] },
      opts.noiseBand,
    );
    const ciSeparates = recall.iterations > 0 && recall.hi < 0;
    pairs.push({
      pair: `full vs ${control}`,
      recall,
      paired,
      separates: ciSeparates && paired.separates,
      note: ciSeparates
        ? paired.separates
          ? `${control} is worse than full by ${fmtPts(-recall.delta)} recall points, CI ${fmtCi(negate(recall))}.`
          : `bootstrap separates but the per-scenario majority does not (${paired.wins}W/${paired.losses}L/${paired.ties}T) — treated as NOT separating.`
        : `${control} does NOT separate from full: delta ${fmtPts(recall.delta)} recall points, CI ${fmtCi(recall)}.`,
    });
  }

  const valid =
    invocationFailure === null &&
    missingArms.length === 0 &&
    pairs.length === 2 &&
    pairs.every((p) => p.separates) &&
    power.resolving;

  const banner: string[] = [];
  if (valid) {
    banner.push('INSTRUMENT VALID. Both negative controls separate from `full`.');
    for (const p of pairs) banner.push(`  ${p.pair}: ${p.note}`);
    if (fullStats.invocationRate != null) {
      banner.push(
        `  \`full\` invoked a skill in ${(fullStats.invocationRate * 100).toFixed(0)}% of its cells` +
          (fullStats.invocationUnknownCells > 0
            ? ` (${fullStats.invocationUnknownCells} cell(s) unknown, so the rate covers only part of the arm).`
            : '.'),
      );
    }
  } else {
    banner.push(
      '',
      '='.repeat(78),
      'INVALID RUN — THIS INSTRUMENT IS BLIND. NO MODULE VERDICT BELOW IS USABLE.',
      '='.repeat(78),
    );
    if (invocationFailure) {
      banner.push(
        'THE SKILL DID NOT RUN.',
        `  ${invocationFailure}`,
        '  A `full` cell that never called the Skill tool measures the raw model with',
        '  an unread directory on disk. On those cells `full` IS `no-skill`, so every',
        '  ablation delta collapses toward zero and every module reads as dead weight.',
        '  Whatever separation the pairs below show, it was not the skill doing it.',
        '  Fix the invocation (prompt, routing, or install) before reading any verdict.',
        '',
      );
    }
    if (missingArms.length > 0) {
      banner.push(`Missing arms (never ran, zero cells): ${missingArms.join(', ')}.`);
    }
    for (const p of pairs) banner.push(`  ${p.pair}: ${p.note}`);
    if (!power.resolving) {
      // score.ts owns the canonical "why this matters" prose. Don't restate it.
      banner.push(...power.banner);
    } else if (!invocationFailure) {
      // The pairwise test passed but the gate did not (missing arm, or the
      // bootstrap and the W/L majority disagree).
      banner.push(
        '',
        'Scenarios that cannot tell "all 42 modules gutted" from "all 42 present"',
        'cannot tell whether ONE of them earns its tokens.',
        'Do NOT cite this run to delete, shrink, or defend anything.',
        'Fix the scenarios (or the replicate budget) and re-run.',
      );
    } else {
      banner.push('', 'Do NOT cite this run to delete, shrink, or defend anything.');
    }
    banner.push('='.repeat(78), '');
  }
  return { valid, missingArms, pairs, full: fullStats, invocationFailure, banner };
}

// ─────────────────────────── one comparison axis ───────────────────────────

/** cell.ts owns the `ablate:` parser. These two are its siblings. */
export const soloModule = (arm: string): string | null => (arm.startsWith('solo:') ? arm.slice(5) : null);
export const ablatedSet = (arm: string): string | null =>
  arm.startsWith('ablate-set:') ? arm.slice('ablate-set:'.length) : null;

/**
 * Three-state read of one interval. `unclear` is never rounded to `flat` — that
 * rounding is the false-DEAD this whole layer exists to prevent.
 *
 * `direction` is the side of zero we care about: -1 when a DROP is the effect
 * (ablation degrading), +1 when a RISE is (solo beating the floor).
 *   moves    the whole CI sits on the caring side of zero
 *   flat     the CI rules out an effect as large as minEffect on that side
 *   unclear  neither: underpowered
 */
export type Signal = 'moves' | 'flat' | 'unclear';

export function readSignal(i: Interval, direction: -1 | 1, minEffect: number): Signal {
  if (i.iterations === 0) return 'unclear';
  if (direction < 0) {
    if (i.hi < 0) return 'moves';
    return i.lo > -minEffect ? 'flat' : 'unclear';
  }
  if (i.lo > 0) return 'moves';
  return i.hi < minEffect ? 'flat' : 'unclear';
}

export interface Axis {
  /** e.g. `ablate:plan/office-hours vs full`. */
  label: string;
  treat: ArmStats;
  control: ArmStats;
  /** Scenarios scored in BOTH arms — the only ones the comparison uses. */
  sharedScenarios: string[];
  /** Ran in the treatment arm but never in the control: never dropped silently. */
  missingFromControl: string[];
  recall: Interval;
  fabrications: Interval;
  /** Recall direction; fabrications are read in the opposite direction. */
  direction: -1 | 1;
  signal: Signal;
  /** Non-empty means this axis has no verdict, only a power problem. */
  powerProblems: string[];
}

/**
 * One arm-vs-arm comparison, with its power audit.
 *
 * Fabrications are read in the OPPOSITE direction to recall, because on the
 * ablate axis more fabrications is harm, while on the solo axis fewer
 * fabrications is the module's contribution.
 */
export function buildAxis(args: {
  treatArm: string;
  treatCells: Cell[];
  controlArm: string;
  controlCells: Cell[];
  direction: -1 | 1;
  opts: Options;
}): Axis {
  const { treatArm, treatCells: rawTreat, controlArm, controlCells: rawControl, direction, opts } = args;
  // Cells that never invoked a skill do not measure this arm; they are counted in
  // ArmStats and reported, never averaged in.
  const treatCells = measuredCells(treatArm, rawTreat);
  const controlCells = measuredCells(controlArm, rawControl);
  const tRecall = groupValues(treatCells, recallOf);
  const cRecall = groupValues(controlCells, recallOf);
  const sharedScenarios = [...tRecall.keys()].filter((s) => cRecall.has(s)).sort();
  const missingFromControl = [...tRecall.keys()].filter((s) => !cRecall.has(s)).sort();
  const treat = armStats(treatArm, rawTreat);
  const control = armStats(controlArm, rawControl.filter((c) => sharedScenarios.includes(c.scenarioId)));
  const recall = bootstrapPairedDelta(tRecall, cRecall, sharedScenarios, opts);
  const fabrications = bootstrapPairedDelta(
    groupValues(treatCells, fabricationsOf),
    groupValues(controlCells, fabricationsOf),
    sharedScenarios,
    opts,
  );

  const powerProblems: string[] = [];
  if (treat.cells === 0) powerProblems.push(`${treatArm} has zero cells`);
  if (control.cells === 0) powerProblems.push(`${controlArm} has zero cells on these scenarios`);
  if (sharedScenarios.length === 0) powerProblems.push(`no scenario was scored in both ${treatArm} and ${controlArm}`);
  const reps = Math.min(treat.replicatesMin, control.replicatesMin);
  if (sharedScenarios.length > 0 && reps < opts.minReplicates) {
    powerProblems.push(`thinnest scenario has ${reps} replicate(s), need ${opts.minReplicates}`);
  }
  for (const a of [treat, control]) {
    if (a.cells > 0 && a.unhealthyRate > opts.maxUnhealthy) {
      powerProblems.push(
        `${a.arm}: ${(a.unhealthyRate * 100).toFixed(0)}% of cells timed out or produced no report ` +
          `(${JSON.stringify(a.exitReasons)}) — budget problem, not a verdict`,
      );
    }
    // An arm that rarely invoked the skill has no verdict, in the same way a
    // mostly-timed-out arm has none: the sessions were not measuring the tree.
    if (a.invocationRate != null && a.invocationRate < opts.minInvocationRate) {
      powerProblems.push(
        `${a.arm}: invocation rate ${(a.invocationRate * 100).toFixed(0)}% ` +
          `(${a.notInvokedCells}/${a.cellsTotal} cells never called a skill) — prompt problem, not a verdict`,
      );
    }
  }
  if (missingFromControl.length > 0) {
    powerProblems.push(`${missingFromControl.length} ${treatArm} scenario(s) have no \`${controlArm}\` counterpart`);
  }

  const r = readSignal(recall, direction, opts.minEffect);
  const f = readSignal(fabrications, direction < 0 ? 1 : -1, opts.minFabEffect);
  const signal: Signal = r === 'moves' || f === 'moves' ? 'moves' : r === 'flat' && f === 'flat' ? 'flat' : 'unclear';

  return {
    label: `${treatArm} vs ${controlArm}`,
    treat,
    control,
    sharedScenarios,
    missingFromControl,
    recall,
    fabrications,
    direction,
    signal,
    powerProblems,
  };
}

/** Why an axis read the way it did, in one line. */
function axisReason(a: Axis, opts: Options): string {
  const dir = a.direction < 0 ? 'ablation' : 'solo';
  const rc = `recall ${(a.recall.delta >= 0 ? '+' : '') + fmtPts(a.recall.delta)} CI ${fmtCi(a.recall)}`;
  const fc = `fabrications ${(a.fabrications.delta >= 0 ? '+' : '') + a.fabrications.delta.toFixed(2)} CI ${fmtCiRaw(a.fabrications)}`;
  if (a.signal === 'moves') return `${a.label}: ${dir} moves the score — ${rc}, ${fc}`;
  if (a.signal === 'flat') {
    return `${a.label}: flat — ${rc} rules out ${fmtPts(opts.minEffect)} points, ${fc} rules out ${opts.minFabEffect}/scenario`;
  }
  return `${a.label}: UNCLEAR — ${rc}, ${fc}; the CI still admits an effect worth caring about`;
}

// ─────────────────────────── per-module verdict ───────────────────────────

/**
 * `DEAD` is the single-arm verdict, kept for runs with no `solo:` cells: the
 * ablation was flat, which is evidence but not proof (flaw 2 — one 11 KB module
 * out of ~1,684 KB is a tiny perturbation). The 2x2 verdicts replace it whenever
 * a `solo:` arm exists.
 */
export type ModuleVerdict =
  | 'EARNS'
  | 'REDUNDANT'
  | 'INTERACTION'
  | 'INERT'
  | 'DEAD'
  | 'INSUFFICIENT'
  | 'UNTRUSTWORTHY';

/** Verdicts that could license a deletion, before set confirmation is considered. */
export const CUT_CANDIDATE: readonly ModuleVerdict[] = ['INERT', 'REDUNDANT', 'DEAD'];

export interface ModuleReport {
  module: string;
  skills: string[];
  bytes: number | null;
  /** `ablate:<module>` vs `full`. null when the run has no ablation arm for it. */
  ablate: Axis | null;
  /** `solo:<module>` vs `no-skill`. null when the run has no solo arm for it. */
  solo: Axis | null;
  /** In `full` for this module's dispatchers but never run ablated: coverage the run lacks. */
  notRunAblated: string[];
  verdict: ModuleVerdict;
  reasons: string[];
  /** What would have to run to promote this verdict to an actionable one. */
  blockedBy: string | null;
}

/**
 * The 2x2 from cell.ts, with INSUFFICIENT dominant over all four and
 * UNTRUSTWORTHY dominant over everything.
 *
 *   solo>floor  ablate<full   verdict
 *   moves       moves         EARNS        earns uniquely, keep
 *   moves       flat          REDUNDANT    works, covered by siblings here
 *   flat        moves         INTERACTION  investigate, do not cut
 *   flat        flat          INERT        safe to delete
 */
function decide(
  ablate: Axis | null,
  solo: Axis | null,
  gateValid: boolean,
  opts: Options,
): { verdict: ModuleVerdict; reasons: string[]; blockedBy: string | null } {
  if (!gateValid) {
    return {
      verdict: 'UNTRUSTWORTHY',
      reasons: ['instrument validity gate failed; these numbers measure the scenarios, not the module'],
      blockedBy: 'a run whose `gutted` and `no-skill` arms separate from `full`',
    };
  }

  const problems = [...(ablate?.powerProblems ?? []), ...(solo?.powerProblems ?? [])];
  if (!ablate && !solo) {
    return { verdict: 'INSUFFICIENT', reasons: ['no `ablate:` or `solo:` arm for this module'], blockedBy: 'any arm' };
  }
  if (problems.length > 0) {
    return { verdict: 'INSUFFICIENT', reasons: problems, blockedBy: 'more replicates or a healthier arm' };
  }

  // ── single-arm fallback: an ablate-only run still reports something honest ──
  if (!solo) {
    const reasons = [axisReason(ablate!, opts)];
    if (ablate!.signal === 'moves') return { verdict: 'EARNS', reasons, blockedBy: null };
    if (ablate!.signal === 'unclear') {
      return { verdict: 'INSUFFICIENT', reasons, blockedBy: 'more replicates or scenarios' };
    }
    return {
      verdict: 'DEAD',
      reasons: [
        ...reasons,
        'single-arm evidence only: a flat ablation cannot separate INERT from REDUNDANT, ' +
          'and cannot rule out an effect hidden under the variance of the other 41 modules',
      ],
      blockedBy: 'a `solo:` arm (standalone signal) or an `ablate-set:` confirmation',
    };
  }
  // ── solo-only: no ablation to compare, so redundancy is unknown ──
  if (!ablate) {
    return {
      verdict: 'INSUFFICIENT',
      reasons: [axisReason(solo, opts), 'no `ablate:` arm, so redundancy against siblings is unmeasured'],
      blockedBy: 'an `ablate:` arm',
    };
  }

  if (ablate.signal === 'unclear' || solo.signal === 'unclear') {
    return {
      verdict: 'INSUFFICIENT',
      reasons: [axisReason(ablate, opts), axisReason(solo, opts)],
      blockedBy: 'more replicates or scenarios on the unclear axis',
    };
  }

  const reasons = [axisReason(solo, opts), axisReason(ablate, opts)];
  if (solo.signal === 'moves' && ablate.signal === 'moves') {
    return { verdict: 'EARNS', reasons: [...reasons, 'works standalone AND its removal hurts: earns uniquely'], blockedBy: null };
  }
  if (solo.signal === 'moves' && ablate.signal === 'flat') {
    return {
      verdict: 'REDUNDANT',
      reasons: [...reasons, 'works standalone but its removal costs nothing: a sibling covers it here'],
      blockedBy: 'an `ablate-set:` confirmation covering this module',
    };
  }
  if (solo.signal === 'flat' && ablate.signal === 'moves') {
    return {
      verdict: 'INTERACTION',
      reasons: [...reasons, 'does nothing alone yet its removal hurts: an interaction effect. Investigate, do not cut'],
      blockedBy: 'an investigation, not a deletion',
    };
  }
  return {
    verdict: 'INERT',
    reasons: [...reasons, 'no standalone contribution and no cost to removing it'],
    blockedBy: null,
  };
}

// ─────────────────────────── set confirmation ───────────────────────────

export type SetVerdict = 'CONFIRMED' | 'MUTUAL_REDUNDANCY' | 'DEGRADES' | 'INSUFFICIENT' | 'UNTRUSTWORTHY';

export interface SetReport {
  setId: string;
  arm: string;
  members: string[];
  /** `arm-id` when the arm encodes members (`ablate-set:a/b+c/d`), else presumed. */
  memberSource: 'arm-id' | 'presumed: run cut candidates';
  memberVerdicts: Record<string, ModuleVerdict>;
  bytes: number;
  bytesUnknown: string[];
  axis: Axis;
  verdict: SetVerdict;
  reasons: string[];
}

/** `ablate-set:a/b+c/d` → members. A bare id does not encode membership. */
export function parseSetMembers(setId: string): string[] | null {
  const parts = setId
    .split(/[+,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 1 && parts.every((p) => p.includes('/')) ? parts : null;
}

/**
 * The confirmation phase, and the reason `ablate-set:` exists.
 *
 * If the set degrades while every member individually read flat, the members
 * cover each other: each single ablation was masked by a surviving sibling.
 * Deleting them one at a time on single-module evidence would have shipped the
 * regression. That case refuses to recommend and asks for a bisect.
 */
function decideSet(
  axis: Axis,
  members: string[],
  memberVerdicts: Record<string, ModuleVerdict>,
  gateValid: boolean,
  opts: Options,
): { verdict: SetVerdict; reasons: string[] } {
  if (!gateValid) {
    return { verdict: 'UNTRUSTWORTHY', reasons: ['instrument validity gate failed'] };
  }
  if (axis.powerProblems.length > 0) return { verdict: 'INSUFFICIENT', reasons: axis.powerProblems };
  if (axis.signal === 'unclear') {
    return { verdict: 'INSUFFICIENT', reasons: [axisReason(axis, opts)] };
  }
  if (axis.signal === 'flat') {
    return {
      verdict: 'CONFIRMED',
      reasons: [axisReason(axis, opts), `removing all ${members.length} together costs nothing measurable`],
    };
  }
  // The set degrades. Was every member individually cleared?
  const individuallyFlat = members.filter((m) => {
    const v = memberVerdicts[m];
    return v === 'INERT' || v === 'REDUNDANT' || v === 'DEAD';
  });
  if (members.length > 0 && individuallyFlat.length === members.length) {
    return {
      verdict: 'MUTUAL_REDUNDANCY',
      reasons: [
        axisReason(axis, opts),
        `every one of the ${members.length} members read ${[...new Set(members.map((m) => memberVerdicts[m]))].join('/')} alone, ` +
          'yet removing them together degrades the score: they cover each other',
      ],
    };
  }
  const carriers = members.filter((m) => !individuallyFlat.includes(m));
  return {
    verdict: 'DEGRADES',
    reasons: [
      axisReason(axis, opts),
      carriers.length > 0
        ? `expected: the set contains ${carriers.length} module(s) that did not read flat alone (${carriers.join(', ')})`
        : 'the set degrades and its membership is unknown, so nothing can be cleared',
    ],
  };
}

// ─────────────────────────── top level ───────────────────────────

export interface AblationReport {
  runId: string;
  totalCells: number;
  totalCostUsd: number;
  costUnknownCells: number;
  totalDurationMs: number;
  gate: ValidityGate;
  arms: ArmStats[];
  modules: ModuleReport[];
  sets: SetReport[];
  /**
   * The only modules the data licenses deleting: INERT, or REDUNDANT covered by
   * a CONFIRMED set. A REDUNDANT module on single-arm evidence is never here.
   */
  deletableModules: string[];
  deletableBytes: number;
  /** Deletable modules whose file could not be located; excluded from the total, never assumed 0. */
  deletableBytesUnknown: string[];
  /** Looks cuttable but is not actionable yet, with what would unblock it. */
  cutCandidates: Array<{ module: string; verdict: ModuleVerdict; bytes: number | null; blockedBy: string | null }>;
  /** Non-empty means at least one proposed set holds mutual redundancy: refuse and bisect. */
  mutualRedundancy: SetReport[];
  warnings: string[];
  options: Omit<Options, 'bytesOf'>;
}

export function analyze(cells: Cell[], override: Partial<Options> = {}): AblationReport {
  const opts: Options = { ...DEFAULTS, ...override };
  const bytesOf = opts.bytesOf ?? ((id: string) => moduleBytes(id, opts.root));

  const byArm = new Map<string, Cell[]>();
  for (const c of cells) (byArm.get(c.arm) ?? byArm.set(c.arm, []).get(c.arm)!).push(c);

  const gate = validityGate(byArm, opts);

  const order = (a: string) =>
    a === 'full' ? 0 : a === 'gutted' ? 1 : a === 'no-skill' ? 2 : a.startsWith('ablate-set:') ? 3 : 4;
  const arms = [...byArm.entries()]
    .sort((x, y) => order(x[0]) - order(y[0]) || x[0].localeCompare(y[0]))
    .map(([arm, cs]) => armStats(arm, cs));

  const full = byArm.get('full') ?? [];
  const floor = byArm.get('no-skill') ?? [];

  // Every module named by an `ablate:` or a `solo:` arm gets one row.
  const named = new Map<string, { ablate?: Cell[]; solo?: Cell[] }>();
  for (const [arm, cs] of byArm) {
    const a = ablatedModule(arm as Cell['arm']);
    const s = soloModule(arm);
    if (a) (named.get(a) ?? named.set(a, {}).get(a)!).ablate = cs;
    else if (s) (named.get(s) ?? named.set(s, {}).get(s)!).solo = cs;
  }

  const modules: ModuleReport[] = [];
  for (const [module, { ablate: ablateCells, solo: soloCells }] of named) {
    const ablate = ablateCells
      ? buildAxis({
          treatArm: `ablate:${module}`,
          treatCells: ablateCells,
          controlArm: 'full',
          controlCells: full,
          direction: -1, // a DROP vs full is the effect
          opts,
        })
      : null;
    const solo = soloCells
      ? buildAxis({
          treatArm: `solo:${module}`,
          treatCells: soloCells,
          controlArm: 'no-skill',
          controlCells: floor,
          direction: 1, // a RISE vs the floor is the effect
          opts,
        })
      : null;

    const skills = [...new Set([...(ablateCells ?? []), ...(soloCells ?? [])].map((c) => c.skill))].sort();
    const ranSids = new Set((ablateCells ?? []).map((c) => c.scenarioId));
    const notRunAblated = [...new Set(full.filter((c) => skills.includes(c.skill)).map((c) => c.scenarioId))]
      .filter((s) => !ranSids.has(s))
      .sort();

    modules.push({
      module,
      skills,
      bytes: bytesOf(module),
      ablate,
      solo,
      notRunAblated: ablateCells ? notRunAblated : [],
      ...decide(ablate, solo, gate.valid, opts),
    });
  }
  // Worst ablation delta first: the modules that most look like they earn their tokens.
  const sortKey = (m: ModuleReport) => m.ablate?.recall.delta ?? m.solo?.recall.delta ?? 0;
  modules.sort((a, b) => sortKey(a) - sortKey(b) || a.module.localeCompare(b.module));
  const memberVerdicts = Object.fromEntries(modules.map((m) => [m.module, m.verdict]));

  // ── set confirmation ──
  const cutCandidateModules = modules.filter((m) => CUT_CANDIDATE.includes(m.verdict)).map((m) => m.module);
  const sets: SetReport[] = [];
  for (const [arm, setCells] of byArm) {
    const setId = ablatedSet(arm);
    if (setId == null) continue;
    const parsed = parseSetMembers(setId);
    const members = parsed ?? cutCandidateModules;
    const axis = buildAxis({
      treatArm: arm,
      treatCells: setCells,
      controlArm: 'full',
      controlCells: full,
      direction: -1,
      opts,
    });
    const memberBytes = members.map((m) => ({ m, b: bytesOf(m) }));
    sets.push({
      setId,
      arm,
      members,
      memberSource: parsed ? 'arm-id' : 'presumed: run cut candidates',
      memberVerdicts: Object.fromEntries(members.map((m) => [m, memberVerdicts[m] ?? 'INSUFFICIENT'])),
      bytes: memberBytes.reduce((n, x) => n + (x.b ?? 0), 0),
      bytesUnknown: memberBytes.filter((x) => x.b == null).map((x) => x.m),
      axis,
      ...decideSet(axis, members, memberVerdicts, gate.valid, opts),
    });
  }
  sets.sort((a, b) => a.setId.localeCompare(b.setId));
  const mutualRedundancy = sets.filter((s) => s.verdict === 'MUTUAL_REDUNDANCY');

  // ── what the run licenses deleting ──
  const confirmed = new Set(sets.filter((s) => s.verdict === 'CONFIRMED').flatMap((s) => s.members));
  // A non-confirmed set VETOES its members, INERT included. An INERT module
  // inside a mutually-redundant set is exactly the module that looked safe alone
  // and is not; recommending it would defeat the confirmation phase.
  const blockedBySet = new Set(sets.filter((s) => s.verdict !== 'CONFIRMED').flatMap((s) => s.members));
  const deletable = modules.filter(
    (m) =>
      !blockedBySet.has(m.module) &&
      (m.verdict === 'INERT' || (m.verdict === 'REDUNDANT' && confirmed.has(m.module))),
  );
  const deletableSet = new Set(deletable.map((m) => m.module));
  const cutCandidates = modules
    .filter((m) => CUT_CANDIDATE.includes(m.verdict) && !deletableSet.has(m.module))
    .map((m) => ({
      module: m.module,
      verdict: m.verdict,
      bytes: m.bytes,
      blockedBy: mutualRedundancy.some((s) => s.members.includes(m.module))
        ? 'bisecting the mutually-redundant set it belongs to'
        : m.blockedBy,
    }));

  const warnings: string[] = [];
  for (const a of arms) {
    if (a.notInvokedCells > 0) {
      warnings.push(
        `arm ${a.arm}: ${a.notInvokedCells}/${a.cellsTotal} cell(s) never invoked a skill — excluded from the means ` +
          `(invocation rate ${a.invocationRate == null ? 'unknown' : (a.invocationRate * 100).toFixed(0) + '%'}). ` +
          `Those sessions measured the raw model, not the tree.`,
      );
    }
    if (a.invocationUnknownCells > 0) {
      warnings.push(
        `arm ${a.arm}: ${a.invocationUnknownCells}/${a.cellsTotal} cell(s) have unknown invocation status ` +
          `(kept in the means); the reported rate covers only the ${a.cellsTotal - a.invocationUnknownCells} known cell(s).`,
      );
    }
    if (a.cells === 0) warnings.push(`arm ${a.arm}: zero cells.`);
    if (a.replicatesMin !== a.replicatesMax) {
      warnings.push(
        `arm ${a.arm}: uneven replicates (${a.replicatesMin}-${a.replicatesMax} per scenario) — some cells never ran.`,
      );
    }
    if (a.unhealthyRate > opts.maxUnhealthy) {
      warnings.push(
        `arm ${a.arm}: ${(a.unhealthyRate * 100).toFixed(0)}% unhealthy cells ${JSON.stringify(a.exitReasons)}.`,
      );
    }
    if (a.costUnknownCells > 0) warnings.push(`arm ${a.arm}: ${a.costUnknownCells} cell(s) reported no cost.`);
  }
  for (const m of modules) {
    for (const ax of [m.ablate, m.solo]) {
      if (ax && ax.missingFromControl.length > 0) {
        warnings.push(`${m.module}: no \`${ax.control.arm}\` cells for ${ax.missingFromControl.join(', ')}.`);
      }
    }
    if (m.notRunAblated.length > 0) {
      warnings.push(`${m.module}: ablation skipped ${m.notRunAblated.length} scenario(s) \`full\` covered.`);
    }
    if (m.ablate && !m.solo) {
      warnings.push(`${m.module}: no \`solo:\` arm — standalone contribution unmeasured (flaw 2 not ruled out).`);
    }
  }
  for (const s of sets) {
    if (s.memberSource !== 'arm-id') {
      warnings.push(
        `set ${s.setId}: membership not encoded in the arm id; presumed to be this run's ${s.members.length} cut candidate(s). ` +
          `Name members as \`ablate-set:a/b+c/d\` to make it explicit.`,
      );
    }
    const unknown = s.members.filter((m) => memberVerdicts[m] == null);
    if (unknown.length > 0) warnings.push(`set ${s.setId}: ${unknown.length} member(s) have no single-module arm.`);
  }

  const { bytesOf: _drop, ...recorded } = opts;
  return {
    runId: cells[0]?.runId ?? '(unknown)',
    totalCells: cells.length,
    totalCostUsd: cells.reduce((n, c) => n + (c.costUsd ?? 0), 0),
    costUnknownCells: cells.filter((c) => c.costUsd == null).length,
    totalDurationMs: cells.reduce((n, c) => n + c.durationMs, 0),
    gate,
    arms,
    modules,
    sets,
    deletableModules: deletable.map((m) => m.module),
    deletableBytes: deletable.reduce((n, m) => n + (m.bytes ?? 0), 0),
    deletableBytesUnknown: deletable.filter((m) => m.bytes == null).map((m) => m.module),
    cutCandidates,
    mutualRedundancy,
    warnings,
    options: recorded,
  };
}

// ─────────────────────────── formatting ───────────────────────────

const negate = (i: Interval): Interval => ({ ...i, delta: -i.delta, lo: -i.hi, hi: -i.lo });
const fmtPts = (x: number): string => (x * 100).toFixed(1);
const fmtCi = (i: Interval): string =>
  i.iterations === 0 ? '[no CI]' : `[${i.lo >= 0 ? '+' : ''}${fmtPts(i.lo)}, ${i.hi >= 0 ? '+' : ''}${fmtPts(i.hi)}]`;
/** Fabrication intervals are counts per scenario, not recall points — no x100. */
const fmtCiRaw = (i: Interval): string =>
  i.iterations === 0 ? '[no CI]' : `[${i.lo >= 0 ? '+' : ''}${i.lo.toFixed(2)}, ${i.hi >= 0 ? '+' : ''}${i.hi.toFixed(2)}]`;
const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length));
/** Set arm ids can name ten modules; keep the columns aligned. */
const clip = (s: string, n: number): string => (s.length <= n ? pad(s, n) : s.slice(0, n - 1) + '~');
const lpad = (s: string, n: number): string => (s.length >= n ? s : ' '.repeat(n - s.length) + s);

export function formatReport(r: AblationReport): string[] {
  const out: string[] = [];
  out.push(`ablation report — run ${r.runId}`, '');

  // 1. Validity gate, first and loud.
  out.push(...r.gate.banner, '');

  // 1b. The refusal. Prominent, not a footnote: this is why `ablate-set:` exists.
  for (const s of r.mutualRedundancy) {
    out.push(
      '='.repeat(78),
      'MUTUAL REDUNDANCY DETECTED — REFUSING TO RECOMMEND THIS SET.',
      '='.repeat(78),
      `set: ${s.setId} (${s.members.length} members, ${kb(s.bytes)})`,
      `members: ${s.members.map((m) => `${m} [${s.memberVerdicts[m]}]`).join(', ')}`,
      ...s.reasons.map((x) => '  ' + x),
      '',
      'Each of these looked safe to delete on its own. Removing them together',
      'degrades the score, so they were covering each other: every single-module',
      'ablation was masked by a surviving sibling. Deleting them one at a time on',
      'that evidence would have shipped the regression.',
      '',
      'DO NOT delete this set. Bisect it: split the members into halves, run',
      `\`ablate-set:\` on each half, and recurse until the degradation localises`,
      'to the module (or the pair) actually carrying the work.',
      '='.repeat(78),
      '',
    );
  }

  // Per-arm census: which cells ran, which never did.
  out.push('ARMS');
  out.push(
    '  ' +
      pad('arm', 34) +
      lpad('cells', 6) +
      lpad('scn', 5) +
      lpad('rep', 8) +
      lpad('recall', 8) +
      lpad('fab', 7) +
      lpad('noRep', 7) +
      lpad('unhlth', 8) +
      lpad('inv', 10) +
      '  exit',
  );
  for (const a of r.arms) {
    out.push(
      '  ' +
        clip(a.arm, 34) +
        lpad(a.cells === a.cellsTotal ? String(a.cells) : `${a.cells}/${a.cellsTotal}`, 6) +
        lpad(String(a.scenarios.length), 5) +
        lpad(a.replicatesMin === a.replicatesMax ? `${a.replicatesMin}x` : `${a.replicatesMin}-${a.replicatesMax}x`, 8) +
        lpad(a.meanRecall.toFixed(3), 8) +
        lpad(a.meanFabrications.toFixed(2), 7) +
        lpad(`${(a.noReportRate * 100).toFixed(0)}%`, 7) +
        lpad(`${(a.unhealthyRate * 100).toFixed(0)}%`, 8) +
        lpad(
          a.invocationRate == null
            ? isSkillBearing(a.arm)
              ? '?'
              : 'n/a'
            : `${(a.invocationRate * 100).toFixed(0)}%` + (a.invocationUnknownCells > 0 ? `+${a.invocationUnknownCells}?` : ''),
          10,
        ) +
        '  ' +
        Object.entries(a.exitReasons)
          .sort()
          .map(([k, n]) => `${k}=${n}`)
          .join(' '),
    );
  }
  out.push('');

  // 2. Per-module table, sorted by delta. Two axes side by side: the 2x2.
  out.push('PER-MODULE VERDICT (sorted by ablation delta, worst first)');
  out.push('  solo:X vs no-skill = standalone contribution | ablate:X vs full = cost of removal');
  if (r.modules.length === 0) {
    out.push('  no `ablate:*` or `solo:*` arm in this run.');
  } else {
    out.push(
      '  ' +
        pad('module', 30) +
        lpad('KB', 6) +
        lpad('scn', 4) +
        lpad('cells', 9) +
        lpad('soloD', 8) +
        lpad('solo 95% CI', 18) +
        lpad('ablD', 8) +
        lpad('abl 95% CI', 18) +
        lpad('fabD', 7) +
        '  verdict',
    );
    const dcol = (i: Interval | undefined) => lpad(i ? (i.delta >= 0 ? '+' : '') + fmtPts(i.delta) : '—', 8);
    const ccol = (i: Interval | undefined) => lpad(i ? fmtCi(i) : '(no arm)', 18);
    for (const m of r.modules) {
      const ax = m.ablate ?? m.solo!;
      out.push(
        '  ' +
          clip(m.module, 30) +
          lpad(m.bytes == null ? '?' : (m.bytes / 1024).toFixed(1), 6) +
          lpad(String(ax.sharedScenarios.length), 4) +
          lpad(`${ax.treat.cells}/${ax.control.cells}`, 9) +
          dcol(m.solo?.recall) +
          ccol(m.solo?.recall) +
          dcol(m.ablate?.recall) +
          ccol(m.ablate?.recall) +
          lpad(
            m.ablate ? (m.ablate.fabrications.delta >= 0 ? '+' : '') + m.ablate.fabrications.delta.toFixed(2) : '—',
            7,
          ) +
          '  ' +
          m.verdict,
      );
      for (const why of m.reasons) out.push('      ' + why);
    }
  }
  out.push('');

  // 3. Set confirmation.
  if (r.sets.length > 0) {
    out.push('SET CONFIRMATION (ablate-set: vs full)');
    for (const s of r.sets) {
      out.push(
        `  ${clip(s.setId, 40)}${lpad(kb(s.bytes), 10)}${lpad((s.axis.recall.delta >= 0 ? '+' : '') + fmtPts(s.axis.recall.delta), 8)}` +
          `${lpad(fmtCi(s.axis.recall), 18)}  ${s.verdict}`,
      );
      out.push(`      members (${s.memberSource}): ${s.members.map((m) => `${m}[${s.memberVerdicts[m]}]`).join(', ')}`);
      for (const why of s.reasons) out.push('      ' + why);
    }
    out.push('');
  }

  // 4. Bottom line. Only INERT, or REDUNDANT with a passing set confirmation.
  out.push('BOTTOM LINE');
  if (!r.gate.valid) {
    out.push('  None. The instrument is blind for this run; every verdict above is UNTRUSTWORTHY.');
  } else if (r.deletableModules.length === 0) {
    out.push('  Nothing is safe to delete on this run\'s evidence.');
  } else {
    out.push(`  SAFE TO DELETE — the data licenses removing these ${r.deletableModules.length}:`);
    for (const m of r.modules.filter((x) => r.deletableModules.includes(x.module))) {
      out.push(
        `    ${pad(m.module, 32)}${lpad(m.bytes == null ? 'size unknown' : kb(m.bytes), 12)}  ${m.verdict}`,
      );
    }
    out.push(`  total: ${kb(r.deletableBytes)} across ${r.deletableModules.length} module(s).`);
    if (r.deletableBytesUnknown.length > 0) {
      out.push(`  NOT counted (file not found on disk): ${r.deletableBytesUnknown.join(', ')}.`);
    }
  }
  if (r.gate.valid && r.cutCandidates.length > 0) {
    out.push(`  CUT CANDIDATES, NOT YET ACTIONABLE (${r.cutCandidates.length}):`);
    for (const c of r.cutCandidates) {
      out.push(
        `    ${pad(c.module, 32)}${lpad(c.bytes == null ? '?' : kb(c.bytes), 12)}  ${pad(c.verdict, 12)} needs: ${c.blockedBy ?? 'review'}`,
      );
    }
  }
  const counts: Record<string, number> = {};
  for (const m of r.modules) counts[m.verdict] = (counts[m.verdict] ?? 0) + 1;
  out.push(
    `  verdicts: ${Object.entries(counts)
      .sort()
      .map(([k, n]) => `${k}=${n}`)
      .join(' ') || 'none'}`,
  );
  if (r.sets.length > 0) {
    out.push(`  sets: ${r.sets.map((s) => `${s.setId}=${s.verdict}`).join(' ')}`);
  }
  out.push(
    `  cost: $${r.totalCostUsd.toFixed(2)} over ${r.totalCells} cells, ` +
      `${(r.totalDurationMs / 3_600_000).toFixed(1)}h of session time.`,
  );
  if (r.costUnknownCells > 0) out.push(`  ${r.costUnknownCells} cell(s) reported no cost; true total is higher.`);

  if (r.warnings.length > 0) {
    out.push('', 'MISSING / THIN CELLS (never silently excluded)');
    for (const w of r.warnings) out.push('  ' + w);
  }
  return out;
}

/** Parse a cells.jsonl body. Bad lines are reported, never skipped in silence. */
export function parseCells(body: string): { cells: Cell[]; bad: string[] } {
  const cells: Cell[] = [];
  const bad: string[] = [];
  body.split(/\r?\n/).forEach((line, i) => {
    if (line.trim().length === 0) return;
    try {
      cells.push(JSON.parse(line) as Cell);
    } catch {
      bad.push(`line ${i + 1}: unparseable JSON`);
    }
  });
  return { cells, bad };
}
