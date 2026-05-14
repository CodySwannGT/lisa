# Claude Code Agent Teams, Git Worktrees, Skills, Commands, Hooks & Settings Reference (2026-02-20)

Complete expert reference for Claude Code Agent Teams, Git Worktrees, skills, commands, hooks, and `.claude/settings.json` configuration. Standalone document superseding REFERENCE.md and REFERENCE.0002.md.

---

## Summary of Updates from REFERENCE.0002.md

| Feature | Change |
|---------|--------|
| **Agent Teams** | New experimental feature for coordinating multiple Claude Code instances |
| **Hook events** | 15 total (added `TeammateIdle`, `TaskCompleted`) |
| **Hook handler types** | 3 total (added `agent` type alongside `command` and `prompt`) |
| **Async hooks** | New `"async": true` option for command hooks |
| **New settings** | `teammateMode`, `prefersReducedMotion`, `spinnerVerbs`, `allowManagedPermissionRulesOnly`, `sandbox.network.allowAllUnixSockets`, `sandbox.network.allowedDomains` |
| **New env vars** | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`, `CLAUDE_CODE_TEAM_NAME`, `CLAUDE_CODE_PLAN_MODE_REQUIRED`, `CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, many more |
| **SessionEnd matcher** | New value `bypass_permissions_disabled` |
| **Subagent config** | `memory` field, `skills` preloading, `hooks` in frontmatter, `mcpServers` field |
| **Settings validation** | `$schema` support for `settings.json` |
| **Git Worktrees (v2.1.49)** | `--worktree` (`-w`) CLI flag for isolated parallel sessions; `isolation: worktree` for subagents |
| **Worktree hooks (v2.1.50)** | `WorktreeCreate` and `WorktreeRemove` hook events for custom VCS setup/teardown |
| **Hook events** | 17 total (added `WorktreeCreate`, `WorktreeRemove`) |
| **New tool** | `EnterWorktree` — create worktree mid-session |

---

## Skills vs Commands

Skills and commands are complementary features in Claude Code with distinct roles.

### Skills (`.claude/skills/<name>/SKILL.md`)

Skills contain implementation logic — the actual instructions Claude follows to perform a task.

| Property | Details |
|----------|---------|
| **Location** | `.claude/skills/<name>/SKILL.md` |
| **Naming** | Hyphen-separated (e.g., `plan-create`, `git-commit`) |
| **Invocation** | Via `Skill` tool: `Skill(skill: "plan-create", args: "...")` |
| **`$ARGUMENTS`** | NOT substituted — appears as literal text |
| **`argument-hint`** | NOT supported — ignored in frontmatter |
| **Frontmatter** | `name`, `description`, `allowed-tools` |
| **Visibility** | Listed in system prompt, invocable by Claude autonomously |

### Commands (`.claude/commands/<namespace>/<name>.md`)

Commands are the user-facing interface — they provide argument hints in the UI and substitute `$ARGUMENTS` before delegating to a skill.

| Property | Details |
|----------|---------|
| **Location** | `.claude/commands/<namespace>/<name>.md` |
| **Naming** | Directory nesting creates colon-separated UI names (e.g., `plan/create.md` → `/plan:create`) |
| **Invocation** | User types `/plan:create <args>` in the prompt |
| **`$ARGUMENTS`** | Substituted with user input before Claude sees the prompt |
| **`argument-hint`** | Supported — shown as placeholder text in the UI |
| **Frontmatter** | `description`, `allowed-tools`, `argument-hint` |
| **Visibility** | Shown in slash command menu with descriptions and argument hints |

### How They Work Together

```text
User types: /plan:create https://jira.example.com/TICKET-123

1. Claude Code finds .claude/commands/plan/create.md
2. $ARGUMENTS is replaced: "Use the /plan-create skill to create a plan for https://jira.example.com/TICKET-123"
3. Claude invokes Skill(skill: "plan-create", args: "https://jira.example.com/TICKET-123")
4. Skill SKILL.md is loaded and Claude follows the instructions
```

### Naming Conventions

| Context | Format | Example |
|---------|--------|---------|
| Skill directory | Hyphen-separated | `.claude/skills/plan-create/SKILL.md` |
| Command directory | Nested directories | `.claude/commands/plan/create.md` |
| User-facing name | Colon-separated (from command nesting) | `/plan:create` |
| Skill-to-skill reference | Hyphen name | `Run /git-commit` |
| User docs and rules | Either format | `/plan:create` or `/plan-create` |

### Command Pass-Through Pattern

Every skill should have a corresponding command:

```markdown
---
description: "What this command does"
allowed-tools: ["Skill"]
argument-hint: "<required-arg> [optional-arg]"
---

Use the /my-skill-name skill to do the thing. $ARGUMENTS
```

For skills without arguments, omit `argument-hint` and `$ARGUMENTS`.

### Why Skills Matter for Subagents

Subagents (spawned via the `Task` tool) have **isolated context windows** — they do not inherit the parent agent's conversation history, in-flight reasoning, or any context accumulated during the session. Each subagent starts with a clean slate.

However, subagents **do** automatically load:

- `CLAUDE.md` and all `.claude/rules/` files
- MCP servers configured in `.claude/settings.json`
- Skills listed in the agent's frontmatter `skills:` array

This creates an important design principle: **encode reusable standards as skills, not as conversational instructions.** A skill listed in an agent's frontmatter is loaded identically whether the work is performed directly by the parent session or delegated to a subagent. Conversational instructions ("remember to follow JSDoc best practices") are lost when work is delegated because subagents cannot see the parent's conversation.

```yaml
---
name: implementer
skills:
  - jsdoc-best-practices
  - coding-philosophy
---
```

In this example, the `implementer` agent enforces the same JSDoc and coding standards as the parent session — not because it inherited them from the conversation, but because the skills are explicitly preloaded via frontmatter.

**Rule of thumb:** If a standard should apply uniformly regardless of who does the work, make it a skill (or a rule in `.claude/rules/`). If it's a one-off instruction for a specific task, put it in the spawn prompt.

| Mechanism | Inherited by subagents? | Use for |
|-----------|------------------------|---------|
| Conversation context | No | Task-specific instructions in spawn prompts |
| `.claude/rules/` files | Yes (auto-loaded) | Project-wide rules and constraints |
| Skills in frontmatter `skills:` | Yes (preloaded) | Reusable procedures and standards |
| CLAUDE.md | Yes (auto-loaded) | Top-level project instructions |
| Spawn prompt | Yes (initial context) | Task-specific goals and context |

---

## Agent Teams

### Overview

Agent Teams is an experimental feature that coordinates multiple Claude Code instances as a team with shared tasks, messaging, and centralized management. One instance acts as the **team lead** that creates tasks and spawns **teammates** (subagents) to work in parallel.

### Enabling Agent Teams

| Method | Configuration |
|--------|--------------|
| Environment variable | `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| Settings JSON | `"env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" }` |

### Architecture

```text
Team Lead (main Claude Code session)
├── Team config: ~/.claude/teams/{team-name}/config.json
├── Task list:   ~/.claude/tasks/{team-name}/
├── Teammate A (subagent)
│   └── Mailbox (receives messages, sends results)
├── Teammate B (subagent)
│   └── Mailbox
└── Teammate C (subagent)
    └── Mailbox
```

| Component | Description |
|-----------|-------------|
| **Team lead** | Main session that creates the team, spawns teammates, and coordinates work |
| **Teammates** | Subagents spawned via the `Task` tool with `team_name` parameter |
| **Task list** | Shared task tracking at `~/.claude/tasks/{team-name}/` accessible by all members |
| **Mailbox** | Message delivery system — teammates send/receive via `SendMessage` tool |
| **Team config** | `~/.claude/teams/{team-name}/config.json` with member registry |

### Team Config File Structure

```json
{
  "members": [
    {
      "name": "team-lead",
      "agentId": "unique-agent-id",
      "agentType": "general-purpose"
    },
    {
      "name": "researcher",
      "agentId": "unique-agent-id-2",
      "agentType": "Explore"
    }
  ]
}
```

- **name**: Human-readable name — always use this for messaging and task assignment
- **agentId**: Unique identifier (reference only — do not use for communication)
- **agentType**: Role/type of the agent

### TeamCreate Tool

Creates a new team with associated task list.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `team_name` | `string` | Yes | Name for the new team |
| `description` | `string` | No | Team description/purpose |
| `agent_type` | `string` | No | Type/role of the team lead |

**Creates:**
- Team file at `~/.claude/teams/{team-name}/config.json`
- Task list directory at `~/.claude/tasks/{team-name}/`

### TeamDelete Tool

Removes team and task directories when work is complete. Takes no parameters — uses current session's team context.

**Important:** TeamDelete fails if the team still has active members. Shut down all teammates first via `shutdown_request` messages.

### Spawning Teammates

Teammates are spawned via the `Task` tool with team-specific parameters:

```json
{
  "prompt": "Research the authentication module",
  "subagent_type": "general-purpose",
  "team_name": "my-team",
  "name": "researcher",
  "mode": "default"
}
```

| Parameter | Description |
|-----------|-------------|
| `team_name` | Team to join (must match TeamCreate name) |
| `name` | Human-readable teammate name (used for all messaging) |
| `subagent_type` | Agent type determining available tools |
| `mode` | Permission mode: `default`, `plan`, `acceptEdits`, `bypassPermissions`, `dontAsk`, `delegate` |

### SendMessage Tool

Communication between team members. All types use the `SendMessage` tool.

#### Message Types

| Type | Direction | Description |
|------|-----------|-------------|
| `message` | One-to-one | Direct message to a specific teammate |
| `broadcast` | One-to-all | Same message to every teammate (expensive — use sparingly) |
| `shutdown_request` | Lead → Teammate | Request graceful shutdown |
| `shutdown_response` | Teammate → Lead | Approve or reject shutdown |
| `plan_approval_response` | Lead → Teammate | Approve or reject a teammate's plan |

#### `message` Schema

```json
{
  "type": "message",
  "recipient": "researcher",
  "content": "Your message here",
  "summary": "Brief 5-10 word preview"
}
```

#### `broadcast` Schema

```json
{
  "type": "broadcast",
  "content": "Message to all teammates",
  "summary": "Brief 5-10 word preview"
}
```

**Warning:** Broadcasting sends a separate message to every teammate. N teammates = N deliveries. Use only for critical team-wide announcements.

#### `shutdown_request` Schema

```json
{
  "type": "shutdown_request",
  "recipient": "researcher",
  "content": "Task complete, wrapping up"
}
```

#### `shutdown_response` Schema

**Approve:**

```json
{
  "type": "shutdown_response",
  "request_id": "abc-123",
  "approve": true
}
```

**Reject:**

```json
{
  "type": "shutdown_response",
  "request_id": "abc-123",
  "approve": false,
  "content": "Still working on task #3"
}
```

#### `plan_approval_response` Schema

**Approve:**

```json
{
  "type": "plan_approval_response",
  "request_id": "abc-123",
  "recipient": "researcher",
  "approve": true
}
```

**Reject:**

```json
{
  "type": "plan_approval_response",
  "request_id": "abc-123",
  "recipient": "researcher",
  "approve": false,
  "content": "Please add error handling for the API calls"
}
```

### Task Tools Integration for Teams

When a team exists, task tools operate on the team's shared task list at `~/.claude/tasks/{team-name}/`.

| Tool | Team Behavior |
|------|--------------|
| `TaskCreate` | Creates task in shared list — all teammates can see it |
| `TaskUpdate` | Update status, set `owner` to assign to teammates by name |
| `TaskList` | View all tasks across the team |
| `TaskGet` | Read full task details including description and dependencies |
| `TaskOutput` | Retrieve output from a running or completed background task |
| `TaskStop` | Stop a running background task by its ID |

#### Task Assignment Workflow

1. Team lead creates tasks with `TaskCreate`
2. Assign tasks with `TaskUpdate` setting `owner` to teammate's name
3. Teammates claim unassigned tasks via `TaskUpdate`
4. Teammates mark tasks `completed` via `TaskUpdate`
5. After completing a task, teammates call `TaskList` to find next available work

#### Task Dependencies

```json
{
  "taskId": "2",
  "addBlockedBy": ["1"]
}
```

Tasks with non-empty `blockedBy` cannot be claimed until dependencies resolve.

### Teammate Lifecycle

```text
1. Team lead calls TeamCreate
2. Team lead spawns teammates via Task tool (with team_name)
3. Teammates receive initial prompt and begin working
4. Teammates go idle after each turn (normal — not an error)
5. Messages from teammates are automatically delivered to team lead
6. Team lead assigns new work or sends follow-up messages
7. Team lead sends shutdown_request when done
8. Teammates respond with shutdown_response (approve/reject)
9. Team lead calls TeamDelete after all teammates shut down
```

#### Idle State

- Teammates go idle after every turn — this is **normal and expected**
- Idle teammates **can receive messages** — sending a message wakes them up
- System sends automatic idle notifications to the team lead
- Do not treat idle as an error or completion signal
- When a teammate sends a DM to another teammate, a brief summary appears in their idle notification

### Display Modes

Controlled by the `teammateMode` setting:

| Mode | Description |
|------|-------------|
| `in-process` | Teammates run in the same terminal process |
| `tmux` | Teammates run in separate tmux panes (requires tmux) |
| `auto` | Automatically selects best mode based on environment (default) |

### Delegate Mode

Delegate mode restricts the team lead to coordination-only tools (task management, messaging) by pressing **Shift+Tab** in the team lead's terminal. This forces the lead to focus on orchestration rather than direct implementation, delegating all coding work to teammates.

### Plan Mode for Teammates

When spawning with `"mode": "plan"`, the teammate must create a plan and get approval before implementing:

1. Teammate enters plan mode automatically
2. Teammate explores codebase and creates plan
3. Teammate calls `ExitPlanMode` which sends `plan_approval_request` to team lead
4. Team lead reviews and responds with `plan_approval_response`
5. On approval, teammate exits plan mode and implements
6. On rejection, teammate revises plan based on feedback

### Permissions Inheritance

- Teammates inherit the project's permission settings from `.claude/settings.json`
- The `mode` parameter on the Task tool call can override per-teammate
- Team lead's permission mode does not automatically cascade

### Context & Communication Patterns

- Teammates do **not** share context windows — each has its own
- All communication must go through `SendMessage` — text output is not visible to others
- Messages are delivered automatically (no manual inbox checking needed)
- When reporting on teammate messages, you do not need to quote the original — it's already rendered
- Do not send structured JSON status messages — use `TaskUpdate` for task status

### Token Cost Guidance

Agent teams use approximately **7x more tokens** than standard sessions when teammates run in plan mode, because each teammate maintains its own context window and runs as a separate Claude instance.

| Consideration | Guidance |
|---------------|----------|
| Base overhead | ~7x standard usage per teammate (each has its own context window) |
| Model selection | Use Sonnet for teammates with trivial tasks — balances capability and cost for coordination tasks |
| Spawn prompts | Keep focused — teammates load CLAUDE.md, MCP servers, and skills automatically; everything in spawn prompt adds to initial context |
| Broadcast cost | Scales linearly with team size (avoid unnecessary broadcasts) |
| Right-sizing | Spawn only the teammates you need for genuine parallel work |
| Cleanup | Active teammates continue consuming tokens even if idle — shut them down when done |

### Limitations

| Limitation | Description |
|------------|-------------|
| No session resumption | Teammates cannot resume from previous sessions |
| No nested teams | A teammate cannot create its own team |
| One team per session | Each session can only have one active team |
| No shared context | Teammates do not see each other's context windows |
| Experimental | Feature requires explicit opt-in via env var |
| Teammate output invisible | Plain text output from teammates is not visible to team lead or other teammates — must use SendMessage |

---

## Git Worktrees (v2.1.49+)

### Overview

Git Worktrees allow running multiple parallel Claude Code sessions in the same repository without code edits clobbering each other. Each session gets its own isolated copy of the repo via a git worktree. Introduced in **v2.1.49** (February 20, 2026), enhanced with hook events in **v2.1.50** (same day).

**Announcement:** Boris Cherny (creator of Claude Code) announced on [Threads](https://www.threads.com/@boris_cherny/post/DVAAnexgRUj/introducing-built-in-git-worktree-support-for-claude-code-now-agents-can-run-in):

> "Introducing: built-in git worktree support for Claude Code. Now, agents can run in parallel without interfering with one another. Each agent gets its own worktree and can work independently. The Claude Code Desktop app has had built-in support for worktrees for a while, and now we're bringing it to CLI too."

### CLI Usage

```bash
# Named worktree — creates .claude/worktrees/feature-auth/ with branch worktree-feature-auth
claude --worktree feature-auth
claude -w feature-auth

# Auto-named worktree — generates a random name like "bright-running-fox"
claude --worktree
claude -w

# Combine with tmux for background sessions
claude --worktree feature-auth --tmux
```

### How It Works

| Aspect | Details |
|--------|---------|
| **Location** | `<repo>/.claude/worktrees/<name>/` |
| **Branch name** | `worktree-<name>` |
| **Branch base** | Default remote branch (e.g., `origin/main`) |
| **Memory** | Separate memory directory per worktree |
| **Sessions** | Stored per project directory; `/resume` shows sessions from the same git repo including worktrees |

### Cleanup Behavior

| Scenario | Behavior |
|----------|----------|
| No changes made | Worktree and branch are **automatically removed** |
| Changes or commits exist | Claude **prompts** to keep or remove. Keeping preserves directory and branch. Removing deletes the worktree directory and branch, discarding all uncommitted changes and commits |

### Mid-Session Worktree Creation

Users can ask Claude to create a worktree during a session by saying "work in a worktree" or "start a worktree". Claude uses the `EnterWorktree` tool internally.

#### EnterWorktree Tool

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `name` | `string` | No | Name for the worktree. A random name is generated if not provided |

**Requirements:**
- Must be in a git repository, OR have `WorktreeCreate`/`WorktreeRemove` hooks configured
- Must not already be in a worktree

### Subagent Worktree Isolation

Subagents can run in isolated worktrees via two mechanisms:

#### 1. Task Tool Parameter

When spawning subagents via the `Task` tool, pass `isolation: "worktree"`:

```json
{
  "prompt": "Refactor the auth module",
  "subagent_type": "general-purpose",
  "isolation": "worktree"
}
```

The worktree is automatically cleaned up if the subagent makes no changes. If changes are made, the worktree path and branch are returned in the result.

#### 2. Agent Definition Frontmatter

Custom agents in `.claude/agents/` can declare worktree isolation in their frontmatter:

```markdown
---
name: refactorer
description: Refactors code in an isolated worktree
isolation: worktree
---

Agent instructions here...
```

| Frontmatter Field | Required | Description |
|-------------------|----------|-------------|
| `isolation` | No | Set to `worktree` to run the subagent in a temporary git worktree |

### Worktree Hook Events (v2.1.50)

Two hook events enable custom VCS setup and teardown when worktrees are created or removed.

#### WorktreeCreate

Fires when a worktree is created (CLI `--worktree` flag, `EnterWorktree` tool, or subagent `isolation: worktree`).

**Use cases:** Install dependencies, copy environment files, seed databases, custom VCS setup for non-git systems.

#### WorktreeRemove

Fires when a worktree is being removed (session exit cleanup or explicit removal).

**Use cases:** Clean up resources, remove temporary files, custom VCS teardown.

**Hook configuration example:**

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cd $WORKTREE_PATH && bun install",
            "timeout": 120
          }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'Cleaning up worktree at $WORKTREE_PATH'"
          }
        ]
      }
    ]
  }
}
```

### .gitignore Configuration

Add `.claude/worktrees/` to `.gitignore` to prevent worktree contents from appearing as untracked files:

```gitignore
.claude/worktrees/
```

### Known Limitations

| Limitation | Status | Reference |
|------------|--------|-----------|
| `.worktreeinclude` not supported in CLI | Open | [#15327](https://github.com/anthropics/claude-code/issues/15327) — Desktop app only |
| Windows drive letter casing mismatch | Fixed in v2.1.47 | [#26123](https://github.com/anthropics/claude-code/issues/26123) |
| Custom agents/skills not discovered in worktrees | Fixed in v2.1.47 | [#25816](https://github.com/anthropics/claude-code/issues/25816) |
| Background tasks failing in worktrees | Fixed in v2.1.47 | [#26065](https://github.com/anthropics/claude-code/issues/26065) |
| No option to disable auto-worktree in Desktop | Open | [#21236](https://github.com/anthropics/claude-code/issues/21236) |

### Related GitHub Issues

| Issue | Description | Status |
|-------|-------------|--------|
| [#1052](https://github.com/anthropics/claude-code/issues/1052) | Field notes: git worktree pattern (early community workflow) | Closed |
| [#24850](https://github.com/anthropics/claude-code/issues/24850) | Offer to implement approved plans in a new worktree | Open |
| [#15327](https://github.com/anthropics/claude-code/issues/15327) | CLI support for `.worktreeinclude` file (parity with Desktop) | Open |
| [#20875](https://github.com/anthropics/claude-code/issues/20875) | Share sessions across git worktrees | Open |
| [#22615](https://github.com/anthropics/claude-code/issues/22615) | Enhanced worktree management with selective checkout | Open |

### Version History

| Version | Date | Changes |
|---------|------|---------|
| v2.1.47 | Feb 18-19, 2026 | Bug fixes: Windows drive letter casing, agent/skill discovery in worktrees, background task remote URL resolution |
| v2.1.49 | Feb 20, 2026 | Feature introduction: `--worktree` (`-w`) CLI flag, `isolation: "worktree"` for Task tool subagents |
| v2.1.50 | Feb 20, 2026 | Enhancements: `isolation: worktree` in agent definition frontmatter, `WorktreeCreate` and `WorktreeRemove` hook events |

### Sources

- [Common workflows — Claude Code Docs](https://code.claude.com/docs/en/common-workflows) — Primary official documentation
- [Create custom subagents — Claude Code Docs](https://code.claude.com/docs/en/sub-agents) — `isolation: worktree` frontmatter
- [Automate workflows with hooks — Claude Code Docs](https://code.claude.com/docs/en/hooks-guide) — `WorktreeCreate`/`WorktreeRemove` hooks
- [Claude Code CHANGELOG.md](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) — Release notes
- [Boris Cherny Threads announcement](https://www.threads.com/@boris_cherny/post/DVAAnexgRUj/introducing-built-in-git-worktree-support-for-claude-code-now-agents-can-run-in)
- [Boris Cherny Threads usage tip](https://www.threads.com/@boris_cherny/post/DVAAoZ3gYut/use-claude-worktree-for-isolation-to-run-claude-code-in-its-own-git-worktree)
- [incident.io blog: Shipping faster with Claude Code and Git Worktrees](https://incident.io/blog/shipping-faster-with-claude-code-and-git-worktrees)
- [The Complete Guide to Git Worktrees with Claude Code](https://notes.muthu.co/2026/02/the-complete-guide-to-git-worktrees-with-claude-code/)

---

## Hook Event Types (17 total)

| Event | Trigger | Matcher Support | Purpose |
|-------|---------|-----------------|---------|
| `SessionStart` | Session begins/resumes | `startup`, `resume`, `clear`, `compact` | Load context, set environment variables |
| `SessionEnd` | Session terminates | `clear`, `logout`, `prompt_input_exit`, `bypass_permissions_disabled`, `other` | Cleanup tasks, logging, session state |
| `Setup` | `--init`, `--init-only`, `--maintenance` flags | `init`, `maintenance` | One-time operations: dependencies, migrations |
| `PreToolUse` | Before tool call processes | Tool names (regex supported) | Validate/modify/block tool calls before execution |
| `PostToolUse` | After tool succeeds | Tool names (regex supported) | Provide feedback after successful execution |
| `PostToolUseFailure` | After tool fails | Tool names (regex supported) | Handle tool execution failures |
| `PermissionRequest` | Permission dialog appears | Tool names | Auto-approve/deny permission requests |
| `SubagentStart` | Subagent spawns | N/A | Log/monitor subagent initialization |
| `SubagentStop` | Subagent finishes | N/A | Validate subagent completion, decide continuation |
| `Stop` | Main agent finishes (not interrupted) | N/A | Intelligent decision: stop or continue working |
| `UserPromptSubmit` | User submits prompt | N/A | Add context, validate, or block prompts |
| `Notification` | Notifications sent | `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` | Send alerts, custom notifications |
| `PreCompact` | Before context compaction | `manual`, `auto` | Pre-compaction cleanup or logging |
| `TeammateIdle` | Teammate goes idle | N/A | Monitor teammate state, assign new work |
| `TaskCompleted` | A task is marked completed | N/A | React to task completion, trigger follow-up |
| `WorktreeCreate` | Worktree is created (CLI flag, EnterWorktree tool, or subagent isolation) | N/A | Install dependencies, copy env files, custom VCS setup |
| `WorktreeRemove` | Worktree is being removed (session exit or explicit removal) | N/A | Clean up resources, custom VCS teardown |

---

## Hook Configuration Structure

```json
{
  "hooks": {
    "EventName": [
      {
        "matcher": "ToolPattern",
        "hooks": [
          {
            "type": "command",
            "command": "bash-cmd",
            "timeout": 60
          },
          {
            "type": "prompt",
            "prompt": "Evaluation prompt with $ARGUMENTS",
            "timeout": 30
          },
          {
            "type": "agent",
            "prompt": "Verify the code changes are correct",
            "timeout": 120
          }
        ]
      }
    ]
  }
}
```

### Hook Handler Types (3 total)

| Type | Description | Availability |
|------|-------------|--------------|
| `command` | Executes bash command synchronously (or async with `"async": true`) | All events |
| `prompt` | Sends JSON input to LLM (Haiku) for context-aware decision | `Stop`, `SubagentStop`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest` |
| `agent` | Spawns a subagent with tool access for verification/complex logic | All events |

### Hook Handler Fields

#### Common Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `type` | `string` | Required | `"command"`, `"prompt"`, or `"agent"` |
| `timeout` | `number` | Varies | Timeout in seconds (command: 600, prompt: 30, agent: 60) |
| `statusMessage` | `string` | None | Custom spinner message displayed while hook runs |

#### Command-Specific Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `command` | `string` | Required | Bash command to execute |
| `async` | `boolean` | `false` | Run in background without blocking |

#### Prompt-Specific Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prompt` | `string` | Required | Evaluation prompt (supports `$ARGUMENTS` substitution) |
| `model` | `string` | Haiku | Model for prompt evaluation |

`$ARGUMENTS` is substituted with the JSON-serialized hook input at runtime, providing the prompt with the full event context.

#### Agent-Specific Fields

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `prompt` | `string` | Required | Instructions for the subagent |
| `model` | `string` | Default | Model for the subagent |

### Async Hooks

Command hooks can run asynchronously with `"async": true`:

```json
{
  "type": "command",
  "command": "notify-slack.sh",
  "async": true
}
```

Async hooks run in the background and do not block the main execution. Exit codes from async hooks are not processed for blocking behavior.

### Prompt Hook Configuration Example

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Evaluate whether this command is safe to run: $ARGUMENTS",
            "model": "haiku",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

**Supported events for prompt hooks:** `Stop`, `SubagentStop`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`

### Prompt Hook Response Schema

```json
{
  "ok": true,
  "reason": "Explanation of decision"
}
```

When `ok` is `false`, the hook blocks the action and provides the reason as feedback.

---

## Hook Input Schemas

### Common Fields (all events)

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "permission_mode": "default | plan | acceptEdits | dontAsk | bypassPermissions",
  "hook_event_name": "EventName"
}
```

### Per-Event Input

#### PreToolUse

```json
{
  "tool_name": "Bash | Write | Edit | Read | ...",
  "tool_input": {
    "command": "...",
    "description": "...",
    "timeout": 120000,
    "run_in_background": false
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

#### PostToolUse

```json
{
  "tool_name": "...",
  "tool_input": {},
  "tool_response": {},
  "tool_use_id": "toolu_01ABC123..."
}
```

#### PostToolUseFailure

```json
{
  "tool_name": "...",
  "tool_input": {},
  "error": "Error message",
  "is_interrupt": false,
  "tool_use_id": "toolu_01ABC123..."
}
```

#### SessionStart

```json
{
  "source": "startup | resume | clear | compact",
  "model": "claude-sonnet-4-20250514",
  "agent_type": "AgentName"
}
```

#### SessionEnd

```json
{
  "reason": "exit | clear | logout | prompt_input_exit | bypass_permissions_disabled | other"
}
```

#### Setup

```json
{
  "trigger": "init | maintenance"
}
```

#### UserPromptSubmit

```json
{
  "prompt": "User's prompt text"
}
```

#### Stop

```json
{
  "stop_hook_active": false
}
```

#### SubagentStart

```json
{
  "agent_id": "agent-abc123",
  "agent_type": "Explore | Bash | Plan | CustomAgentName"
}
```

#### SubagentStop

```json
{
  "stop_hook_active": false,
  "agent_id": "def456",
  "agent_type": "Explore | Bash | Plan | CustomAgentName",
  "agent_transcript_path": "/path/to/subagent/transcript.jsonl"
}
```

#### Notification

```json
{
  "message": "Claude needs your permission to use Bash",
  "notification_type": "permission_prompt | idle_prompt | auth_success | elicitation_dialog"
}
```

#### PreCompact

```json
{
  "trigger": "manual | auto",
  "custom_instructions": ""
}
```

#### PermissionRequest

```json
{
  "tool_name": "Bash",
  "tool_input": {
    "command": "rm -rf node_modules"
  }
}
```

#### TeammateIdle

```json
{
  "teammate_name": "researcher",
  "team_name": "my-team"
}
```

#### TaskCompleted

```json
{
  "task_id": "1",
  "task_subject": "Implement authentication",
  "task_description": "Optional task description",
  "teammate_name": "researcher",
  "team_name": "my-team"
}
```

---

## Hook Output Schemas

### PreToolUse Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow | deny | ask",
    "permissionDecisionReason": "Optional explanation",
    "updatedInput": { "field_name": "new_value" },
    "additionalContext": "Additional context for Claude"
  }
}
```

### PermissionRequest Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PermissionRequest",
    "decision": {
      "behavior": "allow | deny",
      "message": "Why denied",
      "interrupt": true,
      "updatedInput": {}
    }
  }
}
```

### PostToolUse Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Feedback for Claude"
  },
  "decision": "block | undefined",
  "reason": "Why blocked (if decision=block)"
}
```

### UserPromptSubmit Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Additional context to add"
  },
  "decision": "block | undefined",
  "reason": "Why blocked"
}
```

### Stop/SubagentStop Output

```json
{
  "decision": "block | undefined",
  "reason": "Why blocked (required when blocked)"
}
```

### SessionStart/Setup Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart | Setup",
    "additionalContext": "Context to inject"
  }
}
```

---

## Exit Code Behavior

| Exit Code | Behavior |
|-----------|----------|
| **0** | Success — stdout processed for JSON or added as context |
| **2** | Blocking error — prevents action, stderr shown to Claude |
| **Other** | Non-blocking error — stderr shown in verbose mode only |

---

## Blocking vs Non-Blocking Hooks

| Event | Exit Code 2 Effect |
|-------|-------------------|
| `PreToolUse` | Blocks tool call, shows stderr to Claude |
| `PermissionRequest` | Denies permission, shows stderr to Claude |
| `PostToolUse` | Shows stderr to Claude (tool already ran) |
| `UserPromptSubmit` | Erases submitted prompt, shows stderr to user only |
| `Stop`/`SubagentStop` | Blocks stoppage, shows stderr to Claude |
| `SessionStart`/`SessionEnd`/`Setup`/`PreCompact`/`Notification` | Shows stderr to user only |

---

## Complete settings.json Schema

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",

  "permissions": {
    "allow": ["Bash(npm run:*)", "Read"],
    "ask": ["Bash(git push:*)"],
    "deny": ["Bash(rm -rf:*)", "Read(./.env.*)"],
    "additionalDirectories": ["../docs/"],
    "defaultMode": "default | acceptEdits | plan | bypassPermissions | dontAsk",
    "disableBypassPermissionsMode": "disable | warn"
  },

  "hooks": {},
  "disableAllHooks": false,
  "allowManagedHooksOnly": false,
  "allowManagedPermissionRulesOnly": false,

  "env": {
    "ANTHROPIC_API_KEY": "sk-...",
    "BASH_DEFAULT_TIMEOUT_MS": "30000",
    "BASH_MAX_TIMEOUT_MS": "7200000",
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "CLAUDE_CODE_MAX_OUTPUT_TOKENS": "32000",
    "MAX_THINKING_TOKENS": "31999",
    "OTEL_METRICS_EXPORTER": "otlp",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "...",
    "CUSTOM_VAR": "value"
  },

  "model": "string",
  "alwaysThinkingEnabled": false,

  "statusLine": { "type": "command", "command": "<HOME>/.claude/statusline.sh" },
  "outputStyle": "string",
  "language": "string",
  "spinnerTipsEnabled": true,
  "spinnerVerbs": { "mode": "append", "verbs": ["Pondering", "Crafting"] },
  "terminalProgressBarEnabled": true,
  "showTurnDuration": true,
  "prefersReducedMotion": false,
  "teammateMode": "in-process | tmux | auto",

  "attribution": {
    "commit": "🤖 Generated with Claude Code\n\nCo-Authored-By: ...",
    "pr": "🤖 Generated with Claude Code"
  },
  "includeCoAuthoredBy": false,

  "forceLoginMethod": "claudeai | console",
  "forceLoginOrgUUID": "string",
  "apiKeyHelper": "string",
  "awsAuthRefresh": "string",
  "awsCredentialExport": "string",
  "otelHeadersHelper": "string",

  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": [],
  "disabledMcpjsonServers": [],
  "allowedMcpServers": [],
  "deniedMcpServers": [],

  "enabledPlugins": { "plugin-name@marketplace": true },
  "extraKnownMarketplaces": {},
  "strictKnownMarketplaces": [],

  "respectGitignore": true,
  "fileSuggestion": { "type": "command", "command": "..." },
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["git", "docker"],
    "allowUnsandboxedCommands": true,
    "network": {
      "allowUnixSockets": ["<HOME>/.ssh/agent-socket"],
      "allowAllUnixSockets": false,
      "allowedDomains": ["api.example.com"],
      "allowLocalBinding": true,
      "httpProxyPort": 8080,
      "socksProxyPort": 8081
    },
    "enableWeakerNestedSandbox": false
  },

  "cleanupPeriodDays": 30,
  "autoUpdatesChannel": "stable | latest",
  "plansDirectory": "string",
  "companyAnnouncements": []
}
```

---

## Detailed settings.json Key Reference

### Core Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `$schema` | `string` | None | JSON Schema URL for settings validation |
| `model` | `string` | Current default | Override the default Claude model |
| `language` | `string` | System default | Preferred response language |
| `outputStyle` | `string` | Default | Adjust output style for responses |

### Display & UX Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `spinnerTipsEnabled` | `boolean` | `true` | Show rotating tips during spinner/loading |
| `spinnerVerbs` | `object` | Default set | Custom verbs: `{ "mode": "append", "verbs": ["Pondering"] }` |
| `terminalProgressBarEnabled` | `boolean` | `true` | Display terminal progress bars |
| `showTurnDuration` | `boolean` | `true` | Show "Turn took X seconds" messages |
| `statusLine` | `object` | None | Custom status line script |
| `fileSuggestion` | `object` | Default | Custom `@` file autocomplete script |
| `prefersReducedMotion` | `boolean` | `false` | Reduce animations and motion in UI |
| `teammateMode` | `string` | `"auto"` | Agent Teams display: `"in-process"`, `"tmux"`, `"auto"` |

### Thinking & Model Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `alwaysThinkingEnabled` | `boolean` | `false` | Enable extended thinking by default |
| `autoUpdatesChannel` | `string` | `"latest"` | `"stable"` (tested) or `"latest"` (immediate) |

### File & Git Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `respectGitignore` | `boolean` | `true` | File picker respects `.gitignore` patterns |
| `attribution` | `object` | Default | Git commit/PR attribution strings |
| `includeCoAuthoredBy` | `boolean` | `true` | **DEPRECATED**: Use `attribution.commit` instead |
| `plansDirectory` | `string` | `~/.claude/plans` | Custom directory for plan files |

### Session & Context Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `cleanupPeriodDays` | `number` | `30` | Delete inactive sessions after N days |
| `companyAnnouncements` | `string[]` | `[]` | Announcements at session startup |
| `env` | `object` | `{}` | Environment variables for bash commands |

### Authentication & Security

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `forceLoginMethod` | `string` | Auto-detect | `"claudeai"` (browser) or `"console"` (CLI) |
| `forceLoginOrgUUID` | `string` | None | Organization UUID for auto-select |
| `apiKeyHelper` | `string` | None | Script outputting API key/Bearer token |
| `otelHeadersHelper` | `string` | None | Script generating OpenTelemetry headers |
| `awsAuthRefresh` | `string` | None | Script to refresh AWS credentials |
| `awsCredentialExport` | `string` | None | Script outputting AWS credentials as JSON |

### Hook Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `hooks` | `object` | `{}` | Hook configuration by event type |
| `disableAllHooks` | `boolean` | `false` | Disable all user/project hooks globally |
| `allowManagedHooksOnly` | `boolean` | `false` | Only allow managed and SDK hooks |

### Permission Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `permissions` | `object` | Default | Permission rules for tools (allow/deny/ask) |
| `allowManagedPermissionRulesOnly` | `boolean` | `false` | Only allow managed permission rules (rejects user/project overrides) |

### MCP & Plugin Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `enableAllProjectMcpServers` | `boolean` | `false` | Auto-approve all MCP servers in `.mcp.json` |
| `enabledMcpjsonServers` | `string[]` | `[]` | Allowlist of MCP servers to enable |
| `disabledMcpjsonServers` | `string[]` | `[]` | Denylist of MCP servers to disable |
| `allowedMcpServers` | `object[]` | `[]` | **Managed only**: Allowlist of configurable MCP servers |
| `deniedMcpServers` | `object[]` | `[]` | **Managed only**: Denylist (takes precedence over allowlist) |
| `enabledPlugins` | `object` | `{}` | Enable/disable plugins: `"name@marketplace": boolean` |
| `extraKnownMarketplaces` | `object` | `{}` | Additional plugin marketplace sources |
| `strictKnownMarketplaces` | `object[]` | `[]` | **Managed only**: Plugin marketplace allowlist |

---

## Permission Settings

```json
{
  "permissions": {
    "allow": ["Bash(npm run:*)", "Read(./docs/**)"],
    "ask": ["Bash(git push:*)"],
    "deny": ["Bash(rm -rf *)", "Read(./.env.*)"],
    "additionalDirectories": ["../docs/"],
    "defaultMode": "default",
    "disableBypassPermissionsMode": "disable"
  }
}
```

### Evaluation Order

First match wins:

1. **Deny rules** (highest priority) — block immediately
2. **Ask rules** — show confirmation dialog
3. **Allow rules** (lowest priority) — auto-approve

### Wildcard Patterns

| Pattern | Matches | Example |
|---------|---------|---------|
| `:*` | Prefix + word boundary | `Bash(npm run:*)` → `npm run lint` (NOT `npm runtest`) |
| `*` | Glob anywhere | `Bash(ls*)` → `ls`, `lsof`, `ls -la` |
| `**` | Recursive glob | `Read(./secrets/**)` → all files under `./secrets/` |
| (exact) | Exact match only | `Bash(npm test)` → only `npm test` |

---

## Sandbox Settings

```json
{
  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["git", "docker"],
    "allowUnsandboxedCommands": true,
    "network": {
      "allowUnixSockets": ["~/.ssh/agent-socket"],
      "allowAllUnixSockets": false,
      "allowedDomains": ["api.example.com", "*.internal.corp"],
      "allowLocalBinding": true,
      "httpProxyPort": 8080,
      "socksProxyPort": 8081
    },
    "enableWeakerNestedSandbox": false
  }
}
```

| Key | Type | Description |
|-----|------|-------------|
| `enabled` | `boolean` | Enable sandboxing (default: true on supported OS) |
| `autoAllowBashIfSandboxed` | `boolean` | Auto-approve Bash when sandboxed |
| `excludedCommands` | `string[]` | Commands running outside sandbox |
| `allowUnsandboxedCommands` | `boolean` | Allow `dangerouslyDisableSandbox` in Bash tool |
| `network.allowUnixSockets` | `string[]` | Unix socket paths accessible inside sandbox |
| `network.allowAllUnixSockets` | `boolean` | Allow all Unix sockets inside sandbox |
| `network.allowedDomains` | `string[]` | Domain allowlist for sandboxed network access |
| `network.allowLocalBinding` | `boolean` | Allow localhost binding (macOS only) |
| `network.httpProxyPort` | `number` | HTTP proxy port for sandboxed commands |
| `network.socksProxyPort` | `number` | SOCKS5 proxy port for sandboxed commands |
| `enableWeakerNestedSandbox` | `boolean` | Weaker sandbox for unprivileged Docker containers |

---

## Environment Variables

### Authentication & API

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | API key for Anthropic services |
| `ANTHROPIC_AUTH_TOKEN` | Bearer token alternative to API key |
| `ANTHROPIC_BASE_URL` | Custom base URL for API requests |

### Model & Provider

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_MAX_OUTPUT_TOKENS` | Maximum output tokens per response |
| `MAX_THINKING_TOKENS` | Maximum tokens for extended thinking |
| `CLAUDE_CODE_USE_BEDROCK` | Use AWS Bedrock as provider (`1`) |
| `CLAUDE_CODE_USE_VERTEX` | Use Google Vertex AI as provider (`1`) |
| `ANTHROPIC_MODEL` | Override model selection |
| `CLAUDE_CODE_SUBAGENT_MODEL` | Model to use for subagents/teammates |
| `CLAUDE_CODE_EFFORT_LEVEL` | Reasoning effort level |

### Agent Teams

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | Enable Agent Teams feature (`1`) |
| `CLAUDE_CODE_TEAM_NAME` | Name of the current team (set automatically when in a team) |
| `CLAUDE_CODE_TASK_LIST_ID` | Task list ID for team coordination |
| `CLAUDE_CODE_PLAN_MODE_REQUIRED` | Force teammate into plan mode (`1`) |

### Bash & Execution

| Variable | Description |
|----------|-------------|
| `BASH_DEFAULT_TIMEOUT_MS` | Default bash command timeout in ms (default: 30000) |
| `BASH_MAX_TIMEOUT_MS` | Maximum bash command timeout in ms (default: 7200000) |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | Disable background task execution (`1`) |

### Context & Memory

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | Disable automatic memory creation (`1`) |

### Hook Environment Variables

| Variable | Description | Availability |
|----------|-------------|--------------|
| `CLAUDE_PROJECT_DIR` | Absolute path to project root | All hooks |
| `CLAUDE_CODE_REMOTE` | `"true"` if web environment | All hooks |
| `CLAUDE_ENV_FILE` | File path to persist env vars | SessionStart only |
| `CLAUDE_PLUGIN_ROOT` | Plugin directory path | Plugin hooks only |
| `SESSION_ID` | Unique session identifier | All hooks |

### Telemetry & Observability

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_ENABLE_TELEMETRY` | Enable telemetry (`1`) |
| `OTEL_METRICS_EXPORTER` | OpenTelemetry metrics exporter (e.g., `otlp`) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OpenTelemetry collector endpoint |

### UI & Features

| Variable | Description |
|----------|-------------|
| `CLAUDE_CODE_THEME` | Terminal color theme override |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | Disable non-essential network requests |

---

## Subagent Configuration

Subagents (custom agents) are defined as markdown files in `.claude/agents/` with YAML frontmatter.

### Frontmatter Fields

```yaml
---
name: "my-agent"
description: "Agent description"
model: "inherit"
tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
allowedTools:
  - "Bash(npm test:*)"
memory: "path/to/memory.md"
skills:
  - "skill-name"
hooks:
  PostToolUse:
    - matcher: "Write|Edit"
      hooks:
        - type: "command"
          command: "eslint --fix $FILE"
mcpServers:
  - server-name
isolation: worktree
---

Agent instructions go here in markdown...
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | `string` | Agent identifier |
| `description` | `string` | Purpose description (shown in Task tool) |
| `model` | `string` | Model override: `"sonnet"`, `"opus"`, `"haiku"` |
| `tools` | `string[]` | Allowed tool list |
| `allowedTools` | `string[]` | Permission rules (same syntax as settings.json allow) |
| `memory` | `string` | Path to persistent memory file loaded at start |
| `skills` | `string[]` | Skills to preload when agent starts |
| `hooks` | `object` | Hook configuration specific to this agent |
| `mcpServers` | `string[]` | MCP servers available to this agent |
| `isolation` | `string` | Set to `"worktree"` to run in a temporary git worktree (v2.1.49+) |

### Permission Modes for Subagents

| Mode | Description |
|------|-------------|
| `default` | Standard permission prompts |
| `acceptEdits` | Auto-accept file edits, prompt for other tools |
| `plan` | Must create plan and get approval before implementing |
| `bypassPermissions` | Skip all permission prompts (use with caution) |
| `dontAsk` | Skip prompts but don't bypass deny rules |
| `delegate` | Delegated permissions from parent agent |

---

## Settings File Locations & Precedence

| Scope | Location | Shared | Precedence |
|-------|----------|--------|-----------|
| **Managed** | System-level `managed-settings.json` | Yes (IT deployed) | Highest (cannot override) |
| **CLI args** | Command-line flags and options | No | High |
| **Local** | `.claude/settings.local.json` | No (gitignored) | Normal (overrides Project) |
| **Project** | `.claude/settings.json` | Yes (in git) | Normal |
| **User** | `~/.claude/settings.json` | No | Lowest |

### Managed Settings Locations

| OS | Path |
|----|------|
| macOS | `/Library/Application Support/ClaudeCode/managed-settings.json` |
| Linux/WSL | `/etc/claude-code/managed-settings.json` |
| Windows | `%PROGRAMDATA%\ClaudeCode\managed-settings.json` |

---

## Matcher Patterns

| Pattern | Matches | Example |
|---------|---------|---------|
| `Write` | Exact match only | Write tool only |
| `Edit\|Write` | Either tool (regex OR) | Edit or Write |
| `npm run:*` | Prefix + word boundary | `npm run lint` (NOT `npm runtest`) |
| `ls*` | Glob anywhere | `ls -la`, `lsof` |
| `Notebook.*` | Regex pattern | All Notebook tools |
| `mcp__.*__read` | MCP tools matching | All MCP read operations |
| `""` or omitted | All tools/events | Match everything |

### Common Tool Names for Matching

**Core Tools:**
`Bash`, `Write`, `Edit`, `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `LSP`

**Notebook Tools:**
`Notebook`, `NotebookEdit`

**Agent & Task Tools:**
`Task`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TaskOutput`, `TaskStop`

**Team Tools:**
`TeamCreate`, `TeamDelete`, `SendMessage`

**Skill & Planning Tools:**
`Skill`, `EnterPlanMode`, `ExitPlanMode`, `AskUserQuestion`

**Advanced Tools:**
`Computer`, `ToolSearch`, `TeammateTool`

**MCP Tools Pattern:**
`mcp__<server>__<tool>` (e.g., `mcp__memory__create_entities`)

---

## Hook Output Handling by Event

| Event | stdout | stderr |
|-------|--------|--------|
| PreToolUse/PostToolUse/Stop/SubagentStop | Shown in verbose mode, JSON parsed for control | Shown in verbose mode |
| Notification/SessionEnd | Logged to debug only (`--debug`) | Logged to debug only |
| UserPromptSubmit/SessionStart/Setup | **Added to Claude's context** | Shown to user in verbose mode |

---

## Best Practices

### 1. Blocking Behavior for Enforcement

Use exit code 2 (blocking) for linting, code quality, or static analysis hooks so Claude receives feedback and can fix errors.

### 2. Notification Hooks

Notification-only hooks should exit 0 (no blocking) since they don't require Claude to take action.

### 3. JSON Parsing

Never parse JSON in shell scripts using grep/sed/cut/awk — always use `jq`:

```bash
# Correct
VALUE=$(jq -r '.field' hook-input.json)
```

### 4. Environment Persistence

Use `CLAUDE_ENV_FILE` in SessionStart/Setup hooks to persist variables:

```bash
echo 'export VAR=value' >> "$CLAUDE_ENV_FILE"
```

### 5. Timeout Configuration

Default is 60 seconds per hook. Configure per-hook with `"timeout"` field (in seconds).

### 6. Agent Teams Best Practices

#### Trust the Team Lead's Built-In Behavior

The team lead already has detailed system prompts that teach it how to use `TeamCreate`, `SendMessage`, `TaskUpdate`, task dependencies, shutdown protocols, and all other coordination tools. **Do not re-teach these mechanics in your spawn prompts, agent files, or CLAUDE.md.** Over-specifying coordination instructions is counterproductive for two reasons:

1. **It wastes context.** Every redundant instruction ("use SendMessage to communicate") consumes tokens in the team lead's context window — space better used for actual task reasoning.
2. **It conflicts with built-in behavior.** The system prompts are tested and maintained by Anthropic. Custom instructions that paraphrase or subtly contradict them create ambiguity that degrades coordination quality.

**Start with zero coordination instructions.** Let the team lead manage teammates, assign tasks, and handle communication using its built-in behavior. Only add explicit instructions when you observe a specific failure — and then add the minimum correction needed.

| Approach | When to use |
|----------|-------------|
| No coordination instructions (default) | First attempt at any team workflow |
| Minimal correction in spawn prompt | Team lead repeatedly makes the same mistake (e.g., not shutting down teammates) |
| Explicit protocol in agent file | A specific agent type consistently misuses a tool across multiple sessions |

**Examples of instructions you should NOT add** (because the system prompt already covers them):

- "Use `SendMessage` for all inter-teammate communication" — already in the system prompt
- "Use `TaskUpdate` to mark tasks completed" — already in the system prompt
- "Shut down teammates before calling `TeamDelete`" — already enforced (TeamDelete fails with active members)
- "Refer to teammates by name, not agent ID" — already in the system prompt

**Examples of instructions worth adding** (because they reflect project-specific decisions the system prompt cannot know):

- "Spawn the `implementer` agent with `mode: plan` for tasks touching the auth module"
- "Use Sonnet for all teammates to manage token cost"
- "Assign test-specialist and implementer to separate file trees to avoid edit conflicts"

#### General Guidelines

- For trivial tasks, use Sonnet for teammates to reduce token cost
- Always refer to teammates by **name**, not agent ID
- Spawn only the teammates needed for genuine parallel work
- Default to `message` over `broadcast` — broadcasts scale linearly with team size

---

## Claude Code System Prompts Reference

Comprehensive catalog of all 110+ system prompts used by Claude Code v2.1.19+. Maintained by Piebald AI and updated within minutes of each Claude Code release.

**Contains:**
- Main system prompt and ~40 system reminders
- 18+ tool descriptions (Bash, Write, Edit, Read, WebFetch, WebSearch, etc.)
- Specialized agent prompts (Explore, Plan, Task execution)
- Creation assistants (Agent architect, CLAUDE.md generator, status line setup)
- Slash command implementations (/security-review, /review-pr, /pr-comments)

**Repository:** [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)

---

## Sources

- [Claude Code Hooks Reference](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Claude Code Settings Documentation](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Claude Code Agent Teams](https://docs.anthropic.com/en/docs/claude-code/agent-teams)
- [Claude Code Subagents](https://docs.anthropic.com/en/docs/claude-code/sub-agents)
- [Claude Code System Prompts Repository](https://github.com/Piebald-AI/claude-code-system-prompts)
