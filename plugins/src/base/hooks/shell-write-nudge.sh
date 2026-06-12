#!/usr/bin/env bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
# =============================================================================
# Shell Write Nudge Hook (PostToolUse - Bash)
# =============================================================================
# Emits a one-line, non-blocking notice when a Bash command appears to mutate a
# tracked repository file directly. This keeps shell escape hatches visible
# without blocking legitimate scripts or codemods.
# =============================================================================
set -uo pipefail

JSON_INPUT="$(cat)"

command -v jq >/dev/null 2>&1 || exit 0

COMMAND="$(printf '%s' "$JSON_INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -n "$COMMAND" ] || exit 0

case "$COMMAND" in
  bun\ run* | npm\ run* | pnpm\ run* | yarn\ run* | node\ scripts/* | bun\ scripts/* | bash\ scripts/* | sh\ scripts/*)
    exit 0
    ;;
esac

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$repo_root" 2>/dev/null || exit 0

is_tracked_file() {
  local candidate="$1"
  [ -n "$candidate" ] || return 1
  candidate="${candidate#./}"
  git ls-files --error-unmatch -- "$candidate" >/dev/null 2>&1
}

command_mentions_tracked_write() {
  local token
  local sed_command_re='(^|[[:space:];&|])sed[[:space:]]'
  local inline_runtime_re='(^|[[:space:];&|])(python3?|node|bun)[[:space:]]+-[ce][[:space:]]'

  if [[ "$COMMAND" =~ $sed_command_re && "$COMMAND" == *"-i"* ]]; then
    while IFS= read -r token; do
      is_tracked_file "$token" && return 0
    done < <(printf '%s\n' "$COMMAND" | tr ' ' '\n' | sed 's/^[\"'\'']//; s/[\"'\'',;|&)]$//')
  fi

  while IFS= read -r token; do
    token="${token#./}"
    is_tracked_file "$token" && return 0
  done < <(
    printf '%s\n' "$COMMAND" |
      grep -Eo '(^|[[:space:]])(>>?|tee[[:space:]]+-a?|cat[[:space:]]+<<[^[:space:]]+[[:space:]]*>)[[:space:]]*[^[:space:];|&]+' |
      sed -E 's/^[[:space:]]*(>>?|tee[[:space:]]+-a?|cat[[:space:]]+<<[^[:space:]]+[[:space:]]*>)[[:space:]]*//; s/^[\"'\'']//; s/[\"'\'']$//'
  )

  if [[ "$COMMAND" =~ $inline_runtime_re ]]; then
    while IFS= read -r token; do
      is_tracked_file "$token" && return 0
    done < <(git ls-files | while IFS= read -r file; do
      [[ "$COMMAND" == *"$file"* ]] && printf '%s\n' "$file"
    done)
  fi

  return 1
}

if command_mentions_tracked_write; then
  echo "Lisa notice: prefer Edit/Write for tracked file edits so lint-on-edit can see the change." >&2
fi

exit 0
