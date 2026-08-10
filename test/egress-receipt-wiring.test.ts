/**
 * Static-grep tripwire for egress-receipt wiring. Free tier — no API.
 *
 * Every enumerated off-machine sink (the EGRESS-AUDIT.md surface) must route
 * its send through the receipt ledger (lib/egress-receipt.js), receipt BEFORE
 * send, fail-closed. A future egress call site added to one of these files
 * without a receipt fails CI here instead of becoming a user-filed issue
 * (#1081, #2166 pattern). This converts the one-time 8-auditor manual
 * EGRESS-AUDIT into a standing, machine-checked invariant.
 *
 * Pattern mirrors test/hermetic-wiring.test.ts and
 * browse/test/cdp-session-cleanup.test.ts: read source files as text, assert
 * invariants on their contents. Brittle by design — renaming the helper must
 * force the author to look here.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), 'utf-8');
}

/** JS/TS sinks: must import the canonical helper and call writeReceipt(). */
const MODULE_SINKS = [
  'runtime/context.js',
  'lib/code-intelligence/sourcebot-adapter.ts',
  'lib/code-intelligence/gbrain-adapter.ts',
  'lib/model-benchmark/braintrust-eval.ts',
  'bin/gstack-gbrain-sync.ts',
  'bin/gstack-memory-ingest.ts',
  'browse/src/server.ts',
];

/** Bash sinks: every network call must sit under a gstack-egress-receipt write. */
const SHELL_SINKS = [
  'bin/gstack-telemetry-sync',
  'bin/gstack-update-check',
  'bin/gstack-brain-sync',
];

describe('egress receipt wiring tripwire', () => {
  test('every JS/TS sink imports the receipt helper and calls writeReceipt()', () => {
    for (const rel of MODULE_SINKS) {
      const src = read(rel);
      expect(src.includes('egress-receipt'), `${rel}: must import lib/egress-receipt.js`).toBe(true);
      expect(src.includes('writeReceipt('), `${rel}: must call writeReceipt() before its send`).toBe(true);
    }
  });

  test('runtime-bootstrap keeps its inline dependency-free receipt writer at every fetch site', () => {
    // The bootstrap is vendored standalone into skills/*/references/support/,
    // so it carries an inline copy of the writer instead of the lib import.
    const src = read('runtime/runtime-bootstrap.mjs');
    expect(src.includes('function bootstrapEgressReceipt(')).toBe(true);
    expect(src.includes('security", "egress.jsonl') || src.includes(`security", "egress.jsonl`) || /security.+egress\.jsonl/.test(src)).toBe(true);
    // Every fetch call site in the bootstrap must have a receipt call within
    // the 12 preceding lines (receipt-before-send).
    const lines = src.split('\n');
    const offenders: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/await\s+(fetch_|options\.fetch|fetch)\s*\(/.test(lines[i])) continue;
      const windowStart = Math.max(0, i - 12);
      const context = lines.slice(windowStart, i).join('\n');
      if (!context.includes('bootstrapEgressReceipt(')) {
        offenders.push(`runtime/runtime-bootstrap.mjs:${i + 1}`);
      }
    }
    expect(
      offenders,
      'fetch call(s) without a bootstrapEgressReceipt() in the preceding lines: ' + offenders.join(', '),
    ).toEqual([]);
  });

  test('vendored bootstrap copies in skills/ stay byte-identical to runtime/', () => {
    const canonical = read('runtime/runtime-bootstrap.mjs');
    const copies = fs.readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join('skills', entry.name, 'references', 'support', 'runtime-bootstrap.mjs'))
      .filter((rel) => fs.existsSync(path.join(ROOT, rel)));
    expect(copies.length).toBeGreaterThan(0);
    for (const rel of copies) {
      expect(read(rel) === canonical, `${rel} has drifted from runtime/runtime-bootstrap.mjs — re-copy it`).toBe(true);
    }
  });

  test('every curl in a bash sink sits under a gstack-egress-receipt WRITE (fail-closed)', () => {
    // Only the `write` subcommand counts as a receipt — an `outcome` call is
    // bookkeeping for a receipt that already exists and must not launder a
    // later raw curl past this tripwire.
    const RECEIPT_WRITE = /gstack-egress-receipt(["']?)\s+write\b|_receipted_version_fetch\s*\(\)/;
    const offenders: string[] = [];
    for (const rel of SHELL_SINKS) {
      const lines = read(rel).split('\n');
      const guarded = (i: number): boolean => {
        // Receipt-before-send: the write call must appear within the 30
        // preceding lines of the network invocation (brain-sync's retry push
        // sits 27 lines under its receipt; a fresh un-receipted call appended
        // elsewhere has no write call in scope and fails here).
        for (let j = i - 1; j >= Math.max(0, i - 30); j--) {
          if (RECEIPT_WRITE.test(lines[j])) return true;
        }
        return false;
      };
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^\s*#/.test(line)) continue; // comments
        const isCurl = /\bcurl\b/.test(line);
        const isPush = rel === 'bin/gstack-brain-sync' && /git .*push origin/.test(line);
        const isLsRemote = /git ls-remote/.test(line);
        if (!isCurl && !isPush && !isLsRemote) continue;
        if (!guarded(i)) offenders.push(`${rel}:${i + 1}`);
      }
    }
    expect(
      offenders,
      'un-receipted network call(s) — write the egress receipt first (fail-closed): ' + offenders.join(', '),
    ).toEqual([]);
  });

  test('deprecated dead-endpoint brain consumer/reader scripts stay deleted', () => {
    // EGRESS-AUDIT open P2: these posted brain repo_url + Bearer token to a
    // user-registered ingest_url for a /ingest-repo endpoint gbrain never
    // shipped. lstat (not existsSync) so a dangling symlink also fails.
    for (const rel of ['bin/gstack-brain-consumer', 'bin/gstack-brain-reader']) {
      let present = true;
      try {
        fs.lstatSync(path.join(ROOT, rel));
      } catch {
        present = false;
      }
      expect(present, `${rel} was deleted (dead /ingest-repo egress sink) — do not resurrect`).toBe(false);
    }
  });

  test('receipt-before-send ordering in runtime/context.js #request', () => {
    const src = read('runtime/context.js');
    const receiptAt = src.indexOf('writeReceipt({');
    const fetchAt = src.indexOf('this.fetch(requestUrl');
    expect(receiptAt).toBeGreaterThan(-1);
    expect(fetchAt).toBeGreaterThan(-1);
    expect(receiptAt, 'the receipt must be written before this.fetch() fires').toBeLessThan(fetchAt);
  });

  test('sourcebot receipts gate on non-loopback at the single fetch chokepoint', () => {
    const src = read('lib/code-intelligence/sourcebot-adapter.ts');
    expect(/if\s*\(\s*!this\.local\s*\)\s*\{[\s\S]{0,400}writeReceipt\(/.test(src)).toBe(true);
  });

  test('browse tunnel: every ngrok.forward() has a receipt in the preceding lines', () => {
    const lines = read('browse/src/server.ts').split('\n');
    const offenders: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].includes('await ngrok.forward(')) continue;
      const context = lines.slice(Math.max(0, i - 30), i).join('\n');
      if (!context.includes('writeReceipt(')) offenders.push(`browse/src/server.ts:${i + 1}`);
    }
    expect(offenders, 'tunnel session opened without a receipt: ' + offenders.join(', ')).toEqual([]);
  });
});
