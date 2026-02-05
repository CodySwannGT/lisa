# Fix CDK tsconfig sourceMap/inlineSourceMap Conflict

## Problem

Lisa's CDK template causes a TypeScript build error in downstream CDK projects:

```
error TS5053: Option 'sourceMap' cannot be specified with option 'inlineSourceMap'.
```

**Root cause:** `tsconfig.base.json` (typescript stack) sets `sourceMap: true`. `tsconfig.cdk.json` extends it and adds `inlineSourceMap: true` without disabling `sourceMap`. These options are mutually exclusive in TypeScript.

**Inheritance chain:**
```
tsconfig.json → [tsconfig.cdk.json, tsconfig.local.json]
                    └→ tsconfig.base.json (sourceMap: true)
                       + inlineSourceMap: true ← CONFLICT
```

## Fix

Add `"sourceMap": false` to `cdk/copy-overwrite/tsconfig.cdk.json` to explicitly disable the inherited `sourceMap: true` from `tsconfig.base.json`.

**File:** `cdk/copy-overwrite/tsconfig.cdk.json`

**Before:**
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["es2020"],
    "inlineSourceMap": true,
    "inlineSources": true,
    ...
  }
}
```

**After:**
```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["es2020"],
    "sourceMap": false,
    "inlineSourceMap": true,
    "inlineSources": true,
    ...
  }
}
```

## Branch & PR

- **Branch:** `fix/cdk-tsconfig-sourcemap-conflict`
- **PR target:** `main`
- **PR:** To be created as draft

## Skills

- `/coding-philosophy`
- `/jsdoc-best-practices`
- `/git:commit`
- `/git:submit-pr`

## Task List

Create tasks using `TaskCreate` in the following order:

### Task 1: Add `sourceMap: false` to CDK tsconfig template

- **subject:** "Add sourceMap: false to CDK tsconfig.cdk.json template"
- **activeForm:** "Adding sourceMap: false to CDK tsconfig.cdk.json template"
- **Description:**

  **Type:** Bug

  **Description:** `tsconfig.base.json` sets `sourceMap: true` and `tsconfig.cdk.json` extends it adding `inlineSourceMap: true` without disabling `sourceMap`. TypeScript errors with `TS5053: Option 'sourceMap' cannot be specified with option 'inlineSourceMap'`.

  **Acceptance Criteria:**
  - [ ] `cdk/copy-overwrite/tsconfig.cdk.json` has `"sourceMap": false` in `compilerOptions`
  - [ ] `"sourceMap": false` appears before `"inlineSourceMap": true` for clarity

  **Relevant Research:**
  - `cdk/copy-overwrite/tsconfig.cdk.json` — the file to modify (line 7 has `inlineSourceMap`)
  - `typescript/copy-overwrite/tsconfig.base.json:12` — sets `sourceMap: true` (inherited by CDK)
  - `cdk/copy-overwrite/tsconfig.json` — extends `[tsconfig.cdk.json, tsconfig.local.json]`

  **Skills to Invoke:** `/coding-philosophy`

  **Implementation Details:**
  - File to modify: `cdk/copy-overwrite/tsconfig.cdk.json`
  - Add `"sourceMap": false` before `"inlineSourceMap": true` in `compilerOptions`

  **Testing Requirements:** N/A (JSON config file, no unit tests)

  **Verification:**
  - **Type:** `manual-check`
  - **Command:** `node -e "const base = require('./typescript/copy-overwrite/tsconfig.base.json'); const cdk = require('./cdk/copy-overwrite/tsconfig.cdk.json'); console.log('base.sourceMap:', base.compilerOptions.sourceMap); console.log('cdk.sourceMap:', cdk.compilerOptions.sourceMap); console.log('cdk.inlineSourceMap:', cdk.compilerOptions.inlineSourceMap); console.log('conflict:', base.compilerOptions.sourceMap && cdk.compilerOptions.inlineSourceMap && cdk.compilerOptions.sourceMap !== false);"`
  - **Expected:** `conflict: false`

  **Metadata:**
  ```json
  {
    "plan": "nifty-floating-thacker",
    "type": "bug",
    "skills": ["/coding-philosophy"],
    "verification": {
      "type": "manual-check",
      "command": "node -e \"const base = require('./typescript/copy-overwrite/tsconfig.base.json'); const cdk = require('./cdk/copy-overwrite/tsconfig.cdk.json'); console.log('conflict:', base.compilerOptions.sourceMap && cdk.compilerOptions.inlineSourceMap && cdk.compilerOptions.sourceMap !== false);\"",
      "expected": "conflict: false"
    }
  }
  ```

### Task 2: Run Lisa integration test against downstream CDK project

- **subject:** "Run Lisa integration test against Qualis infrastructure"
- **activeForm:** "Running Lisa integration test against Qualis infrastructure"
- **Description:**

  **Type:** Task

  **Description:** Apply the updated Lisa templates to `/Users/cody/workspace/qualis/infrastructure` and verify the sourceMap conflict is resolved.

  **Acceptance Criteria:**
  - [ ] `lisa .` runs successfully against the CDK project
  - [ ] `tsconfig.cdk.json` in the downstream project has `sourceMap: false`
  - [ ] No `TS5053` error when running the build

  **Relevant Research:**
  - Downstream project: `/Users/cody/workspace/qualis/infrastructure`
  - Use `/lisa:integration-test` skill

  **Skills to Invoke:** `/coding-philosophy`, `/lisa:integration-test`

  **Implementation Details:**
  - Run Lisa against `/Users/cody/workspace/qualis/infrastructure`
  - Verify `tsconfig.cdk.json` in the downstream project now includes `sourceMap: false`
  - Run the project's build script to confirm no TS5053 error

  **Testing Requirements:** Integration test via `/lisa:integration-test`

  **Verification:**
  - **Type:** `manual-check`
  - **Command:** `cd /Users/cody/workspace/qualis/infrastructure && cat tsconfig.cdk.json | node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync('/dev/stdin','utf8')); console.log('sourceMap:', d.compilerOptions.sourceMap, 'inlineSourceMap:', d.compilerOptions.inlineSourceMap);"`
  - **Expected:** `sourceMap: false inlineSourceMap: true`

  **Metadata:**
  ```json
  {
    "plan": "nifty-floating-thacker",
    "type": "task",
    "skills": ["/coding-philosophy", "/lisa:integration-test"],
    "verification": {
      "type": "manual-check",
      "command": "cd /Users/cody/workspace/qualis/infrastructure && cat tsconfig.cdk.json | node -e \"...\"",
      "expected": "sourceMap: false inlineSourceMap: true"
    }
  }
  ```

### Task 3: Commit changes and open draft PR

- **subject:** "Commit and submit draft PR for CDK sourceMap fix"
- **activeForm:** "Committing and submitting draft PR"
- **Description:**

  **Type:** Task

  **Description:** Use `/git:commit-and-submit-pr` to commit the fix and open a draft PR targeting `main`.

  **Acceptance Criteria:**
  - [ ] Changes committed with conventional commit message
  - [ ] Draft PR opened targeting `main`

  **Skills to Invoke:** `/coding-philosophy`, `/git:commit-and-submit-pr`

  **Implementation Details:**
  - Branch: `fix/cdk-tsconfig-sourcemap-conflict`
  - Commit message: `fix(cdk): disable sourceMap in tsconfig.cdk.json to prevent TS5053 conflict`
  - PR target: `main`

  **Testing Requirements:** N/A

  **Verification:**
  - **Type:** `manual-check`
  - **Command:** `gh pr view --json state,title`
  - **Expected:** PR exists with state "OPEN"

  **Metadata:**
  ```json
  {
    "plan": "nifty-floating-thacker",
    "type": "task",
    "skills": ["/coding-philosophy", "/git:commit-and-submit-pr"],
    "verification": {
      "type": "manual-check",
      "command": "gh pr view --json state,title",
      "expected": "PR exists with state OPEN"
    }
  }
  ```

### Task 4: Archive the plan

- **subject:** "Archive the nifty-floating-thacker plan"
- **activeForm:** "Archiving the plan"
- **Description:**

  **Type:** Task

  **Description:** Archive this plan after all other tasks are complete.

  **Acceptance Criteria:**
  - [ ] Created folder `./plans/completed/nifty-floating-thacker`
  - [ ] Renamed plan file to reflect actual contents (e.g., `fix-cdk-tsconfig-sourcemap.md`)
  - [ ] Moved plan into `./plans/completed/nifty-floating-thacker/`
  - [ ] Read session IDs from the plan file
  - [ ] Moved `~/.claude/tasks/<session-id>` directories to `./plans/completed/nifty-floating-thacker/tasks`
  - [ ] Updated any `in_progress` tasks to `completed`
  - [ ] Committed changes
  - [ ] Pushed to PR

  **Skills to Invoke:** `/coding-philosophy`

  **Implementation Details:**
  1. Create folder `./plans/completed/nifty-floating-thacker`
  2. Rename this plan to `fix-cdk-tsconfig-sourcemap.md`
  3. Move it into `./plans/completed/nifty-floating-thacker/`
  4. Read session IDs from the moved plan file's `## Sessions` section
  5. For each session ID, move `~/.claude/tasks/<session-id>` to `./plans/completed/nifty-floating-thacker/tasks`
  6. Update any `in_progress` tasks to `completed`
  7. Commit changes
  8. Push to PR

  **Testing Requirements:** N/A

  **Verification:**
  - **Type:** `manual-check`
  - **Command:** `ls ./plans/completed/nifty-floating-thacker/`
  - **Expected:** Plan file and tasks directory present

  **Metadata:**
  ```json
  {
    "plan": "nifty-floating-thacker",
    "type": "task",
    "skills": ["/coding-philosophy"],
    "verification": {
      "type": "manual-check",
      "command": "ls ./plans/completed/nifty-floating-thacker/",
      "expected": "Plan file and tasks directory present"
    }
  }
  ```

## Verification

1. Verify `cdk/copy-overwrite/tsconfig.cdk.json` has `sourceMap: false`
2. Run Lisa against `/Users/cody/workspace/qualis/infrastructure` and confirm no `TS5053` error
3. PR is open targeting `main`

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| 70fa984e-f0ff-4c93-a80b-2ce43a2152b0 | 2026-02-05T16:17:00Z | plan |
