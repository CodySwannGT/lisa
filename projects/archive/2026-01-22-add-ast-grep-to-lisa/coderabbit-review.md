# CodeRabbit Review

## File: typescript/copy-overwrite/.lintstagedrc.json
**Line:** 2
**Type:** potential_issue

**Comment:**
Add sgconfig.yml before using ast-grep scan in lint-staged.

ast-grep scan requires sgconfig.yml and will error if the configuration file is not found. The tool searches the current directory and parent directories for the config, but there is no sgconfig.yml in this repository. This change will break the pre-commit workflow for all developers.

**Prompt for AI Agent:**
In @typescript/copy-overwrite/.lintstagedrc.json at line 2, The lint-staged entry for ".{js,mjs,ts,tsx}" runs "ast-grep scan" which fails if sgconfig.yml is missing; either add a repository root sgconfig.yml (minimum: ruleDirs: ["rules"]) or scaffold it via "ast-grep new", or alter the lint-staged command to pass an explicit config path ("ast-grep scan --config path/to/sgconfig.yml"); update the config or command referencing the pattern ".{js,mjs,ts,tsx}" and the "ast-grep scan" invocation so pre-commit hooks no longer error due to a missing sgconfig.yml.

---

## File: typescript/copy-overwrite/.claude/hooks/sg-scan-on-edit.sh
**Line:** 42 to 58
**Type:** potential_issue

**Comment:**
Validate CLAUDE_PROJECT_DIR before use.

The script assumes CLAUDE_PROJECT_DIR is set but doesn't validate it. If unset:
- Line 44: RELATIVE_PATH becomes the full FILE_PATH (path stripping fails)
- Line 58: cd "" fails silently with exit 0

**Suggested fix:**
```bash
# Validate CLAUDE_PROJECT_DIR is set
if [ -z "${CLAUDE_PROJECT_DIR:-}" ]; then
    echo "Skipping ast-grep: CLAUDE_PROJECT_DIR not set" >&2
    exit 0
fi
```

**Prompt for AI Agent:**
In @typescript/copy-overwrite/.claude/hooks/sg-scan-on-edit.sh around lines 42 - 58, The script uses CLAUDE_PROJECT_DIR without validating it which can make RELATIVE_PATH incorrect and the cd "$CLAUDE_PROJECT_DIR" call unsafe; add a guard near the top that checks CLAUDE_PROJECT_DIR is set and non-empty (and optionally is a directory) and bail with a clear error if not, then compute RELATIVE_PATH="${FILE_PATH#$CLAUDE_PROJECT_DIR/}" and continue; ensure any early exits use non-zero status to indicate failure so callers can detect the problem.

---

## File: typescript/copy-overwrite/.claude/hooks/sg-scan-on-edit.sh
**Line:** 11 to 13
**Type:** potential_issue

**Comment:**
JSON parsing with grep/cut is fragile.

The current regex-based JSON extraction can fail with:
- Nested objects in tool_input
- Escaped quotes in file paths
- Multiline JSON formatting

**Suggested fix using jq:**
```bash
# Extract the file path from the tool_input
# The Edit tool input contains a "file_path" or "path" field in the tool_input object
FILE_PATH=$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path // .tool_input.path // empty' 2>/dev/null)
```

If jq cannot be assumed available, add a fallback or document the dependency.

**Prompt for AI Agent:**
In @typescript/copy-overwrite/.claude/hooks/sg-scan-on-edit.sh around lines 11 - 13, Replace the fragile grep/cut JSON extraction in sg-scan-on-edit.sh that sets FILE_PATH from JSON_INPUT with a robust parser: use jq to extract .tool_input.file_path (e.g., FILE_PATH=$(echo "$JSON_INPUT" | jq -r '.tool_input.file_path')) and add a fallback or clear error if jq is not installed; ensure you handle null/empty results and preserve quoting/escaped characters.
