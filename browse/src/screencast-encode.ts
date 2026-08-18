/**
 * Encode a JPEG frame directory into a playable recording, and open it.
 *
 * ffmpeg is optional. When it is missing or fails, we write a self-contained
 * HTML player that steps through the frames at the captured fps so the user
 * still gets something they can open. No Playwright, no CDP.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { TEMP_DIR } from './platform';

export const FRAME_PATTERN_JPG = 'frame_%06d.jpg';
export const FRAME_PATTERN_PNG = 'frame_%06d.png';

export interface EncodeResult {
  artifactPath: string;
  kind: 'mp4' | 'webm' | 'html';
  frameCount: number;
  ffmpeg: boolean;
}

function listFrames(framesDir: string): { files: string[]; pattern: string } {
  if (!fs.existsSync(framesDir)) return { files: [], pattern: FRAME_PATTERN_JPG };
  const names = fs.readdirSync(framesDir);
  const jpgs = names.filter((f) => /^frame_\d{6}\.jpe?g$/i.test(f)).sort();
  if (jpgs.length) return { files: jpgs, pattern: FRAME_PATTERN_JPG };
  const pngs = names.filter((f) => /^frame_\d{6}\.png$/i.test(f)).sort();
  return { files: pngs, pattern: FRAME_PATTERN_PNG };
}

/** True when `ffmpeg` is on PATH. Pure probe — never throws. */
export function ffmpegAvailable(): boolean {
  try {
    const r = spawnSync('ffmpeg', ['-version'], {
      stdio: 'ignore',
      timeout: 4000,
      windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

function writeHtmlPlayer(framesDir: string, frames: string[], fps: number, dest: string): void {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 8;
  const relFrames = frames.map((f) => path.basename(f));
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>gstack recording</title>
  <style>
    body { margin: 0; background: #111; color: #eee; font: 14px/1.4 system-ui, sans-serif; }
    main { max-width: 1100px; margin: 0 auto; padding: 16px; }
    img { width: 100%; background: #000; display: block; }
    .bar { display: flex; gap: 12px; align-items: center; margin-top: 12px; }
    button { font: inherit; padding: 6px 12px; }
  </style>
</head>
<body>
<main>
  <img id="frame" alt="recording frame">
  <div class="bar">
    <button id="toggle" type="button">Pause</button>
    <span id="meta"></span>
  </div>
</main>
<script>
const frames = ${JSON.stringify(relFrames)};
const fps = ${safeFps};
let i = 0;
let playing = true;
const img = document.getElementById('frame');
const meta = document.getElementById('meta');
const toggle = document.getElementById('toggle');
function show() {
  if (!frames.length) { meta.textContent = 'No frames'; return; }
  img.src = frames[i];
  meta.textContent = (i + 1) + ' / ' + frames.length + ' @ ' + fps + ' fps';
}
function tick() {
  if (!playing || frames.length === 0) return;
  i = (i + 1) % frames.length;
  show();
}
toggle.addEventListener('click', () => {
  playing = !playing;
  toggle.textContent = playing ? 'Pause' : 'Play';
});
show();
setInterval(tick, Math.max(20, Math.round(1000 / fps)));
</script>
</body>
</html>
`;
  fs.writeFileSync(dest, html);
}

function runFfmpeg(framesDir: string, fps: number, outputPath: string, pattern: string): boolean {
  const input = path.join(framesDir, pattern);
  const attempts: string[][] = [
    ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', input,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath],
    ['-y', '-hide_banner', '-loglevel', 'error', '-framerate', String(fps), '-i', input,
      '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', outputPath],
  ];
  for (const args of attempts) {
    try {
      const r = spawnSync('ffmpeg', args, {
        stdio: 'ignore',
        timeout: 120_000,
        windowsHide: true,
      });
      if (r.status === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return true;
      }
    } catch {
      // try next encoder
    }
  }
  return false;
}

/**
 * Turn numbered JPEG frames into a playable artifact next to `outputPath`.
 * Prefers mp4 via ffmpeg; falls back to an HTML player in the frame directory.
 */
export function encodeFrameDirectory(
  framesDir: string,
  outputPath: string,
  fps: number,
): EncodeResult {
  const { files: frames, pattern } = listFrames(framesDir);
  if (frames.length === 0) {
    throw new Error(`No recording frames in ${framesDir}`);
  }

  const ext = path.extname(outputPath).toLowerCase();
  const videoPath = ext === '.webm' || ext === '.mp4' ? outputPath : outputPath.replace(/\.[^.]+$/, '') + '.mp4';

  if (ffmpegAvailable() && runFfmpeg(framesDir, fps, videoPath, pattern)) {
    const kind = path.extname(videoPath).toLowerCase() === '.webm' ? 'webm' : 'mp4';
    return { artifactPath: videoPath, kind, frameCount: frames.length, ffmpeg: true };
  }

  const htmlPath = path.join(framesDir, 'player.html');
  writeHtmlPlayer(framesDir, frames, fps, htmlPath);
  return { artifactPath: htmlPath, kind: 'html', frameCount: frames.length, ffmpeg: false };
}

/** Open a file with the platform viewer. Best-effort; never throws. */
export function openArtifact(filePath: string): boolean {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return false;
  const cmd =
    process.platform === 'darwin' ? ['open', resolved]
    : process.platform === 'win32' ? ['cmd', '/c', 'start', '', resolved]
    : ['xdg-open', resolved];
  try {
    const r = spawnSync(cmd[0], cmd.slice(1), {
      stdio: 'ignore',
      timeout: 8000,
      windowsHide: true,
    });
    return r.status === 0;
  } catch {
    return false;
  }
}

export function defaultRecordingPath(stamp = Date.now()): string {
  return path.join(TEMP_DIR, `gstack-recording-${stamp}.mp4`);
}
