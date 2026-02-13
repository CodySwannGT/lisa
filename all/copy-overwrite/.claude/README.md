# Claude Code Configuration

This directory contains Claude Code configuration files that customize AI-assisted development workflows.

## Directory Structure

```
.claude/
├── settings.json              # Main Claude Code settings
├── settings.local.json        # Local overrides (gitignored)
├── settings.local.json.example # Template for local settings
├── agents/                    # Custom agent definitions
├── hooks/                     # Automation hooks
├── rules/                     # Always-on governance rules
└── skills/                    # Skill definitions (colon-namespaced)
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
| `agent-architect.md` | Agent file design and optimization |
| `architecture-specialist.md` | Implementation design, dependency mapping, pattern evaluation |
| `git-history-analyzer.md` | Git history analysis |
| `hooks-expert.md` | Claude Code hooks expertise |
| `implementer.md` | Code implementation with TDD enforcement |
| `learner.md` | Post-implementation learning and skill creation |
| `performance-specialist.md` | N+1 queries, algorithmic complexity, memory leaks |
| `product-specialist.md` | User flows, acceptance criteria, UX validation |
| `quality-specialist.md` | Code correctness, coding philosophy, test coverage review |
| `security-specialist.md` | Threat modeling (STRIDE), OWASP Top 10, auth/secrets review |
| `skill-evaluator.md` | Skill quality assessment |
| `slash-command-architect.md` | Command design |
| `test-specialist.md` | Test strategy, test writing, coverage analysis |
| `web-search-researcher.md` | Web research tasks |

## Skills

Skills use colon-namespaced directories (e.g., `plan:create/`) and are invoked via `/skill-name` in Claude Code.

### Plan Skills

| Skill | Purpose |
|-------|---------|
| `plan:create` | Create implementation plans from ticket URLs, file paths, or text descriptions |
| `plan:implement` | Execute an existing plan with an Agent Team |
| `plan:add-test-coverage` | Increase test coverage to a target threshold |
| `plan:fix-linter-error` | Fix all violations of specific ESLint rules |
| `plan:local-code-review` | Review local branch changes against main |
| `plan:lower-code-complexity` | Reduce cognitive complexity threshold |
| `plan:reduce-max-lines` | Reduce max file lines threshold |
| `plan:reduce-max-lines-per-function` | Reduce max function lines threshold |

### Git Skills

| Skill | Purpose |
|-------|---------|
| `git:commit` | Create conventional commits for current changes |
| `git:commit-and-submit-pr` | Commit changes and create/update a pull request |
| `git:submit-pr` | Push changes and create or update a pull request |
| `git:prune` | Prune local branches deleted on remote |

### Integration Skills

| Skill | Purpose |
|-------|---------|
| `jira:create` | Create JIRA epics, stories, and tasks |
| `jira:verify` | Verify JIRA ticket meets organizational standards |
| `jira:sync` | Sync plan progress to linked JIRA tickets |
| `sonarqube:check` | Check SonarQube/SonarCloud quality gate failures |
| `sonarqube:fix` | Fix SonarQube quality gate failures |
| `pull-request:review` | Check and implement PR review comments |
| `security:zap-scan` | Run OWASP ZAP baseline security scan |

### Utility Skills

| Skill | Purpose |
|-------|---------|
| `tasks:load` | Load tasks from project directory into session |
| `tasks:sync` | Export session tasks to project directory |
| `skill-creator` | Guide for creating new skills |
| `agent-design-best-practices` | Best practices for designing agent files |
| `jsdoc-best-practices` | JSDoc documentation standards |

See each skill's `SKILL.md` for detailed documentation.

## Customization

### Adding Custom Skills

Skills contain implementation logic and use hyphen-separated naming:

```bash
mkdir -p .claude/skills/my-namespace-my-skill
cat > .claude/skills/my-namespace-my-skill/SKILL.md << 'EOF'
---
name: my-namespace-my-skill
description: "What this skill does"
---

# My Skill

Instructions for the skill...
EOF
```

### Adding Custom Commands

Commands are user-facing pass-throughs to skills. Directory nesting creates colon-separated names in the UI (e.g., `my-namespace/my-skill.md` becomes `/my-namespace:my-skill`):

```bash
mkdir -p .claude/commands/my-namespace
cat > .claude/commands/my-namespace/my-skill.md << 'EOF'
---
description: "What this command does"
allowed-tools: ["Skill"]
argument-hint: "<arguments>"
---

Use the /my-namespace-my-skill skill to do the thing. $ARGUMENTS
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

### Skills Not Found

1. Ensure skill directory contains a `SKILL.md` file with correct frontmatter
2. Restart Claude Code to reload skills
3. Check for syntax errors in skill definition
