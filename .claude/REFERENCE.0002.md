# Claude Code Settings & Hooks Reference (Updated 2026-01-29)

Complete expert reference for Claude Code hooks and `.claude/settings.json` configuration with detailed key descriptions.

---

## Summary of Updates from Previous Version

This updated reference includes:
- **Expanded settings.json key descriptions** with use cases and examples
- **New settings** added since the original document
- **Clarified deprecations** (e.g., `includeCoAuthoredBy` in favor of `attribution`)
- **Enhanced hook event documentation** with all event types and their purposes
- **Added prompt-based hooks** support (currently for Stop/SubagentStop, expanding support)
- **MCP tool integration** patterns for hooks
- **Updated hook output schemas** with structured JSON control
- **Sandbox configuration** details
- **Plugin hooks** documentation

---

## Hook Event Types (13 total)

| Event | Trigger | Matcher Support | Purpose |
|-------|---------|-----------------|---------|
| `SessionStart` | Session begins/resumes | `startup`, `resume`, `clear`, `compact` | Load context, set environment variables |
| `SessionEnd` | Session terminates | `clear`, `logout`, `prompt_input_exit`, `other` | Cleanup tasks, logging, session state |
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

---

## Complete settings.json Schema with Descriptions

```json
{
  "permissions": { /* Permission rules for tools */ },
  "env": { /* Environment variables */ },
  "hooks": { /* Hook configuration */ },
  "attribution": { /* Git attribution settings */ },
  "model": "string",
  "statusLine": { /* Status line config */ },
  "fileSuggestion": { /* File suggestion config */ },
  "outputStyle": "string",
  "language": "string",
  "spinnerTipsEnabled": true,
  "terminalProgressBarEnabled": true,
  "showTurnDuration": true,
  "alwaysThinkingEnabled": false,
  "disableAllHooks": false,
  "allowManagedHooksOnly": false,
  "respectGitignore": true,
  "includeCoAuthoredBy": false,
  "cleanupPeriodDays": 30,
  "autoUpdatesChannel": "stable | latest",
  "forceLoginMethod": "claudeai | console",
  "forceLoginOrgUUID": "string",
  "apiKeyHelper": "string",
  "otelHeadersHelper": "string",
  "awsAuthRefresh": "string",
  "awsCredentialExport": "string",
  "plansDirectory": "string",
  "enableAllProjectMcpServers": false,
  "enabledMcpjsonServers": [],
  "disabledMcpjsonServers": [],
  "allowedMcpServers": [],
  "deniedMcpServers": [],
  "enabledPlugins": {},
  "extraKnownMarketplaces": {},
  "strictKnownMarketplaces": [],
  "companyAnnouncements": [],
  "sandbox": { /* Sandbox configuration */ }
}
```

---

## Detailed settings.json Key Reference

### Core Settings

| Key | Type | Default | Description | Example |
|-----|------|---------|-------------|---------|
| **model** | `string` | Current default | Override the default Claude model for this project | `"claude-opus-4-5-20251101"` |
| **language** | `string` | System default | Preferred response language (user-facing output) | `"spanish"`, `"french"`, `"japanese"` |
| **outputStyle** | `string` | Default | Adjust system prompt output style for responses | `"Explanatory"`, `"Concise"` |

### Display & UX Settings

| Key | Type | Default | Description | Example |
|-----|------|---------|-------------|---------|
| **spinnerTipsEnabled** | `boolean` | `true` | Show rotating tips during spinner/loading screens | `false` |
| **terminalProgressBarEnabled** | `boolean` | `true` | Display terminal progress bars for long operations | `false` |
| **showTurnDuration** | `boolean` | `true` | Show "Turn took X seconds" messages after responses | `false` |
| **statusLine** | `object` | None | Custom status line script showing session info | `{"type": "command", "command": "~/.claude/statusline.sh"}` |
| **fileSuggestion** | `object` | Default | Custom script for `@` file autocomplete suggestions | `{"type": "command", "command": "~/.claude/file-suggest.sh"}` |

### Thinking & Model Settings

| Key | Type | Default | Description | Example |
|-----|------|---------|-------------|---------|
| **alwaysThinkingEnabled** | `boolean` | `false` | Enable extended thinking by default (uses more tokens) | `true` |
| **autoUpdatesChannel** | `string` | `"latest"` | Update channel: `"stable"` (1 week old, tested) or `"latest"` (immediate) | `"stable"` |

### File & Git Settings

| Key | Type | Default | Description | Example |
|-----|------|---------|-------------|---------|
| **respectGitignore** | `boolean` | `true` | File picker respects `.gitignore` patterns when suggesting files | `false` |
| **attribution** | `object` | Default | Git commit and PR attribution strings (replaces deprecated `includeCoAuthoredBy`) | See [Attribution Settings](#attribution-settings) |
| **includeCoAuthoredBy** | `boolean` | `true` | **DEPRECATED**: Use `attribution.commit` instead | N/A |
| **plansDirectory** | `string` | `~/.claude/plans` | Custom directory for plan files (relative to project root) | `"./plans"`, `"./specs"` |

### Session & Context Settings

| Key | Type | Default | Description | Example |
|-----|------|---------|-------------|---------|
| **cleanupPeriodDays** | `number` | `30` | Delete inactive sessions after N days (0 = immediate deletion) | `20`, `0` |
| **companyAnnouncements** | `string[]` | `[]` | Announcements displayed at session startup (random selection) | `["Welcome to Acme!"]` |
| **env** | `object` | `{}` | Environment variables applied to every bash command in this project | `{"NODE_ENV": "development", "DEBUG": "1"}` |

### Authentication & Security

| Key | Type | Default | Description | Example |
|-----|------|---------|-------------|---------|
| **forceLoginMethod** | `string` | Auto-detect | Restrict login method: `"claudeai"` (browser) or `"console"` (CLI) | `"claudeai"` |
| **forceLoginOrgUUID** | `string` | None | Organization UUID to auto-select during login (prevents selection dialog) | `"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"` |
| **apiKeyHelper** | `string` | None | Custom script that outputs API key or Bearer token for requests | `/bin/generate_temp_api_key.sh` outputs: `sk-...` |
| **otelHeadersHelper** | `string` | None | Custom script generating dynamic OpenTelemetry headers (JSON) | `/bin/otel_headers.sh` outputs: `{"x-trace-id": "..."}` |
| **awsAuthRefresh** | `string` | None | Custom script to refresh AWS credentials (runs before AWS operations) | `aws sso login --profile myprofile` |
| **awsCredentialExport** | `string` | None | Custom script outputting AWS credentials as JSON for Claude operations | `/bin/aws_creds.sh` outputs: `{"AccessKeyId": "...", ...}` |

### Hook Settings

| Key | Type | Default | Description | Example |
|-----|------|---------|-------------|---------|
| **hooks** | `object` | `{}` | Hook configuration by event type and matcher | See [Hook Configuration Structure](#hook-configuration-structure) |
| **disableAllHooks** | `boolean` | `false` | Disable all user/project hooks globally (managed hooks still apply) | `true` |
| **allowManagedHooksOnly** | `boolean` | `false` | **Managed only**: Only allow managed and SDK hooks, reject user/project hooks | `true` |

### Permission Settings

| Key | Type | Default | Description | Example |
|-----|------|---------|-------------|---------|
| **permissions** | `object` | Default | Permission rules for tools (allow/deny/ask) | See [Permission Settings](#permission-settings) |

### MCP & Plugin Settings

| Key | Type | Default | Description | Example |
|-----|------|---------|-------------|---------|
| **enableAllProjectMcpServers** | `boolean` | `false` | Auto-approve all MCP servers defined in project `.mcp.json` | `true` |
| **enabledMcpjsonServers** | `string[]` | `[]` | Allowlist of specific MCP servers to enable | `["memory", "github"]` |
| **disabledMcpjsonServers** | `string[]` | `[]` | Denylist of specific MCP servers to disable | `["filesystem"]` |
| **allowedMcpServers** | `object[]` | `[]` | **Managed only**: Allowlist of MCP servers users can configure | `[{"serverName": "github"}]` |
| **deniedMcpServers** | `object[]` | `[]` | **Managed only**: Denylist of MCP servers (takes precedence over allowlist) | `[{"serverName": "dangerous-server"}]` |
| **enabledPlugins** | `object` | `{}` | Enable/disable plugins: `"name@marketplace": boolean` | `{"formatter@acme-tools": true, "linter@dev": false}` |
| **extraKnownMarketplaces** | `object` | `{}` | Additional plugin marketplace sources beyond default | See [Plugin Marketplaces](#plugin-marketplaces) |
| **strictKnownMarketplaces** | `object[]` | `[]` | **Managed only**: Allowlist of plugin marketplaces | `[{"name": "official", "url": "..."}]` |

### Sandbox Settings

| Key | Type | Default | Description | Example |
|-----|------|---------|-------------|---------|
| **sandbox** | `object` | See below | Advanced sandboxing behavior for Bash commands | See [Sandbox Settings](#sandbox-settings) |

---

## Permission Settings

Control which tools Claude can use automatically (allow), with confirmation (ask), or never (deny).

```json
{
  "permissions": {
    "allow": ["string[]"],
    "ask": ["string[]"],
    "deny": ["string[]"],
    "additionalDirectories": ["string[]"],
    "defaultMode": "default | acceptEdits | plan | bypassPermissions | dontAsk",
    "disableBypassPermissionsMode": "disable | warn"
  }
}
```

### Permission Rule Examples

```json
{
  "permissions": {
    "allow": [
      "Bash(npm run:*)",
      "Bash(npm test)",
      "Read(~/.zshrc)",
      "Read(./docs/**)"
    ],
    "deny": [
      "Bash",
      "Bash(curl *)",
      "Bash(rm -rf *)",
      "Read(./.env)",
      "Read(./.env.*)",
      "Read(./secrets/**)",
      "WebFetch",
      "WebSearch"
    ],
    "ask": [
      "Bash(git push:*)",
      "Edit(package.json)"
    ],
    "additionalDirectories": [
      "../docs/",
      "/shared/libraries/"
    ],
    "defaultMode": "acceptEdits",
    "disableBypassPermissionsMode": "disable"
  }
}
```

### Permission Evaluation Order

1. **Deny rules** (highest priority) - block immediately
2. **Ask rules** - show confirmation dialog
3. **Allow rules** (lowest priority) - auto-approve

First matching rule wins.

### Permission Wildcard Patterns

| Pattern | Matches | Example |
|---------|---------|---------|
| `:*` | Prefix + word boundary | `Bash(npm run:*)` matches `npm run lint` but NOT `npm runtest` |
| `*` | Glob anywhere | `Bash(ls*)` matches `ls`, `lsof`, `ls -la` |
| `**` | Recursive glob | `Read(./secrets/**)` matches all files under ./secrets/ |
| (exact) | Exact match | `Bash(npm test)` matches ONLY `npm test` |

---

## Attribution Settings

Configure how Claude Code is attributed in git commits and pull requests.

```json
{
  "attribution": {
    "commit": "Generated with Claude Code\n\nCo-Authored-By: Claude <claude@anthropic.com>",
    "pr": "Generated with Claude Code"
  }
}
```

- **commit**: Git commit message attribution (empty string hides attribution)
- **pr**: Pull request body attribution (empty string hides attribution)
- **includeCoAuthoredBy**: **DEPRECATED** — use `attribution.commit` instead

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
            "prompt": "Your evaluation prompt with $ARGUMENTS",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Hook Types

| Type | Description | Use Case | Availability |
|------|-------------|----------|--------------|
| `command` | Executes bash command synchronously | Deterministic validation, formatting, linting | All events |
| `prompt` | Sends JSON to LLM (Haiku) for context-aware decision | Complex decision logic, intelligent gating | Stop, SubagentStop, UserPromptSubmit, PreToolUse, PermissionRequest |

---

## Sandbox Settings

Control sandboxing behavior for Bash commands (macOS, Linux, WSL2 only).

```json
{
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
  }
}
```

| Key | Type | Description |
|-----|------|-------------|
| **enabled** | `boolean` | Enable sandboxing (default: true on supported OS) |
| **autoAllowBashIfSandboxed** | `boolean` | Auto-approve Bash when sandboxed (safe isolation) |
| **excludedCommands** | `string[]` | Commands running outside sandbox (git, docker, etc.) |
| **allowUnsandboxedCommands** | `boolean` | Allow `dangerouslyDisableSandbox` parameter in Bash tool |
| **network.allowUnixSockets** | `string[]` | Unix socket paths accessible inside sandbox |
| **network.allowLocalBinding** | `boolean` | Allow localhost binding (macOS only) |
| **network.httpProxyPort** | `number` | HTTP proxy port for sandboxed commands |
| **network.socksProxyPort** | `number` | SOCKS5 proxy port for sandboxed commands |
| **enableWeakerNestedSandbox** | `boolean` | Weaker sandbox for unprivileged Docker containers |

---

## Environment Variables Available to Hooks

| Variable | Description | Availability | Example |
|----------|-------------|--------------|---------|
| `CLAUDE_PROJECT_DIR` | Absolute path to project root | All hooks | `/Users/me/myproject` |
| `CLAUDE_CODE_REMOTE` | `"true"` if web environment | All hooks | `"true"` or empty/unset |
| `CLAUDE_ENV_FILE` | File path to persist env vars | SessionStart, Setup | `/tmp/claude-env-abc123` |
| `CLAUDE_PLUGIN_ROOT` | Plugin directory path | Plugin hooks only | `/Users/me/.claude/plugins/my-plugin` |
| `SESSION_ID` | Unique session identifier | All hooks | `abc123def456` |

---

## Exit Code Behavior

| Exit Code | Behavior |
|-----------|----------|
| **0** | Success — stdout processed for JSON or added as context |
| **2** | Blocking error — prevents action, stderr shown to Claude |
| **Other** | Non-blocking error — stderr shown in verbose mode only |

---

## Hook-Specific Output Schemas

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

### SessionStart/Setup/UserPromptSubmit Output

```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart | Setup",
    "additionalContext": "Context to inject"
  }
}
```

---

## Settings File Locations & Precedence

| Scope | Location | Shared | Precedence |
|-------|----------|--------|-----------|
| **Managed** | System-level `managed-settings.json` | Yes (IT deployed) | Highest (cannot override) |
| **Local** | `.claude/settings.local.json` | No (gitignored) | Normal |
| **Project** | `.claude/settings.json` | Yes (in git) | Normal |
| **User** | `~/.claude/settings.json` | No | Lowest |

### Managed Settings Locations

| OS | Path |
|----|------|
| macOS | `<SYSTEM_CONFIG>/ClaudeCode/managed-settings.json` |
| Linux/WSL | `<SYSTEM_CONFIG>/claude-code/managed-settings.json` |
| Windows | `<SYSTEM_CONFIG>\ClaudeCode\managed-settings.json` |

---

## Common Tool Names for Matchers

### Core Tools
`Bash`, `Write`, `Edit`, `Read`, `Glob`, `Grep`, `WebFetch`, `WebSearch`, `LSP`

### Notebook Tools
`Notebook`, `NotebookEdit`

### Agent & Task Tools
`Task`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TaskOutput`, `TaskStop`

### Skill & Planning Tools
`Skill`, `EnterPlanMode`, `ExitPlanMode`, `AskUserQuestion`

### MCP Tools Pattern
`mcp__<server>__<tool>` (e.g., `mcp__memory__create_entities`, `mcp__filesystem__read_file`)

---

## Matcher Pattern Examples

| Pattern | Matches | Example |
|---------|---------|---------|
| `Write` | Exact match | Write tool only |
| `Edit\|Write` | Either tool (regex OR) | Edit or Write |
| `npm run:*` | Prefix + word boundary | `npm run lint`, `npm run test` (NOT `npm runtest`) |
| `ls*` | Glob anywhere | `ls -la`, `lsof` |
| `Notebook.*` | Regex pattern | All Notebook tools |
| `mcp__.*__read` | MCP tools matching pattern | All MCP read operations |
| `""` or omitted | All tools | Match every tool |

---

## Best Practices

### 1. Blocking Behavior for Enforcement

When creating hooks for linting, code quality, or static analysis:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          {
            "type": "command",
            "command": "npm run lint -- $FILE",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

Use exit code 2 (blocking) so Claude receives feedback and can fix errors.

### 2. Notification Hooks

Notification-only hooks should exit 0 (no blocking):

```bash
#!/bin/bash
curl -X POST https://ntfy.sh/mychannel -d "Build passed"
exit 0  # Non-blocking
```

### 3. JSON Parsing

**Never** parse JSON in shell scripts using grep/sed/cut/awk:

```bash
# Wrong
VALUE=$(cat hook-input.json | grep "field" | sed 's/.*: "//' | sed 's/".*//')

# Correct
VALUE=$(jq -r '.field' hook-input.json)
```

### 4. Environment Persistence

Use `CLAUDE_ENV_FILE` in SessionStart/Setup hooks to persist variables across bash commands:

```bash
#!/bin/bash
if [ -n "$CLAUDE_ENV_FILE" ]; then
  echo 'export PATH="$PATH:./node_modules/.bin"' >> "$CLAUDE_ENV_FILE"
  echo 'export NODE_ENV=production' >> "$CLAUDE_ENV_FILE"
fi
exit 0
```

### 5. Timeout Configuration

Default is 60 seconds per hook. Configure per-hook with `timeout` field (in seconds):

```json
{
  "type": "command",
  "command": "npm run typecheck",
  "timeout": 120
}
```

---

## Prompt-Based Hooks

Prompt-based hooks use an LLM to make intelligent, context-aware decisions.

### Configuration

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "prompt",
            "prompt": "Should Claude continue working? Check if all tasks are complete. $ARGUMENTS",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

### Response Schema

The LLM must respond with JSON:

```json
{
  "ok": true,
  "reason": "All tasks completed successfully"
}
```

or

```json
{
  "ok": false,
  "reason": "Tests are still failing, should continue"
}
```

### Supported Events

- **Stop**: Intelligently decide if Claude should continue
- **SubagentStop**: Evaluate if subagent completed its task
- **UserPromptSubmit**: Validate prompts with LLM assistance
- **PreToolUse**: Context-aware permission decisions
- **PermissionRequest**: Intelligent allow/deny decisions

---

## Sources

- [Claude Code Settings Documentation](https://code.claude.com/docs/en/settings)
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks)
- [Claude Code Hooks Guide](https://code.claude.com/docs/en/hooks-guide)

---

## Key Differences from Previous Version

| Topic | Previous | Updated |
|-------|----------|---------|
| Prompt-based hooks | Not documented | Now fully documented with examples |
| MCP tool matchers | Basic mention | Expanded with naming patterns and examples |
| Plugin hooks | Not covered | Now includes plugin hook patterns |
| Attribution | `includeCoAuthoredBy` only | New `attribution` object with commit/pr fields |
| Hook output schemas | Basic structure | Detailed per-event schemas with all fields |
| Sandbox settings | Mentioned | Now fully documented with all options |
| Environment variables | Limited | Expanded with CLAUDE_CODE_REMOTE, CLAUDE_PLUGIN_ROOT |
| Detailed key descriptions | Missing | Comprehensive table with use cases and examples |

