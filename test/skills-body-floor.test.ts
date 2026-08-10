/**
 * A floor under the shipped judgment surface.
 *
 * Every other size guard in this repo points DOWN: the catalog must stay 70%
 * below the 1.x baseline, each SKILL.md under 40K tokens, the eager-read tier
 * byte-exact. Nothing pointed UP. So a legacy module could be gutted to a
 * stub and the whole suite would go greener, not redder.
 *
 * That mattered here specifically: this tree was cut hard on purpose, and the
 * cut rule says a removal must state what it removes and what check would
 * catch the loss. This is that check. It does not forbid cutting — it forbids
 * cutting SILENTLY.
 *
 * The old floor lived in skill-size-budget.test.ts and only ever measured the
 * 1.x root tree, so it went vacuous the moment that tree was deleted and was
 * removed rather than left green-asserting-nothing.
 *
 * Deliberate cut? Set GSTACK_BODY_FLOOR_REASON="why" — the reason is printed
 * and the run passes. Then regenerate the baseline in the same commit, so the
 * next cut is measured against what you actually shipped.
 */
import { describe, expect, test } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(import.meta.dir, '..');
const BASELINE = path.join(ROOT, 'test', 'fixtures', 'skills-body-baseline.json');
const MIN_RATIO = 0.8;

interface Baseline {
  capturedAt: string;
  files: Record<string, number>;
}

describe('skills body floor', () => {
  const baseline: Baseline = JSON.parse(fs.readFileSync(BASELINE, 'utf-8'));

  test('baseline covers the shipped judgment surface', () => {
    expect(Object.keys(baseline.files).length).toBeGreaterThan(40);
  });

  test('no shipped module shrinks past 80% of baseline without a stated reason', () => {
    const undershoots: string[] = [];
    for (const [rel, before] of Object.entries(baseline.files)) {
      const abs = path.join(ROOT, rel);
      // A deleted file is a different signal — the reachability tests own that.
      if (!fs.existsSync(abs)) continue;
      const after = fs.statSync(abs).size;
      const ratio = after / before;
      if (ratio < MIN_RATIO) {
        undershoots.push(`${rel}: ${before} -> ${after} bytes (${Math.round(ratio * 100)}% of baseline)`);
      }
    }

    if (undershoots.length === 0) return;

    const reason = process.env.GSTACK_BODY_FLOOR_REASON?.trim();
    if (reason) {
      // eslint-disable-next-line no-console
      console.warn(
        `[skills-body-floor] OVERRIDE (${reason}) — ${undershoots.length} module(s) cut below ${MIN_RATIO * 100}%:\n  ` +
          undershoots.join('\n  ') +
          `\nRegenerate test/fixtures/skills-body-baseline.json in this same commit.`,
      );
      return;
    }

    expect(
      undershoots,
      `Modules shrank past ${MIN_RATIO * 100}% of baseline:\n  ${undershoots.join('\n  ')}\n\n` +
        `If deliberate, re-run with GSTACK_BODY_FLOOR_REASON="what you cut and why" ` +
        `and regenerate the baseline in the same commit.`,
    ).toEqual([]);
  });

  test('baseline names no file that has silently vanished', () => {
    // Deleting a module is legal, but it should be a decision, not a surprise.
    // This lists them so a reviewer sees the removal in the diff.
    const gone = Object.keys(baseline.files).filter((rel) => !fs.existsSync(path.join(ROOT, rel)));
    expect(
      gone,
      `Baseline lists files no longer on disk. If the removal was intended, regenerate the baseline:\n  ${gone.join('\n  ')}`,
    ).toEqual([]);
  });
});
