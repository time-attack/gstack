/**
 * Runtime-absence guard (gate, free).
 *
 * The canonical `npx skills add time-attack/gstack/skills` install ships no
 * `$GSTACK_BIN`. Skill prose that invokes it therefore has to survive an empty
 * `~/.gstack` on a clean machine. Two invariants keep it honest:
 *
 *  1. Every `references/RUNTIME.md` carries the absence probe and the rule that
 *     a runtime-only section is skipped whole, so the agent does not READ
 *     hundreds of lines to execute nothing. The read is the cost, not the
 *     failed exec.
 *  2. No naked `$GSTACK_BIN/...` invocation inside a bash fence. A naked call
 *     prints "no such file or directory" on every clean install, which reads as
 *     a broken skill rather than an absent optional runtime.
 *
 * Both are static text checks over `skills/`, which is the source of truth.
 */
import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dir, '..');
const SKILLS = path.join(ROOT, 'skills');

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.md')) out.push(p);
  }
  return out;
}

const MD = walk(SKILLS);
const rel = (p: string) => path.relative(ROOT, p);

describe('runtime-absence guard (gate, free)', () => {
  test('every RUNTIME.md ships the absence probe and the skip-whole-section rule', () => {
    const runtimeDocs = MD.filter((p) => path.basename(p) === 'RUNTIME.md');
    expect(runtimeDocs.length).toBeGreaterThanOrEqual(6);

    for (const f of runtimeDocs) {
      const text = fs.readFileSync(f, 'utf-8');
      expect(text, `${rel(f)} is missing the absence probe`).toContain('GSTACK_RUNTIME_ABSENT');
      expect(text, `${rel(f)} is missing the presence branch`).toContain('GSTACK_RUNTIME_PRESENT');
      // The read is the cost: the rule has to say "skip the section", not just
      // "the command may fail".
      expect(
        /skip the whole enclosing section/.test(text),
        `${rel(f)} must tell the agent to skip the whole enclosing section, not just tolerate a failed exec`,
      ).toBe(true);
    }
  });

  test('no naked $GSTACK_BIN invocation inside a bash fence', () => {
    const naked: string[] = [];

    for (const f of MD) {
      const lines = fs.readFileSync(f, 'utf-8').split('\n');
      let inFence = false;
      let heredoc: string | null = null;

      lines.forEach((line, i) => {
        if (/^\s*```/.test(line)) {
          inFence = !inFence;
          heredoc = null;
          return;
        }
        if (!inFence) return;
        if (heredoc !== null) {
          if (line.trim() === heredoc) heredoc = null;
          return;
        }
        const hd = line.match(/<<-?\s*'?"?([A-Za-z_][A-Za-z0-9_]*)'?"?/);
        if (hd) heredoc = hd[1];

        // Only line-initial invocations: `FOO=$GSTACK_BIN/x` is a binding and
        // `a | $GSTACK_BIN/x` / `$(...)` are handled by their enclosing command.
        if (!/^\s*\$GSTACK_BIN\//.test(line)) return;
        // Continuation: the guard belongs on the last line of the command, and
        // a line whose predecessor ends in `\` is itself a continuation.
        if (/\\$/.test(line)) return;
        if (/\\$/.test(lines[i - 1] ?? '')) return;
        // Guarded: stderr suppressed, an explicit fallback branch, or an
        // existence check.
        if (/2>\/dev\/null/.test(line)) return;
        if (/\|\|/.test(line)) return;
        if (/\[\s-[xf]\s/.test(line)) return;

        naked.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }

    expect(naked, `naked $GSTACK_BIN calls (add \`2>/dev/null || echo "GSTACK_RUNTIME_ABSENT: <tool> skipped"\`):\n${naked.join('\n')}`).toEqual([]);
  });

  test('no unconditional "ALWAYS RUN" label over a runtime-only command', () => {
    const lying: string[] = [];

    for (const f of MD) {
      const lines = fs.readFileSync(f, 'utf-8').split('\n');
      lines.forEach((line, i) => {
        if (!/ALWAYS RUN(?!\s+WHEN THE RUNTIME IS PRESENT)/.test(line)) return;
        // Look ahead to the next fence: if its first command is a $GSTACK_BIN
        // helper, the label promises something a clean install cannot keep.
        const window = lines.slice(i + 1, i + 14).join('\n');
        const fence = window.match(/```bash\n([^\n]*)/);
        if (fence && fence[1].includes('$GSTACK_BIN/')) {
          lying.push(`${rel(f)}:${i + 1}: ${line.trim().slice(0, 100)}`);
        }
      });
    }

    expect(lying, `"ALWAYS RUN" over a $GSTACK_BIN command the canonical install never ships:\n${lying.join('\n')}`).toEqual([]);
  });
});
