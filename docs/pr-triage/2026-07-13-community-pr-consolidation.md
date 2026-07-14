# Community PR consolidation log — 2026-07-13

This branch consolidates community pull requests from the July 2026 triage.
Every PR in the merged waves is accounted for below, exactly once: either
**applied** (cherry-picked or hand-ported with original authorship preserved)
or **dropped** (with the reason). Four waves are merged as of this log;
per-wave triage reports with full receipts (test commands, pristine-main
comparisons, codex second opinions) live in the maintainers' local triage
archive.

**Totals: 116 PRs triaged → 61 applied, 54 dropped, 1 held.**

| Wave | PRs | Applied | Dropped |
|------|-----|---------|---------|
| other | 19 | 8 | 11 |
| skills | 6 | 1 | 5 |
| test-infra | 20 | 14 | 6 |
| security | 21 | 13 | 8 |
| hosts | 50 | 25 | 24 (+1 held) |

---

## Wave: other (19 PRs — 8 applied, 11 dropped)

### Applied

| PR | Author | Change |
|----|--------|--------|
| #1599 | @genisis0x | Bumps `diff` ^7.0.0 → ^9.0.0, clearing GHSA-73rr-hh4g-fpgx (both call sites verified `diffLines`-only) |
| #2038 | @jbetala7 | Dependency Review Action CI gate (GitHub first-party action) — *later removed on this fork only; Dependency Graph unavailable here. Kept for upstream.* |
| #2141 | @aversini | Review checklist: loosened-input consumer tracing + stale user-facing strings (hand-ported without the header rename, per the author's own offered variant) |
| #1874 | @timlinnet | plan-eng-review: flag optimistic UI on server-gated actions |
| #1679 | @0xteng | Sidebar terminal: defer IME composing reset to stop CJK double-send |
| #1822 | @Mike-E-Log | Extension: withhold auth token from content-script `getPort` callers |
| #1083 | @burakbengi | README: disclose hourly VERSION fetch + `update_check: false` opt-out |
| #2245 | @chrisquorum | gpt-5.6 model overlay + resolver mapping |

Corrections added on top (separate commits): `clearTimeout` at
compositionstart so continuous Korean typing can't hit a stale composing
reset; the new checklist category enumerated in the severity table and
`/review` category list (+ SKILL.md regen); the getPort auth-race test
updated to pin the guarded behavior (found by codex review).

### Dropped

| PR | Author | Reason |
|----|--------|--------|
| #531 | @keshav55 | Already on main verbatim (landed via #561, v0.12.9.0) |
| #1865 | @mvanhorn | Already on main (rename landed via #1912, v1.57.4.0) |
| #1207 | @topitopongsala | Superseded: `scripts/write-version-files.sh` already guards missing git HEAD |
| #1172 | @yaoyunvfx-png | Duplicate of #1599 with a 2,239-line `package-lock.json` — wrong lockfile; never touches bun.lock |
| #2164 | @sonukapoor | Loses to #2038: author-built scanner, `security-events: write`, SARIF upload fails on every fork PR |
| #557 | @HMAKT99 | Superseded: the silent-failure masking it fixed was removed with `scripts/build.sh`; porting would reintroduce silent-stale skill docs |
| #2173 | @hernandez42 | Guard references nonexistent `this.worktreeBase` (silently disables pruning, fails existing test); claimed attack unreachable — `fs.rmSync` unlinks symlinks, doesn't follow them |
| #406 | @habiz | Promotional README section featuring the author's own tool — maintainer-voice territory |
| #477 | @HMAKT99 | 2,794-line conflicting dashboard feature; main has since grown its own dashboard surfaces |
| #1755 | @sternryan | Author-held draft; PR body states the underlying iOS 26 problem is not fixed |
| #2197 | @smartitemgalaxy | 498-line French README translation; no maintenance story, guaranteed rot |

---

## Wave: skills (6 PRs — 1 applied, 5 dropped)

### Applied

| PR | Author | Change |
|----|--------|--------|
| #884 | @Tarabcak | Reviewer discipline gate: /ship assigns reviewers; /land-and-deploy blocks merge until GitHub approval (ported to templates — original edited generated files — with corrections: reviewRequests-based gate, zsh-safe args, comment-only-review blocker) |

### Dropped

| PR | Author | Reason |
|----|--------|--------|
| #592 | @jojoprison | Already stronger on main (failure-modes audit); Step 0 rename breaks carve-guard test |
| #610 | @kristjanakkermann | Main's confidence-calibration gate + evidence citations already filter the same FP classes; targets stale step numbers |
| #876 | @quanru | Already fixed on main: openclaw frontmatter rewritten colon-free |
| #2126 | @aniruddh10124 | Tense churn breaking checklist parallelism in a shared resolver; edited generated file |
| #2183 | @aniruddh10124 | Indentation change with zero rendering effect (CommonMark); edited generated file |

---

## Wave: test-infra (20 PRs — 14 applied, 6 dropped)

### Applied

| PR | Author | Change |
|----|--------|--------|
| #553 | @ryankc33 | Eliminates shell injection in session-runner (direct spawn, stdin prompt) |
| #789 | @km-git007 | firstResponseMs measured on first NDJSON line, not first tool_use (was over-reporting 5-15s) |
| #1684 | @jbetala7 | Validates `eval:list --limit`; bad values now error instead of silently emptying output |
| #1688 | @officialasishkumar | Parses nested `filter:` blocks in SKILL.md manifests so gbrain queries stay repo-scoped |
| #1766 | @spacegeologist | Fixes iOS QA first-run SwiftPM failures (phantom test path, misplaced tools-version line) |
| #1896 | @jbetala7 | Canonicalizes remote URLs with trailing slash — one repo, one identity |
| #1919 | @sternryan | Sliding 5-min idle tunnel cache TTL so iOS QA device sessions survive past 30s |
| #1936 | @katlun-lgtm | Validates `suppressedResolvers` against the resolver registry (typos now caught) |
| #2025 | @jbetala7 | Unifies credential noun list across revoke/reset/rotate |
| #2040 | @jbetala7 | /careful flags chained `rm` even when a dangerous delete precedes a safe one |
| #2053 | @jbetala7 | Concurrency groups on actionlint + skill-docs workflows (cancel superseded runs) |
| #2243 | @chrisquorum | opus-4-8 model overlay + resolver mapping |
| #2246 | @chrisquorum | fable-5 model overlay + resolver mapping |
| #2247 | @chrisquorum | sonnet-5 model overlay + resolver mapping |

### Dropped

| PR | Author | Reason |
|----|--------|--------|
| #663 | @morluto | Already on main (476b0ec5: job-level permissions incl. `issues: write`) |
| #1177 | @JonasFocus | Already on main (7ca04d8e: build moved to scripts/build.sh with unborn-HEAD fallback) |
| #1578 | @aifllow | Already on main (7ca04d8e: version stamping via write-version-files.sh) |
| #1762 | @jbetala7 | Weaker duplicate of #1684; bare `--limit` still silently defaults; carries VERSION/CHANGELOG hunks |
| #1110 | @JiayuuWang | Fatal bash syntax error; once fixed, its segment merge allows a destructive-command bypass |
| #2009 | @giattijunior | Fork-oriented bundle: pins 5/10 workflows, smuggles an unrelated workflow, fails `git apply` on every file |

---

## Wave: security (21 PRs — 13 applied, 8 dropped)

### Applied

| PR | Author | Change |
|----|--------|--------|
| #1764 | @dwidoo | Fixes iOS 17 SwiftUI button tap; login token moved to a directory that survives backgrounding |
| #1796 | @Bmathews721 | Reuses rotated bearer token so /ios-qa drives a real device across sessions |
| #1851 | @harjothkhara | Fixes context-recovery reviews.jsonl lookup for branch names with slashes (#1127) |
| #1944 | @JonasFocus | /ship PR updates moved from deprecated `gh pr edit` GraphQL to REST |
| #1241 | @jbetala7 | AskUserQuestion prompts kept compact; long explanations moved out of the question field |
| #2045 | @mruderman | Documents the exact AskUserQuestion JSON tool-call shape |
| #2030 | @tonyjzhou | Signal-gated learnings capture with helpful/harmful counters |
| #1053 | @andreycpu | /cso `--fix` mode with a catalog of safe auto-fixes |
| #1523 | @slash9494 | mini-shai-hulud npm/PyPI supply-chain detection rules in /cso comprehensive mode |
| #2227 | @time-attack | Pins basic-ftp to 5.3.1, clearing CVE-2026-39983 + 3 sibling HIGH advisories |
| #526 | @rhiever | Claude Code plugin-marketplace manifests, skill symlinks, README install docs (completed with 27 missing symlinks) |
| #2236 | @time-attack | /bug-report skill: failure descriptions → evidence-backed maintainer-ready reports |
| #2026 | @jbetala7 | Partially applied: one salvaged test pinning fail-closed genuine-zero on the security dashboard (rest duplicated main's #2077 fix) |

Corrections by the wave: #1764 Swift compile fix + legacy token fallback;
#1796 session-cache dead-end fix (codex P1); #1053 two unsafe auto-fix
entries corrected (lockfile gate, CSRF cookie exemption); #2030 feedback
script re-patched for Windows/stderr; #1053/#1523 adapted to the carved
cso layout.

### Dropped

| PR | Author | Reason |
|----|--------|--------|
| #775 | @Madrox | v0.15-era rewrite; erases main's #1745 cross-project trust gate; collides with #2030 |
| #956 | @nicezic | Setup fails `bash -n` at PR head; 73.3K of 73.4K lines are generated dumps; ~46 releases stale |
| #491 | @latifclawbot-mdil | 23 auto-ported OpenClaw stubs contradict the 4 deliberate hand-crafted native skills |
| #1962 | @maxpetrusenkoagent | Superseded by main's #1946 fix; PR head self-broken |
| #398 | @simonemacario | Rewrites protected ETHOS.md — hard no-external-edits rule; needs the maintainer personally |
| #737 | @ljagged | Drags in an unrelated strategist skill + stale preamble edits; overlaps decisions.jsonl system |
| #1711 | @tonyjzhou | CLAUDE.md split against a stale v1.44 base — applying deletes 3 current sections; needs human sign-off |
| #2114 | @aleksanderstevens191-sudo | Edits only generated files; feature already on main via `gstack-config gbrain-refresh` |

---

## Integration fixes (cross-wave)

Applied on the integration branch after the waves merged:

- `package.json` version synced to 1.61.0.0 to match the test-infra wave's
  VERSION bump (the suite pins the two together).
- The session-runner non-fatal I/O count test floor lowered 6 → 5: the
  shell-injection fix (#553) legitimately removed the promptFile temp-file
  path and its wrap, but the count tripwire still expected the old floor.
- The dependency-review workflow from #2038 was removed **on this fork
  only** (Dependency Graph not enabled here); it remains recommended
  upstream where the graph is enabled.

All fork PRs listed above get re-targeted through the base repo when
upstreamed, since fork PRs don't receive base-repo CI secrets.

---

## Wave: hosts (50 PRs — 25 applied, 24 dropped, 1 held)

All applied PRs were verified against the REAL host products, installed on a
real machine: cursor-agent, pi, agy, codex, and opencode each named their
installed gstack skills in live LLM calls; `grok inspect` listed all 54 skills;
gemini's benchmark parsing was validated against live captured stream-json
(success and error paths). Full receipts: fork PR #1.

### Applied

| PR | Author | Change |
|----|--------|--------|
| #1430 | @EricXu-0805 | skill:check honors primary-host skipSkills |
| #2165 | @dpnascimento | question-preference-hook stops emitting invalid permissionDecision "defer" |
| #2146 | @kalpajit279 | Claude Desktop AskUserQuestion pre-empt (prose decision brief) |
| #1816 | @ztownsend | (salvage) hook spike-doc contract correction + empty-stdout AUQ regression test; its hook fix was superseded by #2165 |
| #2229 | @time-attack | team-mode "required" actually enforces: cross-platform .cjs hook, dual-schema deny, Copilot matcher |
| #2221 | @time-attack | gemini benchmark parser for current stream-json + skip-trust + unit fixtures (extended on top: surface real API error messages, live-capture fixture) |
| #2216 | @jizusun | setup copies supabase/config.sh into kiro/codex/factory/opencode runtime roots |
| #2198 | @netkurt | setup links lib/ into opencode runtime root (extended on top: codex/factory/kiro/sidecar/cursor/slate/qoder/grok parity) |
| #1494 | @jbetala7 | honest Hermes setup banner + static test |
| #1054 | @dkoh12 | namespaced generated Hermes skill names |
| #1767 | @spacegeologist | keychain-safe Claude auth preflight for the Codex host |
| #1160 | @mamedov | Codex design binary path resolution + design/dist links (raw ln converted to _link_or_copy) |
| #2123 | @dpattonux | Codex global install moved to ~/.agents/skills per current Codex spec (+ wave migration v1.61.0.0.sh) |
| #1996 | @ashcharus-hue | CLAUDE.md → AGENTS.md rewrite for Codex output |
| #1772 | @spacegeologist | Codex ship qa-only path fix |
| #1101 | @JiayuuWang | AskUserQuestion → request_user_input tool rewrite (+ wave regression test) |
| #1888 | @jbetala7 | co-author trailer bumped to Opus 4.8 (source hunks; docs regenerated) |
| #1935 | @katlun-lgtm | 'Agent tool' phrasing rewrites for hermes/gbrain/openclaw/factory + golden regression tests (goldens regenerated fresh) |
| #1526 | @mvanhorn | --host cursor wired through setup dispatch + install (+ wave slate clone — identical runtimeRoot) |
| #1918 | @withabdul | Pi host config (+ warn-mode description limit ported from #1497; print-only setup case) |
| #2134 | @0xshae | Antigravity (agy) host config — only candidate matching official paths (+ print-only setup case) |
| #1640 | @nmrtn | Mistral Vibe host config (+ print-only setup case) |
| #2116 | @andriyhuang | Qoder host (qoder commit only; --dir + Playwright hunks dropped) — corrected on top to the real product: qodercli binary, ~/.qoder/skills |
| #1282 | @Spenquatch | autoplan outside-voice routing for Codex hosts (+ codex_reviews master-switch port, keychain-safe probe) |
| #2248 | @AgileInnov8tor | Grok Build host: packaging, fail-closed runtime staging, env-var dist-path fix (+ rollback-safe promotion, lib/ link, mktemp fixes) |

### Held (returns as a follow-up)

| PR | Author | Reason |
|----|--------|--------|
| #2241 | @ljodea | /grok second-opinion skill — flag surface, auth path, and graceful degradation verified against grok 0.2.99 live, but the core value (one successful xAI review round-trip) blocked by 402 usage-balance on the verifying account. Ships the moment one live review is receipted. |

### Dropped

| PR | Reason |
|----|--------|
| #934 | 3-line flag whitelist that installs nothing — validates --host cursor then silently no-ops; worse than the error |
| #1326 | 16 raw `ln -snf` calls fail the D7 Windows invariant; no tests; links files hosts/cursor.ts doesn't declare |
| #1184 | raw `ln` + unrelated bun-install-hoisting refactor; stale base predating current setup layout |
| #1004 | right architecture, wrong vintage: 15-months drift, `mapfile` requires bash 4+ (macOS ships 3.2), opencode claim already live on main |
| #1179 | setup refactor entangled with unrelated CI-image scope; stale base; introduces python3 dependency into setup |
| #2034 | redundant with #1430; prints a misleading ✅ for skipped skills |
| #2150 | draft; stringly host lookup; same fix as #1430 |
| #1924 | third copy of the defer fix; oldest base, CONFLICTING, no unique value |
| #1937 | comment-only; its central "correction" is inaccurate vs the current gbrain resolver behavior |
| #382 | already on main in better form (coAuthorTrailer HostConfig field); its tests pin a stale model string |
| #418 | Pi via the pre-host-config architecture; every substantive hunk targets code refactored away |
| #1497 | Pi setup half uses 16 raw `ln`; missing gitignore/README/count-test (its warn-limit idea was ported) |
| #2187 | agy: cliCommand misses the real `agy` binary; squats the .gemini hostSubdir a future gemini host needs |
| #1490 | agy install paths unsupported by any Antigravity documentation |
| #2244 | agy as CLI-only "plugin" at an undocumented path; hardcoded stale version; dead-code link guard; bundles unrelated benchmark scope |
| #413 | pre-architecture antigravity attempt (AGENTS.md/README/setup only) |
| #1593 | Copilot globalRoot layout proven invisible to Copilot's one-level picker scan (#1443 live testing); no setup wiring |
| #396 | Copilot via pre-architecture sed rewrites sharing .agents with codex; 27 conflict markers |
| #1785 | Zed: breaks host-count + setup tests; localSkillRoot collides with codex's; 100KB truncation silently amputates flagship skills |
| #855 | .gitignore line for an ainative host that doesn't exist in the registry |
| #1695 | contradicts current architecture: ROOT/hostSubdir staging is deliberate; writing to $HOME during build would clobber live installs |
| #423 | edits only generated files (wiped on regen); documents a fallback chain no code implements; uses a nonexistent --image flag |
| #560 | Gemini second-opinion dispatcher, architecturally right but 70 conflict markers stale; missing main's timeout wrapper, auth probe, telemetry, and injection guardrails — good spec for a rewrite |
| #2028 | grok host superseded by #2248, which credits it; array-shaped toolRewrites would corrupt generation; CRLF-corrupted .gitignore |
