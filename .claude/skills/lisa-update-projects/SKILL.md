---
name: lisa-update-projects
description: This skill should be used when updating local Lisa projects in batches. It reads the project list from .lisa.config.local.json, checks out the target branch, pulls the latest, creates an update branch, runs the package manager update for @codyswann/lisa, migrates legacy CI workflows, checks for upstream changes, then commits, pushes, and opens a PR for each project.
---

# Lisa Update Projects

Updates local Lisa projects in batches by running the package manager update command for `@codyswann/lisa` in each configured project, which triggers Lisa's postinstall script to apply template changes automatically.

## Instructions

1. Read @.lisa.config.local.json to get the list of projects and their target branches.
2. For each project directory, checkout the target branch and pull the latest from the remote.
3. If you can't because of existing changes or a dirty worktree, don't do anything. Ask the human what should be done about it before moving on.
4. Once you have resolution, within each clean project, check out a new branch (e.g. `chore/lisa-update-YYYY-MM-DD`).
5. Check if `@codyswann/lisa` is in the project's `trustedDependencies` array in `package.json`. If missing, add it using `jq`. Bun only runs postinstall scripts for trusted packages, so without this entry Lisa's postinstall (template application and file deletions) is silently skipped.
6. Run the project's package manager update command for `@codyswann/lisa` (e.g. `bun update @codyswann/lisa` or `npm update @codyswann/lisa`). This triggers Lisa's postinstall script which applies templates automatically.
   6b. If the project has BOTH `bun.lock` AND `package-lock.json` (dual-lockfile CDK or infra repo), regenerate the npm lockfile too: run `npm install --package-lock-only --ignore-scripts` and include the resulting `package-lock.json` in the commit. CI that uses `npm ci` will fail otherwise. Evidence: thumbwar-infrastructure PR #103 needed this fix. Also applies to any repo where CI uses `npm ci` but the `bun update` step only refreshes `bun.lock`.
7. After updating, check if `@codyswann/lisa` appears in the project's `dependencies` (not `devDependencies`). If so, move it: remove from `dependencies` and ensure it's in `devDependencies`. Use `jq` to check and the package manager to reinstall correctly.
8. Check for legacy inline Claude workflows that need migration. For each file in `.github/workflows/` matching `claude*.yml`, `claude*.yaml`, `auto-update-pr-branches.yml`, `auto-update-pr-branches.yaml`, `ci.yml`, `ci.yaml`, `deploy.yml`, and `deploy.yaml`:
   - If the workflow has inline `steps:` blocks instead of calling `uses: CodySwannGT/lisa/.github/workflows/reusable-*.yml@main`, it is legacy.
   - Detect project capabilities independently (Rails: has `bin/rails` or `config/application.rb`; TypeScript: has `tsconfig.json` or `package.json` with TypeScript signals). A repo may be both.
   - Apply per-file mapping rules — not a single repo-wide template selection — so dual-stack repos get the correct template for each workflow file:
     - `ci.yml`/`ci.yaml` in a Rails project → `rails/create-only/.github/workflows/ci.yml` (calls `quality-rails.yml@main`)
     - `deploy.yml`/`deploy.yaml` in a Rails project → `rails/create-only/.github/workflows/deploy.yml` (calls `release-rails.yml@main`)
     - `ci.yml`/`ci.yaml` in a TypeScript-only project → `typescript/create-only/.github/workflows/ci.yml` (calls `quality.yml@main`)
     - `claude*.yml`/`claude*.yaml` → `typescript/create-only/.github/workflows/` (e.g., `claude.yml` → `reusable-claude.yml@main`, `claude-ci-auto-fix.yml` → `reusable-claude-ci-auto-fix.yml@main`)
     - `auto-update-pr-branches.yml`/`auto-update-pr-branches.yaml` → `typescript/create-only/.github/workflows/` (calls `reusable-auto-update-pr-branches.yml@main`)
   - The create-only templates are the source of truth for the correct caller format.
9. Remove stale `file:` references to bundled ESLint plugins from the project's `package.json`. Previous Lisa versions copied plugin directories and added `file:./` dependencies; current Lisa deletes the directories but the `package.json` references remain. Use `jq` to remove these keys from both `dependencies` and `devDependencies` if they exist:
   - `eslint-plugin-code-organization`
   - `eslint-plugin-component-structure`
   - `eslint-plugin-ui-standards`
10. Remove stale `$CLAUDE_PROJECT_DIR/.claude/hooks/` references from the project's `.claude/settings.json`. Previous Lisa versions installed hook scripts into the project's `.claude/hooks/` directory and registered them in `.claude/settings.json`. Current Lisa deletes these scripts via `all/deletions.json` and provides them through the plugin system (`${CLAUDE_PLUGIN_ROOT}/hooks/` in `plugin.json`) instead. The settings.json references to the deleted scripts cause "No such file or directory" errors. Use `jq` to:
   - Remove any hook entry objects where the `command` contains `$CLAUDE_PROJECT_DIR/.claude/hooks/`
   - Remove entire hook matcher blocks that become empty after removing those entries
   - Remove entire hook category arrays that have no remaining matcher blocks
   - Preserve all non-file-path hook entries (inline commands like `echo ...`, `command -v entire ...`, etc.)
11. Update create-only workflow schedules that have drifted from the current templates. For each create-only workflow in `.github/workflows/` (e.g., `claude-nightly-jira-triage.yml`), compare the `cron` schedule against the corresponding template in `typescript/create-only/.github/workflows/` (or `rails/create-only/` for Rails projects) in the Lisa repo. If the project's schedule differs from the template, update it to match. For example, if the template uses `0 */2 * * *` but the project still has `0 6 * * 1-5`, update the project file.
12. Check `git diff` to see if the project changed any Lisa-managed files. If so, examine them to see if any changes need to be upstreamed back to Lisa and do so if necessary.
13. Commit, push, and PR the branch to the project's target branch specified in @.lisa.config.local.json.
14. If you hit any pre-push blockers, fix them and upstream anything that needs to. Do not lower any thresholds to get around a pre-push block. Instead, fix the code.

For steps 4-13, use up to 4 parallel subagents to accomplish those steps.

## Fixing Upstream Bugs

If the Lisa postinstall crashes, rolls back changes, or applies incorrect templates during a project update, **do not just work around it in the downstream project**. Instead:

1. Diagnose the root cause in the Lisa source code at the current working directory.
2. Fix the bug in Lisa (create a branch, commit, push, and open a PR).
3. Wait for the fix to merge and release before continuing project updates, OR apply the workaround in downstream projects only as a temporary measure while the upstream fix is in flight.

Common symptoms that indicate an upstream Lisa bug:
- Postinstall crashes with errors (e.g., missing function, module resolution failures)
- Templates from a parent stack (typescript) overwriting child stack templates (expo, nestjs, cdk) — this means the postinstall crashed after applying parent templates but before child templates could override them, triggering a rollback
- Rollback messages in the postinstall output (`[WARN] Rolling back changes...`) followed by an error
- Files that should be stack-specific (eslint.config.ts, tsconfig.json, knip.json) containing generic TypeScript config instead of the expected child stack config

The goal is to fix bugs at the source so they don't recur on every future update across all projects.
