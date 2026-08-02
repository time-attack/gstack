# Runtime-only tail for plan-ceo-review

Nothing here runs on the canonical `npx skills add` install: it ships no `$GSTACK_BIN`.
Read this file only after the probe in `references/RUNTIME.md` reported
`GSTACK_RUNTIME_PRESENT`. Every command below writes to or reads from
`${GSTACK_HOME:-$HOME/.gstack}`, never project files.

Render the dashboard from `references/sections/review-dashboard.md` first, then run the blocks below.

## Handoff Note Cleanup

After producing the Completion Summary, clean up any handoff notes for this branch —
the review is complete and the context is no longer needed.

```bash
setopt +o nomatch 2>/dev/null || true  # zsh compat
eval "$($GSTACK_BIN/gstack-slug 2>/dev/null)"
rm -f "${GSTACK_HOME:-$HOME/.gstack}"/projects/${PROJECT_ID:-unknown}/*-$BRANCH-ceo-handoff-*.md 2>/dev/null || true
```

## Review Log

After producing the Completion Summary above, persist the review result.

**PLAN MODE EXCEPTION — ALWAYS RUN WHEN THE RUNTIME IS PRESENT:** On `GSTACK_RUNTIME_ABSENT`,
skip this whole section; the dashboard it feeds does not exist either.
When the runtime is present, this command writes review metadata to
`"${GSTACK_HOME:-$HOME/.gstack}"/` (user config directory, not project files). The skill preamble
already writes to `"${GSTACK_HOME:-$HOME/.gstack}"/sessions/` and `"${GSTACK_HOME:-$HOME/.gstack}"/analytics/` — this is
the same pattern. The review dashboard depends on this data. Skipping this
command breaks the review readiness dashboard in /ship.

```bash
$GSTACK_BIN/gstack-review-log '{"skill":"plan-ceo-review","timestamp":"TIMESTAMP","status":"STATUS","unresolved":N,"critical_gaps":N,"mode":"MODE","scope_proposed":N,"scope_accepted":N,"scope_deferred":N,"commit":"COMMIT"}' 2>/dev/null || echo "GSTACK_RUNTIME_ABSENT: gstack-review-log skipped"
$GSTACK_BIN/gstack-decision-log '{"decision":"CEO review (MODE): SCOPE_SUMMARY","rationale":"VERDICT","scope":"branch","source":"skill","confidence":8}' 2>/dev/null || true
```

The second command records the accepted scope as a durable cross-session decision so the next session sees what was settled (and why) without re-litigating it. It writes to `"${GSTACK_HOME:-$HOME/.gstack}"/` (same pattern as review-log), is non-interactive, and is best-effort (`|| true` — never blocks the review). Substitute `SCOPE_SUMMARY` (e.g. "accepted 4 of 6 proposals" for expansion, or "held scope" / "cut 3 items" for HOLD/REDUCTION) and `VERDICT` (the one-line verdict from the summary).

Before running this command, substitute the placeholder values from the Completion Summary you just produced:
- **TIMESTAMP**: current ISO 8601 datetime (e.g., 2026-03-16T14:30:00)
- **STATUS**: "clean" if 0 unresolved decisions AND 0 critical gaps; otherwise "issues_open"
- **unresolved**: number from "Unresolved decisions" in the summary
- **critical_gaps**: number from "Failure modes: ___ CRITICAL GAPS" in the summary
- **MODE**: the mode the user selected (SCOPE_EXPANSION / SELECTIVE_EXPANSION / HOLD_SCOPE / SCOPE_REDUCTION)
- **scope_proposed**: number from "Scope proposals: ___ proposed" in the summary (0 for HOLD/REDUCTION)
- **scope_accepted**: number from "Scope proposals: ___ accepted" in the summary (0 for HOLD/REDUCTION)
- **scope_deferred**: number of items deferred to TODOS.md from scope decisions (0 for HOLD/REDUCTION)
- **COMMIT**: output of `git rev-parse --short HEAD`

## Capture Learnings

If you discovered a non-obvious pattern, pitfall, or architectural insight during
this session, log it for future sessions:

```bash
$GSTACK_BIN/gstack-learnings-log '{"skill":"plan-ceo-review","type":"TYPE","key":"SHORT_KEY","insight":"DESCRIPTION","confidence":N,"source":"SOURCE","files":["path/to/relevant/file"]}' 2>/dev/null || echo "GSTACK_RUNTIME_ABSENT: gstack-learnings-log skipped"
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
