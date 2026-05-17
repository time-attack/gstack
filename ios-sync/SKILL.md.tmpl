---
name: ios-sync
version: 1.0.0
description: |
  Fetch and install the latest iOS skill templates from the canonical gstack source.
  Updates ~/.claude/skills/ios-qa/templates/ with the newest StateServer,
  DebugOverlay, DebugBridgeManager, StateAccessor, Package, and JSON templates.
  Run this after pulling gstack updates, or when templates may be stale.
allowed-tools:
  - Bash
  - Read
triggers:
  - ios sync
  - ios-sync
  - update ios templates
  - fetch ios templates
  - sync ios skills
---

{{PREAMBLE}}

# iOS Sync — Fetch Latest Templates

Pull the latest iOS skill templates from the canonical source and install them
to `~/.claude/skills/ios-qa/templates/`.

## Step 1: Find the canonical source

Check for a local gstack fork first (faster, no network):

```bash
# Check common fork locations
for DIR in \
  ~/gstack-fork \
  ~/emdash/gstack \
  ~/code/gstack \
  ~/.claude/skills/gstack-source; do
  if [ -d "$DIR/ios-qa/templates" ]; then
    echo "FOUND_LOCAL: $DIR"
    break
  fi
done
```

If a local fork is found, use it. Otherwise clone from GitHub:

```bash
# Clone or pull from GitHub
SYNC_TMP="/tmp/ios-sync-source"
if [ -d "$SYNC_TMP/.git" ]; then
  echo "Pulling latest..."
  git -C "$SYNC_TMP" pull --ff-only 2>&1 | tail -2
else
  echo "Cloning gstack..."
  git clone --depth=1 https://github.com/time-attack/gstack.git "$SYNC_TMP" 2>&1 | tail -3
fi
SOURCE="$SYNC_TMP/ios-qa"
```

## Step 2: Verify source has templates

```bash
ls "$SOURCE/templates/"
# Expected: DebugBridgeJSON.swift.template  DebugBridgeManager.swift.template
#           DebugOverlay.swift.template     Package.swift.template
#           StateAccessor.swift.template    StateServer.swift.template
```

If any template is missing, stop and report which ones are absent.

## Step 3: Check what's changed

Diff each template against the currently installed version:

```bash
for TMPL in "$SOURCE/templates/"*.template; do
  NAME=$(basename "$TMPL")
  INSTALLED=~/.claude/skills/ios-qa/templates/"$NAME"
  if [ ! -f "$INSTALLED" ]; then
    echo "NEW: $NAME"
  elif ! diff -q "$TMPL" "$INSTALLED" >/dev/null 2>&1; then
    echo "CHANGED: $NAME"
  else
    echo "SAME: $NAME"
  fi
done
```

## Step 4: Install templates

```bash
mkdir -p ~/.claude/skills/ios-qa/templates/
cp "$SOURCE/templates/"*.template ~/.claude/skills/ios-qa/templates/
echo "Templates installed to ~/.claude/skills/ios-qa/templates/"
```

## Step 5: Also sync SKILL.md files for all ios-* skills

```bash
SOURCE_ROOT=$(dirname "$SOURCE")

for SKILL in ios-qa ios-fix ios-design-review ios-clean ios-sync; do
  SRC_SKILL="$SOURCE_ROOT/$SKILL"
  DST_SKILL=~/.claude/skills/$SKILL

  # Prefer SKILL.md.tmpl, fall back to SKILL.md
  if [ -f "$SRC_SKILL/SKILL.md.tmpl" ]; then
    mkdir -p "$DST_SKILL"
    cp "$SRC_SKILL/SKILL.md.tmpl" "$DST_SKILL/SKILL.md"
    echo "Updated: ~/.claude/skills/$SKILL/SKILL.md"
  elif [ -f "$SRC_SKILL/SKILL.md" ]; then
    mkdir -p "$DST_SKILL"
    cp "$SRC_SKILL/SKILL.md" "$DST_SKILL/SKILL.md"
    echo "Updated: ~/.claude/skills/$SKILL/SKILL.md"
  else
    echo "SKIP: $SKILL (not found in source)"
  fi
done
```

## Step 6: Verify checksums

```bash
echo ""
echo "Verification:"
for TMPL in ~/.claude/skills/ios-qa/templates/*.template; do
  NAME=$(basename "$TMPL")
  SRC="$SOURCE/templates/$NAME"
  if diff -q "$TMPL" "$SRC" >/dev/null 2>&1; then
    echo "  ✓ $NAME"
  else
    echo "  ✗ $NAME — MISMATCH (investigate)"
  fi
done
```

## Step 7: Report

```
iOS Sync complete.
Source: [local fork path or github.com/time-attack/gstack]

Templates updated:
  ✓ StateServer.swift.template       (changed / same)
  ✓ DebugOverlay.swift.template      (changed / same)
  ✓ DebugBridgeManager.swift.template (same)
  ✓ StateAccessor.swift.template     (same)
  ✓ DebugBridgeJSON.swift.template   (same)
  ✓ Package.swift.template           (same)

Skills updated:
  ✓ ios-qa      v4.x.x
  ✓ ios-fix     v1.x.x
  ✓ ios-design-review
  ✓ ios-clean
  ✓ ios-sync

Next /ios-qa run will use the latest templates.
```
