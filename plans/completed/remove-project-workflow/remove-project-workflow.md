# Plan: Remove Deprecated Project Workflow and Update HUMAN.md

## Summary

Remove all deprecated project workflow files (commands, skills, templates) completely, add them to Lisa's `deletions.json` so target projects also clean up, copy the two new plan commands from template to root, and rewrite HUMAN.md to document the plan-based workflow.

## Branch

Create branch `chore/remove-project-workflow` from `main`. PR targets `main`.

## What Gets Deleted

### 1. Root project commands (17 files)

Delete entire directory: `.claude/commands/project/`

### 2. Template project commands (17 files)

Delete entire directory: `all/copy-overwrite/.claude/commands/project/`

### 3. Root project skills (17 directories)

Delete all `project-*` skill directories from `.claude/skills/`:
- `project-add-test-coverage`, `project-archive`, `project-bootstrap`, `project-debrief`, `project-document`, `project-execute`, `project-fix-linter-error`, `project-implement`, `project-local-code-review`, `project-lower-code-complexity`, `project-plan`, `project-reduce-max-lines`, `project-reduce-max-lines-per-function`, `project-research`, `project-review`, `project-setup`, `project-verify`

### 4. Template project skills (17 directories)

Delete all `project-*` skill directories from `all/copy-overwrite/.claude/skills/`:
- Same 17 directories as above

### 5. Add to `all/deletions.json`

Add all deleted paths so Lisa removes them from target projects:
- `.claude/commands/project` (entire directory)
- All 17 `.claude/skills/project-*` directories

### 6. Copy new plan commands to root

Copy from `all/copy-overwrite/.claude/commands/plan/` to `.claude/commands/plan/`:
- `create.md`
- `implement.md`

### 7. Rewrite HUMAN.md (both root and template)

Replace the project-workflow-centric content with plan-workflow-centric content:
- **Quick Start Workflow**: Describe the plan-based workflow (`/plan:create`, plan mode, `/plan:implement`)
- **Command Reference**: Remove all `/project:*` commands, add `/plan:create` and `/plan:implement`
- **Command Details**: Remove all `/project:*` detail sections
- **Command Call Graph**: Remove `/project:*` graph entries
- **Git Commands "Called By"**: Remove references to `/project:*` commands
- Keep all non-project commands (git, pull-request, tasks, jira, sonarqube, lisa, plan utility commands)

## Skills to Use During Execution

- `/coding-philosophy` - required for all tasks
- `/jsdoc-best-practices` - if any JSDoc changes needed
- `/git:commit` - for committing changes

## Task List

Create the following tasks using TaskCreate:

### Task 1: Delete root project commands and skills

**subject**: Delete root project commands and skills directories
**activeForm**: Deleting root project commands and skills directories

**Description**: Delete `.claude/commands/project/` directory and all 17 `project-*` directories from `.claude/skills/`. Verify all files are git-tracked before deleting.

**Verification**: `ls .claude/commands/project/ 2>&1 && echo "FAIL" || echo "PASS"` — expected: directory not found, "PASS"

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "ls .claude/commands/project/ 2>&1 && echo FAIL || echo PASS", "expected": "PASS" } }`

### Task 2: Delete template project commands and skills

**subject**: Delete template project commands and skills directories
**activeForm**: Deleting template project commands and skills directories

**Description**: Delete `all/copy-overwrite/.claude/commands/project/` directory and all 17 `project-*` directories from `all/copy-overwrite/.claude/skills/`. Verify all files are git-tracked before deleting.

**Verification**: `ls all/copy-overwrite/.claude/commands/project/ 2>&1 && echo "FAIL" || echo "PASS"` — expected: "PASS"

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "ls all/copy-overwrite/.claude/commands/project/ 2>&1 && echo FAIL || echo PASS", "expected": "PASS" } }`

### Task 3: Update deletions.json

**subject**: Add project workflow paths to deletions.json
**activeForm**: Adding project workflow paths to deletions.json

**Description**: Update `all/deletions.json` to add paths for all deleted project workflow files so that Lisa removes them from target projects on next run. Add:
- `.claude/commands/project` (the directory — Lisa will delete the whole thing)
- All 17 `.claude/skills/project-*` directory paths

**File**: `all/deletions.json`

**Verification**: `cat all/deletions.json | jq '.paths | map(select(startswith(".claude/commands/project") or startswith(".claude/skills/project-"))) | length'` — expected: 18

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "cat all/deletions.json | jq '.paths | map(select(startswith(\".claude/commands/project\") or startswith(\".claude/skills/project-\"))) | length'", "expected": "18" } }`

### Task 4: Copy new plan commands to root

**subject**: Copy plan create.md and implement.md to root commands
**activeForm**: Copying plan create.md and implement.md to root commands

**Description**: Copy `all/copy-overwrite/.claude/commands/plan/create.md` and `all/copy-overwrite/.claude/commands/plan/implement.md` to `.claude/commands/plan/`. These are new plan workflow commands that replace parts of the old project workflow.

**Verification**: `ls .claude/commands/plan/create.md .claude/commands/plan/implement.md && echo "PASS"` — expected: both files listed, "PASS"

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "ls .claude/commands/plan/create.md .claude/commands/plan/implement.md && echo PASS", "expected": "PASS" } }`

### Task 5: Rewrite HUMAN.md for plan workflow

**subject**: Rewrite HUMAN.md to document plan-based workflow
**activeForm**: Rewriting HUMAN.md to document plan-based workflow

**Description**: Completely rewrite both `HUMAN.md` (root) and `all/copy-overwrite/HUMAN.md` (template) to replace all project workflow references with the plan workflow. The new workflow is:
1. `/plan:create [request]` — enters plan mode and creates a plan
2. Review/approve the plan
3. `/plan:implement [plan-file]` — implements the plan

Remove all `/project:*` command references from Quick Start, Command Reference tables, Command Details sections, and Command Call Graph. Add `/plan:create` and `/plan:implement` as the new primary commands. Keep all other command categories (git, pull-request, tasks, jira, sonarqube, lisa, plan utilities). Update Git Commands "Called By" to remove `/project:*` references.

Both files must be identical.

**Verification**: `diff HUMAN.md all/copy-overwrite/HUMAN.md && ! grep -q "/project:" HUMAN.md && echo "PASS"` — expected: no diff, no project references, "PASS"

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "diff HUMAN.md all/copy-overwrite/HUMAN.md && ! grep -q '/project:' HUMAN.md && echo PASS", "expected": "PASS" } }`

### Task 6: Commit and open draft PR

**subject**: Commit all changes and open draft PR
**activeForm**: Committing changes and opening draft PR

**Description**: Use `/git:commit` to create conventional commits for all changes. Then open a draft PR targeting `main` with title "chore: remove deprecated project workflow and update HUMAN.md".

**Verification**: `gh pr view --json state,title | jq '.state'` — expected: "OPEN"

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/git:commit", "/git:submit-pr"], "verification": { "type": "manual-check", "command": "gh pr view --json state,title | jq '.state'", "expected": "OPEN" } }`

### Task 7: Run CodeRabbit code review

**subject**: Run CodeRabbit code review on changes
**activeForm**: Running CodeRabbit code review

**Description**: Run CodeRabbit review on the PR changes. Blocked by Task 6.

**Verification**: CodeRabbit review completes without critical findings.

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/coderabbit:review"], "verification": { "type": "manual-check", "command": "echo review-complete", "expected": "review-complete" } }`

### Task 8: Run local code review

**subject**: Run local code review on changes
**activeForm**: Running local code review

**Description**: Run `/plan:local-code-review` on the changes. Blocked by Task 6.

**Verification**: Review completes.

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/plan:local-code-review"], "verification": { "type": "manual-check", "command": "echo review-complete", "expected": "review-complete" } }`

### Task 9: Implement valid review suggestions

**subject**: Implement valid code review suggestions
**activeForm**: Implementing valid code review suggestions

**Description**: Review findings from Tasks 7 and 8. Implement any valid suggestions. Blocked by Tasks 7 and 8.

**Verification**: All valid suggestions addressed.

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "echo suggestions-implemented", "expected": "suggestions-implemented" } }`

### Task 10: Simplify code with code-simplifier

**subject**: Simplify implemented code with code-simplifier agent
**activeForm**: Simplifying implemented code

**Description**: Use the code-simplifier agent to review and simplify any new code written (mainly HUMAN.md content). Blocked by Task 9.

**Verification**: Code simplifier completes.

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "echo simplification-complete", "expected": "simplification-complete" } }`

### Task 11: Update tests

**subject**: Update or remove tests related to project workflow
**activeForm**: Updating tests related to project workflow

**Description**: Check for any tests that reference the deleted project workflow files. The test at `tests/unit/hooks/track-plan-sessions.test.ts` should be unaffected (it's for plans, not projects). Verify no tests break. Blocked by Task 9.

**Verification**: `bun run test` — expected: all tests pass

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "test", "command": "bun run test", "expected": "all tests pass" } }`

### Task 12: Update documentation

**subject**: Update documentation referencing project workflow
**activeForm**: Updating documentation referencing project workflow

**Description**: Check README.md, `.claude/REFERENCE.md`, `.claude/README.md`, and any other markdown files for references to `/project:*` commands and update them. Blocked by Task 9.

**Verification**: `grep -r "/project:" --include="*.md" . --exclude-dir=plans --exclude-dir=node_modules --exclude-dir=.git | grep -v "deprecated" | wc -l` — expected: 0

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "documentation", "command": "grep -r '/project:' --include='*.md' . --exclude-dir=plans --exclude-dir=node_modules --exclude-dir=.git | grep -v deprecated | wc -l", "expected": "0" } }`

### Task 13: Verify all task verifications

**subject**: Verify all verification metadata in existing tasks
**activeForm**: Verifying all task verification metadata

**Description**: Run the verification command for every completed task to ensure they all still pass. Blocked by Tasks 10, 11, 12.

**Verification**: All verification commands pass.

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "echo all-verified", "expected": "all-verified" } }`

### Task 14: Archive the plan

**subject**: Archive the plan after all tasks complete
**activeForm**: Archiving the plan

**Description**: After all other tasks are complete:
1. Create folder `remove-project-workflow` in `./plans/completed`
2. Rename this plan file to `remove-project-workflow.md`
3. Move it into `./plans/completed/remove-project-workflow/`
4. Read the session IDs from `./plans/completed/remove-project-workflow/remove-project-workflow.md`
5. For each session ID, move `~/.claude/tasks/<session-id>` directory to `./plans/completed/remove-project-workflow/tasks`
6. Update any "in_progress" task in `./plans/completed/remove-project-workflow/tasks` to "completed"
7. Commit changes
8. Push changes to the PR

Blocked by Task 13.

**Verification**: `ls plans/completed/remove-project-workflow/remove-project-workflow.md && echo "PASS"` — expected: "PASS"

**Metadata**: `{ "plan": "rustling-napping-lobster", "type": "task", "skills": ["/git:commit"], "verification": { "type": "manual-check", "command": "ls plans/completed/remove-project-workflow/remove-project-workflow.md && echo PASS", "expected": "PASS" } }`

## Task Dependencies

- Tasks 1-5 can run in parallel (no dependencies between them)
- Task 6 blocked by Tasks 1-5
- Tasks 7, 8 blocked by Task 6 (can run in parallel with each other)
- Task 9 blocked by Tasks 7, 8
- Tasks 10, 11, 12 blocked by Task 9 (can run in parallel with each other)
- Task 13 blocked by Tasks 10, 11, 12
- Task 14 blocked by Task 13

## Key Files

- `all/deletions.json` — add deletion paths
- `.claude/commands/project/` — delete entirely
- `all/copy-overwrite/.claude/commands/project/` — delete entirely
- `.claude/skills/project-*` — delete 17 directories
- `all/copy-overwrite/.claude/skills/project-*` — delete 17 directories
- `.claude/commands/plan/create.md` — copy from template
- `.claude/commands/plan/implement.md` — copy from template
- `HUMAN.md` — rewrite
- `all/copy-overwrite/HUMAN.md` — rewrite (identical to root)

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| 0222ec04-a198-42af-86f1-13522782b431 | 2026-02-03T18:47:00Z | plan |
