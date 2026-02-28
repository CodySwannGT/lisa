# Lisa → Distributable Claude Plugins

## Context

Lisa currently works as a **CLI that deploys files into downstream projects** — copying `.claude/` directories (skills, agents, hooks, rules, commands) plus config files (ESLint, tsconfig, GitHub workflows, package.json governance) on every `lisa` run.

Claude Code's new plugin system offers a better distribution mechanism for the `.claude/` portions: instead of Lisa *pushing* files into projects, projects can *pull* functionality by installing plugins. This eliminates the file-copy maintenance burden, enables independent versioning per capability domain, and allows teams to compose only what they need.

**The key architectural shift:**
- **Lisa CLI (remains)** → deploys project-level config files only: ESLint, tsconfig, package.json governance, GitHub workflows, prettier, commitlint
- **Lisa Plugins (new)** → replaces `.claude/` deployment: skills, agents, hooks, rules

---

## Plugin Structure (per the spec)

Each plugin directory needs:
```
lisa-<stack>/
├── .claude-plugin/
│   └── plugin.json        # name, version, description, author
├── commands/              # User-facing slash commands (pass-through to skills)
├── skills/                # SKILL.md implementations
├── agents/                # Agent definitions
├── rules/                 # Plain markdown files (not Claude-recognized, read via hook)
│   ├── coding-philosophy.md
│   └── verfication.md
└── hooks/
    └── hooks.json         # Hook event handlers (includes UserPromptSubmit to inject rules)
```

Skills are namespaced: `/lisa-typescript:git-commit` instead of `/git:commit`.

**Rules injection pattern** — since plugins have no `rules/` concept, a `UserPromptSubmit` hook reads the files from `${CLAUDE_PLUGIN_ROOT}/rules/` and outputs their contents, which Claude receives as context before processing every prompt. This replicates the auto-load behavior of `.claude/rules/*.md`.

---

## Recommended Plugin Breakdown

### Bundled Stack Approach: One plugin per stack, each self-contained

Each stack plugin includes everything from `all/` (git, plan, JIRA, quality, agents, hooks) **plus** its stack-specific content. Teams install exactly one plugin. No dependency management, no install order.

---

### Plugin 1: `lisa-typescript`

**What:** Everything a TypeScript project needs — all universal skills/agents/hooks from `all/` + TypeScript-specific content.

**Source directories:**
- `all/copy-overwrite/.claude/` → full merge into plugin
- `typescript/copy-overwrite/.claude/` → merged on top (stack-specific overrides)

**Agents:** All 16 specialist agents (implementer, quality-specialist, security-specialist, test-specialist, product-specialist, debug-specialist, performance-specialist, architecture-specialist, git-history-analyzer, web-search-researcher, skill-evaluator, learner, agent-architect, hooks-expert, slash-command-architect, verification-specialist)

**Skills (namespaced `/lisa-typescript:*`):**
- git: commit, submit-pr, commit-and-submit-pr, prune, + full PR verify workflows
- jira: create, fix, implement, verify, journey, add-journey, evidence, sync
- plan: execute, local-code-review, add-test-coverage, fix-linter-error, reduce-max-lines, reduce-max-lines-per-function, lower-code-complexity
- quality: sonarqube-check, sonarqube-fix, zap-scan, mutation-testing
- misc: pull-request-review, tasks-load, tasks-sync, skill-creator, jsdoc-best-practices, claude-code-action

**Hooks:**
- `PostToolUse[Write|Edit]`: lint-on-edit, format-on-edit, sg-scan-on-edit
- `Stop`: verify-completion
- `UserPromptSubmit`: check-tired-boss (if applicable)
- `SessionStart`: setup-jira-cli
- `PostToolUse`: ticket-sync-reminder, track-plan-sessions, enforce-plan-rules, notify-ntfy, sync-tasks

---

### Plugin 2: `lisa-expo`

**What:** Everything a React Native/Expo project needs — all universal content + Expo-specific skills, Playwright/Maestro agents, Expo verification rules.

**Source directories:**
- `all/copy-overwrite/.claude/` → full merge
- `expo/copy-overwrite/.claude/` → merged on top

**Additional agents:** Playwright agent, React Native agent (from `expo/copy-overwrite/.claude/agents/`)

**Additional skills (on top of typescript bundle):**
- Expo-specific: Apollo Client patterns, Gluestack UI, Expo Router, Env Config, ops tools, Playwright verification helpers

**Additional hooks:** Expo-specific hooks from `expo/copy-overwrite/.claude/hooks/`

**Note on rules:** `expo/copy-overwrite/.claude/rules/expo-verification.md` is embedded into the Playwright agent's system prompt since plugins have no `rules/` mechanism.

---

### Plugin 3: `lisa-nestjs`

**What:** Everything a NestJS/GraphQL backend needs.

**Source directories:**
- `all/copy-overwrite/.claude/` → full merge
- `nestjs/copy-overwrite/.claude/` → merged on top

**Additional content:** NestJS/GraphQL patterns, TypeORM skills, NestJS-specific agents

---

### Plugin 4: `lisa-cdk`

**What:** Everything an AWS CDK project needs.

**Source directories:**
- `all/copy-overwrite/.claude/` → full merge
- `cdk/copy-overwrite/.claude/` → merged on top

---

### Plugin 5: `lisa-rails`

**What:** Everything a Ruby on Rails project needs.

**Source directories:**
- `all/copy-overwrite/.claude/` → full merge
- `rails/copy-overwrite/.claude/` → merged on top

**Additional content:** ActionController, ActionView, ActiveRecord skills; Rails-specific plan commands

---

## What Lisa CLI Continues to Manage

The CLI (`src/`) becomes a thin wrapper responsible for:

1. **Config file deployment** (everything outside `.claude/`):
   - ESLint config files (`eslint.config.ts`, `eslint.base.ts`, stack-specific configs)
   - Jest configs, tsconfig files
   - `package.json` governance (force/defaults/merge via `package.lisa.json`)
   - GitHub Actions workflows
   - `.prettierrc.json`, `.lintstagedrc.json`, `commitlint.config.cjs`
   - `.gitleaksignore`, `.coderabbit.yml`, `.yamllint`, etc.
   - `ast-grep/*` rules
   - Manifest tracking (`.lisa-manifest`)
   - `coding-philosophy.md` and `verfication.md` as `copy-overwrite` (rules can't be pluginized)

2. **Auto-installing the right plugin** after config deployment:
   ```bash
   claude plugin install lisa-typescript --scope project   # for TypeScript stack
   claude plugin install lisa-expo --scope project          # for Expo stack
   # etc.
   ```

The `all/`, `typescript/`, `expo/` etc. stack directories **still exist** in Lisa for deploying config files — but their `.claude/` subdirectories are removed (plugins handle that now), except for `rules/*.md` files.

---

## Migration Strategy

### Phase 1: Build plugins alongside existing deployment (no breaking changes)
1. Create plugin directories in a new `plugins/` top-level directory in Lisa repo:
   ```
   plugins/
   ├── lisa-typescript/
   │   ├── .claude-plugin/plugin.json
   │   ├── agents/
   │   ├── skills/
   │   ├── hooks/
   │   └── commands/
   ├── lisa-expo/
   ├── lisa-nestjs/
   ├── lisa-cdk/
   └── lisa-rails/
   ```
2. Publish each plugin to a marketplace (GitHub-based or Anthropic official)
3. Test against downstream projects using `claude --plugin-dir`

### Phase 2: Wire CLI to auto-install plugins
1. Add `claude plugin install <detected-stack> --scope project` call to `src/core/lisa.ts` post-deployment
2. Update `deletions.json` for each stack to remove the old `.claude/` managed files (except `rules/`)
3. Remove `.claude/` subtrees from `all/`, `typescript/`, `expo/`, etc. stack template directories

### Phase 3: Plugin-only distribution
1. `lisa` CLI handles only config files + plugin install trigger
2. Plugin versions independently managed (bump `plugin.json` version to push updates to all users)
3. Downstream projects benefit from plugin updates without needing to re-run `lisa`

---

## Key Naming Changes

All skills are namespaced under their stack plugin name. The namespace is the same regardless of stack (typescript, expo, etc. all use the same skill names, just different namespace prefix):

| Current (standalone)          | Plugin equivalent (TypeScript) |
|-------------------------------|-------------------------------|
| `/jira:create`                | `/lisa-typescript:jira-create` |
| `/git:commit`                 | `/lisa-typescript:git-commit` |
| `/plan:execute`               | `/lisa-typescript:plan-execute` |
| `/sonarqube:check`            | `/lisa-typescript:sonarqube-check` |
| `/mutation-testing:run`       | `/lisa-typescript:mutation-testing` |

> **Note:** Skill names within the plugin use hyphen-separated names (e.g., `jira-create`), not colon-separated (e.g., `jira:create`), since the colon is reserved for the namespace separator.

---

## Benefits of the Plugin Approach

1. **No file drift** — downstream projects don't get stale copies; plugin updates are immediate
2. **Independent versioning** — can update `lisa-jira` to `2.0` without touching `lisa-git`
3. **Composable** — teams install only the plugins they need (`lisa-core` + `lisa-git` for a simple TypeScript project)
4. **Marketplace distribution** — submit to Anthropic's official marketplace; installable with `/plugin install`
5. **Elimination of the manifest** — `.lisa-manifest` was needed to track deployed `.claude/` files; plugins remove this complexity
6. **Faster adoption** — new projects run one command to install a plugin instead of running the `lisa` CLI

## Resolved Questions

1. **Rules/documentation** — Solved via `UserPromptSubmit` hook. Store rule files at `${CLAUDE_PLUGIN_ROOT}/rules/` (just a plain directory, not a Claude-recognized location) and use a hook to inject them into every prompt:
   ```json
   {
     "hooks": {
       "UserPromptSubmit": [
         {
           "hooks": [
             {
               "type": "command",
               "command": "find ${CLAUDE_PLUGIN_ROOT}/rules -name '*.md' -exec cat {} \\;"
             }
           ]
         }
       ]
     }
   }
   ```
   This is functionally identical to `.claude/rules/` auto-loading. The hook fires before every prompt, Claude sees all rule files as injected context. Adding a new `.md` file to `rules/` in the plugin automatically gets picked up — no hook changes needed. Lisa CLI no longer needs to deploy `coding-philosophy.md` or `verfication.md` as `copy-overwrite` files.

2. **Plugin dependencies** — Resolved by the bundled approach: no inter-plugin dependencies since each stack plugin is self-contained.

3. **Lisa CLI role** — Thin wrapper: deploy config files + auto-install the detected stack plugin.

4. **Hooks with credentials** — `setup-jira-cli.sh` and similar hooks that need env vars will document required secrets in plugin README and in the SKILL.md for the relevant skill.
