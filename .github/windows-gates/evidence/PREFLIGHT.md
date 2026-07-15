# Central Windows gate preflight — hold for approval

Status: local preparation only. Nothing has been committed, pushed, dispatched, or otherwise mutated on GitHub.

## Fork and trigger boundary

- Preparation root: /Users/sinabina/Documents/Codex/2026-07-14/clo/gstack/.gstack/maintainer/native/environments/cloud-windows/time-attack-gstack-20260715/
- Only remote: origin = https://github.com/time-attack/gstack.git
- Local branch: codex/windows-gates-20260715-central
- Branch base: bb57306d98c97011b0919c6132705a15b1579781
- Remote branch check: absent before approval.
- Only active workflow: .github/workflows/codex-windows-gates-20260715-central.yml
- Only event: push to the exact branch codex/windows-gates-20260715-central
- Permission: contents: read
- Workflow SHA-256: 042d2d36d669e51e52ea17e18146ee60f79d07dd09eda0052983c1f681d4ffa7
- Ten pre-existing workflows moved byte-for-byte to .github/windows-gates/evidence/disabled-workflows/ and verified by disabled-workflows.sha256.

There is no pull_request, workflow_dispatch, schedule, secret reference, cache action, or other active workflow.

## Checkout EOL invariant

- Root `.gitattributes` SHA-256: d9c1feb4bfb9cd8ecc1fb7a30c88536960566116aefd669669ef76edde189958.
- PowerShell rule: `*.ps1      text eol=lf`.
- Proof command: `git check-attr text eol -- .github/windows-gates/pr1743/windows/run-pr1743-windows-probe.ps1`.
- Proof result: `text: set` and `eol: lf`.

This keeps the reviewed LF bytes—and therefore the pinned SHA-256—stable even when Git for Windows is installed with `core.autocrlf=true`.

## Action and credential boundary

- actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 (v4.2.2), persist-credentials: false.
- actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 (v4.4.0), Node 24.16.0, token empty.
- actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065 (v5.6.0), Python 3.13.14, token empty.
- oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6 (v2.2.0), Bun 1.3.14, no-cache true, token empty.
- actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 (v4.6.2).

Only checkout and upload may use platform credentials. Setup actions receive an explicitly empty token. No tested subprocess receives the parent Actions environment.

## Source and consumer materialization

All GStack refs are in one complete-history local bundle:

- Path: .github/windows-gates/payloads/gstack-exact-windows-refs.bundle
- Bytes: 74,205,603
- SHA-256: 7b7c543417e066c8a5da6eeb8b179e1cc4bb16e7da0237441457c421531c08ef
- Base: a3259400a366593e0c909dd9ac3e59752efd2488
- #2260: b9fbe4dea9b192d5d6fe6814bc558f89ef41dde7
- #1743: 33143ad9239b78c1b79a2bf235ac202ecfe2e61b
- #2243: f1fc59aa98a38cc8115c0ba9b0d1cae06895c08d
- #2245: c506e7aa6412d5fd053875b61f22ab3bed8cc954
- #2246: 2f19b03b9b1df3351010883d7f2627721d251863
- #2247: 1ad60f617d387c80ae6084b1dde569a83f1f59ec

Every phase clones the local bundle into a fresh root, checks out the exact SHA detached, verifies the bundle, runs full fsck and a missing-object scan, and asserts non-shallow state.

All consumer trees are branch-contained pinned archives. Runtime consumer Git network reads were removed. Every baseline/candidate phase gets a separate extracted consumer root. The immutable #1981 transfer subset was independently validated before and after copying. Manifest SHA-256 is 31a75f09ed5b615eb4079c1fe92fc3a1bb5659dec0bf22508899c9dadbfaa8c8; validator SHA-256 is 229e4ad28130b6d758f97aad3de40806f24bbb948ab32b29bc24a785d11fdc83. All nine prepared-tree tar archives passed path-traversal scans.

## Child-process and network boundary

Common helper SHA-256: 439df951b75592014b094020679dfe1368b0e2932c8c43d037bd0342ccff07ba.

- Every owned external child launch goes through one helper.
- The helper unconditionally calls ProcessStartInfo.Environment.Clear().
- It supplies only a newly constructed minimal Windows environment plus explicit test variables.
- The minimal PATH explicitly includes the native Windows PowerShell directory required by the reviewed #1743 probe.
- It rejects GITHUB_*, ACTIONS_*, RUNNER_*, cloud credentials, tokens, secrets, passwords, proxies, OIDC, upload, server-URL, and API-URL keys.
- Environment evidence records keys only and never values.
- Frozen Bun installs run with --ignore-scripts.
- Only frozen package fetches and the exact lockfile-provided Playwright Chromium download occur before lockdown.
- Consumer and source materialization is offline.
- Each post-install probe runs under a firewall rule blocking every non-loopback outbound IPv4 range and all IPv6.
- Lockdown setup is internally exception-safe: any partially created rule is removed and its absence rechecked before the setup error is rethrown.
- After successful setup, the rule is removed in caller finally and restoration evidence is written before artifact upload.

The reviewed immutable #1743 inner probe retains its seven original hashes. Its direct node and Bun calls occur only inside the outer pwsh process launched with the cleared minimal environment, so descendants cannot recover the Actions parent environment.

## Matrices and fixed commands

### PR #2260

- Affected: onemancompany@8f880c03, plain path.
- Affected: gbrain@5008b287, path with spaces.
- Control: plane@bed58d9b.
- Each consumer archive is materialized separately per phase and is the launch CWD/integration context.
- Control probe SHA-256: 3671449c1ff031088e83fccdd74029e92bccedada1458a223eb51e08125653f9.
- The control probe converts native `GSTACK_UNDER_TEST` with `cygpath -u` and requires the result to remain under `/c/gstack-isolated/pr-2260/` before `cd`.
- Outer command: bash "$(cygpath -u "$PR2260_FIXED_WRAPPER")"
- Command SHA-256: cc3e5749348a7c0feb70fbf83d7be8fb9ab0d26750da369be85982eb1bb0d5ce
- Affected expectation: baseline nonzero, candidate zero.
- Control expectation: baseline zero, candidate zero.

### PR #1981

- Primary affected: healthy-gbrain-clean and healthy-gstack-auto-spaces.
- Primary control: no-cli-stagehand.
- Secondary: timeout-stagehand and missing-version-secondary.
- Default MSYS conversion remains enabled; GBRAIN_HOME, MSYS_NO_PATHCONV, and MSYS2_ARG_CONV_EXCL are absent.
- Native Windows python3.exe is first on PATH and asserted with os.name=nt and platform.system=Windows.
- Every phase has separate source, consumer, HOME, state, evidence, PGLite, and official-gbrain executable roots.
- Fixed command SHA-256: 3468b951bfb21d68751872e9f8f96b9abcdcd6d6dd3fb0f1af39c90f28d36b8e
- Product command SHA-256: c7dca8c1854c743a068054b3da932185cf9fbca95cb4743bcf719b7cad176849
- Every case expects baseline 43 and candidate zero.

### PR #1743

- Affected: gstack-auto@17bf2a0 and zotero-arxiv-daily@05b20ec.
- Control: stagehand@2a6e20b.
- Separate consumer/source/HOME/state/evidence/artifact roots per phase.
- Fixed command SHA-256: 2f2be4a7afc849e231ba284fc4177ec2bfe1ffa2d85275d81775473a30abe35b
- Real CurrentUser DPAPI, synthetic Chrome v10 cookie profile, process lifecycle/exit/dual-pipe/missing-binary/cap/sentinel assertions.
- Affected expects baseline nonzero/candidate zero; control expects zero/zero.

### Model overlays (secondary only)

- #2243, #2246, and #2247 assert baseline zero and candidate zero.
- #2245 is explicitly not green: it asserts source-approved raw-exit parity and, when nonzero, identical normalized failure identity and count.
- Fixed command: bun run test:windows
- Command SHA-256: 516baff1792e323331c4d2bf1a5298d8ee24b20bcfeaf7bb1e77360ac77d42ef
- #2268 is excluded.

## Artifact roots

- #2260: %RUNNER_TEMP%\gstack-windows-gates\pr2260\<case>
- #1981: %RUNNER_TEMP%\gstack-windows-gates\pr1981\<case>
- #1743: %RUNNER_TEMP%\gstack-windows-gates\pr1743\<case>
- Model overlays: %RUNNER_TEMP%\gstack-windows-gates\model-overlays\pr-<number>

Raw stdout/stderr, source invariants, tool facts, key-only environment records, lockdown/restoration records, phase results, screenshots where applicable, and per-file artifact SHA-256 manifests are uploaded with unique run/attempt names.

## Local validation completed

- actionlint v1.7.11: pass.
- PowerShell 7.6.2 parser: 9 files, pass.
- Bash parser: 7 files, pass.
- OrderedDictionary failure-identity self-test: pass, SHA-256 86afd7c96ff5c66677047190238ab77ae529acfcca09d516bb31fb288d587d31.
- Static launch-policy test: 25 reviewed invocations, pass; test SHA-256 959500901d4488e55896b05b269963a9cc18978b77bcae51e194640562a2e5e3.
- `git check-attr`: hash-pinned #1743 PowerShell probe reports `text: set`, `eol: lf`.
- Active workflow count: exactly 1.
- Disabled workflow verification: 10/10 pass.
- Git bundle: complete history and seven exact refs.
- Transfer validator: source and destination pass with zero stderr.
- Tar path-traversal scans: 9/9 pass.
- Maximum branch payload file: 74,205,603 bytes, below 100 MB.

This preflight remains on hold until explicit approval to commit and push.
