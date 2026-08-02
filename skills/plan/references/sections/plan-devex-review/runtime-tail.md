# Runtime-only tail for plan-devex-review

Nothing here runs on the canonical `npx skills add` install: it ships no `$GSTACK_BIN`.
Read this file only after the probe in `references/RUNTIME.md` reported
`GSTACK_RUNTIME_PRESENT`. Every command below writes to or reads from
`${GSTACK_HOME:-$HOME/.gstack}`, never project files.

Render the dashboard from `references/sections/review-dashboard.md` first, then run the blocks below.

## Review Log

Persist after the DX Scorecard — the dashboard, the GSTACK REVIEW REPORT, and the EXIT
PLAN MODE GATE's "review log was called" check depend on it. **PLAN MODE EXCEPTION — ALWAYS RUN WHEN THE RUNTIME IS PRESENT** (writes to `"${GSTACK_HOME:-$HOME/.gstack}"/`, not project files). On `GSTACK_RUNTIME_ABSENT`, skip this whole section; the dashboard it feeds does not exist either, and the gate is satisfied by the absence probe.

```bash
$GSTACK_BIN/gstack-review-log '{"skill":"plan-devex-review","timestamp":"TIMESTAMP","status":"STATUS","initial_score":N,"overall_score":N,"product_type":"PRODUCT_TYPE","tthw_current":"TTHW_CURRENT","tthw_target":"TTHW_TARGET","mode":"MODE","persona":"PERSONA","competitive_tier":"COMPETITIVE_TIER","unresolved":N,"commit":"COMMIT"}' 2>/dev/null || echo "GSTACK_RUNTIME_ABSENT: gstack-review-log skipped"
```

TIMESTAMP = current ISO 8601 datetime; STATUS = "clean" if score 8+ AND 0 unresolved, else "issues_open"; other fields from the DX Scorecard + Step 0; COMMIT = `git rev-parse --short HEAD`.

## Capture Learnings

If you discovered a non-obvious pattern, pitfall, or architectural insight during
this session, log it for future sessions:

```bash
$GSTACK_BIN/gstack-learnings-log '{"skill":"plan-devex-review","type":"TYPE","key":"SHORT_KEY","insight":"DESCRIPTION","confidence":N,"source":"SOURCE","files":["path/to/relevant/file"]}' 2>/dev/null || echo "GSTACK_RUNTIME_ABSENT: gstack-learnings-log skipped"
```

**Types:** `pattern` (reusable approach), `pitfall` (what NOT to do), `preference`
(user stated), `architecture` (structural decision), `tool` (library/framework insight),
`operational` (project environment/CLI/workflow knowledge).

**Sources:** `observed` (you found this in the code), `user-stated` (user told you),
`inferred` (AI deduction), `cross-model` (both Claude and Codex agree).

**Confidence:** 1-10. Be honest. An observed pattern you verified in the code is 8-9.
An inference you're not sure about is 4-5. A user preference they explicitly stated is 10.

**files:** Include the specific file paths this learning references. This enables
staleness detection: if those files are later deleted, the learning can be flagged.

**Only log genuine discoveries.** Don't log obvious things. Don't log things the user
already knows. A good test: would this insight save time in a future session? If yes, log it.

## Brain Cache Background Refresh

After the skill's work completes (and telemetry has logged), kick a
background refresh of any cache digest that's getting close to its TTL.
This is non-blocking — the user doesn't wait. Next invocation benefits
from the warm cache.

```bash
eval "$($GSTACK_BIN/gstack-slug 2>/dev/null)" 2>/dev/null || true
($GSTACK_BIN/gstack-brain-cache refresh --project "$SLUG" 2>/dev/null &) || true
```
