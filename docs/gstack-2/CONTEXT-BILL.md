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

Six ledgers and two ceilings:

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
  actually pays.
- **TRANSITIVE (pulled in by a file above)** — what the eager and conditional
  files themselves order read. `RUNTIME.md` orders `BROWSER-PROVIDERS.md` and
  two machine-readable contracts, `QUESTION-FORMAT.md` orders the two
  AskUserQuestion docs, `TOTAL-VERIFICATION.md` orders its worked examples. The
  dispatcher names none of them, so a ledger that stops at the dispatcher's own
  sentence billed every one at zero. Each row prints the file that pulled it in.
  It is a separate tier rather than folded into EAGER on purpose: the dispatcher
  never ordered these directly, and a floor that quietly absorbs them stops
  meaning "floor".
- **LAZY (per mode/alias)** — for each mode and legacy alias in the routing
  tables, which `references/legacy/*.md` modules activate and what each costs,
  plus everything those modules order read: the `references/sections/` phases,
  the `references/artifacts/` files, and plain references like
  `BASE-DETECTION.md`. Unrouted on-disk modules and missing (phantom) modules
  are flagged.
- **ROUTE CEILING** — per-invocation plus the heaviest mode that dispatcher can
  route to. This is the figure an audited run gets compared against, so it is
  printed last and named plainly.

Nothing is charged twice. Each tier is seeded with what the tier above already
paid, so a file two modules both name, or a reference a module points back at,
is billed once and the ceiling stays a true sum.

The real cost of one run sits between the trivial-path figure and the route
ceiling. `--skill X --mode Y` prints the exact sum for one mode.

Against `skills/` today (offline estimate; run `--exact` for measured counts).
Every figure below comes from one command, so re-render it rather than trusting
the digits:

```bash
gstack context-bill skills
```


| Skill | Fast path | Eager floor | Conditional | Transitive | Per-invocation | Route ceiling |
|---|---|---|---|---|---|---|
| `plan` | 4.1K tok | 4.8K tok | +11.7K tok | +7.9K tok | 24.4K tok (5.1x) | 53.7K tok (Product) |
| `qa` | 2.6K tok | 4.0K tok | +7.6K tok | +6.6K tok | 18.1K tok (4.6x) | 49.8K tok (Report) |
| `debug` | 2.3K tok | 3.7K tok | +5.8K tok | +6.4K tok | 15.9K tok (4.3x) | 21.4K tok (Fix) |
| `review` | 2.4K tok | 3.8K tok | +6.3K tok | +6.4K tok | 16.5K tok (4.3x) | 66.7K tok (Deep) |
| `ship` | 2.4K tok | 3.8K tok | +10.9K tok | +6.4K tok | 21.1K tok (5.6x) | 72.1K tok (Prepare) |
| `make-pdf` | none | 2.3K tok | +2.1K tok | +3.7K tok | 8.1K tok (3.5x) | none routed |

Whole tree: ~525K tok on disk, 77% lazy by bytes but 80% by tokens.

Run the tool for current numbers; the table above is a snapshot, not a pin.

### Why the ceiling moved

An audited `/plan` Engineering run read eight files totalling 101,951 B. The
pre-walk tool printed a 66,889 B ceiling for `/plan`, so the run came in 52%
over it. The gap was structural, not arithmetic. The bill walked
`references/*.md` only where a dispatcher sentence named the file, and never
followed what those files, or a routed module, ordered read next. A 46 KB
`references/sections/` file was read on that run and priced by no ledger at all.

**That run cannot be recomputed from this repository.** The 101,951 B total is
the only thing anyone wrote down. The eight file paths were not recorded, and
neither was a token count, so nothing here can re-derive either one and no
bytes-per-token ratio can be read off it. Treat it as a single observation in
bytes. Do not quote a token figure for it, and do not use it to calibrate a
divisor.

Both halves of the walk are priced now, and the ceiling that gets quoted is the
route one:

```bash
gstack context-bill skills --skill plan --mode Engineering
```

That prints 174,950 B against the audited run's 101,951 B, which is 72%
**above** it. That is not a tight fit and it is not evidence of accuracy. A
ceiling assumes every stated condition fires and the heaviest mode routes; a
real run hits some conditions and one mode. So the tool traded a 52%
understatement of that one run for a 72% overstatement in the other direction.
A bound is what a bound is for. If you need what a run cost, measure the run.

The before column comes from the tool as it stood at `6565c194`
(`git archive 6565c194 | tar -x -C "$(mktemp -d)"`, then run its
`bin/gstack-context-bill` against its own `skills/`). Bytes are exact; the token
figures beside them carry the estimate's error band.

| Figure for `/plan` | Before | After |
|---|---|---|
| Per-invocation ceiling | 66,889 B (~16.1K tok) | 98,803 B (~24.1K tok) |
| Engineering route total | not printed | 174,950 B (~45.3K tok) |
| Route ceiling (heaviest mode) | not printed | 204,644 B (~53.6K tok) |

The other direction matters as much. A cost tool this project already caught
over-reporting by 11% does not get to fix under-reporting by over-reporting, so
the walk skips table rows outside the LAZY tier. `ASSETS.md` is a manifest whose
rows map an old asset path to a current one for lookup; following those rows
would charge a skill's whole `artifacts/` tree the moment anything mentions
`ASSETS.md`. Module tables are dispatch tables (`review`'s specialist rows say
when to read each one), so those are followed.

### Savings this bill cannot see

Two recent context cuts do not show up in any row here. A doc that let you infer
they did would be claiming a number the tool never produced.

**The `/qa` DX-audit gate is prose, not routing.** `devex-review.md` is the
largest module in the tree, about 29 KB. `/qa` now loads it on the presence of a
developer-experience surface rather than on the depth of the pass, and records
`no developer-experience surface` on the Skipped modules line when it does not.
The bill cannot see that. It prices route membership from the routing tables, and
`devex-review.md` is still a member of the `qa` / `Report` route, so the row
charges it before and after:

```bash
gstack context-bill skills --json \
  | jq '.skills[]|select(.name=="qa")|.lazy[]|select(.label=="Report")
        |.modules[]|select(.path|test("devex"))'
```

The ceiling is behaving correctly. It assumes every stated condition fires, and
this is a stated condition. The saving is real for an API, CLI, worker, or
webhook target with no DX surface, and it is worth roughly what that row says,
but you will see it in what a run actually reads, not in the printed ceiling. A
`Report` ceiling that moves across this change moved for some other reason.
`test/qa-devex-conditional.test.ts` is what holds the gate in place.

**The dead-runtime-prose pass was mostly a relocation.** Runtime-only prose moved
out of the modules that ordered it and into
`skills/plan/references/sections/**/runtime-tail.md` and
`skills/plan/references/sections/review-dashboard.md`. Those five files total
18,282 B, they ship, and the bill charges them: they appear in the `plan` /
`Engineering` LAZY row next to the module that pulls them in. Net change to the
tree is a rounding error:

```bash
b=$(mktemp -d) && git archive 6565c194 | tar -x -C "$b"
find "$b/skills" -name '*.md' -exec cat {} + | wc -c   # before
find    skills   -name '*.md' -exec cat {} + | wc -c   # after
```

1,946,457 B before, 1,940,423 B after. That is -6,034 B, or **-0.31%** of the
tree. So it is not a size win and should not be sold as one. The reason to do it is
per-run, not on disk: a runtime-only section is now skipped whole on a machine
with no `$GSTACK_BIN` instead of being read in full to execute nothing. The read
is the cost. `test/runtime-absence-guard.test.ts` pins both halves of that.

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
always-on, eager, conditional, or transitive cost grew, so you see the `/plan`
bill get heavier BEFORE you upgrade. This is exactly the class of regression in
#2362 (a template bug that silently added ~11K tokens to every /spec load).
Conditional counts as growth: a newly mandated read that fires on most runs is a
real regression even though no line says "for every invocation". So does
transitive: a reference that starts ordering a new file read costs the same
tokens whether or not the dispatcher mentions it.

## Budget gating (CI-friendly)

```bash
gstack context-bill <tree> --budget budget.json
```

`budget.json` is plain user-authored JSON with ceilings in ~tokens:

```json
{
  "alwaysOnTotal": 500,
  "eagerPerInvocation": { "plan": 5000, "ship": 4500 },
  "perInvocation": { "plan": 25000, "ship": 22000 },
  "routeCeiling": { "plan": 55000, "ship": 75000 }
}
```

`eagerPerInvocation` gates the forced-read floor. `perInvocation` gates the
eager + conditional + transitive ceiling before anything routes.
`routeCeiling` adds the heaviest mode, which is the number a routed run
actually pays, so that is usually the one you want in CI. Exit 0 within budget;
exit 2 over budget with the offending files listed (conditional, transitive,
and routed-module ones each marked with why they are there).

## Other flags

- `--json` — machine-readable output (works with the default, --diff, and --budget forms).
  Each skill carries `fastPath` (`{ paths, bytes, tokens }`, or `null` when no fast
  path overrides its forced reads), `transitiveRefs` (each with a `via` naming the
  file that pulled it in), and `routeCeiling` (`{ label, bytes, tokens }`, or `null`
  when nothing routes). Every priced entry carries both `bytes` and
  `tokens`, so a consumer never has to re-derive tokens from a byte total and lose
  the per-class divisor. `tokenSource` names where the token figures came from.
- `--exact`, `--exact-model <id>` — see the accuracy section above. Off by default;
  `--exact` sends file content to `api.anthropic.com`.
- `--skill plan --mode Discovery` — single-invocation simulation: eager plus
  conditional plus transitive cost, plus everything that mode routes to.

Tests: `bun test test/context-bill.test.ts` (free tier, offline).
