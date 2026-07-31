# Skill-content checklist — apply to the static `skills/` tree

Main is now static (the generator is gone), so these skill-content improvements —
produced as generator overlays during the v2 fix wave — must be applied as **direct
edits** to the static `skills/*.md` files. The root-cause **code** fixes are being
integrated separately on `gstack2-integration`; this doc is only the skill-content
half, which you own.

Each item lists the issue it closes, the target file(s) on static main, and the
exact change. The bulk is in `01-judgment-and-privacy-overlays.patch` (32 files),
generated as `git diff 4796e884 gstack2-judgment-surface -- skills`. It was cut
against the pre-refactor tree, so apply with 3-way and resolve any rejects:

```bash
git apply --3way --whitespace=fix docs/gstack-2/SKILL-CONTENT-CHECKLIST/01-judgment-and-privacy-overlays.patch
# for hunks that reject because static main drifted, apply them by hand from the .rej
```

Verify nothing names a model after you finish (the whole point):
`git grep -nE "gpt-[0-9]|claude-(sonnet|opus|haiku)-[0-9]|gemini-[0-9]|composer-[0-9]" -- skills/` should return only preserved-legacy quotations, nothing in a dispatch command.

## Status on `gstack2-integration` (verified 2026-07-30)

Measured against the working tree, not this doc's claims: file existence, anchor
greps (`GSTACK2_BUG_FIX_START pr=<n>`), and blob-hash comparison against patch 01.

| # | Item | Status |
|---|------|--------|
| 1 | Codex portable dispatch (#2370/#2091/#1674) | **Applied** — `mktemp` templates end in bare `XXXXXX`, dispatch reads stdin (`- < "$_PROMPT_FILE"`), no `--model` flag |
| 2 | Stop key-byte echo + drop update-check (#1078/#1081) | **Applied** — `setup-deploy.md:80` prints set/missing only; zero `gstack-update-check` references |
| 3 | PR mutations via REST (#1079) | **Applied** — `gh api -X PATCH` in ship legacy modules; `skills/ship/references/EXTERNAL-EFFECTS.md` present |
| 4 | QUESTION-FORMAT contract (#1208/#1066/#2373/#2035) | **Applied** — all five `skills/{plan,qa,review,ship,debug}/references/QUESTION-FORMAT.md` exist, byte-identical to this patch (blob `1106171e`); SHARED-JUDGMENT rule 14 and the SKILL.md step-4 load line present in all five; zero "preamble's AskUserQuestion Format" pointers remain (6 legacy refs now resolve to `references/QUESTION-FORMAT.md`). Residual: `references/support/docs/askuserquestion-split.md` (all five copies) still points at the deleted `scripts/resolvers/preamble/generate-ask-user-format.ts` |
| 5 | Restored dropped ports (#1777/#1920/#2189) | **Applied** — #1777 in `office-hours.md`, #1920 in `qa.md`+`qa-only.md`, #2189 in `plan-ceo-review.md`+`office-hours.md` (anchors + bodies) |
| 6 | Redact scan-at-sink (#9108/#9109) | **Applied** — `gstack-redact --from-file` on the exact dispatch bytes in autoplan/codex sinks; consent + anchors present |
| 7 | `/careful` per-segment wording (#2039) | **NOT applied** — `careful.md` "How it works" still describes whole-command matching, no per-segment tokenizer wording |
| 8 | make-pdf eager-token trim | **NOT applied** — the four sections are still inline in `skills/make-pdf/SKILL.md`; no `references/make-pdf-usage.md`. make-pdf behavior is frozen on this branch, so apply only as a zero-behavior-change doc restructure or drop the item |
| 9 | iOS `/qa` module install instruction (#1735) | **NOT applied** — `ios-qa.md` still instructs adding the DebugBridge SPM dependency directly; no shipped-template generation map, no `.package(path: "DebugBridge")` |

---

## 1. Codex portable dispatch — #2370 / #2091 / #1674  (patch 01)

**Files:** `skills/review/references/legacy/codex.md`, `skills/plan/references/legacy/autoplan.md`, and any other `codex exec` / `codex review` sink.
**Change:** every `mktemp` template ends in trailing `XXXXXX` with **no suffix** (BSD mktemp creates the literal unsubstituted name otherwise, so the 2nd call collides — the failure masquerades as a model stall). Every prompt dispatch reads from **stdin** — `codex exec ... - < "$PROMPT_FILE"` — instead of passing `"$(cat "$FILE")"` as an argv positional (the Windows ~32KB `CreateProcess` argv limit). **No `--model` flag** — host uses its configured default.

## 2. Stop key-byte echo + drop update-check — #1078 / #1081  (patch 01)

**File:** `skills/ship/references/legacy/setup-deploy.md` (~line 80).
**Change:** verify the Render key without printing bytes: `[ -n "$RENDER_API_KEY" ] && echo "RENDER_API_KEY: set"`. Remove any `gstack-update-check` invocation from skill text (Agent Skills owns updates now).

## 3. PR mutations via REST, not `gh pr edit` — #1079  (patch 01)

**Files:** `skills/ship/references/legacy/{ship,land-and-deploy,document-release}.md`, `skills/ship/references/sections/ship/pr-body.md`, `skills/ship/references/sections/document-release/release-body.md`.
**Change:** every PR create/edit uses `gh api -X PATCH "repos/:owner/:repo/pulls/$(gh pr view --json number -q .number)"` (the GraphQL `gh pr edit` path hard-errors on some repos). New `skills/ship/references/EXTERNAL-EFFECTS.md` documents the REST block, the codex-sandbox canary, and the no-runtime fallback (announce the command, never auto-retry, inspect before reconcile).

## 4. QUESTION-FORMAT contract + host-neutral fallback — #1208 / #1066 / #2373 / #2035  (patch 01)

**New file:** `skills/{plan,qa,review,ship,debug}/references/QUESTION-FORMAT.md` (decision brief as assistant text, `question` field < 120 chars, ≤ 4 options, 12-char tab caps, split protocol). Dispatch protocol step 4 loads it. Repoint the ~6 dangling "preamble's AskUserQuestion Format" pointers. Add SHARED-JUDGMENT rule: when the structured question tool is unavailable (Codex host, Claude desktop), render identical options as **numbered prose and never silently default**.

## 5. Restored dropped ports — #1777 / #1920 / #2189  (patch 01)

Lost when `/design` was retired; restored verbatim into surviving modules:
- **#1777** rejection-strength memory → `skills/plan/references/legacy/office-hours.md`
- **#1920** design-system-first audit → `skills/qa/references/legacy/{qa,qa-only}.md`
- **#2189** design-thesis equivalence → `skills/plan/references/legacy/{plan-ceo-review,office-hours}.md`

## 6. Redact scan-at-sink before external dispatch — #9108 / #9109  (patch 01)

**Files:** `skills/plan/references/legacy/autoplan.md`, `skills/review/references/legacy/{codex,claude}.md`.
**Change:** before any `codex`/`claude -p` dispatch of a prompt/diff, materialize the exact bytes to a temp file, run `bin/gstack-redact --from-file` on that file, send the **same** file (exit 3 blocks HIGH, exit 2 confirms MEDIUM, exit 0 clean). Autoplan additionally persists a one-time per-repo consent before its first Codex dispatch.

## 7. `/careful` "How it works" wording — #2039

**File:** `skills/debug/references/legacy/careful.md`, "How it works" section.
**Change:** the hook now checks each command **segment** (splits on `&&`, `||`, `;`, `|`, newlines, quote/subshell-aware) rather than the whole command string — describe the per-segment tokenizer so the doc matches the fixed `careful/bin/check-careful.sh` (the code fix lands via integration). Old text says the hook "checks it against the patterns" (single-command framing); that's now false.

## 8. make-pdf eager-token trim  (see 02-makepdf-bloat-trim.diff)

**File:** `skills/make-pdf/SKILL.md` (tool skill).
**Change:** move `## Common flags`, `## Debugging`, `## Output contract` into a new lazily-loaded `skills/make-pdf/references/make-pdf-usage.md` and leave a one-line pointer; drop the `## When Claude should run it` trigger list (duplicates the frontmatter `description`). Keep inline: the 80% one-command path, the Linux `fonts-liberation` note, the emoji-font note, and the `--to` vs `--format` warning (real footguns). Saves ~706 eager tokens with zero behavior change. **Do not** touch the five judgment dispatchers' eager surface — those cuts (~720 tokens) are gated on the A/B sweep evidence.

## 9. iOS `/qa` module install instruction — #1735  (see 03-ios-qa-module-instruction-SOURCE.patch)

**File:** `skills/qa/references/legacy/ios-qa.md`.
**Change:** the module documents a nonexistent SPM dependency. Replace with: generate the local DebugBridge package from the shipped templates (explicit template→destination map) and add `.package(path: "DebugBridge")` as a local dependency. The template/daemon code fixes land via integration; this is the doc half.

---

## Not here (handled elsewhere)

- Root-cause **code** fixes (gbrain, browse lifecycle, `/careful` tokenizer, make-pdf render bugs, iOS templates/daemon, review-precision harness, privacy runtime, A/B harness) → `gstack2-integration`.
- **Model-overlay subsystem deletion** (`scripts/models.ts`, `model-overlays/*.md`) → `gstack2-integration` (they're orphaned on static main).
- Audit findings, backlog map, bloat ledger → preserved as docs under `docs/gstack-2/`.
