# Task: Add ast-grep to lint-staged Configuration

**Type:** Task
**Parent:** None

## Description

Add ast-grep scan to the lint-staged configuration so it runs on staged TypeScript/JavaScript files during pre-commit. This ensures code is scanned before being committed.

## Acceptance Criteria

- [ ] ast-grep scan is added to `.lintstagedrc.json` for TS/JS files
- [ ] Configuration uses the correct file patterns (*.ts, *.tsx, *.js, *.jsx)
- [ ] ast-grep runs after ESLint in the command array

## Relevant Research

From research.md:

**lint-staged Configuration:** `typescript/copy-overwrite/.lintstagedrc.json`
```json
{
  "*.{js,mjs,ts,tsx}": ["eslint --quiet --cache --fix"],
  "*.{json,mjs,js,ts,jsx,tsx,html,md,mdx,css,scss,yaml,yml,graphql}": ["prettier --write"]
}
```

**lint-staged Integration from claude-code-safety-net:**
```json
{
  "*.{js,ts,cjs,mjs,d.cts,d.mts,json,jsonc}": [
    "biome check --write --no-errors-on-unmatched",
    "ast-grep scan"
  ]
}
```

The lint-staged config uses `copy-overwrite` strategy because it should match Lisa's patterns.

## Applicable Skills

Invoke these skills before writing implementation code:

- `/coding-philosophy` - Always required for all code

## Implementation Details

1. Read the existing `typescript/copy-overwrite/.lintstagedrc.json` file
2. Add `ast-grep scan` to the TS/JS file pattern command array:
```json
{
  "*.{js,mjs,ts,tsx}": ["eslint --quiet --cache --fix", "ast-grep scan"],
  "*.{json,mjs,js,ts,jsx,tsx,html,md,mdx,css,scss,yaml,yml,graphql}": ["prettier --write"]
}
```

Files to modify:
- `typescript/copy-overwrite/.lintstagedrc.json`

## Testing Requirements

### Unit Tests
N/A - Configuration file modification

### Integration Tests
N/A - no integration points

### E2E Tests
N/A - no user-facing changes

## Documentation Requirements

### Code Documentation (JSDoc)
N/A - JSON configuration file

### Database Comments
N/A - no database changes

### GraphQL Descriptions
N/A - no GraphQL changes

## Verification

### Type
`manual-check`

### Proof Command
```bash
cat /Users/cody/workspace/lisa/typescript/copy-overwrite/.lintstagedrc.json
```

### Expected Output
Should show the lint-staged configuration with `ast-grep scan` included in the TS/JS file pattern array alongside ESLint.

## Implementation Steps

### Step 0: Setup Tracking
Use TodoWrite to create task tracking todos:
- Invoke skills
- Write failing tests
- Write implementation
- Verify implementation
- Update documentation
- Commit changes

### Step 1: Invoke Skills
Mark "Invoke skills" as in_progress.

1. Mark this task as "in progress" in `progress.md`
2. Invoke each skill listed in "Applicable Skills" using the Skill tool

Mark "Invoke skills" as completed.

### Step 2: Write Failing Tests
Mark "Write failing tests" as in_progress.

N/A - Configuration file only, no tests needed.

Mark "Write failing tests" as completed.

### Step 3: Write Implementation
Mark "Write implementation" as in_progress.

1. Read `typescript/copy-overwrite/.lintstagedrc.json`
2. Add `ast-grep scan` to the TS/JS file pattern

Mark "Write implementation" as completed.

### Step 4: Verify Implementation
Mark "Verify implementation" as in_progress.

1. Run the Proof Command from Verification section
2. Confirm output matches Expected Output
3. If verification fails, fix and re-verify

Mark "Verify implementation" as completed.

### Step 5: Update Documentation
Mark "Update documentation" as in_progress.

N/A - No documentation updates needed for this task.

Mark "Update documentation" as completed.

### Step 6: Commit Changes
Mark "Commit changes" as in_progress.

1. Run `/git:commit`
2. Mark this task as "completed" in `progress.md`
3. Record any learnings in `findings.md`

Mark "Commit changes" as completed.
