## Host-neutral runtime bindings

These assignments select stable paths only; they do not install anything or grant consent:

```bash
GSTACK_HOME="${GSTACK_HOME:-$HOME/.gstack}"
GSTACK_ROOT="$GSTACK_HOME"
GSTACK_STATE_ROOT="$GSTACK_HOME"
GSTACK_BIN="$GSTACK_HOME/bin"
BUN_CMD="$GSTACK_BIN/bun"
B="$GSTACK_BIN/browse"
P="$GSTACK_BIN/make-pdf"
```

# $qa --mode Report --module recording — record an agent using the app, then open it

The user asked for a **screen recording** of an agent walking a web app or a physical iOS app, plus full QA, and for that recording to **open when it is done**.

This module owns start/stop/open. It does not replace QA judgment: after recording is rolling, load and execute `references/legacy/qa-only.md` (web) or `references/legacy/ios-qa.md` (device). Report-only unless the user explicitly authorized product-code fixes, in which case load `references/legacy/qa.md` instead of qa-only after the same recording start.

Do not add a sixth public skill. `/recording` is an opt-in alias for this module. `$B record` is the web affordance; `ios-qa/scripts/record-session.ts` is the device affordance. Pair-agent tunnel tokens cannot invoke `$B record`.

## Parse the request

| Signal | Action |
|---|---|
| URL, localhost, "web app", "site", "frontend" | Web surface |
| iPhone, device, "iOS app", UDID, DebugBridge | iOS surface |
| Both, or neither | Prefer web if a local/dev URL is reachable; otherwise iOS if a daemon is up; otherwise ask once |
| "watch", "show me", "demo", "headed" | Visible browser (web) or iOS demo mode (device) in addition to the recording |
| "fix", "patch", "make it work" | Mutation = Fix; load qa.md after recording starts. Default is report-only |
| Output path | Honor it. Default: `.gstack/qa-reports/recordings/qa-<stamp>.mp4` |

If no URL is given on a feature branch, use qa-only's diff-aware local-app detection after recording is ready to start — but **start recording before the first interaction**, not after.

## SETUP (run BEFORE any browse or device command)

```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
B=""
[ -n "$_ROOT" ] && [ -x "$GSTACK_BIN/browse" ] && B="$GSTACK_BIN/browse"
[ -z "$B" ] && B="${GSTACK_HOME:-$HOME/.gstack}/bin/browse"
if [ -x "$B" ]; then
  echo "READY: $B"
else
  echo "NEEDS_SETUP"
fi
```

If `NEEDS_SETUP` on a **web** target: tell the user the browser-backed capability is not ready, offer the local setup options (managed Chromium or a detected installed Chromium) with no network access or changes, then STOP. Read `references/RUNTIME.md` and follow its capability bootstrap. Never assume a standard-installed skill directory contains `./setup`. Never download a second Bun.

If the target is **iOS** and the daemon is not up, follow `references/legacy/ios-qa.md` Phase 0–2 first, then return here to start the recorder before Phase 3.

```bash
REPORT_DIR=".gstack/qa-reports"
STAMP=$(date +%Y%m%d-%H%M%S)
RECORDING="$REPORT_DIR/recordings/qa-$STAMP.mp4"
mkdir -p "$REPORT_DIR/recordings" "$REPORT_DIR/screenshots"
echo "RECORDING_PATH=$RECORDING"
```

Carry `RECORDING_PATH` in prose ("the recording path created in SETUP") — each bash block is a new shell.

## Web surface

1. Find the browse binary (SETUP above). Headless is the default. Only if the user asked to **watch live**, read `references/legacy/open-gstack-browser.md` and `$B connect` first — do not offer headed Chromium for ordinary recorded QA.
2. Navigate to the app (`$B goto <url>` or qa-only's local-port probe). Recording needs an active page; `record start` fails with "No active page" otherwise.
3. Start capturing **before** the QA sweep:

```bash
$B record start "<the recording path created in SETUP>" --fps 8
```

4. Read `references/legacy/qa-only.md` completely (or `references/legacy/qa.md` if mutation is Fix) and execute it. Every click, fill, and snapshot happens while the screencast is running. Still take per-finding screenshots — the video is the walkthrough, screenshots remain the evidence map.
5. Stop, encode, and open:

```bash
$B record stop --open
```

6. The stop output starts with `RECORDING: <absolute path>`. Print that path in the final reply. If open failed (no viewer, headless CI), say so and leave the path clickable. Do not claim the user has watched the video.

`$B record status` is the heartbeat if a later step is unsure whether capture is still running. Do not start a second recording; stop the first.

ffmpeg is optional. When it is missing, stop writes an HTML player next to the JPEG frames and opens that instead. That still counts as opening the recording.

## iOS surface

Physical device only. No simulator, no XCTest, no WebDriverAgent, no cloud device farm.

1. Bootstrap with `references/legacy/ios-qa.md` through daemon-up (Phases 0–2). Turn on **Recording mode** (`--recording`) so DebugOverlay watermarks the screencast "AGENT DEMO". If the user said demo/watch/show me, also apply that module's Demo mode (visible taps only, 4 fps).
2. Resolve the recorder:

```bash
_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
IOS_RECORD="$($GSTACK_BIN/gstack runtime path ios-qa/scripts/record-session.ts 2>/dev/null || true)"
[ -z "$IOS_RECORD" ] && [ -n "$_ROOT" ] && IOS_RECORD="$_ROOT/ios-qa/scripts/record-session.ts"
if [ -f "$IOS_RECORD" ]; then echo "IOS_RECORD=$IOS_RECORD"; else echo "IOS_RECORD_MISSING"; fi
```

If `IOS_RECORD_MISSING`, say the iOS recorder is part of the managed runtime and STOP with the runtime bootstrap offer for capability `ios`. Do not invent a different device backend.

3. Start the poller against the daemon (the port from ios-qa session cache / Phase 2). Default 4 fps:

```bash
"$BUN_CMD" "$IOS_RECORD" start --daemon "http://127.0.0.1:<daemon-port>" --out "<the recording path created in SETUP>" --fps 4
```

Pass `--token` only when the daemon requires a bearer for `/screenshot`.

4. Execute ios-qa Phase 3 (vision-driven loop) against the user's test goal. The poller keeps capturing independently of each `/tap`.
5. Stop and open:

```bash
"$BUN_CMD" "$IOS_RECORD" stop --open
```

Same `RECORDING:` line contract as web.

## Full QA contract

"Full QA" here means the preserved specialist, not a screenshot slideshow:

- Web: qa-only's modes (diff-aware / quick / full / regression) and scoring. Prefer **full** unless the user said `--quick`.
- iOS: the closed find→verify loop on the real device, not a single screenshot.
- Do not skip console, network, accessibility, or forms because a camera is running.
- Do not use `POST /state/*` writes to skip UI during a recording the user will watch — that is ios-qa demo-mode's rule, and it applies to this module whenever the artifact is a walkthrough.

## Exit

Report, in this order:

1. **RECORDING:** absolute path, kind (mp4 / webm / html), whether it opened.
2. The QA report path from the specialist you loaded.
3. Findings count by severity. Each finding still has a screenshot.
4. Surfaces you did not test.

If recording started and QA later fails, still `record stop --open` (or the iOS stop) so the user gets the partial walkthrough. Never leave a screencast running.
