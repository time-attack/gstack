#!/usr/bin/env bash
# Run Booked on THIS Mac, walk a booking in a visible browser, record it, open it.
# Usage: ./record-mac.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-8765}"
URL="http://127.0.0.1:${PORT}/"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${ROOT}/../../.gstack/qa-reports/recordings/booked-mac-${STAMP}.mp4"
mkdir -p "$(dirname "$OUT")"
OUT="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This script is for your local Mac. This machine is $(uname -s)."
  echo "Open a local Cursor agent on the Mac, or run this file there."
  exit 2
fi

find_browse() {
  if [[ -n "${B:-}" && -x "$B" ]]; then
    echo "$B"
    return
  fi
  if [[ -x "${GSTACK_BIN:-}/browse" ]]; then
    echo "${GSTACK_BIN}/browse"
    return
  fi
  if [[ -x "${GSTACK_HOME:-$HOME/.gstack}/bin/browse" ]]; then
    echo "${GSTACK_HOME:-$HOME/.gstack}/bin/browse"
    return
  fi
  local repo
  repo="$(cd "$ROOT/../.." && pwd)"
  if [[ -f "$repo/browse/src/cli.ts" ]] && command -v bun >/dev/null 2>&1; then
    echo "bun $repo/browse/src/cli.ts"
    return
  fi
  return 1
}

if ! BROWSE="$(find_browse)"; then
  echo "No gstack browse binary on this Mac."
  echo "Serving Booked and opening it in your default browser (no \$B record)."
  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" &
  SERVER_PID=$!
  trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
  sleep 0.4
  open "$URL"
  echo "OPENED $URL"
  echo "Install gstack browse, then re-run for a headed recording that opens when done."
  wait "$SERVER_PID"
  exit 0
fi

echo "BROWSE=$BROWSE"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null || true' EXIT
sleep 0.4
curl -fsS -o /dev/null "$URL"

# shellcheck disable=SC2086
run() { $BROWSE --headed "$@"; }

run disconnect >/dev/null 2>&1 || true
run goto "$URL"
run viewport 1440x900
echo "RECORDING_PATH=$OUT"
run record start "$OUT" --fps 10 --quality 85
sleep 1
run click '[data-testid="dest-JFK"]'
sleep 1
run click '[data-testid="date-1"]'
sleep 1
run click '[data-testid="flight-DL405"]'
sleep 1
run click '[data-testid="request"]'
sleep 1
run click '[data-testid="confirm"]'
sleep 2
echo "=== stop ==="
run record stop --open
echo "Booked is still at $URL until you Ctrl-C."
wait "$SERVER_PID"
