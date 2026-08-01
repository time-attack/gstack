/**
 * gstack context-bill — token bill-of-materials for an installed gstack skills tree.
 *
 * Read-only, offline, deterministic. Four ledgers over pure file reads:
 *   ALWAYS-ON  per-skill YAML frontmatter bytes (what every session's skill
 *              scanner loads), flagging frontmatter keys the router never
 *              reads (#2286) and foreign-host files in scanner scope (#1694).
 *   EAGER      SKILL.md + the forced-read references the dispatch protocol
 *              mandates "for every invocation" (the shared triad).
 *   FAST-PATH  what a trivial ask costs when the dispatcher's fast path
 *              explicitly overrides that forced-read step: SKILL.md alone, no
 *              forced refs, no modules. Reported next to EAGER so the eager
 *              number is not mistaken for the floor of every invocation.
 *   CONDITIONAL the references the dispatcher mandates under a stated condition
 *              (QUESTION-FORMAT before the first question, RUNTIME before
 *              capability work, CODE-INTELLIGENCE once per repo target, ...).
 *              Most real invocations hit several, so an EAGER-only number
 *              understates what an invocation actually pays. The per-invocation
 *              ceiling (eager + conditional) is reported alongside.
 *   LAZY       per mode/alias table row, which references/legacy/*.md modules
 *              activate and what each costs.
 *
 * Token figures come from one of two sources, always named in the output:
 *   ESTIMATE (default, offline)  bytes / TOKEN_DIVISOR, calibrated against real
 *                               count_tokens measurements of this repo's files.
 *   EXACT (--exact, opt-in)      Anthropic's count_tokens for every file the
 *                               bill touches. Sends file content off-machine,
 *                               so it is never implicit.
 * Both bytes and tokens are always shown, and the estimate's measured error band
 * is printed with it. The tool never writes state anywhere.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const FORCED_PHRASE = "for every invocation";
const LEGACY_REF = /references\/legacy\/[^`|)\s]+\.md/g;
// Backticked non-legacy reference in prose. Legacy modules belong to LAZY.
const PROSE_REF = /`(references\/(?!legacy\/)[^`]+\.md)`/g;
// A dispatcher that says its fast path overrides the forced-read step pays
// SKILL.md alone on that path. Named paths come from the section headings.
const FAST_PATH_OVERRIDE = /fast paths? overrides? this step/i;
const FAST_PATH_HEADING = /^#{2,}\s+(\S.*? fast path)\s*$/i;
const ROUTER_KEYS = new Set(["name", "description"]);
// Skill-shaped files other hosts drop into scanner scope (#1694).
const FOREIGN_SKILL_FILE = /^(skill\.(ya?ml|json)|agents?\.md|\.cursorrules|\.windsurfrules)$/i;

/**
 * Bytes per token, per content class, fitted to real count_tokens measurements.
 *
 * Calibration corpus: all 219 `.md` files in this repo's `skills/` tree plus the
 * six frontmatter blocks, measured 2026-08-01 against `claude-opus-4-5` with the
 * per-request message envelope subtracted. Regenerate with
 * `gstack context-bill <tree> --exact --json` and read the `calibration` block,
 * which grades this estimate against measured counts file by file.
 *
 * Why classes and not one divisor: measured bytes-per-token spans 2.36 to 4.72
 * across the tree, and the spread is largely structural. Legacy specialist
 * modules cluster at 3.47 (n=50, range 3.10-3.83) and SKILL.md bodies at 4.21
 * (n=50, range 3.65-4.50) -- tight enough that one divisor for both charges the
 * LAZY ledger about 19% under while charging EAGER about right. Splitting on the
 * path roles this file already understands cuts mean per-file error from 11.1%
 * to 7.4% and removes the systematic bias, which is what a cost tool owes.
 *
 * What classes do NOT fix: the `reference` class is genuinely heterogeneous
 * (2.36 to 4.72 -- dense path/table files like ASSETS.md sit at one end, prose
 * at the other), so worst-case per-file error stays near 40%. Use --exact when a
 * single file's number has to be right.
 *
 * These divisors are tokenizer-specific. Opus 4.7 and later tokenize
 * differently; on those models use --exact.
 */
export const TOKEN_DIVISORS = {
  frontmatter: 3.99,
  skillmd: 4.21,
  reference: 4.15,
  artifact: 3.67,
  legacy: 3.47,
};
/** Fallback for content that matches no class. Corpus-wide aggregate. */
export const TOKEN_DIVISOR = 3.9;
/** Worst-case per-file residual of the estimate over the calibration corpus. */
export const TOKEN_ESTIMATE_ERROR_PCT = 40;

/**
 * Content class from the path role. These roles are already load-bearing in this
 * file (legacy modules are the LAZY ledger, artifacts are never routed prose),
 * so the split adds no new convention.
 */
export function contentClass(key) {
  if (key.endsWith("#frontmatter")) return "frontmatter";
  if (/references[/\\]legacy[/\\]/.test(key)) return "legacy";
  if (/references[/\\](artifacts|sections|support)[/\\]/.test(key)) return "artifact";
  if (/(^|[/\\])SKILL\.md$/.test(key)) return "skillmd";
  if (/references[/\\]/.test(key)) return "reference";
  return "other";
}

/** Path-less callers get the corpus-wide aggregate divisor. */
export function estimateTokens(bytes) {
  return Math.round(bytes / TOKEN_DIVISOR);
}

/** Default token source: the calibrated offline estimate. Unrounded, so sums round once. */
function estimateTokensOf(key, bytes) {
  return bytes / (TOKEN_DIVISORS[contentClass(key)] ?? TOKEN_DIVISOR);
}

function bytesOf(file) {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

function refEntry(skillDir, rel, tokensOf) {
  const abs = path.join(skillDir, rel);
  const bytes = bytesOf(abs);
  return {
    path: rel,
    bytes: bytes ?? 0,
    tokens: bytes == null ? 0 : tokensOf(abs, bytes),
    missing: bytes == null,
  };
}

function sumBytes(entries) {
  return entries.reduce((n, e) => n + e.bytes, 0);
}

function sumTokens(entries) {
  return entries.reduce((n, e) => n + e.tokens, 0);
}

/** The dispatcher's own words for when a conditional read fires, trimmed to one line. */
function conditionOf(clause) {
  const text = clause
    // Basename, not stripped: a clause mandating two references ("RUNTIME
    // before capability work and WEB-CONTEXT before public-web work") reads
    // wrong once the paths are gone.
    .replace(PROSE_REF, (_m, p) => path.basename(p))
    .replace(/^\s*\d+\.\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 96 ? `${text.slice(0, 93)}...` : text;
}

/** Cache key for a SKILL.md's frontmatter block, which is a slice, not a whole file. */
function frontmatterKey(skillMdPath) {
  return `${skillMdPath}#frontmatter`;
}

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { bytes: 0, keys: [], block: "" };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { bytes: 0, keys: [], block: "" };
  const closeEol = text.indexOf("\n", end + 1);
  const block = text.slice(0, closeEol === -1 ? text.length : closeEol + 1);
  const inner = text.slice(text.indexOf("\n") + 1, end);
  const keys = [];
  for (const line of inner.split("\n")) {
    const m = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (m) keys.push(m[1]);
  }
  return { bytes: Buffer.byteLength(block, "utf8"), keys, block };
}

/** Every .md file under a tree, for the on-disk total and for exact measurement. */
export function walkMd(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkMd(p));
    else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
  }
  return out;
}

function totalMd(dir, tokensOf) {
  let bytes = 0;
  let tokens = 0;
  for (const p of walkMd(dir)) {
    const b = bytesOf(p) ?? 0;
    bytes += b;
    tokens += tokensOf(p, b);
  }
  return { bytes, tokens };
}

export function parseSkill(skillDir, name, tokensOf = estimateTokensOf) {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const text = fs.readFileSync(skillMdPath, "utf8");
  const skillMdBytes = bytesOf(skillMdPath) ?? 0;
  const skillMdTokens = tokensOf(skillMdPath, skillMdBytes);
  const fm = parseFrontmatter(text);
  // The frontmatter block is a slice of SKILL.md, so it carries its own key.
  const frontmatterTokens = tokensOf(frontmatterKey(skillMdPath), fm.bytes);
  const deadKeys = fm.keys.filter((k) => !ROUTER_KEYS.has(k));

  // Every prose clause outside a routing table, paired with the references it
  // mandates. A clause carrying "for every invocation" is EAGER; any other
  // clause that mandates a reference is CONDITIONAL — real, just gated.
  const clauses = [];
  let fastPathOverrides = false;
  const fastPathNames = [];
  for (const line of text.split("\n")) {
    if (line.includes(FORCED_PHRASE) && FAST_PATH_OVERRIDE.test(line)) fastPathOverrides = true;
    const heading = FAST_PATH_HEADING.exec(line.trim());
    if (heading) fastPathNames.push(heading[1]);
    if (line.trim().startsWith("|")) continue; // routing tables are LAZY
    for (const clause of line.split(/(?<=[.;])\s+/)) {
      const paths = [...new Set([...clause.matchAll(PROSE_REF)].map((m) => m[1]))];
      if (paths.length) clauses.push({ clause, paths });
    }
  }

  // EAGER: the forced-read triad ("for every invocation" — parity-pinned phrasing).
  const forcedRefs = [];
  const seenForced = new Set();
  for (const { clause, paths } of clauses) {
    if (!clause.includes(FORCED_PHRASE)) continue;
    for (const p of paths) {
      if (seenForced.has(p)) continue;
      seenForced.add(p);
      forcedRefs.push(refEntry(skillDir, p, tokensOf));
    }
  }

  // CONDITIONAL: mandated under a stated condition. The condition text comes
  // from the dispatcher's own clause so the reader can judge how often it fires.
  const conditionalRefs = [];
  const seenConditional = new Set();
  for (const { clause, paths } of clauses) {
    if (clause.includes(FORCED_PHRASE)) continue;
    for (const p of paths) {
      if (seenForced.has(p) || seenConditional.has(p)) continue;
      seenConditional.add(p);
      conditionalRefs.push({ ...refEntry(skillDir, p, tokensOf), condition: conditionOf(clause) });
    }
  }

  // LAZY: markdown table rows whose cells route to references/legacy/*.md.
  const lazy = [];
  const routed = new Set();
  for (const line of text.split("\n")) {
    const row = line.trim();
    if (!row.startsWith("|")) continue;
    const modulePaths = [...new Set([...row.matchAll(LEGACY_REF)].map((m) => m[0]))];
    if (modulePaths.length === 0) continue;
    const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
    const label = (cells[0] ?? "").replace(/`/g, "") || "(unnamed row)";
    const modules = modulePaths.map((p) => refEntry(skillDir, p, tokensOf));
    for (const p of modulePaths) routed.add(p);
    lazy.push({ label, modules, bytes: sumBytes(modules), tokens: sumTokens(modules) });
  }

  // Legacy modules on disk that no table routes to (orphans).
  const legacyDir = path.join(skillDir, "references", "legacy");
  let orphans = [];
  try {
    orphans = fs
      .readdirSync(legacyDir)
      .filter((f) => f.endsWith(".md") && !routed.has(`references/legacy/${f}`))
      .sort()
      .map((f) => refEntry(skillDir, `references/legacy/${f}`, tokensOf));
  } catch {
    // no legacy dir — nothing lazy on disk
  }

  // Foreign-host skill files sitting next to SKILL.md (#1694).
  const foreignFiles = [];
  for (const entry of fs.readdirSync(skillDir, { withFileTypes: true })) {
    if (entry.isFile() && FOREIGN_SKILL_FILE.test(entry.name)) {
      const abs = path.join(skillDir, entry.name);
      const bytes = bytesOf(abs) ?? 0;
      foreignFiles.push({ path: entry.name, bytes, tokens: tokensOf(abs, bytes) });
    }
  }

  const total = totalMd(skillDir, tokensOf);
  return {
    name,
    dir: skillDir,
    frontmatterBytes: fm.bytes,
    frontmatterTokens,
    frontmatterKeys: fm.keys,
    deadKeys,
    skillMdBytes,
    skillMdTokens,
    forcedRefs,
    eagerBytes: skillMdBytes + sumBytes(forcedRefs),
    eagerTokens: skillMdTokens + sumTokens(forcedRefs),
    // What a trivial ask pays: SKILL.md only. null when no fast path overrides
    // the forced-read step, i.e. every invocation really does pay the eager row.
    fastPath: fastPathOverrides
      ? { paths: fastPathNames, bytes: skillMdBytes, tokens: skillMdTokens }
      : null,
    conditionalRefs,
    conditionalBytes: sumBytes(conditionalRefs),
    conditionalTokens: sumTokens(conditionalRefs),
    // What an invocation that hits every stated condition actually pays.
    perInvocationBytes: skillMdBytes + sumBytes(forcedRefs) + sumBytes(conditionalRefs),
    perInvocationTokens: skillMdTokens + sumTokens(forcedRefs) + sumTokens(conditionalRefs),
    lazy,
    orphans,
    foreignFiles,
    totalMdBytes: total.bytes,
    totalMdTokens: total.tokens,
  };
}

function findSkillDirs(root) {
  const out = [];
  (function walk(dir) {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.isFile() && e.name === "SKILL.md")) {
      out.push(dir);
      return; // a skill's own subtree (references/, agents/) is not another skill
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
      walk(path.join(dir, e.name));
    }
  })(root);
  return out.sort();
}

export function buildBill(root, { tokensOf = estimateTokensOf, tokenSource, calibration } = {}) {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) throw new Error(`No such tree: ${resolved}`);
  const skills = findSkillDirs(resolved).map((dir) =>
    parseSkill(dir, path.relative(resolved, dir) || path.basename(resolved), tokensOf),
  );
  // Unique per skill: a module routed by two mode rows is paid for once.
  const uniqueLazy = (s) => {
    const unique = new Map();
    for (const row of s.lazy) for (const m of row.modules) unique.set(m.path, m);
    for (const o of s.orphans) unique.set(o.path, o);
    return [...unique.values()];
  };
  const lazyBytes = skills.reduce((n, s) => n + sumBytes(uniqueLazy(s)), 0);
  const lazyTokens = skills.reduce((n, s) => n + sumTokens(uniqueLazy(s)), 0);
  const total = skills.reduce((n, s) => n + s.totalMdBytes, 0);
  const totalTokens = skills.reduce((n, s) => n + s.totalMdTokens, 0);
  return {
    root: resolved,
    // Named so a reader never has to guess whether a figure was measured.
    tokenSource: tokenSource ?? "estimate: calibrated bytes/token per content class",
    tokenEstimate: TOKEN_DIVISORS,
    tokenEstimateErrorPct: tokenSource ? 0 : TOKEN_ESTIMATE_ERROR_PCT,
    // Present only under --exact: how far the offline estimate was off, per file.
    ...(calibration ? { calibration } : {}),
    skills,
    totals: {
      skillCount: skills.length,
      alwaysOnBytes: skills.reduce((n, s) => n + s.frontmatterBytes, 0),
      alwaysOnTokens: skills.reduce((n, s) => n + s.frontmatterTokens, 0),
      eagerBytesBySkill: Object.fromEntries(skills.map((s) => [s.name, s.eagerBytes])),
      eagerTokensBySkill: Object.fromEntries(skills.map((s) => [s.name, Math.round(s.eagerTokens)])),
      fastPathBytesBySkill: Object.fromEntries(skills.map((s) => [s.name, s.fastPath?.bytes ?? null])),
      fastPathTokensBySkill: Object.fromEntries(
        skills.map((s) => [s.name, s.fastPath ? Math.round(s.fastPath.tokens) : null]),
      ),
      perInvocationBytesBySkill: Object.fromEntries(skills.map((s) => [s.name, s.perInvocationBytes])),
      perInvocationTokensBySkill: Object.fromEntries(
        skills.map((s) => [s.name, Math.round(s.perInvocationTokens)]),
      ),
      lazyBytes,
      lazyTokens,
      totalMdBytes: total,
      totalMdTokens: totalTokens,
      lazyPercent: total ? Math.round((lazyBytes / total) * 100) : 0,
      // Token share, not byte share: the two differ because content classes
      // tokenise differently, which is exactly what a byte percentage hides.
      lazyTokenPercent: totalTokens ? Math.round((lazyTokens / totalTokens) * 100) : 0,
    },
  };
}

export function diffBills(a, b) {
  const rows = [];
  const push = (ledger, label, before, after, tokBefore, tokAfter) => {
    if (before !== after) {
      rows.push({
        ledger,
        label,
        before,
        after,
        delta: after - before,
        tokenDelta: Math.round(tokAfter - tokBefore),
      });
    }
  };
  const skillNames = [...new Set([...a.skills, ...b.skills].map((s) => s.name))].sort();
  for (const name of skillNames) {
    const sa = a.skills.find((s) => s.name === name);
    const sb = b.skills.find((s) => s.name === name);
    push(
      "always-on", name,
      sa?.frontmatterBytes ?? 0, sb?.frontmatterBytes ?? 0,
      sa?.frontmatterTokens ?? 0, sb?.frontmatterTokens ?? 0,
    );
    push("eager", name, sa?.eagerBytes ?? 0, sb?.eagerBytes ?? 0, sa?.eagerTokens ?? 0, sb?.eagerTokens ?? 0);
    push(
      "conditional", name,
      sa?.conditionalBytes ?? 0, sb?.conditionalBytes ?? 0,
      sa?.conditionalTokens ?? 0, sb?.conditionalTokens ?? 0,
    );
    const labels = [...new Set([...(sa?.lazy ?? []), ...(sb?.lazy ?? [])].map((r) => r.label))];
    for (const label of labels) {
      const ra = sa?.lazy.find((r) => r.label === label);
      const rb = sb?.lazy.find((r) => r.label === label);
      push("lazy", `${name} / ${label}`, ra?.bytes ?? 0, rb?.bytes ?? 0, ra?.tokens ?? 0, rb?.tokens ?? 0);
    }
  }
  rows.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
  const grew =
    b.totals.alwaysOnBytes > a.totals.alwaysOnBytes ||
    rows.some((r) => (r.ledger === "eager" || r.ledger === "conditional") && r.delta > 0);
  return { rows, grew };
}

/**
 * Budget file: user-authored plain JSON, ceilings in ~tokens.
 *   { "alwaysOnTotal": 4000, "eagerPerInvocation": { "plan": 5000 },
 *     "perInvocation": { "plan": 9000 } }
 * `eagerPerInvocation` gates the forced-read floor; `perInvocation` gates the
 * eager + conditional ceiling, which is what a real invocation pays.
 */
export function checkBudget(bill, budget) {
  const violations = [];
  if (typeof budget.alwaysOnTotal === "number") {
    const actual = Math.round(bill.totals.alwaysOnTokens);
    if (actual > budget.alwaysOnTotal) {
      violations.push({
        ceiling: "alwaysOnTotal",
        limit: budget.alwaysOnTotal,
        actual,
        files: bill.skills.map((s) => `${s.name}/SKILL.md (frontmatter ${s.frontmatterBytes}B)`),
      });
    }
  }
  for (const key of ["eagerPerInvocation", "perInvocation"]) {
    const withConditional = key === "perInvocation";
    for (const [name, limit] of Object.entries(budget[key] ?? {})) {
      const skill = bill.skills.find((s) => s.name === name);
      if (!skill) {
        violations.push({ ceiling: `${key}.${name}`, limit, actual: null, files: ["<skill not found in tree>"] });
        continue;
      }
      const actual = Math.round(withConditional ? skill.perInvocationTokens : skill.eagerTokens);
      if (actual > limit) {
        violations.push({
          ceiling: `${key}.${name}`,
          limit,
          actual,
          files: [
            `${skill.name}/SKILL.md (${skill.skillMdBytes}B)`,
            ...skill.forcedRefs.map((r) => `${skill.name}/${r.path} (${r.bytes}B)`),
            ...(withConditional
              ? skill.conditionalRefs.map((r) => `${skill.name}/${r.path} (${r.bytes}B, conditional)`)
              : []),
          ],
        });
      }
    }
  }
  return violations;
}

function fmtBytes(b) {
  if (b >= 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)}MB`;
  if (b >= 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${b}B`;
}

/** Exact counts are measurements, so they lose the "~" the estimate wears. */
function fmtTok(tokens, exact) {
  const t = Math.round(tokens);
  const tilde = exact ? "" : "~";
  return t >= 1000 ? `${tilde}${(t / 1000).toFixed(1)}K tok` : `${tilde}${t} tok`;
}

export function renderBill(bill, { skill, mode } = {}) {
  const skills = skill ? bill.skills.filter((s) => s.name === skill) : bill.skills;
  const exact = bill.tokenEstimateErrorPct === 0;
  const size = (bytes, tokens) => `${fmtBytes(bytes)} (${fmtTok(tokens, exact)})`;
  const lines = [`Context bill for ${bill.root}`, `Token source: ${bill.tokenSource}`, ""];

  lines.push(
    `ALWAYS-ON (every session): ${skills.length} skills, ` +
      `${size(skills.reduce((n, s) => n + s.frontmatterBytes, 0), skills.reduce((n, s) => n + s.frontmatterTokens, 0))}`,
  );
  // The host wraps each skill's frontmatter in its own available_skills XML
  // element before the model sees it. That wrapper is host-specific and cannot
  // be read from this tree, so it is excluded here — the real always-on cost is
  // this figure plus one wrapper per skill.
  lines.push("  (frontmatter only; excludes the host's per-skill available_skills XML wrapper)");
  for (const s of skills) lines.push(`  ${s.name.padEnd(12)} ${size(s.frontmatterBytes, s.frontmatterTokens)}`);
  for (const s of skills) {
    if (s.deadKeys.length) lines.push(`  ! ${s.name}: frontmatter key(s) the router never reads: ${s.deadKeys.join(", ")}`);
    for (const f of s.foreignFiles) lines.push(`  ! ${s.name}: foreign-host file in scanner scope: ${f.path} (${size(f.bytes, f.tokens)})`);
  }
  lines.push("");

  lines.push("EAGER (per invocation): SKILL.md + forced-read references");
  for (const s of skills) {
    const refs = s.forcedRefs.length
      ? ` = SKILL.md ${fmtBytes(s.skillMdBytes)} + refs ${fmtBytes(sumBytes(s.forcedRefs))} (${s.forcedRefs.map((r) => path.basename(r.path)).join(", ")})`
      : "";
    lines.push(`  ${s.name.padEnd(12)} ${size(s.eagerBytes, s.eagerTokens)}${refs}`);
    for (const r of s.forcedRefs.filter((r) => r.missing)) lines.push(`  ! ${s.name}: forced-read reference missing on disk: ${r.path}`);
  }
  lines.push("");

  lines.push("FAST-PATH (trivial ask): SKILL.md only, no forced refs, no modules");
  for (const s of skills) {
    if (!s.fastPath) {
      lines.push(`  ${s.name.padEnd(12)} none (no fast path overrides the forced reads; a trivial ask pays the eager row)`);
      continue;
    }
    const saved = s.eagerBytes - s.fastPath.bytes;
    const savedTokens = s.eagerTokens - s.fastPath.tokens;
    // The saving is quoted as a share of tokens, not of bytes. A byte share is
    // divisor-invariant, so it silently reports the same number however the
    // estimate is calibrated, even though references and SKILL.md bodies
    // tokenise at different rates.
    const pct = s.eagerTokens ? Math.round((savedTokens / s.eagerTokens) * 100) : 0;
    lines.push(
      `  ${s.name.padEnd(12)} ${size(s.fastPath.bytes, s.fastPath.tokens)}` +
        `, ${saved > 0 ? `-${size(saved, savedTokens)} vs eager (-${pct}% of eager tokens)` : "same as eager"}` +
        `  [${s.fastPath.paths.join(", ") || "fast path"}]`,
    );
  }
  lines.push("");

  lines.push("CONDITIONAL (per invocation, when the stated condition holds)");
  for (const s of skills) {
    if (!s.conditionalRefs.length) {
      lines.push(`  ${s.name.padEnd(12)} none`);
      continue;
    }
    lines.push(`  ${s.name.padEnd(12)} +${size(s.conditionalBytes, s.conditionalTokens)} across ${s.conditionalRefs.length} reference(s)`);
    for (const r of s.conditionalRefs) {
      lines.push(`      ${path.basename(r.path).padEnd(24)} +${size(r.bytes, r.tokens)}  ${r.condition}`);
      if (r.missing) lines.push(`  ! ${s.name}: conditional reference missing on disk: ${r.path}`);
    }
    lines.push(
      `  = ${s.name} per-invocation ceiling (eager + all conditional): ${size(s.perInvocationBytes, s.perInvocationTokens)}` +
        `, ${(s.perInvocationTokens / (s.eagerTokens || 1)).toFixed(1)}x the eager figure`,
    );
  }
  lines.push("");

  lines.push("LAZY (per mode/alias): activates only when routed");
  for (const s of skills) {
    const rows = mode ? s.lazy.filter((r) => r.label.toLowerCase().includes(mode.toLowerCase())) : s.lazy;
    for (const r of rows) {
      lines.push(`  ${s.name} / ${r.label.padEnd(20)} +${size(r.bytes, r.tokens)}  [${r.modules.map((m) => path.basename(m.path)).join(", ")}]`);
      for (const m of r.modules.filter((m) => m.missing)) lines.push(`  ! ${s.name} / ${r.label}: routed module missing on disk: ${m.path}`);
    }
    if (!mode && s.orphans.length) {
      lines.push(`  ${s.name} / (unrouted on disk)   +${size(sumBytes(s.orphans), sumTokens(s.orphans))}  [${s.orphans.map((o) => path.basename(o.path)).join(", ")}]`);
    }
    if (mode) {
      const invocation = s.perInvocationBytes + rows.reduce((n, r) => n + r.bytes, 0);
      const invocationTokens = s.perInvocationTokens + rows.reduce((n, r) => n + r.tokens, 0);
      lines.push(
        `  ${s.name} / mode "${mode}" invocation total: ${size(invocation, invocationTokens)} (eager + conditional + routed modules)`,
      );
    }
  }
  lines.push("");

  lines.push(
    `TOTAL on disk: ${size(bill.totals.totalMdBytes, bill.totals.totalMdTokens)}, ` +
      `${bill.totals.lazyPercent}% lazy by bytes / ${bill.totals.lazyTokenPercent}% by tokens.`,
  );
  lines.push(tokenDisclaimer(bill));
  return lines.join("\n") + "\n";
}

/**
 * Names the error band instead of hand-waving about "estimates". The band is the
 * worst-case residual measured over the calibration corpus, not a guess.
 */
export function tokenDisclaimer(bill) {
  if (bill.tokenEstimateErrorPct === 0) {
    return `Token counts measured with ${bill.tokenSource}. Bytes are exact.`;
  }
  const per = Object.entries(TOKEN_DIVISORS).map(([k, v]) => `${k} /${v}`).join(", ");
  return (
    `Token counts are ESTIMATES: bytes divided per content class (${per}), calibrated against ` +
    `count_tokens on this repo's 219 skill files. Measured accuracy of that estimate: mean ` +
    `per-file error 7.4%, systematic bias under 0.5%, worst single file ` +
    `${bill.tokenEstimateErrorPct}% (dense path/table files such as ASSETS.md). Ledger rows ` +
    `land tighter than single files because errors partly cancel across a sum. Run --exact for ` +
    `measured counts when a number has to be right. Bytes are always exact.`
  );
}

export function renderDiff(diff) {
  if (diff.rows.length === 0) return "No context-cost changes between trees.\n";
  const lines = ["Context-cost changes (sorted by |delta|):", ""];
  for (const r of diff.rows) {
    const sign = r.delta > 0 ? "+" : "-";
    lines.push(
      `  ${r.ledger.padEnd(11)} ${r.label.padEnd(28)} ${sign}${fmtBytes(Math.abs(r.delta))} (${sign}${Math.abs(r.tokenDelta)} tok)  ${fmtBytes(r.before)} -> ${fmtBytes(r.after)}`,
    );
  }
  lines.push("");
  lines.push(
    diff.grew
      ? "RESULT: context cost GREW (always-on, eager, or conditional)."
      : "RESULT: no always-on, eager, or conditional growth.",
  );
  return lines.join("\n") + "\n";
}

// --exact defaults to the model the offline divisor was calibrated against, so
// `--exact` and the estimate are comparable. Later tokenizers differ.
export const EXACT_DEFAULT_MODEL = "claude-opus-4-5";
const COUNT_TOKENS_URL = "https://api.anthropic.com/v1/messages/count_tokens";
const EXACT_CONCURRENCY = 8;

/** Typed failures, so callers branch on a code rather than on message text. */
export class ExactModeError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ExactModeError";
    this.code = code;
  }
}

async function countTokens(text, { model, apiKey, fetchImpl }) {
  let res;
  try {
    res = await fetchImpl(COUNT_TOKENS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model, messages: [{ role: "user", content: text }] }),
    });
  } catch (error) {
    throw new ExactModeError("exact_network_unreachable", `count_tokens unreachable: ${error?.message ?? error}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const code = res.status === 401 || res.status === 403 ? "exact_auth_rejected" : "exact_request_failed";
    throw new ExactModeError(code, `count_tokens returned ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = await res.json();
  if (typeof json?.input_tokens !== "number") {
    throw new ExactModeError("exact_response_malformed", "count_tokens response had no input_tokens");
  }
  return json.input_tokens;
}

/**
 * Measures every text the bill will bill for. Returns a `tokensOf` lookup.
 *
 * count_tokens prices a whole request, so it includes a fixed message envelope.
 * That envelope is measured once and subtracted, leaving the tokens each file's
 * own content contributes — otherwise every small reference is overcharged by a
 * constant that has nothing to do with the file.
 */
export async function measureExactTokens(root, { model, apiKey, fetchImpl = fetch, onProgress } = {}) {
  if (!apiKey) {
    throw new ExactModeError(
      "exact_missing_api_key",
      "--exact needs ANTHROPIC_API_KEY. Without it the offline estimate is used; nothing was sent.",
    );
  }
  const opts = { model, apiKey, fetchImpl };
  // One-char body: subtracting its single content token leaves the envelope.
  const envelope = (await countTokens("x", opts)) - 1;

  const texts = new Map();
  // Resolve before keying. buildBill resolves its root, so a relative root here
  // would produce keys that never match and every lookup would fall back to the
  // estimate -- exact mode silently degrading to the thing it replaces.
  for (const file of walkMd(path.resolve(root))) {
    const text = fs.readFileSync(file, "utf8");
    texts.set(file, text);
    if (path.basename(file) === "SKILL.md") {
      const fm = parseFrontmatter(text);
      if (fm.block) texts.set(frontmatterKey(file), fm.block);
    }
  }

  const counts = new Map();
  const keys = [...texts.keys()];
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < keys.length) {
      const key = keys[next++];
      const raw = await countTokens(texts.get(key), opts);
      counts.set(key, Math.max(0, raw - envelope));
      onProgress?.(++done, keys.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(EXACT_CONCURRENCY, keys.length) }, worker));

  // A key the walk never saw (a non-.md foreign-host file) falls back to the
  // estimate rather than billing zero. Misses are counted, not swallowed: a bill
  // that is part-measured and part-estimated must not present itself as measured.
  const missed = new Set();
  const tokensOf = (key, bytes) => {
    const exact = counts.get(key);
    if (exact !== undefined) return exact;
    missed.add(key);
    return estimateTokensOf(key, bytes);
  };
  return {
    tokenSource: `count_tokens (${model})`,
    tokensOf,
    measuredFiles: counts.size,
    counts,
    /** Keys priced by estimate because measurement missed them. Read after buildBill. */
    missedKeys: missed,
  };
}

/**
 * Estimate-vs-measured residual per file. This is what makes the divisor
 * auditable: run --exact and the tool grades its own offline estimate.
 */
export function calibrationTable(counts, root) {
  const rows = [];
  for (const [key, tokens] of counts) {
    if (key.endsWith("#frontmatter") || tokens === 0) continue;
    const bytes = bytesOf(key);
    if (bytes == null) continue;
    // Grade the estimate the tool actually uses, class divisor included.
    const estimated = Math.round(estimateTokensOf(key, bytes));
    rows.push({
      path: path.relative(root, key),
      contentClass: contentClass(key),
      bytes,
      estimatedTokens: estimated,
      tokens,
      bytesPerToken: Number((bytes / tokens).toFixed(3)),
      errorPct: Number((((estimated - tokens) / tokens) * 100).toFixed(1)),
    });
  }
  rows.sort((a, b) => Math.abs(b.errorPct) - Math.abs(a.errorPct));
  const abs = rows.map((r) => Math.abs(r.errorPct));
  return {
    rows,
    worstErrorPct: abs.length ? Math.max(...abs) : 0,
    meanAbsErrorPct: abs.length ? Number((abs.reduce((a, b) => a + b, 0) / abs.length).toFixed(2)) : 0,
    biasPct: rows.length
      ? Number((rows.reduce((n, r) => n + r.errorPct, 0) / rows.length).toFixed(2))
      : 0,
  };
}

// Where `npx skills add ...` actually puts a tree: `.agents/skills` (the
// host-neutral canonical path) alongside `.claude/skills`, project then user.
const DEFAULT_TREES = [
  ["cwd", "skills"],
  ["cwd", ".agents", "skills"],
  ["cwd", ".claude", "skills"],
  ["home", ".agents", "skills"],
  ["home", ".claude", "skills"],
];

function defaultTreeCandidates(cwd, homeDir) {
  return DEFAULT_TREES.map(([base, ...rest]) => path.join(base === "cwd" ? cwd : homeDir, ...rest));
}

function detectDefaultTree(cwd, homeDir) {
  return defaultTreeCandidates(cwd, homeDir).find((c) => fs.existsSync(c)) ?? null;
}

const USAGE =
  "Usage:\n" +
  "  gstack context-bill [TREE] [--json] [--skill <name>] [--mode <mode>]\n" +
  "  gstack context-bill --diff <treeA> <treeB> [--json]\n" +
  "  gstack context-bill [TREE] --budget <budget.json> [--json]\n" +
  "\n" +
  "  --exact              measure tokens with Anthropic's count_tokens instead of\n" +
  "                       estimating. Off by default: it sends the content of every\n" +
  "                       .md file in the tree to api.anthropic.com. Needs\n" +
  "                       ANTHROPIC_API_KEY; passing --exact is the consent.\n" +
  "  --exact-model <id>   model whose tokenizer to count against\n" +
  `                       (default ${EXACT_DEFAULT_MODEL}, the calibration model).\n`;

export async function contextBillMain(argv, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const homeDir = options.homeDir ?? os.homedir();

  const positional = [];
  const flags = { json: false, diff: false, exact: false, exactModel: EXACT_DEFAULT_MODEL };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") flags.json = true;
    else if (arg === "--diff") flags.diff = true;
    else if (arg === "--skill") flags.skill = argv[++i];
    else if (arg === "--mode") flags.mode = argv[++i];
    else if (arg === "--budget") flags.budget = argv[++i];
    else if (arg === "--exact") flags.exact = true;
    else if (arg === "--exact-model") flags.exactModel = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      stdout.write(USAGE);
      return 0;
    } else if (arg.startsWith("--")) {
      stderr.write(`Unknown flag: ${arg}\n${USAGE}`);
      return 2;
    } else positional.push(arg);
  }

  // Exact mode is the only path that leaves the machine. Announce what is sent
  // before sending it, and degrade to the estimate rather than failing the run.
  const exactFor = async (tree) => {
    if (!flags.exact) return {};
    const files = walkMd(tree).length;
    stderr.write(
      `--exact: sending the content of ${files} .md file(s) under ${tree} to ` +
        `api.anthropic.com for count_tokens (${flags.exactModel}). No other data leaves this machine.\n`,
    );
    try {
      const measured = await measureExactTokens(tree, {
        model: flags.exactModel,
        apiKey: options.apiKey ?? process.env.ANTHROPIC_API_KEY,
        fetchImpl: options.fetchImpl,
      });
      return {
        tokensOf: measured.tokensOf,
        tokenSource: measured.tokenSource,
        calibration: calibrationTable(measured.counts, tree),
        onDone: () => {
          if (measured.missedKeys.size) {
            stderr.write(
              `--exact: ${measured.missedKeys.size} item(s) had no measurement and were estimated ` +
                `(${[...measured.missedKeys].slice(0, 3).join(", ")}). Those figures are not measurements.\n`,
            );
          }
        },
      };
    } catch (error) {
      if (!(error instanceof ExactModeError)) throw error;
      stderr.write(`--exact unavailable [${error.code}]: ${error.message}\nFalling back to the offline estimate.\n`);
      return {};
    }
  };

  try {
    if (flags.diff) {
      if (positional.length !== 2) {
        stderr.write(`--diff needs exactly two trees.\n${USAGE}`);
        return 2;
      }
      const treeA = path.resolve(cwd, positional[0]);
      const treeB = path.resolve(cwd, positional[1]);
      const optsA = await exactFor(treeA);
      const optsB = await exactFor(treeB);
      const diff = diffBills(buildBill(treeA, optsA), buildBill(treeB, optsB));
      optsA.onDone?.();
      optsB.onDone?.();
      stdout.write(flags.json ? JSON.stringify(diff, null, 2) + "\n" : renderDiff(diff));
      return diff.grew ? 2 : 0;
    }

    const tree = positional[0] ? path.resolve(cwd, positional[0]) : detectDefaultTree(cwd, homeDir);
    if (!tree) {
      stderr.write(
        `No skills tree found (tried ${defaultTreeCandidates(cwd, homeDir).join(", ")}). Pass a path.\n`,
      );
      return 2;
    }
    const exactOpts = await exactFor(tree);
    const bill = buildBill(tree, exactOpts);
    exactOpts.onDone?.();
    if (bill.skills.length === 0) {
      stderr.write(`No SKILL.md files found under ${tree}.\n`);
      return 2;
    }
    if (flags.skill && !bill.skills.some((s) => s.name === flags.skill)) {
      stderr.write(`No skill named "${flags.skill}" in ${tree}. Skills: ${bill.skills.map((s) => s.name).join(", ")}\n`);
      return 2;
    }

    if (flags.budget) {
      const budget = JSON.parse(fs.readFileSync(path.resolve(cwd, flags.budget), "utf8"));
      const violations = checkBudget(bill, budget);
      if (flags.json) {
        stdout.write(JSON.stringify({ ok: violations.length === 0, violations }, null, 2) + "\n");
      } else if (violations.length === 0) {
        stdout.write("Within budget.\n");
      } else {
        for (const v of violations) {
          stdout.write(`OVER BUDGET: ${v.ceiling} at ~${v.actual} tok (ceiling ~${v.limit} tok)\n`);
          for (const f of v.files) stdout.write(`  ${f}\n`);
        }
      }
      return violations.length === 0 ? 0 : 2;
    }

    stdout.write(flags.json ? JSON.stringify(bill, null, 2) + "\n" : renderBill(bill, flags));
    return 0;
  } catch (error) {
    stderr.write(`${error?.message ?? error}\n`);
    return 1;
  }
}
