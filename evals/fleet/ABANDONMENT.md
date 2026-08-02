# Abandonment contract

Round 1 ran 48 personas and abandoned 0 of them. Zero of 48 is not a good
result. It is a dead variable. With no variance in the outcome, no driver of
abandonment is computable, and every "what makes people quit" question the
round was built to answer stayed unanswered.

The cause is structural, not statistical. An instrumented persona is paid to
finish. A real user is not. Round 1 therefore measured friction and printed it
under the word abandonment.

This file makes quitting reachable by making it mandatory under declared
conditions. A persona that hits a cap stops. Not "considers stopping". Stops,
writes the quit record, and the run ends.

## The quit mandate

Every persona brief must carry this text verbatim, near the top, before the
task:

> You may quit. Quitting is a valid outcome and is not a failure of your run.
> If any cap below trips, you MUST stop immediately, write the quit record,
> and do no further work. You may also quit before a cap trips if you would
> have quit in real life. Say why.

Without the mandate the caps do nothing. A persona that reads "finish the
task" at the top and a cap table at the bottom finishes the task.

## Caps

Five caps. Each is machine-checkable from the run artifacts described in
[METRICS.md](METRICS.md). Each round declares its cap values in
`round.json` and records which one tripped.

| Cap | Round 2 value | Basis |
|---|---|---|
| `capSecondsToFirstUsefulOutput` | 300 | Round 1 median was 88s. Five minutes with nothing useful on screen is the closest cap to how people actually behave. |
| `capSecondsTotal` | 900 | Round 1 median was 294s persona-reported, and two verifier-pinned runs came in 33% and 45% higher. Roughly 2x an honest median. |
| `capContextLoadedTokens` | 40000 | Round 1 median was 13,501. About 3x. |
| `capConsecutiveDeadEnds` | 3 | Three paths in a row that went nowhere. Not three total. |
| `capRageScore` | 15 | Round 1 median was 7. About 2x. |

Two notes on these numbers, because a cap presented without its provenance
gets treated as a law.

They are round-1-derived, and round 1 measured a fixed task mix. Re-declare
them whenever the mix changes. A cap carried across a mix change is comparing
two different things.

There is deliberately no cap on cumulative tokens burned by the run, as
distinct from context loaded. Round 1 did not record that number, so any value
here would be invented. Round 2 records it (see `usageTokensTotal` in
METRICS.md) with no cap attached. Round 3 can set one from a real
distribution.

### The question cap, and why it is probably dead on arrival

`capUnanswerableQuestions` is 3: three questions the persona could not answer
without going and looking something up.

Round 1 asked 0 questions across 48 runs, against 60 wrong assumptions. This
cap will almost certainly never trip. It is here so that the reverse
regression is visible. If a future change makes the tool ask more, this cap
catches the overcorrection instead of letting it land as "more thorough".

## Walk-away

A persona may quit under every cap. The trigger is `judgment` and the record
requires a free-text reason in the persona's own words. This is the only
self-reported quit trigger and it is marked as such everywhere it appears.

Round 1's finding was that paid personas do not walk away. Expect very few of
these. A `judgment` quit with a specific reason is worth more than the other
four triggers put together, because it is the only one that is not the harness
enforcing an arbitrary number.

## The quit record

On abandonment, append one record to the run's `run.jsonl` and stop:

```json
{"type":"quit","ts":"2026-08-02T10:14:22Z","trigger":"capSecondsTotal","capValue":900,"observedValue":1204,"lastAction":"re-reading review-army.md for the second time","reason":"free text, required for trigger=judgment, optional otherwise"}
```

`trigger` is one of `capSecondsToFirstUsefulOutput`, `capSecondsTotal`,
`capContextLoadedTokens`, `capConsecutiveDeadEnds`, `capRageScore`,
`capUnanswerableQuestions`, `judgment`.

`observedValue` is the number that broke the cap, taken from the artifacts,
not from recall. For `judgment` both value fields are `null`.

A run whose outcome is `abandoned` and has no `quit` record is invalid, the
same as a run with an empty transcript. Drop it and say you dropped it.

## Reporting

Report abandonment as a table of which cap tripped, not as a single rate:

| Trigger | Runs | Median elapsed at quit | Median dollars at quit |
|---|---|---|---|

Then the two rates, separately:

- `abandonRateForced` = runs quit by a cap, divided by valid runs.
- `abandonRateJudgment` = runs quit by walk-away, divided by valid runs.

Mixing them hides the only interesting one.

## What this will and will not show

It will show which cap trips first and how often, what a run had cost in time
and dollars at the moment it tripped, and whether a change moves runs closer
to a cap or further from it. That is a real dependent variable with real
variance, which is exactly what round 1 lacked.

It will not show a churn rate. `abandonRateForced` is a property of the cap
values, and the cap values are ours. Move a cap, move the rate. Nobody should
quote it as "N% of users would quit". The number that comes closest to that
claim is `abandonRateJudgment`, and round 1 gives every reason to expect it to
be small.
