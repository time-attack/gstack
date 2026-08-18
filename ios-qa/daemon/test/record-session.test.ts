/**
 * iOS record-session poller: GET /screenshot → numbered PNG frames.
 * Does not require a phone. The encode path is covered in browse/test/screencast.test.ts.
 */

import { describe, test, expect, afterEach } from 'bun:test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { pollLoop, parseNamed, writeState, clearState } from '../../scripts/record-session';

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a4944415478da63000000020001e221bc330000000049454e44ae426082',
  'hex',
);

describe('record-session parseNamed', () => {
  test('parses daemon, fps, and boolean open', () => {
    expect(parseNamed(['--daemon', 'http://127.0.0.1:9', '--fps', '4', '--open'])).toEqual({
      daemon: 'http://127.0.0.1:9',
      fps: '4',
      open: true,
    });
  });
});

describe('record-session pollLoop', () => {
  const dirs: string[] = [];
  const previousHome = process.env.GSTACK_HOME;

  afterEach(() => {
    if (previousHome === undefined) delete process.env.GSTACK_HOME;
    else process.env.GSTACK_HOME = previousHome;
    for (const d of dirs) {
      try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
    }
    dirs.length = 0;
    try { clearState(); } catch {}
  });

  test('writes numbered PNG frames from the daemon screenshot endpoint', async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-ios-rec-home-'));
    const frames = fs.mkdtempSync(path.join(os.tmpdir(), 'gstack-ios-rec-frames-'));
    dirs.push(home, frames);
    process.env.GSTACK_HOME = home;

    let hits = 0;
    const server = Bun.serve({
      port: 0,
      fetch() {
        hits += 1;
        return new Response(PNG, { headers: { 'content-type': 'image/png' } });
      },
    });

    writeState({
      pid: process.pid,
      daemonUrl: `http://127.0.0.1:${server.port}`,
      token: null,
      framesDir: frames,
      outputPath: path.join(frames, 'out.mp4'),
      fps: 10,
      startedAt: Date.now(),
    });

    const poller = pollLoop({
      pid: process.pid,
      daemonUrl: `http://127.0.0.1:${server.port}`,
      token: null,
      framesDir: frames,
      outputPath: path.join(frames, 'out.mp4'),
      fps: 10,
      startedAt: Date.now(),
    });

    await Bun.sleep(250);
    clearState();
    await poller;
    server.stop(true);

    const pngs = fs.readdirSync(frames).filter((f) => f.endsWith('.png')).sort();
    expect(pngs.length).toBeGreaterThan(0);
    expect(pngs[0]).toBe('frame_000001.png');
    expect(hits).toBeGreaterThan(0);
  });
});
