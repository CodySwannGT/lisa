# Claude Code Over-Instructions Analysis

This document identifies patterns where Lisa's slash commands over-instruct Claude on behaviors that the native Task tools already handle. Over-instruction constrains Claude's ability to improve and adds unnecessary verbosity.

## Principle

**Trust Claude to understand its tools.** The Task tool descriptions already document:
- How to find available tasks (`pending` status, no `blockedBy`)
- When to mark tasks `in_progress` vs `completed`
- How to check for blocked tasks
- The status workflow (`pending` → `in_progress` → `completed`)

Commands should focus on **what** to accomplish, not **how** to use the Task tools.

---

## Pattern 1: Redundant Status Workflow Instructions

### Problem
Commands explicitly tell Claude to "mark as in_progress" then "mark as completed" for every step.

### Examples

**project/execute.md** (lines 77-121):
```markdown
Use TaskUpdate to mark "Step 1: Planning" as `in_progress`.
...
Use TaskUpdate to mark "Step 1: Planning" as `completed`.
```
Repeated 6 times for each step.

**project/research.md** (lines 47-229):
```markdown
Use TaskUpdate to mark "Step 1: Read mentioned files" as `in_progress`.
...
Use TaskUpdate to mark "Step 1: Read mentioned files" as `completed`. Proceed to Step 2.
```
Repeated 6 times.

**project/plan.md**, **project/verify.md**, **project/review.md**, **project/debrief.md** - all follow this pattern.

### Why It's Redundant
The TaskUpdate tool description already states:
> "Mark task as `in_progress` **BEFORE** beginning work"
> "Mark task as `completed` **ONLY** when fully accomplished"

Claude knows this from the tool definitions.

---

## Pattern 2: Explaining How to Find Available Tasks

### Problem
Commands explain the mechanics of finding unblocked tasks.

### Example

**project/implement.md** (lines 74-80):
```markdown
Use TaskList to find tasks where:
- status is `pending`
- `blockedBy` is empty (no unresolved dependencies)

If no pending unblocked tasks exist:
- If all tasks are `completed`: Go to Step 4 (Complete)
- If tasks are blocked: Report which tasks are blocked and why, then STOP
```

### Why It's Redundant
The TaskList tool description already states:
> "To see what tasks are available to work on (status: 'pending', no owner, not blocked)"
> "To find tasks that are blocked and need dependencies resolved"

Claude can determine what to do based on TaskList output without explicit conditional logic.

---

## Pattern 3: Repeating Subagent Instructions

### Problem
Commands tell subagents how to use Task tools when they already know.

### Examples

**project/add-test-coverage.md** (lines 60-65):
```markdown
Each subagent MUST:
1. Use TaskList to find pending tasks with no blockers
2. Use TaskUpdate to claim a task (set status to `in_progress`)
3. Write tests for their claimed file(s)
4. Run `/git:commit` to commit their changes
5. If hooks fail, fix the errors and re-run `/git:commit`
6. Use TaskUpdate to mark task as `completed` only after a successful commit
```

**project/fix-linter-error.md** (lines 68-80) - identical pattern
**project/lower-code-complexity.md** (lines 54-66) - identical pattern
**pull-request/review.md** (lines 33-36) - similar pattern

### Why It's Redundant
Subagents have the same Task tool access and descriptions. They know how to:
- Find available tasks
- Claim tasks
- Mark tasks complete

---

## Pattern 4: "Proceed to Step X" Navigation

### Problem
Commands explicitly tell Claude which step to go to next.

### Examples

Every workflow command includes:
```markdown
Use TaskUpdate to mark "Step 1" as `completed`. Proceed to Step 2.
...
Use TaskUpdate to mark "Step 2" as `completed`. Proceed to Step 3.
```

### Why It's Redundant
If tasks are created sequentially (Step 1, Step 2, Step 3...), Claude can naturally work through them using TaskList. The dependency system handles ordering if needed.

---

## Pattern 5: Conditional Stop Logic

### Problem
Commands spell out every conditional outcome.

### Example

**project/implement.md** (lines 78-80):
```markdown
If no pending unblocked tasks exist:
- If all tasks are `completed`: Go to Step 4 (Complete)
- If tasks are blocked: Report which tasks are blocked and why, then STOP
```

### Why It's Redundant
Claude can determine appropriate actions from TaskList output:
- All completed → naturally done
- Some blocked → Claude can see what's blocking and report

---

## Pattern 6: Explicit Tool Usage Instructions

### Problem
Commands explain basic tool mechanics.

### Example

**project/implement.md** (lines 86-88):
```markdown
1. Use TaskGet to retrieve full task details (including metadata)
2. Use TaskUpdate to set `status: "in_progress"`
3. Read the full task spec file from the path in metadata.specFile
```

### Why It's Redundant
Claude knows:
- TaskGet retrieves task details (from tool description)
- TaskUpdate changes status (from tool description)
- How to read files (from Read tool)

---

## Recommendations

### 1. Simplify Workflow Commands

**Before:**
```markdown
## Step 1: Do Thing
Use TaskUpdate to mark "Step 1: Do Thing" as `in_progress`.
[actual instructions]
Use TaskUpdate to mark "Step 1: Do Thing" as `completed`. Proceed to Step 2.

## Step 2: Do Other Thing
Use TaskUpdate to mark "Step 2: Do Other Thing" as `in_progress`.
...
```

**After:**
```markdown
## Tasks
Create tasks for this workflow:
1. Do Thing
2. Do Other Thing
3. Final Thing

Work through each task. [High-level guidance for each task type if needed]
```

### 2. Trust Task System for Orchestration

**Before:**
```markdown
Use TaskList to find tasks where:
- status is `pending`
- `blockedBy` is empty

If no pending unblocked tasks exist:
- If all tasks are `completed`: Go to Step 4
- If tasks are blocked: Report and STOP
```

**After:**
```markdown
Work through all tasks until complete.
```

### 3. Simplify Subagent Instructions

**Before:**
```markdown
Each subagent MUST:
1. Use TaskList to find pending tasks
2. Use TaskUpdate to claim a task
3. Do the work
4. Run /git:commit
5. Use TaskUpdate to mark complete
```

**After:**
```markdown
Launch subagents to work through the task list in parallel.
```

---

## Files Requiring Refactor

| File | Severity | Primary Issues |
|------|----------|----------------|
| `project/implement.md` | High | Patterns 2, 4, 5, 6 |
| `project/execute.md` | High | Patterns 1, 4 (repeated 12x) |
| `project/research.md` | High | Patterns 1, 4 (repeated 12x) |
| `project/plan.md` | High | Patterns 1, 4 (repeated 10x) |
| `project/review.md` | Medium | Patterns 1, 4 (repeated 10x) |
| `project/verify.md` | Medium | Patterns 1, 4 (repeated 6x) |
| `project/debrief.md` | Medium | Patterns 1, 4 (repeated 6x) |
| `project/add-test-coverage.md` | Medium | Pattern 3 |
| `project/fix-linter-error.md` | Medium | Pattern 3 |
| `project/lower-code-complexity.md` | Medium | Pattern 3 |
| `pull-request/review.md` | Low | Pattern 3 |

---

## Benefits of Refactoring

1. **Future-proof**: As Claude improves, commands won't constrain it
2. **Shorter prompts**: Less token usage, faster processing
3. **Clearer intent**: Focus on *what* not *how*
4. **Easier maintenance**: Fewer places to update when Task system changes
5. **Better autonomy**: Claude can adapt to edge cases without rigid instructions

---

## Reference Rewrite: implement.md

Use this as the template pattern for refactoring all other commands.

### BEFORE (current verbose version):

```markdown
---
description: Systematically implements all tasks in a specified project
argument-hint: <project-directory>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, TaskGet, Skill
---

## Step 0: Validate Project

Check if the project has task files:

\`\`\`bash
ls $ARGUMENTS/tasks/*.md 2>/dev/null | head -5
\`\`\`

If no task files exist, report error: "Error: No task files found in $ARGUMENTS/tasks/. Run /project:plan first to create task files."

## Step 1: Set Active Project

Extract project name from the path and set the active project marker:

\`\`\`bash
echo "$ARGUMENTS" | sed 's|.*/||' > .claude-active-project
\`\`\`

This ensures the sync-tasks hook will auto-sync task updates to this project.

## Step 2: Load Tasks into Task System

### 2.1: Get List of Task Files

Read all task markdown files from the project:

\`\`\`bash
ls -1 $ARGUMENTS/tasks/*.md 2>/dev/null | sort
\`\`\`

### 2.2: Check for Existing Tasks

Use TaskList to see if tasks are already loaded for this session.

### 2.3: Create Tasks (if needed)

For each task file in `$ARGUMENTS/tasks/`:

1. Read the task file to extract:
   - Task name from the `# Task:` header
   - Description from the `## Description` section (first paragraph)

2. Use TaskCreate with:
   - **subject**: The task name (e.g., "Add user authentication endpoint")
   - **description**: Brief description + "Full spec: $ARGUMENTS/tasks/{filename}"
   - **activeForm**: Present continuous form (e.g., "Adding user authentication endpoint")
   - **metadata**: `{ "project": "<project-name>", "specFile": "<task-filename>" }`

3. If the task has dependencies listed in its spec, use TaskUpdate to set `addBlockedBy` after all tasks are created

### 2.4: Report Task Summary

After loading, use TaskList and report:

\`\`\`
Loaded X tasks for project: <project-name>
- Pending: Y
- In Progress: Z
- Completed: W

Ready to begin implementation.
\`\`\`

## Step 3: Implementation Loop

### 3.1: Find Next Available Task

Use TaskList to find tasks where:
- status is `pending`
- `blockedBy` is empty (no unresolved dependencies)

If no pending unblocked tasks exist:
- If all tasks are `completed`: Go to Step 4 (Complete)
- If tasks are blocked: Report which tasks are blocked and why, then STOP

### 3.2: Claim and Start Task

For the next available task:

1. Use TaskGet to retrieve full task details (including metadata)
2. Use TaskUpdate to set `status: "in_progress"`
3. Read the full task spec file from the path in metadata.specFile

### 3.3: Execute Task

Use Task tool with subagent_type "general-purpose" and prompt:

\`\`\`
Run /project:complete-task $ARGUMENTS/tasks/<task-spec-filename>
\`\`\`

Wait for the subagent to complete.

### 3.4: Mark Task Complete

After subagent finishes:

1. Use TaskUpdate to set `status: "completed"`
2. The sync-tasks hook will automatically sync this to `$ARGUMENTS/tasks/{id}.json`

### 3.5: Continue Loop

**CRITICAL: DO NOT STOP.** Return to Step 3.1 to find the next available task.

Repeat until all tasks are completed.

## Step 4: Complete

When all tasks are completed:

1. Use TaskList to get final summary
2. Report:

\`\`\`
Implementation complete for project: <project-name>

All X tasks completed:
- [list task subjects]

Run /project:review to review the implementation.
\`\`\`

---

## Notes

- Task progress is automatically synced to `$ARGUMENTS/tasks/{id}.json` via the sync-tasks hook
- The `.claude-active-project` marker file enables auto-sync without explicit metadata
- Task spec files (`tasks/*.md`) contain the full implementation details
- Task JSON files (`tasks/{id}.json`) contain status and metadata for the Task system
- Dependencies between tasks are respected - blocked tasks won't be started until blockers complete
```

### AFTER (simplified version):

```markdown
---
description: Systematically implements all tasks in a specified project
argument-hint: <project-directory>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, TaskGet, Skill
---

## Setup

1. Verify task files exist in `$ARGUMENTS/tasks/*.md` (if not, error: "Run /project:plan first")
2. Set active project marker: `echo "$ARGUMENTS" | sed 's|.*/||' > .claude-active-project`

## Load Tasks

For each markdown file in `$ARGUMENTS/tasks/`:
- Extract task name from `# Task:` header
- Extract description from `## Description` section
- Create task with metadata: `{ "project": "<project-name>", "specFile": "<filename>" }`
- Set up any dependencies listed in the spec

## Implementation

For each task, use a subagent to run `/project:complete-task` with the task's spec file.

Work through all tasks until complete.

## Complete

Report summary and suggest running `/project:review`.
```

---

## Action Items: Files to Refactor

Apply the same simplification pattern to each file. The templates in `all/copy-overwrite/.claude/commands/` must be updated to match.

### High Priority (most verbose)

1. **project/execute.md** - Remove 12 instances of "mark as in_progress/completed". Simplify to: create workflow tasks, invoke each step's command in sequence.

2. **project/research.md** - Remove 12 instances of status updates. Keep the research-specific instructions (agent types, document format) but remove Task tool mechanics.

3. **project/plan.md** - Remove 10 instances of status updates. Keep the task template and validation logic.

### Medium Priority

4. **project/review.md** - Remove 10 instances of status updates. Keep the review-specific logic (check if files exist, run coderabbit).

5. **project/verify.md** - Remove 6 instances of status updates. Simplify to: review requirements, verify implementation, document any drift.

6. **project/debrief.md** - Remove 6 instances of status updates. Keep skill-evaluator logic.

7. **project/add-test-coverage.md** - Remove subagent micro-instructions (lines 60-65). Simplify to: "Launch subagents to work through the task list."

8. **project/fix-linter-error.md** - Same as add-test-coverage.

9. **project/lower-code-complexity.md** - Same as add-test-coverage.

### Low Priority

10. **pull-request/review.md** - Remove subagent micro-instructions (lines 33-36).

---

## Refactoring Checklist

For each file:

- [ ] Remove all "Use TaskUpdate to mark X as in_progress/completed" lines
- [ ] Remove "Proceed to Step X" instructions
- [ ] Remove conditional logic about blocked/completed tasks (Claude knows)
- [ ] Remove explanations of how TaskList/TaskGet/TaskUpdate work
- [ ] Remove numbered subagent instructions about claiming/completing tasks
- [ ] Keep domain-specific logic (validation rules, document formats, tool invocations)
- [ ] Keep metadata requirements (`{ "project": "...", "phase": "..." }`)
- [ ] Update corresponding template in `all/copy-overwrite/.claude/commands/`
- [ ] Verify implementation and template are in sync
