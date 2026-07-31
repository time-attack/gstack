import { describe, expect, test } from 'bun:test';
import corpus from '../evals/platform-bakeoff/corpus.json';

function coverage(output: string, required: string[]): number {
  const normalized = output.toLowerCase();
  return required.filter((term) => normalized.includes(term.toLowerCase())).length / required.length;
}

describe('evaluation-platform bake-off corpus', () => {
  test('uses synthetic paired runs with a deterministic regression signal', () => {
    expect(corpus.length).toBeGreaterThanOrEqual(3);
    for (const item of corpus) {
      expect(item.required.length).toBeGreaterThan(0);
      expect(coverage(item.candidate, item.required)).toBe(1);
      expect(coverage(item.baseline, item.required)).toBeLessThan(1);
    }
  });

  test('benchmarks evaluation tooling rather than selecting model providers', () => {
    const encoded = JSON.stringify(corpus).toLowerCase();
    expect(encoded).not.toContain('claude-opus');
    expect(encoded).not.toContain('gpt-5');
    expect(encoded).not.toContain('gemini-');
  });
});
