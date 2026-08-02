# Trivial-change fast path

Read this only when the trivial-change trigger in SKILL.md has already fired: the diffstat probe showed a release with no release surface. This file is the whole path. Nothing else is read on it.

On the trivial path:

- Print the fast-path header named below, and nothing else from the full block in SKILL.md. Skip every specialist module and every per-invocation reference from dispatch step 4 — the diffstat already answered everything a module would ask.
- Run the project's own declared checks once, read from the project's config (CLAUDE.md, package scripts, CI workflow), never a guessed command. If the project declares none, say so in one line and proceed. The hard rule stands: a failing check ends the fast path, it is not shipped past.
- Honor the repository's existing release convention at the smallest size that convention allows — one line in the CHANGELOG's existing style if the repo keeps one, one bump if the repo version-stamps. If the repo keeps neither, do not invent them for a two-file change.
- Commit, push, and open or update the PR inside the mutation boundary the user authorized; dispatch step 6 still governs that authority and dispatch step 9 still governs the irreversible stage.
- Suppress the ceremony entirely: no pre-mortem, no review army, no readiness dashboard, no scores, no coverage diagram, no queue table, no mode upsell. The report is what changed, which checks ran, and what landed or is waiting on whom.

## The fast-path header

This path prints a reduced header, not the full block in SKILL.md. Two fields, in this order:

```text
Target: <the repository, branch, or PR this run shipped>
Mutation: <report-only, or the exact authorized mutation boundary>
```

Every other label in the full block is dropped, not filled with a guess. This path reads no specialist module and rates no depth, so a printed Mode, Depth, Active modules, Skipped modules, or Web context line would carry no information a reader can act on. Say in one sentence that the trivial-change fast path fired and that no module was read. That is the whole account of what was skipped.

## When this path does not apply

If the probe surfaces real release surface — a public interface, a migration, a dependency or deploy-config change, more files than the diffstat can enumerate at a glance, or an ask that reaches deploy, canary, or store distribution (an App Store or TestFlight release is never trivial; dispatch step 10 owns it) — the release is not trivial. Fall back to normal dispatch and say why in one line.
