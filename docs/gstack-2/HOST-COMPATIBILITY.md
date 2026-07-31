# GStack 2 host compatibility

This matrix uses evidence tiers. It does not call a host “supported” merely
because its directory name exists in legacy setup code.

## Tiers

| Tier | Meaning |
|---|---|
| **Portable** | The canonical `skills/<name>/SKILL.md` tree follows the Agent Skills specification and uses no required host-private placement logic. This is a source-format claim. |
| **Verified** | The named layer and matrix cells passed against a recorded host/installer version. A scoped “Verified — installer” claim does not imply the host UI launched or executed judgment. |
| **Native** | A necessary host API adds behavior unavailable through portable skills while consuming the same canonical judgment source. Native is not “better”; it carries an additional adapter maintenance contract. |

Tiers are cumulative only when evidence says so. A portable host is not
automatically verified. A legacy generated host output is not a native GStack 2
bundle.

## Canonical installation

```bash
npx skills add time-attack/gstack/skills
```

The standards installer owns host detection, destination paths, project/global
scope, copy versus symlink, updates, removal, and selected-skill installation.
Review its detected-host prompt; detection must never silently enroll a host.

Examples supported by the installer interface:

```bash
# One public skill only (point selection at the canonical skill directory)
npx skills add time-attack/gstack/skills --skill qa

# Installer-managed global scope
npx skills add time-attack/gstack/skills -g
```

Run `npx skills add --help` for the installed CLI version before scripting
agent-selection flags. GStack deliberately does not reproduce those flags or
host paths in `./setup`.

The expected discoverable names are exactly:

```text
plan
qa
debug
review
ship
make-pdf
```

Compatibility aliases live at `skills/.compat/<name>/SKILL.md` (routing-only,
no judgment); the dot-prefixed directory keeps them out of discovery, so
neither they nor `references/legacy/*.md` may appear as additional skills. Installing a subset must not pull the other
public entries unless the user selected them.

The committed `skills` CLI 1.5.19 evidence run predates the `design` →
`make-pdf` change, so its recorded discovery result is the six design-era names
(`debug`, `design`, `plan`, `qa`, `review`, `ship`), not the current set. For
selected installation, use the canonical `skills/` source as in the example
above. That CLI version's pre-filter display can count hidden
compatibility aliases, but the committed actual-host artifact proves that only
the selected `qa` directory was installed; the display count is not an
installed-skill count.

## Candidate installer matrix

The isolated standard-installer matrix passed 510/510 checks with `skills` CLI
1.5.19: 18 install cases and two removal cases. Default discovery projected
only canonical `skills/`; separate explicit-selection cases covered a single
canonical skill and an opt-in legacy alias. The matrix used symlinked and spaced
source paths matching a clean checkout where ignored legacy host trees are
absent. Every installed file was a physical copy and its hash matched the
selected source. The standard skill installation remains Markdown-only and
does not install the optional runtime. The committed evidence artifact is
[`evals/installation/install-matrix.json`](../../evals/installation/install-matrix.json).
That artifact is **historical evidence as of its 2026-07-20 `generatedAt`
date**: it was generated against the design-era skill set (`design` in place of
`make-pdf`) by a matrix script that has since been removed. Its
installer-mechanics results (copy fidelity, hashes, scope handling, removal)
stand as of that date; it does not verify discovery of the current six-skill
set.

| Host | Portable | Project all-five | Global all-five | Selected-skill coverage | Installer tier | Host UI/process |
|---|---|---|---|---|---|---|
| Claude Code | yes | pass | pass | no separate subset case | **Verified — installer** | **UI-verified**: six-skill discovery + `/qa` activation probes passed; scored one-shot cell **passed 13/13** ([artifact](../../evals/host-adversarial/runs/2026-07-28-uilaunch-claude-2.json)); first cell retained failed on a harness parser defect ([artifact](../../evals/host-adversarial/runs/2026-07-28-uilaunch-claude.json)) |
| OpenAI Codex | yes | pass | pass | global `qa`, `review`, `ship` pass + removal pass; actual selected `qa` runtime-absent run; opt-in alias covered | **Verified — installer**; runtime-absent invocation passed | **UI-verified**: live v3 adversarial **passed 4/4** one-shot ([artifact](../../evals/host-adversarial/runs/2026-07-22T21-33-20-053Z-84fcb74b.json)); v1, v2, two 3/4 live v3 one-shots, and a 3/4 harness-4 `gpt-5.6-sol` one-shot ([artifact](../../evals/host-adversarial/runs/2026-07-21-v4-live-gpt-5-6-sol.json)) retained failed |
| Kimi Code CLI | yes | pass | pass | no separate subset case | **Verified — installer** | six-skill discovery verified from kimi's own session context record; every model call fails 401 (local OAuth grant expired 2026-07-24, refresh rejected) — scored cell pending operator `kimi login`. Browser automation uses the consented GStack local-browser fallback |
| Cursor | yes | pass | pass | project `qa`, `review`, `ship` pass + removal pass | **Verified — installer** | **UI-verified**: six-skill discovery + `/qa` activation probes passed; scored one-shot cell **passed 13/13** in ask mode ([artifact](../../evals/host-adversarial/runs/2026-07-28-uilaunch-cursor-2.json)); first cell retained failed on plan-mode final-message conflict + a harness plan-tool misclassification ([artifact](../../evals/host-adversarial/runs/2026-07-28-uilaunch-cursor.json)) |
| Pi | yes | pass | pass | no separate subset case | **Verified — installer** | UI launch + `/qa` activation verified by probe; scored one-shot cell **failed** — safe report-only behavior and valid structured output but only 2/5 mandated reads (pi 0.80.9, `gemini-2.5-pro`), retained as-is ([artifact](../../evals/host-adversarial/runs/2026-07-28-uilaunch-pi.json)) |
| OpenClaw | yes | pass | pass | project `ship` single-skill pass | **Verified — installer** | pending host availability: CLI not installed here; `npm view openclaw` shows an installable CLI (`openclaw@2026.7.1-2`, `bin: openclaw`) |
| GitHub Copilot | yes | pass | pass | no separate subset case | **Verified — installer** | pending host availability: requires a paid Copilot seat; not installed here |

The representative selection cases installed exactly `qa`, `review`, and
`ship`, independently at project scope for Cursor and global scope for Codex,
then removed them noninteractively. Separate cases installed only `ship` for
OpenClaw and explicitly selected the `office-hours` compatibility alias for
Codex; neither alias nor unselected canonical skill was silently enrolled.
`--copy` was advertised and used.

The installer matrix itself is filesystem verification. Host UI execution is
evidenced separately, per the Host UI/process column: Codex passed the full
4/4 live adversarial suite; Claude Code and Cursor passed scored one-shot
UI-launch cells (single-fixture, recorded `incomplete` by construction — a
UI-launch cell, not adversarial parity); Pi's cell is a retained honest
failure; Kimi is blocked on an expired operator OAuth grant; OpenClaw and
GitHub Copilot are installer-verified only, pending host availability. The
activation token for the slash-capable hosts is `/skill` (probe-verified);
Codex activates on `$skill`. A separate actual Codex invocation installed only `qa`
from `time-attack/gstack/skills`, with the optional runtime absent, and passed
the judgment/setup-gate behavior without changing its workspace or creating a
runtime or browser. The Codex adversarial lane now has a passing live result:
the 2026-07-22 paid live v3 one-shot **passed 4/4** (Codex CLI 0.145.0,
`gpt-5.4`, `retry_count` 0; artifact
[`2026-07-22T21-33-20-053Z-84fcb74b.json`](../../evals/host-adversarial/runs/2026-07-22T21-33-20-053Z-84fcb74b.json)).
The retained failed history is unchanged: v1 and immutable v2 failed, two
earlier live v3 one-shots each failed 3/4 (review compound inspection, then
ship `git symbolic-ref` under the pre-fix classifier), and a harness-4
`gpt-5.6-sol` one-shot (Codex CLI 0.144.4, 2026-07-21) failed 3/4 when the
ship fixture logged one forbidden command attempt (the session ran
`npm run check` during the report-only readiness assessment; artifact
[`2026-07-21-v4-live-gpt-5-6-sol.json`](../../evals/host-adversarial/runs/2026-07-21-v4-live-gpt-5-6-sol.json)).
The 4/4 pass is a single-model result on the model recorded in its artifact
and does not supersede the retained `gpt-5.6-sol` failure. None was retried or
relabeled; the offline harness suite (now harness 4 with per-host adapters) is
green at 32 tests / 183 assertions. The installer
matrix used the current local canonical projection through the published
`npx skills` CLI. The release branch remained unpushed; native CI used the
temporary `codex/gstack-2-ci-20260717-39bc307b` ref only.

Hosts still without any live host-UI execution evidence:

- **Kimi Code CLI** — installer- and discovery-verified only; the scored cell
  is blocked on an expired operator OAuth grant (`kimi login` required).
- **OpenClaw** — installer-verified only; the CLI is not installed here.
- **GitHub Copilot** — installer-verified only; requires a paid Copilot seat.

Pi has live UI evidence, but its scored cell is a retained failure, not a
pass.

Legacy generators currently know ten host names. That is historical breadth,
not proof that all ten install correctly. Kiro's old Codex-rewrite behavior and
other host-output transforms are outside the canonical 2.0 path.

## Verification procedure and evidence

Use a clean temporary home and project for every cell; never test against an
operator's live skill directory.

1. Record OS, host version, Node/npm version, and `skills` CLI version.
2. List the source and assert exactly five default entries.
3. Install all five at project scope and verify each host discovers only those
   five GStack public skills.
4. Remove them through the standard installer.
5. Repeat at global scope.
6. Install a selected subset; verify unselected skills were not enrolled.
7. Reinstall/update without re-detecting or enrolling an unselected host.
8. Invoke a pure judgment mode with `gstack` absent from `PATH`.
9. Invoke a capability-dependent mode and verify one actionable runtime offer,
   without breaking judgment.
10. Exercise a path containing spaces and, where supported, symlink and
    read-only failure behavior.
11. Record exact command, exit status, output artifact, and cleanup result in
    [TEST-EVIDENCE.md](./TEST-EVIDENCE.md).

The scripted matrix runner (`scripts/gstack2/test-install-matrix.ts`) and its
test file were removed with the rest of `scripts/gstack2/`, so the committed
matrix JSON cannot be regenerated and stands as historical evidence at its
recorded date. To re-verify installation against the current tree, run the
standard installer manually from a clean temporary home and project:

```bash
# From a clean temp project (HOME pointed at a temp dir):
npx skills add time-attack/gstack/skills            # all six, project scope
npx skills add time-attack/gstack/skills -g         # global scope
npx skills add time-attack/gstack/skills --skill qa # selected subset
```

Then assert the discovered set is exactly the six canonical names, compare
each installed file's hash against its source, verify the subset case
installed only the selected skill, and remove everything through the same
installer.

The committed historical matrix (2026-07-20, design-era skill set) passed
510/510 installer CLI checks across 18 installs and two
removals; its JSON artifact is committed at
[`evals/installation/install-matrix.json`](../../evals/installation/install-matrix.json).
Steps 8–9 passed for the recorded Codex runtime-absent invocation; UI-launch
cells now also cover Claude Code, Cursor, and (as a retained failure) Pi per
the matrix above. The paid live v3
adversarial gate **passed 4/4 one-shot** on 2026-07-22; the 3/4
one-shots are retained as immutable failed runs, not pending runs. Evidence:
[`standard-codex-runtime-absent-2026-07-17.json`](../../evals/installation/standard-codex-runtime-absent-2026-07-17.json),
[`2026-07-22T21-33-20-053Z-84fcb74b.json`](../../evals/host-adversarial/runs/2026-07-22T21-33-20-053Z-84fcb74b.json)
(passed), and the retained failed one-shots
[`2026-07-17T19-48-45Z-v3-live-gpt-5-4.json`](../../evals/host-adversarial/runs/2026-07-17T19-48-45Z-v3-live-gpt-5-4.json),
[`2026-07-21-v4-live-gpt-5-6-sol.json`](../../evals/host-adversarial/runs/2026-07-21-v4-live-gpt-5-6-sol.json),
and [`2026-07-22T20-57-26-117Z-b39a6a57.json`](../../evals/host-adversarial/runs/2026-07-22T20-57-26-117Z-b39a6a57.json).

## Optional runtime/platform matrix

The optional runtime is separate from skill placement. From a repository
checkout, the one host-neutral setup entrypoint is:

```bash
./setup
~/.gstack/bin/gstack doctor --json
```

`./setup` resolves a symlinked checkout, reinstalls the frozen production
dependency set on every run,
builds missing allowlisted capabilities through the runtime-only build target,
validates and hashes every staged file, smoke-tests the CLI, atomically
activates the version, and writes stable POSIX and Windows launchers under
`$GSTACK_HOME/bin` (default `~/.gstack/bin`). The bundle uses `.exe` targets on
Windows and includes the CoreDevice/iOS bundle only on Darwin. Add the bin
directory to `PATH` if the short `gstack` command is desired.

Official bundles capture the pinned Bun 1.3.14 executable inside the immutable
runtime and expose it as `$GSTACK_HOME/bin/bun`; browser launchers do
not use host-global Bun. Node remains the bootstrap/launcher floor. On Windows,
Git for Windows Bash is required only for retained shell helpers and is a
separate doctor check. Python 3 is an optional prerequisite only for specialist
flows that name it. Doctor reports both tools independently of native
browser readiness.

Twenty-five focused installer tests pass with 341 assertions. They cover
manifests, paths with spaces,
source-root symlinks, internal-link/path-escape rejection, failed build/
validation/smoke rollback including native-load rollback smoke,
interrupted-pointer recovery, stable POSIX/Windows launchers, runtime-only
builder selection, deterministic exact Sharp/ngrok platform closure, managed
uninstall, and the host-neutral wrapper.

The deterministic clean macOS arm64 managed-bundle audit records 110
components, 1,829 files, 450,044,315 bytes, and 50 capability launchers. This
is a platform-specific bundle measurement, not a universal byte count;
platform-native package payloads differ. Setup installs frozen production-only
dependencies and excludes the development-only Claude Agent SDK. The
Sharp/ngrok closure is included. The Hugging Face sidecar is excluded and its
package is development-only, so setup installs neither its inference runtime
nor model weights and reports the L4 capability unavailable.

| Platform | Source-level target | Candidate evidence |
|---|---|---|
| macOS | Node runtime + local browser + physical iOS where applicable | Runtime installer 25/341 and the deterministic clean macOS arm64 bundle audit pass. The final native job passed 150/0 with 1,189 assertions. The uninterrupted broad singleton run is green at 6,255 pass / 226 expected skips / 0 fail and 25,509 assertions across 384 files. The physical lane later passed 12/12 harness checks and five-of-five live iterations on an explicitly authorized wired paired `iPhone17,1`; this is device-specific evidence, not universal iOS coverage. Artifact: [`ios-physical-device-2026-07-20T17-49-19-302Z.json`](./evidence/ios-physical-device-2026-07-20T17-49-19-302Z.json). |
| Linux | Node runtime + local browser | Official release artifacts currently target glibc on x64 and arm64; musl is rejected before network and is not claimed. Final native Ubuntu passed 150/0 with 1,189 assertions across 16 files. A clean glibc Linux arm64 container also passed the production-only runtime/browser lifecycle. |
| Native Windows | Node bootstrap/launcher; managed Bun; native browser/design/PDF. Git for Windows Bash only for retained shell helpers; Python 3 only for labeled specialist flows. | Doctor verifies and discloses Bun, Bash, and Python separately. Final native Windows passed 150/0 with 1,145 assertions across 16 files and standard-installer discovery found exactly six skills. The local Windows-safe singleton lane also passed 2,829 / 57 expected skips / 0 fail with 8,648 assertions across all 214 selected files. The older run predates the managed-Bun release artifact, so the new six-target release workflow remains the evidence gate for that layer. |
| Dev Container | Pure skills and optional runtime; browser only when container supports it | The declared image built; the GStack 2 suite passed 150/0 with 1,188 assertions across 16 files, followed by the clean runtime install/browser smoke and state-preserving uninstall. |

Native CI run [`29615621805`](https://github.com/time-attack/gstack/actions/runs/29615621805)
passed every job at commit `a8a5fa1aa381f9b948dfc57af26016092fc33277`:
macOS, Ubuntu, native Windows, the 470-check installer matrix, and the Dev
Container. The sanitized committed record is
[`evals/ci/native-2026-07-17.json`](../../evals/ci/native-2026-07-17.json).
Runs `29608904265`, `29611504979`, `29611757175`, `29612056517` (cancelled),
`29613668419`, `29614448170`, and `29614899434` are retained as superseded
diagnostic evidence, not substituted for the passing run.

The six portable skills remain useful when runtime installation fails. A
runtime failure must not remove or corrupt their standard-installer placement.

## Native adapters

No GStack 2 native tier is currently required or awarded. A future native
bundle needs an accepted issue showing that a host API is necessary, must load
the same canonical judgment modules, and must pass the portable parity suite.
Host-specific presentation metadata such as `agents/openai.yaml` does not by
itself create a second judgment source or a Native claim.
