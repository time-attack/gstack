/**
 * `gstack egress` — the auditor's view of the receipts ledger.
 *
 *   list    what DID leave this machine (one row per receipt)
 *   grants  what CAN leave: every consent grant in force, where it lives,
 *           and the exact command that revokes it (pure config reads)
 *   verify  recompute the hash chain; exit 3 on tamper
 *
 * The ledger itself is written by lib/egress-receipt.js at every enumerated
 * sink (see test/egress-receipt-wiring.test.ts for the pinned list).
 */

import fs from "node:fs/promises";
import path from "node:path";
import { egressLedgerPath, listReceipts, verifyLedger } from "../lib/egress-receipt.js";
import { configGet } from "./config.js";
import { errorWithCode as cliError } from "./errors.js";

export async function egressCommand({ args, home, stdout }) {
  const [action, ...rest] = args;
  if (action === "list") return egressList({ args: rest, home, stdout });
  if (action === "grants") return egressGrants({ args: rest, home, stdout });
  if (action === "verify") return egressVerify({ args: rest, home, stdout });
  throw cliError("Usage: gstack egress list [--since <ISO>] [--host <host>] [--sink <sink>] [--json] | grants [--json] | verify [--json]", "USAGE");
}

function parseListArgs(args) {
  const values = new Map();
  const flags = new Set();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (["--since", "--host", "--sink"].includes(arg)) {
      const value = args[++index];
      if (value == null || value.startsWith("--")) throw cliError(`${arg} requires a value`, "USAGE");
      values.set(arg, value);
    } else if (arg === "--json") {
      flags.add(arg);
    } else {
      throw cliError(`Unknown option: ${arg}`, "USAGE");
    }
  }
  return { values, flags };
}

async function egressList({ args, home, stdout }) {
  const { values, flags } = parseListArgs(args);
  const since = values.get("--since");
  if (since != null && !Number.isFinite(Date.parse(since))) {
    throw cliError("--since must be an ISO timestamp", "USAGE");
  }
  let receipts = listReceipts(home);
  if (since) receipts = receipts.filter((receipt) => Date.parse(receipt.ts) >= Date.parse(since));
  if (values.has("--host")) receipts = receipts.filter((receipt) => receipt.host === values.get("--host"));
  if (values.has("--sink")) receipts = receipts.filter((receipt) => receipt.sink === values.get("--sink"));
  if (flags.has("--json")) {
    stdout.write(`${JSON.stringify(receipts, null, 2)}\n`);
    return 0;
  }
  if (!receipts.length) {
    stdout.write(`no receipts\nledger: ${egressLedgerPath(home)}\n`);
    return 0;
  }
  for (const receipt of receipts) {
    stdout.write(`${receipt.ts}  ${receipt.sink} -> ${receipt.host}  ${receipt.payload_class}  ${receipt.bytes}B  sha256=${receipt.sha256 ?? "(subprocess-owned)"}  consent=${receipt.consent}  status=${receipt.status ?? "-"}\n`);
  }
  stdout.write(`${receipts.length} receipt(s)  ledger: ${egressLedgerPath(home)}\n`);
  return 0;
}

async function egressVerify({ args, home, stdout }) {
  for (const arg of args) if (arg !== "--json") throw cliError(`Unknown option: ${arg}`, "USAGE");
  const result = verifyLedger(home);
  if (args.includes("--json")) {
    stdout.write(`${JSON.stringify({ ...result, ledger: egressLedgerPath(home) }, null, 2)}\n`);
  } else if (result.ok) {
    stdout.write(`chain intact: ${result.count} line(s) verified\n`);
  } else {
    stdout.write(`TAMPER: chain broken at line ${result.brokenLine} (${result.reason})\n`);
  }
  return result.ok ? 0 : 3;
}

/** Read one key from the code-intelligence selection store without importing TS. */
async function readCodeIntelligence(home) {
  try {
    const raw = await fs.readFile(path.join(home, "code-intelligence.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function egressGrants({ args, home, stdout }) {
  for (const arg of args) if (arg !== "--json") throw cliError(`Unknown option: ${arg}`, "USAGE");
  const config = await configGet(home);
  const configFile = path.join(home, "config.json");
  const codeIntelligence = await readCodeIntelligence(home);

  const network = config.network ?? {};
  const validation = config.context?.validation?.status ?? "unverified";
  const contextGranted = network.selection === "context" && network.mode === "context" &&
    network.consent === true && validation !== "unverified";

  const grants = [
    {
      grant: "telemetry",
      value: String(config.telemetry ?? "off"),
      granted: config.telemetry === "community",
      detail: "only the explicit community tier uploads; off/anonymous stay local-only",
      file: configFile,
      key: "telemetry",
      revoke: "gstack config set telemetry off",
    },
    {
      grant: "context.dev",
      value: `mode=${network.mode ?? "off"} consent=${network.consent === true} selection=${network.selection ?? "none"} validation=${validation}`,
      granted: contextGranted,
      detail: "four-condition gate; all four must hold before any URL is sent",
      file: configFile,
      key: "network.* + context.validation",
      revoke: "gstack context select none",
    },
    {
      grant: "code-intelligence",
      value: codeIntelligence
        ? `provider=${codeIntelligence.provider ?? "none"} consented-repos=${Object.entries(codeIntelligence.consents ?? {}).filter(([, v]) => v === true).map(([k]) => k).join(",") || "none"}`
        : "provider=none consented-repos=none",
      granted: Boolean(codeIntelligence?.provider) &&
        Object.values(codeIntelligence?.consents ?? {}).some((consented) => consented === true),
      detail: "per-repo egress consent; no provider selected by default",
      file: path.join(home, "code-intelligence.json"),
      key: "provider + consents",
      revoke: "gstack-code-intelligence select none (or edit consents in the file)",
    },
    {
      grant: "pair_agent",
      value: String(config.pair_agent ?? "off"),
      granted: config.pair_agent === true || config.pair_agent === "on",
      detail: "allows the browse daemon to open an ngrok tunnel session",
      file: configFile,
      key: "pair_agent",
      revoke: "gstack config set pair_agent off",
    },
    {
      grant: "braintrust_upload",
      value: String(config.braintrust_upload ?? "false"),
      granted: config.braintrust_upload === true,
      detail: "benchmark results upload; BRAINTRUST_API_KEY presence alone never uploads",
      file: configFile,
      key: "braintrust_upload",
      revoke: "gstack config set braintrust_upload false",
    },
    {
      grant: "brain-sync",
      value: String(config.artifacts_sync_mode ?? "off"),
      granted: Boolean(config.artifacts_sync_mode) && config.artifacts_sync_mode !== "off",
      detail: "git push of curated allowlisted memory to the user-configured brain remote",
      file: configFile,
      key: "artifacts_sync_mode",
      revoke: "gstack config set artifacts_sync_mode off",
    },
  ];

  if (args.includes("--json")) {
    stdout.write(`${JSON.stringify(grants, null, 2)}\n`);
    return 0;
  }
  for (const grant of grants) {
    stdout.write(`${grant.granted ? "[GRANTED]" : "[off]    "} ${grant.grant}: ${grant.value}\n` +
      `          ${grant.detail}\n` +
      `          lives in: ${grant.file} (${grant.key})\n` +
      `          revoke:   ${grant.revoke}\n`);
  }
  stdout.write("What DID leave: `gstack egress list`. Chain check: `gstack egress verify`.\n");
  return 0;
}
