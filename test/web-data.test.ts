/**
 * web-data provider selection + recommendation. Free tier: no network, no
 * provider processes — availability is driven entirely by env/fs fixtures.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  PROVIDERS,
  TASK_IDS,
  TASK_RANKINGS,
  detectAvailability,
  readSelection,
  recommend,
  setProvider,
} from "../lib/web-data";

let home: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "web-data-test-"));
  // No inherited keys: availability starts from zero.
  env = { HOME: home, GSTACK_HOME: home, PATH: "/nonexistent" };
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("task rankings", () => {
  test("every task has a ranking and every ranked id is a real provider", () => {
    const ids = new Set(PROVIDERS.map((p) => p.id));
    for (const task of TASK_IDS) {
      const r = TASK_RANKINGS[task];
      expect(r.order.length).toBeGreaterThan(0);
      for (const id of r.order) expect(ids.has(id)).toBe(true);
    }
  });

  test("authenticated pages are aside-only — no API provider is ever ranked", () => {
    expect(TASK_RANKINGS.authenticated.order).toEqual(["aside"]);
  });

  test("local browser is never ranked for hostile sites (bot-walled in bakeoff)", () => {
    expect(TASK_RANKINGS.hostile.order).not.toContain("local-browser");
  });
});

describe("availability detection", () => {
  test("nothing configured → nothing available", () => {
    for (const a of detectAvailability(env)) expect(a.available).toBe(false);
  });

  test("env keys flip firecrawl/exa", () => {
    const avail = detectAvailability({ ...env, FIRECRAWL_API_KEY: "fc-x", EXA_API_KEY: "ex-x" });
    const byId = new Map(avail.map((a) => [a.id, a.available]));
    expect(byId.get("firecrawl")).toBe(true);
    expect(byId.get("exa")).toBe(true);
    expect(byId.get("context")).toBe(false);
  });

  test("context requires mode=context AND consent=true in runtime config", () => {
    writeFileSync(join(home, "config.json"), JSON.stringify({ network: { mode: "context", consent: false } }));
    expect(detectAvailability(env).find((a) => a.id === "context")!.available).toBe(false);
    writeFileSync(join(home, "config.json"), JSON.stringify({ network: { mode: "context", consent: true } }));
    expect(detectAvailability(env).find((a) => a.id === "context")!.available).toBe(true);
  });

  test("local-browser detects the installed browse binary", () => {
    mkdirSync(join(home, "bin"), { recursive: true });
    writeFileSync(join(home, "bin", "browse"), "");
    expect(detectAvailability(env).find((a) => a.id === "local-browser")!.available).toBe(true);
  });
});

describe("selection store", () => {
  test("no selection = provider-OFF default, not declined", () => {
    expect(readSelection(env)).toEqual({ provider: null, declined: false });
  });

  test("select persists; select none records the decline; reselect clears it", () => {
    setProvider("firecrawl", env);
    expect(readSelection(env)).toEqual({ provider: "firecrawl", declined: false });
    setProvider(null, env);
    expect(readSelection(env)).toEqual({ provider: null, declined: true });
    setProvider("exa", env);
    expect(readSelection(env).declined).toBe(false);
  });

  test("corrupt or unknown stored provider degrades to OFF", () => {
    writeFileSync(join(home, "web-data.json"), '{"provider":"skynet","declined":false}');
    expect(readSelection(env).provider).toBeNull();
    writeFileSync(join(home, "web-data.json"), "not json");
    expect(readSelection(env)).toEqual({ provider: null, declined: false });
  });
});

describe("recommend: best AVAILABLE wins, better-unavailable carries setup hints", () => {
  test("firecrawl key present → firecrawl recommended for scrape", () => {
    const r = recommend("scrape", { ...env, FIRECRAWL_API_KEY: "fc-x" });
    expect(r.best?.id).toBe("firecrawl");
    expect(r.betterUnavailable).toEqual([]);
  });

  test("only exa available → exa recommended for scrape, firecrawl listed as better with its setup hint", () => {
    const r = recommend("scrape", { ...env, EXA_API_KEY: "ex-x" });
    expect(r.best?.id).toBe("exa");
    expect(r.betterUnavailable.map((u) => u.id)).toEqual(["firecrawl"]);
    expect(r.betterUnavailable[0].setupHint).toContain("FIRECRAWL_API_KEY");
  });

  test("nothing available → best is null and every ranked provider carries a setup hint", () => {
    const r = recommend("search", env);
    expect(r.best).toBeNull();
    expect(r.betterUnavailable.map((u) => u.id)).toEqual(TASK_RANKINGS.search.order);
    for (const u of r.betterUnavailable) expect(u.setupHint.length).toBeGreaterThan(0);
  });

  test("authenticated task never falls back to an API provider even when keys exist", () => {
    const r = recommend("authenticated", { ...env, FIRECRAWL_API_KEY: "fc-x", EXA_API_KEY: "ex-x" });
    expect(r.best).toBeNull();
    expect(r.betterUnavailable.map((u) => u.id)).toEqual(["aside"]);
  });
});
