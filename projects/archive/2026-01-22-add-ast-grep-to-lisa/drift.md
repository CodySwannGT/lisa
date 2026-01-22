# Drift Report: Add ast-grep to Lisa

This document captures the differences between the project requirements and the actual implementation.

## Summary

Overall, the implementation satisfies the requirements with two significant deviations:

1. **Task 7: Pre-commit Hook** - ast-grep NOT added to pre-commit hook
2. **Task 8: quality.yml** - ast-grep added to TypeScript template, not Lisa's root quality.yml

## Detailed Drift Analysis

### Task 1: Add ast-grep Configuration Files
**Status: FULLY IMPLEMENTED**

All files exist as specified:
- `typescript/copy-overwrite/sgconfig.yml` - Present with correct configuration
- `typescript/copy-overwrite/ast-grep/rules/.gitkeep` - Present
- `typescript/copy-overwrite/ast-grep/rule-tests/.gitkeep` - Present
- `typescript/copy-overwrite/ast-grep/utils/.gitkeep` - Present

### Task 2: Add @ast-grep/cli Dependency
**Status: FULLY IMPLEMENTED**

- `@ast-grep/cli` added to `typescript/merge/package.json` devDependencies with version `^0.40.4`
- `@ast-grep/cli` added to trustedDependencies array

### Task 3: Add sg:scan Script
**Status: FULLY IMPLEMENTED**

- `sg:scan` script defined as `"ast-grep scan"` in `typescript/merge/package.json`

### Task 4: Create ast-grep Claude Hook
**Status: FULLY IMPLEMENTED WITH ENHANCEMENTS**

The hook `typescript/copy-overwrite/.claude/hooks/sg-scan-on-edit.sh` exists and is executable with:
- JSON input extraction (uses different approach than spec but functionally equivalent)
- File extension validation (supports ts, tsx, js, jsx, mjs, cjs)
- Source directory validation (expanded list beyond spec)
- Package manager detection (includes pnpm in addition to spec)
- sgconfig.yml existence check
- **Enhancement**: Also checks if any rules are defined (skips if rules directory only has .gitkeep)
- Blocking behavior with non-zero exit on errors

### Task 5: Register ast-grep Hook in settings.json
**Status: FULLY IMPLEMENTED**

The hook is registered in `typescript/merge/.claude/settings.json` with:
- Command: `$CLAUDE_PROJECT_DIR/.claude/hooks/sg-scan-on-edit.sh`
- Timeout: 30 seconds
- Correct PostToolUse matcher for Write|Edit

### Task 6: Add ast-grep to lint-staged
**Status: FULLY IMPLEMENTED**

`.lintstagedrc.json` updated with:
```json
"*.{js,mjs,ts,tsx}": ["eslint --quiet --cache --fix", "ast-grep scan"]
```

### Task 7: Add ast-grep to Pre-commit Hook
**Status: NOT IMPLEMENTED**

The requirement specified adding ast-grep scan to the Husky pre-commit hook with a conditional check for sgconfig.yml. However, **no changes were made to the pre-commit hook**.

The pre-commit hook at `typescript/copy-contents/.husky/pre-commit` does not contain any ast-grep references.

**Reason for drift**: The implementation relies on lint-staged to run ast-grep (Task 6) rather than adding a separate step to the pre-commit hook. Since lint-staged already runs during pre-commit, ast-grep will still execute on staged files. However, this means:
- No explicit "Running ast-grep scan..." message in pre-commit output
- The skip behavior when sgconfig.yml doesn't exist is handled differently (lint-staged may fail if command not found)

### Task 8: Add ast-grep Job to quality.yml Workflow
**Status: PARTIALLY IMPLEMENTED - DIFFERENT LOCATION**

The requirement specified adding the sg_scan job to `/Users/cody/workspace/lisa/.github/workflows/quality.yml` (Lisa's own workflow).

**What was implemented:**
- The sg_scan job was added to `typescript/copy-overwrite/.github/workflows/quality.yml` (the TypeScript template)
- Lisa's own quality.yml at `.github/workflows/quality.yml` does NOT have the sg_scan job

**Implications:**
- TypeScript projects that receive Lisa configurations WILL get the sg_scan job in their CI/CD
- Lisa's own repository will NOT run ast-grep scan in its quality checks

**Recommendation**: The implementation is arguably correct since Lisa itself doesn't have ast-grep rules defined. The TypeScript template approach ensures projects that use Lisa will get the ast-grep workflow.

## Recommendations

1. **For Task 7**: If explicit pre-commit ast-grep scanning is desired with its own output message, add the following to the pre-commit hook:
   ```bash
   # Run ast-grep scan if sgconfig.yml exists
   if [ -f "sgconfig.yml" ]; then
     echo "Running ast-grep scan..."
     $RUNNER sg:scan
   fi
   ```

2. **For Task 8**: If Lisa's own repository should also run ast-grep scans, either:
   - Add ast-grep rules to Lisa's repository
   - Add the sg_scan job to Lisa's quality.yml (will be skipped if no sgconfig.yml)

## Verification Commands Used

```bash
# Task 1
ls -la typescript/copy-overwrite/sgconfig.yml typescript/copy-overwrite/ast-grep/*/

# Task 2 & 3
cat typescript/merge/package.json | grep -A2 '@ast-grep/cli'
cat typescript/merge/package.json | grep 'sg:scan'

# Task 4
ls -la typescript/copy-overwrite/.claude/hooks/sg-scan-on-edit.sh

# Task 5
cat typescript/merge/.claude/settings.json | grep sg-scan

# Task 6
cat typescript/copy-overwrite/.lintstagedrc.json

# Task 7
grep 'ast-grep\|sg:scan' typescript/copy-contents/.husky/pre-commit

# Task 8
grep 'sg_scan' .github/workflows/quality.yml
grep 'sg_scan' typescript/copy-overwrite/.github/workflows/quality.yml
```
