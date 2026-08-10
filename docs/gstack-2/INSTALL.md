# Install

GStack installs in two layers. The first is the whole point of GStack and takes
one command. The second is optional, consent-gated, and only exists because some
work needs a binary.

```bash
npx skills add time-attack/gstack/skills
```

**The `/skills` path at the end is required.** It is the subpath, the folder
inside the repository that holds the six shipping skills. Installing from the
bare repository root instead (`time-attack/gstack`, with no `/skills`) still
gives you the right six by default, but adding a select-everything flag to that
form does not. `-s "*"` or its `--all` shorthand on the bare root installs 96
skill folders, 695 files, and about 36 MB, because it un-hides the retired 1.x tree
that still sits at the repository root. With `/skills` on the end, the same
flags install 6 folders and 237 files. Name the subpath and the wrong install
is not reachable.

## What it writes into your repository

Project scope is the directory you run it in. In a fresh `git init` repository,
`skills` CLI 1.5.21 leaves three untracked entries:

| Entry | What it is |
|---|---|
| `.agents/` | The skills themselves. 2.9 MB, 244 files. |
| `.claude/skills/` | Six relative symlinks into `../../.agents/skills`. |
| `skills-lock.json` | The installer's lockfile. |

Nothing gitignores them, and the installer's closing line is `Done!  Review
skills before use; they run with full agent permissions.` — no mention of the
write. A `git add -A` after that commits 2.9 MB of vendored skills into your
product history, and the six symlinks resolve to nothing for anyone who checks
that commit out on CI or another machine.

This is the installer's behaviour, not GStack's, and GStack does not own it.
What GStack can tell you is the fix. Run it before your next commit:

```bash
printf '.agents/\n.claude/skills/\nskills-lock.json\n' >> .gitignore
```

`.claude/skills/` rather than `.claude/`, so your own tracked `.claude/`
configuration stays tracked. With those three lines, `git status` reports only
`.gitignore`, which you commit. If you never want the repository touched at all,
install to global scope with `-g`; that leaves `git status` empty.

That is skills only: `/plan`, `/qa`, `/debug`, `/review`, `/ship`, and
`make-pdf`. **It ships no binaries.** If you install it and then ask for a
rendered PDF or a browser-driven QA pass, you are hitting a seam, not a bug.

## What works skills-only

Everything that is judgment:

- `/plan` — Discovery, Product, Engineering, DX, Specification, Full chain.
- `/qa` — the coverage audit, the ask-contract, report-only vs fix-and-verify,
  evidence standards. It can also drive **your host's own browser** if your host
  has one (Claude in Chrome, the Codex desktop browser, Copilot's integrated
  browser, and so on) with no GStack runtime at all.
- `/debug` — root-cause proof before any mutation.
- `/review` — diff, security, compatibility, repository health.
- `/ship` — PR preparation, landing, release docs, rollback reasoning.
- `make-pdf` — reviewing and structuring the document. Not rendering it.

Judgment never requires the runtime. That is a contract, not a default.

## What needs the optional runtime

| You want | Capability |
|---|---|
| GStack's own local browser for QA (`browse`) when your host has none, or you want the headless/local path | `browser` |
| `make-pdf` to actually emit a PDF / HTML / DOCX | `pdf` (expands to `pdf + diagram + browser`) |
| Mermaid / Excalidraw fences rendered as vector diagrams | `diagram` (expands to `diagram + browser`) |
| Physical-iPhone QA (macOS only) | `ios` |
| `gstack doctor`, `gstack state`, `gstack context*`, `gstack context-bill`, `gstack egress`, `gstack-decision-log`, `gstack-decision-search`, and the other `gstack-*` helpers | any install (they ship with the runtime core) |

## Adding it

The ordinary path is to do nothing in advance. When an active skill first
reaches a capability it cannot use, it names the capability, explains the
network and download boundary, and asks. Deferring costs you nothing except that
capability.

The manual equivalent, run **from the installed skill directory** that
`npx skills list` prints (for example `.claude/skills/make-pdf` or
`.agents/skills/make-pdf`):

```bash
# 1. Local only. No network, no changes. Shows which Chromium engines you can pick.
node references/support/runtime-bootstrap.mjs options --capability pdf

# 2. One public GitHub request for signed manifest metadata. Downloads nothing.
node references/support/runtime-bootstrap.mjs preview --capability pdf --browser managed

# 3. Reprints the same plan, then installs.
node references/support/runtime-bootstrap.mjs install --capability pdf --browser managed --yes
```

**Until the signed `v2.0.0-rc.6` release is published** (it ships with the
release tag), step 2 exits with `BOOTSTRAP_RELEASE_UNAVAILABLE` and downloads
nothing. That is expected during the beta: the runtime is optional, and every
skill runs in judgment-only mode without it.

Real output from step 2 on macOS arm64, once the release exists:

```
GStack optional runtime 2.0.0 for darwin-arm64
Capabilities: browser, diagram, pdf
Browser: managed isolated Chromium
Components: browser-code, browser-headless, core, diagram, pdf
Download: 208786482 bytes across 5 component(s)
```

Roughly 199 MB, because a managed Chromium is in there. To skip that download and
reuse a browser you already have, take the path `options` printed:

```bash
node references/support/runtime-bootstrap.mjs install --capability pdf \
  --browser installed --browser-path "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --yes
```

Notes that matter:

- `--yes` is required on `install`; without it you get
  `BOOTSTRAP_CONSENT_REQUIRED`. Preview consent is not install consent.
- Downloads come only from the pinned official GitHub Release, with declared
  byte count and SHA-256 verified, and Cosign checked when Cosign is already
  present. Cosign is not a prerequisite.
- Installing a capability never enrolls another coding host and never touches
  your host's skill placement. That belongs to `npx skills`.
- Repeat `--capability` for more than one (`--capability pdf --capability ios`).

## Verifying

The runtime lives in `$GSTACK_HOME`, default `~/.gstack`, and is **not** added to
your `PATH`. Skills resolve `$GSTACK_HOME/bin` themselves, so they work either
way; your shell needs the full path unless you add it.

```bash
~/.gstack/bin/gstack doctor                        # all checks, mutates nothing
~/.gstack/bin/gstack doctor --capability browser   # or ios; add --json
ls ~/.gstack/bin                                   # browse, make-pdf, gstack, gstack-* helpers
```

`gstack doctor` keeps five questions separate on purpose — judgment
availability, platform support, preview consent, install consent, runtime
readiness. Readiness is exactly `ready`, `degraded`, `unavailable`,
`unsupported`, or `failed`. See
[`CAPABILITY-READINESS.md`](CAPABILITY-READINESS.md).

## When something is missing

| Symptom | Meaning |
|---|---|
| `gstack: command not found` | Runtime not installed, or installed and not on `PATH`. Try `~/.gstack/bin/gstack doctor`. |
| `make-pdf`/`browse` not found | Same. Skills-only install, or the `pdf`/`browser` capability was never approved. |
| `DEGRADED [CAPABILITY_UNAVAILABLE]` from doctor | The capability is not selected or no runtime is active. Run the three-step flow above. |
| `Managed runtime cannot be inspected` | No runtime in `$GSTACK_HOME` yet. Expected on a skills-only install. |
| `unsupported` for `ios` | Physical-iPhone QA is macOS-only. |
| A skill stalls waiting on a binary | Tell it to continue without the capability; every dispatcher has a judgment-only path. |

## Skill lifecycle

Skills are the installer's business, not GStack's:

```bash
npx skills list      # what is installed, and where
npx skills check     # updates available
npx skills update    # preserves source and scope
npx skills remove plan
```

The verified matrix pins `skills` CLI 1.5.19. That CLI collects anonymous
command-usage telemetry by default; set `DISABLE_TELEMETRY=1` or
`DO_NOT_TRACK=1` to opt out. GStack neither proxies nor adds fields to it.

## Network and consent

Off by default, all of it. Public web research is optional: pick host-native
search, GStack's local browser, or none with
`gstack context select host|local-browser|none`. Context.dev is the only new
external service, stays disabled until explicit consent, and may receive only
public URLs. See [`CONTEXT-DEV.md`](CONTEXT-DEV.md) and
[`PRIVACY.md`](PRIVACY.md). To audit what actually left the machine:
`gstack egress list`, `gstack egress grants`, `gstack egress verify`.
