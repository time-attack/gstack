#!/usr/bin/env bash
# Migration: v1.61.1.0 — heal the v1.27 rename for already-migrated installs
#
# NOTE FOR THE SHIPPING RELEASE: this filename must match the VERSION this
# branch ships as (migrations run when crossing their version). If the release
# lands as something other than v1.61.1.0, rename this file and its test.
#
# The v1.27.0.0 migration's GitHub rename passed a bare repo name to
# `gh repo rename`, which requires OWNER/REPO — the rename always failed,
# the step still marked itself done, and the migration's later steps rewrote
# ~/.gstack-artifacts-remote.txt to point at a gstack-artifacts-* repo that
# was never created (GitHub only redirects renamed repos, so pushes 404).
# The v1.27 script is fixed in this release, but everyone who ALREADY ran it
# is stuck: the done-touchfile and the version window block any retry.
#
# Affected: GitHub-hosted artifacts users who upgraded across v1.27.0.0
# before this release. Detection is conservative:
#   - ~/.gstack-artifacts-remote.txt points at github.com/<owner>/gstack-artifacts-*
#   - that repo does NOT exist on GitHub
#   - <owner>/gstack-brain-* (the pre-rename name) DOES exist
# and only then is the owner-qualified rename retried. Idempotent, non-fatal,
# no prompts: this completes the rename the user already accepted in v1.27.
set -euo pipefail

if [ -z "${HOME:-}" ]; then
  exit 0
fi

GSTACK_HOME="${HOME}/.gstack"
MIGRATION_DIR="${GSTACK_HOME}/.migrations"
DONE="${MIGRATION_DIR}/v1.61.1.0.done"
REMOTE_TXT="${HOME}/.gstack-artifacts-remote.txt"

mkdir -p "$MIGRATION_DIR"
[ -f "$DONE" ] && exit 0

finish() { touch "$DONE"; exit 0; }

# No artifacts remote at all — nothing to heal.
[ -f "$REMOTE_TXT" ] || finish

REMOTE_URL="$(head -1 "$REMOTE_TXT" 2>/dev/null | tr -d '[:space:]')"
case "$REMOTE_URL" in
  https://github.com/*/gstack-artifacts-*) ;;
  *) finish ;;  # non-GitHub host or unexpected shape — out of scope
esac

_REPO_PATH="${REMOTE_URL#https://github.com/}"
_REPO_PATH="${_REPO_PATH%.git}"
OWNER="${_REPO_PATH%%/*}"
NEW_NAME="${_REPO_PATH#*/}"
OLD_NAME="gstack-brain-${NEW_NAME#gstack-artifacts-}"
if [ -z "$OWNER" ] || [ -z "$NEW_NAME" ] || [ "$OWNER" = "$NEW_NAME" ]; then
  finish
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "  [v1.61.1.0] gh CLI not available — cannot verify the artifacts repo rename." >&2
  echo "  If pushes to $REMOTE_URL fail with 'repository not found', run:" >&2
  echo "    gh repo rename $NEW_NAME --repo $OWNER/$OLD_NAME --yes" >&2
  exit 0  # leave un-done so a later upgrade with gh available can retry
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "  [v1.61.1.0] gh is not authenticated — skipping the artifacts rename check." >&2
  exit 0  # leave un-done so a later authenticated upgrade can retry
fi

# The artifacts repo already exists (v1.27 worked here, or the user healed it
# manually) — nothing to do.
if gh repo view "$OWNER/$NEW_NAME" >/dev/null 2>&1; then
  finish
fi

# Old name gone too? Some other setup (repo deleted, different host) — out of
# scope for an automated heal.
if ! gh repo view "$OWNER/$OLD_NAME" >/dev/null 2>&1; then
  echo "  [v1.61.1.0] neither $OWNER/$NEW_NAME nor $OWNER/$OLD_NAME exists on GitHub — nothing to heal." >&2
  finish
fi

echo "  [v1.61.1.0] healing the v1.27 artifacts rename: $OWNER/$OLD_NAME → $NEW_NAME" >&2
if gh repo rename "$NEW_NAME" --repo "$OWNER/$OLD_NAME" --yes >/dev/null 2>&1; then
  echo "  [v1.61.1.0] renamed — artifacts sync to $REMOTE_URL works again." >&2
  finish
fi

echo "  [v1.61.1.0] WARNING: rename failed (permissions or org policy?). Run manually:" >&2
echo "    gh repo rename $NEW_NAME --repo $OWNER/$OLD_NAME --yes" >&2
exit 0  # non-fatal; left un-done so a later upgrade retries
