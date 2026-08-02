# Fleet metrics contract

Every persona-fleet round records the same twenty-odd numbers so rounds are
comparable and a regression is visible. Correctness alone does not tell you
whether a tool is worth using; most people quit over time, cost, and friction.

Five families. A round that omits a family is reported as omitting it, never
silently.

Quitting is one of the outcomes and it has its own contract in
[ABANDONMENT.md](ABANDONMENT.md). Read that before running a round.

## 0. Run artifacts

Every metric below resolves to an artifact or it is marked self-reported.
Round 1 skipped this and the damage was concrete: two verifier-pinned runs
came in 33% and 45% above the persona's own elapsed figure, 4 of 10 audited
sandboxes had empty transcript directories, and one persona reported asking a
question in a 154-record transcript containing no AskUserQuestion block at
all.

Each run writes one append-only NDJSON file, `run.jsonl`, in the sandbox run
directory. NDJSON means one JSON object per line.

**The harness writes the first line before the persona sees the task:**

```json
{"type":"t0","ts":"2026-08-02T10:00:00Z","run":"p07","round":2,"caps":{"capSecondsTotal":900}}
```

`t0` is machine-written or the run is invalid. It is the only way elapsed time
is a measurement rather than a convention. A persona writing its own start
time is writing down when it remembered to start counting.

The rest of the file is the `claude -p --output-format stream-json --verbose`
transcript, plus the `quit` record if the run abandons.

**The harness writes the last line too**, on every exit path, accepted or
abandoned or crashed:

```json
{"type":"tEnd","ts":"2026-08-02T10:14:22Z","run":"p07","outcome":"accepted"}
```

Both bookends are machine-written because stream-json records carry no
timestamp of their own. Without `tEnd` there is nothing to subtract `t0` from.

**Validity preconditions.** A run is invalid, and is dropped from every median
with the drop stated in the report, if any of these hold:

- `run.jsonl` is missing, empty, or is missing either the `t0` or the `tEnd`
  line.
- It has no `{"type":"result"}` line and no `quit` line.
- Its outcome is `abandoned` and it has no `quit` line.

Round 1 had 4 empty transcript directories out of 10 audited. Under this rule
those are 4 dropped runs and a stated denominator, not 4 silent rows of
self-reported numbers.

**Extraction.** These are the commands, not a description of them:

```bash
# secondsTotal: tEnd minus t0, the only two lines that carry a timestamp
jq -s '[ .[] | select(.type=="t0" or .type=="tEnd") | .ts | fromdate ]
       | .[1] - .[0]' run.jsonl

# dollarsSpent
jq -s 'map(select(.type=="result")) | last | .total_cost_usd' run.jsonl

# turnsToDone
jq -s 'map(select(.type=="result")) | last | .num_turns' run.jsonl

# usageTokensTotal
jq -s 'map(select(.type=="result")) | last | .usage
       | (.input_tokens + .output_tokens + (.cache_read_input_tokens // 0))' run.jsonl

# questionsAsked: counted, never recalled
jq -s '[ .[] | .message.content[]?
       | select(.type=="tool_use" and .name=="AskUserQuestion") ] | length' run.jsonl

# referenceFilesRead
jq -s '[ .[] | .message.content[]?
       | select(.type=="tool_use" and .name=="Read") | .input.file_path ]
       | map(select(test("/references/"))) | unique | length' run.jsonl
```

**Every recorded metric carries a source.** Write each one as a value plus a
`source` that is either a resolvable path with a record range, or the literal
string `self-report`:

```json
{"questionsAsked": {"value": 2, "source": "run.jsonl#L14,L31"},
 "questionsAnswerable": {"value": 1, "source": "self-report"}}
```

If the path does not resolve when the verifier checks it, the metric becomes
`self-report`. It does not become `null`, and it does not stay as-is.

## 1. Speed

| Metric | Definition |
|---|---|
| `secondsToFirstUsefulOutput` | From the `t0` record to the first line that answers the ask. Not the header, not the plan of a plan. The end of the interval is a persona judgment, so cite the record it landed on. |
| `secondsTotal` | From the `t0` record to the last record in `run.jsonl`. Measured, never estimated. |
| `turnsToDone` | `num_turns` from the result line. |
| `probeCount` | Shell/file probes before the first substantive output. Proxy for how much it looked around before doing anything. |

## 2. Cost

| Metric | Definition |
|---|---|
| `contextLoadedTokens` | `gstack context-bill` on the installed tree for the path actually taken. Capped, see ABANDONMENT.md. |
| `referenceFilesRead` | Distinct skill reference files opened. The bloat number people feel. |
| `dollarsSpent` | **Required.** `total_cost_usd` from the final result line. Round 1 reported 0 across all 48 runs because nobody read the field, not because the runs were free. A round that cannot produce this number is not runnable, so fix the harness before running it. |
| `usageTokensTotal` | Input plus output plus cache-read from the result line. Recorded in round 2 with no cap, so a later round can set one from a real distribution. |
| `costPerAcceptedResult` | `dollarsSpent` divided by accepted results. Blank when nothing was accepted. |

## 3. Patience

Round 1's patience family was entirely self-reported and at least one figure
was flatly contradicted by the transcript. Two of the four are countable from
`run.jsonl`. Count those. Mark the other two.

| Metric | Definition |
|---|---|
| `questionsAsked` | AskUserQuestion blocks before any substantive work. Counted from `run.jsonl` with the command in section 0. Never recalled. |
| `questionsAnswerable` | How many the persona could answer without going and looking something up. Self-reported by nature. Marked `self-report`, and it can never exceed a counted `questionsAsked`. |
| `interventionsRequired` | Times the human had to step in to keep it moving. Counted as user-role records after the first, from `run.jsonl`. |
| `stopGatesHit` | Approval gates encountered. The count is from the transcript. Whether each was warranted is `self-report`. |

## 4. Rage

Frustration is an event count, not a mood. Each event is one thing the tool did
that a real person would swear at.

| Metric | Definition |
|---|---|
| `wrongAssumptions` | It assumed something about the project that was false (framework, branch, command, layout). |
| `unaskedActions` | It did something nobody asked for. |
| `ignoredInstructions` | It was told something and did otherwise. |
| `deadEnds` | Paths that led nowhere and had to be abandoned. |
| `repeatedItself` | Re-asked or re-derived something already established. |
| `ceremonyEvents` | Output sections the persona skipped without reading. |
| `rageScore` | Sum of the above. Not weighted: every one of these is a person exhaling through their nose. |

## 5. Verification

| Metric | Definition |
|---|---|
| `oracleCaptured` | A falsifiable check existed before the work started. |
| `oracleReRunnable` | An independent verifier could re-run it. |
| `oraclePassed` | It passed on re-run, by the verifier, not by the persona. |
| `claimedDoneWithoutEvidence` | It said done and showed nothing. The single most damaging failure mode. |
| `evidenceOffered` | Command plus exit code, or a diff, or a screenshot. |

## Outcome

`accepted` | `accepted-with-friction` | `abandoned` | `invalid`

`abandoned` is a first-class outcome and must be reachable. A fleet where
nobody can quit is measuring compliance, not usability. Round 1 abandoned 0 of
48, which is a dead dependent variable, not a clean bill of health. The caps
and the quit mandate that make it reachable are in
[ABANDONMENT.md](ABANDONMENT.md). An `abandoned` run also records its
`quitTrigger`.

`invalid` is a run that failed a validity precondition in section 0. It is not
a fourth kind of result. It is a run that produced no data, and it is
subtracted from the denominator with the subtraction stated.

## Reporting rules

- Unmeasured is written `null` and reported as unmeasured. Never estimated.
- Every metric ships with its `source`. Any metric whose source is
  `self-report` is labelled self-reported everywhere it appears, including in
  the summary line. A self-reported number and a counted number never share a
  median.
- Verifier-confirmed numbers and persona-reported numbers are kept in separate
  columns. They disagree, and the disagreement is a finding.
- Report the valid-run count next to every median. `median 294s (n=44 of 48
  valid)` is a number. `median 294s` is a claim.
- Round-over-round comparison needs the same task mix and the same cap values.
  Changing either and reporting a delta is comparing two different things.
