# Nest plugin commands and unify namespace to `/lisa:`

## Context

Two issues with plugin skills/commands in downstream projects:

1. **Name collision**: Commands and skills share flat names (e.g., `git-commit` exists as both `skills/git-commit/SKILL.md` and `commands/git-commit.md`), causing commands to be shadowed by skills.
2. **Inconsistent prefix**: Skills/commands show as `/expo:git-commit` instead of `/lisa:git-commit` because plugin.json `name` is `"expo"`.

## Changes

### 1. Rename plugins to `lisa-*` in both plugin.json and marketplace.json

**plugin.json** (controls runtime prefix):
- `plugins/src/typescript/.claude-plugin/plugin.json` — `"name": "typescript"` → `"name": "lisa-typescript"`
- `plugins/src/expo/.claude-plugin/plugin.json` — `"name": "expo"` → `"name": "lisa-expo"`
- `plugins/src/nestjs/.claude-plugin/plugin.json` — `"name": "nestjs"` → `"name": "lisa-nestjs"`
- `plugins/src/cdk/.claude-plugin/plugin.json` — `"name": "cdk"` → `"name": "lisa-cdk"`
- `plugins/src/rails/.claude-plugin/plugin.json` — `"name": "rails"` → `"name": "lisa-rails"`

**marketplace.json** (controls settings key):
- `.claude-plugin/marketplace.json` — update all 5 plugin names to match

Settings keys change from `expo@lisa` to `lisa-expo@lisa`, etc. Files referencing old keys:
- `typescript/merge/.claude/settings.json` — `typescript@lisa` → `lisa-typescript@lisa`
- `expo/merge/.claude/settings.json` — `expo@lisa` → `lisa-expo@lisa`
- `nestjs/merge/.claude/settings.json` — `nestjs@lisa` → `lisa-nestjs@lisa`
- `cdk/merge/.claude/settings.json` — `cdk@lisa` → `lisa-cdk@lisa`
- `rails/merge/.claude/settings.json` — `rails@lisa` → `lisa-rails@lisa`
- `.claude/settings.json` (Lisa repo itself) — `typescript@lisa` → `lisa-typescript@lisa`
- `scripts/install-claude-plugins.sh` — `expo@lisa` → `lisa-expo@lisa`

### 2. Restructure `plugins/src/base/commands/` from flat to nested

| Old (flat) | New (nested) | Command name |
|---|---|---|
| `git-commit.md` | `git/commit.md` | `/lisa-*:git:commit` |
| `git-commit-and-submit-pr.md` | `git/commit-and-submit-pr.md` | `/lisa-*:git:commit-and-submit-pr` |
| `git-commit-submit-pr-and-verify.md` | `git/commit-submit-pr-and-verify.md` | `/lisa-*:git:commit-submit-pr-and-verify` |
| `git-commit-submit-pr-deploy-and-verify.md` | `git/commit-submit-pr-deploy-and-verify.md` | `/lisa-*:git:commit-submit-pr-deploy-and-verify` |
| `git-prune.md` | `git/prune.md` | `/lisa-*:git:prune` |
| `git-submit-pr.md` | `git/submit-pr.md` | `/lisa-*:git:submit-pr` |
| `jira-add-journey.md` | `jira/add-journey.md` | `/lisa-*:jira:add-journey` |
| `jira-create.md` | `jira/create.md` | `/lisa-*:jira:create` |
| `jira-evidence.md` | `jira/evidence.md` | `/lisa-*:jira:evidence` |
| `jira-fix.md` | `jira/fix.md` | `/lisa-*:jira:fix` |
| `jira-implement.md` | `jira/implement.md` | `/lisa-*:jira:implement` |
| `jira-journey.md` | `jira/journey.md` | `/lisa-*:jira:journey` |
| `jira-sync.md` | `jira/sync.md` | `/lisa-*:jira:sync` |
| `jira-verify.md` | `jira/verify.md` | `/lisa-*:jira:verify` |
| `plan-add-test-coverage.md` | `plan/add-test-coverage.md` | `/lisa-*:plan:add-test-coverage` |
| `plan-create.md` | `plan/create.md` | `/lisa-*:plan:create` |
| `plan-execute.md` | `plan/execute.md` | `/lisa-*:plan:execute` |
| `plan-fix-linter-error.md` | `plan/fix-linter-error.md` | `/lisa-*:plan:fix-linter-error` |
| `plan-local-code-review.md` | `plan/local-code-review.md` | `/lisa-*:plan:local-code-review` |
| `plan-lower-code-complexity.md` | `plan/lower-code-complexity.md` | `/lisa-*:plan:lower-code-complexity` |
| `plan-reduce-max-lines-per-function.md` | `plan/reduce-max-lines-per-function.md` | `/lisa-*:plan:reduce-max-lines-per-function` |
| `plan-reduce-max-lines.md` | `plan/reduce-max-lines.md` | `/lisa-*:plan:reduce-max-lines` |
| `sonarqube-check.md` | `sonarqube/check.md` | `/lisa-*:sonarqube:check` |
| `sonarqube-fix.md` | `sonarqube/fix.md` | `/lisa-*:sonarqube:fix` |
| `security-zap-scan.md` | `security/zap-scan.md` | `/lisa-*:security:zap-scan` |
| `tasks-load.md` | `tasks/load.md` | `/lisa-*:tasks:load` |
| `tasks-sync.md` | `tasks/sync.md` | `/lisa-*:tasks:sync` |
| `pull-request-review.md` | `pull-request/review.md` | `/lisa-*:pull-request:review` |
| `lisa-review-implementation.md` | `review/implementation.md` | `/lisa-*:review:implementation` |

### 3. No content changes needed

Command file contents stay the same — they reference skills via flat names (`/lisa:git-commit`), which are unaffected by the command nesting. No skills reference commands.

### 4. Rebuild plugins

Run `bun run build:plugins` to regenerate all 5 built `plugins/lisa-*` directories.

## Verification

1. `find plugins/src/base/commands/ -name "*.md" | wc -l` — should be 29
2. `ls plugins/src/base/commands/` — should show only subdirectories, no flat `.md` files
3. `bun run build:plugins` — should succeed
4. `find plugins/lisa-expo/commands/ -name "*.md" | wc -l` — should be 29
5. `jq '.name' plugins/lisa-expo/.claude-plugin/plugin.json` — should be `"lisa-expo"`
6. `jq '.name' plugins/lisa-typescript/.claude-plugin/plugin.json` — should be `"lisa-typescript"`
7. `grep -r 'expo@lisa\|typescript@lisa\|nestjs@lisa\|cdk@lisa\|rails@lisa' . --include='*.json' --include='*.sh'` — should return no results (all migrated to `lisa-*@lisa`)
