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
# $qa --mode Report --module scrape — pull data from a page

One entry point for getting data off the web. Two paths under the hood:

1. **Match path** (~200ms) — if the user's intent matches an existing
   browser-skill's triggers, run it via `$B skill run <name>` and emit
   the JSON.
2. **Prototype path** (~30s) — no matching skill yet, so drive the page
   with `$B` primitives and return the JSON.

Read-only by contract. If the intent implies writing (submitting forms,
clicking buttons that mutate state), refuse and route to `/automate`.

## Step 1 — Determine intent

The user's request after `$qa --mode Report --module scrape` is the intent. If they did not include
one, ask once:

> "What do you want to scrape? Describe it in one line, e.g. 'top stories
> on Hacker News' or 'product names + prices on example.com/products'."

Do not ask multiple clarifying questions up front. Any further questions
go in the prototype path where they're cheaper.

## Step 2 — Refuse mutating intents

If the intent implies writes — verbs like *submit*, *post*, *send*, *log
in*, *click X*, *fill the form*, *delete*, *create*, *order*, *book* —
respond:

> "$qa --mode Report --module scrape is read-only. For mutating flows, use /automate (browser-skills
> Phase 2 P0 in TODOS.md — not yet shipped). Until then, use $B click /
> $B fill / $B type directly."

Stop. Do not enter the match or prototype path.

## Step 3 — Match phase

List existing browser-skills:

```bash
$B skill list
```

For each skill, `$B skill show <name>` exposes the full SKILL.md including
`triggers:`, `description:`, and `host:`. Read these and judge whether the
user's intent semantically matches one of them.

A confident match means **all three** are true:

- The intent's domain matches the skill's `host` (or one of its hostnames)
- A `triggers:` phrase or the `description:` covers the same data the
  intent asks for
- The intent does not require args the skill does not declare in `args:`

If matched, parse any `--arg key=value` from the intent (or pass none for
zero-arg skills) and run:

```bash
$B skill run <name> [--arg key=value ...]
```

Emit the JSON the skill prints to stdout. Stop.

If matching is ambiguous (two skills could plausibly fit), pick the
narrower-tier one (project > global > bundled — `$B skill list` shows the
tier). If still ambiguous, fall through to the prototype path rather than
guess wrong.

## Step 4 — Prototype phase

No match. Drive the page using `$B` primitives:

1. `$B goto <url>` — navigate to the target. The user's intent usually
   names a host or a URL; use it directly.
2. `$B snapshot --text` (or `$B text`) — get a clean text view of the
   page to find selectors.
3. `$B html` — pull the raw HTML when you need to parse structured data
   (lists, tables, repeated rows).
4. `$B links` — when the intent is to gather URLs.
5. Iterate: try a selector, check the output, refine.

Emit the result as JSON on stdout (one document, not pretty-printed).
Use a stable shape — typically `{ "items": [...], "count": N }` or
similar — so downstream consumers can treat it as data.

## When the prototype fails

If the page loads but data extraction does not yield a sensible JSON shape
after 3-4 selector attempts:

- Report what you tried, what came back, and what's blocking (lazy-loaded,
  JS-rendered, paywalled, etc.).
- Do NOT write a partial result and call it done.
- Ask the user whether they want to (a) try a different selector, (b)
  switch to a different page, or (c) stop.

## What this skill does NOT do

- Mutating actions (use /automate when shipped, or $B primitives directly)
- Auth flows / cookie import (use $qa --mode Report --module setup-browser-cookies first)
- Multi-page crawls (this is one-shot per call)
- Anything that requires the daemon to not be running

## Output discipline

The match path returns whatever JSON the matched skill emits. The
prototype path returns whatever JSON you construct. In both cases:

- One JSON document, on stdout.
- Stderr (or chat) is for logs and the skillify nudge.
- Do not embed prose around the JSON in the chat reply unless the user
  asked for an explanation — many `$qa --mode Report --module scrape` callers pipe the output to
  `jq`.

## Capture Learnings

If you discovered a non-obvious pattern, pitfall, or architectural insight during
this session, log it for future sessions:

```bash
$GSTACK_BIN/gstack-learnings-log '{"skill":"scrape","type":"TYPE","key":"SHORT_KEY","insight":"DESCRIPTION","confidence":N,"source":"SOURCE","files":["path/to/relevant/file"]}' 2>/dev/null || echo "GSTACK_RUNTIME_ABSENT: gstack-learnings-log skipped"
```

The shared taxonomy (types, sources, confidence, files, what is worth logging) is specified once in `references/LEARNINGS.md` — read it before logging.

<!-- GSTACK2_BUG_FIX_START pr=679 anchor=GSTACK2_FIX_679_MATCH_USER_LANGUAGE -->
## Upstream judgment port: PR #679

[Match the user language](https://github.com/garrytan/gstack/pull/679)

### User-language rule

Write questions, progress updates, reports, and artifacts in the language used by the user. Source material, code identifiers, commands, and quotations may remain in their original language when translating them would reduce accuracy.
<!-- GSTACK2_BUG_FIX_END pr=679 -->

<!-- GSTACK2_BUG_FIX_START pr=2030 anchor=GSTACK2_FIX_2030_SIGNAL_GATED_LEARNING -->
## Upstream judgment port: PR #2030

[Record only signal-bearing learnings](https://github.com/garrytan/gstack/pull/2030)

### Signal-gated learning

Persist a learning only when the interaction contains a useful, reusable signal such as an explicit preference, correction, accepted recommendation, or rejected direction. Track helpful and harmful outcomes separately. Do not manufacture a learning merely because a workflow completed.
<!-- GSTACK2_BUG_FIX_END pr=2030 -->

<!-- GSTACK2_BUG_FIX_START pr=879 anchor=GSTACK2_FIX_879_SELF_CONTAINED_QUESTIONS -->
## Upstream judgment port: issue #879

[Show the content a question refers to before asking it](https://github.com/garrytan/gstack/issues/879)

### Self-contained questions

A question is only answerable if the user can see what it refers to. Before any AskUserQuestion or prose decision brief that asks the user to confirm, approve, rank, or choose among content this session produced — premises, findings, plans, approaches, scores, summaries — render that content in full as direct assistant text immediately before the question, or restate it inside the question and option descriptions. Internal reasoning is invisible to the user, and collapsed tool output (Bash cat, Read) does not count as shown. Never ask "do you agree with the N premises?" when the premises exist only in your reasoning: print them, then ask. This generalizes the inline design-doc approval rule from PR #1116 to every question in every workflow.
<!-- GSTACK2_BUG_FIX_END pr=879 -->
