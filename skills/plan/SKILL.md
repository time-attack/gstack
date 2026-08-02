---
name: plan
description: >-
  Plan products, scope, architecture, developer experience, or executable specs before implementation. Use for ideas, strategic or engineering reviews, autoplan, and planning preferences.
---

# GStack Plan

Choose one planning specialist, preserve its question pressure and gates, and produce an executable decision artifact.

## Required execution header

Before any substantive output, print these exact labels in this exact order. Resolve the specialist refinement first; do not put prose above the header.

```text
Target: <concrete repository, product, URL, device, PR, or artifact>
Mode: <selected top-level mode>
Depth: <readiness, standard, or deep>
Scale: <session, hobby, project, product, or venture — name the deciding vectors>
Mutation: <report-only or exact authorized mutation boundary>
Verification: <the check that fails today, passes only when this plan's outcome is real, and that this run may not edit, plus what it does not cover; or `none (reason)`>
Role: <author (produces the plan) or reviewer (critiques a plan the user supplied)>
Active modules: <comma-separated internal specialist modules>
Skipped modules: <comma-separated non-active mandatory modules with compact reasons>
Web context: <none, optional, local-browser, or production>
```

## Dispatch protocol

1. Infer the mode from product stage, surface, requested artifact, mutation authorization, evidence needs, and deployment state. Do not route by keyword alone.
2. Refine the public mode to the smallest applicable internal specialist set, then print the required execution header before any substantive output.
3. Read each active module in full from the path shown in the mode/alias tables. Its specialist body, behavioral contract, STOP gates, and appended upstream judgment ports are binding. Read a lazy specialist phase in full only when the workflow reaches its package-local reference. The empty-target and trivial-change fast paths override this step: when one fires, read only what that path directs.
4. Read `references/EXECUTION-PROFILES.md`, `references/SHARED-JUDGMENT.md`, and `references/AUTHORITY-POLICY.md` for every invocation. The empty-target and trivial-change fast paths override this step: when one fires, read only what that path directs. Read `references/QUESTION-FORMAT.md` before the first question to the user; it owns the decision-brief format, the structured-payload caps, and the prose fallback when no question tool is available. Infer Depth from structured operating conditions, then obey its mandatory modules, legal skips, artifacts, and claim limits. Read `references/RUNTIME.md` before capability-dependent work and `references/WEB-CONTEXT.md` before public-web work. When the target is a repository, read `references/CODE-INTELLIGENCE.md` once before substantive specialist work and follow its one-time indexing offer. Read `references/THIRD-PARTY-ACTIONS.md` before directing the user to act on a third-party website (API key registration, vendor accounts, dashboards). Read `references/VERIFICATION-CONTRACT.md` before printing the header; it owns the Verification line, the rules that keep the check honest and un-gameable, and the conditions under which `none` is the correct value. Read `references/TOTAL-VERIFICATION.md` before authoring a total check, that is, when the work ranges over an enumerable population and a per-member check a stub fails; it owns rules 10 through 15, the ledger arithmetic, the waiver discipline, and the worked examples.
5. If an old asset path is unavailable, use `references/ASSETS.md`. If legacy prose invokes another retired skill, resolve it through `references/COMPATIBILITY.md` and stay inside these five dispatchers.
6. Preserve report-only versus mutation boundaries. Missing mutation authorization fails closed: do not edit merely because a specialist can fix. Commits, pushes, PRs, merges, deploys, messages, and other external mutations still require affirmative authority from the user.
7. Match the user's language. Keep code identifiers, commands, and source quotations original when translation would reduce accuracy.
8. At exit, report completed artifacts, evidence, unresolved decisions, skipped modules with reasons, and any blocked gate.

9. Classify the Scale header line from the Build scale section before any questioning begins. Every planning specialist applies its proportional-planning judgment port to that scale.

## Empty-target fast path

Probe the target directory with one cheap listing (`ls -A`) before reading any reference file or specialist module. If the working tree is empty or holds only VCS/tooling metadata (`.git`, `.gitignore`, editor or CI config), do not spend further reading discovering that: read `references/FAST-PATH.md` and follow its empty-target section. It is binding, it carries the whole path, and it is the only file this path reads.

## Trivial-change fast path

A trivial change is mechanical and fully specified by the prompt: a rename, move, or inline across a small surface, with no design decision to make and no new capability to shape. The same path also opens for oracle-backed work, where a reference this run may not edit already exists or can be captured before the first edit (the pre-change tree, a committed baseline, a recorded trace, a failing repro), so the check decides whether the work is right and no amount of prescription adds to it. Classify from the prompt plus one cheap probe (a grep for the symbol, a file listing) before reading any reference file or specialist module — the same probe budget as the empty-target path. If the edits are enumerable from the probe and none of them is a judgment call, the change is trivial; do not load the specialist apparatus to confirm that.

When either entry fires, read `references/FAST-PATH.md` and follow its trivial-change section. It is binding, it carries the whole path, and it names the one other reference the oracle-backed entry reads. Nothing else is read on either entry.

## Build scale

Classify the request on fifteen scale vectors before any questioning begins, from the prompt and cheap repository evidence only. Never run a questioning round merely to classify scale. Default unknown vectors to the low end; the specialist's own workflow raises the scale naturally when answers reveal more (builder talk turning into startup talk upgrades mid-session).

Vectors: audience (self → friends/team → public), expected users (none → handful → many), commercial intent (none → maybe → core), deployment target (none/local → hosted → production), time horizon (one sitting → days → weeks → months+), maintenance expectation (throwaway → kept → maintained), integration surface (standalone → consumes APIs → exposes APIs/multi-service), extensibility ask (fixed → configurable → customizable platform), data sensitivity (none → personal → regulated), failure stakes (lost fun → annoyance → money/trust/safety), team (solo → few → org), codebase (greenfield → existing repo → legacy production), reversibility (discardable → migrations/breaking changes), distribution (private → shared → published), compliance (none → some → audited).

The highest tier any vector demands wins: `session` (all vectors low — one sitting, for fun, self only), `hobby` (kept personal tool, days), `project` (shared or in a real repo, weeks), `product` (external users, hosted, revenue intent), `venture` (startup ambition, platform/API surface, team, months+). "A cool space animation in my terminal" is session-scale. "A startup with customizable APIs" is venture-scale. Print the result on the header's Scale line with the two or three vectors that decided it.

An explicit user time constraint is a ceiling, not one vector among fifteen: work that must fit one sitting (a hackathon demo, a stated hour count, "before my flight") caps the scale at `session`, and a day-or-two deadline caps it at `hobby`, no matter how public the audience or how ambitious the idea. The user's clock outranks every ambition vector. Print the constraint with the scale: `Scale: session (hackathon, one sitting)`.

The scale binds the whole chain, not just this invocation, and fixes a chain-wide question budget: five total questions at `session`, eight at `hobby`, twelve at `project`, uncapped at `product` and `venture` (approval STOP gates excluded). Every handoff to a chained review or specialist names the scale, any time box, and the questions already spent; the receiving workflow applies its proportional-planning port to the inherited scale and the remaining budget without re-asking or re-classifying upward.


## Top-level modes

| Mode | Target | Infer when | Candidate internal specialists |
|---|---|---|---|
| `Discovery` | Unshaped idea or product premise | The problem, user, wedge, or value proposition is still fluid. | `references/legacy/office-hours.md` |
| `Product` | Product scope and strategic plan | The plan exists and the main uncertainty is scope, ambition, or product trajectory. | `references/legacy/plan-ceo-review.md` |
| `Engineering` | Architecture and implementation plan | The plan needs architecture, data, failure-mode, performance, or test review. | `references/legacy/plan-eng-review.md` |
| `DX` | Developer-facing plan | Developers, SDK/CLI/API consumers, onboarding, or documentation are the product surface. | `references/legacy/plan-devex-review.md` |
| `Specification` | Backlog-ready executable specification | Intent must become acceptance criteria, issue structure, testing, rollback, and handoff. | `references/legacy/spec.md` |
| `Full chain` | Cross-functional plan | The user wants the full CEO/engineering/DX chain with automatic routing. | `references/legacy/autoplan.md` |

## Hard rules

- Never silently expand scope.
- Never skip a selected review phase without listing the evidence for the skip.
- Do not implement product code from this dispatcher unless the user explicitly changes Mutation.

- Global Context search is deprecated. Use explicit context-save/context-restore state; do not imply an unbounded global search capability.

## Internal specialist routing aliases

Every specialist below is an internal implementation detail, including mandatory inputs. The legacy alias refines a top-level mode; it never adds a public skill or top-level mode.

| Legacy invocation | Legacy alias | Public mode | Role | Module |
|---|---|---|---|---|
| `/gstack` | `catalog` | `Discovery` | supporting | `references/legacy/gstack.md` |
| `/office-hours` | `product` | `Discovery` | mandatory | `references/legacy/office-hours.md` |
| `/plan-ceo-review` | `ceo` | `Product` | mandatory | `references/legacy/plan-ceo-review.md` |
| `/plan-eng-review` | `eng` | `Engineering` | mandatory | `references/legacy/plan-eng-review.md` |
| `/plan-devex-review` | `dx` | `DX` | mandatory | `references/legacy/plan-devex-review.md` |
| `/autoplan` | `auto` | `Full chain` | mandatory | `references/legacy/autoplan.md` |
| `/spec` | `spec` | `Specification` | mandatory | `references/legacy/spec.md` |
| `/plan-tune` | `preferences` | `Discovery` | mandatory | `references/legacy/plan-tune.md` |
| `/context-save` | `context-save` | `Discovery` | supporting | `references/legacy/context-save.md` |
| `/context-restore` | `context-restore` | `Discovery` | supporting | `references/legacy/context-restore.md` |
| `/learn` | `learning` | `Discovery` | supporting | `references/legacy/learn.md` |
| `/retro` | `retro` | `Discovery` | supporting | `references/legacy/retro.md` |
| `/setup-gbrain` | `memory-setup` | `Discovery` | supporting | `references/legacy/setup-gbrain.md` |
| `/sync-gbrain` | `memory-sync` | `Discovery` | supporting | `references/legacy/sync-gbrain.md` |

## Completeness invariant

Do not work from this dispatcher summary when a module is active. Read the referenced module completely, including its provenance marker, specialist workflow, lazy-phase directives, behavioral contract, and bug-fix overlays. The pinned 1.x shared onboarding wrapper is provenance-only and never runs during canonical execution.
