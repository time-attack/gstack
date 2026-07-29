/**
 * #2242 bug 1 regression tripwire: never mutate the signed Chrome-for-Testing
 * bundle.
 *
 * The old launchHeaded() "rebrand" ran a global
 * `.replace(/Google Chrome for Testing/g, 'GStack Browser')` over the
 * bundle's Info.plist — which renamed CFBundleExecutable to a binary that
 * doesn't exist — and overwrote Resources/*.icns. Both writes broke the
 * codesign seal: GPU process exit_code=5, headed mode dead on macOS 26
 * (#2242, #2138, #2139).
 *
 * Static invariant (same pattern as cdp-session-cleanup.test.ts): the
 * browser lifecycle code must contain NO write into the Chromium .app
 * bundle. Branding lives in the wrapper .app / custom GBrowser build.
 * These assertions fail on the pre-fix code.
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const SRC = fs.readFileSync(
  path.join(import.meta.dir, '..', 'src', 'browser-manager.ts'),
  'utf-8',
);

describe('#2242: signed Chromium bundle is never mutated', () => {
  test('no global Google-Chrome-for-Testing plist replace', () => {
    expect(SRC).not.toContain("replace(/Google Chrome for Testing/g");
  });

  test('no Info.plist write into the Chromium bundle', () => {
    // The old code built `Info.plist` under the bundle's Contents dir and
    // wrote it back. Any reappearance of that pattern is a regression.
    expect(SRC).not.toMatch(/writeFileSync\(\s*chromePlist/);
    expect(SRC).not.toContain("join(chromeContentsDir, 'Info.plist')");
  });

  test('no icon overwrite into the Chromium bundle Resources dir', () => {
    expect(SRC).not.toMatch(/copyFileSync\([^)]*destIcon/);
    expect(SRC).not.toContain("CFBundleIconFile");
  });

  test('the tombstone comment documenting why stays put', () => {
    // If someone deletes the explanation, the next contributor reintroduces
    // the mutation in good faith. Keep the why next to the where.
    expect(SRC).toContain('#2242');
  });
});
