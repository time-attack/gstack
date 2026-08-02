# Verification contract

Name the check before the steps. The check is what makes the outcome real. The
steps are detail a capable model infers, and prescribing them buys less than
naming what will fail if the work is wrong.

The header's Verification line carries one of these values:

```text
Verification: <check> | not covered: <axes the check says nothing about>
Verification: ledger <path>, <N> <members> from `<command>` at <sha>
  | <C> covered, <W> waived (<P>%), stub sweep <S>/<N> survive,
    vectors per member min <a> median <b>
  | not covered: <axes>
Verification: sampled <N> of <universe> | <check> | not covered: <axes>
Verification: none (<why no check can be captured before the work starts>)
```

Totality is a property of the deliverable, not a word in the prompt. Ask what
plural noun the work ranges over; if the answer has more than one member and a
command can list them, the ledger value is required. Every, all, each, entire,
complete, 1:1, pixel by pixel are examples of the trigger, not the test: a
request to "redesign the settings screen" ranges over its controls whether or
not it says "every". Restating the request over a smaller population than the
user posed is a scope change under rule 14, not a classification. A ledger is
one file with one line per thing the work ranges over. Rules 10 through 15 own
it.

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
   its threshold, that diff is reported and approved on its own first. Authoring
   a new comparator, normalizer, or tolerance is the same act as loosening an old
   one. Each difference it masks is a waiver row under rule 14 and carries the
   count of vectors it fires on: "error-text normalizer, fires on 1,190 of 1,204
   vectors" is a confession, not a footnote.
4. **Unrun is unverified.** Report the exact command, its exit code, and the
   baseline it ran against, or report "not verified". A failure is not
   pre-existing without a run on the base branch showing the same failure.
5. **Name the axis the check does not cover.** A check binds what it measures
   and quietly hollows out every requirement it omits. A green pixel comparison
   over a rewritten app says nothing about what happens when the user taps.
   Carry the uncovered axes to the exit report as remaining work. Naming an axis
   is not absolution: an axis a cheap check could have covered is work still
   owed, and it blocks the completion claim rather than annotating it.
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

When the work has an enumerable population and a per-member check a stub
fails, rules 10 through 15 in `references/TOTAL-VERIFICATION.md` are binding and
must be read before the total check is authored.
