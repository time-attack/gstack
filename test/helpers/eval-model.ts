/**
 * Single model-resolution point for eval/benchmark runs.
 *
 * gstack never names a model: the host CLI (claude, codex, cursor, pi, gemini,
 * kimi) uses whatever model it is configured with. Default here is `undefined`,
 * which means "omit --model" so the host picks its own configured default.
 *
 * Set GSTACK_EVAL_MODEL (or the legacy EVALS_MODEL) only to PIN a model across
 * both arms of an A/B run for reproducibility. The runners already record the
 * model the host actually resolved on each result, so the receipt exists even
 * when nothing is pinned.
 */
export function resolveEvalModel(): string | undefined {
  return process.env.GSTACK_EVAL_MODEL || process.env.EVALS_MODEL || undefined;
}
