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
 * Token estimate is bytes/4 (same convention as docs/gstack-2/BLOAT-LEDGER.json).
 * Both bytes and ~tokens are always shown so nobody mistakes estimate for
 * measurement. The tool never writes state anywhere.
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

export function estimateTokens(bytes) {
  return Math.round(bytes / 4);
}

function bytesOf(file) {
  try {
    const st = fs.statSync(file);
    return st.isFile() ? st.size : null;
  } catch {
    return null;
  }
}

function refEntry(skillDir, rel) {
  const bytes = bytesOf(path.join(skillDir, rel));
  return { path: rel, bytes: bytes ?? 0, missing: bytes == null };
}

function sumBytes(entries) {
  return entries.reduce((n, e) => n + e.bytes, 0);
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

function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { bytes: 0, keys: [] };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { bytes: 0, keys: [] };
  const closeEol = text.indexOf("\n", end + 1);
  const block = text.slice(0, closeEol === -1 ? text.length : closeEol + 1);
  const inner = text.slice(text.indexOf("\n") + 1, end);
  const keys = [];
  for (const line of inner.split("\n")) {
    const m = /^([A-Za-z0-9_-]+)\s*:/.exec(line);
    if (m) keys.push(m[1]);
  }
  return { bytes: Buffer.byteLength(block, "utf8"), keys };
}

function totalMdBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) total += totalMdBytes(p);
    else if (e.isFile() && e.name.endsWith(".md")) total += bytesOf(p) ?? 0;
  }
  return total;
}

export function parseSkill(skillDir, name) {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const text = fs.readFileSync(skillMdPath, "utf8");
  const skillMdBytes = bytesOf(skillMdPath) ?? 0;
  const fm = parseFrontmatter(text);
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
      forcedRefs.push(refEntry(skillDir, p));
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
      conditionalRefs.push({ ...refEntry(skillDir, p), condition: conditionOf(clause) });
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
    const modules = modulePaths.map((p) => refEntry(skillDir, p));
    for (const p of modulePaths) routed.add(p);
    lazy.push({ label, modules, bytes: sumBytes(modules) });
  }

  // Legacy modules on disk that no table routes to (orphans).
  const legacyDir = path.join(skillDir, "references", "legacy");
  let orphans = [];
  try {
    orphans = fs
      .readdirSync(legacyDir)
      .filter((f) => f.endsWith(".md") && !routed.has(`references/legacy/${f}`))
      .sort()
      .map((f) => refEntry(skillDir, `references/legacy/${f}`));
  } catch {
    // no legacy dir — nothing lazy on disk
  }

  // Foreign-host skill files sitting next to SKILL.md (#1694).
  const foreignFiles = [];
  for (const entry of fs.readdirSync(skillDir, { withFileTypes: true })) {
    if (entry.isFile() && FOREIGN_SKILL_FILE.test(entry.name)) {
      foreignFiles.push({ path: entry.name, bytes: bytesOf(path.join(skillDir, entry.name)) ?? 0 });
    }
  }

  return {
    name,
    dir: skillDir,
    frontmatterBytes: fm.bytes,
    frontmatterKeys: fm.keys,
    deadKeys,
    skillMdBytes,
    forcedRefs,
    eagerBytes: skillMdBytes + sumBytes(forcedRefs),
    // What a trivial ask pays: SKILL.md only. null when no fast path overrides
    // the forced-read step, i.e. every invocation really does pay the eager row.
    fastPath: fastPathOverrides ? { paths: fastPathNames, bytes: skillMdBytes } : null,
    conditionalRefs,
    conditionalBytes: sumBytes(conditionalRefs),
    // What an invocation that hits every stated condition actually pays.
    perInvocationBytes: skillMdBytes + sumBytes(forcedRefs) + sumBytes(conditionalRefs),
    lazy,
    orphans,
    foreignFiles,
    totalMdBytes: totalMdBytes(skillDir),
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

export function buildBill(root) {
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved)) throw new Error(`No such tree: ${resolved}`);
  const skills = findSkillDirs(resolved).map((dir) =>
    parseSkill(dir, path.relative(resolved, dir) || path.basename(resolved)),
  );
  const lazyBytes = skills.reduce((n, s) => {
    const unique = new Map();
    for (const row of s.lazy) for (const m of row.modules) unique.set(m.path, m.bytes);
    for (const o of s.orphans) unique.set(o.path, o.bytes);
    return n + [...unique.values()].reduce((a, b) => a + b, 0);
  }, 0);
  const total = skills.reduce((n, s) => n + s.totalMdBytes, 0);
  return {
    root: resolved,
    tokenEstimate: "bytes/4",
    skills,
    totals: {
      skillCount: skills.length,
      alwaysOnBytes: skills.reduce((n, s) => n + s.frontmatterBytes, 0),
      eagerBytesBySkill: Object.fromEntries(skills.map((s) => [s.name, s.eagerBytes])),
      fastPathBytesBySkill: Object.fromEntries(skills.map((s) => [s.name, s.fastPath?.bytes ?? null])),
      perInvocationBytesBySkill: Object.fromEntries(skills.map((s) => [s.name, s.perInvocationBytes])),
      lazyBytes,
      totalMdBytes: total,
      lazyPercent: total ? Math.round((lazyBytes / total) * 100) : 0,
    },
  };
}

export function diffBills(a, b) {
  const rows = [];
  const push = (ledger, label, before, after) => {
    if (before !== after) rows.push({ ledger, label, before, after, delta: after - before });
  };
  const skillNames = [...new Set([...a.skills, ...b.skills].map((s) => s.name))].sort();
  for (const name of skillNames) {
    const sa = a.skills.find((s) => s.name === name);
    const sb = b.skills.find((s) => s.name === name);
    push("always-on", name, sa?.frontmatterBytes ?? 0, sb?.frontmatterBytes ?? 0);
    push("eager", name, sa?.eagerBytes ?? 0, sb?.eagerBytes ?? 0);
    push("conditional", name, sa?.conditionalBytes ?? 0, sb?.conditionalBytes ?? 0);
    const labels = [...new Set([...(sa?.lazy ?? []), ...(sb?.lazy ?? [])].map((r) => r.label))];
    for (const label of labels) {
      push(
        "lazy",
        `${name} / ${label}`,
        sa?.lazy.find((r) => r.label === label)?.bytes ?? 0,
        sb?.lazy.find((r) => r.label === label)?.bytes ?? 0,
      );
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
    const actual = estimateTokens(bill.totals.alwaysOnBytes);
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
      const actual = estimateTokens(withConditional ? skill.perInvocationBytes : skill.eagerBytes);
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

function fmtTok(bytes) {
  const t = estimateTokens(bytes);
  return t >= 1000 ? `~${(t / 1000).toFixed(1)}K tok` : `~${t} tok`;
}

function size(bytes) {
  return `${fmtBytes(bytes)} (${fmtTok(bytes)})`;
}

export function renderBill(bill, { skill, mode } = {}) {
  const skills = skill ? bill.skills.filter((s) => s.name === skill) : bill.skills;
  const lines = [`Context bill for ${bill.root}`, ""];

  lines.push(`ALWAYS-ON (every session): ${skills.length} skills, ${size(skills.reduce((n, s) => n + s.frontmatterBytes, 0))}`);
  for (const s of skills) lines.push(`  ${s.name.padEnd(12)} ${size(s.frontmatterBytes)}`);
  for (const s of skills) {
    if (s.deadKeys.length) lines.push(`  ! ${s.name}: frontmatter key(s) the router never reads: ${s.deadKeys.join(", ")}`);
    for (const f of s.foreignFiles) lines.push(`  ! ${s.name}: foreign-host file in scanner scope: ${f.path} (${size(f.bytes)})`);
  }
  lines.push("");

  lines.push("EAGER (per invocation): SKILL.md + forced-read references");
  for (const s of skills) {
    const refs = s.forcedRefs.length
      ? ` = SKILL.md ${fmtBytes(s.skillMdBytes)} + refs ${fmtBytes(sumBytes(s.forcedRefs))} (${s.forcedRefs.map((r) => path.basename(r.path)).join(", ")})`
      : "";
    lines.push(`  ${s.name.padEnd(12)} ${size(s.eagerBytes)}${refs}`);
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
    lines.push(
      `  ${s.name.padEnd(12)} ${size(s.fastPath.bytes)}` +
        `, ${saved > 0 ? `-${size(saved)} vs eager` : "same as eager"}` +
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
    lines.push(`  ${s.name.padEnd(12)} +${size(s.conditionalBytes)} across ${s.conditionalRefs.length} reference(s)`);
    for (const r of s.conditionalRefs) {
      lines.push(`      ${path.basename(r.path).padEnd(24)} +${size(r.bytes)}  ${r.condition}`);
      if (r.missing) lines.push(`  ! ${s.name}: conditional reference missing on disk: ${r.path}`);
    }
    lines.push(
      `  = ${s.name} per-invocation ceiling (eager + all conditional): ${size(s.perInvocationBytes)}` +
        `, ${(s.perInvocationBytes / (s.eagerBytes || 1)).toFixed(1)}x the eager figure`,
    );
  }
  lines.push("");

  lines.push("LAZY (per mode/alias): activates only when routed");
  for (const s of skills) {
    const rows = mode ? s.lazy.filter((r) => r.label.toLowerCase().includes(mode.toLowerCase())) : s.lazy;
    for (const r of rows) {
      lines.push(`  ${s.name} / ${r.label.padEnd(20)} +${size(r.bytes)}  [${r.modules.map((m) => path.basename(m.path)).join(", ")}]`);
      for (const m of r.modules.filter((m) => m.missing)) lines.push(`  ! ${s.name} / ${r.label}: routed module missing on disk: ${m.path}`);
    }
    if (!mode && s.orphans.length) {
      lines.push(`  ${s.name} / (unrouted on disk)   +${size(sumBytes(s.orphans))}  [${s.orphans.map((o) => path.basename(o.path)).join(", ")}]`);
    }
    if (mode) {
      const invocation = s.perInvocationBytes + rows.reduce((n, r) => n + r.bytes, 0);
      lines.push(
        `  ${s.name} / mode "${mode}" invocation total: ${size(invocation)} (eager + conditional + routed modules)`,
      );
    }
  }
  lines.push("");

  lines.push(
    `TOTAL on disk: ${size(bill.totals.totalMdBytes)}, ${bill.totals.lazyPercent}% lazy.`,
  );
  lines.push("Token counts are estimates (bytes/4), not measurements.");
  return lines.join("\n") + "\n";
}

export function renderDiff(diff) {
  if (diff.rows.length === 0) return "No context-cost changes between trees.\n";
  const lines = ["Context-cost changes (sorted by |delta|):", ""];
  for (const r of diff.rows) {
    const sign = r.delta > 0 ? "+" : "-";
    lines.push(
      `  ${r.ledger.padEnd(11)} ${r.label.padEnd(28)} ${sign}${fmtBytes(Math.abs(r.delta))} (${sign}${estimateTokens(Math.abs(r.delta))} tok)  ${fmtBytes(r.before)} -> ${fmtBytes(r.after)}`,
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
  "  gstack context-bill [TREE] --budget <budget.json> [--json]\n";

export async function contextBillMain(argv, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const homeDir = options.homeDir ?? os.homedir();

  const positional = [];
  const flags = { json: false, diff: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") flags.json = true;
    else if (arg === "--diff") flags.diff = true;
    else if (arg === "--skill") flags.skill = argv[++i];
    else if (arg === "--mode") flags.mode = argv[++i];
    else if (arg === "--budget") flags.budget = argv[++i];
    else if (arg === "--help" || arg === "-h") {
      stdout.write(USAGE);
      return 0;
    } else if (arg.startsWith("--")) {
      stderr.write(`Unknown flag: ${arg}\n${USAGE}`);
      return 2;
    } else positional.push(arg);
  }

  try {
    if (flags.diff) {
      if (positional.length !== 2) {
        stderr.write(`--diff needs exactly two trees.\n${USAGE}`);
        return 2;
      }
      const diff = diffBills(buildBill(path.resolve(cwd, positional[0])), buildBill(path.resolve(cwd, positional[1])));
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
    const bill = buildBill(tree);
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
