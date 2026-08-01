# Trivial-change fast path

Read this only when the trivial-change trigger in SKILL.md has already fired: the diffstat probe showed a small diff with no risk surface. This file is the whole path. Nothing else is read on it.

On the trivial path:

- Print the required header with `Depth: readiness (trivial diff)`, `Active modules: none (trivial-change fast path)`, and `Skipped modules: all (trivial diff — nothing for a specialist to work on)`. Skip every specialist module and every per-invocation reference from dispatch step 4; the probe already answered everything a module would ask.
- The review is the findings themselves: file, line, what is wrong, what to do. Nothing else. If nothing is wrong, say the diff is clean and name what you checked in one line.
- Suppress the ceremony entirely: no pre-mortem, no severity scores or grades, no coverage diagram, no review-army roster, no outside voices, no depth or mode upsell. A 48-line diff does not need a report; it needs the read.
- Report-only versus mutation authority is unchanged. A typo you were authorized to fix, you fix; anything outside the authorized boundary is reported, not edited.

## When this path does not apply

The change is not trivial if the probe shows it touches authentication, secrets, money, permissions, data shape or migrations, concurrency, or a published API; loosens a check or input that unchanged code elsewhere still consumes; or is large enough that the risk lives in the interaction between files rather than in the lines themselves. Fall back to normal dispatch and say why in one line.
