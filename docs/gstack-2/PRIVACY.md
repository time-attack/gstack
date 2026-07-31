# GStack 2 privacy boundary

GStack 2 defaults to local judgment and local state. Optional network and
device capabilities are separated by explicit purpose and consent. The full
retained-tool egress audit ran on 2026-07-28 and passed with zero violations
([audit section below](#retained-tool-egress-audit-2026-07-28)); the
2026-07-30 integration-wave re-audit, with per-surface call-site tables and
remediation status, is [EGRESS-AUDIT.md](./EGRESS-AUDIT.md). See the gate
list in [STATUS.md](./STATUS.md).

Beyond the point-in-time audits, every gstack-initiated off-machine send now
writes a hash-chained, content-free receipt before it fires: run
`gstack egress list` (what DID leave), `gstack egress grants` (what CAN
leave and how to revoke it), and `gstack egress verify` (tamper check). See
[EGRESS-RECEIPTS.md](./EGRESS-RECEIPTS.md).

## Data-flow summary

| Capability | Default | May leave the machine | Never send |
|---|---|---|---|
| Six judgment skills | available | nothing by the skill text alone | project data to a new service without separate user/host authority |
| Standard installer | user-invoked, Markdown-only | repository/registry requests needed to fetch the skills | runtime dependencies, Context key, project content, browser credentials |
| Optional runtime/state | local, network off | nothing until a separately selected operation requires it | secrets in config/log output; one worktree's state to another |
| Context.dev | off, explicit consent required | public target URL and public extraction options | authenticated/private/local content, cookies, tokens, repo content, user files |
| Local browser | local daemon | navigation requests to sites the user directs it to; explicit legacy tunnels if separately enabled | browser profile/cookies to Context.dev or a cloud-browser provider |
| Physical iPhone | local Mac/device bridge | optional pre-existing Tailscale path only when explicitly configured | device session to a cloud-device farm or alternate driver provider |
| Telemetry | off in the GStack 2 contract | minimal legacy telemetry only after its independent opt-in | code, prompts, paths, repo/branch names, user content |

Skill update discovery and installation belong to the user-invoked Agent
Skills installer (`npx skills update`). GStack preambles make no passive
release request. The retained `gstack-update-check` compatibility helper exits
before state or network access unless the operator explicitly passes
`--force`; `update_check` also defaults to false.

Network installation is not Context.dev consent. Browser navigation is not
Context.dev consent. A key present in the environment is not consent. The
Context client requires persisted selection `context`, mode `context`, and
`network.consent: true` before DNS or fetch. Explicit selections `host`,
`local-browser`, and `none` persist with consent false.

The deterministic Context contract is green at 22 pass / 0 fail and 139
assertions. A verified-key live provider smoke also passed the official
Markdown scrape endpoint. It used explicit consent, protected key input, and
an isolated temporary home that was removed afterward; the committed artifact
contains no credential or response body.

## Retained-tool egress audit (2026-07-28)

A newer re-audit of the same surfaces on the integration branch (2026-07-30,
eight parallel auditors) lives in [EGRESS-AUDIT.md](./EGRESS-AUDIT.md); it
records the violations found after this run and their fix status. The
section below documents the original 2026-07-28 baseline audit.

Every network egress path in the retained tools was audited against this
contract across 9 surfaces: browse server + tunnel, the deleted design CLI and
its residue, the runtime installer, the Context.dev client, pdf/diagram
(make-pdf), the iOS daemon, the deleted Chrome extension, the `bin/` CLI
utilities + code-intelligence contract, and the generated skill instructions.
Verdict: **PASS**, zero violations. Evidence:
[`evals/privacy/egress-audit-2026-07-28.md`](../../evals/privacy/egress-audit-2026-07-28.md)
(with a machine-readable `.json` beside it).

The audit surfaced 9 NEEDS_REVIEW findings; all are fixed:

1. **Telemetry anonymous tier claimed local-only but uploaded.**
   `bin/gstack-telemetry-sync` now exits before any upload for the anonymous
   tier; only the community tier syncs.
2. **`security_url_domain` uploaded the raw visited domain.** Attack-attempt
   telemetry now ships the same salted hash treatment as the payload hash; raw
   domains stay in the local `attempts.jsonl` only.
3. **Welcome page fetched fonts from Google/Fontshare on every headed start.**
   `browse/src/welcome.html` uses a system font stack; headed startup makes
   zero third-party requests.
4. **Orphaned 63MB design binary (embedding api.openai.com wiring) on disk.**
   Deleted, plus the `gstack-upgrade/migrations/v1.64.21.0.sh` migration
   removes it from existing installs.
5. **Dead `DESIGN_SETUP`/`DESIGN_MOCKUP` resolvers could re-arm the retired
   design CLI.** Deleted from `scripts/resolvers/`, along with the stale
   `./setup` capability help text.
6. **iOS daemon `dns.resolve6` fallback leaked device names as unicast DNS.**
   The `legacyResolve6` path is removed; devicectl + mDNS `dns.lookup` cover
   real hardware.
7. **Braintrust uploaded benchmark content on key presence alone.**
   `gstack-model-benchmark` now requires an explicit `--upload` flag or
   `braintrust_upload` config in addition to the key.
8. **Autoplan dispatched plan/diff content to Codex silently.** Judgment
   overlay #9108 adds a persisted one-time per-repo consent before the first
   Codex dispatch and the standard redact scan-at-sink.
9. **/review outside voices (`codex`, `claude -p`) sent branch diffs
   unscanned.** Judgment overlay #9109 requires the gstack-redact scan on the
   exact prompt/diff bytes before every outside-voice dispatch; HIGH findings
   block the dispatch.

One consent-text caveat is deliberate: the frozen 1.x telemetry prompt still
describes the anonymous tier as sending aggregate usage. The prompt is pinned
normalized-render evidence for the GStack 2 parity oracle, so it is not
rewritten; actual behavior sends nothing on that tier, which under-runs the
stated consent. README.md documents the local-only anonymous tier.

## Public Context.dev gate

Before any provider request, the runtime rejects:

- non-HTTP(S) schemes;
- URL usernames/passwords;
- localhost and `.localhost`;
- private/intranet/test/local suffixes and single-label hosts;
- loopback, private, link-local, unspecified, multicast, and mapped-private IPs;
- cloud metadata names/addresses; and
- a nominally public hostname if any resolved address is non-public.

Allowed operations still receive only the public URL and necessary operation
parameters. Do not paste or synthesize cookies, authorization headers, private
page HTML, repository snippets, diffs, or prompts into a public-web request.
When a page requires login or its provenance is uncertain, use the local
browser and keep the content local.

Context.dev credentials are read from protected runtime secrets or a deliberate
environment variable. Interactive setup uses hidden input. The CLI rejects
key-looking arguments, redacts known key formats from errors, and prevents
secret-looking config keys from entering public `config.json`. See
[CONTEXT-DEV.md](./CONTEXT-DEV.md).

## Local browser boundary

GStack retains its own loopback Chromium/Playwright daemon; no cloud-browser
backend has been added. Mutating commands require bearer authentication.
Existing tunnel support uses a separate deny-default listener and scoped
tokens; it exposes the local browser only after an explicit pairing action and
does not turn a hosted browser into a provider dependency. The current runtime
bundle includes the retained ngrok dependency closure for that explicit legacy
tunnel path; it does not add a cloud-browser provider.

Imported cookies remain in the local browser context. Cookie values are not
displayed in the picker or sent to Context.dev. Page content, console messages,
network payloads, dialog text, screenshots, and downloaded files are untrusted
input to the agent, never operational instructions.

Killing or cancelling a browser workflow must close its owned processes and
listeners without killing a sibling worktree's session. Full cancellation/leak
evidence remains a release gate.

## Physical-iPhone boundary

There is one device backend: the existing GStack DebugBridge over Apple's
CoreDevice tooling. It uses local `xcodebuild`, `devicectl`, signing,
provisioning, a CoreDevice tunnel, typed app state, screenshots, and coordinate
actions. Optional Tailscale exposure is retained only where already configured
and authorized. GStack does not use a cloud iPhone, Appium, Agent Device, or an
XCUITest backend abstraction.

The bridge is debug-only. Release builds must contain no bridge symbols. GStack
must not overwrite an unrelated installed app or delete app data without
approval. It checks the expected bundle before and after coordinate mutations
and stops if focus changes.

## State and worktree isolation

State lives under `$GSTACK_HOME` or `~/.gstack`; there is no new database. The
runtime stores JSON/JSONL plus artifacts in a project directory derived from
both repository and worktree identity. Linked worktrees share a repository ID
but have distinct project IDs, so inspect/resume cannot silently select a
sibling.

Writes use atomic replacement and lock leases. Secrets are `0600` where
supported. Durable external-effect claims prevent an uncertain post-crash
action from being repeated automatically. Human-readable files make audits and
manual recovery possible.

Do not place secrets, cookies, private page dumps, or device credentials into
timeline/decision/evidence records. Evidence must be the minimum needed to
support the claim and must follow the source system's retention policy.

## Models, images, and documents

The deterministic clean macOS arm64 managed-bundle audit records 110
components, 1,829 files, 450,044,315 bytes, and 50 capability launchers. This
is a platform-specific bundle measurement, not a universal byte count;
platform-native package payloads differ. Setup installs frozen production-only
dependencies. The Sharp/ngrok closure is included; the development-only Claude
Agent SDK is excluded. The Hugging Face sidecar is excluded and its package is
development-only, so setup installs neither its inference runtime nor model
weights and reports the L4 capability unavailable.

GStack 2 therefore downloads no model weights, checkpoints, LoRAs, or ComfyUI
runtime and starts no background image-model server. Host-native image
generation remains optional when the user and host already provide it. Design
works without it through systems, HTML/CSS, wireframes, screenshots, diagrams,
and critique.

PDF and Mermaid/Excalidraw rendering remain local internal capabilities. No
hosted PDF or diagram service was introduced.

## Disable and remove

Turn Context network use off while preserving state:

```bash
gstack context select none
```

Remove managed runtime versions while preserving config/project state:

```bash
gstack uninstall
```

Purge all GStack 2 runtime state and secrets only with the explicit destructive
confirmation:

```bash
gstack uninstall --purge --yes
```

Use the standard Agent Skills installer to remove skill placements. Removing
runtime state does not authorize GStack to edit unrelated host directories,
browser profiles, applications, or device data.
