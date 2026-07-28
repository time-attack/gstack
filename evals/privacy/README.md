# Privacy egress audits

Point-in-time audits of every network egress path in the retained GStack tools,
checked against the contract in `docs/gstack-2/PRIVACY.md`.

## 2026-07-28 retained-tool egress audit (P0 gate)

- `egress-audit-2026-07-28.md` — synthesized report (verdict, egress inventory, residual risk).
- `egress-audit-2026-07-28.json` — machine-readable per-surface results and findings.

**Scope:** 9 surfaces — browse server + tunnel, design CLI (deleted at HEAD +
residue), runtime installer, Context.dev client, pdf/diagram (make-pdf), iOS
daemon, Chrome extension (deleted at HEAD), bin/ CLI utilities + code-intelligence
contract, generated skill instructions (skills/ + compat/).

**Method:** full read of docs/gstack-2/PRIVACY.md, then per-surface source reads
plus systematic greps for network primitives (`fetch(`, `https?://`, `curl`,
`wget`, `axios`, WebSocket/EventSource, `net.connect`/`tls.connect`, `dns.*`,
dgram), child processes (`spawn`/`exec*`), analytics SDKs, API-key names,
install lifecycle hooks (`postinstall`/`preinstall`), auto-update pings, and
listener binds beyond loopback. Each egress point is recorded with trigger,
gating, verdict, and file:line citation (see the `notes` field per surface in
the JSON for the exact greps run).

**Gate rules:** VIOLATION = default-on egress of user data, a consent bypass, or
an undisclosed endpoint (fails the gate). NEEDS_REVIEW = consent-semantics
drift, hygiene leftovers, or metadata-only leaks with a concrete fix (does not
fail the gate). Verdict: **PASS** — zero violations, 9 NEEDS_REVIEW findings,
all fixed on this branch (see the CHANGELOG entry and commits referencing this
artifact).
