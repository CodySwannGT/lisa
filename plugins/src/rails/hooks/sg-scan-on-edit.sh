#!/bin/bash
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
# =============================================================================
# ast-grep Scan-on-Edit Hook (PostToolUse - Write|Edit)
# =============================================================================
# Runs ast-grep scan on each edited Ruby file to enforce structural code rules.
# Complements RuboCop by catching patterns that require AST-level analysis.
#
# Behavior:
#   - Exit 0: no issues found or ast-grep not configured
#   - Exit 1: issues found — blocks Claude so it fixes them immediately
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

# Check if file is in a recognized source directory
RELATIVE_PATH="${FILE_PATH#$CLAUDE_PROJECT_DIR/}"
case "$RELATIVE_PATH" in
    app/*|lib/*|config/*|spec/*) ;;
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

# Locate ast-grep binary — prefer local sg, then npx fallback
if command -v sg >/dev/null 2>&1; then
    SG_CMD="sg"
elif command -v npx >/dev/null 2>&1; then
    SG_CMD="npx @ast-grep/cli"
else
    echo "ast-grep: sg binary not found, skipping scan"
    exit 0
fi

# Run ast-grep scan
echo "Running ast-grep scan on: $FILE_PATH"
if OUTPUT=$($SG_CMD scan "$FILE_PATH" 2>&1); then
    echo "ast-grep: No issues found in $(basename "$FILE_PATH")"
    exit 0
else
    echo "ast-grep found issues in: $FILE_PATH" >&2
    echo "$OUTPUT" >&2
    exit 1
fi
