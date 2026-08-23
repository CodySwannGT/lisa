#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
# =============================================================================
# Lint-on-Edit Hook (PostToolUse - Write|Edit)
# =============================================================================
# Runs oxlint on each edited TypeScript file. Full ESLint remains enforced at
# the commit/CI chokepoint via the project lint scripts.
#
# oxlint is Rust-native and covers the fast-feedback rule tier in milliseconds;
# ESLint stays out of the edit-time path.
#
# Behavior:
#   - Exit 0: lint passes
#   - Exit 2: oxlint errors remain - blocks Claude so it fixes them immediately
#
# @see .claude/rules/verfication.md "Self-Correction Loop" section
# =============================================================================

# Extract file path from JSON input. Use jq for robust JSON parsing (never
# grep/sed/cut — a shape change would silently skip the blocking lint gate).
# Fail open without jq so we never hard-block an edit.
command -v jq >/dev/null 2>&1 || exit 0
FILE_PATH=$(cat | jq -r '.tool_input.file_path // empty')

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

# Resolve oxlint binary - prefer local node_modules/.bin
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

# oxlint (REQUIRED in the Phase 2 hybrid pipeline)
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

echo "Running oxlint on: $FILE_PATH"
OX_OUTPUT=$($OXLINT_CMD --quiet "$FILE_PATH" 2>&1)
OX_EXIT=$?
if [ $OX_EXIT -ne 0 ]; then
    case "$OX_OUTPUT" in
        *"No files found to lint"* | *" on 0 files"* | *" on 0 file"*)
            echo "oxlint: Ignored by lint config: $FILE_PATH"
            exit 0
            ;;
    esac
    echo "oxlint found errors in: $FILE_PATH" >&2
    echo "$OX_OUTPUT" >&2
    exit 2
fi

echo "oxlint: No errors in $(basename "$FILE_PATH")"
exit 0
