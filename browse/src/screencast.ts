/**
 * `$B record start|stop|status|open` — capture a Chromium screencast of the
 * agent driving the page, encode it, and optionally open it for the user.
 *
 * Uses CDP Page.startScreencast through the cdp-bridge helpers (never a
 * raw newCDPSession). Frames go to a temp directory as JPEGs; encode is
 * ffmpeg-if-present, HTML player otherwise (screencast-encode.ts).
 *
 * Not on the pair-agent tunnel allowlist: a continuous capture is a
 * larger exfil surface than a single screenshot.
 */

import type { Page } from 'playwright';
import type { BrowserManager } from './browser-manager';
import { getOrCreateCdpSession } from './cdp-bridge';
import { mkdirSecure } from './file-permissions';
import { validateOutputPath } from './path-security';
import { TEMP_DIR } from './platform';
import {
  defaultRecordingPath,
  encodeFrameDirectory,
  openArtifact,
  type EncodeResult,
} from './screencast-encode';
import * as fs from 'fs';
import * as path from 'path';

const DEFAULT_FPS = 8;
const DEFAULT_QUALITY = 60;
const MAX_FRAMES = 7200; // 15 min at 8 fps
const MAX_DURATION_MS = 15 * 60 * 1000;
const MIN_FRAME_GAP_MS = 40; // drop CDP frames faster than ~25 fps

const sessionCache: WeakMap<Page, any> = new WeakMap();

export interface RecordingStatus {
  active: boolean;
  outputPath?: string;
  framesDir?: string;
  frameCount?: number;
  elapsedMs?: number;
  fps?: number;
  lastArtifact?: string;
}

interface ActiveRecording {
  page: Page;
  session: any;
  framesDir: string;
  outputPath: string;
  fps: number;
  startedAt: number;
  frameCount: number;
  lastKeptAt: number;
  onFrame: (params: { data: string; sessionId: number }) => void;
}

let active: ActiveRecording | null = null;
let lastArtifact: string | null = null;

export function getLastArtifact(): string | null {
  return lastArtifact;
}

export function recordingStatus(): RecordingStatus {
  if (!active) {
    return { active: false, lastArtifact: lastArtifact ?? undefined };
  }
  return {
    active: true,
    outputPath: active.outputPath,
    framesDir: active.framesDir,
    frameCount: active.frameCount,
    elapsedMs: Date.now() - active.startedAt,
    fps: active.fps,
    lastArtifact: lastArtifact ?? undefined,
  };
}

function parseStartArgs(args: string[]): { outputPath: string; fps: number; quality: number } {
  let outputPath = defaultRecordingPath();
  let fps = DEFAULT_FPS;
  let quality = DEFAULT_QUALITY;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--fps') {
      const n = Number(args[++i]);
      if (!Number.isFinite(n) || n < 1 || n > 30) throw new Error('record start: --fps must be 1-30');
      fps = Math.round(n);
    } else if (a === '--quality') {
      const n = Number(args[++i]);
      if (!Number.isFinite(n) || n < 1 || n > 100) throw new Error('record start: --quality must be 1-100');
      quality = Math.round(n);
    } else if (a.startsWith('--')) {
      throw new Error(`Unknown record start flag: ${a}`);
    } else {
      outputPath = a;
    }
  }
  return { outputPath, fps, quality };
}

async function ackFrame(session: any, sessionId: number): Promise<void> {
  try {
    await session.send('Page.screencastFrameAck', { sessionId });
  } catch {
    // Page may have navigated or the session detached. Drop the ack.
  }
}

export async function startRecording(
  bm: BrowserManager,
  args: string[],
): Promise<string> {
  if (active) {
    throw new Error(`Already recording to ${active.outputPath}. Run: record stop`);
  }

  const page = bm.getPage();
  const { outputPath, fps, quality } = parseStartArgs(args);
  validateOutputPath(outputPath);

  const stamp = Date.now();
  const framesDir = path.join(TEMP_DIR, `gstack-recording-frames-${stamp}`);
  mkdirSecure(framesDir);
  const outDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outDir)) mkdirSecure(outDir);

  const session = await getOrCreateCdpSession(page, sessionCache);
  const rec: ActiveRecording = {
    page,
    session,
    framesDir,
    outputPath,
    fps,
    startedAt: stamp,
    frameCount: 0,
    lastKeptAt: 0,
    onFrame: () => {},
  };

  rec.onFrame = (params) => {
    void (async () => {
      await ackFrame(session, params.sessionId);
      if (active !== rec) return;
      const now = Date.now();
      if (now - rec.startedAt > MAX_DURATION_MS) {
        void stopRecording({ open: false }).catch(() => {});
        return;
      }
      const minGap = Math.max(MIN_FRAME_GAP_MS, Math.round(1000 / rec.fps));
      if (rec.lastKeptAt && now - rec.lastKeptAt < minGap) return;
      if (rec.frameCount >= MAX_FRAMES) {
        void stopRecording({ open: false }).catch(() => {});
        return;
      }
      rec.lastKeptAt = now;
      rec.frameCount += 1;
      const file = path.join(rec.framesDir, `frame_${String(rec.frameCount).padStart(6, '0')}.jpg`);
      try {
        fs.writeFileSync(file, Buffer.from(params.data, 'base64'));
      } catch {
        rec.frameCount -= 1;
      }
    })();
  };

  session.on('Page.screencastFrame', rec.onFrame);
  await session.send('Page.startScreencast', {
    format: 'jpeg',
    quality,
    everyNthFrame: 1,
  });
  active = rec;

  return `Recording started → ${outputPath}\nFrames: ${framesDir}\nStop with: record stop [--open]`;
}

export async function stopRecording(opts: { open?: boolean; keepFrames?: boolean } = {}): Promise<string> {
  const rec = active;
  if (!rec) {
    throw new Error(lastArtifact
      ? `Not recording. Last recording: ${lastArtifact}`
      : 'Not recording. Start with: record start [path]');
  }
  active = null;

  try {
    if (typeof rec.session.off === 'function') rec.session.off('Page.screencastFrame', rec.onFrame);
    else if (typeof rec.session.removeListener === 'function') rec.session.removeListener('Page.screencastFrame', rec.onFrame);
    await rec.session.send('Page.stopScreencast');
  } catch {
    // Session may already be dead; still encode whatever frames we have.
  }

  if (rec.frameCount === 0) {
    // Static pages sometimes emit no screencast frames. Grab one screenshot
    // so stop still produces an artifact.
    try {
      const buf = await rec.page.screenshot({ type: 'jpeg', quality: 70 });
      const file = path.join(rec.framesDir, 'frame_000001.jpg');
      fs.writeFileSync(file, buf);
      rec.frameCount = 1;
    } catch (err: any) {
      throw new Error(`Recording captured 0 frames and screenshot fallback failed: ${err?.message ?? err}`);
    }
  }

  const encoded: EncodeResult = encodeFrameDirectory(rec.framesDir, rec.outputPath, rec.fps);
  lastArtifact = encoded.artifactPath;

  if (!opts.keepFrames && encoded.kind !== 'html') {
    try {
      fs.rmSync(rec.framesDir, { recursive: true, force: true });
    } catch {
      // leave frames if cleanup fails
    }
  }

  const elapsed = ((Date.now() - rec.startedAt) / 1000).toFixed(1);
  const opened = opts.open ? openArtifact(encoded.artifactPath) : false;
  const lines = [
    `RECORDING: ${encoded.artifactPath}`,
    `kind=${encoded.kind} frames=${encoded.frameCount} elapsed=${elapsed}s ffmpeg=${encoded.ffmpeg}`,
  ];
  if (opts.open) lines.push(opened ? 'Opened in the local viewer.' : 'Could not open the viewer; open the RECORDING path yourself.');
  return lines.join('\n');
}

export async function flushRecordingOnShutdown(): Promise<void> {
  if (!active) return;
  try {
    await stopRecording({ open: false });
  } catch {
    active = null;
  }
}

export async function handleRecordCommand(args: string[], bm: BrowserManager): Promise<string> {
  const action = args[0];
  const rest = args.slice(1);
  if (!action || action === 'help' || action === '--help') {
    throw new Error('Usage: record start [path] [--fps N] [--quality Q] | record stop [--open] [--keep-frames] | record status | record open [path]');
  }

  if (action === 'start') {
    return startRecording(bm, rest);
  }
  if (action === 'stop') {
    const open = rest.includes('--open');
    const keepFrames = rest.includes('--keep-frames');
    const unknown = rest.filter((a) => a.startsWith('--') && a !== '--open' && a !== '--keep-frames');
    if (unknown.length) throw new Error(`Unknown record stop flag: ${unknown[0]}`);
    return stopRecording({ open, keepFrames });
  }
  if (action === 'status') {
    return JSON.stringify(recordingStatus(), null, 2);
  }
  if (action === 'open') {
    const target = rest[0] || lastArtifact;
    if (!target) throw new Error('No recording to open. Pass a path or run record stop --open.');
    validateOutputPath(target);
    const ok = openArtifact(target);
    return ok ? `Opened: ${target}` : `Could not open: ${target}`;
  }

  throw new Error(`Unknown record action: ${action}. Use start, stop, status, or open.`);
}

/** Test-only: drop in-memory recording state. Does not delete files. */
export function __resetRecordingForTests(): void {
  active = null;
  lastArtifact = null;
}
