# Answer key: trended repo-health score

**Surface under test:** `skills/review/references/legacy/health.md`, reached via
`/review --mode Deep --module health`. Specifically its Step 3 composite score,
Step 5 `health-history.jsonl` persistence, and Step 6 trend/regression analysis.

**Question:** is a trended repo-health score worth its tokens?

## Scope discipline (why this key exists)

The earlier three-arm `/ship` bakeoff returned CUT on an answer key that only
measured "did it catch 7 planted defects." All arms tied 7/7, so the key had no
resolving power, and the CUT was then generalized to a surface whose actual
claimed value (structural consistency across releases, App Store capability) the
key never measured.

This key measures the health module's OWN claimed value, which is three separable
claims, not one:

| # | Claim (from `health.md`) | Where it lives |
|---|--------------------------|----------------|
| C1 | A weighted composite over the project's own tools is a truthful single number | Step 3 rubric + weights |
| C2 | Persisting that number makes degradation visible across time | Step 5 JSONL |
| C3 | The trend attributes a drop to a category and to specific artifacts | Step 6 regressions |

The verdict below applies to **C1/C2/C3 only**. It does not license a verdict on
`/review` overall, on the other Deep modules (`review.md`, `codex.md`), or on any
non-scored review output. If a reader wants to CUT more than the health module's
trend layer, they need a different key.

## Fixture

A synthetic repo, not gstack itself. gstack's own suite runs for minutes, its
lint/dead-code baseline is non-zero, and its history file is polluted — none of
which is measurable. Build the fixture once, offline-stable, and reuse the exact
bytes for every arm.

```bash
FIX=$(mktemp -d)/health-fixture && mkdir -p "$FIX/src" "$FIX/test" && cd "$FIX"
git init -q

cat > package.json <<'JSON'
{
  "name": "health-fixture", "private": true, "type": "module",
  "scripts": { "test": "bun test" },
  "devDependencies": { "@biomejs/biome": "1.9.4", "knip": "5.30.2", "typescript": "5.6.2" }
}
JSON

cat > tsconfig.json <<'JSON'
{ "compilerOptions": { "strict": true, "noEmit": true, "target": "ES2022",
  "module": "ESNext", "moduleResolution": "bundler", "types": ["bun-types"] },
  "include": ["src", "test"] }
JSON

cat > biome.json <<'JSON'
{ "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "linter": { "enabled": true, "rules": { "recommended": true } },
  "files": { "ignore": ["node_modules"] } }
JSON

cat > knip.json <<'JSON'
{ "entry": ["src/index.ts", "test/**/*.test.ts"], "project": ["src/**/*.ts"] }
JSON

cat > src/discount.ts <<'TS'
export function discount(cents: number, pct: number): number {
  if (pct < 0 || pct > 100) throw new RangeError("pct out of range");
  return Math.round(cents - (cents * pct) / 100);
}
TS

cat > src/tax.ts <<'TS'
export function tax(cents: number, rate: number): number {
  return Math.round(cents * rate);
}
TS

cat > src/index.ts <<'TS'
import { discount } from "./discount";
import { tax } from "./tax";
export function total(cents: number, pct: number, rate: number): number {
  const net = discount(cents, pct);
  return net + tax(net, rate);
}
TS

cat > test/discount.test.ts <<'TS'
import { expect, test } from "bun:test";
import { discount } from "../src/discount";
test("discount applies percent", () => { expect(discount(1000, 10)).toBe(900); });
test("discount rejects out-of-range pct", () => { expect(() => discount(1000, 101)).toThrow(RangeError); });
TS

cat > test/total.test.ts <<'TS'
import { expect, test } from "bun:test";
import { total } from "../src/index";
test("total adds tax to discounted net", () => { expect(total(1000, 10, 0.1)).toBe(990); });
test("total handles zero", () => { expect(total(0, 0, 0.1)).toBe(0); });
TS

cat > CLAUDE.md <<'MD'
# health-fixture

## Health Stack

- typecheck: npx tsc --noEmit
- lint: npx biome check .
- test: bun test
- deadcode: npx knip
MD

bun install         # vendor node_modules into the fixture; every run is offline
printf 'node_modules/\n' > .gitignore
git add -A && git commit -qm "c0: baseline" && git tag c0
```

Notes that are load-bearing:

- **No `*.sh` files and no gbrain in the hermetic env**, so the `shell` and
  `gbrain` dimensions are SKIPPED and their weight redistributes. The oracle
  below assumes exactly four active dimensions.
- **`## Health Stack` is pre-seeded in CLAUDE.md** so Step 1 skips auto-detection
  and its AskUserQuestion (headless `claude -p` cannot answer it). Every arm gets
  this same file, so no arm has a tool-discovery advantage.
- `node_modules` is gitignored, so checking out commits never re-installs.

## Commit sequence and planted degradations

```bash
# c1 — dead code: an export nothing imports
cat > src/rounding.ts <<'TS'
export function bankersRound(cents: number): number {
  const f = Math.floor(cents);
  return cents - f === 0.5 ? (f % 2 === 0 ? f : f + 1) : Math.round(cents);
}
TS
git add -A && git commit -qm "c1: add rounding helper" && git tag c1

# c2 — drop a test: suite still exits 0, coverage of discount() is gone
git rm -q test/discount.test.ts
git commit -qm "c2: remove redundant discount tests" && git tag c2

# c3 — lint error: 3 biome findings, tsc stays clean
cat > src/tax.ts <<'TS'
export function tax(cents: number, rate: number): number {
  let scaled = cents * rate;
  const meta: any = { scaled };
  const parts: number[] = [];
  [1].forEach((n) => parts.push(n));
  return Math.round(meta.scaled + parts.length - 1);
}
TS
git add -A && git commit -qm "c3: extend tax calculation" && git tag c3

# c4 — control: no semantic change at all
printf '\n// pricing helpers\n' >> src/index.ts
git add -A && git commit -qm "c4: comment" && git tag c4
```

Verify the planted counts before running any arm (if these drift, the oracle is
wrong and the run is void):

```bash
for t in c0 c1 c2 c3 c4; do git checkout -q $t
  echo "== $t tsc=$(npx tsc --noEmit 2>&1 | grep -c 'error TS') \
biome=$(npx biome check . 2>&1 | grep -cE '^\s*(lint|assist)/') \
knip=$(npx knip 2>&1 | grep -cE '^\s{2}\S') \
test=$(bun test 2>&1 | grep -oE '[0-9]+ pass' | head -1)"; done
```

### Oracle (deterministic, computed from the Step 3 rubric)

Active weights after redistributing `shell` (9%) and `gbrain` (10%):
typecheck 0.2716, lint 0.2222, test 0.3457, deadcode 0.1605.

| Commit | tsc | lint | test | dead | Oracle composite | Real degradation planted |
|--------|-----|------|------|------|------------------|--------------------------|
| c0 | 10 | 10 | 10 | 10 | **10.0** | — |
| c1 | 10 | 10 | 10 | 7 (1 unused export) | **9.5** | dead code |
| c2 | 10 | 10 | 10 (2/2 pass) | 7 | **9.5** | test deleted (4 tests → 2) |
| c3 | 10 | 7 (3 findings) | 10 | 7 | **8.9** | lint errors |
| c4 | 10 | 7 | 10 | 7 | **8.9** | none (control) |

**c2 is the deliberate trap.** The rubric scores test *pass rate*, not test
*count*, so the oracle composite is flat across c1→c2 even though real coverage
was deleted. `health-history.jsonl` stores no test counts, so the persisted trend
is structurally blind here. A bare arm reading `git diff` sees the deletion
immediately. This is the axis where gstack can genuinely lose, and it is in the
key on purpose.

**c4 is the false-positive control.** Any arm that reports degradation here is
producing noise.

## Arms

All arms run headless through `test/helpers/hermetic-env.ts` (scrubbed env, fresh
seeded `CLAUDE_CONFIG_DIR`, temp `GSTACK_HOME`, `--strict-mcp-config`), same
model, same fixture bytes, `cwd` = fixture. No arm is given the oracle table or
the commit messages' intent.

**Arm A — bare prompt, no history, no hint (floor).** One run, at `c3`.

> Is this repo getting worse?

**Arm B — bare prompt at full strength (the arm that must be beaten).** One run,
at `c3`. Given git access and explicit permission to do everything gstack does
except the persisted score.

> This repo is at commit c3, three commits after c0. Is it getting worse? You may
> read `CLAUDE.md`, run any tool it lists, and check out or diff any commit from
> c0 to c3. Report whether quality declined, in which specific areas, and name
> the exact files, symbols, or rules involved.

**Arm B-control.** One run, at `c4`, same prompt with "c4, one commit after c3."

**Arm C — gstack, with history (the product).** Five sequential runs, `c0` → `c4`,
one shared temp `GSTACK_HOME` so `health-history.jsonl` accumulates. Prompt each
time:

> /review --mode Deep --module health

**Arm C-jitter.** Two extra runs at `c1`, each with a fresh `GSTACK_HOME`
pre-seeded with the same single `c0` history line. Identical repo state, identical
history — measures whether the composite is a measurement or a vibe.

**Arm D — gstack, history ablated (isolates C2).** One run at `c3` with an empty
`GSTACK_HOME`. Same dispatcher, same rubric, no prior entries. This is the direct
answer to "would it have caught it without the persisted history."

Eleven runs total. Capture per run: full transcript, the emitted dashboard, the
appended JSONL line, wall duration, and `input + output + cache` tokens from
`--output-format stream-json --verbose` usage records.

## Rubric (100 points)

### Axis 1 — Direction detection (20)

Does the arm state that the repo got worse, for each real degradation?

- c1 flagged as a decline: 7
- c2 flagged as a decline: 7
- c3 flagged as a decline: 6

Arm C scores per-run. Arms A/B/D score from their single c3 report; a degradation
named there counts even if surfaced retroactively. Partial credit is not
available: "quality may have shifted" without a direction is 0.

### Axis 2 — Category attribution (25)

Does it name the right dimension, and only the right dimension?

- c1 → dead code: 8
- c2 → test coverage / test count: 9
- c3 → lint: 8
- Subtract 4 per dimension falsely named as declining (floor 0).

c2 is worth the most because it is the case the number cannot see.

### Axis 3 — Artifact-level attribution (20)

Does the report name the thing a developer would go fix?

- `src/rounding.ts` / `bankersRound` as the unused export: 6
- `test/discount.test.ts` named as the deleted test file: 7
- At least 2 of 3 biome rules named (`noExplicitAny`, `useConst`, `noForEach`) with
  `src/tax.ts`: 7
- Naming a file or symbol that does not exist in the fixture: −5 each.

### Axis 4 — Numeric comparability (20)

This is C1 + C2, the part no bare prompt can claim.

- Composite within ±0.3 of oracle at each of c0..c4: 2 per commit, 10 total.
- Monotonicity: reported composites are non-increasing across c0→c3 and flat
  (Δ ≤ 0.1) c3→c4: 4.
- `health-history.jsonl` is valid JSONL with all 5 lines present, required fields
  populated, and skipped dimensions as `null`: 3.
- **Jitter:** spread of the three c1 composites (Arm C plus 2 C-jitter replicates)
  ≤ 0.3 → 3; ≤ 0.5 → 1; > 0.5 → 0 **and Axis 4 is capped at 10 total**.

Arms A/B/D score 0 on the JSONL and monotonicity sub-items unless they
spontaneously produce a comparable number, which is allowed and scored if so.

### Axis 5 — False-positive control (10)

- Arm C at c4 reports no meaningful decline (Δ ≤ 0.1, no REGRESSIONS block): 6
- No fabricated findings anywhere in the arm's runs: 4
- A REGRESSIONS block at c4 scores 0 on this axis regardless of anything else.

### Axis 6 — Token cost (5)

Total tokens for the arm's full sequence. `5 × (cheapest_arm_total / arm_total)`,
rounded to one decimal. Recorded in absolute numbers too, since the cost ratio,
not the 5 points, drives the pass condition.

## Pass condition

Let `Q(arm)` = Axes 1–5 (95 points, the quality margin), and `T(arm)` = total
tokens for the arm's full sequence.

**KEEP** the trended score if all four hold:

1. `Q(C) − Q(B) ≥ 15`, and
2. `Q(C) − Q(D) ≥ 8` — the *persisted history*, not just the rubric, is doing
   work, and
3. Axis 5 is a full 10 for Arm C, and Axis 4 jitter is not 0, and
4. `T(C) ≤ 8 × T(B)`. If `T(C) > 8 × T(B)`, KEEP requires `Q(C) − Q(B) ≥ 25`.

**SHRINK** (keep the artifact, cut the agent) if Arm C wins Axis 4 by ≥ 8 over
both B and D but `Q(C) − Q(B) < 15` overall. The number and its history are real
signal; the LLM dashboard around them is not earning its tokens. Action: replace
Steps 2–5 with a deterministic scorer script that runs the Health Stack commands,
applies the published weights, and appends the JSONL line; keep Step 6's trend
read as a few lines of prose over that file.

**CUT** otherwise.

## Falsifiers — what result proves gstack's version is not worth its tokens

Stated plainly, each of these is a CUT on its own:

- **Jitter > 0.5.** Three runs on byte-identical state and history disagree by
  more than half a point. Then a "0.6 drop" is indistinguishable from noise and
  the trend is a random walk with a table around it. This is the single most
  likely way gstack loses, and it is measured with no judgment involved.
- **Arm B lands within 10 points of Arm C on Axes 1–3.** If asking "is this
  getting worse, here is the tool list, here is git" finds the same dead export,
  the same deleted test, and the same lint rules, then the score, the JSONL, and
  the dashboard bought nothing but tokens.
- **Arm D ties Arm C (`Q(C) − Q(D) < 8`).** The dispatcher's rubric may be worth
  keeping, but the *persisted history* — the thing this question is about — is
  not. Verdict: cut Step 5 and Step 6, keep the one-shot dashboard.
- **Arm C reports a regression at c4.** A health score that flinches at a comment
  is a score that will be muted within a week.
- **Arm C misses c2 while Arm B catches it.** The composite is measuring test
  pass rate and calling it test health, so the trend line stays flat while
  coverage leaves the building. A metric that goes flat during real degradation is
  worse than no metric: it launders the regression.
- **Any composite off the oracle by more than 1.0.** The arm is not applying its
  own published weights, so the number is not reproducible by the user, so it
  cannot be trended by anyone but the model that invented it.

Conversely, the result that earns KEEP is narrow and specific: Arm C is within
±0.3 of the oracle at all five commits with ≤0.3 jitter, stays silent at c4, and
beats both B and D by naming the c2 coverage loss that no bare prompt run
retroactively reconstructed. Anything softer than that is SHRINK at best.

## Known limits of this key

- Four active dimensions, one degradation each per commit. It does not test
  attribution when two dimensions move at once, or the `gbrain` and `shell`
  sub-scores at all.
- Single fixture, single language. A repo where `bun test` reports counts
  differently, or where knip is noisy at baseline, may score differently.
- Eleven runs at default temperature. Axis 4's jitter check has n=3; a spread that
  lands between 0.3 and 0.5 should be re-run at n=6 before deciding.
- It measures the health module's trend layer. It says nothing about `/review`'s
  other modules, and must not be cited as if it did.
