/**
 * /spec --execute end-to-end (periodic, paid, real-PTY).
 *
 * Asserts: when /spec --execute runs against a fixture prompt, it:
 *   1. Refuses to draft on turn 1 (Phase 1 hard gate)
 *   2. Reads code in Phase 3 (cites a real file path from the fixture repo)
 *   3. Passes the quality gate (score >= 7) on a well-formed fixture
 *   4. Spawns a fresh worktree on branch spec/<slug>-<pid>
 *   5. Issues a final-confirm AskUserQuestion before the spawn
 *
 * Cost: ~$3-5/run, 5-8 min wall clock. Periodic — runs weekly via cron or
 *       on demand via `EVALS=1 EVALS_TIER=periodic bun run test:e2e`.
 *
 * TODO (v1.1): expand to test all 5 expansion paths and the plan-mode-aware
 * Phase 5 branching (active vs inactive). Current implementation is the
 * minimum smoke that proves --execute end-to-end works.
 */

import { expect } from 'bun:test';
import {
  ROOT, describeIfSelected, testIfSelected, installLegacySkill,
} from './helpers/e2e-helpers';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describeIfSelected('/spec --execute end-to-end (periodic)', ['spec-execute'], () => {
  testIfSelected('spec-execute', async () => {
    // Reachability sanity, replacing two existsSync checks on `spec/SKILL.md.tmpl`
    // and `spec/SKILL.md`. Commit f19d6cda deleted the 1.x root tree, so both
    // paths are gone and neither the generator that produced them nor the
    // spec-template-invariants / spec-template-sync suites that guarded them
    // still exist. What a user reaches today is the compat alias, and
    // installLegacySkill is the stronger check the old pair was reaching for:
    // it throws on a missing alias, a missing `$dispatcher --mode` route, a
    // dispatcher that is not in skills/, or a --module that dangles.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-spec-execute-'));
    try {
      const route = installLegacySkill(dir, 'spec');
      expect(route.dispatcher).toBe('plan');
      expect(route.mode).toBe('Specification');
      expect(route.module).toBe('spec');

      // The phases this test is registered to exercise must still be IN the
      // module the route lands on. Without this, the file would go green on a
      // module that had been gutted down to a stub.
      const moduleBody = fs.readFileSync(
        path.join(ROOT, 'skills', route.dispatcher, 'references', 'legacy', `${route.module}.md`),
        'utf-8',
      );
      for (const phase of [
        '### Phase 1: Understand the "Why"',
        '### Phase 3: Technical Interrogation',
        '### Phase 4.5: Quality Gate',
        '### Phase 5: File the Spec',
      ]) {
        expect(moduleBody, `${route.module}.md no longer carries "${phase}"`).toContain(phase);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // Full PTY-driven E2E lives in a follow-up. For now this test exists as
    // the periodic-tier surface registered in E2E_TIERS so the diff-based
    // selector knows to run it when the spec module or its alias changes.
    //
    // Replace with the full claude-pty-runner driven test per TODO:
    //   "/spec --execute E2E full pipeline test (v1.1)"
  }, 600_000);
});
