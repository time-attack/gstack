---
name: review
description: >-
  Review code with validated evidence. Use for normal, security, performance, or deep audits of diffs, architecture, data, tests, dependencies, docs, and code health.
---

# GStack Review

Classify the change, select relevant review modules, validate findings, and distinguish report-only from safe fixes.

## Required execution header

Before any substantive output, print these exact labels in this exact order. Resolve the specialist refinement first; do not put prose above the header.

```text
Target: <concrete repository, product, URL, device, PR, or artifact>
Mode: <selected top-level mode>
Depth: <readiness, standard, or deep>
Mutation: <report-only or exact authorized mutation boundary>
Active modules: <comma-separated internal specialist modules>
Skipped modules: <comma-separated non-active mandatory modules with compact reasons>
Web context: <none, optional, local-browser, or production>
```

This exact-labels rule does not bind the trivial-change fast path. That path prints the reduced header its own file names, which is a subset of the labels above.

Gloss these header words on first use, for a reader who has not seen them before. A *diff* is the set of lines this change adds and removes. *Depth* is how much evidence the review owes you: `readiness` is a fast pre-landing pass, `standard` is the normal pass, `deep` adds health evidence and independent second opinions. *Mutation* is what this run is allowed to change: report-only means it writes findings and edits nothing, and a mutation boundary is the exact set of files or fixes the user authorized. *Modules* are the preserved specialist review workflows this dispatcher loads from `references/`; *active* ones run, *skipped* ones are named with the reason they did not. An *outside voice* is a second reviewer that is genuinely a different model, never this one re-reading its own work. A *STOP gate* is a point where the workflow stops and waits for your explicit approval before continuing.

## Dispatch protocol

1. Infer the mode from product stage, surface, requested artifact, mutation authorization, evidence needs, and deployment state. Do not route by keyword alone.
2. Refine the public mode to the smallest applicable internal specialist set, then print the required execution header before any substantive output.
3. Read each active module in full from the path shown in the mode/alias tables. Its specialist body, behavioral contract, STOP gates, and appended upstream judgment ports are binding. Read a lazy specialist phase in full only when the workflow reaches its package-local reference. The trivial-change fast path overrides this step: when it fires, read only what that path directs.
4. Read `references/SHARED-JUDGMENT.md` and `references/AUTHORITY-POLICY.md` for every invocation. Read `references/EXECUTION-PROFILES.md` only when the depth this run needs is not already obvious from the request; a stated depth, a trivial ask, or a fast path answers it without reading anything. The trivial-change fast path overrides this step: when it fires, read only what that path directs. Read `references/QUESTION-FORMAT.md` before the first question to the user; it owns the decision-brief format, the structured-payload caps, and the prose fallback when no question tool is available. Infer Depth from structured operating conditions, then obey its mandatory modules, legal skips, artifacts, and claim limits. Read `references/RUNTIME.md` before capability-dependent work and `references/WEB-CONTEXT.md` before public-web work. When the target is a repository, read `references/CODE-INTELLIGENCE.md` once before substantive specialist work and follow its one-time indexing offer. Read `references/THIRD-PARTY-ACTIONS.md` before directing the user to act on a third-party website (API key registration, vendor accounts, dashboards).
5. If an old asset path is unavailable, use `references/ASSETS.md`. If legacy prose invokes another retired skill, resolve it through `references/COMPATIBILITY.md` and stay inside these five dispatchers.
6. Preserve report-only versus mutation boundaries. Missing mutation authorization fails closed: do not edit merely because a specialist can fix. Commits, pushes, PRs, merges, deploys, messages, and other external mutations still require affirmative authority from the user.
7. Match the user's language. Keep code identifiers, commands, and source quotations original when translation would reduce accuracy.
8. At exit, report completed artifacts, evidence, unresolved decisions, skipped modules with reasons, and any blocked gate.


## Trivial-change fast path

A trivial change is a small diff with no risk surface: a rename or move, a comment, doc, or copy edit, a formatting or version-string bump, a test-only addition, or a few lines whose whole effect is visible in the diff itself. Classify from the prompt plus one cheap probe before reading any reference file or specialist module: `git diff <base>...HEAD --stat`, then read the diff itself when the stat says it is small (roughly a handful of files and under ~100 changed lines). Reading a tiny diff IS the review; do not load the specialist apparatus to confirm that there is nothing for it to work on.

When that trigger fires, read `references/FAST-PATH.md` and follow it. It is binding, it carries the whole path, and it is the only file this path reads.

## Top-level modes

| Mode | Target | Infer when | Candidate internal specialists |
|---|---|---|---|
| `Normal` | A current branch diff | A standard pre-landing or broad code review is requested. | `references/legacy/review.md` |
| `Security` | The repository threat surface (every way an attacker could get in) | The primary risk is auth, secrets, supply chain (the third-party packages your code depends on), abuse, infrastructure, or threat modeling. | `references/legacy/cso.md` |
| `Performance` | Changed performance behavior | The review should concentrate on latency, memory, resource use, hot paths (the code that runs most often), or regressions (behavior that used to work and now does not). | `references/legacy/review.md` |
| `Deep` | A high-risk or cross-cutting change | The change warrants health evidence and every genuinely independent outside voice available. | `references/legacy/review.md`, `references/legacy/health.md`, `references/legacy/codex.md`, `references/legacy/claude.md` |

## Hard rules

- Validate critical findings against current code and provenance.
- Trace loosened inputs into unchanged consumers and re-read unchanged user-facing strings.
- Never invoke the current model as its own outside voice.

## Internal specialist routing aliases

Every specialist below is an internal implementation detail, including mandatory inputs. The legacy alias refines a top-level mode; it never adds a public skill or top-level mode.

| Legacy invocation | Legacy alias | Public mode | Role | Module |
|---|---|---|---|---|
| `/review` | `diff` | `Normal` | mandatory | `references/legacy/review.md` |
| `/cso` | `security` | `Security` | mandatory | `references/legacy/cso.md` |
| `/health` | `health` | `Deep` | mandatory | `references/legacy/health.md` |
| `/codex` | `outside-codex` | `Deep` | mandatory | `references/legacy/codex.md` |
| `/claude` | `outside-claude` | `Deep` | mandatory | `references/legacy/claude.md` |

## Completeness invariant

Do not work from this dispatcher summary when a module is active. Read the referenced module completely, including its provenance marker, specialist workflow, lazy-phase directives, behavioral contract, and bug-fix overlays. The pinned 1.x shared onboarding wrapper is provenance-only and never runs during canonical execution.
