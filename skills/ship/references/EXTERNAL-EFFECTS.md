# Durable external effects

Ship, land, deploy, monitor, and resume retain their preserved judgment. This runtime protocol makes their already-authorized external actions crash-safe; it is not authority to perform an action and is not a workflow engine.

1. Start or resume one durable run for the workflow: `RUN_ID=$(gstack state begin ship)` or `gstack state resume <run-id>`.
2. Before each push, PR create/update, merge, deploy, rollback, release publication, or external notification, choose a stable semantic key such as `git.push.origin`, `pr.create`, `merge.pr-42`, or `deploy.production`.
3. Execute the exact argv without a shell through `gstack state effect "$RUN_ID" <effect-key> -- <executable> [args...]`. The runtime records a durable claim before spawning it and exposes `GSTACK_IDEMPOTENCY_KEY` to commands that support native idempotency.
4. On success, a repeated invocation returns the recorded result without spawning the command again.
5. If execution is interrupted or its outcome is ambiguous, stop. Inspect the external system. Never retry automatically. If evidence proves the action occurred, record that evidence with `gstack state reconcile-applied "$RUN_ID" <effect-key> --confirm-applied --evidence <reference>`. Only if evidence proves it did not occur may the user-authorized workflow run `gstack state reconcile-not-applied "$RUN_ID" <effect-key> --confirm-not-applied` and retry.
6. A not-applied effect remains unresolved until its retry completes. Finish only when every effect is completed: `gstack state complete "$RUN_ID"`.

Do not put secrets in run IDs, effect keys, or command arguments. Existing approval gates remain binding before merge, deploy, destructive mutation, spending, or messages.

## PR mutations use the REST API

The gh CLI's high-level PR-edit subcommand rides a GraphQL mutation that hard-errors under fine-grained tokens and several permission setups. Every PR title/body/base mutation in these workflows uses this one canonical REST form, substituted at every edit site by the generator:

```bash
gh api -X PATCH "repos/:owner/:repo/pulls/$(gh pr view --json number -q .number)" -f title="$NEW_TITLE"
gh api -X PATCH "repos/:owner/:repo/pulls/$(gh pr view --json number -q .number)" -F body=@"$PR_BODY_FILE"
```

Creating a PR may use `gh pr create`; when it fails, the REST fallback is `gh api -X POST "repos/:owner/:repo/pulls" -f head="$(git branch --show-current)" -f base="<base>" -f title="$TITLE" -F body=@"$BODY_FILE"`. Run each mutation through the durable state wrapper like any other external effect.

## Second-opinion passes must prove they ran

A Codex review pass on a Linux host without user namespaces silently no-ops: the bwrap sandbox cannot start, and the empty result masquerades as a clean review. Before crediting any Codex pass as review evidence, source `$GSTACK_BIN/gstack-codex-probe` and run `_gstack_codex_sandbox_canary` once per session; on `CODEX_SANDBOX_UNAVAILABLE` (typed, fail-closed) record the degradation ("codex skipped: sandbox unavailable") and continue without that voice. An empty or failed pass is never a clean review.

## No-runtime fallback

When the optional runtime is not installed (`$GSTACK_BIN/gstack` missing), the durable ledger is unavailable but the discipline still binds: before each external effect, print the effect key and the exact command as assistant text; execute it directly; after an interruption or ambiguous outcome, STOP and inspect the external system first. Never retry automatically, and never re-run an effect whose outcome is unknown. Runtime absence changes the bookkeeping, not the authority gates or the no-blind-retry rule.
