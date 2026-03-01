# Claude Plugin Auto-Installation + Settings Deep Merge + Plugin Source Deduplication

## Context

Three related problems:

1. **Plugin installation gap** — Lisa declares `enabledPlugins` in `settings.json` but never installs the plugins. Third-party plugins (`code-review`, `playwright`, etc.) and Lisa's own stack plugins (`typescript@lisa`, etc.) must be installed manually. A `postinstall` lifecycle script can automate this.

2. **settings.json is overwritten not merged** — Lisa currently clobbers the project's `settings.json` on every `lisa:update`. This prevents downstream projects from customizing Claude Code settings. The fix: deep-merge Lisa's template with the project's existing settings (Lisa wins on conflicts).

3. **Hooks and README in the wrong place** — The deployed `settings.json` contains `entire` CLI hooks that belong in the plugin's `plugin.json`. The `.claude/README.md` also belongs in the plugin as a rules file. Consolidating everything into the plugin makes the plugin self-contained.

4. **Plugin source duplication** — The `plugins/` directory has 5 stack variants with 92 identical files. Reorganizing into `plugins/src/base/` + stack-specific additions with a build step eliminates this.

---

## Architecture After This Plan

### settings.json in downstream projects
Lisa's `settings.json` template only contributes the deep-merged fields. No hooks.

```json
{
  "enabledPlugins": { "typescript@lisa": true, "code-review@claude-plugins-official": true, ... },
  "extraKnownMarketplaces": { "CodySwannGT/lisa": true },
  "env": { "BASH_DEFAULT_TIMEOUT_MS": "1800000", ... },
  "plansDirectory": "./plans",
  "attribution": { "commit": "...", "pr": "..." },
  "permissions": { "deny": ["Read(./.entire/metadata/**)"] }
}
```

### Hooks in plugin.json
All hooks (both existing format/lint hooks AND the `entire` CLI hooks) live in the plugin:

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "matcher": "", "hooks": [{ "command": "command -v entire ... || true" }] },
      { "matcher": "", "hooks": [{ "command": "${CLAUDE_PLUGIN_ROOT}/hooks/enforce-plan-rules.sh" }] }
    ],
    "PostToolUse": [
      { "matcher": "Write|Edit", "hooks": [
        { "command": "${CLAUDE_PLUGIN_ROOT}/hooks/format-on-edit.sh" },
        { "command": "${CLAUDE_PLUGIN_ROOT}/hooks/sg-scan-on-edit.sh" },
        { "command": "${CLAUDE_PLUGIN_ROOT}/hooks/lint-on-edit.sh" }
      ]},
      { "matcher": "Task", "hooks": [{ "command": "command -v entire ... post-task || true" }] },
      { "matcher": "TodoWrite", "hooks": [{ "command": "command -v entire ... post-todo || true" }] },
      { "matcher": "TaskCreate|TaskUpdate", "hooks": [{ "command": "${CLAUDE_PLUGIN_ROOT}/hooks/sync-tasks.sh" }] }
    ],
    "PreToolUse": [
      { "matcher": "Task", "hooks": [{ "command": "command -v entire ... pre-task || true" }] }
    ],
    "Stop": [
      { "hooks": [{ "command": "${CLAUDE_PLUGIN_ROOT}/hooks/verify-completion.sh" }] },
      { "hooks": [{ "command": "${CLAUDE_PLUGIN_ROOT}/hooks/notify-ntfy.sh" }] },
      { "hooks": [{ "command": "command -v entire ... stop || true" }] }
    ],
    "SessionStart": [
      { "matcher": "startup", "hooks": [{ "command": "${CLAUDE_PLUGIN_ROOT}/hooks/install-pkgs.sh" }] },
      { "hooks": [{ "command": "${CLAUDE_PLUGIN_ROOT}/hooks/setup-jira-cli.sh" }] },
      { "hooks": [{ "command": "command -v entire ... session-start || true" }] }
    ],
    "SessionEnd": [
      { "hooks": [{ "command": "command -v entire ... session-end || true" }] }
    ]
  }
}
```

### Plugin source structure
```
plugins/
  src/
    base/          # 92 shared files
    expo/          # Expo-only additions
    nestjs/        # NestJS-only additions
    cdk/           # CDK-only additions
    rails/         # Rails-only additions (+ different plugin.json)
  lisa-typescript/ # GENERATED
  lisa-expo/       # GENERATED
  lisa-nestjs/     # GENERATED
  lisa-cdk/        # GENERATED
  lisa-rails/      # GENERATED
```

### .claude/ files Lisa manages in downstream projects
After this plan, only **1 file**:

| File | How managed |
|------|-------------|
| `.claude/settings.json` | Deep-merged (Lisa wins conflicts) |

Everything else is plugin-delivered:
- **Agents, commands, skills**: loaded from plugin by Claude Code
- **Hooks**: defined in `plugin.json`, run from `${CLAUDE_PLUGIN_ROOT}/hooks/`
- **Rules** (`lisa.md`, `coding-philosophy.md`, `verfication.md`, `README.md`): injected into every prompt via the existing `UserPromptSubmit` hook: `find ${CLAUDE_PLUGIN_ROOT}/rules -name '*.md' -exec cat {} \;`

`CLAUDE.md` is no longer managed by Lisa. `HUMAN.md` is deleted from Lisa entirely. `.claude/rules/lisa.md` moves to `plugins/src/base/rules/lisa.md` (injected via the hook, not file-deployed).

---

## Implementation Plan

### Step 1: Add `plugins/` and `.claude-plugin/` to npm `files`

**File**: `package.json`

```json
"files": [
  "dist", "all", "typescript", "expo", "nestjs", "cdk", "rails",
  "tsconfig", "scripts", "plugins", ".claude-plugin"
]
```

---

### Step 2: Create `scripts/build-plugins.sh`

**File**: `scripts/build-plugins.sh` (new)

Generates each `plugins/lisa-<stack>/` from shared base + stack-specific overrides:

```bash
#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGINS_DIR="$SCRIPT_DIR/../plugins"
SRC_DIR="$PLUGINS_DIR/src"
BASE_DIR="$SRC_DIR/base"
STACKS=(typescript expo nestjs cdk rails)

for stack in "${STACKS[@]}"; do
  OUT="$PLUGINS_DIR/lisa-$stack"
  rm -rf "$OUT"
  mkdir -p "$OUT"
  cp -r "$BASE_DIR/." "$OUT/"
  STACK_SRC="$SRC_DIR/$stack"
  if [ -d "$STACK_SRC" ]; then
    cp -r "$STACK_SRC/." "$OUT/"
  fi
  echo "Built plugins/lisa-$stack"
done
```

---

### Step 3: Reorganize `plugins/src/`

**Action**: Migrate from 5 full copies to shared source + stack-specific additions.

#### `plugins/src/base/`
Move the shared files from `plugins/lisa-typescript/`:
- `agents/` (18 agents)
- `commands/` (31 commands)
- `hooks/` (all 13 hooks)
- `rules/coding-philosophy.md`, `rules/lisa.md`, `rules/verfication.md`
- `rules/README.md` ← moved from `all/copy-overwrite/.claude/README.md`
- `skills/` (31 skills common to all stacks)
- **No `plugin.json` here** — each stack has its own

#### `plugins/src/typescript/`
- `.claude-plugin/plugin.json` — full plugin.json with all hooks (base version)

#### `plugins/src/expo/`
- `.claude-plugin/plugin.json` — identical to typescript
- `agents/ops-specialist.md`
- `rules/expo-verification.md`
- `skills/` — 20 expo-exclusive skills

#### `plugins/src/nestjs/`
- `.claude-plugin/plugin.json` — identical to typescript
- `skills/` — nestjs-specific skills

#### `plugins/src/cdk/`
- `.claude-plugin/plugin.json` — identical to typescript
- Any cdk-specific skills

#### `plugins/src/rails/`
- `.claude-plugin/plugin.json` — **differs**: omits `format-on-edit`, `sg-scan-on-edit`, `lint-on-edit` PostToolUse hooks
- `rules/rails-conventions.md`
- Any rails-specific skills

#### Delete
Old `plugins/lisa-*/` directories (replaced by build output).

---

### Step 4: Update `plugins/src/*/plugin.json` — add `entire` CLI hooks, remove "I'm tired boss" hooks

**Action**: Migrate the `entire` CLI hooks from deployed `settings.json` templates into each stack's `plugin.json` in `plugins/src/`. Remove both "I'm tired boss" enforcement hooks:
- Do NOT include the `echo 'REMINDER: ...'` UserPromptSubmit hook
- Do NOT include the `check-tired-boss.sh` Stop hook

Also delete `plugins/src/base/hooks/check-tired-boss.sh` — it will not be part of the plugin at all.

Add to `plugins/src/typescript/.claude-plugin/plugin.json` (and non-rails stacks):

```json
"UserPromptSubmit": [
  { "matcher": "", "hooks": [{ "type": "command", "command": "echo 'REMINDER: Start your response with \"I'\\''m tired boss\" as required by CLAUDE.md.'" }] },
  { "matcher": "", "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code user-prompt-submit || true" }] },
  { "matcher": "", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/enforce-plan-rules.sh" }] }
],
"PostToolUse": [
  (existing Write|Edit hooks stay),
  { "matcher": "Task", "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code post-task || true" }] },
  { "matcher": "TodoWrite", "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code post-todo || true" }] }
],
"PreToolUse": [
  { "matcher": "Task", "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code pre-task || true" }] }
],
"Stop": [
  (existing verify/check-tired/notify hooks stay),
  { "matcher": "", "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code stop || true" }] }
],
"SessionStart": [
  (existing install-pkgs/setup-jira hooks stay),
  { "matcher": "", "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code session-start || true" }] }
],
"SessionEnd": [
  { "matcher": "", "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code session-end || true" }] }
]
```

---

### Step 5: Strip hooks from deployed `settings.json` templates

**Files**:
- `all/copy-overwrite/.claude/settings.json`
- `typescript/copy-overwrite/.claude/settings.json`
- `nestjs/copy-overwrite/.claude/settings.json`
- `expo/copy-overwrite/.claude/settings.json`
- `cdk/copy-overwrite/.claude/settings.json`

Remove the entire `hooks` key. Keep: `enabledPlugins`, `extraKnownMarketplaces`, `env`, `plansDirectory`, `attribution`, `permissions`.

---

### Step 6: Remove `.claude/README.md`, `CLAUDE.md`, and `HUMAN.md` from copy-overwrite

**Action**:
- Delete `all/copy-overwrite/.claude/README.md` — content moves to `plugins/src/base/rules/README.md`
- Delete `all/copy-overwrite/CLAUDE.md` — Lisa no longer manages this file in downstream projects
- Delete `rails/copy-overwrite/CLAUDE.md` — same (rails has its own copy)
- Delete `all/copy-overwrite/HUMAN.md` — removed entirely; add `"HUMAN.md"` and `".claude/rules/lisa.md"` to `all/deletions.json` so existing downstream projects have them removed on next `lisa:update`
- Delete `all/copy-overwrite/.claude/rules/lisa.md` — moves to `plugins/src/base/rules/lisa.md` and injected via UserPromptSubmit hook

**Note**: `check-tired-boss.sh` is already listed in `all/deletions.json` (removing it from `.claude/hooks/` in existing projects). This plan additionally removes it from `plugins/src/base/hooks/` so it won't be re-introduced via the plugin.

---

### Step 7: Change `settings.json` deployment from copy-overwrite to deep-merge in Lisa's CLI

**Files**: Lisa CLI source in `src/` (the file deployment logic)

Currently Lisa copies `settings.json` verbatim (copy-overwrite). Change the logic: when the destination `settings.json` already exists, deep-merge it with Lisa's template using lodash.merge semantics — Lisa's values win on conflicts.

Merged fields (Lisa wins):
- `enabledPlugins` — additive: both sets kept; Lisa's entries override if same key
- `extraKnownMarketplaces` — additive: same merge
- `env` — Lisa's values overwrite matching keys
- `plansDirectory` — Lisa's value wins
- `attribution` — Lisa's values win
- `permissions` — Lisa's values win

First-time setup (no existing `settings.json`): write Lisa's template as-is.

**Note**: This requires identifying the specific function in `src/` that handles file deployment. The existing `lodash.merge` dependency in Lisa is already available for this.

---

### Step 8: Update `.gitignore`

Add generated plugin directories:
```
plugins/lisa-typescript/
plugins/lisa-expo/
plugins/lisa-nestjs/
plugins/lisa-cdk/
plugins/lisa-rails/
```

---

### Step 9: Wire build step

**File**: `package.json`

```json
"build:plugins": "bash scripts/build-plugins.sh",
"build": "tsc && bun run build:plugins",
```

---

### Step 10: Create `scripts/install-claude-plugins.sh`

**File**: `scripts/install-claude-plugins.sh` (new)

```bash
#!/usr/bin/env bash
# Registers the Lisa marketplace and installs required Claude Code plugins.
# Runs as Lisa's postinstall lifecycle script.
set -euo pipefail

if ! command -v claude &>/dev/null; then exit 0; fi

PROJECT_ROOT="${npm_config_local_prefix:-${INIT_CWD:-}}"
if [ -z "$PROJECT_ROOT" ]; then exit 0; fi

LISA_DIR="$PROJECT_ROOT/node_modules/@codyswann/lisa"
if [ ! -d "$LISA_DIR" ]; then exit 0; fi

cd "$PROJECT_ROOT"

# Register the Lisa marketplace pointing to this npm package
claude marketplace add "$LISA_DIR" </dev/null 2>&1 || true

# Detect which stack plugin to install from .claude/settings.json
SETTINGS_FILE="$PROJECT_ROOT/.claude/settings.json"
LISA_PLUGIN=""
if [ -f "$SETTINGS_FILE" ]; then
  for stack in typescript expo nestjs cdk rails; do
    if grep -q "\"${stack}@lisa\"" "$SETTINGS_FILE" 2>/dev/null; then
      LISA_PLUGIN="${stack}@lisa"
      break
    fi
  done
fi

if [ -n "$LISA_PLUGIN" ]; then
  claude plugin install "$LISA_PLUGIN" --scope project </dev/null 2>&1 || true
fi

# Install third-party plugins required by all Lisa stacks
for plugin in \
  "typescript-lsp@claude-plugins-official" \
  "code-simplifier@claude-plugins-official" \
  "code-review@claude-plugins-official" \
  "playwright@claude-plugins-official" \
  "coderabbit@claude-plugins-official" \
  "sentry@claude-plugins-official" \
  "safety-net@cc-marketplace"; do
  claude plugin install "$plugin" --scope project </dev/null 2>&1 || true
done
```

---

### Step 11: Add `postinstall` to `package.json`

```json
"postinstall": "bash ./scripts/install-claude-plugins.sh || true"
```

---

### Step 12: Update `plugins/src/base/rules/lisa.md` — trimmed managed-files list

Rewrite `lisa.md` (which lives in `plugins/src/base/rules/` and is injected via the UserPromptSubmit hook) to reflect the post-plan reality. The list is now much shorter:

**Files with local overrides** (edit override, not managed file):
| Managed File | Local Override |
|---|---|
| `eslint.config.ts` | `eslint.config.local.ts` |
| `jest.config.ts` | `jest.config.local.ts` |
| `tsconfig.json` | `tsconfig.local.json` |

**Create-only files** (edit freely, Lisa won't overwrite):
- `.claude/rules/PROJECT_RULES.md`
- `eslint.thresholds.json`
- `jest.thresholds.json`

**Deep-merged by Lisa** (Lisa wins conflicts, but project can add its own keys):
- `.claude/settings.json`

**Plugin-managed content** (agents, skills, hooks, commands, rules):
These resources are distributed via the stack Claude Code plugin (e.g., `typescript@lisa`). Rules — including this file — are injected into each prompt automatically. Do not add these files to your project directory.

**Copy-overwrite files** (do not edit — full list):
- `.prettierrc.json`, `.prettierignore`, `.lintstagedrc.json`, `.versionrc`, `.nvmrc`
- `.yamllint`, `.gitleaksignore`, `.coderabbit.yml`, `commitlint.config.cjs`, `sgconfig.yml`, `knip.json`
- `.safety-net.json`, `audit.ignore.config.json`
- `eslint.base.ts`, `eslint.typescript.ts` (+ `expo`/`nestjs`/`cdk` variants), `eslint.slow.config.ts`
- `jest.base.ts`, `jest.typescript.ts` (+ variants)
- `tsconfig.base.json`, `tsconfig.typescript.json` (+ variants), `tsconfig.eslint.json`, `tsconfig.build.json`, `tsconfig.spec.json`
- `.github/workflows/quality.yml`, `release.yml`, `claude.yml`, and all other Claude/CI workflows
- `.github/dependabot.yml`, `.github/GITHUB_ACTIONS.md`
- `ast-grep/rules/`, `ast-grep/utils/`, `ast-grep/rule-tests/`

---

### Step 13: Add `@codyswann/lisa` to `trustedDependencies` in root template

**File**: `package.lisa.json`

**File**: `package.lisa.json`

```json
"merge": {
  "trustedDependencies": [
    "@ast-grep/cli",
    "@sentry/cli",
    "@codyswann/lisa"
  ]
}
```

---

## Critical Files

| File | Change |
|------|--------|
| `package.json` | Add `plugins`, `.claude-plugin` to `files`; add `postinstall`, `build:plugins` to scripts; update `build` |
| `scripts/install-claude-plugins.sh` | New — marketplace registration + plugin install |
| `scripts/build-plugins.sh` | New — generates `plugins/lisa-*/` from `plugins/src/` |
| `plugins/src/base/` | New — 92 shared files migrated from `plugins/lisa-typescript/` |
| `plugins/src/<stack>/` | New — stack-specific additions only |
| `plugins/src/*/plugin.json` | Updated — add `entire` CLI hooks + PreToolUse + SessionEnd; remove both "I'm tired boss" hooks |
| `plugins/src/base/hooks/check-tired-boss.sh` | Deleted — "I'm tired boss" Stop hook removed |
| `plugins/lisa-*/` | Deleted from git (gitignored; regenerated by build) |
| `all/copy-overwrite/.claude/settings.json` | Remove `hooks` key |
| `all/copy-overwrite/.claude/README.md` | Deleted (moved to `plugins/src/base/rules/README.md`) |
| `all/copy-overwrite/CLAUDE.md` | Deleted — Lisa no longer manages this file |
| `rails/copy-overwrite/CLAUDE.md` | Deleted — same |
| `all/copy-overwrite/HUMAN.md` | Deleted — add `"HUMAN.md"` to `all/deletions.json` |
| `all/copy-overwrite/.claude/rules/lisa.md` | Deleted — moves to `plugins/src/base/rules/lisa.md`; add `".claude/rules/lisa.md"` to `all/deletions.json` |
| `typescript/copy-overwrite/.claude/settings.json` | Remove `hooks` key |
| `nestjs/copy-overwrite/.claude/settings.json` | Remove `hooks` key |
| `expo/copy-overwrite/.claude/settings.json` | Remove `hooks` key |
| `cdk/copy-overwrite/.claude/settings.json` | Remove `hooks` key |
| `src/` (Lisa CLI) | Change `settings.json` deployment from copy-overwrite to deep-merge |
| `.gitignore` | Add `plugins/lisa-*/` entries |
| `package.lisa.json` | Add `@codyswann/lisa` to `merge.trustedDependencies` |

---

## Verification

1. **Build generates plugin dirs**: `bun run build:plugins` → verify all 5 `plugins/lisa-*/` directories generated with correct file counts.

2. **Plugin hooks complete**: Inspect generated `plugins/lisa-typescript/.claude-plugin/plugin.json` — confirm all hooks present (format-on-edit, lint-on-edit, sg-scan-on-edit, entire CLI hooks, UserPromptSubmit reminder, verify-completion, check-tired-boss).

3. **settings.json deep-merge**: Apply Lisa to a test project that has custom settings — confirm Lisa's values are present and project-custom values outside Lisa's keys are preserved.

4. **postinstall works non-interactively**: From a test downstream project, run `bash node_modules/@codyswann/lisa/scripts/install-claude-plugins.sh` — all plugins install without prompting.

5. **Idempotency**: Run install script twice — `~/.claude/plugins/installed_plugins.json` shows one entry per plugin, not duplicates.

6. **Graceful CI skip**: `command -v claude` absent → install script exits 0 silently.

7. **npm publish dry-run**: `bun pack --dry-run` → `plugins/lisa-*/`, `.claude-plugin/` appear in file listing.

8. **trustedDependencies propagation**: Apply Lisa to downstream project → `@codyswann/lisa` appears in `trustedDependencies` in the project's `package.json`.
