# Plan: Add `auto_merge` input to PR-creating Claude workflows

## Context

Nightly Claude workflows (test-coverage, code-complexity, test-improvement) and the deploy-auto-fix workflow all create PRs via `gh pr create` in Claude's prompt. Currently these PRs sit open until manually merged. Adding an `auto_merge` input (defaulting to `true`) lets Claude's PRs auto-merge once required status checks pass, reducing manual toil.

## Scope

**4 reusable workflows that create PRs:**
1. `.github/workflows/reusable-claude-nightly-test-coverage.yml`
2. `.github/workflows/reusable-claude-nightly-code-complexity.yml`
3. `.github/workflows/reusable-claude-nightly-test-improvement.yml`
4. `.github/workflows/reusable-claude-deploy-auto-fix.yml`

**4 downstream caller templates (create-only):**
1. `typescript/create-only/.github/workflows/claude-nightly-test-coverage.yml`
2. `typescript/create-only/.github/workflows/claude-nightly-code-complexity.yml`
3. `typescript/create-only/.github/workflows/claude-nightly-test-improvement.yml`
4. `typescript/create-only/.github/workflows/claude-deploy-auto-fix.yml`

**Not in scope** (don't create PRs):
- `reusable-claude-ci-auto-fix.yml` (pushes directly to failing branch)
- `reusable-claude-code-review-response.yml` (pushes to existing PR branch)

## Approach

### 1. Add `auto_merge` input to each reusable workflow

Add to the `workflow_call.inputs` section of all 4 reusable workflows:

```yaml
auto_merge:
  description: 'Enable auto-merge on created PRs (requires repo auto-merge setting enabled)'
  required: false
  default: true
  type: boolean
```

### 2. Add auto-merge step after each Claude action step

Add a new step after the Claude Code action in each workflow that finds the PR by branch prefix and enables auto-merge:

```yaml
- name: Enable auto-merge
  if: inputs.auto_merge
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    PR_URL=$(gh pr list --head "claude/<branch-prefix>" --state open --json url --jq '.[0].url' 2>/dev/null || echo "")
    if [ -n "$PR_URL" ]; then
      gh pr merge "$PR_URL" --auto --squash
      echo "Auto-merge enabled for $PR_URL"
    else
      echo "No PR found to auto-merge."
    fi
```

This is better than adding it to Claude's prompt because:
- It doesn't consume Claude turns
- It's deterministic (not dependent on Claude following instructions)
- It's visible in the workflow step logs
- It fails gracefully if the repo doesn't have auto-merge enabled

### 3. Workflow-specific details

Each workflow uses a different `branch_prefix` for `gh pr list --head`:

| Workflow | Branch prefix |
|---|---|
| test-coverage | `claude/nightly-test-coverage-` |
| code-complexity | `claude/nightly-code-complexity-` |
| test-improvement | `claude/nightly-test-improvement-` |
| deploy-auto-fix | `claude/deploy-fix-` |

**Special case: `test-improvement`** has two Claude action steps (nightly mode and general mode). The auto-merge step goes after both, with the same branch prefix since both use `claude/nightly-test-improvement-`.

**Special case: `deploy-auto-fix`** already has a post-step `check-fix` that finds the PR. The auto-merge step should go after that step and can reuse the same `gh pr list` pattern. The `if` condition also needs to include `steps.loop-guard.outputs.skip != 'true'` to match the existing guard.

### 4. Update downstream caller templates

The `auto_merge` input defaults to `true`, so no changes to caller templates are strictly required. However, for visibility, update each caller template to show the input is available (commented out or with an explicit `# auto_merge: true` comment). Since these are create-only files, this only affects newly scaffolded projects.

Actually — since `auto_merge` defaults to `true`, callers don't need to pass it. Leave caller templates unchanged. Projects that want to disable it can add `auto_merge: false` to their `with:` block.

## Files to modify

1. `.github/workflows/reusable-claude-nightly-test-coverage.yml` — add input + auto-merge step
2. `.github/workflows/reusable-claude-nightly-code-complexity.yml` — add input + auto-merge step
3. `.github/workflows/reusable-claude-nightly-test-improvement.yml` — add input + auto-merge step
4. `.github/workflows/reusable-claude-deploy-auto-fix.yml` — add input + auto-merge step

## Verification

1. YAML syntax: validate with `yamllint` or `prettier --check` on changed files
2. Review the `gh pr list --head` pattern matches the `branch_prefix` in each workflow
3. Verify the `if` conditions on auto-merge steps correctly gate on `inputs.auto_merge` and any prior step guards
4. Dry-run: trigger a nightly workflow via `workflow_dispatch` on a test repo to confirm auto-merge is enabled on the created PR
