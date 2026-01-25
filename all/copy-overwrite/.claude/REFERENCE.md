# Claude Code Hooks & Settings Reference

Complete expert reference for Claude Code hooks and `.claude/settings.json` configuration.

---

## Hook Event Types (12 total)

| Event | Trigger | Matcher Support |
|-------|---------|-----------------|
| `SessionStart` | Session begins/resumes | `startup`, `resume`, `clear`, `compact` |
| `SessionEnd` | Session terminates | `clear`, `logout`, `prompt_input_exit`, `other` |
| `Setup` | `--init`, `--init-only`, `--maintenance` flags | `init`, `maintenance` |
| `PreToolUse` | Before tool call processes | Tool names (regex supported) |
| `PostToolUse` | After tool succeeds | Tool names (regex supported) |
| `PostToolUseFailure` | After tool fails | Tool names (regex supported) |
| `PermissionRequest` | Permission dialog appears | Tool names |
| `SubagentStart` | Subagent spawns | N/A |
| `SubagentStop` | Subagent finishes | N/A |
| `Stop` | Main agent finishes (not interrupted) | N/A |
| `UserPromptSubmit` | User submits prompt | N/A |
| `Notification` | Notifications sent | `permission_prompt`, `idle_prompt`, `auth_success`, `elicitation_dialog` |
| `PreCompact` | Before context compaction | `manual`, `auto` |

---

## Complete settings.json Schema

```json
{
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

  "statusLine": { "type": "command", "command": "~/.claude/statusline.sh" },
  "outputStyle": "string",
  "language": "string",
  "spinnerTipsEnabled": true,
  "terminalProgressBarEnabled": true,
  "showTurnDuration": true,

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
  "additionalDirectories": [],

  "sandbox": {
    "enabled": true,
    "autoAllowBashIfSandboxed": true,
    "excludedCommands": ["git", "docker"],
    "allowUnsandboxedCommands": true,
    "network": {
      "allowUnixSockets": ["~/.ssh/agent-socket"],
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
          }
        ]
      }
    ]
  }
}
```

### Hook Types

| Type | Description |
|------|-------------|
| `command` | Executes bash command synchronously |
| `prompt` | Sends JSON input to LLM (Haiku) for decision |

**Prompt-based hooks** only support: `Stop`, `SubagentStop`, `UserPromptSubmit`, `PreToolUse`, `PermissionRequest`

Prompt hooks must return JSON: `{"ok": true|false, "reason": "explanation"}`

---

## Environment Variables Available to Hooks

| Variable | Description | Availability |
|----------|-------------|--------------|
| `CLAUDE_PROJECT_DIR` | Absolute path to project root | Always |
| `CLAUDE_CODE_REMOTE` | `"true"` if web environment | Always |
| `CLAUDE_ENV_FILE` | File path to persist env vars | SessionStart/Setup only |
| `CLAUDE_PLUGIN_ROOT` | Plugin directory path | Plugin hooks only |

---

## Exit Code Behavior

| Exit Code | Behavior |
|-----------|----------|
| **0** | Success - stdout processed for JSON or added as context |
| **2** | Blocking error - prevents action, stderr shown to Claude |
| **Other** | Non-blocking error - stderr shown in verbose mode |

---

## Blocking vs Non-Blocking Hooks

### Blocking Hooks (Exit Code 2)

| Event | Effect |
|-------|--------|
| `PreToolUse` | Blocks tool call, shows stderr to Claude |
| `PermissionRequest` | Denies permission, shows stderr to Claude |
| `PostToolUse` | Shows stderr to Claude (tool already ran) |
| `UserPromptSubmit` | Erases submitted prompt, shows stderr to user only |
| `Stop`/`SubagentStop` | Blocks stoppage, shows stderr to Claude |
| `Setup`/`SessionStart`/`SessionEnd`/`PreCompact`/`Notification` | Shows stderr to user only |

---

## Matcher Patterns

| Pattern | Matches |
|---------|---------|
| `Write` | Exact match only |
| `Edit\|Write` | Either tool (regex OR) |
| `npm run:*` | Prefix + word boundary (`npm run lint` yes, `npm runtest` no) |
| `ls*` | Glob anywhere (`ls -la`, `lsof`) |
| `Notebook.*` | Regex pattern (all Notebook tools) |
| `mcp__server__.*` | All MCP server tools |
| `""` or omit | All tools/events |

### Common Tool Names for Matching

`Bash`, `Write`, `Edit`, `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `Task`, `Notebook`, `NotebookEdit`

---

## Settings File Locations & Precedence

| Scope | Location | Shared | Precedence |
|-------|----------|--------|------------|
| Managed | System-level `managed-settings.json` | Yes (IT deployed) | Highest (cannot override) |
| User | `~/.claude/settings.json` | No | Normal |
| Project | `.claude/settings.json` | Yes (in git) | Normal |
| Local | `.claude/settings.local.json` | No (gitignored) | Normal |

### Managed Settings Locations

| OS | Path |
|----|------|
| macOS | `/Library/Application Support/ClaudeCode/` |
| Linux/WSL | `/etc/claude-code/` |
| Windows | `C:\Program Files\ClaudeCode\` |

---

## Hook Output Handling by Event

| Event | stdout | stderr |
|-------|--------|--------|
| PreToolUse/PostToolUse/Stop/SubagentStop | Shown in verbose mode, JSON parsed for control | Shown in verbose mode |
| Notification/SessionEnd | Logged to debug only (`--debug`) | Logged to debug only |
| UserPromptSubmit/SessionStart/Setup | **Added to Claude's context** | Shown to user in verbose mode |

---

## Hook Input Schema (Common Fields)

All hook inputs include:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.jsonl",
  "cwd": "/current/working/directory",
  "permission_mode": "default | plan | acceptEdits | dontAsk | bypassPermissions",
  "hook_event_name": "EventName"
}
```

### PreToolUse Input

```json
{
  "tool_name": "Bash | Write | Edit | Read | Glob | Grep | WebFetch | WebSearch | Task",
  "tool_input": {
    "command": "...",
    "description": "...",
    "timeout": 120000,
    "run_in_background": false
  },
  "tool_use_id": "toolu_01ABC123..."
}
```

### PostToolUse Input

```json
{
  "tool_name": "...",
  "tool_input": {},
  "tool_response": {},
  "tool_use_id": "toolu_01ABC123..."
}
```

### Notification Input

```json
{
  "message": "Claude needs your permission to use Bash",
  "notification_type": "permission_prompt | idle_prompt | auth_success | elicitation_dialog"
}
```

### UserPromptSubmit Input

```json
{
  "prompt": "User's prompt text"
}
```

### Stop Input

```json
{
  "stop_hook_active": false
}
```

### SubagentStop Input

```json
{
  "stop_hook_active": false,
  "agent_id": "def456",
  "agent_transcript_path": "/path/to/subagent/transcript.jsonl"
}
```

### SubagentStart Input

```json
{
  "agent_id": "agent-abc123",
  "agent_type": "Explore | Bash | Plan | CustomAgentName"
}
```

### SessionStart Input

```json
{
  "source": "startup | resume | clear | compact",
  "model": "claude-sonnet-4-20250514",
  "agent_type": "AgentName"
}
```

### SessionEnd Input

```json
{
  "reason": "exit | clear | logout | prompt_input_exit | other"
}
```

### Setup Input

```json
{
  "trigger": "init | maintenance"
}
```

### PreCompact Input

```json
{
  "trigger": "manual | auto",
  "custom_instructions": ""
}
```

---

## Hook-Specific Output Schemas

### PreToolUse Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow | deny | ask",
    "permissionDecisionReason": "Optional explanation",
    "updatedInput": {
      "field_name": "new_value"
    },
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

## Permission Evaluation Order

First match wins:

1. **Deny rules** (highest priority)
2. **Ask rules**
3. **Allow rules** (lowest priority)

---

## Wildcard Patterns in Permissions

| Pattern | Description |
|---------|-------------|
| `:*` | Prefix matching with word boundary |
| `*` | Glob matching anywhere |
| `**` | Recursive glob |

Examples:
- `Bash(npm run:*)` - matches "npm run lint" but NOT "npm runtest"
- `Bash(ls*)` - matches both "ls -la" and "lsof"
- `Read(./secrets/**)` - matches all files under ./secrets/

---

## Best Practices

1. **Blocking behavior for enforcement**: When creating hooks for linting, code quality, or static analysis, use blocking behavior (exit 2) so Claude receives feedback and can fix errors.

2. **Notification hooks**: Notification-only hooks should exit 0 since they don't require Claude to take action.

3. **JSON parsing**: Never parse JSON in shell scripts using grep/sed/cut/awk—always use `jq` for robust JSON handling.

4. **Environment persistence**: Use `CLAUDE_ENV_FILE` in SessionStart/Setup hooks to persist environment variables across subsequent bash commands:
   ```bash
   echo 'export VAR=value' >> "$CLAUDE_ENV_FILE"
   ```

5. **Timeout configuration**: Default is 60 seconds per hook. Configure per-hook with `"timeout"` field (in seconds).

---

---

## Claude Code System Prompts Reference

Comprehensive catalog of all 110+ system prompts used by Claude Code v2.1.19+. Maintained by Piebald AI and updated within minutes of each Claude Code release.

**What It Contains:**
- Main system prompt and ~40 system reminders
- 18+ tool descriptions (Bash, Write, Edit, Read, WebFetch, WebSearch, etc.)
- Specialized agent prompts (Explore, Plan, Task execution)
- Creation assistants (Agent architect, CLAUDE.md generator, status line setup)
- Slash command implementations (/security-review, /review-pr, /pr-comments)
- Utility functions (summarization, session management, security analysis)

**Why It's Useful:**
Understand exactly how Claude Code is instructed to operate across different scenarios. Reference for customization via tweakcc tool.

**Repository:** [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts)

---

## Sources

- [Claude Code Hooks Reference](https://docs.anthropic.com/en/docs/claude-code/hooks)
- [Claude Code Settings Documentation](https://docs.anthropic.com/en/docs/claude-code/settings)
- [Claude Code System Prompts Repository](https://github.com/Piebald-AI/claude-code-system-prompts)
