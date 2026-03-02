# Plan: Migrate GitHub Workflows from copy-overwrite to create-only

## Context

GitHub workflows in `typescript/copy-overwrite/.github/workflows/` are overwritten on every Lisa run. This is unnecessary because the wrapper workflows already reference Lisa's reusable definitions via `CodySwannGT/lisa/.github/workflows/*.yml@main` — so updates propagate automatically. Making them `create-only` lets projects customize `with:` parameters (cron schedules, skip_jobs, etc.) without Lisa overwriting their changes. The local `reusable-*.yml` copies in downstream projects are completely redundant since the wrappers call Lisa's repo directly.

## Changes

### 1. Move 8 wrapper workflows to create-only

Move from `typescript/copy-overwrite/.github/workflows/` to `typescript/create-only/.github/workflows/`:

- `auto-update-pr-branches.yml`
- `claude.yml`
- `claude-ci-auto-fix.yml`
- `claude-code-review-response.yml`
- `claude-deploy-auto-fix.yml`
- `claude-nightly-code-complexity.yml`
- `claude-nightly-test-coverage.yml`
- `claude-nightly-test-improvement.yml`

Update each file's header from:
```yaml
# This file is managed by Lisa.
# Do not edit directly — changes will be overwritten on the next `lisa` run.
```
to:
```yaml
# This file was created by Lisa on first setup.
# You can customize this file — Lisa will not overwrite it.
```

### 2. Delete 8 reusable definitions from copy-overwrite

Delete from `typescript/copy-overwrite/.github/workflows/`:

- `reusable-auto-update-pr-branches.yml`
- `reusable-claude.yml`
- `reusable-claude-ci-auto-fix.yml`
- `reusable-claude-code-review-response.yml`
- `reusable-claude-deploy-auto-fix.yml`
- `reusable-claude-nightly-code-complexity.yml`
- `reusable-claude-nightly-test-coverage.yml`
- `reusable-claude-nightly-test-improvement.yml`

Then `rm -rf typescript/copy-overwrite/.github/workflows/` (only the workflows directory; non-workflow files like `GITHUB_ACTIONS.md` and `dependabot.yml` are preserved).

### 3. Add reusable paths to `typescript/deletions.json`

Add 8 entries to the existing `paths` array (NOT to `keep`) so downstream projects get these redundant files cleaned up:

```json
".github/workflows/reusable-auto-update-pr-branches.yml",
".github/workflows/reusable-claude.yml",
".github/workflows/reusable-claude-ci-auto-fix.yml",
".github/workflows/reusable-claude-code-review-response.yml",
".github/workflows/reusable-claude-deploy-auto-fix.yml",
".github/workflows/reusable-claude-nightly-code-complexity.yml",
".github/workflows/reusable-claude-nightly-test-coverage.yml",
".github/workflows/reusable-claude-nightly-test-improvement.yml"
```

### 4. Move `npm-package/copy-overwrite/.github/workflows/publish-to-npm.yml` to create-only

This is a reusable workflow definition with Lisa-specific steps (eslint plugin publishing). Downstream npm packages get it once as a template and customize it.

- Create `npm-package/create-only/.github/workflows/`
- Move `publish-to-npm.yml` there with updated header
- `rm -rf npm-package/copy-overwrite/.github/`

### 5. Update `.claude/rules/lisa.md`

- Remove the 8 `reusable-*.yml` entries from "Files with NO local override"
- Move the 8 wrapper workflow entries from "No local override" to "Create-only files"

## Files Modified

| File | Action |
|---|---|
| `typescript/copy-overwrite/.github/workflows/*.yml` (16 files) | Delete all |
| `typescript/create-only/.github/workflows/*.yml` (8 files) | Create (moved wrappers with updated headers) |
| `typescript/deletions.json` | Add 8 reusable paths |
| `npm-package/copy-overwrite/.github/workflows/publish-to-npm.yml` | Delete |
| `npm-package/create-only/.github/workflows/publish-to-npm.yml` | Create (moved with updated header) |
| `.claude/rules/lisa.md` | Update managed files documentation |

## Verification

1. Run `bun run lint` — ensure no lint errors
2. Run `bun run typecheck` — ensure no type errors
3. Run `bun run test` — ensure existing tests pass
4. Verify `typescript/copy-overwrite/.github/` directory no longer exists
5. Verify all 8 wrappers exist in `typescript/create-only/.github/workflows/`
6. Verify `typescript/deletions.json` has the 8 new reusable paths
7. Run `lisa . --dry-run` on a test project (if available) to confirm correct behavior
