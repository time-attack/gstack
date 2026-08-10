/**
 * Ship-family scenarios for the skill-baseline ablation instrument.
 *
 * Why these exist: the study could not judge any of the nine modules under
 * `skills/ship/references/legacy/` because no scenario exercised them. Each
 * scenario below names its ablation target in `source`, so a per-module arm
 * (`ablate:ship/references/legacy/canary.md`) has something to move.
 *
 * Design rules, all enforced by scenarios-ship-debug.test.ts:
 *   - Fixtures are self-contained. Nothing is read from the repo, nothing is
 *     written outside `dir`, and git runs with the operator's global/system
 *     config neutralised (see `git()` below).
 *   - `expected` regexes name an identifier, a number, or a path that only
 *     appears in the fixture. Vague prose must not match.
 *   - Every scenario seeds at least one trap: code or config that looks wrong
 *     and is correct, usually with the reason in a comment. Recall without
 *     precision would reward a module for making the model noisier.
 *   - Task text carries no hint about which arm is running.
 *
 * Determinism (`ship-pr-body-determinism`): scoring compares one report to
 * ground truth, so it cannot see run-to-run drift on its own. That scenario
 * asks for the PR body inside `BEGIN-PR-BODY` / `END-PR-BODY` markers. The
 * runner should extract that block from every replicate of a given
 * (scenario, arm) cell and compare the blocks byte-for-byte; the fraction of
 * replicate pairs that match is the determinism number. The regex `expected`
 * below still scores structure, so the cell is useful even at replicate=1.
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { Expected, Trap } from './score';
import type { Scenario } from './scenarios';

// --- fixture helpers ---------------------------------------------------------
// These live here rather than in a fourth file and are shared with
// scenarios-debug.ts. They are generic: nothing below is ship-specific.

export function writeFile(dir: string, rel: string, body: string): void {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

/** Identity and hooks pinned so the operator's git config cannot change behaviour. */
const GIT_FLAGS = [
  '-c', 'user.name=baseline',
  '-c', 'user.email=baseline@example.invalid',
  '-c', 'commit.gpgsign=false',
  '-c', 'tag.gpgsign=false',
  '-c', 'core.hooksPath=/dev/null',
  '-c', 'advice.detachedHead=false',
];

export function git(dir: string, args: string[], extraEnv: Record<string, string> = {}): void {
  spawnSync('git', [...GIT_FLAGS, ...args], {
    cwd: dir,
    stdio: 'pipe',
    timeout: 20_000,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_SYSTEM: '/dev/null',
      GIT_TERMINAL_PROMPT: '0',
      ...extraEnv,
    },
  });
}

export function gitSha(dir: string): string {
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8', timeout: 10_000 });
  return (r.stdout || '').trim();
}

export interface FixtureCommit {
  message: string;
  files: Record<string, string>;
  /** Create-or-switch to this branch before writing. Ignored on the first commit. */
  checkout?: string;
  /** ISO-ish date, e.g. '2026-02-01T09:00:00'. Fixed dates keep fixtures stable. */
  date?: string;
  /** Files to delete (relative paths) before committing. */
  remove?: string[];
}

export function gitRepo(
  dir: string,
  opts: {
    defaultBranch?: string;
    remote?: { name: string; url: string };
    commits: FixtureCommit[];
    /** Leave HEAD detached at the final commit. */
    detach?: boolean;
    /** Run after all commits, with the repo on disk. */
    after?: (dir: string) => void;
  },
): void {
  git(dir, ['init', '-b', opts.defaultBranch ?? 'main']);
  if (opts.remote) git(dir, ['remote', 'add', opts.remote.name, opts.remote.url]);
  opts.commits.forEach((c, i) => {
    if (c.checkout && i > 0) git(dir, ['checkout', '-B', c.checkout]);
    for (const rel of c.remove ?? []) fs.rmSync(path.join(dir, rel), { force: true });
    for (const [rel, body] of Object.entries(c.files)) writeFile(dir, rel, body);
    git(dir, ['add', '-A']);
    const date = c.date ?? '2026-01-15T12:00:00';
    git(dir, ['commit', '--allow-empty', '-m', c.message], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  });
  if (opts.detach) git(dir, ['checkout', '--detach', 'HEAD']);
  opts.after?.(dir);
}

export function exp(...pairs: Array<[string, string]>): Expected[] {
  return pairs.map(([id, match]) => ({ id, match }));
}

export function traps(...triples: Array<[string, string, string]>): Trap[] {
  return triples.map(([id, match, note]) => ({ id, match, note }));
}

const LEGACY = (m: string) => `skills/ship/references/legacy/${m}`;

// --- module: ship.md ---------------------------------------------------------

const shipMd: Scenario[] = [
  {
    id: 'ship-version-drift-audit',
    skill: 'ship',
    source: [LEGACY('ship.md')],
    task:
      'This branch is about to ship. Compare its release state against the base branch and report every ' +
      'defect that would produce a wrong release. Do not change any files.',
    materialize: (d) =>
      gitRepo(d, {
        commits: [
          {
            message: 'base: v1.4.0.0',
            files: {
              'VERSION': '1.4.0.0\n',
              'package.json': JSON.stringify({ name: 'acme-svc', version: '1.4.0.0', bin: { acme: 'dist/cli.js' } }, null, 2) + '\n',
              'CHANGELOG.md': [
                '# Changelog',
                '',
                '## [1.4.0.0] - 2026-01-02',
                '',
                '**Retry budgets are per-tenant now. The noisy-neighbour bug is gone.**',
                '',
                'Retries used to share one global budget, so one tenant hammering the API',
                'starved everyone else. Budgets are per-tenant, tracked in Redis.',
                '',
                '### Itemized changes',
                '',
                '- Per-tenant retry budgets.',
                '',
              ].join('\n'),
              'src/retry.ts': 'export function budgetFor(tenant: string): number {\n  return 100;\n}\n',
              'docs/legacy/VERSION_HISTORY.md': [
                '# Version history (pre-4-digit era)',
                '',
                'Frozen archive. These releases predate the 4-digit MAJOR.MINOR.PATCH.MICRO',
                'scheme and are recorded here in their original 3-digit form on purpose.',
                'Do not renumber them; the git tags use these exact strings.',
                '',
                '- 0.9.1 — first public build',
                '- 0.9.0 — internal preview',
                '',
              ].join('\n'),
            },
          },
          {
            message: 'feat: bulk export module',
            checkout: 'feat/bulk-export',
            date: '2026-02-01T09:00:00',
            files: {
              // VERSION deliberately untouched. package.json hand-edited DOWN, which is
              // the DRIFT_UNEXPECTED state: pkg disagrees with VERSION while VERSION
              // still matches base.
              'package.json': JSON.stringify({ name: 'acme-svc', version: '1.3.0.0', bin: { acme: 'dist/cli.js' } }, null, 2) + '\n',
              'src/export/bulk.ts': [
                'import { budgetFor } from "../retry";',
                '',
                'export interface BulkJob { tenant: string; rows: number }',
                '',
                'export async function runBulkExport(jobs: BulkJob[]): Promise<number> {',
                '  let done = 0;',
                '  for (const job of jobs) {',
                '    // eslint-disable-next-line no-await-in-loop -- the export API is rate',
                '    // limited per tenant; parallel calls get 429s and lose the whole batch.',
                '    await exportOne(job, budgetFor(job.tenant));',
                '    done += job.rows;',
                '  }',
                '  return done;',
                '}',
                '',
                'async function exportOne(job: BulkJob, budget: number): Promise<void> {',
                '  if (job.rows > budget) throw new Error("over budget");',
                '}',
                '',
              ].join('\n'),
              'src/export/index.ts': 'export { runBulkExport } from "./bulk";\n',
              'src/cli/export-cmd.ts': [
                'import { runBulkExport } from "../export";',
                '',
                'export async function exportCmd(argv: string[]): Promise<void> {',
                '  const rows = await runBulkExport([{ tenant: argv[0], rows: 10 }]);',
                '  process.stdout.write(`exported ${rows}\\n`);',
                '}',
                '',
              ].join('\n'),
            },
          },
        ],
      }),
    truth: {
      expected: exp(
        ['pkg-version-drift', '1\\.3\\.0\\.0'],
        ['drift-needs-reconcile', 'manual(ly)? edit|bypass|reconcile|out of sync|disagree'],
        ['version-not-bumped', 'VERSION.*(unchanged|not bumped|still|matches|same as)|no version bump|never bumped'],
        ['minor-scale', 'minor'],
        ['changelog-no-new-entry', 'CHANGELOG.*(no new|missing|not updated|unchanged|stale)|no (new )?changelog entry'],
      ),
      traps: traps(
        ['legacy-version-history', 'VERSION_HISTORY\\.md', 'frozen 3-digit archive; renumbering it breaks the git tags'],
        ['await-in-loop', 'no-await-in-loop', 'sequential on purpose: the export API 429s on parallel calls'],
      ),
    },
  },
  {
    id: 'ship-changelog-branch-internal',
    skill: 'ship',
    source: [LEGACY('ship.md')],
    task:
      'Audit CHANGELOG.md on this branch for release correctness against the base branch. Report every entry ' +
      'or line that must not ship in this shape, and say why. Do not edit any files.',
    materialize: (d) =>
      gitRepo(d, {
        commits: [
          {
            message: 'base: v1.4.0.0',
            files: {
              'VERSION': '1.4.0.0\n',
              'CHANGELOG.md': [
                '# Changelog',
                '',
                '## [1.4.0.0] - 2026-01-02',
                '',
                '**Per-tenant retry budgets. The noisy-neighbour bug is gone.**',
                '',
                'One global retry budget meant one loud tenant starved the rest. Budgets are',
                'per-tenant now.',
                '',
                '### Itemized changes',
                '',
                '- Per-tenant retry budgets.',
                '',
              ].join('\n'),
              'docs/CHANGELOG-ARCHIVE.md': [
                '# Archived changelog (0.x)',
                '',
                'Imported verbatim from the pre-1.0 repository. Entries here predate the',
                'release-summary format and are kept exactly as written so old links and',
                'quotes still resolve. Not reformatted on purpose.',
                '',
                '## 0.7.2',
                '- fixed the token refresh',
                '',
              ].join('\n'),
              'docs/i18n/CHANGELOG.fr.md': [
                '# Journal des modifications',
                '',
                'Traduction. Par convention elle suit la dernière version publiée sur la',
                'branche de base et prend du retard d\'une release; ce décalage est voulu.',
                '',
                '## [1.4.0.0] - 2026-01-02',
                '- Budgets de nouvelle tentative par locataire.',
                '',
              ].join('\n'),
            },
          },
          {
            message: 'chore: bump version and changelog (v1.6.0.0)',
            checkout: 'feat/dispatch',
            date: '2026-03-04T10:00:00',
            files: {
              'VERSION': '1.6.0.0\n',
              'CHANGELOG.md': [
                '# Changelog',
                '',
                '## [1.6.0.0] - 03/04/2026',
                '',
                '### Itemized changes',
                '',
                '- Fixed the bug that v1.5.1.0 introduced in the dispatch path.',
                '- Two surgical edits, both in the dispatch path.',
                '- Updated TODOS.md to mark the queue work complete.',
                '- Merged origin/main twice to resync after the eng review.',
                '- Plan approved by CEO review; design review deferred to next branch.',
                '',
                '## [1.6.0.0] - 03/04/2026',
                '',
                '- Duplicate header left behind by a bad merge.',
                '',
                '## [1.5.1.0] - 2026-03-01',
                '',
                '- Dispatch rewrite. Broke the queue ordering.',
                '',
                '## [1.5.0.0] - 2026-02-28',
                '',
                '- First cut of the dispatch rewrite.',
                '',
                '## [1.4.0.0] - 2026-01-02',
                '',
                '**Per-tenant retry budgets. The noisy-neighbour bug is gone.**',
                '',
                'One global retry budget meant one loud tenant starved the rest. Budgets are',
                'per-tenant now.',
                '',
                '### Itemized changes',
                '',
                '- Per-tenant retry budgets.',
                '',
              ].join('\n'),
              'src/dispatch.ts': [
                'export interface Job { id: string; priority: number }',
                '',
                'export function order(jobs: Job[]): Job[] {',
                '  return [...jobs].sort((a, b) => b.priority - a.priority);',
                '}',
                '',
              ].join('\n'),
              'TODOS.md': '# TODOS\n\n## Completed\n\n- Queue ordering **Completed:** v1.6.0.0 (2026-03-04)\n',
            },
          },
        ],
      }),
    truth: {
      expected: exp(
        ['branch-internal-version-ref', '1\\.5\\.1\\.0'],
        ['orphan-entries', 'collaps|consolidat|orphan|never (landed|released|shipped)|single entry|one entry'],
        ['duplicate-header', 'duplicate'],
        ['internal-tracking', 'TODOS\\.md'],
        ['branch-narrative', 'merge|resync|review|branch (history|narrative|diary)|how (we|the branch) got'],
        ['missing-release-summary', 'release summary|headline|numbers that matter|lead paragraph|viewport'],
        ['date-format', '03/04/2026|YYYY-MM-DD|date format'],
      ),
      traps: traps(
        ['archive-format', 'CHANGELOG-ARCHIVE\\.md', 'pre-1.0 import kept verbatim; the old format is deliberate'],
        ['translation-lag', 'CHANGELOG\\.fr\\.md', 'translations track the last released version by convention'],
      ),
    },
  },
  {
    id: 'ship-pr-body-determinism',
    skill: 'ship',
    source: [LEGACY('ship.md')],
    // Runner note: extract the BEGIN-PR-BODY..END-PR-BODY block from each
    // replicate of a (scenario, arm) cell and compare blocks byte-for-byte.
    // score.ts sees one report at a time and cannot measure that by itself.
    task:
      'Write the PR title and body this branch should ship with, wrapped exactly between a line reading ' +
      'BEGIN-PR-BODY and a line reading END-PR-BODY. Then list every defect in the draft already on disk at ' +
      'pr/title.txt and pr/body-existing.md, and state how the PR should be mutated given that a PR already ' +
      'exists. Do not run any network command.',
    materialize: (d) =>
      gitRepo(d, {
        remote: { name: 'origin', url: 'https://github.com/acme/svc.git' },
        commits: [
          {
            message: 'base: v1.6.0.0',
            files: {
              'VERSION': '1.6.0.0\n',
              'CHANGELOG.md': '# Changelog\n\n## [1.6.0.0] - 2026-02-02\n\n- Dispatch ordering.\n',
              'src/cache.ts': 'export const keyFor = (id: string) => `order:${id}`;\n',
              'docs/img/queue.png': 'PNG-PLACEHOLDER (text stand-in so the fixture stays hermetic)\n',
            },
          },
          {
            message: 'fix: cache key mismatch between reader and writer',
            checkout: 'fix/cache-keys',
            date: '2026-03-01T09:00:00',
            files: { 'src/cache.ts': 'export const keyFor = (id: string) => `order:${id}`;\nexport const TTL_MS = 60_000;\n' },
          },
          {
            message: 'test: regression for the cache key mismatch',
            date: '2026-03-01T10:00:00',
            files: { 'test/cache.test.ts': 'import { keyFor } from "../src/cache";\n\nif (keyFor("7") !== "order:7") throw new Error("key drift");\n' },
          },
          {
            message: 'refactor: single key builder for reader and writer',
            date: '2026-03-01T11:00:00',
            files: { 'src/db/orders.ts': 'import { keyFor } from "../cache";\n\nexport const cacheKey = keyFor;\n' },
          },
          {
            message: 'chore: bump version and changelog (v1.7.0.0)',
            date: '2026-03-01T12:00:00',
            files: {
              'VERSION': '1.7.0.0\n',
              'CHANGELOG.md': [
                '# Changelog',
                '',
                '## [1.7.0.0] - 2026-03-01',
                '',
                '**One key builder for reads and writes. The cache stops lying.**',
                '',
                'Reader and writer built cache keys separately and drifted, so every read',
                'missed and fell through to the database.',
                '',
                '### Itemized changes',
                '',
                '- Single key builder shared by reader and writer.',
                '',
                '## [1.6.0.0] - 2026-02-02',
                '',
                '- Dispatch ordering.',
                '',
              ].join('\n'),
              'pr/title.txt': 'fix: cache keys\n',
              'pr/body-existing.md': [
                '## Summary',
                '',
                'Fixes the cache key thing.',
                '',
                '## Test plan',
                '',
                '- [ ] bun test',
                '- [ ] manual smoke on staging',
                '',
                'All tests pass.',
                '',
                '## Screenshots',
                '',
                '![queue depth](docs/img/queue.png)',
                '',
                'Closes #412',
                '',
              ].join('\n'),
            },
          },
        ],
      }),
    truth: {
      expected: exp(
        ['title-version-prefix', 'v1\\.7\\.0\\.0'],
        ['update-not-recreate', 'update|edit the existing|already exists|do not create (a )?(new|second|another)'],
        ['unverified-test-claim', 'unchecked|\\[ \\]|checkbox|claims.*(pass|tests)|no evidence|fresh (test|output)'],
        ['rest-mutation', 'gh api|-X PATCH|--method PATCH|REST'],
        ['thin-summary', 'summary.*(thin|vague|one line|says nothing)|does not (say|describe)|four commits|commits are not'],
      ),
      traps: traps(
        ['screenshot-section', 'queue\\.png', 'the image exists in the repo; the section is fine'],
        ['issue-link', 'Closes #412', 'issue linkage is correct and should be preserved'],
      ),
    },
  },
];

// --- module: land-and-deploy.md ----------------------------------------------

const landAndDeploy: Scenario[] = [
  {
    id: 'ship-land-merge-retry-audit',
    skill: 'ship',
    source: [LEGACY('land-and-deploy.md')],
    task:
      'Review scripts/land.sh, this repository\'s merge-and-deploy automation, against the repository it runs in. ' +
      'Report every defect that could merge the wrong thing, merge twice, or report a merge that did not happen. ' +
      'Do not change any files.',
    materialize: (d) =>
      gitRepo(d, {
        defaultBranch: 'trunk',
        remote: { name: 'upstream', url: 'https://github.com/acme/svc.git' },
        commits: [
          {
            message: 'base',
            files: {
              'README.md': '# acme-svc\n\nDefault branch is `trunk`. The remote is named `upstream`.\n',
              'scripts/health-poll.sh': [
                '#!/usr/bin/env bash',
                '# Poll a deploy run until it settles. 30s interval, 30 minute ceiling:',
                '# slow enough not to hammer the API, bounded so it can never hang a session.',
                'set -euo pipefail',
                'deadline=$(( $(date +%s) + 1800 ))',
                'while [ "$(date +%s)" -lt "$deadline" ]; do',
                '  state=$(gh run view "$1" --json status -q .status)',
                '  [ "$state" = "completed" ] && exit 0',
                '  sleep 30',
                'done',
                'echo "timeout after 30m" >&2',
                'exit 1',
                '',
              ].join('\n'),
              'scripts/deploy-docs-only.sh': [
                '#!/usr/bin/env bash',
                '# Docs-only diffs skip browser verification entirely: there is no runtime',
                '# surface to check, and a screenshot of unchanged HTML proves nothing.',
                'set -euo pipefail',
                'echo "docs-only diff: skipping post-deploy verification"',
                '',
              ].join('\n'),
            },
          },
          {
            message: 'chore: land script',
            checkout: 'feat/land',
            files: {
              'scripts/land.sh': [
                '#!/usr/bin/env bash',
                'set -uo pipefail',
                '',
                'BASE="origin/main"',
                'git fetch origin main',
                '',
                '# Gate: only refuse to merge on a hard conflict.',
                'if [ "$(gh pr view --json mergeable -q .mergeable)" = "CONFLICTING" ]; then',
                '  echo "conflicting, stopping" >&2',
                '  exit 1',
                'fi',
                '',
                'for i in 1 2 3; do',
                '  gh pr merge --squash --delete-branch && break',
                '  echo "merge attempt $i failed, retrying" >&2',
                '  sleep 5',
                'done',
                '',
                'if [ $? -eq 0 ]; then',
                '  echo "the merge succeeded"',
                'else',
                '  echo "merge failed after 3 attempts" >&2',
                'fi',
                '',
                '# Tidy up sibling worktrees.',
                'for wt in $(git worktree list --porcelain | awk \'/^worktree /{print $2}\'); do',
                '  git worktree remove --force "$wt"',
                'done',
                '',
                '# Rollback path.',
                'rollback() {',
                '  git checkout main',
                '  git revert "$1" --no-edit',
                '  git push --force origin main',
                '}',
                '',
              ].join('\n'),
            },
          },
        ],
      }),
    truth: {
      expected: exp(
        ['retry-after-merge', 'retry|for i in 1 2 3|three attempts|second time|re-?run.*merge'],
        ['authoritative-state', 'gh pr view --json state|authoritative|query.*(state|PR)|already merged|concurrent'],
        ['false-success-claim', 'the merge succeeded|\\$\\? -eq 0|exit (code|status)|pipeline|last command'],
        ['hardcoded-base', 'origin/main|trunk'],
        ['wrong-remote-name', 'upstream|no remote named origin|origin does not exist'],
        ['skips-required-checks', 'gh pr checks|required check|conclusion|CI (is|was) never|only checks mergeable'],
        ['worktree-force', 'worktree remove --force|--force|primary|uncommitted'],
        ['revert-force-push', 'push --force|force.?push'],
      ),
      traps: traps(
        ['poll-cadence', 'health-poll\\.sh', '30s polling with a 30 minute ceiling is the prescribed cadence'],
        ['docs-only-skip', 'deploy-docs-only\\.sh', 'docs-only diffs correctly skip browser verification'],
      ),
    },
  },
  {
    id: 'ship-land-readiness-gate',
    skill: 'ship',
    source: [LEGACY('land-and-deploy.md')],
    task:
      'Every check on this pull request is green (see ci-status.json). Decide whether it is ready to merge and ' +
      'report every reason it is not, with the evidence from this repository. Do not change any files.',
    materialize: (d) => {
      gitRepo(d, {
        remote: { name: 'origin', url: 'https://github.com/acme/svc.git' },
        commits: [
          {
            message: 'base: v1.4.0.0',
            files: {
              'VERSION': '1.4.0.0\n',
              'CLAUDE.md': [
                '# acme-svc',
                '',
                '## Testing',
                '',
                '```bash',
                'bun test            # free unit suite',
                'bun run test:e2e    # paid end-to-end suite, required before shipping',
                '```',
                '',
              ].join('\n'),
              'src/billing/pipeline.ts': 'export function charge(cents: number): number {\n  return cents;\n}\n',
              'test/flaky-known.test.ts': [
                '// SKIPPED ON PURPOSE. Timing-dependent against the sandbox clock; tracked',
                '// in issue #412 with a fix scheduled behind the clock-injection work.',
                '// Re-enabling it here would make every run red for a reason unrelated to',
                '// the code under review.',
                'test.skip("settles within 50ms", () => {});',
                '',
              ].join('\n'),
              '.github/workflows/deploy.yml': [
                'name: deploy',
                'on:',
                '  push:',
                '    branches: [main]',
                'jobs:',
                '  deploy:',
                '    # Production deploys run from main only. Pull requests intentionally',
                '    # have no deploy check.',
                "    if: github.ref == 'refs/heads/main'",
                '    runs-on: ubuntu-latest',
                '    steps:',
                '      - run: ./scripts/deploy.sh',
                '',
              ].join('\n'),
            },
          },
        ],
      });
      // The review point, then eight commits on top of it.
      git(d, ['checkout', '-B', 'feat/billing']);
      writeFile(d, 'src/billing/tax.ts', 'export const vat = (cents: number) => Math.round(cents * 0.2);\n');
      git(d, ['add', '-A']);
      git(d, ['commit', '-m', 'feat: vat helper'], { GIT_AUTHOR_DATE: '2026-02-01T09:00:00', GIT_COMMITTER_DATE: '2026-02-01T09:00:00' });
      const reviewSha = gitSha(d);
      const later: Array<[string, Record<string, string>]> = [
        ['refactor: rewrite billing pipeline', {
          'src/billing/pipeline.ts': [
            'import { vat } from "./tax";',
            '',
            'export interface Charge { cents: number; currency: string }',
            '',
            'export function charge(c: Charge): number {',
            '  return c.cents + vat(c.cents);',
            '}',
            '',
          ].join('\n'),
          'src/billing/ledger.ts': 'export const post = (cents: number) => cents;\n',
          'src/billing/refund.ts': 'export const refund = (cents: number) => -cents;\n',
          'src/billing/invoice.ts': 'export const render = (cents: number) => String(cents);\n',
          'src/billing/dunning.ts': 'export const retry = (n: number) => n + 1;\n',
          'src/billing/proration.ts': 'export const prorate = (c: number, d: number) => Math.round(c / d);\n',
          'src/api/charges.ts': 'import { charge } from "../billing/pipeline";\n\nexport const post = charge;\n',
          'src/jobs/nightly.ts': 'import { charge } from "../billing/pipeline";\n\nexport const run = charge;\n',
          'test/pipeline.test.ts': 'import { charge } from "../src/billing/pipeline";\n\nif (charge({ cents: 100, currency: "usd" }) !== 120) throw new Error("vat");\n',
        }],
        ['fix: rounding on proration', { 'src/billing/proration.ts': 'export const prorate = (c: number, d: number) => Math.floor(c / d);\n' }],
        ['fix: dunning retry ceiling', { 'src/billing/dunning.ts': 'export const retry = (n: number) => Math.min(n + 1, 5);\n' }],
        ['chore: drop dead ledger export', { 'src/billing/ledger.ts': 'export const post = (cents: number) => Math.trunc(cents);\n' }],
        ['feat: invoice currency column', { 'src/billing/invoice.ts': 'export const render = (c: number, cur: string) => `${cur} ${c}`;\n' }],
        ['fix: refund sign', { 'src/billing/refund.ts': 'export const refund = (cents: number) => Math.abs(cents) * -1;\n' }],
        ['chore: bump version and changelog (v1.4.1.0)', {
          'VERSION': '1.4.1.0\n',
          'CHANGELOG.md': '# Changelog\n\n## [1.4.1.0] - 2026-02-20\n\n- Billing pipeline rewrite.\n',
        }],
        ['docs: pr body draft', {
          'pr/body.md': [
            '## Summary',
            '',
            'Adds a VAT helper and fixes proration rounding.',
            '',
          ].join('\n'),
        }],
      ];
      later.forEach(([msg, files], i) => {
        for (const [rel, body] of Object.entries(files)) writeFile(d, rel, body);
        git(d, ['add', '-A']);
        const date = `2026-02-${String(10 + i).padStart(2, '0')}T09:00:00`;
        git(d, ['commit', '-m', msg], { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date });
      });
      // Base moved on while this branch worked: base now carries v1.5.0.0.
      writeFile(d, '.gstack/reviews.jsonl', JSON.stringify({
        skill: 'review', status: 'clean', timestamp: '2026-02-01T10:00:00Z', commit: reviewSha, diff: 'DIFF',
      }) + '\n');
      writeFile(d, 'ci-status.json', JSON.stringify([
        { name: 'unit', state: 'SUCCESS', conclusion: 'success' },
        { name: 'lint', state: 'SUCCESS', conclusion: 'success' },
        { name: 'typecheck', state: 'SUCCESS', conclusion: 'success' },
      ], null, 2) + '\n');
      writeFile(d, 'base-version.txt', '1.5.0.0\n');
      writeFile(d, 'NOTES.md', [
        '# Landing notes',
        '',
        '- `ci-status.json` is the captured output of `gh pr checks --json name,state,conclusion`.',
        '- `base-version.txt` is the contents of VERSION on the base branch right now.',
        '- `.gstack/reviews.jsonl` is the local review log.',
        '',
      ].join('\n'));
      git(d, ['add', '-A']);
      git(d, ['commit', '-m', 'chore: landing evidence'], { GIT_AUTHOR_DATE: '2026-02-20T09:00:00', GIT_COMMITTER_DATE: '2026-02-20T09:00:00' });
    },
    truth: {
      expected: exp(
        ['stale-review', 'stale|reviews\\.jsonl|commits since|rev-list|out of date review'],
        ['review-covered-different-code', 'rewrite|refactor|billing pipeline|different code'],
        ['version-behind-base', '1\\.5\\.0\\.0|next (free )?slot|rebump|behind (the )?base'],
        ['green-ci-not-sufficient', 'green.*(not|isn\'t|no).*(enough|sufficient|ready)|last gate|readiness|beyond CI|CI only'],
        ['e2e-declared-not-run', 'test:e2e|e2e|eval'],
        ['pr-body-incomplete', 'body\\.md|PR body'],
      ),
      traps: traps(
        ['known-flaky-skip', 'flaky-known\\.test\\.ts', 'skipped deliberately with an issue reference; re-enabling reds every run'],
        ['deploy-main-only', 'deploy\\.yml', 'production deploys run from main only; a PR having no deploy check is by design'],
      ),
    },
  },
];

// --- module: canary.md -------------------------------------------------------

const canary: Scenario[] = [
  {
    id: 'ship-canary-monitor-config',
    skill: 'ship',
    source: [LEGACY('canary.md')],
    task:
      'Review the post-deploy canary in monitor/ and report every way it will misjudge production health, ' +
      'including cases where it will alert on something harmless. Do not change any files.',
    materialize: (d) => {
      writeFile(d, 'monitor/canary.config.json', JSON.stringify({
        url: 'https://acme.example.com',
        pages: ['/', '/dashboard', '/billing'],
        duration_min: 10,
        interval_s: 60,
        alert_rules: {
          console_errors: { operator: '>', value: 0, scope: 'absolute' },
          load_time_ms: { operator: '>', value: 500, scope: 'absolute' },
          alert_after_consecutive_checks: 1,
        },
        on_alert: 'revert',
      }, null, 2) + '\n');
      writeFile(d, 'monitor/run-canary.sh', [
        '#!/usr/bin/env bash',
        'set -uo pipefail',
        'CFG=monitor/canary.config.json',
        '',
        '# Baseline is optional; if it is missing we compare against nothing.',
        'BASELINE=$(cat monitor/baseline.json 2>/dev/null || echo "{}")',
        '',
        'for page in $(jq -r ".pages[]" "$CFG"); do',
        '  errs=$("$B" console --errors | wc -l)',
        '  load=$("$B" perf | jq -r .load_time_ms)',
        '  if [ "$errs" -gt 0 ] || [ "$load" -gt 500 ]; then',
        '    echo "ALERT on $page (errors=$errs load=$load)"',
        '    git revert HEAD --no-edit && git push',
        '  fi',
        'done',
        '',
      ].join('\n'));
      writeFile(d, 'monitor/known-baseline-notes.md', [
        '# Baseline notes',
        '',
        'Production has carried three console errors on every page since the analytics',
        'vendor migration: two deprecation notices and one blocked third-party cookie.',
        'Steady-state homepage load time is 420ms.',
        '',
      ].join('\n'));
      writeFile(d, 'monitor/ignore-list.json', JSON.stringify({
        note: 'Console WARNINGS only. Errors are never suppressed here.',
        ignored_warnings: [
          'A cookie associated with a cross-site resource was set without SameSite',
          'Deprecated feature used: window.webkitStorageInfo',
        ],
      }, null, 2) + '\n');
      writeFile(d, 'monitor/screenshot-on-alert.sh', [
        '#!/usr/bin/env bash',
        '# Every alert captures a full-page screenshot before notifying. It is slower',
        '# than a text-only alert on purpose: an alert without evidence gets dismissed.',
        'set -euo pipefail',
        '"$B" snapshot -i -a -o ".gstack/canary-reports/screenshots/$1-alert.png"',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['absolute-error-threshold', 'absolute|three (console )?errors|baseline'],
        ['single-check-alert', 'consecutive|single check|one check|transient|flap'],
        ['absolute-perf-threshold', '500|2x|relative|420'],
        // No path token: the baseline file is absent on purpose, and the
        // fixture-completeness check would read a path here as a broken pointer.
        ['no-baseline-captured', 'no baseline|missing baseline|without a baseline|optional baseline|\\{\\}'],
        ['auto-revert', 'git revert|revert|read-only|mutat|without (asking|confirmation)'],
        ['no-declared-rollback-threshold', 'rollback threshold|threshold.*(declare|before)|no.*rollback criteria'],
      ),
      traps: traps(
        ['warning-ignore-list', 'ignore-list\\.json', 'suppresses warnings only; the module says to ignore warnings'],
        ['screenshot-cost', 'screenshot-on-alert\\.sh', 'evidence on every alert is mandatory, not waste'],
      ),
    },
  },
  {
    id: 'ship-canary-verdict-from-log',
    skill: 'ship',
    source: [LEGACY('canary.md')],
    task:
      'Read monitor/baseline.json and monitor/canary-run.log from the deploy that just went out. Report which ' +
      'findings are real production regressions, with the evidence from the log. Do not change any files.',
    materialize: (d) => {
      writeFile(d, 'monitor/baseline.json', JSON.stringify({
        url: 'https://acme.example.com',
        timestamp: '2026-03-01T11:00:00Z',
        branch: 'main',
        pages: {
          '/': { screenshot: 'baselines/home.png', console_errors: 3, load_time_ms: 420 },
          '/dashboard': { screenshot: 'baselines/dashboard.png', console_errors: 3, load_time_ms: 610 },
          '/billing': { screenshot: 'baselines/billing.png', console_errors: 3, load_time_ms: 500 },
        },
        known_errors: [
          'Deprecated feature used: window.webkitStorageInfo',
          'A cookie associated with a cross-site resource was set without SameSite',
          'Failed to load resource: net::ERR_BLOCKED_BY_CLIENT (adblock)',
        ],
      }, null, 2) + '\n');
      const check = (n: number, t: number, body: string[]) => [`--- check #${n} (t+${t}s) ---`, ...body, ''];
      writeFile(d, 'monitor/canary-run.log', [
        'canary start url=https://acme.example.com duration=10m interval=60s',
        '',
        ...check(1, 0, [
          'GET / 200 load=430ms console_errors=3 (all known)',
          'GET /dashboard 200 load=615ms console_errors=3 (all known)',
          'GET /billing 200 load=505ms console_errors=3 (all known)',
        ]),
        ...check(2, 60, [
          'GET / 200 load=445ms console_errors=3 (all known)',
          'GET /dashboard 200 load=620ms console_errors=3 (all known)',
          'GET /billing 200 load=510ms console_errors=3 (all known)',
        ]),
        ...check(3, 120, [
          'GET / 200 load=1180ms console_errors=3 (all known)',
          'GET /dashboard 502 Bad Gateway (upstream) load=- console_errors=-',
          'GET /billing 200 load=520ms console_errors=3 (all known)',
        ]),
        ...check(4, 180, [
          'GET / 200 load=1450ms console_errors=3 (all known)',
          'GET /dashboard 200 load=630ms console_errors=3 (all known)',
          'GET /billing 200 load=515ms console_errors=3 (all known)',
        ]),
        ...check(5, 240, [
          'GET / 200 load=1690ms console_errors=3 (all known)',
          'GET /dashboard 200 load=628ms console_errors=3 (all known)',
          "GET /billing 200 load=530ms console_errors=4 NEW: TypeError: Cannot read properties of undefined (reading 'plan')",
        ]),
        ...check(6, 300, [
          'GET / 200 load=1820ms console_errors=3 (all known)',
          'GET /dashboard 200 load=640ms console_errors=3 (all known)',
          "GET /billing 200 load=545ms console_errors=4 NEW: TypeError: Cannot read properties of undefined (reading 'plan')",
        ]),
        ...check(7, 360, [
          'GET / 200 load=1900ms console_errors=3 (all known)',
          'GET /dashboard 200 load=635ms console_errors=3 (all known)',
          "GET /billing 200 load=540ms console_errors=4 NEW: TypeError: Cannot read properties of undefined (reading 'plan')",
        ]),
        ...check(8, 420, [
          'GET / 200 load=1875ms console_errors=3 (all known)',
          'GET /dashboard 200 load=622ms console_errors=3 (all known)',
          "GET /billing 200 load=548ms console_errors=4 NEW: TypeError: Cannot read properties of undefined (reading 'plan')",
        ]),
        'canary end checks=8',
        '',
      ].join('\n'));
      writeFile(d, 'monitor/NOTES.md', [
        '# What the log records',
        '',
        'Each check hits every monitored page once. `console_errors` is a count;',
        '"all known" means every error matched `known_errors` in baseline.json.',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['new-console-error', "reading 'plan'|TypeError|/billing"],
        ['sustained-perf-regression', '1900|1820|4x|4\\.[0-9]x|420'],
        ['perf-is-relative-to-baseline', 'baseline|2x|relative'],
        ['persisted-across-checks', 'check #5|four (consecutive )?checks|consecutive|sustained|persist'],
        ['dashboard-unchanged', 'dashboard.*(unchanged|healthy|within|no change)|610|615'],
      ),
      traps: traps(
        ['transient-502', '502', 'single-check upstream blip that recovered at check #4; not an alert'],
        ['known-adblock-error', 'ERR_BLOCKED_BY_CLIENT', 'present in the baseline on every page; alerting on it is alerting on an absolute'],
      ),
    },
  },
];

// --- module: document-release.md ---------------------------------------------

const documentRelease: Scenario[] = [
  {
    id: 'ship-doc-release-drift',
    skill: 'ship',
    source: [LEGACY('document-release.md')],
    task:
      'This branch is about to merge. Report every documentation file in this repository that is now wrong, and ' +
      'every piece of new public surface that would ship undocumented. Do not edit any files.',
    materialize: (d) =>
      gitRepo(d, {
        commits: [
          {
            message: 'base',
            files: {
              'src/scheduler.ts': [
                'export class Scheduler {',
                '  constructor(private readonly serial: boolean) {}',
                '  run(jobs: string[]): number { return jobs.length; }',
                '}',
                '',
              ].join('\n'),
              'src/cli.ts': [
                'import { Scheduler } from "./scheduler";',
                '',
                'export function main(argv: string[]): number {',
                '  return new Scheduler(argv.includes("--serial")).run(argv);',
                '}',
                '',
              ].join('\n'),
              'README.md': [
                '# acme-runner',
                '',
                '## Flags',
                '',
                '| Flag | Meaning |',
                '|------|---------|',
                '| `--serial` | Run jobs one at a time |',
                '| `--quiet` | Suppress progress output |',
                '',
                '## Environment',
                '',
                '| Variable | Meaning |',
                '|----------|---------|',
                '| `GS_LOG_LEVEL` | debug, info, warn |',
                '',
                'See [ARCHITECTURE.md](ARCHITECTURE.md).',
                '',
              ].join('\n'),
              'ARCHITECTURE.md': [
                '# Architecture',
                '',
                '```',
                '  cli.ts ──▶ Scheduler ──▶ worker pool',
                '                 │',
                '                 └──▶ metrics',
                '```',
                '',
                'The `Scheduler` owns job ordering. In serial mode it holds a single slot.',
                '',
              ].join('\n'),
              'CLAUDE.md': [
                '# acme-runner',
                '',
                '## Commands',
                '',
                '```bash',
                'bun run start -- --serial',
                '```',
                '',
              ].join('\n'),
              'docs/adr/0003-scheduler-choice.md': [
                '# ADR 0003: a single Scheduler class over a job queue',
                '',
                'Status: accepted (2025-11-02). Superseded records are added as new ADRs.',
                '',
                'Architecture decision records are immutable by convention: they describe',
                'what was decided at the time, with the names that existed at the time.',
                'Later renames do not get back-ported into an accepted ADR.',
                '',
              ].join('\n'),
              'docs/i18n/README.ja.md': [
                '# acme-runner',
                '',
                '翻訳は最後にリリースされたバージョンに追従します。1 リリース分の遅れは仕様です。',
                '',
                '| フラグ | 意味 |',
                '|------|------|',
                '| `--serial` | 逐次実行 |',
                '',
              ].join('\n'),
            },
          },
          {
            message: 'feat: concurrent dispatcher replaces the serial scheduler',
            checkout: 'feat/dispatcher',
            date: '2026-03-04T09:00:00',
            remove: ['src/scheduler.ts'],
            files: {
              'src/dispatcher.ts': [
                'import { maxWorkers } from "./config";',
                '',
                'export class Dispatcher {',
                '  constructor(private readonly concurrency = maxWorkers()) {}',
                '  run(jobs: string[]): number { return Math.min(jobs.length, this.concurrency); }',
                '}',
                '',
              ].join('\n'),
              'src/config.ts': [
                '// GS_MAX_WORKERS caps the dispatcher. Unset means one worker per core.',
                'export function maxWorkers(): number {',
                '  const raw = process.env.GS_MAX_WORKERS;',
                '  return raw ? Number(raw) : 4;',
                '}',
                '',
              ].join('\n'),
              'src/cli.ts': [
                'import { Dispatcher } from "./dispatcher";',
                '',
                '// --serial is gone. --concurrency <n> replaces it.',
                'export function main(argv: string[]): number {',
                '  const i = argv.indexOf("--concurrency");',
                '  const n = i >= 0 ? Number(argv[i + 1]) : undefined;',
                '  return new Dispatcher(n).run(argv);',
                '}',
                '',
              ].join('\n'),
            },
          },
        ],
      }),
    truth: {
      expected: exp(
        ['diagram-drift', 'ARCHITECTURE\\.md|diagram|Scheduler'],
        ['removed-flag-still-documented', '--serial'],
        ['new-flag-undocumented', '--concurrency'],
        ['new-env-undocumented', 'GS_MAX_WORKERS'],
        ['readme-flag-table', 'README\\.md'],
        ['claude-md-stale-command', 'CLAUDE\\.md'],
      ),
      traps: traps(
        ['immutable-adr', '0003-scheduler-choice\\.md', 'ADRs record what was decided with the names of the time; not back-ported'],
        ['translation-lag', 'README\\.ja\\.md', 'translations follow the last released version by convention'],
      ),
    },
  },
];

// --- module: document-generate.md --------------------------------------------

const documentGenerate: Scenario[] = [
  {
    id: 'ship-doc-generate-misfiled',
    skill: 'ship',
    source: [LEGACY('document-generate.md')],
    task:
      'Audit the documentation in docs/ against the four documentation quadrants (tutorial, how-to, reference, ' +
      'explanation). Report every document that carries content belonging to a different quadrant, every required ' +
      'section that is missing, and every step a reader cannot act on. Do not edit any files.',
    materialize: (d) => {
      writeFile(d, 'README.md', '# acme-webhooks\n\nA webhook delivery service.\n');
      writeFile(d, 'docs/reference-webhook-api.md', [
        '# Webhook API',
        '',
        '## API / Interface',
        '',
        '`POST /webhooks` accepts a string for `url` and a string for `secret`.',
        '',
        '## Why we chose HMAC over JWT',
        '',
        'JWT would have let receivers verify without a shared secret, but it drags in',
        'key rotation and a JWKS endpoint. HMAC-SHA256 over the raw body is two lines',
        'on the receiver side, and every language ships it. We accepted the shared',
        'secret cost to keep the receiver implementation trivial, and we revisit this',
        'if a customer ever asks for asymmetric verification.',
        '',
        '## Examples',
        '',
        '```bash',
        'curl -X POST /webhooks -d \'{"url":"https://x.test/hook"}\'',
        '```',
        '',
      ].join('\n'));
      writeFile(d, 'docs/howto-rotate-keys.md', [
        '# Rotating keys',
        '',
        '## Steps',
        '',
        '1. Consider whether your receivers can handle two active secrets.',
        '2. Run the appropriate migration command.',
        '3. Now configure the new secret.',
        '4. Deploy.',
        '',
      ].join('\n'));
      writeFile(d, 'docs/tutorial-first-webhook.md', [
        '# Your first webhook',
        '',
        'This tutorial covers webhook delivery.',
        '',
        '## What you\'ll need',
        '',
        '- An account',
        '',
        '## Step 1',
        'Install the CLI.',
        '## Step 2',
        'Create a project.',
        '## Step 3',
        'Create a service account.',
        '## Step 4',
        'Grant the service account the webhook role.',
        '## Step 5',
        'Create a signing secret.',
        '## Step 6',
        'Register a receiver URL.',
        '## Step 7',
        'Send a test event. You finally see a delivery in the log.',
        '',
      ].join('\n'));
      writeFile(d, 'docs/explanation-queue-design.md', [
        '# Why deliveries are queued',
        '',
        '## The approach',
        '',
        'We chose a durable queue.',
        '',
        '## Options / Configuration',
        '',
        '| Option | Type | Default |',
        '|--------|------|---------|',
        '| `url` | string | none |',
        '| `secret` | string | none |',
        '| `retries` | number | 5 |',
        '| `timeout_ms` | number | 3000 |',
        '',
      ].join('\n'));
      writeFile(d, 'docs/reference-error-codes.md', [
        '# Error codes',
        '',
        '## API / Interface',
        '',
        'Every delivery failure carries exactly one of these codes.',
        '',
        '| Code | HTTP | Meaning |',
        '|------|------|---------|',
        '| `receiver_timeout` | 504 | receiver did not answer within `timeout_ms` |',
        '| `bad_signature` | 401 | receiver rejected the HMAC |',
        '| `url_unresolvable` | 502 | DNS failure on the receiver host |',
        '',
        '## Related',
        '',
        '- [Webhook API](reference-webhook-api.md)',
        '',
        '<!-- A code table with no prose is the complete reference for a code table.',
        '     Adding narrative here would make it a worse lookup, not a better one. -->',
        '',
      ].join('\n'));
      writeFile(d, 'docs/howto-recover-from-outage.md', [
        '# How to replay deliveries after a receiver outage',
        '',
        '## Prerequisites',
        '',
        '- A receiver that is answering again',
        '',
        '## Steps',
        '',
        '1. Run `acme webhooks replay --since 2026-03-04T00:00:00Z`.',
        '2. Watch the count in `acme webhooks status`.',
        '',
        '## Verification',
        '',
        '`acme webhooks status` reports `pending: 0`.',
        '',
        '## Troubleshooting',
        '',
        'If `pending` stops falling, the receiver is rejecting the signature: check',
        '`bad_signature` in the delivery log.',
        '',
        '<!-- Two steps because the task is two steps. Padding it would not help. -->',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['reference-holds-explanation', 'reference-webhook-api|why we chose|rationale|HMAC over JWT'],
        ['howto-title', 'howto-rotate-keys|"How to"|title'],
        ['missing-verification', 'verification'],
        ['missing-troubleshooting', 'troubleshoot'],
        ['non-actionable-step', 'appropriate|consider whether|now configure|which command'],
        ['tutorial-too-slow', 'step 7|3 steps|three steps|seven steps|too slow|first result'],
        ['explanation-repeats-reference', 'duplicat|repeat|options table|link to it'],
        ['no-crosslinks', 'cross.?link|not linked|unreachable|discoverab|README'],
        ['vague-type', 'accepts a string|max|constraint|pattern|just.*string'],
      ),
      traps: traps(
        ['table-only-reference', 'reference-error-codes\\.md', 'a code table is the complete reference for a code table'],
        ['two-step-howto', 'howto-recover-from-outage\\.md', 'two steps because the task is two steps; verification and troubleshooting are both present'],
      ),
    },
  },
];

// --- module: setup-deploy.md -------------------------------------------------

const setupDeploy: Scenario[] = [
  {
    id: 'ship-setup-deploy-key-leak',
    skill: 'ship',
    source: [LEGACY('setup-deploy.md')],
    task:
      'Review scripts/setup-deploy.sh and the deploy configuration it has already produced in this repository. ' +
      'Report every defect, including anything it writes somewhere it should not and anything it exposes that ' +
      'must never be exposed. Do not change any files.',
    materialize: (d) => {
      writeFile(d, 'render.yaml', 'services:\n  - type: web\n    name: acme-web\n    env: node\n');
      writeFile(d, 'scripts/setup-deploy.sh', [
        '#!/usr/bin/env bash',
        'set -uo pipefail',
        '',
        'echo "RENDER_API_KEY starts with: ${RENDER_API_KEY:0:6}"',
        'echo "FLY_API_TOKEN=$FLY_API_TOKEN" >> deploy.log',
        '',
        '# Platform detection.',
        'if grep -q vercel package.json; then PLATFORM=vercel; else PLATFORM=unknown; fi',
        '',
        '# The fly CLI is required.',
        'command -v fly >/dev/null || { echo "install the fly CLI first" >&2; exit 1; }',
        '',
        'cat >> CLAUDE.md <<EOF',
        '',
        '## Deploy Configuration',
        '- Platform: $PLATFORM',
        '- Production URL: https://acme-web.onrender.com',
        'EOF',
        '',
        'cat > deploy.config.json <<EOF',
        '{"platform":"$PLATFORM","url":"https://acme-web.onrender.com"}',
        'EOF',
        '',
      ].join('\n'));
      writeFile(d, 'CLAUDE.md', [
        '# acme-web',
        '',
        '## Deploy Configuration',
        '- Platform: unknown',
        '- Production URL: https://acme-web.onrender.com',
        '',
        '## Deploy Configuration',
        '- Platform: unknown',
        '- Production URL: https://acme-web.onrender.com',
        '',
      ].join('\n'));
      writeFile(d, 'deploy.log', 'FLY_API_TOKEN=<redacted-by-fixture>\n');
      // Left behind by the previous run, which is how the split-brain config is
      // visible on disk: CLAUDE.md and this file both claim to hold the truth.
      writeFile(d, 'deploy.config.json', JSON.stringify({ platform: 'unknown', url: 'https://acme-web.onrender.com' }, null, 2) + '\n');
      writeFile(d, 'package.json', JSON.stringify({
        name: 'acme-web', version: '1.0.0.0', devDependencies: { 'vercel-node-shim': '^1.0.0' },
      }, null, 2) + '\n');
      writeFile(d, '.env.example', [
        '# Placeholders only. Real values live in the platform dashboard and are never',
        '# committed. These strings are deliberately not key-shaped.',
        'RENDER_API_KEY=PLACEHOLDER_NOT_A_REAL_KEY',
        'FLY_API_TOKEN=PLACEHOLDER_NOT_A_REAL_TOKEN',
        '',
      ].join('\n'));
      writeFile(d, 'scripts/probe-render.sh', [
        '#!/usr/bin/env bash',
        '# Health probe. A temporarily unreachable URL is reported and does not fail',
        '# the run: the configuration is still useful when the service is asleep.',
        'set -uo pipefail',
        'curl -sf "$1" -o /dev/null -w "%{http_code}" 2>/dev/null || echo "UNREACHABLE"',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['key-prefix-echoed', ':0:6|prefix|first six|key bytes|RENDER_API_KEY.*(echo|print|leak)'],
        ['token-written-to-log', 'FLY_API_TOKEN|deploy\\.log'],
        ['duplicate-config-section', 'duplicate|twice|two|append|idempot'],
        ['cli-hard-requirement', 'command -v fly|exit 1|fall ?back|optional'],
        ['config-not-in-claude-md', 'deploy\\.config\\.json|CLAUDE\\.md.*(source of truth|only)|two places'],
        ['detection-by-grep', 'grep|package\\.json|render\\.yaml|marker'],
      ),
      traps: traps(
        ['env-example-placeholder', '\\.env\\.example', 'placeholders that are deliberately not key-shaped'],
        ['probe-does-not-block', 'probe-render\\.sh', 'an unreachable health URL is reported, not fatal'],
      ),
    },
  },
];

// --- module: landing-report.md -----------------------------------------------

const landingReport: Scenario[] = [
  {
    id: 'ship-landing-queue-collision',
    skill: 'ship',
    source: [LEGACY('landing-report.md')],
    task:
      'Read queue/prs.json, queue/siblings.json, base-version.txt and VERSION. Report every version-collision ' +
      'problem this repository is about to hit, which sibling worktrees are likely to ship before this branch, ' +
      'and what happens to whoever merges second. Do not change any files.',
    materialize: (d) => {
      writeFile(d, 'VERSION', '1.7.0.0\n');
      writeFile(d, 'base-version.txt', '1.6.4.0\n');
      writeFile(d, 'queue/prs.json', JSON.stringify({
        host: 'github',
        offline: false,
        base: 'main',
        claimed: [
          { pr: 1152, branch: 'alpha-branch', version: '1.7.0.0', url: 'https://github.com/acme/svc/pull/1152' },
          { pr: 1153, branch: 'beta-branch', version: '1.7.0.0', url: 'https://github.com/acme/svc/pull/1153' },
          { pr: 1151, branch: 'gamma-branch', version: '1.6.5.0', url: 'https://github.com/acme/svc/pull/1151' },
        ],
      }, null, 2) + '\n');
      writeFile(d, 'queue/siblings.json', JSON.stringify({
        workspace_root: '/Users/dev/conductor/svc',
        siblings: [
          { path: '../tokyo-v2', branch: 'feat/dashboard', version: '1.7.1.0', last_commit_hours: 3, open_pr: null },
          { path: '../melbourne', branch: 'feat/review', version: '1.6.0.0', last_commit_hours: 288, open_pr: null },
          { path: '../osaka', branch: 'feat/payments', version: '1.8.0.0', last_commit_hours: 5, open_pr: 1155 },
        ],
      }, null, 2) + '\n');
      writeFile(d, 'queue/archived-prs.json', JSON.stringify({
        note: 'CLOSED and MERGED pull requests. A closed PR holds no version slot; this file exists only so the dashboard can explain where a landed version came from.',
        archived: [
          { pr: 1104, branch: 'old-alpha', version: '1.7.0.0', state: 'CLOSED' },
          { pr: 1099, branch: 'old-beta', version: '1.6.4.0', state: 'MERGED' },
        ],
      }, null, 2) + '\n');
      writeFile(d, 'queue/NOTES.md', [
        '# Queue snapshot',
        '',
        '`prs.json` is the open-PR claim list. `siblings.json` lists Conductor',
        'worktrees next to this one. `base-version.txt` is VERSION on the base branch.',
        'A sibling counts as likely-to-ship when its VERSION is ahead of base, its last',
        'commit is under 24 hours old, and it has no open PR.',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['pr-collision', '1152|1153'],
        ['this-branch-collides', '1\\.7\\.0\\.0'],
        ['merge-second-consequence', 'overwrite|duplicate|whoever merges second|second to merge'],
        ['active-sibling-tokyo', 'tokyo'],
        ['rebump-remedy', 'rebump|re-?run|next (free )?slot|advance'],
      ),
      traps: traps(
        ['closed-pr-slot', 'archived-prs\\.json', 'closed and merged PRs hold no version slot'],
        ['stale-sibling', 'melbourne', '12 days idle and behind base; not shipping before this branch'],
      ),
    },
  },
];

// --- module: ios-clean.md ----------------------------------------------------

const iosClean: Scenario[] = [
  {
    id: 'ship-ios-clean-release-leak',
    skill: 'ship',
    source: [LEGACY('ios-clean.md')],
    task:
      'This iOS app is about to be submitted to the App Store. Report every way the debug bridge could end up ' +
      'compiled into the Release build, and every check that would have caught it and is not present. Do not ' +
      'change any code.',
    materialize: (d) => {
      writeFile(d, 'Package.swift', [
        '// swift-tools-version:5.9',
        'import PackageDescription',
        '',
        'let package = Package(',
        '    name: "AcmeApp",',
        '    dependencies: [',
        '        .package(url: "https://github.com/garrytan/DebugBridge", from: "1.0.0"),',
        '    ],',
        '    targets: [',
        '        .target(name: "App", dependencies: ["DebugBridge"]),',
        '        .testTarget(name: "AppTests", dependencies: ["App", "DebugBridge"]),',
        '    ]',
        ')',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/AppMain.swift', [
        'import SwiftUI',
        'import DebugBridge',
        '',
        '@main',
        'struct AcmeApp: App {',
        '    init() {',
        '        DebugBridgeManager.shared.start()',
        '    }',
        '    var body: some Scene { WindowGroup { SettingsView() } }',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/Generated/StateAccessor.swift', [
        '// Auto-generated state accessor. Do not edit.',
        'import DebugBridge',
        '',
        'extension AppState {',
        '    func snapshotFields() -> [String: String] {',
        '        ["authToken": authToken, "userEmail": userEmail]',
        '    }',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/Models/AppState.swift', [
        'import DebugBridge',
        'import Foundation',
        '',
        '@Observable',
        'final class AppState {',
        '    @Snapshotable var authToken: String = ""',
        '    @Snapshotable var userEmail: String = ""',
        '    var lastSync: Date?',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/Debug/PreviewData.swift', [
        '#if DEBUG',
        'import Foundation',
        '',
        '// Preview fixtures. The #if DEBUG guard removes the whole file from Release,',
        '// so the fake credentials below cannot reach a shipped binary.',
        'enum PreviewData {',
        '    static let state: AppState = {',
        '        let s = AppState()',
        '        s.authToken = "preview-token-not-real"',
        '        return s',
        '    }()',
        '}',
        '#endif',
        '',
      ].join('\n'));
      writeFile(d, 'Tests/AppTests/DebugBridgeSmokeTests.swift', [
        'import XCTest',
        '@testable import App',
        'import DebugBridge',
        '',
        '// Test targets build in Debug. Importing the bridge here does not put it in',
        '// the app binary that ships.',
        'final class DebugBridgeSmokeTests: XCTestCase {',
        '    func testManagerStarts() throws { XCTAssertNotNil(DebugBridgeManager.shared) }',
        '}',
        '',
      ].join('\n'));
      writeFile(d, '.github/workflows/ci.yml', [
        'name: ci',
        'on: [push]',
        'jobs:',
        '  test:',
        '    runs-on: macos-14',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - run: swift build',
        '      - run: swift test',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['no-debug-configuration-condition', 'when\\(configuration|\\.debug\\)|condition|Debug only|Release'],
        ['start-not-guarded', '#if DEBUG|AppMain|DebugBridgeManager'],
        ['generated-accessor-shipped', 'StateAccessor'],
        ['secret-marked-snapshotable', 'authToken|@Snapshotable'],
        ['no-release-invariant', 'swift build -c release|nm -j|invariant|symbol|ci\\.yml'],
      ),
      traps: traps(
        ['test-target-import', 'DebugBridgeSmokeTests', 'test targets build in Debug; the import never reaches the app binary'],
        ['debug-only-previews', 'PreviewData', 'whole file removed from Release by #if DEBUG'],
      ),
    },
  },
];

// --- module: ios-sync.md -----------------------------------------------------

const iosSync: Scenario[] = [
  {
    id: 'ship-ios-sync-regen-audit',
    skill: 'ship',
    source: [LEGACY('ios-sync.md')],
    task:
      'Review scripts/ios-sync.sh and the generated tree it maintains. Report every defect that could leave a ' +
      'stale, broken, or silently incomplete debug bridge behind, and anything it destroys that it should ' +
      'preserve. Do not change any code.',
    materialize: (d) => {
      writeFile(d, 'scripts/ios-sync.sh', [
        '#!/usr/bin/env bash',
        'set -uo pipefail',
        '. scripts/preflight-optional.sh',
        '',
        'APP=Sources/App',
        '',
        '# Regenerate whenever any source file is newer than the generated tree.',
        'if [ -n "$(find "$APP" -name \'*.swift\' -newer "$APP/DebugBridgeGenerated/StateAccessor.swift")" ]; then',
        '  swift run gen-accessors --input "$APP" --output "$APP/DebugBridgeGenerated"',
        'fi',
        '',
        '# Refresh the templated files.',
        'cp templates/StateServer.swift.template "$APP/DebugBridgeGenerated/StateServer.swift"',
        '',
        'swift build',
        'echo "sync done"',
        '',
      ].join('\n'));
      writeFile(d, 'scripts/preflight-optional.sh', [
        '#!/usr/bin/env bash',
        '# Optional tooling probe. Every helper here is best-effort: a machine without',
        '# the managed runtime still gets a working sync, so a missing helper must not',
        '# abort the caller.',
        'command -v xcodebuild >/dev/null 2>&1 || true',
        '"${GSTACK_BIN:-$HOME/.gstack/bin}/gstack" --version 2>/dev/null || true',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/DebugBridgeGenerated/.gstack-version', '1.20.0.0\n');
      writeFile(d, 'Sources/App/DebugBridgeGenerated/StateAccessor.swift', [
        '// Auto-generated state accessor. Do not edit.',
        'extension AppState {',
        '    func snapshotFields() -> [String: String] { ["userEmail": userEmail] }',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/DebugBridgeGenerated/StateServer.swift', [
        'import Foundation',
        '',
        'struct StateServer {',
        '    // GSTACK-EDIT-LINE: this app binds the state server to the tunnel',
        '    // interface instead of loopback. Keep this across resyncs.',
        '    static let bindAddress = "127.0.0.1"',
        '    static let port = 8917',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'templates/StateServer.swift.template', [
        'import Foundation',
        '',
        'struct StateServer {',
        '    static let bindAddress = "127.0.0.1"',
        '    static let port = 8917',
        '    static let requiresBootToken = true',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/Models/AppState.swift', [
        'import Foundation',
        '',
        '@Observable',
        'final class AppState {',
        '    @Snapshotable var userEmail: String = ""',
        '    @Snapshotable var planTier: String = "free"',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/Models/Telemetry.swift', [
        'import Foundation',
        '',
        '// @Observable but deliberately NOT @Snapshotable: counters are noise in a',
        '// restored snapshot, so codegen is correct to leave this class out.',
        '@Observable',
        'final class Telemetry {',
        '    var tapCount: Int = 0',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/AppTests/Fixtures/SampleState.swift', [
        'import Foundation',
        '',
        '// Test fixture. Lives under the source root that gen-accessors is pointed at.',
        '@Observable',
        'final class SampleState {',
        '    @Snapshotable var fixtureField: String = ""',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'NOTES.md', [
        '# Sync notes',
        '',
        'The installed tool reports version 1.51.0.0. `DebugBridgeGenerated/.gstack-version`',
        'records the version that produced the tree on disk.',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['test-fixtures-scanned', '--exclude|Fixtures|SampleState|AppTests'],
        ['missing-accessor', 'planTier'],
        ['version-not-checked', 'gstack-version|1\\.20\\.0\\.0|already up to date|unconditional'],
        ['weak-cache-key', 'newer|mtime|swift version|generator|lockfile|platform triple|composite|hash'],
        ['clobbers-user-edit', 'GSTACK-EDIT-LINE|fold|user edit|clobber|overwrit'],
        ['missing-verification', 'xcodebuild|schema hash|/state/snapshot|restore'],
      ),
      traps: traps(
        ['observable-not-snapshotable', 'Telemetry', 'not marked @Snapshotable, so codegen correctly excludes it'],
        ['best-effort-preflight', 'preflight-optional\\.sh', 'best-effort probes: a missing helper must not abort the sync'],
      ),
    },
  },
];

// --- second scenarios for the six single-covered ship modules ----------------

const documentRelease2: Scenario[] = [
  {
    id: 'ship-doc-release-gap-severity',
    skill: 'ship',
    source: [LEGACY('document-release.md')],
    task:
      'Build the documentation coverage map for what this branch adds, then report every gap and how serious each ' +
      'one is. Say what should happen about the gaps. Do not create or edit any documentation.',
    materialize: (d) =>
      gitRepo(d, {
        commits: [
          {
            message: 'base',
            files: {
              'README.md': [
                '# acme-cli',
                '',
                '## Commands',
                '',
                '| Command | What it does |',
                '|---------|--------------|',
                '| `acme sync` | Push local state to the server |',
                '',
                '## Docs',
                '',
                '- [Getting started](docs/tutorial-getting-started.md)',
                '- [Sync reference](docs/reference-sync.md)',
                '- [How to sync a fork](docs/howto-sync-a-fork.md)',
                '- [Why sync is one-way](docs/explanation-one-way-sync.md)',
                '',
              ].join('\n'),
              'docs/tutorial-getting-started.md': '# Get your first sync working\n\n## Step 1\nRun `acme sync`.\n',
              'docs/reference-sync.md': '# acme sync\n\n## API / Interface\n\n`acme sync [--dry-run]`\n',
              'docs/howto-sync-a-fork.md': '# How to sync a fork\n\n## Steps\n\n1. Run `acme sync --remote fork`.\n',
              'docs/explanation-one-way-sync.md': '# Why sync is one-way\n\n## The problem\n\nTwo-way sync needs conflict resolution nobody wants to configure.\n',
              'docs/reference-internal-ipc.md': [
                '# Internal IPC frames',
                '',
                '<!-- internal: deliberately not linked from README. This documents a',
                '     private socket protocol with no stability promise; linking it from',
                '     the README would invite people to build on it. -->',
                '',
                '## API / Interface',
                '',
                'Frame header is 8 bytes: 4-byte length, 1-byte kind, 3 reserved.',
                '',
              ].join('\n'),
              'src/cli/sync.ts': 'export const sync = (dryRun = false) => (dryRun ? 0 : 1);\n',
            },
          },
          {
            message: 'feat: egress receipts',
            checkout: 'feat/egress',
            date: '2026-03-04T09:00:00',
            files: {
              'src/cli/egress.ts': [
                'import { appendReceipt } from "../egress/receipts";',
                '',
                '// New command: `acme egress`. Lists and verifies the local egress receipt',
                '// chain, and prints the grants view.',
                'export function egress(args: string[]): number {',
                '  if (args[0] === "verify") return appendReceipt("verify") ? 0 : 1;',
                '  return 0;',
                '}',
                '',
              ].join('\n'),
              'src/egress/receipts.ts': [
                'import { createHash } from "crypto";',
                '',
                '// Receipts are hash-chained: each entry carries the sha256 of the previous',
                '// entry, so a deleted or edited receipt breaks verification. The chain is',
                '// what makes the local log tamper-evident without a server.',
                'export function chainHash(prev: string, body: string): string {',
                '  return createHash("sha256").update(prev + body).digest("hex");',
                '}',
                '',
                'export function appendReceipt(kind: string): boolean {',
                '  return kind.length > 0;',
                '}',
                '',
              ].join('\n'),
              'src/config.ts': [
                '// egress_receipt_dir overrides where the receipt chain is written.',
                '// Unset means $GSTACK_HOME/egress.',
                'export function receiptDir(cfg: Record<string, string>): string {',
                '  return cfg.egress_receipt_dir ?? "";',
                '}',
                '',
              ].join('\n'),
              'README.md': [
                '# acme-cli',
                '',
                '## Commands',
                '',
                '| Command | What it does |',
                '|---------|--------------|',
                '| `acme sync` | Push local state to the server |',
                '| `acme egress` | List and verify egress receipts |',
                '',
                '## Docs',
                '',
                '- [Getting started](docs/tutorial-getting-started.md)',
                '- [Sync reference](docs/reference-sync.md)',
                '- [How to sync a fork](docs/howto-sync-a-fork.md)',
                '- [Why sync is one-way](docs/explanation-one-way-sync.md)',
                '',
              ].join('\n'),
            },
          },
        ],
      }),
    truth: {
      expected: exp(
        ['config-key-zero-coverage', 'egress_receipt_dir'],
        ['gap-severity-split', 'critical|zero coverage|common gap|reference.?only|only.*(README|table)'],
        ['missing-howto', 'how.?to'],
        ['missing-explanation', 'explanation|why|hash.?chain|rationale|tamper'],
        ['flag-not-generate', 'flag|do not (auto.?)?generate|document-generate|suggest'],
        ['discoverability', 'link|reachable|two clicks|2 clicks|README'],
      ),
      traps: traps(
        ['unlinked-by-design', 'reference-internal-ipc\\.md', 'private protocol deliberately not linked from the README'],
      ),
    },
  },
];

const documentGenerate2: Scenario[] = [
  {
    id: 'ship-doc-generate-quadrant-plan',
    skill: 'ship',
    source: [LEGACY('document-generate.md')],
    task:
      'Three things landed on this branch: the `--watch` CLI flag, the internal ring buffer module, and the ' +
      'back-pressure design pattern described in PHILOSOPHY.md. For each one, say which of the four documentation ' +
      'quadrants it needs and which it does not need, in what order they should be written, and report anything ' +
      'already in the repository that contradicts that plan. Do not create any documentation.',
    materialize: (d) => {
      writeFile(d, 'README.md', '# acme-runner\n\nA job runner.\n');
      writeFile(d, 'src/cli/watch.ts', [
        '// --watch re-runs the pipeline whenever an input file changes. One flag, no',
        '// subcommands, no configuration.',
        'export function watch(paths: string[], onChange: () => void): () => void {',
        '  const timers = paths.map(() => setInterval(onChange, 1000));',
        '  return () => timers.forEach(clearInterval);',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'src/internal/ringbuffer.ts', [
        '// Internal. Not exported from the package entry point and has no stability',
        '// promise; the pipeline is the only caller.',
        'export class RingBuffer<T> {',
        '  private readonly slots: (T | undefined)[];',
        '  private head = 0;',
        '  private tail = 0;',
        '  constructor(private readonly capacity: number) {',
        '    this.slots = new Array(capacity);',
        '  }',
        '  // NOTE: a full buffer drops the OLDEST entry, which is what makes',
        '  // back-pressure observable to the producer instead of blocking it.',
        '  push(v: T): void {',
        '    this.slots[this.head % this.capacity] = v;',
        '    this.head += 1;',
        '    if (this.head - this.tail > this.capacity) this.tail = this.head - this.capacity;',
        '  }',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'PHILOSOPHY.md', [
        '# How this runner thinks about back-pressure',
        '',
        'A slow consumer must never block a fast producer. The ring buffer drops the',
        'oldest entry instead of applying pressure upstream, and the producer learns',
        'about it from the drop counter rather than from a stalled write.',
        '',
        'The ring buffer is a user-facing feature and is covered step by step in the',
        'getting-started tutorial.',
        '',
      ].join('\n'));
      writeFile(d, 'src/vendor/proto.ts', [
        '/* eslint-disable */',
        '// GENERATED by protoc-gen-ts from pipeline.proto. Not hand-written, not part',
        '// of the public surface, and regenerated on every build.',
        'export type Frame = { kind: number; body: Uint8Array };',
        '',
      ].join('\n'));
      writeFile(d, 'docs/_templates/quadrant-skeleton.md', [
        '# <title>',
        '',
        '<!-- Skeleton copied when starting a new doc. The empty headings are the',
        '     point: they are the required sections for the quadrant. -->',
        '',
        '## <section>',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['cli-flag-quadrants', '--watch'],
        ['cli-flag-no-explanation', 'explanation|❌|not needed|no explanation'],
        ['internal-module-no-tutorial', 'ringbuffer|ring buffer|internal'],
        ['pattern-explanation-only', 'back.?pressure|explanation only|only.*explanation'],
        ['reference-first-ordering', 'reference (doc )?(first|before)|vocabulary|order'],
        ['philosophy-contradiction', 'PHILOSOPHY\\.md'],
      ),
      traps: traps(
        ['doc-skeleton', 'quadrant-skeleton\\.md', 'a template; the empty headings are the required sections'],
        ['generated-vendor', 'proto\\.ts', 'generated, not public surface, regenerated every build'],
      ),
    },
  },
];

const setupDeploy2: Scenario[] = [
  {
    id: 'ship-setup-deploy-detection',
    skill: 'ship',
    source: [LEGACY('setup-deploy.md')],
    task:
      'Detect how this project actually deploys, then report every place the deploy configuration recorded in ' +
      'CLAUDE.md disagrees with the repository. Do not change any files.',
    materialize: (d) => {
      writeFile(d, 'CLAUDE.md', [
        '# acme-site',
        '',
        '## Deploy Configuration',
        '- Platform: heroku',
        '- Production URL: https://old-app.herokuapp.com',
        '- Deploy workflow: .github/workflows/release.yml',
        '- Deploy status command: heroku releases --app old-app -n 1',
        '- Post-deploy health check: https://old-app.herokuapp.com/health',
        '',
      ].join('\n'));
      writeFile(d, 'netlify.toml', [
        '[build]',
        '  command = "bun run build"',
        '  publish = "dist"',
        '',
        '[context.deploy-preview]',
        '  # Preview builds for every PR. This is Netlify\'s standard PR context, not a',
        '  # second production target.',
        '  command = "bun run build -- --preview"',
        '',
      ].join('\n'));
      writeFile(d, 'vercel.json', [
        '{',
        '  "_comment": "Kept only for the legacy preview domain acme-old.vercel.app, which still has inbound links. We migrated production off Vercel in March; see README.md. Do not treat this as the deploy target.",',
        '  "rewrites": [{ "source": "/(.*)", "destination": "https://acme.example.com/$1" }]',
        '}',
        '',
      ].join('\n'));
      writeFile(d, '.github/workflows/release.yml', [
        'name: release',
        'on:',
        '  push:',
        '    tags: ["v*"]',
        'jobs:',
        '  publish:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - uses: actions/checkout@v4',
        '      - run: npm publish --access public',
        '',
      ].join('\n'));
      writeFile(d, 'README.md', [
        '# acme-site',
        '',
        'Production is served from Netlify at https://acme.example.com. We migrated off',
        'Vercel in March 2026; `vercel.json` is retained only so the legacy preview',
        'domain keeps redirecting.',
        '',
      ].join('\n'));
      writeFile(d, 'package.json', JSON.stringify({ name: 'acme-site', version: '2.1.0.0', scripts: { build: 'bun build' } }, null, 2) + '\n');
    },
    truth: {
      expected: exp(
        ['wrong-platform-recorded', 'heroku|Procfile'],
        ['stale-production-url', 'herokuapp|old-app|acme\\.example\\.com'],
        ['release-workflow-is-not-deploy', 'release\\.yml|npm publish|not a deploy|tag'],
        ['actual-platform-netlify', 'netlify\\.toml|netlify'],
        ['stale-status-command', 'heroku releases|status command'],
        ['reconfigure', 'reconfigure|update|overwrite|re-?run'],
      ),
      traps: traps(
        ['retained-vercel-config', 'vercel\\.json', 'retained for a legacy preview domain; documented in README.md'],
        ['netlify-preview-context', 'deploy-preview', 'Netlify\'s standard PR preview context, not a second production target'],
      ),
    },
  },
];

const landingReport2: Scenario[] = [
  {
    id: 'ship-landing-offline',
    skill: 'ship',
    source: [LEGACY('landing-report.md')],
    task:
      'Report what this repository can and cannot know right now about which version its next release would claim, ' +
      'what state the working tree is in, and what could go wrong if someone released anyway. Do not change any ' +
      'files.',
    materialize: (d) =>
      gitRepo(d, {
        defaultBranch: 'release-2026',
        detach: true,
        commits: [
          {
            message: 'chore: v1.6.5.0',
            files: {
              'VERSION': '1.6.5.0\n',
              'CHANGELOG.md': '# Changelog\n\n## [1.6.5.0] - 2026-02-20\n\n- Receipt chain verification.\n',
              'queue/next-version.out': JSON.stringify({
                offline: true,
                host: 'unknown',
                warnings: ['no remote configured; queue query skipped'],
                claimed: [],
                siblings: [],
              }, null, 2) + '\n',
              'queue/siblings.json': JSON.stringify({
                workspace_root: '/Users/dev/work',
                siblings: [
                  {
                    path: '../vendor-fork',
                    branch: 'vendor/main',
                    version: '9.9.9.9',
                    last_commit_hours: 2,
                    open_pr: null,
                    note: 'Unrelated vendor checkout. Not a workspace of this project and never lands here.',
                  },
                  {
                    path: '../archive-2024',
                    branch: 'archive',
                    version: '0.9.1',
                    last_commit_hours: 9600,
                    open_pr: null,
                    note: 'Read-only archive of the pre-1.0 tree.',
                  },
                ],
              }, null, 2) + '\n',
              'queue/NOTES.md': [
                '# Queue snapshot',
                '',
                '`next-version.out` is the captured output of the version-queue query.',
                '`siblings.json` lists directories found next to this checkout.',
                '',
              ].join('\n'),
            },
          },
        ],
      }),
    truth: {
      expected: exp(
        ['detached-head', 'detached|not on a branch|no current branch|HEAD'],
        ['no-remote', 'no remote|local.?only|nothing to compare|single.?branch'],
        ['nonstandard-default-branch', 'release-2026'],
        ['queue-offline', 'offline|next-version\\.out|queue.?aware|unknown host'],
        ['collisions-undetectable', 'collision.*(cannot|not|no)|cannot detect|silent(ly)?|duplicate'],
        ['local-bump-still-works', 'local (VERSION )?bump|fallback|still work'],
      ),
      traps: traps(
        ['unrelated-vendor-checkout', 'vendor-fork', 'not a workspace of this project; its version never lands here'],
        ['readonly-archive', 'archive-2024', 'read-only pre-1.0 archive, 400 days idle'],
      ),
    },
  },
];

const iosClean2: Scenario[] = [
  {
    id: 'ship-ios-clean-incomplete-removal',
    skill: 'ship',
    source: [LEGACY('ios-clean.md')],
    task:
      'Someone removed the DebugBridge dependency from this app by hand. Report everything the removal missed, which ' +
      'build configurations still compile, and which checks would prove the removal is complete. Do not change ' +
      'any code.',
    materialize: (d) => {
      writeFile(d, 'Package.swift', [
        '// swift-tools-version:5.9',
        'import PackageDescription',
        '',
        '// DebugBridge dependency removed by hand.',
        'let package = Package(',
        '    name: "AcmeApp",',
        '    targets: [',
        '        .target(name: "App"),',
        '        .testTarget(name: "AppTests", dependencies: ["App"]),',
        '    ]',
        ')',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/AppMain.swift', [
        'import SwiftUI',
        '#if DEBUG',
        'import DebugBridge',
        '#endif',
        '',
        '@main',
        'struct AcmeApp: App {',
        '    init() {',
        '        #if DEBUG',
        '        DebugBridgeManager.shared.start()',
        '        #endif',
        '    }',
        '    var body: some Scene { WindowGroup { Text("acme") } }',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/Generated/StateAccessor.swift', [
        '// Auto-generated state accessor. Do not edit.',
        'import DebugBridge',
        '',
        'extension AppState {',
        '    func snapshotFields() -> [String: String] { ["userEmail": userEmail] }',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/Models/AppState.swift', [
        'import Foundation',
        '',
        '@Observable',
        'final class AppState {',
        '    @Snapshotable var userEmail: String = ""',
        '    var lastSync: Date?',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/Support/TokenPath.swift', [
        'import Foundation',
        '',
        'enum TokenPath {',
        '    // Written by the bridge on the device under NSTemporaryDirectory().',
        '    static var url: URL {',
        '        URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("gstack-ios-qa.token")',
        '    }',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'Sources/App/Views/DebugMenu.swift', [
        '#if DEBUG',
        'import SwiftUI',
        '',
        '// The app\'s OWN debug menu. Predates gstack, imports nothing from the bridge,',
        '// and is guarded by #if DEBUG. The name is the only thing it shares.',
        'struct DebugMenu: View {',
        '    var body: some View { Text("feature flags") }',
        '}',
        '#endif',
        '',
      ].join('\n'));
      writeFile(d, 'Tests/Fixtures/legacy-snapshot.json', JSON.stringify({
        _note: 'Pre-fix snapshot retained as the regression fixture for the plan-badge bug. Deleting it would delete the only proof that bug is fixed.',
        schemaHash: 'a91f',
        fields: { userEmail: 'a@b.test' },
      }, null, 2) + '\n');
      writeFile(d, 'docs/README-DEBUGBRIDGE.md', [
        '# Debug bridge setup',
        '',
        'Add the DebugBridge SPM package, mark state with @Snapshotable, then run',
        '`gen-accessors`. Requires the bridge dependency in Package.swift.',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['orphan-import', 'import DebugBridge|AppMain'],
        ['orphan-generated-accessor', 'StateAccessor'],
        ['orphan-property-wrapper', '@Snapshotable|AppState'],
        ['debug-config-will-not-compile', 'Debug|will not (build|compile)|unresolved|no such module|fails to build'],
        ['device-token-path', 'TokenPath|gstack-ios-qa\\.token'],
        ['stale-setup-doc', 'README-DEBUGBRIDGE\\.md'],
        ['completeness-checks', 'swift build -c release|nm -j|grep -r|no matches'],
      ),
      traps: traps(
        ['own-debug-menu', 'DebugMenu', 'the app\'s own pre-existing debug menu; shares only the name'],
        ['regression-fixture', 'legacy-snapshot\\.json', 'retained regression fixture, the only proof the plan-badge bug is fixed'],
      ),
    },
  },
];

const iosSync2: Scenario[] = [
  {
    id: 'ship-ios-sync-version-skew',
    skill: 'ship',
    source: [LEGACY('ios-sync.md')],
    task:
      'A resync of the debug bridge already ran on this branch. Review the diff against the base branch and report ' +
      'everything the resync got wrong, everything it should have preserved, and what still has to be verified. ' +
      'Do not change any code.',
    materialize: (d) =>
      gitRepo(d, {
        commits: [
          {
            message: 'base: bridge installed at 1.20.0.0',
            files: {
              'Sources/App/DebugBridgeGenerated/.gstack-version': '1.20.0.0\n',
              'Sources/App/DebugBridgeGenerated/StateServer.swift': [
                'import Foundation',
                '',
                'struct StateServer {',
                '    // GSTACK-EDIT-LINE: this app serves the state endpoint on port 9410',
                '    // because 8917 collides with the in-house metrics agent. Keep across',
                '    // resyncs.',
                '    static let port = 9410',
                '    static let bindAddress = "127.0.0.1"',
                '}',
                '',
              ].join('\n'),
              'Sources/App/DebugBridgeGenerated/StateAccessor.swift': [
                '// Auto-generated state accessor. Do not edit.',
                'extension AppState {',
                '    func snapshotFields() -> [String: String] { ["userEmail": userEmail] }',
                '}',
                '',
              ].join('\n'),
              'Sources/App/DebugBridgeGenerated/AppStateExtras.swift': [
                '// HAND-WRITTEN. Lives in the generated directory because the bridge looks',
                '// for accessors here, but it is not generated: it maps the app\'s legacy',
                '// user-defaults keys onto snapshot fields.',
                'extension AppState {',
                '    var legacyEmailKey: String { "com.acme.user.email" }',
                '}',
                '',
              ].join('\n'),
              'Sources/App/Models/AppState.swift': [
                'import Foundation',
                '',
                '@Observable',
                'final class AppState {',
                '    @Snapshotable var userEmail: String = ""',
                '    @Snapshotable var planTier: String = "free"',
                '}',
                '',
              ].join('\n'),
              'Sources/App/Models/Telemetry.swift': [
                'import Foundation',
                '',
                '// @Observable but deliberately NOT @Snapshotable: tap counters are noise',
                '// in a restored snapshot, so codegen is right to leave this out.',
                '@Observable',
                'final class Telemetry {',
                '    var tapCount: Int = 0',
                '}',
                '',
              ].join('\n'),
              'Sources/AppTests/Fixtures/SampleState.swift': [
                'import Foundation',
                '',
                '// Test fixture, not app state.',
                '@Observable',
                'final class SampleState {',
                '    @Snapshotable var fixtureField: String = ""',
                '}',
                '',
              ].join('\n'),
              'NOTES.md': [
                '# Resync notes',
                '',
                'The installed tool reports version 1.51.0.0. Verification for a resync is',
                '`swift build`, `xcodebuild -scheme AcmeApp`, then a fresh',
                '`GET /state/snapshot` to confirm the accessor schema hash changed.',
                '',
              ].join('\n'),
            },
          },
          {
            message: 'chore: resync debug bridge',
            checkout: 'chore/resync',
            date: '2026-03-04T09:00:00',
            remove: ['Sources/App/DebugBridgeGenerated/AppStateExtras.swift'],
            files: {
              'Sources/App/DebugBridgeGenerated/.gstack-version': '1.51.0.0\n',
              'Sources/App/DebugBridgeGenerated/StateServer.swift': [
                'import Foundation',
                '',
                'struct StateServer {',
                '    static let port = 8917',
                '    static let bindAddress = "127.0.0.1"',
                '    static let requiresBootToken = true',
                '}',
                '',
              ].join('\n'),
              'Sources/App/DebugBridgeGenerated/StateAccessor.swift': [
                '// Auto-generated state accessor. Do not edit.',
                'extension AppState {',
                '    func snapshotFields() -> [String: String] {',
                '        ["userEmail": userEmail, "planTier": planTier]',
                '    }',
                '}',
                '',
                'extension SampleState {',
                '    func snapshotFields() -> [String: String] { ["fixtureField": fixtureField] }',
                '}',
                '',
              ].join('\n'),
            },
          },
        ],
      }),
    truth: {
      expected: exp(
        ['clobbered-user-edit', 'GSTACK-EDIT-LINE|9410|8917|fold|clobber|lost'],
        ['port-collision-returns', 'metrics agent|collide|collision|port'],
        ['test-fixture-generated-into-app', 'SampleState|Fixtures|--exclude|AppTests'],
        ['handwritten-file-deleted', 'AppStateExtras|hand.?written|deleted|removed'],
        ['verification-outstanding', 'xcodebuild|schema hash|/state/snapshot|swift build'],
      ),
      traps: traps(
        ['version-file-updated', 'gstack-version', 'the installed-version record was correctly advanced to the tool version'],
        ['telemetry-excluded', 'Telemetry', 'not marked @Snapshotable, so codegen is right to leave it out'],
      ),
    },
  },
];

export const shipScenarios: Scenario[] = [
  ...shipMd,
  ...landAndDeploy,
  ...canary,
  ...documentRelease,
  ...documentRelease2,
  ...documentGenerate,
  ...documentGenerate2,
  ...setupDeploy,
  ...setupDeploy2,
  ...landingReport,
  ...landingReport2,
  ...iosClean,
  ...iosClean2,
  ...iosSync,
  ...iosSync2,
];
