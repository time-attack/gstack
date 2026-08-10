/**
 * Every scenario prompt must name its skill.
 *
 * This guards the most expensive failure mode in the ablation study. A
 * scenario that does not name a skill relies on the model spontaneously
 * invoking one, and measured on the real harness it often does not: a smoke
 * cell showed the `full` arm never calling the Skill tool and scoring
 * identically to `no-skill`.
 *
 * When that happens `full` IS `no-skill`. Every ablation delta collapses to
 * zero and all 42 modules read as dead weight, so the study recommends
 * deleting everything for a reason unrelated to any module's content. At the
 * time this was written, 0 of 94 scenario tasks named a skill.
 *
 * The aggregator has a runtime backstop (a low invocation rate on `full`
 * fails the validity gate), but that only voids a run AFTER it is paid for.
 * This is the free check that stops it being launched.
 */
import { describe, expect, test } from 'bun:test';
import { allScenarios, scenarioPrompt } from './scenarios';

const NAMES_A_SKILL = /\/(plan|qa|debug|review|ship|make-pdf)\b/i;

describe('scenario invocation', () => {
  const all = allScenarios();

  test('there are scenarios to check', () => {
    expect(all.length).toBeGreaterThan(50);
  });

  test('every prompt names a skill', () => {
    const silent = all.filter((s) => !NAMES_A_SKILL.test(scenarioPrompt(s))).map((s) => `${s.id} [${s.skill}]`);
    expect(
      silent,
      `These scenarios never name a skill, so every arm would measure the raw model ` +
        `and every module would read as dead weight:\n  ${silent.join('\n  ')}`,
    ).toEqual([]);
  });

  test('the directive names the scenario\'s own dispatcher', () => {
    // A review scenario that says "use /qa" measures mis-routing, not the module.
    const wrong = all
      .filter((s) => !new RegExp(`/${s.skill}\\b`, 'i').test(scenarioPrompt(s)))
      .map((s) => `${s.id} declares skill=${s.skill} but its prompt does not name /${s.skill}`);
    expect(wrong, wrong.join('\n  ')).toEqual([]);
  });

  test('scenario ids are unique', () => {
    // A duplicate id silently pools two different tasks into one cell key,
    // so replicates of different work get averaged together.
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const s of all) {
      if (seen.has(s.id)) dupes.push(s.id);
      seen.add(s.id);
    }
    expect(dupes, `duplicate scenario ids: ${dupes.join(', ')}`).toEqual([]);
  });

  test('every dispatcher has scenarios, or its modules cannot be judged', () => {
    const covered = new Set(all.map((s) => s.skill));
    const missing = ['plan', 'qa', 'debug', 'review', 'ship'].filter((d) => !covered.has(d as never));
    expect(
      missing,
      `No scenarios for: ${missing.join(', ')}. Modules under these dispatchers can be ` +
        `neither confirmed nor cut — "never measured", which is easy to misread as "no value".`,
    ).toEqual([]);
  });
});
