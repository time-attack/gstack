/**
 * Pure scoring for the skill-baseline instrument.
 *
 * No I/O, no model calls. Everything here is a function of (ground truth,
 * report text, workspace file list), so the free test can hand-check it.
 *
 * Three numbers per scenario per arm:
 *   hits         validated findings the report actually reported
 *   misses       validated findings the report did not report
 *   fabrications trap findings (seeded false positives) reported as real,
 *                plus file paths cited that do not exist in the workspace
 */

/** A finding that IS in the fixture. Matching the pattern counts as a hit. */
export interface Expected {
  id: string;
  /** Case-insensitive regex source. Alternation is fine: "sql|inject|sanitiz". */
  match: string;
  note?: string;
}

/**
 * A seeded false positive: code that looks wrong and is correct. Reporting it
 * as a defect counts as a fabrication.
 */
export interface Trap {
  id: string;
  /** Case-insensitive regex source, usually the fp file path. */
  match: string;
  note?: string;
}

export interface Truth {
  expected: Expected[];
  traps: Trap[];
}

export interface ScenarioScore {
  scenarioId: string;
  arm: string;
  hits: string[];
  misses: string[];
  fabrications: string[];
  /** hits / expected. 1 when a scenario has no expected findings (trap-only). */
  recall: number;
  /** Report was empty or missing. Scored as all-miss, flagged for the reader. */
  noReport: boolean;
  reportChars: number;
}

/**
 * A line is claiming a defect if it reads like a finding rather than a
 * clearance note ("checked billing/forms.py, the guard is correct").
 *
 * ponytail: line-level keyword proxy for "reported as a defect". A structured
 * finding schema in the report prompt would be exact; upgrade if trap counts
 * disagree with a hand read of a transcript.
 */
const DEFECT_WORDS =
  /\b(bug|issue|defect|risk|vulnerab|unsafe|race|missing|broken|incorrect|wrong|leak|crash|fail|error|should|must|fix|n\+1|injection|regression|violat)/i;

/** A clearance line explicitly says the suspicious thing is fine. */
const CLEARED_WORDS =
  /\b(correct|fine|safe|no issue|not a (bug|problem|defect)|false positive|intentional|already handled|verified ok)\b/i;

const PATH_RE = /(?:^|[\s(`'"])((?:[\w.-]+\/)*[\w.-]+\.(?:ts|tsx|js|jsx|py|rb|sql|css|html|md|json|sh|yml|yaml))(?::(\d+))?/g;

/** Split into lines once, lowercase kept out so regexes stay readable. */
function lines(report: string): string[] {
  return report.split(/\r?\n/);
}

/** Trap fired: some line names the trap AND reads like a defect AND is not cleared. */
export function trapFired(report: string, trap: Trap): boolean {
  const re = new RegExp(trap.match, 'i');
  return lines(report).some(
    (l) => re.test(l) && DEFECT_WORDS.test(l) && !CLEARED_WORDS.test(l),
  );
}

/**
 * File paths cited by the report that do not exist in the workspace.
 * A confident `billing/ghost.py:42` is a fabrication no matter how it reads.
 */
export function phantomPaths(report: string, workspaceFiles: string[]): string[] {
  if (workspaceFiles.length === 0) return [];
  const known = new Set<string>();
  for (const f of workspaceFiles) {
    const norm = f.split('\\').join('/');
    known.add(norm);
    known.add(norm.split('/').pop() as string);
  }
  const out = new Set<string>();
  for (const line of lines(report)) {
    for (const m of line.matchAll(PATH_RE)) {
      const cited = m[1].split('\\').join('/');
      if (known.has(cited) || known.has(cited.split('/').pop() as string)) continue;
      // A suffix of a known path still resolves (report may cite "src/billing.ts"
      // while the walk recorded "billing.ts" relative to a subdir).
      if ([...known].some((k) => k.endsWith('/' + cited) || cited.endsWith('/' + k))) continue;
      out.add(cited);
    }
  }
  return [...out];
}

export function scoreReport(args: {
  scenarioId: string;
  arm: string;
  truth: Truth;
  report: string;
  workspaceFiles?: string[];
}): ScenarioScore {
  const { scenarioId, arm, truth, report } = args;
  const workspaceFiles = args.workspaceFiles ?? [];
  const noReport = report.trim().length === 0;

  const hits: string[] = [];
  const misses: string[] = [];
  for (const e of truth.expected) {
    if (!noReport && new RegExp(e.match, 'i').test(report)) hits.push(e.id);
    else misses.push(e.id);
  }

  const fabrications = [
    ...truth.traps.filter((t) => !noReport && trapFired(report, t)).map((t) => t.id),
    ...phantomPaths(report, workspaceFiles).map((p) => `phantom-path:${p}`),
  ];

  return {
    scenarioId,
    arm,
    hits,
    misses,
    fabrications,
    recall: truth.expected.length === 0 ? 1 : hits.length / truth.expected.length,
    noReport,
    reportChars: report.length,
  };
}

// --- Aggregation + the resolving-power verdict ---

export interface ArmSummary {
  arm: string;
  scenarios: number;
  expected: number;
  hits: number;
  misses: number;
  fabrications: number;
  recall: number;
  noReports: number;
}

export function summarizeArm(arm: string, scores: ScenarioScore[]): ArmSummary {
  const hits = scores.reduce((n, s) => n + s.hits.length, 0);
  const misses = scores.reduce((n, s) => n + s.misses.length, 0);
  return {
    arm,
    scenarios: scores.length,
    expected: hits + misses,
    hits,
    misses,
    fabrications: scores.reduce((n, s) => n + s.fabrications.length, 0),
    recall: hits + misses === 0 ? 0 : hits / (hits + misses),
    noReports: scores.filter((s) => s.noReport).length,
  };
}

export interface PairVerdict {
  pair: string;
  recallDelta: number;
  fabricationDelta: number;
  wins: number;
  losses: number;
  ties: number;
  separates: boolean;
  message: string;
}

/**
 * Does the instrument separate two arms?
 *
 * Separation needs BOTH a recall gap wider than the noise band AND a paired
 * per-scenario majority, so one loud scenario cannot carry the verdict.
 */
export function comparePair(
  better: { arm: string; scores: ScenarioScore[] },
  worse: { arm: string; scores: ScenarioScore[] },
  noiseBand = 0.1,
): PairVerdict {
  const a = summarizeArm(better.arm, better.scores);
  const b = summarizeArm(worse.arm, worse.scores);
  const byId = new Map(worse.scores.map((s) => [s.scenarioId, s]));
  let wins = 0, losses = 0, ties = 0;
  for (const s of better.scores) {
    const o = byId.get(s.scenarioId);
    if (!o) continue;
    if (s.recall > o.recall) wins++;
    else if (s.recall < o.recall) losses++;
    else ties++;
  }
  const recallDelta = a.recall - b.recall;
  const separates = recallDelta > noiseBand && wins > losses;
  return {
    pair: `${better.arm} vs ${worse.arm}`,
    recallDelta,
    fabricationDelta: a.fabrications - b.fabrications,
    wins,
    losses,
    ties,
    separates,
    message: separates
      ? `${better.arm} beats ${worse.arm} by ${(recallDelta * 100).toFixed(1)} recall points (${wins}W/${losses}L/${ties}T).`
      : `${better.arm} does NOT separate from ${worse.arm}: ${(recallDelta * 100).toFixed(1)} recall points, noise band is ${(noiseBand * 100).toFixed(0)} (${wins}W/${losses}L/${ties}T).`,
  };
}

export interface Verdict {
  resolving: boolean;
  pairs: PairVerdict[];
  banner: string[];
}

/**
 * The gate on the whole refactor.
 *
 * `current` must separate from BOTH `gutted` (frontmatter only, all bodies
 * emptied) and `no-skill` (bare host). If it does not, the fixtures cannot see
 * what the skill bodies do, and no later cut may cite this instrument.
 */
export function resolvingPower(
  arms: Record<string, ScenarioScore[]>,
  noiseBand = 0.1,
): Verdict {
  const pairs: PairVerdict[] = [];
  const banner: string[] = [];
  const need = (name: string) => arms[name] && arms[name].length > 0;

  if (!need('current')) {
    return {
      resolving: false,
      pairs,
      banner: ['INCONCLUSIVE: no `current` arm was scored. Run current + gutted + no-skill.'],
    };
  }
  for (const control of ['gutted', 'no-skill']) {
    if (!need(control)) {
      banner.push(`INCONCLUSIVE: control arm \`${control}\` was not scored.`);
      continue;
    }
    pairs.push(comparePair({ arm: 'current', scores: arms.current }, { arm: control, scores: arms[control] }, noiseBand));
  }
  const scored = pairs.length > 0;
  const resolving = scored && pairs.every((p) => p.separates);

  if (!scored) {
    banner.push('INCONCLUSIVE: no control arm scored, so resolving power is unknown.');
  } else if (!resolving) {
    const flat = pairs.filter((p) => !p.separates).map((p) => p.pair).join(' and ');
    banner.push(
      '',
      '='.repeat(72),
      'STOP. THIS INSTRUMENT HAS NO RESOLVING POWER.',
      '='.repeat(72),
      `The scored arms do not separate: ${flat}.`,
      'A tree with every body emptied scores the same as the real tree, or the',
      'bare host does. That is a statement about these fixtures, not about the',
      'judgment prose. 87 hostile field users reported the judgment useful; the',
      'correct reading is that these fixtures cannot see what those users saw.',
      'Do NOT cite this run to justify deleting or shrinking anything.',
      'Fix the fixtures first, or gate the refactor on field evidence instead.',
      '='.repeat(72),
      '',
    );
  } else {
    banner.push(
      'Instrument has resolving power. Both controls separate from the current tree.',
      ...pairs.map((p) => '  ' + p.message),
    );
  }
  return { resolving, pairs, banner };
}

/** Two run files, same scenarios: what moved. */
export function compareRuns(
  a: { runId: string; arms: Record<string, ScenarioScore[]> },
  b: { runId: string; arms: Record<string, ScenarioScore[]> },
): string[] {
  const out: string[] = [`compare ${a.runId} -> ${b.runId}`];
  for (const arm of new Set([...Object.keys(a.arms), ...Object.keys(b.arms)])) {
    const sa = a.arms[arm] ? summarizeArm(arm, a.arms[arm]) : null;
    const sb = b.arms[arm] ? summarizeArm(arm, b.arms[arm]) : null;
    if (!sa || !sb) {
      out.push(`  ${arm}: only in ${sa ? a.runId : b.runId}`);
      continue;
    }
    const d = (sb.recall - sa.recall) * 100;
    out.push(
      `  ${arm}: recall ${(sa.recall * 100).toFixed(1)} -> ${(sb.recall * 100).toFixed(1)} (${d >= 0 ? '+' : ''}${d.toFixed(1)}), ` +
        `fabrications ${sa.fabrications} -> ${sb.fabrications}`,
    );
  }
  return out;
}
