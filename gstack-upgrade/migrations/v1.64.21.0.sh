#!/usr/bin/env bash
# Migration: v1.64.21.0 — remove the orphaned design CLI binary.
#
# Why a migration: the design CLI (GPT Image API) was removed from the source
# tree, but installs that ever built it still carry a stale ~63MB compiled
# binary at design/dist/design. It is untracked, gitignored, and unreferenced,
# so `git pull` + `./setup` never clean it up. It embeds api.openai.com wiring,
# so the 2026-07-28 privacy egress audit flagged it for removal
# (evals/privacy/egress-audit-2026-07-28.md, finding 4).
#
# Affected: users who installed before the design CLI was removed and ran a
# build that produced design/dist/design.
#
# Idempotent: rm -f / rmdir on already-absent paths is a no-op.

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

rm -f "${SCRIPT_DIR}/design/dist/design" "${SCRIPT_DIR}/design/dist/.version" 2>/dev/null || true
# Clean up the now-empty directories (rmdir refuses non-empty dirs, so any
# user files someone parked under design/ are left alone).
rmdir "${SCRIPT_DIR}/design/dist" 2>/dev/null || true
rmdir "${SCRIPT_DIR}/design" 2>/dev/null || true

exit 0
