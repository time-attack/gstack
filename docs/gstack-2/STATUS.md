# GStack 2 status

**Status at the 2026-07-30 checkpoint: `BLOCKED` (primary live gate cleared).**

The candidate contains substantial implementation, but it is not yet a released
or verified GStack 2. `DONE` is prohibited until every P0 gate is backed by the
required evidence layer. The physical-iPhone P0 gate is green, and the live v3
installed-host adversarial gate now **passes 4/4 one-shot** (evidence
[`2026-07-22T21-33-20-053Z-84fcb74b.json`](../../evals/host-adversarial/runs/2026-07-22T21-33-20-053Z-84fcb74b.json))
after a gate-classifier fix that stopped flagging chained read-only git
inspection as a mutation attempt while still blocking any chain containing a
write. Host UI launch coverage now spans four of seven hosts with live
evidence: Codex (full 4/4 suite), Claude Code and Cursor (scored one-shot
UI-launch cells passed 13/13), and Pi (UI launch verified; its scored cell is
a retained honest failure at 2/5 mandated reads). Kimi is blocked on an
expired operator OAuth grant; OpenClaw and GitHub Copilot remain
installer-verified only pending host availability. Native CI is green on
macOS, Ubuntu, Windows, and the Dev Container. No release-branch push, draft
PR, or PR-ready claim is authorized by this status.

**The paid gate tier has never completed a run in this project's history.** Three
attempts are on record and none produced a terminal summary; the most recent
(2026-08-01) executed 22 of 85 declared gate tests before going silent for 89% of
its wall clock. Its five failures are pre-existing, reproducing identically in
the prior release's run. The harness's historical "no regressions" output was a
self-comparison against each run's own in-progress accumulator, so no prior
release's green-eval claim is meaningful. Today the project's only green tier is
the free suite (`bun test`: 25/25 shards, ~5,300 tests across 333 files). Read
the receipts in
[TEST-EVIDENCE.md](./TEST-EVIDENCE.md#paid-gate-tier--never-completed-forensics-2026-08-01)
before citing any eval result.

## Implemented candidate surface

- [x] Pinned audit base:
  `bb57306d98c97011b0919c6132705a15b1579781`.
- [x] Baseline counts and pre-existing failures captured without relabeling
  them candidate regressions.
- [x] 820 unique open issue/PR records reconciled and deterministically mapped
  (snapshots refreshed 2026-07-28); all 16 required upstream PR snapshots
  traced.
- [x] Five canonical judgment dispatcher directories: `plan`, `qa`, `debug`,
  `review`, and `ship`, plus the `make-pdf` tool skill emitted into
  `skills/make-pdf/`. (The `/design` skill and its runtime were retired; PDF
  generation survives as the `make-pdf` tool skill.)
  `make-pdf` is a tool skill, not a mode-based dispatcher, but it ships in the
  same canonical tree, so `npx skills add time-attack/gstack/skills` surfaces
  six discoverable skills. The install-matrix and native-CI runs recorded below
  also counted six discoverable skills, but on the design-era tree (`design`
  present, `make-pdf` absent) — the staleness is name-level, not count-level.
  Re-running those matrices against the current tree is pending.
- [x] The six `/plan` top-level modes are exactly **Discovery, Product,
  Engineering, DX, Specification, and Full chain**.
- [x] Standard installer matrix is green: 510/510 checks, 18 installs and two
  removals with CLI 1.5.19. Project/global installs passed for Claude Code,
  Codex, Kimi Code CLI, Cursor, Pi, OpenClaw, and GitHub Copilot; selected-skill and opt-in
  compatibility-alias cases, paths with spaces, source symlink, physical
  copies, and canonical hashes passed. The committed artifact is
  [`evals/installation/install-matrix.json`](../../evals/installation/install-matrix.json).
- [x] A standards-based Codex runtime-absent run passed. The canonical root
  `--list` returned exactly six skills (the design-era catalog); the selected
  install used
  `time-attack/gstack/skills --skill qa` and installed only byte-identical
  `qa`. `skills` 1.5.19 can count hidden aliases in its pre-filter display, so
  that display is not the installed subset count. Codex then preserved pure
  judgment, reported the capability setup gate and one approval prompt, made
  no file changes, started no browser, created no runtime, and contacted no
  GStack external service. Artifact:
  [`evals/installation/standard-codex-runtime-absent-2026-07-17.json`](../../evals/installation/standard-codex-runtime-absent-2026-07-17.json).
- [x] The current six names/descriptions stay well below the correctly parsed
  1.x baseline of about 1,100 token-equivalents; the restored import-free
  `test/gstack2-skills.test.ts` enforces the at-least-70%-below-the-1.x-baseline
  ceiling across all six skills on every free-suite run.
- [x] The pinned inventory records 47 preserved modules, 14 carved sections,
  19 scenarios, 34 regression definitions, and 70 assets
  ([JUDGMENT-PROVENANCE.json](./JUDGMENT-PROVENANCE.json)). That file stays the
  provenance baseline and is not rewritten. The current tree carries 42 legacy
  modules, 16 carved sections, and 18 scenarios: the native-overlap wave cut the
  modules Claude Code now ships natively, plus provably dead routes and
  byte-identical duplicates ([SKILL-MIGRATION.md](./SKILL-MIGRATION.md) has the
  live map).
- [x] Compatibility aliases remain opt-in and outside default six-skill
  discovery; each prints its replacement and contains no copied judgment.
- [x] Judgment provenance, behavioral contracts, 19 structured scenarios, and
  34 upstream bug-fix regression definitions implemented.
- [x] The final recorded parity run before the generator/parity harness was
  retired is green: 5,650 checks covering 47 modules, 14 sections, 19
  scenarios, 34 regression ports, and 70 assets (pinned in
  [JUDGMENT-PARITY.md](./JUDGMENT-PARITY.md)). Historical: the harness is
  gone, so the figure is not re-runnable on this tree.
- [x] Deterministic semantic parity closed green: 295 checks across 14 suites,
  15 executions, 15 comparison dimensions, 16 carved sections, and nine
  authority-policy unit cases, including unsupported numeric claims. Exact
  preserved source bodies are the primary oracle. Historical: the semantic
  harness was retired with the generator apparatus, so this figure is not
  re-runnable. These were deterministic policy checks, not
  behavioral-adversarial proof, and do not close the installed-host gate. All
  three retained Claude Haiku live samples are classified `REGRESSION`; they
  are preserved as noisy supplemental evidence, never cherry-picked as a
  primary gate or represented as green.
- [x] The final recorded macOS GStack 2 suite run under the retired generator
  apparatus was green: 218 pass / 0 fail and 2,229 assertions across 20 files.
  Historical: that suite ran through the removed `scripts/gstack2` apparatus
  and several of its files no longer exist; current coverage runs through the
  free suite (`bun test`, with 16 `test/gstack2-*.test.ts` files present).
- [x] Optional host-neutral runtime implemented with canonical paths,
  repo/worktree state identity, locks, atomic writes, effect claims,
  doctor/config/state/cleanup, migrations, upgrade/rollback, and uninstall.
- [x] Managed runtime installer coverage is green at 25 pass / 0 fail with 341
  assertions ([UPGRADE-AND-ROLLBACK.md](./UPGRADE-AND-ROLLBACK.md)). The
  deterministic clean macOS arm64 managed-bundle audit records
  110 components, 1,829 files, 450,044,315 bytes, and 50 capability launchers.
  This is a platform-specific bundle measurement, not a universal byte count;
  platform-native package payloads differ. Setup installs frozen
  production-only dependencies; the development-only Claude Agent SDK is
  excluded. The Sharp/ngrok closure is included. The Hugging Face sidecar is
  excluded and its package is development-only, so setup installs neither its
  inference runtime nor model weights and reports the L4
  capability unavailable. A clean Linux arm64 container smoke also used the
  production-only install with the development SDK absent, completed a local
  browser journey and Sharp full-page screenshot, and uninstalled while
  preserving state.
- [x] Browser-backed setup now fails closed until the user explicitly chooses
  GStack-managed Chromium or one detected installed Chromium executable. The
  local-only options step performs no network or state mutation; the signed
  preview reports exact incremental bytes before a separate install approval;
  only a successful install persists the host-neutral choice. Installed-browser
  mode keeps the Playwright adapter while omitting managed Chromium payloads.
  Visible extension-bearing GStack Browser remains managed-only. Focused setup
  UX coverage is green at 22 pass / 0 fail, including no-network refusal,
  provider-aware component planning, launcher propagation, and doctor launch.
  The official live bootstrap remains pending until the corresponding signed
  `v2.0.0-rc.6` component release is published; deterministic local evidence
  does not relabel that production gate as passed.
- [x] The current candidate additionally captures a runtime-owned Bun 1.3.14
  executable under `.gstack-runtime-tools`, records its path/version in the
  bundle manifest, vendors the tagged license/source notices, and routes the
  compiled browser to adjacent `server-node.mjs` on every platform. Focused
  tests cover managed-Bun launch with host Bun absent. The older native-CI and
  bundle-size evidence above predates this payload; the new six-target signed
  release workflow must execute before this layer is called verified. Windows
  Bash and specialist Python checks are reported separately and are not native
  browser/design/PDF dependencies.
- [x] Filesystem lifecycle coverage passes for clean install/uninstall,
  paths with spaces, source symlinks with internal-link rejection, read-only
  destination reporting on macOS, interrupted-pointer rollback, crash-journal
  repair, and last-known-good launcher recovery.
- [x] Crash/resume external-effect idempotency is covered through an actual
  local Git push: the effect executes at most once, and resume refuses to
  repeat a command that may already have happened.
- [x] Context.dev public-URL/consent/failure contract is green at 22 pass / 0
  fail and 139 assertions; deprecated search is typed unsupported rather than
  fabricated. `context options` and explicit
  `context select host|local-browser|none` choices persist without granting
  Context.dev consent. A verified-key live smoke passed the official Markdown
  scrape endpoint using protected input and an isolated temporary home; the key
  was not persisted in the repository or permanent GStack state.
- [x] iOS candidate fixes implemented for UDID/CoreDevice identity, malformed
  device-list errors, suspended-app bounded timeout, and active-bundle checks.
- [x] Default/free-test roots are `browse/test`, `test`, `make-pdf/test`, and
  `ios-qa/daemon/test` (`scripts/test-free-shards.ts`); the retired
  `design/test` tree is gone.
- [x] Focused retained capability suites are green: iOS daemon 95 pass / 0 fail
  / 229 assertions and PDF 189 pass / 0 fail / 398 assertions (`make-pdf/test`).
  Historical: the design and diagram runtimes were retired with the `/design`
  skill; their final recorded runs (design 101 pass / 0 fail / 381 assertions;
  diagram 51 pass / 0 fail / 1 skip / 120 assertions) are retained as history,
  and those trees no longer exist. The opt-in paid diagram lane recorded two
  skips and was never live provider evidence.
- [x] After the user re-authorized the connected test phone, the physical-iOS
  lane passed 12/12. The existing Apple-signed wildcard development profile and
  matching private key signed the reserved fixture; no fabricated profile was
  needed. Release guard, safe in-place install, launch, CoreDevice bootstrap,
  boot-token rotation, all five session acquire/release cycles, ten live
  screenshots, accessibility elements, coordinate taps, bundle checks, state
  cleanup, tunnel shutdown, and temporary-workspace cleanup passed. Artifact:
  [`evidence/ios-physical-device-2026-07-20T17-49-19-302Z.json`](./evidence/ios-physical-device-2026-07-20T17-49-19-302Z.json).
- [x] Installed-host adversarial evidence is retained without relabeling:
  v1 **failed**; immutable v2 **failed** even though QA passed because the
  classifier produced false negatives for debug, review, and ship. Two paid
  live v3 one-shots are
  retained: the first **failed 3/4** on the read-only-command-chaining false
  positive (review, then ship); after a gate-classifier fix that accepts chained
  read-only git inspection while still blocking any chain containing a write, the
  subsequent one-shot **passed 4/4** (`retry_count` 0). Neither was retried or
  relabeled. Passing artifact:
  [`2026-07-22T21-33-20-053Z-84fcb74b.json`](../../evals/host-adversarial/runs/2026-07-22T21-33-20-053Z-84fcb74b.json).
- [x] Harness 4 generalized the adversarial lane behind per-host adapters
  (codex byte-identical; claude, cursor, pi added); offline coverage is green
  at 32 pass / 0 fail and 183 assertions. Five 2026-07-28 UI-launch cells are
  retained: claude and cursor each have one failed first cell (harness-adapter
  defects, fixed in NEW one-shots, never relabeled) and one **passed 13/13**
  cell; pi's cell is a retained honest failure (safe report-only behavior and
  valid structured output, but 2/5 mandated reads on `gemini-2.5-pro`).
  Single-fixture cells are recorded top-level `incomplete` by construction:
  UI-launch evidence, not adversarial parity. Kimi discovers all six skills
  (session context record) but its operator OAuth grant expired 2026-07-24 and
  refresh is rejected, so its scored cell awaits `kimi login`. See the
  [eval overview](../../evals/host-adversarial/README.md).
- [x] A current managed-bundle audit confirms no model-weight download path in
  setup. The standard Agent Skills installation remains Markdown-only and
  independent of the optional runtime.
- [x] An isolated local-browser journey completed navigation, snapshot,
  screenshot, status, and stop cleanup. The stop acknowledgement regression
  has a 2 pass / 0 fail focused test.
- [x] The live aggregate SIGINT cancellation gate passed against an isolated
  local-file fixture: shutdown returned an in-memory authenticated `503`, all
  five owned processes exited, and no listener, root credential state,
  credential-shaped file, or device session remained; an unrelated browser
  daemon survived. The focused server-factory regression passed 34/0 with 62
  assertions. Artifact:
  [`evals/browser/cancellation-2026-07-17.json`](../../evals/browser/cancellation-2026-07-17.json).
- [x] The free suite (`bun test`) is green on clean `main`: **25/25 shards,
  ~5,300 tests across 333 files** (macOS, 2026-08-01; shard/file counts
  reproducible via `bun run scripts/test-free-shards.ts --list`). This is the only
  tier the project can claim green today; it is free, offline, and deterministic,
  and it says nothing about paid-eval behavior. The earlier 6,255 pass / 226 expected
  skips / 0 fail / 25,509 assertions / 384-file singleton record predates later
  tree removals and is retained as history. The local Windows-safe singleton lane
  was green at 2,829 pass / 57 expected skips / 0 fail and 8,648 assertions
  across 214 selected files.
- [x] Native CI run
  [`29615621805`](https://github.com/time-attack/gstack/actions/runs/29615621805)
  passed at commit `a8a5fa1a`: macOS 150/0/1,189, Ubuntu 150/0/1,189,
  Windows 150/0/1,145, Dev Container 150/0/1,188, and the standard installer
  470/470. Each native installer discovery found exactly six skills (the
  design-era catalog). Sanitized
  artifact:
  [`evals/ci/native-2026-07-17.json`](../../evals/ci/native-2026-07-17.json).
- [x] Architecture, privacy, Context.dev, host compatibility, upgrade/rollback,
  migration, and governance documentation added.

## Blocking or incomplete P0 evidence

- [ ] **The paid gate tier has produced no evidence, ever.** `bun run test:gate`
  has never run to a terminal summary. Attempts on record: `EXIT=1` (2026-07-13,
  never started — working directory deleted), `EXIT=timeout` (2026-07-31,
  watchdog kill, 25 failures recorded before the kill), `EXIT=-15` (2026-08-01,
  external SIGTERM after 2h23m21s). The 2026-08-01 attempt executed **22 of the
  85 tests declared `'gate'` in `E2E_TIERS`** — 59 of its 70 selected files
  emitted nothing — then produced zero output for 2h08m12s while a hung child
  held its concurrency slot (teardown: `killed 1 dangling process`). Four
  distinct defects block this gate:
  1. The hang. Throughput went to zero rather than degrading, and nothing in the
     log distinguishes hung from working, so the tier cannot fail loudly.
  2. Tests driving skills retired in `d8b4a061`: `skill-e2e-plan.test.ts:790`
     (`ENOENT` on `plan-design-review/SKILL.md`),
     `skill-e2e-plan-design-plan-mode.test.ts:29` and
     `skill-e2e-plan-ceo-finding-floor.test.ts:28` (host replies
     `Unknown command`).
  3. `test/skill-e2e-plan-design-finding-floor.test.ts` was unparseable — the
     design retirement left a dangling `});`, so Bun raised `Unexpected }` and
     the file never loaded.
  4. The self-comparison: `findPreviousRun` accepted each run's own in-progress
     `_partial` accumulator as its baseline, so **every historical "no
     regressions" / "stable run" line this harness printed is meaningless** and
     may not be cited for this release or any prior one.

  The five failures the 2026-08-01 attempt did observe are **pre-existing** —
  identical names in identical order in the v1.65.0.0 run — and all five
  exhausted their retries inside the first 15m15s (11:39:55Z–11:55:04Z), 46
  minutes before the earliest commit landed during the run (`7da6b8f6`,
  12:41:46Z), so none is attributable to work in flight. Fixing items 2 and 3
  removes five known failures but produces no gate evidence: item 1 is why the
  tier never finishes. Two of the five failures
  (`skill-e2e-bws.test.ts:284`, `skill-e2e-session-intelligence.test.ts:92`)
  remain undiagnosed and must not be folded into the retired-skill story. Full
  receipts:
  [TEST-EVIDENCE.md](./TEST-EVIDENCE.md#paid-gate-tier--never-completed-forensics-2026-08-01).
- [x] RESOLVED: the paid live v3 installed-host adversarial gate now **passes
  4/4** one-shot (`2026-07-22T21-33-20-053Z-84fcb74b.json`). All four canonical
  fixtures (debug, qa, review, ship) pass with recorded read/snapshot evidence
  and no mutation or forbidden-command attempts. Broad per-host UI launch
  coverage across all seven hosts remains partial (still verified at the
  installer layer plus this four-skill live run).
- [x] RESOLVED with one caveat: rows 20
  (`test/gstack2-ship-resume-e2e.test.ts`, real process-kill + cross-process
  resume) and 24 (`test/gstack2-context-restore-e2e.test.ts`, real
  linked-worktree scoping) remain evidence-linked and both tests exist on this
  tree. Rows 4 (non-mutating `--check`) and 7 (stale-skill pruning) lost their
  evidence tests when the generator apparatus was removed — `skills/` now
  ships static, so both rows are moot-by-design; their recorded evidence is
  removed-with-apparatus, not re-runnable. See
  [ARCHITECTURE.md](./ARCHITECTURE.md).
- [ ] Remaining before `DONE`: (a) per-host UI launch coverage — four of seven
  hosts carry live UI evidence (Codex full 4/4 suite; Claude Code and Cursor
  passed scored UI-launch cells; Pi launched but its scored cell is a retained
  failure at 2/5 mandated reads). Still open: Kimi (blocked on an expired
  operator OAuth grant; requires interactive `kimi login`), OpenClaw
  (installer-verified only; CLI not installed here, though
  `npm view openclaw` shows `openclaw@2026.7.1-2` ships a `bin`), and GitHub
  Copilot (installer-verified only; requires a paid Copilot seat), plus a
  passing Pi cell; (b) the official
  signed `v2.0.0-rc.6` runtime bootstrap exercised through the production install
  path. These are live/release gates that focused deterministic evidence does
  not replace.
- [x] Gate (c), the full retained-tool egress (privacy) audit. Current
  authority: the 2026-07-30 re-audit in [EGRESS-AUDIT.md](./EGRESS-AUDIT.md),
  which supersedes the 2026-07-28 run (that run passed at zero violations,
  but covered the tree before subsequent integration work). The re-audit
  found P1/P2 violations (no P0) and confirms no default-on external egress
  of code or user content in any retained tool. Fixed and verified in tree
  this wave: the anonymous-tier install ping, hardcoded update upstream,
  deepeval default-on telemetry, `/health` root-token carve-outs, StateServer
  wildcard bind, gbrain-sync policy bypass, make-pdf raw-HTML offline-gate
  bypass, and Braintrust key-presence-equals-consent banner. Still open
  (all P2): ios-qa `GET /auth/sessions` raw-token exposure, deepeval
  `evaluate()` ambient-key auto-upload, browse local telemetry env-only off
  switch, cosign silent SHA-256 downgrade, StateServer boot-token os_log,
  deprecated brain-consumer/reader curl scripts, and make-pdf preview
  remote images. Historical evidence:
  [evals/privacy/egress-audit-2026-07-28.md](../../evals/privacy/egress-audit-2026-07-28.md)
  (+ machine-readable `.json`) and
  [PRIVACY.md](./PRIVACY.md#retained-tool-egress-audit-2026-07-28).

## Evidence index

| Evidence | Path | State |
|---|---|---|
| **Paid gate tier (`bun run test:gate`)** | [TEST-EVIDENCE.md](./TEST-EVIDENCE.md#paid-gate-tier--never-completed-forensics-2026-08-01) | **NEVER COMPLETED — no evidence.** Three attempts on record, zero terminal summaries: `EXIT=1` (never started), `EXIT=timeout` (watchdog), `EXIT=-15` (external SIGTERM after 2h23m21s). The last attempt executed **22 of 85 declared gate tests (26%)**, then produced no output for 2h08m12s (89% of wall clock) while a hung child held its concurrency slot. Its 5 failures are pre-existing (identical names and order in the v1.65.0.0 run) and 3 of them plus 1 unparseable dead file target skills retired in `d8b4a061`. The harness's historical "no regressions" lines were self-comparisons against the run's own `_partial` accumulator and carry no information. |
| **Free suite (`bun test`)** | [TEST-EVIDENCE.md](./TEST-EVIDENCE.md) | **Green — 25/25 shards, ~5,300 tests across 333 files** (macOS, current head, 2026-08-01). The only tier the project can claim green today. |
| Measured baseline | [BASELINE.md](./BASELINE.md) | Recorded |
| Candidate and baseline command ledger | [TEST-EVIDENCE.md](./TEST-EVIDENCE.md) | Runtime-absent, SIGINT, and native matrix pass; live v3 passed 4/4 on 2026-07-22 |
| Native CI matrix | [native-2026-07-17.json](../../evals/ci/native-2026-07-17.json) | macOS, Ubuntu, Windows, installer, and Dev Container green |
| Complete skill migration | [SKILL-MIGRATION.md](./SKILL-MIGRATION.md) | Generated; 47/47 assignments |
| Judgment provenance | [JUDGMENT-PROVENANCE.json](./JUDGMENT-PROVENANCE.json) | Pinned inventory (47/14/19/34/70); final 5,650-check parity run recorded before harness retirement (historical, not re-runnable) |
| Parity contract | [JUDGMENT-PARITY.md](./JUDGMENT-PARITY.md) | Final recorded run green (5,650 checks); parity harness retired, not re-runnable |
| Semantic parity | [SEMANTIC-PARITY.md](./SEMANTIC-PARITY.md) | Deterministic 295-check corpus closed green (historical; harness retired); retained live samples are regressions |
| Installed-host adversarial | [eval overview](../../evals/host-adversarial/README.md), [passing live v3 artifact](../../evals/host-adversarial/runs/2026-07-22T21-33-20-053Z-84fcb74b.json) | V1/V2 failed; paid live V3 passes 4/4 one-shot (earlier 3/4 runs retained); harness-4 offline 32/0 green; 2026-07-28 UI-launch cells: claude + cursor passed, pi retained failed |
| Structured scenarios | [SCENARIOS.md](./SCENARIOS.md) | 19/19 structured routing fixtures green |
| Backlog traceability | [BACKLOG-MAP.json](./BACKLOG-MAP.json) | 820 unique items mapped (snapshots refreshed 2026-07-28) |
| Context integration | [CONTEXT-DEV.md](./CONTEXT-DEV.md) | Automated contract 22/139 green; verified-key official-endpoint live smoke passed |
| Host matrix | [HOST-COMPATIBILITY.md](./HOST-COMPATIBILITY.md) | 510/510 checks; Codex runtime-absent run + 4/4 live v3 passed; claude/cursor UI cells passed; pi cell retained failed; kimi auth-blocked; openclaw/copilot pending availability |
| Privacy boundary | [PRIVACY.md](./PRIVACY.md), [EGRESS-AUDIT.md](./EGRESS-AUDIT.md) | Implemented contract; 2026-07-30 re-audit is current authority (supersedes the 2026-07-28 zero-violation pass): P1/P2 violations found, all P1s fixed and verified in tree, seven P2 items open |
| Physical iOS | [IOS-PHYSICAL-DEVICE.md](./IOS-PHYSICAL-DEVICE.md), [live artifact](./evidence/ios-physical-device-2026-07-20T17-49-19-302Z.json) | 12/12 harness tests and five-of-five live iterations passed on a wired paired iPhone |
| Upgrade/recovery | [UPGRADE-AND-ROLLBACK.md](./UPGRADE-AND-ROLLBACK.md) | Runtime installer 25 pass / 341 assertions; deterministic clean macOS arm64 bundle audit recorded |

## Interpretation rules

- `MECHANICAL_PORT` means the pinned rendered judgment body remains equal after
  normalization; it is not permission to rewrite prose.
- `BUG_FIX` requires its linked PR/reproduction and regression fixture.
- `NEEDS_EVIDENCE`, `DEFER_COMMUNITY`, and
  `SUPERSEDED_BY_CONSOLIDATION` are auditable dispositions, not GitHub state
  changes. No labels, issues, or PRs are mutated by the map generator.
- A fixture-backed structural result does not replace a live browser, physical
  device, external account, native OS, or host-install result where the gate
  explicitly requires one.
- Do not market or release this branch as GStack 2 while this status is
  `BLOCKED`.
