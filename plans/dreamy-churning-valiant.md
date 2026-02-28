# Lisa Plugins — Phase 2 & 3: Wire CLI + Cleanup

## Context

Phase 1 is complete: 5 plugins (`plugins/lisa-typescript`, `plugins/lisa-expo`, `plugins/lisa-nestjs`, `plugins/lisa-cdk`, `plugins/lisa-rails`) have been built and a self-hosted marketplace is registered at `.claude-plugin/marketplace.json` (marketplace name: `lisa`). Skills are accessible as `/lisa:skill-name`.

Phase 2 wires the CLI so downstream projects automatically get the right plugin when they run `lisa:update`, and cleans up the old `.claude/` template content that the plugins now replace. Phase 3 updates documentation to reflect the new architecture.

**Architectural shift being finalized:**
- Before: Lisa CLI pushes agents, skills, hooks, commands as files into `.claude/`
- After: Lisa CLI deploys only config files + registers the plugin marketplace in `settings.json`; Claude Code installs plugins automatically

---

## Phase 2: Wire CLI + Clean Templates

### Step 1 — Move plugin hooks into plugin.json (all 5 plugins)

Per the Claude Code plugin spec, hook configuration belongs in `plugin.json` under a top-level `hooks` key. The `hooks/hooks.json` files are our own convention and are not automatically loaded.

For each plugin, copy the `hooks` object from `hooks/hooks.json` into `.claude-plugin/plugin.json`, then delete `hooks/hooks.json`.

**Files to modify (5x plugin.json):**

- `plugins/lisa-typescript/.claude-plugin/plugin.json` — add `hooks` key from `plugins/lisa-typescript/hooks/hooks.json`
- `plugins/lisa-expo/.claude-plugin/plugin.json` — add `hooks` key from `plugins/lisa-expo/hooks/hooks.json`
- `plugins/lisa-nestjs/.claude-plugin/plugin.json` — add `hooks` key from `plugins/lisa-nestjs/hooks/hooks.json`
- `plugins/lisa-cdk/.claude-plugin/plugin.json` — add `hooks` key from `plugins/lisa-cdk/hooks/hooks.json`
- `plugins/lisa-rails/.claude-plugin/plugin.json` — add `hooks` key from `plugins/lisa-rails/hooks/hooks.json`

**Files to delete (5x hooks.json):**
- `plugins/lisa-typescript/hooks/hooks.json`
- `plugins/lisa-expo/hooks/hooks.json`
- `plugins/lisa-nestjs/hooks/hooks.json`
- `plugins/lisa-cdk/hooks/hooks.json`
- `plugins/lisa-rails/hooks/hooks.json`

**Resulting plugin.json structure for typescript (same pattern for all stacks):**

```json
{
  "name": "typescript",
  "version": "1.0.0",
  "description": "Claude Code governance plugin for TypeScript projects — includes all universal skills, agents, hooks, and rules from Lisa plus TypeScript-specific tooling",
  "author": "Cody Swann",
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "find ${CLAUDE_PLUGIN_ROOT}/rules -name '*.md' -exec cat {} \\;"
          }
        ]
      },
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/hooks/enforce-plan-rules.sh"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Write|Edit",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/format-on-edit.sh" },
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/sg-scan-on-edit.sh" },
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/lint-on-edit.sh" }
        ]
      },
      {
        "matcher": "TaskCreate|TaskUpdate",
        "hooks": [
          { "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/sync-tasks.sh" }
        ]
      }
    ],
    "Stop": [
      { "matcher": "", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/verify-completion.sh" }] },
      { "matcher": "", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/check-tired-boss.sh" }] },
      { "matcher": "", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/notify-ntfy.sh" }] }
    ],
    "SessionStart": [
      { "matcher": "startup", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/install-pkgs.sh" }] },
      { "matcher": "", "hooks": [{ "type": "command", "command": "${CLAUDE_PLUGIN_ROOT}/hooks/setup-jira-cli.sh" }] }
    ]
  }
}
```

---

### Step 2 — Update settings.json templates

All `$CLAUDE_PROJECT_DIR/.claude/hooks/*.sh` references are removed from `settings.json` (plugins handle them). Keep only: inline commands, `entire` CLI integrations, attribution, env, permissions, plansDirectory. Add `extraKnownMarketplaces` and the stack-specific `enabledPlugins` entry.

**2a. `all/copy-overwrite/.claude/settings.json`** — update in place:

Changes:
- Add `"extraKnownMarketplaces": {"CodySwannGT/lisa": true}` after `enabledPlugins`
- Strip all hooks that reference `$CLAUDE_PROJECT_DIR/.claude/hooks/` (format-on-edit, sg-scan-on-edit, lint-on-edit, sync-tasks, verify-completion, check-tired-boss, notify-ntfy, install-pkgs, setup-jira-cli, enforce-plan-rules, debug-hook)
- Strip `Notification`, `PermissionRequest`, `PostToolUseFailure`, `PreCompact`, `Setup`, `SubagentStart`, `SubagentStop` hook events entirely (only had debug-hook refs)
- Keep: inline `echo 'REMINDER...'` in UserPromptSubmit, all `entire` CLI hooks
- Resulting hooks: UserPromptSubmit (echo + entire), PostToolUse (entire Task/TodoWrite), PreToolUse (entire Task), SessionEnd (entire), SessionStart (entire), Stop (entire)

**2b. `typescript/copy-overwrite/.claude/settings.json`** — same changes as 2a, plus:
- Add `"typescript@lisa": true` to `enabledPlugins`

**2c–2f. Create 4 new settings.json files** (copy cleaned `all/` version, add stack plugin):

- `expo/copy-overwrite/.claude/settings.json` — include sentry plugin, add `"expo@lisa": true`
- `nestjs/copy-overwrite/.claude/settings.json` — include sentry plugin, add `"nestjs@lisa": true`
- `cdk/copy-overwrite/.claude/settings.json` — include sentry plugin, add `"cdk@lisa": true`
- `rails/copy-overwrite/.claude/settings.json` — include sentry plugin, add `"rails@lisa": true`

**Target settings.json shape (all/ base, no stack plugin yet):**

```json
{
  "attribution": {
    "commit": "🤖 Generated with Claude Code\n\nCo-Authored-By: Claude",
    "pr": "🤖 Generated with Claude Code"
  },
  "enabledPlugins": {
    "typescript-lsp@claude-plugins-official": true,
    "safety-net@cc-marketplace": true,
    "code-simplifier@claude-plugins-official": true,
    "code-review@claude-plugins-official": true,
    "playwright@claude-plugins-official": true,
    "coderabbit@claude-plugins-official": true,
    "sentry@claude-plugins-official": true
  },
  "extraKnownMarketplaces": {
    "CodySwannGT/lisa": true
  },
  "env": {
    "BASH_DEFAULT_TIMEOUT_MS": "1800000",
    "BASH_MAX_TIMEOUT_MS": "7200000",
    "CLAUDE_DEBUG": "0",
    "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"
  },
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Task",
        "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code post-task || true" }]
      },
      {
        "matcher": "TodoWrite",
        "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code post-todo || true" }]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Task",
        "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code pre-task || true" }]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code session-end || true" }]
      }
    ],
    "SessionStart": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code session-start || true" }]
      }
    ],
    "Stop": [
      {
        "matcher": "",
        "hooks": [{ "type": "command", "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code stop || true" }]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'REMINDER: Start your response with \"I'\\''m tired boss\" as required by CLAUDE.md.'"
          },
          {
            "type": "command",
            "command": "command -v entire >/dev/null 2>&1 && entire hooks claude-code user-prompt-submit || true"
          }
        ]
      }
    ]
  },
  "permissions": {
    "deny": ["Read(./.entire/metadata/**)"]
  },
  "plansDirectory": "./plans"
}
```

---

### Step 3 — Update deletions.json files

These entries tell the Lisa CLI to clean up old files from downstream projects on next `lisa:update`.

**3a. `all/deletions.json`** — append to existing `paths` array:

```
Agents (16):
  .claude/agents/agent-architect.md
  .claude/agents/architecture-specialist.md
  .claude/agents/debug-specialist.md
  .claude/agents/git-history-analyzer.md
  .claude/agents/hooks-expert.md
  .claude/agents/implementer.md
  .claude/agents/learner.md
  .claude/agents/performance-specialist.md
  .claude/agents/product-specialist.md
  .claude/agents/quality-specialist.md
  .claude/agents/security-specialist.md
  .claude/agents/skill-evaluator.md
  .claude/agents/slash-command-architect.md
  .claude/agents/test-specialist.md
  .claude/agents/verification-specialist.md
  .claude/agents/web-search-researcher.md

Command directories (9):
  .claude/commands/git
  .claude/commands/jira
  .claude/commands/lisa
  .claude/commands/plan
  .claude/commands/plans
  .claude/commands/pull-request
  .claude/commands/security
  .claude/commands/sonarqube
  .claude/commands/tasks

Skill directories (30):
  .claude/skills/agent-design-best-practices
  .claude/skills/git-commit
  .claude/skills/git-commit-and-submit-pr
  .claude/skills/git-commit-submit-pr-and-verify
  .claude/skills/git-commit-submit-pr-deploy-and-verify
  .claude/skills/git-prune
  .claude/skills/git-submit-pr
  .claude/skills/jira-add-journey
  .claude/skills/jira-create
  .claude/skills/jira-evidence
  .claude/skills/jira-fix
  .claude/skills/jira-implement
  .claude/skills/jira-journey
  .claude/skills/jira-sync
  .claude/skills/jira-verify
  .claude/skills/lisa-review-implementation
  .claude/skills/plan-add-test-coverage
  .claude/skills/plan-execute
  .claude/skills/plan-fix-linter-error
  .claude/skills/plan-local-code-review
  .claude/skills/plan-lower-code-complexity
  .claude/skills/plan-reduce-max-lines
  .claude/skills/plan-reduce-max-lines-per-function
  .claude/skills/pull-request-review
  .claude/skills/security-zap-scan
  .claude/skills/skill-creator
  .claude/skills/sonarqube-check
  .claude/skills/sonarqube-fix
  .claude/skills/tasks-load
  .claude/skills/tasks-sync

Hook scripts (9):
  .claude/hooks/check-tired-boss.sh
  .claude/hooks/debug-hook.sh
  .claude/hooks/enforce-plan-rules.sh
  .claude/hooks/notify-ntfy.sh
  .claude/hooks/setup-jira-cli.sh
  .claude/hooks/sync-tasks.sh
  .claude/hooks/ticket-sync-reminder.sh
  .claude/hooks/track-plan-sessions.sh
  .claude/hooks/verify-completion.sh

Rules (2):
  .claude/rules/coding-philosophy.md
  .claude/rules/verfication.md
```

**3b. `typescript/deletions.json`** — append to existing 2-entry `paths` array:

```
  .claude/hooks/format-on-edit.sh
  .claude/hooks/install-pkgs.sh
  .claude/hooks/lint-on-edit.sh
  .claude/hooks/sg-scan-on-edit.sh
  .claude/skills/jira-add-journey
  .claude/skills/jira-create
  .claude/skills/jira-evidence
  .claude/skills/jira-journey
  .claude/skills/jira-verify
  .claude/skills/jsdoc-best-practices
```

**3c. Create `expo/deletions.json`:**

```json
{
  "paths": [
    ".claude/agents/ops-specialist.md",
    ".claude/rules/expo-verification.md",
    ".claude/skills/apollo-client",
    ".claude/skills/atomic-design-gluestack",
    ".claude/skills/container-view-pattern",
    ".claude/skills/cross-platform-compatibility",
    ".claude/skills/directory-structure",
    ".claude/skills/expo-env-config",
    ".claude/skills/expo-router-best-practices",
    ".claude/skills/gluestack-nativewind",
    ".claude/skills/jira-add-journey",
    ".claude/skills/jira-create",
    ".claude/skills/jira-evidence",
    ".claude/skills/jira-journey",
    ".claude/skills/jira-verify",
    ".claude/skills/local-state",
    ".claude/skills/ops-browser-uat",
    ".claude/skills/ops-check-logs",
    ".claude/skills/ops-db-ops",
    ".claude/skills/ops-deploy",
    ".claude/skills/ops-monitor-errors",
    ".claude/skills/ops-performance",
    ".claude/skills/ops-run-local",
    ".claude/skills/ops-verify-health",
    ".claude/skills/owasp-zap",
    ".claude/skills/playwright-selectors",
    ".claude/skills/testing-library"
  ]
}
```

Note: Verify full expo skills list during implementation (`ls expo/copy-overwrite/.claude/skills/`) — the ls was truncated at 25 lines.

**3d. Create `nestjs/deletions.json`:**

```json
{
  "paths": [
    ".claude/skills/nestjs-graphql",
    ".claude/skills/nestjs-rules",
    ".claude/skills/security-zap-scan",
    ".claude/skills/typeorm-patterns"
  ]
}
```

**3e. `rails/deletions.json`** — append to existing 1-entry `paths` array:

```
  .claude/skills/action-controller-best-practices
  .claude/skills/action-view-best-practices
  .claude/skills/active-record-model-best-practices
  .claude/skills/plan-add-test-coverage
  .claude/skills/plan-fix-linter-error
  .claude/skills/plan-lower-code-complexity
  .claude/skills/plan-reduce-max-lines
  .claude/skills/plan-reduce-max-lines-per-function
```

Also check if `rails/copy-overwrite/.claude/rules/` has files and add deletion entries for them.

**Note on CDK:** CDK has no `.claude/` content in its template directory — skip.

---

### Step 4 — Delete template content

Remove the following from template directories (they now live in plugins):

**From `all/copy-overwrite/.claude/`:**
- Delete `agents/` directory entirely (16 .md files)
- Delete `commands/` directory entirely (9 subdirs, all .md files)
- Delete `skills/` directory entirely (30 skill dirs)
- Delete `hooks/*.sh` — all 9 shell scripts (keep `hooks/README.md`)
- Delete `rules/coding-philosophy.md`
- Delete `rules/verfication.md`

**From `typescript/copy-overwrite/.claude/`:**
- Delete `hooks/` directory entirely (4 scripts: format-on-edit.sh, install-pkgs.sh, lint-on-edit.sh, sg-scan-on-edit.sh)
- Delete `skills/` directory entirely (6 dirs: jira-add-journey, jira-create, jira-evidence, jira-journey, jira-verify, jsdoc-best-practices)

**From `expo/copy-overwrite/.claude/`:**
- Delete `agents/` directory entirely (ops-specialist.md + any others)
- Delete `skills/` directory entirely (25+ dirs)
- Delete `rules/expo-verification.md`

**From `nestjs/copy-overwrite/.claude/`:**
- Delete `skills/` directory entirely (4 dirs)

**From `rails/copy-overwrite/.claude/`:**
- Delete `skills/` directory entirely (8 dirs)
- Check if `rules/` has files and delete them too

---

## Phase 3: Documentation Cleanup

### Step 5 — Update lisa.md template

**File:** `all/copy-overwrite/.claude/rules/lisa.md`

Changes:
1. Remove the "Directories with both Lisa-managed and project content" section — `.claude/skills/`, `.claude/agents/`, `.claude/hooks/`, `.claude/commands/` are no longer managed by Lisa CLI
2. Remove the skill/agent/hook/command-specific entries from "Files and directories with NO local override" section
3. Add a new "Plugin-managed content" section explaining that agents, skills, hooks, and commands are now distributed via the stack plugin (e.g., `typescript@lisa`) and update automatically from the Lisa GitHub repo

### Step 6 — Update .lisa-manifest

**File:** `.lisa-manifest` (in Lisa repo root)

Remove all entries for paths being deleted from templates:
- All 16 agent paths
- All command paths (git/, jira/, etc.)
- All 30+ skill directory paths (from all/)
- All 10+ typescript-specific skill paths
- All 25+ expo-specific paths
- All nestjs/rails skill paths
- All hook script paths from all/ and typescript/
- `coding-philosophy.md`, `verfication.md`, `expo-verification.md` entries

Do this by reading `.lisa-manifest` and removing lines that match the deleted paths. The manifest is a plain text file listing relative paths.

---

## Verification

After implementation, verify:

```bash
# 1. No hooks.json files remain in plugins
ls plugins/*/hooks/hooks.json 2>&1  # should show "no such file" for all

# 2. All plugin.json files have hooks key
cat plugins/lisa-typescript/.claude-plugin/plugin.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('hooks' in d)"  # should print True

# 3. settings.json has extraKnownMarketplaces
cat all/copy-overwrite/.claude/settings.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('extraKnownMarketplaces'))"  # should print marketplace

# 4. Template dirs no longer have agents/skills/hooks/commands
ls all/copy-overwrite/.claude/  # should only show: rules/ settings.json README.md (no agents, commands, skills, hooks)

# 5. TypeScript enabledPlugins includes typescript@lisa
cat typescript/copy-overwrite/.claude/settings.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['enabledPlugins'])"  # should include typescript@lisa

# 6. Run quality checks
bun run typecheck
bun run lint
bun run test
```

## Critical Files

| File | Change |
|---|---|
| `plugins/lisa-*/` `.claude-plugin/plugin.json` | Add `hooks` key (5 files) |
| `plugins/lisa-*/hooks/hooks.json` | Delete (5 files) |
| `all/copy-overwrite/.claude/settings.json` | Add marketplace, strip hook refs |
| `typescript/copy-overwrite/.claude/settings.json` | Same + add typescript@lisa |
| `expo/copy-overwrite/.claude/settings.json` | Create new with expo@lisa |
| `nestjs/copy-overwrite/.claude/settings.json` | Create new with nestjs@lisa |
| `cdk/copy-overwrite/.claude/settings.json` | Create new with cdk@lisa |
| `rails/copy-overwrite/.claude/settings.json` | Create new with rails@lisa |
| `all/deletions.json` | Add ~66 new paths |
| `typescript/deletions.json` | Add 10 new paths |
| `expo/deletions.json` | Create new (27+ paths) |
| `nestjs/deletions.json` | Create new (4 paths) |
| `rails/deletions.json` | Add 8 paths |
| `all/copy-overwrite/.claude/agents/` | Delete directory |
| `all/copy-overwrite/.claude/commands/` | Delete directory |
| `all/copy-overwrite/.claude/skills/` | Delete directory |
| `all/copy-overwrite/.claude/hooks/*.sh` | Delete 9 scripts |
| `all/copy-overwrite/.claude/rules/coding-philosophy.md` | Delete |
| `all/copy-overwrite/.claude/rules/verfication.md` | Delete |
| `typescript/copy-overwrite/.claude/hooks/` | Delete directory |
| `typescript/copy-overwrite/.claude/skills/` | Delete directory |
| `expo/copy-overwrite/.claude/agents/` | Delete directory |
| `expo/copy-overwrite/.claude/skills/` | Delete directory |
| `expo/copy-overwrite/.claude/rules/expo-verification.md` | Delete |
| `nestjs/copy-overwrite/.claude/skills/` | Delete directory |
| `rails/copy-overwrite/.claude/skills/` | Delete directory |
| `all/copy-overwrite/.claude/rules/lisa.md` | Update content |
| `.lisa-manifest` | Remove deleted path entries |
