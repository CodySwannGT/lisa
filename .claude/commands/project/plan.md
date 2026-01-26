---
description: Uses the research.md and brief.md file in the specified directory to create a detailed list of tasks to implement the project
argument-hint: <project-directory>
allowed-tools: Read, Bash, Glob, Grep, TaskCreate, TaskUpdate, TaskList, Skill
---

## Setup

Set active project marker: `echo "$ARGUMENTS" | sed 's|.*/||' > .claude-active-project`

Extract `<project-name>` from the last segment of `$ARGUMENTS`.

## Step 1: Read Project Files

Read `$ARGUMENTS/brief.md` and `$ARGUMENTS/research.md` FULLY (no limit/offset).

## Step 2: Validate Research

Locate "## Open Questions" in research.md.

**Valid states** (proceed):
- Section contains "None", "[None identified]", "N/A", or is empty
- Section doesn't exist
- All `**Answer**:` fields are filled

**Invalid state** (stop immediately):
- Questions with unfilled `**Answer**:` fields

If invalid, report:
```
CANNOT PROCEED WITH PLANNING

The research.md file has unanswered open questions.

Unanswered Questions Found:
[List each question]

Action Required:
1. Review $ARGUMENTS/research.md "## Open Questions"
2. Fill in the **Answer**: field for each question
3. Re-run /project:plan
```

**IMPORTANT**: NEVER modify research.md during validation.

## Step 3: Discover Skills

Read `.claude/skills/*/SKILL.md` files (first 10 lines each) to map skills to applicable tasks.

## Step 4: Create Tasks

### Determine Task List

Each task must be small enough to have a **single, specific verification**.
- Ask: "Can I prove this task is done with ONE command or check?"
- Exception: `ui-recording` tasks may verify per-platform (web/iOS/Android)

**Properly-sized tasks:**
- "Add logout button to header" → single Playwright test
- "Add unit tests for UserService" → single coverage command
- "Create API endpoint for user profile" → single curl command

**Too large (split these):**
- "Build authentication system" → split into login, logout, session, etc.
- "Add user management feature" → split into list, create, edit, etc.

### Create Tasks with TaskCreate

For each task, use **TaskCreate** with:

**subject**: Task name in imperative form (e.g., "Add logout button to header")

**activeForm**: Present continuous form (e.g., "Adding logout button to header")

**description**: Full task specification in markdown:

```markdown
**Type:** Bug | Task | Epic | Story

## Description
[Clear description based on type:
- Bug: Symptoms, root cause approach
- Story: Gherkin BDD format (Given/When/Then)
- Task: Straightforward with clear goal
- Epic: Goal overview with sub-tasks]

## Acceptance Criteria
- [ ] Criterion 1
- [ ] Criterion 2

## Relevant Research
[Extract from research.md: code references, patterns, architecture constraints]

## Skills to Invoke
- `/coding-philosophy` - Always required
- [Other applicable skills from Step 3]

## Implementation Details
[Files to modify, functions to implement, edge cases]

## Testing Requirements
### Unit Tests
- [ ] `describe('X')/it('should Y')`: Description

### Integration Tests
[Or "N/A - no integration points"]

### E2E Tests
[Or "N/A - no user-facing changes"]

## Verification
**Type:** `test` | `ui-recording` | `test-coverage` | `api-test` | `manual-check` | `documentation`

| Type | When to Use | Example |
|------|-------------|---------|
| `test` | Run specific tests | `bun run test -- src/services/user.spec.ts` |
| `ui-recording` | UI/UX changes | `bun run playwright:test ...` |
| `test-coverage` | Coverage threshold | `bun run test:cov -- --collectCoverageFrom='...'` |
| `api-test` | API endpoints | `./scripts/verify/<task-name>.sh` |
| `documentation` | Docs, README | `cat path/to/doc.md` |
| `manual-check` | Config, setup | Command showing config exists |

**Proof Command:**
```bash
[Single command to verify completion]
```

**Expected Output:**
[What success looks like]

## Learnings
During implementation, collect any discoveries valuable for future developers:
- Gotchas or unexpected behavior encountered
- Edge cases that weren't obvious from requirements
- Better approaches discovered during implementation
- Patterns that should be reused or avoided
- Documentation gaps or misleading information found

**On task completion**, use `TaskUpdate` to save learnings:
```
TaskUpdate:
  taskId: "<this-task-id>"
  metadata: { learnings: ["Learning 1", "Learning 2", ...] }
```
```

**metadata**:
```json
{
  "project": "<project-name>",
  "type": "bug|task|epic|story",
  "skills": ["/coding-philosophy", ...],
  "verification": {
    "type": "test|ui-recording|test-coverage|api-test|manual-check|documentation",
    "command": "the proof command",
    "expected": "what success looks like"
  }
}
```

### Set Up Dependencies

After creating all tasks, use **TaskUpdate** with `addBlockedBy` to establish task order where needed.

## Step 5: Report

Report: "Planning complete - X tasks created for project <project-name>"

Use **TaskList** to show the created tasks.

---

**IMPORTANT**: Each task description should contain all necessary information from `brief.md` and `research.md` to complete in isolation. Tasks should be independent and as small in scope as possible.

---

## Next Step

If the implementation step doesn't start automatically, run `/project:implement $ARGUMENTS`.
