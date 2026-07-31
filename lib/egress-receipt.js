/**
 * egress-receipt — hash-chained, content-free receipts for every
 * gstack-initiated off-machine send (`~/.gstack/security/egress.jsonl`, 0600).
 *
 * Semantics (docs/gstack-2/EGRESS-RECEIPTS.md):
 *   - Receipt-before-send, fail-closed: the receipt line is appended BEFORE
 *     the network call. If it cannot be written, the caller MUST refuse the
 *     send with the typed code EGRESS_RECEIPT_FAILED.
 *   - Content-free: never payload text, never credentials — a sha256 of the
 *     exact bytes sent plus a byte count only (semantic-reviews.jsonl
 *     precedent). Sinks where a subprocess/SDK owns the bytes record
 *     sha256: null.
 *   - Tamper-evident: each line carries `prev` = sha256 of the previous raw
 *     line ("" for line 1). `verifyLedger` recomputes the chain.
 *
 * Plain ESM JS on node builtins only, so the node runtime CLI, bun TS
 * binaries, and the compiled browse binary can all import it (same
 * constraint as browse/src/security.ts: no native modules).
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const EGRESS_RECEIPT_FAILED = "EGRESS_RECEIPT_FAILED";

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * Same resolution order as the rest of gstack (selection.ts, shell sinks):
 * GSTACK_HOME, legacy GSTACK_STATE_DIR, then $HOME/.gstack.
 */
export function resolveEgressHome(env = process.env) {
  const configured = env.GSTACK_HOME || env.GSTACK_STATE_DIR;
  if (configured) return path.resolve(configured);
  return path.join(env.HOME || os.homedir(), ".gstack");
}

export function egressLedgerPath(home) {
  return path.join(home, "security", "egress.jsonl");
}

export function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function receiptError(message, cause) {
  const error = cause === undefined ? new Error(message) : new Error(message, { cause });
  error.code = EGRESS_RECEIPT_FAILED;
  return error;
}

function requireString(value, name) {
  if (typeof value !== "string" || !value) throw receiptError(`Egress receipt requires a non-empty ${name}`);
  return value;
}

/**
 * ponytail: mkdir spin lock (~2.5s budget), a full flock helper if two sinks
 * ever contend for real. Egress events are rare (minutes apart), the lock
 * only protects the read-last-line → append window.
 */
function withLedgerLock(ledger, callback) {
  const lock = `${ledger}.lock`;
  const deadline = Date.now() + 2500;
  for (;;) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() > deadline) {
        // A crashed writer can strand the lock; a lock dir older than the
        // budget is stale by definition (appends are milliseconds).
        try {
          const age = Date.now() - fs.statSync(lock).mtimeMs;
          if (age > 10_000) { fs.rmdirSync(lock); continue; }
        } catch { /* raced with the owner's cleanup — retry */ }
        throw receiptError(`Egress ledger is locked: ${lock}`);
      }
      // Sync sleep (node + bun): the API is sync on purpose so shell, bun,
      // and node callers all share one implementation.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return callback();
  } finally {
    try { fs.rmdirSync(lock); } catch { /* best-effort unlock */ }
  }
}

function lastRawLine(ledger) {
  let content;
  try {
    // ponytail: whole-file read per append; index the tail offset if a ledger
    // ever grows past a few MB of receipts.
    content = fs.readFileSync(ledger, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  const lines = content.split("\n").filter((line) => line.length > 0);
  return lines.length ? lines[lines.length - 1] : null;
}

function appendChained(homeOrNull, record, env) {
  const home = homeOrNull ?? resolveEgressHome(env);
  const ledger = egressLedgerPath(home);
  try {
    fs.mkdirSync(path.dirname(ledger), { recursive: true, mode: 0o700 });
    return withLedgerLock(ledger, () => {
      const previous = lastRawLine(ledger);
      const line = JSON.stringify({ ...record, prev: previous == null ? "" : sha256Hex(previous) });
      const existed = fs.existsSync(ledger);
      fs.appendFileSync(ledger, `${line}\n`, { mode: 0o600 });
      if (!existed) fs.chmodSync(ledger, 0o600); // umask must not weaken the ledger
      return { id: sha256Hex(line), path: ledger };
    });
  } catch (error) {
    if (error?.code === EGRESS_RECEIPT_FAILED) throw error;
    throw receiptError(`Egress receipt could not be written to ${ledger}: ${error?.message ?? error}`, error);
  }
}

/**
 * Append one content-free receipt BEFORE a network send.
 *
 * @param {object} opts
 * @param {string} [opts.home]        gstack home; resolved from env when omitted
 * @param {object} [opts.env]         env for home resolution (tests)
 * @param {string} opts.sink          which gstack component is sending
 * @param {string} opts.host          destination host[:port]
 * @param {string} opts.payloadClass  content-free payload description
 * @param {number} [opts.bytes]       exact byte count sent (0 for bodyless requests)
 * @param {string|null} [opts.sha256] sha256 hex of the exact bytes sent; null when a
 *                                    subprocess/SDK owns the bytes
 * @param {string} opts.consent       the consent key+value that authorizes this send
 * @returns {{id: string, path: string}} id = sha256 of the written line (for writeOutcome)
 * @throws {Error} code EGRESS_RECEIPT_FAILED — caller must refuse the send
 */
export function writeReceipt(opts) {
  const sink = requireString(opts.sink, "sink");
  const host = requireString(opts.host, "host");
  const payloadClass = requireString(opts.payloadClass, "payloadClass");
  const consent = requireString(opts.consent, "consent");
  const bytes = opts.bytes ?? 0;
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw receiptError("Egress receipt bytes must be a non-negative integer");
  const sha256 = opts.sha256 ?? null;
  if (sha256 !== null && !SHA256_HEX.test(String(sha256))) throw receiptError("Egress receipt sha256 must be 64 lowercase hex chars or null");
  return appendChained(opts.home ?? null, {
    ts: new Date().toISOString(),
    type: "egress",
    sink,
    host,
    payload_class: payloadClass,
    bytes,
    sha256,
    consent,
  }, opts.env);
}

/**
 * Append the response status for an earlier receipt (best-effort companion
 * record — the pre-send receipt is the fail-closed invariant, the outcome is
 * bookkeeping). Chained like every other line.
 */
export function writeOutcome(opts) {
  const receipt = requireString(opts.receipt, "receipt id");
  return appendChained(opts.home ?? null, {
    ts: new Date().toISOString(),
    type: "outcome",
    receipt,
    status: String(opts.status ?? "unknown"),
  }, opts.env);
}

/** Raw parsed lines: [{lineNo, raw, record|null}]. Missing ledger → []. */
export function readLedger(home) {
  const ledger = egressLedgerPath(home);
  let content;
  try {
    content = fs.readFileSync(ledger, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  return content.split("\n").filter((line) => line.length > 0).map((raw, index) => {
    let record = null;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") record = parsed;
    } catch { /* malformed line — verifyLedger reports it */ }
    return { lineNo: index + 1, raw, record };
  });
}

/** Receipts with their joined outcome status (`status: null` = none recorded). */
export function listReceipts(home) {
  const lines = readLedger(home);
  const receipts = [];
  const byId = new Map();
  for (const { raw, record } of lines) {
    if (!record) continue;
    if (record.type === "egress") {
      const entry = { ...record, id: sha256Hex(raw), status: null };
      receipts.push(entry);
      byId.set(entry.id, entry);
    } else if (record.type === "outcome" && byId.has(record.receipt)) {
      byId.get(record.receipt).status = record.status;
    }
  }
  return receipts;
}

/**
 * Recompute the hash chain. Returns {ok, count, brokenLine, reason};
 * brokenLine is the 1-indexed first line whose `prev` no longer matches the
 * sha256 of the previous raw line (or that fails to parse).
 */
export function verifyLedger(home) {
  const lines = readLedger(home);
  let previousRaw = null;
  for (const { lineNo, raw, record } of lines) {
    if (!record || typeof record.prev !== "string") {
      return { ok: false, count: lines.length, brokenLine: lineNo, reason: "unparseable or missing prev" };
    }
    const expected = previousRaw == null ? "" : sha256Hex(previousRaw);
    if (record.prev !== expected) {
      return { ok: false, count: lines.length, brokenLine: lineNo, reason: "prev hash does not match previous line" };
    }
    previousRaw = raw;
  }
  return { ok: true, count: lines.length, brokenLine: null, reason: null };
}
