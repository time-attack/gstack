#!/usr/bin/env bash
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")" && pwd -P)}"
MANIFEST="$ROOT/manifest.json"
[ -f "$MANIFEST" ] || { printf 'manifest missing: %s\n' "$MANIFEST" >&2; exit 2; }

manifest_rows() {
  if command -v jq >/dev/null 2>&1; then
    jq -r '.files[] | [.path, (.bytes|tostring), .sha256] | @tsv' "$MANIFEST"
  elif command -v node >/dev/null 2>&1; then
    node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); for (const f of m.files) console.log([f.path,String(f.bytes),f.sha256].join("\t"));' "$MANIFEST"
  else
    printf 'jq or node is required to read the manifest\n' >&2
    return 2
  fi
}

manifest_value() {
  key="$1"
  if command -v jq >/dev/null 2>&1; then
    jq -r ".${key}" "$MANIFEST"
  else
    node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(m[process.argv[2]]));' "$MANIFEST" "$key"
  fi
}

if command -v sha256sum >/dev/null 2>&1; then
  hash_file() { sha256sum "$1" | awk '{print $1}'; }
else
  hash_file() { shasum -a 256 "$1" | awk '{print $1}'; }
fi

count=0
if command -v jq >/dev/null 2>&1; then
  expected_count="$(jq -r '.files | length' "$MANIFEST")"
else
  expected_count="$(node -e 'const fs=require("fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); process.stdout.write(String(m.files.length));' "$MANIFEST")"
fi
while IFS=$'\t' read -r relative expected_bytes expected_hash; do
  file="$ROOT/$relative"
  [ -f "$file" ] || { printf 'missing: %s\n' "$relative" >&2; exit 3; }
  actual_bytes="$(wc -c <"$file" | tr -d '[:space:]')"
  [ "$actual_bytes" = "$expected_bytes" ] || {
    printf 'size mismatch: %s expected=%s actual=%s\n' "$relative" "$expected_bytes" "$actual_bytes" >&2
    exit 4
  }
  actual_hash="$(hash_file "$file")"
  [ "$actual_hash" = "$expected_hash" ] || {
    printf 'hash mismatch: %s expected=%s actual=%s\n' "$relative" "$expected_hash" "$actual_hash" >&2
    exit 5
  }
  printf 'OK %s %s\n' "$actual_hash" "$relative"
  count=$((count + 1))
done < <(manifest_rows)

[ "$count" = "$expected_count" ] || {
  printf 'manifest count mismatch: expected=%s checked=%s\n' "$expected_count" "$count" >&2
  exit 6
}
printf 'PAYLOAD_VALID files=%s head=%s test_merge_tree=%s\n' \
  "$count" \
  "$(manifest_value headSha)" \
  "$(manifest_value testMergeTree)"
