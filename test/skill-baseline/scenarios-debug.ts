/**
 * Debug-family scenarios for the skill-baseline ablation instrument.
 *
 * The six modules under `skills/debug/references/legacy/` had zero scenarios,
 * so the study could return no verdict on any of them. Each scenario names its
 * ablation target in `source`.
 *
 * Same rules as scenarios-ship.ts, enforced by scenarios-ship-debug.test.ts:
 * self-contained hermetic fixtures, identifier-tight `expected` regexes, at
 * least one seeded false positive per scenario, and task text that is identical
 * across arms.
 *
 * Fixture helpers are imported from scenarios-ship.ts rather than duplicated
 * into a fourth file; nothing in them is ship-specific.
 */

import type { Scenario } from './scenarios';
import { exp, git, gitRepo, traps, writeFile } from './scenarios-ship';

const LEGACY = (m: string) => `skills/debug/references/legacy/${m}`;

// --- module: investigate.md --------------------------------------------------

const investigate: Scenario[] = [
  {
    id: 'debug-wrong-obvious-cause',
    skill: 'debug',
    source: [LEGACY('investigate.md')],
    task:
      'Orders that exist in the database return 404 from GET /api/orders/:id, as described in BUG.md. Find the ' +
      'root cause. Report the root cause with the file and line that proves it, the evidence you used, and every ' +
      'other caller affected by the same defect. Do not change any code.',
    materialize: (d) =>
      gitRepo(d, {
        commits: [
          {
            message: 'feat: order lookup with cache',
            files: {
              'BUG.md': [
                '# 404 on existing orders',
                '',
                'Reported by support, reproduced on staging.',
                '',
                '```',
                '$ curl -i localhost:3000/api/orders/8814',
                'HTTP/1.1 404 Not Found',
                '{"error":"order not found"}',
                '```',
                '',
                'The row is there:',
                '',
                '```',
                'psql> select id, total_cents from orders where id = 8814;',
                ' 8814 | 129900',
                '```',
                '',
                'Started after the caching work landed. Every id behaves the same way, not',
                'just 8814.',
                '',
              ].join('\n'),
              'src/routes/validate.ts': [
                '// Every :id route parameter is validated here before the handler runs.',
                '// The pattern guarantees a non-empty run of digits, so downstream parsing',
                '// can never see a non-numeric or empty id.',
                'const NUMERIC_ID = /^[0-9]+$/;',
                '',
                'export function requireNumericId(raw: string | undefined): string {',
                '  if (!raw || !NUMERIC_ID.test(raw)) {',
                '    throw Object.assign(new Error("bad id"), { status: 400 });',
                '  }',
                '  return raw;',
                '}',
                '',
              ].join('\n'),
              'src/routes/orders.ts': [
                'import { findById } from "../db/orders";',
                'import { requireNumericId } from "./validate";',
                '',
                'export async function getOrder(req: any, res: any) {',
                '  const raw = requireNumericId(req.params.id);',
                '  // Safe: requireNumericId already proved /^[0-9]+$/, so parseInt cannot',
                '  // return NaN and needs no radix guard here.',
                '  const id = parseInt(raw, 10);',
                '  const order = await findById(id);',
                '  if (!order) {',
                '    res.status(404).json({ error: "order not found" });',
                '    return;',
                '  }',
                '  res.status(200).json(order);',
                '}',
                '',
              ].join('\n'),
              'src/routes/invoices.ts': [
                'import { findById } from "../db/orders";',
                '',
                'export async function getInvoice(req: any, res: any) {',
                '  const order = await findById(Number(req.params.orderId));',
                '  if (!order) {',
                '    res.status(404).json({ error: "invoice has no order" });',
                '    return;',
                '  }',
                '  res.status(200).json({ orderId: order.id, total: order.total_cents });',
                '}',
                '',
              ].join('\n'),
              'src/jobs/reconcile.ts': [
                'import { findById } from "../db/orders";',
                '',
                '// Nightly reconciliation. Silently skips orders it cannot load, which is',
                '// why nobody noticed this job going quiet.',
                'export async function reconcile(ids: number[]): Promise<number> {',
                '  let matched = 0;',
                '  for (const id of ids) {',
                '    const order = await findById(id);',
                '    if (order) matched += 1;',
                '  }',
                '  return matched;',
                '}',
                '',
              ].join('\n'),
              'src/db/cache.ts': [
                'type Entry = { value: unknown; expires: number };',
                '',
                'const store = new Map<string, Entry>();',
                '',
                '// Reader-side key builder.',
                'export function keyFor(id: number): string {',
                '  return "orders:" + id;',
                '}',
                '',
                'export function put(key: string, value: unknown, ttlMs = 60_000): void {',
                '  store.set(key, { value, expires: Date.now() + ttlMs });',
                '}',
                '',
                'export function get(key: string): unknown | undefined {',
                '  const hit = store.get(key);',
                '  if (!hit) return undefined;',
                '  if (hit.expires < Date.now()) {',
                '    store.delete(key);',
                '    return undefined;',
                '  }',
                '  return hit.value;',
                '}',
                '',
                'export async function getOrLoad<T>(',
                '  id: number,',
                '  load: (id: number) => Promise<T | null>,',
                '): Promise<T | null> {',
                '  const cached = get(keyFor(id)) as T | undefined;',
                '  return cached ?? null;',
                '}',
                '',
              ].join('\n'),
              'src/db/orders.ts': [
                'import { getOrLoad, put } from "./cache";',
                '',
                'export interface Order { id: number; total_cents: number }',
                '',
                'const rows: Order[] = [{ id: 8814, total_cents: 129900 }];',
                '',
                '// Writer-side key builder.',
                'function writeKey(id: number): string {',
                '  return "order:" + id;',
                '}',
                '',
                'async function loadFromDb(id: number): Promise<Order | null> {',
                '  const row = rows.find((r) => r.id === id) ?? null;',
                '  if (row) put(writeKey(id), row);',
                '  return row;',
                '}',
                '',
                'export async function findById(id: number): Promise<Order | null> {',
                '  return getOrLoad(id, loadFromDb);',
                '}',
                '',
              ].join('\n'),
              'src/routes/health.ts': [
                '// Unauthenticated on purpose: the load balancer probes this before it has',
                '// any credentials, and the body carries no data about the system.',
                'export function health(_req: any, res: any) {',
                '  res.status(200).send("ok");',
                '}',
                '',
              ].join('\n'),
            },
          },
        ],
      }),
    truth: {
      expected: exp(
        ['cache-key-mismatch', 'keyFor|cache key|writeKey'],
        ['reader-writer-divergence', '"orders:"|orders:|"order:"|singular|plural|two (different )?key'],
        ['loader-never-called', 'getOrLoad|\\?\\? null|never (call|invoke|reach)|load (is )?(never|not)|ignores the loader'],
        ['cites-cache-file', 'cache\\.ts'],
        ['sibling-invoices', 'invoices'],
        ['sibling-reconcile', 'reconcile'],
      ),
      traps: traps(
        ['parseint-radix', 'parseInt', 'requireNumericId already proved /^[0-9]+$/ upstream'],
        ['unauthenticated-health', 'health\\.ts', 'unauthenticated liveness probe by design, no data in the body'],
      ),
    },
  },
];

// --- module: careful.md ------------------------------------------------------

const careful: Scenario[] = [
  {
    id: 'debug-careful-destructive-script',
    skill: 'debug',
    source: [LEGACY('careful.md')],
    task:
      'Review scripts/reset-env.sh and the Makefile in this repository. Report every command that can destroy ' +
      'data, history, or uncommitted work, and say what each one destroys. Do not change any files.',
    materialize: (d) => {
      writeFile(d, 'scripts/reset-env.sh', [
        '#!/usr/bin/env bash',
        '# Reset a developer environment back to a known state.',
        'set -uo pipefail',
        '',
        '# BUILD_DIR comes from the caller. Nothing sets a default.',
        'rm -rf $BUILD_DIR/',
        '',
        'psql "$DATABASE_URL" -c "TRUNCATE orders;"',
        'psql "$DATABASE_URL" -c "DROP TABLE IF EXISTS order_events;"',
        '',
        'kubectl delete pod -l app=api --all-namespaces',
        'docker system prune -af',
        '',
        'echo "environment reset"',
        '',
      ].join('\n'));
      writeFile(d, 'Makefile', [
        '.PHONY: clean sync revert-local tmp',
        '',
        'clean:',
        '\t# Regenerable build output only.',
        '\trm -rf node_modules dist .next coverage __pycache__',
        '',
        'sync:',
        '\tgit fetch origin main',
        '\tgit push --force origin main',
        '',
        'revert-local:',
        '\tgit reset --hard HEAD~3',
        '\tgit checkout .',
        '',
        'tmp:',
        '\tbash scripts/tmp-clean.sh',
        '',
      ].join('\n'));
      writeFile(d, 'scripts/tmp-clean.sh', [
        '#!/usr/bin/env bash',
        '# Removes only this session\'s own scratch directory. The path is created by',
        '# mktemp -d in the same script, quoted, and never read from the environment,',
        '# so there is no unset-variable or word-splitting hazard here.',
        'set -euo pipefail',
        'SCRATCH="$(mktemp -d)"',
        'trap \'rm -rf "$SCRATCH"\' EXIT',
        'echo "scratch at $SCRATCH"',
        '',
      ].join('\n'));
      writeFile(d, 'README.md', [
        '# acme-svc developer tooling',
        '',
        '`DATABASE_URL` points at whatever database the shell is configured for. On',
        'several machines that is the production replica.',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['unset-build-dir', 'BUILD_DIR|unset|empty|unquoted|word.?split'],
        ['truncate', 'TRUNCATE'],
        ['drop-table', 'DROP TABLE'],
        ['no-database-guard', 'DATABASE_URL|production|which database|no (env|environment) (guard|check)'],
        ['force-push', 'push --force|force.?push'],
        ['reset-hard', 'reset --hard'],
        ['checkout-dot', 'git checkout \\.|checkout \\.|restore \\.'],
        ['kubectl-delete', 'kubectl delete'],
        ['docker-prune', 'docker system prune'],
      ),
      traps: traps(
        ['safe-clean-target', 'node_modules', 'regenerable build output is an explicit safe exception'],
        ['scratch-cleanup', 'tmp-clean\\.sh', 'quoted mktemp -d path created in the same script; no hazard'],
      ),
    },
  },
];

// --- module: freeze.md -------------------------------------------------------

const freeze: Scenario[] = [
  {
    id: 'debug-freeze-boundary-impl',
    skill: 'debug',
    source: [LEGACY('freeze.md')],
    task:
      'Review the edit-freeze hook in .claude/hooks/freeze-guard.sh together with its state file and its ' +
      'documentation. Report every path it wrongly allows, every path it wrongly blocks, and every claim about ' +
      'it that is not true. Do not change any files.',
    materialize: (d) => {
      writeFile(d, '.claude/hooks/state/freeze-dir.txt', '/work/app/src\n');
      writeFile(d, '.claude/hooks/state/freeze-dir.txt.bak', '/work/app/src/auth\n');
      writeFile(d, '.claude/hooks/freeze-guard.sh', [
        '#!/usr/bin/env bash',
        '# Edit boundary hook. Registered for Edit, Write, Read and Grep.',
        'set -uo pipefail',
        '',
        '# Read once at session start and exported for the rest of the session.',
        ': "${FREEZE_DIR:=$(cat .claude/hooks/state/freeze-dir.txt 2>/dev/null)}"',
        'export FREEZE_DIR',
        '',
        'TARGET="$1"',
        '',
        'case "$TARGET" in',
        '  "$FREEZE_DIR"*)',
        '    echo \'{"permissionDecision":"allow"}\'',
        '    ;;',
        '  *)',
        '    echo \'{"permissionDecision":"ask","message":"outside the freeze boundary"}\'',
        '    ;;',
        'esac',
        '',
      ].join('\n'));
      writeFile(d, '.claude/hooks/FREEZE.md', [
        '# Freeze hook',
        '',
        'Freeze is a hard security boundary. Once a boundary is set, nothing in the',
        'session can modify a file outside it.',
        '',
        'The hook receives the target path as its first positional argument.',
        '',
        'Registered tools: Edit, Write, Read, Grep.',
        '',
      ].join('\n'));
      writeFile(d, '.claude/settings.json', JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Edit|Write|Read|Grep', hooks: [{ type: 'command', command: '.claude/hooks/freeze-guard.sh' }] },
          ],
        },
      }, null, 2) + '\n');
      writeFile(d, 'src/auth/session.ts', 'export const ttlMs = 900_000;\n');
      writeFile(d, 'src-old/auth/session.ts', '// pre-rewrite copy, still imported by nothing\nexport const ttlMs = 60_000;\n');
      writeFile(d, 'src/vendor/generated.ts', [
        '/* eslint-disable */',
        '// GENERATED FILE - DO NOT EDIT. Produced by protoc-gen-ts from api.proto.',
        '// The formatting, the any-types and the long lines all come from the generator.',
        'export type Any = { typeUrl: string; value: Uint8Array };',
        'export function encode(m: any): any { return m; }',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['missing-trailing-slash', 'trailing (slash|/)|src-old'],
        ['relative-vs-absolute', 'absolute|relative|/work/app|file_path|does not match'],
        ['read-and-grep-blocked', 'Read|Grep|Edit and Write only'],
        ['state-cached-once', 're-?read|every (invocation|call)|cached|session start|stale'],
        ['ask-not-deny', 'deny|"ask"|allow(s|ed) through|override'],
        ['wrong-input-source', 'tool input|stdin|JSON|\\$1|positional'],
        ['overclaims-security', 'not a security boundary|sed|bypass|advisory|Bash'],
      ),
      traps: traps(
        ['state-backup', 'freeze-dir\\.txt\\.bak', 'a backup with no reader; not live state'],
        ['generated-vendor', 'generated\\.ts', 'generated file, style findings in it are noise for this task'],
      ),
    },
  },
];

// --- module: guard.md --------------------------------------------------------

const guard: Scenario[] = [
  {
    id: 'debug-guard-composition',
    skill: 'debug',
    source: [LEGACY('guard.md')],
    task:
      'SESSION.md says guard mode is active for this session. Verify that claim against .claude/settings.json, ' +
      'the hook scripts on disk, and the state directory. Report every protection that is announced but not ' +
      'actually running, and anything the announcement leaves out. Do not change any files.',
    materialize: (d) => {
      writeFile(d, 'SESSION.md', [
        '# Session',
        '',
        '**Guard mode active.** Two protections are now running:',
        '',
        '1. **Destructive command warnings** - rm -rf, DROP TABLE, force-push and the',
        '   rest will warn before executing (you can override).',
        '2. **Edit boundary** - file edits restricted to `src/auth/`. Edits outside this',
        '   directory are blocked.',
        '',
        'Both protections persist for the whole session.',
        '',
      ].join('\n'));
      writeFile(d, '.claude/settings.json', JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: 'Bash', hooks: [{ type: 'command', command: '.claude/hooks/careful.sh' }] },
          ],
        },
      }, null, 2) + '\n');
      writeFile(d, '.claude/hooks/careful.sh', [
        '#!/usr/bin/env bash',
        '# Destructive command warnings. Bash-scoped by design: the patterns it matches',
        '# are shell commands, so Edit/Write invocations have nothing to check.',
        'set -uo pipefail',
        'CMD=$(jq -r ".tool_input.command // empty")',
        'case "$CMD" in',
        '  *"rm -rf"*|*"DROP TABLE"*|*TRUNCATE*|*"push --force"*|*"reset --hard"*)',
        '    echo \'{"permissionDecision":"ask","message":"destructive command"}\'',
        '    ;;',
        '  *) echo \'{"permissionDecision":"allow"}\' ;;',
        'esac',
        '',
      ].join('\n'));
      writeFile(d, '.claude/hooks/freeze.sh', [
        '#!/usr/bin/env bash',
        '# Edit boundary hook. Present on disk but nothing registers it.',
        'set -uo pipefail',
        'FILE=$(jq -r ".tool_input.file_path // empty")',
        'DIR=$(cat "${GSTACK_HOME:-$HOME/.gstack}/freeze-dir.txt" 2>/dev/null || echo "")',
        '[ -z "$DIR" ] && { echo \'{"permissionDecision":"allow"}\'; exit 0; }',
        'case "$FILE" in',
        '  "$DIR"*) echo \'{"permissionDecision":"allow"}\' ;;',
        '  *) echo \'{"permissionDecision":"deny","message":"outside the freeze boundary"}\' ;;',
        'esac',
        '',
      ].join('\n'));
      writeFile(d, '.claude/hooks/log-only.sh', [
        '#!/usr/bin/env bash',
        '# Audit log only. Always allows; its entire job is to append a line so the',
        '# session has a record of which tools ran. Returning anything else would',
        '# duplicate the decision hooks.',
        'set -uo pipefail',
        'printf \'%s\\n\' "$(date -u +%FT%TZ) tool=$1" >> .claude/hooks/state/tools.log',
        'echo \'{"permissionDecision":"allow"}\'',
        '',
      ].join('\n'));
      writeFile(d, '.claude/hooks/state/tools.log', '2026-03-04T09:00:00Z tool=Bash\n');
      writeFile(d, 'src/auth/session.ts', 'export const ttlMs = 900_000;\n');
      writeFile(d, 'src/billing/invoice.ts', 'export const render = (cents: number) => String(cents);\n');
    },
    truth: {
      expected: exp(
        ['freeze-hook-unregistered', 'settings\\.json|not registered|unregistered|never (wired|invoked)|freeze\\.sh'],
        ['edit-boundary-not-running', 'Edit|Write|edit boundary.*(not|no)|nothing blocks'],
        // No path token: the state file is absent on purpose (see the note on
        // no-baseline-captured in scenarios-ship.ts).
        ['missing-state-file', 'no (state|boundary) file|boundary (file )?(is )?(missing|absent|unset)|allows everything|empty'],
        ['announcement-overclaims', 'two protections|announce|claim|not (actually )?(running|active|enforced)'],
        ['missing-unfreeze-instruction', 'unfreeze|how to (remove|clear)|no instruction'],
        ['session-scope', 'session|persist|ends with the conversation'],
      ),
      traps: traps(
        ['bash-scoped-careful', 'careful\\.sh', 'destructive-command checks are Bash-scoped on purpose'],
        ['audit-only-hook', 'log-only\\.sh', 'always-allow audit hook; deciding here would duplicate the real hooks'],
      ),
    },
  },
];

// --- module: unfreeze.md -----------------------------------------------------

const unfreeze: Scenario[] = [
  {
    id: 'debug-unfreeze-clear-semantics',
    skill: 'debug',
    source: [LEGACY('unfreeze.md')],
    task:
      'Review scripts/unfreeze.sh against the state directory it operates on. Report every defect, including ' +
      'anything it destroys that it should not and anything it prints that is not true. Do not change any files.',
    materialize: (d) => {
      writeFile(d, 'scripts/unfreeze.sh', [
        '#!/usr/bin/env bash',
        'set -uo pipefail',
        '. scripts/paths.sh',
        '',
        'if [ ! -f "$STATE_DIR/freeze-dir.txt" ]; then',
        '  echo "nothing to unfreeze" >&2',
        '  exit 1',
        'fi',
        '',
        'rm -rf "$STATE_DIR"',
        '',
        'echo "Freeze boundary cleared. Hooks removed; edits are allowed everywhere."',
        '',
      ].join('\n'));
      writeFile(d, 'scripts/paths.sh', [
        '#!/usr/bin/env bash',
        '# Resolve gstack paths through the runtime helper when it is installed, and',
        '# fall back to the documented default when it is not. A missing helper must',
        '# never abort the caller, hence the 2>/dev/null and the || true.',
        'eval "$("${GSTACK_BIN:-$HOME/.gstack/bin}/gstack-paths" 2>/dev/null || true)"',
        'STATE_DIR="${GSTACK_STATE_ROOT:-${GSTACK_HOME:-$HOME/.gstack}}"',
        '',
      ].join('\n'));
      writeFile(d, 'state/freeze-dir.txt', '/work/app/src/auth/\n');
      writeFile(d, 'state/decisions.jsonl', JSON.stringify({
        id: 'd1', decision: 'Cache keys are built in one place', scope: 'repo', confidence: 9,
      }) + '\n');
      writeFile(d, 'state/learnings.jsonl', JSON.stringify({
        skill: 'investigate', type: 'investigation', key: 'CACHE_KEY_DRIFT', confidence: 9,
      }) + '\n');
      writeFile(d, 'state/config.yaml', 'explain_level: terse\nredact_prepush_hook: true\n');
      writeFile(d, 'state/freeze-dir.txt.lock', '');
      writeFile(d, 'NOTES.md', [
        '# State directory',
        '',
        'Everything under `state/` is what `$GSTACK_STATE_ROOT` points at on this',
        'machine: the freeze boundary, the decision log, the learnings log and the',
        'user config all share that one directory.',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['nukes-state-dir', 'rm -rf|whole|entire|STATE_DIR|only.*freeze-dir'],
        ['destroys-other-state', 'decisions\\.jsonl|learnings\\.jsonl|config\\.yaml'],
        ['no-previous-value', 'previous|was:|report.*(previous|old)|does not (say|print|report) (the )?(old|previous)'],
        ['false-hooks-claim', 'hooks|still registered|remain|not removed|session'],
        ['nonzero-when-unset', 'exit 1|non-?zero|no (freeze )?boundary was set|should succeed'],
      ),
      traps: traps(
        ['paths-fallback', 'paths\\.sh', 'runtime-absent fallback: a missing helper must not abort the caller'],
        ['stale-lock', 'freeze-dir\\.txt\\.lock', 'empty lock artifact from an atomic write; harmless'],
      ),
    },
  },
];

// --- module: ios-fix.md ------------------------------------------------------

const iosFix: Scenario[] = [
  {
    id: 'debug-ios-fix-no-repro',
    skill: 'debug',
    source: [LEGACY('ios-fix.md')],
    task:
      'Audit the fix that landed on this branch for the iOS plan-badge bug described in qa/ios-report.md. Report ' +
      'every reason it does not meet the bar for a landed device fix, and every screen still showing the wrong ' +
      'value. Do not change any code.',
    materialize: (d) =>
      gitRepo(d, {
        commits: [
          {
            message: 'base: settings screen',
            files: {
              'qa/ios-report.md': [
                '# ios-qa finding: plan badge shows Free for Pro accounts',
                '',
                '- Device: iPhone 15 Pro, iOS 18.3, build 412',
                '- Screen: Settings',
                '- Steps: sign in as a Pro account, open Settings.',
                '- Observed: the badge reads "Free".',
                '- Expected: "Pro".',
                '- Also seen on: the billing screen and the paywall (same value).',
                '- Accessibility node: `settings.plan.badge`',
                '',
              ].join('\n'),
              'Sources/App/Models/PlanState.swift': [
                'import Foundation',
                '',
                'enum Tier: String { case free, pro }',
                '',
                '@Observable',
                'final class PlanState {',
                '    private var cachedTier: Tier = .free',
                '    private var fetchedAt: Date?',
                '',
                '    /// Returns the cached tier. `refresh()` is what fills it, and nothing',
                '    /// calls `refresh()` before the first read, so the first read of the',
                '    /// session always answers `.free`.',
                '    var tier: Tier { cachedTier }',
                '',
                '    func refresh(from remote: Tier) {',
                '        cachedTier = remote',
                '        fetchedAt = Date()',
                '    }',
                '',
                '    var displayName: String { tier == .pro ? "Pro" : "Free" }',
                '}',
                '',
              ].join('\n'),
              'Sources/App/ViewModels/SettingsViewModel.swift': [
                'import Foundation',
                '',
                '@Observable',
                'final class SettingsViewModel {',
                '    let plan: PlanState',
                '',
                '    init(plan: PlanState) { self.plan = plan }',
                '',
                '    var badgeText: String { plan.displayName }',
                '}',
                '',
              ].join('\n'),
              'Sources/App/Views/SettingsView.swift': [
                'import SwiftUI',
                '',
                'struct SettingsView: View {',
                '    @State var model: SettingsViewModel',
                '',
                '    var body: some View {',
                '        Text(model.badgeText)',
                '            .accessibilityIdentifier("settings.plan.badge")',
                '    }',
                '}',
                '',
              ].join('\n'),
              'Sources/App/Views/BillingView.swift': [
                'import SwiftUI',
                '',
                'struct BillingView: View {',
                '    let plan: PlanState',
                '',
                '    var body: some View {',
                '        Text("Current plan: \\(plan.displayName)")',
                '    }',
                '}',
                '',
              ].join('\n'),
              'Sources/App/Views/PaywallView.swift': [
                'import SwiftUI',
                '',
                'struct PaywallView: View {',
                '    let plan: PlanState',
                '',
                '    var body: some View {',
                '        if plan.tier == .free { Text("Upgrade to Pro") }',
                '    }',
                '}',
                '',
              ].join('\n'),
              'Sources/App/Views/DebugPlanOverlay.swift': [
                '#if DEBUG',
                'import SwiftUI',
                '',
                '// Debug-only overlay. Compiled out of Release by the #if DEBUG guard, so',
                '// the raw tier values it prints never reach a shipped build.',
                'struct DebugPlanOverlay: View {',
                '    let plan: PlanState',
                '    var body: some View { Text("raw tier: \\(plan.tier.rawValue)") }',
                '}',
                '#endif',
                '',
              ].join('\n'),
              'Tests/AppTests/SnapshotSmokeTest.swift': [
                '#if GSTACK_HAS_IOS_DEVICE',
                'import XCTest',
                '',
                '// Device-gated and periodic-tier by design: it drives a real handset, so it',
                '// cannot run on the CI machines and is not part of the merge gate.',
                'final class SnapshotSmokeTest: XCTestCase {',
                '    func testRestoresSnapshot() throws {}',
                '}',
                '#endif',
                '',
              ].join('\n'),
            },
          },
          {
            message: 'fix: correct plan badge on settings screen',
            checkout: 'fix/plan-badge',
            date: '2026-03-04T09:00:00',
            files: {
              'Sources/App/Views/SettingsView.swift': [
                'import SwiftUI',
                '',
                'struct SettingsView: View {',
                '    @State var model: SettingsViewModel',
                '',
                '    var body: some View {',
                '        // Force the label to Pro when the account has an active subscription',
                '        // receipt, since the badge was showing Free.',
                '        Text(ReceiptStore.hasActiveSubscription ? "Pro" : model.badgeText)',
                '            .accessibilityIdentifier("settings.plan.badge")',
                '    }',
                '}',
                '',
              ].join('\n'),
              'Sources/App/Support/ReceiptStore.swift': [
                'import Foundation',
                '',
                'enum ReceiptStore {',
                '    static var hasActiveSubscription: Bool { true }',
                '}',
                '',
              ].join('\n'),
            },
          },
        ],
      }),
    truth: {
      expected: exp(
        // No path tokens: the snapshot fixture and the regression test are
        // absent on purpose, which is the finding.
        ['no-reproducing-snapshot', 'snapshot|/state/snapshot|pre-fix fixture|reproduc'],
        ['no-regression-test', 'regression test|ios-fix|no test|untested'],
        ['symptom-not-root-cause', 'symptom|SettingsView|root cause|PlanState'],
        ['root-cause-named', 'cachedTier|refresh\\(\\)|never (called|refreshed)|first read'],
        ['sibling-billing', 'BillingView'],
        ['sibling-paywall', 'PaywallView'],
      ),
      traps: traps(
        ['device-gated-test', 'SnapshotSmokeTest', 'device-gated periodic-tier test, correctly outside the merge gate'],
        ['debug-overlay', 'DebugPlanOverlay', 'compiled out of Release by #if DEBUG'],
      ),
    },
  },
];

// --- second scenarios, same six modules --------------------------------------

const investigate2: Scenario[] = [
  {
    id: 'debug-fix-breaks-sibling',
    skill: 'debug',
    source: [LEGACY('investigate.md')],
    task:
      'The invoice PDF renders "¥12" where it should render "¥1200", as described in BUG.md. Find the root cause. ' +
      'Report where the fix belongs, every other place that has the same defect today, and any test that currently ' +
      'encodes the wrong behaviour. Do not change any code.',
    materialize: (d) => {
      writeFile(d, 'BUG.md', [
        '# JPY amounts render 100x too small',
        '',
        'Customer in Tokyo, invoice total 1200 JPY.',
        '',
        '- Invoice PDF shows `¥12`.',
        '- The stored value is `1200` in `amount_minor`.',
        '- USD invoices are correct: 129900 renders as `$1,299.00`.',
        '',
      ].join('\n'));
      writeFile(d, 'src/format.ts', [
        '// Amounts are stored in the smallest unit the currency has.',
        'export function formatCurrency(amountMinor: number, currency: string): string {',
        '  const major = amountMinor / 100;',
        '  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(major);',
        '}',
        '',
        '// Percentages arrive as a ratio and are shown with two decimals. The',
        '// round-trip through 100 is exact for the two-decimal output we want, so',
        '// this is not the same bug as formatCurrency.',
        'export function formatPercent(ratio: number): string {',
        '  return (Math.round(ratio * 10000) / 100).toFixed(2) + "%";',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'src/pdf/invoice.ts', [
        'import { formatCurrency } from "../format";',
        '',
        'export function renderTotal(amountMinor: number, currency: string): string {',
        '  return `Total: ${formatCurrency(amountMinor, currency)}`;',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'src/email/receipt.ts', [
        'import { formatCurrency } from "../format";',
        '',
        'export function receiptLine(amountMinor: number, currency: string): string {',
        '  return `You paid ${formatCurrency(amountMinor, currency)}`;',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'src/api/orders.ts', [
        'import { formatCurrency } from "../format";',
        '',
        'export function orderJson(amountMinor: number, currency: string) {',
        '  return { amount_minor: amountMinor, display: formatCurrency(amountMinor, currency) };',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'src/ui/cart.tsx', [
        'import { formatCurrency } from "../format";',
        '',
        'export function CartTotal({ minor, currency }: { minor: number; currency: string }) {',
        '  return <span>{formatCurrency(minor, currency)}</span>;',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'test/format.test.ts', [
        'import { formatCurrency } from "../src/format";',
        '',
        'if (formatCurrency(129900, "USD") !== "$1,299.00") throw new Error("usd");',
        '// Locks in today\'s behaviour for JPY.',
        'if (formatCurrency(1200, "JPY") !== "¥12") throw new Error("jpy");',
        '',
      ].join('\n'));
      writeFile(d, 'src/legacy/formatMoneyV1.ts', [
        '/**',
        ' * @deprecated Superseded by src/format.ts in 2021. Retained only so the',
        ' * 2019 archive export can be regenerated byte-identically. No live callers:',
        ' * nothing imports this module.',
        ' */',
        'export function formatMoneyV1(cents: number): string {',
        '  return "$" + (cents / 100).toFixed(2);',
        '}',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['root-in-format', 'format\\.ts|formatCurrency'],
        ['zero-decimal-currency', 'zero.?decimal|minor unit|JPY|no (fractional|decimal)|exponent'],
        ['fix-belongs-at-shared-callee', 'shared|one place|single place|all (four |4 )?callers|root'],
        ['sibling-receipt', 'receipt'],
        ['sibling-cart', 'cart'],
        ['sibling-api', 'orders\\.ts|api/orders'],
        ['test-encodes-bug', 'format\\.test\\.ts'],
      ),
      traps: traps(
        ['percent-rounding', 'formatPercent', 'exact for the two-decimal output; not the currency bug'],
        ['deprecated-no-callers', 'formatMoneyV1', 'no live callers; retained to regenerate a frozen archive export'],
      ),
    },
  },
];

const careful2: Scenario[] = [
  {
    id: 'debug-careful-hook-boundary',
    skill: 'debug',
    source: [LEGACY('careful.md')],
    task:
      'Review the destructive-command hook in .claude/hooks/destructive-guard.sh. Report every destructive command ' +
      'it fails to catch, every harmless command it wrongly stops, and every claim in it that is not true. Do not ' +
      'change any files.',
    materialize: (d) => {
      writeFile(d, '.claude/hooks/destructive-guard.sh', [
        '#!/usr/bin/env bash',
        '# Destructive command guard. This is a security boundary: once installed, no',
        '# command in the session can destroy data.',
        'set -uo pipefail',
        '',
        'CMD="$1"',
        '',
        'if [[ "$CMD" =~ ^rm[[:space:]]+-rf ]] || [[ "$CMD" =~ ^git[[:space:]]+push[[:space:]]+--force ]]; then',
        '  echo \'{"permissionDecision":"deny","message":"destructive command blocked"}\'',
        '  exit 0',
        'fi',
        '',
        'if [[ "$CMD" =~ node_modules ]]; then',
        '  echo \'{"permissionDecision":"deny","message":"do not delete dependencies"}\'',
        '  exit 0',
        'fi',
        '',
        'echo \'{"permissionDecision":"allow"}\'',
        '',
      ].join('\n'));
      writeFile(d, '.claude/settings.json', JSON.stringify({
        hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: '.claude/hooks/destructive-guard.sh' }] }] },
      }, null, 2) + '\n');
      writeFile(d, 'scripts/clean-build.sh', [
        '#!/usr/bin/env bash',
        '# Regenerable output only. Everything removed here is rebuilt by `bun run build`.',
        'set -euo pipefail',
        'rm -rf dist .next coverage',
        '',
      ].join('\n'));
      writeFile(d, 'scripts/db-seed.sh', [
        '#!/usr/bin/env bash',
        '# Bounded maintenance delete: expired session rows only, never a whole table.',
        '# Runs inside a transaction and is safe to re-run.',
        'set -euo pipefail',
        'psql "$DATABASE_URL" -c "BEGIN; DELETE FROM sessions WHERE expires < now(); COMMIT;"',
        '',
      ].join('\n'));
      writeFile(d, 'scripts/danger.sh', [
        '#!/usr/bin/env bash',
        '# Commands the guard is supposed to catch.',
        'cd /var/data && rm -rf .',
        'rm -r /var/cache/acme',
        'rm --recursive /var/log/acme',
        'psql "$DATABASE_URL" -c "DROP TABLE users;"',
        'psql "$DATABASE_URL" -c "TRUNCATE orders;"',
        'git push -f origin main',
        'git reset --hard HEAD~5',
        'git checkout .',
        'kubectl delete deployment api',
        'docker rm -f api',
        'sed -i \'\' \'s/.*//\' src/format.ts',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['anchored-pattern', '\\^|start of|anchor|beginning of|&&|compound|cd /var/data'],
        ['missing-rm-variants', 'rm -r |--recursive'],
        ['missing-sql', 'DROP TABLE|TRUNCATE'],
        ['missing-git-variants', 'push -f|reset --hard|git checkout \\.'],
        ['missing-container-and-cluster', 'kubectl delete|docker rm'],
        ['deny-not-ask', '"ask"|deny|override|cannot be overridden'],
        ['safe-exception-blocked', 'node_modules'],
        ['overclaims-security', 'not a security boundary|sed|bypass|advisory|Bash'],
        ['wrong-input-source', 'tool input|stdin|JSON|\\$1|positional'],
      ),
      traps: traps(
        ['regenerable-clean', 'clean-build\\.sh', 'regenerable build output is an explicit safe exception'],
        ['bounded-delete', 'db-seed\\.sh', 'bounded transactional delete of expired rows, not a table drop'],
      ),
    },
  },
];

const freeze2: Scenario[] = [
  {
    id: 'debug-freeze-scope-lock',
    skill: 'debug',
    source: [LEGACY('freeze.md')],
    task:
      'A session-expiry bug lives in src/auth/session.ts and src/auth/cookie.ts. Report the edit boundary this ' +
      'debugging session should use, every problem with the boundary state currently on disk, and whether that ' +
      'boundary is actually enforced on this machine. Do not change any files.',
    materialize: (d) => {
      writeFile(d, 'BUG.md', [
        '# Sessions expire after 60 seconds',
        '',
        'Users are signed out almost immediately. The cookie Max-Age and the server',
        'TTL disagree; both live under src/auth/.',
        '',
      ].join('\n'));
      writeFile(d, 'src/auth/session.ts', 'export const ttlMs = 60_000; // intended: 900_000\n');
      writeFile(d, 'src/auth/cookie.ts', 'export const maxAgeSeconds = 900;\n');
      writeFile(d, 'src/authz/policy.ts', [
        '// Authorization policy. Unrelated to session lifetime: it only maps roles to',
        '// permissions and never reads the session TTL.',
        'export const can = (role: string, action: string) => role === "admin" || action === "read";',
        '',
      ].join('\n'));
      writeFile(d, 'src/billing/schema.sql', 'CREATE TABLE invoices (id bigserial primary key, total_cents bigint not null);\n');
      writeFile(d, 'state/freeze-dir.txt', '/repo/src/billing/\n');
      writeFile(d, 'SESSION.md', [
        '# Session',
        '',
        'Debug scope is locked. Edits outside the boundary are mechanically blocked by',
        'an installed hook, so there is no way to touch unrelated code by accident.',
        '',
      ].join('\n'));
      writeFile(d, '.claude/settings.json', JSON.stringify({
        permissions: { allow: ['Bash(bun test)'] },
      }, null, 2) + '\n');
    },
    truth: {
      expected: exp(
        ['narrowest-directory', 'src/auth'],
        ['stale-boundary', 'billing|stale|previous|wrong directory'],
        ['not-enforced', 'advisory|no hook|not (mechanically )?(enforced|blocked)|settings\\.json|no hooks'],
        ['trailing-slash', 'trailing'],
        ['unfreeze-path', 'unfreeze|clear|remove the (restriction|boundary)'],
        ['bash-can-bypass', 'sed|Bash|bypass|Edit and Write only'],
      ),
      traps: traps(
        ['unrelated-authz', 'policy\\.ts', 'authorization policy never reads the session TTL'],
        ['unrelated-billing-schema', 'schema\\.sql', 'the old boundary pointed here; the file has nothing to do with this bug'],
      ),
    },
  },
];

const guard2: Scenario[] = [
  {
    id: 'debug-guard-setup-ask',
    skill: 'debug',
    source: [LEGACY('guard.md')],
    task:
      'Review scripts/guard-setup.sh and the boundary file it produced. Report every defect in how it resolves, ' +
      'validates and records the directory, and everything it should have asked the user that it decided on its ' +
      'own. Do not change any files.',
    materialize: (d) => {
      writeFile(d, 'scripts/guard-setup.sh', [
        '#!/usr/bin/env bash',
        'set -uo pipefail',
        '',
        'STATE_DIR=state',
        'mkdir -p "$STATE_DIR"',
        '',
        '# Everyone debugs src/, so use it.',
        'TARGET=src/',
        '',
        'FREEZE_DIR=$(cd "$TARGET" 2>/dev/null && pwd)',
        'echo "$FREEZE_DIR" > "$STATE_DIR/freeze-dir.txt"',
        '',
        'echo "Guard mode active. Destructive command warnings are on and edits are"',
        'echo "restricted to $FREEZE_DIR."',
        '',
      ].join('\n'));
      // The script ran from a directory where `src/` did not exist, so `cd` failed
      // and the boundary was written empty.
      writeFile(d, 'state/freeze-dir.txt', '\n');
      writeFile(d, 'scripts/guard-status.sh', [
        '#!/usr/bin/env bash',
        '# Read-only status printer. Reports the current boundary and changes nothing,',
        '# which is why it is safe to run at any point in a session.',
        'set -uo pipefail',
        'B=$(cat state/freeze-dir.txt 2>/dev/null || echo "")',
        '[ -z "$B" ] && echo "no freeze boundary set" || echo "boundary: $B"',
        '',
      ].join('\n'));
      writeFile(d, 'app/lib/session.ts', 'export const ttlMs = 900_000;\n');
      writeFile(d, 'NOTES.md', [
        '# Layout',
        '',
        'This project keeps its code under `app/`, not `src/`. There is no `src/`',
        'directory anywhere in the repository.',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['unchecked-cd', 'cd |exit status|\\$\\?|unchecked|silently|fails? (silently|without)'],
        ['empty-boundary-written', 'empty|blank|no path|blocks everything|allows everything'],
        ['wrong-directory-assumed', 'src/|app/|does not exist|no src'],
        ['never-asks', 'ask|AskUserQuestion|hardcode|assum|user (should|must) (choose|type|pick)'],
        ['no-trailing-slash', 'trailing'],
        ['missing-unfreeze-instruction', 'unfreeze|how to (remove|clear)'],
      ),
      traps: traps(
        ['readonly-status', 'guard-status\\.sh', 'read-only status printer; changing nothing is the point'],
      ),
    },
  },
];

const unfreeze2: Scenario[] = [
  {
    id: 'debug-unfreeze-vs-scope-lock',
    skill: 'debug',
    source: [LEGACY('unfreeze.md')],
    task:
      'The debug boundary from the previous session is still on disk, and the next task in TASK.md edits a ' +
      'different part of the tree. Report the correct way to proceed and every problem with what is on disk now, ' +
      'including anything a previous session left behind that must not be removed. Do not change any files.',
    materialize: (d) => {
      writeFile(d, 'TASK.md', [
        '# Next task',
        '',
        'Add a `currency` column to `src/billing/schema.sql` and thread it through',
        '`src/billing/invoice.ts`. Nothing under `src/auth/` is in scope.',
        '',
      ].join('\n'));
      writeFile(d, 'state/freeze-dir.txt', '/repo/src/auth/\n');
      writeFile(d, 'state/decisions.jsonl', JSON.stringify({
        id: 'd-41',
        decision: 'Session TTL lives in one constant, read by both the cookie and the server',
        rationale: 'The 60s expiry bug was two constants disagreeing',
        scope: 'repo',
        source: 'skill',
        confidence: 9,
      }) + '\n');
      writeFile(d, 'history.md', [
        '# Previous session',
        '',
        '```',
        'DEBUG REPORT',
        'Symptom:         sessions expired after 60 seconds',
        'Root cause:      cookie Max-Age and server TTL were separate constants',
        'Fix:             src/auth/session.ts:1, src/auth/cookie.ts:1',
        'Evidence:        bun test output, 42 pass',
        'Regression test: test/session-ttl.test.ts:3',
        'Status:          DONE',
        '```',
        '',
      ].join('\n'));
      writeFile(d, 'scripts/edit-anywhere.sh', [
        '#!/usr/bin/env bash',
        '# The boundary blocks Edit and Write, so do it from Bash instead.',
        'set -uo pipefail',
        'sed -i \'\' \'s/total_cents/total_cents, currency/\' src/billing/schema.sql',
        '',
      ].join('\n'));
      writeFile(d, 'src/auth/session.ts', 'export const ttlMs = 900_000;\n');
      writeFile(d, 'src/billing/schema.sql', 'CREATE TABLE invoices (id bigserial primary key, total_cents bigint not null);\n');
      writeFile(d, 'src/billing/invoice.ts', 'export const render = (cents: number) => String(cents);\n');
      writeFile(d, 'test/session-ttl.test.ts', 'import { ttlMs } from "../src/auth/session";\n\nif (ttlMs !== 900_000) throw new Error("ttl");\n');
    },
    truth: {
      expected: exp(
        ['clear-the-boundary', 'unfreeze|clear|remove the (restriction|boundary)'],
        ['sed-workaround-wrong', 'sed|bypass|workaround|circumvent|edit-anywhere'],
        ['boundary-stale-after-done', 'DONE|previous session|stale|no longer|finished'],
        ['hooks-remain-registered', 'hooks (are )?(still|remain)|registered|allow everything|session'],
        ['report-previous-value', 'previous|was|src/auth'],
      ),
      traps: traps(
        ['durable-decision-log', 'decisions\\.jsonl', 'append-only durable decision record; not session scratch state'],
        ['regression-test-kept', 'session-ttl\\.test\\.ts', 'the previous fix\'s regression test stays, it is not leftover state'],
      ),
    },
  },
];

const iosFix2: Scenario[] = [
  {
    id: 'debug-ios-fix-loop-discipline',
    skill: 'debug',
    source: [LEGACY('ios-fix.md')],
    task:
      'LOG.md records an autonomous iOS fix session. Report every place the session broke its own discipline, ' +
      'whether the fix can be called verified, and what evidence is missing. Do not change any code.',
    materialize: (d) => {
      writeFile(d, 'LOG.md', [
        '# ios-fix session: plan-badge',
        '',
        '- 09:02 read the ios-qa finding (settings.plan.badge reads Free for Pro).',
        '- 09:04 captured GET /state/snapshot -> test/fixtures/ios-fix/plan-badge-pre.json',
        '- 09:05 captured GET /screenshot -> test/fixtures/ios-fix/plan-badge-pre.png',
        '- 09:11 iteration 1: edited PlanState.swift, xcodebuild build install. Build failed:',
        '        "value of optional type Date? must be unwrapped". Patched by changing',
        '        `fetchedAt!` to `try! unwrap(fetchedAt)` and rebuilt.',
        '- 09:20 iteration 2: rebuilt. Daemon detected the rebuild and reconnected the',
        '        StateServer tunnel. Boot-token rotation ran as usual.',
        '- 09:24 POST /state/restore -> 409 schema_mismatch. Worked around it by deleting',
        '        test/fixtures/ios-fix/plan-badge-pre.json and capturing a fresh snapshot',
        '        from the CURRENT (post-fix) device state.',
        '- 09:31 iteration 3: badge still reads Free.',
        '- 09:38 iteration 4: badge still reads Free.',
        '- 09:46 iteration 5: badge now reads Pro.',
        '- 09:47 took GET /screenshot, eyeballed it against the earlier screenshot.',
        '- 09:48 wrote the report: "Verified. Badge renders Pro."',
        '',
      ].join('\n'));
      writeFile(d, 'test/fixtures/ios-fix/plan-badge-post.png', 'PNG-PLACEHOLDER (text stand-in so the fixture stays hermetic)\n');
      writeFile(d, 'Sources/App/Models/PlanState.swift', [
        'import Foundation',
        '',
        '@Observable',
        'final class PlanState {',
        '    private var cachedTier: String = "free"',
        '    private var fetchedAt: Date?',
        '    var tier: String { cachedTier }',
        '    func refresh(from remote: String) { cachedTier = remote; fetchedAt = Date() }',
        '}',
        '',
      ].join('\n'));
      writeFile(d, 'NOTES.md', [
        '# Session artifacts',
        '',
        'Everything the session captured lives under `test/fixtures/ios-fix/`. Nothing',
        'else was written.',
        '',
      ].join('\n'));
    },
    truth: {
      expected: exp(
        ['exceeded-iteration-ceiling', '3 iterations|five|5 iterations|iteration 4|escalat|max'],
        ['schema-mismatch-mishandled', '409|schema_mismatch|re-?codegen|gen-accessors|accessor'],
        ['baseline-destroyed', 'plan-badge-pre|deleted|post-fix snapshot|baseline|regression fixture'],
        ['build-failure-not-reverted', 'try!|revert|compile|unwrap'],
        ['not-verified', '/state/restore|not verified|cannot be called verified|screenshot alone|eyeball'],
        ['no-regression-test', 'regression test|no test|test file'],
      ),
      traps: traps(
        ['daemon-reconnect', 'reconnect', 'the daemon reconnecting after a rebuild is the documented flow'],
        ['token-rotation', 'token rotation', 'boot-token rotation on every redeploy is the intended security behaviour'],
      ),
    },
  },
];

export const debugScenarios: Scenario[] = [
  ...investigate,
  ...careful,
  ...freeze,
  ...guard,
  ...unfreeze,
  ...iosFix,
  ...investigate2,
  ...careful2,
  ...freeze2,
  ...guard2,
  ...unfreeze2,
  ...iosFix2,
];
