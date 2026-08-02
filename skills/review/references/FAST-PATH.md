# Trivial-change fast path

Read this only when the trivial-change trigger in SKILL.md has already fired: the diffstat probe showed a small diff with no risk surface. This file is the whole path. Nothing else is read on it.

On the trivial path:

- Print the fast-path header named below, and nothing else from the full block in SKILL.md. Skip every specialist module and every per-invocation reference from dispatch step 4; the probe already answered everything a module would ask.
- The review is the findings themselves: file, line, what is wrong, what to do. Nothing else. If nothing is wrong, say the diff is clean and name what you checked in one line.
- Suppress the ceremony entirely: no pre-mortem, no severity scores or grades, no coverage diagram, no review-army roster, no outside voices, no depth or mode upsell. A 48-line diff does not need a report; it needs the read.
- Report-only versus mutation authority is unchanged. A typo you were authorized to fix, you fix; anything outside the authorized boundary is reported, not edited.

## The fast-path header

This path prints a reduced header, not the full block in SKILL.md. Two fields, in this order:

```text
Target: <the diff, PR, branch, or repository this run read>
Mutation: <report-only, or the exact authorized mutation boundary>
```

Every other label in the full block is dropped, not filled with a guess. This path reads no specialist module and rates no depth, so a printed Mode, Depth, Active modules, Skipped modules, or Web context line would carry no information a reader can act on. Say in one sentence that the trivial-change fast path fired and that no module was read. That is the whole account of what was skipped.

## When this path does not apply

The change is not trivial if the probe shows it touches authentication, secrets, money, permissions, data shape or migrations, concurrency, or a published API; loosens a check or input that unchanged code elsewhere still consumes; or is large enough that the risk lives in the interaction between files rather than in the lines themselves. Fall back to normal dispatch and say why in one line.
