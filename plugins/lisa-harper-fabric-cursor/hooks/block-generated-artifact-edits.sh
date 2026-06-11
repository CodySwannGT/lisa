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

  if [ "${glob: -3}" = "/**" ]; then
    local dir="${glob%/**}"
    case "$file" in
      "$dir"/* | */"$dir"/*) return 0 ;;
    esac
    return 1
  fi

  case "$file" in
    $glob | */$glob) return 0 ;;
  esac

  return 1
}

NORMALIZED_FILE=$(normalize_path "$FILE_PATH")

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
