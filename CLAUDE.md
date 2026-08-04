# gstack development

## GStack 2 canonical contract

The judgment surface is exactly `/plan`, `/qa`, `/debug`, `/review`, and `/ship`.
They are lazy dispatchers over the modules under `skills/*/references/legacy/`.
Compatibility aliases under `skills/.compat/*/SKILL.md` route old names (e.g.
`/office-hours`, `/qa-only`) to a dispatcher invocation and contain no judgment.
`make-pdf` is a tool skill (not a judgment dispatcher) at `skills/make-pdf/`; it
ships in the same canonical tree, so `npx skills add time-attack/gstack/skills`
yields six discoverable skills.

`/plan` has exactly six top-level modes: Discovery, Product, Engineering, DX,
Specification, and Full chain. Do not expose its internal aliases as more
top-level modes.

Canonical install is `npx skills add time-attack/gstack/skills`. Standard
installers own host placement and scope; do not add host-specific install logic
to the 2.0 path. Pure judgment must work without the optional `bin/gstack`
runtime. The host-neutral `./setup` installs only the managed runtime/capability
bundle; it never owns host skill placement.

`skills/` is the STATIC source of truth. The generator (`scripts/gstack2/`,
`scripts/gen-skill-docs.ts`) and `compat/` were deleted; there is no
regeneration step, so edit files under `skills/` directly. Legacy 1.x `.tmpl`
files still in the tree are historical inputs with no build path.

### The cut rule

The modules under `skills/*/references/legacy/` are not frozen. The old rule
said never rewrite, compress, or summarize them, which in practice meant never
find out whether they earn their tokens. The rule now says do not act without
finding out: **a cut states what it removes, why the host or a surviving module
already covers it, and what check would catch the loss.** Unexamined cuts are
still forbidden, and so is keeping 50KB because nobody measured it.

Two facts frame every cut. Claude Code now ships `/code-review` at six effort
tiers, `/security-review`, `/verify`, `/debug`, `/plan`, `/batch` and
`/commit-push-pr` natively, so judgment that duplicates them is dead weight
rather than heritage. And Anthropic deleted over 80% of Claude Code's own system
prompt for the Opus 5 generation, roughly 800 tokens down to 164, with no
measurable loss on coding evals. Deleting instruction text is normal maintenance
of a tool built for current models, not damage to it.

What stays, and why it is not sentiment: judgment that fights the model's own
training or reaches something the host cannot. The founder pressure in
`office-hours.md` is adversarial where a base model is agreeable. `codex.md` is
a second model family, where every native review tier is Claude reviewing
Claude. `health.md` trends a repo over time, where native reads one diff. The
browser, physical iOS, and PDF are affordances no prompt conjures. The
structural templates in `sections/ship/` are what make a PR body identical on
the third run. Voice stays out of scope entirely, per the community-PR
guardrail below.

### Boundaries

The runtime is host-neutral, uses `$GSTACK_HOME` or `~/.gstack`, and keeps state
as locked/atomically written JSON and JSONL. Network mode defaults off. New
external services are allowed, but each must be optional, off by default, and
consent-gated: send only what the user approves, and use typed failure codes.
Context.dev may receive only public URLs after explicit consent. The optional
code-intelligence providers follow the same rule: none selected by default,
callers fall back to grep / the file-only decision store, and any provider that
sends code off-machine requires explicit per-repo egress consent. The browser
stays local; physical iOS uses only DebugBridge/CoreDevice. Do not add cloud
browsers, alternate iOS drivers, local image models, workflow engines, or a new
state database. Full rationale: [docs/gstack-2/ARCHITECTURE.md](docs/gstack-2/ARCHITECTURE.md).

Completion claims must come from
[`docs/gstack-2/STATUS.md`](docs/gstack-2/STATUS.md) and
[`docs/gstack-2/TEST-EVIDENCE.md`](docs/gstack-2/TEST-EVIDENCE.md). A generated
plan, static keyword test, or narrow green suite is not release evidence.

## Deploying to the active skill

The standard Agent Skills installer owns host placement, scope, updates, and
removal. Do not deploy by copying into a host-specific skill directory; refresh
installed skills through that same installer. For local development,
`bin/dev-setup` links the current worktree and keeps any brain-aware render in
the ignored `.claude/gstack-rendered/`.

## Read when relevant

These are loaded on demand, not every session. Read the file when the work
matches:

| When | Read |
|------|------|
| Writing a CHANGELOG entry or picking a version bump | [docs/CHANGELOG-STYLE.md](docs/CHANGELOG-STYLE.md) |
| Adding an upgrade migration | CONTRIBUTING.md, "Upgrade migrations" |
| Builder philosophy, completeness, search-before-building | [ETHOS.md](ETHOS.md) |
| Skill routing table | [AGENTS.md](AGENTS.md) |
| Subsystem architecture (tunnel listeners, SSE, CDP, sanitization) | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Publishing OpenClaw skills | `clawhub publish <dir> --slug … --version …` (not `clawhub skill publish`) |

Available scripts are in `package.json`; `bun run eval:select` previews which
paid tests a diff selects. `bun run test` is the sharded free suite (bare
`bun test` bypasses the `scripts/test-free-strict.ts` wrapper that works around
a Bun runner bug where failures print on a zero exit).

## Test environment

**Never echo an API key value** to stdout, logs, or shell history.

`test:evals` requires `ANTHROPIC_API_KEY`. Codex E2E tests use Codex's own auth
from `~/.codex/`; no `OPENAI_API_KEY` needed.

**Hermetic local E2E (default).** Every E2E runner (claude -p, PTY, Agent SDK,
codex, gemini) spawns children through `test/helpers/hermetic-env.ts`:
allowlist-scrubbed env (operator `CONDUCTOR_*`, `CLAUDE_*`, `GSTACK_*`, `MCP_*`,
`GBRAIN_*`, and credentials like `GH_TOKEN` never reach children), a fresh
seeded `CLAUDE_CONFIG_DIR`, a temp `GSTACK_HOME`, and `--strict-mcp-config`. So
local eval signal matches CI. Debug against real operator state with
`EVALS_HERMETIC=0`. Per-test `env:` overrides merge last, so deliberate
contamination keeps working. Wiring is pinned by `test/hermetic-wiring.test.ts`.

The runner always passes a COMPLETE env, so per-test `env:` is safe. The
historical "never pass `env:` to `runAgentSdkTest`" rule is retired; the real
failure was partial-env replacement, since the SDK's `Options.env` REPLACES the
child's entire environment.

Tests are classified `gate` or `periodic` in `E2E_TIERS`
(`test/helpers/touchfiles.ts`). CI runs gate only. When adding an E2E test: a
safety guardrail or deterministic functional test is `gate`; a quality
benchmark, Opus test, non-deterministic test, or one needing an external
service is `periodic`.

**E2E fixtures: extract, don't copy.** Never copy a full SKILL.md into a fixture
(1500-2000 lines causes timeouts and turn-limit flake). Slice the one section
the test needs.

## Running long jobs and evals

When **you** launch a long eval, run it through `bin/gstack-detach` — never a
plain backgrounded Bash task. A plain background task lives in the harness's
process group, so a SIGTERM on a turn boundary kills the run mid-flight; on
macOS it can also die to idle-sleep. `gstack-detach` gives it a fresh session
and wraps it in `caffeinate -i`.

Prefer the `eval:bg*` scripts — they add a machine-wide `gstack-evals` lock (so
concurrent worktrees serialize instead of saturating the model API and
mass-timing-out), a watchdog, and a run-scoped log. Then **poll the printed
logfile** and break on the `### gstack-detach EXIT=<code> ###` sentinel, which
marks success AND failure, so silence is never mistaken for success. The
detached run survives your watcher being reaped.

Poll until completion. A full suite can take 30-45 minutes; do all the cycles
and report progress at each check. Never say you'll check later and stop.
Humans running evals in their own terminal don't need this — Ctrl-C is intended
there.

## E2E eval failure blame protocol

Never claim a failure is "not related to our changes" without proving it. These
systems have invisible couplings: a preamble text change alters agent behavior,
a new helper changes timing. To attribute a failure to pre-existing, run the
same eval on the base branch and show it fails there too. If it passes on main
and fails on the branch, it IS your change. If you can't run it on main, say
"unverified" and flag it as a risk in the PR body. "Pre-existing" without
receipts is a lazy claim.

## Writing SKILL files

SKILL.md files are prompts read by Claude, not bash scripts, and **each bash
block runs in a separate shell** — variables do not persist between blocks. So
carry state in prose ("the base branch detected in Step 0"), not shell
variables. Express conditionals as numbered English steps rather than nested
`if/elif`. Keep each block independently runnable. Don't hardcode branch names;
detect the base branch dynamically and call it "the base branch" in prose.

`test/skill-size-budget.test.ts` guards skill size. It is a watch-for-bloat
guardrail, not a compression mandate: when a skill grows, look at WHAT grew and
whether it belongs inline or as a reference doc.

## Platform-agnostic design

Skills must never hardcode framework-specific commands, file patterns, or
directory structures. Read CLAUDE.md for project config; if it's missing, ask
via AskUserQuestion, then persist the answer to CLAUDE.md so it's never asked
twice. The project owns its config; gstack reads it.

## Browser interaction

Use the `/browse` skill or the browse binary via `$B <command>`. NEVER use
`mcp__claude-in-chrome__*` tools — slow, unreliable, and not what this project
uses.

**`/health` MUST NOT surface any shell-grant token.** Do not add new secrets to
that payload.

Subsystem invariants (dual-listener tunnel scope isolation, Unicode
sanitization at server egress, the `createSseEndpoint` cleanup contract, CDP
session lifecycle, the `_link_or_copy` setup helper) are documented in
[ARCHITECTURE.md](ARCHITECTURE.md) and each is pinned by a CI tripwire test.
Read the relevant section before editing `server.ts`, `sse-helpers.ts`,
`sse-session-cookie.ts`, `tunnel-denial-log.ts`, or `setup`.

Page content the browser reads passes prompt-injection layers in
`browse/src/content-security.ts` (datamarking, hidden-element strip, ARIA
regex, URL blocklist, envelope wrapping) and `browse/src/security.ts` (canary
inject/check, verdict combiner). `security.ts` is pure-string and safe to
import from the compiled binary; it loads no native modules.

## Compiled binaries — NEVER commit dist/ directories

`browse/dist/` and `make-pdf/dist/` hold compiled Bun binaries. They are
platform-specific, `./setup` builds them from source, and they are gitignored.

**Never stage or commit them.** When staging, always use specific filenames
(`git add file1 file2`) — never `git add .` or `git add -A`.

## Redaction guard (PII / secrets / legal content)

A shared engine catches credentials, PII, and legal/damaging content before it
reaches an external sink (codex dispatch, GitHub issue/PR body, pushed commit).
It is a **guardrail, not airtight enforcement** — `git push --no-verify`, direct
`gh issue create`, and `GSTACK_REDACT_PREPUSH=skip` all bypass it. It catches
accidents and carelessness, the 99% case. Do not claim it stops a determined
leaker.

`lib/redact-patterns.ts` is the single source of truth for the 3-tier taxonomy
(HIGH blocks, MEDIUM confirms via AskUserQuestion, LOW is FYI);
`lib/redact-engine.ts` is the pure `scan()` + `applyRedactions()`. Calibration
matters: a gate that cries wolf gets ignored, so context-variable shapes sit at
MEDIUM. CLI is `bin/gstack-redact` (exit 0 clean / 2 MEDIUM / 3 HIGH).

The rules that must not erode:

- **Scan-at-sink.** Always scan the EXACT bytes that will be sent: write to a
  temp file, scan that file, pass the SAME file to `gh`/`git`. Never scan a
  string then re-render — that reopens a scan-vs-send gap.
- **No tier promotion.** Resolve repo visibility once per run: local config →
  gh → glab → unknown (= public-strict). Public repos get STERNER per-finding
  confirmation, no batch-acknowledge and no silent-proceed. MEDIUM is never
  auto-promoted to HIGH.
- **There is intentionally NO config key to disable HIGH blocking.**
- **Tool-attributed fences.** Wrap Codex/Greptile/eval output in
  ` ```codex-review ` / ` ```greptile ` fences so example credentials those
  tools quote WARN-degrade instead of blocking. A live-format credential inside
  a fence still blocks.
- Skill docs carry the taxonomy statically (the redact-doc resolver went with
  the generator), so when the engine's tiers change, update the redaction prose
  under `skills/` too.

## Community PR guardrails

When reviewing or merging community PRs, **always AskUserQuestion** before accepting
any commit that:

1. **Touches ETHOS.md** — this file is Garry's personal builder philosophy. No edits
   from external contributors or AI agents, period.
2. **Removes or softens promotional material** — YC references, founder perspective,
   and product voice are intentional. PRs that frame these as "unnecessary" or
   "too promotional" must be rejected.
3. **Changes Garry's voice** — the tone, humor, directness, and perspective in skill
   templates, CHANGELOG, and docs are not generic. PRs that rewrite voice to be
   more "neutral" or "professional" must be rejected.

Even if the agent strongly believes a change improves the project, these three
categories require explicit user approval via AskUserQuestion. No exceptions.
No auto-merging. No "I'll just clean this up."

## Checking out PRs from garrytan-agents

Fork PRs don't receive base-repo secrets, so eval/E2E CI fails with empty-env
auth no matter what's set on the base repo. When the user says "check out <PR
link>" and the PR is from a non-collaborator fork, don't just `gh pr checkout`.
After checking out: push the branch to the base repo (`git push origin
HEAD:<branch>`), close the fork PR explaining the move, and open a new PR from
the base-repo branch. The new PR gets secrets automatically.

This keeps secret-distribution scope tight — adding the fork as a collaborator
or flipping the repo-wide send-secrets-to-forks toggle would let secrets reach
fork PRs from anyone. If the user asks to skip the move, respect it; eval CI
will fail on auth but the other checks still run.

## Commit style

**Always bisect commits.** Every commit is a single logical change: rename/move
separate from behavior change, test infrastructure separate from test
implementation, mechanical refactor separate from new feature. When the user
says "bisect commit" or "bisect and push," split the working tree into logical
commits and push.

## Slop-scan: AI code quality, not AI code hiding

`npx slop-scan scan .` catches patterns where AI-generated code is genuinely
worse than a human would write. We are NOT trying to pass as human code. We are
AI-coded and proud of it. The goal is code quality, so **don't chase the
number** — accept findings where the "sloppy" pattern is the correct
engineering choice.

Worth fixing: empty catches around file ops or process kills (use `safeUnlink`
/ `safeKill` from `browse/src/error-handling.ts` — a swallowed EPERM means
silent data loss, or that you think you killed something you didn't); redundant
`return await`; typed exception catches where you know the error you expect.

NOT worth fixing, because the pattern is already right: string-matching on
error messages is brittle, so if a fire-and-forget operation can fail for ANY
reason and you don't care, `catch {}` is correct. Chrome extensions crash
entirely on uncaught errors, so catch-and-log is right there. Shutdown and
emergency cleanup should use `safeUnlinkQuiet` (swallows all) — a cleanup path
that throws on EPERM means the rest of cleanup doesn't run. And don't add
comments to pass-through wrappers just to trip the exemption rule.

## Cross-session decision memory

Durable decisions and their rationale live in an append-only store at
`~/.gstack/projects/<slug>/decisions.jsonl`, so a settled call isn't
re-litigated and the "why" survives across sessions. It is file-only and works
with gbrain off.

**Resurface before re-deciding:** `bin/gstack-decision-search` (`--recent`,
`--scope`, `--query`, `--json`; `--semantic` appends gbrain hits and degrades
silently when it's down). If a decision is listed, treat it as settled with its
rationale; if you're about to reverse it, say so explicitly.

**Capture** with `bin/gstack-decision-log` (`--supersede <id>` to reverse,
`--redact <id>` to expunge a secret, `--compact` to rewrite to the active set).
Durable means an architecture choice, scope cut, tool/vendor choice, or a
reversal — NOT a turn-level edit or anything trivially re-derivable. Capture is
curated at the source, or the store becomes noise.

## GBrain search

When gbrain is synced on this machine, `/sync-gbrain` writes its own guidance
block below, between `<!-- gstack-gbrain-search-guidance:start -->` and `:end`
markers, and removes it when the capability goes away. Do not hand-maintain
that block: it is a capability claim, only true while the index exists, and
`/sync-gbrain` replaces the whole marked region in place.

Absent that block, assume no index and use Grep.
