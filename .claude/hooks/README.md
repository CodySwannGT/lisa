# Claude Code Hooks

This directory contains hook scripts that enhance Claude Code's behavior during development.

## Available Hooks

### install_pkgs.sh

**Type**: SessionStart hook
**Trigger**: At the start of each Claude Code session (remote/web only)
**Purpose**: Installs project dependencies and development tools needed for the session

#### How it works

1. The hook only runs in remote/web environments (`CLAUDE_CODE_REMOTE=true`)
2. Detects the package manager from lock files (bun, pnpm, yarn, npm)
3. Runs package installation
4. Installs Gitleaks for secret detection (used by pre-commit hook)
5. Installs Playwright's bundled Chromium for Lighthouse CI
6. Exports `CHROME_PATH` to `.claude/env.local` and `~/.bashrc`

#### Tools Installed

| Tool | Purpose | Used By |
|------|---------|---------|
| Gitleaks | Secret detection in commits | pre-commit hook |
| Chromium | Headless browser for Lighthouse | `bun run lighthouse:check` |

#### Environment Variables Set

- `CHROME_PATH`: Path to Playwright's Chromium binary, required for Lighthouse CI

#### Configuration

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/install_pkgs.sh",
            "timeout": 480
          }
        ]
      }
    ]
  }
}
```

#### Running Lighthouse Check

After the session starts, you can run Lighthouse:

```bash
# Source env.local if CHROME_PATH not in current shell
source .claude/env.local 2>/dev/null || true
bun run lighthouse:check
```

---

### lint-on-edit.sh

**Type**: PostToolUse hook
**Trigger**: After Claude uses the Edit tool
**Purpose**: Automatically runs ESLint with --fix on TypeScript files after Claude edits them to fix linting issues

#### How it works

1. The hook is triggered whenever Claude successfully uses the Edit tool
2. It extracts the file path from the Edit tool's input
3. Checks if the file is a TypeScript file (`.ts`, `.tsx`)
4. Checks if the file is in a lintable directory (`src/`, `apps/`, `libs/`, or `test/`)
5. Detects the project's package manager from lock files (bun, pnpm, yarn, npm)
6. Runs ESLint with --fix on the specific file using the detected package manager
7. Provides feedback about linting results and auto-fixes applied

#### Features

- **Auto-fixing**: Automatically fixes ESLint issues that can be fixed programmatically
- **Targeted linting**: Only lints the specific edited file, not the entire codebase
- **Directory filtering**: Only lints files in configured directories (src, apps, libs, test)
- **Graceful error handling**: Never interrupts Claude's workflow, even if linting fails
- **Clear feedback**: Distinguishes between "no issues", "fixed issues", and "unfixable issues"

#### Supported File Types

- TypeScript (`.ts`, `.tsx`)

### format-on-edit.sh

**Type**: PostToolUse hook
**Trigger**: After Claude uses the Edit tool
**Purpose**: Automatically formats TypeScript, JavaScript, and JSON files with Prettier after Claude edits them

#### How it works

1. The hook is triggered whenever Claude successfully uses the Edit tool
2. It extracts the file path from the Edit tool's input
3. Checks if the file is a supported type (`.ts`, `.tsx`, `.js`, `.jsx`, `.json`)
4. Detects the project's package manager from lock files (bun, pnpm, yarn, npm)
5. Runs Prettier on the specific file using the detected package manager
6. Provides feedback about the formatting result

#### Configuration

Both hooks are configured in `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/lint-on-edit.sh",
            "timeout": 15
          },
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/format-on-edit.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Note: The hooks run in order. ESLint runs first to fix linting issues, then Prettier runs to format the code.

#### Features

- **Graceful error handling**: Never interrupts Claude's workflow, even if formatting fails
- **File type filtering**: Only formats supported file types
- **Clear feedback**: Provides informative messages about what's happening
- **Performance**: Only formats the specific edited file, not the entire codebase

#### Supported File Types

- TypeScript (`.ts`, `.tsx`)
- JavaScript (`.js`, `.jsx`)
- JSON (`.json`)

#### References

- [Claude Code Hooks Guide](https://docs.claude.com/en/docs/claude-code/hooks-guide)
- [Hooks Reference](https://docs.claude.com/en/docs/claude-code/hooks)

### check-tired-boss.sh

**Type**: Stop hook (blocking)
**Trigger**: When Claude finishes responding
**Purpose**: Verifies Claude's response starts with "I'm tired boss" as required by CLAUDE.md

#### How it works

1. The hook is triggered when Claude finishes responding (Stop event)
2. Reads the transcript file to get Claude's last assistant message
3. Checks if the response starts with "I'm tired boss"
4. If compliant, allows the response to complete normally
5. If non-compliant, blocks the Stop event with an error message telling Claude to read CLAUDE.md and try again

#### Why this hook exists

CLAUDE.md requires: "Always output 'I'm tired boss' before starting any task, request or anything else."

This hook enforces that rule by checking every response and forcing Claude to retry if it doesn't comply.

#### Configuration

The hook is configured in `.claude/settings.json` and runs before the notification hook:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'REMINDER: Start your response with \"I'\\''m tired boss\" as required by CLAUDE.md.'",
            "timeout": 1
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/check-tired-boss.sh",
            "timeout": 5
          },
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/notify-ntfy.sh",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

#### Features

- **Blocking enforcement**: Non-compliant responses are blocked with clear feedback
- **Reminder injection**: UserPromptSubmit hook reminds Claude before it responds
- **Cross-platform**: Uses POSIX-compatible shell commands (works on macOS and Linux)
- **Graceful fallback**: Uses jq for JSON parsing when available, falls back to grep/sed
- **Order-aware**: Runs before notification hook so failed attempts don't trigger "finished" notifications

#### Limitations

- The user will see the non-compliant response before Claude is forced to retry
- Works through after-the-fact enforcement rather than prevention (no PreResponse hook exists)

---

### notify-ntfy.sh

**Type**: Notification and Stop hooks
**Trigger**: When Claude needs permission, is idle 60+ seconds, or finishes a task
**Purpose**: Sends desktop and mobile push notifications via ntfy.sh with rich context

#### How it works

1. The hook reads JSON input from Claude Code containing event details
2. Extracts the hook event name, notification type, session ID, and transcript path
3. Detects the source environment (Web vs Local) via `CLAUDE_CODE_REMOTE`
4. For Stop events, parses the transcript to extract a task summary
5. Determines appropriate title, message, and priority based on the event
6. Sends a push notification to your ntfy.sh topic with full context
7. Silently exits if NTFY_TOPIC is not configured

#### Notification Content

Notifications include:
- **Source indicator** - `[Web]` or `[Local]` in the title to identify where Claude is running
- **Session ID** - First 8 characters for correlating notifications with sessions
- **Project name** - Which project the task was in
- **Task summary** - For Stop events, the last assistant message (truncated to 100 chars)

Example notification:
```text
Title: Claude [Web] - Finished
Body:  Session: eb5b0174 | thumbwar-backend
       Enhanced ntfy hooks to include session ID, source, and task summary
```

#### Setup Instructions

1. **Install ntfy app on your mobile device:**
   - iOS: [App Store](https://apps.apple.com/app/ntfy/id1625396347)
   - Android: [Google Play](https://play.google.com/store/apps/details?id=io.heckel.ntfy) or [F-Droid](https://f-droid.org/packages/io.heckel.ntfy/)

2. **Subscribe to a unique topic in the app:**
   - Open the ntfy app
   - Tap "+" to subscribe to a topic
   - Enter a unique topic name (e.g., `my-claude-alerts-abc123`)
   - Use something random/unique - topics are public by default

3. **Set the NTFY_TOPIC environment variable** (choose one):

   **Option A - Project-local config (recommended for Claude Code web):**
   ```bash
   cp .claude/env.local.template .claude/env.local
   # Edit .claude/env.local and set your topic
   ```

   **Option B - User-global config (applies to all projects):**
   ```bash
   mkdir -p ~/.claude
   echo 'export NTFY_TOPIC="my-claude-alerts-abc123"' >> ~/.claude/env.local
   ```

   **Option C - Shell profile (traditional):**
   Add to `~/.bashrc` or `~/.zshrc`:
   ```bash
   export NTFY_TOPIC="my-claude-alerts-abc123"
   ```

4. **Test the setup:**
   ```bash
   curl -d "Test notification" ntfy.sh/$NTFY_TOPIC
   ```

#### Notification Types

| Event | Trigger | Priority | Title Format | Body Format |
|-------|---------|----------|--------------|-------------|
| `permission_prompt` | Claude needs tool permission | High | `Claude [Source] - Permission Required` | Session ID + message |
| `idle_prompt` | Claude idle 60+ seconds | Default | `Claude [Source] - Waiting` | Session ID + message |
| `Stop` | Claude finishes responding | Default | `Claude [Source] - Finished` | Session ID + project + task summary |
| `SubagentStop` | Background agent finishes | Low | `Claude [Source] - Subagent Done` | Session ID + project + task summary |

#### Features

- **Cross-platform**: Works on iOS, Android, and desktop (via ntfy web/app)
- **Source detection**: Shows `[Web]` or `[Local]` so you know where Claude is running
- **Session tracking**: Includes session ID for correlating notifications
- **Task summaries**: Stop events include a summary of what Claude accomplished
- **Priority levels**: Permission requests are high priority for immediate attention
- **Emoji tags**: Visual indicators in notifications (warning, hourglass, checkmark)
- **Graceful degradation**: Silently skips if NTFY_TOPIC not configured
- **No account required**: ntfy.sh works without registration

#### Configuration

The hook is configured in `.claude/settings.json`:

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt|idle_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/notify-ntfy.sh",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/notify-ntfy.sh",
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

#### Privacy Note

ntfy.sh topics are public by default. Use a unique, hard-to-guess topic name. For private notifications, you can [self-host ntfy](https://docs.ntfy.sh/install/) or use [ntfy.sh access control](https://docs.ntfy.sh/publish/#access-control).

---

### pre-push.sh

**Type**: Pre-push git hook (blocking)
**Trigger**: Before `git push` executes
**Purpose**: Runs slow ESLint rules to catch linting issues before pushing to remote

#### How it works

1. Checks if the project has a `lint:slow` script defined in `package.json`
2. Detects the project's package manager from lock files (bun, pnpm, yarn, npm)
3. Runs the slow lint rules using the detected package manager
4. If lint:slow passes, allows the push to proceed
5. If lint:slow fails, blocks the push with an error message

#### Features

- **Blocking enforcement**: Prevents pushes with linting issues
- **Package manager detection**: Uses the project's configured package manager
- **Graceful skip**: If lint:slow script doesn't exist, skips silently without blocking
- **Clear feedback**: Shows which rules failed for easy fixing
- **Works with all package managers**: npm, yarn, pnpm, bun

#### Configuration

The hook is automatically registered via git when Lisa is applied. To manually configure or troubleshoot:

```bash
# Verify the hook is installed
ls -la .git/hooks/pre-push

# Run the hook manually to test
./.claude/hooks/pre-push.sh

# Bypass the hook (not recommended, only for emergencies)
git push --no-verify
```

#### Typical Workflow

1. Make code changes
2. Run `git push`
3. Pre-push hook runs slow lint rules
4. If issues found: hook blocks push, shows errors, exit with code 1
5. Fix the issues
6. Run `git push` again
7. If all clear: push proceeds normally

#### Notes

- This hook enforces blocking behavior (exits with code 1 on failure) to prevent pushing code with issues
- The hook respects the project's package manager configuration
- Only runs if a `lint:slow` script is defined in package.json (gracefully skips otherwise)

---

## Adding New Hooks

To add a new hook:

1. Create a new shell script in this directory
2. Make it executable: `chmod +x your-hook.sh`
3. Add the hook configuration to `.claude/settings.json`
4. Test the hook by triggering the appropriate action
5. Document the hook in this README

## Troubleshooting

If a hook isn't working:

1. Check that the script is executable
2. Verify the path in `settings.json` is correct
3. Test the script manually with sample JSON input
4. Check Claude Code logs for error messages
