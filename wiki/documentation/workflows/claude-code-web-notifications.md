# Claude Code Web + Notifications Workflow

Lisa includes built-in support for push notifications via [ntfy.sh](https://ntfy.sh), enabling a powerful async workflow with Claude Code Web.

## Why This Matters

Claude Code Web allows you to offload tasks to the cloud, but without notifications you'd have to constantly check if it's done. With ntfy integration:

- Fire off a task and get back to other work
- Receive push notifications when Claude finishes or needs attention
- Review results and approve PRs from your phone
- Run multiple tasks in parallel across different projects

## Quick Start

### 1. Set Up ntfy

[ntfy.sh](https://ntfy.sh) is a simple pub-sub notification service.

1. **Download the app**
   - [iOS App Store](https://apps.apple.com/app/ntfy/id1625396347)
   - [Google Play Store](https://play.google.com/store/apps/details?id=io.heckel.ntfy)
   - Or use the [web app](https://ntfy.sh/app) / desktop clients

2. **Create a unique topic**
   - Open the app and subscribe to a topic
   - Use something unique like `claude-yourname-abc123`
   - Anyone who knows the topic name can send to it, so make it unguessable

3. **Set the environment variable**

   Add to your shell config (`~/.zshrc`, `~/.bashrc`, etc.):
   ```bash
   export NTFY_TOPIC="claude-yourname-abc123"
   ```

   Or create a local config file (gitignored):
   ```bash
   # Project-specific
   echo 'export NTFY_TOPIC="claude-yourname-abc123"' >> .claude/env.local

   # Or user-global
   echo 'export NTFY_TOPIC="claude-yourname-abc123"' >> ~/.claude/env.local
   ```

### 2. Configure Claude Code Web

1. Go to [claude.ai/code](https://claude.ai/code)
2. Add a new environment or select an existing one
3. Add your `NTFY_TOPIC` as an environment variable in the environment settings
4. Review the [network policy](https://code.claude.com/docs/en/claude-code-on-the-web#network-policy) for security considerations

**Mobile access:**
- Open the Claude app on your phone
- Tap the nav drawer (top left)
- Tap **Code**

## How It Works

Lisa's settings.json includes hooks that automatically send notifications:

| Event | Trigger | Priority |
|-------|---------|----------|
| Permission Required | Claude needs approval to continue | High |
| Waiting for Input | Claude is idle, waiting for you | Default |
| Task Finished | Claude completed its work | Default |
| Subagent Done | A background agent finished | Low |

The hooks are wired up in `.claude/settings.json`:
```json
{
  "hooks": {
    "Notification": [{
      "matcher": "permission_prompt|idle_prompt",
      "hooks": [{ "command": ".claude/hooks/notify-ntfy.sh" }]
    }],
    "Stop": [{
      "matcher": "",
      "hooks": [{ "command": ".claude/hooks/notify-ntfy.sh" }]
    }]
  }
}
```

If `NTFY_TOPIC` is not set, the hook exits silently with no effect.

## Usage Patterns

### Pattern 1: CLI Offload

From Claude Code CLI, prefix your command with `&` to offload it to the web:

```bash
& Implement the user authentication feature based on specs/auth.md
```

The task runs in Claude Code Web. You get a notification when it's done.

### Pattern 2: Direct from Phone

Open Claude Code in the mobile app and type your task directly:

```
Review the PR at https://github.com/org/repo/pull/123 and leave comments
```

### Pattern 3: Browser Session

Open [claude.ai/code](https://claude.ai/code) in any browser and start a session. Useful for:

- Creating specs or plans that you'll later pull into implementation
- Long-running research tasks
- Parallel workstreams across multiple projects

## When a Task Completes

1. You receive an ntfy notification with:
   - Source (Web or Local)
   - Project name
   - Session ID
   - Task summary (first 100 chars of Claude's last message)

2. Open the task in Claude Code Web

3. Click **Open PR** if Claude created changes

4. From GitHub:
   - Enable Auto Merge if your repo supports it
   - The GitHub mobile app is handy for quick approvals

## Notification Details

The notification includes context to help you triage:

```
Claude [Web] - Finished
Session: a1b2c3d4 | my-project
Implemented the user authentication feature with OAuth...
```

**Notification types:**
- `Claude [Web] - Permission Required` - High priority, needs action
- `Claude [Web] - Waiting` - Claude is idle
- `Claude [Web] - Finished` - Task complete
- `Claude [Local] - *` - Same events from local CLI

## Session Start Setup

Lisa also includes a `SessionStart` hook that runs when you start a Claude Code Web session:

```bash
.claude/hooks/install-pkgs.sh
```

This script:
- Detects when running in Claude Code Web (`CLAUDE_CODE_REMOTE=true`)
- Installs project dependencies using the correct package manager
- Installs additional tools (Gitleaks, Chromium for Lighthouse)

This ensures your remote environment is ready without manual setup.

## Troubleshooting

### Not receiving notifications

1. **Check NTFY_TOPIC is set:**
   ```bash
   echo $NTFY_TOPIC
   ```

2. **Test ntfy directly:**
   ```bash
   curl -d "Test message" "https://ntfy.sh/$NTFY_TOPIC"
   ```

3. **Check hook permissions:**
   ```bash
   chmod +x .claude/hooks/notify-ntfy.sh
   ```

4. **In Claude Code Web:** Ensure `NTFY_TOPIC` is set in the environment settings

### Notifications work locally but not from Web

The `NTFY_TOPIC` environment variable must be configured in your Claude Code Web environment settings, not just your local shell.

### curl not available

The ntfy hook requires `curl`. In Claude Code Web environments, this is available by default.

## Security Considerations

- **ntfy topics are public** - Anyone who knows your topic name can send notifications to it
- Use a long, random topic name (e.g., `claude-yourname-8f3a9b2c`)
- Don't include sensitive info in your topic name
- The hook only sends: project name, session ID prefix, and a truncated task summary
