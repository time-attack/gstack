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
  foreign-host skill files polluting scanner scope (#1694). **This row counts
  frontmatter only.** The host wraps each skill in its own `available_skills` XML
  element before the model sees it, and that wrapper is host-specific rather than
  something this tree can measure, so the row prints its exclusion instead of
  folding in a guessed constant. Real always-on cost is this figure plus one
  wrapper per skill.
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
ceilings run 1.6x to 4.2x it. These are **measured** with `count_tokens`
(`claude-opus-4-5`), not estimated — reproduce with `--exact`:

| Skill | Fast path (trivial ask) | Eager floor | Conditional | Per-invocation ceiling |
|---|---|---|---|---|
| `plan` | 2.8K tok | 4.5K tok | +7.8K tok | 12.3K tok (2.7x) |
| `qa` | 2.0K tok | 3.7K tok | +8.0K tok | 11.7K tok (3.1x) |
| `debug` | 1.7K tok | 3.4K tok | +5.8K tok | 9.1K tok (2.7x) |
| `review` | 1.8K tok | 3.4K tok | +6.7K tok | 10.1K tok (2.9x) |
| `ship` | 1.9K tok | 3.6K tok | +11.5K tok | 15.1K tok (4.2x) |
| `make-pdf` | none | 2.7K tok | +1.7K tok | 4.4K tok (1.6x) |

The fast-path column is the same 1,675 tok of forced references in every
dispatcher (the shared triad), dropped because the dispatcher tells the agent
to drop it. Whole tree: 521,607 tok on disk, 58% lazy by bytes but 60% by tokens.

Run the tool for current numbers; the table above is a snapshot, not a pin.

## How accurate are the token numbers?

The tool's whole value is being trustworthy about cost, so it states where every
figure comes from. The first output line names the token source, and the last
line names the measured error band.

**Bytes are always exact.** Tokens come from one of two sources.

### Default: a calibrated offline estimate

Offline is a hard rule here, so the default never touches the network. It divides
bytes by a divisor **per content class**, each fitted to real `count_tokens`
measurements of this repo's own files:

| Content class | Path role | Bytes per token |
|---|---|---|
| `frontmatter` | the YAML block of a SKILL.md | 3.99 |
| `skillmd` | SKILL.md bodies | 4.21 |
| `reference` | `references/*.md` | 4.15 |
| `artifact` | `references/{artifacts,sections,support}/**` | 3.67 |
| `legacy` | `references/legacy/**` | 3.47 |

Classes exist because the spread is structural, not random. Measured across all
219 files in `skills/`, bytes-per-token runs from 2.36 to 4.72, but legacy
specialist modules cluster at 3.47 (n=50, range 3.10-3.83) and SKILL.md bodies at
4.21 (n=50, range 3.65-4.50). One divisor for both charged the LAZY ledger about
19% under while charging EAGER about right.

Measured accuracy of the estimate, against `count_tokens` on those 219 files:

| | Old flat bytes/4 | Calibrated per class |
|---|---|---|
| Mean per-file error | 11.14% | **7.36%** |
| Systematic bias | -2.49% | **-0.02%** |
| Worst single file | 40.9% | 43.0% |

Per class after calibration: `skillmd` worst 13.3% (mean 3.2%), `legacy` worst
10.7% (mean 4.3%), `artifact` worst 23.7% (mean 8.2%), `reference` worst 43.0%
(mean 12.0%).

**What calibration does not fix.** The `reference` class is genuinely mixed:
dense path-and-table files like `ASSETS.md` measure 2.36 bytes/token while prose
references reach 4.72. No divisor keyed on path can split those, so worst-case
single-file error stays near 40%. Ledger rows land tighter than single files
because errors partly cancel across a sum, but if one file's number has to be
right, measure it.

The divisors are tokenizer-specific, fitted against `claude-opus-4-5`. Opus 4.7
and later tokenize differently; on those models use `--exact`.

### `--exact`: measured counts, opt-in only

```bash
gstack context-bill <tree> --exact                    # measured, not estimated
gstack context-bill <tree> --exact --exact-model <id> # another tokenizer
```

`--exact` calls Anthropic's `count_tokens` for every file the bill touches, so
the figures are measurements and lose the `~` the estimates wear.

**It sends the content of every `.md` file in the tree to `api.anthropic.com`.**
That is why it is off by default and why passing the flag is the consent: the
command prints what it is about to send, to stderr, before sending it. It needs
`ANTHROPIC_API_KEY`; with no key nothing is sent, the run prints the typed code
`exact_missing_api_key`, and the offline estimate answers instead. Other typed
codes: `exact_auth_rejected`, `exact_request_failed`, `exact_network_unreachable`,
`exact_response_malformed`. Every one of them degrades to the estimate rather
than failing the run.

`count_tokens` prices a whole request, so it includes a fixed message envelope.
The envelope is measured once per run and subtracted, leaving the tokens each
file's own content contributes — otherwise every small reference is overcharged
by a constant that has nothing to do with the file.

### The tool grades its own estimate

`--exact --json` adds a `calibration` block: per file, the class, the estimate,
the measured count, bytes-per-token, and the signed residual, plus corpus
`worstErrorPct`, `meanAbsErrorPct`, and `biasPct`. That is how the divisor table
above was produced, and how to re-derive it after the skills tree changes:

```bash
gstack context-bill skills --exact --json | jq '.calibration | {worstErrorPct, meanAbsErrorPct, biasPct}'
```

Estimated versus measured on ten real files spanning every class, before and
after calibration (this sample deliberately includes the worst outliers, so its
means are worse than the whole-corpus figures above):

| File | Class | Bytes | Actual tok | bytes/4 | Err | Calibrated | Err |
|---|---|---|---|---|---|---|---|
| `plan/SKILL.md` | skillmd | 11865 | 2833 | 2966 | +4.7% | 2818 | **-0.5%** |
| `qa/SKILL.md` | skillmd | 8159 | 2028 | 2040 | +0.6% | 1938 | -4.4% |
| `make-pdf/SKILL.md` | skillmd | 9742 | 2670 | 2436 | -8.8% | 2314 | -13.3% |
| `plan/references/EXECUTION-PROFILES.md` | reference | 3191 | 676 | 798 | +18.0% | 769 | **+13.8%** |
| `plan/references/RUNTIME.md` | reference | 7150 | 1588 | 1788 | +12.6% | 1723 | **+8.5%** |
| `plan/references/ASSETS.md` | reference | 1534 | 649 | 384 | -40.8% | 370 | -43.0% |
| `plan/references/legacy/autoplan.md` | legacy | 59840 | 16631 | 14960 | -10.0% | 17245 | **+3.7%** |
| `qa/references/legacy/qa.md` | legacy | 39844 | 11157 | 9961 | -10.7% | 11482 | **+2.9%** |
| `review/references/legacy/health.md` | legacy | 14061 | 4538 | 3515 | -22.5% | 4052 | **-10.7%** |
| `qa/.../qa-report-template.md` | artifact | 2979 | 1038 | 745 | -28.2% | 812 | **-21.8%** |

The legacy column is the point: those are the biggest numbers the tool prints,
and `bytes/4` billed them 10-22% under.

### Percentages are token shares, not byte shares

The fast-path saving and the lazy share are reported against tokens. A byte-derived
percentage is divisor-invariant — it prints the identical number no matter how the
estimate is calibrated, so a wrong multiplier can hide inside it indefinitely while
references and SKILL.md bodies tokenize at different rates. `TOTAL on disk` prints
both shares so the gap between them is visible.

The gap is real and always in the same direction, because the forced references a
fast path drops are less token-dense than the SKILL.md body it keeps:

| Skill | Saving, byte-derived | Saving, measured tokens | Overstatement |
|---|---|---|---|
| `debug` | 52.2% | 49.9% | 2.3 pp |
| `plan` | 39.8% | 37.2% | 2.6 pp |
| `qa` | 49.0% | 45.2% | 3.7 pp |
| `review` | 51.5% | 48.8% | 2.7 pp |
| `ship` | 50.3% | 46.9% | 3.3 pp |

No choice of flat divisor closes that gap, which is why the fix is per-file counts
rather than a better multiplier.

### The other sense of "estimate"

The ceiling is an estimate in a second sense: it assumes every stated condition
fires. A run that never asks a question and never touches a capability pays less.
The condition text next to each row is there so you can judge which ones apply to
your run. The fast-path row is an estimate in that sense too: it is what the
dispatcher's fast path directs, for the asks that classify as trivial. `--exact`
makes the per-file numbers measurements; it does not make the ceiling a prediction.

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
  Each skill carries `fastPath` (`{ paths, bytes, tokens }`, or `null` when no fast
  path overrides its forced reads). Every priced entry carries both `bytes` and
  `tokens`, so a consumer never has to re-derive tokens from a byte total and lose
  the per-class divisor. `tokenSource` names where the token figures came from.
- `--exact`, `--exact-model <id>` — see the accuracy section above. Off by default;
  `--exact` sends file content to `api.anthropic.com`.
- `--skill plan --mode Discovery` — single-invocation simulation: eager plus
  conditional cost, plus the modules that mode routes to.

Tests: `bun test test/context-bill.test.ts` (free tier, offline).
