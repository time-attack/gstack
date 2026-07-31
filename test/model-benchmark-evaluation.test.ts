import { describe, expect, test } from 'bun:test';
import { evaluateOutput, parseEvaluationSpec } from '../lib/model-benchmark/evaluation';

describe('model benchmark deterministic evaluation', () => {
  test('scores required terms and blocks forbidden behavior', () => {
    expect(evaluateOutput('Consent with a local fallback', {
      requiredTerms: ['consent', 'fallback'],
      forbiddenTerms: ['mandatory install'],
    })).toMatchObject({ score: 1, passed: true });

    const failed = evaluateOutput('Use a mandatory install with consent', {
      requiredTerms: ['consent'],
      forbiddenTerms: ['mandatory install'],
    });
    expect(failed.score).toBe(0);
    expect(failed.passed).toBe(false);
    expect(failed.forbidden.matched).toEqual(['mandatory install']);
  });

  test('supports partial thresholds and validates the JSON contract', () => {
    expect(evaluateOutput('alpha', {
      requiredTerms: ['alpha', 'beta'],
      minimumScore: 0.5,
    }).passed).toBe(true);
    expect(parseEvaluationSpec('{"requiredTerms":["alpha"],"minimumScore":1}')).toEqual({
      requiredTerms: ['alpha'],
      minimumScore: 1,
    });
    expect(() => parseEvaluationSpec('{"requiredTerms":"alpha"}')).toThrow();
  });
});
