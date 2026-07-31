# GStack browser infrastructure: before and after

This document compares the original GStack 1 browser setup with the current
GStack 2 candidate at `a84a6e23`. It also names the immediate `v2.0.0-rc.5`
baseline at `75b35766`, because some runtime improvements existed before the
final browser-provider work.

This is a candidate description, not a GStack 2 release claim. The signed
`v2.0.0-rc.6` runtime artifacts still need to be published and exercised
through the production bootstrap. See [STATUS.md](./STATUS.md).

## Executive answer

The new browser infrastructure is substantially better at installation,
consent, payload control, upgrades, and failure isolation. It is not a new
browser engine and it is not universally 16 times faster.

The existing local Chromium/Playwright command layer and persistent daemon are
preserved. The main change is that GStack no longer assumes every user should
download and run GStack-managed Chromium. A user can now select:

1. GStack-managed isolated Chromium.
2. An explicitly selected installed Chrome-family executable through the same
   Playwright Core adapter.
3. Later, with no browser runtime installed and judgment-only skills still
   usable.

The clearest measured result is:

- **Payload:** installed-browser mode omits 100% of GStack's managed Chromium
  components. It still installs the smaller browser command and Playwright
  adapter code.
- **Functional coverage:** the supplemental ten-app local bakeoff passed
  115/115 probes with both the pre-change managed path and the new installed
  browser adapter.
- **Warm latency:** the installed-browser adapter was about 17% faster in that
  local bakeoff.
- **Cold latency:** the installed-browser adapter was about 24% slower in that
  local bakeoff.
- **Bad-selector failure:** the old path hit the bakeoff's 8-second kill. The
  new path returned in about 5.03 seconds, at least 37% less latency and more
  than 1.59 times faster to a useful failure.

There is no defensible single percentage for the whole migration. The largest
win is optionality and safety, not raw page-action speed.

## The three baselines

| Baseline | Browser infrastructure |
|---|---|
| Original GStack 1, pinned at `bb57306d` | `./setup` combined host placement, dependency installation, browser build, and browser acquisition. It required Playwright-managed Chromium to be launchable and ran `playwright install chromium` when it was missing. The package included full `playwright` plus unused `puppeteer-core`. |
| GStack 2 RC5, `75b35766` | Skill placement was already separated from the optional runtime. Signed component previews, exact compressed bytes, and atomic runtime activation existed, but browser-backed capability planning always selected managed Chromium. There was no local-only provider-options step or persisted installed-browser choice. |
| Current candidate, `a84a6e23` | Browser setup fails closed until the user chooses managed or installed Chromium. Installed mode retains the adapter and omits managed browser components. The choice is validated, persisted only after successful activation, propagated by stable launchers, included in daemon identity, checked by doctor, and restored with rollback. |

## Before and after

| Concern | Original GStack Browse | Current browser infrastructure |
|---|---|---|
| Skill and browser installation | One repository-specific `./setup` path also detected hosts and placed generated skills. | Agent Skills installs the six Markdown skills. The optional runtime is separate and installed once per user. |
| When setup happens | Browser readiness was part of setup even if the user only wanted judgment skills. | Setup can be deferred until a selected workflow actually reaches browser-backed evidence. |
| Browser engine | Playwright-managed Chromium was required. | Explicit choice between managed Chromium and a validated installed Chrome, Chromium, Edge, or Brave executable. |
| Dependency | Full `playwright`; original GStack 1 also carried unused `puppeteer-core`. | `playwright-core` is exposed through the existing `playwright` import name. No second automation stack or cloud browser was added. |
| Browser download | Setup downloaded Playwright Chromium when the cache was missing. | Installed mode downloads no managed Chromium. Managed mode downloads only the approved headless or visible component. |
| Consent | No separate browser-engine choice. Browser acquisition was embedded in setup. | Local options make no network request or mutation. Provider selection, signed metadata preview, and installation approval are separate steps. |
| Preview | No browser-specific exact component plan before setup. | The signed manifest lists the dependency-closed components and exact missing compressed bytes before installation. |
| Capability packaging | Browser code and browser acquisition were coupled to the repository build. | `core`, `browser-code`, `browser-headless`, and `browser-visible` are separate signed components. |
| Headless versus visible | One managed Playwright browser installation served the setup. | Ordinary QA installs headless only. Visible extension-bearing GStack Browser is additive and managed-only. Installing visible Chromium does not also install the headless shell. |
| Browser profile | GStack used its own automation profile. | Both providers still use an isolated automation profile. Installed mode does not silently reuse the user's personal Chrome profile or cookies. |
| Configuration | Ambient environment and repository setup selected the runtime behavior. | `$GSTACK_HOME/config.json` records one coherent provider choice. The active bundle records the matching provider and components. |
| Launcher behavior | The browser process inherited more ambient runtime state. | Stable launchers remove ambient provider overrides, inject the persisted provider/path, and reject a provider that does not match the active runtime slot. |
| Existing daemon | Same-version reuse did not identify the selected browser engine. | The daemon configuration hash includes provider and installed executable. A mismatch fails closed and asks for `browse disconnect`. |
| Upgrades and rollback | No provider-aware transaction joined browser config to runtime activation. | Browser config, launchers, install manifest, and active pointer participate in one crash-recoverable transaction. Rollback restores the matching provider choice. |
| Health check | Setup attempted to launch Playwright Chromium. | `gstack doctor` launches the exact selected managed slot or installed executable through the same adapter. |
| Missing selector | A failed 5-second click could start a second locator wait while trying to improve the error. | An immediate `count()` check avoids the second wait and preserves the helpful `<option>` guidance only when one element exists. |
| Browser command surface | Persistent local daemon, snapshots, refs, console/network capture, screenshots, tabs, storage, and high-level QA commands. | Preserved. This work changes provider and lifecycle infrastructure, not the high-level QA contract. |

## How setup works now

The browser does not configure itself without consent.

1. The user installs the six skills with the Agent Skills installer:

   ```bash
   npx skills add time-attack/gstack/skills
   ```

2. Judgment-only work runs with no browser runtime.
3. When an active specialist first needs a browser-backed capability, it asks
   whether the user wants setup options.
4. The local-only options command detects supported installed executables and
   also offers managed Chromium. It performs no network request and writes no
   state:

   ```bash
   node references/support/runtime-bootstrap.mjs options --capability browser
   ```

5. The user explicitly chooses managed or installed Chromium, or defers.
6. After separate consent for one public GitHub manifest request, preview shows
   the exact signed component plan and compressed byte count. Preview does not
   install anything.
7. After a second explicit approval, install repeats the same plan, verifies
   byte counts and SHA-256, stages the runtime, smoke-tests the selected
   browser, and atomically activates it.
8. Only successful activation persists the provider. A failure restores the
   prior config, launchers, install manifest, and active runtime pointer.

Installed mode is for headless automation. A headed window, extension, handoff,
or the visible GStack Browser requires the separately approved managed
`browser-visible` component.

## How much better is it?

### Release-grade and deterministic evidence

| Measure | Result | Interpretation |
|---|---|---|
| Managed browser payload in installed mode | `browser-headless` and `browser-visible` are both omitted | 100% of GStack's managed Chromium payload is avoided. This is not a claim that the entire optional runtime is zero bytes; `core` and `browser-code` remain. |
| Provider setup and lifecycle tests | 70 pass, 0 fail, 603 assertions across the setup-UX and managed-installer suites | Covers provider selection, no-network options, component planning, launcher propagation, doctor launch, activation, provider mismatch, rollback, and crash recovery. |
| Current GStack 2 suite | 218 pass, 0 fail, 2,229 assertions across 20 files | Covers the broader routing, runtime, privacy, upgrade, and browser-provider surface. |
| Focused missing-selector regression | 5,031.93 ms in the current run; test limit is 6,500 ms | Confirms there is one intentional 5-second Playwright auto-wait and no second locator wait. |
| Provider-aware command coverage | 251 pass, 0 fail in the focused browser command and daemon-mismatch run | Confirms the browser command surface and provider-aware daemon refusal remain green. |

The deterministic tests prove behavior and lifecycle rules. They do not prove
that every native browser build or fresh production bootstrap works. The
official RC6 artifacts and production journey are still pending.

### Supplemental local ten-app bakeoff

The local bakeoff exercised ten isolated web apps covering forms, auth,
dialogs, uploads/downloads, API recovery, tabs, shadow DOM, iframe behavior,
responsive screenshots/PDF, hostile page text, large DOMs, console/network,
storage, and invalid selectors. These artifacts currently live under
`outputs/playwright-cli-bakeoff-10apps/` and are not committed release evidence.

| Measure | Pre-change managed GStack | New installed-browser adapter | Change |
|---|---:|---:|---:|
| Functional probes | 115/115 | 115/115 | parity in this corpus |
| Cold navigation median | 908.8 ms | 1,122.5 ms | 23.5% slower |
| Warm command median | 51.7 ms | 42.8 ms | 17.2% lower latency, about 1.21x faster |
| Semantic action median | 43.7 ms | 36.2 ms | 17.2% lower latency, about 1.21x faster |
| Missing-selector median | 8,003.5 ms and killed by the harness | 5,030.1 ms, normal error | at least 37.2% lower latency, more than 1.59x faster |

This is a useful local comparison, not a universal benchmark. It says the
installed adapter preserved functionality and improved warm work on this Mac,
while making cold startup worse. Managed mode remains available when
reproducibility or visible extension support matters more than avoiding the
browser payload.

## Why the result is not "16x faster"

The earlier 16x number came from dividing the GStack command median by an
external `@playwright/cli` command median in the same synthetic corpus. That
was a GStack-versus-Playwright-CLI comparison, not old-GStack-versus-new-GStack.
It compared two CLI contracts and daemon implementations, so it cannot be used
as an engine-level or migration-level speed claim.

For this migration, the comparable local number is about **1.21x faster on
warm/action medians**, **more than 1.59x faster on the fixed missing-selector
failure**, and **1.24x slower on cold navigation**. The managed-browser path
uses the same daemon and should not be advertised as broadly faster merely
because its installation lifecycle is safer.

## What remains from GStack Browse

The high-value part of GStack Browse was not thrown away:

- one persistent local daemon rather than a new browser per action;
- compact commands designed for agent QA;
- semantic snapshots and stable element references;
- local cookies, tabs, storage, console, network, dialogs, screenshots, PDF,
  and responsive workflows;
- loopback binding, mutation authorization, URL checks, and untrusted-content
  handling;
- visible GStack Browser for extension, handoff, and paired-agent workflows.

Playwright Core is the transport and automation engine. GStack remains the
stateful QA command layer, security boundary, and lifecycle manager around it.

## Costs and limitations of the new design

- Installed-browser mode is headless-only. Visible extension workflows require
  managed Chromium.
- Installed mode still needs adapter code and the optional runtime; it only
  eliminates the managed browser binary components.
- Switching providers while a daemon is live requires `browse disconnect` so
  the process cannot silently keep using the previous engine.
- A system-browser update can change behavior outside GStack's release cycle.
  Managed Chromium is the reproducible choice.
- The first installed-browser cold start was slower in the local bakeoff.
- The official signed RC6 component release and a fresh production journey are
  still required before this layer can be called released or verified.
- Seven hosts are verified at the Agent Skills installer layer. That does not
  mean seven host UIs have executed this browser runtime.

## Source and evidence map

- Browser choice and executable discovery:
  [`runtime/browser-choice.mjs`](../../runtime/browser-choice.mjs)
- Local options, signed preview, and exact component plan:
  [`runtime/runtime-bootstrap.mjs`](../../runtime/runtime-bootstrap.mjs)
- Component selection, activation, launchers, and install rollback:
  [`runtime/install.js`](../../runtime/install.js)
- Runtime rollback synchronization:
  [`runtime/upgrade.js`](../../runtime/upgrade.js)
- Selected-engine health probes:
  [`runtime/doctor.js`](../../runtime/doctor.js)
- Browser launch integration:
  [`browse/src/browser-manager.ts`](../../browse/src/browser-manager.ts)
- Provider-aware daemon identity:
  [`browse/src/proxy-config.ts`](../../browse/src/proxy-config.ts)
- Missing-selector fix:
  [`browse/src/write-commands.ts`](../../browse/src/write-commands.ts)
- Provider setup and install tests:
  [`test/gstack2-runtime-setup-ux.test.ts`](../../test/gstack2-runtime-setup-ux.test.ts)
  and
  [`test/gstack2-runtime-install.test.ts`](../../test/gstack2-runtime-install.test.ts)
- Browser command regression:
  [`browse/test/commands.test.ts`](../../browse/test/commands.test.ts)
- Full evidence ledger: [TEST-EVIDENCE.md](./TEST-EVIDENCE.md)

