#!/usr/bin/env bash
# Lisa-managed Codex hook helper (sourced, not executed directly).
#
# Provides `lisa_extract_edit_paths`, the single source of truth for turning a
# Codex Pre/PostToolUse hook envelope into the list of file paths the tool
# touches. Every edit-aware Lisa hook (format/lint/sg-scan/rubocop/block-
# migration) sources this so the apply_patch parsing lives in exactly one place.
#
# Tool envelope shapes (verified against codex-cli 0.125.0 by capturing real
# hook stdin):
#   Edit / Write   → tool_input.file_path  (single string)
#   apply_patch    → tool_input.command    (a STRING containing the full patch,
#                                            NOT an array — there is no command[1])
#
# An apply_patch patch encodes its targets as header lines:
#   *** Add File: <path>
#   *** Update File: <path>
#   *** Delete File: <path>
# A single patch may carry MANY files, so callers must loop over the output.

# Print, one per line, every file path the tool envelope intends to write.
# Emits nothing (and returns 0) when jq is unavailable or no path is found, so
# callers can fail open.
#
# $1 - the full hook stdin JSON
lisa_extract_edit_paths() {
  local json="$1"
  command -v jq >/dev/null 2>&1 || return 0

  local tool_name
  tool_name="$(printf '%s' "$json" | jq -r '.tool_name // .tool // empty')"

  if [ "$tool_name" = "apply_patch" ]; then
    local patch_text
    patch_text="$(printf '%s' "$json" | jq -r '.tool_input.command // empty')"
    [ -n "$patch_text" ] || return 0
    # Walk the patch line-by-line with bash-native string ops (NOT grep/sed on
    # JSON — see .claude/rules/PROJECT_RULES.md) to pull out every file header.
    while IFS= read -r line; do
      case "$line" in
        "*** Add File: "* | "*** Update File: "* | "*** Delete File: "*)
          printf '%s\n' "${line#*File: }"
          ;;
      esac
    done <<<"$patch_text"
  else
    printf '%s' "$json" | jq -r '.tool_input.file_path // empty'
  fi
}
