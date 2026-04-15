#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.

# Hook script to format files with Prettier after Claude edits them
# This script receives JSON input via stdin with tool information
# Reference: https://docs.claude.com/en/docs/claude-code/hooks

# Read the JSON input from stdin
JSON_INPUT=$(cat)

# Extract the file path from the tool_input
# The Edit tool input contains a "file_path" field in the tool_input object
FILE_PATH=$(echo "$JSON_INPUT" | grep -o '"tool_input":{[^}]*"file_path":"[^"]*"' | grep -o '"file_path":"[^"]*"' | cut -d'"' -f4)

# Check if we successfully extracted a file path
if [ -z "$FILE_PATH" ]; then
    echo "⚠ Skipping Prettier: Could not extract file path from Edit tool input" >&2
    exit 0  # Exit gracefully to not interrupt Claude's workflow
fi

# Check if the file exists
if [ ! -f "$FILE_PATH" ]; then
    echo "⚠ Skipping Prettier: File does not exist: $FILE_PATH" >&2
    exit 0  # Exit gracefully
fi

# Get the file extension
FILE_EXT="${FILE_PATH##*.}"

# Check if this is a TypeScript or JavaScript file that should be formatted
# Based on package.json format command: "prettier --write \"src/**/*.ts\" \"test/**/*.ts\""
case "$FILE_EXT" in
    ts|tsx|js|jsx|json)
        # File type is supported for formatting
        ;;
    *)
        echo "ℹ Skipping Prettier: File type .$FILE_EXT is not configured for auto-formatting"
        exit 0
        ;;
esac

# Change to the project directory to ensure package manager commands work
cd "$CLAUDE_PROJECT_DIR" || exit 0

# Resolve Prettier binary — prefer local node_modules/.bin, then package-manager exec
if [ -x "./node_modules/.bin/prettier" ]; then
    PRETTIER_CMD="./node_modules/.bin/prettier"
    PKG_MANAGER="npm"
elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
    PRETTIER_CMD="bunx prettier"
    PKG_MANAGER="bun"
elif [ -f "pnpm-lock.yaml" ]; then
    PRETTIER_CMD="pnpm exec prettier"
    PKG_MANAGER="pnpm"
elif [ -f "yarn.lock" ]; then
    PRETTIER_CMD="yarn exec prettier"
    PKG_MANAGER="yarn"
else
    PRETTIER_CMD="npx prettier"
    PKG_MANAGER="npm"
fi

# Run Prettier on the specific file
echo "🎨 Running Prettier on: $FILE_PATH"
$PRETTIER_CMD --write "$FILE_PATH" 2>&1 | grep -v "run v" | grep -v "Done in"

# Check the exit status
if [ ${PIPESTATUS[0]} -eq 0 ]; then
    echo "✓ Successfully formatted: $(basename "$FILE_PATH")"
else
    echo "⚠ Prettier formatting failed for: $FILE_PATH" >&2
    echo "  You may need to run '$PKG_MANAGER run format' manually to fix formatting issues." >&2
fi

# Always exit successfully to not interrupt Claude's workflow
exit 0