#!/usr/bin/env bash
# Lisa-managed Codex hook script.
# Reads all .md files from .codex/lisa-rules/ and injects them into the
# session context via additionalContext.
#
# Wired by Lisa's installer as a SessionStart hook in .codex/hooks.json.
# Codex sets the hook script's cwd to the session cwd (NOT the repo root),
# so we resolve paths against `git rev-parse --show-toplevel`.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
RULES_DIR="${REPO_ROOT}/.codex/lisa-rules"

# Bail silently if the rules dir is absent (e.g., Lisa was uninstalled)
[ -d "$RULES_DIR" ] || exit 0

CONTEXT=""
for file in "$RULES_DIR"/*.md; do
  [ -f "$file" ] || continue
  CONTEXT+="$(cat "$file")"$'\n\n'
done

# Bail if no rules were found
[ -n "$CONTEXT" ] || exit 0

# Codex hooks accept hookSpecificOutput.additionalContext for context injection
jq -n --arg ctx "$CONTEXT" '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": $ctx}}'
