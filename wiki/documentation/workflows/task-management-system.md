# Task Management System

Lisa includes a comprehensive task management system for structured team-based development workflows. These tools enable decomposing complex projects into discrete work items with dependency tracking.

> **Note:** These tools are provided by [cc-mirror](https://github.com/numman-ali/cc-mirror), a team collaboration platform. They integrate with Claude Code to enable multi-agent orchestration and parallel work streams.

## Overview

The task management system provides four core operations:

| Tool | Purpose |
|------|---------|
| **TaskCreate** | Create new work items |
| **TaskGet** | Retrieve task details and dependencies |
| **TaskUpdate** | Modify task state, add notes, establish dependencies |
| **TaskList** | View all tasks and their status |

Each task has:
- **ID**: Numeric identifier
- **Subject**: Brief title
- **Description**: Detailed work requirements
- **Status**: `open` or `resolved`
- **Owner**: Worker assigned to the task
- **Dependencies**: Blocking relationships between tasks

## TaskCreate

Create a new work item in the task queue.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `subject` | string | Yes | Brief task title (25-100 characters) |
| `description` | string | Yes | Detailed explanation of work needed |

### Example

```json
{
  "subject": "Implement user authentication",
  "description": "Add login/logout with JWT tokens, bcrypt password hashing, and session management. Support both email and OAuth flows."
}
```

### Response

```json
{
  "task": {
    "id": "1",
    "subject": "Implement user authentication",
    "description": "...",
    "status": "open",
    "owner": null,
    "blockedBy": [],
    "blocks": [],
    "comments": []
  }
}
```

## TaskGet

Retrieve comprehensive information about a specific task.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | Numeric task identifier |

### Example

```json
{
  "taskId": "1"
}
```

### Response

```json
{
  "task": {
    "id": "1",
    "subject": "Implement user authentication",
    "description": "Add login/logout with JWT tokens, bcrypt password hashing, and session management. Support both email and OAuth flows.",
    "status": "open",
    "owner": "worker-001",
    "blockedBy": [],
    "blocks": ["2", "3"],
    "comments": [
      {
        "author": "worker-001",
        "content": "Started implementation with bcrypt for password hashing"
      }
    ]
  }
}
```

## TaskUpdate

Modify task state, add notes, or establish dependencies.

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `taskId` | string | Yes | Target task identifier |
| `status` | enum | No | `open` or `resolved` |
| `addComment` | object | No | `{author: string, content: string}` |
| `addBlockedBy` | array | No | Array of task IDs that must complete first |
| `blocks` | array | No | Task IDs this task prevents from starting |

### Status Values

- **`open`**: Task is active or waiting for dependencies
- **`resolved`**: Task is complete and can unblock dependents

### Examples

**Mark task as resolved:**

```json
{
  "taskId": "1",
  "status": "resolved"
}
```

**Add a comment with progress update:**

```json
{
  "taskId": "1",
  "addComment": {
    "author": "worker-001",
    "content": "Completed with bcrypt hashing and JWT tokens. Ready for testing."
  }
}
```

**Establish a blocking dependency:**

```json
{
  "taskId": "2",
  "addBlockedBy": ["1"]
}
```

This marks task 2 as blocked by task 1. Task 2 cannot start until task 1 is resolved.

**Declare what this task blocks:**

```json
{
  "taskId": "1",
  "blocks": ["2", "3"]
}
```

This indicates that tasks 2 and 3 are waiting for task 1 to complete.

## TaskList

Display all tasks with summary metadata.

### Parameters

None

### Example

```json
{}
```

### Response

```json
{
  "tasks": [
    {
      "id": "1",
      "subject": "Setup database schema",
      "status": "resolved",
      "owner": "worker-001"
    },
    {
      "id": "2",
      "subject": "Implement user model",
      "status": "open",
      "owner": null,
      "blockedBy": ["1"]
    },
    {
      "id": "3",
      "subject": "Create authentication service",
      "status": "open",
      "owner": null,
      "blockedBy": ["2"]
    },
    {
      "id": "4",
      "subject": "Build login UI",
      "status": "open",
      "owner": null,
      "blockedBy": ["3"]
    }
  ]
}
```

## Workflow Pattern

The task management system enables a structured workflow:

### 1. Decompose

Break down complex work into discrete tasks using `TaskCreate`:

```json
[
  {"subject": "Setup database", "description": "..."},
  {"subject": "Implement user model", "description": "..."},
  {"subject": "Create auth service", "description": "..."}
]
```

### 2. Declare Dependencies

Establish task ordering using `TaskUpdate` with `addBlockedBy`:

```json
{
  "taskId": "2",
  "addBlockedBy": ["1"]
}
```

This ensures work proceeds in the correct sequence.

### 3. Find Ready Work

Query `TaskList` to identify unblocked tasks:

```json
// Response contains tasks where blockedBy is empty
```

These are the tasks that can start immediately.

### 4. Execute

Assign a task to a worker and begin implementation:

```json
{
  "taskId": "2",
  "addComment": {"author": "worker-001", "content": "Starting implementation"}
}
```

### 5. Mark Complete

Update task status to `resolved` when finished:

```json
{
  "taskId": "2",
  "status": "resolved",
  "addComment": {"author": "worker-001", "content": "Completed with tests passing"}
}
```

This automatically unblocks dependent tasks.

### 6. Loop

Repeat steps 3-5 until all tasks are `resolved`.

## Usage Example: Building a Web Application

Here's a complete example of decomposing an application into tasks:

**Step 1: Create tasks**

```json
{
  "subject": "Setup project infrastructure",
  "description": "Initialize repository, configure build tools, setup CI/CD pipelines"
}
→ Task ID: 1

{
  "subject": "Design database schema",
  "description": "Create ERD, define models for users, posts, comments"
}
→ Task ID: 2

{
  "subject": "Implement database layer",
  "description": "Create migrations, repositories, implement query methods"
}
→ Task ID: 3

{
  "subject": "Build authentication service",
  "description": "JWT tokens, password hashing, session management"
}
→ Task ID: 4

{
  "subject": "Create REST API endpoints",
  "description": "POST /auth/login, GET /posts, POST /posts, etc."
}
→ Task ID: 5

{
  "subject": "Build frontend UI",
  "description": "React components for login, home, post creation"
}
→ Task ID: 6
```

**Step 2: Establish dependencies**

```json
// Task 3 (database) blocked by Task 2 (schema)
{"taskId": "3", "addBlockedBy": ["2"]}

// Task 4 (auth) blocked by Task 3 (database)
{"taskId": "4", "addBlockedBy": ["3"]}

// Task 5 (API) blocked by Tasks 1 and 4
{"taskId": "5", "addBlockedBy": ["1", "4"]}

// Task 6 (UI) blocked by Task 5 (API)
{"taskId": "6", "addBlockedBy": ["5"]}
```

**Step 3: Parallel execution**

Workers can now execute in parallel:
- Worker 1 completes Task 1 (infrastructure)
- Worker 2 completes Task 2 (schema design)
- Once Task 2 completes, Worker 3 starts Task 3 (database layer)
- Once Tasks 1 and 3 complete, Task 4 becomes ready
- And so on...

## Benefits

- **Structured Decomposition**: Break down ambiguous goals into concrete tasks
- **Dependency Management**: Prevent work from starting before prerequisites complete
- **Parallel Execution**: Multiple workers progress simultaneously without blocking
- **Progress Tracking**: Monitor which tasks are complete, in progress, or blocked
- **Handoff Clarity**: Clear task ownership and completion criteria
- **Auditable History**: Comments provide a record of work performed

## Integration with Claude Code

These task management tools integrate with Claude Code's multi-agent capabilities to enable:

- **Orchestration**: Coordinate work across multiple agent instances
- **Dynamic Dispatch**: Spawn workers for unblocked tasks automatically
- **Feedback Loops**: Workers report completion via task comments
- **Dependency Resolution**: Automatically identify tasks ready to start

This enables complex, long-running projects to be executed by teams of coordinated AI agents.
