/**
 * Skill coverage matrix (v1.45.0.0 T1, cathedral Phase 0).
 *
 * Single source of truth mapping each gstack skill to its E2E test files.
 * The CI gate at test/skill-coverage-matrix.test.ts fails if a skill has
 * no gate-tier entry, ensuring the eval-first foundation holds: every
 * skill has at least one CI-blocking check that asserts must-have
 * behavior.
 *
 * KNOWN GAP (recorded, not fixed): both consumers discover skills by
 * scanning REPO_ROOT for `<dir>/SKILL.md`, so this registry has never
 * covered the shipped GStack 2 surface — `skills/` has no top-level
 * SKILL.md, so the six dispatchers under `skills/*` are invisible to the
 * scan. After the 1.x root-tree deletion the registry tracks only the
 * three surviving root-level skill dirs (browse, make-pdf, ios-qa);
 * nothing asserts "every shipped dispatcher has a named gate test."
 *
 * Two tiers per entry:
 *   gate     CI-blocking, runs on every PR, target <$0.50/test or free.
 *   periodic Weekly cron, deeper coverage, can cost ~$1-$3/test.
 *
 * The 'floor' entry refers to test/skill-coverage-floor.test.ts —
 * a structural-compliance smoke test that covers every skill with
 * file-IO checks (free, no LLM cost). When a skill has only 'floor'
 * coverage, that's the eval-first minimum; future work can layer
 * behavioral checks on top.
 */

export interface SkillCoverage {
  /** Gate-tier test file paths (relative to repo root). At least one required per skill. */
  gate: string[];
  /** Periodic-tier test file paths. Optional but recommended. */
  periodic: string[];
  /** Brief note on why this coverage is the right shape for this skill. */
  rationale?: string;
}

/**
 * Per-skill coverage. Keys MUST match the top-level skill directory name.
 * The CI test asserts every skill in the repo has an entry here AND that
 * gate[] is non-empty.
 *
 * Adding a new skill: add an entry here AND either reference an existing
 * test that covers it OR add 'test/skill-coverage-floor.test.ts' as the
 * minimum gate-tier check.
 */
export const SKILL_COVERAGE: Record<string, SkillCoverage> = {
  browse: {
    gate: ['test/skill-coverage-floor.test.ts'],
    periodic: [],
    rationale: 'browse binary has its own integration suite under browse/test/.',
  },
  'make-pdf': {
    gate: ['test/skill-coverage-floor.test.ts'],
    periodic: [],
    rationale: 'Standalone markdown->PDF tool skill; render/e2e behavior has its own suite under make-pdf/test/ (render.test.ts + e2e/*-gate.test.ts).',
  },

  // ─── iOS ────────────────────────────────────────────────────
  'ios-qa': { gate: ['test/skill-e2e-ios.test.ts', 'test/skill-coverage-floor.test.ts'], periodic: ['test/skill-e2e-ios-device.test.ts', 'test/skill-e2e-ios-swift-build.test.ts'] },
};
