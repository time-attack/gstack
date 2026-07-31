# GStack evaluation-platform bake-off — 2026-07-21

This run compared evaluation frameworks, not language models. All inputs were
synthetic. Every platform received the same three cases, paired baseline and
candidate outputs, and the same deterministic required-term scorer.

## Executed systems

| Platform | Execution path | Baseline | Candidate | Runtime evidence |
|---|---|---:|---:|---|
| Langfuse 3 / Python SDK 3.7.0 | Official six-container self-hosted stack, persisted datasets, experiment runs, traces, and scores | 16.7% | 100% | 4 dataset runs and 18 traces retrieved from its local API |
| Braintrust SDK 0.3.15 | Supported `no_send_logs=True` local evaluator | 16.7% | 100% | Native evaluator summaries returned for both experiments |
| DeepEval 4.1.2 | Local `evaluate()` runner and custom `BaseMetric` | 0% pass | 100% pass | Two structured test-run JSON exports |

The baseline's individual scores were `[0.5, 0, 0]`; the candidate's were
`[1, 1, 1]`. All three frameworks detected the intended regression signal.

## Measured execution overhead

These timings measure framework orchestration for three deterministic cases;
they exclude model inference.

| Platform | Baseline | Candidate |
|---|---:|---:|
| Braintrust local | 11.31 ms | 1.64 ms |
| DeepEval local | 35.07 ms | 16.37 ms |
| Langfuse self-hosted | 867.31 ms | 958.49 ms |

Langfuse persisted substantially more state, so its time is not directly
equivalent to the local-only paths.

## Self-hosted Langfuse footprint

The live stack consumed approximately 2.33 GiB of RAM after the experiment:

- Web: 928 MiB
- Worker: 424 MiB
- ClickHouse: 805 MiB
- PostgreSQL, Redis, and MinIO: 171 MiB combined

The six downloaded images total approximately 5.3 GB by reported image size.

## Decision from executed evidence

Braintrust currently has the best lightweight evaluator ergonomics for a
GStack adapter. DeepEval has the best fully local test-run workflow. Langfuse
has the strongest self-hosted persistence and visual experiment foundation,
but its local operational footprint is too large to make it a mandatory GStack
runtime dependency.

Keep the GStack corpus and scorer schema provider-neutral. Any vendor backend
must remain optional and consent-gated. Hosted dashboards for Braintrust,
Confident AI, and Parea were not executed in this run because no authenticated
projects were available; their documentation was not counted as benchmark
evidence.
