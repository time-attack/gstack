/**
 * Arm construction for the skill-baseline instrument.
 *
 * Three arms, plus the negative control:
 *   no-skill  bare host, no skill tree at all (the Anthropic-mandated baseline)
 *   current   the tree on disk (skills/)
 *   mutated   any tree path, so a later stage can swap one file for a stub
 *   gutted    NEGATIVE CONTROL: every .md reduced to its frontmatter, bodies emptied
 */

import * as fs from 'fs';
import * as path from 'path';

export type ArmId = 'no-skill' | 'current' | 'mutated' | 'gutted';

export interface Arm {
  id: ArmId;
  /** null for no-skill. */
  treePath: string | null;
  label: string;
}

export const ROOT = path.resolve(import.meta.dir, '..', '..');
export const CURRENT_TREE = path.join(ROOT, 'skills');

/** Directories that carry no judgment and only slow the copy down. */
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);

export function walkFiles(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walkFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return out;
}

/**
 * Keep the YAML frontmatter block, drop everything after it.
 * A file with no frontmatter becomes empty: nothing to keep.
 */
export function gutMarkdown(source: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(source);
  return m ? m[0] : '';
}

/**
 * Build the negative control. `.md` keeps frontmatter only; every other file is
 * copied verbatim (scripts and data are tooling, not judgment prose, and a
 * gutted SKILL.md never tells the model they exist).
 */
export function buildGuttedTree(srcTree: string, destTree: string): { files: number; gutted: number } {
  fs.rmSync(destTree, { recursive: true, force: true });
  let gutted = 0;
  const files = walkFiles(srcTree);
  for (const rel of files) {
    const src = path.join(srcTree, rel);
    const dst = path.join(destTree, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (rel.toLowerCase().endsWith('.md')) {
      fs.writeFileSync(dst, gutMarkdown(fs.readFileSync(src, 'utf-8')));
      gutted++;
    } else {
      fs.copyFileSync(src, dst);
    }
  }
  return { files: files.length, gutted };
}

// --- per-module ablation ------------------------------------------------------

/** `<dispatcher>/references/legacy/<module>.md` relative to a skill tree. */
const LEGACY_RE = /^([^/]+)\/references\/legacy\/(.+)\.md$/;

/** Module ids present in a tree, as `<dispatcher>/<module>` (e.g. `plan/office-hours`). */
export function listLegacyModules(srcTree = CURRENT_TREE): string[] {
  return walkFiles(srcTree)
    .map((rel) => LEGACY_RE.exec(rel))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]}/${m[2]}`)
    .sort();
}

/** `plan/office-hours` → `plan/references/legacy/office-hours.md`. Already-expanded paths pass through. */
export function moduleTreePath(moduleId: string): string {
  if (LEGACY_RE.test(moduleId)) return moduleId;
  const [dispatcher, ...rest] = moduleId.split('/');
  if (!dispatcher || rest.length === 0) throw new Error(`malformed module id: ${moduleId}`);
  return `${dispatcher}/references/legacy/${rest.join('/')}.md`;
}

/** `plan/references/legacy/office-hours.md` → `plan`; `plan/office-hours` → `plan`. */
export function moduleDispatcher(moduleId: string): string {
  const d = moduleId.split('/')[0];
  if (!d) throw new Error(`malformed module id: ${moduleId}`);
  return d;
}

export interface AblationResult {
  /** Total files written. Identical to the source tree's file count. */
  files: number;
  /** Tree-relative paths of the files that were gutted. */
  targets: string[];
  bytesBefore: number;
  bytesAfter: number;
}

/**
 * Resolve one ablation target, or throw. Both failure modes are fatal because
 * both manufacture the study's most attractive wrong answer: a missing path
 * means the arm is identical to `full` and the module scores "no effect", and a
 * target that is already body-less means the same thing for the same reason.
 */
function ablationTarget(srcTree: string, moduleId: string): { rel: string; before: string; after: string } {
  const rel = moduleTreePath(moduleId);
  const srcFile = path.join(srcTree, rel);
  if (!fs.existsSync(srcFile)) {
    throw new Error(
      `ablation target does not exist: ${rel} (in ${srcTree}). ` +
        `Ablating nothing would score as "module has no effect".`,
    );
  }
  const before = fs.readFileSync(srcFile, 'utf-8');
  const after = gutMarkdown(before);
  if (after.length === before.length) {
    throw new Error(
      `ablation target has no body to remove: ${rel}. ` +
        `The arm would be byte-identical to \`full\`, which is not a measurement.`,
    );
  }
  return { rel, before, after };
}

/**
 * Build the treatment tree for `ablate:<module>` (one id) or `ablate-set:<id>`
 * (a list): the whole tree copied byte-for-byte, with exactly the named legacy
 * modules reduced to their frontmatter.
 *
 * The set form exists because single-module ablation is structurally blind to
 * pairwise redundancy: if A and B overlap, removing either alone shows nothing
 * and both read DEAD, but removing both hurts. A set that degrades while every
 * member individually did not must be bisected before anything is deleted.
 */
export function buildAblatedTree(
  srcTree: string,
  destTree: string,
  modules: string | string[],
): AblationResult {
  const ids = typeof modules === 'string' ? [modules] : modules;
  if (ids.length === 0) throw new Error('ablation needs at least one module');
  // Resolve and validate EVERY target before writing anything, so a bad id in a
  // set cannot leave a half-built tree that a later run would treat as cached.
  const resolved = ids.map((id) => ablationTarget(srcTree, id));
  const byRel = new Map(resolved.map((r) => [r.rel, r.after]));

  fs.rmSync(destTree, { recursive: true, force: true });
  const files = walkFiles(srcTree);
  for (const rel of files) {
    const dst = path.join(destTree, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const gutted = byRel.get(rel);
    if (gutted !== undefined) fs.writeFileSync(dst, gutted);
    else fs.copyFileSync(path.join(srcTree, rel), dst);
  }
  return {
    files: files.length,
    targets: resolved.map((r) => r.rel),
    bytesBefore: resolved.reduce((n, r) => n + r.before.length, 0),
    bytesAfter: resolved.reduce((n, r) => n + r.after.length, 0),
  };
}

export interface SoloResult {
  files: number;
  /** Tree-relative path of the one legacy module left intact. */
  kept: string;
  /** How many other legacy modules were reduced to frontmatter. */
  gutted: number;
}

/**
 * Build the treatment tree for `solo:<module>`: every legacy module gutted
 * EXCEPT this one. The dispatcher SKILL.md files and all non-legacy references
 * stay verbatim, because they are the routing table and the forced reads — the
 * skeleton the module needs to be reachable at all.
 *
 * Why this arm exists: `full` carries ~1.7 MB across 42 modules, so removing
 * one 11 KB module is a perturbation small enough for a real effect to hide
 * under the variance of the other 41. Solo is the same question at maximum
 * signal, scored against `no-skill` rather than `full`.
 *
 * Reachability is asserted, not assumed. A solo tree whose dispatcher can no
 * longer route to the module measures nothing and reads as "the module is
 * inert" — the same false-DEAD verdict, arrived at from the other direction.
 */
export function buildSoloTree(srcTree: string, destTree: string, moduleId: string): SoloResult {
  const kept = moduleTreePath(moduleId);
  if (!fs.existsSync(path.join(srcTree, kept))) {
    throw new Error(`solo target does not exist: ${kept} (in ${srcTree}).`);
  }

  fs.rmSync(destTree, { recursive: true, force: true });
  const files = walkFiles(srcTree);
  let gutted = 0;
  for (const rel of files) {
    const dst = path.join(destTree, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    if (rel !== kept && LEGACY_RE.test(rel)) {
      fs.writeFileSync(dst, gutMarkdown(fs.readFileSync(path.join(srcTree, rel), 'utf-8')));
      gutted++;
    } else {
      fs.copyFileSync(path.join(srcTree, rel), dst);
    }
  }
  assertReachable(destTree, kept);
  return { files: files.length, kept, gutted };
}

/**
 * The module survived intact AND something in the built tree still routes to
 * it. Routing lives in `<dispatcher>/SKILL.md`, which names every legacy module
 * by its tree-relative path; scanning every surviving non-legacy file also
 * catches routes through COMPATIBILITY.md or a `.compat` alias.
 */
export function assertReachable(destTree: string, moduleRel: string): void {
  const built = path.join(destTree, moduleRel);
  if (!fs.existsSync(built)) throw new Error(`solo tree is missing its module: ${moduleRel}`);
  const body = fs.readFileSync(built, 'utf-8');
  if (body.length === gutMarkdown(body).length) {
    throw new Error(`solo tree gutted the module it was supposed to keep: ${moduleRel}`);
  }
  const needle = moduleRel.split('/').slice(1).join('/'); // references/legacy/<module>.md
  const routed = walkFiles(destTree).some(
    (rel) =>
      rel !== moduleRel &&
      rel.toLowerCase().endsWith('.md') &&
      !LEGACY_RE.test(rel) &&
      fs.readFileSync(path.join(destTree, rel), 'utf-8').includes(needle),
  );
  if (!routed) {
    throw new Error(
      `nothing in the built tree routes to ${moduleRel}. An unreachable module ` +
        `scores as inert, which is a false DEAD verdict, not a measurement.`,
    );
  }
}

/** Symlink where the platform allows it, copy where it does not. */
export function linkOrCopy(src: string, dst: string): 'link' | 'copy' {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.rmSync(dst, { recursive: true, force: true });
  try {
    fs.symlinkSync(src, dst, 'junction');
    return 'link';
  } catch {
    fs.cpSync(src, dst, { recursive: true });
    return 'copy';
  }
}

/** Make the arm's skills discoverable to a host running in `workspace`. */
export function installArm(arm: Arm, workspace: string): void {
  const dest = path.join(workspace, '.claude', 'skills');
  if (!arm.treePath) {
    fs.mkdirSync(dest, { recursive: true });
    return;
  }
  linkOrCopy(arm.treePath, dest);
}

/** Resolve the arms requested on the command line. */
export function resolveArms(ids: string[], opts: { mutatedPath?: string; guttedPath?: string }): Arm[] {
  return ids.map((id) => {
    switch (id) {
      case 'no-skill':
        return { id, treePath: null, label: 'bare host, no skills' };
      case 'current':
        return { id, treePath: CURRENT_TREE, label: CURRENT_TREE };
      case 'gutted':
        if (!opts.guttedPath) throw new Error('gutted arm needs a built tree path');
        return { id, treePath: opts.guttedPath, label: `NEGATIVE CONTROL ${opts.guttedPath}` };
      case 'mutated':
        if (!opts.mutatedPath) throw new Error('mutated arm needs --mutated <path>');
        return { id, treePath: path.resolve(opts.mutatedPath), label: path.resolve(opts.mutatedPath) };
      default:
        throw new Error(`unknown arm: ${id}`);
    }
  });
}
