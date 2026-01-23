#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.

# Hook script to run ast-grep scan after Claude edits files
# This script receives JSON input via stdin with tool information
# Reference: https://docs.claude.com/en/docs/claude-code/hooks
# Note: This hook is BLOCKING - it returns non-zero exit codes so Claude must fix issues

# Extract file path from JSON input
FILE_PATH=$(cat | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)

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

cd "$CLAUDE_PROJECT_DIR" || exit 0

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
    exit 1
fi
