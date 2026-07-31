# gstack context-bill

A token bill-of-materials for everything gstack loads into your agent's context.
Offline, read-only, deterministic. It writes no state anywhere. Part of the
optional runtime bundle (a tool, like make-pdf, not a judgment dispatcher).

```bash
gstack context-bill                      # auto-detects ./skills or ~/.claude/skills
gstack context-bill <tree>               # any installed skills tree
bin/gstack-context-bill <tree>           # same tool, standalone
```

Three ledgers:

- **ALWAYS-ON** — per-skill YAML frontmatter bytes (what every session's skill
  scanner loads). Flags frontmatter keys the router never reads (#2286) and
  foreign-host skill files polluting scanner scope (#1694).
- **EAGER (per invocation)** — SKILL.md plus the forced-read references the
  dispatch protocol mandates for every invocation (the shared triad), parsed
  from the dispatcher's own "for every invocation" sentence.
- **LAZY (per mode/alias)** — for each mode and legacy alias in the routing
  tables, which `references/legacy/*.md` modules activate and what each costs.
  Unrouted on-disk modules and missing (phantom) modules are flagged.

Token counts are estimates, bytes/4, the same convention as
[BLOAT-LEDGER.json](BLOAT-LEDGER.json). Bytes are always printed alongside so
nobody mistakes an estimate for a measurement.

## Upgrade preflight

```bash
gstack context-bill --diff <old-tree> <new-tree>
```

Prints only changed rows with signed deltas, sorted by |delta|. Exits 2 if any
always-on or eager cost grew, so you see the `/plan` bill get heavier BEFORE
you upgrade. This is exactly the class of regression in #2362 (a template bug
that silently added ~11K tokens to every /spec load).

## Budget gating (CI-friendly)

```bash
gstack context-bill <tree> --budget budget.json
```

`budget.json` is plain user-authored JSON with ceilings in ~tokens:

```json
{ "alwaysOnTotal": 500, "eagerPerInvocation": { "plan": 5000, "ship": 4000 } }
```

Exit 0 within budget; exit 2 over budget with the offending files listed.

## Other flags

- `--json` — machine-readable output (works with the default, --diff, and --budget forms).
- `--skill plan --mode Discovery` — single-invocation simulation: eager cost
  plus the modules that mode routes to.

Tests: `bun test test/context-bill.test.ts` (free tier, offline).
