# Verification contract

Name the check before the steps. The check is what makes the outcome real. The
steps are detail a capable model infers, and prescribing them buys less than
naming what will fail if the work is wrong.

The header's Verification line carries one of two values:

```text
Verification: <check> | not covered: <axes the check says nothing about>
Verification: none (<why no check can be captured before the work starts>)
```

## Rules

1. **Author the check before the work.** Capture the baseline, the recording,
   or the failing repro before the first edit. A check written after the work
   describes what the work did; it does not test whether the work is right. If
   it cannot be captured first, the value is `none`.
2. **Name an input, an observable, and a threshold.** "Tests pass", "no
   regressions", "looks right", "fast enough" name none of the three. If no
   state of the world fails the check, it is not a check: say `none`.
3. **Keep the check outside the mutation boundary.** Weakening, deleting,
   regenerating, re-thresholding, narrowing, skipping, or re-running a subset of
   the check so that it passes is a contract violation, not a pass, and it voids
   the claim. If the work must touch the check, its fixtures, its baseline, or
   its threshold, that diff is reported and approved on its own first.
4. **Unrun is unverified.** Report the exact command, its exit code, and the
   baseline it ran against, or report "not verified". A failure is not
   pre-existing without a run on the base branch showing the same failure.
5. **Name the axis the check does not cover.** A check binds what it measures
   and quietly hollows out every requirement it omits. A green pixel comparison
   over a rewritten app says nothing about what happens when the user taps.
   Carry the uncovered axes to the exit report as remaining work.
6. **`none` is legal and expected.** Goal selection, one-way doors (schema,
   public interface, auth model, data retention, vendor, pricing), taste, and
   underspecified requests have no check that runs inside the session. Print
   `none` with the reason, keep the full specialist apparatus and its question
   pressure on, and call nothing in that run verified.
7. **Absence properties get a coverage boundary, not a verdict.** "No auth
   bypass", "no personal data leaves the machine": say what was checked and what
   was not. A scan that found nothing because it looked nowhere is not a proof.
8. **If the check does not exist yet, building it is step one of the plan.**
   Not a prerequisite that excuses skipping it, and not a follow-up ticket.
9. **In Specification mode the check targets the artifact.** The deliverable is
   the acceptance criteria, so it cannot be gated on itself. Usable value: a
   second agent handed only this issue produces a diff that satisfies every
   acceptance criterion with zero clarifying questions.

## What a real check buys

When the check already exists and this run may not edit it, the plan is the
check plus the edit list, and the oracle-backed entry to the trivial-change fast
path applies: skip the pre-mortem, the coverage diagram, the failure-modes
table, and the scores, and name the skips in one line. Telling a modern model
how to write the migration adds nothing. Telling it what will fail if the
migration is wrong is the plan.

Suppression never skips a STOP gate, an approval boundary, or the mutation
boundary. Those are consent, not ceremony.

## Examples

```text
Verification: for each of the 14 screens in screens.txt, render the pre-change
  build from worktree @a3f21c and the new build, capture both after network
  idle at scale 2, diff; every pair under 0.1% differing pixels and no console
  errors. Baselines captured at a3f21c before the first Swift file exists and
  committed outside the mutation boundary.
  | not covered: behavior on tap, persistence, error and empty states,
  VoiceOver, Dynamic Type, launch time, any screen absent from screens.txt.
```

No image comparison tool exists in this repo, so writing one is step one
(rule 8). The runnable-today substitute is a text snapshot per screen committed
before the work, then `git diff --exit-code` over that directory after it, which
also ignores font and antialiasing noise.

```text
Verification: none (the plan selects what to build; no check inside this session
  separates a product users want from one they do not). Demand evidence and
  premise challenge stay on.
```
