#!/usr/bin/env bun
/**
 * Record a physical iPhone session by polling the ios-qa daemon's
 * GET /screenshot and encoding the frames (ffmpeg if present, HTML player
 * otherwise). Self-contained: the managed ios runtime does not ship browse/src.
 *
 *   bun ios-qa/scripts/record-session.ts start --daemon http://127.0.0.1:PORT [--token T] [--out PATH] [--fps 4]
 *   bun ios-qa/scripts/record-session.ts stop [--open]
 *   bun ios-qa/scripts/record-session.ts status
 *
 * `start` detaches a poller so the skill's next bash block can drive the
 * device. State lives at `$GSTACK_HOME/ios-qa-recording.json`.
 */

import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

interface RecordingState {
  pid: number;
  daemonUrl: string;
  token: string | null;
  framesDir: string;
  outputPath: string;
  fps: number;
  startedAt: number;
}

const TEMP_DIR = process.platform === 'win32' ? os.tmpdir() : '/tmp';

function homeDir(): string {
  return process.env.GSTACK_HOME || path.join(os.homedir(), '.gstack');
}

function statePath(): string {
  return path.join(homeDir(), 'ios-qa-recording.json');
}

function readState(): RecordingState | null {
  const p = statePath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8')) as RecordingState;
  } catch {
    return null;
  }
}

function writeState(state: RecordingState): void {
  fs.mkdirSync(homeDir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}

function clearState(): void {
  try { fs.unlinkSync(statePath()); } catch (err: any) {
    if (err?.code !== 'ENOENT') throw err;
  }
}

function parseNamed(args: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = args[i + 1];
    if (!next || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

function ffmpegAvailable(): boolean {
  try {
    return spawnSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 4000, windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

function listFrames(framesDir: string): string[] {
  if (!fs.existsSync(framesDir)) return [];
  return fs.readdirSync(framesDir).filter((f) => /^frame_\d{6}\.(png|jpe?g)$/i.test(f)).sort();
}

function encodeFrameDirectory(framesDir: string, outputPath: string, fps: number): {
  artifactPath: string; kind: 'mp4' | 'webm' | 'html'; frameCount: number; ffmpeg: boolean;
} {
  const frames = listFrames(framesDir);
  if (frames.length === 0) throw new Error(`No recording frames in ${framesDir}`);
  const ext = path.extname(outputPath).toLowerCase();
  const videoPath = ext === '.webm' || ext === '.mp4' ? outputPath : outputPath.replace(/\.[^.]+$/, '') + '.mp4';
  const pattern = frames[0].endsWith('.png') ? 'frame_%06d.png' : 'frame_%06d.jpg';
  if (ffmpegAvailable()) {
    const input = path.join(framesDir, pattern);
    const r = spawnSync('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', input,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', videoPath,
    ], { stdio: 'ignore', timeout: 120_000, windowsHide: true });
    if (r.status === 0 && fs.existsSync(videoPath) && fs.statSync(videoPath).size > 0) {
      return { artifactPath: videoPath, kind: 'mp4', frameCount: frames.length, ffmpeg: true };
    }
  }
  const htmlPath = path.join(framesDir, 'player.html');
  const rel = frames.map((f) => path.basename(f));
  fs.writeFileSync(htmlPath, `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>gstack recording</title></head><body><img id="f"><script>
const frames=${JSON.stringify(rel)}; const fps=${fps}; let i=0;
setInterval(()=>{if(!frames.length)return; i=(i+1)%frames.length; document.getElementById('f').src=frames[i];}, Math.max(20, Math.round(1000/fps)));
if(frames[0]) document.getElementById('f').src=frames[0];
</script></body></html>`);
  return { artifactPath: htmlPath, kind: 'html', frameCount: frames.length, ffmpeg: false };
}

function openArtifact(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return false;
  const cmd = process.platform === 'darwin' ? ['open', resolved]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', resolved]
    : ['xdg-open', resolved];
  try {
    return spawnSync(cmd[0], cmd.slice(1), { stdio: 'ignore', timeout: 8000, windowsHide: true }).status === 0;
  } catch {
    return false;
  }
}

async function fetchScreenshot(daemonUrl: string, token: string | null): Promise<Buffer> {
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${daemonUrl.replace(/\/$/, '')}/screenshot`, { headers });
  if (!res.ok) throw new Error(`GET /screenshot ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function pollLoop(state: RecordingState): Promise<void> {
  fs.mkdirSync(state.framesDir, { recursive: true });
  const interval = Math.max(50, Math.round(1000 / state.fps));
  let n = 0;
  const maxFrames = 3600;
  const deadline = state.startedAt + 15 * 60 * 1000;
  while (Date.now() < deadline && n < maxFrames) {
    if (!fs.existsSync(statePath())) break;
    try {
      const buf = await fetchScreenshot(state.daemonUrl, state.token);
      n += 1;
      fs.writeFileSync(path.join(state.framesDir, `frame_${String(n).padStart(6, '0')}.png`), buf);
    } catch {
      // Device may be mid-action; skip this tick.
    }
    await Bun.sleep(interval);
  }
}

function start(args: string[]): string {
  if (readState()) throw new Error('Already recording. Run: record-session.ts stop');
  const flags = parseNamed(args);
  const daemon = flags.daemon;
  if (typeof daemon !== 'string' || !daemon) {
    throw new Error('Usage: record-session.ts start --daemon http://127.0.0.1:PORT [--token T] [--out PATH] [--fps 4]');
  }
  const fps = flags.fps ? Number(flags.fps) : 4;
  if (!Number.isFinite(fps) || fps < 1 || fps > 15) throw new Error('--fps must be 1-15');
  const outputPath = typeof flags.out === 'string' ? flags.out : path.join(TEMP_DIR, `gstack-recording-${Date.now()}.mp4`);
  const token = typeof flags.token === 'string' ? flags.token : null;
  const stamp = Date.now();
  const framesDir = path.join(TEMP_DIR, `gstack-ios-recording-frames-${stamp}`);
  fs.mkdirSync(framesDir, { recursive: true });
  const outDir = path.dirname(path.resolve(outputPath));
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const child = spawn(process.execPath, [import.meta.path, 'poll'], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  if (!child.pid) throw new Error('Failed to detach iOS recording poller');

  writeState({
    pid: child.pid,
    daemonUrl: daemon,
    token,
    framesDir,
    outputPath,
    fps: Math.round(fps),
    startedAt: stamp,
  });
  return `iOS recording started (pid ${child.pid}) → ${outputPath}\nStop with: record-session.ts stop [--open]`;
}

function stop(args: string[]): string {
  const state = readState();
  if (!state) throw new Error('Not recording. Start with: record-session.ts start --daemon URL');
  const flags = parseNamed(args);
  try { process.kill(state.pid, 'SIGTERM'); } catch (err: any) {
    if (err?.code !== 'ESRCH') throw err;
  }
  clearState();

  const encoded = encodeFrameDirectory(state.framesDir, state.outputPath, state.fps);
  if (encoded.kind !== 'html') {
    try { fs.rmSync(state.framesDir, { recursive: true, force: true }); } catch { /* leave frames */ }
  }
  const opened = flags.open ? openArtifact(encoded.artifactPath) : false;
  const lines = [
    `RECORDING: ${encoded.artifactPath}`,
    `kind=${encoded.kind} frames=${encoded.frameCount} ffmpeg=${encoded.ffmpeg}`,
  ];
  if (flags.open) lines.push(opened ? 'Opened in the local viewer.' : 'Could not open the viewer; open the RECORDING path yourself.');
  return lines.join('\n');
}

function status(): string {
  const state = readState();
  if (!state) return JSON.stringify({ active: false }, null, 2);
  return JSON.stringify({
    active: true,
    pid: state.pid,
    outputPath: state.outputPath,
    framesDir: state.framesDir,
    fps: state.fps,
    elapsedMs: Date.now() - state.startedAt,
  }, null, 2);
}

async function main(): Promise<void> {
  const [action, ...rest] = process.argv.slice(2);
  try {
    if (action === 'poll') {
      const state = readState();
      if (!state) return;
      await pollLoop(state);
      return;
    }
    if (action === 'start') {
      console.log(start(rest));
      return;
    }
    if (action === 'stop') {
      console.log(stop(rest));
      return;
    }
    if (action === 'status') {
      console.log(status());
      return;
    }
    throw new Error('Usage: record-session.ts start --daemon URL | stop [--open] | status');
  } catch (err: any) {
    console.error(err?.message ?? err);
    process.exit(1);
  }
}

export { parseNamed, start, stop, status, readState, writeState, clearState, statePath, pollLoop };

if (import.meta.main) {
  void main();
}
