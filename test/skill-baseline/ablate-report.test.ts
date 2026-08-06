/**
 * Free, deterministic tests for the ablation verdict layer. No model calls.
 *
 * Two tests carry this file. "gutted ties full" proves the instrument refuses to
 * answer when it cannot see. "mutual redundancy" proves it refuses to recommend a
 * set whose members were covering each other. Both guard the same mistake from
 * different sides: deleting working judgment because a number looked flat.
 */

import { describe, expect, test } from 'bun:test';
import type { Cell } from './cell';
import {
  analyze,
  armStats,
  bootstrapPairedDelta,
  formatReport,
  moduleBytes,
  parseCells,
  parseSetMembers,
  perScenarioScores,
  readSignal,
  DEFAULTS,
} from './ablate-report';

const EXPECTED = 10; // findings per scenario, so recall lands on 0.1 steps

/**
 * Build one cell whose hits/misses arrays actually agree with its recall —
 * score.ts's summarizeArm counts array lengths, not the recall field.
 */
function mkCell(o: {
  scenarioId: string;
  arm: string;
  replicate: number;
  recall: number;
  skill?: string;
  fabrications?: number;
  exitReason?: string;
  noReport?: boolean;
  costUsd?: number | null;
  skillInvoked?: boolean | null;
}): Cell {
  const hits = Math.round(o.recall * EXPECTED);
  return {
    runId: 'synthetic',
    scenarioId: o.scenarioId,
    skill: o.skill ?? 'review',
    arm: o.arm as Cell['arm'],
    replicate: o.replicate,
    hits: Array.from({ length: hits }, (_, i) => `e${i}`),
    misses: Array.from({ length: EXPECTED - hits }, (_, i) => `e${hits + i}`),
    fabrications: Array.from({ length: o.fabrications ?? 0 }, (_, i) => `trap${i}`),
    recall: hits / EXPECTED,
    noReport: o.noReport ?? false,
    reportChars: o.noReport ? 0 : 500,
    turns: 12,
    costUsd: o.costUsd === undefined ? 0.05 : o.costUsd,
    durationMs: 60_000,
    exitReason: o.exitReason ?? 'success',
    // Default to a healthy run: the skill was invoked. Tests that care set it.
    skillInvoked: o.skillInvoked === undefined ? true : o.skillInvoked,
  };
}

/** An arm from a per-scenario list of replicate recalls. */
function mkArm(
  arm: string,
  recalls: Record<string, number[]>,
  extra: Partial<Parameters<typeof mkCell>[0]> = {},
): Cell[] {
  return Object.entries(recalls).flatMap(([scenarioId, rs]) =>
    rs.map((recall, replicate) => mkCell({ scenarioId, arm, replicate, recall, ...extra })),
  );
}

const SCENARIOS = ['s1', 's2', 's3', 's4', 's5', 's6'];

/** Same value on every scenario/replicate. */
function flat(value: number, reps = 4, ids = SCENARIOS): Record<string, number[]> {
  return Object.fromEntries(ids.map((id) => [id, Array(reps).fill(value)]));
}

/** Slight per-scenario/per-replicate variation, so the bootstrap has something to chew. */
function jitter(base: number[], ids = SCENARIOS): Record<string, number[]> {
  return Object.fromEntries(ids.map((id, i) => [id, base.map((b, j) => clamp(b + 0.1 * (((i + j) % 3) - 1)))]));
}
const clamp = (x: number) => Math.max(0, Math.min(1, Math.round(x * 10) / 10));

const FULL_SHAPE = [0.9, 0.8, 0.9, 0.8];
const FULL_GOOD = () => mkArm('full', jitter(FULL_SHAPE));
const FLOOR = 0.2;

/**
 * Controls that clearly lose to `full`, so the validity gate passes.
 * `no-skill` never invokes a skill — that is the arm working as designed.
 */
function validControls(): Cell[] {
  return [...mkArm('gutted', flat(0.3)), ...mkArm('no-skill', flat(FLOOR), { skillInvoked: false })];
}

/** An `ablate:` arm indistinguishable from `full`: signal `flat`. */
const ablateFlat = (module: string) => mkArm(`ablate:${module}`, jitter(FULL_SHAPE));
/** An `ablate:` arm far below `full`: signal `moves`. */
const ablateMoves = (module: string) => mkArm(`ablate:${module}`, flat(0.3));
/** A `solo:` arm indistinguishable from `no-skill`: signal `flat`. */
const soloFlat = (module: string) => mkArm(`solo:${module}`, flat(FLOOR));
/** A `solo:` arm far above `no-skill`: signal `moves`. */
const soloMoves = (module: string) => mkArm(`solo:${module}`, flat(0.7));

describe('validity gate', () => {
  test('a run where gutted ties full is INVALID and every module verdict is UNTRUSTWORTHY', () => {
    // gutted and no-skill score exactly what full scores: the scenarios cannot
    // see the module bodies at all.
    const cells = [
      ...mkArm('full', jitter(FULL_SHAPE)),
      ...mkArm('gutted', jitter(FULL_SHAPE)),
      ...mkArm('no-skill', jitter(FULL_SHAPE)),
      // A module whose ablation looks devastating. It must STILL not be believed.
      ...ablateMoves('plan/office-hours'),
      ...soloMoves('plan/office-hours'),
    ];
    const r = analyze(cells, { root: '/nonexistent' });

    expect(r.gate.valid).toBe(false);
    expect(r.modules).toHaveLength(1);
    expect(r.modules[0].verdict).toBe('UNTRUSTWORTHY');
    expect(r.deletableModules).toEqual([]);
    expect(r.deletableBytes).toBe(0);
    expect(r.cutCandidates).toEqual([]);

    const text = formatReport(r).join('\n');
    expect(text).toContain('INVALID RUN');
    expect(text).toContain('THIS INSTRUMENT IS BLIND');
    expect(text).toContain('Do NOT cite this run');
    expect(text).toContain('UNTRUSTWORTHY');
    // The banner precedes the per-module table: a reader cannot miss it.
    expect(text.indexOf('INVALID RUN')).toBeLessThan(text.indexOf('PER-MODULE VERDICT'));
    expect(text).toContain('None. The instrument is blind');
  });

  test('UNTRUSTWORTHY dominates set verdicts too', () => {
    const r = analyze(
      [
        ...mkArm('full', jitter(FULL_SHAPE)),
        ...mkArm('gutted', jitter(FULL_SHAPE)),
        ...mkArm('no-skill', jitter(FULL_SHAPE)),
        ...mkArm('ablate-set:plan/a+plan/b', jitter(FULL_SHAPE)),
      ],
      { root: '/nonexistent' },
    );
    expect(r.gate.valid).toBe(false);
    expect(r.sets[0].verdict).toBe('UNTRUSTWORTHY');
    expect(r.deletableModules).toEqual([]);
  });

  test('no-skill tying full also invalidates, even when gutted separates', () => {
    const r = analyze(
      [
        ...FULL_GOOD(),
        ...mkArm('gutted', flat(0.3)),
        ...mkArm('no-skill', jitter(FULL_SHAPE)),
        ...ablateFlat('review/codex'),
      ],
      { root: '/nonexistent' },
    );
    expect(r.gate.valid).toBe(false);
    expect(r.modules[0].verdict).toBe('UNTRUSTWORTHY');
    expect(formatReport(r).join('\n')).toContain('full vs no-skill');
  });

  test('a missing negative control is not a pass', () => {
    const r = analyze([...FULL_GOOD(), ...mkArm('gutted', flat(0.3))], { root: '/nonexistent' });
    expect(r.gate.valid).toBe(false);
    expect(r.gate.missingArms).toContain('no-skill');
    expect(formatReport(r).join('\n')).toContain('Missing arms');
  });

  test('both controls losing clearly makes the run valid', () => {
    const r = analyze([...FULL_GOOD(), ...validControls()], { root: '/nonexistent' });
    expect(r.gate.valid).toBe(true);
    expect(r.gate.pairs.map((p) => p.separates)).toEqual([true, true]);
    expect(formatReport(r).join('\n')).toContain('INSTRUMENT VALID');
  });
});

describe('skill invocation is a validity field, not telemetry', () => {
  /** `full` where replicates 2 and 3 never called the Skill tool: 50% invocation. */
  const halfInvokedFull = () =>
    Object.entries(jitter(FULL_SHAPE)).flatMap(([scenarioId, rs]) =>
      rs.map((recall, replicate) =>
        mkCell({ scenarioId, arm: 'full', replicate, recall, skillInvoked: replicate < 2 }),
      ),
    );

  test('a full arm below the invocation floor fails the gate EVEN WHEN it separates from both controls', () => {
    const r = analyze([...halfInvokedFull(), ...validControls(), ...ablateFlat('plan/a'), ...soloFlat('plan/a')], {
      root: '/nonexistent',
    });

    // The separation itself is real and still reported...
    expect(r.gate.pairs.map((p) => p.separates)).toEqual([true, true]);
    // ...and the run is invalid anyway, because it was not the skill separating.
    expect(r.gate.valid).toBe(false);
    expect(r.gate.invocationFailure).toContain('50%');
    expect(r.gate.full.invocationRate).toBeCloseTo(0.5, 6);
    expect(r.gate.full.notInvokedCells).toBe(12);
    expect(r.gate.full.cellsTotal).toBe(24);
    expect(r.gate.full.cells).toBe(12); // means computed over the invoking half only

    expect(r.modules.every((m) => m.verdict === 'UNTRUSTWORTHY')).toBe(true);
    expect(r.deletableModules).toEqual([]);
    expect(r.cutCandidates).toEqual([]);

    const text = formatReport(r).join('\n');
    expect(text).toContain('THE SKILL DID NOT RUN');
    expect(text).toContain('`full` IS `no-skill`');
    expect(text).toContain('Do NOT cite this run');
    expect(text.indexOf('THE SKILL DID NOT RUN')).toBeLessThan(text.indexOf('PER-MODULE VERDICT'));
    // The excluded cells are named, not quietly dropped.
    expect(text).toContain('never invoked a skill');
  });

  test('the SAME numbers with the skill actually invoked are a valid run: only the flag differs', () => {
    const cells = (invoked: boolean) => [
      ...mkArm('full', jitter(FULL_SHAPE), { skillInvoked: invoked }),
      ...validControls(),
      ...ablateFlat('plan/a'),
      ...soloFlat('plan/a'),
    ];
    // Identical recalls in both runs. `full` beats both controls either way.
    const notInvoked = analyze(cells(false), { root: '/nonexistent' });
    const invoked = analyze(cells(true), { root: '/nonexistent' });

    expect(invoked.gate.valid).toBe(true);
    expect(invoked.modules[0].verdict).toBe('INERT');

    expect(notInvoked.gate.valid).toBe(false);
    expect(notInvoked.gate.invocationFailure).toContain('0%');
    expect(notInvoked.gate.full.cells).toBe(0);
    expect(notInvoked.modules[0].verdict).toBe('UNTRUSTWORTHY');
    expect(notInvoked.deletableModules).toEqual([]);
  });

  test('an ablation arm below the invocation floor is INSUFFICIENT: a prompt problem, not a verdict', () => {
    // `full` is healthy, so the gate passes and the failure is scoped to one arm.
    const partlyInvoked = Object.entries(flat(0.85)).flatMap(([scenarioId, rs]) =>
      rs.map((recall, replicate) =>
        mkCell({ scenarioId, arm: 'ablate:plan/learn', replicate, recall, skillInvoked: replicate === 0 }),
      ),
    );
    const r = analyze([...FULL_GOOD(), ...validControls(), ...partlyInvoked, ...soloFlat('plan/learn')], {
      root: '/nonexistent',
    });
    expect(r.gate.valid).toBe(true);
    const m = r.modules.find((x) => x.module === 'plan/learn')!;
    expect(m.verdict).toBe('INSUFFICIENT');
    expect(m.reasons.join(' ')).toContain('invocation rate 25%');
    expect(m.reasons.join(' ')).toContain('prompt problem, not a verdict');
    expect(m.ablate!.treat.notInvokedCells).toBe(18);
    expect(r.deletableModules).toEqual([]);
  });

  test('no-skill cells at 0% invocation trip nothing — that arm is meant not to invoke', () => {
    const r = analyze(
      [...FULL_GOOD(), ...validControls(), ...ablateFlat('plan/a'), ...soloFlat('plan/a')],
      { root: '/nonexistent' },
    );
    expect(r.gate.valid).toBe(true);
    expect(r.gate.invocationFailure).toBeNull();
    expect(r.modules[0].verdict).toBe('INERT');
    const floorArm = r.arms.find((a) => a.arm === 'no-skill')!;
    expect(floorArm.cells).toBe(24); // nothing excluded
    expect(floorArm.cellsTotal).toBe(24);
    expect(floorArm.notInvokedCells).toBe(0);
    expect(floorArm.invocationRate).toBeNull(); // not applicable, not zero
    expect(r.warnings.some((w) => w.includes('no-skill') && w.includes('invoke'))).toBe(false);
    expect(formatReport(r).join('\n')).not.toContain('THE SKILL DID NOT RUN');
  });

  test('null invocation is unknown: kept in the means, excluded from the rate, and surfaced', () => {
    // Legacy cells written before the runner populated the field.
    const legacy = Object.entries(jitter(FULL_SHAPE)).flatMap(([scenarioId, rs]) =>
      rs.map((recall, replicate) =>
        mkCell({ scenarioId, arm: 'full', replicate, recall, skillInvoked: replicate < 2 ? true : null }),
      ),
    );
    const r = analyze([...legacy, ...validControls(), ...ablateFlat('plan/a'), ...soloFlat('plan/a')], {
      root: '/nonexistent',
    });
    const full = r.arms.find((a) => a.arm === 'full')!;
    expect(full.invocationUnknownCells).toBe(12);
    expect(full.notInvokedCells).toBe(0); // unknown is NOT counted as a failure
    expect(full.cells).toBe(24); // and NOT excluded from the means
    expect(full.invocationRate).toBe(1); // rate covers the 12 known cells only
    // The run stays usable, but the reader is told the rate is partial.
    expect(r.gate.valid).toBe(true);
    expect(r.warnings.some((w) => w.includes('unknown invocation status'))).toBe(true);
    const text = formatReport(r).join('\n');
    expect(text).toContain('12 cell(s) unknown');
    expect(text).toContain('100%+12?'); // census: rate, plus the unknown count
  });

  test('an all-legacy run does not read as 0% invocation and does not fail the gate', () => {
    const r = analyze(
      [
        ...mkArm('full', jitter(FULL_SHAPE), { skillInvoked: null }),
        ...mkArm('gutted', flat(0.3), { skillInvoked: null }),
        ...mkArm('no-skill', flat(FLOOR), { skillInvoked: null }),
        ...mkArm('ablate:plan/a', jitter(FULL_SHAPE), { skillInvoked: null }),
        ...mkArm('solo:plan/a', flat(FLOOR), { skillInvoked: null }),
      ],
      { root: '/nonexistent' },
    );
    expect(r.gate.valid).toBe(true);
    expect(r.gate.invocationFailure).toBeNull();
    expect(r.gate.full.invocationRate).toBeNull();
    expect(r.modules[0].verdict).toBe('INERT');
    expect(r.warnings.some((w) => w.includes('unknown invocation status'))).toBe(true);
  });
});

describe('the 2x2: solo x ablate', () => {
  const twoByTwo = (module: string, solo: Cell[], ablate: Cell[]) =>
    analyze([...FULL_GOOD(), ...validControls(), ...solo, ...ablate], { root: '/nonexistent' }).modules.find(
      (m) => m.module === module,
    )!;

  test('solo better AND ablate worse -> EARNS uniquely', () => {
    const m = twoByTwo('plan/office-hours', soloMoves('plan/office-hours'), ablateMoves('plan/office-hours'));
    expect(m.verdict).toBe('EARNS');
    expect(m.solo!.signal).toBe('moves');
    expect(m.ablate!.signal).toBe('moves');
    expect(m.reasons.join(' ')).toContain('earns uniquely');
    expect(m.blockedBy).toBeNull();
  });

  test('solo better AND ablate same -> REDUNDANT, a cut candidate needing set confirmation', () => {
    const r = analyze(
      [...FULL_GOOD(), ...validControls(), ...soloMoves('plan/learn'), ...ablateFlat('plan/learn')],
      { root: '/nonexistent' },
    );
    const m = r.modules.find((x) => x.module === 'plan/learn')!;
    expect(m.verdict).toBe('REDUNDANT');
    expect(m.solo!.signal).toBe('moves');
    expect(m.ablate!.signal).toBe('flat');
    expect(m.reasons.join(' ')).toContain('a sibling covers it here');
    // Never recommended on single-arm evidence.
    expect(r.deletableModules).toEqual([]);
    expect(r.cutCandidates.map((c) => c.module)).toEqual(['plan/learn']);
    expect(r.cutCandidates[0].blockedBy).toContain('ablate-set:');
    const text = formatReport(r).join('\n');
    expect(text).toContain('CUT CANDIDATES, NOT YET ACTIONABLE');
    expect(text).not.toContain('SAFE TO DELETE');
  });

  test('solo same AND ablate worse -> INTERACTION, investigate not cut', () => {
    const r = analyze(
      [...FULL_GOOD(), ...validControls(), ...soloFlat('review/review'), ...ablateMoves('review/review')],
      { root: '/nonexistent' },
    );
    const m = r.modules.find((x) => x.module === 'review/review')!;
    expect(m.verdict).toBe('INTERACTION');
    expect(m.reasons.join(' ')).toContain('interaction effect');
    expect(r.deletableModules).toEqual([]);
    expect(r.cutCandidates).toEqual([]); // INTERACTION is not a cut candidate at all
  });

  test('solo same AND ablate same -> INERT, safe to delete', () => {
    const r = analyze(
      [...FULL_GOOD(), ...validControls(), ...soloFlat('plan/context-save'), ...ablateFlat('plan/context-save')],
      { root: '/nonexistent' },
    );
    const m = r.modules.find((x) => x.module === 'plan/context-save')!;
    expect(m.verdict).toBe('INERT');
    expect(m.solo!.signal).toBe('flat');
    expect(m.ablate!.signal).toBe('flat');
    expect(r.deletableModules).toEqual(['plan/context-save']);
    expect(formatReport(r).join('\n')).toContain('SAFE TO DELETE');
  });

  test('INSUFFICIENT dominates the 2x2 when either axis is unclear', () => {
    // ablate axis is flat, but solo swings wildly: no read on the standalone axis.
    // Mean lands exactly on the 0.2 floor, but half the scenarios sit at 0 and
    // half average 0.4, so the CI straddles zero AND admits a 10-point rise.
    const wildSolo = mkArm('solo:qa/browse', {
      s1: [0, 0, 0],
      s2: [0.6, 0, 0.6],
      s3: [0, 0, 0],
      s4: [0.6, 0.6, 0],
      s5: [0, 0, 0],
      s6: [0, 0.6, 0.6],
    });
    const m = analyze([...FULL_GOOD(), ...validControls(), ...wildSolo, ...ablateFlat('qa/browse')], {
      root: '/nonexistent',
    }).modules.find((x) => x.module === 'qa/browse')!;
    expect(m.verdict).toBe('INSUFFICIENT');
    expect(m.solo!.signal).toBe('unclear');
    expect(m.ablate!.signal).toBe('flat');
  });

  test('a solo arm with no ablate arm cannot judge redundancy', () => {
    const m = analyze([...FULL_GOOD(), ...validControls(), ...soloMoves('plan/spec')], {
      root: '/nonexistent',
    }).modules.find((x) => x.module === 'plan/spec')!;
    expect(m.verdict).toBe('INSUFFICIENT');
    expect(m.reasons.join(' ')).toContain('redundancy against siblings is unmeasured');
    expect(m.blockedBy).toContain('ablate:');
  });
});

describe('set confirmation', () => {
  /** Two modules that each read INERT alone. */
  const pairIndividuallyFlat = () => [
    ...soloFlat('plan/a'),
    ...ablateFlat('plan/a'),
    ...soloFlat('plan/b'),
    ...ablateFlat('plan/b'),
  ];

  test('MUTUAL REDUNDANCY: the set degrades though every member read flat alone — refuse and bisect', () => {
    const r = analyze(
      [
        ...FULL_GOOD(),
        ...validControls(),
        ...pairIndividuallyFlat(),
        // Removing BOTH craters the score. Each single ablation was masked by the other.
        ...mkArm('ablate-set:plan/a+plan/b', flat(0.3)),
      ],
      { root: '/nonexistent' },
    );

    // Individually they still read INERT — that reading is not retroactively falsified.
    expect(r.modules.find((m) => m.module === 'plan/a')!.verdict).toBe('INERT');
    expect(r.modules.find((m) => m.module === 'plan/b')!.verdict).toBe('INERT');

    expect(r.sets).toHaveLength(1);
    expect(r.sets[0].verdict).toBe('MUTUAL_REDUNDANCY');
    expect(r.sets[0].members).toEqual(['plan/a', 'plan/b']);
    expect(r.sets[0].memberSource).toBe('arm-id');
    expect(r.mutualRedundancy).toHaveLength(1);

    // THE POINT: nothing is recommended, even though both members are INERT.
    expect(r.deletableModules).toEqual([]);
    expect(r.deletableBytes).toBe(0);
    expect(r.cutCandidates.map((c) => c.module).sort()).toEqual(['plan/a', 'plan/b']);
    for (const c of r.cutCandidates) expect(c.blockedBy).toContain('bisecting');

    const text = formatReport(r).join('\n');
    expect(text).toContain('MUTUAL REDUNDANCY DETECTED');
    expect(text).toContain('REFUSING TO RECOMMEND THIS SET');
    expect(text).toContain('DO NOT delete this set');
    expect(text).toContain('Bisect it');
    expect(text).toContain('they cover each other');
    // Prominent, not a footnote: above the arm census and the module table.
    expect(text.indexOf('MUTUAL REDUNDANCY DETECTED')).toBeLessThan(text.indexOf('ARMS'));
    expect(text.indexOf('MUTUAL REDUNDANCY DETECTED')).toBeLessThan(text.indexOf('PER-MODULE VERDICT'));
    expect(text).not.toContain('SAFE TO DELETE');
  });

  test('CONFIRMED set promotes its REDUNDANT members to deletable', () => {
    const r = analyze(
      [
        ...FULL_GOOD(),
        ...validControls(),
        // Both work standalone but neither's removal costs anything: REDUNDANT.
        ...soloMoves('plan/a'),
        ...ablateFlat('plan/a'),
        ...soloMoves('plan/b'),
        ...ablateFlat('plan/b'),
        // Removing both together still costs nothing.
        ...mkArm('ablate-set:plan/a+plan/b', jitter(FULL_SHAPE)),
      ],
      { bytesOf: () => 10_240, root: '/nonexistent' },
    );
    expect(r.modules.map((m) => m.verdict)).toEqual(['REDUNDANT', 'REDUNDANT']);
    expect(r.sets[0].verdict).toBe('CONFIRMED');
    expect(r.deletableModules.sort()).toEqual(['plan/a', 'plan/b']);
    expect(r.deletableBytes).toBe(20_480);
    expect(r.cutCandidates).toEqual([]);
    const text = formatReport(r).join('\n');
    expect(text).toContain('SAFE TO DELETE');
    expect(text).toContain('SET CONFIRMATION');
    expect(text).not.toContain('MUTUAL REDUNDANCY DETECTED');
  });

  test('a set that degrades because it contains a known EARNS module is DEGRADES, not mutual redundancy', () => {
    const r = analyze(
      [
        ...FULL_GOOD(),
        ...validControls(),
        ...soloMoves('plan/a'),
        ...ablateMoves('plan/a'), // EARNS: should never have been in the set
        ...soloFlat('plan/b'),
        ...ablateFlat('plan/b'),
        ...mkArm('ablate-set:plan/a+plan/b', flat(0.3)),
      ],
      { root: '/nonexistent' },
    );
    expect(r.sets[0].verdict).toBe('DEGRADES');
    expect(r.mutualRedundancy).toEqual([]);
    expect(r.sets[0].reasons.join(' ')).toContain('did not read flat alone');
    // plan/b is INERT but vetoed by the non-confirmed set it belongs to.
    expect(r.modules.find((m) => m.module === 'plan/b')!.verdict).toBe('INERT');
    expect(r.deletableModules).toEqual([]);
  });

  test('a set id that does not encode members falls back to the run cut candidates, and says so', () => {
    const r = analyze(
      [...FULL_GOOD(), ...validControls(), ...pairIndividuallyFlat(), ...mkArm('ablate-set:round-1', flat(0.3))],
      { root: '/nonexistent' },
    );
    expect(r.sets[0].memberSource).toBe('presumed: run cut candidates');
    expect(r.sets[0].members.sort()).toEqual(['plan/a', 'plan/b']);
    expect(r.sets[0].verdict).toBe('MUTUAL_REDUNDANCY');
    expect(r.warnings.some((w) => w.includes('membership not encoded'))).toBe(true);
  });

  test('parseSetMembers only accepts ids that really encode module paths', () => {
    expect(parseSetMembers('plan/a+plan/b')).toEqual(['plan/a', 'plan/b']);
    expect(parseSetMembers('plan/a,plan/b,qa/c')).toEqual(['plan/a', 'plan/b', 'qa/c']);
    expect(parseSetMembers('round-1')).toBeNull();
    expect(parseSetMembers('plan/a')).toBeNull(); // a single member is not a set id
    expect(parseSetMembers('a+b')).toBeNull(); // no dispatcher prefix, not module paths
  });
});

describe('ablate-only runs keep the original single-arm verdicts', () => {
  const ablateOnly = (arms: Cell[]) => analyze([...FULL_GOOD(), ...validControls(), ...arms], { root: '/nonexistent' });

  test('a module whose ablation clearly degrades recall EARNS its tokens', () => {
    const m = ablateOnly(ablateMoves('plan/office-hours')).modules[0];
    expect(m.module).toBe('plan/office-hours');
    expect(m.verdict).toBe('EARNS');
    expect(m.solo).toBeNull();
    expect(m.ablate!.recall.delta).toBeLessThan(-0.4);
    expect(m.ablate!.recall.hi).toBeLessThan(0);
  });

  test('a module whose ablation adds fabrications EARNS even at flat recall', () => {
    const m = ablateOnly(mkArm('ablate:review/cso', jitter(FULL_SHAPE), { fabrications: 3 })).modules.find(
      (x) => x.module === 'review/cso',
    )!;
    expect(m.verdict).toBe('EARNS');
    expect(m.ablate!.fabrications.lo).toBeGreaterThan(0);
    expect(m.reasons.join(' ')).toContain('fabrications');
  });

  test('a flat ablation is DEAD, a cut candidate but never a recommendation', () => {
    const r = ablateOnly(ablateFlat('plan/context-save'));
    const m = r.modules.find((x) => x.module === 'plan/context-save')!;
    expect(m.verdict).toBe('DEAD');
    expect(Math.abs(m.ablate!.recall.delta)).toBeLessThan(0.02);
    expect(m.ablate!.recall.lo).toBeGreaterThan(-DEFAULTS.minEffect);
    expect(m.reasons.join(' ')).toContain('single-arm evidence only');
    // Flaw 2: without a solo arm, a flat ablation cannot license a deletion.
    expect(r.deletableModules).toEqual([]);
    expect(r.cutCandidates).toEqual([
      { module: 'plan/context-save', verdict: 'DEAD', bytes: null, blockedBy: m.blockedBy },
    ]);
    expect(m.blockedBy).toContain('solo:');
    expect(r.warnings.some((w) => w.includes('standalone contribution unmeasured'))).toBe(true);
  });

  test('two replicates is INSUFFICIENT, never DEAD', () => {
    const m = ablateOnly(
      mkArm('ablate:plan/learn', Object.fromEntries(SCENARIOS.map((id, i) => [id, i % 2 ? [1, 0.6] : [0.6, 1]]))),
    ).modules.find((x) => x.module === 'plan/learn')!;
    expect(m.verdict).toBe('INSUFFICIENT');
    expect(m.reasons.join(' ')).toContain('replicate');
  });

  test('enough replicates but a CI too wide to rule out a real drop is INSUFFICIENT, not DEAD', () => {
    // 3 replicates, mean near full's, but recall swings 0.2 -> 1. The point
    // estimate says "no effect"; the CI says "we cannot tell". Rounding this to
    // DEAD is the mistake this whole layer exists to avoid.
    const r = ablateOnly(
      mkArm('ablate:qa/browse', {
        s1: [1, 0.4, 1],
        s2: [0.3, 1, 1],
        s3: [1, 1, 0.2],
        s4: [0.2, 1, 1],
        s5: [1, 0.3, 1],
        s6: [1, 1, 0.3],
      }),
    );
    const m = r.modules.find((x) => x.module === 'qa/browse')!;
    expect(m.verdict).toBe('INSUFFICIENT');
    expect(m.ablate!.recall.lo).toBeLessThan(-DEFAULTS.minEffect);
    expect(m.reasons.join(' ')).toContain('UNCLEAR');
    expect(r.deletableModules).toEqual([]);
  });

  test('an arm that mostly timed out has a budget problem, not a verdict', () => {
    const r = ablateOnly(mkArm('ablate:ship/canary', flat(0), { exitReason: 'timeout', noReport: true }));
    const m = r.modules.find((x) => x.module === 'ship/canary')!;
    expect(m.verdict).toBe('INSUFFICIENT');
    expect(m.reasons.join(' ')).toContain('budget problem');
    expect(m.ablate!.treat.exitReasons.timeout).toBe(24);
    expect(formatReport(r).join('\n')).toContain('timeout=24');
  });

  test('a hard degradation is not laundered into DEAD by a mixed exit breakdown', () => {
    // One of four replicates hit the turn limit (below maxUnhealthy), recall clearly down.
    const cells = SCENARIOS.flatMap((id) => [
      mkCell({ scenarioId: id, arm: 'ablate:review/review', replicate: 0, recall: 0.2 }),
      mkCell({ scenarioId: id, arm: 'ablate:review/review', replicate: 1, recall: 0.3 }),
      mkCell({ scenarioId: id, arm: 'ablate:review/review', replicate: 2, recall: 0.2 }),
      mkCell({
        scenarioId: id,
        arm: 'ablate:review/review',
        replicate: 3,
        recall: 0.3,
        exitReason: 'error_max_turns',
      }),
    ]);
    const m = ablateOnly(cells).modules.find((x) => x.module === 'review/review')!;
    expect(m.verdict).toBe('EARNS');
    expect(m.ablate!.treat.unhealthyRate).toBeCloseTo(0.25, 5);
  });
});

describe('cell accounting', () => {
  test('scenarios missing from an arm are reported, never silently dropped', () => {
    // `full` scenarios here are all skill=review (mkCell's default), so the
    // ablated module must be a review module for the coverage check to apply.
    const partial = mkArm('ablate:review/health', flat(0.85, 4, ['s1', 's2', 'sX']));
    const r = analyze([...FULL_GOOD(), ...validControls(), ...partial], { root: '/nonexistent' });
    const m = r.modules.find((x) => x.module === 'review/health')!;
    expect(m.ablate!.sharedScenarios).toEqual(['s1', 's2']);
    expect(m.ablate!.missingFromControl).toEqual(['sX']);
    // full covered s3..s6 for this dispatcher's scenarios but the ablation skipped them.
    expect(m.notRunAblated).toEqual(['s3', 's4', 's5', 's6']);
    expect(m.verdict).toBe('INSUFFICIENT');
    const text = formatReport(r).join('\n');
    expect(text).toContain('MISSING / THIN CELLS');
    expect(text).toContain('no `full` cells for sX');
    expect(text).toContain('ablation skipped 4 scenario(s)');
  });

  test('uneven replicates surface as a warning', () => {
    const uneven = [...mkArm('full', flat(0.9, 4, ['s1', 's2'])), ...mkArm('full', flat(0.9, 2, ['s3']))];
    const r = analyze([...uneven, ...validControls()], { root: '/nonexistent' });
    expect(r.warnings.some((w) => w.includes('uneven replicates'))).toBe(true);
  });

  test('cost, duration and unknown-cost cells all land in the totals', () => {
    const cells = [
      ...FULL_GOOD(),
      ...validControls(),
      mkCell({ scenarioId: 's1', arm: 'full', replicate: 9, recall: 0.9, costUsd: null }),
    ];
    const r = analyze(cells, { root: '/nonexistent' });
    expect(r.totalCells).toBe(cells.length);
    expect(r.totalCostUsd).toBeCloseTo(0.05 * (cells.length - 1), 6);
    expect(r.costUnknownCells).toBe(1);
    expect(formatReport(r).join('\n')).toContain('reported no cost');
  });

  test('the arm census lists every arm with its cell count', () => {
    const r = analyze([...FULL_GOOD(), ...validControls(), ...soloFlat('plan/a')], { root: '/nonexistent' });
    expect(r.arms.map((a) => a.arm)).toEqual(['full', 'gutted', 'no-skill', 'solo:plan/a']);
    expect(r.arms.every((a) => a.cells === 24)).toBe(true);
    const text = formatReport(r).join('\n');
    expect(text).toContain('ARMS');
    expect(text).toContain('success=24');
  });
});

describe('primitives', () => {
  test('readSignal never rounds unclear down to flat', () => {
    const i = (lo: number, hi: number) => ({ delta: (lo + hi) / 2, lo, hi, width: hi - lo, iterations: 100 });
    // direction -1: a drop is the effect we care about.
    expect(readSignal(i(-0.3, -0.1), -1, 0.1)).toBe('moves');
    expect(readSignal(i(-0.05, 0.05), -1, 0.1)).toBe('flat');
    expect(readSignal(i(-0.4, 0.2), -1, 0.1)).toBe('unclear');
    // direction +1: a rise is.
    expect(readSignal(i(0.1, 0.3), 1, 0.1)).toBe('moves');
    expect(readSignal(i(-0.05, 0.05), 1, 0.1)).toBe('flat');
    expect(readSignal(i(-0.2, 0.4), 1, 0.1)).toBe('unclear');
    // no CI at all is never a reading.
    expect(readSignal({ delta: 0, lo: -1, hi: 1, width: 2, iterations: 0 }, -1, 0.1)).toBe('unclear');
  });

  test('perScenarioScores pools replicates so score.ts helpers apply unchanged', () => {
    const scores = perScenarioScores(mkArm('full', flat(0.8, 3, ['s1'])));
    expect(scores).toHaveLength(1);
    expect(scores[0].hits).toHaveLength(24); // 3 replicates x 8 hits
    expect(scores[0].misses).toHaveLength(6);
    expect(scores[0].recall).toBeCloseTo(0.8, 6);
  });

  test('bootstrap CI brackets a known delta and is reproducible', () => {
    const treat = new Map(SCENARIOS.map((s) => [s, [0.4, 0.5, 0.4]]));
    const control = new Map(SCENARIOS.map((s) => [s, [0.9, 0.8, 0.9]]));
    const o = { iterations: 500, seed: 7, level: 0.95 };
    const a = bootstrapPairedDelta(treat, control, SCENARIOS, o);
    const b = bootstrapPairedDelta(treat, control, SCENARIOS, o);
    expect(a).toEqual(b);
    expect(a.delta).toBeCloseTo(0.4333333 - 0.8666667, 5); // mean(0.4,0.5,0.4) - mean(0.9,0.8,0.9)
    expect(a.lo).toBeLessThanOrEqual(a.delta);
    expect(a.hi).toBeGreaterThanOrEqual(a.delta);
    expect(a.hi).toBeLessThan(0);
  });

  test('no shared scenario yields the widest possible interval, not a confident zero', () => {
    const i = bootstrapPairedDelta(new Map(), new Map(), [], { iterations: 100, seed: 1, level: 0.95 });
    expect(i.iterations).toBe(0);
    expect(i.lo).toBe(-1);
    expect(i.hi).toBe(1);
  });

  test('armStats reports zeroed stats for an empty arm rather than throwing', () => {
    const a = armStats('ablate:x/y', []);
    expect(a.cells).toBe(0);
    expect(a.replicatesMin).toBe(0);
    expect(a.meanRecall).toBe(0);
  });

  test('module byte weight resolves against the real skills/ tree', () => {
    expect(moduleBytes('plan/office-hours')).toBeGreaterThan(40_000);
    expect(moduleBytes('review/health')).toBeGreaterThan(1_000);
    expect(moduleBytes('plan/does-not-exist')).toBeNull();
  });

  test('deletable byte totals come from real file sizes and unknowns are not counted as free', () => {
    const r = analyze([
      ...FULL_GOOD(),
      ...validControls(),
      ...soloFlat('plan/context-save'),
      ...ablateFlat('plan/context-save'),
      ...soloFlat('plan/ghost-module'),
      ...ablateFlat('plan/ghost-module'),
      // real root: byte weights come off disk
    ]);
    expect(r.deletableModules.sort()).toEqual(['plan/context-save', 'plan/ghost-module']);
    expect(r.deletableBytes).toBe(moduleBytes('plan/context-save')!);
    expect(r.deletableBytesUnknown).toEqual(['plan/ghost-module']);
    const text = formatReport(r).join('\n');
    expect(text).toContain('NOT counted (file not found on disk)');
    expect(text).toMatch(/total: \d+\.\d KB across 2 module/);
  });

  test('parseCells reports bad lines instead of skipping them quietly', () => {
    const good = JSON.stringify(mkCell({ scenarioId: 's1', arm: 'full', replicate: 0, recall: 0.5 }));
    const { cells, bad } = parseCells(`${good}\n\nnot json\n${good}\n`);
    expect(cells).toHaveLength(2);
    expect(bad).toEqual(['line 3: unparseable JSON']);
  });
});
