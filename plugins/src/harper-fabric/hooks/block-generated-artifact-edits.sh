#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly - changes will be overwritten on the next `lisa` run.

# PreToolUse hook: block Write/Edit/MultiEdit on generated Harper deploy
# artifacts. Harper/Fabric projects build these files from TypeScript under
# src/, so direct edits are overwritten by the next build and usually ship as
# no-op fixes.
# Reference: https://docs.claude.com/en/docs/claude-code/hooks
# Exit code 2 blocks the tool call and surfaces stderr to Claude.

JSON_INPUT=$(cat)

command -v jq >/dev/null 2>&1 || exit 0

FILE_PATH=$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.file_path // empty')
[ -n "$FILE_PATH" ] || exit 0

PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-}
if [ -z "$PLUGIN_ROOT" ]; then
  PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
GLOBS_FILE="$PLUGIN_ROOT/generated-artifact-globs.txt"
[ -f "$GLOBS_FILE" ] || exit 0

normalize_path() {
  local path="$1"
  path="${path#./}"
  printf '%s' "$path"
}

matches_glob() {
  local file="$1"
  local glob="$2"

  # Recursive directory globs: "dir/**" matches everything under dir.
  if [ "${glob: -3}" = "/**" ]; then
    local dir="${glob%/**}"
    case "$file" in
      "$dir"/* | */"$dir"/*) return 0 ;;
    esac
    return 1
  fi

  # Single-star globs like "harper-app/*.js": the star must not cross a
  # directory separator, so a broadened root-level pattern protects compiled
  # modules emitted straight into harper-app/ (resources.js, resource-*.js, and
  # any other build output such as detail-shell-negotiation.js) WITHOUT matching
  # hand-written files nested one level down (e.g. harper-app/<route>/index.js).
  case "$glob" in
    */\** | \**)
      local base_glob="${glob##*/}"
      local dir_glob=""
      case "$glob" in
        */*) dir_glob="${glob%/*}" ;;
      esac
      local file_base="${file##*/}"
      local file_dir=""
      case "$file" in
        */*) file_dir="${file%/*}" ;;
      esac
      case "$file_base" in
        $base_glob) ;;
        *) return 1 ;;
      esac
      [ -z "$dir_glob" ] && return 0
      # Match the directory exactly, or as a suffix so absolute/prefixed paths
      # (e.g. /repo/harper-app/foo.js) still resolve.
      case "$file_dir" in
        $dir_glob | */"$dir_glob") return 0 ;;
      esac
      return 1
      ;;
  esac

  # Literal (wildcard-free) globs.
  case "$file" in
    $glob | */$glob) return 0 ;;
  esac

  return 1
}

NORMALIZED_FILE=$(normalize_path "$FILE_PATH")

# Project-owned allowlist of hand-written files that live under harper-app/ and
# must NOT be treated as generated (e.g. a hand-authored SEO shell, or route
# index.js shims kept at the harper-app root). The broadened root-level
# `harper-app/*.js` protection would otherwise block editing them. One glob per
# line (same syntax as the globs file); blank lines and `#` comments ignored.
# Prefer naming compiled resource modules `resource-*.ts` so their JS output is
# unambiguously generated and never needs allowlisting.
ALLOWLIST_FILE="${CLAUDE_PROJECT_DIR:-.}/.lisa/harper-generated-artifact-allowlist.txt"
if [ -f "$ALLOWLIST_FILE" ]; then
  while IFS= read -r allow || [ -n "$allow" ]; do
    [ -n "$allow" ] || continue
    case "$allow" in \#*) continue ;; esac
    if matches_glob "$NORMALIZED_FILE" "$allow"; then
      exit 0
    fi
  done <"$ALLOWLIST_FILE"
fi

while IFS= read -r glob || [ -n "$glob" ]; do
  [ -n "$glob" ] || continue
  case "$glob" in \#*) continue ;; esac

  if matches_glob "$NORMALIZED_FILE" "$glob"; then
    cat >&2 <<MSG
Blocked: direct edit to generated Harper/Fabric artifact.

File: $FILE_PATH
Matched generated artifact pattern: $glob

TypeScript under src/ is the source of truth for Harper resources, web assets,
and shared libraries. Change the matching TypeScript source under src/ and run
the project build to regenerate harper-app outputs.
MSG
    exit 2
  fi
done <"$GLOBS_FILE"

exit 0
