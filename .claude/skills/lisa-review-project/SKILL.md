---
name: lisa-review-project
description: This skill should be used when comparing Lisa's source templates against a target project's implementation to identify drift. It validates the Lisa directory, detects project types, scans template directories, compares files, categorizes changes, and offers to adopt improvements back into Lisa. This is the inverse of lisa:review-implementation.
---

# Lisa Project Review

This skill compares Lisa's source templates against a target project that has Lisa applied, identifying what the project has changed from Lisa and offering to adopt those improvements back into Lisa.

This is the inverse of `/lisa-review-implementation`:
- **lisa:review-implementation**: Run FROM project → "What did I change from Lisa?"
- **lisa:review-project**: Run FROM Lisa → "What has this project changed?"

## Prerequisites

This skill must be run FROM the Lisa repository directory. The target project must have Lisa already applied.

## Instructions

### Step 1: Validate Lisa Directory

Confirm running from Lisa by checking for `src/core/lisa.ts`.

If not in Lisa, error with:
```
This command must be run FROM the Lisa repository.

Current directory does not contain src/core/lisa.ts.

Usage: /lisa-review-project /path/to/target-project
```

### Step 2: Validate Arguments

If no project path provided, ask the user:
```
Which project would you like to review?

Path: [user provides path]
```

Validate the project path:
1. Check the path exists and is a directory
2. Check at least one project marker exists:
   - `package.json` (Node-based projects)
   - `Gemfile` or `config/application.rb` (Rails projects)

### Step 3: Detect Project Types

Parse the project's `package.json` and filesystem to detect its type(s):

- **npm-package**: `package.json` without `"private": true` AND has `main`, `bin`, `exports`, or `files`
- **cdk**: `cdk.json` exists OR `aws-cdk` in package.json dependencies
- **nestjs**: `nest-cli.json` exists OR `@nestjs` in package.json dependencies
- **expo**: `app.json` exists OR `eas.json` exists OR `expo` in package.json dependencies
- **typescript**: `tsconfig.json` exists OR `typescript` in package.json dependencies
- **rails**: `Gemfile` exists OR `config/application.rb` exists

Build the type hierarchy. Example: if `expo` detected, types = `[all, typescript, expo]`

If no types detected, use `[all]`.

### Step 4: Scan Lisa Template Directories

Instead of reading a manifest, scan Lisa's template directories directly to build the list of managed files.

For each type in the hierarchy (e.g., `[all, typescript, expo]`):
1. List files in `{type}/copy-overwrite/` — record each as `(relativePath, "copy-overwrite", sourceTemplate)`
2. List files in `{type}/copy-contents/` — record each as `(relativePath, "copy-contents", sourceTemplate)`
3. If `{type}/package-lisa/package.lisa.json` exists, include `package.json` in the managed set and build its expected contents by merging every detected type's package-lisa template in hierarchy order.
4. If the same `relativePath` appears in multiple copy-* types, the most specific type wins (last in hierarchy).

This gives you the complete list of Lisa-managed files and their source templates.

**Skip these strategies** (they're intentionally customized):
- `create-only` - meant to be customized by project
- `merge` - already merged into project's file

### Step 5: Compare Files

For files with source found and strategy is `copy-overwrite` or `copy-contents`:

1. Read both the Lisa source and project version
2. If identical, mark as "in-sync"
3. If different:
   - Generate diff using: `diff -u "{lisa-source}" "{project-file}" || true`
   - Mark as "drifted"
   - Store diff for report

### Step 6: Analyze and Categorize

For each drifted file, provide brief analysis:

- **Improvement**: Change that makes the file better (better CI config, cleaner code, etc.)
- **Customization**: Change specific to this project (environment config, custom paths, etc.)
- **Bug fix**: Fixing an issue in Lisa's template
- **Divergence**: Change that's neither an improvement nor needed customization (concerning)

### Step 7: Generate Report

Create a markdown report:

```markdown
# Lisa Project Review

**Lisa Directory:** {lisa-path}
**Target Project:** {project-path}
**Project Types:** {types}
**Project Name:** {from package.json name or basename}
**Generated:** {current date/time ISO}

## Summary

- **Total managed files:** X
- **In sync:** X
- **Drifted:** X
- **Intentionally customized (create-only/merge):** X
- **Source not found:** X

## Drifted Files

### {relative/path/to/file}

**Source:** {type}/copy-overwrite/{path}
**Strategy:** copy-overwrite
**Category:** Improvement

<details>
<summary>View diff (Lisa <- Project)</summary>

\`\`\`diff
{diff output}
\`\`\`

</details>

**Analysis:** {Brief analysis of the change and why it matters}

---

[Repeat for each drifted file]

## Files Present in Lisa Templates but Missing from Project

These files exist in Lisa templates but not in the project:

- {file1}
- {file2}

This might mean:
- Lisa hasn't been applied to this project yet
- The file was deleted by the project
- The file is gitignored

## Intentionally Customized

These files use `create-only` or `merge` strategies and are meant to be customized:

- {file1}
- {file2}

## In Sync Files

<details>
<summary>X files match Lisa templates exactly</summary>

- {file1}
- {file2}

</details>
```

### Step 8: Offer to Adopt Changes

After the report, present the findings:

```
I found X files that have drifted from Lisa's templates.

[List files with categories]

Would you like to:
1. Review specific drifted files in detail
2. Adopt improvements from this project back into Lisa
3. Just view the full report
4. Done - no changes
```

If user wants to adopt improvements:

1. Ask which files to adopt (let them select multiple)
2. For each selected file:
   - Determine the target path in Lisa (preserve type directory)
   - Confirm: "Copy project version to `{type}/copy-overwrite/{path}`?"
   - If confirmed, use Write tool to copy project file to Lisa
   - Report success

### Important Notes

- **Never auto-adopt without confirmation** - always ask the user first
- **Preserve the most specific type directory** - if a file exists in both `typescript/` and `all/`, adopt to where it currently exists in Lisa
- **Handle missing files gracefully** - if project file is missing but exists in Lisa templates, note it (possible deletion or git-ignored)
- **Compare carefully** - some differences may be platform-specific (line endings, env vars) and should NOT be adopted
- The diff shows "Lisa <- Project" (what project changed FROM Lisa)
