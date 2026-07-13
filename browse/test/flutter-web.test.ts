/**
 * Flutter Web support tests
 *
 * Tests: Flutter detection, semantics enablement, ref assignment,
 * button click, text input fill, and text content reading.
 */

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startTestServer } from './test-server';
import { BrowserManager } from '../src/browser-manager';
import { handleReadCommand as _handleReadCommand } from '../src/read-commands';
import { handleWriteCommand as _handleWriteCommand } from '../src/write-commands';
import { handleMetaCommand } from '../src/meta-commands';

const handleReadCommand = (cmd: string, args: string[], b: BrowserManager) =>
  _handleReadCommand(cmd, args, b.getActiveSession());
const handleWriteCommand = (cmd: string, args: string[], b: BrowserManager) =>
  _handleWriteCommand(cmd, args, b.getActiveSession(), b);

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
  // Close only this file's own browser — never process.exit(): bun test runs
  // all files in one process (see test/no-suicide-exit.test.ts). Race close()
  // at 3s and abandon; the child is reaped at process exit.
  try { await Promise.race([bm?.close(), new Promise((resolve) => setTimeout(resolve, 3000))]); } catch {}
});

// ─── Flutter Web Detection ─────────────────────────────────────

describe('Flutter Web', () => {
  test('snapshot detects Flutter and enables semantics', async () => {
    await handleWriteCommand('goto', [baseUrl + '/flutter-web.html'], bm);
    const result = await handleMetaCommand('snapshot', [], bm, shutdown);
    expect(result).toContain('Flutter Web');
    expect(result).toContain('@e');
  });

  test('snapshot -i returns interactive Flutter elements with refs', async () => {
    await handleWriteCommand('goto', [baseUrl + '/flutter-web.html'], bm);
    const result = await handleMetaCommand('snapshot', ['-i'], bm, shutdown);
    expect(result).toContain('Flutter Web');
    expect(result).toContain('[button]');
    expect(result).toContain('Increment');
    expect(result).toContain('Submit');
    expect(result).toContain('[textbox]');
  });

  test('Flutter button click works via ref', async () => {
    await handleWriteCommand('goto', [baseUrl + '/flutter-web.html'], bm);
    // Enable semantics and get refs
    await handleMetaCommand('snapshot', ['-i'], bm, shutdown);

    // Find the Increment button ref and click it
    await handleWriteCommand('click', ['#flt-semantic-node-5'], bm);

    // Verify counter changed
    const text = await handleReadCommand('js', [
      'document.querySelector("#flt-semantic-node-4 span").textContent',
    ], bm);
    expect(text).toContain('Counter: 1');
  });

  test('Flutter text input works', async () => {
    await handleWriteCommand('goto', [baseUrl + '/flutter-web.html'], bm);
    await handleMetaCommand('snapshot', ['-i'], bm, shutdown);

    // Fill the input
    await handleWriteCommand('click', ['flutter-view flt-semantics-host input'], bm);
    await handleWriteCommand('fill', ['flutter-view flt-semantics-host input', 'TestUser'], bm);

    // Click submit
    await handleWriteCommand('click', ['#flt-semantic-node-7'], bm);

    // Verify greeting appeared
    const text = await handleReadCommand('js', [
      'document.querySelector("#flt-semantic-node-8 span").textContent',
    ], bm);
    expect(text).toContain('Hello, TestUser!');
  });

  test('accessibility command detects Flutter', async () => {
    await handleWriteCommand('goto', [baseUrl + '/flutter-web.html'], bm);
    const result = await handleReadCommand('accessibility', [], bm);
    expect(result).toContain('Flutter Web detected');
  });

  test('non-Flutter page returns normal snapshot', async () => {
    await handleWriteCommand('goto', [baseUrl + '/snapshot.html'], bm);
    const result = await handleMetaCommand('snapshot', [], bm, shutdown);
    expect(result).not.toContain('Flutter Web');
    expect(result).toContain('@e');
  });
});
