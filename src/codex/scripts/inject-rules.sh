#!/usr/bin/env bash
# Lisa-managed Codex hook script.
# Reads all .md files from .codex/lisa-rules/eager/ and injects them into the
# session context via additionalContext.
#
# Wired by Lisa's installer as a SessionStart hook in .codex/hooks.json.
# Codex sets the hook script's cwd to the session cwd (NOT the repo root),
# so we resolve paths against `git rev-parse --show-toplevel`.
#
# The split between eager and reference rules: eager carries load-bearing
# prescriptions injected at every SessionStart; reference bodies under
# .codex/lisa-rules/reference/ are mirrored alongside but loaded only when
# the eager breadcrumb points to them.
set -euo pipefail

# This hook does not inspect the envelope, but it must still consume it before
# any early return to keep Codex's stdin writer open.
cat >/dev/null 2>&1 || true

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
RULES_BASE="${REPO_ROOT}/.codex/lisa-rules"
RULES_DIR="${RULES_BASE}/eager"

# Backward compatibility: if the eager subdir is absent (older Lisa install),
# fall back to the flat lisa-rules/ directory so partial installs still ship.
if [ ! -d "$RULES_DIR" ]; then
  RULES_DIR="$RULES_BASE"
fi

# Bail silently if the rules dir is absent (e.g., Lisa was uninstalled)
[ -d "$RULES_DIR" ] || exit 0

# Fail open if jq is missing — without it we can't emit valid hook JSON.
# Codex would otherwise log a warning on every SessionStart.
command -v jq >/dev/null 2>&1 || exit 0

CONTEXT=""
for file in "$RULES_DIR"/*.md; do
  [ -f "$file" ] || continue
  CONTEXT+="$(cat "$file")"$'\n\n'
done

# Bail if no rules were found
[ -n "$CONTEXT" ] || exit 0

# Codex hooks accept hookSpecificOutput.additionalContext for context injection
jq -n --arg ctx "$CONTEXT" '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": $ctx}}'
