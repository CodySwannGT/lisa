---
description: "Updates local Lisa projects in batches"
---

1. Read @.lisa.config.local.json to get the list of projects and their target branches.
2. For each project directory, checkout the target branch and pull the latest from the remote.
3. If you can't because of existing changes or a dirty worktree, don't do anything. Ask the human what should be done about it before moving on.
4. Once you have resolution, within each clean project, check out a new branch (e.g. `chore/lisa-update-YYYY-MM-DD`).
5. Run the project's package manager update command for `@codyswann/lisa` (e.g. `bun update @codyswann/lisa` or `npm update @codyswann/lisa`). This triggers Lisa's postinstall script which applies templates automatically.
6. Check for legacy inline Claude workflows that need migration. For each file in `.github/workflows/` matching `claude*.yml`, `auto-update-pr-branches.yml`, and `ci.yml`:
   - If the workflow has inline `steps:` blocks instead of calling `uses: CodySwannGT/lisa/.github/workflows/reusable-*.yml@main`, it is legacy.
   - Replace each legacy workflow file with the corresponding create-only template from `typescript/create-only/.github/workflows/` in the Lisa repo. These are thin callers that delegate to the reusable workflows at `@main`.
   - The create-only templates are the source of truth for the correct caller format.
   - Key mappings: `ci.yml` → calls `quality.yml@main`, `claude.yml` → calls `reusable-claude.yml@main`, `claude-ci-auto-fix.yml` → calls `reusable-claude-ci-auto-fix.yml@main`, `auto-update-pr-branches.yml` → calls `reusable-auto-update-pr-branches.yml@main`, and similarly for all other `claude-*.yml` workflows.
7. Check `git diff` to see if the project changed any Lisa-managed files. If so, examine them to see if any changes need to be upstreamed back to Lisa and do so if necessary.
8. Commit, push, and PR the branch to the project's target branch specified in @.lisa.config.local.json.
9. If you hit any pre-push blockers, fix them and upstream anything that needs to. Do not lower any thresholds to get around a pre-push block. Instead, fix the code.

For steps 4-9, use up to 4 parallel subagents to accomplish those steps.
