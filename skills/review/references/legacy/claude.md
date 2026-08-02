## Step 0: Detect platform and base branch

First resolve the repository's own remote as `<remote>` using
`references/BASE-DETECTION.md` — never assume `origin` exists, and empty means a
local-only repo, which is a supported case. Then detect the git hosting platform
from that remote's URL:

```bash
git remote get-url <remote> 2>/dev/null
```

- If the URL contains "github.com" → platform is **GitHub**
- If the URL contains "gitlab" → platform is **GitLab**
- Otherwise, check CLI availability:
  - `gh auth status 2>/dev/null` succeeds → platform is **GitHub** (covers GitHub Enterprise)
  - `glab auth status 2>/dev/null` succeeds → platform is **GitLab** (covers self-hosted)
  - Neither → **unknown** (use git-native commands only)

Determine which branch this PR/MR targets, or the repo's default branch if no
PR/MR exists. Use the result as "the base branch" in all subsequent steps.

Resolve the remote and the base branch with the order in
`references/BASE-DETECTION.md`: a base the user named, then the open PR/MR
target, the remote's own HEAD, the platform CLI's default branch, the local
default branch, the current branch's upstream, and finally "no separate base
branch" scoped to the working tree. Stop at the first candidate that
`git rev-parse --verify` confirms exists. Never substitute a hardcoded `main`,
`master`, or `origin/main`, and never assume the remote is named `origin`.

Print the detected remote (or "none") and the detected base branch name. In every
subsequent `git diff`, `git log`, `git fetch`, `git merge`, and PR/MR creation
command, substitute the detected branch name wherever the instructions say "the
base branch" or `<default>`, and the detected remote wherever they say
`<remote>`.

---

# $review --mode Deep --module claude - Claude Outside Voice

You are running the `$review --mode Deep --module claude` skill from a non-Claude host. This wraps `claude -p`
to get an independent Claude Code second opinion without allowing nested Claude to
modify files.

The generated external invocation name is `gstack-claude`.

---

## Step 0: Check Claude CLI

```bash
CLAUDE_BIN=$(command -v claude 2>/dev/null || echo "")
[ -z "$CLAUDE_BIN" ] && echo "NOT_FOUND" || echo "FOUND: $CLAUDE_BIN"
```

If `NOT_FOUND`, stop and tell the user:
"Claude CLI not found. Install Claude Code, then re-run this skill."

Check auth:

```bash
if [ -f "$HOME/.claude/.credentials.json" ] || [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "AUTH_FOUND"
else
  echo "AUTH_MISSING"
fi
```

If `AUTH_MISSING`, stop and tell the user:
"No Claude authentication found. Run `claude` interactively to log in, or export `ANTHROPIC_API_KEY`, then re-run this skill."

---

## Safety Boundary

Nested Claude must stay focused on the user's repository and must not run gstack
skills from inside this skill.

All `claude -p` calls MUST include:

- `--disable-slash-commands`
- Review/challenge: `--tools ""`
- Consult: `--allowedTools Read,Grep,Glob --disallowedTools Bash,Edit,Write`

Never pass `Bash`, `Edit`, or `Write` to nested Claude in this skill.

All prompts MUST be written to a temp file and fed through stdin. Never interpolate
user text directly into the shell command.

---

## Step 1: Detect Mode

Parse the user's input:

1. `$review --mode Deep --module claude review` or `$review --mode Deep --module claude review <instructions>` - **Review mode** (Step 2A)
2. `$review --mode Deep --module claude challenge` or `$review --mode Deep --module claude challenge <focus>` - **Challenge mode** (Step 2B)
3. `$review --mode Deep --module claude` with no arguments, or `$review --mode Deep --module claude <anything else>` - **Consult mode** (Step 2C)

If no mode is obvious and a diff exists, ask whether to review, challenge, or consult.

---

## Shared Helpers

Use these shell snippets in every mode.

Create temp files:

```bash
PROMPT_FILE=$(mktemp /tmp/gstack-claude-prompt-XXXXXX)
RESP_FILE=$(mktemp /tmp/gstack-claude-response-XXXXXX)
ERR_FILE=$(mktemp /tmp/gstack-claude-error-XXXXXX)
```

Cleanup at the end of every mode:

```bash
rm -f "$PROMPT_FILE" "$RESP_FILE" "$ERR_FILE"
```

Parse JSON output:

```bash
python3 - "$RESP_FILE" <<'PY'
import json, sys
path = sys.argv[1]
try:
    obj = json.load(open(path))
except Exception as exc:
    print(f"CLAUDE_JSON_PARSE_ERROR: {exc}")
    sys.exit(0)

if obj.get("is_error"):
    print("CLAUDE_ERROR: true")

result = obj.get("result") or obj.get("response") or ""
if result:
    print(result)

usage = obj.get("usage") or {}
input_tokens = usage.get("input_tokens", 0) or 0
output_tokens = usage.get("output_tokens", 0) or 0
cache_read = usage.get("cache_read_input_tokens", 0) or 0
model = obj.get("model") or "unknown"
session_id = obj.get("session_id") or ""

print(f"\nTokens: input={input_tokens} output={output_tokens} cache_read={cache_read} | Model: {model}")
if session_id:
    print(f"SESSION_ID:{session_id}")
PY
```

If stderr contains `auth`, `login`, or `unauthorized`, tell the user:
"Claude authentication failed. Run `claude` interactively to authenticate or export `ANTHROPIC_API_KEY`."

---

## Step 2A: Review Mode

Review the current branch diff with nested Claude in tool-less mode.

1. Fetch base and capture diff:

```bash
_REPO_ROOT=$(git rev-parse --show-toplevel) || { echo "ERROR: not in a git repo" >&2; exit 1; }
cd "$_REPO_ROOT"
DIFF_FILE=$(mktemp /tmp/gstack-claude-diff-XXXXXX)
git fetch origin <base> --quiet 2>/dev/null || true
git diff "<remote>/<base>" > "$DIFF_FILE" 2>/dev/null || git diff "<base>" > "$DIFF_FILE"
```

If the diff file is empty, stop and say:
"Nothing to review - no changes against the base branch."

2. Write the prompt file:

```bash
cat > "$PROMPT_FILE" <<'EOF'
You are a brutally honest Claude Code reviewer. Review this git diff for bugs,
production failure modes, security issues, missing tests, and maintainability
problems. Be direct. No compliments. Reference files and changed code where possible.

Additional user instructions, if any:
<custom review instructions>

DIFF:
EOF
cat "$DIFF_FILE" >> "$PROMPT_FILE"
```

3. Run Claude:

```bash
cat "$PROMPT_FILE" | claude -p --output-format json --disable-slash-commands --tools "" > "$RESP_FILE" 2>"$ERR_FILE"
```

4. Present the parsed output:

```
CLAUDE SAYS (code review):
============================================================
<parsed result from RESP_FILE>
============================================================
```

5. Cleanup:

```bash
rm -f "$DIFF_FILE" "$PROMPT_FILE" "$RESP_FILE" "$ERR_FILE"
```

---

## Step 2B: Challenge Mode

Run an adversarial failure-mode review with nested Claude in tool-less mode.

1. Capture the diff using the same diff commands from Review mode.

2. Write the prompt:

```bash
cat > "$PROMPT_FILE" <<'EOF'
You are an adversarial Claude Code reviewer. Try to break this change before users do.
Find edge cases, race conditions, security holes, resource leaks, silent data
corruption, bad error handling, and operational failure modes. Be thorough. No
compliments. If the user provided a focus area, prioritize it.

Focus area, if any:
<focus>

DIFF:
EOF
cat "$DIFF_FILE" >> "$PROMPT_FILE"
```

3. Run Claude:

```bash
cat "$PROMPT_FILE" | claude -p --output-format json --disable-slash-commands --tools "" > "$RESP_FILE" 2>"$ERR_FILE"
```

4. Present the parsed output:

```
CLAUDE SAYS (adversarial challenge):
============================================================
<parsed result from RESP_FILE>
============================================================
```

5. Cleanup:

```bash
rm -f "$DIFF_FILE" "$PROMPT_FILE" "$RESP_FILE" "$ERR_FILE"
```

---

## Step 2C: Consult Mode

Ask Claude about the repository. Consult mode may inspect files, but only with
read-only tools.

1. Check for an existing Claude session:

```bash
cat .context/claude-session-id 2>/dev/null || echo "NO_SESSION"
```

If a session exists, ask the user whether to continue it or start fresh.

2. Write the prompt:

```bash
cat > "$PROMPT_FILE" <<'EOF'
You are Claude Code acting as an independent outside voice for this repository.
Answer the user's question directly. You may inspect repository files with Read,
Grep, and Glob only. Do not use Bash. Do not edit or write files. Do not invoke
slash commands or gstack skills.

USER QUESTION:
<user prompt>
EOF
```

3. Run Claude.

For a new session:

```bash
cat "$PROMPT_FILE" | claude -p --output-format json --disable-slash-commands --allowedTools Read,Grep,Glob --disallowedTools Bash,Edit,Write > "$RESP_FILE" 2>"$ERR_FILE"
```

For a resumed session:

```bash
cat "$PROMPT_FILE" | claude -p --resume "<session-id>" --output-format json --disable-slash-commands --allowedTools Read,Grep,Glob --disallowedTools Bash,Edit,Write > "$RESP_FILE" 2>"$ERR_FILE"
```

4. Parse and save the session id:

```bash
SESSION_ID=$(python3 - "$RESP_FILE" <<'PY'
import json, sys
try:
    obj = json.load(open(sys.argv[1]))
    print(obj.get("session_id") or "")
except Exception:
    print("")
PY
)
if [ -n "$SESSION_ID" ]; then
  mkdir -p .context
  printf "%s\n" "$SESSION_ID" > .context/claude-session-id
fi
```

5. Present the parsed output:

```
CLAUDE SAYS (consult):
============================================================
<parsed result from RESP_FILE>
============================================================
Session saved - run $review --mode Deep --module claude again to continue this conversation.
```

6. Cleanup:

```bash
rm -f "$PROMPT_FILE" "$RESP_FILE" "$ERR_FILE"
```

---

## Error Handling

- **Binary not found:** Stop with install instructions.
- **Auth missing:** Stop with login/API key instructions.
- **Auth failure from stderr:** Surface the stderr line and ask the user to re-authenticate.
- **JSON parse failure:** Show raw stdout from `$RESP_FILE` and stderr from `$ERR_FILE`.
- **Empty response:** Tell the user "Claude returned no response. Check stderr for errors."
- **Resume failure:** Delete `.context/claude-session-id` and retry with a fresh session.

---

## Important Rules

- Nested Claude is read-only in consult mode and tool-less in review/challenge.
- Always include `--disable-slash-commands`.
- Never pass nested Claude `Bash`, `Edit`, or `Write`.
- Never interpolate user text into a shell command.
- Present Claude's response faithfully, then add any host-agent synthesis after it.

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

<!-- GSTACK2_BUG_FIX_START pr=2370 anchor=GSTACK2_FIX_2370_PORTABLE_DISPATCH -->
## Upstream judgment port: issue #2370

[Dispatch outside voices portably: trailing-XXXXXX mktemp and prompts via stdin](https://github.com/garrytan/gstack/issues/2370)

### Portable outside-voice dispatch

Two dispatch-infrastructure defects masquerade as a model stall (empty output,
no findings) on macOS from the second run and on Alpine/BusyBox from the first:

1. **Temp files.** Every `mktemp` template MUST end in trailing `XXXXXX` with
   no suffix (`mktemp "$TMP_ROOT/codex-err-XXXXXX"`, never
   `codex-err-XXXXXX.txt`). BSD and BusyBox `mktemp` require the Xs at the end
   of the template; a suffixed template errors or degrades to a fixed name that
   collides on the next run.
2. **Prompt dispatch.** Never inline a prompt file into argv with
   `"$(cat "$PROMPT_FILE")"` — argv length limits and shell quoting differences
   truncate or mangle large prompts. Send the prompt over stdin
   (`codex exec - < "$PROMPT_FILE"`, or pipe the same file to `claude -p`) so
   the bytes dispatched are exactly the bytes in the scanned file.

Before blaming a stall on the model or the network, classify the failure:
a nonzero `mktemp` exit or an argv-shaped dispatch is infrastructure, not the
model. Report it as such instead of "Codex stalled".
<!-- GSTACK2_BUG_FIX_END pr=2370 -->

<!-- GSTACK2_BUG_FIX_START pr=9109 anchor=GSTACK2_FIX_9109_OUTSIDE_VOICE_REDACT_SCAN -->
## Upstream judgment port: PR #9109

[Outside-voice review dispatches scan the diff before it leaves the machine](https://github.com/time-attack/gstack/blob/main/evals/privacy/egress-audit-2026-07-28.md)

### Redaction scan before outside-voice dispatch

Every dispatch in this module ships repository content to an external model:
the branch diff, any files the CLI reads for context, and the composed prompt.
Before EACH such dispatch (`codex review`, `codex exec`, or `claude -p` with
repo content), run the standard scan-at-sink procedure the specification,
ship, and security-audit workflows already apply to their external sinks:

1. **Materialize what will leave the machine.** For prompt-file dispatches
   (`cat "$PROMPT_FILE" | claude -p …`), the prompt file IS the sink bytes —
   scan `$PROMPT_FILE` itself and pipe the SAME file after a clean scan. For
   `codex review`, the CLI reads the branch diff itself; materialize those
   bytes first (`git diff <remote>/<base>...HEAD 2>/dev/null || git diff <base>...HEAD`,
   plus your prompt text, into a temp file) and scan them before dispatching.
2. **Scan.** Resolve `$REDACT_VIS` once (local config `redact_repo_visibility`
   → gh → glab → unknown=public-strict), then run
   `"${GSTACK_HOME:-$HOME/.gstack}/bin/gstack-redact" --from-file "$REDACT_FILE" --repo-visibility "$REDACT_VIS" --self-email "$(git config user.email 2>/dev/null)" --json`.
3. **Exit 3 (HIGH):** do NOT dispatch. Print the findings, tell the user to
   rotate + redact at source, and stop this outside voice with a typed
   degradation note. HIGH has no skip flag.
4. **Exit 2 (MEDIUM):** AskUserQuestion per finding before dispatching
   (sterner on public repos, no batch-acknowledge, no silent-proceed).
5. **Exit 0 (clean):** dispatch; surface WARN (tool-fence degrades) + LOW as a
   one-line FYI. Delete the temp file afterwards.

A secret in the diff must not reach OpenAI or Anthropic unscanned. Guardrail,
not airtight enforcement — it catches accidents and carelessness.
<!-- GSTACK2_BUG_FIX_END pr=9109 -->
