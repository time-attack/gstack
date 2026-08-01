# Trivial-check fast path

Read this only when the trivial-check trigger in SKILL.md has already fired: one cheap probe showed a single observation whose verdict is pass or fail with nothing left to triage. This file is the whole path. Nothing else is read on it.

On the trivial path:

- Print the required header with `Depth: readiness (trivial check)`, `Active modules: none (trivial-change fast path)`, and `Skipped modules: all (trivial-change fast path)`. Skip every specialist module and every per-invocation reference from dispatch step 4 — the probe already answered everything a module would ask.
- Do the small thing and report the observation: what was run, what came back, pass or fail. Nothing else.
- Ask at most one clarifier, and only for genuine ambiguity the probe surfaced (two routes match that path, no declared command for this check). Reversible defaults are decided, not asked, and named in one line. The project-owned-command rule still binds: read the command from project config or ask, never probe-run a framework guess.
- Suppress the ceremony entirely: no pre-mortem, no coverage audit or diagram, no severity table, no scores, no evidence-package assembly, no deeper-mode upsell. A one-line check does not need a QA report; it needs the check.
- Mutation is unchanged by this path. A fix that is obvious and inside an already-authorized mutation boundary is applied and reported; without that authorization the check stays report-only and still fails closed.

## When this path does not apply

If the probe surfaces real surface — the check crosses a user journey, the first observation fails in a way that needs triage, or the single target turns out to be a fleet — the ask is not trivial. Fall back to normal dispatch and say why in one line.
