#!/usr/bin/env bash
# Migration: v1.61.0.0 — Codex global install moved from ~/.codex/skills to ~/.agents/skills
# Affected: users who installed for Codex before v1.61.0.0.
#
# Codex's documented user-scope skill discovery path is $HOME/.agents/skills;
# setup now installs there (community PR #2123). The old ~/.codex/skills
# location leaves stale gstack symlinks/dirs behind that would be discovered
# twice if Codex ever scans the legacy dir. Remove only gstack-owned entries
# (gstack and gstack-*); never touch anything else the user put there.
set -euo pipefail

LEGACY="$HOME/.codex/skills"
[ -d "$LEGACY" ] || exit 0

for entry in "$LEGACY"/gstack "$LEGACY"/gstack-*; do
  [ -e "$entry" ] || [ -L "$entry" ] || continue
  if [ -L "$entry" ]; then
    rm -f "$entry" 2>/dev/null || true
  elif [ -d "$entry" ]; then
    # Runtime roots are real dirs full of symlinks created by setup; safe to remove.
    rm -rf "$entry" 2>/dev/null || true
  fi
done

# Drop the parent dirs if gstack was the only thing in them.
rmdir "$LEGACY" 2>/dev/null || true
rmdir "$HOME/.codex" 2>/dev/null || true
exit 0
