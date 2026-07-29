// Reconnect-leg tests (gstack#1796, #1975 finding 1). The StateServer boot
// token is single-use — the first /auth/rotate deletes the on-disk token and
// invalidates it — so before the session cache, a device was drivable exactly
// once per app launch: every later bootstrap (daemon restart, 30s tunnel-cache
// expiry) died at boot_token_unavailable.
//
// These tests simulate the device side (stateful StateServer model: boot
// token consumed on rotate, token file gone, only the rotated bearer lives)
// and prove the state machine: bootstrap → rotate → cache → reconnect, with
// a second daemon session driving the device without relaunching the app.
// The physical lane was verified separately (12/12); this pins the logic.

import { describe, test, expect, afterAll } from 'bun:test';
import { mkdtempSync, writeFileSync, existsSync, statSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createServer, type Server } from 'http';
import { bootstrapTunnel } from '../src/tunnel-bootstrap';
import {
  readSessionCache,
  writeSessionCache,
  clearSessionCache,
  type CachedDeviceSession,
} from '../src/session-cache';
import { startDaemon, type RunningDaemon } from '../src/index';
import type { SpawnImpl } from '../src/devicectl';

let workDir: string;

function tmp(): string {
  if (!workDir) workDir = mkdtempSync(join(tmpdir(), 'gstack-ios-session-cache-'));
  return workDir;
}

afterAll(() => {
  if (workDir) rmSync(workDir, { recursive: true, force: true });
});

// ── Scripted spawn (same shape as tunnel-bootstrap.test.ts; copied rather
//    than imported so requiring that test file doesn't re-register its tests).
interface ScriptedCall {
  argsMatch: RegExp;
  stdout?: string;
  exitCode?: number;
  jsonOutput?: object;
  destOutput?: string;
}

function makeSpawn(scripts: ScriptedCall[]): SpawnImpl {
  let idx = 0;
  return (cmd: string, args: string[]) => {
    const joined = `${cmd} ${args.join(' ')}`;
    const script = scripts[idx];
    if (!script || !script.argsMatch.test(joined)) {
      return makeReturn(1, '', `unexpected call: ${joined}`);
    }
    idx++;
    if (script.jsonOutput) {
      const flagIdx = args.indexOf('--json-output');
      if (flagIdx !== -1 && args[flagIdx + 1]) {
        writeFileSync(args[flagIdx + 1]!, JSON.stringify(script.jsonOutput));
      }
    }
    if (script.destOutput) {
      const flagIdx = args.indexOf('--destination');
      if (flagIdx !== -1 && args[flagIdx + 1]) {
        writeFileSync(args[flagIdx + 1]!, script.destOutput);
      }
    }
    return makeReturn(script.exitCode ?? 0, script.stdout ?? '', '');
  };
}

function makeReturn(exit: number, stdout: string, stderr: string) {
  return {
    pid: 0,
    output: [null, Buffer.from(stdout), Buffer.from(stderr)],
    stdout: Buffer.from(stdout),
    stderr: Buffer.from(stderr),
    status: exit,
    signal: null,
  } as ReturnType<SpawnImpl>;
}

/** devicectl scripts for one bootstrap: list → processes(running) → details. */
function deviceScripts(ipv6: string, copyFromToken?: string): ScriptedCall[] {
  const scripts: ScriptedCall[] = [
    {
      argsMatch: /devicectl list devices/,
      jsonOutput: {
        result: { devices: [{
          identifier: 'UDID-1',
          connectionProperties: { tunnelState: 'connected', pairingState: 'paired' },
          deviceProperties: { name: 'Test iPhone' },
          hardwareProperties: { productType: 'iPhone18,2' },
        }] },
      },
    },
    {
      argsMatch: /devicectl device info processes/,
      jsonOutput: { result: { runningProcesses: [{ executable: 'file:///var/containers/Bundle/Application/X/com.test.app/com.test' }] } },
    },
    {
      argsMatch: /devicectl device info details/,
      jsonOutput: { result: { connectionProperties: { tunnelIPAddress: ipv6 } } },
    },
  ];
  if (copyFromToken !== undefined) {
    scripts.push({ argsMatch: /devicectl device copy from/, destOutput: `${copyFromToken}\n` });
  }
  return scripts;
}

// ── Stateful StateServer model. Mirrors the shipped Swift behavior: rotate
//    accepts the boot token exactly once, deletes the on-disk token file,
//    and everything else requires the rotated bearer.
interface DeviceState {
  bootToken: string;
  bootValid: boolean;
  rotated: string | null;
  tokenFileExists: boolean;
}

function makeFetchStub(device: DeviceState, log: Array<{ path: string; auth: string; status: number }>): typeof fetch {
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const auth = ((init?.headers ?? {}) as Record<string, string>)['Authorization'] ?? '';
    const bearer = auth.replace(/^Bearer /, '');
    const respond = (status: number, body: unknown) => {
      log.push({ path: u.pathname, auth: bearer.slice(0, 8), status });
      return new Response(JSON.stringify(body), { status });
    };
    if (u.pathname === '/healthz') return respond(200, { version: '1.0.0' });
    if (u.pathname === '/auth/rotate') {
      if (!device.bootValid || bearer !== device.bootToken) return respond(401, { error: 'boot_token_invalid' });
      const parsed = JSON.parse(String(init?.body ?? '{}')) as { new_token?: string };
      device.rotated = parsed.new_token ?? null;
      device.bootValid = false;
      device.tokenFileExists = false;
      return respond(200, { ok: true });
    }
    // Everything else requires the rotated bearer.
    if (!device.rotated || bearer !== device.rotated) return respond(401, { error: 'unauthorized' });
    return respond(200, { ok: true, path: u.pathname });
  }) as typeof fetch;
}

describe('session cache file', () => {
  test('missing, corrupt, and wrong-shape files all read as null', () => {
    const missing = join(tmp(), 'nope.json');
    expect(readSessionCache(missing)).toBeNull();

    const corrupt = join(tmp(), 'corrupt.json');
    writeFileSync(corrupt, '{not json');
    expect(readSessionCache(corrupt)).toBeNull();

    const wrongShape = join(tmp(), 'wrong-shape.json');
    writeFileSync(wrongShape, JSON.stringify({ udid: 'U', bearer: 'too-short' }));
    expect(readSessionCache(wrongShape)).toBeNull();
  });

  test('roundtrips and is written 0600', () => {
    const path = join(tmp(), 'cache-dir', 'session.json');
    const session: CachedDeviceSession = {
      udid: 'UDID-1',
      bundleId: 'com.test',
      ipv6Addr: 'fd00::1',
      port: 9999,
      bearer: 'a'.repeat(43),
      savedAt: new Date().toISOString(),
    };
    writeSessionCache(path, session);
    expect(readSessionCache(path)).toEqual(session);
    if (process.platform !== 'win32') {
      expect(statSync(path).mode & 0o777).toBe(0o600);
    }
    clearSessionCache(path);
    expect(existsSync(path)).toBe(false);
    clearSessionCache(path); // idempotent
  });
});

describe('bootstrap → rotate → cache → reconnect', () => {
  test('second bootstrap reuses the cached bearer with the boot token gone', async () => {
    const cachePath = join(tmp(), 'reconnect', 'session.json');
    const device: DeviceState = { bootToken: 'BOOT-1', bootValid: true, rotated: null, tokenFileExists: true };
    const log: Array<{ path: string; auth: string; status: number }> = [];
    const fetchStub = makeFetchStub(device, log);

    // Session 1 — cold bootstrap: scrape boot token, rotate, cache.
    const first = await bootstrapTunnel({
      bundleId: 'com.test',
      sessionCachePath: cachePath,
      spawnImpl: makeSpawn(deviceScripts('fd00::1', 'BOOT-1')),
      fetchImpl: fetchStub,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.warmStart).toBeFalsy();
    expect(device.rotated).toBe(first.tunnel.bootTokenRotated);
    expect(device.tokenFileExists).toBe(false); // rotate consumed the token file
    const cached = readSessionCache(cachePath);
    expect(cached?.bearer).toBe(first.tunnel.bootTokenRotated);

    // Session 2 — the app was NOT relaunched: boot token dead, token file
    // gone. The devicectl script has NO `copy from` entry, so any attempt to
    // scrape the token fails the bootstrap — reuse is the only path to ok.
    const rotatesBefore = log.filter((l) => l.path === '/auth/rotate').length;
    const second = await bootstrapTunnel({
      bundleId: 'com.test',
      sessionCachePath: cachePath,
      spawnImpl: makeSpawn(deviceScripts('fd00::1')),
      fetchImpl: fetchStub,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.warmStart).toBe(true);
    expect(second.tunnel.bootTokenRotated).toBe(first.tunnel.bootTokenRotated);
    // No second rotate — the single-use boot token was never needed again.
    expect(log.filter((l) => l.path === '/auth/rotate').length).toBe(rotatesBefore);
    // The reconnect probe drove an authed device endpoint successfully.
    const probe = log[log.length - 1]!;
    expect(probe.path).toBe('/state/snapshot');
    expect(probe.status).toBe(200);
  });

  test('warm reconnect follows a changed tunnel address and refreshes the cache', async () => {
    const cachePath = join(tmp(), 'readdress', 'session.json');
    const device: DeviceState = { bootToken: 'BOOT-1', bootValid: true, rotated: 'r'.repeat(43), tokenFileExists: false };
    writeSessionCache(cachePath, {
      udid: 'UDID-1', bundleId: 'com.test', ipv6Addr: 'fd00::aaaa', port: 9999,
      bearer: device.rotated!, savedAt: new Date().toISOString(),
    });

    // The device resolves at a NEW tunnel address (Xcode 26 tunnel drop +
    // re-establish, #1975 finding 1). Probe must use the fresh address.
    const seen: string[] = [];
    const fetchStub = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(url));
      return makeFetchStub(device, [])(url as never, init as never);
    }) as typeof fetch;

    const r = await bootstrapTunnel({
      bundleId: 'com.test',
      sessionCachePath: cachePath,
      spawnImpl: makeSpawn(deviceScripts('fd00::beef')),
      fetchImpl: fetchStub,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warmStart).toBe(true);
    expect(r.tunnel.ipv6Addr).toBe('fd00::beef');
    expect(seen.every((u) => u.includes('[fd00::beef]'))).toBe(true);
    expect(readSessionCache(cachePath)?.ipv6Addr).toBe('fd00::beef');
  });

  test('app relaunch (dead bearer) falls back to the cold boot-token flow and re-caches', async () => {
    const cachePath = join(tmp(), 'relaunch', 'session.json');
    const staleBearer = 's'.repeat(43);
    writeSessionCache(cachePath, {
      udid: 'UDID-1', bundleId: 'com.test', ipv6Addr: 'fd00::1', port: 9999,
      bearer: staleBearer, savedAt: new Date().toISOString(),
    });
    // Fresh app instance: new boot token, no rotated bearer yet.
    const device: DeviceState = { bootToken: 'BOOT-2', bootValid: true, rotated: null, tokenFileExists: true };
    const log: Array<{ path: string; auth: string; status: number }> = [];

    const r = await bootstrapTunnel({
      bundleId: 'com.test',
      sessionCachePath: cachePath,
      spawnImpl: makeSpawn(deviceScripts('fd00::1', 'BOOT-2')),
      fetchImpl: makeFetchStub(device, log),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warmStart).toBeFalsy();
    expect(r.tunnel.bootTokenRotated).not.toBe(staleBearer);
    // Probe 401'd, then the cold path rotated with the fresh boot token.
    expect(log.some((l) => l.path === '/state/snapshot' && l.status === 401)).toBe(true);
    expect(log.some((l) => l.path === '/auth/rotate' && l.status === 200)).toBe(true);
    expect(readSessionCache(cachePath)?.bearer).toBe(r.tunnel.bootTokenRotated);
  });
});

// ── Daemon-level: a SECOND daemon session drives the device through the
//    loopback proxy with the boot token long gone.
describe('daemon reconnect (stub StateServer over real HTTP)', () => {
  function startStubStateServer(device: DeviceState): Promise<{ server: Server; port: number; rotateCount: () => number }> {
    return new Promise((resolve) => {
      let rotates = 0;
      const server = createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          const auth = (req.headers['authorization'] ?? '').toString().replace(/^Bearer /, '');
          const send = (status: number, body: unknown) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body));
          };
          if (req.url === '/healthz') { send(200, { version: '1.0.0' }); return; }
          if (req.url === '/auth/rotate') {
            if (!device.bootValid || auth !== device.bootToken) { send(401, { error: 'boot_token_invalid' }); return; }
            const parsed = JSON.parse(Buffer.concat(chunks).toString('utf-8') || '{}') as { new_token?: string };
            device.rotated = parsed.new_token ?? null;
            device.bootValid = false;
            device.tokenFileExists = false;
            rotates++;
            send(200, { ok: true });
            return;
          }
          if (!device.rotated || auth !== device.rotated) { send(401, { error: 'unauthorized' }); return; }
          if (req.url === '/elements') { send(200, { elements: [{ id: 'tap-button' }] }); return; }
          send(200, { ok: true });
        });
      });
      server.listen(0, '::1', () => {
        const addr = server.address();
        resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0, rotateCount: () => rotates });
      });
    });
  }

  test('second daemon session drives /elements via the cached bearer, no relaunch, one rotate total', async () => {
    const device: DeviceState = { bootToken: 'BOOT-1', bootValid: true, rotated: null, tokenFileExists: true };
    const stub = await startStubStateServer(device);
    const cachePath = join(tmp(), 'daemon', 'session.json');

    const makeProvider = (copyFromToken?: string) => async () => {
      const r = await bootstrapTunnel({
        bundleId: 'com.test',
        port: stub.port,
        sessionCachePath: cachePath,
        spawnImpl: makeSpawn(deviceScripts('::1', copyFromToken)),
      });
      return r.ok ? r.tunnel : null;
    };

    // Daemon session A — cold bootstrap + drive.
    const daemonA = await startDaemon({
      loopbackPort: 0,
      tailnetEnabled: false,
      pidfilePath: join(tmp(), 'daemon', 'a.pid'),
      tunnelProvider: makeProvider('BOOT-1'),
    }) as RunningDaemon;
    expect('close' in daemonA).toBe(true);
    const respA = await fetch(`http://127.0.0.1:${daemonA.loopbackPort}/elements`);
    expect(respA.status).toBe(200);
    await daemonA.close();
    expect(device.tokenFileExists).toBe(false); // boot token consumed

    // Daemon session B — fresh process state, boot token gone, app NOT
    // relaunched. Its devicectl script has no `copy from`; only bearer
    // reuse can connect.
    const daemonB = await startDaemon({
      loopbackPort: 0,
      tailnetEnabled: false,
      pidfilePath: join(tmp(), 'daemon', 'b.pid'),
      tunnelProvider: makeProvider(),
    }) as RunningDaemon;
    const respB = await fetch(`http://127.0.0.1:${daemonB.loopbackPort}/elements`);
    expect(respB.status).toBe(200);
    expect((await respB.json() as { elements: unknown[] }).elements.length).toBe(1);
    await daemonB.close();

    expect(stub.rotateCount()).toBe(1); // exactly one rotate across both sessions
    stub.server.close();
  });
});
