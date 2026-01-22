#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.

# Hook script to lint and auto-fix files with ESLint after Claude edits them
# This script receives JSON input via stdin with tool information
# Reference: https://docs.claude.com/en/docs/claude-code/hooks

# Read the JSON input from stdin
JSON_INPUT=$(cat)

# Extract the file path from the tool_input
# The Edit tool input contains a "file_path" field in the tool_input object
FILE_PATH=$(echo "$JSON_INPUT" | grep -o '"tool_input":{[^}]*"file_path":"[^"]*"' | grep -o '"file_path":"[^"]*"' | cut -d'"' -f4)

# Check if we successfully extracted a file path
if [ -z "$FILE_PATH" ]; then
    echo "⚠ Skipping ESLint: Could not extract file path from Edit tool input" >&2
    exit 0  # Exit gracefully to not interrupt Claude's workflow
fi

# Check if the file exists
if [ ! -f "$FILE_PATH" ]; then
    echo "⚠ Skipping ESLint: File does not exist: $FILE_PATH" >&2
    exit 0  # Exit gracefully
fi

# Get the file extension
FILE_EXT="${FILE_PATH##*.}"

# Check if this is a TypeScript file that should be linted
# Based on package.json lint command: "eslint \"{src,apps,libs,test}/**/*.ts\""
case "$FILE_EXT" in
    ts|tsx)
        # File type is supported for linting
        ;;
    *)
        echo "ℹ Skipping ESLint: File type .$FILE_EXT is not configured for linting"
        exit 0
        ;;
esac

# Check if the file is in a directory that should be linted
# Extract the relative path from the project directory
RELATIVE_PATH="${FILE_PATH#$CLAUDE_PROJECT_DIR/}"

# Check if the file is in src, apps, libs, or test directories
case "$RELATIVE_PATH" in
    src/*|apps/*|libs/*|test/*|features/*|components/*|hooks/*|screens/*|app/*|constants/*|utils/*|providers/*|stores/*)
        # File is in a directory configured for linting
        ;;
    *)
        echo "ℹ Skipping ESLint: File is not in src/, apps/, libs/, or test/ directory"
        exit 0
        ;;
esac

# Change to the project directory to ensure package manager commands work
cd "$CLAUDE_PROJECT_DIR" || exit 0

# Detect package manager based on lock file presence
detect_package_manager() {
    if [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
        echo "bun"
    elif [ -f "pnpm-lock.yaml" ]; then
        echo "pnpm"
    elif [ -f "yarn.lock" ]; then
        echo "yarn"
    elif [ -f "package-lock.json" ]; then
        echo "npm"
    else
        echo "npm"  # Default fallback
    fi
}

PKG_MANAGER=$(detect_package_manager)

# Run ESLint with --fix on the specific file
echo "🔍 Running ESLint --fix on: $FILE_PATH"

# Run ESLint with fix flag and capture output
$PKG_MANAGER run lint --fix "$FILE_PATH" 2>&1 | while IFS= read -r line; do
    # Filter out common noise from package manager output
    if [[ ! "$line" =~ ^$ ]] && \
       [[ ! "$line" =~ "Need to install the following packages" ]] && \
       [[ ! "$line" =~ "Ok to proceed" ]]; then
        echo "$line"
    fi
done

# Check the exit status (use PIPESTATUS to get the eslint exit code, not the while loop)
EXIT_CODE=${PIPESTATUS[0]}

if [ $EXIT_CODE -eq 0 ]; then
    echo "✓ ESLint: No issues found in $(basename "$FILE_PATH")"
elif [ $EXIT_CODE -eq 1 ]; then
    echo "✓ ESLint: Fixed issues in $(basename "$FILE_PATH")"
    echo "  Some issues were automatically fixed. Please review the changes."
else
    echo "⚠ ESLint found issues that couldn't be auto-fixed in: $FILE_PATH" >&2
    echo "  You may need to run '$PKG_MANAGER run lint:fix' manually or fix the issues by hand." >&2
fi

# Always exit successfully to not interrupt Claude's workflow
exit 0