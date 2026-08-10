# Answer key: `/review` vs native `/code-review` — defect axis

**Question under test.** Does gstack `/review` catch defects that native
`/code-review` misses, and is the differential worth the token bill?

**Status.** Pre-registration. Written before any arm has run. Frozen once the
first run starts (see [Pre-registration](#pre-registration-and-anti-gaming)).

**Verdict scope — read this before quoting any number from this key.**
This key measures ONE axis: defect detection on a branch diff, and the
fabrication rate that comes with it. It licenses a verdict about that axis and
nothing else. It does **not** measure `/review`'s other claimed value:

| `/review` claim | Measured here? |
|---|---|
| Finds defects a native reviewer misses | **yes — this key** |
| Fabrication suppression (pre-emit verification gate, #1539) | **yes — this key** |
| Cost per defect | **yes — this key** |
| Cross-model outside voice is genuinely independent | no |
| `health.md` repo-health evidence | no |
| Fix-first: AUTO-FIX vs ASK, mutation boundary held under pressure | no |
| Scope-drift + plan-completion audit (Step 1.5) | no |
| Cross-review dedup / calibration learning across runs | no |

A CUT from this key cuts the **defect-detection justification for `/review`**.
It does not cut the skill. The `/ship` bakeoff failed exactly here: it measured
7 planted defects, all arms tied 7/7, and the CUT was generalized to a surface
whose real value was structural consistency and App Store capability — neither of
which the key had measured. Do not repeat that. Any writeup citing this file must
carry the table above verbatim.

---

## 1. Fixture

Extends the existing corpus at `test/fixtures/review-precision/` (Django 4.2 +
DRF 3.15 site-rental app). Reuse its harness verbatim: `base/` is committed on
`main`, `feature/` is overlaid and committed on `feature/billing-and-search`,
review scope is `git diff main...HEAD`. See
`test/skill-e2e-review-precision.test.ts` for the git/setup mechanics and
`test/fixtures/review-precision/answer-key.json` for the inherited seeds.

Inherited, unchanged:

- **11 false-positive seeds** in `billing/models.py`, `services.py`, `forms.py`,
  `api.py`, `serializers.py`, `admin.py` — suspicious-looking code that is
  correct, with the guard visible in 1–2 files.
- **4 pattern-matchable true positives** TP-1…TP-4: SQL injection
  (`rentals/views.py`), enum completeness (`rentals/models.py` +
  unchanged `rentals/status.py`), `None`-crash on an optional param
  (`rentals/reports.py`), lost-update race (`rentals/deposits.py`).

This key adds **two judgment defects**. Both are invisible to per-hunk pattern
matching: the defect lives in the relationship between a changed file and an
unchanged one.

### 1.1 New base files (committed on `main`, NOT in the diff)

`base/config/settings.py`

```python
SECRET_KEY = "dev-only"
ROOT_URLCONF = "config.urls"
INSTALLED_APPS = ["django.contrib.auth", "django.contrib.contenttypes", "rest_framework", "rentals"]
MIDDLEWARE = [
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "config.middleware.SessionAuthRequiredMiddleware",
]
# Prefixes that skip SessionAuthRequiredMiddleware. Senders sign their payloads;
# each exempt view verifies the signature itself.
AUTH_EXEMPT_PREFIXES = ["/healthz", "/webhooks/"]
REST_FRAMEWORK = {"DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"]}
```

`base/config/middleware.py`

```python
from django.conf import settings
from django.http import JsonResponse


class SessionAuthRequiredMiddleware:
    """Site-wide 401 for anonymous requests, except AUTH_EXEMPT_PREFIXES."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        exempt = any(request.path.startswith(p) for p in settings.AUTH_EXEMPT_PREFIXES)
        if not exempt and not request.user.is_authenticated:
            return JsonResponse({"detail": "authentication required"}, status=401)
        return self.get_response(request)
```

`base/config/urls.py`

```python
from django.urls import include, path

urlpatterns = [
    path("healthz", lambda r: __import__("django").http.JsonResponse({"ok": True})),
    path("rentals/", include("rentals.urls")),
]
```

`base/rentals/importers.py`

```python
import csv

from .models import Rental


def import_legacy_csv(site, fh):
    """Nightly ops import. The legacy export has no external ref column, so
    every row imported this way keeps the model default for external_ref."""
    rows = [
        Rental(site=site, equipment_name=r["equipment"], deposit_cents=int(r["deposit"]))
        for r in csv.DictReader(fh)
    ]
    return Rental.objects.bulk_create(rows)
```

`base/rentals/migrations/0001_initial.py` — ordinary initial migration for
`Site` and `Rental` (fields as in `base/rentals/models.py`). Content is not
load-bearing; it exists so migration `0002` has a parent.

**Add these two lines to the `Rental` model in BOTH `base/rentals/models.py`
and `feature/rentals/models.py`, identically**, so the field does not appear in
the diff:

```python
    # Set by the API; blank for anything imported by import_legacy_csv.
    external_ref = models.CharField(max_length=64, blank=True, default="")
```

### 1.2 New feature files (in the diff)

`feature/billing/permissions.py`

```python
from rest_framework import permissions


def require_billing_role(role):
    """Tag a view with the billing role it needs.

    Enforcement lives in BillingRolePermission, which reads the tag. This
    decorator only annotates; it does not check anything by itself.
    """

    def decorate(fn):
        fn.required_billing_role = role
        return fn

    return decorate


class BillingRolePermission(permissions.BasePermission):
    def has_permission(self, request, view):
        needed = getattr(getattr(view, "fn", None), "required_billing_role", None)
        if needed is None:
            return True
        return bool(request.user and request.user.is_authenticated
                    and request.user.groups.filter(name=needed).exists())
```

`feature/billing/views_refund.py`

```python
import json

from django.http import JsonResponse

from .models import Invoice
from .permissions import require_billing_role


@require_billing_role("billing-admin")
def refund_invoice(request):
    """Refund an invoice and write the reversing ledger entry."""
    body = json.loads(request.body or "{}")
    invoice = Invoice.objects.get(pk=body["invoice_id"])
    amount = int(body.get("amount_cents") or invoice.total_cents)
    invoice.refunded_cents = (invoice.refunded_cents or 0) + amount
    invoice.save(update_fields=["refunded_cents"])
    return JsonResponse({"invoice": invoice.pk, "refunded_cents": amount})
```

(Add `refunded_cents = models.IntegerField(default=0)` to `Invoice` in
`feature/billing/models.py`.)

`feature/billing/urls_internal.py` — the decoy: the same view, correctly guarded.

```python
from rest_framework.decorators import api_view, permission_classes
from rest_framework.urls import path  # noqa: F401  (kept for parity with legacy modules)
from django.urls import path

from .permissions import BillingRolePermission
from .views_refund import refund_invoice

guarded_refund = api_view(["POST"])(permission_classes([BillingRolePermission])(refund_invoice))

urlpatterns = [path("refund", guarded_refund, name="internal-refund")]
```

`feature/billing/urls_webhook.py`

```python
from django.urls import path

from .views_refund import refund_invoice

urlpatterns = [path("billing/refund", refund_invoice, name="webhook-refund")]
```

`feature/config/urls.py`

```python
from django.urls import include, path

urlpatterns = [
    path("healthz", lambda r: __import__("django").http.JsonResponse({"ok": True})),
    path("rentals/", include("rentals.urls")),
    path("internal/", include("billing.urls_internal")),
    path("webhooks/", include("billing.urls_webhook")),
]
```

`feature/rentals/migrations/0002_rental_external_ref_unique.py`

```python
from django.db import migrations, models


def dedupe_external_ref(apps, schema_editor):
    Rental = apps.get_model("rentals", "Rental")
    seen = set()
    for rental in Rental.objects.order_by("pk").iterator():
        key = rental.external_ref
        if key in seen:
            Rental.objects.filter(pk=rental.pk).delete()
        else:
            seen.add(key)


class Migration(migrations.Migration):
    dependencies = [("rentals", "0001_initial")]
    operations = [
        migrations.RunPython(dedupe_external_ref, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="rental",
            name="external_ref",
            field=models.CharField(max_length=64, blank=True, default="", unique=True),
        ),
    ]
```

### 1.3 The two judgment defects

**JP-1 — handler looks protected, route is unauthenticated.**
`refund_invoice` carries `@require_billing_role("billing-admin")`. That
decorator only sets an attribute; enforcement is `BillingRolePermission`, which
runs only on the DRF-wrapped mount in `urls_internal.py`. The same plain
function is also mounted under `/webhooks/`, which
`base/config/settings.py:AUTH_EXEMPT_PREFIXES` excludes from
`SessionAuthRequiredMiddleware`. Result: `POST /webhooks/billing/refund` refunds
any invoice, unauthenticated, with no signature check anywhere in the view
despite the settings comment promising one.

Catching it requires three files, two of them different reads: the handler
(looks protected), the decorator body (inert alone), and the mount plus the
unchanged middleware allowlist. A reviewer that reads the decorator name and
stops concludes the endpoint is admin-only. The correctly-guarded
`urls_internal.py` mount in the same diff is a deliberate decoy.

**JP-2 — migration destructive only given existing data.**
`external_ref` is not in the diff; only the migration is. On an empty database
(CI, a fresh dev box, `migrate` on a new deploy target) `dedupe_external_ref`
deletes zero rows and the unique constraint applies cleanly — fully green. On
any database that ran `import_legacy_csv`, every imported row shares
`external_ref == ""`, so the loop deletes all but one of them: silent,
irreversible destruction of production rentals, sized by how much legacy data
exists. `RunPython.noop` as the reverse means there is no rollback.

Catching it requires reading unchanged base code (`importers.py` leaves the
field blank; the model default is `""`) and reasoning about data state that the
diff cannot show. "There is a `.delete()` in a migration" is not a catch — see
the scoring rule in §3.2.

**Total answer key: 6 defects.** TP-1…TP-4 (pattern), JP-1 and JP-2 (judgment),
plus 11 FP seeds that must not be flagged.

---

## 2. Arms

Four arms, same fixture, same repo state, same pinned model, `n = 3` runs each
(12 runs). Non-determinism is the whole reason for `n = 3`; single runs do not
score.

| Arm | Invocation | Notes |
|---|---|---|
| **A0 — nothing** | Bare prompt, no skill, no slash command: `Review the diff on this branch against main and report every defect you find.` | Control. Measures the model, not the harness. |
| **A1 — code-review high** | `/code-review high` | Native. Record the `level` it reports to `ReportFindings`. |
| **A2 — code-review ultra** | `/code-review ultra` | Native. Record the reported `level` (expect `xhigh`/`max`); do not assume the mapping, log what happened. |
| **A3 — gstack /review Deep** | `/review` with `Depth: deep` requested in the prompt | Canonical-install profile: `skills/review/` copied into a fresh `CLAUDE_CONFIG_DIR`, **no `bin/gstack` runtime** — what `npx skills add time-attack/gstack/skills` actually gives a user. |

Environment: reuse the hermetic setup in
`test/skill-e2e-review-precision.test.ts` (`buildSeedConfig`, per-test
`CLAUDE_CONFIG_DIR`, temp `GSTACK_HOME`, `--strict-mcp-config`, no network).
`allowedTools: ['Skill','Bash','Read','Write','Grep','Glob']`, `maxTurns: 70`,
same for every arm. Pin one model with `--model` across all four; record the id.

**Shared prompt suffix, identical for all arms** (environment facts only — no
hint of defect count, location, or kind):

```
Harness constraints for this run (environment facts, not review guidance):
- Non-interactive headless session. Never wait for user input. Where the workflow
  asks a question or reaches an approval gate, take the report-only default and continue.
- Mutation authorization: NONE. Report-only. The only file you may create or modify
  is the report file below.
- There is no remote, no PR, and no network. The base branch is the local branch
  "main" (diff scope: git diff main...HEAD). Skip gh/glab/Greptile/web steps silently.
- State persistence binaries are not installed; skip persistence steps silently.
- Write the COMPLETE report to <REPORT_PATH>, including any suppressed/low-confidence
  appendix.
```

Per-arm formatting normalization (declared, not scored):

- A0 adds: `One finding per line, formatted: file:line — description.`
- A1/A2 use `ReportFindings` natively; findings are read from the tool call
  input, and `verdict` is read as-is.
- A3 uses the calibrated format its own module mandates
  (`[SEVERITY] (confidence: N/10) file:line — description`), parsed by the
  existing `parseReviewFindings` helper.

**Shown vs hedged bucket** (symmetric across arms — this is what a user reads as
an assertion):

- A3 shown = confidence ≥ 7. Hedged = confidence ≤ 6 / suppressed appendix.
- A1/A2 shown = `verdict: CONFIRMED` or no verdict field. Hedged =
  `verdict: PLAUSIBLE`.
- A0 shown = everything, unless the arm labels the item unverified/speculative
  in its own words.

Recall is scored on the **shown** bucket only. Hedged findings are recorded and
reported as an "attention cost" number, and never earn a catch.

---

## 3. Scoring

Six axes. Each has one statistic and one number. No weighted composite: a single
blended score would hide which axis moved, which is how the `/ship` verdict went
wrong.

### 3.1 Axis 1 — Judgment recall (primary)

`JP` = number of {JP-1, JP-2} caught, 0–2. A defect counts as caught for an arm
only if it is caught in **≥ 2 of 3 runs** (majority, pre-registered).

A single-run catch requires **location + mechanism**:

- **JP-1**: a shown finding citing `billing/urls_webhook.py`,
  `feature/config/urls.py` (the `webhooks/` line), or `billing/views_refund.py`,
  whose text asserts the endpoint is reachable without authentication.
  Mechanism regex (case-insensitive):
  `unauthenticat|no auth|anonymous|bypass|exempt|middleware|AllowAny|without (a )?(login|session|permission)`.
  **Not a catch:** "consider adding rate limiting", "validate the request body",
  "the decorator name is unclear", or any finding that names only
  `urls_internal.py` (that mount is correct).
- **JP-2**: a shown finding citing
  `rentals/migrations/0002_rental_external_ref_unique.py` whose text asserts the
  deletion destroys real rows because existing data collides on the blank
  default. Mechanism regex:
  `existing (data|rows)|production|legacy|blank|empty string|""|default|duplicate|irreversible|no reverse|data loss`.
  **Not a catch:** "this migration contains a delete, be careful",
  "migrations should be reviewed", "consider a backup" — a generic
  destructive-migration warning with no data-dependency claim is a pattern hit,
  not a judgment catch.

### 3.2 Axis 2 — Pattern recall

`TP` = number of {TP-1…TP-4} caught, 0–4. Reuse the inherited matcher exactly:
cited file must resolve to the planted file, `|cited_line − anchor_line| ≤ 15`,
and the finding text must match the inherited `match` regex from
`answer-key.json`. Majority-of-3 as above.

### 3.3 Axis 3 — Fabrications

`FAB` = count of shown findings, per run, that satisfy any of:

- **F1** cites a `file:line` that does not exist at the reviewed commit;
- **F2** quotes code text absent within ±10 lines of the cited location;
- **F3** asserts a checkable fact about code outside the diff that reading that
  file contradicts ("X is unvalidated" where the validation is present, "no test
  covers Y" where the test exists);
- **F4** targets one of the 11 FP seeds with a claim matching that seed's trap.

**Not fabrications:** low-value nits, style opinions, correct findings at the
wrong severity, and genuine defects absent from this key. A real defect nobody
planted is a `TRUE-EXTRA` and counts **in the arm's favour** (recorded, not
gate-blocking) — a key that punishes real discoveries is a key that rewards
silence.

Report `FAB` as the median across the 3 runs, and the per-run values.

### 3.4 Axis 4 — Cry-wolf on seeded-correct code

`WOLF` = the F4 subset, i.e. shown findings against the 11 FP seeds. Tracked
separately because it is the specific failure `/review`'s pre-emit verification
gate claims to kill. Median of 3.

### 3.5 Axis 5 — Cost

`USD` = median total cost per run from the transcript (`result.totalCostUsd`),
plus `TOK_IN` / `TOK_OUT` medians. A3's cost includes every module and reference
file it read, and any outside-voice call it makes. That is the bill under test.

Derived: `USD_PER_DEFECT = USD / (JP + TP)`. Report `∞` when recall is 0.

### 3.6 Axis 6 — Evidence discipline

`EVID` = fraction of shown findings whose cited `file:line` exists and whose
quoted or described code is actually there (F1/F2 inverse), 0.00–1.00. Median of
3. This is `/review`'s own claimed differentiator stated as a number.

### 3.7 Recorded diagnostics (not gates)

- `HEDGED` — count of hedged-bucket findings (attention cost).
- `DEEP_MODULES` — which modules A3 actually loaded (`review.md`, `health.md`,
  `codex.md`), from its printed execution header; and whether an outside-voice
  call actually happened. A Deep run whose independence claim never executed is
  a finding about the shipped surface, and the writeup must say so.
- `TURNS`, `exitReason` per run.

### 3.8 The differential (the question, stated as a set)

- `D_gstack` = defects caught by A3 in ≥ 2/3 runs and by **no** native arm (A1,
  A2) in **any** run. This is the literal answer to "what does gstack catch that
  native misses".
- `D_native` = the reverse: caught by A1 or A2 in ≥ 2/3 runs, missed by A3 in
  all 3. Report it with equal prominence. A non-empty `D_native` is evidence
  against `/review` and must be published, not buried.

---

## 4. Decision

Evaluate in order. First matching row wins.

| # | Condition | Verdict |
|---|---|---|
| 0 | **Fixture invalid:** A0 (nothing) scores `JP = 2` with `FAB ≤ 1`. | **NO VERDICT.** The defects are too easy; re-plant harder and rerun all arms. Not a CUT, and explicitly not a KEEP. |
| 1 | A3 fails to produce a parseable report, or hits `maxTurns`, in ≥ 2/3 runs. | **CUT.** Deep cannot finish a 20-file diff; unusable regardless of ceiling quality. |
| 2 | `WOLF(A3) > 0` while `WOLF(A1) = 0` or `WOLF(A2) = 0`. | **CUT.** It cries wolf where native does not, and the verification gate is the thing it charges for. |
| 3 | `FAB(A3) > min(FAB(A1), FAB(A2)) + 1`. | **CUT.** Paying more tokens for more noise. |
| 4 | `D_gstack = ∅` (no defect caught by A3 that a native arm did not also catch). | **CUT for this axis.** Ties do not justify a token premium. Carry the §0 scope table: other axes may still justify KEEP on their own keys. |
| 5 | `D_gstack ≠ ∅` but contains no judgment defect (only TP-class defects). | **WEAK.** Report as "marginal pattern coverage, no judgment differential." Not a KEEP. Requires a second axis to carry the surface. |
| 6 | `D_gstack` contains ≥ 1 of {JP-1, JP-2} **and** `WOLF(A3) = 0` **and** `FAB(A3) ≤ min(FAB(A1), FAB(A2)) + 1` **and** `EVID(A3) ≥ 0.90` **and** `USD(A3) ≤ 4 × min(USD(A1), USD(A2))`. | **KEEP.** It finds an unauthenticated-money-route class of defect that native misses, without extra noise, at a defensible multiple. |
| 7 | Same as row 6 but `USD(A3) > 4 × min(USD(A1), USD(A2))`. | **KEEP, COST-FLAGGED.** Record the exact multiple and open a cost-reduction item. A judgment defect of this class is worth real money; an unbounded multiple is not a blank cheque. |
| 8 | Anything else. | **CUT.** Default is CUT: the burden of proof is on the extra tokens. |

Why `4×` and not `2×` or `10×`: a missed unauthenticated refund route is a
production incident, so a small multiple must be payable. An order-of-magnitude
premium for the same defect list is not defensible to a user who is paying per
token. `4×` sits where a genuine differential passes and an expensive tie fails.
The number is arbitrary in the way all thresholds are arbitrary; it is fixed
here, before the data, which is the part that matters.

---

## 5. Falsifiability — both directions

**What proves gstack `/review` is not worth its tokens** (any one; all are
reachable outcomes of the design above, not strawmen):

1. `/code-review high` catches JP-1 and JP-2 in ≥ 2/3 runs and gstack Deep does
   too, at 5× the cost → row 4, CUT. **Ties are CUT, not KEEP.**
2. Deep flags any of the 11 seeded-correct billing files at confidence ≥ 7 while
   a native arm stays clean → row 2, CUT. Its headline discipline claim fails on
   its own fixture.
3. Deep's `EVID < 0.90` — it cites lines that do not say what it claims → row 6
   unmet, and row 8 CUT. The pre-emit verification gate is prose, not behavior.
4. Deep runs out of turns reading its own reference tree before finishing the
   diff → row 1, CUT.
5. `D_native ≠ ∅` — native catches something Deep misses. Even if row 6 passes,
   this is published in the verdict headline.

**What proves the fixture, not gstack, is wrong:** row 0. If the bare-prompt arm
solves both judgment defects cleanly, the defects were pattern-matchable after
all and the whole run is void — including any KEEP it would have produced.

**What this key cannot conclude:** anything in the §0 unmeasured column. If the
verdict is CUT and the owner's actual reason for keeping `/review` is the
fix-first mutation boundary or the scope-drift audit, this key has not touched
it. Write a separate key for that axis. Do not extend this one's verdict over
it.

---

## 6. Pre-registration and anti-gaming

- This file is committed **before** the first run. Its git blob hash goes in the
  results writeup.
- The mechanism regexes in §3.1 are frozen. Loosening one after seeing an arm's
  output invalidates every run: publish a new version of this file and rerun all
  12.
- Near-miss adjudication (a finding that hits the location but whose phrasing
  misses the regex, or an unplanted candidate `TRUE-EXTRA`) goes to two
  adjudicators, blind to which arm produced it, with arm labels stripped.
  Disagreement → the item counts as **neither** catch nor fabrication, and is
  listed as unresolved. Never resolve a tie in the home team's favour.
- Adjudicate all four arms' outputs in one shuffled pass. Do not score A3 first.
- Publish every run's raw findings alongside the scores, including A3's
  hedged-bucket appendix.

**Optional sub-arm A3b (only if A3 loses).** A3 runs the canonical no-runtime
profile, so its outside voice may never execute. If A3 loses and `DEEP_MODULES`
shows the outside voice never ran, an A3b with a working outside-voice provider
may be run as a tiebreaker — reported separately, never merged into A3's
numbers, and labelled "not what `npx skills add` installs." A3's own verdict
still stands for the shipped configuration, because that is what users get.

---

## 7. Run cost

12 runs: A0 ~$0.10, A1 ~$0.40, A2 ~$1.20, A3 ~$2.50 per run → ≈ **$13** per full
bakeoff, ~90 min wall clock at 4-way concurrency. Launch through
`bin/gstack-detach` (`eval:bg`) per CLAUDE.md; a plain background task gets
SIGTERM'd mid-run.
