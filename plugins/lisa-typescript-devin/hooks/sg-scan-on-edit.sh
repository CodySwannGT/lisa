#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.

# Hook script to run ast-grep scan after Claude edits files
# This script receives JSON input via stdin with tool information
# Reference: https://docs.claude.com/en/docs/claude-code/hooks
# Note: This hook is BLOCKING - it returns non-zero exit codes so Claude must fix issues

# Extract file path from JSON input. Use jq for robust JSON parsing (never
# grep/sed/cut — a shape change would turn this blocking scan into a silent
# no-op). Fail open without jq so we never hard-block an edit.
command -v jq >/dev/null 2>&1 || exit 0
FILE_PATH=$(cat | jq -r '.tool_input.file_path // empty')

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
    exit 0
fi

# Check if file type is supported (TypeScript, JavaScript)
case "${FILE_PATH##*.}" in
    ts|tsx|js|jsx|mjs|cjs) ;;
    *) exit 0 ;;
esac

# Validate project directory
if [ -z "${CLAUDE_PROJECT_DIR:-}" ]; then
    exit 0
fi

# Check if file is in a source directory
RELATIVE_PATH="${FILE_PATH#$CLAUDE_PROJECT_DIR/}"
case "$RELATIVE_PATH" in
    src/*|apps/*|libs/*|test/*|tests/*|features/*|components/*|hooks/*|screens/*|app/*|constants/*|utils/*|providers/*|stores/*) ;;
    *) exit 0 ;;
esac

# Where this script lives, resolved BEFORE any `cd`. `$0` is the path the
# harness invoked, and the façade helper ships beside it.
LISA_HOOK_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"

cd "$CLAUDE_PROJECT_DIR" || exit 0

# ---------------------------------------------------------------------------
# Gate façade. The project's declaration decides BEFORE any tool is resolved.
# Full contract, and why an undeclared project sees no change at all, in
# lisa-edit-gate.sh beside this file.
#
# All-or-nothing across the properties this script proves: a single invocation
# that proves more than one stands down only when EVERY one is declared, or it
# would silently stop proving the others.
# ---------------------------------------------------------------------------
if [ -f "$LISA_HOOK_DIR/lisa-edit-gate.sh" ]; then
    # shellcheck source=/dev/null
    . "$LISA_HOOK_DIR/lisa-edit-gate.sh"
    if LISA_GATE_COMMANDS="$(lisa_edit_gate_tasks post-tool structural-rules)"; then
        lisa_edit_gate_run "$FILE_PATH" "$LISA_GATE_COMMANDS"
        exit $?
    fi
fi


# Verify ast-grep configuration exists
if [ ! -f "sgconfig.yml" ]; then
    exit 0
fi

# Verify rules are defined
RULE_COUNT=$(find ast-grep/rules -name "*.yml" -o -name "*.yaml" 2>/dev/null | grep -v ".gitkeep" | wc -l | tr -d ' ')
if [ "$RULE_COUNT" -eq 0 ]; then
    exit 0
fi

# Detect package manager
if [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
    PKG_MANAGER="bun"
elif [ -f "pnpm-lock.yaml" ]; then
    PKG_MANAGER="pnpm"
elif [ -f "yarn.lock" ]; then
    PKG_MANAGER="yarn"
else
    PKG_MANAGER="npm"
fi

# Run ast-grep scan
echo "Running ast-grep scan on: $FILE_PATH"
if OUTPUT=$($PKG_MANAGER run sg:scan "$FILE_PATH" 2>&1); then
    echo "ast-grep: No issues found in $(basename "$FILE_PATH")"
    exit 0
else
    echo "ast-grep found issues in: $FILE_PATH" >&2
    echo "$OUTPUT" >&2
    exit 2
fi
