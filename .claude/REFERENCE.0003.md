# Claude Code Agent Teams, Hooks & Settings Reference (2026-02-08)

Complete expert reference for Claude Code Agent Teams, hooks, and `.claude/settings.json` configuration. Standalone document superseding REFERENCE.md and REFERENCE.0002.md.

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
| Model selection | Use Sonnet for teammates — balances capability and cost for coordination tasks |
| Spawn prompts | Keep focused — teammates load CLAUDE.md, MCP servers, and skills automatically; everything in spawn prompt adds to initial context |
| Broadcast cost | Scales linearly with team size (avoid unnecessary broadcasts) |
| Right-sizing | Spawn only the teammates you need for genuine parallel work |
| Cleanup | Active teammates continue consuming tokens even if idle — shut them down when done |
| Average cost | ~$6/developer/day standard; ~$100-200/developer/month with Sonnet 4.5 |

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

## Hook Event Types (15 total)

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
model: "sonnet"
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

- Use Sonnet for teammates to reduce token cost (~7x overhead per teammate)
- Always refer to teammates by **name**, not agent ID
- Use `SendMessage` for all inter-teammate communication — plain text is not visible
- Use `TaskUpdate` for task status rather than sending structured JSON messages
- Shut down teammates gracefully via `shutdown_request` before calling `TeamDelete`
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
