#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT"

BUN_CMD="${BUN_CMD:-bun}"
BUN_CMD_WAS_COPIED=0

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    bun_path="$(command -v "$BUN_CMD" 2>/dev/null || true)"
    case "$bun_path" in
      *[![:ascii:]]*)
        bun_copy_dir="$ROOT/.tmp-bun-bin"
        mkdir -p "$bun_copy_dir"
        cp -f "$bun_path" "$bun_copy_dir/bun.exe"
        BUN_CMD="$bun_copy_dir/bun.exe"
        BUN_CMD_WAS_COPIED=1
        ;;
    esac
    ;;
esac

# build_or_wrap ENTRY OUTFILE REL_SCRIPT
# Try `bun build --compile`; if it fails (e.g. virtiofs / devcontainer mounts
# where Bun's compile step can't mmap the temp binary — issue #407), write an
# executable bash wrapper that runs the source via `bun run` instead of leaving
# the user with no binary at all. The wrapper resolves its own dir with
# `pwd -P` (physical): installed layouts symlink dist dirs (the codex host
# symlinks browse/dist), and a logical pwd would resolve REL_SCRIPT against the
# symlink path where no src/ exists.
build_or_wrap() {
  local entry="$1" outfile="$2" rel="$3"
  if "$BUN_CMD" build --compile "$entry" --outfile "$outfile"; then
    return 0
  fi
  echo "[build] bun compile failed for $entry — writing a 'bun run' wrapper to $outfile" >&2
  cat > "$outfile" <<'WRAPPER'
#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
exec bun run "$SCRIPT_DIR/__REL__" "$@"
WRAPPER
  # Substitute the relative script path after the fact so the heredoc stays literal.
  sed -i.bak "s|__REL__|$rel|" "$outfile" && rm -f "$outfile.bak"
  chmod +x "$outfile"
}

"$BUN_CMD" run vendor:xterm
"$BUN_CMD" run gen:skill-docs --host all
build_or_wrap browse/src/cli.ts browse/dist/browse ../src/cli.ts
build_or_wrap browse/src/find-browse.ts browse/dist/find-browse ../src/find-browse.ts
build_or_wrap design/src/cli.ts design/dist/design ../src/cli.ts
build_or_wrap make-pdf/src/cli.ts make-pdf/dist/pdf ../src/cli.ts
build_or_wrap bin/gstack-global-discover.ts bin/gstack-global-discover gstack-global-discover.ts
bash browse/scripts/build-node-server.sh
bash scripts/write-version-files.sh browse/dist/.version design/dist/.version make-pdf/dist/.version
chmod +x browse/dist/browse browse/dist/find-browse design/dist/design make-pdf/dist/pdf bin/gstack-global-discover
rm -f .*.bun-build
if [ "$BUN_CMD_WAS_COPIED" -eq 1 ]; then
  rm -rf "$ROOT/.tmp-bun-bin"
fi
