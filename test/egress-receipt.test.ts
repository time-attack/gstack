/**
 * Egress receipts — chain, fail-closed, verify, CLI. Free tier, no network.
 *
 * Pins the auditor contract from docs/gstack-2/EGRESS-RECEIPTS.md:
 *   - receipt-before-send fail-closed (EGRESS_RECEIPT_FAILED, no ledger = no send)
 *   - content-free lines chained by prev = sha256(previous raw line)
 *   - `gstack egress verify` exit 3 on tamper, naming the first broken line
 *   - `gstack egress grants` names every consent grant, its file, and revoke command
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import {
  EGRESS_RECEIPT_FAILED,
  egressLedgerPath,
  listReceipts,
  sha256Hex,
  verifyLedger,
  writeOutcome,
  writeReceipt,
} from '../lib/egress-receipt.js';
import { main as cliMain } from '../runtime/cli.js';

const ROOT = path.resolve(new URL(import.meta.url).pathname, '..', '..');

let home: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-egress-'));
});

afterEach(() => {
  try { fs.chmodSync(path.join(home, 'security'), 0o700); } catch {} // undo fail-closed fixtures
  fs.rmSync(home, { recursive: true, force: true });
});

function capture() {
  let value = '';
  return {
    stream: { write(chunk: string) { value += chunk; } },
    value: () => value,
  };
}

async function runCli(args: string[]) {
  const out = capture();
  const err = capture();
  const code = await cliMain(args, {
    env: { GSTACK_HOME: home },
    cwd: home,
    stdout: out.stream,
    stderr: err.stream,
  });
  return { code, stdout: out.value(), stderr: err.value() };
}

describe('egress receipt library', () => {
  test('receipts chain: prev = sha256 of the previous raw line, "" for line 1', () => {
    writeReceipt({ home, sink: 'a', host: 'h1', payloadClass: 'c', bytes: 3, sha256: sha256Hex('abc'), consent: 'k=v' });
    writeReceipt({ home, sink: 'b', host: 'h2', payloadClass: 'c', bytes: 0, sha256: null, consent: 'k=v' });
    const lines = fs.readFileSync(egressLedgerPath(home), 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    expect(first.prev).toBe('');
    expect(second.prev).toBe(sha256Hex(lines[0]));
    expect(first.sha256).toBe(sha256Hex('abc'));
    expect(second.sha256).toBeNull();
    expect(verifyLedger(home)).toMatchObject({ ok: true, count: 2 });
  });

  test('ledger is 0600 and the security dir 0700', () => {
    writeReceipt({ home, sink: 'a', host: 'h', payloadClass: 'c', consent: 'k=v' });
    const ledger = egressLedgerPath(home);
    expect(fs.statSync(ledger).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(ledger)).mode & 0o777).toBe(0o700);
  });

  test('fail-closed: unwritable security dir throws typed EGRESS_RECEIPT_FAILED', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return; // chmod is advisory there
    writeReceipt({ home, sink: 'a', host: 'h', payloadClass: 'c', consent: 'k=v' });
    fs.chmodSync(path.join(home, 'security'), 0o500);
    try {
      expect(() =>
        writeReceipt({ home, sink: 'a', host: 'h', payloadClass: 'c', consent: 'k=v' }),
      ).toThrow();
      try {
        writeReceipt({ home, sink: 'a', host: 'h', payloadClass: 'c', consent: 'k=v' });
      } catch (err: any) {
        expect(err.code).toBe(EGRESS_RECEIPT_FAILED);
      }
    } finally {
      fs.chmodSync(path.join(home, 'security'), 0o700);
    }
  });

  test('outcome records join back onto their receipt in listReceipts', () => {
    const { id } = writeReceipt({ home, sink: 'a', host: 'h', payloadClass: 'c', consent: 'k=v' });
    writeOutcome({ home, receipt: id, status: 204 });
    const receipts = listReceipts(home);
    expect(receipts.length).toBe(1);
    expect(receipts[0].status).toBe('204');
    expect(verifyLedger(home)).toMatchObject({ ok: true, count: 2 });
  });

  test('tampering with a middle line breaks verification at that line', () => {
    for (let i = 0; i < 3; i += 1) {
      writeReceipt({ home, sink: `s${i}`, host: 'h', payloadClass: 'c', consent: 'telemetry=community' });
    }
    const ledger = egressLedgerPath(home);
    const lines = fs.readFileSync(ledger, 'utf-8').trim().split('\n');
    lines[1] = lines[1].replace('community', 'communitX');
    fs.writeFileSync(ledger, `${lines.join('\n')}\n`);
    // Line 2's edited bytes no longer hash to line 3's recorded prev.
    expect(verifyLedger(home)).toMatchObject({ ok: false, brokenLine: 3 });
  });

  test('validation rejects garbage before touching the ledger', () => {
    expect(() => writeReceipt({ home, sink: '', host: 'h', payloadClass: 'c', consent: 'k' } as any)).toThrow();
    expect(() => writeReceipt({ home, sink: 's', host: 'h', payloadClass: 'c', consent: 'k', bytes: -1 })).toThrow();
    expect(() => writeReceipt({ home, sink: 's', host: 'h', payloadClass: 'c', consent: 'k', sha256: 'nothex' })).toThrow();
    expect(fs.existsSync(egressLedgerPath(home))).toBe(false);
  });
});

describe('gstack egress CLI', () => {
  test('list on a fresh home prints "no receipts" and the ledger path, exit 0', async () => {
    const { code, stdout } = await runCli(['egress', 'list']);
    expect(code).toBe(0);
    expect(stdout).toContain('no receipts');
    expect(stdout).toContain(egressLedgerPath(home));
  });

  test('list --json returns receipts and honors --sink/--host/--since filters', async () => {
    writeReceipt({ home, sink: 'telemetry-sync', host: '127.0.0.1:8399', payloadClass: 'telemetry-events', bytes: 2, sha256: sha256Hex('[]'), consent: 'telemetry=community' });
    writeReceipt({ home, sink: 'context.dev', host: 'api.context.dev', payloadClass: 'public-url-extraction-request', consent: 'network.consent=true' });
    const all = await runCli(['egress', 'list', '--json']);
    expect(all.code).toBe(0);
    expect(JSON.parse(all.stdout).length).toBe(2);
    const filtered = await runCli(['egress', 'list', '--json', '--sink', 'telemetry-sync']);
    const rows = JSON.parse(filtered.stdout);
    expect(rows.length).toBe(1);
    expect(rows[0].host).toBe('127.0.0.1:8399');
    expect(rows[0].sha256).toBe(sha256Hex('[]'));
    const none = await runCli(['egress', 'list', '--json', '--since', '2999-01-01T00:00:00Z']);
    expect(JSON.parse(none.stdout).length).toBe(0);
  });

  test('verify exits 0 on an intact chain and 3 naming the first broken line on tamper', async () => {
    writeReceipt({ home, sink: 'a', host: 'h', payloadClass: 'c', consent: 'telemetry=community' });
    writeReceipt({ home, sink: 'b', host: 'h', payloadClass: 'c', consent: 'telemetry=community' });
    expect((await runCli(['egress', 'verify'])).code).toBe(0);
    const ledger = egressLedgerPath(home);
    const lines = fs.readFileSync(ledger, 'utf-8').trim().split('\n');
    lines[0] = lines[0].replace('community', 'communitX');
    fs.writeFileSync(ledger, `${lines.join('\n')}\n`);
    const tampered = await runCli(['egress', 'verify']);
    expect(tampered.code).toBe(3);
    expect(tampered.stdout).toContain('line 2');
  });

  test('grants on a fresh home shows every grant off, each naming its file and revoke command', async () => {
    const { code, stdout } = await runCli(['egress', 'grants']);
    expect(code).toBe(0);
    for (const grant of ['telemetry', 'context.dev', 'code-intelligence', 'pair_agent', 'braintrust_upload', 'brain-sync']) {
      expect(stdout).toContain(grant);
    }
    expect(stdout).not.toContain('[GRANTED]');
    expect(stdout).toContain(path.join(home, 'config.json'));
    expect(stdout).toContain('revoke:');
  });

  test('grants --json flips granted=true for an explicit community telemetry tier', async () => {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ schemaVersion: 2, telemetry: 'community' }));
    const { code, stdout } = await runCli(['egress', 'grants', '--json']);
    expect(code).toBe(0);
    const grants = JSON.parse(stdout);
    const telemetry = grants.find((g: any) => g.grant === 'telemetry');
    expect(telemetry.granted).toBe(true);
    expect(telemetry.revoke).toContain('telemetry off');
    expect(grants.find((g: any) => g.grant === 'context.dev').granted).toBe(false);
  });
});

describe('gstack-egress-receipt shell bridge', () => {
  test('write hashes the exact payload file, prints the receipt id; outcome joins', () => {
    const payload = path.join(home, 'payload.json');
    fs.writeFileSync(payload, '[{"v":1}]');
    const bin = path.join(ROOT, 'bin', 'gstack-egress-receipt');
    const write = spawnSync('node', [bin, 'write', '--sink', 'telemetry-sync', '--host', '127.0.0.1:8399',
      '--class', 'telemetry-events', '--payload-file', payload, '--consent', 'telemetry=community'],
      { encoding: 'utf-8', env: { ...process.env, GSTACK_HOME: home } });
    expect(write.status).toBe(0);
    const id = write.stdout.trim();
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    const outcome = spawnSync('node', [bin, 'outcome', id, '204'],
      { encoding: 'utf-8', env: { ...process.env, GSTACK_HOME: home } });
    expect(outcome.status).toBe(0);
    const receipts = listReceipts(home);
    expect(receipts.length).toBe(1);
    expect(receipts[0].bytes).toBe(9);
    expect(receipts[0].sha256).toBe(sha256Hex('[{"v":1}]'));
    expect(receipts[0].status).toBe('204');
  });

  test('write exits 3 with EGRESS_RECEIPT_FAILED when the ledger is unwritable', () => {
    if (process.platform === 'win32' || process.getuid?.() === 0) return;
    fs.mkdirSync(path.join(home, 'security'), { recursive: true, mode: 0o500 });
    const bin = path.join(ROOT, 'bin', 'gstack-egress-receipt');
    const write = spawnSync('node', [bin, 'write', '--sink', 's', '--host', 'h', '--class', 'c', '--no-payload'],
      { encoding: 'utf-8', env: { ...process.env, GSTACK_HOME: home } });
    expect(write.status).toBe(3);
    expect(write.stderr).toContain('EGRESS_RECEIPT_FAILED');
    fs.chmodSync(path.join(home, 'security'), 0o700);
  });
});
