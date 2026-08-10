# Answer key: `/ship` Prepare — PR-body structural consistency across runs

**Surface under test:** the PR-body composition path of `/ship` Prepare
(`skills/ship/SKILL.md` → `references/legacy/ship.md` → lazy phase
`references/sections/ship/pr-body.md`, Step 19).

**Question:** does it produce the same PR structure every run?

**Why this key exists.** A three-arm bakeoff already ran on `/ship` and returned
CUT. Its only axis was "did the arm catch 7 planted defects". All arms tied 7/7,
so the key had no discriminating power at all, and the CUT was then generalized
to the whole `/ship` surface. Defect-catching is not why the owner keeps `/ship`.
Two of the actual reasons are (a) a stable, contract-shaped PR body every run and
(b) App Store / TestFlight distribution. This key measures (a) only. It does not
license a verdict on (b), or on Land / Deploy / Monitor / Resume / queue-drift
version arbitration. See **Scope of verdict** at the bottom — that boundary is
the whole point of writing a second key.

**Status:** SPEC ONLY. Never run. No numbers below are measured; every results
cell is blank on purpose. Do not quote this file as evidence until the runner has
produced `results.json`.

---

## 1. Ground truth: the canonical structure

`references/sections/ship/pr-body.md` lines 57-145 define the contract. Canonical
headings, in canonical order:

| # | Heading | Conditionality |
|---|---|---|
| 1 | `## Summary` | always |
| 2 | `## Test Coverage` | always |
| 3 | `## Pre-Landing Review` | always |
| 4 | `## Eval Results` | always (carries explicit skip text) |
| 5 | `## Greptile Review` | omit if no PR existed at Step 10 |
| 6 | `## Scope Drift` | omit if scope-drift check did not run |
| 7 | `## Plan Completion` | always (says "No plan file detected." if none) |
| 8 | `## Linked Spec` | omit if no `/plan` Specification archive matches the branch |
| 9 | `## Verification Results` | omit if not applicable |
| 10 | `## TODOS` | omit if no `TODOS.md` and the user skipped |
| 11 | `## Documentation` | omit if Step 18 returned `documentation_section: null` |
| 12 | `## Test plan` | always |

On the fixture in §2 the resolved expectation is:

- **Required present (6):** Summary, Test Coverage, Pre-Landing Review, Eval
  Results, Plan Completion, Test plan.
- **Required absent (1):** Linked Spec — no spec archive exists, and no
  `Closes #N` line may appear anywhere in the body.
- **Free (4):** Greptile Review, Scope Drift, Verification Results,
  Documentation. Presence is not scored; *inconsistent* presence across the three
  runs is scored (Axis 1).

**Known contract defect — do not score it.** Line 144 of `pr-body.md` carries a
corrupted trailer, `https:/$review --mode Deep --module claude.com/claude-code`,
left by an alias-rewrite pass over the legacy tree. The trailer URL is therefore
not a valid expectation; exclude the trailer line from every axis and file the
corruption separately. Scoring a broken contract clause would measure the bug,
not the surface.

---

## 2. Fixture (exact, hermetic, built by script)

Built outside this repo, never inside it. One pristine copy, then a fresh
per-run copy, so no run observes another run's mutations (VERSION bumps,
CHANGELOG edits, generated tests).

```bash
set -euo pipefail
FX=~/.gstack-dev/evals-fixtures/ship-consistency
rm -rf "$FX"; mkdir -p "$FX/pristine"; cd "$FX/pristine"
git init -q -b main
export GIT_AUTHOR_NAME=Fixture GIT_AUTHOR_EMAIL=fixture@example.invalid \
       GIT_COMMITTER_NAME=Fixture GIT_COMMITTER_EMAIL=fixture@example.invalid \
       GIT_AUTHOR_DATE='2026-01-01T00:00:00Z' GIT_COMMITTER_DATE='2026-01-01T00:00:00Z'

mkdir -p src test
printf '# fixture\n\n## Testing\n\n```bash\nnode --test test/\n```\n' > CLAUDE.md
printf '1.2.0.0\n' > VERSION
printf '# Changelog\n\n## [1.2.0.0]\n\nInitial fixture release.\n' > CHANGELOG.md
cat > src/retry.js <<'EOF'
export function backoff(attempt, baseMs) { return baseMs * 2 ** attempt; }
EOF
cat > test/retry.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert';
import { backoff } from '../src/retry.js';
for (const [a, b, want] of [[0,100,100],[1,100,200],[2,100,400],[3,100,800],[0,50,50],[4,10,160],[5,1,32]])
  test(`backoff ${a} ${b}`, () => assert.equal(backoff(a, b), want));
EOF
printf '{"name":"fixture","type":"module"}\n' > package.json
git add -A && git commit -qm 'chore: fixture baseline'

git checkout -qb fixture/pr-structure
cat > src/config.js <<'EOF'
export function loadConfig(env = process.env) {
  return { region: env.REGION ?? 'us', retries: Number(env.RETRIES ?? 3) };
}
EOF
git add -A && git commit -qm 'feat: config loader with env overrides'

cat > src/rate-limit.js <<'EOF'
// Public interface, zero tests: the planted coverage gap.
export function parseWindow(spec) {
  const m = /^(\d+)([smh])$/.exec(spec);
  if (!m) throw new TypeError(`bad window: ${spec}`);
  return Number(m[1]) * { s: 1000, m: 60000, h: 3600000 }[m[2]];
}
export function tokenBucket(rate, windowSpec) {
  return { rate, windowMs: parseWindow(windowSpec), tokens: rate };
}
EOF
git add -A && git commit -qm 'feat: token-bucket rate limiter with window parsing'

cat > src/retry.js <<'EOF'
// Breaking signature change: positional args -> options object.
export function backoff({ attempt, baseMs = 100, jitter = 0 }) {
  return baseMs * 2 ** attempt + jitter;
}
EOF
cat > test/retry.test.js <<'EOF'
import { test } from 'node:test';
import assert from 'node:assert';
import { backoff } from '../src/retry.js';
for (const [a, b, want] of [[0,100,100],[1,100,200],[2,100,400],[3,100,800],[0,50,50],[4,10,160],[5,1,32]])
  test(`backoff ${a} ${b}`, () => assert.equal(backoff({ attempt: a, baseMs: b }), want));
EOF
git add -A && git commit -qm 'refactor: retry backoff takes an options object'

printf '1.3.0.0\n' > VERSION
printf '# Changelog\n\n## [1.3.0.0]\n\nRate limiting and config loading.\n\n## [1.2.0.0]\n\nInitial fixture release.\n' > CHANGELOG.md
git add -A && git commit -qm 'chore: bump VERSION to 1.3.0.0 + CHANGELOG'

git init -q --bare "$FX/remote.git"
git remote add origin "$FX/remote.git"
git push -q origin main fixture/pr-structure
node --test test/   # must be 7/7 green before any arm runs
```

Fixture properties that matter, and what each one tests:

| Property | Tests |
|---|---|
| 3 substantive commits + 1 bookkeeping commit | Summary enumerates all substantive work and excludes the VERSION/CHANGELOG commit |
| `parseWindow` / `tokenBucket` exported with zero tests | Test Coverage names a real gap instead of asserting blanket coverage |
| `backoff` signature change | public-interface change, so the trivial-change fast path (`references/FAST-PATH.md`) must NOT fire |
| `CLAUDE.md` declares `node --test test/`, 7 passing tests | Test plan cites the project's real command and a real count |
| no `TODOS.md`, no plan file, no spec archive, no open PR | four conditional sections must resolve to omit-or-negative-statement, not fabrication |
| local bare remote, `gh` unauthenticated / absent | nothing can accidentally create a real PR |

If an arm takes the fast path, **score the run as produced**. Do not re-roll, do
not discard. Divergent classification of the same branch across runs is exactly
the inconsistency this key exists to measure, and discarding unflattering runs is
how a key gets rigged.

---

## 3. Arms

Three arms × 3 runs = 9 runs. Every run: fresh `cp -R "$FX/pristine" "$FX/run-<arm><n>"`,
fresh process, no shared session, identical model, identical turn cap (120),
hermetic env per `test/helpers/hermetic-env.ts` conventions (scrubbed env, fresh
`CLAUDE_CONFIG_DIR`, temp `GSTACK_HOME`, `--strict-mcp-config`). Arm A additionally
gets the gstack skill tree linked into its `CLAUDE_CONFIG_DIR`; arms B and C get a
skill-free config dir.

**Arm A — gstack** (`/ship` Prepare):

> Use the ship skill in Prepare mode on this branch. Base branch is `main`.
> Report-only: do not commit, do not push, do not create or edit a PR. Compose
> the full PR body you would submit and write it verbatim to `./pr-body.md`.
> Then stop.

**Arm B — bare** (the null hypothesis):

> Write a PR body for this branch. Base branch is `main`. Write it verbatim to
> `./pr-body.md`. Then stop.

**Arm C — pasted template** (the cheap-substitute control; Arm B's prompt plus):

> Use exactly these sections, in this order, omitting any that do not apply:
> `## Summary`, `## Test Coverage`, `## Pre-Landing Review`, `## Eval Results`,
> `## Greptile Review`, `## Scope Drift`, `## Plan Completion`, `## Linked Spec`,
> `## Verification Results`, `## TODOS`, `## Documentation`, `## Test plan`.

Arm C exists because it is the only honest way to answer "worth its tokens". If a
12-line pasted heading list reaches A's score at a thirtieth of A's tokens, then
the value is a template — extractable to `.github/pull_request_template.md` — and
not a judgment surface. A key without Arm C can only ever flatter gstack.

Record per run: `pr-body.md`, full transcript, input+output tokens, wall clock,
whether the fast path fired, and whether the run breached the report-only
boundary (commit / push / PR). Boundary breach is reported as a finding, not
scored — it is a different claim.

### Diff the runs (the requirement, literally)

```bash
cd "$FX"
for arm in A B C; do
  for n in 1 2 3; do grep -n '^## ' run-$arm$n/pr-body.md | sed 's/:## /\t/' > head-$arm$n.txt; done
  echo "== arm $arm: 1v2"; diff head-${arm}1.txt head-${arm}2.txt || true
  echo "== arm $arm: 2v3"; diff head-${arm}2.txt head-${arm}3.txt || true
  echo "== arm $arm: 1v3"; diff head-${arm}1.txt head-${arm}3.txt || true
done
```

---

## 4. Rubric — 100 points per arm, fully mechanical

No LLM judge. Every check is a string/set operation over the nine `pr-body.md`
files, so the score is reproducible from the artifacts alone.

Heading extraction: lines matching `^## `, in file order, trimmed, lowercased,
whitespace-collapsed. Duplicates are kept (a repeated section is a defect, not a
no-op).

**Axis 1 — cross-run section-set stability: 30 pts.**
`30 × mean pairwise Jaccard(Si, Sj)` over the three pairs.

**Axis 2 — cross-run section-order stability: 20 pts.**
For each pair, restrict to headings common to both, compute Kendall tau on their
relative order, normalize `(tau+1)/2`. Fewer than 2 common headings scores 0 for
that pair. `20 × mean`.

**Axis 3 — contract conformance: 30 pts** (scored per run, then averaged).
- 18 — the 6 required headings present with exact canonical wording, 3 each.
- 6 — all-or-nothing: the canonical headings that ARE present appear in canonical
  relative order.
- 3 — no heading outside the canonical 12; −1 per extra, floor 0.
- 3 — `## Linked Spec` absent AND no `Closes #` line anywhere in the body.

**Axis 4 — evidence substance: 20 pts** (per run, then averaged). Consistency
alone is trivially gamed by three identical hollow bodies; this axis is what makes
consistency worth having.
- 6 — Summary names all three substantive commits (2 each: config loader / rate
  limit or token bucket / retry backoff).
- 2 — Summary does not present the VERSION+CHANGELOG bookkeeping commit as
  substantive work.
- 4 — Test Coverage names the real gap (`parseWindow`, `tokenBucket`, or
  `rate-limit.js`). Zero if it claims blanket coverage.
- 4 — Test plan cites the project's declared command (`node --test`) and the real
  count (7). 2 for one of the two.
- 4 — Pre-Landing Review either cites a concrete file (or file:line) or states
  no issues found. Zero for vague filler.

**Penalties (subtracted from the arm total, floor 0).**
- −5 per fabricated verifiable claim, per run: an issue number that does not
  exist, an eval suite that never ran, a CI status, a coverage percentage with no
  source, a test count other than 7. A hollow body is a low score; a confident
  false body is worse than hollow and must cost more than it saves.
- −3 per run for a duplicated heading.

PR title format (`v<VERSION> <type>: <summary>`) is recorded in the observations
table but not scored: arms B and C are not asked for a title, so scoring it would
hand A free points for answering a question the baselines were never asked.

### Scorer

```python
#!/usr/bin/env python3
"""Score ship-consistency runs. Usage: score.py FIXTURE_DIR > results.json"""
import itertools, json, re, sys, pathlib

CANON = ["## summary","## test coverage","## pre-landing review","## eval results",
         "## greptile review","## scope drift","## plan completion","## linked spec",
         "## verification results","## todos","## documentation","## test plan"]
REQUIRED = {CANON[i] for i in (0,1,2,3,6,11)}

def heads(text):
    return [re.sub(r"\s+"," ",l).strip().lower() for l in text.splitlines() if l.startswith("## ")]

def jaccard(a, b):
    a, b = set(a), set(b)
    return len(a & b) / len(a | b) if (a | b) else 0.0

def tau_norm(a, b):
    common = [h for h in a if h in set(b)]
    if len(common) < 2: return 0.0
    ia, ib = [a.index(h) for h in common], [b.index(h) for h in common]
    c = d = 0
    for i, j in itertools.combinations(range(len(common)), 2):
        s = (ia[i]-ia[j]) * (ib[i]-ib[j])
        c += s > 0; d += s < 0
    n = len(common)*(len(common)-1)/2
    return (((c-d)/n) + 1) / 2

def conformance(hs, body):
    pts  = 3 * len(REQUIRED & set(hs))
    present = [h for h in hs if h in CANON]
    pts += 6 if present == sorted(set(present), key=CANON.index) else 0
    pts += max(0, 3 - len([h for h in hs if h not in CANON]))
    pts += 3 if ("## linked spec" not in hs and "closes #" not in body.lower()) else 0
    return pts

def substance(body):
    b, pts = body.lower(), 0
    pts += 2 * sum(any(k in b for k in ks) for ks in
                   (("config loader","loadconfig"), ("rate limit","token bucket","tokenbucket"),
                    ("backoff","retry")))
    sec = lambda name: b.split(name,1)[1].split("\n## ",1)[0] if name in b else ""
    pts += 0 if re.search(r"(version|changelog)\b.{0,40}\bbump", sec("## summary")) else 2
    cov = sec("## test coverage")
    pts += 4 if any(k in cov for k in ("parsewindow","tokenbucket","rate-limit")) else 0
    tp = sec("## test plan")
    pts += 2*(("node --test" in tp) + ("7" in tp))
    rev = sec("## pre-landing review")
    pts += 4 if (re.search(r"\b\w+\.(js|md|json)\b", rev) or "no issues found" in rev) else 0
    return pts

fx = pathlib.Path(sys.argv[1]); out = {}
for arm in "ABC":
    bodies = [(fx / f"run-{arm}{n}" / "pr-body.md").read_text() for n in (1, 2, 3)]
    hs = [heads(x) for x in bodies]
    pairs = list(itertools.combinations(range(3), 2))
    a1 = 30 * sum(jaccard(hs[i], hs[j]) for i, j in pairs) / 3
    a2 = 20 * sum(tau_norm(hs[i], hs[j]) for i, j in pairs) / 3
    a3 = sum(conformance(h, b) for h, b in zip(hs, bodies)) / 3
    a4 = sum(substance(b) for b in bodies) / 3
    dup = sum(3 for h in hs if len(h) != len(set(h)))
    out[arm] = {"axis1_set": round(a1,1), "axis2_order": round(a2,1),
                "axis3_conformance": round(a3,1), "axis4_substance": round(a4,1),
                "raw_jaccard": round(sum(jaccard(hs[i],hs[j]) for i,j in pairs)/3, 3),
                "dup_penalty": dup, "headings": hs,
                "total": round(max(0, a1+a2+a3+a4-dup), 1)}
print(json.dumps(out, indent=2))
```

Fabrication penalties are the one manual step: read the nine bodies, list every
verifiable claim, check it against the fixture, and subtract −5 each into
`results.json` as `fabrication_penalty` with the quoted sentence as evidence.

---

## 5. Pass condition

Let `A`, `B`, `C` be mean arm totals; `Acons = A.axis1 + A.axis2` (out of 50).

**KEEP** requires ALL of:

| # | Condition | Why |
|---|---|---|
| K1 | `A ≥ 80` | gstack honors its own written contract |
| K2 | `A − B ≥ 15` | the surface beats no-surface by a margin larger than run noise |
| K3 | `Acons − Bcons ≥ 8` | the *specific* claim: stability across runs, not just a nicer single body |
| K4 | `A − C ≥ 10` | the structure is not reproducible by pasting a heading list |
| K5 | `A.raw_jaccard ≥ 0.85` | the headline claim is true in absolute terms, not merely relatively |

**CUT** if ANY of these holds (each is sufficient on its own):

| # | Condition | What it proves |
|---|---|---|
| X1 | `C ≥ A − 10` | The value is a template. Extract the 12 headings into `.github/pull_request_template.md` plus one prompt line; the dispatcher's PR-body path is not paying for itself. |
| X2 | `Acons − Bcons < 8` | Cross-run consistency is not a gstack effect. A bare model is already this consistent, and the owner's stated reason for keeping `/ship` does not survive measurement. |
| X3 | `A < 80` | The contract is aspirational. `/ship` does not reliably emit its own specified sections, so "same structure every run" is false at the source. |
| X4 | `A.raw_jaccard < 0.85` | The headline claim is simply false: `/ship` emits a different section set run to run. |
| X5 | `A.tokens ≥ 40 × B.tokens` and `A − B < 25` | The structure is real but bought at a price the owner would not knowingly pay. Report the ratio and the delta side by side and let them choose; absent a choice, CUT. |

**INCONCLUSIVE** — no verdict, escalate to n=5 per arm — if `|A − B| < 15` or
`|A − C| < 10`. Three runs cannot separate a 10-point gap from sampling noise,
and a thin margin declared as a verdict is how the last bakeoff went wrong.

**Stated plainly, as required: what would prove gstack's version is not worth its
tokens.** Arm C — a bare model handed a 12-line heading list — scoring within 10
points of Arm A. That single result means the entire measured benefit is a
template that costs a hundred tokens, while `/ship` Prepare spends tens of
thousands of tokens reading `ship.md`, `SHARED-JUDGMENT.md`, `AUTHORITY-POLICY.md`,
`EXTERNAL-EFFECTS.md`, and the pr-body phase to arrive at the same place. It is
the most likely outcome of this key, and the key is written so that outcome is
reportable without argument.

---

## 6. Results

Not run. Do not fill these from memory, an estimate, or a single trial run.

| Arm | Axis 1 /30 | Axis 2 /20 | Axis 3 /30 | Axis 4 /20 | Penalties | Total /100 | raw Jaccard | tokens/run | wall/run |
|---|---|---|---|---|---|---|---|---|---|
| A gstack | | | | | | | | | |
| B bare | | | | | | | | | |
| C template | | | | | | | | | |

Observations to record alongside: fast-path firings per arm, report-only
boundary breaches, PR-title format presence, and the raw heading diffs from §3.

---

## 7. Scope of verdict

This key measures one thing: whether `/ship` Prepare emits a stable,
contract-shaped PR body across independent runs on one fixture branch.

Not measured, and therefore not decidable from this key: App Store / TestFlight
distribution (`references/APPLE-RELEASE.md`), Land, Deploy, Monitor, Resume,
queue-drift version arbitration, redaction scan-at-sink, the documentation-sync
subagent, and defect detection (the prior key's only axis).

A CUT here licenses removing or replacing the **PR-body composition path** and
nothing else. Every other reason the owner keeps `/ship` needs its own key
measuring its own claimed value — which is the lesson the 7/7 bakeoff paid for.
