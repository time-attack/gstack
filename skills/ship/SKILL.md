---
name: ship
description: >-
  Prepare, land, deploy, monitor, or resume a release. Use for checks, versioning, docs, commits, PRs, merge gates, production verification, and rollback.
---

# GStack Ship

Select one release stage, preserve human and automated gates, and make every external mutation explicit.

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

## Dispatch protocol

1. Infer the mode from product stage, surface, requested artifact, mutation authorization, evidence needs, and deployment state. Do not route by keyword alone.
2. Refine the public mode to the smallest applicable internal specialist set, then print the required execution header before any substantive output.
3. Read each active module in full from the path shown in the mode/alias tables. Its specialist body, behavioral contract, STOP gates, and appended upstream judgment ports are binding. Read a lazy specialist phase in full only when the workflow reaches its package-local reference. The trivial-change fast path overrides this step: when it fires, read only what that path directs.
4. Read `references/SHARED-JUDGMENT.md` and `references/AUTHORITY-POLICY.md` for every invocation. Read `references/EXECUTION-PROFILES.md` only when the depth this run needs is not already obvious from the request; a stated depth, a trivial ask, or a fast path answers it without reading anything. The trivial-change fast path overrides this step: when it fires, read only what that path directs. Read `references/QUESTION-FORMAT.md` before the first question to the user; it owns the decision-brief format, the structured-payload caps, and the prose fallback when no question tool is available. Infer Depth from structured operating conditions, then obey its mandatory modules, legal skips, artifacts, and claim limits. Read `references/RUNTIME.md` before capability-dependent work and `references/WEB-CONTEXT.md` before public-web work. When the target is a repository, read `references/CODE-INTELLIGENCE.md` once before substantive specialist work and follow its one-time indexing offer. Read `references/THIRD-PARTY-ACTIONS.md` before directing the user to act on a third-party website (API key registration, vendor accounts, dashboards).
5. If an old asset path is unavailable, use `references/ASSETS.md`. If legacy prose invokes another retired skill, resolve it through `references/COMPATIBILITY.md` and stay inside these five dispatchers.
6. Preserve report-only versus mutation boundaries. Missing mutation authorization fails closed: do not edit merely because a specialist can fix. Commits, pushes, PRs, merges, deploys, messages, and other external mutations still require affirmative authority from the user.
7. Match the user's language. Keep code identifiers, commands, and source quotations original when translation would reduce accuracy.
8. At exit, report completed artifacts, evidence, unresolved decisions, skipped modules with reasons, and any blocked gate.

9. Before push, PR creation/update, merge, deploy, rollback, release publication, or external notification, read `references/EXTERNAL-EFFECTS.md` and execute the action through its durable state wrapper.
10. When the release target is an Apple platform app (an `.xcodeproj`, `.xcworkspace`, or app-product Swift package is present), read `references/APPLE-RELEASE.md` FIRST — before any specialist preflight or repository gate — and follow its App Store journey end to end. An App Store or TestFlight ask is store distribution, not repository landing: the specialist branch/PR ceremony does not gate it, and a clean tree on the base branch is a valid state to archive and upload from.


## Trivial-change fast path

A trivial release carries no release surface: a copy, content, comment, doc, test, or single-value config edit across a handful of files, landing on a repository branch, with no public interface change, no schema or data migration, no dependency or build change, no auth/secret/payment path, and no deploy, canary, or store distribution in the ask. Classify from the prompt plus one cheap probe (the branch diffstat against the base, `git status --short` alongside it) before reading any reference file or specialist module. If the diffstat is enumerable and every changed path is content the probe can read at a glance, the release is trivial; do not load the release apparatus to confirm that.

When that trigger fires, read `references/FAST-PATH.md` and follow it. It is binding, it carries the whole path, and it is the only file this path reads.

## Top-level modes

| Mode | Target | Infer when | Candidate internal specialists |
|---|---|---|---|
| `Prepare` | A working branch or release artifact | The work needs checks, review, release metadata, documentation, commit, push, PR creation, or queue status. | `references/legacy/ship.md`, `references/legacy/landing-report.md`, `references/legacy/document-release.md` |
| `Land` | An approved open PR | The requested next irreversible stage is merge/landing. | `references/legacy/land-and-deploy.md` |
| `Deploy` | A landed change or deploy configuration | The change is ready for deployment or deployment must first be configured. | `references/legacy/setup-deploy.md`, `references/legacy/land-and-deploy.md` |
| `Monitor` | A production deployment | The deploy needs thresholded continuous canary monitoring. | `references/legacy/canary.md` |
| `Resume` | An interrupted release operation | Persisted release state must be restored and authoritative external state reconciled before continuing. | `references/legacy/context-restore.md`, `references/legacy/land-and-deploy.md` |

## Hard rules

- Never force push or bypass failing tests.
- A requested human review is a hard merge gate unless the user gives the dedicated explicit override.
- Breaking-change analysis overrides line-count bump heuristics.

## Internal specialist routing aliases

Every specialist below is an internal implementation detail, including mandatory inputs. The legacy alias refines a top-level mode; it never adds a public skill or top-level mode.

| Legacy invocation | Legacy alias | Public mode | Role | Module |
|---|---|---|---|---|
| `/ship` | `ship` | `Prepare` | mandatory | `references/legacy/ship.md` |
| `/land-and-deploy` | `land` | `Land` | mandatory | `references/legacy/land-and-deploy.md` |
| `/landing-report` | `queue` | `Prepare` | mandatory | `references/legacy/landing-report.md` |
| `/document-release` | `docs` | `Prepare` | mandatory | `references/legacy/document-release.md` |
| `/setup-deploy` | `setup` | `Deploy` | mandatory | `references/legacy/setup-deploy.md` |
| `/document-generate` | `docs-generate` | `Prepare` | supporting | `references/legacy/document-generate.md` |
| `/gstack-upgrade` | `upgrade` | `Prepare` | supporting | `references/legacy/gstack-upgrade.md` |
| `/ios-clean` | `ios-clean` | `Prepare` | supporting | `references/legacy/ios-clean.md` |
| `/ios-sync` | `ios-sync` | `Prepare` | supporting | `references/legacy/ios-sync.md` |

## Completeness invariant

Do not work from this dispatcher summary when a module is active. Read the referenced module completely, including its provenance marker, specialist workflow, lazy-phase directives, behavioral contract, and bug-fix overlays. The pinned 1.x shared onboarding wrapper is provenance-only and never runs during canonical execution.
