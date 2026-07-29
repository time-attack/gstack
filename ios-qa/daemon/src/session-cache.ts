// Rotated-bearer session cache — the daemon-side warm start that makes a
// device drivable across daemon restarts and tunnel-cache expiries instead
// of exactly once per app launch (gstack#1796, #1975 finding 1).
//
// The StateServer's boot token is single-use: the first /auth/rotate deletes
// the on-disk token file and invalidates it. Without persistence, every
// re-bootstrap after that dies at boot_token_unavailable. So after a
// successful rotate the daemon persists the rotated bearer here (0600, the
// same trust level as the pidfile dir), and the next bootstrap reuses it
// after a cheap authed probe — falling back to the full boot-token flow only
// when the probe fails (app relaunched → fresh boot token → fresh rotate).

import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { homedir } from 'os';

export interface CachedDeviceSession {
  udid: string;
  bundleId: string;
  ipv6Addr: string;
  port: number;
  bearer: string;
  savedAt: string; // ISO timestamp, informational only
}

export function defaultSessionCachePath(): string {
  if (process.env.GSTACK_IOS_SESSION_CACHE) return process.env.GSTACK_IOS_SESSION_CACHE;
  const home = process.env.GSTACK_HOME ?? join(homedir(), '.gstack');
  return join(home, 'ios-qa-device-session.json');
}

/** Read + validate the cache. Returns null on missing/corrupt/wrong shape. */
export function readSessionCache(path: string): CachedDeviceSession | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf-8');
  } catch {
    return null; // missing or unreadable — cold start
  }
  try {
    const parsed = JSON.parse(raw) as Partial<CachedDeviceSession>;
    if (
      typeof parsed.udid === 'string' && parsed.udid.length > 0 &&
      typeof parsed.bundleId === 'string' && parsed.bundleId.length > 0 &&
      typeof parsed.ipv6Addr === 'string' && parsed.ipv6Addr.length > 0 &&
      typeof parsed.port === 'number' && Number.isInteger(parsed.port) &&
      typeof parsed.bearer === 'string' && parsed.bearer.length >= 16
    ) {
      return parsed as CachedDeviceSession;
    }
  } catch {
    /* corrupt JSON */
  }
  return null;
}

/** Atomic 0600 write (tmp + rename), parent dir created 0700. */
export function writeSessionCache(path: string, session: CachedDeviceSession): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(session, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
}

export function clearSessionCache(path: string): void {
  rmSync(path, { force: true });
}
