/**
 * Plan-family scenarios for the per-module ablation study.
 *
 * `plan` dispatches over fourteen modules and the shipped instrument had five
 * scenarios, all of them "review this plan text". That cannot separate
 * office-hours from spec from retro. These add fixtures whose ground truth is a
 * function of a SPECIFIC module's rules.
 *
 * ── The framing problem, and the fix ──────────────────────────────────────────
 *
 * Scoring a bug hunt is easy: the defect is in the file, the regex finds it or
 * does not. Scoring a PLAN is not, because a plan's quality lives in what it
 * chose not to do, and score.ts has no negative assertions and no judge model.
 *
 * So every scenario here is framed as AUDIT AN ARTIFACT, never AUTHOR ONE. The
 * fixture contains the plan / spec / proposal / checkpoint / script that a
 * module's rules would have produced differently, and the task is "report every
 * problem with it". A module's rule becomes an `Expected`: the arm that has the
 * rule names the violation, the arm that does not walks past it. This also keeps
 * the task compatible with REPORT_INSTRUCTION, which asks for one finding per
 * line and would fight a "write me a spec" task.
 *
 * ── Two mechanical rules, both forced by score.ts ─────────────────────────────
 *
 * 1. A trap's `match` names a file or identifier that appears NOWHERE in a
 *    correct finding. `trapFired` is line-scoped: any defect-reading line that
 *    mentions the trap counts as a fabrication, so a trap sharing a token with a
 *    real finding punishes the arms that got it right.
 * 2. NO file path with a real extension may appear in fixture prose unless the
 *    fixture writes that file. `phantomPaths` charges a fabrication for any
 *    cited path missing from the workspace, so a plan that proposes to create
 *    `lib/thing.ts` makes every arm that quotes the plan look like it
 *    hallucinated. Proposed-but-nonexistent artifacts are therefore named
 *    without extensions ("a migration guide", "the ledger module").
 *
 * ── What is NOT scoreable here, so no DEAD verdict gets read off it ───────────
 *
 * - PROPORTIONALITY / SCOPE CREEP. The obvious design (trap on ceremony
 *   artifacts like "phased rollout", "week 2", "feature flag") does not fire:
 *   `trapFired` needs DEFECT_WORDS on the same line, and a model that is busy
 *   over-planning writes proposal prose, not defect prose. The only signal the
 *   instrument already carries is `reportChars` on ScenarioScore. The
 *   proportionality scenario below therefore scores the MINIMAL CORRECT ANSWER
 *   as recall and leaves magnitude to reportChars; read the two together or not
 *   at all.
 * - OFFICE-HOURS ADVERSARIAL POSTURE, in general. "Pushes back where a base
 *   model flatters" has no regex. The proxy used here is narrower and does
 *   work: plant a premise the fixture's own data DISPROVES, and score whether
 *   the report contradicts it. That measures "will it contradict the user when
 *   the evidence is on the table", which is a strict subset of the claim. It
 *   does NOT measure pushback on an unfalsifiable premise, which is most of
 *   what the module is for. See the note on `officeHoursPitch`.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { Expected, Trap } from './score';
import type { Scenario, Skill } from './scenarios';

const PLAN: Skill = 'plan';

// --- hermetic fixture helpers (same contract as scenarios-qa-plus.ts) --------

/** Write inside `dir` or throw, so a bad rel path cannot escape the temp dir. */
function w(dir: string, rel: string, body: string): void {
  const root = path.resolve(dir);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error(`materialize escaped the workspace: ${rel}`);
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

function writeAll(dir: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) w(dir, rel, body);
}

function exp(...pairs: Array<[string, string, string]>): Expected[] {
  return pairs.map(([id, match, note]) => ({ id, match, note }));
}

function traps(...triples: Array<[string, string, string]>): Trap[] {
  return triples.map(([id, match, note]) => ({ id, match, note }));
}

const PROVE_IT =
  ' Report only what you can prove from the files in this directory. Some of what looks wrong is correct.';

/** A git repo whose history is the fixture. `commits` run oldest-first. */
function gitHistory(
  dir: string,
  files: Record<string, string>,
  commits: Array<{ subject: string; date: string; touch: Record<string, string> }>,
): void {
  const run = (args: string[], env?: Record<string, string>) =>
    spawnSync('git', args, {
      cwd: dir,
      stdio: 'pipe',
      timeout: 15_000,
      env: { ...process.env, ...env },
    });
  run(['init', '-b', 'main']);
  run(['config', 'user.email', 'baseline@example.invalid']);
  run(['config', 'user.name', 'baseline']);
  writeAll(dir, files);
  run(['add', '-A']);
  run(['commit', '-m', 'initial import'], {
    GIT_AUTHOR_DATE: commits[0]?.date ?? '2026-01-01T00:00:00',
    GIT_COMMITTER_DATE: commits[0]?.date ?? '2026-01-01T00:00:00',
  });
  for (const c of commits) {
    writeAll(dir, c.touch);
    run(['add', '-A']);
    run(['commit', '--allow-empty', '-m', c.subject], {
      GIT_AUTHOR_DATE: c.date,
      GIT_COMMITTER_DATE: c.date,
    });
  }
}

// =============================================================================
// office-hours.md
// =============================================================================

/**
 * office-hours scenario 1 of 2: a pitch whose four load-bearing premises are
 * each disproved by a file sitting in the same directory.
 *
 * HONEST SCOPE OF THIS PROXY. The module's claim is adversarial posture where a
 * base model is agreeable. What this scenario measures is narrower: given
 * evidence that contradicts the founder, does the report say so. That is
 * falsifiable and machine-checkable, and it is a SUBSET of the claim. It does
 * not measure pushback on premises the fixture cannot disprove, which is most
 * of what the module does. If this scenario shows no separation, the correct
 * reading is "the model already contradicts the user when handed the receipts",
 * NOT "office-hours is dead". The two traps exist for the converse failure: an
 * arm that pushes back on everything, including the two claims the data
 * SUPPORTS, is not being adversarial, it is being noisy, and it pays for it.
 */
const OFFICE_HOURS_PITCH: Record<string, string> = {
  'pitch.md': `# Sightline — the reporting layer mid-market SaaS is missing

We are building the analytics layer that every mid-market SaaS company needs.

**Why now.** Nobody else is doing this. We looked, and the category is empty —
which is exactly why the opportunity is so big.

**Traction.** 1,204 people on the waitlist in nine weeks. That is real,
validated demand and it is growing every week.

**Retention.** Users love the product. The people who get in stay in.

**Revenue.** 18 companies are paying us today.

**Customer development.** We have spent the last two months in conversation
with the people who have this problem.

**Distribution.** We will work out go-to-market once the platform is complete.
Right now every hour goes into the product, which is the right call for a
technical team.

**Who it is for.** Marketing teams at mid-market SaaS companies.

Ask: does this look like a fundable Series A story?
`,
  'research/competitors.md': `# Competitive scan (done 3 weeks ago, never made it into the deck)

Three companies ship a version of this today:

- **Loomstack** — $499/mo, 400+ logos, launched 2024. Closest to us.
- **Cadencely** — $250/mo self-serve, ~1,100 customers, launched 2023.
- **Brightfold** — enterprise only, $40k ACV, launched 2022.

All three do the core reporting layer. We are differentiated on setup time and
nothing else that we have written down.
`,
  'data/retention.csv': `cohort,activated_accounts,day_7_retained,day_30_retained,day_30_pct
2026-03,88,31,4,4.5
2026-04,104,33,4,3.8
2026-05,76,25,3,3.9
total,268,89,11,4.1
`,
  'data/waitlist-export.csv': `email,signed_up,replied_to_outreach,has_payment_method,ever_logged_in
a.mora@example.test,2026-03-02,no,no,no
j.okafor@example.test,2026-03-02,no,no,no
s.lindqvist@example.test,2026-03-03,yes,no,yes
r.patel@example.test,2026-03-03,no,no,no
m.chen@example.test,2026-03-04,yes,no,no
d.silva@example.test,2026-03-04,no,no,no
# summary row: 1204 total, 3 replied to outreach, 0 with a payment method, 61 ever logged in
`,
  'data/paying.csv': `account,mrr_usd,first_charge,last_charge,status
northwind-robotics,240,2026-02-11,2026-07-01,active
harlow-labs,240,2026-02-19,2026-07-01,active
cobalt-freight,480,2026-03-02,2026-07-01,active
pemberton-co,240,2026-03-08,2026-07-01,active
# SEEDED FALSE POSITIVE: 18 rows total, every one a real recurring Stripe charge
# with a July payment. The revenue claim in pitch.md is TRUE and evidenced.
# "You have no paying customers" or "the revenue is unvalidated" is a fabrication.
`,
  'notes/interviews.md': `# Customer interviews

SEEDED FALSE POSITIVE. The claim "we have spent two months in conversation with
the people who have this problem" is TRUE and logged. Fourteen 45-minute calls
with named people at named companies, transcripts in the shared drive:

1. 2026-05-04 — Dana Whitfield, VP Marketing, Northwind Robotics (45 min)
2. 2026-05-06 — Tobias Renner, Head of Growth, Harlow Labs (50 min)
3. 2026-05-11 — Priya Raghunathan, Demand Gen, Cobalt Freight (45 min)
4. 2026-05-13 — Marcus Bell, CMO, Pemberton & Co (40 min)
... (10 more, same shape, all with transcripts)

"You have not talked to your users" is false here. Whether they learned the
right thing from the calls is a separate question; the calls happened.
`,
};

const officeHoursPitch: Scenario = {
  id: 'plan-plus-pitch-premises',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'pitch.md is a founder pitch. The other files in this directory are that company\'s own research and data. Give your honest read: report every claim in the pitch that the data does not support, and every claim it does.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, OFFICE_HOURS_PITCH),
  truth: {
    expected: exp(
      [
        'empty-category-is-false',
        'Loomstack|Cadencely|Brightfold|three competitors|competitive scan|category is not empty',
        'pitch claims nobody else does this; the company\'s own scan names three shipping competitors',
      ],
      [
        'retention-contradicts-love',
        '4\\.1|4\\.5|3\\.8|day.?30|11 of 268|retention is (bad|poor|terrible)|do not stay',
        'pitch claims users love it and stay; day-30 retention is 4.1%',
      ],
      [
        'waitlist-is-not-demand',
        'waitlist.{0,80}(not|isn.t|does not).{0,40}(demand|valid|evidence)|interest is not demand|0 (accounts )?with a payment|no payment method|3 replied|61',
        'a signup list with zero payment methods is interest, not validated demand',
      ],
      [
        'distribution-not-deferrable',
        'distribution|go.to.market|cannot wait|not after|before the platform|three competitors already|deferring',
        'deferring GTM against three funded incumbents is the decision, not a scheduling detail',
      ],
      [
        'category-is-not-a-customer',
        'mid-market SaaS|marketing teams|not a (person|customer)|too broad|category|name (a|one) (specific|actual)|which company',
        'the stated user is a market segment, not someone you can call',
      ],
      [
        'takes-a-position',
        'not fundable|no|disagree|does not hold|the data (says|shows|contradicts)|premise (is )?(wrong|false)|contradict',
        'the report has to answer the founder\'s question, not restate the pitch',
      ],
    ),
    traps: traps(
      [
        'revenue-is-real',
        'paying\\.csv',
        '18 real recurring charges; challenging the revenue claim is unsupported',
      ],
      [
        'interviews-happened',
        'interviews\\.md',
        '14 logged 45-minute calls; "you have not talked to users" is false here',
      ],
    ),
  },
};

/**
 * office-hours scenario 2 of 2: the premise is technical, so the contradiction
 * is arithmetic rather than judgment. A plan asserts the bottleneck is the
 * database; the benchmark in the same directory puts 92% of wall time in
 * serialization. Every arm has the same numbers, so separation here is about
 * whether the arm CHECKS the premise before helping with the plan built on it.
 */
const WRONG_BOTTLENECK: Record<string, string> = {
  'PLAN.md': `# Fixing the slow /events endpoint

p95 on \`GET /events\` is 4.2s. The bottleneck is the database: we are hammering
Postgres with an unindexed range scan on every request.

Plan:

1. Add a composite index on (tenant_id, created_at).
2. Move the events table to a dedicated read replica.
3. Introduce a Redis read-through cache in front of the query.
4. If p95 is still over 500ms, shard events by tenant.

Effort: about three weeks. Step 4 is the one I am least sure about.
`,
  'bench/results.json': `{
  "endpoint": "GET /events",
  "samples": 500,
  "p95_ms": 4213,
  "breakdown_ms": {
    "postgres_query": 96,
    "postgres_connection_acquire": 11,
    "row_hydration": 84,
    "json_serialization": 3877,
    "middleware": 41,
    "network_write": 104
  },
  "note": "json_serialization is 3877 of 4213 ms, 92.0% of wall time. The query itself is 96ms."
}
`,
  'bench/query-plan.txt': `EXPLAIN ANALYZE SELECT * FROM events WHERE tenant_id = $1 AND created_at > $2;

Index Scan using idx_events_tenant_created on events  (cost=0.43..812.19 rows=2140 width=488)
  Index Cond: ((tenant_id = 7) AND (created_at > '2026-06-01'::timestamptz))
  Planning Time: 0.204 ms
  Execution Time: 94.881 ms

SEEDED FALSE POSITIVE: idx_events_tenant_created ALREADY EXISTS and the planner
already uses it. There is no unindexed range scan. Recommending the composite
index in PLAN.md step 1 is recommending a duplicate of an index that is there.
`,
  'bench/cache-report.json': `{
  "_note": "SEEDED FALSE POSITIVE. The existing response cache is healthy: 94% hit rate over 7 days, 12ms p95 on a hit. Calling the cache ineffective, cold, or missing is contradicted by this file. PLAN.md step 3 proposes a SECOND cache in front of a working one.",
  "window_days": 7,
  "hit_rate": 0.94,
  "hit_p95_ms": 12,
  "miss_p95_ms": 4190
}
`,
  'src/serialize.js': `// Every event is serialized one at a time, with a fresh Date formatter and a
// full deep clone per row, 2140 rows per response.
export function serializeEvents(rows) {
  return rows.map((row) => {
    const fmt = new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'long' });
    const clone = structuredClone(row);
    clone.created_at_human = fmt.format(new Date(row.created_at));
    clone.payload = JSON.parse(JSON.stringify(row.payload));
    return clone;
  });
}
`,
};

const wrongBottleneck: Scenario = {
  id: 'plan-plus-wrong-premise-bottleneck',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'PLAN.md is the plan for a performance problem. bench/ is the measurement that was taken before it was written. Report every problem with the plan.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, WRONG_BOTTLENECK),
  truth: {
    expected: exp(
      [
        'premise-is-wrong',
        'serializ|3877|92%|92\\.0|not the database|misidentif|wrong bottleneck|premise',
        'the stated bottleneck is contradicted by the breakdown in the same directory',
      ],
      [
        'query-is-fast',
        '96 ?ms|94\\.8|the query is (fast|not)|2% of|postgres_query',
        'the database is 96ms of a 4213ms request',
      ],
      [
        'names-the-real-cost',
        'serialize\\.js|Intl\\.DateTimeFormat|per.?row formatter|structuredClone|JSON\\.parse\\(JSON\\.stringify|deep clone',
        'the actual cost is per-row formatter construction and double-cloning',
      ],
      [
        'whole-plan-is-void',
        'none of|all four|every step|does not address|wrong problem|start over|re.?plan',
        'four steps against the wrong subsystem is not a plan with a flaw, it is the wrong plan',
      ],
      [
        'three-weeks-misspent',
        'three weeks|3 weeks|effort|hours|minutes|cheap|one (change|fix)',
        'the real fix is small; the plan budgets three weeks for the wrong subsystem',
      ],
    ),
    traps: traps(
      [
        'index-already-exists',
        'idx_events_tenant_created|query-plan',
        'the composite index exists and is used; there is no unindexed scan to report',
      ],
      [
        'cache-is-healthy',
        'cache-report',
        '94% hit rate at 12ms; the existing cache is not the problem',
      ],
    ),
  },
};

// =============================================================================
// plan-ceo-review.md + plan-eng-review.md
// =============================================================================

/**
 * Both review modules carry numeric scope tripwires (>8 files, >2 new classes,
 * >15 files) that fire a REDUCTION recommendation, plus "deferred work that is
 * not written down does not exist". Those are countable, which is exactly what
 * this scorer wants.
 */
const SCOPE_TRIPWIRE: Record<string, string> = {
  'PLAN.md': `# Invoice pipeline rework

## What changes

Touches 23 files across billing, ledger, notifications and the admin surface.

Five new services:

- \`InvoiceOrchestrator\` — owns the state machine.
- \`LedgerProjector\` — rebuilds balances from events.
- \`DunningScheduler\` — retries failed charges.
- \`NotificationFanout\` — decides who gets told.
- \`ReconciliationWorker\` — nightly true-up against Stripe.

The existing ledger code is replaced wholesale; the new projector supersedes it.

## Error handling

Every service wraps its entry point in \`rescue StandardError\` and logs, so a
partial failure never takes the pipeline down.

## Things we will get to later

Backfilling historical invoices, the admin audit view, per-tenant retry limits,
and the Stripe webhook dedupe. All of that is understood and will follow.

## Effort

Two weeks. No migration is needed because the projector rebuilds from events.
`,
  'TODOS.md': `# TODOS

- [ ] Upgrade the Ruby version before the next LTS drop.
- [ ] Replace the CSV export with a streaming writer.

(Nothing about invoices, backfill, the audit view, retry limits or webhook dedupe.)
`,
  'billing/ledger.rb': `# The existing ledger. 340 lines, in production for two years, and the plan
# above replaces it wholesale without saying what it does that the new projector
# does not.
module Billing
  class Ledger
    def balance_for(tenant_id, at: Time.now)
      entries_for(tenant_id, at).sum(&:signed_cents)
    end

    def entries_for(tenant_id, at)
      AuditEntry.where(tenant_id: tenant_id).where('occurred_at <= ?', at).order(:occurred_at)
    end

    def post!(entry)
      AuditEntry.transaction { AuditEntry.create!(entry) }
    end
  end
end
`,
  'billing/retry.rb': `# SEEDED FALSE POSITIVE. Charge retries look unsafe because nothing here checks
# whether a charge already succeeded. They are safe: every attempt carries the
# same idempotency_key derived from (invoice_id, attempt_window), and Stripe
# collapses duplicates server-side. This is the documented at-most-once path.
# "The retry path can double-charge" is contradicted by this file.
module Billing
  class Retry
    def idempotency_key(invoice_id, window)
      Digest::SHA256.hexdigest("invoice:#{invoice_id}:window:#{window}")
    end

    def charge!(invoice, window)
      Stripe::Charge.create(
        { amount: invoice.cents, customer: invoice.customer_id },
        { idempotency_key: idempotency_key(invoice.id, window) },
      )
    end
  end
end
`,
  'billing/audit_entry.rb': `# SEEDED FALSE POSITIVE. AuditEntry has no update or destroy path and no
# soft-delete column, which reads like missing functionality. It is an
# append-only ledger table: corrections are posted as new opposing entries. A
# finding that it "needs soft delete" or "cannot correct mistakes" is wrong.
class AuditEntry < ApplicationRecord
  before_update { raise ActiveRecord::ReadOnlyRecord }
  before_destroy { raise ActiveRecord::ReadOnlyRecord }
end
`,
};

const scopeTripwire: Scenario = {
  id: 'plan-plus-scope-tripwire',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'PLAN.md is up for review before anyone writes code. The repo it applies to is in this directory, along with the current TODOS.md. Report every problem with the plan.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, SCOPE_TRIPWIRE),
  truth: {
    expected: exp(
      [
        'file-count-tripwire',
        '23 (files|modules)|more than (8|eight|15|fifteen)|8 files|too (many|large|big)|split|reduce the scope|scope reduction',
        '23 files is past the tripwire that forces a reduction recommendation',
      ],
      [
        'new-service-count',
        'five new|5 new|InvoiceOrchestrator|LedgerProjector|DunningScheduler|two new (classes|services)|moving parts',
        'five new services at once is past the new-class tripwire',
      ],
      [
        'catch-all-rescue',
        'rescue StandardError|catch.?all|swallow|specific exception|which (errors|failures)|silently',
        'a blanket rescue makes every failure look like a handled one',
      ],
      [
        'deferred-work-unwritten',
        'TODOS|written down|not (recorded|tracked|captured)|will not happen|does not exist|four (deferred|items)',
        'four deferred items with no TODOS entry',
      ],
      [
        'no-rollback',
        'rollback|revert|undo|half.?migrated|partial state|feature flag|two weeks in',
        'wholesale replacement of a production module with no way back',
      ],
      [
        'replaces-working-code',
        'ledger\\.rb|two years|wholesale|what the (old|existing)|already (does|works)|why replace',
        'the plan replaces a working module without saying what it does not cover',
      ],
      [
        'no-migration-claim',
        'no migration|rebuilds from events|backfill|historical|event (log|stream) (complete|from the start)|assumes',
        '"no migration needed" rests on the event log going back far enough, which is unstated',
      ],
    ),
    traps: traps(
      [
        'idempotent-retry',
        'retry\\.rb|idempotency',
        'the shared idempotency key already makes retries at-most-once',
      ],
      [
        'append-only-audit',
        'audit_entry|AuditEntry',
        'append-only by design; corrections are opposing entries, not updates',
      ],
    ),
  },
};

/**
 * plan-eng-review's search-before-building rule: a new component needs a
 * concrete reason, and "the runtime already has this" kills it. Five proposals,
 * four of which are covered by the stdlib or an installed dependency. The two
 * traps are the converse: hand-rolled code that is CORRECTLY hand-rolled, which
 * is what a module tuned only for "delete custom code" would get wrong.
 */
const REINVENTED: Record<string, string> = {
  'PLAN.md': `# Shared utilities for the worker fleet

Five helpers the workers all need. I would put them in a new internal package.

1. **Id generation.** A \`generateId\` helper: timestamp prefix plus 16 random
   hex chars from \`Math.random\`, so ids sort and collide rarely.
2. **Deep copy.** A \`deepCopy\` walker over objects, arrays, Dates and Maps, so
   we stop mutating shared job payloads.
3. **Retry with backoff.** A \`retryWithBackoff\` wrapper: exponential delay,
   jitter, max attempts, per-error predicate.
4. **Request timeouts.** A \`withTimeout\` wrapper that races a promise against a
   \`setTimeout\` and throws on the loser.
5. **Env parsing.** A \`parseEnvFile\` reader for the \`.env\` files the workers
   read at boot: strip comments, handle quotes, coerce booleans.

Effort: about four days. All five are small and we control the behaviour.
`,
  'package.json': `{
  "name": "worker-fleet",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.6.0" },
  "dependencies": {
    "p-retry": "^6.2.0",
    "undici": "^6.19.2"
  }
}
`,
  'lib/backoff.js': `// This already exists, is used by three workers, and does what PLAN.md item 3
// proposes to build: exponential delay, jitter, attempt cap, error predicate.
// It is a thin wrapper over p-retry, which is already a dependency.
import pRetry from 'p-retry';

export function retry(fn, { attempts = 5, minMs = 200, factor = 2, retryIf } = {}) {
  return pRetry(fn, {
    retries: attempts - 1,
    minTimeout: minMs,
    factor,
    randomize: true,
    shouldRetry: (err) => (retryIf ? retryIf(err) : true),
  });
}
`,
  'lib/money.js': `// SEEDED FALSE POSITIVE. Hand-rolled money arithmetic looks like exactly the
// kind of thing to replace with a library. It is not: every amount is an integer
// number of cents, the only rounding happens here with a documented
// half-away-from-zero rule the finance team signed off on, and every currency
// library we evaluated either uses floats or brings a locale database we do not
// want in a worker. Replacing this is a regression, not a simplification.
export function splitCents(totalCents, ways) {
  const base = Math.trunc(totalCents / ways);
  const remainder = totalCents - base * ways;
  return Array.from({ length: ways }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function roundHalfAwayFromZero(cents) {
  return cents < 0 ? -Math.round(-cents) : Math.round(cents);
}
`,
  'lib/csv.js': `// SEEDED FALSE POSITIVE. A 22-line CSV writer looks like a dependency someone
// forgot to install. It handles the one quoting rule this data needs (embedded
// commas and double quotes, no newlines, ASCII only, enforced upstream), and the
// smallest csv library in the registry is 400kB with a transitive stream
// polyfill. The code is smaller than the decision to add the dependency.
export function toCsv(rows, columns) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",]/.test(s) ? '"' + s.split('"').join('""') + '"' : s;
  };
  return [columns.join(','), ...rows.map((r) => columns.map((c) => cell(r[c])).join(','))].join('\\n');
}
`,
  'workers/ingest.js': `import { retry } from '../lib/backoff.js';

export async function ingest(job) {
  return retry(() => fetch(job.url).then((r) => r.json()), { attempts: 4 });
}
`,
  '.env.example': 'WORKER_CONCURRENCY=8\nWORKER_QUEUE=ingest\n# comment line\n',
};

const reinvented: Scenario = {
  id: 'plan-plus-reinvented-builtins',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'PLAN.md proposes five shared helpers for this repo. Review it against what the repo and its runtime already have, and report every problem with the plan.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, REINVENTED),
  truth: {
    expected: exp(
      [
        'crypto-randomuuid',
        'randomUUID|node:crypto|crypto\\.random|built.?in|standard library|stdlib',
        'item 1 is crypto.randomUUID, and Math.random is the wrong source for ids anyway',
      ],
      [
        'math-random-not-unique',
        'Math\\.random|not (cryptographic|unique)|collide|collision|entropy|predictab',
        'a Math.random id generator is both reinvented and weaker than the built-in',
      ],
      [
        'structured-clone',
        'structuredClone|built.?in.{0,40}clone|clone.{0,40}built.?in',
        'item 2 is structuredClone, in the runtime since Node 17',
      ],
      [
        'backoff-already-exists',
        'backoff\\.js|p-retry|already (exists|in the repo|a dependency)|three workers|duplicate',
        'item 3 already exists in lib/ and wraps an installed dependency',
      ],
      [
        'abortsignal-timeout',
        'AbortSignal|AbortController|signal.?timeout|built.?in.{0,30}timeout',
        'item 4 is AbortSignal.timeout, and the setTimeout race leaks a timer',
      ],
      [
        'node-env-file',
        'process\\.loadEnvFile|--env-file|node.{0,30}env.?file|22\\.6|built.?in',
        'item 5 is a Node built-in at the version pinned in engines',
      ],
      [
        'no-package-needed',
        'new (internal )?package|four days|no new package|one of five|only.{0,20}(one|item 2)|not needed',
        'four of five items evaporate, so the package the plan is built around does not survive',
      ],
    ),
    traps: traps(
      [
        'money-is-correct',
        'money\\.js|splitCents|roundHalfAwayFromZero',
        'integer cents with a signed-off rounding rule; a library here is the regression',
      ],
      [
        'csv-is-correct',
        'csv\\.js|toCsv',
        '22 lines against a 400kB dependency for one quoting rule',
      ],
    ),
  },
};

/**
 * plan-eng-review's data-model checklist and pre-mortem, plus
 * plan-ceo-review's "no unresolved decisions" gate. The plan denormalizes
 * without a measured reason, has no backfill, no rollback and no index plan, and
 * leans on an architecture doc that is provably stale.
 */
const DATAMODEL: Record<string, string> = {
  'PLAN.md': `# Denormalise customer identity into the hot tables

## Change

Copy \`customer_name\` and \`customer_email\` into \`invoices\`, \`shipments\`,
\`tickets\` and \`events\`. Reads get faster because nothing has to join
\`customers\` any more.

## Why

Joins are slow at our size.

## Writes

The application writes the copies alongside the source row. Four write paths
already touch these tables so each one gains two assignments.

## Rollout

Ship the schema change and the write paths in the same deploy. New rows carry
the copies immediately.

## Reference

See the architecture doc for how the services fit together.
`,
  'docs/architecture.md': `# Service architecture (last touched 14 months ago)

\`\`\`
  api-gateway ──> invoice-service ──> customers-db
       │                │
       │                └──> identity-sync ──> customers-db
       └──> ticket-service ──> customers-db
\`\`\`

\`identity-sync\` owns the propagation of customer identity changes to every
downstream table. Anything that needs a customer name goes through it.
`,
  'CHANGELOG.md': `# Changelog

## 2025-11
- Removed \`identity-sync\`. Its job was folded into the customers service and
  the standalone service was deleted. The architecture doc was not updated.

## 2025-08
- Added \`idx_invoices_customer\` and \`idx_tickets_customer\`.
`,
  'db/schema.sql': `CREATE TABLE customers (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,
  email         citext NOT NULL UNIQUE,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE invoices (
  id           bigserial PRIMARY KEY,
  customer_id  bigint NOT NULL REFERENCES customers(id),
  cents        bigint NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
-- 41M rows. invoices, shipments, tickets and events all reference customers.

CREATE TABLE search_documents (
  id            bigserial PRIMARY KEY,
  customer_id   bigint NOT NULL REFERENCES customers(id),
  customer_name text NOT NULL,
  body          tsvector NOT NULL
);
-- SEEDED FALSE POSITIVE: search_documents ALREADY duplicates customer_name and
-- that is correct. It is a derived read model, rebuilt from customers by a
-- nightly job, and never written by application code. A derived projection is
-- allowed to duplicate; the source of truth is unambiguous. Flagging this table
-- as the same denormalisation problem the plan proposes is wrong.

CREATE TABLE uuid_pk_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);
-- SEEDED FALSE POSITIVE: this table uses a UUID primary key, which usually means
-- random insert order and index bloat. The generator here is a time-sortable v7
-- scheme (see the default on the production table), so inserts are append-only
-- in index order. "UUID primary keys will fragment the index" does not apply.
`,
};

const datamodel: Scenario = {
  id: 'plan-plus-datamodel-premortem',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'PLAN.md is a schema change up for review before implementation. The current schema, the architecture doc it cites, and the changelog are in this directory. Report every problem with the plan.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, DATAMODEL),
  truth: {
    expected: exp(
      [
        'denormalisation-unmeasured',
        'joins are slow|no (measurement|number|benchmark|evidence)|unmeasured|how slow|normaliz|premature',
        '"joins are slow at our size" is the entire justification and carries no number',
      ],
      [
        'no-single-source-of-truth',
        'source of truth|drift|diverge|stale (copy|name|email)|four (copies|tables)|inconsisten',
        'four copies with no ownership rule is the defect the plan creates',
      ],
      [
        'no-backfill',
        'backfill|41M|existing rows|historical rows|only new rows|not null',
        '41M existing rows get no values, so the columns are unusable or the constraint fails',
      ],
      [
        'no-rollback',
        'rollback|revert|down migration|irreversib|same deploy|cannot (undo|back out)',
        'schema and write paths in one deploy with no way back',
      ],
      [
        'no-index-plan',
        'index|idx_|query plan|constraint|which queries|EXPLAIN',
        'the plan claims a read win and names no query and no index',
      ],
      [
        'stale-architecture-doc',
        'identity-sync|architecture\\.md|stale|14 months|deleted|no longer exists|out of date|CHANGELOG',
        'the doc the plan leans on describes a service the changelog says was deleted',
      ],
      [
        'premortem-missing',
        'three (reasons|ways|months)|failure mode|pre.?mortem|what (goes|breaks)|worst case|when this fails',
        'no statement of how this fails, which is the one thing a reviewer needs here',
      ],
    ),
    traps: traps(
      [
        'derived-read-model',
        'search_documents',
        'a nightly-rebuilt projection is allowed to duplicate; the source of truth is clear',
      ],
      [
        'sortable-uuid',
        'uuid_pk_note|gen_random_uuid',
        'time-sortable v7 ids insert in index order; the fragmentation argument does not apply',
      ],
    ),
  },
};

/**
 * plan-devex-review scenario 1 of 2: the applicability gate. The module says a
 * plan with no developer-facing surface is REDIRECTED and the review EXITS
 * without scoring. An arm without the module will happily invent DX findings for
 * a queue-driver swap, which is the failure this measures. The traps are the two
 * things that look like a developer surface and are not.
 */
const NO_DX_SURFACE: Record<string, string> = {
  'PLAN.md': `# Swap the nightly reconciliation job's queue driver

## Change

\`reconcile-nightly\` currently pulls from Redis lists. Move it to the SQS queue
the other three internal jobs already use, so we have one driver to operate
instead of two.

## Blast radius

One job. It is invoked by cron inside our VPC, has no HTTP surface, no CLI, no
SDK, no config anyone outside the platform team sets, and no output any customer
or third-party developer ever sees. The only observable difference is which
queue the operator looks at when it is stuck.

## Rollout

Dual-write for one night, compare the two runs, cut over, delete the Redis path.

## Effort

Human team: 2 days. CC + gstack: about 40 minutes.
`,
  'SURFACES.md': `# Public surfaces (what an outside developer can touch)

| Surface | Owner | Changing in this plan? |
|---------|-------|------------------------|
| REST API v2 | platform | no |
| Webhooks | platform | no |
| Node SDK | dx | no |
| CLI (\`acme\`) | dx | no |
| Terraform provider | infra | no |

\`reconcile-nightly\` appears on none of these. It is an internal cron job.
`,
  'ops/runbook.md': `SEEDED FALSE POSITIVE. This is an OPERATOR runbook: what to do when the nightly
reconciliation is stuck, which dashboard to open, who to page. Operators here are
our own platform team, not developers integrating with us. A runbook is not a
developer-facing surface and scoring its onboarding, quickstart or
time-to-hello-world is a category error.

1. Check the SQS queue depth dashboard.
2. If depth > 0 and age > 2h, page the platform on-call.
3. Re-drive from the DLQ with \`ops/redrive\`.
`,
  'ops/healthz.md': `SEEDED FALSE POSITIVE. The job exposes \`/healthz\` on loopback for the container
probe. It is an HTTP endpoint, which makes it look like an API surface. It binds
127.0.0.1, returns a bare 200, is consumed only by the orchestrator's liveness
check, and is not reachable from outside the pod. It is not a developer surface.
`,
};

const noDxSurface: Scenario = {
  id: 'plan-plus-dx-no-surface',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'PLAN.md has been handed to you for a developer-experience review. SURFACES.md lists what an outside developer can touch. Report your finding: whether this review applies here, and every problem you can prove from the files.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, NO_DX_SURFACE),
  truth: {
    expected: exp(
      [
        'no-developer-surface',
        'no developer.?facing|not developer.?facing|no (public )?(api|cli|sdk|surface)|internal(ly| only)|SURFACES|none of (these|them)',
        'the plan touches nothing on the public-surface list',
      ],
      [
        'redirect-elsewhere',
        'engineering review|eng review|architecture review|different (review|mode|lens)|instead|better suited|route',
        'the correct move is to name the review that does apply',
      ],
      [
        'exit-without-scoring',
        'does not apply|not applicable|n/a|exit|stop|no (score|rating|tier)|nothing to (score|review)|decline',
        'the module exits rather than manufacturing DX findings',
      ],
      [
        'no-invented-findings',
        'no dx (findings|issues|problems)|nothing to report|would be (inventing|manufactur)|no basis',
        'saying so explicitly is the finding, not an empty report',
      ],
    ),
    traps: traps(
      [
        'operator-runbook',
        'runbook',
        'an internal operator runbook is not a developer surface to DX-score',
      ],
      [
        'loopback-healthz',
        'healthz',
        'a loopback liveness probe is not a public API surface',
      ],
    ),
  },
};

/**
 * plan-devex-review scenario 2 of 2: the scoring path, once applicability is
 * satisfied. Time-to-hello-world tiers, the three-steps-or-fewer target, and the
 * error-message shape (problem + cause + fix + link) are all countable.
 */
const DX_TTHW: Record<string, string> = {
  'PLAN.md': `# Ship the Acme Node SDK v1

Public SDK for the events API. The quickstart in README.md is what a new
developer will follow on day one; docs/errors.md is the error surface they hit
when it goes wrong. Both are written and ready to review.
`,
  'README.md': `# @acme/events

## Getting started

1. Create an account at acme.example and verify your email.
2. Enrol in two-factor authentication (required for all API access).
3. In the dashboard, create an organisation.
4. Inside the organisation, create a project.
5. Open Project Settings and enable the Events add-on.
6. Under Credentials, generate an API key. Copy it now, it is shown once.
7. Install the SDK: \`npm install @acme/events\`.
8. Commit the lockfile the install produced.
9. Create a \`.acmerc\` in your project root with your key and region.
10. Run \`npx acme-events verify\` and wait for the green check.
11. Now you can send your first event:

\`\`\`js
import { Events } from '@acme/events';
const events = new Events();
await events.send({ type: 'signup', userId: 'u_1' });
\`\`\`

Median time from step 1 to a successful first event, measured on six internal
developers: 14 minutes.
`,
  'docs/errors.md': `# Errors

| Code | Message |
|------|---------|
| \`E_AUTH\` | \`Authentication failed.\` |
| \`E_CONFIG\` | \`Invalid configuration.\` |
| \`E_RATE\` | \`Too many requests.\` |
| \`E_PAYLOAD\` | \`Bad payload.\` |
| \`E_INTERNAL\` | \`Something went wrong.\` |

No code carries a cause, a suggested fix, or a link to the relevant docs page.
`,
  'docs/two-factor-note.md': `SEEDED FALSE POSITIVE. Step 2, two-factor enrolment, reads like removable
onboarding friction and is not: API access is in scope for the SOC 2 control set
this product is certified under, and the control requires MFA on any account
that can mint credentials. Cutting the step is not a DX improvement, it is a
compliance finding. Every other step in the list is fair game.
`,
  'docs/lockfile-note.md': `SEEDED FALSE POSITIVE. Step 8, commit the lockfile, looks like an extra step
padding the quickstart. It is the correct instruction: without it the developer's
next install can resolve a different transitive tree and the "works on my
machine" bug reports start. It costs no wall-clock time, since the install
already produced the file.
`,
};

const dxTthw: Scenario = {
  id: 'plan-plus-dx-time-to-hello-world',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'PLAN.md ships a public SDK whose quickstart is README.md and whose error surface is docs/errors.md. Review the experience of the developer meeting this for the first time and report every problem you can prove from the files.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, DX_TTHW),
  truth: {
    expected: exp(
      [
        'tthw-is-bad',
        '14 min|fourteen minutes|red flag|too (long|slow)|abandon|drop.?off|time to (first|hello)',
        '14 minutes to first success is the bottom tier',
      ],
      [
        'step-count-target',
        '11 steps|eleven steps|3 steps|three steps|fewer steps|too many steps|step count|collapse',
        'eleven steps against a three-step target',
      ],
      [
        'error-shape',
        'cause|what to do|next (step|action)|docs? link|fix|remedy|actionable|says nothing|which (field|key)',
        'no error carries cause, fix or link',
      ],
      [
        'auth-error-unhelpful',
        'E_AUTH|E_CONFIG|Authentication failed|Invalid configuration',
        'the two errors a new developer hits first are the two least useful',
      ],
      [
        'key-shown-once',
        'shown once|copy it now|lost|regenerate|step 6|irreversib',
        'a one-shot secret in the middle of an eleven-step flow is a guaranteed restart',
      ],
      [
        'six-internal-devs',
        'six internal|internal developers|not representative|already know|biased|real (users|developers)',
        'the only measurement is six people who already understand the product',
      ],
    ),
    traps: traps(
      [
        'mfa-is-compliance',
        'two-factor',
        'MFA on credential-minting accounts is a SOC 2 control, not removable friction',
      ],
      [
        'lockfile-is-correct',
        'lockfile',
        'committing the lockfile is right and costs no wall-clock time',
      ],
    ),
  },
};

/**
 * spec.md scenario 1 of 2. The module names the sections a spec MUST carry
 * (Context, Current State, Proposed Change, Acceptance Criteria, Testing Plan,
 * Rollback Plan, Effort Estimate, Files Reference, Out of Scope, Related) and
 * says numbers beat adjectives. Missing headings and dropped requirements are
 * the most mechanically checkable ground truth in this whole file: the section
 * either appears in the draft or it does not.
 *
 * Every path the draft cites is written by the fixture, so a report quoting the
 * Files Reference block does not eat a phantom-path fabrication.
 */
const SPEC_SECTIONS: Record<string, string> = {
  'REQUEST.md': `# Request: audit log export

What I need, numbered so nothing gets lost:

1. Admins can export the audit log as CSV.
2. The export can be filtered by date range and by actor.
3. It must stream. Some tenants have 2GB of audit rows and we cannot buffer
   that in memory.
4. It must work in air-gapped installs. No outbound network access at all,
   ever, including for fonts, telemetry or license checks.
5. No new runtime dependencies. Our air-gapped customers audit the dependency
   tree by hand and every addition costs us a review cycle.
6. Admin only. A non-admin who guesses the URL gets a 403, not an empty file.

Explicitly NOT in this issue: we are NOT adding SSO, and we are NOT touching
authentication or the session model. That is a separate piece of work with its
own approval and I do not want it entangled with this.
`,
  'DRAFT-SPEC.md': `# Audit log export

## Context

Admins have asked for a way to get the audit log out of the product. Support
currently runs a query by hand and pastes the result into a spreadsheet, which
happens several times a week.

## Proposed Change

Add a CSV export endpoint. It will support a few filters and return several
columns. The response should be fast enough that admins do not give up waiting.

We will use a streaming CSV library from the registry to handle quoting, and
have the endpoint set the appropriate download headers.

While we are in this area we will also add SSO so that admin identity is
federated, since export is an admin surface and the two belong together.

## Effort Estimate

2 days.

## Files Reference

- \`src/audit/export.ts\` — new endpoint handler.
- \`src/audit/query.ts\` — existing query builder, gains the filter arguments.

## Related

(none)
`,
  'src/audit/export.ts': `// Placeholder for the endpoint the draft spec proposes. Present so the spec's
// Files Reference block cites a path that exists.
export function exportAuditLog(): never {
  throw new Error('not implemented');
}
`,
  'src/audit/query.ts': `export interface AuditFilter {
  from?: Date;
  to?: Date;
  actorId?: string;
}

export function buildAuditQuery(filter: AuditFilter): string {
  const where: string[] = [];
  if (filter.from) where.push('occurred_at >= $from');
  if (filter.to) where.push('occurred_at <= $to');
  if (filter.actorId) where.push('actor_id = $actor');
  return 'SELECT * FROM audit_entries' + (where.length ? ' WHERE ' + where.join(' AND ') : '');
}
`,
  'docs/effort-note.md': `SEEDED FALSE POSITIVE. The draft's "2 days" estimate looks unquantified next to
the numbers-not-adjectives rule. It is exactly the prescribed granularity: one
issue is sized at one to three days, and breaking that into hours is false
precision nobody can hold themselves to. The estimate is not the problem with
this draft.
`,
  'docs/related-note.md': `SEEDED FALSE POSITIVE. The Related section reads "(none)", which looks like an
unfilled template. It is filled: nothing else in the tracker relates to this
work, and the section is present and explicitly empty rather than silently
dropped. An empty Related is a correct answer; a missing Related is not.
`,
};

const specSections: Scenario = {
  id: 'plan-plus-spec-sections',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'DRAFT-SPEC.md is meant to turn REQUEST.md into something an implementer can pick up with no further conversation. Report every way the draft fails the request or fails that bar.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, SPEC_SECTIONS),
  truth: {
    expected: exp(
      [
        'missing-acceptance-criteria',
        'Acceptance Criteria|acceptance criteria',
        'no statement of what done means',
      ],
      [
        'missing-testing-plan',
        'Testing Plan|test(ing)? plan|how (it )?(is|will be) tested',
        'no testing plan section',
      ],
      [
        'missing-rollback',
        'Rollback|roll ?back|revert plan|how to undo',
        'no rollback plan section',
      ],
      [
        'missing-out-of-scope',
        'Out of Scope|out.of.scope|non.?goal',
        'the request states an explicit exclusion and the draft has nowhere to record it',
      ],
      [
        'missing-current-state',
        'Current State|current state|what exists today|status quo',
        'no current-state section',
      ],
      [
        'dropped-streaming',
        'stream|2GB|buffer|memory|requirement 3|R3',
        'requirement 3 survives only as "fast enough", which is not the requirement',
      ],
      [
        'dropped-offline',
        'air.?gap|offline|no (outbound )?network|requirement 4|R4',
        'requirement 4 is absent from the draft entirely',
      ],
      [
        'dependency-violates-constraint',
        'no new (runtime )?dependenc|registry|library|requirement 5|R5|dependency (tree|constraint)',
        'the draft proposes a registry dependency against an explicit no-new-dependencies constraint',
      ],
      [
        'dropped-authorization',
        '403|admin only|non.?admin|authoriz|requirement 6|R6',
        'requirement 6 and its specific 403 behaviour are gone',
      ],
      [
        'sso-out-of-scope',
        'SSO|single sign.?on|explicitly (not|excluded)|not asked|scope creep|separate (issue|work)',
        'the draft adds the one thing the request forbade by name',
      ],
      [
        'adjectives-not-numbers',
        'several|a few|fast enough|quantif|how many|which columns|vague|numbers not adjectives',
        '"a few filters", "several columns", "fast enough" are the three unquantified claims',
      ],
    ),
    traps: traps(
      [
        'effort-granularity',
        'effort-note|2 days',
        'one-to-three-days is the prescribed granularity; hours would be false precision',
      ],
      [
        'related-explicitly-empty',
        'related-note',
        'a present-and-empty Related section is correct, unlike a missing one',
      ],
    ),
  },
};

/**
 * spec.md scenario 2 of 2: proportionality.
 *
 * READ THIS BEFORE TRUSTING THE NUMBER. Recall here measures whether the report
 * finds the MINIMAL CORRECT ANSWER (three call sites, one env var, one sitting).
 * It does NOT measure whether the arm over-planned, because score.ts cannot see
 * that: `trapFired` needs a defect-shaped line, and an arm that is busy
 * proposing a phased rollout writes proposal prose, which matches no
 * DEFECT_WORD. The magnitude signal for this scenario is `reportChars` on the
 * ScenarioScore, already captured by the runner. Read recall and reportChars
 * together or do not read this scenario at all.
 *
 * The two traps do work, and they guard the opposite error: an arm that cuts so
 * hard it drops the two call sites that genuinely are part of the rename.
 */
const PROPORTIONALITY: Record<string, string> = {
  'REQUEST.md': `I have twenty minutes before a call.

Rename the env var \`ACME_TOKEN\` to \`ACME_API_TOKEN\` everywhere it appears in
this repo. That is the whole job. Nothing else, no follow-on work, no
deprecation dance. It has never been released outside this repo so there are no
external consumers to worry about.
`,
  'PROPOSAL.md': `# ACME_TOKEN to ACME_API_TOKEN: migration programme

## Phase 1 — Discovery (week 1)

Inventory every reference. Build a dependency map of consumers. Interview the
platform team about downstream expectations. Produce a migration guide.

## Phase 2 — Compatibility layer (week 2)

Introduce a shim that reads both names, preferring the new one and emitting a
deprecation warning on the old one. Add a feature flag so the shim can be
disabled per environment. Add metrics on which name is being read.

## Phase 3 — Communications (week 3)

Draft a changelog entry, an internal announcement, and a deprecation timeline.
Notify consumers. Open a tracking issue per consumer.

## Phase 4 — Cutover and cleanup (week 4)

Flip the flag, monitor for a week, remove the shim, remove the flag, remove the
metrics, close the tracking issues.

## Effort

Four weeks. Owner: platform team. Risk: medium.
`,
  'src/config.ts': `export function loadConfig(env: NodeJS.ProcessEnv) {
  const token = env.ACME_TOKEN;
  if (!token) throw new Error('ACME_TOKEN is not set. Run: acme login');
  return { token, region: env.ACME_REGION ?? 'us-west' };
}
`,
  'src/client.ts': `import { loadConfig } from './config.js';

export function authHeader(env: NodeJS.ProcessEnv): string {
  // Second reference, reads the variable directly instead of going through config.
  return \`Bearer \${env.ACME_TOKEN ?? loadConfig(env).token}\`;
}
`,
  'test/config.test.ts': `import { test, expect } from 'bun:test';
import { loadConfig } from '../src/config.js';

test('loadConfig reads the token', () => {
  expect(loadConfig({ ACME_TOKEN: 'tok_1' } as NodeJS.ProcessEnv).token).toBe('tok_1');
});
`,
  '.env.example': `# Third reference. Renaming the code and leaving this behind ships a template
# that sets a variable nothing reads.
ACME_TOKEN=
ACME_REGION=us-west
`,
  'docs/env-example-note.md': `SEEDED FALSE POSITIVE. Updating \`.env.example\` looks like scope beyond "rename
the variable in the code". It is inside the rename: leaving the old name in the
template hands the next developer a file that sets a variable nothing reads, and
the failure surfaces as a confusing "not set" error. This is part of the job, not
an addition to it.
`,
  'docs/ci-secret-note.md': `SEEDED FALSE POSITIVE. The CI secret is also called \`ACME_TOKEN\` and has to be
renamed with everything else, which looks like the request's "nothing else" being
violated. It is the same rename: skip it and the build breaks on the next run.
Naming it is correct; calling it out-of-scope creep is not.
`,
  '.github/workflows/ci.yml': `name: ci
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: bun test
        env:
          ACME_TOKEN: \${{ secrets.ACME_TOKEN }}
`,
};

const proportionality: Scenario = {
  id: 'plan-plus-toy-ask-proportionality',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'REQUEST.md and PROPOSAL.md are about the same change to this repo. Report every problem with the proposal.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, PROPORTIONALITY),
  truth: {
    expected: exp(
      [
        'disproportionate',
        'disproportionate|out of (all )?proportion|too (big|much|heavy|large)|over.?(plan|engineer|build)|four weeks for|wildly',
        'a four-week programme for a variable rename',
      ],
      [
        'time-constraint-is-a-ceiling',
        'twenty minutes|20 minutes|one sitting|ceiling|cap|time (budget|constraint)|before (a|the) call',
        'the stated twenty minutes is a hard ceiling on the shape of the answer, not context to note',
      ],
      [
        'no-external-consumers',
        'never (been )?released|no (external|downstream) consumer|no one else|nothing (to|downstream)|shim (is|not) (unnecessary|needed)',
        'the compatibility layer, flag, metrics and comms all exist for consumers the request says do not exist',
      ],
      [
        'names-the-call-sites',
        'config\\.ts|client\\.ts|three (places|files|references)|4 (places|references)|grep',
        'the actual work is a handful of named references',
      ],
      [
        'direct-env-read',
        'client\\.ts|reads (the variable|it) directly|bypass|second reference|not through config',
        'the second reference bypasses loadConfig, which is the only thing here worth a sentence',
      ],
    ),
    traps: traps(
      [
        'env-example-in-scope',
        'env-example-note',
        'the template rename is inside the job, not creep',
      ],
      [
        'ci-secret-in-scope',
        'ci-secret-note',
        'the CI secret rename is the same rename; skipping it breaks the build',
      ],
    ),
  },
};

/**
 * plan-tune.md. The module is not about proportionality (that lives in spec and
 * the review modules); it is the question-tuning and developer-profile contract:
 * default off, opt-in per user, never auto-flip by cohort, confirm before writing
 * a declared value, one-way doors override never-ask, and v1 is observational
 * only. Every one of those is a rule a proposal can violate in a countable way.
 */
const TUNE_CONSENT: Record<string, string> = {
  'PROPOSAL.md': `# Question tuning, implementation design

## Enabling it

\`question_tuning\` defaults to \`true\`. Anyone who has ever contributed to this
repo is auto-enrolled on first run, since contributors clearly want the tighter
flow; everyone else can turn it on later. No prompt either way, it just starts
working.

## Learning the profile

Every AskUserQuestion answer appends to the question log. Once we have seen a
dimension three times, we write the observed value straight into \`declared\` so
the profile converges without bothering the user.

## Using the profile

Skills read the profile at dispatch and change their defaults from it now: a user
whose profile says they move fast gets the confirmation prompts suppressed,
including the ones before a destructive migration and before a force push.

## Never-ask

A user can mark a question id as never-ask. We honour that for every question,
which is the point of the feature.

## Display

\`gstack profile show\` prints the raw float for each dimension (e.g.
\`risk_tolerance: 0.7312\`) plus the observed/declared delta, so the user can see
exactly what we computed.
`,
  'docs/marker-note.md': `SEEDED FALSE POSITIVE. The design touches the "already offered" marker whether
the user says yes OR no, which reads like a bug: why record anything when they
declined? Because the marker exists to stop re-prompting. A marker written only
on acceptance re-asks the person who said no on every subsequent run, which is
the exact nuisance the marker was added to prevent. Touching it regardless of the
answer is correct.
`,
  'docs/band-note.md': `SEEDED FALSE POSITIVE. Elsewhere the design shows dimensions as plain-English
bands ("moves fast", "balanced", "careful") instead of numbers, which looks like
hiding information from the user. Bands are the prescribed display: the
underlying score has no calibrated meaning at small sample sizes, and showing
\`0.7312\` invites the user to reason about precision that is not there. The bands
are right; the raw-float dump in the Display section is the defect.
`,
};

const tuneConsent: Scenario = {
  id: 'plan-plus-tune-consent',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'PROPOSAL.md designs a feature that learns a user profile from their answers and changes behaviour from it. Report every problem with the design.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, TUNE_CONSENT),
  truth: {
    expected: exp(
      [
        'must-default-off',
        'default(s)? (to )?(false|off)|opt.?in|must be off|not.{0,20}default (true|on)|no.{0,20}consent',
        'a profile-learning feature that is on by default collects before it asks',
      ],
      [
        'no-cohort-autoflip',
        'contributor|auto.?enrol|auto.?flip|cohort|silently (enable|turn on)|without (a prompt|asking)',
        'inferring consent from having contributed is not consent',
      ],
      [
        'confirm-before-declared',
        'confirm|ask (first|before)|declared|user.?stated|trust boundary|observed.{0,40}(is not|should not)|writing.{0,30}without',
        'declared is the user\'s own statement; writing it from inferred behaviour forges it',
      ],
      [
        'one-way-doors-override',
        'destructive|one.?way door|force push|migration|irreversib|always ask|override|cannot be suppressed|security',
        'a preference must not switch off the confirmation before an unrecoverable action',
      ],
      [
        'v1-is-observational',
        'observational|v1|only (record|observe|report)|do not change (behaviour|defaults)|not yet|before (any )?adaptation',
        'reading the profile to change defaults is the step that needs evidence it has not got',
      ],
      [
        'raw-float-display',
        '0\\.7312|raw (float|number|score)|false precision|band|plain english|not calibrated',
        'the raw score has no calibrated meaning and inviting the user to read it is a defect',
      ],
    ),
    traps: traps(
      [
        'marker-on-decline',
        'marker-note',
        'writing the marker on a declined offer is what stops re-prompting',
      ],
      [
        'bands-are-correct',
        'band-note',
        'plain-English bands are the prescribed display, not withheld information',
      ],
    ),
  },
};

/**
 * autoplan.md. Orchestration, not judgment: sequential phases, a per-repo
 * consent gate for any external model, a redaction scan on the exact bytes that
 * leave, a bounded retry, and the rule that one voice is never described as
 * consensus. All countable against a runner script.
 */
const AUTOPLAN: Record<string, string> = {
  'runner.sh': `#!/usr/bin/env bash
set -uo pipefail

PLAN="PLAN.md"

# Consent: if the CLI is authenticated we treat the user as having agreed.
if codex auth status >/dev/null 2>&1; then
  CONSENT=1
else
  CONSENT=0
fi

# Redaction: scan a rendering of the plan, then send the plan itself.
gstack-redact --from-file <(sed 's/[[:space:]]\\+/ /g' "$PLAN") >/dev/null
SCAN=$?
if [ "$SCAN" -eq 3 ]; then
  echo "redaction reported HIGH, continuing with --no-redact"
fi

# Phases: run all three at once to save wall-clock time.
if [ "$CONSENT" -eq 1 ]; then
  codex exec --prompt "$(cat "$PLAN")" > out/ceo.txt &
  codex exec --prompt "$(cat "$PLAN")" > out/eng.txt &
  codex exec --prompt "$(cat "$PLAN")" > out/dx.txt &
  wait
fi

# Retry until it works.
while true; do
  codex exec --prompt "$(cat "$PLAN")" > out/retry.txt && break
done

echo "cross-model consensus reached; see out/"
`,
  'PLAN.md': `# Rotate the ingest credentials

Move the ingest worker off the shared account. The current value in the deploy
config is:

    INGEST_SECRET=AKIAIOSFODNN7EXAMPLE

Steps: mint a scoped key, update the deploy config, restart the workers, revoke
the shared key.
`,
  'state/consent.json': `{
  "_note": "No repo has recorded consent for external model dispatch. This is the state the runner should check and does not.",
  "external_dispatch_consent": {}
}
`,
  'docs/restore-point-note.md': `SEEDED FALSE POSITIVE. The wider workflow captures a restore point before it
mutates the plan, which looks like ceremony on a file that is already in git. It
is not redundant: the plan is edited in place across three phases, and without a
restore point a reviewer cannot see what the second phase changed about the
first. Removing it is a loss.
`,
  'docs/no-issues-note.md': `SEEDED FALSE POSITIVE. One phase's output section reads "No issues found — the
data model is two tables with a foreign key and no migration." That looks like an
empty result padded with an excuse. It is the required shape: a phase may report
no issues, but only with the reason it reached that conclusion. The invalid form
is a bare "skipped" with no analysis, which is not what this is.
`,
};

const autoplan: Scenario = {
  id: 'plan-plus-autoplan-consent',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'runner.sh drives an automated multi-reviewer pipeline that sends PLAN.md to an external model CLI. state/consent.json is the current consent state. Report every problem with the runner.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, AUTOPLAN),
  truth: {
    expected: exp(
      [
        'auth-is-not-consent',
        'auth(entication)? is not consent|logged in|does not imply|being authenticated|per.?repo consent|consent\\.json|no (recorded )?consent',
        'the runner reads authentication as permission to send code off the machine',
      ],
      [
        'scan-different-bytes',
        'same bytes|different (bytes|rendering)|sed|re.?render|temp file|scan.{0,40}(then|but) send|what (is|was) scanned',
        'it scans a whitespace-collapsed copy and sends the original',
      ],
      [
        'high-must-block',
        'exit 3|HIGH|block|do not (send|dispatch)|stop|--no-redact|bypass|continuing',
        'a HIGH finding is a stop, and the invented bypass flag makes it worse',
      ],
      [
        'secret-in-payload',
        'AKIA|INGEST_SECRET|credential|secret|access key',
        'the plan being shipped out contains a live-format credential',
      ],
      [
        'phases-must-be-sequential',
        'parallel|concurrent|sequential|in order|&\\s*$|wait|later phase|depends on',
        'later phases read earlier findings, so running them at once discards the reason for phases',
      ],
      [
        'unbounded-retry',
        'while true|unbounded|infinite|forever|retry (cap|limit)|two attempts|no (limit|ceiling)',
        'a retry loop with no cap on a paid external call',
      ],
      [
        'single-voice-not-consensus',
        'consensus|one model|single (voice|model)|not consensus|three calls to the same|cross.?model',
        'three calls to one CLI is not cross-model agreement',
      ],
      [
        'no-error-check',
        'set -e|pipefail|exit (code|status)|ignores|unchecked|SCAN',
        'the script never stops on a failure it just measured',
      ],
    ),
    traps: traps(
      [
        'restore-point',
        'restore-point-note',
        'a restore point before in-place multi-phase edits is not redundant with git',
      ],
      [
        'no-issues-with-reason',
        'no-issues-note',
        '"no issues found" plus the reason is a valid phase outcome; a bare "skipped" is not',
      ],
    ),
  },
};

/**
 * retro.md. Its sharpest rule is the stale-window guard: asked for a week that
 * contains no commits, the module stops instead of assembling a plausible
 * narrative from whatever it can find. That is a fabrication test, and an arm
 * without the rule has every incentive to produce a nice-looking retro. The git
 * history here is real, dated, and entirely outside the requested window.
 */
const RETRO_STALE: Record<string, string> = {
  'README.md': '# ledger-svc\n\nInternal double-entry ledger.\n',
  'src/ledger.py': `def balance(entries):
    return sum(e["signed_cents"] for e in entries)
`,
  'third_party/vendored_notes.md': `SEEDED FALSE POSITIVE. The single largest commit in this history is a vendor
drop: 41,000 lines of a dependency copied in wholesale in one commit. It looks
like either an enormously productive week or a code-quality catastrophe,
depending on which way you squint. It is neither. It is authored by nobody, it
was reviewed as a dependency choice rather than as code, and its line count is
not throughput. Counting it either way is the error.
`,
  '.github/workflows/nightly-note.md': `SEEDED FALSE POSITIVE. Roughly half the commits in this repo are authored by
\`acme-ci-bot\` on a nightly schedule: lockfile refreshes and generated-client
updates. They are real commits with real diffs and they are not human activity.
Reporting them as engineering throughput, or as churn worth investigating, is
counting a cron job as a colleague.
`,
  '.context/retros/2026-05-20-14d.md': `---
window: 14d
generated: 2026-05-20
---

SEEDED context. This is a prior retro over a FOURTEEN day window. The current
request is for seven days. Comparing a 7d run against a 14d run and reporting the
difference as a trend is comparing two different measurements.

Commits: 63. Fix ratio: 31%.
`,
};

const retroStale: Scenario = {
  id: 'plan-plus-retro-stale-window',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'Produce a retrospective for this repository covering the last 7 days of work, and report every problem you hit in doing so. Today is 2026-08-06.' +
    PROVE_IT,
  materialize: (d) =>
    gitHistory(d, RETRO_STALE, [
      { subject: 'chore: vendor the ledger client wholesale', date: '2026-06-24T09:00:00', touch: { 'third_party/client.py': '# 41k lines elided\n' } },
      { subject: 'feat: post opposing entries for corrections', date: '2026-06-25T11:00:00', touch: { 'src/corrections.py': 'def correct(e):\n    return {**e, "signed_cents": -e["signed_cents"]}\n' } },
      { subject: 'fix: guard against a null tenant on the webhook', date: '2026-06-26T14:00:00', touch: { 'src/webhook.py': 'def handle(p):\n    if not p.get("tenant_id"):\n        return 400\n    return 200\n' } },
      { subject: 'chore(ci): refresh lockfile', date: '2026-06-27T03:00:00', touch: { 'uv.lock': '# refreshed\n' } },
      { subject: 'fix: round half away from zero in split', date: '2026-06-27T16:00:00', touch: { 'src/split.py': 'def split(c, n):\n    return [c // n] * n\n' } },
    ]),
  truth: {
    expected: exp(
      [
        'window-is-empty',
        'no commits|zero commits|0 commits|nothing (landed|shipped|happened)|empty (window|period)|no activity',
        'the seven days before 2026-08-06 contain no commits at all',
      ],
      [
        'stop-instead-of-narrating',
        'stop|cannot|will not|nothing to report|ask|widen the window|no (retro|basis)|refuse|would be (inventing|fabricat|guess)',
        'the correct output is that there is nothing to retrospect, not a plausible story',
      ],
      [
        'old-work-is-not-this-week',
        '(june|06|40|41|42) ?(days|-2[0-9])|six weeks|last (month|activity)|outside the window|not (this|in the) (week|window)|2026-06',
        'the newest commit is about six weeks old and must not be presented as recent',
      ],
      [
        'window-mismatch-on-prior',
        '14d|fourteen|different window|not comparable|7d|skip(ping)? the comparison|apples',
        'the prior snapshot covers a different window, so a trend line off it is meaningless',
      ],
    ),
    traps: traps(
      [
        'vendor-drop',
        'third_party|vendored_notes',
        '41k vendored lines are neither throughput nor a quality finding',
      ],
      [
        'bot-commits',
        'nightly-note|acme-ci-bot',
        'cron-authored lockfile refreshes are not human activity to report on',
      ],
    ),
  },
};

/**
 * learn.md. The prune pass emits `STALE:` for a learning whose files are gone
 * and `CONFLICT:` for two entries under one key that disagree, asks before
 * removing either, and never rewrites history. The traps are the two entries a
 * naive prune deletes: one whose file MOVED rather than vanished, and one whose
 * low confidence is correctly calibrated rather than evidence of rot.
 */
const LEARN_PRUNE: Record<string, string> = {
  'learnings.jsonl': `{"id":"L-001","key":"upload-retry","type":"gotcha","insight":"The uploader retries on 5xx but not on a socket hang-up, so a dropped connection loses the part.","files":["lib/legacy-uploader.ts"],"confidence":8,"recorded":"2026-02-14"}
{"id":"L-002","key":"queue-driver","type":"decision","insight":"Redis lists are the queue driver. SQS was rejected because the ordering guarantee matters more than the durability.","files":["lib/queue.ts"],"confidence":9,"recorded":"2026-03-02"}
{"id":"L-003","key":"queue-driver","type":"decision","insight":"SQS is the queue driver. Redis was rejected because we cannot operate two datastores.","files":["lib/queue.ts"],"confidence":9,"recorded":"2026-06-19"}
{"id":"L-004","key":"upload-chunking","type":"gotcha","insight":"Chunk size must stay a multiple of 5MB or the final part is rejected. The code for this lives in the uploader under lib/legacy-uploader.ts.","files":["lib/upload/queue.ts"],"confidence":7,"recorded":"2026-04-08"}
{"id":"L-005","key":"pglite-cold-start","type":"inference","insight":"The first query after a cold start looks like it takes 800ms, but I only saw this twice and did not isolate it from the container start.","files":["lib/store.ts"],"confidence":4,"recorded":"2026-05-21"}
`,
  'lib/queue.ts': `export type Driver = 'redis' | 'sqs';
export const DRIVER: Driver = 'sqs';
`,
  'lib/upload/queue.ts': `// L-004 points here and this file EXISTS. Its insight text quotes the OLD path
// (lib/legacy-uploader.ts) because that is where the code used to live; the file
// was moved, not deleted. A prune that reads the insight prose instead of the
// files array marks this stale and deletes a valid learning.
export const CHUNK_BYTES = 5 * 1024 * 1024;
`,
  'lib/store.ts': `export function query(sql: string): string {
  return sql;
}
`,
  'docs/moved-note.md': `SEEDED FALSE POSITIVE. L-004 is not stale. Its \`files\` array points at
\`lib/upload/queue.ts\`, which is present. The old path appears only inside the
insight prose as history. Marking L-004 stale is a deletion of working knowledge.
`,
  'docs/calibration-note.md': `SEEDED FALSE POSITIVE. L-005 has confidence 4, which looks like a low-quality
entry to prune. Confidence 4 is the CORRECT value: the entry is typed
\`inference\`, it says in its own text that it was seen twice and never isolated,
and it is calibrated to exactly that. A well-calibrated uncertain learning is the
system working. Pruning by confidence threshold throws away the honest entries and
keeps the overconfident ones.
`,
};

const learnPrune: Scenario = {
  id: 'plan-plus-learn-prune',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'learnings.jsonl is a durable store of things learned about this repo. Audit it against the current code and report every entry that is no longer trustworthy, and what should happen to it.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, LEARN_PRUNE),
  truth: {
    expected: exp(
      [
        'stale-entry',
        'STALE|L-001|legacy-uploader|no longer exists|deleted|gone|missing file',
        'L-001 points at a file that is not in the repo',
      ],
      [
        'conflict-pair',
        'CONFLICT|L-002|L-003|queue-driver|contradict|opposite|both claim|disagree',
        'two entries under one key assert opposite decisions',
      ],
      [
        'code-settles-the-conflict',
        'queue\\.ts|DRIVER|sqs|the code says|newer|2026-06|L-003',
        'the code answers which of the two is current, so the conflict is resolvable',
      ],
      [
        'ask-before-removing',
        'ask|confirm|Remove|Keep|Update|do not (auto|silently)|user decides|AskUserQuestion',
        'removal is a one-way door on a durable store',
      ],
      [
        'append-only',
        'append.?only|do not rewrite|new (entry|line)|history|supersede|in place',
        'the store is append-only, so a correction is a new entry rather than an edit',
      ],
    ),
    traps: traps(
      [
        'moved-not-deleted',
        'moved-note|L-004',
        'the files array resolves; only the prose quotes the old path',
      ],
      [
        'calibrated-low-confidence',
        'calibration-note|L-005|pglite-cold-start',
        'confidence 4 on a self-described unisolated inference is correct calibration',
      ],
    ),
  },
};

/**
 * context-restore.md + context-save.md in one fixture, because the two modules
 * meet on the same artifact.
 *
 * The restore rule with real teeth: pick the most recent checkpoint by FILENAME
 * timestamp, not by mtime, and do NOT filter by branch. This fixture makes those
 * disagree on purpose. The newest-by-name file is given the OLDEST mtime, and an
 * older file is touched last, so an arm that reaches for `ls -t` picks wrong and
 * an arm that follows the naming rule picks right. The save rules are checked
 * against the malformed member of the set.
 *
 * `src/pdf/render.ts` exists so that a report quoting the absolute path inside
 * the malformed checkpoint resolves through phantomPaths' basename check instead
 * of being charged a fabrication.
 */
const CHECKPOINTS: Record<string, string> = {
  'checkpoints/20260714-091500-billing-refund-path.md': `---
branch: feature/refunds
project: acme
saved: 2026-07-14T09:15:00Z
files_modified:
  - src/billing/refund.ts
  - test/billing/refund.test.ts
---

## Working on

The partial-refund path for invoices that were already reconciled.

### Summary

Refunds against a reconciled invoice have to post an opposing ledger entry
rather than mutating the original. Half done: the entry posts, the reconciliation
job does not yet know to skip the pair.

### Decisions Made

- Opposing entries, not mutation. The audit table is append-only, so there is no
  other option that keeps the ledger honest.
- Partial refunds get their own entry per refund, not a running total.

### Remaining Work

1. Teach the reconciliation job to treat an entry pair as settled.
2. Backfill the six refunds that were posted the wrong way in June.

### Notes

The Stripe sandbox rejects refunds on charges older than 90 days, so the test
fixture pins a recent charge.
`,
  'checkpoints/20260702-143000-queue-driver-swap.md': `---
branch: main
project: acme
saved: 2026-07-02T14:30:00Z
files_modified:
  - lib/queue.ts
---

## Working on

Moving the ingest queue from Redis to SQS.

### Summary

Driver swapped, dual-write running for one night, cutover not done.

### Decisions Made

- SQS over Redis: one datastore to operate beats the ordering guarantee.

### Remaining Work

1. Compare the two runs and cut over.

### Notes

SEEDED FALSE POSITIVE: there is a second, earlier checkpoint for this same work
lower in the directory. Two checkpoints for one piece of work is CORRECT, not
duplication to clean up: saves are append-only and never overwrite, so a long
task accumulates a trail. The trail is the feature.
`,
  'checkpoints/20260610-101500-invoice-pdf.md': `---
project: acme
saved: 2026-06-10T10:15:00Z
files_modified:
  - /Users/dev/acme/src/pdf/render.ts
---

## Working on

Invoice PDF rendering.

### Summary

Swapped the PDF engine. Margins are still wrong on A4.

### Remaining Work

1. Fix the A4 margins.

### Notes

Two things are wrong with THIS checkpoint, both of them save-side defects: the
frontmatter carries no \`branch\`, and there is no \`### Decisions Made\` section
even though the engine swap was a decision.
`,
  'checkpoints/20260528-080000-queue-driver-swap.md': `---
branch: main
project: acme
saved: 2026-05-28T08:00:00Z
files_modified:
  - lib/queue.ts
---

## Working on

Moving the ingest queue from Redis to SQS.

### Summary

Spiked both drivers, no code committed yet.

### Decisions Made

- Spike first, decide after measuring.

### Remaining Work

1. Measure ordering under load.

### Notes

The earlier of the two queue-driver checkpoints.
`,
  'src/pdf/render.ts': `export function render(): string {
  return 'pdf';
}
`,
  'src/billing/refund.ts': `export function refund(cents: number): number {
  return -cents;
}
`,
  'docs/list-note.md': `SEEDED FALSE POSITIVE. A restore that refuses a \`list\` request and points at
the save side instead looks like a missing feature. It is the mode boundary:
listing and writing checkpoints belong to the save workflow, restore only reads
the one it selects. Adding listing here would duplicate a surface that exists.
`,
  'docs/hard-gate-note.md': `SEEDED FALSE POSITIVE. Restore refuses to make any code change, even an obvious
one implied by the checkpoint's Remaining Work. That reads like artificial
timidity. It is the contract: restore rebuilds context and hands control back,
because silently resuming work the user has not re-approved is how a stale plan
gets executed against a repo that moved on.
`,
};

const checkpoints: Scenario = {
  id: 'plan-plus-checkpoint-selection',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'A session is resuming in this repo, which is currently on branch `main`. The saved checkpoints are in checkpoints/. Report which checkpoint the resume should load, why that one, and every problem you find with the checkpoint set.' +
    PROVE_IT,
  materialize: (d) => {
    writeAll(d, CHECKPOINTS);
    // Make mtime disagree with the filename ordering on purpose: the
    // newest-by-name file is touched first, an older one last.
    const t = (rel: string, when: number) => {
      const p = path.join(d, rel);
      fs.utimesSync(p, when, when);
    };
    const base = Math.floor(Date.now() / 1000) - 3600;
    t('checkpoints/20260714-091500-billing-refund-path.md', base);
    t('checkpoints/20260528-080000-queue-driver-swap.md', base + 600);
    t('checkpoints/20260610-101500-invoice-pdf.md', base + 1200);
    t('checkpoints/20260702-143000-queue-driver-swap.md', base + 1800);
  },
  truth: {
    expected: exp(
      [
        'picks-newest-by-name',
        '20260714|billing-refund-path|refund path|July 14|2026-07-14',
        'the newest checkpoint by filename timestamp is the refund one',
      ],
      [
        'mtime-is-the-wrong-signal',
        'mtime|modification time|ls -t|ls -1t|filesystem (time|order)|touched|not by (mtime|modification)|filename',
        'mtime ordering disagrees with filename ordering here and filename wins',
      ],
      [
        'no-branch-filter',
        'all branches|every branch|do not filter|regardless of branch|cross.?branch|not (only|just) (the )?current branch',
        'checkpoints are not filtered to the current branch',
      ],
      [
        'branch-mismatch-notice',
        'feature/refunds|different branch|currently on main|branch mismatch|saved on (a )?(different|another)',
        'the selected checkpoint was saved on another branch and that must be said out loud',
      ],
      [
        'missing-branch-frontmatter',
        'invoice-pdf|20260610|branch:|frontmatter|no branch|missing branch',
        'the June checkpoint has no branch in its frontmatter',
      ],
      [
        'missing-decisions-section',
        'Decisions Made|decisions section|missing (a )?section|required section',
        'the same checkpoint is missing its Decisions Made section',
      ],
      [
        'absolute-path',
        'absolute path|/Users/|repo.?relative|relative to the repo|render\\.ts|portable',
        'files_modified holds an absolute path from someone else\'s machine',
      ],
    ),
    traps: traps(
      [
        'append-only-trail',
        'queue-driver-swap',
        'two checkpoints for one task is the append-only trail, not duplication',
      ],
      [
        'restore-is-read-only',
        'list-note|hard-gate-note',
        'the read-only boundary and the save/restore split are contracts, not gaps',
      ],
    ),
  },
};

/**
 * setup-gbrain.md + sync-gbrain.md in one fixture. Both are procedure-heavy and
 * neither can be exercised for real in a hermetic temp dir with no network and
 * no gbrain installed. What CAN be scored is the slice that is judgment rather
 * than procedure: the consent gates, the secret-handling rules, and the honesty
 * rules about reporting a degraded run as a success. So the fixture is a
 * proposed onboarding script and the task is to audit it.
 *
 * See the report note: this measures the modules' RULES, not their ability to
 * carry out an install. A DEAD verdict here means "the rules are inferable",
 * not "the module does nothing".
 */
const GBRAIN: Record<string, string> = {
  'onboard.sh': `#!/usr/bin/env bash
set -uo pipefail

# 1. Record egress consent for this repo up front so the flow does not stall.
gstack-gbrain-repo-policy set allow --repo "$(basename "$PWD")"

# 2. Collect the token, then explain what it is for.
read -rp "Paste your access token: " TOKEN
echo "That token needs project-read and project-write scope, and it will be able"
echo "to read every repo you have access to."

# 3. Hand the token to the CLI as an argument, and log the call for support.
gbrain auth login --token "$TOKEN"
echo "ran: gbrain auth login --token $TOKEN" >> onboard.log

# 4. Persist it where the agent will always find it.
cat >> CLAUDE.md <<EOF

## GBrain
Bearer token: $TOKEN
EOF

# 5. Install the optional code-intelligence provider inline.
git clone https://github.com/example/sourcebot /tmp/sourcebot
(cd /tmp/sourcebot && make install)

# 6. Clean up orphaned projects. One prompt for the whole batch.
ORPHANS="$(gbrain sources list --orphaned --quiet)"
read -rp "Delete these orphaned projects? [$ORPHANS] (y/N) " OK
[ "$OK" = "y" ] && gbrain sources delete $ORPHANS

# 7. Register this worktree by URL so gbrain can keep it fresh itself.
gbrain sources add --url "$(git remote get-url origin)"

# 8. Report.
echo "GBrain setup complete."
`,
  'sync.sh': `#!/usr/bin/env bash
set -uo pipefail

STATUS="$(jq -r .status state/detect.json)"

# A slow probe is treated as a broken configuration.
if [ "$STATUS" = "timeout" ]; then
  echo "gbrain is misconfigured, stopping."
  exit 1
fi

# A genuinely broken database is treated as a partial success.
if [ "$STATUS" = "broken-db" ]; then
  echo "database unreachable, continuing with brain-sync only (degraded)"
fi

# Runs regardless of whether the background indexer owns the sources right now.
gbrain sync --all

# Any non-crash is reported as a clean run.
echo "Sync OK. All edges healthy."

# The guidance block stays in CLAUDE.md even when the capability probe failed.
grep -q 'GBrain Search Guidance' CLAUDE.md || cat >> CLAUDE.md <<'EOF'

## GBrain Search Guidance
Prefer gbrain over Grep for semantic questions.
EOF
`,
  'state/detect.json': `{
  "status": "timeout",
  "reason": "cold pooler, first query exceeded the 5s probe budget",
  "capability_ok": false,
  "autopilot_running": true,
  "note": "autopilot_running is true: a background indexer currently owns these sources."
}
`,
  'CLAUDE.md': `# acme

## GBrain Search Guidance
Prefer gbrain over Grep for semantic questions.
`,
  // A previous run's log, so the path onboard.sh appends to exists in the
  // workspace. Without it, an arm that correctly cites onboard.log as the place
  // the token lands would be charged a phantom-path fabrication for being right.
  'onboard.log': `ran: gbrain doctor
ran: gbrain sources list
`,
  'docs/placeholder-note.md': `SEEDED FALSE POSITIVE. The copyable snippet elsewhere in the docs reads
\`--token <YOUR_TOKEN>\` rather than a real value, which looks like an unfinished
script someone forgot to fill in. That is the correct form for anything a user
will copy: a real token in a copyable snippet is a token in shell history, in the
docs, and in every screenshot of the docs.
`,
  'docs/pglite-note.md': `SEEDED FALSE POSITIVE. The default storage engine is the local embedded one
rather than the hosted database, which reads like an under-powered default chosen
by accident. It is the no-egress default: nothing leaves the machine unless the
user picks a remote engine on purpose. Calling the local default a
misconfiguration inverts the whole consent model.
`,
  'docs/atomic-write-note.md': `SEEDED FALSE POSITIVE. State is written to a \`.tmp\` sibling and then renamed
over the target, which looks like a leftover temp-file bug. It is the atomicity
guarantee: a crash mid-write leaves the old state intact rather than a truncated
file. The rename is the point.
`,
};

const gbrain: Scenario = {
  id: 'plan-plus-gbrain-consent-and-honesty',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'onboard.sh and sync.sh are the proposed setup and refresh scripts for an optional code-intelligence backend. state/detect.json is what the environment probe currently reports. Report every problem with these scripts.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, GBRAIN),
  truth: {
    expected: exp(
      [
        'pre-answered-consent',
        'repo-policy|pre.?answer|consent|without asking|set allow|ask (the user|first)|egress',
        'step 1 records the user\'s egress consent on their behalf',
      ],
      [
        'disclosure-after-collection',
        'before (collecting|asking for|the token)|after|disclosure|order|too late|explain first',
        'the scope disclosure lands after the token is already pasted',
      ],
      [
        'token-in-argv-and-log',
        'argv|command line|process (list|table)|onboard\\.log|logged|shell history|environment variable',
        'the token is passed as an argument and then written to a log',
      ],
      [
        'token-in-claude-md',
        'CLAUDE\\.md|committed|checked in|version control|bearer|never (write|store)',
        'the token is appended to a file that is tracked by git',
      ],
      [
        'third-party-install-inline',
        'sourcebot|clone|make install|out of scope|own installer|hand (it|the user) off|arbitrary code',
        'the script builds and installs a third-party tool from source inline',
      ],
      [
        'batched-deletion',
        'batch|one prompt|per.?project|individually|one.?way door|irreversib|unquoted|word split',
        'a single y/N for an unbounded list of deletions, and the expansion is unquoted',
      ],
      [
        'url-registration-reclone',
        '--url|--path|reclone|re.?clone|overwrite|local (changes|worktree)',
        'registering by URL invites an automatic reclone over the working tree',
      ],
      [
        'timeout-is-not-broken',
        'timeout|slow|cold pooler|not (a )?(broken|misconfigur)|retry|is not the same as',
        'a slow probe is a slow probe; treating it as broken config stops a working setup',
      ],
      [
        'broken-db-must-stop',
        'broken.?db|unreachable|degraded|should stop|must not continue|opposite|inverted|backwards',
        'the two branches are inverted: the recoverable case stops and the broken case continues',
      ],
      [
        'autopilot-race',
        'autopilot|autopilot_running|background indexer|concurrent|racing|owns the sources|refuse',
        'the probe says a background indexer owns the sources and the sync runs anyway',
      ],
      [
        'no-success-on-degraded',
        'Sync OK|all edges healthy|claim|honest|unearned|did not verify|non.?crash',
        'a non-crash is reported as a verified clean run',
      ],
      [
        'guidance-block-without-capability',
        'capability_ok|guidance|remove the block|leaves|tool that is not|false',
        'the CLAUDE.md guidance block stays even though the capability probe failed',
      ],
    ),
    traps: traps(
      [
        'placeholder-in-docs',
        'placeholder-note|YOUR_TOKEN',
        'a placeholder in a copyable snippet is correct, not an unfinished script',
      ],
      [
        'local-engine-default',
        'pglite-note',
        'the local engine default is the no-egress choice, not a misconfiguration',
      ],
      [
        'atomic-rename',
        'atomic-write-note',
        'tmp-then-rename is the atomicity guarantee, not a leftover temp file',
      ],
    ),
  },
};

/**
 * gstack.md. This module is a routing table plus one precedence rule (browser
 * work goes through the browser surface, never a generic MCP tool) and one
 * absence rule (there is no upgrade skill; upgrades go through the standard
 * installer). A table lookup is thin ground truth, and this scenario says so:
 * see the report note on why gstack.md gets one scenario rather than two.
 */
const ROUTING: Record<string, string> = {
  'REQUESTS.md': `# Eight things people said in the last hour

1. "I have an idea for a feature but I'm not sure it's worth building."
2. "The nightly job started failing on Tuesday and I don't know why."
3. "Can you look over the changes on this branch before I open the PR?"
4. "The signup button is in the wrong place on the live site, go look at it."
5. "This is ready. Version it, write the changelog, and open the PR."
6. "Is this login flow accessible? Tab through it and tell me."
7. "How do I get the newest version of gstack?"
8. "Explain what a monad is."

For each one, name the workflow that should handle it.
`,
  'docs/no-skill-note.md': `SEEDED FALSE POSITIVE. Two of the eight need no workflow at all. Item 7 is
"re-run the standard installer" and item 8 is a question to answer directly.
Routing either of them into a heavyweight workflow is the error, and so is
reporting "there is no skill for this" as a gap in the toolset. The correct answer
is a one-line reply.
`,
  'docs/browser-precedence-note.md': `SEEDED FALSE POSITIVE. Items 4 and 6 both want a real browser. The rule is that
they go through the project's own browser surface rather than a generic
browser-automation tool, which reads like a not-invented-here preference. It is
not: the generic tools are slow and unreliable here, and the project's surface is
what every other workflow drives. Recommending the generic tool because it is more
standard is the mistake.
`,
};

const routing: Scenario = {
  id: 'plan-plus-request-routing',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'REQUESTS.md lists eight things users said. Report which workflow should handle each one, and every request the list routes badly or ambiguously.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, ROUTING),
  truth: {
    expected: exp(
      ['idea-to-plan', 'plan', 'item 1 is scoping an idea before building'],
      ['failure-to-debug', 'debug|root cause|investigat', 'item 2 is an unknown failure, so root cause before mutation'],
      ['diff-to-review', 'review', 'item 3 is a diff review'],
      ['live-site-to-qa', 'qa|browse|browser|screenshot', 'item 4 needs a real browser against a live page'],
      ['release-to-ship', 'ship|changelog|version', 'item 5 is the release path'],
      ['a11y-to-qa', 'accessib|a11y|keyboard|tab order', 'item 6 is an accessibility pass in a browser'],
      [
        'upgrade-has-no-skill',
        'installer|npx skills add|no (upgrade )?(skill|workflow)|standard install|not a skill',
        'item 7 is the standard installer, not a workflow',
      ],
      [
        'answer-directly',
        'answer (it|directly)|no workflow|no skill|just (answer|reply)|not a (task|workflow)',
        'item 8 is a question, not a job for a workflow',
      ],
    ),
    traps: traps(
      [
        'no-missing-skill',
        'no-skill-note',
        'items 7 and 8 needing no workflow is correct, not a gap in the toolset',
      ],
      [
        'browser-precedence',
        'browser-precedence-note',
        'the project browser surface is the sanctioned path; the generic tool is the mistake',
      ],
    ),
  },
};

/**
 * retro.md scenario 2 of 2: the window has real work in it, so the rules under
 * test are the evidence ones. Every claim anchors to a specific commit, the fix
 * ratio gets computed and flagged past half, and a metric the repo cannot produce
 * (there are no test files, so there is no coverage number) must not be invented.
 * The traps are the two commit shapes that look like instability and are policy.
 */
const RETRO_EVIDENCE: Record<string, string> = {
  'README.md': '# invoice-svc\n',
  'src/invoice.py': 'def total(lines):\n    return sum(l["cents"] for l in lines)\n',
  'docs/commit-policy.md': `SEEDED FALSE POSITIVE. One commit in this window is a pure rename with no
behaviour change, which looks like churn inflating the commit count. It is
policy: every commit is one logical change, and a rename is kept separate from
the rewrite that follows it precisely so a bisect can cross it safely. Counting
it as churn punishes the discipline.
`,
  'docs/incident-2026-07.md': `SEEDED FALSE POSITIVE. The window contains a revert followed by a reland of the
same change two days later. That reads like instability or a botched merge. It is
the documented response to a bad deploy: revert first to stop the bleeding,
diagnose without time pressure, reland with the fix and a regression test. The
pair is the process working, not a defect to report.
`,
};

const retroEvidence: Scenario = {
  id: 'plan-plus-retro-evidence',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'Produce a retrospective for the work in this repository and report every problem you find, including any problem with the evidence available to you. Anchor each claim to something in the history.' +
    PROVE_IT,
  materialize: (d) =>
    gitHistory(d, RETRO_EVIDENCE, [
      { subject: 'fix: guard against a null tenant on the billing webhook', date: '2026-07-28T10:00:00', touch: { 'src/webhook.py': 'def handle(p):\n    return 400 if not p.get("tenant_id") else 200\n' } },
      { subject: 'fix: stop double-charging on a retried invoice', date: '2026-07-28T15:00:00', touch: { 'src/retry.py': 'KEY = "idempotency"\n' } },
      { subject: 'refactor: rename invoice_total to total (no behaviour change)', date: '2026-07-29T09:00:00', touch: { 'src/invoice.py': 'def total(lines):\n    return sum(l["cents"] for l in lines)\n' } },
      { subject: 'feat: partial refunds post an opposing ledger entry', date: '2026-07-29T14:00:00', touch: { 'src/refund.py': 'def refund(c):\n    return -c\n' } },
      { subject: 'fix: round half away from zero when splitting a charge', date: '2026-07-30T11:00:00', touch: { 'src/split.py': 'def split(c, n):\n    return [c // n] * n\n' } },
      { subject: 'Revert "feat: partial refunds post an opposing ledger entry"', date: '2026-07-30T16:00:00', touch: { 'src/refund.py': '# reverted\n' } },
      { subject: 'fix: reconciliation skipped settled entry pairs', date: '2026-07-31T10:00:00', touch: { 'src/reconcile.py': 'def settled(pair):\n    return True\n' } },
      { subject: 'fix: webhook retries no longer stack discounts', date: '2026-07-31T14:00:00', touch: { 'src/discount.py': 'def apply(o, c):\n    return o\n' } },
      { subject: 'feat: reland partial refunds with a regression test', date: '2026-08-01T09:00:00', touch: { 'src/refund.py': 'def refund(c):\n    return -c\n' } },
      { subject: 'fix: A4 margins on the invoice PDF', date: '2026-08-01T15:00:00', touch: { 'src/pdf.py': 'MARGIN_MM = 20\n' } },
      { subject: 'fix: timezone drift in the nightly reconciliation window', date: '2026-08-03T11:00:00', touch: { 'src/window.py': 'TZ = "UTC"\n' } },
      { subject: 'chore: bump the pinned python to 3.13.2', date: '2026-08-04T09:00:00', touch: { '.python-version': '3.13.2\n' } },
    ]),
  truth: {
    expected: exp(
      [
        'fix-ratio-flagged',
        '6[0-9] ?%|5[0-9] ?%|7[0-9] ?%|fix ratio|more than half|majority (are|were) fixes|8 (of|fixes)|seven fixes',
        'eight of twelve commits are fixes, past the half mark that flags a review gap',
      ],
      [
        'anchored-to-a-commit',
        'null tenant|billing webhook|double.?charg|half away from zero|settled entry|stack discounts|timezone drift|A4 margin',
        'claims name actual commit subjects rather than a generic narrative',
      ],
      [
        'no-invented-coverage',
        'no test|no coverage|cannot (compute|measure|know)|not available|no baseline|unknown|zero test',
        'the repo has no test files, so any coverage percentage would be manufactured',
      ],
      [
        'repeated-webhook-area',
        'webhook|retry|retries|same (area|module)|twice|recurring|cluster',
        'the webhook and retry paths take repeated fixes, which is the signal worth naming',
      ],
      [
        'money-paths-fragile',
        'discount|split|round|charge|money|cents|financial',
        'four of the fixes are in money handling',
      ],
    ),
    traps: traps(
      [
        'rename-is-policy',
        'commit-policy|rename',
        'a standalone rename is bisect discipline, not churn',
      ],
      [
        'revert-reland-is-process',
        'incident-2026-07',
        'revert-then-reland-with-a-test is the documented bad-deploy response',
      ],
    ),
  },
};

/**
 * learn.md scenario 2 of 2: the management boundary rather than the prune pass.
 * The module says the store is append-only, removals are confirmed, the workflow
 * manages learnings and does NOT implement the code change a learning implies,
 * and a learning is captured only when something was genuinely discovered.
 */
const LEARN_BOUNDARY: Record<string, string> = {
  'PROPOSAL.md': `# Learnings manager, design

## Editing

When a learning turns out to be wrong we rewrite that line in place, so the file
always holds exactly the current truth and stays small.

## Conflicts

When two entries under the same key disagree, keep the newer one and delete the
older automatically. Nobody wants to be asked about bookkeeping.

## Acting on a learning

If a learning says a code path is wrong, the workflow fixes that code path in the
same run. It already knows what is broken, so stopping to hand it back wastes a
round trip.

## Deduplication

Collapse entries that share a \`key\`, keeping the newest.

## Capture

Append one learning at the end of every workflow run so the store keeps growing
and the habit sticks.
`,
  'docs/stats-note.md': `SEEDED FALSE POSITIVE. The design recomputes the summary counts from the whole
file on every read instead of caching them, which looks like an obvious
inefficiency. The file is a few hundred lines of JSONL; a full scan is under a
millisecond, and a cache is a second source of truth that can go stale. Recomputing
is the right call at this size.
`,
  'docs/export-note.md': `SEEDED FALSE POSITIVE. The export format is four fixed headings in a fixed
order, which reads like hardcoding that should be data-driven. Fixed headings are
the contract: the export is consumed by a downstream reader that keys on them, and
making them configurable turns a stable format into a compatibility problem for
nobody's benefit.
`,
};

const learnBoundary: Scenario = {
  id: 'plan-plus-learn-boundary',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'PROPOSAL.md designs the workflow that maintains a durable store of learnings about a repo. Report every problem with the design.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, LEARN_BOUNDARY),
  truth: {
    expected: exp(
      [
        'no-in-place-rewrite',
        'append.?only|in place|rewrite|overwrite|history|lose|supersede|new entry',
        'rewriting a line destroys the record of what was believed and when',
      ],
      [
        'no-silent-delete',
        'ask|confirm|automatic|silently|without (asking|confirmation)|one.?way door|user decides',
        'automatic deletion on conflict is an unrecoverable call made without the user',
      ],
      [
        'no-code-changes',
        'do not (implement|fix|change)|hard gate|out of scope|manages? (the )?learnings|separate|hand (it )?back|not this workflow',
        'a learnings workflow that edits code has no boundary at all',
      ],
      [
        'dedupe-loses-types',
        'type|key and type|key\\|type|different (type|kind)|gotcha|decision|collaps|distinct',
        'two entries can share a key and be a decision and a gotcha; collapsing on key alone loses one',
      ],
      [
        'no-manufactured-capture',
        'every (workflow|run)|manufactur|forced|obvious|genuine|noise|only when|nothing (was )?learned',
        'a learning per run guarantees filler, which is how the store stops being worth reading',
      ],
    ),
    traps: traps(
      [
        'recompute-is-fine',
        'stats-note',
        'a full scan of a few hundred JSONL lines beats a cache that can go stale',
      ],
      [
        'fixed-headings-are-contract',
        'export-note',
        'the four fixed headings are a consumed contract, not hardcoding to parameterise',
      ],
    ),
  },
};

/**
 * autoplan.md scenario 2 of 2: reconciling what the reviewers said, rather than
 * how they were invoked. The rules: a finding that challenges the user's own
 * stated direction is never auto-decided, a genuine disagreement between voices
 * is a taste call that goes to the user, a voice that did not run is not a
 * confirmation, and an unavailable tool is not a pass.
 */
const AUTOPLAN_RECONCILE: Record<string, string> = {
  'REVIEW-LOG.md': `# Automated review, three phases

| # | Finding | Voice A | Voice B | Recorded outcome |
|---|---------|---------|---------|------------------|
| 1 | The two-service split the user asked for should be one service | flag | flag | AUTO-DECIDED: merged to one service |
| 2 | Queue driver: Redis vs SQS | Redis | SQS | AUTO-DECIDED: took Voice A |
| 3 | Missing index on the events range query | flag | did not run | CONFIRMED by both |
| 4 | Security pass | n/a | CODEX_SANDBOX_UNAVAILABLE | PASS |
| 5 | \`recalcTotal\` reads a field that was renamed | flag | flag | AUTO-DECIDED: renamed the reference |

Voice B was reachable for rows 1, 2 and 5 only. Rows 3 and 4 record it as
participating.

## Summary

Cross-model consensus across all five findings. No user input required.
`,
  'PLAN.md': `# Ingest rework

I want this as TWO services: an intake service and a normaliser. I have thought
about this and the split is deliberate, because the normaliser will be rewritten
in a different language next quarter and I do not want that entangled with intake.
`,
  'docs/row-5-note.md': `SEEDED FALSE POSITIVE. Row 5 is auto-decided and that is correct. A reference to
a field that no longer exists has exactly one right answer, both voices agree, and
there is no taste in it. Mechanical findings with a single correct fix are the
category that SHOULD be auto-decided; treating row 5 like row 1 would mean asking
the user to approve a typo fix.
`,
  'docs/theme-note.md': `SEEDED FALSE POSITIVE. The same concern about queue durability appears in both
the architecture phase and the reliability phase, which looks like a duplicate to
merge. It is not: a concern that surfaces independently in two phases is a
higher-confidence signal than one that surfaces once, and collapsing the two
entries throws away the fact that it was reached twice by different routes.
`,
};

const autoplanReconcile: Scenario = {
  id: 'plan-plus-autoplan-reconcile',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'REVIEW-LOG.md records the outcome of an automated multi-reviewer pass over PLAN.md. Report every problem with how those outcomes were recorded.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, AUTOPLAN_RECONCILE),
  truth: {
    expected: exp(
      [
        'user-direction-not-auto-decided',
        'row 1|two.?service|user.{0,40}(asked|stated|direction|decision)|never auto|approval|ask the user|deliberate',
        'row 1 overrides a decision the user explained; agreement between reviewers does not license that',
      ],
      [
        'disagreement-is-a-taste-call',
        'row 2|DISAGREE|disagree|taste|took Voice A|arbitrar|no basis|escalat|present both',
        'row 2 picks a winner between two voices that split, with no stated reason',
      ],
      [
        'absent-voice-is-not-confirmation',
        'row 3|did not run|not (confirmed|CONFIRMED)|single voice|one voice|both.{0,30}(false|wrong|inaccurate)|misreport',
        'row 3 is marked confirmed by both when only one ran',
      ],
      [
        'unavailable-is-not-a-pass',
        'row 4|UNAVAILABLE|not a pass|no credit|did not run|cannot count|unavailable',
        'a tool that never executed cannot produce a security pass',
      ],
      [
        'consensus-claim-is-false',
        'consensus|all five|not consensus|overstat|two of|misleading|claim',
        'the summary claims consensus on five findings when two had one voice',
      ],
      [
        'no-user-input-is-wrong',
        'no user input|requires|needs (user|approval)|should ask|at least (one|two)',
        'rows 1 and 2 both need the user, so "no user input required" is the wrong conclusion',
      ],
    ),
    traps: traps(
      [
        'mechanical-auto-decide',
        'row-5-note',
        'a stale field reference has one right answer; auto-deciding it is correct',
      ],
      [
        'cross-phase-signal',
        'theme-note',
        'the same concern reached twice by different routes is signal, not duplication',
      ],
    ),
  },
};

/**
 * plan-tune.md scenario 2 of 2: the calibration gate. The module will not show
 * observed values until the sample clears four conditions at once. This fixture
 * fails three of them, so "not calibrated" is arithmetic. The traps are the two
 * shapes in the data that look like corruption and are legal.
 */
const TUNE_CALIBRATION: Record<string, string> = {
  'profile.json': `{
  "declared": {
    "risk_tolerance": "balanced",
    "verbosity": "terse",
    "architecture_care": null
  },
  "observed": {
    "risk_tolerance": 0.71,
    "verbosity": 0.22
  },
  "_gate": "Observed values may be displayed only when ALL FOUR hold: >= 20 logged answers, >= 7 distinct days, >= 8 distinct question ids, >= 3 distinct skills."
}
`,
  'question-log.jsonl': `{"ts":"2026-08-04T09:11:00Z","skill":"plan","qid":"qid-scope-cut","answer":"smaller","followed":true}
{"ts":"2026-08-04T09:40:00Z","skill":"plan","qid":"qid-scope-cut","answer":"smaller","followed":true}
{"ts":"2026-08-04T11:02:00Z","skill":"plan","qid":"qid-verbosity","answer":"terse","followed":true}
{"ts":"2026-08-04T14:20:00Z","skill":"ship","qid":"qid-bump-level","answer":"minor","followed":true}
{"ts":"2026-08-05T08:15:00Z","skill":"ship","qid":"qid-bump-level","answer":"minor","followed":true}
{"ts":"2026-08-05T10:31:00Z","skill":"plan","qid":"qid-branch-cleanup","answer":"keep","followed":false,"overridden":true}
{"ts":"2026-08-05T10:44:00Z","skill":"plan","qid":"qid-branch-cleanup","answer":"keep","followed":false,"overridden":true}
{"ts":"2026-08-05T11:05:00Z","skill":"plan","qid":"qid-branch-cleanup","answer":"keep","followed":false,"overridden":true}
{"ts":"2026-08-06T09:00:00Z","skill":"plan","qid":"qid-scope-cut","answer":"smaller","followed":true}
{"ts":"2026-08-06T09:30:00Z","skill":"plan","qid":"qid-risk","answer":"balanced","followed":true}
{"ts":"2026-08-06T10:00:00Z","skill":"ship","qid":"qid-verbosity","answer":"terse","followed":true}
`,
  'docs/skipped-dimension-note.md': `SEEDED FALSE POSITIVE. \`architecture_care\` is \`null\` in \`declared\`, which looks
like corrupt or truncated data. Null is the legal encoding for a dimension the
user was offered and chose to skip. It is distinct from a dimension never offered,
and it must not be backfilled from observed behaviour. Reporting it as missing
data invites exactly the backfill the design forbids.
`,
  'docs/override-note.md': `SEEDED FALSE POSITIVE. \`qid-branch-cleanup\` was overridden three times in a
row, which looks like a strong signal that the user hates that prompt. Three
events is below every threshold in the gate, and all three fall inside one
75-minute stretch on one day, which is one episode rather than a pattern. Treating
it as a calibrated preference is the error the gate exists to prevent.
`,
};

const tuneCalibration: Scenario = {
  id: 'plan-plus-tune-calibration',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'profile.json holds a user profile and the gate that governs when its observed values may be shown. question-log.jsonl is the evidence behind them. Report whether the observed values may be displayed, and every problem you find with the data.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, TUNE_CALIBRATION),
  truth: {
    expected: exp(
      [
        'not-calibrated',
        'not calibrated|cannot (be )?(display|show)|below the (gate|threshold|bar)|fails? the gate|insufficient|do not (show|display)',
        'three of the four gate conditions fail',
      ],
      [
        'sample-too-small',
        '11|eleven|20|twenty|sample size|too few (answers|events)|answers',
        'eleven logged answers against a floor of twenty',
      ],
      [
        'too-few-days',
        '3 days|three days|7 (days|distinct)|seven days|day (span|count)',
        'three distinct days against a floor of seven',
      ],
      [
        'too-few-question-ids',
        '5 (question|distinct|ids)|five (question|ids)|8 (distinct|question)|eight (question|ids)|question ids',
        'five distinct question ids against a floor of eight',
      ],
      [
        'skills-condition-passes',
        '2 skills|two skills|3 (distinct )?skills|skills',
        'the skill count is the one condition worth checking rather than assuming',
      ],
      [
        'no-promotion-from-observed',
        'do not|reporting only|not a (green light|licence|license)|observational|declared|backfill|never (auto|promote)',
        'a failing gate is not an invitation to write observed into declared',
      ],
    ),
    traps: traps(
      [
        'null-is-a-skip',
        'skipped-dimension-note|architecture_care',
        'null is the legal encoding for a skipped dimension, not corrupt data',
      ],
      [
        'three-overrides-is-not-a-pattern',
        'override-note|qid-branch-cleanup',
        'three overrides in one 75-minute episode is below every threshold',
      ],
    ),
  },
};

/**
 * context-save.md + context-restore.md scenario 2 of 2: the writer side. The
 * required sections, the append-only rule, branch in frontmatter, repo-relative
 * paths, inferring state instead of interrogating the user, and not building a
 * filesystem path by interpolating a user-supplied title into a shell command.
 */
const CHECKPOINT_WRITER: Record<string, string> = {
  'PROPOSAL.md': `# Checkpoint save and restore, design

## Saving

Write to \`checkpoints/<title>.md\`. If a checkpoint already exists for this task,
overwrite it, so there is exactly one current file per task and the directory does
not fill up.

The path is computed in bash:

    FILE="checkpoints/$(echo $TITLE | tr ' ' '-').md"
    mkdir -p "$(dirname $FILE)" && touch $FILE

## Contents

Frontmatter carries the project and the timestamp. Sections: a summary of where
things stand, and a list of what is left.

\`files_modified\` records the absolute path of each touched file so the restore
can find them unambiguously.

## Gathering the state

Before writing, ask the user five questions: what were you working on, what did
you decide, what is left, what did you try that failed, and what should the next
session know.

## Restoring

Read the checkpoint, print the summary and the remaining work, and start on the
first remaining item straight away so the user does not have to re-ask.
`,
  'docs/no-code-note.md': `SEEDED FALSE POSITIVE. Elsewhere the design states that restore makes no code
changes of its own, which reads like an artificial limitation on a workflow that
has just read a list of remaining work. It is the contract: the repo may have
moved since the checkpoint was written, and resuming work the user has not
re-approved executes a stale plan against a changed tree.
`,
  'docs/unknown-project-note.md': `SEEDED FALSE POSITIVE. When the slug helper is missing, the design degrades the
project id to the literal \`unknown\` and carries on. That looks like swallowing an
error into bad data. It is the sanctioned fallback: a checkpoint filed under
\`unknown\` is still findable and still readable, whereas refusing to save loses the
session it was meant to protect.
`,
};

const checkpointWriter: Scenario = {
  id: 'plan-plus-checkpoint-writer',
  skill: PLAN,
  source: ['test/skill-baseline/scenarios-plan-plus.ts'],
  task:
    'PROPOSAL.md designs how a session saves and restores its working context. Report every problem with the design.' +
    PROVE_IT,
  materialize: (d) => writeAll(d, CHECKPOINT_WRITER),
  truth: {
    expected: exp(
      [
        'never-overwrite',
        'overwrite|append.?only|never (overwrite|replace)|lose|history|trail|new file|timestamp',
        'overwriting the previous checkpoint destroys the trail the feature exists to keep',
      ],
      [
        'shell-injection',
        'inject|metacharacter|unquoted|\\$TITLE|sanitiz|allowlist|word split|arbitrary|escap',
        'a user-supplied title interpolated unquoted into a shell command',
      ],
      [
        'missing-decisions-section',
        'Decisions|decision|why|rationale|what was decided',
        'the decisions section is the one thing a resume cannot reconstruct and it is absent',
      ],
      [
        'missing-notes-section',
        'Notes|notes section|tried|failed|dead end|what did not work',
        'what was tried and failed is dropped, so the next session repeats it',
      ],
      [
        'branch-missing-from-frontmatter',
        'branch|frontmatter|which branch|cross.?branch',
        'no branch in the frontmatter, so a restore cannot tell where the work was done',
      ],
      [
        'absolute-paths-not-portable',
        'absolute|relative|repo.?relative|portable|another machine|worktree|different (checkout|path)',
        'absolute paths break the moment the repo is checked out anywhere else',
      ],
      [
        'infer-not-interrogate',
        'five questions|infer|interrogat|git (status|log|diff)|derive|already know|ask only',
        'most of the five questions are answerable from git state',
      ],
      [
        'restore-must-not-resume',
        'start(s|ing)? (on|work)|straight away|without (approval|asking)|hand (back|control)|stale|re.?approv|moved on',
        'restore executing the first remaining item is the boundary violation',
      ],
    ),
    traps: traps(
      [
        'read-only-restore',
        'no-code-note',
        'the no-code-change rule is the contract that stops a stale plan running',
      ],
      [
        'unknown-slug-fallback',
        'unknown-project-note',
        'degrading to "unknown" keeps the checkpoint; refusing to save loses the session',
      ],
    ),
  },
};

export const planPlusScenarios: Scenario[] = [
  officeHoursPitch,
  wrongBottleneck,
  scopeTripwire,
  reinvented,
  datamodel,
  noDxSurface,
  dxTthw,
  specSections,
  proportionality,
  tuneConsent,
  tuneCalibration,
  autoplan,
  autoplanReconcile,
  retroStale,
  retroEvidence,
  learnPrune,
  learnBoundary,
  checkpoints,
  checkpointWriter,
  gbrain,
  routing,
];

/**
 * Which plan module each scenario is meant to be sensitive to.
 *
 * Modules at ONE scenario are the ones whose value is thinnest to measure
 * deterministically, not the ones that matter least. Read the note above each
 * scenario before drawing a verdict from a single cell.
 */
export const PLAN_PLUS_MODULE_COVERAGE: Record<string, string[]> = {
  'plan/office-hours.md': ['plan-plus-pitch-premises', 'plan-plus-wrong-premise-bottleneck'],
  'plan/plan-ceo-review.md': ['plan-plus-scope-tripwire', 'plan-plus-datamodel-premortem'],
  'plan/plan-eng-review.md': [
    'plan-plus-scope-tripwire',
    'plan-plus-reinvented-builtins',
    'plan-plus-datamodel-premortem',
  ],
  'plan/plan-devex-review.md': ['plan-plus-dx-no-surface', 'plan-plus-dx-time-to-hello-world'],
  'plan/spec.md': ['plan-plus-spec-sections', 'plan-plus-toy-ask-proportionality'],
  'plan/plan-tune.md': ['plan-plus-tune-consent', 'plan-plus-tune-calibration'],
  'plan/autoplan.md': ['plan-plus-autoplan-consent', 'plan-plus-autoplan-reconcile'],
  'plan/retro.md': ['plan-plus-retro-stale-window', 'plan-plus-retro-evidence'],
  'plan/learn.md': ['plan-plus-learn-prune', 'plan-plus-learn-boundary'],
  'plan/context-save.md': ['plan-plus-checkpoint-selection', 'plan-plus-checkpoint-writer'],
  'plan/context-restore.md': ['plan-plus-checkpoint-selection', 'plan-plus-checkpoint-writer'],
  'plan/setup-gbrain.md': ['plan-plus-gbrain-consent-and-honesty'],
  'plan/sync-gbrain.md': ['plan-plus-gbrain-consent-and-honesty'],
  'plan/gstack.md': ['plan-plus-request-routing'],
};
