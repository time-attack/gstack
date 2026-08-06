/**
 * The unit of the ablation study: one (scenario × arm × replicate) cell.
 *
 * Why per-module ablation rather than a whole-tree A/B. The question is not
 * "does gstack help" — it is "does THIS module earn its tokens". So the arm
 * `ablate:office-hours` ships the entire skill tree with exactly one module
 * gutted. If the score does not move, that module is scaffolding the model
 * already infers, and it goes.
 *
 * Every field here is machine-derived. Nothing in this pipeline asks a model
 * to judge another model: scoring is regex-against-planted-ground-truth in
 * score.ts, so a cell cannot pass while measuring nothing. That failure mode
 * is not hypothetical — retiring seven review specialists turned zero tests
 * red, because the assertions were keyword-echo of their own prompts.
 *
 * One cell = one `claude -p` session. Cells are fully independent, so the
 * study scales horizontally to whatever the API will bear.
 */
import type { ScenarioScore } from './score';

/**
 * `full` is the control: the shipped tree, untouched.
 * `no-skill` is the floor: no gstack at all, raw model. A module that scores
 *   no better than this floor is not merely redundant, it is inert.
 * `gutted` is the negative control: every module reduced to headings. If
 *   `gutted` scores the same as `full`, the instrument itself is not
 *   resolving anything and no per-module verdict from that run is
 *   trustworthy.
 * `ablate:<module>` is the treatment, one module removed.
 */
export type Arm =
  | 'full'
  | 'no-skill'
  | 'gutted'
  | `ablate:${string}`
  | `solo:${string}`
  | `ablate-set:${string}`;

/**
 * Two flaws in naive single-module ablation, and the arms that fix them.
 *
 * FLAW 1 — pairwise redundancy. If modules A and B overlap, ablating A alone
 * shows nothing (B covers it) and ablating B alone shows nothing (A covers
 * it). Both read DEAD, and deleting both then hurts. Single-module ablation
 * is structurally blind to this.
 *   Fix: `ablate-set:<id>` removes the entire proposed DEAD set at once, as a
 *   confirmation phase. If the set ablation degrades while every member
 *   individually did not, the set holds mutual redundancy and must be
 *   bisected before anything is deleted.
 *
 * FLAW 2 — signal-to-noise by construction. `full` carries ~1,684 KB across
 * 42 modules. Removing one 11 KB module is a tiny perturbation, so a real
 * effect can hide under the variance of the other 41, producing a false DEAD.
 *   Fix: `solo:<module>` ships that module alone (plus the dispatcher
 *   skeleton it needs to be reachable) and is compared against `no-skill`.
 *   Maximum signal for the module's standalone contribution.
 *
 * Together they give a decision table single-arm ablation cannot:
 *
 *   solo>floor  ablate<full   verdict
 *   yes         yes           earns uniquely — keep
 *   yes         no            works, but redundant here — cut candidate,
 *                             only on set confirmation
 *   no          yes           interaction effect — investigate, do not cut
 *   no          no            inert — delete
 */

export interface Cell {
  runId: string;
  scenarioId: string;
  skill: string;
  arm: Arm;
  /** 0-based. Model output is stochastic; a single sample decides nothing. */
  replicate: number;

  // ── deterministic score (from score.ts, no model involved) ──
  hits: string[];
  misses: string[];
  fabrications: string[];
  recall: number;
  noReport: boolean;
  reportChars: number;

  // ── session telemetry, for cost accounting and timeout triage ──
  turns: number | null;
  costUsd: number | null;
  durationMs: number;
  /** 'success' | 'error_max_turns' | 'timeout' | 'spawn_error' */
  exitReason: string;

  /** Set when the cell failed to produce a scoreable report at all. */
  error?: string;

  /**
   * Did the session actually invoke a gstack skill?
   *
   * This is a validity field, not telemetry, and it is the most dangerous
   * failure mode in the whole study. A `full` cell where the Skill tool was
   * never called is not a measurement of gstack — it is a measurement of the
   * raw model with an unread directory on disk. Observed live: on one
   * scenario the `full` arm never invoked and scored identically to
   * `no-skill`.
   *
   * If that goes unrecorded, `full` collapses onto the floor, every ablation
   * delta goes to zero, and all 42 modules read DEAD. The study would
   * confidently recommend deleting everything, for a reason that has nothing
   * to do with any module's content.
   *
   * So: cells with `skillInvoked === false` on a skill-bearing arm are
   * excluded from means and counted separately. An arm whose invocation rate
   * is low has no verdict, it has a prompt problem.
   *
   * null = the runner could not determine it (older cells, missing transcript).
   */
  skillInvoked: boolean | null;
  /** Which skills the session invoked, for diagnosing mis-routing. */
  skillsUsed?: string[];
}

export function cellKey(c: Pick<Cell, 'scenarioId' | 'arm' | 'replicate'>): string {
  return `${c.scenarioId}|${c.arm}|${c.replicate}`;
}

export function toCell(
  base: Omit<Cell, keyof ScenarioScore | 'runId'> & { runId: string },
  score: ScenarioScore,
): Cell {
  return {
    ...base,
    hits: score.hits,
    misses: score.misses,
    fabrications: score.fabrications,
    recall: score.recall,
    noReport: score.noReport,
    reportChars: score.reportChars,
  } as Cell;
}

/** `ablate:plan/office-hours` → `plan/office-hours`; null for non-ablation arms. */
export function ablatedModule(arm: Arm): string | null {
  return arm.startsWith('ablate:') ? arm.slice('ablate:'.length) : null;
}
