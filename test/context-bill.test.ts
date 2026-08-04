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
 *   - CONDITIONAL ledger: refs the dispatcher mandates under a stated condition
 *   - TRANSITIVE ledger: what those files pull in on their own, plus the
 *     per-invocation ceiling that sums all three
 *   - LAZY ledger: mode/alias table rows resolved to references/legacy/*.md,
 *     everything those modules order read, orphan (unrouted) module listing
 *   - ROUTE CEILING: per-invocation plus the heaviest mode, the figure an
 *     audited run is measured against
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
  calibrationTable,
  checkBudget,
  contentClass,
  contextBillMain,
  diffBills,
  estimateTokens,
  measureExactTokens,
  renderBill,
  tokenDisclaimer,
  ExactModeError,
  TOKEN_DIVISOR,
  TOKEN_DIVISORS,
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

describe("fast-path ledger (what a trivial ask actually pays)", () => {
  it("bills SKILL.md alone — no forced refs, no modules — and names the paths", () => {
    const tree = treeWithFastPath();
    const alpha = buildBill(tree).skills.find((s) => s.name === "alpha")!;
    expect(alpha.fastPath).toEqual({
      paths: ["Trivial-change fast path"],
      // This fixture's fast-path section names no reference of its own, so the
      // path really is SKILL.md alone. A section that names one pays for it.
      refs: [],
      bytes: alpha.skillMdBytes,
      tokens: alpha.skillMdTokens,
    });
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
    expect(text).toContain("FAST-PATH (trivial ask): SKILL.md + what that path itself binds");
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

/**
 * TREE_A's alpha, plus the two shapes the pre-fix bill could not see: a chain
 * (a conditional reference that orders another file read, which orders a third)
 * and a manifest (a table that maps paths for lookup rather than ordering reads).
 */
function treeWithTransitiveReads(): string {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "context-bill-transitive-"));
  const tree = path.join(tmp, "tree");
  fs.cpSync(TREE_A, tree, { recursive: true });
  const refs = path.join(tree, "alpha", "references");
  fs.appendFileSync(
    path.join(refs, "OPTIONAL.md"),
    "\nRead `references/DEEP.md` in full before continuing.\n",
  );
  fs.writeFileSync(
    path.join(refs, "DEEP.md"),
    `${"d".repeat(9000)}\n\nThen read \`references/support/notes.md\` and \`references/support/tool.ts\`.\n`,
  );
  fs.mkdirSync(path.join(refs, "support"), { recursive: true });
  fs.writeFileSync(path.join(refs, "support", "notes.md"), "n".repeat(3000));
  fs.writeFileSync(path.join(refs, "support", "tool.ts"), "t".repeat(1500));
  // The manifest: rows that MAP old names to current paths. Following them
  // would charge the whole tree on a lookup nobody performed.
  fs.appendFileSync(
    path.join(refs, "CORE.md"),
    "\n| old | new |\n|---|---|\n| `huge.md` | `references/HUGE.md` |\n",
  );
  fs.writeFileSync(path.join(refs, "HUGE.md"), "h".repeat(500000));
  return tree;
}

describe("transitive ledger (what a priced file pulls in on its own)", () => {
  it("prices the chain a conditional reference starts, and names who pulled each file", () => {
    const tree = treeWithTransitiveReads();
    const alpha = buildBill(tree).skills.find((s) => s.name === "alpha")!;
    // The receipted miss: DEEP.md is ordered read by OPTIONAL.md, and its own
    // two support files after that. The dispatcher names none of the three, so
    // a ledger that stops at the dispatcher's sentence billed all of it at zero.
    expect(alpha.transitiveRefs.map((r) => [r.path, r.via])).toEqual([
      ["references/DEEP.md", "references/OPTIONAL.md"],
      ["references/support/notes.md", "references/DEEP.md"],
      // Any extension: a support script a file orders read costs what it costs.
      ["references/support/tool.ts", "references/DEEP.md"],
    ]);
    expect(alpha.transitiveBytes).toBe(
      fileBytes(tree, "alpha", "references", "DEEP.md") +
        fileBytes(tree, "alpha", "references", "support", "notes.md") +
        fileBytes(tree, "alpha", "references", "support", "tool.ts"),
    );
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });

  it("the per-invocation ceiling covers the transitive tier, not just what the dispatcher names", () => {
    const tree = treeWithTransitiveReads();
    const alpha = buildBill(tree).skills.find((s) => s.name === "alpha")!;
    expect(alpha.perInvocationBytes).toBe(
      alpha.eagerBytes + alpha.conditionalBytes + alpha.transitiveBytes,
    );
    // Pre-fix this ceiling stopped at eager + conditional and understated the
    // run by the whole chain. 13.5KB of pulled-in reads is not a rounding error.
    expect(alpha.perInvocationBytes - alpha.eagerBytes - alpha.conditionalBytes).toBeGreaterThan(13000);
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });

  it("does not follow an asset-manifest row, so the bill cannot over-report either", () => {
    const tree = treeWithTransitiveReads();
    const alpha = buildBill(tree).skills.find((s) => s.name === "alpha")!;
    // HUGE.md is 500KB and appears only as a lookup target in CORE.md's mapping
    // table. Charging it would be a 500KB fiction, the same failure mode in the
    // other direction. Nothing reads it, so nothing pays for it.
    expect(alpha.transitiveRefs.some((r) => r.path.includes("HUGE"))).toBe(false);
    expect(alpha.perInvocationBytes).toBeLessThan(100000);
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });

  it("renders the transitive tier separately, with the file that pulled each entry in", () => {
    const tree = treeWithTransitiveReads();
    const text = renderBill(buildBill(tree));
    expect(text).toContain("TRANSITIVE (pulled in by a file above, not named by the dispatcher)");
    expect(text).toContain("pulled in by OPTIONAL.md");
    expect(text).toContain("tool.ts");
    // Reported in its own tier, never folded into the eager floor: the
    // dispatcher did not order these directly and the floor must stay a floor.
    const eager = text.slice(text.indexOf("EAGER ("), text.indexOf("FAST-PATH ("));
    expect(eager).not.toContain("DEEP.md");
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });

  it("bills each pulled-in file once across the whole route, so the ceiling is a sum", () => {
    const tree = treeWithTransitiveReads();
    // A routed module that also orders DEEP.md read. It is already charged
    // upstream, so charging it again would inflate the route ceiling.
    fs.appendFileSync(
      path.join(tree, "alpha", "references", "legacy", "office.md"),
      "\nRead `references/DEEP.md` before the interview.\n",
    );
    const alpha = buildBill(tree).skills.find((s) => s.name === "alpha")!;
    const discovery = alpha.lazy.find((r) => r.label === "Discovery")!;
    expect(discovery.modules.some((m) => m.path === "references/DEEP.md")).toBe(false);
    expect(alpha.routeCeiling!.bytes).toBe(alpha.perInvocationBytes + discovery.bytes);
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });
});

describe("route ceiling (per invocation + the heaviest mode)", () => {
  const bill = buildBill(TREE_A);
  const alpha = bill.skills.find((s) => s.name === "alpha")!;

  it("adds the heaviest routable mode, because a dispatcher exists to route", () => {
    const heaviest = alpha.lazy.reduce((a, b) => (a.bytes >= b.bytes ? a : b));
    expect(alpha.routeCeiling).toEqual({
      label: heaviest.label,
      bytes: alpha.perInvocationBytes + heaviest.bytes,
      tokens: alpha.perInvocationTokens + heaviest.tokens,
    });
    expect(alpha.routeCeiling!.bytes).toBeGreaterThan(alpha.perInvocationBytes);
    expect(bill.totals.routeCeilingBytesBySkill.alpha).toBe(alpha.routeCeiling!.bytes);
  });

  it("falls back to the per-invocation figure when nothing is routed", () => {
    const beta = bill.skills.find((s) => s.name === "beta")!;
    expect(beta.routeCeiling).toBeNull();
    expect(bill.totals.routeCeilingBytesBySkill.beta).toBeNull();
    expect(renderBill(bill)).toContain("nothing routed; the per-invocation ceiling stands");
  });

  it("--budget routeCeiling gates the figure an audited run is measured against", () => {
    const ceiling = Math.round(alpha.routeCeiling!.tokens);
    const perInvocation = Math.round(alpha.perInvocationTokens);
    // The gap the pre-fix budget let through: a tree inside its perInvocation
    // ceiling while every routed run blows past it.
    expect(checkBudget(bill, { perInvocation: { alpha: perInvocation } })).toEqual([]);
    const violations = checkBudget(bill, { routeCeiling: { alpha: perInvocation } });
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ ceiling: "routeCeiling.alpha", actual: ceiling });
    expect(violations[0].files.some((f: string) => f.includes("mode "))).toBe(true);
    expect(checkBudget(bill, { routeCeiling: { alpha: ceiling } })).toEqual([]);
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

describe("token estimate calibration", () => {
  it("uses the corpus-wide divisor for path-less callers, rounded", () => {
    expect(estimateTokens(3900)).toBe(1000);
    expect(estimateTokens(TOKEN_DIVISOR * 2)).toBe(2);
  });

  it("charges each content class its own measured divisor", () => {
    // The defect this closes: one divisor for every class billed legacy
    // specialist modules ~19% under while billing SKILL.md about right.
    expect(contentClass("/x/plan/SKILL.md")).toBe("skillmd");
    expect(contentClass("/x/plan/references/legacy/office.md")).toBe("legacy");
    expect(contentClass("/x/plan/references/RUNTIME.md")).toBe("reference");
    expect(contentClass("/x/plan/references/artifacts/qa/t.md")).toBe("artifact");
    expect(contentClass("/x/plan/SKILL.md#frontmatter")).toBe("frontmatter");
    // Distinct divisors, so identical byte counts in different roles cost differently.
    expect(TOKEN_DIVISORS.legacy).toBeLessThan(TOKEN_DIVISORS.skillmd);
    const bill = buildBill(TREE_A);
    const alpha = bill.skills.find((s) => s.name === "alpha")!;
    const legacyRow = alpha.lazy.find((r) => r.label === "Discovery")!;
    expect(legacyRow.tokens).toBeCloseTo(legacyRow.bytes / TOKEN_DIVISORS.legacy, 6);
    expect(alpha.skillMdTokens).toBeCloseTo(alpha.skillMdBytes / TOKEN_DIVISORS.skillmd, 6);
  });

  it("never claims more precision than it has: no divisor is a measurement", () => {
    // A flat divisor cancels out of any ratio, so a byte-derived percentage
    // reports the same saving regardless of calibration. Token shares must not.
    const bill = buildBill(TREE_A);
    expect(bill.tokenEstimateErrorPct).toBeGreaterThan(0);
    expect(bill.tokenSource).toContain("estimate");
    expect(bill.calibration).toBeUndefined();
  });

  it("names the measured error band rather than a vague 'estimates'", () => {
    const text = tokenDisclaimer(buildBill(TREE_A));
    expect(text).toContain("ESTIMATES");
    expect(text).toMatch(/worst single file 40%/);
    expect(text).toContain("bias under 0.5%");
    expect(text).toContain("--exact");
    expect(text).toContain("Bytes are always exact");
    // An exact bill must not carry the estimate's error band.
    const exactText = tokenDisclaimer({
      tokenEstimateErrorPct: 0,
      tokenSource: "count_tokens (claude-opus-4-5)",
    } as never);
    expect(exactText).toContain("measured with count_tokens");
    expect(exactText).not.toContain("ESTIMATES");
  });
});

describe("rendering", () => {

  it("text output carries every ledger plus flags", () => {
    const text = renderBill(buildBill(TREE_A));
    expect(text).toContain("ALWAYS-ON (every session): 2 skills");
    expect(text).toContain("EAGER (per invocation)");
    expect(text).toContain("FAST-PATH (trivial ask)");
    expect(text).toContain("CONDITIONAL (per invocation, when the stated condition holds)");
    expect(text).toContain("TRANSITIVE (pulled in by a file above, not named by the dispatcher)");
    // "before modules": the figure excludes the LAZY row, and says so, because
    // it gets quoted as if it were the whole run.
    expect(text).toContain("alpha per-invocation ceiling before modules (eager + conditional + transitive)");
    expect(text).toContain("Routed modules add the LAZY row on top.");
    expect(text).toContain("LAZY (per mode/alias)");
    expect(text).toContain("ROUTE CEILING (per invocation + the heaviest mode that dispatcher can route to)");
    expect(text).toContain("frontmatter key(s) the router never reads: triggers");
    expect(text).toContain("foreign-host file in scanner scope: agents.md");
    expect(text).toContain("(unrouted on disk)");
    expect(text).toContain("Token source: estimate");
    expect(text).toContain("Token counts are ESTIMATES");
  });

  it("states the always-on row's exclusion of the host's per-skill wrapper", () => {
    // The row is frontmatter bytes only. Claude Code wraps each skill in its own
    // available_skills XML element, which this tree cannot measure, so the
    // omission is declared rather than silently folded in.
    const text = renderBill(buildBill(TREE_A));
    const alwaysOn = text.slice(text.indexOf("ALWAYS-ON"), text.indexOf("EAGER ("));
    expect(alwaysOn).toContain("excludes the host's per-skill available_skills XML wrapper");
  });

  it("quotes the fast-path saving as a token share, not a byte share", () => {
    // A byte share is divisor-invariant: it prints the same number no matter how
    // the estimate is calibrated, which is how a wrong multiplier hid.
    const tree = treeWithFastPath();
    const text = renderBill(buildBill(tree));
    expect(text).toMatch(/-\d+% of eager tokens/);
    fs.rmSync(path.dirname(tree), { recursive: true, force: true });
  });

  it("--json shape is stable", async () => {
    const out = capture();
    const code = await contextBillMain([TREE_A, "--json"], { stdout: out.stream, stderr: out.stream });
    expect(code).toBe(0);
    const bill = JSON.parse(out.text());
    expect(bill.tokenEstimate).toEqual(TOKEN_DIVISORS);
    expect(bill.tokenEstimateErrorPct).toBe(40);
    expect(Object.keys(bill.totals).sort()).toEqual([
      "alwaysOnBytes",
      "alwaysOnTokens",
      "eagerBytesBySkill",
      "eagerTokensBySkill",
      "fastPathBytesBySkill",
      "fastPathTokensBySkill",
      "lazyBytes",
      "lazyPercent",
      "lazyTokenPercent",
      "lazyTokens",
      "perInvocationBytesBySkill",
      "perInvocationTokensBySkill",
      "routeCeilingBytesBySkill",
      "routeCeilingTokensBySkill",
      "skillCount",
      "totalMdBytes",
      "totalMdTokens",
    ]);
    const skill = bill.skills[0];
    for (const key of ["name", "frontmatterBytes", "frontmatterTokens", "deadKeys", "skillMdBytes", "skillMdTokens", "forcedRefs", "eagerBytes", "eagerTokens", "fastPath", "conditionalRefs", "conditionalBytes", "conditionalTokens", "transitiveRefs", "transitiveBytes", "transitiveTokens", "perInvocationBytes", "perInvocationTokens", "routeCeiling", "lazy", "orphans", "foreignFiles", "totalMdTokens"]) {
      expect(skill).toHaveProperty(key);
    }
    // Every priced entry carries its own token count, so sums never re-derive
    // tokens from a byte total and lose the per-class divisor.
    for (const r of skill.forcedRefs) expect(typeof r.tokens).toBe("number");
    for (const row of skill.lazy) expect(typeof row.tokens).toBe("number");
  });

  it("--skill/--mode simulates a single invocation", async () => {
    const out = capture();
    const code = await contextBillMain([TREE_A, "--skill", "alpha", "--mode", "Discovery"], {
      stdout: out.stream,
      stderr: out.stream,
    });
    expect(code).toBe(0);
    expect(out.text()).toContain('alpha / mode "Discovery" invocation total');
    expect(out.text()).toContain("(eager + conditional + transitive + routed modules)");
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

  it("a read added one level down is growth too (exit 2)", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "context-bill-trans-"));
    const treeB = path.join(tmp, "tree-b");
    fs.cpSync(TREE_A, treeB, { recursive: true });
    // Nothing in SKILL.md changes. A forced reference starts ordering a new
    // heavy file read, which every invocation now pays. Pre-fix the diff was
    // clean and the upgrade looked free.
    fs.writeFileSync(path.join(treeB, "alpha", "references", "PULLED.md"), "x".repeat(38000));
    fs.appendFileSync(
      path.join(treeB, "alpha", "references", "CORE.md"),
      "\nRead `references/PULLED.md` in full.\n",
    );

    const diff = diffBills(buildBill(TREE_A), buildBill(treeB));
    expect(diff.rows.find((r) => r.ledger === "transitive")).toMatchObject({ label: "alpha", delta: 38000 });
    expect(diff.grew).toBe(true);

    const out = capture();
    expect(await contextBillMain(["--diff", TREE_A, treeB], { stdout: out.stream, stderr: out.stream })).toBe(2);
    expect(out.text()).toContain("transitive");
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
  // Read the ceiling off the bill's own token figure. Re-deriving it from bytes
  // would silently re-introduce the flat divisor the budget no longer uses.
  const alphaEagerTok = Math.round(buildBill(TREE_A).skills.find((s) => s.name === "alpha")!.eagerTokens);

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
    const ceiling = Math.round(alpha.perInvocationTokens);
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

describe("--exact (opt-in measurement; offline here via an injected fetch)", () => {
  const ENVELOPE = 7;
  /** Deterministic stand-in for count_tokens: 1 token per 3 chars, plus envelope. */
  function fakeFetch(calls: { body: string }[] = []) {
    return async (_url: string, init: { body: string }) => {
      calls.push({ body: init.body });
      const { messages } = JSON.parse(init.body);
      const text: string = messages[0].content;
      return {
        ok: true,
        json: async () => ({ input_tokens: Math.ceil(text.length / 3) + ENVELOPE }),
      };
    };
  }

  it("subtracts the request envelope so small files are not overcharged", async () => {
    const calls: { body: string }[] = [];
    const measured = await measureExactTokens(TREE_A, {
      model: "test-model",
      apiKey: "sk-test",
      fetchImpl: fakeFetch(calls) as never,
    });
    expect(measured.tokenSource).toBe("count_tokens (test-model)");
    const core = path.join(TREE_A, "alpha", "references", "CORE.md");
    const text = fs.readFileSync(core, "utf8");
    // Content tokens only: the envelope every request pays is not billed to the file.
    expect(measured.tokensOf(core, text.length)).toBe(Math.ceil(text.length / 3));
    // One probe call for the envelope, then one per measured text.
    expect(calls.length).toBe(measured.measuredFiles + 1);
  });

  it("measures the frontmatter block, not the whole SKILL.md, for the always-on row", async () => {
    const measured = await measureExactTokens(TREE_A, {
      model: "m",
      apiKey: "sk-test",
      fetchImpl: fakeFetch() as never,
    });
    const skillMd = path.join(TREE_A, "alpha", "SKILL.md");
    const fmTokens = measured.tokensOf(`${skillMd}#frontmatter`, 0);
    const bodyTokens = measured.tokensOf(skillMd, 0);
    expect(fmTokens).toBeGreaterThan(0);
    expect(fmTokens).toBeLessThan(bodyTokens);
  });

  it("exact tokens replace the estimate everywhere the bill prices content", async () => {
    const measured = await measureExactTokens(TREE_A, {
      model: "m",
      apiKey: "sk-test",
      fetchImpl: fakeFetch() as never,
    });
    const bill = buildBill(TREE_A, { tokensOf: measured.tokensOf, tokenSource: measured.tokenSource });
    const alpha = bill.skills.find((s) => s.name === "alpha")!;
    // Measured content runs ~3 bytes/token here, well off any estimate divisor,
    // so an unconverted path would be obvious. Per-file ceil() adds at most one
    // token per file, hence the small upper slack.
    expect(alpha.eagerTokens).toBeGreaterThanOrEqual(alpha.eagerBytes / 3);
    expect(alpha.eagerTokens).toBeLessThan(alpha.eagerBytes / 3 + 4);
    expect(alpha.eagerTokens / (alpha.eagerBytes / TOKEN_DIVISOR)).toBeGreaterThan(1.2);
    expect(alpha.eagerTokens).toBe(alpha.skillMdTokens + alpha.forcedRefs.reduce((n, r) => n + r.tokens, 0));
    expect(alpha.perInvocationTokens).toBe(alpha.eagerTokens + alpha.conditionalTokens);
    expect(bill.tokenEstimateErrorPct).toBe(0);
    expect(renderBill(bill)).toContain("Token counts measured with count_tokens");
    // Exact figures drop the "~" the estimate wears.
    expect(renderBill(bill)).not.toMatch(/\(~\d/);
  });

  it("measures against a relative root too, instead of silently estimating", async () => {
    // The trap: buildBill resolves its root, so keying measurements by an
    // unresolved path made every lookup miss and quietly fall back to the
    // estimate -- exact mode degrading into the thing it exists to replace,
    // while still labelling itself "measured".
    const relative = path.relative(process.cwd(), TREE_A);
    const measured = await measureExactTokens(relative, {
      model: "m",
      apiKey: "sk-test",
      fetchImpl: fakeFetch() as never,
    });
    const bill = buildBill(relative, { tokensOf: measured.tokensOf, tokenSource: measured.tokenSource });
    for (const s of bill.skills) {
      // The fake meters ~3 bytes/token; any estimate divisor is >= 3.47.
      expect(s.totalMdBytes / s.totalMdTokens).toBeLessThan(3.2);
    }
    expect(bill.totals.alwaysOnBytes / bill.totals.alwaysOnTokens).toBeLessThan(3.2);
    expect(measured.missedKeys.size).toBe(0);
  });

  it("counts anything it could not measure instead of passing it off as measured", async () => {
    const measured = await measureExactTokens(TREE_A, {
      model: "m",
      apiKey: "sk-test",
      fetchImpl: fakeFetch() as never,
    });
    expect(measured.missedKeys.size).toBe(0);
    // An unmeasured key still gets a number, but is recorded as estimated.
    const ghost = path.join(TREE_A, "alpha", "nope.md");
    expect(measured.tokensOf(ghost, 4150)).toBeGreaterThan(0);
    expect(measured.missedKeys.has(ghost)).toBe(true);
  });

  it("grades its own estimate: calibrationTable reports the residual per file", async () => {
    const measured = await measureExactTokens(TREE_A, {
      model: "m",
      apiKey: "sk-test",
      fetchImpl: fakeFetch() as never,
    });
    const table = calibrationTable(measured.counts, TREE_A);
    expect(table.rows.length).toBeGreaterThan(0);
    for (const row of table.rows) {
      expect(row).toHaveProperty("contentClass");
      expect(row.estimatedTokens).toBeGreaterThan(0);
      expect(row.tokens).toBeGreaterThan(0);
      // errorPct must describe estimate-vs-measured, signed.
      expect(row.errorPct).toBeCloseTo(((row.estimatedTokens - row.tokens) / row.tokens) * 100, 1);
    }
    expect(typeof table.worstErrorPct).toBe("number");
    expect(typeof table.biasPct).toBe("number");
  });

  it("refuses to go to the network without a key, and says nothing was sent", async () => {
    let called = false;
    await expect(
      measureExactTokens(TREE_A, {
        model: "m",
        apiKey: "",
        fetchImpl: (() => ((called = true), Promise.reject(new Error("should not run")))) as never,
      }),
    ).rejects.toMatchObject({ code: "exact_missing_api_key" });
    expect(called).toBe(false);
  });

  it("maps HTTP failures to typed codes", async () => {
    const status = (code: number) => async () => ({ ok: false, status: code, text: async () => "nope" });
    for (const [code, expected] of [
      [401, "exact_auth_rejected"],
      [403, "exact_auth_rejected"],
      [500, "exact_request_failed"],
    ] as const) {
      await expect(
        measureExactTokens(TREE_A, { model: "m", apiKey: "k", fetchImpl: status(code) as never }),
      ).rejects.toMatchObject({ code: expected });
    }
    await expect(
      measureExactTokens(TREE_A, {
        model: "m",
        apiKey: "k",
        fetchImpl: (() => Promise.reject(new Error("offline"))) as never,
      }),
    ).rejects.toBeInstanceOf(ExactModeError);
  });

  it("offline by default: no --exact means no network call at all", async () => {
    const out = capture();
    let called = false;
    const code = await contextBillMain([TREE_A, "--json"], {
      stdout: out.stream,
      stderr: out.stream,
      fetchImpl: (() => ((called = true), Promise.reject(new Error("no")))) as never,
      apiKey: "sk-test",
    } as never);
    expect(code).toBe(0);
    expect(called).toBe(false);
    expect(JSON.parse(out.text()).tokenSource).toContain("estimate");
  });

  it("discloses what --exact sends before sending it", async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await contextBillMain([TREE_A, "--exact", "--json"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      apiKey: "sk-test",
      fetchImpl: fakeFetch() as never,
    } as never);
    expect(code).toBe(0);
    expect(stderr.text()).toContain("api.anthropic.com");
    expect(stderr.text()).toMatch(/sending the content of \d+ \.md file\(s\)/);
    const bill = JSON.parse(stdout.text());
    expect(bill.tokenSource).toContain("count_tokens");
    expect(bill.calibration.rows.length).toBeGreaterThan(0);
  });

  it("degrades to the estimate when exact mode is unavailable, naming the code", async () => {
    const stdout = capture();
    const stderr = capture();
    const code = await contextBillMain([TREE_A, "--exact", "--json"], {
      stdout: stdout.stream,
      stderr: stderr.stream,
      apiKey: "",
      fetchImpl: (() => Promise.reject(new Error("should not run"))) as never,
    } as never);
    // A missing key is not a crash: the offline estimate still answers.
    expect(code).toBe(0);
    expect(stderr.text()).toContain("exact_missing_api_key");
    expect(JSON.parse(stdout.text()).tokenSource).toContain("estimate");
  });
});

describe("ground-truth cross-check against the real skills/ tree", () => {
  const SKILLS = path.join(ROOT, "skills");

  it("plan's forced-read set is the always-binding pair, not the old triad", () => {
    // EXECUTION-PROFILES.md moved to conditional on measured grounds: it infers
    // depth, which a stated depth or a fast path already answers, so charging
    // ~751 tok for it on every invocation of every skill bought nothing. It is
    // still read, just when the condition holds. SHARED-JUDGMENT and
    // AUTHORITY-POLICY stay forced because they bind every run: evidence for
    // claims, no fabrication, untrusted input, approval before merge or deploy.
    const bill = buildBill(SKILLS);
    const plan = bill.skills.find((s) => s.name === "plan")!;
    expect(plan.forcedRefs.map((r) => r.path)).toEqual([
      "references/SHARED-JUDGMENT.md",
      "references/AUTHORITY-POLICY.md",
    ]);
    // Not merely absent from forced: it must still be reachable.
    expect(plan.conditionalRefs.map((r) => r.path)).toContain("references/EXECUTION-PROFILES.md");
    const wc =
      fileBytes(SKILLS, "plan", "SKILL.md") +
      fileBytes(SKILLS, "plan", "references", "SHARED-JUDGMENT.md") +
      fileBytes(SKILLS, "plan", "references", "AUTHORITY-POLICY.md");
    expect(plan.eagerBytes).toBe(wc);
  });

  it("every plan legacy module on disk is routed by a table (no orphans, no phantoms)", () => {
    const plan = buildBill(SKILLS).skills.find((s) => s.name === "plan")!;
    expect(plan.orphans).toEqual([]);
    for (const row of plan.lazy) for (const m of row.modules) expect(m.missing).toBe(false);
    const routed = new Set(
      plan.lazy.flatMap((r) =>
        r.modules.filter((m) => m.path.startsWith("references/legacy/")).map((m) => path.basename(m.path)),
      ),
    );
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

  it("every dispatcher's trivial path drops the forced refs; make-pdf has no fast path", () => {
    const bill = buildBill(SKILLS);
    // The always-binding pair. EXECUTION-PROFILES.md is conditional now, so it
    // is not part of what a trivial ask drops: it was never charged to it.
    const forced =
      fileBytes(SKILLS, "plan", "references", "SHARED-JUDGMENT.md") +
      fileBytes(SKILLS, "plan", "references", "AUTHORITY-POLICY.md");
    for (const name of ["plan", "qa", "debug", "review", "ship"]) {
      const s = bill.skills.find((x) => x.name === name)!;
      // The overstatement this closes: forced refs charged to a
      // trivial ask that the dispatcher explicitly tells the agent to skip.
      expect(s.fastPath).not.toBeNull();
      expect(s.fastPath!.bytes).toBe(s.skillMdBytes + s.fastPath!.refs.reduce((n, r) => n + r.bytes, 0));
      expect(s.fastPath!.bytes - s.skillMdBytes).toBeGreaterThan(0); // every one binds FAST-PATH.md
      expect(s.eagerBytes - s.skillMdBytes).toBe(forced);
      expect(s.fastPath!.paths.some((p) => /fast path$/.test(p))).toBe(true);
    }
    expect(bill.skills.find((s) => s.name === "plan")!.fastPath!.paths).toEqual([
      "Empty-target fast path",
      "Trivial-change fast path",
    ]);
    // A tool skill, not a dispatcher: no fast path, so its eager row stands.
    expect(bill.skills.find((s) => s.name === "make-pdf")!.fastPath).toBeNull();
  });

  /**
   * The bill's own numbers are what people quote as evidence, so every printed
   * figure has to cover every file the route's own prose orders read. Derived
   * here straight from the prose, independently of the implementation.
   */
  it("every printed route figure covers every file that route's own prose calls binding", () => {
    const bill = buildBill(SKILLS);
    const printed = renderBill(bill);
    // Files a module's prose orders read as part of running the route: the
    // package-local sections/ phases and artifacts/, transitively.
    const bindings = (skillDir: string, rel: string, seen = new Set<string>()): string[] => {
      if (seen.has(rel) || !fs.existsSync(path.join(skillDir, rel))) return [];
      seen.add(rel);
      const text = fs.readFileSync(path.join(skillDir, rel), "utf8");
      const named = [...text.matchAll(/`(references\/(?:sections|artifacts)\/[^`]+\.md)`/g)].map((m) => m[1]);
      return [...new Set(named)].flatMap((p) => [p, ...bindings(skillDir, p, seen)]);
    };

    let checkedSections = 0;
    for (const s of bill.skills) {
      for (const row of s.lazy) {
        const billed = new Set(row.modules.map((m) => m.path));
        const mandatory = new Set(
          row.modules
            .filter((m) => m.path.startsWith("references/legacy/"))
            .flatMap((m) => bindings(s.dir, m.path)),
        );
        // Receipted miss before this pin: ship/Prepare priced legacy/ship.md and
        // none of the eight sections/ship/*.md phases it orders read, so the
        // route's biggest reads were absent from the row entirely.
        const row_ = `${s.name} / ${row.label}`;
        expect({ row: row_, unbilled: [...mandatory].filter((p) => !billed.has(p)) }).toEqual({
          row: row_,
          unbilled: [],
        });
        checkedSections += [...mandatory].filter((p) => p.startsWith("references/sections/")).length;
        const floor = [...mandatory].reduce((n, p) => n + fileBytes(s.dir, p), 0);
        expect(row.bytes).toBeGreaterThanOrEqual(floor);
      }
      // The printed fast-path figure covers the reference that path binds, and
      // the render names it so the number is auditable from the output alone.
      if (s.fastPath) {
        const bound = s.fastPath.refs.reduce((n, r) => n + r.bytes, 0);
        expect(s.fastPath.bytes).toBe(s.skillMdBytes + bound);
        for (const r of s.fastPath.refs) expect(printed).toContain(path.basename(r.path));
        if (bound > 0) expect(printed).toContain("+ binds");
      }
    }
    // Guards the guard: a closure that silently resolved nothing would pass every
    // assertion above. The real tree routes sections from seven legacy modules.
    expect(checkedSections).toBeGreaterThan(10);
  });

  it("no references/sections file is priced by nothing (the 276KB the bill used to omit)", () => {
    const bill = buildBill(SKILLS);
    for (const s of bill.skills) {
      const dir = path.join(s.dir, "references", "sections");
      if (!fs.existsSync(dir)) continue;
      const priced = new Set([
        ...s.lazy.flatMap((r) => r.modules.map((m) => m.path)),
        ...s.orphans.map((o) => o.path),
      ]);
      const onDisk = (fs.readdirSync(dir, { recursive: true }) as string[])
        .filter((p) => p.endsWith(".md"))
        .map((p) => path.join("references", "sections", p));
      expect(onDisk.length).toBeGreaterThan(0);
      expect(onDisk.filter((p) => !priced.has(p))).toEqual([]);
    }
  });

  /**
   * The defect this closes, in the form it was caught: an audited /plan
   * Engineering run read eight files totalling ~102KB, which was 56% over the
   * ceiling the tool printed. The cause was structural, not arithmetic — the
   * sections file the Engineering module orders read, and everything the
   * conditional references pull in, were priced by no ledger at all. Byte
   * literals would rot as the tree changes, so the file set is rebuilt from
   * disk and the ceiling has to cover it.
   */
  it("plan's printed ceiling covers every file a real Engineering run reads", () => {
    const plan = buildBill(SKILLS).skills.find((s) => s.name === "plan")!;
    const dir = path.join(SKILLS, "plan");
    const engineering = plan.lazy.find((r) => r.label === "Engineering")!;
    // What the run reads: SKILL.md, the forced triad, the question format it
    // must load before asking, the routed module, and what that module orders.
    const run = [
      "SKILL.md",
      ...plan.forcedRefs.map((r) => r.path),
      "references/QUESTION-FORMAT.md",
      ...engineering.modules.map((m) => m.path),
    ];
    const runBytes = [...new Set(run)].reduce((n, p) => n + fileBytes(dir, p), 0);
    const routeBytes = plan.perInvocationBytes + engineering.bytes;
    expect(runBytes).toBeGreaterThan(80000); // the run is genuinely this heavy
    expect(routeBytes).toBeGreaterThanOrEqual(runBytes);
    // A ceiling that a real run exceeds is not a ceiling. Pre-fix this compared
    // ~67KB against ~102KB.
    expect(plan.routeCeiling!.bytes).toBeGreaterThanOrEqual(runBytes);
    expect(renderBill(buildBill(SKILLS), { skill: "plan" })).toContain("ROUTE CEILING");
  });

  it("every dispatcher prices what its own references pull in", () => {
    const bill = buildBill(SKILLS);
    for (const name of ["plan", "qa", "debug", "review", "ship"]) {
      const s = bill.skills.find((x) => x.name === name)!;
      const pulled = s.transitiveRefs.map((r) => path.basename(r.path));
      // Receipted misses: RUNTIME.md orders BROWSER-PROVIDERS.md read and
      // QUESTION-FORMAT.md orders the two AskUserQuestion docs. The dispatcher
      // names none of them, so every one was billed at zero.
      expect(pulled).toContain("BROWSER-PROVIDERS.md");
      expect(pulled).toContain("askuserquestion-split.md");
      for (const r of s.transitiveRefs) {
        expect(r.missing).toBe(false);
        expect(r.via).toBeTruthy();
      }
      // No file is charged twice across the three per-invocation tiers.
      const all = [...s.forcedRefs, ...s.conditionalRefs, ...s.transitiveRefs].map((r) => r.path);
      expect(all.length).toBe(new Set(all).size);
    }
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
