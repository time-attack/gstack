# Fleet metrics contract

Every persona-fleet round records the same twenty-odd numbers so rounds are
comparable and a regression is visible. Correctness alone does not tell you
whether a tool is worth using; most people quit over time, cost, and friction.

Five families. A round that omits a family is reported as omitting it, never
silently.

## 1. Speed

| Metric | Definition |
|---|---|
| `secondsToFirstUsefulOutput` | Wall clock from invoking the skill to the first line that answers the ask. Not the header, not the plan of a plan. |
| `secondsTotal` | Invocation to a result the persona would accept. |
| `turnsToDone` | Model turns consumed. |
| `probeCount` | Shell/file probes before the first substantive output. Proxy for how much it looked around before doing anything. |

## 2. Cost

| Metric | Definition |
|---|---|
| `contextLoadedTokens` | `gstack context-bill` on the installed tree for the path actually taken. |
| `referenceFilesRead` | Distinct skill reference files opened. The bloat number people feel. |
| `dollarsSpent` | If the host reports it. |
| `costPerAcceptedResult` | `dollarsSpent` divided by accepted results. Blank when nothing was accepted. |

## 3. Patience

| Metric | Definition |
|---|---|
| `questionsAsked` | Questions before any substantive work. |
| `questionsAnswerable` | How many the persona could answer without going and looking something up. |
| `interventionsRequired` | Times the human had to step in to keep it moving. |
| `stopGatesHit` | Approval gates encountered, and whether each was warranted. |

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

`accepted` | `accepted-with-friction` | `abandoned`

`abandoned` is a first-class outcome and must be reachable. A fleet where
nobody can quit is measuring compliance, not usability.

## Reporting rules

- Unmeasured is written `null` and reported as unmeasured. Never estimated.
- Verifier-confirmed numbers and persona-reported numbers are kept in separate
  columns. They disagree, and the disagreement is a finding.
- Round-over-round comparison needs the same task mix. Changing the mix and
  reporting a delta is comparing two different things.
