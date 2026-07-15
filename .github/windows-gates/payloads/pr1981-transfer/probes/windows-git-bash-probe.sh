#!/usr/bin/env bash
# Exact-behavior probe for PR #1981. This file is intended to run inside
# genuine Git for Windows Bash with a native Windows Python executable first
# on PATH. The command line is identical across baseline and candidate; the
# phase and tree under test are supplied through the environment.
set -uo pipefail

MODE="${WINDOWS_PROBE_MODE:-healthy}"
PHASE="${GSTACK_PR_TEST_PHASE:-}"
REPO_ID="${GSTACK_PR_TEST_REPO:-unknown-consumer}"
GSTACK_UNDER_TEST="${GSTACK_UNDER_TEST:-}"
GSTACK_STATE_ROOT="${GSTACK_STATE_ROOT:-}"
EVIDENCE_DIR="${WINDOWS_EVIDENCE_DIR:-}"

fail() {
  printf 'ASSERTION_FAIL: %s\n' "$*" >&2
  exit 70
}

case "$PHASE" in
  baseline|candidate) ;;
  *) fail "GSTACK_PR_TEST_PHASE must be baseline or candidate" ;;
esac
case "$MODE" in
  healthy|timeout|no-cli|missing-version) ;;
  *) fail "WINDOWS_PROBE_MODE must be healthy, timeout, no-cli, or missing-version" ;;
esac
[ -n "$GSTACK_UNDER_TEST" ] || fail "GSTACK_UNDER_TEST is required"
[ -n "$GSTACK_STATE_ROOT" ] || fail "GSTACK_STATE_ROOT is required"
[ -n "$EVIDENCE_DIR" ] || fail "WINDOWS_EVIDENCE_DIR is required"
[ -x "$GSTACK_UNDER_TEST/bin/gstack-config" ] || fail "gstack-config is missing"

case "$(uname -s)" in
  MINGW*|MSYS*) ;;
  *) fail "probe requires genuine Git for Windows Bash; uname=$(uname -s)" ;;
esac

mkdir -p "$HOME" "$GSTACK_STATE_ROOT" "$EVIDENCE_DIR"
DETECTION_FILE="$GSTACK_STATE_ROOT/gbrain-detection.json"
CACHE_FILE="$GSTACK_STATE_ROOT/.gbrain-local-status-cache.json"
COMMAND_STDOUT="$EVIDENCE_DIR/command.stdout.log"
COMMAND_STDERR="$EVIDENCE_DIR/command.stderr.log"
OFFICIAL_SOURCES_STDOUT="$EVIDENCE_DIR/official-sources.stdout.log"
OFFICIAL_SOURCES_STDERR="$EVIDENCE_DIR/official-sources.stderr.log"
PYTHON_BOUNDARY_STDERR="$EVIDENCE_DIR/native-python-boundary.stderr.log"

rm -f "$DETECTION_FILE" "$DETECTION_FILE.tmp" "$CACHE_FILE" \
  "$COMMAND_STDOUT" "$COMMAND_STDERR" \
  "$OFFICIAL_SOURCES_STDOUT" "$OFFICIAL_SOURCES_STDERR" \
  "$PYTHON_BOUNDARY_STDERR"

# These are the mandatory safe-wrapper suppressions. The Windows VM uses this
# scrubbed runner because the macOS harness cannot itself enter the VM.
export GSTACK_SKIP_COREUTILS=1
export GSTACK_SKIP_FONTS=1
export GSTACK_SKIP_GBRAIN_REGEN=1
export GSTACK_DETECT_NO_CACHE=1
if [ "$MODE" = "timeout" ]; then
  export GSTACK_GBRAIN_PROBE_TIMEOUT_MS=1
else
  export GSTACK_GBRAIN_PROBE_TIMEOUT_MS="${GSTACK_GBRAIN_PROBE_TIMEOUT_MS:-60000}"
fi

PYTHON_CMD="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
[ -n "$PYTHON_CMD" ] || fail "native Windows Python is absent"
PYTHON_NATIVE_PATH="$(cygpath -w "$PYTHON_CMD" 2>/dev/null || true)"
PYTHON_FACTS="$("$PYTHON_CMD" -c 'import os,platform,sys; print("os.name="+os.name); print("platform.system="+platform.system()); print("sys.executable="+sys.executable); print("version="+platform.python_version())' 2>&1)"
printf '%s\n' "$PYTHON_FACTS" | grep -Fq 'os.name=nt' || fail "Python is not a native Windows process: $PYTHON_FACTS"
printf '%s\n' "$PYTHON_FACTS" | grep -Fq 'platform.system=Windows' || fail "Python platform is not Windows: $PYTHON_FACTS"

printf 'probe_contract=pr-1981-exact-windows-v1\n'
printf 'phase=%s\n' "$PHASE"
printf 'repo_id=%s\n' "$REPO_ID"
printf 'mode=%s\n' "$MODE"
printf 'uname=%s\n' "$(uname -a)"
printf 'msystem=%s\n' "${MSYSTEM:-unset}"
printf 'ostype=%s\n' "${OSTYPE:-unset}"
printf 'home_msys=%s\n' "$HOME"
printf 'home_windows=%s\n' "$(cygpath -w "$HOME" 2>/dev/null || printf unavailable)"
printf 'state_root_msys=%s\n' "$GSTACK_STATE_ROOT"
printf 'state_root_windows=%s\n' "$(cygpath -w "$GSTACK_STATE_ROOT" 2>/dev/null || printf unavailable)"
printf 'gstack_under_test=%s\n' "$GSTACK_UNDER_TEST"
printf 'resolved_bash=%s\n' "$(command -v bash)"
printf 'resolved_bun=%s\n' "$(command -v bun 2>/dev/null || printf none)"
printf 'bun_version=%s\n' "$(bun --version 2>/dev/null || printf unavailable)"
printf 'resolved_python=%s\n' "$PYTHON_CMD"
printf 'resolved_python_windows=%s\n' "$PYTHON_NATIVE_PATH"
printf '%s\n' "$PYTHON_FACTS"
if command -v file >/dev/null 2>&1; then
  printf 'python_file_identity=%s\n' "$(file "$PYTHON_CMD" 2>/dev/null || printf unavailable)"
fi
printf 'gstack_config_sha256=%s\n' "$(sha256sum "$GSTACK_UNDER_TEST/bin/gstack-config" | awk '{print $1}')"
printf 'gstack_detector_sha256=%s\n' "$(sha256sum "$GSTACK_UNDER_TEST/bin/gstack-gbrain-detect" | awk '{print $1}')"

if [ "$MODE" != "no-cli" ]; then
  GBRAIN_CMD="$(command -v gbrain 2>/dev/null || true)"
  [ -n "$GBRAIN_CMD" ] || fail "official gbrain is absent"
  printf 'resolved_gbrain=%s\n' "$GBRAIN_CMD"
  printf 'official_gbrain_version=%s\n' "$(gbrain --version 2>&1 | head -1)"
  [ -f "$HOME/.gbrain/config.json" ] || fail "official gbrain config is absent from isolated HOME"
  printf 'official_gbrain_config_sha256=%s\n' "$(sha256sum "$HOME/.gbrain/config.json" | awk '{print $1}')"
  set +e
  gbrain sources list --json >"$OFFICIAL_SOURCES_STDOUT" 2>"$OFFICIAL_SOURCES_STDERR"
  OFFICIAL_SOURCES_EXIT=$?
  set -e
  printf 'official_sources_exit=%s\n' "$OFFICIAL_SOURCES_EXIT"
  [ "$OFFICIAL_SOURCES_EXIT" -eq 0 ] || fail "official gbrain sources health probe failed"
elif command -v gbrain >/dev/null 2>&1; then
  fail "no-cli mode unexpectedly has gbrain on PATH"
else
  printf 'resolved_gbrain=none\n'
fi

set +e
"$GSTACK_UNDER_TEST/bin/gstack-config" gbrain-refresh \
  >"$COMMAND_STDOUT" 2>"$COMMAND_STDERR"
COMMAND_EXIT=$?
set -e
printf 'gstack_config_exit=%s\n' "$COMMAND_EXIT"
printf '%s\n' command_stdout_begin
cat "$COMMAND_STDOUT"
printf '%s\n' command_stdout_end
printf '%s\n' command_stderr_begin
cat "$COMMAND_STDERR"
printf '%s\n' command_stderr_end
[ "$COMMAND_EXIT" -eq 0 ] || fail "gstack-config itself exited nonzero"
[ -f "$DETECTION_FILE" ] || fail "real detector did not persist detection JSON"

STATUS="$(grep -o '"gbrain_local_status":[[:space:]]*"[^"]*"' "$DETECTION_FILE" | sed 's/.*"\([^"]*\)"$/\1/' | head -1 || true)"
VERSION="$(grep -o '"gbrain_version":[[:space:]]*"[^"]*"' "$DETECTION_FILE" | sed 's/.*"\([^"]*\)"$/\1/' | head -1 || true)"
ON_PATH="$(grep -o '"gbrain_on_path":[[:space:]]*\(true\|false\)' "$DETECTION_FILE" | sed 's/.*:[[:space:]]*//' | head -1 || true)"
DETECTION_SHA="$(sha256sum "$DETECTION_FILE" | awk '{print $1}')"
printf 'detector_on_path=%s\n' "${ON_PATH:-missing}"
printf 'detector_status=%s\n' "${STATUS:-missing}"
printf 'detector_version=%s\n' "${VERSION:-missing}"
printf 'detection_sha256=%s\n' "$DETECTION_SHA"

# Reproduce the exact boundary independently: interpolate the MSYS path into
# native Python source, matching current main. Native Windows Python must fail
# to open /c/... even though Git Bash and Bun's detector can access the file.
set +e
"$PYTHON_CMD" -c "open('$DETECTION_FILE','rb').read()" \
  >/dev/null 2>"$PYTHON_BOUNDARY_STDERR"
PYTHON_BOUNDARY_EXIT=$?
set -e
printf 'native_python_msys_path_open_exit=%s\n' "$PYTHON_BOUNDARY_EXIT"
[ "$PYTHON_BOUNDARY_EXIT" -ne 0 ] || fail "native Python unexpectedly opened the literal MSYS path; bug precondition is absent"

if [ "$MODE" = "healthy" ] || [ "$MODE" = "timeout" ]; then
  [ "$ON_PATH" = "true" ] || fail "official detector did not find gbrain"
  EXPECTED_STATUS=ok
  [ "$MODE" = "timeout" ] && EXPECTED_STATUS=timeout
  [ "$STATUS" = "$EXPECTED_STATUS" ] || fail "official detector status is not $EXPECTED_STATUS: ${STATUS:-missing}"
  [ -n "$VERSION" ] || fail "official detector omitted gbrain version"
  if [ "$PHASE" = "baseline" ]; then
    grep -Fq 'local-status: unknown' "$COMMAND_STDOUT" || fail "baseline did not reproduce unknown status"
    if grep -Fq 'Detected gbrain' "$COMMAND_STDOUT"; then
      fail "baseline unexpectedly reported healthy gbrain"
    fi
    printf 'ASSERTION_PASS: baseline reproduced native-Python/MSYS-path bug with healthy official detector\n'
    exit 43
  fi
  grep -Fq "Detected gbrain v$VERSION (local-status: $EXPECTED_STATUS)." "$COMMAND_STDOUT" || fail "candidate masked healthy detector result"
  grep -Fq 'No global install at ' "$COMMAND_STDOUT" || fail "candidate did not reach guarded render decision"
  if grep -Fq 'local-status: unknown' "$COMMAND_STDOUT"; then
    fail "candidate still reported unknown"
  fi
  printf 'ASSERTION_PASS: candidate bypassed native Python and reached guarded render decision\n'
  exit 0
fi

if [ "$MODE" = "missing-version" ]; then
  [ "$ON_PATH" = "true" ] || fail "missing-version fixture did not report gbrain on PATH"
  [ "$STATUS" = "ok" ] || fail "missing-version fixture did not preserve ok status"
  [ -z "$VERSION" ] || fail "missing-version fixture unexpectedly emitted a version"
  if [ "$PHASE" = "baseline" ]; then
    grep -Fq 'local-status: unknown' "$COMMAND_STDOUT" || fail "baseline missing-field fallback was not documented"
    printf 'ASSERTION_PASS: baseline missing-field fallback also exposes the native-Python/MSYS-path boundary\n'
    exit 43
  fi
  grep -Fq 'Detected gbrain vunknown (local-status: ok).' "$COMMAND_STDOUT" || fail "candidate missing-field fallback result changed"
  grep -Fq 'No global install at ' "$COMMAND_STDOUT" || fail "candidate missing-field control did not reach guarded render decision"
  printf 'ASSERTION_PASS: candidate documents missing-version fallback without claiming it as the primary fix\n'
  exit 0
fi

[ "$ON_PATH" = "false" ] || fail "no-cli detector unexpectedly reported gbrain"
[ "$STATUS" = "no-cli" ] || fail "no-cli status changed: ${STATUS:-missing}"
if [ "$PHASE" = "baseline" ]; then
  grep -Fq 'local-status: unknown' "$COMMAND_STDOUT" || fail "baseline no-cli boundary was not documented"
  printf 'ASSERTION_PASS: baseline no-cli also exposes the native-Python/MSYS-path boundary\n'
  exit 43
fi
grep -Fq 'gbrain not detected (local-status: no-cli)' "$COMMAND_STDOUT" || fail "candidate no-cli classification changed"
if grep -Fq 'Detected gbrain' "$COMMAND_STDOUT"; then
  fail "candidate produced a false healthy result without gbrain"
fi
printf 'ASSERTION_PASS: candidate preserved no-cli without a false healthy result\n'
exit 0
