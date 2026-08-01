# Trivial-change fast path

Read this only when the trivial-change trigger in SKILL.md has already fired: one cheap probe showed the failing line, the wrong value, and the right value. This file is the whole path. Nothing else is read on it.

On the trivial path:

- Print the required header with `Depth: readiness (single-probe root cause)` and `Active modules: none (trivial-change fast path)`. Skip every specialist module and every per-invocation reference from dispatch step 4 — the probe already answered everything a module would ask.
- State the root cause in one line: file, line, wrong value → right value. When the prompt is itself the fix instruction ("fix the off-by-one in `paginate`"), that is affirmative mutation authority: print it on the Mutation line, apply the edit, and report. Without it, report the line and stop.
- Ask at most one clarifier, and only for genuine ambiguity the probe surfaced (two symbols with that name, an intended bound that could go either way). Reversible defaults are decided, not asked: extend the regression check the repo already has for that code, follow the repo's existing test habits, and say what you chose in one line. Never stand up a test harness for a one-line fix.
- Suppress the ceremony entirely: no pre-mortem, no reproduction ladder, no evidence table, no coverage diagram, no scores, no bisect plan, no mode upsell. A one-line fix does not need a report; it needs the line.

## When this path does not apply

If the probe does not pin the cause — the symptom is not where the prompt says it is, the "off-by-one" is a disagreement about intended behavior, the failure is intermittent, or more than one call site could produce it — the defect is not trivial. Fall back to normal dispatch and say why in one line.
