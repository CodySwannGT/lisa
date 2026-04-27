#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
# =============================================================================
# Lint-on-Edit Hook (PostToolUse - Write|Edit)
# =============================================================================
# Runs oxlint --fix, then ESLint --fix --quiet --cache on each edited
# TypeScript file. Part of the inline self-correction pipeline:
#   prettier → ast-grep → oxlint --fix → eslint --fix
#
# oxlint runs first because it's a Rust-native linter (~1000x faster) that
# covers the majority of rules, leaving only the slow / type-aware / plugin
# rules for ESLint to handle.
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

# Resolve oxlint and ESLint binaries — prefer local node_modules/.bin
if [ -x "./node_modules/.bin/oxlint" ]; then
    OXLINT_CMD="./node_modules/.bin/oxlint"
elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
    OXLINT_CMD="bunx oxlint"
elif [ -f "pnpm-lock.yaml" ]; then
    OXLINT_CMD="pnpm exec oxlint"
elif [ -f "yarn.lock" ]; then
    OXLINT_CMD="yarn exec oxlint"
else
    OXLINT_CMD="npx oxlint"
fi

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

# 1) oxlint --fix (REQUIRED in the Phase 2 hybrid pipeline)
# If oxlint is missing the project is out of sync with the current Lisa
# governance — fail loudly rather than silently skipping. ESLint alone is
# no longer a complete lint pass.
if [ ! -x "./node_modules/.bin/oxlint" ] && ! command -v "${OXLINT_CMD%% *}" >/dev/null 2>&1; then
    echo "oxlint is required but not installed in this project." >&2
    echo "Add 'oxlint' as a devDependency (Lisa governance pins it via package.lisa.json) and run install." >&2
    exit 2
fi

if [ ! -f ".oxlintrc.json" ] && [ ! -f ".oxlintrc.jsonc" ] && [ ! -f "oxlint.config.ts" ]; then
    echo "oxlint is installed but no .oxlintrc.json found. Run 'lisa update' to install the stack template." >&2
    exit 2
fi

echo "Running oxlint --fix on: $FILE_PATH"
OX_OUTPUT=$($OXLINT_CMD --fix --quiet "$FILE_PATH" 2>&1)
OX_EXIT=$?
if [ $OX_EXIT -ne 0 ]; then
    # Re-run without --fix to capture remaining errors
    OX_OUTPUT=$($OXLINT_CMD --quiet "$FILE_PATH" 2>&1)
    OX_EXIT=$?
    if [ $OX_EXIT -ne 0 ]; then
        echo "oxlint found unfixable errors in: $FILE_PATH" >&2
        echo "$OX_OUTPUT" >&2
        exit 2
    fi
fi

# 2) ESLint --fix --quiet --cache
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
