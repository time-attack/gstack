#!/usr/bin/env bash
set -euo pipefail

repo_input="${GSTACK_UNDER_TEST:?GSTACK_UNDER_TEST is required}"
if command -v cygpath >/dev/null 2>&1; then
  repo="$(cygpath -u "$repo_input")"
else
  repo="$repo_input"
fi
case "$repo" in
  /c/gstack-isolated/pr-2260/*) ;;
  *) echo "SAFETY_REFUSAL: control checkout is outside C:/gstack-isolated/pr-2260: $repo" >&2; exit 96 ;;
esac
cd "$repo"
echo "CONTROL_PROBE_ID=pr-2260-unaffected-posix-build-script"
echo "CONTROL_PHASE=${GSTACK_PR_TEST_PHASE:?}"
echo "CONTROL_REPO=${GSTACK_PR_TEST_REPO:?}"
test -s browse/scripts/build-node-server.sh
case "$GSTACK_PR_TEST_PHASE" in
  baseline) expected=a3259400a366593e0c909dd9ac3e59752efd2488 ;;
  candidate) expected=b9fbe4dea9b192d5d6fe6814bc558f89ef41dde7 ;;
  *) echo "unknown control phase: $GSTACK_PR_TEST_PHASE" >&2; exit 87 ;;
esac
test "$(git rev-parse HEAD)" = "$expected"
bash -n browse/scripts/build-node-server.sh
echo "CONTROL_PROBE_PASS"
