// Swift-build invariant tests. Requires the Swift toolchain (Xcode CLI tools
// or stand-alone Swift). If swift is unavailable the suites skip LOUDLY with
// a typed reason on stderr (reason=swift_toolchain_unavailable) — never
// silently.
//
// Three invariants:
//
//   1. First-run consumer path (gstack#1735): the SHIPPED templates in
//      ios-qa/templates/ plus the gen-accessors output — not a hand-corrected
//      fixture — render into a fresh temp Swift package and `swift build`
//      succeeds (macOS host build, plus iOS-simulator build when the SDK is
//      present). This is the gate that keeps the tested artifact byte-equal
//      to the artifact users get.
//
//   2. Fixture debug-config build succeeds + the StateServer XCTest unit
//      suite passes (validates that the Swift production code actually runs,
//      not just compiles).
//
//   3. Release-config build excludes DebugBridge symbols. This is the
//      structural Release-build guard from Package.swift's
//      `.when(configuration: .debug)`.

import { describe, test, expect, afterAll } from 'bun:test';
import { spawnSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, copyFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { generate } from '../ios-qa/scripts/gen-accessors';

const ROOT = join(import.meta.dir, '..');
const FIXTURE_PATH = join(ROOT, 'test/fixtures/ios-qa/FixtureApp');
const TEMPLATES_PATH = join(ROOT, 'ios-qa/templates');
const GEN_ACCESSORS_TOOL_PATH = join(ROOT, 'ios-qa/scripts/gen-accessors-tool');

// Parity: canonical Obj-C touch templates must match the fixture's working
// copy. The fixture is the only place the .m / .h are exercised end-to-end
// on a real device, so any divergence means consuming apps would ship a
// stale, untested version of the SwiftUI hit-test fix.
describe('template ↔ fixture parity', () => {
  test('DebugBridgeTouch.h.template matches fixture include', () => {
    const tmpl = readFileSync(join(TEMPLATES_PATH, 'DebugBridgeTouch.h.template'), 'utf-8');
    const fixture = readFileSync(
      join(FIXTURE_PATH, 'Sources/DebugBridgeTouch/include/DebugBridgeTouch.h'),
      'utf-8',
    );
    expect(tmpl).toBe(fixture);
  });

  test('DebugBridgeTouch.m.template matches fixture .m', () => {
    const tmpl = readFileSync(join(TEMPLATES_PATH, 'DebugBridgeTouch.m.template'), 'utf-8');
    const fixture = readFileSync(
      join(FIXTURE_PATH, 'Sources/DebugBridgeTouch/DebugBridgeTouch.m'),
      'utf-8',
    );
    expect(tmpl).toBe(fixture);
  });

  // The four shared Swift bodies must also match byte-for-byte — the fixture
  // is where they're exercised on hardware, the templates are what users get.
  for (const [tmplName, fixtureRel] of [
    ['StateServer.swift.template', 'Sources/DebugBridgeCore/StateServer.swift'],
    ['DebugBridgeManager.swift.template', 'Sources/DebugBridgeCore/DebugBridgeManager.swift'],
    ['Bridges.swift.template', 'Sources/DebugBridgeUI/Bridges.swift'],
    ['DebugOverlay.swift.template', 'Sources/DebugBridgeUI/DebugOverlay.swift'],
  ] as const) {
    test(`${tmplName} matches fixture copy`, () => {
      const tmpl = readFileSync(join(TEMPLATES_PATH, tmplName), 'utf-8');
      const fixture = readFileSync(join(FIXTURE_PATH, fixtureRel), 'utf-8');
      expect(tmpl).toBe(fixture);
    });
  }

  test('Package.swift.template declares all 3 DebugBridge targets', () => {
    const tmpl = readFileSync(join(TEMPLATES_PATH, 'Package.swift.template'), 'utf-8');
    // Each target must be present as a library product AND a target definition.
    for (const name of ['DebugBridgeCore', 'DebugBridgeUI', 'DebugBridgeTouch']) {
      expect(tmpl).toContain(`name: "${name}"`);
    }
    // DebugBridgeUI must depend on the other two; that's how the consuming
    // app gets the transitive set with one dependency entry.
    expect(tmpl).toMatch(/name:\s*"DebugBridgeUI"[\s\S]*?dependencies:\s*\["DebugBridgeCore",\s*"DebugBridgeTouch"\]/);
  });

  // EGRESS-AUDIT P2: the boot token must never hit the unified log with
  // .public visibility — the daemon reads it from the 0600 file, not os_log.
  // Checked in EVERY shipped copy: the canonical template, both skills-tree
  // renders, and the fixture (all pinned byte-identical to the canonical).
  test('boot token is logged .private in every StateServer copy', () => {
    const canonical = readFileSync(join(TEMPLATES_PATH, 'StateServer.swift.template'), 'utf-8');
    expect(canonical).toContain('self.bootToken, privacy: .private');
    expect(canonical).not.toContain('self.bootToken, privacy: .public');
    // The skills-tree renders are what `npx skills add` users get; they must
    // stay byte-equal to the canonical template (fixture parity is above).
    for (const copy of [
      'skills/qa/references/artifacts/ios-qa/templates/StateServer.swift.template',
      'skills/ship/references/artifacts/ios-qa/templates/StateServer.swift.template',
    ]) {
      expect(readFileSync(join(ROOT, copy), 'utf-8')).toBe(canonical);
    }
  });
});

// Static manifest invariants (gstack#1735 bugs 3/5/6). These run everywhere,
// no Swift toolchain needed, and catch the two classes that bricked every
// consumer's first run: a tools-version directive not on line 1 (SwiftPM
// rejects the manifest) and a declared target path that doesn't exist on
// disk (SwiftPM validates ALL target paths before building anything).
describe('shipped manifest invariants', () => {
  const manifests: Array<{ label: string; path: string; pkgRoot: string | null }> = [
    // pkgRoot null: template paths resolve in the consumer render, checked by
    // the render-and-build suite below; here we only check the directive line.
    { label: 'ios-qa/templates/Package.swift.template', path: join(TEMPLATES_PATH, 'Package.swift.template'), pkgRoot: null },
    { label: 'gen-accessors-tool/Package.swift', path: join(GEN_ACCESSORS_TOOL_PATH, 'Package.swift'), pkgRoot: GEN_ACCESSORS_TOOL_PATH },
  ];

  for (const { label, path, pkgRoot } of manifests) {
    test(`${label}: swift-tools-version is on line 1`, () => {
      const firstLine = readFileSync(path, 'utf-8').split('\n')[0] ?? '';
      expect(firstLine).toMatch(/^\/\/ swift-tools-version:/);
    });

    if (pkgRoot) {
      test(`${label}: every declared target path exists on disk`, () => {
        const manifest = readFileSync(path, 'utf-8');
        const declaredPaths = [...manifest.matchAll(/path:\s*"([^"]+)"/g)].map((m) => m[1]!);
        expect(declaredPaths.length).toBeGreaterThan(0);
        for (const p of declaredPaths) {
          expect({ declaredPath: p, exists: existsSync(join(pkgRoot, p)) })
            .toEqual({ declaredPath: p, exists: true });
        }
      });
    }
  }
});

function hasSwift(): boolean {
  // Prefer the Xcode toolchain (xcrun) since that's what real consumers use;
  // fall back to a bare swift on PATH (Linux/stand-alone toolchains).
  const xcrun = spawnSync('xcrun', ['swift', '--version'], { stdio: 'pipe' });
  if (xcrun.status === 0) return true;
  const bare = spawnSync('swift', ['--version'], { stdio: 'pipe' });
  return bare.status === 0;
}

const swiftAvailable = hasSwift();
if (!swiftAvailable) {
  // Loud, typed skip — never silent. The swift-build gates did NOT run.
  console.error(
    '[skill-e2e-ios-swift-build] SKIPPED reason=swift_toolchain_unavailable — ' +
    'neither `xcrun swift --version` nor `swift --version` succeeded; ' +
    'the render-and-build first-run gate (gstack#1735) did not execute on this host.',
  );
}
const describeIfSwift = swiftAvailable ? describe : describe.skip;

// ─── First-run consumer path (gstack#1735) ────────────────────────────────
//
// Render EVERY shipped template verbatim (plus the gen-accessors output and
// the pasted wiring snippet, exactly as the /qa ios-qa module instructs a
// first-run user) into a fresh temp Swift package and `swift build` it.
// StateAccessor.swift.template is the documented SHAPE of the codegen output
// and contains {{PLACEHOLDER}} tokens; its real render is the gen-accessors
// output compiled here.
describeIfSwift('first-run consumer path: shipped templates render and build', () => {
  const pkg = mkdtempSync(join(tmpdir(), 'gstack-ios-template-render-'));
  const consumerDir = join(pkg, 'Sources', 'ConsumerApp');

  afterAll(() => rmSync(pkg, { recursive: true, force: true }));

  // The consumer's canonical state class. The @Observable marker line lives
  // only in the codegen parse input: the shipped package floor is iOS 16 /
  // macOS 13 while the Observation framework needs iOS 17 / macOS 14, so the
  // compiled copy drops that one line. Same fields, same wrapper, one string.
  const demoStateBody = [
    'import Foundation',
    '',
    '/// No-op marker wrapper the codegen detects via attribute scan.',
    '@propertyWrapper',
    'public struct Snapshotable<Value> {',
    '    public var wrappedValue: Value',
    '    public init(wrappedValue: Value) { self.wrappedValue = wrappedValue }',
    '}',
    '',
    '@Observable',
    'public final class DemoAppState {',
    '    @Snapshotable public var isLoggedIn: Bool = false',
    '    @Snapshotable public var username: String = ""',
    '    public var transientCache: Int = 0',
    '    public init() {}',
    '}',
    '',
  ].join('\n');

  test('renders all shipped templates + gen-accessors output into a fresh package', () => {
    // 1. The shipped package, byte-for-byte from templates.
    const renderMap: Array<[string, string]> = [
      ['Package.swift.template', 'Package.swift'],
      ['StateServer.swift.template', 'Sources/DebugBridgeCore/StateServer.swift'],
      ['DebugBridgeManager.swift.template', 'Sources/DebugBridgeCore/DebugBridgeManager.swift'],
      ['DebugBridgeTouch.h.template', 'Sources/DebugBridgeTouch/include/DebugBridgeTouch.h'],
      ['DebugBridgeTouch.m.template', 'Sources/DebugBridgeTouch/DebugBridgeTouch.m'],
      ['Bridges.swift.template', 'Sources/DebugBridgeUI/Bridges.swift'],
      ['DebugOverlay.swift.template', 'Sources/DebugBridgeUI/DebugOverlay.swift'],
    ];
    for (const [tmpl, dest] of renderMap) {
      const destPath = join(pkg, dest);
      mkdirSync(join(destPath, '..'), { recursive: true });
      copyFileSync(join(TEMPLATES_PATH, tmpl), destPath);
    }

    // 2. Consumer app source: state class, pasted wiring snippet (the shipped
    //    template verbatim), and a boot function compiling the documented
    //    @main-init usage.
    mkdirSync(consumerDir, { recursive: true });
    writeFileSync(join(consumerDir, 'DemoAppState.swift'), demoStateBody.replace('@Observable\n', ''));
    copyFileSync(join(TEMPLATES_PATH, 'DebugBridgeWiring.swift.template'), join(consumerDir, 'DebugBridgeWiring.swift'));
    writeFileSync(join(consumerDir, 'DemoBoot.swift'), [
      '// Compiles the pasted wiring + the codegen\'d accessor exactly as the',
      '// documented consumer @main init would.',
      'import Foundation',
      '',
      '#if DEBUG',
      '@MainActor',
      'func gstackDemoBoot() {',
      '    let appState = DemoAppState()',
      '    startGstackDebugBridge()',
      '    DemoAppStateAccessor.register(appState)',
      '}',
      '#endif',
      '',
    ].join('\n'));

    // 3. gen-accessors output, generated from the marker copy of the same
    //    class definition and emitted into the consumer target.
    const codegenInput = mkdtempSync(join(tmpdir(), 'gstack-ios-codegen-input-'));
    writeFileSync(join(codegenInput, 'DemoAppState.swift'), demoStateBody);
    const result = generate({
      inputDir: codegenInput,
      outputDir: consumerDir,
      buildId: 'template-render-test',
      cacheRoot: mkdtempSync(join(tmpdir(), 'gstack-ios-codegen-cache-')),
    });
    expect(result.specs).toEqual([
      {
        className: 'DemoAppState',
        fields: [
          { name: 'isLoggedIn', typeText: 'Bool' },
          { name: 'username', typeText: 'String' },
        ],
      },
    ]);
    const emitted = readFileSync(result.outputPath, 'utf-8');
    // The emitted accessor must import the real module (gstack#1735 bug 4).
    expect(emitted).toContain('import DebugBridgeCore');
    expect(emitted).not.toMatch(/import DebugBridge\s*$/m);

    // 4. Add the consumer target to the manifest (test-owned addition — a
    //    real user's app target lives in their own project; this compiles the
    //    wiring + accessor against the rendered package).
    const manifestPath = join(pkg, 'Package.swift');
    const manifest = readFileSync(manifestPath, 'utf-8');
    // Anchor on the top-level targets array (the products section also
    // contains `targets: [` inside each .library entry).
    expect(manifest).toContain('\n    targets: [\n');
    writeFileSync(manifestPath, manifest.replace('\n    targets: [\n', [
      '',
      '    targets: [',
      '        .target(',
      '            name: "ConsumerApp",',
      '            dependencies: ["DebugBridgeCore", "DebugBridgeUI"],',
      '            path: "Sources/ConsumerApp",',
      '            swiftSettings: [.define("DEBUG", .when(configuration: .debug))]',
      '        ),',
      '',
    ].join('\n')));
  });

  test('swift build succeeds on the rendered package (macOS host)', () => {
    const r = spawnSync('swift', ['build'], { cwd: pkg, stdio: 'pipe', timeout: 300_000 });
    if (r.status !== 0) {
      console.error('rendered-package swift build stderr:', r.stderr?.toString().slice(0, 4000));
      console.error('rendered-package swift build stdout:', r.stdout?.toString().slice(-2000));
    }
    expect(r.status).toBe(0);
  }, 360_000);

  test('swift build succeeds for the iOS simulator triple (UIKit paths compile)', () => {
    const sdk = spawnSync('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'], { stdio: 'pipe' });
    const sdkPath = sdk.stdout?.toString().trim();
    if (sdk.status !== 0 || !sdkPath) {
      // Loud, typed skip: macOS build above still ran; only the UIKit leg is skipped.
      console.error('[skill-e2e-ios-swift-build] SKIPPED reason=ios_simulator_sdk_unavailable — xcrun --sdk iphonesimulator failed; UIKit template paths not compiled.');
      return;
    }
    const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
    const r = spawnSync('swift', [
      'build',
      '--triple', `${arch}-apple-ios16.0-simulator`,
      '--sdk', sdkPath,
    ], { cwd: pkg, stdio: 'pipe', timeout: 300_000 });
    if (r.status !== 0) {
      console.error('iOS-sim swift build stderr:', r.stderr?.toString().slice(0, 4000));
      console.error('iOS-sim swift build stdout:', r.stdout?.toString().slice(-2000));
    }
    expect(r.status).toBe(0);
  }, 360_000);
});

describeIfSwift('swift build invariants', () => {
  // DebugBridgeUI + DebugBridgeTouch are iOS-only (they link UIKit). Plain
  // `swift build` on macOS host can't resolve UIKit, so we scope these
  // invariants to DebugBridgeCore (Swift, cross-platform) + its XCTest
  // target. The iOS-only targets are covered by xcodebuild on the device
  // path (test/skill-e2e-ios-device.test.ts).
  test('Debug-config build succeeds (DebugBridgeCore)', () => {
    const r = spawnSync('swift', ['build', '-c', 'debug', '--target', 'DebugBridgeCore'], {
      cwd: FIXTURE_PATH,
      stdio: 'pipe',
      timeout: 120_000,
    });
    if (r.status !== 0) {
      console.error('swift build stderr:', r.stderr?.toString().slice(0, 4000));
    }
    expect(r.status).toBe(0);
  }, 180_000);

  test('XCTest suite for StateServer passes (validates real Swift impl)', () => {
    const r = spawnSync('swift', ['test', '--filter', 'DebugBridgeCoreTests'], {
      cwd: FIXTURE_PATH,
      stdio: 'pipe',
      timeout: 180_000,
    });
    const stdout = r.stdout?.toString() ?? '';
    const stderr = r.stderr?.toString() ?? '';
    const combined = stdout + stderr;
    if (r.status !== 0) {
      console.error('swift test failure:', combined.slice(-4000));
    }
    expect(r.status).toBe(0);
    // --filter scopes the run to DebugBridgeCoreTests; the xctest summary
    // line is "'Selected tests' passed" rather than "'All tests' passed".
    expect(combined).toMatch(/'(?:All|Selected) tests' passed/);
    // Guard against an empty pass-by-no-tests (filter typo / target rename):
    // we expect at least one StateServer smoke test to actually execute.
    expect(combined).toContain('StateServerSmokeTests');
  }, 240_000);

  // Codex-flagged: Release-build guard must be STRUCTURAL, not advisory.
  // The Package.swift's `.when(configuration: .debug)` setting causes Swift
  // to compile-out the entire DebugBridgeCore target body in Release. Since
  // every public symbol is gated `#if DEBUG`, the release build emits an
  // empty module — zero symbols.
  test('Release-config build excludes DebugBridge symbols', () => {
    // Step 1: clean + release build (Core only — UI/Touch can't build on macOS)
    spawnSync('swift', ['package', 'clean'], { cwd: FIXTURE_PATH, stdio: 'pipe', timeout: 60_000 });
    const build = spawnSync('swift', ['build', '-c', 'release', '--target', 'DebugBridgeCore'], {
      cwd: FIXTURE_PATH,
      stdio: 'pipe',
      timeout: 180_000,
    });
    if (build.status !== 0) {
      console.error('release build stderr:', build.stderr?.toString().slice(0, 4000));
    }
    expect(build.status).toBe(0);

    // Step 2: locate the built object file(s). SwiftPM puts .build artifacts
    // under .build/<triple>/release/.
    const oFiles = spawnSync('find', [
      join(FIXTURE_PATH, '.build'),
      '-path', '*/release/*',
      '-name', '*.o',
      '-path', '*DebugBridge*',
    ], { stdio: 'pipe' });
    const files = (oFiles.stdout?.toString() ?? '').trim().split('\n').filter(Boolean);
    expect(files.length).toBeGreaterThan(0);

    let foundForbidden = 0;
    const forbidden = ['StateServer', 'handleRequest', 'sessionAcquire', 'authRotate', 'snapshotGet'];
    for (const f of files) {
      const nm = spawnSync('nm', ['-j', f], { stdio: 'pipe' });
      const syms = nm.stdout?.toString() ?? '';
      for (const tok of forbidden) {
        if (syms.includes(tok)) {
          console.error(`Release symbol leak: ${tok} found in ${f}`);
          foundForbidden++;
        }
      }
    }
    expect(foundForbidden).toBe(0);
  }, 300_000);
});
