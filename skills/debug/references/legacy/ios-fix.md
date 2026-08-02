# Autonomous iOS bug fixer

## Iron Law

**NO FIX WITHOUT A REPRODUCING SNAPSHOT.** Before editing any Swift source,
the agent MUST capture a `GET /state/snapshot` that reproduces the bug.
That snapshot becomes a regression test fixture (`test/fixtures/ios-fix/`).
A fix that lands without a reproducing snapshot is a fix you'll be re-fixing
in three months.

## Phase 1: Reproduce the bug

1. Read the `$qa --mode Report --module ios-qa` finding (bug description, screenshot, suspected
   accessibility-tree node).
2. Bring the device into the bug state via `POST /tap`, `/swipe`, `/type`,
   or `POST /state/<key>` (snapshot-eligible fields only).
3. Capture `GET /state/snapshot` → write to
   `test/fixtures/ios-fix/<bug-slug>-pre.json`.
4. Capture `GET /screenshot` → write to
   `test/fixtures/ios-fix/<bug-slug>-pre.png`.
5. Persist a one-line description of what's wrong + expected behavior.

## Phase 2: Locate root cause

Per `$debug --mode Diagnose-only --module investigate`'s Iron Law: no fix without root cause. The agent reads the
Swift source, traces from the buggy screen back to the view model, the data
flow, and the state mutation. Identify the smallest change that fixes the
behavior.

Use AskUserQuestion if there are multiple plausible root causes — let the
user pick the one to fix.

## Phase 3: Apply fix

1. Edit Swift source. Keep the diff minimal.
2. Rebuild: `xcodebuild -scheme <SchemeName>
   -destination 'platform=iOS,id=<UDID>' build install`.
3. Daemon detects the rebuild and reconnects the StateServer tunnel.
4. Re-deploy. The same boot-token rotation flow runs.

## Phase 4: Verify

1. `POST /state/restore` with the pre-bug snapshot → reproduces the state.
2. Take a fresh screenshot. Compare against
   `test/fixtures/ios-fix/<bug-slug>-pre.png`.
3. If the bug visibly persists, the fix didn't work — revert and try again
   (max 3 iterations before escalating to the user).
4. If the bug is gone, capture `<bug-slug>-post.png` for the regression test.

## Phase 5: Add regression test

Write a test in `test/fixtures/ios-fix/<bug-slug>.test.ts` that:

1. Loads the pre-bug snapshot.
2. Restores it via `POST /state/restore`.
3. Asserts the post-fix behavior on a real device (gated
   `GSTACK_HAS_IOS_DEVICE=1`, periodic tier).

Commit the snapshot fixture + test file alongside the fix.

## Failure modes

| Symptom | Action |
|---|---|
| 3 iterations, bug still present | STOP, report to user with current best hypothesis |
| `409 schema_mismatch` on /state/restore after rebuild | Re-codegen accessors (`swift run gen-accessors`), re-snapshot |
| Device disconnects mid-fix | Daemon auto-reconnects; resume from Phase 4 |
| Build fails | Revert Swift edits; investigate compile error before re-applying fix |

<!-- GSTACK2_BUG_FIX_START pr=679 anchor=GSTACK2_FIX_679_MATCH_USER_LANGUAGE -->
## Upstream judgment port: PR #679

[Match the user language](https://github.com/garrytan/gstack/pull/679)

### User-language rule

Write questions, progress updates, reports, and artifacts in the language used by the user. Source material, code identifiers, commands, and quotations may remain in their original language when translating them would reduce accuracy.
<!-- GSTACK2_BUG_FIX_END pr=679 -->

<!-- GSTACK2_BUG_FIX_START pr=879 anchor=GSTACK2_FIX_879_SELF_CONTAINED_QUESTIONS -->
## Upstream judgment port: issue #879

[Show the content a question refers to before asking it](https://github.com/garrytan/gstack/issues/879)

### Self-contained questions

A question is only answerable if the user can see what it refers to. Before any AskUserQuestion or prose decision brief that asks the user to confirm, approve, rank, or choose among content this session produced — premises, findings, plans, approaches, scores, summaries — render that content in full as direct assistant text immediately before the question, or restate it inside the question and option descriptions. Internal reasoning is invisible to the user, and collapsed tool output (Bash cat, Read) does not count as shown. Never ask "do you agree with the N premises?" when the premises exist only in your reasoning: print them, then ask. This generalizes the inline design-doc approval rule from PR #1116 to every question in every workflow.
<!-- GSTACK2_BUG_FIX_END pr=879 -->
