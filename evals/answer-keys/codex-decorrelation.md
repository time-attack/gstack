# Answer key: does a second model family catch what Claude misses

**Surface under test:** the cross-model outside voice in `/review` Deep mode
(`skills/review/references/legacy/codex.md`), invoked through
`skills/review/SKILL.md` Deep. Nothing else in `/review` is on trial here.

**The claim being tested (the surface's own claim, verbatim from the dispatcher):**
Deep "adds health evidence and an independent cross-model second opinion", the
outside voice "is genuinely a different model, never this one re-reading its own
work", codex output is "present[ed] faithfully, not summarized", and the module
emits a `CROSS-MODEL ANALYSIS` block naming what only codex found and what only
Claude found. That is a decorrelation claim plus a transmission claim. Both get
scored.

**Why this key exists.** The three-arm `/ship` bakeoff returned CUT off a key
that only asked "did the arm catch 7 planted defects". All arms scored 7/7, the
key had a ceiling, and a tie got read as "no differentiated value" and
generalized to a surface whose real value (structural consistency, App Store
capability) was never measured. This key does not repeat that: it pre-registers
a ceiling-void rule, it measures the claimed mechanism rather than raw recall,
and it scopes its own verdict.

**Scope of any verdict this key can produce.** KEEP/CUT here applies to the
codex outside voice inside Deep, and to nothing else. This key does not measure
health evidence, module routing, mutation-boundary discipline, FP calibration in
non-Deep modes, or `/review` Normal. A CUT here means "drop the codex step",
never "drop `/review`".

---

## 1. Fixture

Reuse `test/fixtures/review-precision/` (already has the git-history builder, a
10-seed false-positive suite, and 4 planted true positives) and extend it with a
harder tier. Create `test/fixtures/review-decorrelation/` containing:

```
base/            -> copy of review-precision/base       (unchanged, committed on main)
feature/         -> copy of review-precision/feature     (unchanged, the FP suite + TP-1..TP-4)
feature-hard/    -> NEW files listed in section 2, overlaid on the same feature commit
answer-key.json  -> review-precision/answer-key.json + the H1..H6 block from section 2
```

Repo construction is exactly the `beforeAll` in
`test/skill-e2e-review-precision.test.ts`: `git init -b main`, commit `base/`,
`git checkout -b feature/billing-and-search`, copy `feature/` **and**
`feature-hard/`, one commit. Diff scope for every arm is `git diff main...HEAD`.
`base/rentals/status.py` stays untouched, so cross-file defects require reading
outside the diff.

Three defect tiers, all pre-registered and frozen before the first run:

| Tier | IDs | Source | Role |
|---|---|---|---|
| Floor | TP-1..TP-4 | existing `answer-key.json` `planted_bugs` | every arm should get these; a miss indicts the arm, not the key |
| Hard | H1..H6 | section 2 | where decorrelation, if real, shows up |
| FP suite | FP-1..FP-10 | existing `answer-key.json` `fp_seeds` | precision control; a second voice that just reports more is not a second voice |

---

## 2. The hard tier (exact defects)

Six defects, six distinct failure mechanisms, each a real bug a competent
reviewer can prove from the repo. No defect is pre-assigned an expected winner.
Every one of these is either a cross-file invariant or a low-salience
correctness bug, because the single-file high-salience classes (injection,
None-crash) are already the floor tier and already saturate.

New file `feature-hard/billing/refunds.py`:

```python
from .models import Invoice, Refund


def issue_refund(invoice, amount_dollars, reason=""):
    """Record a refund against an issued invoice. Amount arrives in dollars."""
    if not invoice.issued:
        raise ValueError("cannot refund an unissued invoice")
    return Refund.objects.create(
        invoice=invoice, amount_cents=amount_dollars, reason=reason
    )


def refunded_total(invoice):
    """Sum of refunds on this invoice, excluding voided refunds."""
    rows = Refund.objects.filter(invoice=invoice)
    return sum(row.amount_cents for row in rows)


def net_billed(invoice):
    return invoice.amount_cents - refunded_total(invoice)
```

New file `feature-hard/billing/periods.py`:

```python
import datetime

from .models import Invoice


def next_period(period_start, period_end):
    """Advance to the following billing period (periods are end-inclusive)."""
    length = (period_end - period_start).days
    return period_start + datetime.timedelta(days=length), period_end + datetime.timedelta(days=length)


def overlapping_invoices(rental, period_start, period_end):
    return Invoice.objects.filter(
        rental=rental, period_start__lte=period_end, period_end__gte=period_start
    ).exists()
```

New file `feature-hard/billing/reconcile.py`:

```python
from django.db import IntegrityError, transaction

from .models import Invoice, LedgerEntry


@transaction.atomic
def reconcile_period(rental, period_start, period_end, amount_cents):
    invoice = Invoice(rental=rental, period_start=period_start, period_end=period_end)
    try:
        invoice.save()
    except IntegrityError:
        invoice = Invoice.objects.get(
            rental=rental, period_start=period_start, period_end=period_end
        )
    LedgerEntry.objects.create(invoice=invoice, amount_cents=amount_cents)
    return invoice
```

New file `feature-hard/billing/exports.py`:

```python
from .models import Invoice


def export_page(offset, page_size=50):
    """Stable pages for the finance CSV export job."""
    rows = Invoice.objects.all().order_by("period_start")[offset : offset + page_size]
    return [{"id": r.id, "amount_cents": r.amount_cents} for r in rows]


def invoice_for_export(invoice_id):
    return Invoice.objects.get(id=invoice_id)
```

Append to `feature-hard/rentals/status.py` consumers by adding
`feature-hard/rentals/handoff.py`:

```python
from .status import BADGE_CLASSES
from .models import Rental


def handoff_summary(rental_id):
    rental = Rental.objects.get(id=rental_id)
    label = BADGE_CLASSES.get(rental.status, "badge-unknown")
    Rental.objects.filter(id=rental_id).update(status="handed_off")
    return {"id": rental.id, "badge": label}
```

Defect table (goes into `answer-key.json` as `hard_bugs`, same schema as
`planted_bugs`):

| ID | Mechanism | File | Anchor | The bug | `match` regex |
|---|---|---|---|---|---|
| H1 | unit/scale error across a module boundary | `billing/refunds.py` | `amount_cents=amount_dollars` | dollars stored into a cents column; every refund is 100x too small, and `net_billed` silently over-reports revenue | `dollar\|cents\|unit\|100\|scale\|conver` |
| H2 | docstring contradicts code | `billing/refunds.py` | `rows = Refund.objects.filter(invoice=invoice)` | docstring promises "excluding voided refunds"; the query excludes nothing, and `Refund` has no void concept, so either the doc or the model is wrong | `docstring\|comment\|void\|contradict\|excl\|document` |
| H3 | ORM protocol misuse on the error path | `billing/reconcile.py` | `except IntegrityError:` | catching `IntegrityError` inside `@transaction.atomic` without a nested `atomic` block leaves the transaction broken; the following `LedgerEntry.objects.create` raises `TransactionManagementError`, so every insert-race loses the ledger row | `atomic\|transactionmanagement\|savepoint\|nested\|broken transaction\|rollback` |
| H4 | inclusive/exclusive boundary drift | `billing/periods.py` | `length = (period_end - period_start).days` | periods are documented end-inclusive, so the advance is one day short; `next_period` returns a range that overlaps the previous one, and `overlapping_invoices` (correctly inclusive) then blocks legitimate billing | `off.?by.?one\|inclusiv\|exclusiv\|\\+ ?1\|overlap\|boundar\|days` |
| H5 | authorization narrowing lost in an unchanged consumer | `billing/exports.py` | `def invoice_for_export(invoice_id)` | unscoped `Invoice.objects.get(id=...)`; reachable from the site-scoped API surface, so a manager can fetch another site's invoice by id. Requires tracing the unchanged `billing/api.py` consumer | `scope\|idor\|authoriz\|tenant\|site\|objects\.get\|permission\|leak` |
| H6 | non-unique ordering under pagination | `billing/exports.py` | `order_by("period_start")` | `period_start` is not unique, so paged export drops and duplicates rows between pages; the finance CSV is silently wrong | `order_by\|non.?unique\|tiebreak\|pagina\|duplicate\|stable\|deterministic` |

`handoff.py` is a decoy-and-anchor: it is correct (the `.get()` default handles
the unmapped status, the `update()` is a single statement). It goes in the FP
list as FP-11 so the hard tier does not become "flag everything new".

Matching rule is inherited from the existing runner: a defect counts as caught
only when a finding cites the file, lands within 15 lines of the anchor, and its
text matches the regex. Anything else is an unplanted finding and goes to
adjudication (section 4).

---

## 3. Arms

Five arms. All report-only, all hermetic (`test/helpers/hermetic-env.ts`, fresh
`CLAUDE_CONFIG_DIR`, temp `GSTACK_HOME`), all on the same fixture repo, all
handed the identical harness-constraints preamble from
`test/skill-e2e-review-precision.test.ts` (non-interactive, mutation NONE, no
remote, write the complete report to `$REPORT`, one finding per line in
`[SEVERITY] (confidence: N/10) file:line — description`).

| Arm | Configuration | What it isolates |
|---|---|---|
| A1 | `/code-review ultra` (host command, verified fleet). No gstack skills in `CLAUDE_CONFIG_DIR`. Findings read from the `ReportFindings` tool input, not prose. | Claude reviewing Claude, at the strongest setting Claude has |
| A2 | gstack `/review` Deep, codex CLI on PATH and authed from `~/.codex` | the shipped claim |
| A3 | gstack `/review` Deep, codex removed from PATH (module hits `NOT_FOUND`) | is the gain the second family, or the rest of Deep? |
| A4 | **null control.** A1 run twice with independent seeds, findings unioned | is the gain decorrelation, or just variance? Cost-matched to A2 |
| A5 | raw `codex review` with no gstack (the exact invocation from `codex.md` step 1, `model_reasoning_effort="high"`) | what codex knows before gstack touches it |

A4 is the arm that makes this key falsifiable. Two independent samples from one
model family also union to more than one sample. Any "codex found things Claude
missed" number that A4 matches is variance wearing a second family's clothes.

**n = 3 seeds per arm** (A4 consumes 2 A1 runs per seed, so 3 extra A1 runs).
18 runs total. Budget at the observed review-precision per-run cost; if that
exceeds the paid-eval ceiling, drop to n = 3 for A1/A2/A4 and n = 2 for A3/A5
and record the reduced n in the results file. Never n = 1: a variance claim
cannot be tested with one sample.

**Pre-registered normalizations** (fixed now so they cannot become post-hoc
knobs):

- Shown-finding bar is confidence >= 7, matching the existing FP bar.
- A1/A4 `ReportFindings` has no confidence field: `verdict: CONFIRMED` maps to 8,
  `PLAUSIBLE` maps to 6, absent verdict maps to 8. Findings below the bar are
  scored only in the suppressed-appendix column, never in recall.
- A5 emits prose. Its findings are extracted by the same
  `parseReviewFindings` grammar after a mechanical pass that assigns confidence
  8 to `[P1]`/`[P2]` markers and 6 to `[P3]`, per `codex.md`'s own severity
  scheme.
- Runs that fail infrastructurally (auth error, timeout 124, empty output) are
  re-run once, then recorded as VOID for that seed. A VOID does not count as a
  miss.

---

## 4. Adjudication of unplanted findings

Planted-only scoring is how the `/ship` key over-generalized. Every
confidence>=7 finding not matched to TP/H/FP goes through blind adjudication:

1. Pool all findings from all arms and seeds. Strip arm labels, run ids, prose
   style tells, and shuffle.
2. Each finding is adjudicated TRUE (a real defect provable from the fixture),
   FALSE (the code is correct as written), or UNVERIFIABLE (needs runtime state
   the fixture does not have).
3. Adjudicator is a model from a third family with repo read access, plus human
   tiebreak on any finding where two adjudication passes disagree. Record both
   passes.
4. TRUE unplanted findings enter the union and exclusivity sets exactly like
   planted ones. FALSE ones count against precision. UNVERIFIABLE ones are
   dropped from both.

Deduplication across arms is by (file, defect mechanism), not by wording. Two
findings that name the same root cause at the same site are one defect.

---

## 5. Scoring

Per run: floor recall (0-4), hard recall (0-6), FP count on FP-1..FP-11,
unplanted TRUE count, unplanted FALSE count, total tokens, wall clock.

Per arm: median of the per-run numbers, plus the **union set** across that arm's
seeds (the set of adjudicated true defects the arm caught in at least one seed).

Family attribution, computed on union sets so single-run variance cannot fake it:

```
claude_found(d) = d in union(A1)          # includes A4 by construction
codex_found(d)  = d in union(A5)
X_c = { d : codex_found(d)  and not claude_found(d) }   # codex-exclusive
X_a = { d : claude_found(d) and not codex_found(d) }    # Claude-exclusive
G   = |union(A2)| - |union(A4)|                          # gain over the null control
T   = |X_c ∩ shown(A2)| / |X_c|                          # transmission fidelity
```

Axes, one number each:

| # | Axis | Metric | Target |
|---|---|---|---|
| 1 | Bidirectional decorrelation | `|X_c|`, `|X_a|` | `|X_c| >= 2` and `|X_a| >= 1` |
| 2 | Gain over the null control | `G` | `>= +2` adjudicated true defects |
| 3 | Precision not purchased | FP(A2) - FP(A4) | `<= +1` |
| 4 | Transmission fidelity | `T` | `>= 0.80` |
| 5 | Attribution of the gain | `|union(A2)| - |union(A3)|` | `>= +2` |
| 6 | Wrapper is not net-negative | `|union(A2)| - |union(A5)|` and FP(A2) - FP(A5) | `>= 0` and `<= 0` |
| 7 | Cross-model honesty | fabricated entries in A2's `CROSS-MODEL ANALYSIS` "Only Codex found" list, where fabricated = a claimed codex-only finding absent from that run's captured codex output | `0` in at least 2 of 3 runs |
| 8 | Floor sanity | floor recall, every arm | `>= 3/4` median |
| 9 | Cost | tokens(A2) / tokens(A1), wall clock | reported, not gated. Feeds the worth-its-tokens read in section 7 |

Axis 7 needs the raw codex output captured, so A2 runs with the module's JSONL
path and the harness archives the codex stdout alongside the report. Without
that capture axis 7 is unscorable and the run is VOID.

---

## 6. Validity gates (checked before any verdict)

Pre-registered, because a ceiling and a floor both produce meaningless ties.

- **Ceiling void.** If every arm's median is 6/6 hard and 4/4 floor with FP <= 1,
  the hard tier is too easy. The result is VOID, not a tie, and not evidence of
  no differentiation. Re-plant harder and re-run.
- **Floor void.** If the best arm scores < 2/6 on the hard tier, the defects are
  underspecified or unfair. VOID, fix the fixture, re-run.
- **Adjudication void.** If more than 30% of unplanted findings land
  UNVERIFIABLE, the fixture is too thin to adjudicate against. VOID.
- **Infrastructure void.** If A5 or A2 loses more than one seed to codex auth or
  timeout, the codex arm is not being measured. Fix and re-run.

---

## 7. Pass condition

**KEEP the codex outside voice** iff all of: axis 1, axis 2, axis 3, axis 4,
axis 5, axis 6, axis 7 hit target, and no validity gate voided the run.

That conjunction is the point. Decorrelation has to exist (1), it has to beat
sampling the same family twice at the same cost (2, 3), gstack has to actually
deliver it to the user (4), it has to come from the second family rather than
the rest of Deep (5), and the wrapper has to not lose what codex handed it (6, 7).

**CUT** on any of the following. Each is stated as the concrete result that
proves the codex step is not worth its tokens:

| Result | Reading | Action |
|---|---|---|
| `|X_c| <= 1` | Claude's verified fleet already sees what codex sees on this corpus. The second family adds no blind-spot coverage. | CUT the codex step. Ship Deep without it. |
| `G <= 0` | A1 run twice unions to as much as A1+codex. The "decorrelated blind spots" were run-to-run variance. Cheaper to sample Claude twice. | CUT. Replace the outside voice with a second independent Claude pass. |
| `FP(A2) - FP(A4) > +1` while `G >= +2` | The extra defects were bought with extra false positives. A reviewer that cries wolf gets ignored, so this is not a win. | CUT unless the FP delta is entirely UNVERIFIABLE-class, which must be shown per finding. |
| `T < 0.80` | Codex finds defects and gstack's report does not show them. The pipeline destroys the value it pays for. | Fix transmission in `codex.md`, re-run once. Still `< 0.80` after the fix: CUT. |
| `|union(A2)| - |union(A3)| < +2` | The gain is Deep's own apparatus, not the second family. | CUT the codex dependency specifically. Keep Deep. |
| `|union(A5)| > |union(A2)|` or `FP(A2) > FP(A5)` | gstack is a net-negative wrapper on codex. | CUT the wrapper. Tell users to run `codex review`. |
| fabricated cross-model entries in >= 2 of 3 A2 runs | The `CROSS-MODEL ANALYSIS` block is theater. It invents attributions the codex output does not support. | CUT the block regardless of every recall number. A dishonest summary is worse than no summary. |
| `|X_a| = 0` | Claude found nothing codex missed. Then the honest configuration is codex alone, not both. | CUT the Claude-side review in Deep, not the codex step. Inverse verdict, still a cut. |

Both directions are live. Axis 1 can fail by `X_c` being empty (codex adds
nothing) or by `X_a` being empty (Claude adds nothing), and each has its own
cut. There is no arm assignment or threshold in this key that gstack wins by
default: A4 costs the same as A2 and needs no second vendor, so gstack has to
beat a strictly cheaper configuration on its own claimed mechanism.

---

## 8. Runnable spec

Files to create (this key writes none of them):

- `test/fixtures/review-decorrelation/` per section 1, `answer-key.json`
  extended with `hard_bugs` (section 2) and FP-11.
- `test/skill-e2e-review-decorrelation.test.ts`: five arm runners over the same
  `beforeAll` repo builder as `test/skill-e2e-review-precision.test.ts`. A2/A3
  install `skills/review` into the per-test `CLAUDE_CONFIG_DIR` and prompt
  `/review` with `Depth: deep` stated in the harness constraints. A1/A4 install
  nothing and invoke `/code-review ultra`. A3 prepends a PATH shim directory
  that shadows `codex`. A5 shells `codex review` directly through the codex
  runner in `test/helpers/codex-session-runner.ts`. Archive per run: report
  file, `ReportFindings` inputs, codex stdout/JSONL, token counts, wall clock.
- `scripts/decorrelation-score.ts`: reads the archived runs, applies section 5
  formulas, prints the axis table plus KEEP/CUT/VOID and which row fired.
- `test/helpers/touchfiles.ts`: add
  `'review-decorrelation': ['skills/review/**', 'test/fixtures/review-decorrelation/**', 'test/skill-e2e-review-decorrelation.test.ts', 'test/helpers/codex-session-runner.ts']`
  and classify it `periodic` (multi-arm, external vendor CLI, non-deterministic).

Run it:

```bash
export ANTHROPIC_API_KEY=...          # codex uses its own ~/.codex auth
bun run eval:bg:periodic              # or: EVALS_TIER=periodic bun test test/skill-e2e-review-decorrelation.test.ts
bun run scripts/decorrelation-score.ts ~/.gstack-dev/evals/<runId>
```

Results land in `evals/answer-keys/results/codex-decorrelation-<date>.json`, with
the per-arm union sets and the adjudication ledger recorded verbatim so the
verdict is re-derivable without re-running the models.
