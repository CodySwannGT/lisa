# Claude Code Task Management System

> Comprehensive documentation for Claude Code's native task management system introduced in v2.1.16 (January 22, 2026)

## Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
- [The Four Task Tools](#the-four-task-tools)
  - [TaskCreate](#taskcreate)
  - [TaskUpdate](#taskupdate)
  - [TaskList](#tasklist)
  - [TaskGet](#taskget)
- [Status Workflow](#status-workflow)
- [Task Dependencies](#task-dependencies)
- [Multi-Session Coordination](#multi-session-coordination)
- [Storage and Persistence](#storage-and-persistence)
- [Integration with Claude Code Hooks](#integration-with-claude-code-hooks)
- [Integration with Subagents](#integration-with-subagents)
- [Migration from TodoWrite](#migration-from-todowrite)
- [Comparison to Related Systems](#comparison-to-related-systems)
- [Best Practices](#best-practices)
- [Known Limitations](#known-limitations)
- [Version History](#version-history)
- [Sources](#sources)

---

## Overview

Claude Code v2.1.16 introduced a native **Task Management System** that upgrades the previous TodoWrite functionality. This system is designed for **session-level coordination** in agentic workflows, enabling dependency tracking, multi-session collaboration, and persistent task state.

The key insight behind this system is that while Claude 3.5 Opus can autonomously handle smaller tasks without explicit tracking, longer projects spanning multiple sessions or subagents require better state coordination and dependency management.

### Why Tasks Instead of Todos?

The previous TodoWrite system was a simple checklist. The new Tasks system is a full coordination primitive:

| Capability | TodoWrite | Tasks |
|------------|-----------|-------|
| Basic checklist | ✅ | ✅ |
| Status tracking | ✅ | ✅ |
| Dependency tracking | ❌ | ✅ |
| Task ownership | ❌ | ✅ |
| Cross-session persistence | ❌ | ✅ |
| Multi-agent coordination | ❌ | ✅ |
| Shared task lists | ❌ | ✅ |

---

## Core Features

### Dependency Tracking

Tasks can block other tasks. Claude won't proceed with Task B until Task A completes, ensuring logical sequencing of work.

```
Task 1: "Set up database schema"
Task 2: "Create API endpoints" (blockedBy: Task 1)
Task 3: "Write integration tests" (blockedBy: Task 2)
```

### Persistent Storage

Tasks are stored in `~/.claude/tasks`, surviving across:
- Session restarts
- Context window compaction
- Terminal closures

### Multi-Session Coordination

Updates broadcast to all sessions watching the same task list. Multiple Claude instances share one source of truth.

### Task Ownership

Tasks can be claimed by specific agents using the `owner` parameter, enabling parallel work distribution among multiple subagents.

---

## The Four Task Tools

### TaskCreate

**Token Count**: ~570 tokens

**Purpose**: Creates structured task lists to organize coding sessions, track progress, and demonstrate thoroughness to users.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subject` | string | Yes | Brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow") |
| `description` | string | Yes | Detailed description including context and acceptance criteria |
| `activeForm` | string | Recommended | Present continuous form shown in spinner when task is `in_progress` (e.g., "Fixing authentication bug") |
| `metadata` | object | No | Arbitrary metadata to attach to the task |

#### When to Use TaskCreate

- **Complex multi-step tasks**: When a task requires 3 or more distinct steps
- **Non-trivial work**: Tasks requiring careful planning or multiple operations
- **Plan mode**: When using plan mode, create a task list to track work
- **User requests**: When user explicitly asks for a todo list
- **Multiple deliverables**: When user provides a list of things to be done
- **After receiving instructions**: Immediately capture user requirements as tasks

#### When NOT to Use TaskCreate

- Single, straightforward tasks
- Trivial work that can be completed in less than 3 steps
- Purely conversational or informational requests

#### Example Usage

```json
{
  "subject": "Implement user authentication",
  "description": "Add JWT-based authentication to the API. Include login, logout, and token refresh endpoints. Write tests for each endpoint.",
  "activeForm": "Implementing user authentication"
}
```

**Important**: The `subject` should be imperative ("Run tests") while `activeForm` should be present continuous ("Running tests"). All tasks are created with status `pending`.

---

### TaskUpdate

**Purpose**: Modifies task state, ownership, and dependencies.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | The ID of the task to update |
| `status` | enum | No | New status: `pending`, `in_progress`, or `completed` |
| `subject` | string | No | New subject for the task |
| `description` | string | No | New description for the task |
| `activeForm` | string | No | Present continuous form for spinner |
| `owner` | string | No | Agent name claiming the task |
| `addBlocks` | string[] | No | Task IDs that this task blocks |
| `addBlockedBy` | string[] | No | Task IDs that must complete before this one |
| `metadata` | object | No | Metadata keys to merge (set key to `null` to delete) |

#### Status Transitions

```
pending → in_progress → completed
```

**Critical Rules**:
- Mark task as `in_progress` **BEFORE** beginning work
- Mark task as `completed` **ONLY** when fully accomplished
- **Never** mark completed if:
  - Tests are failing
  - Implementation is partial
  - Errors remain unresolved
  - Files or dependencies couldn't be found

#### Staleness Check

**Always read a task's latest state using `TaskGet` before updating it.** Other agents or sessions may have modified the task since you last read it.

#### Example Usage

```json
// Start working on a task
{ "taskId": "1", "status": "in_progress" }

// Complete a task
{ "taskId": "1", "status": "completed" }

// Claim a task
{ "taskId": "1", "owner": "worker-1" }

// Set up dependencies
{ "taskId": "2", "addBlockedBy": ["1"] }
```

---

### TaskList

**Token Count**: ~313 tokens

**Purpose**: Retrieves a summary of all tasks in the current task list.

#### Parameters

None required.

#### Output

Returns summary of each task:

| Field | Description |
|-------|-------------|
| `id` | Task identifier (use with TaskGet, TaskUpdate) |
| `subject` | Brief description of the task |
| `status` | `pending`, `in_progress`, or `completed` |
| `owner` | Agent ID if assigned, empty if available |
| `blockedBy` | List of open task IDs that must resolve first |

#### When to Use TaskList

- To see what tasks are available to work on (status: `pending`, no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work

---

### TaskGet

**Purpose**: Retrieves full details of a specific task by ID.

#### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | The ID of the task to retrieve |

#### Output

Returns full task details:

| Field | Description |
|-------|-------------|
| `subject` | Task title |
| `description` | Detailed requirements and context |
| `status` | `pending`, `in_progress`, or `completed` |
| `blocks` | Tasks waiting on this one to complete |
| `blockedBy` | Tasks that must complete before this one can start |
| `owner` | Agent assigned to the task |
| `metadata` | Any attached metadata |

#### When to Use TaskGet

- When you need the full description before starting work
- To understand task dependencies
- Before updating a task (staleness check)

---

## Status Workflow

Tasks follow a strict status progression:

```
┌─────────┐     ┌─────────────┐     ┌───────────┐
│ pending │ ──► │ in_progress │ ──► │ completed │
└─────────┘     └─────────────┘     └───────────┘
```

### Status Definitions

| Status | Meaning |
|--------|---------|
| `pending` | Task created but not yet started |
| `in_progress` | Agent is actively working on the task |
| `completed` | Task fully accomplished and verified |

### Status Rules

1. **Always mark `in_progress` before starting**: This signals to other agents/sessions that work has begun
2. **Never skip statuses**: Don't go directly from `pending` to `completed`
3. **Verify before completing**: Only mark `completed` when all acceptance criteria are met
4. **Handle blockers properly**: If blocked, create a new task describing what needs resolution

---

## Task Dependencies

### Setting Up Dependencies

Use `addBlockedBy` when creating or updating tasks:

```json
// Task 2 cannot start until Task 1 completes
{ "taskId": "2", "addBlockedBy": ["1"] }

// Task 1 blocks Tasks 2 and 3
{ "taskId": "1", "addBlocks": ["2", "3"] }
```

### Dependency Resolution

When a task is marked `completed`:
1. All tasks it blocks become unblocked (if no other blockers remain)
2. Call `TaskList` to see newly available work
3. Claim and start the next unblocked task

### Dependency Graph Example

```
┌──────────────────────┐
│ 1. Set up database   │
└──────────┬───────────┘
           │ blocks
           ▼
┌──────────────────────┐
│ 2. Create API routes │
└──────────┬───────────┘
           │ blocks
           ▼
┌──────────────────────┐     ┌──────────────────────┐
│ 3. Write unit tests  │     │ 4. Write e2e tests   │
└──────────────────────┘     └──────────────────────┘
```

---

## Multi-Session Coordination

### Shared Task Lists

To make multiple Claude sessions collaborate on a single task list:

```bash
# Terminal 1
CLAUDE_CODE_TASK_LIST_ID=my-project claude

# Terminal 2
CLAUDE_CODE_TASK_LIST_ID=my-project claude
```

Both sessions now share the same task list. When one session updates a task, the change broadcasts to all sessions.

### Use Cases

- **Parallel development**: Multiple Claude instances working on different parts of a feature
- **Research + Implementation**: One session researches while another implements
- **Testing + Fixing**: One session runs tests while another fixes failures

### Multi-Agent Orchestration

In multi-agent systems, workers can autonomously claim tasks:

```
Orchestrator: Creates tasks with dependencies
Worker-1: TaskUpdate(taskId="12", status="in_progress", owner="worker-1")
Worker-2: TaskUpdate(taskId="7", status="in_progress", owner="worker-2")
```

If a worker fails (heartbeat timeout), the task is released for another worker to claim.

---

## Storage and Persistence

### File Location

Tasks are stored in the filesystem at:

```
~/.claude/tasks/
```

### Persistence Benefits

- **Survives session restarts**: Resume work exactly where you left off
- **Survives context compaction**: Task state preserved even when conversation is summarized
- **Enables external tooling**: Build utilities on top of the task system

### Task List Isolation

Each task list is isolated by its ID. Without `CLAUDE_CODE_TASK_LIST_ID`, each session gets its own task list.

---

## Integration with Claude Code Hooks

Claude Code hooks can be used to enhance the task management workflow:

### Pre-Tool Hooks

Execute actions before task operations:

```json
// .claude/settings.json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "TaskCreate|TaskUpdate",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Task operation: $TOOL_NAME' >> ~/.claude/task-audit.log"
          }
        ]
      }
    ]
  }
}
```

### Post-Tool Hooks

Execute actions after task operations:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "TaskUpdate",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/notify-task-update.sh"
          }
        ]
      }
    ]
  }
}
```

### Example: Notification on Task Completion

```bash
#!/bin/bash
# .claude/hooks/notify-task-update.sh

# Parse the tool input to check if status changed to completed
if echo "$TOOL_INPUT" | jq -e '.status == "completed"' > /dev/null 2>&1; then
  TASK_ID=$(echo "$TOOL_INPUT" | jq -r '.taskId')

  # Send notification via ntfy.sh
  curl -d "Task $TASK_ID completed!" ntfy.sh/my-claude-tasks
fi
```

### Example: Task Audit Log

```bash
#!/bin/bash
# .claude/hooks/audit-tasks.sh

TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TOOL_NAME="$1"

echo "[$TIMESTAMP] $TOOL_NAME: $TOOL_INPUT" >> ~/.claude/task-audit.log
```

### Integration with Project Workflows

Hooks can trigger project-specific actions when tasks complete:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "TaskUpdate",
        "hooks": [
          {
            "type": "command",
            "command": "if echo $TOOL_INPUT | jq -e '.status == \"completed\"' > /dev/null; then npm test; fi"
          }
        ]
      }
    ]
  }
}
```

---

## Integration with Subagents

### Task Tool vs Task Management Tools

There are two distinct "Task" concepts in Claude Code:

1. **Task Tool**: Launches specialized subagents (Plan, Explore, etc.)
2. **Task Management Tools**: TaskCreate, TaskUpdate, TaskList, TaskGet

These work together for complex workflows.

### Subagent Task Coordination

Subagents can use the task management tools to:

1. Read their assigned tasks via `TaskGet`
2. Mark tasks `in_progress` when starting
3. Create subtasks if needed via `TaskCreate`
4. Mark tasks `completed` when done
5. Check for next available work via `TaskList`

### Example: Parallel Subagent Workflow

```
Main Agent:
  1. TaskCreate: "Implement feature A" (id: 1)
  2. TaskCreate: "Implement feature B" (id: 2)
  3. TaskCreate: "Integration tests" (id: 3, blockedBy: [1, 2])
  4. Launch subagent for task 1
  5. Launch subagent for task 2
  6. Wait for both to complete
  7. Launch subagent for task 3
```

### Background Agents

When using `run_in_background: true` with the Task tool:

```json
{
  "subagent_type": "general-purpose",
  "prompt": "Implement the authentication module",
  "run_in_background": true
}
```

The background agent can update task status independently, and the main agent can monitor progress via `TaskList`.

---

## Migration from TodoWrite

### Key Differences

| Aspect | TodoWrite | Tasks |
|--------|-----------|-------|
| Storage | In-memory/session | Filesystem (`~/.claude/tasks`) |
| Persistence | Session only | Cross-session |
| Dependencies | None | Full `blockedBy`/`blocks` support |
| Ownership | None | `owner` parameter |
| Multi-session | No | Yes via `CLAUDE_CODE_TASK_LIST_ID` |
| API | `TodoWrite`, `TodoRead` | `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet` |

### Migration Path

The migration is automatic. Claude Code v2.1.16+ uses the Task tools instead of TodoWrite. No manual migration is required.

### Behavioral Changes

1. **Proactive task creation**: Claude now offers "Want me to add that now, or create a task for later?"
2. **Dependency awareness**: Claude considers task dependencies when planning work order
3. **Multi-agent ready**: Claude can coordinate with other sessions/agents

---

## Comparison to Related Systems

| System | Scope | Storage | Best For |
|--------|-------|---------|----------|
| **Tasks** | Session-level | `~/.claude/tasks` | Immediate Claude Code coordination |
| **Beads** | Project-level | Git repo (`.beads/`) | Long-term project memory, audit trail |
| **Flux** | Team-level | Git/SQLite | Multi-person visibility, dashboards |
| **Linear/Jira** | Organization | Cloud | Enterprise project management |

### Tasks vs Beads

**Tasks** are designed for immediate Claude Code coordination within and across sessions. They're ephemeral by nature and optimized for agentic workflows.

**Beads** (by Steve Yegge) is a git-backed issue tracker storing tasks as JSONL in `.beads/`. It provides:
- Version-controlled task history
- Long-term project memory
- Integration with git workflows

The Task system was inspired by Beads but serves a different purpose: session-level coordination rather than project-level tracking.

### When to Use Each

- **Tasks**: Immediate work coordination, multi-agent orchestration, session management
- **Beads**: Long-term project tracking, audit trails, git-integrated workflows
- **External tools**: Team collaboration, reporting, enterprise requirements

---

## Best Practices

### 1. Create Tasks for Complex Work

If a request involves 3+ steps, create tasks to track progress:

```json
{
  "subject": "Add user profile page",
  "description": "Create profile page with avatar upload, bio editing, and settings. Include form validation and API integration.",
  "activeForm": "Adding user profile page"
}
```

### 2. Use Descriptive Subjects

Good: "Fix authentication timeout in session middleware"
Bad: "Fix bug"

### 3. Include Acceptance Criteria

In the description, specify what "done" looks like:

```json
{
  "description": "Acceptance criteria:\n- Login endpoint returns JWT\n- Token expires after 24h\n- Refresh endpoint works\n- Tests pass with >80% coverage"
}
```

### 4. Set Up Dependencies Early

Plan the dependency graph before starting work:

```json
// Create all tasks first
TaskCreate: "Database schema" (id: 1)
TaskCreate: "API endpoints" (id: 2)
TaskCreate: "Frontend integration" (id: 3)

// Then set up dependencies
TaskUpdate: { taskId: "2", addBlockedBy: ["1"] }
TaskUpdate: { taskId: "3", addBlockedBy: ["2"] }
```

### 5. Always Check Staleness

Before updating a task, read its current state:

```json
TaskGet: { taskId: "1" }  // Read current state
TaskUpdate: { taskId: "1", status: "completed" }  // Then update
```

### 6. Clean Up Completed Tasks

Periodically review the task list and archive completed work to keep the list manageable.

### 7. Use Shared Task Lists for Collaboration

When working across multiple terminals or with subagents:

```bash
export CLAUDE_CODE_TASK_LIST_ID=my-feature
claude
```

---

## Known Limitations

### Current Limitations

1. **Early-stage format**: The task storage format may change in future versions
2. **No MCP server interface**: Unlike Flux, Tasks don't expose an MCP server
3. **No web dashboard**: No visual interface for viewing/managing tasks
4. **Tight coupling**: Tasks are specific to Claude Code and AgentSDK
5. **No task archiving**: Completed tasks remain in the list until manually cleaned

### Known Issues

1. **Premature completion**: Claude may sometimes mark tasks complete without full verification
2. **Visibility in subagents**: TodoWrite updates inside Task tool may not be visible to users (reported in Issue #1173)
3. **Agent reliability**: Claude may stop mid-task without completing all planned work (Issue #6159)

### Workarounds

- **For premature completion**: Add explicit verification steps in task descriptions
- **For visibility**: Use hooks to log task updates externally
- **For reliability**: Break large tasks into smaller, verifiable chunks

---

## Version History

### v2.1.19
- TaskCreate: Added template variables for conditional notes
- TaskCreate: Restructured task assignment instructions

### v2.1.16
- **Initial release of Task Management System**
- TaskCreate introduced as new tool
- Upgrade from TodoWrite to Tasks primitive

### v2.0.74
- TaskList tool description removed from prompts

### v2.0.72
- TaskUpdate: Added "Staleness" section (use TaskGet before updating)
- TaskUpdate: Added usage note requiring short descriptions (3-5 words)

### v2.0.70
- TaskList added as new tool
- TaskUpdate: Added instruction to call TaskList after resolving tasks
- TaskUpdate: Added note about teammates adding comments while working

---

## Sources

### Official Documentation
- [Claude Code v2.1.16 Release Notes](https://github.com/anthropics/claude-code/releases/tag/v2.1.16)
- [Claude Code Docs - How Claude Code Works](https://code.claude.com/docs/en/how-claude-code-works)

### Community Resources
- [paddo.dev - From Beads to Tasks](https://paddo.dev/blog/from-beads-to-tasks/)
- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) - Up-to-date system prompts and changelog
- [ClaudeLog - Task Tool FAQ](https://claudelog.com/faqs/what-is-task-tool-in-claude-code/)
- [Hacker News Discussion](https://news.ycombinator.com/item?id=46739348)

### Related Projects
- [Beads](https://github.com/steveyegge/beads) - Git-backed issue tracker by Steve Yegge
- [Claude Task Master](https://github.com/eyaltoledano/claude-task-master) - Task management integration

### Issue Trackers
- [Issue #6760](https://github.com/anthropics/claude-code/issues/6760) - Feature request for configurable task management
- [Issue #1173](https://github.com/anthropics/claude-code/issues/1173) - TodoWrite visibility in Task tool
- [Issue #6159](https://github.com/anthropics/claude-code/issues/6159) - Agent reliability issues

---

*Last updated: January 24, 2026*
*Claude Code version: v2.1.16+*
