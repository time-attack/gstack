# Fast paths

Read this only when one of the two fast-path triggers in SKILL.md has already fired. It carries the detail for both. Each path reads this file and nothing else.

## The fast-path header

Both entries print a reduced header, not the full block in SKILL.md. Three fields, in this order:

```text
Target: <concrete repository, product, URL, device, PR, or artifact>
Mutation: <report-only, or the exact authorized mutation boundary>
Verification: <the check, plus the axes it does not cover; or `none (reason)`>
```

Every other label in the full block is dropped, not filled with a guess. Neither entry reads a specialist module or rates a depth, so a printed Mode, Depth, Scale, Role, Active modules, Skipped modules, or Web context line would carry no information a reader can act on. Say in one sentence which entry fired and that no module was read.

Three rules keep the Verification line honest. They are inlined here because this file is the whole path.

1. Capture the check before the first edit. A check written afterwards describes what the work did; it does not test whether the work is right.
2. Keep the check outside the mutation boundary. This run may not edit the check, its fixtures, its baseline, or its threshold. Weakening, deleting, regenerating, re-thresholding, narrowing, or skipping it so that it passes is a contract violation, not a pass, and it voids the claim.
3. Name the axes the check leaves alone, as `not covered: <axes>`. A check binds what it measures and says nothing about the rest, so the uncovered axes are remaining work, not a footnote.

When no check can be captured before the work starts, the value is `none` with the reason. That is legal and expected. A run that prints it claims nothing is verified.

## Empty target

The trigger: one cheap listing (`ls -A`) showed an empty working tree, or a tree holding only VCS/tooling metadata.

Print the fast-path header immediately with `Target: <path> (empty repository — greenfield)`, state in the first sentence after the header that the repository is empty, and plan from the prompt alone. Skip decision-store recall, repository scanning, and every specialist phase whose input is existing code — there is none. If the prompt carries no idea to plan, ask the single question of what the user wants to build before reading any module. An empty tree fixes the codebase vector at greenfield; scale comes from the prompt alone.

## Trivial change

The trigger: one cheap probe showed edits that are enumerable and free of judgment calls, or an oracle-backed run whose check already exists or can be captured before the first edit.

On the trivial path:

- Print the fast-path header named above, and nothing else from the full block in SKILL.md. On the oracle-backed entry, make the plan the Verification line plus the concrete edit list; when the check does not exist yet, capturing it is step one and nothing else starts until it is captured and committed where this run may not edit it. Skip every specialist module and every per-invocation reference from dispatch step 4 — the probe already answered everything a module would ask. The three rules above are what decide whether the oracle-backed entry was legitimate; nothing else is read to judge it.
- The plan is the concrete edit list: file, symbol, before → after. Nothing else. When the prompt is itself the mutation instruction ("rename X to Y across this repo"), that is affirmative mutation authority: print it on the Mutation line, apply the edits, and report — the same principle every specialist already carries, that a fix which is obvious and inside the authorized mutation boundary is applied and reported, not asked about.
- Ask at most one clarifier, and only for genuine ambiguity the probe surfaced (two distinct `calc` symbols, a collision with an existing name). Alias-versus-clean-rename, add-a-test-or-not, and other reversible defaults are decided, not asked: clean rename, follow the repo's existing test habits, and say what you chose in one line.
- Suppress the ceremony entirely: no pre-mortem, no coverage diagram, no failure-modes table, no scores, no worktree-parallelization advice, no mode upsell. A rename does not need a report; it needs the rename.

## When the trivial path does not apply

If the probe surfaces real design surface — the symbol is a published API with external consumers, the "rename" is actually a behavior change, or the surface is large enough that sequencing matters — the change is not trivial. Fall back to normal dispatch and say why in one line.

The oracle-backed entry must fall back the same way when the reference cannot be captured before the first edit, when the work would have to touch the check or its baseline or its threshold, when the check fires at random, or when the request hides a decision no check can see: goal selection, a one-way door (schema, public interface, auth model, data retention, vendor, pricing), an absence property at real stakes (security, privacy, money, compliance), taste, or a stated goal that is not the real goal. Those are `Verification: none` runs. They keep the full specialist apparatus, because a plan nobody can check is where question pressure earns its cost, and they claim nothing is verified.
