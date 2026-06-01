---
name: lisa-update-projects
description: This skill should be used when updating local Lisa projects in batches. It reads the project list and each project's target branch from the .lisa.workspaces.json workspace config, then for each host project works in a dedicated git worktree based off that target branch, runs the package manager update for @codyswann/lisa, migrates legacy CI workflows, checks for upstream changes, commits, pushes, and opens a PR targeting the configured branch with auto-merge enabled, auto-fixing any blockers to mergeability (upstreaming fixes when needed). As the final step, Lisa upgrades itself.
---

# Lisa Update Projects

Updates local Lisa projects in batches by running the package manager update command for `@codyswann/lisa` in each configured project, which triggers Lisa's postinstall script to apply template changes automatically.

## Instructions

1. Read @.lisa.workspaces.json to get the list of host projects and each project's target branch. The file is a JSON map of project path → target branch (e.g. `"~/workspace/foo/backend": "staging"`); the value is the branch that project's update PR must target. Branches vary per project (`main`, `staging`, `dev`, …) — never assume `main`. Parse it with `jq`, never grep/sed.
2. For each project, `git fetch` the configured target branch from the remote so you have the latest commit to branch from.
3. Do **all** work for a host project inside a dedicated git worktree based off that project's configured target branch — never modify the project's primary checkout. Create it with the update branch in one step, e.g. `git worktree add <worktree-path>/<project>-lisa-update-YYYY-MM-DD -b chore/lisa-update-YYYY-MM-DD origin/<target-branch>`, where `<target-branch>` is the value from @.lisa.workspaces.json. This keeps the project's main working tree untouched, isolates each project's changes, and lets the parallel subagents operate without colliding. Clean up the worktree (`git worktree remove`) after the PR is opened and the branch is pushed.
4. If you can't create the worktree cleanly (e.g. an update branch already exists, the target branch can't be fetched, or the project has uncommitted changes you'd be discarding), don't do anything for that project. Ask the human what should be done about it before moving on.
5. Check if `@codyswann/lisa` is in the project's `trustedDependencies` array in `package.json`. If missing, add it using `jq`. Bun only runs postinstall scripts for trusted packages, so without this entry Lisa's postinstall (template application and file deletions) is silently skipped.
6. Determine the project's package manager from `package.json` `engines` BEFORE choosing a command. The `engines` field is authoritative — lockfile presence is not.
   - Read `engines` with `jq -r '.engines // {}' package.json`.
   - If `engines.bun === "please-use-npm"` (or `engines.yarn` / `engines.pnpm` use the same sentinel), that package manager is **forbidden**. Use `npm`.
   - If a forbidden lockfile exists anyway (e.g., `bun.lock` in a project where `engines.bun === "please-use-npm"`), it is rogue — bun ignores the engines string and writes the lockfile if invoked. Delete it (`git rm bun.lock`) and include the deletion in the commit.
   - Pick the update command from the surviving package manager:
     - `bun.lock` exists and bun is allowed → `bun add -D @codyswann/lisa@latest` (use `bun add -D <pkg>@latest`, **not** `bun update <pkg>`. `bun update` only walks within the existing semver range, so an exact-pinned `1.95.0` or a caret-pinned `^1.95.0` against a new major like `2.x` is a no-op. `bun add -D <pkg>@latest` always resolves to the latest published version and rewrites the manifest.)
     - otherwise → `npm install -D @codyswann/lisa@latest` (use `install -D` not `update`; `npm update` only bumps within the existing semver range and won't move pinned versions or update the manifest)
   - Bun's postinstall runs templates automatically; npm's does not. After `npm install -D`, manually run `node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check .` to apply templates.
   - **Never run both `bun add` and `npm install` against the same project.** That perpetuates the dual-lockfile bug. Pick one based on the engines field and stick to it.
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
13. Commit, push, and open a PR from the worktree's update branch targeting the project's configured target branch from @.lisa.workspaces.json (the PR base must be that branch — not assumed `main`). Enable auto-merge on the PR if the repository supports it (e.g. `gh pr merge --auto --squash`). If the repository has auto-merge disabled, note it and leave the PR open for manual merge — do not treat the absence of auto-merge as a failure.
14. If you hit any pre-push blockers, fix them and upstream anything that needs to. Do not lower any thresholds to get around a pre-push block. Instead, fix the code.
15. After the PR is open, drive it to a mergeable state. Poll the PR's checks and mergeability and auto-fix any blockers: failing CI checks, merge conflicts with the target branch, lint/typecheck/test failures, and required-check gates. When the root cause of a blocker is a Lisa template or postinstall bug (not project-specific code), fix it upstream in the Lisa source per "Fixing Upstream Bugs" below and propagate the fix down, rather than patching only the downstream project. Never lower thresholds or disable checks to force mergeability — fix the underlying code. Continue until the PR is mergeable (and auto-merge can complete) or you hit a blocker that genuinely requires human input, in which case stop and ask.
16. As the final step, have Lisa upgrade itself: run this same update flow against the Lisa monorepo (the current working directory) — bump `@codyswann/lisa` to latest where Lisa consumes its own templates, apply templates, and commit/push/PR a self-update branch with auto-merge enabled, following the same worktree (rule 3), auto-merge (step 13), and blocker-fixing (step 15) rules. Skip this step only if the Lisa repo has no pending self-update changes after running the flow.

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
