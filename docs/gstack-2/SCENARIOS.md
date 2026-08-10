# GStack 2 routing scenarios

The 18 executable fixtures route from structured stage/surface/authorization/evidence signals. Their prompts intentionally avoid public skill and mode names.

| ID | Expected decision | Active | Mutation | Evidence basis | Gap |
|---|---|---|---|---|---|
| `idea-before-solution` | `plan:Discovery` | `office-hours` | `design-doc-only` | phase=pre-solution; premise_confidence=low | — |
| `scope-and-ambition` | `plan:Product` | `plan-ceo-review` | `plan-only` | artifact_exists=true; uncertainty=scope-strategy | — |
| `architecture-data-contracts` | `plan:Engineering` | `plan-eng-review` | `plan-only` | uncertainty=architecture-data; phase=implementation-design | — |
| `developer-first-onboarding` | `plan:DX` | `plan-devex-review` | `plan-only` | audience=developers; journey=onboarding | — |
| `cross-functional-decision` | `plan:Full chain` | `autoplan` | `plan-only` | review_axes_count=4; automatic_decisions=true | — |
| `backlog-ready-handoff` | `plan:Specification` | `spec` | `spec-and-issue` | output=executable-backlog-item; phase=handoff | — |
| `browser-findings-only` | `qa:Report` | `qa-only` | `report-only` | surface=web; mutation_authorized=false | — |
| `browser-fix-and-verify` | `qa:Fix` | `qa` | `fix-safe` | surface=web; mutation_authorized=true | — |
| `device-state-journey` | `qa:Report` | `ios-qa` | `report-only` | surface=ios; real_device=true | — |
| `cli-api-journey` | `qa:Report` | `devex-review`, `qa-only`, `system-functional` | `report-only` | surface=developer-workflow; journey_measurement=true; functional_backend_harness=true | — |
| `production-threshold-watch` | `ship:Monitor` | `canary` | `report-only` | deployed=true; thresholds_declared=true | — |
| `unknown-intermittent-cause` | `debug:Diagnose-only` | `investigate` | `investigate-only` | cause_known=false; intermittent=true | — |
| `reproducible-device-defect` | `debug:Fix` | `ios-fix` | `fix-safe` | platform=ios; reproducible=true | — |
| `ci-script-change-review` | `review:Normal` | `review` | `fix-safe` | change_exists=true; audit_focus=broad | — |
| `threat-surface-audit` | `review:Security` | `cso` | `report-only` | audit_focus=security; threat_model_required=true | — |
| `branch-to-pull-request` | `ship:Prepare` | `ship` | `commit-push-pr` | release_stage=working-branch; pr_exists=false | — |
| `approved-change-to-production` | `ship:Land` | `land-and-deploy` | `merge-deploy` | release_stage=approved-pr; deploy_requested=true | — |
| `post-release-doc-alignment` | `ship:Prepare` | `document-release` | `docs-only` | release_stage=post-ship; docs_drift=true | — |
