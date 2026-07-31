# Evaluation-platform bake-off

This harness sends the same synthetic corpus and deterministic scorer through
real Langfuse, Braintrust, and DeepEval execution paths. It deliberately does
not compare language models.

The Python script is retained only as reproducible research evidence for the
cross-platform bake-off. It is not part of the GStack runtime or installation.
The production benchmark command now evaluates JSON rubrics natively in
TypeScript/Bun:

```bash
gstack-model-benchmark --prompt "..." \
  --rubric evals/platform-bakeoff/gstack-rubric.example.json
```

- Langfuse uses the complete official self-hosted Docker stack and hosted
  datasets/experiment runs within that local instance.
- Braintrust uses its supported local `no_send_logs` execution path.
- DeepEval uses its local evaluation runner and custom metric API.

Hosted Braintrust, Confident AI, and Parea dashboards require separate service
accounts. Do not upload non-synthetic GStack or user data when extending this
bake-off.
