#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
# =============================================================================
# ESLint Lint-on-Edit Hook (PostToolUse - Write|Edit)
# =============================================================================
# Runs ESLint --fix with --quiet --cache on each edited TypeScript file.
# Part of the inline self-correction pipeline: prettier → ast-grep → eslint.
#
# Behavior:
#   - Exit 0: lint passes or auto-fix resolved all errors
#   - Exit 2: unfixable errors remain — blocks Claude so it fixes them immediately
#
# @see .claude/rules/verfication.md "Self-Correction Loop" section
# =============================================================================

# Extract file path from JSON input
FILE_PATH=$(cat | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
    exit 0
fi

# Check if file type is supported (TypeScript only)
case "${FILE_PATH##*.}" in
    ts|tsx) ;;
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

# Resolve ESLint binary — prefer local node_modules/.bin, then package-manager exec
if [ -x "./node_modules/.bin/eslint" ]; then
    ESLINT_CMD="./node_modules/.bin/eslint"
elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
    ESLINT_CMD="bunx eslint"
elif [ -f "pnpm-lock.yaml" ]; then
    ESLINT_CMD="pnpm exec eslint"
elif [ -f "yarn.lock" ]; then
    ESLINT_CMD="yarn exec eslint"
else
    ESLINT_CMD="npx eslint"
fi

# Run ESLint with --fix --quiet --cache on the specific file
# --quiet: suppress warnings, only show errors
# --cache: use ESLint cache for performance
# --rule: disable no-unused-vars auto-fix to prevent removing imports that Claude
#         plans to use in a subsequent edit (pre-commit hook still catches them)
echo "Running ESLint --fix on: $FILE_PATH"

# First pass: attempt auto-fix
OUTPUT=$($ESLINT_CMD --fix --quiet --cache --rule '@typescript-eslint/no-unused-vars: off' "$FILE_PATH" 2>&1)
FIX_EXIT=$?

if [ $FIX_EXIT -eq 0 ]; then
    echo "ESLint: No errors in $(basename "$FILE_PATH")"
    exit 0
fi

# Auto-fix resolved some issues but errors remain — re-run to get remaining errors
OUTPUT=$($ESLINT_CMD --quiet --cache "$FILE_PATH" 2>&1)
LINT_EXIT=$?

if [ $LINT_EXIT -eq 0 ]; then
    echo "ESLint: Auto-fixed all errors in $(basename "$FILE_PATH")"
    exit 0
fi

# Unfixable errors remain — block with feedback
echo "ESLint found unfixable errors in: $FILE_PATH" >&2
echo "$OUTPUT" >&2
exit 2