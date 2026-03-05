# Split Monolithic Plugins into Layered, Composable Plugins

## Context

Lisa currently builds ONE monolithic plugin per stack (lisa-typescript, lisa-expo, etc.). The build script copies ALL base content into every stack plugin, then overlays stack-specific content. This means:
- Commands are namespaced under the stack name: `/lisa-expo:git:commit` vs `/lisa-nestjs:git:commit`
- Switching between project types means different command names for identical base functionality
- Every stack plugin is ~94+ files, mostly duplicated base content

**Goal**: Split into layered plugins that compose together. An expo project installs `lisa@lisa` + `lisa-typescript@lisa` + `lisa-expo@lisa`. Commands from the base plugin are always `/lisa:git:commit` regardless of project type.

## New Plugin Architecture

| Plugin | Contains | Installed for |
|--------|----------|---------------|
| `lisa` | 16 agents, 29 commands, 9 hooks, 3 rules, 30 skills | ALL projects |
| `lisa-typescript` | 3 hooks (format/lint/scan), 1 rule (lisa.md) | All TS-based projects |
| `lisa-expo` | 1 agent, 1 rule, 26 skills, 5 override commands, .mcp.json | Expo projects |
| `lisa-nestjs` | 3 skills | NestJS projects |
| `lisa-cdk` | (empty placeholder) | CDK projects |
| `lisa-rails` | 2 rules, 13 skills, 10 override commands | Rails projects |

**Installation combos**:
- TypeScript: `lisa` + `lisa-typescript`
- Expo: `lisa` + `lisa-typescript` + `lisa-expo`
- NestJS: `lisa` + `lisa-typescript` + `lisa-nestjs`
- CDK: `lisa` + `lisa-typescript` + `lisa-cdk`
- Rails: `lisa` + `lisa-rails`

## Implementation Steps

### Step 1: Create base plugin manifest

Create `plugins/src/base/.claude-plugin/plugin.json` with universal hooks only (NO Write|Edit hooks — those are TypeScript-specific).

**Hooks to include** (extracted from current monolithic plugin.json minus the TS hooks):
- `UserPromptSubmit`: rules injection, enforce-plan-rules.sh, entire CLI
- `PostToolUse`: sync-tasks.sh (TaskCreate|TaskUpdate), entire post-task/post-todo
- `PreToolUse`: entire pre-task
- `Stop`: verify-completion.sh, notify-ntfy.sh, entire stop
- `SessionStart`: install-pkgs.sh, setup-jira-cli.sh, entire session-start
- `SessionEnd`: entire session-end

**File**: `plugins/src/base/.claude-plugin/plugin.json`

### Step 2: Move TypeScript-specific hooks from base to typescript

Move these 3 files from `plugins/src/base/hooks/` to `plugins/src/typescript/hooks/`:
- `format-on-edit.sh`
- `lint-on-edit.sh`
- `sg-scan-on-edit.sh`

### Step 3: Move `rules/lisa.md` from base to typescript

The base `rules/lisa.md` lists TypeScript-managed files (eslint.config.ts, jest.config.ts, tsconfig.json). This is TS-specific, not universal.

- Move `plugins/src/base/rules/lisa.md` → `plugins/src/typescript/rules/lisa.md`
- Base keeps: `coding-philosophy.md`, `verfication.md`, `README.md`

Rails already has its own `rules/lisa.md` override — no change needed there.

### Step 4: Update all stack source plugin.json files

Each stack plugin.json should contain ONLY stack-specific hooks (not the universal ones from base).

**`plugins/src/typescript/.claude-plugin/plugin.json`** — Only the Write|Edit PostToolUse hooks:
```json
{
  "name": "lisa-typescript",
  "version": "1.0.0",
  "description": "TypeScript-specific hooks — Prettier formatting, ESLint linting, and ast-grep scanning on edit",
  "author": { "name": "Cody Swann" },
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "find ${CLAUDE_PLUGIN_ROOT}/rules -name '*.md' -exec cat {} \\;" }] }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/format-on-edit.sh" },
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/sg-scan-on-edit.sh" },
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/lint-on-edit.sh" }
        ]
      }
    ]
  }
}
```

**`plugins/src/expo/.claude-plugin/plugin.json`** — Rules injection only (for expo-specific rules):
```json
{
  "name": "lisa-expo",
  "version": "1.0.0",
  "description": "Expo/React Native-specific skills, agents, rules, and MCP servers",
  "author": { "name": "Cody Swann" },
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "find ${CLAUDE_PLUGIN_ROOT}/rules -name '*.md' -exec cat {} \\;" }] }
    ]
  }
}
```

**`plugins/src/nestjs/.claude-plugin/plugin.json`** — No hooks (no rules or hooks to add):
```json
{
  "name": "lisa-nestjs",
  "version": "1.0.0",
  "description": "NestJS-specific skills (GraphQL, TypeORM)",
  "author": { "name": "Cody Swann" },
  "hooks": {}
}
```

**`plugins/src/cdk/.claude-plugin/plugin.json`** — No hooks:
```json
{
  "name": "lisa-cdk",
  "version": "1.0.0",
  "description": "AWS CDK-specific plugin",
  "author": { "name": "Cody Swann" },
  "hooks": {}
}
```

**`plugins/src/rails/.claude-plugin/plugin.json`** — Rules injection only:
```json
{
  "name": "lisa-rails",
  "version": "1.0.0",
  "description": "Ruby on Rails-specific skills, rules, and conventions",
  "author": { "name": "Cody Swann" },
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "find ${CLAUDE_PLUGIN_ROOT}/rules -name '*.md' -exec cat {} \\;" }] }
    ]
  }
}
```

### Step 5: Create override commands for expo and rails

Expo overrides 5 skills. Create corresponding commands in `plugins/src/expo/commands/jira/`:
- `add-journey.md` — `Use the /lisa-expo:jira-add-journey skill... $ARGUMENTS`
- `create.md` — `Use the /lisa-expo:jira-create skill... $ARGUMENTS`
- `evidence.md` — `Use the /lisa-expo:jira-evidence skill... $ARGUMENTS`
- `journey.md` — `Use the /lisa-expo:jira-journey skill... $ARGUMENTS`
- `verify.md` — `Use the /lisa-expo:jira-verify skill... $ARGUMENTS`

Rails overrides 10 skills. Create corresponding commands in `plugins/src/rails/commands/`:
- `jira/add-journey.md`, `jira/create.md`, `jira/evidence.md`, `jira/journey.md`, `jira/verify.md`
- `plan/add-test-coverage.md`, `plan/fix-linter-error.md`, `plan/lower-code-complexity.md`, `plan/reduce-max-lines.md`, `plan/reduce-max-lines-per-function.md`

Each command mirrors the base command's metadata but references the stack-specific skill namespace.

### Step 6: Rewrite build script

**File**: `scripts/build-plugins.sh`

Change from "copy base then overlay stack" to "build each plugin standalone":

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
PLUGINS_DIR="$ROOT_DIR/plugins"
SRC_DIR="$PLUGINS_DIR/src"

VERSION=$(node -e "console.log(require('$ROOT_DIR/package.json').version)")

inject_version() {
  local manifest="$1"
  if [ -f "$manifest" ]; then
    node -e "
      const fs = require('fs');
      const m = JSON.parse(fs.readFileSync('$manifest', 'utf8'));
      m.version = '$VERSION';
      fs.writeFileSync('$manifest', JSON.stringify(m, null, 2) + '\n');
    "
  fi
}

# Build base plugin
BASE_OUT="$PLUGINS_DIR/lisa"
rm -rf "$BASE_OUT"
mkdir -p "$BASE_OUT"
cp -r "$SRC_DIR/base/." "$BASE_OUT/"
inject_version "$BASE_OUT/.claude-plugin/plugin.json"
echo "Built plugins/lisa (v$VERSION)"

# Build stack-specific plugins (NO base copy)
STACKS=(typescript expo nestjs cdk rails)
for stack in "${STACKS[@]}"; do
  STACK_SRC="$SRC_DIR/$stack"
  if [ ! -d "$STACK_SRC" ]; then
    echo "Skipping plugins/lisa-$stack (no source)"
    continue
  fi
  OUT="$PLUGINS_DIR/lisa-$stack"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  cp -r "$STACK_SRC/." "$OUT/"
  inject_version "$OUT/.claude-plugin/plugin.json"
  echo "Built plugins/lisa-$stack (v$VERSION)"
done
```

### Step 7: Update marketplace manifest

**File**: `.claude-plugin/marketplace.json`

Add the base `lisa` plugin entry:

```json
{
  "plugins": [
    { "name": "lisa", "source": "./plugins/lisa", "description": "Universal governance — agents, skills, commands, hooks, and rules for all projects", "category": "productivity" },
    { "name": "lisa-typescript", "source": "./plugins/lisa-typescript", "description": "TypeScript hooks — formatting, linting, and ast-grep scanning on edit", "category": "productivity" },
    { "name": "lisa-expo", "source": "./plugins/lisa-expo", "description": "Expo/React Native skills, agents, and rules", "category": "productivity" },
    { "name": "lisa-nestjs", "source": "./plugins/lisa-nestjs", "description": "NestJS skills (GraphQL, TypeORM)", "category": "productivity" },
    { "name": "lisa-cdk", "source": "./plugins/lisa-cdk", "description": "AWS CDK plugin", "category": "productivity" },
    { "name": "lisa-rails", "source": "./plugins/lisa-rails", "description": "Ruby on Rails skills, rules, and conventions", "category": "productivity" }
  ]
}
```

### Step 8: Update settings.json merge files

Lisa applies merge files in layers: `all/` → `typescript/` → `{stack}/`. Each layer's `enabledPlugins` get deep-merged.

**`all/merge/.claude/settings.json`** — Add `"lisa@lisa": true` to enabledPlugins (base plugin for ALL projects)

**`typescript/merge/.claude/settings.json`** — Add `"lisa-typescript@lisa": true` to enabledPlugins

**`expo/merge/.claude/settings.json`** — Replace `"lisa-expo@lisa": true` (keep, but remove the third-party plugins that are already in `all/` and `typescript/` layers — they get merged in). Actually, these are already duplicated across layers via deep-merge, so just ensure `"lisa-expo@lisa": true` is present.

**`nestjs/merge/.claude/settings.json`** — Ensure `"lisa-nestjs@lisa": true` (already present)

**`cdk/merge/.claude/settings.json`** — Ensure `"lisa-cdk@lisa": true` (already present)

**`rails/merge/.claude/settings.json`** — Ensure `"lisa-rails@lisa": true` (already present). Rails settings also has project-level hooks for `entire` CLI — these stay unchanged.

### Step 9: Rewrite install script

**File**: `scripts/install-claude-plugins.sh`

Key changes:
1. Always install `lisa@lisa` (base plugin)
2. Install `lisa-typescript@lisa` for all TS-based stacks
3. Install the stack-specific plugin
4. Uninstall old monolithic plugins during migration

```bash
# Always install base plugin
claude plugin install "lisa@lisa" --scope project </dev/null 2>&1 || true

# Detect stack
LISA_STACK=""
if [ -f "$SETTINGS_FILE" ]; then
  for stack in expo nestjs cdk rails; do
    if grep -q "\"lisa-${stack}@lisa\"" "$SETTINGS_FILE" 2>/dev/null; then
      LISA_STACK="$stack"
      break
    fi
  done
fi

# Install typescript layer for TS-based stacks (everything except rails)
case "$LISA_STACK" in
  rails) ;; # Rails doesn't get typescript plugin
  *)
    claude plugin install "lisa-typescript@lisa" --scope project </dev/null 2>&1 || true
    ;;
esac

# Install stack-specific plugin if not plain typescript
if [ -n "$LISA_STACK" ]; then
  claude plugin install "lisa-${LISA_STACK}@lisa" --scope project </dev/null 2>&1 || true
fi
```

### Step 10: Build and commit

1. Run `bun run build:plugins`
2. Delete old monolithic built plugin directories that no longer exist (the old `plugins/lisa-*` dirs will be replaced by new ones; the new `plugins/lisa/` is added)
3. Commit all changes

## Files Modified

| File | Action |
|------|--------|
| `plugins/src/base/.claude-plugin/plugin.json` | **Create** — new base plugin manifest |
| `plugins/src/base/hooks/format-on-edit.sh` | **Move** → `plugins/src/typescript/hooks/` |
| `plugins/src/base/hooks/lint-on-edit.sh` | **Move** → `plugins/src/typescript/hooks/` |
| `plugins/src/base/hooks/sg-scan-on-edit.sh` | **Move** → `plugins/src/typescript/hooks/` |
| `plugins/src/base/rules/lisa.md` | **Move** → `plugins/src/typescript/rules/` |
| `plugins/src/typescript/.claude-plugin/plugin.json` | **Edit** — strip to TS-only hooks |
| `plugins/src/expo/.claude-plugin/plugin.json` | **Edit** — strip to rules injection only |
| `plugins/src/nestjs/.claude-plugin/plugin.json` | **Edit** — strip to empty hooks |
| `plugins/src/cdk/.claude-plugin/plugin.json` | **Edit** — strip to empty hooks |
| `plugins/src/rails/.claude-plugin/plugin.json` | **Edit** — strip to rules injection only |
| `plugins/src/expo/commands/jira/*.md` | **Create** — 5 override commands |
| `plugins/src/rails/commands/jira/*.md` | **Create** — 5 override commands |
| `plugins/src/rails/commands/plan/*.md` | **Create** — 5 override commands |
| `scripts/build-plugins.sh` | **Rewrite** — layered build (no base merge) |
| `.claude-plugin/marketplace.json` | **Edit** — add base `lisa` plugin entry |
| `all/merge/.claude/settings.json` | **Edit** — add `"lisa@lisa": true` |
| `typescript/merge/.claude/settings.json` | **Edit** — add `"lisa-typescript@lisa": true` |
| `scripts/install-claude-plugins.sh` | **Rewrite** — multi-plugin installation |
| `plugins/lisa/` | **Generated** — new base plugin build output |
| `plugins/lisa-typescript/` | **Generated** — now TS-only content |
| `plugins/lisa-expo/` | **Generated** — now expo-only content |
| `plugins/lisa-nestjs/` | **Generated** — now nestjs-only content |
| `plugins/lisa-cdk/` | **Generated** — now cdk-only content |
| `plugins/lisa-rails/` | **Generated** — now rails-only content |

## Verification

1. **Build**: `bun run build:plugins` succeeds
2. **Base plugin**: `plugins/lisa/` contains agents/, commands/, hooks/ (9 scripts), rules/ (3 files), skills/, `.claude-plugin/plugin.json`
3. **TS plugin**: `plugins/lisa-typescript/` contains ONLY hooks/ (3 scripts), rules/ (1 file), `.claude-plugin/plugin.json`
4. **Expo plugin**: `plugins/lisa-expo/` contains agents/, skills/, rules/, commands/jira/, `.mcp.json`, `.claude-plugin/plugin.json` — NO hooks dir, NO base content
5. **No duplication**: Base agents/commands/skills do NOT appear in any stack plugin
6. **Hook separation**: No hook script referenced in more than one plugin.json
7. **Lint/test**: `bun run lint && bun run test` pass
8. **Settings merge**: Verify `all/merge/.claude/settings.json` has `"lisa@lisa": true`
