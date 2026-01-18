---
description: Uses the research.md and brief.md file in the specified directory to create a detailed list of tasks to implement the project
argument-hint: <project-directory>
---

## Step 0: MANDATORY SETUP

Use TodoWrite to create workflow tracking todos:
- Step 1: Read project files
- Step 2: Validate research
- Step 3: Discover skills
- Step 4: Create task list
- Step 5: Create task files
- Step 6: Commit plan

⚠️ **CRITICAL**: DO NOT STOP until all 6 todos are marked completed.

## Step 1: Read Project Files
Mark "Step 1: Read project files" as in_progress.

1. Read the `brief.md` file inside $ARGUMENTS FULLY (no limit/offset)
2. Read the `research.md` file inside $ARGUMENTS FULLY (no limit/offset)

Mark "Step 1: Read project files" as completed. Proceed to Step 2.

## Step 2: Validate Research
Mark "Step 2: Validate research" as in_progress.

**VALIDATE RESEARCH COMPLETENESS**:
- Locate the "## Open Questions" section in the research.md file you just read
- Examine the content under this section carefully

**VALID STATES** (proceed to Step 3):
✅ Section contains "None", "[None identified]", "N/A", or is empty
✅ Section doesn't exist at all
✅ Section contains questions BUT all `**Answer**:` fields are filled (not empty, not placeholder text like "_[Human fills this in]_")

**INVALID STATE** (stop immediately):
❌ Section contains questions with unfilled `**Answer**:` fields (empty or placeholder text)
❌ Section contains unstructured questions without Answer fields
- If INVALID state is detected, **STOP IMMEDIATELY** and report:

  ```
  ❌ CANNOT PROCEED WITH PLANNING

  The research.md file has unanswered open questions that must be addressed before planning can begin.

  Unanswered Questions Found:
  [List each question title and its Question field]

  Action Required:
  1. Review $ARGUMENTS/research.md "## Open Questions" section
  2. Fill in the **Answer**: field for each question
  3. Re-run /project:plan

  Planning has been aborted.
  ```

**IMPORTANT**: NEVER modify, delete, or replace any existing sections in research.md during validation.
Only READ and VALIDATE. The research.md file is a historical record and must be preserved as-is.

Mark "Step 2: Validate research" as completed. Proceed to Step 3.

## Step 3: Discover Skills
Mark "Step 3: Discover skills" as in_progress.

**DISCOVER APPLICABLE SKILLS**:
- Read all skill descriptions by examining `.claude/skills/*/SKILL.md` files (read only the frontmatter description, first 10 lines of each)
- For each skill, determine if it applies to ANY task in this project based on brief.md requirements
- Create a mental map of: skill name → when it applies (e.g., "container-view-pattern → when creating React components")
- You will use this mapping in Step 5 to annotate each task with its applicable skills

Mark "Step 3: Discover skills" as completed. Proceed to Step 4.

## Step 4: Create Task List
Mark "Step 4: Create task list" as in_progress.

1. Determine a list of tasks required to complete the project
2. **CRITICAL: Each task must be small enough to have a single, specific verification**
   - If a task would require multiple verifications, split it into smaller tasks
   - Ask: "Can I prove this task is done with ONE command or check?"
   - **Exception for multi-platform UI recordings**: Tasks with `ui-recording` verification may have one proof command per platform (web/iOS/Android) since the same UI feature must be verified on each target platform
   - Examples of properly-sized tasks:
     - ✅ "Add logout button to header" → single Playwright test verifies button exists and works
     - ✅ "Add unit tests for UserService" → single coverage command shows UserService coverage
     - ✅ "Create API endpoint for user profile" → single curl command returns expected response
     - ❌ "Build authentication system" → too large, needs multiple verifications (split into login, logout, session, etc.)
     - ❌ "Add user management feature" → too large (split into list users, create user, edit user, etc.)
3. Write that list of tasks to `progress.md` inside $ARGUMENTS

Mark "Step 4: Create task list" as completed. Proceed to Step 5.

## Step 5: Create Task Files
Mark "Step 5: Create task files" as in_progress.

For each task in `progress.md`, create a new file called `tasks/000<step-number>-<task-name>.md`

**For each task, create a file using this template:**

```markdown
# Task: [Task Name]

**Type:** Bug | Task | Epic | Story
**Parent:** [Parent Task Name, or "None"]

## Description

[Write a clear description based on task type:
- **Bug**: Describe the bug, symptoms, and root cause analysis approach
- **Story**: Use Gherkin BDD format (Given/When/Then)
- **Task**: Straightforward description with clear goal
- **Epic**: Goal overview with list of sub-tasks]

## Acceptance Criteria

[Specific, testable criteria that define "done" for this task]

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Relevant Research

[Extract and summarize relevant sections from research.md, including:
- Code references (file:line) that will be modified or referenced
- Patterns to follow from the codebase
- Architecture constraints that apply
- Any resolved questions that affect this task]

## Applicable Skills

Invoke these skills before writing implementation code:

- `/coding-philosophy` - Always required for all code
- [Add other skills from Step 3 that apply to THIS SPECIFIC task]

## Implementation Details

[Specific implementation guidance:
- Files to create or modify
- Functions/classes to implement
- Integration points with existing code
- Edge cases to handle]

## Testing Requirements

### Unit Tests
[List specific unit tests required. Reference patterns from research.md]

- [ ] `describe('X')/it('should Y')`: Test description
- [ ] `describe('X')/it('should Y')`: Test description

### Integration Tests
[List integration tests required, or "N/A - no integration points"]

- [ ] Test description

### E2E Tests
[List e2e tests required, or "N/A - no user-facing changes"]

- [ ] Test scenario description

## Documentation Requirements

### Code Documentation (JSDoc)
[List functions/types needing JSDoc, or "N/A"]

- [ ] `functionName` - @param, @returns, @throws
- [ ] `TypeName` - @description

### Database Comments
[List tables/columns needing comments, or "N/A - no database changes"]

- [ ] `table.column` - purpose description

### GraphQL Descriptions
[List types/fields needing descriptions, or "N/A - no GraphQL changes"]

- [ ] `Type.field` - purpose description

## Verification

### Type
[One of: `ui-recording` | `test-coverage` | `api-test` | `manual-check` | `documentation`]

### Proof Command
```bash
[Single command to verify task completion - must be specific to THIS task]
```

<!-- For ui-recording on multi-platform apps, provide one command per platform:
#### Web
```bash
bun run playwright:test e2e/feature.spec.ts --grep "specific test" --trace on
```

#### iOS
```bash
maestro test .maestro/flows/feature-test.yaml --platform ios
```

#### Android
```bash
maestro test .maestro/flows/feature-test.yaml --platform android
```
-->

<!-- For api-test, create a documented bash script at scripts/verify/<task-name>.sh:
- Script must support -h and --help flags with usage documentation
- Script must handle authentication if required
- Script must return exit code 0 on success, non-zero on failure
- Script must output clear success/failure message

Example:
```bash
./scripts/verify/user-profile-api.sh --help
./scripts/verify/user-profile-api.sh
```
-->

### Expected Output
[What the proof command output should show to confirm success]

## Implementation Steps

### Step 0: Setup Tracking
Use TodoWrite to create task tracking todos:
- Invoke skills
- Write failing tests
- Write implementation
- Verify implementation
- Update documentation
- Commit changes

⚠️ **CRITICAL**: DO NOT STOP until all todos are marked completed.

### Step 1: Invoke Skills
Mark "Invoke skills" as in_progress.

1. Mark this task as "in progress" in `progress.md`
2. Invoke each skill listed in "Applicable Skills" using the Skill tool

Mark "Invoke skills" as completed.

### Step 2: Write Failing Tests
Mark "Write failing tests" as in_progress.

1. Write unit tests based on Testing Requirements
2. Write integration tests based on Testing Requirements
3. Run tests to confirm they fail (TDD)

Mark "Write failing tests" as completed.

### Step 3: Write Implementation
Mark "Write implementation" as in_progress.

Implement code following Implementation Details until tests pass.

Mark "Write implementation" as completed.

### Step 4: Verify Implementation
Mark "Verify implementation" as in_progress.

1. Run the Proof Command from Verification section
2. Confirm output matches Expected Output
3. If verification fails, fix and re-verify

Mark "Verify implementation" as completed.

### Step 5: Update Documentation
Mark "Update documentation" as in_progress.

Complete all items in Documentation Requirements section.

Mark "Update documentation" as completed.

### Step 6: Commit Changes
Mark "Commit changes" as in_progress.

1. Run `/git:commit`
2. Mark this task as "completed" in `progress.md`
3. Record any learnings in `findings.md`

Mark "Commit changes" as completed.
```

---

**Verification Type Reference:**

| Type | When to Use | Example Command |
|------|-------------|-----------------|
| `ui-recording` | UI/UX changes visible to users | Web: `bun run playwright:test ...`, iOS/Android: `maestro test ...` |
| `test-coverage` | New code with tests | `bun run test:cov -- --collectCoverageFrom='src/path/to/file.ts'` |
| `api-test` | New API endpoints | `./scripts/verify/<task-name>.sh` (documented script with -h/--help) |
| `documentation` | Docs, README updates | `cat path/to/doc.md` |
| `manual-check` | Config, setup, infrastructure | Command showing the config/state exists |

Mark "Step 5: Create task files" as completed. Proceed to Step 6.

## Step 6: Commit Plan
Mark "Step 6: Commit plan" as in_progress.

Run /git:commit

Mark "Step 6: Commit plan" as completed.

Report: "📋 Planning complete - X tasks created"

---

IMPORTANT: Each task should contain all the necessary information from `brief.md` and `research.md` and any other support files necessary to complete the task in isolation. Tasks should be completely independent of one another and be as small in scope as possible.

IMPORTANT: If, at the end of a task, the pre-commit blocks you because it is dependent on another task, complete the other task first and then commit.
