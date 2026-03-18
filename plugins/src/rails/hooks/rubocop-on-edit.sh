#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
# =============================================================================
# RuboCop Lint-and-Format-on-Edit Hook (PostToolUse - Write|Edit)
# =============================================================================
# Runs RuboCop -a (safe autocorrect) on each edited Ruby file, then checks for
# remaining unfixable errors. RuboCop serves as both formatter and linter
# for Ruby, so this single hook replaces the Prettier + ESLint pipeline.
#
# Behavior:
#   - Exit 0: RuboCop passes or auto-fix resolved all errors
#   - Exit 1: unfixable errors remain — blocks Claude so it fixes them immediately
#
# @see .claude/rules/verification.md "Self-Correction Loop" section
# =============================================================================

# Extract file path from JSON input
FILE_PATH=$(cat | grep -o '"file_path":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$FILE_PATH" ] || [ ! -f "$FILE_PATH" ]; then
    exit 0
fi

# Check if file type is supported (Ruby only)
case "${FILE_PATH##*.}" in
    rb) ;;
    *) exit 0 ;;
esac

# Validate project directory
if [ -z "${CLAUDE_PROJECT_DIR:-}" ]; then
    exit 0
fi

# Check if file is in a recognized source directory, excluding generated/vendored paths
RELATIVE_PATH="${FILE_PATH#$CLAUDE_PROJECT_DIR/}"
case "$RELATIVE_PATH" in
    db/migrate/*|db/schema.rb) exit 0 ;;
    vendor/*|bin/*|tmp/*|node_modules/*) exit 0 ;;
esac
case "$RELATIVE_PATH" in
    app/*|lib/*|spec/*|config/*|db/*) ;;
    *) exit 0 ;;
esac

cd "$CLAUDE_PROJECT_DIR" || exit 0

# Verify this is a Ruby project with Bundler
if [ ! -f "Gemfile" ]; then
    exit 0
fi

# Run RuboCop autocorrect — fail only on errors (not warnings/conventions)
echo "Running RuboCop on: $FILE_PATH"

# First pass: attempt safe auto-correct
OUTPUT=$(bundle exec rubocop -a --fail-level E "$FILE_PATH" 2>&1)
FIX_EXIT=$?

if [ $FIX_EXIT -eq 0 ]; then
    echo "RuboCop: No errors in $(basename "$FILE_PATH")"
    exit 0
fi

# Auto-fix resolved some issues but errors remain — re-run to get remaining errors
OUTPUT=$(bundle exec rubocop --fail-level E "$FILE_PATH" 2>&1)
LINT_EXIT=$?

if [ $LINT_EXIT -eq 0 ]; then
    echo "RuboCop: Auto-fixed all errors in $(basename "$FILE_PATH")"
    exit 0
fi

# Unfixable errors remain — block with feedback
echo "RuboCop found unfixable errors in: $FILE_PATH" >&2
echo "$OUTPUT" >&2
exit 1
