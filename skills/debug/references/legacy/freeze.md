## Host-neutral runtime bindings

These assignments select stable paths only; they do not install anything or grant consent:

```bash
GSTACK_HOME="${GSTACK_HOME:-$HOME/.gstack}"
GSTACK_ROOT="$GSTACK_HOME"
GSTACK_STATE_ROOT="$GSTACK_HOME"
GSTACK_BIN="$GSTACK_HOME/bin"
BUN_CMD="$GSTACK_BIN/bun"
B="$GSTACK_BIN/browse"
P="$GSTACK_BIN/make-pdf"
```
# $debug --mode Diagnose-only --module freeze — Restrict Edits to a Directory

Lock file edits to a specific directory. Any Edit or Write operation targeting
a file outside the allowed path will be **blocked** (not just warned).

Canonical execution does not write engagement analytics or telemetry.

## Setup

Ask the user which directory to restrict edits to. Use AskUserQuestion:

- Question: "Which directory should I restrict edits to? Files outside this path will be blocked from editing."
- Text input (not multiple choice) — the user types a path.

Once the user provides a directory path:

1. Resolve it to an absolute path:
```bash
FREEZE_DIR=$(cd "<user-provided-path>" 2>/dev/null && pwd)
echo "$FREEZE_DIR"
```

2. Ensure trailing slash and save to the freeze state file:
```bash
FREEZE_DIR="${FREEZE_DIR%/}/"
eval "$($GSTACK_BIN/gstack-paths 2>/dev/null)"
STATE_DIR="$GSTACK_STATE_ROOT"
mkdir -p "$STATE_DIR"
echo "$FREEZE_DIR" > "$STATE_DIR/freeze-dir.txt"
echo "Freeze boundary set: $FREEZE_DIR"
```

Tell the user: "Edits are now restricted to `<path>/`. Any Edit or Write
outside this directory will be blocked. To change the boundary, run `$debug --mode Diagnose-only --module freeze`
again. To remove it, ask to unfreeze (the Scope Lock section of `legacy/investigate.md` owns clearing the boundary) or end the session."

## How it works

The hook reads `file_path` from the Edit/Write tool input JSON, then checks
whether the path starts with the freeze directory. If not, it returns
`permissionDecision: "deny"` to block the operation.

The freeze boundary persists for the session via the state file. The hook
script reads it on every Edit/Write invocation.

## Notes

- The trailing `/` on the freeze directory prevents `/src` from matching `/src-old`
- Freeze applies to Edit and Write tools only — Read, Bash, Glob, Grep are unaffected
- This prevents accidental edits, not a security boundary — Bash commands like `sed` can still modify files outside the boundary
- To deactivate, ask to unfreeze (Scope Lock in `legacy/investigate.md` clears the boundary) or end the conversation

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
