# Retained-tool egress audit (2026-07-30, gstack2-integration)

This document synthesizes the eight parallel egress/privacy auditors run
against the `gstack2-integration` tree on 2026-07-29/30. It is the current
evidence for STATUS.md P0 gate (c) and supersedes the narrative in
[PRIVACY.md](./PRIVACY.md#retained-tool-egress-audit-2026-07-28) for the
2026-07-28 run (which passed at zero violations; this re-audit covers the
tree after subsequent integration work).

**Method and honesty.** Call-site tables below are the auditors' enumerated
evidence, condensed. Rows marked **verified in tree** were independently
re-checked in the working tree at synthesis time; rows marked *unverified*
carry only the auditor's claim. Fix statuses in the findings column reflect
the tree at synthesis time; sibling fix agents are editing the same tree
concurrently, so "open" items may land within the same wave.

**Aggregate verdict:** no default-on external egress of code or user content
exists in any retained tool. The wave surfaced violations (all P1/P2, no P0),
of which the following are **fixed and verified in tree**:

| Violation | Fix (verified) |
|---|---|
| Anonymous-tier install ping to Supabase gated only on `tier != off` | `bin/gstack-update-check:199` now uploads only for explicit `community` tier; anonymous is local-only |
| Update check hardcoded `garrytan/gstack` upstream | `bin/gstack-update-check:173-179` derives the repo slug from the actual git origin |
| deepeval bakeoff arm fired default-on telemetry to Confident AI (PostHog) | `evals/platform-bakeoff/platform_bakeoff.py:107` sets `DEEPEVAL_TELEMETRY_OPT_OUT=YES` before import |
| `/health` handed the root auth token to `chrome-extension://` origins (consumer deleted) | `browse/src/server.ts` `/health` no longer serves any token; both carve-outs (headed mode, extension Origin) removed |
| On-device StateServer bound the wildcard interface with dead loopback config | `ios-qa/templates/StateServer.swift.template:147-155` binds IPv4 to 127.0.0.1; IPv6 wildcard is required for the CoreDevice tunnel and now enforces a per-connection peer gate (loopback or fc00::/7 ULA, else cancel) |
| `bin/gstack-gbrain-sync.ts` ingested repo code ignoring the per-repo `deny`/`read-only` policy (prose-only enforcement) | `repoPolicyTier()` chokepoint in the binary: typed `refused-policy-deny` / `refused-policy-unreadable` / `skipped-policy-read-only`, fail-closed on unreadable store |
| make-pdf raw-HTML subresources (style `url()`, `@import`, `srcset`, `poster`) bypassed the offline gate | `make-pdf/src/render.ts:238-294` sanitizer now strips `@import` and neutralizes remote `url()`/`srcset`/`src`/`poster` in raw HTML |
| `bin/gstack-model-benchmark` advertised key-presence-equals-consent for Braintrust | `--upload` flag / `braintrust_upload` config wiring landed; header and dry-run banner state key presence alone never uploads |

**Still open at synthesis time** (verified present unless noted):

- ios-qa loopback `GET /auth/sessions` returns raw bearer token strings
  (`daemon/src/index.ts:246`, `session-tokens.ts:99-101`) — local
  attack-surface only (unauthenticated loopback listener), P2.
- deepeval `evaluate()` still auto-uploads results to Confident AI if an
  ambient `CONFIDENT_API_KEY` is present (no guard in
  `platform_bakeoff.py`) — key-presence-equals-consent pattern, P2.
- browse local telemetry (`browse/src/telemetry.ts:49`) is on by default with
  an env-only off switch (`GSTACK_TELEMETRY_OFF=1`) and does not read the
  telemetry tier config — local JSONL file only, never uploaded by any sync
  path, P2.
- Cosign attestation silently downgrades to SHA-256-only when the cosign
  binary is absent (`runtime/runtime-bootstrap.mjs:533`) — P2, *unverified*.
- StateServer boot token written to os_log with `privacy: .public` — dead
  after first `/auth/rotate`, P2, *unverified*.
- Deprecated `bin/gstack-brain-consumer`/`gstack-brain-reader` dead-endpoint
  curl scripts still ship — user-invoked test only, P2, *unverified*.
- make-pdf preview HTML renders remote `<img>` without the print-path gate —
  GET beacon when the user opens the preview, P2, *unverified*.

---

## 1. browse (server + daemon + tunnel)

Auditor verdict: **PASS** — no default-on external egress in `browse/src`;
every destination is localhost, a user-directed page, the fail-closed opt-in
ngrok tunnel, or opt-in community telemetry. All `Bun.serve`/net binds are
127.0.0.1; only the allowlisted tunnel listener is ever ngrok-forwarded.
Command surface intact (no browse feature removals).

| Call site | Destination | Payload class | Default | Consent gate | Failure typing | Findings / remediation |
|---|---|---|---|---|---|---|
| `server.ts:1869,2600` @ngrok/ngrok forward | ngrok edge (public tunnel URL) | scoped browser-command surface; page content transits tunnel | OFF | `pair_agent` config opt-in (fail-closed on read error) + root token on `/tunnel/start` + ngrok authtoken; `BROWSE_TUNNEL=1` refused without pair_agent; tunnel listener = locked allowlist, local listener never forwarded | JSON `{error, hint}`; leaked listeners cleaned on partial failure | compliant |
| `server.ts:1765,1825`, `cli.ts:945` tunnel probes | own tunnel URL | none (liveness) | inactive unless tunnel consented+started | inherits pair_agent + token | dead tunnel → `closeTunnel()` | compliant |
| `security.ts:493` → `gstack-telemetry-log` → `gstack-telemetry-sync` curl | local `attempts.jsonl`; upload only to configured Supabase fn | salted-hashed attack domain + payload hash + verdict; no page content, no raw domain off-machine | OFF (`telemetry: off` default) | explicit `community` tier AND Supabase URL; anonymous exits before upload | fire-and-forget, http_code checked; local audit trail always kept | compliant (e1cd3096 fixes verified) |
| `telemetry.ts:69` logTelemetry | local file only (`~/.gstack/analytics/browse-telemetry.jsonl`) | aggregate counters | ON | `GSTACK_TELEMETRY_OFF=1` env only | swallowed | **open P2**: env-only switch, ignores tier config; never uploaded — **verified in tree** |
| `cli.ts` (7 sites) + `browse-client.ts:158` | 127.0.0.1 daemon | browse commands | core function | localhost only; token-scoped `/command` | typed daemon errors | compliant |
| `cookie-import-browser.ts:884-933` | 127.0.0.1 Chrome CDP port | cookies (credentials), never leave machine | only on explicit command | user-invoked; CDP binds loopback | typed errors | compliant |
| `socks-bridge.ts:185,291` | user-configured upstream proxy | all browser traffic when proxying | OFF unless `BROWSE_PROXY_URL` | explicit config; URL+env cred-mixing refused | typed `ProxyConfigError` | compliant |
| `write-commands.ts:1200,1286,1387` + `page.goto` | user-directed URLs | page content the user asked for | core function | explicit command; `validateNavigationUrl` | typed command errors | compliant |
| `server.ts:1598` `/health` (inbound, not egress) | localhost callers | status JSON only | on | n/a | n/a | **fixed, verified in tree**: root-token carve-outs removed this wave |
| `welcome.html` | none — inline data: URIs, no external fonts | n/a | n/a | n/a | n/a | compliant (Google/Fontshare fetch removed, verified by auditor) |

## 2. make-pdf

Auditor verdict: genuine tool skill (no judgment surface), consent-gated
bootstrap, offline-by-default rendering. The wave's P1 (raw-HTML subresource
bypass of the offline gate) is **fixed and verified in tree**.

| Call site | Destination | Payload class | Default | Consent gate | Failure typing | Findings / remediation |
|---|---|---|---|---|---|---|
| `browseClient.ts:172` execFileSync browse | local browse daemon (127.0.0.1 Chromium) | rendered HTML of user markdown, stays local | on (required) | n/a, local only | typed `BrowseClientError`, exit codes 0-4 | compliant |
| `diagram-prepass.ts:604-614` remote `<img>` | arbitrary http(s) URLs from markdown | GET beacon (IP + URL) | OFF — visible blocked placeholder | `--allow-network`; `--strict` → typed `StrictModeError` | typed | compliant |
| `render.ts:238-294` raw-HTML subresources | arbitrary http(s) via style `url()`/`@import`/`srcset`/`poster` | GET beacon | was ON (bypass) | now sanitized under the same offline gate | n/a | **fixed this wave, verified in tree** |
| `orchestrator.ts:322-345` preview remote images | arbitrary http(s) img URLs | GET beacon when preview opened | ON in preview | none | none | **open P2**, *unverified* |
| `runtime-bootstrap.mjs:27,470-518` manifest + artifacts | github.com / objects.githubusercontent.com (host-allowlisted, pinned release path) | GET only; SHA-256 + size + 2GiB cap verified | OFF — never runs on skill invoke | ask-before-preview disclosure + explicit `--yes` (`BOOTSTRAP_CONSENT_REQUIRED`) | typed `BOOTSTRAP_*` codes | compliant |
| `runtime-bootstrap.mjs:533` cosign bundle | allowlisted GitHub hosts | GET attestation | OFF (install-time) | same `--yes` | typed `BOOTSTRAP_ATTESTATION_FAILED` | see setup surface: silent downgrade when cosign absent (P2, *unverified*) |
| `browser-provider-smoke.mjs` | 127.0.0.1 only | local proof token | off (manual) | n/a | n/a | compliant |
| emoji fonts (signed runtime artifact) | distro package mirrors | package download | OFF until pdf capability installed | install `--yes`; `GSTACK_SKIP_FONTS` opt-out | best-effort (untyped) | compliant |

Non-network confirmed by auditor: pdftotext (local poppler), vendored diagram
bundle (no CDN), no telemetry, no credential egress, no LLM SDK clients.

## 3. ios-qa (daemon + on-device StateServer)

Auditor verdict: **zero cloud egress**, CLAUDE.md-compliant (CoreDevice/
DebugBridge only, no Appium/cloud-farm/alternate drivers; tailnet opt-in and
fail-closed). Remaining risks are local attack-surface items.

| Call site | Destination | Payload class | Default | Consent gate | Failure typing | Findings / remediation |
|---|---|---|---|---|---|---|
| `tunnel-bootstrap.ts:142,163,202` | iPhone via CoreDevice USB tunnel (RFC4193 ULA, machine-local) | probe / cached+rotated bearer / boot token (credentials, local link) | on when daemon targets a device | local device link (Trust pairing) | `state_server_unreachable`, `rotate_failed` | compliant |
| `proxy.ts:69` http.request | iPhone (CoreDevice tunnel) | QA commands + bearer out; app state/screenshots back | on (core function) | loopback = spawning agent; tailnet = allowlist + capability token | 502/503/504/413 typed | compliant |
| `tailscale-localapi.ts:53` unix socket | local tailscaled LocalAPI | peer addr WhoIs (metadata) | only with `--tailnet` | CLI flag, fail-closed probe | 4 typed classes | compliant |
| `devicectl.ts` (8 spawns) + `dns.lookup .coredevice.local` | Apple CoreDevice local / mDNSResponder (link-local multicast) | UDID, bundle id, paths / device name slug | on | device pairing | typed `devicectl_*`, `resolve_failed` | compliant; unicast `resolve6` leak removed (prior audit finding, verified) |
| `index.ts:94,105` loopback listeners | ingress, local agents | full command surface, unauthenticated | on | loopback bind is the boundary | typed JSON | **open P2, verified in tree**: `GET /auth/sessions` returns raw token strings to any local process |
| `index.ts:116-132` tailnet listener | ingress, tailnet peers | allowlisted route tiers; mutations audited to `ios-qa-audit.jsonl` | OFF (`--tailnet` AND probe ok) | owner-run mint grant allowlist + WhoIs identity + 256-bit capability tokens (1h TTL, 24h cap, rate-limited) | 401/403/429/502 + salted-hash attempts log | compliant |
| `StateServer.swift.template:147-155` NWListener on-device | ingress on iPhone | app state, screenshots, tap/swipe/type | on when template compiled into app under test | bearer auth except `/healthz`; IPv4 loopback bind, IPv6 per-connection peer gate (loopback or fc00::/7) | 401/404 JSON | **wildcard-bind finding fixed this wave, verified in tree**; boot-token `os_log .public` still open (P2, *unverified*) |
| `physical-device-smoke.ts:1099` | iPhone (tunnel) | smoke commands + bearer | manual harness only | n/a local | `HarnessError` | compliant |
| `gen-accessors-tool/Package.swift:23` | github.com/swiftlang/swift-syntax | source download (dev build-time) | dev only | developer runs `swift build` | SPM failure | compliant |

## 4. gbrain + code-intelligence plumbing

Auditor verdict: contract path compliant — provider default null, grep/
file-only fallback, per-repo egress consent with typed
`PROVIDER_NOT_CONSENTED`. The wave's P1 (deny-tier enforced only in skill
prose) is **fixed and verified in tree**.

| Call site | Destination | Payload class | Default | Consent gate | Failure typing | Findings / remediation |
|---|---|---|---|---|---|---|
| `sourcebot-adapter.ts:144-169` fetch | `SOURCEBOT_URL` (default localhost:3000) | search query + optional Bearer key | off (provider=null) | explicit select; register/refresh to non-loopback need `consented:true` (`contract.ts:179`) | typed `CodeProviderError` | compliant |
| `gbrain-adapter.ts:74-168` spawn gbrain | user's own gbrain DB (local PGLite or remote Supabase) | repo code + docs (register/refresh/add); query strings (search) | off (provider=null) | `local=false` always → `assertEgressConsent` on writes | typed `PROVIDER_NOT_CONSENTED`/`UNAVAILABLE`/`TIMEOUT`/`ERROR` | compliant |
| `graphify-adapter.ts` | none (local tree-sitter graph) | none | off | local=true, never auto-installed | typed | compliant |
| `picker.ts:88` detect probe | `SOURCEBOT_URL` | fixed probe query (metadata) | only on options/status/suggest | user command; localhost default | typed | compliant |
| `bin/gstack-gbrain-sync.ts:844,895` | user's gbrain DB (possibly remote) | full cwd repo code | never unattended; user/skill-invoked | gbrain setup consent + **binary-enforced per-repo policy chokepoint** (`repoPolicyTier`) | typed `refused-policy-deny` / `refused-policy-unreadable` / `skipped-policy-read-only` | **P1 fixed this wave, verified in tree** |
| `bin/gstack-memory-ingest.ts` | user's gbrain DB | transcripts, learnings, retros (may contain code/secrets) | user/skill-invoked | gbrain setup consent; secret scan opt-in only | typed | **open P2** (secret scan not default), *unverified* |
| `lib/gstack-decision-semantic.ts:38,90` | user's gbrain DB | decision-search query string | off (`--semantic` only) | lazy-loaded; degrades silently to file-only | never throws, 10s timeout | compliant |
| `bin/gstack-brain-sync` git push | user-configured brain remote | curated memory (allowlisted paths) | off (`artifacts_sync_mode=off`) | config opt-in + secret_scan on diff + allowlist | status codes written | compliant |
| `bin/gstack-brain-consumer`/`-reader:161` curl | user-registered `ingest_url` | brain repo_url + Bearer token | user-invoked test only | deprecated dead endpoint | n/a | **open P2**: delete, *unverified* |
| `bin/gstack-gbrain-install:87`, `-mcp-verify:77,154`, `-supabase-provision:142` | github.com / user MCP URL / api.supabase.com | connectivity probe, MCP handshake, setup credentials (user's own PAT) | user-invoked | explicit commands; token via env never argv | typed classes / exit codes | compliant |
| `lib/model-benchmark/braintrust-eval.ts:125` | Braintrust cloud | benchmark prompts/outputs | off (`noSendLogs`) | explicit `--upload`/config opt-in AND key; key presence alone never uploads | SDK error surfaces | compliant (prior-audit fix verified; CLI banner drift also **fixed, verified in tree**) |

## 5. Context.dev client

Auditor verdict: **compliant with the CLAUDE.md contract** — exactly one API
egress site pinned to `https://api.context.dev/v1` plus one consent-gated DNS
pre-check; everything off by default behind a four-condition persisted gate;
8 frozen typed `CONTEXT_*` failure codes; key never on argv, redacted from
errors; independently cross-checked against the 2026-07-28 audit rows (agree).
Pinned by `test/gstack2-runtime-context.test.ts` (24 tests).

| Call site | Destination | Payload class | Default | Consent gate | Failure typing | Findings / remediation |
|---|---|---|---|---|---|---|
| `runtime/context.js:425` `#request` fetch | `api.context.dev/v1` only (origin+path pinned, `redirect:'error'`) | public target URL + allowlisted extraction options + Bearer key; no code, no page content, no telemetry | off (`config.js:9` mode off, consent false, selection null) | selection===context AND mode===context AND consent===true AND validation!==unverified, checked in both `#gateTarget` and `#request` | 8 frozen `CONTEXT_*` codes; unknown codes rejected; key redacted | compliant |
| `context.js:251` dns.lookup | OS DNS resolver | target hostname (metadata) | off | reached only AFTER consent check; lexical public-URL + credential-material scan first (zero I/O) | `CONTEXT_BLOCKED` / `CONTEXT_TIMEOUT` | compliant |
| `cli.js:644` setup verification | api.context.dev (fixed public URL) | just-entered API key to its own vendor | never unprompted | interactive yes or `--consent`; `--offline` skips egress (status=unverified blocks ops); keys on argv rejected | `CONSENT_REQUIRED`, `KEY_ON_COMMAND_LINE` | compliant |
| `cli.js:669,697-705` smoke/scrape/crawl/sitemap/screenshot | api.context.dev via client | user-supplied public URL + numeric options | off | full persisted four-condition gate | typed | compliant |
| `cli.js:576-603` status/options/select | NONE | none | n/a | `select` persists `{mode, consent:false, selection}` — fallback persisted WITHOUT Context.dev consent, per contract | n/a | compliant, test-pinned |

Minor open nits (auditor P2-class): fail-open/display-drift hardening only;
no egress impact. *Unverified individually.*

## 6. Telemetry / eval backends (braintrust, deepeval, langfuse, judges)

Auditor verdict: all five e1cd3096 privacy fixes verified in tree; no
default-on egress of code or user content. The wave's two violations
(deepeval phone-home; key-presence semantics) — one fixed, one open.

| Call site | Destination | Payload class | Default | Consent gate | Failure typing | Findings / remediation |
|---|---|---|---|---|---|---|
| `bin/gstack-telemetry-sync:116` curl | configured Supabase fn `telemetry-ingest` | skill-usage + attack events; cwd/branch/repo stripped, attack domain salted-hashed at source | off (exit 0 for off/anonymous/no URL) | explicit `telemetry=community` only; anonymous genuinely local-only | silent exit; cursor advances only on 2xx | compliant (e1cd3096 verified) |
| `bin/gstack-update-check:174-211` install ping + version fetch | Supabase fn / github.com + raw.githubusercontent.com (slug from actual git origin) | `{version, os}` + IP / none | ping: community tier only; version fetch: exits 0 without `--force` | `telemetry=community` / explicit `--force` | untyped, fail-quiet | **anonymous-ping P1 + hardcoded-upstream P1 both fixed this wave, verified in tree** |
| `braintrust-eval.ts:125` | Braintrust cloud | benchmark prompts/outputs/metrics (no repo code) | off (`noSendLogs`) | `upload===true` AND key | SDK error | compliant |
| `bin/gstack-model-benchmark:124` `--judge` | api.openai.com via autoevals | benchmark case + output | off | `--judge` flag AND `OPENAI_API_KEY` | judge skipped without key | compliant |
| `lib/model-benchmark/providers/*` | Anthropic/OpenAI/Google via user-authed CLIs | benchmark prompt only | only on explicit invocation naming providers | invocation is approval; `--dry-run` available | typed per-provider | compliant |
| `platform_bakeoff.py:107` deepeval import | Confident AI PostHog | anonymous usage + stable `DEEPEVAL_ID` | was ON | now `DEEPEVAL_TELEMETRY_OPT_OUT=YES` set before import | n/a | **P1 fixed this wave, verified in tree** |
| `platform_bakeoff.py:138` `evaluate()` | Confident AI cloud | synthetic bakeoff corpus results | off absent key | `CONFIDENT_API_KEY` presence alone = upload | SDK-level | **open P2, verified still absent**: needs explicit opt-in guard |
| `platform_bakeoff.py:63-94` Langfuse | `LANGFUSE_HOST` (default localhost) | synthetic corpus + scores | off (KeyError without explicit keys) | explicit env keys + platform named in argv | python crash | compliant |
| `platform_bakeoff.py:45` Braintrust arm | none | n/a | local-only (`no_send_logs=True` hardcoded) | n/a | n/a | compliant |
| `test/helpers/llm-judge.ts` | api.anthropic.com | eval transcripts (first-party model API) | only in paid `test:evals` runs | explicit paid-eval invocation + key | test failure | compliant |
| `test/helpers/*-runner.ts` | model APIs via host CLIs | test fixtures/prompts, hermetic allowlist-scrubbed env | only via explicit `test:evals`/`test:e2e` | paid-eval invocation; pinned by `test/hermetic-wiring.test.ts` | test failure | compliant |

## 7. Setup / installer / runtime bundle

Auditor verdict: egress surface small, host-allowlisted, consent-gated;
network defaults verifiably off; no model-weight downloads; preview + `--yes`
before install. The wave's P1 (anonymous update ping) and the stale-upstream
P2 are fixed (see surface 6); the cosign silent downgrade remains open.

| Call site | Destination | Payload class | Default | Consent gate | Failure typing | Findings / remediation |
|---|---|---|---|---|---|---|
| `runtime-bootstrap.mjs:28,167,202,481` manifest + components | github.com releases + objects.githubusercontent.com (host-allowlisted, https-only) | GET only; SHA-256 + byte-count verified, 2GiB cap | off — explicit preview/install only | preview prints full plan; install requires `--yes` | typed `BOOTSTRAP_*` | compliant |
| `runtime-bootstrap.mjs:533` cosign | GitHub release cosign bundle | none | off | same install consent | `BOOTSTRAP_ATTESTATION_FAILED` | **open P2**: silently skipped when cosign binary absent (SHA-256-only downgrade), *unverified* |
| `runtime/install.js:1031` bun install | npm registry (frozen lockfile) | package names | off | interactive yes or `--install-now --yes`; disclosed in preview | typed `INSTALL_*` | compliant |
| `runtime/install.js:1267` | Playwright CDN | Chromium download (not gstack-hash-pinned) | off — dev source-install path only | explicit browser-capability approval | `INSTALL_BROWSER_DOWNLOAD_FAILED` | compliant |
| `runtime/context.js` / `cli.js` | api.context.dev | see surface 5 | off | see surface 5 | `CONTEXT_*` | compliant |
| `bin/gstack-update-check` | see surface 6 | see surface 6 | see surface 6 | see surface 6 | untyped, fail-quiet | **fixed this wave, verified in tree** |
| `bin/gstack-community-dashboard:38` | Supabase fn community-pulse | none (GET) | off | explicit user invocation | HTTP code surfaced, never fake-zero | compliant |
| gbrain install / provision / mcp-verify | see surface 4 | see surface 4 | off | explicit invocation | typed | compliant |
| `setup` shell script | — | — | — | — | — | **0 network calls** (auditor-verified) |
| `gstack-upgrade/migrations/` | — | — | — | — | — | **0 network calls** (auditor-verified) |

Contract checks (auditor): network defaults off PASS; no model-weight
downloads PASS (no HF/ONNX/sidecar in runtime, ML classifier removed);
preview-before-install PASS except the cosign downgrade above.

## 8. Chrome extension

Auditor verdict: the extension was **fully deleted** on this branch (commit
`ab4e9ae5`, 2026-07-21, ancestor of HEAD): zero egress call sites, no
manifest, no host permissions, `--load-extension` wiring removed.

| Call site | Destination | Payload class | Default | Consent gate | Failure typing | Findings / remediation |
|---|---|---|---|---|---|---|
| `extension/*` (fetch/WS/XHR/sendBeacon/SDK) | n/a | n/a | deleted | n/a | n/a | component removed in `ab4e9ae5` |
| `extension/lib/xterm.js:1` window.open | user-activated hyperlink | none (navigation, opener nulled) | dead code (never loaded) | user click | n/a | 292K gitignored orphaned vendor blobs remain on disk — cleanup item, no egress |
| `browse/src/welcome.html:223` `<a href>` | github.com, x.com | none (passive links) | on | user click | n/a | compliant |
| `browse/src/server.ts` `/health` extension-origin token grant | inbound localhost | credentials (was: root AUTH_TOKEN) | was on for `chrome-extension://` origins | was NONE | n/a | **fixed this wave, verified in tree** — token no longer served |
