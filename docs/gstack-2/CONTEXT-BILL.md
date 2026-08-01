# gstack context-bill

A token bill-of-materials for everything gstack loads into your agent's context.
Offline, read-only, deterministic. It writes no state anywhere. Part of the
optional runtime bundle (a tool, like make-pdf, not a judgment dispatcher).

```bash
gstack context-bill                      # auto-detects an installed tree (see below)
gstack context-bill <tree>               # any installed skills tree
bin/gstack-context-bill <tree>           # same tool, standalone
```

With no argument it takes the first of these that exists, project before user:
`./skills`, `./.agents/skills`, `./.claude/skills`, `~/.agents/skills`,
`~/.claude/skills`. `.agents/skills` is where `npx skills add
time-attack/gstack/skills` puts a host-neutral install, so the common case
needs no path. When none exist it names every candidate it tried.

Five ledgers:

- **ALWAYS-ON** — per-skill YAML frontmatter bytes (what every session's skill
  scanner loads). Flags frontmatter keys the router never reads (#2286) and
  foreign-host skill files polluting scanner scope (#1694).
- **EAGER (per invocation)** — SKILL.md plus the forced-read references the
  dispatch protocol mandates for every invocation (the shared triad), parsed
  from the dispatcher's own "for every invocation" sentence. This is the
  **floor of a full invocation**, not the bill, and not what a trivial ask pays.
- **FAST-PATH (trivial ask)** — every dispatcher's fast path (trivial-change,
  trivial-check, empty-target) explicitly overrides the forced-read step, so a
  trivial ask pays SKILL.md alone: no forced references, no specialist modules.
  Printed as its own row, with the saving against the eager row and the names of
  the paths that fire it, read from the dispatcher's own override clause and
  section headings. Skills with no such clause print `none`, and their eager row
  stands for every invocation.
- **CONDITIONAL (per invocation)** — the references a dispatcher mandates under
  a stated condition, each printed with the dispatcher's own words for when it
  fires: `QUESTION-FORMAT.md` before the first question to the user,
  `RUNTIME.md` before capability-dependent work, `WEB-CONTEXT.md` before
  public-web work, `CODE-INTELLIGENCE.md` once when the target is a repository,
  `SYSTEM-FUNCTIONAL.md` when that lane is active, and so on. A normal run hits
  several of these, so an eager-only number understates what an invocation
  actually pays. Each dispatcher's **per-invocation ceiling** (eager + every
  conditional) is printed with its multiple of the eager figure.
- **LAZY (per mode/alias)** — for each mode and legacy alias in the routing
  tables, which `references/legacy/*.md` modules activate and what each costs.
  Unrouted on-disk modules and missing (phantom) modules are flagged.

The real cost of one run sits between the trivial-path figure and the ceiling
plus whatever modules the chosen mode routes to. `--skill X --mode Y` prints
that sum directly.

Against `skills/` today, a trivial ask costs roughly half the eager row, and the
ceilings run 1.8x to 3.6x it:

| Skill | Fast path (trivial ask) | Eager floor | Conditional | Per-invocation ceiling |
|---|---|---|---|---|
| `plan` | ~3.2K tok | ~5.0K tok | +~5.5K tok | ~10.5K tok (2.1x) |
| `qa` | ~2.4K tok | ~4.2K tok | +~7.0K tok | ~11.2K tok (2.7x) |
| `debug` | ~2.1K tok | ~3.9K tok | +~5.3K tok | ~9.2K tok (2.4x) |
| `review` | ~2.1K tok | ~3.9K tok | +~5.9K tok | ~9.8K tok (2.5x) |
| `ship` | ~2.3K tok | ~4.1K tok | +~10.6K tok | ~14.7K tok (3.6x) |
| `make-pdf` | none | ~2.4K tok | +~1.9K tok | ~4.4K tok (1.8x) |

The fast-path column is the same ~1.8K tok of forced references in every
dispatcher (the shared triad), dropped because the dispatcher tells the agent
to drop it.

Run the tool for current numbers; the table above is a snapshot, not a pin.

Token counts are estimates, bytes/4, the same convention as
[BLOAT-LEDGER.json](BLOAT-LEDGER.json). Bytes are always printed alongside so
nobody mistakes an estimate for a measurement. The ceiling is an estimate in a
second sense too: it assumes every stated condition fires. A run that never
asks a question and never touches a capability pays less. The condition text
next to each row is there so you can judge which ones apply to your run. The
fast-path row is an estimate in that second sense as well: it is what the
dispatcher's fast path directs, for the asks that classify as trivial.

## Upgrade preflight

```bash
gstack context-bill --diff <old-tree> <new-tree>
```

Prints only changed rows with signed deltas, sorted by |delta|. Exits 2 if any
always-on, eager, or conditional cost grew, so you see the `/plan` bill get
heavier BEFORE you upgrade. This is exactly the class of regression in #2362 (a
template bug that silently added ~11K tokens to every /spec load). Conditional
counts as growth: a newly mandated read that fires on most runs is a real
regression even though no line says "for every invocation".

## Budget gating (CI-friendly)

```bash
gstack context-bill <tree> --budget budget.json
```

`budget.json` is plain user-authored JSON with ceilings in ~tokens:

```json
{
  "alwaysOnTotal": 500,
  "eagerPerInvocation": { "plan": 5000, "ship": 4500 },
  "perInvocation": { "plan": 11000, "ship": 15000 }
}
```

`eagerPerInvocation` gates the forced-read floor. `perInvocation` gates the
eager + conditional ceiling, which is the number a real invocation pays, so
that is usually the one you want in CI. Exit 0 within budget; exit 2 over
budget with the offending files listed (conditional ones marked as such).

## Other flags

- `--json` — machine-readable output (works with the default, --diff, and --budget forms).
  Each skill carries `fastPath` (`{ paths, bytes }`, or `null` when no fast path
  overrides its forced reads).
- `--skill plan --mode Discovery` — single-invocation simulation: eager plus
  conditional cost, plus the modules that mode routes to.

Tests: `bun test test/context-bill.test.ts` (free tier, offline).
