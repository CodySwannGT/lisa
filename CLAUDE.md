# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Lisa is a Claude Code governance framework that applies guardrails, guidance, and automated enforcement to projects. It distributes configurations (CLAUDE.md, skills, hooks, ESLint plugins, etc.) to target projects based on detected project types.

## Common Commands

```bash
# Run Lisa against a project
./lisa.sh /path/to/project

# Dry run (preview changes)
./lisa.sh --dry-run /path/to/project

# Non-interactive mode (CI/CD)
./lisa.sh --yes /path/to/project

# Validate compatibility only
./lisa.sh --validate /path/to/project

# Uninstall Lisa from a project
./lisa.sh --uninstall /path/to/project

# Run tests
bats tests/lisa.bats
```

## Architecture

### Core Script

`lisa.sh` is the main entry point. It:
1. Detects project types (TypeScript, Expo, NestJS, CDK) from the target project
2. Applies configurations in order: `all/` → `typescript/` → child types (expo, nestjs, cdk)
3. Uses four copy strategies based on subdirectory names

### Copy Strategies

Files are organized into strategy subdirectories that control how they're applied:

| Directory | Behavior |
|-----------|----------|
| `copy-overwrite/` | Replace if exists (prompts on conflict) |
| `copy-contents/` | Append missing lines (for .gitignore) |
| `create-only/` | Create once, never update |
| `merge/` | JSON deep merge (project values win) |

### Type Inheritance

```
all/                    ← Applied to every project
└── typescript/         ← TypeScript-specific
    ├── expo/           ← Expo (inherits typescript)
    ├── nestjs/         ← NestJS (inherits typescript)
    └── cdk/            ← CDK (inherits typescript)
```

### Key Distributed Files

- `all/copy-overwrite/CLAUDE.md` - Behavioral rules for target projects
- `all/copy-overwrite/.claude/` - Settings, hooks, commands, skills, agents
- `all/copy-overwrite/eslint-plugin-code-organization/` - Custom ESLint rules
- `typescript/merge/package.json` - Dev dependencies and scripts
- `expo/copy-overwrite/eslint-plugin-component-structure/` - React component rules

### Manifest Tracking

Lisa creates `.lisa-manifest` in target projects to track installed files for uninstall capability.

## Testing

Tests use [bats-core](https://github.com/bats-core/bats-core):

```bash
# Install bats
brew install bats-core  # macOS
apt install bats        # Linux

# Run all tests
bats tests/lisa.bats

# Run specific test
bats tests/lisa.bats --filter "shows help"
```

## Adding Configurations

### New file to all projects
Place in `all/<strategy>/path/to/file`

### New file for specific type
Place in `<type>/<strategy>/path/to/file`

### New ESLint rule
1. Add rule to `eslint-plugin-*/rules/`
2. Register in plugin's `index.js`
3. Add tests in `__tests__/`

### New skill
Create `<type>/copy-overwrite/.claude/skills/<name>/SKILL.md`

### New slash command
Create `<type>/copy-overwrite/.claude/commands/<category>/<name>.md`
