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
