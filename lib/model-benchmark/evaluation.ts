export interface EvaluationSpec {
  requiredTerms?: string[];
  forbiddenTerms?: string[];
  minimumScore?: number;
}

export interface EvaluationResult {
  score: number;
  passed: boolean;
  required: { matched: string[]; missing: string[] };
  forbidden: { matched: string[] };
}

export function evaluateOutput(output: string, spec: EvaluationSpec): EvaluationResult {
  const normalized = output.toLowerCase();
  const requiredTerms = uniqueTerms(spec.requiredTerms);
  const forbiddenTerms = uniqueTerms(spec.forbiddenTerms);
  const matched = requiredTerms.filter((term) => normalized.includes(term.toLowerCase()));
  const missing = requiredTerms.filter((term) => !normalized.includes(term.toLowerCase()));
  const forbiddenMatched = forbiddenTerms.filter((term) => normalized.includes(term.toLowerCase()));
  const requiredScore = requiredTerms.length === 0 ? 1 : matched.length / requiredTerms.length;
  const score = forbiddenMatched.length > 0 ? 0 : requiredScore;
  const minimumScore = spec.minimumScore ?? 1;

  return {
    score,
    passed: score >= minimumScore && forbiddenMatched.length === 0,
    required: { matched, missing },
    forbidden: { matched: forbiddenMatched },
  };
}

export function parseEvaluationSpec(raw: string): EvaluationSpec {
  const value = JSON.parse(raw) as EvaluationSpec;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('rubric must be a JSON object');
  }
  for (const key of ['requiredTerms', 'forbiddenTerms'] as const) {
    if (value[key] !== undefined && (!Array.isArray(value[key]) || value[key]!.some((term) => typeof term !== 'string'))) {
      throw new Error(`${key} must be an array of strings`);
    }
  }
  if (value.minimumScore !== undefined && (typeof value.minimumScore !== 'number' || value.minimumScore < 0 || value.minimumScore > 1)) {
    throw new Error('minimumScore must be between 0 and 1');
  }
  return value;
}

function uniqueTerms(terms: string[] | undefined): string[] {
  return [...new Set((terms ?? []).map((term) => term.trim()).filter(Boolean))];
}
