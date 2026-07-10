#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly - changes will be overwritten on the next `lisa` run.

# PostToolUse hook: after a harper-app/config.yaml edit, compare the edited
# extension set against HEAD and block silent removals. Harper does not merge a
# custom config.yaml with defaults, so removing a top-level extension can disable
# runtime surfaces without a build-time failure.

PLUGIN_ROOT=${CLAUDE_PLUGIN_ROOT:-}
if [ -z "$PLUGIN_ROOT" ]; then
  PLUGIN_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$PLUGIN_ROOT/hooks/enforce-config-extensions.mjs"
if [ ! -f "$SCRIPT_PATH" ]; then
  SCRIPT_PATH="$SCRIPT_DIR/enforce-config-extensions.mjs"
fi

JSON_INPUT=$(cat)

run_check() {
  if command -v bun >/dev/null 2>&1; then
    printf '%s' "$1" | bun "$SCRIPT_PATH"
  else
    printf '%s' "$1" | node "$SCRIPT_PATH"
  fi
}

if [ -f "$SCRIPT_DIR/_extract-edit-paths.sh" ]; then
  # shellcheck source=/dev/null
  . "$SCRIPT_DIR/_extract-edit-paths.sh"
  FILE_PATHS=$(lisa_extract_edit_paths "$JSON_INPUT")
  if [ -n "$FILE_PATHS" ]; then
    while IFS= read -r FILE_PATH; do
      [ -n "$FILE_PATH" ] || continue
      FILE_INPUT=$(printf '%s' "$JSON_INPUT" | jq --arg path "$FILE_PATH" '.tool_input.file_path = $path')
      run_check "$FILE_INPUT" || exit $?
    done <<EOF
$FILE_PATHS
EOF
    exit 0
  fi
fi

run_check "$JSON_INPUT"
