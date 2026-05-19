/**
 * Cross-platform file permission restriction for sensitive gstack state.
 *
 * Why this exists
 * ----------------
 * POSIX mode bits (`0o600` for files, `0o700` for dirs) are how gstack marks
 * sensitive state files — auth tokens, canary tokens, chat history, agent
 * queue, device salt, per-tab security decisions. On Linux and macOS,
 * `fs.chmodSync(path, 0o600)` and `fs.writeFileSync(path, data, { mode: 0o600 })`
 * do exactly what you'd hope: the file ends up readable and writable only
 * by the owning user, no access for group / other.
 *
 * On Windows, both calls are effectively no-ops. NTFS uses ACLs, not POSIX
 * mode bits, and Node's fs module doesn't translate. So on every Windows
 * install, sensitive gstack state files inherit whatever ACL the parent
 * directory grants — typically user-full + inherited admin-full. That's
 * fine on a single-user laptop but leaks on:
 *
 *   - Self-hosted CI runners (GitHub Actions / GitLab / Jenkins agents
 *     running as a different service account on the same box — they can
 *     read developer state)
 *   - Shared development machines (agencies, studios, lab machines)
 *   - Multi-tenant servers with shared home directories
 *   - Malware running as the same user (no in-user-account isolation)
 *
 * This module wraps the platform-correct call. POSIX: chmod. Windows:
 * icacls with inheritance break + explicit user grant. Failures on either
 * platform are best-effort — the filesystem is still functional if ACL
 * restriction fails; we just don't hit the intended hardening target.
 *
 * Warning behavior: to avoid spamming the console on a machine where
 * icacls is unavailable (rare — it ships in System32 on every Windows
 * version since 7), we log the first failure per process and stay silent
 * afterward. The warning includes the advice "sensitive files may be
 * readable by other accounts on this machine" so operators know to audit
 * their runner / share setup.
 */

import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let warnedOnce = false;

/**
 * Resolve an unambiguous icacls principal for the account this process runs as.
 *
 * `os.userInfo().username` returns the bare login name (e.g. "lmiller"). On a
 * domain-joined Windows box that also has a *local* account of the same name,
 * `icacls /grant lmiller:...` resolves the bare name to the LOCAL account
 * (e.g. OFC01\lmiller), NOT the domain account the process actually runs as
 * (e.g. INTEGRIBILT\lmiller). Combined with `/inheritance:r`, that hands the
 * new ACL to an account this process is *not*, locking the process out of the
 * directory it just created — the daemon then can't create its state/lock file
 * and startup fails. See INT-50 / INT-48.
 *
 * Fix: grant to the current process token's SID, which is immune to
 * local-vs-domain name collisions. Fall back to USERDOMAIN\username, then the
 * bare username, if the SID lookup is unavailable. Cached per process.
 */
let cachedIcaclsPrincipal: string | undefined;
function currentUserIcaclsPrincipal(): string {
  if (cachedIcaclsPrincipal !== undefined) return cachedIcaclsPrincipal;
  try {
    // Call System32's whoami.exe by absolute path. A bare 'whoami' can resolve
    // to a shadowing binary earlier on PATH (e.g. Git-for-Windows' Unix
    // `whoami`, which rejects `/user`), which would force the weaker name-based
    // fallback below. The absolute path guarantees we get the real SID.
    const systemRoot = process.env.SystemRoot || process.env.windir || 'C:\\Windows';
    const whoamiExe = `${systemRoot}\\System32\\whoami.exe`;
    const out = execFileSync(whoamiExe, ['/user', '/fo', 'csv', '/nh'], {
      encoding: 'utf8',
    }).trim();
    // Format: "DOMAIN\user","S-1-5-21-..."
    const m = out.match(/"[^"]*","(S-[0-9-]+)"/);
    if (m) {
      // icacls accepts a SID literal when prefixed with '*'.
      cachedIcaclsPrincipal = `*${m[1]}`;
      return cachedIcaclsPrincipal;
    }
  } catch {
    /* fall through to name-based resolution */
  }
  const username = os.userInfo().username;
  const domain = process.env.USERDOMAIN;
  cachedIcaclsPrincipal = domain ? `${domain}\\${username}` : username;
  return cachedIcaclsPrincipal;
}

function warnIcaclsFailure(fsPath: string, err: unknown): void {
  if (warnedOnce) return;
  warnedOnce = true;
  const msg = err instanceof Error ? err.message : String(err);
  // biome-ignore lint/suspicious/noConsole: intentional user-facing warning
  console.warn(
    `[gstack] Failed to restrict Windows ACL on ${fsPath}: ${msg}\n` +
    `  Sensitive files may be readable by other accounts on this machine.\n` +
    `  This warning appears once per process; subsequent failures are silent.`
  );
}

/**
 * Restrict a file to owner-only access (POSIX 0o600 equivalent).
 *
 * POSIX: `fs.chmodSync(path, 0o600)`. Idempotent if the file was already
 * written with `{ mode: 0o600 }`, so safe to call regardless.
 *
 * Windows: invokes `icacls /inheritance:r /grant:r <user>:(F)` to remove
 * any inherited ACLs and replace the ACL with a single entry granting the
 * current user full control.
 */
export function restrictFilePermissions(filePath: string): void {
  if (process.platform === 'win32') {
    try {
      const user = currentUserIcaclsPrincipal();
      execFileSync(
        'icacls',
        [filePath, '/inheritance:r', '/grant:r', `${user}:(F)`],
        { stdio: 'ignore', windowsHide: true },
      );
    } catch (err) {
      warnIcaclsFailure(filePath, err);
    }
    return;
  }
  try { fs.chmodSync(filePath, 0o600); } catch { /* best-effort */ }
}

/**
 * Restrict a directory to owner-only access (POSIX 0o700 equivalent),
 * with new children inheriting the restricted ACL.
 *
 * POSIX: `fs.chmodSync(path, 0o700)`. Idempotent if the dir was already
 * created with `{ mode: 0o700 }`.
 *
 * Windows: `icacls /inheritance:r /grant:r <user>:(OI)(CI)(F)`. The
 * `(OI)(CI)` flags make new files (OI = object inherit) and subdirs
 * (CI = container inherit) inherit the single-user-full ACL — important
 * because child creations in `fs.writeFileSync(...)` without explicit
 * `restrictFilePermissions` still end up owner-only.
 */
export function restrictDirectoryPermissions(dirPath: string): void {
  if (process.platform === 'win32') {
    try {
      const user = currentUserIcaclsPrincipal();
      execFileSync(
        'icacls',
        [dirPath, '/inheritance:r', '/grant:r', `${user}:(OI)(CI)(F)`],
        { stdio: 'ignore', windowsHide: true },
      );
    } catch (err) {
      warnIcaclsFailure(dirPath, err);
    }
    return;
  }
  try { fs.chmodSync(dirPath, 0o700); } catch { /* best-effort */ }
}

/**
 * Write a file and restrict it to owner-only access, cross-platform.
 * Replaces `fs.writeFileSync(path, data, { mode: 0o600 })` + Windows ACL.
 */
export function writeSecureFile(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
): void {
  fs.writeFileSync(filePath, data, { mode: 0o600 });
  restrictFilePermissions(filePath);
}

/**
 * Atomically write a file and restrict it to owner-only access, cross-platform.
 *
 * `writeSecureFile` writes in place, so a crash (or a concurrent reader)
 * mid-write can observe a truncated/half-written file. For state that is
 * rewritten repeatedly by a long-lived daemon — e.g. the auto-cookie state,
 * which checkpoints on every mutating command — a torn write means the next
 * load reads corrupt JSON and silently drops a live auth cookie. This variant
 * writes to a same-directory temp file (owner-only), best-effort fsyncs it,
 * then `rename`s over the destination. `rename` within a directory is atomic
 * on POSIX and on NTFS (ReplaceFile semantics via Node), so a reader sees
 * either the old file or the new one, never a partial.
 *
 * Same-directory is load-bearing: a temp file on another filesystem would make
 * `rename` fall back to copy+unlink, which is NOT atomic. The temp name embeds
 * the pid plus random bytes so racing writes never share a staging path (the
 * destination itself still needs a lock — this only guarantees each write is
 * individually atomic).
 */
export function writeSecureFileAtomic(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
): void {
  const dir = path.dirname(filePath);
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
  let fd: number | null = null;
  try {
    fd = fs.openSync(tmp, 'w', 0o600);
    fs.writeSync(fd, data as any);
    try { fs.fsyncSync(fd); } catch { /* fsync is best-effort — rename still gives atomicity */ }
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed / best-effort */ }
    }
  }
  // On Windows, openSync with mode does not set an ACL; restrict explicitly
  // before the rename so the destination never exists unrestricted.
  restrictFilePermissions(tmp);
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    // Rename failed — clean up the temp file so it doesn't accumulate.
    try { fs.unlinkSync(tmp); } catch { /* best-effort */ }
    throw err;
  }
}

/**
 * Append to a file with owner-only permissions, cross-platform.
 * Replaces `fs.appendFileSync(path, data, { mode: 0o600 })` + Windows ACL.
 *
 * ACL is applied only on first write — subsequent appends are fire-and-forget
 * (no need to re-run icacls on every log line).
 */
export function appendSecureFile(
  filePath: string,
  data: string | NodeJS.ArrayBufferView,
): void {
  const existed = fs.existsSync(filePath);
  fs.appendFileSync(filePath, data, { mode: 0o600 });
  if (!existed) restrictFilePermissions(filePath);
}

/**
 * `mkdir -p` with owner-only directory permissions, cross-platform.
 * Replaces `fs.mkdirSync(path, { recursive: true, mode: 0o700 })` + Windows ACL.
 * Safe to call on an existing directory — re-applies the ACL idempotently.
 *
 * Bun-on-Windows quirk: bun's compiled-binary fs.mkdirSync sometimes throws
 * EEXIST even with `recursive: true` when the directory already exists (Node
 * does not). Swallow that one case so callers don't have to wrap every
 * invocation.
 */
export function mkdirSecure(dirPath: string): void {
  try {
    fs.mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  } catch (err: any) {
    if (err && err.code === 'EEXIST') {
      const stat = fs.statSync(dirPath);
      if (!stat.isDirectory()) throw err;
      // Existing directory — fall through to re-apply ACL.
    } else {
      throw err;
    }
  }
  restrictDirectoryPermissions(dirPath);
}

/**
 * Reset the once-per-process warning gate. Test-only.
 */
export function __resetWarnedForTests(): void {
  warnedOnce = false;
}

/**
 * Resolve the icacls principal for the current process token. Test-only
 * accessor for the module-private `currentUserIcaclsPrincipal`; clears the
 * per-process cache first so each call observes a fresh resolution.
 */
export function __currentUserIcaclsPrincipalForTests(): string {
  cachedIcaclsPrincipal = undefined;
  const principal = currentUserIcaclsPrincipal();
  cachedIcaclsPrincipal = undefined;
  return principal;
}
