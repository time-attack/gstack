/**
 * PostHog analytics — fire-and-forget wrapper for gstack browse telemetry.
 *
 * Uses posthog-node with flushAt:1 / flushInterval:0 so every event flushes
 * immediately. This is correct for CLI/daemon processes that may exit
 * at any time; there is no long-lived request context to batch across.
 *
 * Device identity: a stable anonymous ID persisted in ~/.gstack/device-id.
 * No user PII — hostname hash only.
 *
 * Disabled when GSTACK_TELEMETRY_OFF=1 is set, matching the existing
 * local telemetry gate in telemetry.ts.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { PostHog } from 'posthog-node';

function gstackHome(): string {
  return process.env.GSTACK_HOME || path.join(os.homedir(), '.gstack');
}

function isDisabled(): boolean {
  return process.env.GSTACK_TELEMETRY_OFF === '1';
}

let _client: PostHog | null = null;
let _deviceId: string | null = null;
let _shutdownRegistered = false;

function getDeviceId(): string {
  if (_deviceId) return _deviceId;
  const idFile = path.join(gstackHome(), 'device-id');
  try {
    const existing = fs.readFileSync(idFile, 'utf-8').trim();
    if (existing) {
      _deviceId = existing;
      return existing;
    }
  } catch {
    // File doesn't exist yet — generate one
  }
  const id = 'device-' + crypto.createHash('sha256')
    .update(os.hostname() + os.homedir())
    .digest('hex')
    .slice(0, 16);
  try {
    fs.mkdirSync(path.dirname(idFile), { recursive: true });
    fs.writeFileSync(idFile, id + '\n', { mode: 0o600 });
  } catch {
    // Best effort — don't crash if we can't persist
  }
  _deviceId = id;
  return id;
}

function getClient(): PostHog | null {
  if (isDisabled()) return null;
  if (_client) return _client;

  const apiKey = process.env.POSTHOG_API_KEY;
  const host = process.env.POSTHOG_HOST || 'https://us.i.posthog.com';
  if (!apiKey) return null;

  _client = new PostHog(apiKey, {
    host,
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: true,
  });

  if (!_shutdownRegistered) {
    _shutdownRegistered = true;
    // Use beforeExit so async shutdown can complete. Do NOT add SIGINT/SIGTERM
    // handlers here — server.ts already registers its own graceful-shutdown
    // handlers; adding ours would conflict and call process.exit prematurely.
    process.on('beforeExit', () => {
      _client?.flush().catch(() => {});
    });
  }

  return _client;
}

/** Fire-and-forget capture. Never throws. */
export function capture(event: string, properties?: Record<string, unknown>): void {
  try {
    const client = getClient();
    if (!client) return;
    client.capture({
      distinctId: getDeviceId(),
      event,
      properties: properties ?? {},
    });
  } catch {
    // Analytics must never crash the caller
  }
}

/** Capture an exception. Never throws. */
export function captureException(err: unknown, properties?: Record<string, unknown>): void {
  try {
    const client = getClient();
    if (!client) return;
    client.captureException(err, getDeviceId(), properties);
  } catch {
    // Analytics must never crash the caller
  }
}
