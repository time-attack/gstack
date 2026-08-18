/**
 * `$B record` + JPEG/PNG frame encoding.
 *
 * Encode tests never launch a browser. The integration block launches one
 * Chromium like snapshot.test.ts and asserts start/stop produce an artifact.
 */

import { describe, test, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { startTestServer } from './test-server';
import { BrowserManager } from '../src/browser-manager';
import { handleWriteCommand as _handleWriteCommand } from '../src/write-commands';
import { handleMetaCommand } from '../src/meta-commands';
import {
  encodeFrameDirectory,
  ffmpegAvailable,
} from '../src/screencast-encode';
import { __resetRecordingForTests, recordingStatus } from '../src/screencast';
import { META_COMMANDS, COMMAND_DESCRIPTIONS } from '../src/commands';
import { SCOPE_READ } from '../src/token-registry';

const handleWriteCommand = (cmd: string, args: string[], b: BrowserManager) =>
  _handleWriteCommand(cmd, args, b.getActiveSession(), b);

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe('record command registry', () => {
  test('record is a meta command with a description', () => {
    expect(META_COMMANDS.has('record')).toBe(true);
    expect(COMMAND_DESCRIPTIONS.record?.usage).toContain('record start');
    expect(SCOPE_READ.has('record')).toBe(true);
  });
});

describe('encodeFrameDirectory', () => {
  test('writes an HTML player when ffmpeg is missing or frames are dummy bytes', () => {
    const dir = tmpDir('gstack-enc-');
    fs.writeFileSync(path.join(dir, 'frame_000001.jpg'), Buffer.from('not-a-real-jpeg'));
    fs.writeFileSync(path.join(dir, 'frame_000002.jpg'), Buffer.from('also-fake'));
    const out = path.join(dir, 'out.mp4');
    const result = encodeFrameDirectory(dir, out, 8);
    expect(result.frameCount).toBe(2);
    expect(fs.existsSync(result.artifactPath)).toBe(true);
    expect(result.kind === 'html' || result.kind === 'mp4' || result.kind === 'webm').toBe(true);
    if (result.kind === 'html') {
      const html = fs.readFileSync(result.artifactPath, 'utf-8');
      expect(html).toContain('frame_000001.jpg');
      expect(html).toContain('gstack recording');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('accepts PNG frames from the iOS poller', () => {
    const dir = tmpDir('gstack-enc-png-');
    fs.writeFileSync(path.join(dir, 'frame_000001.png'), Buffer.from('png-bytes'));
    const result = encodeFrameDirectory(dir, path.join(dir, 'out.mp4'), 4);
    expect(result.frameCount).toBe(1);
    expect(fs.existsSync(result.artifactPath)).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('throws when the frame directory is empty', () => {
    const dir = tmpDir('gstack-enc-empty-');
    expect(() => encodeFrameDirectory(dir, path.join(dir, 'out.mp4'), 8)).toThrow(/No recording frames/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('ffmpegAvailable is a boolean probe', () => {
    expect(typeof ffmpegAvailable()).toBe('boolean');
  });
});

describe('$B record integration', () => {
  let testServer: ReturnType<typeof startTestServer>;
  let bm: BrowserManager;
  let baseUrl: string;
  const shutdown = async () => {};

  beforeAll(async () => {
    testServer = startTestServer(0);
    baseUrl = testServer.url;
    bm = new BrowserManager();
    await bm.launch();
  });

  afterAll(async () => {
    try { testServer.server.stop(); } catch {}
    try { await Promise.race([bm?.close(), new Promise((resolve) => setTimeout(resolve, 3000))]); } catch {}
  });

  afterEach(async () => {
    try {
      if (recordingStatus().active) {
        await handleMetaCommand('record', ['stop'], bm, shutdown);
      }
    } catch {
      // ignore — reset below
    }
    __resetRecordingForTests();
  });

  test('start without a page fails closed', async () => {
    const fresh = new BrowserManager();
    await fresh.launch();
    try {
      await fresh.closeAllPages();
      await expect(handleMetaCommand('record', ['start'], fresh, shutdown))
        .rejects.toThrow(/No active page/);
    } finally {
      try { await Promise.race([fresh.close(), new Promise((resolve) => setTimeout(resolve, 3000))]); } catch {}
    }
  });

  test('start then stop writes a RECORDING artifact', async () => {
    await handleWriteCommand('goto', [baseUrl + '/basic.html'], bm);
    const dir = tmpDir('gstack-rec-');
    const out = path.join(dir, 'walk.mp4');
    const started = await handleMetaCommand('record', ['start', out, '--fps', '4'], bm, shutdown);
    expect(started).toContain('Recording started');
    expect(recordingStatus().active).toBe(true);

    await handleWriteCommand('reload', [], bm);
    await Bun.sleep(400);

    const stopped = await handleMetaCommand('record', ['stop'], bm, shutdown);
    expect(stopped).toMatch(/^RECORDING: /m);
    expect(recordingStatus().active).toBe(false);
    const artifact = stopped.split('\n')[0].replace(/^RECORDING:\s*/, '');
    expect(fs.existsSync(artifact)).toBe(true);
    expect(fs.statSync(artifact).size).toBeGreaterThan(20);
    fs.rmSync(dir, { recursive: true, force: true });
    const framesDir = recordingStatus().framesDir;
    if (framesDir && fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
  });

  test('stop without start throws', async () => {
    await expect(handleMetaCommand('record', ['stop'], bm, shutdown))
      .rejects.toThrow(/Not recording/);
  });

  test('unknown start flag throws', async () => {
    await handleWriteCommand('goto', [baseUrl + '/basic.html'], bm);
    await expect(handleMetaCommand('record', ['start', '--bogus'], bm, shutdown))
      .rejects.toThrow(/Unknown record start flag/);
  });

  test('status is JSON', async () => {
    const raw = await handleMetaCommand('record', ['status'], bm, shutdown);
    const parsed = JSON.parse(raw);
    expect(parsed.active).toBe(false);
  });
});
