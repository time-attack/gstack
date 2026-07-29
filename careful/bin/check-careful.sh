#!/usr/bin/env bash
# check-careful.sh — PreToolUse hook for /careful skill
# Reads JSON from stdin, checks Bash command for destructive patterns.
# Returns {"permissionDecision":"ask","message":"..."} to warn, or {} to allow.
#
# The command is split into segments on unquoted ; & | ( ) newlines and
# command substitutions ($(...), `...`) by a quote/escape-aware state
# machine, and every destructive-pattern + safe-exception check runs per
# segment. Compound commands (cd /tmp && rm -rf x, echo hi; rm -rf x,
# true | rm -rf x, $(rm -rf x), rm -rf x &) can no longer ride past the
# check inside another segment, and quoted strings that merely CONTAIN
# destructive text (grep "rm -rf" log) no longer trigger it (upstream #2039).
set -euo pipefail

# Read stdin (JSON with tool_input)
INPUT=$(cat)

# --- Extract tool_input.command ---
# python3 first: correct for every JSON escape (\", \n, \uXXXX). The old
# grep-first path truncated at the first embedded \" and let quoted compound
# commands through unchecked.
CMD=$(printf '%s' "$INPUT" | python3 -c 'import sys,json; print(json.loads(sys.stdin.read()).get("tool_input",{}).get("command",""))' 2>/dev/null || true)

# Fallback (python3 unavailable): ERE JSON-string match (handles escaped
# quotes, unlike the old [^"]* pattern) + awk unescape of standard escapes.
if [ -z "$CMD" ]; then
  RAW=$(printf '%s' "$INPUT" | tr -d '\n\r' | grep -oE '"command"[[:space:]]*:[[:space:]]*"(\\.|[^"\\])*"' | head -1 | sed -E 's/^"command"[[:space:]]*:[[:space:]]*"//; s/"$//' || true)
  if [ -n "$RAW" ]; then
    CMD=$(printf '%s' "$RAW" | awk '
      {
        s = $0; n = length(s); out = ""; i = 1
        while (i <= n) {
          c = substr(s, i, 1)
          if (c == "\\" && i < n) {
            d = substr(s, i + 1, 1); i += 2
            if (d == "n") out = out "\n"
            else if (d == "t") out = out "\t"
            else if (d == "r") out = out "\r"
            else if (d == "u") {
              hex = tolower(substr(s, i, 4)); i += 4; v = 0
              for (h = 1; h <= 4; h++) v = v * 16 + index("0123456789abcdef", substr(hex, h, 1)) - 1
              # whitespace escapes decode to a separator; other non-ASCII to a
              # harmless placeholder so an encoded separator can never smuggle
              # a segment boundary past the tokenizer
              if (v == 9 || v == 10 || v == 13) out = out "\n"
              else if (v >= 32 && v < 127) out = out sprintf("%c", v)
              else out = out "?"
            }
            else out = out d
          } else { out = out c; i++ }
        }
        printf "%s", out
      }' || true)
  fi
fi

# If we still couldn't extract a command, allow
if [ -z "$CMD" ]; then
  echo '{}'
  exit 0
fi

# --- Quote-aware segment tokenizer (awk state machine) ---
# Splits on unquoted ; & | ( ) newlines, backticks, and $(...) boundaries.
# Modes: N top-level command, S single-quote, D double-quote, U inside $(...),
# B inside backticks. kq=0 replaces each quoted span with "_" (so quoted
# lookalikes cannot match command patterns, but a quoted rm TARGET still
# fails the safe-exception check); kq=1 preserves quotes verbatim (for SQL
# payloads and shell-executor arguments, which execute their quoted text).
# ponytail: heredoc bodies are scanned as command text (conservative ask),
# and an unclosed quote drops its tail — which mirrors the shell, where an
# unterminated quote is a syntax error and nothing executes.
TOKENIZER=$(cat <<'AWK'
function flush() {
  gsub(/^[ \t]+/, "", seg); gsub(/[ \t]+$/, "", seg)
  if (seg != "") print seg
  seg = ""
}
{ buf = buf $0 "\n" }
END {
  n = length(buf); sp = 0; mode = "N"; seg = ""
  for (i = 1; i <= n; i++) {
    c = substr(buf, i, 1)
    if (mode == "S") {
      if (c == "'") { mode = stk[sp--]; if (kq) seg = seg c }
      else if (kq) seg = seg c
      continue
    }
    if (mode == "D") {
      if (c == "\"") { mode = stk[sp--]; if (kq) seg = seg c }
      else if (c == "\\") { if (kq) seg = seg c substr(buf, i + 1, 1); i++ }
      else if (c == "$" && substr(buf, i + 1, 1) == "(") { flush(); stk[++sp] = mode; mode = "U"; i++ }
      else if (c == "`") { flush(); stk[++sp] = mode; mode = "B" }
      else if (kq) seg = seg c
      continue
    }
    # command context: N, U, B
    if (c == "\\") {
      d = substr(buf, i + 1, 1); i++
      if (d == "\n") seg = seg " "
      else seg = seg d
      continue
    }
    if (c == "'") { seg = seg (kq ? c : "_"); stk[++sp] = mode; mode = "S"; continue }
    if (c == "\"") { seg = seg (kq ? c : "_"); stk[++sp] = mode; mode = "D"; continue }
    if (c == "$" && substr(buf, i + 1, 1) == "(") { flush(); stk[++sp] = mode; mode = "U"; i++; continue }
    if (c == "`") {
      flush()
      if (mode == "B") mode = stk[sp--]
      else { stk[++sp] = mode; mode = "B" }
      continue
    }
    if (c == ")" && mode == "U") { flush(); mode = stk[sp--]; continue }
    if (c == ";" || c == "&" || c == "|" || c == "\n" || c == "(" || c == ")") { flush(); continue }
    seg = seg c
  }
  flush()
}
AWK
)

SEG_PLAIN=$(printf '%s' "$CMD" | awk -v kq=0 "$TOKENIZER")
SEG_QUOTED=$(printf '%s' "$CMD" | awk -v kq=1 "$TOKENIZER")

# Segments that only produce text output — their args may mention dangerous
# patterns without executing them.
is_text_only() {
  case "$1" in
    "git commit -m "*|"git commit --message "*|echo|"echo "*|printf|"printf "*|"cat <"*) return 0 ;;
  esac
  return 1
}

# Safe-exception check: every token after the FIRST rm word must be a flag or
# a known build-artifact dir, and there must be at least one such target.
# (The old greedy `.*rm` sed took the LAST rm's args, so `rm -rf /x && rm -rf
# node_modules` laundered itself clean; zero extracted targets — e.g. a
# pipe-fed `xargs rm -rf` — also counted as safe.)
rm_targets_all_safe() {
  local rm_seen=false target_count=0 target
  set -f
  for target in $1; do
    if [ "$rm_seen" = false ]; then
      case "$target" in rm|*/rm) rm_seen=true ;; esac
      continue
    fi
    case "$target" in
      -*) ;; # flag, skip
      */node_modules|node_modules|*/.next|.next|*/dist|dist|*/__pycache__|__pycache__|*/.cache|.cache|*/build|build|*/.turbo|.turbo|*/coverage|coverage)
        target_count=$((target_count + 1)) ;;
      *)
        set +f
        return 1 ;;
    esac
  done
  set +f
  [ "$rm_seen" = true ] && [ "$target_count" -gt 0 ]
}

WARN=""
PATTERN=""

# Run destructive-pattern checks against one segment.
# $2 selects pattern families: cmd (command-position patterns, quote-stripped
# text), sql (SQL keywords, quote-preserved text), all (both — for shell
# executors whose quoted argument is itself a command).
scan_segment() {
  local seg="$1" fam="$2" seg_lower
  [ -n "$WARN" ] && return 0

  if [ "$fam" != "sql" ]; then
    # rm -rf / rm -r / rm --recursive (r-flag in any position)
    if printf '%s' "$seg" | grep -qE '(^|[^[:alnum:]_-])rm[[:space:]]+(-[^[:space:]]+[[:space:]]+)*(-[a-zA-Z]*r|--recursive)' 2>/dev/null; then
      if ! rm_targets_all_safe "$seg"; then
        WARN="Destructive: recursive delete (rm -r). This permanently removes files."
        PATTERN="rm_recursive"
        return 0
      fi
    fi

    # git push --force / git push -f
    if printf '%s' "$seg" | grep -qE '(^|[^[:alnum:]_-])git[[:space:]]+push[[:space:]]+.*(-f([[:space:]]|$)|--force)' 2>/dev/null; then
      WARN="Destructive: git force-push rewrites remote history. Other contributors may lose work."
      PATTERN="git_force_push"
      return 0
    fi

    # git reset --hard
    if printf '%s' "$seg" | grep -qE '(^|[^[:alnum:]_-])git[[:space:]]+reset[[:space:]]+--hard' 2>/dev/null; then
      WARN="Destructive: git reset --hard discards all uncommitted changes."
      PATTERN="git_reset_hard"
      return 0
    fi

    # git checkout . / git restore .
    if printf '%s' "$seg" | grep -qE '(^|[^[:alnum:]_-])git[[:space:]]+(checkout|restore)[[:space:]]+\.' 2>/dev/null; then
      WARN="Destructive: discards all uncommitted changes in the working tree."
      PATTERN="git_discard"
      return 0
    fi

    # kubectl delete
    if printf '%s' "$seg" | grep -qE '(^|[^[:alnum:]_-])kubectl[[:space:]]+delete' 2>/dev/null; then
      WARN="Destructive: kubectl delete removes Kubernetes resources. May impact production."
      PATTERN="kubectl_delete"
      return 0
    fi

    # docker rm -f / docker system prune
    if printf '%s' "$seg" | grep -qE '(^|[^[:alnum:]_-])docker[[:space:]]+(rm[[:space:]]+-f|system[[:space:]]+prune)' 2>/dev/null; then
      WARN="Destructive: Docker force-remove or prune. May delete running containers or cached images."
      PATTERN="docker_destructive"
      return 0
    fi
  fi

  if [ "$fam" != "cmd" ]; then
    seg_lower=$(printf '%s' "$seg" | tr '[:upper:]' '[:lower:]')

    # DROP TABLE / DROP DATABASE
    if printf '%s' "$seg_lower" | grep -qE '(^|[^[:alnum:]_])drop[[:space:]]+(table|database)' 2>/dev/null; then
      WARN="Destructive: SQL DROP detected. This permanently deletes database objects."
      PATTERN="drop_table"
      return 0
    fi

    # TRUNCATE
    if printf '%s' "$seg_lower" | grep -qE '(^|[^[:alnum:]_])truncate([^[:alnum:]_]|$)' 2>/dev/null; then
      WARN="Destructive: SQL TRUNCATE detected. This deletes all rows from a table."
      PATTERN="truncate"
      return 0
    fi
  fi
  return 0
}

# Pass 1: quote-stripped segments — command-position patterns.
while IFS= read -r SEG; do
  [ -n "$WARN" ] && break
  is_text_only "$SEG" && continue
  scan_segment "$SEG" cmd
done <<< "$SEG_PLAIN"

# Pass 2: quote-preserved segments. SQL rides inside quoted arguments
# (psql -c "DROP TABLE ..."), and shell executors (sh -c '...', su -c,
# eval, ssh) execute their quoted argument, so those get the full set.
# ponytail: the executor list is enumerated (sh/bash/zsh/dash/ksh/su -c,
# eval, ssh, behind sudo/env/command/nohup/time/xargs/timeout prefixes);
# find -exec sh -c and su - user -c are not covered — extend the
# alternation if that class shows up in the wild.
if [ -z "$WARN" ]; then
  EXECUTOR_RE='^((sudo|env|command|nohup|time|xargs)[[:space:]]+|timeout[[:space:]]+[^[:space:]]+[[:space:]]+)*(((ba|z|da|k)?sh|su)[[:space:]]+(-[^[:space:]]+[[:space:]]+)*-[a-zA-Z]*c[a-zA-Z]*[[:space:]]|eval[[:space:]]|ssh[[:space:]])'
  while IFS= read -r SEG; do
    [ -n "$WARN" ] && break
    is_text_only "$SEG" && continue
    if printf '%s' "$SEG" | grep -qE "$EXECUTOR_RE" 2>/dev/null; then
      scan_segment "$SEG" all
    else
      scan_segment "$SEG" sql
    fi
  done <<< "$SEG_QUOTED"
fi

# --- Output ---
if [ -n "$WARN" ]; then
  # Log hook fire event (pattern name only, never command content)
  mkdir -p ~/.gstack/analytics 2>/dev/null || true
  echo '{"event":"hook_fire","skill":"careful","pattern":"'"$PATTERN"'","ts":"'$(date -u +%Y-%m-%dT%H:%M:%SZ)'","repo":"'$(basename "$(git rev-parse --show-toplevel 2>/dev/null)" 2>/dev/null || echo "unknown")'"}' >> ~/.gstack/analytics/skill-usage.jsonl 2>/dev/null || true

  WARN_ESCAPED=$(printf '%s' "$WARN" | sed 's/"/\\"/g')
  printf '{"permissionDecision":"ask","message":"[careful] %s"}\n' "$WARN_ESCAPED"
else
  echo '{}'
fi
