#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';

const repo = process.env.GSTACK_PR_TEST_REPO || '';
const phase = process.env.GSTACK_PR_TEST_PHASE || '';
const gstackRoot = process.env.GSTACK_UNDER_TEST || '';
const sentinel = 'GSTACK_PR1743_SENTINEL_8d919dc9a143_DO_NOT_LOG';
const isControl = repo === 'stagehand';

function integrationContract() {
  if (repo === 'gstack-auto') {
    const text = fs.readFileSync(path.join(process.cwd(), 'CLAUDE.md'), 'utf8');
    return text.includes('.claude/skills/gstack/browse/dist/browse')
      && text.includes('browse binary is a READ-ONLY dependency from gstack');
  }
  if (repo === 'zotero-arxiv-daily') {
    const text = fs.readFileSync(path.join(process.cwd(), 'CLAUDE.md'), 'utf8');
    return text.includes('Use the `/browse` skill from gstack')
      && text.includes('`/setup-browser-cookies`');
  }
  if (repo === 'stagehand') {
    for (const name of ['CLAUDE.md', 'AGENTS.md']) {
      const file = path.join(process.cwd(), name);
      if (fs.existsSync(file) && /(^|\n)## gstack\s*($|\n)/i.test(fs.readFileSync(file, 'utf8'))) {
        return false;
      }
    }
    return true;
  }
  return false;
}

function parseScenario(result, name) {
  if (result.error?.code === 'ETIMEDOUT') return { name, ok: false, timeout: true };
  if (result.status !== 0) return { name, ok: false, processExit: result.status ?? 124 };
  const line = String(result.stdout || '').trim().split(/\r?\n/).findLast((entry) => entry.startsWith('RESULT:'));
  if (!line) return { name, ok: false, malformed: true };
  try {
    return { name, ...JSON.parse(line.slice('RESULT:'.length)) };
  } catch {
    return { name, ok: false, malformed: true };
  }
}

function runPolyfillScenario(name, body, extraArgs = []) {
  const polyfill = path.join(gstackRoot, 'browse', 'src', 'bun-polyfill.cjs');
  const source = `
    const polyfill = process.argv[1];
    const emit = (value) => console.log('RESULT:' + JSON.stringify(value));
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const within = (promise, ms) => Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
    ]);
    ${body}
  `;
  const result = spawnSync(process.execPath, ['-e', source, polyfill, ...extraArgs], {
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env },
  });
  const parsed = parseScenario(result, name);
  parsed.noSentinelLeak = !String(result.stdout || '').includes(sentinel)
    && !String(result.stderr || '').includes(sentinel);
  return parsed;
}

function runAffectedMatrix() {
  const lifecycle = runPolyfillScenario('proc-exited-exit-7', `
    require(polyfill);
    (async () => {
      const proc = Bun.spawn([process.execPath, '-e', 'process.exit(7)'], { stdio: ['ignore', 'ignore', 'ignore'] });
      const thenable = !!proc.exited && typeof proc.exited.then === 'function';
      const code = thenable ? await within(proc.exited, 3000).catch(() => 'TIMEOUT') : null;
      if (!thenable) proc.kill();
      emit({ ok: thenable && code === 7, thenable, code });
    })().catch(() => emit({ ok: false, error: 'scenario-error' }));
  `);

  const large = runPolyfillScenario('large-stdout-stderr-drain', `
    require(polyfill);
    (async () => {
      const bytes = 1200000;
      const child = 'const n=Number(process.argv[1]); const a=Buffer.alloc(n,111); const b=Buffer.alloc(n,101); process.stdout.write(a,()=>process.stderr.write(b,()=>process.exit(0)));';
      const proc = Bun.spawn([process.execPath, '-e', child, String(bytes)], { stdio: ['ignore', 'pipe', 'pipe'] });
      const thenable = !!proc.exited && typeof proc.exited.then === 'function';
      if (!thenable) { proc.kill(); emit({ ok: false, thenable }); return; }
      const code = await within(proc.exited, 10000).catch(() => 'TIMEOUT');
      const output = await within(Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).arrayBuffer(),
      ]), 5000).catch(() => null);
      const stdoutBytes = output ? output[0].byteLength : -1;
      const stderrBytes = output ? output[1].byteLength : -1;
      emit({ ok: code === 0 && stdoutBytes === bytes && stderrBytes === bytes, code, stdoutBytes, stderrBytes });
    })().catch(() => emit({ ok: false, error: 'scenario-error' }));
  `);

  const missing = runPolyfillScenario('missing-binary-completion', `
    let uncaught = null;
    process.on('uncaughtException', (error) => { uncaught = error && error.code || 'error'; });
    require(polyfill);
    (async () => {
      const proc = Bun.spawn(['gstack-pr1743-definitely-missing-binary'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const thenable = !!proc.exited && typeof proc.exited.then === 'function';
      const code = thenable ? await within(proc.exited, 3000).catch(() => 'TIMEOUT') : null;
      await wait(100);
      emit({ ok: thenable && typeof code === 'number' && code !== 0 && uncaught === null, thenable, code, uncaught });
    })().catch(() => emit({ ok: false, error: 'scenario-error' }));
  `);

  const capped = runPolyfillScenario('one-kibibyte-cap', `
    process.env.GSTACK_SPAWN_MAX_BUFFER = '1024';
    require(polyfill);
    (async () => {
      const child = 'process.stdout.write(Buffer.alloc(10000,120),()=>process.stderr.write(Buffer.alloc(10000,121),()=>process.exit(0)));';
      const proc = Bun.spawn([process.execPath, '-e', child], { stdio: ['ignore', 'pipe', 'pipe'] });
      const thenable = !!proc.exited && typeof proc.exited.then === 'function';
      if (!thenable) { proc.kill(); emit({ ok: false, thenable }); return; }
      const code = await within(proc.exited, 5000).catch(() => 'TIMEOUT');
      const [stdout, stderr] = await within(Promise.all([
        new Response(proc.stdout).arrayBuffer(),
        new Response(proc.stderr).arrayBuffer(),
      ]), 3000).catch(() => [new ArrayBuffer(0), new ArrayBuffer(0)]);
      emit({ ok: code === 0 && stdout.byteLength === 1024 && stderr.byteLength === 1024, code, stdoutBytes: stdout.byteLength, stderrBytes: stderr.byteLength });
    })().catch(() => emit({ ok: false, error: 'scenario-error' }));
  `);

  const noLeak = runPolyfillScenario('sentinel-not-logged', `
    require(polyfill);
    (async () => {
      const expected = process.argv[2];
      const proc = Bun.spawn([process.execPath, '-e', 'process.stdout.write(process.argv[1])', expected], { stdio: ['ignore', 'pipe', 'pipe'] });
      const thenable = !!proc.exited && typeof proc.exited.then === 'function';
      if (!thenable) { proc.kill(); emit({ ok: false, thenable }); return; }
      const code = await within(proc.exited, 3000).catch(() => 'TIMEOUT');
      const value = await within(new Response(proc.stdout).text(), 3000).catch(() => '');
      emit({ ok: code === 0 && value === expected, code, matched: value === expected, bytes: Buffer.byteLength(value) });
    })().catch(() => emit({ ok: false, error: 'scenario-error' }));
  `, [sentinel]);

  return [lifecycle, large, missing, capped, noLeak];
}

function nativeSpawn(args, { cap = Infinity } = {}) {
  return new Promise((resolve) => {
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutKept = 0;
    let stderrKept = 0;
    let errorCode = null;
    const child = spawn(args[0], args.slice(1), { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      stdoutKept += Math.min(chunk.length, Math.max(0, cap - stdoutKept));
    });
    child.stderr?.on('data', (chunk) => {
      stderrBytes += chunk.length;
      stderrKept += Math.min(chunk.length, Math.max(0, cap - stderrKept));
    });
    child.once('error', (error) => { errorCode = error.code || 'error'; });
    child.once('close', (code) => resolve({ code, errorCode, stdoutBytes, stderrBytes, stdoutKept, stderrKept }));
  });
}

async function runControlMatrix() {
  const exit = await nativeSpawn([process.execPath, '-e', 'process.exit(7)']);
  const bytes = 1200000;
  const child = 'const n=Number(process.argv[1]); process.stdout.write(Buffer.alloc(n,111),()=>process.stderr.write(Buffer.alloc(n,101),()=>process.exit(0)));';
  const large = await nativeSpawn([process.execPath, '-e', child, String(bytes)]);
  const missing = await nativeSpawn(['gstack-pr1743-definitely-missing-binary']);
  const cap = await nativeSpawn([process.execPath, '-e', child, '10000'], { cap: 1024 });
  const sentinelResult = spawnSync(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', sentinel], { encoding: 'utf8' });
  return [
    { name: 'native-exit-7', ok: exit.code === 7, code: exit.code, noSentinelLeak: true },
    { name: 'native-large-drain', ok: large.code === 0 && large.stdoutBytes === bytes && large.stderrBytes === bytes, code: large.code, stdoutBytes: large.stdoutBytes, stderrBytes: large.stderrBytes, noSentinelLeak: true },
    { name: 'native-missing-binary', ok: missing.errorCode === 'ENOENT', completion: true, errorCode: missing.errorCode, noSentinelLeak: true },
    { name: 'native-one-kibibyte-reader-cap', ok: cap.code === 0 && cap.stdoutKept === 1024 && cap.stderrKept === 1024 && cap.stdoutBytes === 10000 && cap.stderrBytes === 10000, stdoutKept: cap.stdoutKept, stderrKept: cap.stderrKept, drainedStdoutBytes: cap.stdoutBytes, drainedStderrBytes: cap.stderrBytes, noSentinelLeak: true },
    { name: 'native-sentinel-not-logged', ok: sentinelResult.status === 0 && sentinelResult.stdout === sentinel, matched: sentinelResult.stdout === sentinel, bytes: Buffer.byteLength(sentinelResult.stdout || ''), noSentinelLeak: !String(sentinelResult.stderr || '').includes(sentinel) },
  ];
}

try {
  if (!repo || !phase || !gstackRoot) throw new Error('missing-harness-context');
  const integration = integrationContract();
  const checks = isControl ? await runControlMatrix() : runAffectedMatrix();
  const noSentinelLeak = checks.every((check) => check.noSentinelLeak === true);
  const ok = integration && noSentinelLeak && checks.every((check) => check.ok === true);
  const summary = {
    repo,
    phase,
    cohort: isControl ? 'control-native-node' : 'affected-real-browse-adopter',
    integration,
    dpapi: process.platform === 'win32' ? 'requires-separate-real-profile-probe' : 'not-run-host-is-not-windows',
    checks: checks.map(({ noSentinelLeak: _hidden, ...check }) => check),
    noSentinelLeak,
    ok,
  };
  console.log(JSON.stringify(summary));
  process.exit(ok ? 0 : 1);
} catch (error) {
  console.log(JSON.stringify({ repo, phase, ok: false, error: error instanceof Error ? error.name : 'Error', noSentinelLeak: true }));
  process.exit(1);
}
