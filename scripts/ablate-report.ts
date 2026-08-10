#!/usr/bin/env bun
/**
 * Read one ablation run's cells.jsonl and print the verdict.
 *
 * No model calls. Pure statistics over the JSONL the runner wrote.
 *
 * Usage:
 *   bun run scripts/ablate-report.ts [<runId> | <run dir> | <cells.jsonl>]
 *   bun run scripts/ablate-report.ts --json
 *   bun run scripts/ablate-report.ts --list
 *
 * Options:
 *   --json                machine-readable AblationReport
 *   --list                list runs under ~/.gstack-dev/ablation and exit
 *   --min-replicates N    replicates required per scenario per arm (default 3)
 *   --min-effect P        smallest recall drop worth keeping a module for, in
 *                         points (default 10). DEAD must RULE THIS OUT.
 *   --min-fab-effect X    smallest fabrication increase worth keeping a module
 *                         for, per scenario (default 0.5)
 *   --iterations N        bootstrap resamples (default 2000)
 *   --seed N              bootstrap seed (default 20260801)
 *   --level P             CI level, e.g. 0.95 (default 0.95)
 *   --root DIR            repo root used to read module byte weights
 *
 * Exit codes: 0 valid run, 2 instrument blind (no verdict is usable),
 * 3 mutual redundancy detected (a proposed set must be bisected, not deleted),
 * 1 usage/IO.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { analyze, formatReport, parseCells, DEFAULTS } from '../test/skill-baseline/ablate-report';

const ABLATION_DIR = path.join(process.env.GSTACK_DEV_HOME || path.join(os.homedir(), '.gstack-dev'), 'ablation');

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const argv = process.argv.slice(2);
const opts: Record<string, number | string> = {};
let target: string | null = null;
let asJson = false;
let list = false;

for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  const num = (name: string) => {
    const v = Number(argv[++i]);
    if (!Number.isFinite(v)) die(`--${name} needs a number`);
    return v;
  };
  if (a === '--json') asJson = true;
  else if (a === '--list') list = true;
  else if (a === '--min-replicates') opts.minReplicates = num('min-replicates');
  else if (a === '--min-effect') opts.minEffect = num('min-effect') / 100;
  else if (a === '--min-fab-effect') opts.minFabEffect = num('min-fab-effect');
  else if (a === '--iterations') opts.iterations = num('iterations');
  else if (a === '--seed') opts.seed = num('seed');
  else if (a === '--level') opts.level = num('level');
  else if (a === '--root') opts.root = argv[++i];
  else if (a === '-h' || a === '--help') {
    console.log(fs.readFileSync(import.meta.path, 'utf-8').split('*/')[0].replace(/^#!.*\n/, ''));
    process.exit(0);
  } else if (a.startsWith('-')) die(`unknown flag: ${a}`);
  else target = a;
}

function runDirs(): string[] {
  if (!fs.existsSync(ABLATION_DIR)) return [];
  return fs
    .readdirSync(ABLATION_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(ABLATION_DIR, e.name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

if (list) {
  const dirs = runDirs();
  if (dirs.length === 0) die(`no runs under ${ABLATION_DIR}`);
  for (const d of dirs) {
    const f = path.join(d, 'cells.jsonl');
    const n = fs.existsSync(f) ? fs.readFileSync(f, 'utf-8').split('\n').filter((l) => l.trim()).length : 0;
    console.log(`${path.basename(d)}  ${n} cells  ${fs.statSync(d).mtime.toISOString()}`);
  }
  process.exit(0);
}

/** runId | run dir | explicit jsonl path | newest run. */
function resolveJsonl(t: string | null): string {
  const tries: string[] = [];
  if (t) {
    tries.push(t, path.join(t, 'cells.jsonl'), path.join(ABLATION_DIR, t, 'cells.jsonl'));
  } else {
    const newest = runDirs()[0];
    if (newest) tries.push(path.join(newest, 'cells.jsonl'));
  }
  for (const p of tries) {
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      // next candidate
    }
  }
  die(
    t
      ? `no cells.jsonl for "${t}" (tried: ${tries.join(', ')})`
      : `no ablation runs under ${ABLATION_DIR}. Run the study first, or pass a cells.jsonl path.`,
  );
}

const jsonl = resolveJsonl(target);
const { cells, bad } = parseCells(fs.readFileSync(jsonl, 'utf-8'));
if (cells.length === 0) die(`${jsonl} has no parseable cells (${bad.length} bad line(s)).`);

const report = analyze(cells, { ...DEFAULTS, ...(opts as object) });
if (bad.length > 0) report.warnings.unshift(`${jsonl}: ${bad.length} unparseable line(s): ${bad.join('; ')}`);

if (asJson) {
  console.log(JSON.stringify({ source: jsonl, badLines: bad, ...report }, null, 2));
} else {
  console.log(`source: ${jsonl}`);
  console.log(formatReport(report).join('\n'));
}

if (!report.gate.valid) process.exit(2);
process.exit(report.mutualRedundancy.length > 0 ? 3 : 0);
