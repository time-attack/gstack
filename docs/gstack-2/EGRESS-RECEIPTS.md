# Egress receipts (`gstack egress`)

Every gstack-initiated off-machine send appends one content-free, hash-chained
receipt line to `~/.gstack/security/egress.jsonl` (file 0600, dir 0700) BEFORE
the network call fires. This answers the security engineer's question — "what
did this toolkit actually transmit, to whom, and who authorized it?" — with a
local, tamper-evident artifact instead of a static privacy doc. It turns the
one-time eight-auditor [EGRESS-AUDIT.md](./EGRESS-AUDIT.md) into a standing,
machine-checked invariant (`test/egress-receipt-wiring.test.ts`).

## Semantics

- **Receipt-before-send, fail-closed.** The receipt is written before the
  request. If it cannot be written, the send is refused with the typed code
  `EGRESS_RECEIPT_FAILED`. No ledger, no egress.
- **Content-free.** A receipt never contains payload text or credentials —
  only a byte count and the sha256 of the exact bytes sent (the
  `semantic-reviews.jsonl` precedent). Auditors can match the hash against
  captured traffic (mitmproxy) without the ledger ever storing content. Sinks
  where a subprocess or SDK owns the wire bytes (gbrain, git push, Braintrust)
  record `sha256: null` and say so in `payload_class`.
- **Tamper-evident.** Each line carries `prev` = sha256 of the previous raw
  line (`""` for line 1). Editing or deleting any line breaks every later
  link; `gstack egress verify` recomputes the chain and exits 3 on tamper,
  naming the first broken line.
- **Receipts record actual sends, not refusals.** A consent gate that fires
  before the send (telemetry off, Context.dev unconsented) produces no
  receipt; denials go to `attempts.jsonl` as before.

## Receipt line

```json
{"ts":"2026-07-31T18:53:10.880Z","type":"egress","sink":"telemetry-sync",
 "host":"xyz.supabase.co","payload_class":"telemetry-events","bytes":64,
 "sha256":"8e2e011a…","consent":"telemetry=community","prev":"…"}
```

An optional `{"type":"outcome","receipt":<id>,"status":"200",…}` line records
the response status after the send; `gstack egress list` joins it onto its
receipt. The pre-send receipt is the invariant; the outcome is bookkeeping.

## CLI

```bash
gstack egress list [--since <ISO>] [--host <host>] [--sink <sink>] [--json]
    # what DID leave: one row per send, with sha256 + consent + status
gstack egress grants [--json]
    # what CAN leave: every consent grant in force — telemetry tier,
    # Context.dev four-condition gate, per-repo code-intelligence consents,
    # pair_agent, braintrust_upload, brain-sync — each with the config
    # file/key it lives in and the exact revoke command
gstack egress verify [--json]
    # recompute the hash chain; exit 0 intact, 3 on tamper
```

## Covered sinks (pinned by `test/egress-receipt-wiring.test.ts`)

| Sink | Call site | Receipt hash |
|---|---|---|
| telemetry-sync | `bin/gstack-telemetry-sync` Supabase POST | exact batch bytes (curl sends the same file) |
| update-check | `bin/gstack-update-check` install ping + version probe/fetch | ping bytes; GETs are bodyless |
| context.dev | `runtime/context.js` `#request` | exact request body |
| sourcebot | `lib/code-intelligence/sourcebot-adapter.ts` (non-loopback only) | exact request body |
| gbrain | `lib/code-intelligence/gbrain-adapter.ts` register/refresh/add | subprocess-owned (null; `add` hashes the document body) |
| gbrain-sync | `bin/gstack-gbrain-sync.ts` code walk | subprocess-owned (null) |
| memory-ingest | `bin/gstack-memory-ingest.ts` gbrain import | subprocess-owned (null) |
| brain-sync | `bin/gstack-brain-sync` git push | git-owned (null) |
| braintrust-eval | `lib/model-benchmark/braintrust-eval.ts` upload path | SDK-owned (null) |
| runtime-bootstrap | `runtime/runtime-bootstrap.mjs` manifest/artifact/cosign GETs | bodyless GETs (inline dependency-free writer — the file is vendored standalone) |
| browse-tunnel | `browse/src/server.ts` ngrok session open (both call sites) | session open, no payload |

Out of scope by definition: loopback destinations (the local browse daemon,
localhost Sourcebot, the iOS CoreDevice USB tunnel) and user-directed page
navigation in the browser.

## Trying it locally

```bash
export GSTACK_HOME=$(mktemp -d)
bin/gstack egress list           # "no receipts" + ledger path
bin/gstack egress grants         # every grant off, each naming file + revoke
# drive a real receipt through a mock sink:
python3 -m http.server 8399 &    # or any local listener
mkdir -p "$GSTACK_HOME/analytics"
printf '{"schemaVersion":2,"telemetry":"community"}\n' > "$GSTACK_HOME/config.json"
printf '{"v":1,"ts":"2026-07-31T00:00:00Z","event_type":"skill_start"}\n' \
  > "$GSTACK_HOME/analytics/skill-usage.jsonl"
GSTACK_STATE_DIR="$GSTACK_HOME" GSTACK_SUPABASE_URL=http://127.0.0.1:8399 \
  GSTACK_SUPABASE_ANON_KEY=x bin/gstack-telemetry-sync
bin/gstack egress list           # one receipt; sha256 matches the sent bytes
bin/gstack egress verify         # chain intact
```

Guarantee boundary: the ledger records what GSTACK's own sinks send. It is
tamper-evident, not tamper-proof — an attacker with write access to your home
directory can truncate the whole file (verify then reports a shorter chain,
which is itself the signal to distrust the machine). It does not observe
egress from the model host, your shell, or other tools.
