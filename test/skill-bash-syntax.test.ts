import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const SKIP = new Set(['.git', 'node_modules', 'dist']);

function skillFiles(dir = ROOT, depth = 0): string[] {
  if (depth > 3) return [];
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isFile() && entry.name === 'SKILL.md') files.push(full);
    if (entry.isDirectory()) files.push(...skillFiles(full, depth + 1));
  }
  return files;
}

function bashBlocks(file: string): string[] {
  const blocks: string[] = [];
  let current: string[] | null = null;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (current === null && line.trimStart().startsWith('```bash')) {
      current = [];
    } else if (current !== null && line.trimStart() === '```') {
      blocks.push(current.join('\n'));
      current = null;
    } else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) throw new Error(`${relative(ROOT, file)} has an unclosed bash fence`);
  return blocks;
}

function preprocess(code: string): string {
  return code.replace(/<[A-Za-z][A-Za-z0-9_.|-]*>/g, 'PLACEHOLDER');
}

describe('SKILL.md bash syntax', () => {
  const files = skillFiles();

  test('discovers skill files', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    test(`${relative(ROOT, file)} has valid bash blocks`, () => {
      for (const [index, block] of bashBlocks(file).entries()) {
        const result = Bun.spawnSync(['bash', '-n'], {
          stdin: Buffer.from(preprocess(block)),
          stdout: 'pipe',
          stderr: 'pipe',
        });
        if (result.exitCode !== 0) {
          throw new Error(`${relative(ROOT, file)} bash block ${index + 1}: ${result.stderr.toString()}`);
        }
      }
    });
  }
});
