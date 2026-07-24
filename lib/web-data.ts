/**
 * web-data — pick a web-data (scraping/crawling) provider and recommend the
 * best one per task kind. OPTIONAL: with nothing selected, gstack works fine
 * and callers hand-roll fetches or use the local browser.
 *
 * Selection is stored at `$GSTACK_HOME/web-data.json` (same home as the rest
 * of gstack). Selecting an off-machine provider is the user's explicit consent
 * to send PUBLIC target URLs to it — never authenticated pages, private
 * addresses, project content, cookies, tokens, or credentials. No selection is
 * the provider-OFF default.
 *
 * Task rankings come from the measured bakeoff at
 * `~/.gstack/provider-bakeoff/2026-07-23/REPORT.md` (7 tasks, live runs).
 */

import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export type WebDataProviderId = "firecrawl" | "exa" | "context" | "aside" | "local-browser";
export type WebDataTask = "scrape" | "crawl" | "search" | "batch" | "hostile" | "authenticated";

export const TASK_IDS: readonly WebDataTask[] = ["scrape", "crawl", "search", "batch", "hostile", "authenticated"];

export interface WebDataProvider {
  id: WebDataProviderId;
  label: string;
  /** Sends target URLs off this machine (public URLs only, by contract). */
  offMachine: boolean;
  note: string;
  setupHint: string;
}

export const PROVIDERS: readonly WebDataProvider[] = [
  {
    id: "firecrawl",
    label: "Firecrawl",
    offMachine: true,
    note: "crawl/scrape/search API returning LLM-ready markdown; only provider that passed all bakeoff tasks with live fetches, fastest clean output on anti-bot sites (YC S22)",
    setupHint: "sign up at https://www.firecrawl.dev (1,000 free credits/mo, no card) and export FIRECRAWL_API_KEY",
  },
  {
    id: "exa",
    label: "Exa",
    offMachine: true,
    note: "semantic web search + page contents; unbeatable when you must FIND the URLs first, sub-second on indexed pages, but speed comes from its cache so freshness is not guaranteed (YC S21)",
    setupHint: "sign up at https://dashboard.exa.ai ($20 signup + $10/mo free credits, no card) and export EXA_API_KEY",
  },
  {
    id: "context",
    label: "Context.dev",
    offMachine: true,
    note: "rendered scrape/crawl through the consent-gated gstack runtime; real browser rendering, slowest of the APIs, search deprecated upstream",
    setupHint: "run `gstack context options` then `gstack context setup` (hidden key prompt; free tier, no card)",
  },
  {
    id: "aside",
    label: "Aside browser",
    offMachine: false,
    note: "the user's own AI browser; the only option that can read logged-in/account pages, and its agent can search — but bulk work is serial and slow (22.6s for 8 pages in the bakeoff)",
    setupHint: "install the Aside AI browser so the `aside` CLI is on PATH (never auto-install; presence is not consent to browse)",
  },
  {
    id: "local-browser",
    label: "GStack local browser",
    offMachine: false,
    note: "free local headless Chromium; fine on friendly sites, bot-walled on hostile ones (failed Amazon in the bakeoff), no search",
    setupHint: "run the gstack runtime browser setup (references/RUNTIME.md) to install the managed browse binary",
  },
];

/**
 * Best-first provider order per task kind, from the 2026-07-23 bakeoff.
 * A provider absent from a row cannot do that task at all.
 */
export const TASK_RANKINGS: Record<WebDataTask, { order: WebDataProviderId[]; why: string }> = {
  scrape: {
    order: ["firecrawl", "exa", "context", "aside", "local-browser"],
    why: "single public page to clean markdown: Firecrawl 0.3-1.2s clean output; Exa comparable but cache-based; Context.dev renders but 1.5-4.4s",
  },
  crawl: {
    order: ["firecrawl", "context", "exa", "aside", "local-browser"],
    why: "multi-page crawl: Firecrawl is a real crawler with depth/limit controls; Context.dev does real rendered crawling; Exa returns cached subpages (freshness caveat)",
  },
  search: {
    order: ["exa", "firecrawl", "aside"],
    why: "find URLs/pages first: Exa is a purpose-built search index (0.05-0.8s); Firecrawl /search works (2s); Aside's agent can search (7s); Context.dev deprecated search, local browser has none",
  },
  batch: {
    order: ["firecrawl", "exa", "context", "local-browser", "aside"],
    why: "many known URLs: APIs parallelize (Firecrawl 8 pages in 5.6s); browsers serialize (Aside 22.6s) — wrong tool past a handful of pages",
  },
  hostile: {
    order: ["firecrawl", "aside", "context", "exa"],
    why: "anti-bot sites (Amazon-class): Firecrawl passed in 1.1s with clean prices; Aside passed via the user's real browser session; plain local headless Chromium got bot-walled",
  },
  authenticated: {
    order: ["aside"],
    why: "logged-in/account pages: only the user's own browser may touch these; never send authenticated pages to any API provider",
  },
};

// ---------- availability ----------

export interface Availability {
  id: WebDataProviderId;
  available: boolean;
  detail: string;
}

function gstackHome(env: NodeJS.ProcessEnv): string {
  return env.GSTACK_HOME || join(env.HOME || homedir(), ".gstack");
}

function contextReady(env: NodeJS.ProcessEnv): { ok: boolean; detail: string } {
  const p = join(gstackHome(env), "config.json");
  if (!existsSync(p)) return { ok: false, detail: "no runtime config; run `gstack context setup`" };
  try {
    const cfg = JSON.parse(readFileSync(p, "utf-8"));
    const net = cfg?.network;
    if (net?.mode === "context" && net?.consent === true) return { ok: true, detail: "consented (network mode: context)" };
    return { ok: false, detail: "runtime present but Context.dev not selected/consented" };
  } catch {
    return { ok: false, detail: "unreadable runtime config" };
  }
}

function onPath(bin: string, env: NodeJS.ProcessEnv): boolean {
  try {
    execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "pipe", env: { ...env } });
    return true;
  } catch {
    return false;
  }
}

export function detectAvailability(env: NodeJS.ProcessEnv = process.env): Availability[] {
  const ctx = contextReady(env);
  const asideAvailable = onPath("aside", env);
  return [
    {
      id: "firecrawl",
      available: Boolean(env.FIRECRAWL_API_KEY),
      detail: env.FIRECRAWL_API_KEY ? "FIRECRAWL_API_KEY set" : "FIRECRAWL_API_KEY not set",
    },
    {
      id: "exa",
      available: Boolean(env.EXA_API_KEY),
      detail: env.EXA_API_KEY ? "EXA_API_KEY set" : "EXA_API_KEY not set",
    },
    { id: "context", available: ctx.ok, detail: ctx.detail },
    {
      id: "aside",
      available: asideAvailable,
      detail: asideAvailable ? "aside CLI on PATH" : "aside CLI not found",
    },
    {
      id: "local-browser",
      available: existsSync(join(gstackHome(env), "bin", "browse")),
      detail: existsSync(join(gstackHome(env), "bin", "browse")) ? "browse binary installed" : "browse binary not installed",
    },
  ];
}

// ---------- selection store ----------

export interface WebDataSelection {
  provider: WebDataProviderId | null;
  /** User explicitly chose none — never offer again. */
  declined: boolean;
}

const EMPTY: WebDataSelection = { provider: null, declined: false };

function storePath(env: NodeJS.ProcessEnv): string {
  return join(gstackHome(env), "web-data.json");
}

export function readSelection(env: NodeJS.ProcessEnv = process.env): WebDataSelection {
  const p = storePath(env);
  if (!existsSync(p)) return { ...EMPTY };
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as Partial<WebDataSelection>;
    const provider = PROVIDERS.some((x) => x.id === raw.provider) ? (raw.provider as WebDataProviderId) : null;
    return { provider, declined: raw.declined === true };
  } catch {
    return { ...EMPTY };
  }
}

export function setProvider(provider: WebDataProviderId | null, env: NodeJS.ProcessEnv = process.env): WebDataSelection {
  // Choosing a provider clears a prior decline; clearing to null records one.
  const next: WebDataSelection = { provider, declined: provider === null };
  const p = storePath(env);
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), "utf-8");
  renameSync(tmp, p);
  return next;
}

// ---------- recommendation ----------

export interface Recommendation {
  task: WebDataTask;
  why: string;
  /** Best available provider for this task, or null if none is set up. */
  best: (WebDataProvider & { detail: string }) | null;
  /** Better-ranked providers that are NOT available, with how to set them up. */
  betterUnavailable: (WebDataProvider & { detail: string })[];
}

export function recommend(task: WebDataTask, env: NodeJS.ProcessEnv = process.env): Recommendation {
  const ranking = TASK_RANKINGS[task];
  const avail = new Map(detectAvailability(env).map((a) => [a.id, a]));
  const betterUnavailable: Recommendation["betterUnavailable"] = [];
  let best: Recommendation["best"] = null;
  for (const id of ranking.order) {
    const provider = PROVIDERS.find((x) => x.id === id)!;
    const a = avail.get(id)!;
    if (a.available) {
      best = { ...provider, detail: a.detail };
      break;
    }
    betterUnavailable.push({ ...provider, detail: a.detail });
  }
  return { task, why: ranking.why, best, betterUnavailable };
}
