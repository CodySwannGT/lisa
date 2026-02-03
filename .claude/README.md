# Claude Code Configuration

This directory contains Claude Code configuration files that customize AI-assisted development workflows.

## Directory Structure

```
.claude/
├── settings.json              # Main Claude Code settings
├── settings.local.json        # Local overrides (gitignored)
├── settings.local.json.example # Template for local settings
├── agents/                    # Custom agent definitions
├── commands/                  # Slash command definitions
├── hooks/                     # Automation hooks
└── skills/                    # Skill definitions
```

## Settings

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `BASH_DEFAULT_TIMEOUT_MS` | 1800000 (30 min) | Default timeout for bash commands |
| `BASH_MAX_TIMEOUT_MS` | 7200000 (2 hours) | Maximum allowed timeout |

### Hooks

| Event | Hook | Purpose |
|-------|------|---------|
| `SessionStart` | `install_pkgs.sh` | Install dependencies when session starts |
| `PostToolUse` | `format-on-edit.sh` | Auto-format files after Write/Edit operations |
| `Notification` | `notify-ntfy.sh` | Send notifications via ntfy.sh |
| `Stop` | `notify-ntfy.sh` | Notify when session ends |

## Plugins

The `enabledPlugins` section in `settings.json` references Claude Code plugins. These extend Claude Code functionality with additional capabilities.

### Plugin Sources

| Source | Description | Registration |
|--------|-------------|--------------|
| `claude-plugins-official` | Official Anthropic plugins | Built-in, no registration needed |
| `cc-marketplace` | Community marketplace | Available at [Claude Code Marketplace](https://marketplace.claude.ai) |

### Enabled Plugins

| Plugin | Source | Purpose |
|--------|--------|---------|
| `typescript-lsp` | `claude-plugins-official` | TypeScript language server integration |
| `safety-net` | `cc-marketplace` | Backup and safety features |
| `code-simplifier` | `claude-plugins-official` | Code complexity reduction suggestions |
| `code-review` | `claude-plugins-official` | Automated code review capabilities |
| `playwright` | `claude-plugins-official` | Playwright test integration |

### Installing Plugins

1. **Official plugins** are available by default in Claude Code
2. **Marketplace plugins** can be installed via the Claude Code settings UI
3. **Third-party plugins** require following their installation instructions

### Plugin Availability

Not all plugins may be available in all Claude Code installations:

- Some plugins require specific Claude Code versions
- Marketplace plugins require marketplace access
- Enterprise installations may restrict available plugins

If a plugin is not available, Claude Code will ignore it gracefully.

## Local Settings Override

Create `settings.local.json` to override settings for your local environment:

```json
{
  "env": {
    "CUSTOM_API_KEY": "your-key-here"
  },
  "hooks": {
    "PostToolUse": []
  },
  "enabledPlugins": {
    "playwright": false
  }
}
```

This file should be:
- Added to `.gitignore`
- Never committed to version control
- Used for machine-specific settings

## Agents

Custom agent definitions in `agents/` provide specialized AI personas for different tasks:

| Agent | Purpose |
|-------|---------|
| `agent-architect.md` | System architecture design |
| `codebase-analyzer.md` | Codebase analysis and documentation |
| `codebase-locator.md` | Finding code locations |
| `codebase-pattern-finder.md` | Pattern recognition |
| `git-history-analyzer.md` | Git history analysis |
| `hooks-expert.md` | Claude Code hooks expertise |
| `skill-evaluator.md` | Skill quality assessment |
| `slash-command-architect.md` | Command design |
| `web-search-researcher.md` | Web research tasks |

## Commands

Slash commands in `commands/` provide quick actions:

- `git/` - Git-related commands
- `jira/` - Jira integration commands
- `plan/` - Plan utility commands (test coverage, linting, code review, complexity)
- `project/` - Project management commands (deprecated - use plan mode instead)
- `pull-request/` - PR workflow commands
- `rules/` - Rule management commands
- `sonarqube/` - Code quality commands

## Skills

Skills in `skills/` provide domain-specific knowledge:

| Skill | Purpose |
|-------|---------|
| `jsdoc-best-practices/` | JSDoc documentation standards |
| `skill-creator/` | Creating new skills |
| `plan-add-test-coverage/` | Increase test coverage via plan mode |
| `plan-fix-linter-error/` | Fix ESLint violations via plan mode |
| `plan-local-code-review/` | Review local branch changes |
| `plan-lower-code-complexity/` | Reduce cognitive complexity via plan mode |
| `plan-reduce-max-lines/` | Reduce max file lines via plan mode |
| `plan-reduce-max-lines-per-function/` | Reduce max function lines via plan mode |
| `project-*/` | Project workflow skills (deprecated - use plan mode) |

See each skill's `SKILL.md` for detailed documentation.

## Customization

### Adding Custom Skills

```bash
mkdir -p .claude/skills/my-skill
cat > .claude/skills/my-skill/SKILL.md << 'EOF'
# My Skill

## When to Use
- Situation 1
- Situation 2

## Instructions
Step-by-step guidance...
EOF
```

### Adding Custom Commands

```bash
mkdir -p .claude/commands/my-category
cat > .claude/commands/my-category/my-command.md << 'EOF'
---
name: my-command
description: What this command does
---

Instructions for the command...
EOF
```

### Adding Custom Agents

```bash
cat > .claude/agents/my-agent.md << 'EOF'
# My Agent

## Role
Specialized for specific tasks...

## Capabilities
- Capability 1
- Capability 2

## Instructions
How to behave...
EOF
```

## Troubleshooting

### Hooks Not Running

1. Check file permissions: `chmod +x .claude/hooks/*.sh`
2. Verify `$CLAUDE_PROJECT_DIR` is set correctly
3. Check hook timeout settings

### Plugins Not Loading

1. Verify plugin is installed in your Claude Code installation
2. Check marketplace access if using marketplace plugins
3. Review Claude Code logs for plugin errors

### Commands Not Found

1. Ensure command file has correct frontmatter format
2. Restart Claude Code to reload commands
3. Check for syntax errors in command definition
