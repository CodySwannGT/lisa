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
#   - Exit 2: issues found — blocks Claude so it fixes them immediately
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
    exit 2
fi
