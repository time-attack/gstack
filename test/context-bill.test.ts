/**
 * gstack context-bill — token bill-of-materials for an installed skills tree.
 *
 * Free tier, no network, no API keys. Covers:
 *   - ALWAYS-ON ledger: exact frontmatter byte sums, dead-key flag (#2286),
 *     foreign-host file flag (#1694)
 *   - EAGER ledger: SKILL.md + forced-read refs discovered from the
 *     "for every invocation" dispatch sentence
 *   - FAST-PATH ledger: what a trivial ask pays when the dispatcher's fast path
 *     overrides that forced-read step (SKILL.md alone)
 *   - CONDITIONAL ledger: refs the dispatcher mandates under a stated condition,
 *     plus the eager + conditional per-invocation ceiling
 *   - LAZY ledger: mode/alias table rows resolved to references/legacy/*.md,
 *     orphan (unrouted) module listing
 *   - bytes/4 token estimate, --json shape, --diff (the #2362 replay),
 *     --budget exit codes, and a ground-truth cross-check against the real
 *     skills/ tree (plan's forced triad).
 */
import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  buildBill,
  checkBudget,
  contextBillMain,
  diffBills,
  estimateTokens,
  renderBill,
} from "../runtime/context-bill.js";

const ROOT = path.join(import.meta.dir, "..");
const TREE_A = path.join(import.meta.dir, "fixtures", "context-bill", "tree-a");

function fileBytes(...segments: string[]): number {
  return fs.statSync(path.join(...segments)).size;
}

/** Frontmatter block bytes, computed independently of the implementation. */
function frontmatterBytes(file: string): number {
  const text = fs.readFileSync(file, "utf8");
  const close = text.indexOf("\n---\n", 3);
  return Buffer.byteLength(text.slice(0, close + 5), "utf8");
}

function capture() {
  let buf = "";
  return {
    stream: { write: (s: string) => ((buf += s), true) } as unknown as NodeJS.WriteStream,
    text: () => buf,
  };
}

describe("always-on ledger", () => {
  const bill = buildBill(TREE_A);

  it("sums per-skill frontmatter bytes exactly", () => {
    const alpha = bill.skills.find((s) => s.name === "alpha")!;
    const beta = bill.skills.find((s) => s.name === "beta")!;
    expect(alpha.frontmatterBytes).toBe(frontmatterBytes(path.join(TREE_A, "alpha", "SKILL.md")));
    expect(beta.frontmatterBytes).toBe(frontmatterBytes(path.join(TREE_A, "beta", "SKILL.md")));
    expect(bill.totals.alwaysOnBytes).toBe(alpha.frontmatterBytes + beta.frontmatterBytes);
  });

  it("flags frontmatter keys the router never reads (#2286)", () => {
    const alpha = bill.skills.find((s) => s.name === "alpha")!;
    expect(alpha.deadKeys).toEqual(["triggers"]);
    expect(bill.skills.find((s) => s.name === "beta")!.deadKeys).toEqual([]);
  });

  it("flags foreign-host skill-shaped files in scanner scope (#1694)", () => {
    const beta = bill.skills.find((s) => s.name === "beta")!;
    expect(beta.foreignFiles.map((f) => f.path)).toEqual(["agents.md"]);
    expect(bill.skills.find((s) => s.name === "alpha")!.foreignFiles).toEqual([]);
  });
});

describe("eager ledger", () => {
  const bill = buildBill(TREE_A);
  const alpha = bill.skills.find((s) => s.name === "alpha")!;

  it("eager = SKILL.md + only the forced-read references", () => {
    expect(alpha.forcedRefs.map((r) => r.path)).toEqual([
      "references/CORE.md",
      "references/POLICY.md",
    ]);
    const expected =
      fileBytes(TREE_A, "alpha", "SKILL.md") +
      fileBytes(TREE_A, "alpha", "references", "CORE.md") +
      fileBytes(TREE_A, "alpha", "references", "POLICY.md");
    expect(alpha.eagerBytes).toBe(expected);
  });

  it("conditional references (OPTIONAL.md) stay out of the eager bill", () => {
    expect(alpha.forcedRefs.some((r) => r.path.includes("OPTIONAL"))).toBe(false);
  });

  it("a skill with no forced reads bills only its SKILL.md", () => {
    const beta = bill.skills.find((s) => s.name === "beta")!;
    expect(beta.eagerBytes).toBe(fileBytes(TREE_A, "beta", "SKILL.md"));
  });
});

describe("fast-path ledger (what a trivial ask actually pays)", () => {
  /** TREE_A's alpha, with the dispatcher clause that overrides the forced reads. */
  function treeWithFastPath(): string {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "context-bill-fastpath-"));
    const tree = path.join(tmp, "tree");
    fs.cpSync(TREE_A, tree, { recursive: true });
    const skillMd = path.join(tree, "alpha", "SKILL.md");
    const patched = fs
      .readFileSync(skillMd, "utf8")
      .replace(
        "for every invocation.",
        "for every invocation. The trivial-change fast path overrides this step: when it fires, read only what that path directs.",
      );
    fs.writeFileSync(skillMd, `${patched}\n## Trivial-change fast path\n\nMechanical and fully specified by the prompt.\n`);
    return tree;
  }

  it("bills SKILL.md alone — no forced refs, no modules — and names the paths", () => {
    const tree = treeWithFastPath();
    const alpha = buildBill(tree).skills.find((s) => s.name === "alpha")!;
    expect(alpha.fastPath).toEqual({ paths: ["Trivial-change fast path"], bytes: alpha.skillMdBytes });
    // The receipted overstatement: the eager row charges the forced refs the
    // fast path explicitly skips.
    expect(alpha.fastPath!.bytes).toBeLessThan(alpha.eagerBytes);
    expect(alpha.eagerBytes - alpha.fastPath!.bytes).toBe(
      fileBytes(tree, "alpha", "references", "CORE.md") + fileBytes(tree, "alpha", "references", "POLICY.md"),
    );
    // The normal path still pays them.
    expect(alpha.forcedRefs).toHaveLength(2);
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });

  it("renders the fast-path row next to the eager row, with the saving", () => {
    const tree = treeWithFastPath();
    const text = renderBill(buildBill(tree));
    expect(text).toContain("FAST-PATH (trivial ask): SKILL.md only, no forced refs, no modules");
    expect(text).toContain("[Trivial-change fast path]");
    expect(text).toContain("vs eager");
    expect(text.indexOf("EAGER (per invocation)")).toBeLessThan(text.indexOf("FAST-PATH (trivial ask)"));
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });

  it("no override clause means no fast-path row, so the eager figure is not undersold", () => {
    const bill = buildBill(TREE_A);
    expect(bill.skills.find((s) => s.name === "alpha")!.fastPath).toBeNull();
    expect(bill.totals.fastPathBytesBySkill.alpha).toBeNull();
    expect(renderBill(bill)).toContain("none (no fast path overrides the forced reads");
  });
});

describe("conditional ledger", () => {
  const bill = buildBill(TREE_A);
  const alpha = bill.skills.find((s) => s.name === "alpha")!;

  it("bills the refs the dispatcher mandates under a stated condition", () => {
    expect(alpha.conditionalRefs.map((r) => r.path)).toEqual(["references/OPTIONAL.md"]);
    expect(alpha.conditionalBytes).toBe(fileBytes(TREE_A, "alpha", "references", "OPTIONAL.md"));
  });

  it("carries the dispatcher's own condition text so the reader can judge how often it fires", () => {
    expect(alpha.conditionalRefs[0].condition).toBe("Read OPTIONAL.md before public-web work.");
  });

  it("never double-bills a ref that is already eager", () => {
    // alpha step 3 re-mandates CORE.md under a repository condition.
    expect(alpha.conditionalRefs.some((r) => r.path.includes("CORE"))).toBe(false);
  });

  it("per-invocation ceiling = eager + conditional, above the eager figure", () => {
    expect(alpha.perInvocationBytes).toBe(alpha.eagerBytes + alpha.conditionalBytes);
    expect(alpha.perInvocationBytes).toBeGreaterThan(alpha.eagerBytes);
    expect(bill.totals.perInvocationBytesBySkill.alpha).toBe(alpha.perInvocationBytes);
  });

  it("routing-table module rows never leak into the conditional tier", () => {
    for (const s of bill.skills) {
      expect(s.conditionalRefs.every((r) => !r.path.includes("legacy/"))).toBe(true);
    }
  });

  it("a skill with no mandated reads has an empty conditional tier", () => {
    const beta = bill.skills.find((s) => s.name === "beta")!;
    expect(beta.conditionalRefs).toEqual([]);
    expect(beta.perInvocationBytes).toBe(beta.eagerBytes);
  });
});

describe("lazy ledger", () => {
  const bill = buildBill(TREE_A);
  const alpha = bill.skills.find((s) => s.name === "alpha")!;

  it("resolves mode-table rows to legacy modules and sums their bytes", () => {
    const discovery = alpha.lazy.find((r) => r.label === "Discovery")!;
    expect(discovery.modules.map((m) => m.path)).toEqual(["references/legacy/office.md"]);
    expect(discovery.bytes).toBe(fileBytes(TREE_A, "alpha", "references", "legacy", "office.md"));
    const full = alpha.lazy.find((r) => r.label === "Full chain")!;
    expect(full.bytes).toBe(fileBytes(TREE_A, "alpha", "references", "legacy", "auto.md"));
  });

  it("includes alias-table rows too", () => {
    expect(alpha.lazy.some((r) => r.label === "/office-hours")).toBe(true);
  });

  it("lists on-disk legacy modules no table routes to (orphans)", () => {
    expect(alpha.orphans.map((o) => o.path)).toEqual(["references/legacy/orphan.md"]);
  });
});

describe("token estimate and rendering", () => {
  it("estimates tokens as bytes/4, rounded", () => {
    expect(estimateTokens(4000)).toBe(1000);
    expect(estimateTokens(6)).toBe(2); // 1.5 rounds to 2
    expect(estimateTokens(5)).toBe(1);
  });

  it("text output carries every ledger plus flags", () => {
    const text = renderBill(buildBill(TREE_A));
    expect(text).toContain("ALWAYS-ON (every session): 2 skills");
    expect(text).toContain("EAGER (per invocation)");
    expect(text).toContain("FAST-PATH (trivial ask)");
    expect(text).toContain("CONDITIONAL (per invocation, when the stated condition holds)");
    expect(text).toContain("alpha per-invocation ceiling (eager + all conditional)");
    expect(text).toContain("LAZY (per mode/alias)");
    expect(text).toContain("frontmatter key(s) the router never reads: triggers");
    expect(text).toContain("foreign-host file in scanner scope: agents.md");
    expect(text).toContain("(unrouted on disk)");
    expect(text).toContain("estimates (bytes/4)");
  });

  it("--json shape is stable", async () => {
    const out = capture();
    const code = await contextBillMain([TREE_A, "--json"], { stdout: out.stream, stderr: out.stream });
    expect(code).toBe(0);
    const bill = JSON.parse(out.text());
    expect(bill.tokenEstimate).toBe("bytes/4");
    expect(Object.keys(bill.totals).sort()).toEqual([
      "alwaysOnBytes",
      "eagerBytesBySkill",
      "fastPathBytesBySkill",
      "lazyBytes",
      "lazyPercent",
      "perInvocationBytesBySkill",
      "skillCount",
      "totalMdBytes",
    ]);
    const skill = bill.skills[0];
    for (const key of ["name", "frontmatterBytes", "deadKeys", "skillMdBytes", "forcedRefs", "eagerBytes", "fastPath", "conditionalRefs", "conditionalBytes", "perInvocationBytes", "lazy", "orphans", "foreignFiles"]) {
      expect(skill).toHaveProperty(key);
    }
  });

  it("--skill/--mode simulates a single invocation", async () => {
    const out = capture();
    const code = await contextBillMain([TREE_A, "--skill", "alpha", "--mode", "Discovery"], {
      stdout: out.stream,
      stderr: out.stream,
    });
    expect(code).toBe(0);
    expect(out.text()).toContain('alpha / mode "Discovery" invocation total');
    expect(out.text()).toContain("(eager + conditional + routed modules)");
    expect(out.text()).not.toContain("Full chain");
  });
});

describe("--diff (the #2362 replay: silently inlined preamble)", () => {
  it("reports exactly the grown row and exits 2", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "context-bill-"));
    const treeB = path.join(tmp, "tree-b");
    fs.cpSync(TREE_A, treeB, { recursive: true });
    fs.appendFileSync(path.join(treeB, "alpha", "SKILL.md"), "x".repeat(43000));

    const diff = diffBills(buildBill(TREE_A), buildBill(treeB));
    expect(diff.rows).toHaveLength(1);
    expect(diff.rows[0]).toMatchObject({ ledger: "eager", label: "alpha", delta: 43000 });
    expect(diff.grew).toBe(true);

    const out = capture();
    const code = await contextBillMain(["--diff", TREE_A, treeB], { stdout: out.stream, stderr: out.stream });
    expect(code).toBe(2);
    expect(out.text()).toContain("eager");
    expect(out.text()).toContain("GREW");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("a newly mandated conditional read is growth too (exit 2)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "context-bill-cond-"));
    const treeB = path.join(tmp, "tree-b");
    fs.cpSync(TREE_A, treeB, { recursive: true });
    // A new heavy reference, mandated only under a condition: the pre-fix
    // eager-only ledger reported this as free.
    fs.writeFileSync(path.join(treeB, "alpha", "references", "HEAVY.md"), "x".repeat(40000));
    fs.appendFileSync(
      path.join(treeB, "alpha", "SKILL.md"),
      "\n4. Read `references/HEAVY.md` before deploy work.\n",
    );

    const diff = diffBills(buildBill(TREE_A), buildBill(treeB));
    const conditional = diff.rows.find((r) => r.ledger === "conditional")!;
    expect(conditional).toMatchObject({ label: "alpha", delta: 40000 });
    expect(diff.grew).toBe(true);

    const out = capture();
    const code = await contextBillMain(["--diff", TREE_A, treeB], { stdout: out.stream, stderr: out.stream });
    expect(code).toBe(2);
    expect(out.text()).toContain("conditional");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("identical trees diff clean and exit 0", async () => {
    const out = capture();
    const code = await contextBillMain(["--diff", TREE_A, TREE_A], { stdout: out.stream, stderr: out.stream });
    expect(code).toBe(0);
    expect(out.text()).toContain("No context-cost changes");
  });
});

describe("--budget", () => {
  const alphaEagerTok = estimateTokens(buildBill(TREE_A).skills.find((s) => s.name === "alpha")!.eagerBytes);

  it("exits 0 under budget, 2 over budget with offending files listed", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "context-bill-budget-"));
    const okBudget = path.join(tmp, "ok.json");
    const tightBudget = path.join(tmp, "tight.json");
    fs.writeFileSync(okBudget, JSON.stringify({ alwaysOnTotal: 10000, eagerPerInvocation: { alpha: alphaEagerTok } }));
    fs.writeFileSync(tightBudget, JSON.stringify({ eagerPerInvocation: { alpha: alphaEagerTok - 1 } }));

    const ok = capture();
    expect(await contextBillMain([TREE_A, "--budget", okBudget], { stdout: ok.stream, stderr: ok.stream })).toBe(0);
    expect(ok.text()).toContain("Within budget");

    const over = capture();
    expect(await contextBillMain([TREE_A, "--budget", tightBudget], { stdout: over.stream, stderr: over.stream })).toBe(2);
    expect(over.text()).toContain("OVER BUDGET: eagerPerInvocation.alpha");
    expect(over.text()).toContain("alpha/SKILL.md");
    expect(over.text()).toContain("references/CORE.md");
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("perInvocation gates the eager + conditional ceiling, not just the eager floor", () => {
    const bill = buildBill(TREE_A);
    const alpha = bill.skills.find((s) => s.name === "alpha")!;
    const ceiling = estimateTokens(alpha.perInvocationBytes);
    // A budget the eager floor clears but the real per-invocation cost blows.
    expect(checkBudget(bill, { eagerPerInvocation: { alpha: ceiling } })).toEqual([]);
    const violations = checkBudget(bill, { perInvocation: { alpha: alphaEagerTok } });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ ceiling: "perInvocation.alpha", actual: ceiling });
    expect(violations[0].files.some((f: string) => f.includes("OPTIONAL.md") && f.includes("conditional"))).toBe(true);
  });

  it("checkBudget flags a budgeted skill missing from the tree", () => {
    const violations = checkBudget(buildBill(TREE_A), { eagerPerInvocation: { ghost: 100 } });
    expect(violations).toHaveLength(1);
    expect(violations[0].ceiling).toBe("eagerPerInvocation.ghost");
  });
});

describe("ground-truth cross-check against the real skills/ tree", () => {
  const SKILLS = path.join(ROOT, "skills");

  it("plan's forced-read set is exactly the shared triad", () => {
    const bill = buildBill(SKILLS);
    const plan = bill.skills.find((s) => s.name === "plan")!;
    expect(plan.forcedRefs.map((r) => r.path)).toEqual([
      "references/EXECUTION-PROFILES.md",
      "references/SHARED-JUDGMENT.md",
      "references/AUTHORITY-POLICY.md",
    ]);
    const wc =
      fileBytes(SKILLS, "plan", "SKILL.md") +
      fileBytes(SKILLS, "plan", "references", "EXECUTION-PROFILES.md") +
      fileBytes(SKILLS, "plan", "references", "SHARED-JUDGMENT.md") +
      fileBytes(SKILLS, "plan", "references", "AUTHORITY-POLICY.md");
    expect(plan.eagerBytes).toBe(wc);
  });

  it("every plan legacy module on disk is routed by a table (no orphans, no phantoms)", () => {
    const plan = buildBill(SKILLS).skills.find((s) => s.name === "plan")!;
    expect(plan.orphans).toEqual([]);
    for (const row of plan.lazy) for (const m of row.modules) expect(m.missing).toBe(false);
    const routed = new Set(plan.lazy.flatMap((r) => r.modules.map((m) => path.basename(m.path))));
    const onDisk = fs.readdirSync(path.join(SKILLS, "plan", "references", "legacy")).filter((f) => f.endsWith(".md"));
    expect([...routed].sort()).toEqual(onDisk.sort());
  });

  it("finds all six canonical skills (five dispatchers + make-pdf)", () => {
    const names = buildBill(SKILLS).skills.map((s) => s.name).sort();
    expect(names).toEqual(["debug", "make-pdf", "plan", "qa", "review", "ship"]);
  });

  it("every dispatcher's conditional tier carries the mandated reads the eager row ignores", () => {
    const bill = buildBill(SKILLS);
    for (const name of ["plan", "qa", "debug", "review", "ship"]) {
      const s = bill.skills.find((x) => x.name === name)!;
      const basenames = s.conditionalRefs.map((r) => path.basename(r.path));
      // The receipted misses: each is mandated under a condition a normal run hits.
      expect(basenames).toContain("QUESTION-FORMAT.md");
      expect(basenames).toContain("RUNTIME.md");
      expect(basenames).toContain("WEB-CONTEXT.md");
      expect(basenames).toContain("CODE-INTELLIGENCE.md");
      expect(s.conditionalRefs.every((r) => !r.missing)).toBe(true);
      expect(s.perInvocationBytes).toBeGreaterThan(s.eagerBytes);
    }
  });

  it("every dispatcher's trivial path drops the forced triad; make-pdf has no fast path", () => {
    const bill = buildBill(SKILLS);
    const triad =
      fileBytes(SKILLS, "plan", "references", "EXECUTION-PROFILES.md") +
      fileBytes(SKILLS, "plan", "references", "SHARED-JUDGMENT.md") +
      fileBytes(SKILLS, "plan", "references", "AUTHORITY-POLICY.md");
    for (const name of ["plan", "qa", "debug", "review", "ship"]) {
      const s = bill.skills.find((x) => x.name === name)!;
      // The overstatement this closes: ~1.8K tok of forced refs charged to a
      // trivial ask that the dispatcher explicitly tells the agent to skip.
      expect(s.fastPath).not.toBeNull();
      expect(s.fastPath!.bytes).toBe(s.skillMdBytes);
      expect(s.eagerBytes - s.fastPath!.bytes).toBe(triad);
      expect(s.fastPath!.paths.some((p) => /fast path$/.test(p))).toBe(true);
    }
    expect(bill.skills.find((s) => s.name === "plan")!.fastPath!.paths).toEqual([
      "Empty-target fast path",
      "Trivial-change fast path",
    ]);
    // A tool skill, not a dispatcher: no fast path, so its eager row stands.
    expect(bill.skills.find((s) => s.name === "make-pdf")!.fastPath).toBeNull();
  });

  it("qa's real per-invocation cost is well above its eager row", () => {
    const qa = buildBill(SKILLS).skills.find((s) => s.name === "qa")!;
    // The eager-only figure was the receipted understatement; the ceiling is
    // more than double it, and system-functional is part of why.
    expect(qa.conditionalRefs.map((r) => path.basename(r.path))).toContain("SYSTEM-FUNCTIONAL.md");
    expect(qa.perInvocationBytes).toBeGreaterThan(qa.eagerBytes * 2);
  });
});

describe("auto-detected default trees", () => {
  it("prefers ./skills, then the canonical .agents/skills, then .claude/skills, project before user", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "context-bill-detect-"));
    const home = path.join(tmp, "home");
    const proj = path.join(tmp, "proj");

    const plant = (dir: string, name: string) => {
      fs.mkdirSync(path.join(dir, name), { recursive: true });
      fs.cpSync(TREE_A, path.join(dir, name), { recursive: true });
      return path.join(dir, name);
    };
    const homeClaude = plant(home, path.join(".claude", "skills"));
    const homeAgents = plant(home, path.join(".agents", "skills"));
    const projClaude = plant(proj, path.join(".claude", "skills"));
    const projAgents = plant(proj, path.join(".agents", "skills"));

    const run = async () => {
      const out = capture();
      const code = await contextBillMain([], { cwd: proj, homeDir: home, stdout: out.stream, stderr: out.stream });
      expect(code).toBe(0);
      return out.text().split("\n")[0];
    };

    // .agents/skills is the canonical install path and was invisible pre-fix.
    expect(await run()).toContain(projAgents);
    fs.rmSync(projAgents, { recursive: true, force: true });
    expect(await run()).toContain(projClaude);
    fs.rmSync(projClaude, { recursive: true, force: true });
    expect(await run()).toContain(homeAgents);
    fs.rmSync(homeAgents, { recursive: true, force: true });
    expect(await run()).toContain(homeClaude);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("names every candidate it tried when no tree exists", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "context-bill-none-"));
    const out = capture();
    const code = await contextBillMain([], { cwd: tmp, homeDir: tmp, stdout: out.stream, stderr: out.stream });
    expect(code).toBe(2);
    expect(out.text()).toContain(path.join(tmp, ".agents", "skills"));
    expect(out.text()).toContain(path.join(tmp, ".claude", "skills"));
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe("CLI plumbing", () => {
  it("unknown flag and missing tree are usage errors (exit 2)", async () => {
    const a = capture();
    expect(await contextBillMain(["--nope"], { stdout: a.stream, stderr: a.stream })).toBe(2);
    const b = capture();
    expect(await contextBillMain(["--diff", TREE_A], { stdout: b.stream, stderr: b.stream })).toBe(2);
    const c = capture();
    expect(await contextBillMain([path.join(os.tmpdir(), "does-not-exist-xyz")], { stdout: c.stream, stderr: c.stream })).toBe(1);
  });

  it("bin/gstack-context-bill runs standalone", () => {
    const result = Bun.spawnSync([path.join(ROOT, "bin", "gstack-context-bill"), TREE_A]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString()).toContain("ALWAYS-ON");
  });

  it("gstack context-bill routes through the runtime CLI", async () => {
    const { main } = await import("../runtime/cli.js");
    const out = capture();
    const code = await main(["context-bill", TREE_A], { stdout: out.stream, stderr: out.stream });
    expect(code).toBe(0);
    expect(out.text()).toContain("EAGER (per invocation)");
  });
});
