# Compatibility routing

This package is self-contained. Route every retired invocation to the exact replacement below. A local module path is listed when this selected package contains the dependency; otherwise install the named canonical dispatcher before continuing.

| Retired invocation | Exact replacement | Package-local module or required dispatcher |
|---|---|---|
| `/gstack` | retired router: invoke the matching dispatcher directly (`$plan`, `$qa`, `$debug`, `$review`, `$ship`, `/make-pdf`) or name the task and let the installed skills self-route | retired — no module |
| `/office-hours` | `$plan --mode Discovery --module office-hours` | install `plan` |
| `/plan-ceo-review` | `$plan --mode Product --module plan-ceo-review` | install `plan` |
| `/plan-eng-review` | `$plan --mode Engineering --module plan-eng-review` | install `plan` |
| `/plan-devex-review` | `$plan --mode DX --module plan-devex-review` | install `plan` |
| `/autoplan` | `$plan --mode Full chain --module autoplan` | install `plan` |
| `/spec` | `$plan --mode Specification --module spec` | install `plan` |
| `/plan-tune` | `$plan --mode Discovery --module plan-tune` | install `plan` |
| `/context-save` | `$plan --mode Discovery --module context-save` | install `plan` |
| `/context-restore` | `$plan --mode Discovery --module context-restore` | install `plan` |
| `/learn` | `$plan --mode Discovery --module learn` | install `plan` |
| `/retro` | `$plan --mode Discovery --module retro` | install `plan` |
| `/setup-gbrain` | `$plan --mode Discovery --module setup-gbrain` | install `plan` |
| `/sync-gbrain` | `$plan --mode Discovery --module sync-gbrain` | install `plan` |
| `/qa` | `$qa --mode Fix --module qa` | install `qa` |
| `/qa-only` | `$qa --mode Report --module qa-only` | install `qa` |
| `/ios-qa` | `$qa --mode Report --module ios-qa` | install `qa` |
| `/devex-review` | `$qa --mode Report --module devex-review` | install `qa` |
| `/canary` | `$ship --mode Monitor --module canary` | install `ship` |
| `/browse` | `$qa --mode Report --module browse` | install `qa` |
| `/open-gstack-browser` | `$qa --mode Report --module open-gstack-browser` | install `qa` |
| `/setup-browser-cookies` | `$qa --mode Report --module setup-browser-cookies` | install `qa` |
| `/pair-agent` | `$qa --mode Report --module pair-agent` | install `qa` |
| `/scrape` | `$qa --mode Report --module scrape` | install `qa` |
| `/investigate` | `$debug --mode Diagnose-only --module investigate` | install `debug` |
| `/ios-fix` | `$debug --mode Fix --module ios-fix` | install `debug` |
| `/careful` | `$debug --mode Diagnose-only --module careful` | install `debug` |
| `/freeze` | `$debug --mode Diagnose-only --module freeze` | install `debug` |
| `/guard` | `$debug --mode Diagnose-only --module careful` plus `--module freeze` in the same run (both protections active) | install `debug` |
| `/unfreeze` | `$debug --mode Diagnose-only --module investigate` — its Scope Lock section owns clearing the boundary | install `debug` |
| `/review` | `$review --mode Normal --module review` | `legacy/review.md` |
| `/cso` | `$review --mode Security --module cso` | `legacy/cso.md` |
| `/health` | `$review --mode Deep --module health` | `legacy/health.md` |
| `/codex` | `$review --mode Deep --module codex` | `legacy/codex.md` |
| `/ship` | `$ship --mode Prepare --module ship` | install `ship` |
| `/land-and-deploy` | `$ship --mode Land --module land-and-deploy` | install `ship` |
| `/landing-report` | `$ship --mode Prepare --module landing-report` | install `ship` |
| `/document-release` | `$ship --mode Prepare --module document-release` | install `ship` |
| `/setup-deploy` | `$ship --mode Deploy --module setup-deploy` | install `ship` |
| `/document-generate` | `$ship --mode Prepare --module document-generate` | install `ship` |
| `/ios-clean` | `$ship --mode Prepare --module ios-clean` | install `ship` |
| `/ios-sync` | `$ship --mode Prepare --module ios-sync` | install `ship` |
