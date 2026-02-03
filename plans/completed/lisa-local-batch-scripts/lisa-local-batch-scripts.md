# Plan: Lisa Local Project Batch Update & PR Scripts

## Summary

Create two bash scripts and corresponding `package.json` entries that batch-operate on local Lisa-managed projects defined in `.lisa.config.local.json`:

1. **`lisa:update:local`** - Checkout target branches, pull latest, apply Lisa templates
2. **`lisa:commit-and-pr:local`** - Commit changes and open PRs for each updated project

## Branch

Create branch `feat/lisa-local-batch-scripts` from `main`.

## Pull Request

Open draft PR to `main` after implementation.

## Files to Create

### `scripts/lisa-update-local.sh`

For each project in `.lisa.config.local.json`:
1. Expand `~` to `$HOME` in the project path
2. Validate directory exists
3. `cd` into the project directory
4. `git checkout <target-branch>`
5. `git pull origin <target-branch>`
6. `cd` back to Lisa root
7. `bun run dev <project-path> -y` (applies Lisa templates non-interactively)

Supports `--dry-run` flag (passes `--dry-run` to Lisa CLI and skips git operations).

### `scripts/lisa-commit-and-pr-local.sh`

For each project in `.lisa.config.local.json`:
1. Expand `~` to `$HOME`, validate directory exists
2. `cd` into the project directory
3. Check for changes via `git status --porcelain` - skip if clean
4. Create branch `chore/lisa-update-YYYY-MM-DD` (if name collision, append `-2`, `-3`, etc.)
5. `git add -A`
6. `git commit -m "chore: update Lisa configuration"`
7. `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" git push -u origin <branch>`
8. `gh pr create --title "chore: update Lisa configuration" --base <target-branch>`

Supports `--dry-run` flag (logs what would happen without executing).

## Files to Modify

### `package.json`

Add to `"scripts"`:
```json
"lisa:update:local": "bash scripts/lisa-update-local.sh",
"lisa:commit-and-pr:local": "bash scripts/lisa-commit-and-pr-local.sh"
```

## Implementation Patterns

Both scripts follow existing patterns from `scripts/cleanup-github-branches.sh`:
- `set -euo pipefail`
- Color-coded logging (`log_info`, `log_success`, `log_error`, `log_warning`, `log_dry_run`)
- `SCRIPT_DIR` / `LISA_ROOT` derivation
- `jq` for JSON parsing (project rule: no grep/sed/awk for JSON)
- `--dry-run` support
- Summary output at end (successes/failures/skipped)

Key technical details:
- Use process substitution (`while read ... done < <(jq ...)`) to avoid subshell counter loss
- Tilde expansion: `"${project_path/#\~/$HOME}"`
- Failures in one project log error and `continue` to next (don't abort batch)
- Branch name collision: check `git show-ref --verify --quiet "refs/heads/$branch"` and increment suffix
- Existing PR detection: `gh pr list --head <branch> --base <target> --state open`

## Reusable Code References

- `scripts/cleanup-github-branches.sh` - Color constants, log functions, dry-run pattern, `set -euo pipefail`
- `scripts/github-status-check.sh` - SCRIPT_DIR/PROJECT_ROOT derivation, multi-repo iteration, summary output
- `src/cli/index.ts:41-46` - Confirms `-y` and `-n/--dry-run` CLI flags

## Skills to Use During Execution

- `/coding-philosophy` - Always required
- `/jsdoc-best-practices` - For script preamble documentation
- `/git:commit-and-submit-pr` - For the final commit and PR of these changes to Lisa itself

## Task List

Create the following tasks using `TaskCreate`:

### Task 1: Create `scripts/lisa-update-local.sh`

**Type:** Task
**Description:** Create the bash script that iterates over `.lisa.config.local.json`, checks out target branches, pulls latest, and runs `bun run dev <path> -y` for each project. Follow patterns from `scripts/cleanup-github-branches.sh` for logging, colors, and dry-run support. Use `jq` for JSON parsing. Handle edge cases: missing directories, checkout failures (dirty worktree), pull failures, Lisa CLI failures. Use process substitution to avoid subshell counter issues.
**Verification:** `bash scripts/lisa-update-local.sh --dry-run` exits 0 and prints project list with dry-run messages
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "manual-check", "command": "bash scripts/lisa-update-local.sh --dry-run", "expected": "Lists all projects from config with [DRY-RUN] messages, exits 0" } }`

### Task 2: Create `scripts/lisa-commit-and-pr-local.sh`

**Type:** Task
**Description:** Create the bash script that iterates over `.lisa.config.local.json`, creates date-stamped branches, commits changes, pushes, and opens PRs. Follow patterns from `scripts/cleanup-github-branches.sh`. Use `jq` for JSON parsing. Handle: no changes (skip), branch name collisions (append suffix), existing PRs (log and skip), push failures, PR creation failures. Use `GIT_SSH_COMMAND` for push. Use `gh pr create` for PRs.
**Verification:** `bash scripts/lisa-commit-and-pr-local.sh --dry-run` exits 0 and prints project list with dry-run messages
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "manual-check", "command": "bash scripts/lisa-commit-and-pr-local.sh --dry-run", "expected": "Lists all projects from config with [DRY-RUN] messages for branch creation, commit, push, and PR, exits 0" } }`

### Task 3: Add package.json script entries

**Type:** Task
**Description:** Add `"lisa:update:local"` and `"lisa:commit-and-pr:local"` script entries to `package.json`. Also check if `package.lisa.json` needs a corresponding update (likely not since these are local-only convenience scripts).
**Verification:** `jq '.scripts["lisa:update:local"], .scripts["lisa:commit-and-pr:local"]' package.json` returns both values
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "jq '.scripts[\"lisa:update:local\"], .scripts[\"lisa:commit-and-pr:local\"]' package.json", "expected": "\"bash scripts/lisa-update-local.sh\"\n\"bash scripts/lisa-commit-and-pr-local.sh\"" } }`

### Task 4: Test both scripts with `--dry-run`

**Type:** Task
**Description:** Run both scripts with `--dry-run` to verify they correctly parse `.lisa.config.local.json`, expand paths, validate directories, and produce expected output without making changes.
**Verification:** Both scripts exit 0 with dry-run output
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "bash scripts/lisa-update-local.sh --dry-run && bash scripts/lisa-commit-and-pr-local.sh --dry-run", "expected": "Both scripts print project lists with [DRY-RUN] messages and exit 0" } }`

### Task 5: Review code with CodeRabbit

**Type:** Task
**Description:** Run CodeRabbit code review on the changes using `/coderabbit:review`.
**Skills:** `/coderabbit:review`
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/coderabbit:review"], "verification": { "type": "manual-check", "command": "N/A - review output", "expected": "Review completed with findings addressed" } }`

### Task 6: Review code with local code review

**Type:** Task
**Description:** Run local code review using `/plan-local-code-review`.
**Skills:** `/plan-local-code-review`
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/plan-local-code-review"], "verification": { "type": "manual-check", "command": "N/A - review output", "expected": "Review completed with findings addressed" } }`

### Task 7: Implement valid review suggestions

**Type:** Task
**Description:** Address valid suggestions from both CodeRabbit and local code review.
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "bash scripts/lisa-update-local.sh --dry-run && bash scripts/lisa-commit-and-pr-local.sh --dry-run", "expected": "Scripts still work correctly after review changes" } }`

### Task 8: Simplify implemented code

**Type:** Task
**Description:** Run code simplifier agent on the implemented scripts to reduce complexity.
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "bash scripts/lisa-update-local.sh --dry-run", "expected": "Scripts still function correctly after simplification" } }`

### Task 9: Update/add/remove tests

**Type:** Task
**Description:** These are bash scripts, so tests are manual verification commands. Ensure `--dry-run` mode exercises all code paths. Document test commands in PR description.
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "bash scripts/lisa-update-local.sh --dry-run && bash scripts/lisa-commit-and-pr-local.sh --dry-run", "expected": "Both dry-run executions pass" } }`

### Task 10: Update/add/remove documentation

**Type:** Task
**Description:** Ensure script preambles have proper JSDoc-style documentation. Update any relevant docs if needed.
**Skills:** `/jsdoc-best-practices`
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "documentation", "command": "head -20 scripts/lisa-update-local.sh && head -20 scripts/lisa-commit-and-pr-local.sh", "expected": "Both scripts have proper preamble documentation" } }`

### Task 11: Verify all verification metadata

**Type:** Task
**Description:** Run all verification commands from all tasks and confirm they produce expected output.
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "bash scripts/lisa-update-local.sh --dry-run && bash scripts/lisa-commit-and-pr-local.sh --dry-run", "expected": "All verifications pass" } }`

### Task 12: Archive the plan

**Type:** Task
**Description:** Archive this plan:
1. Create folder `lisa-local-batch-scripts` in `./plans/completed`
2. Rename this plan to `lisa-local-batch-scripts.md`
3. Move it into `./plans/completed/lisa-local-batch-scripts/`
4. Read session IDs from `./plans/completed/lisa-local-batch-scripts/lisa-local-batch-scripts.md`
5. For each session ID, move `~/.claude/tasks/<session-id>` to `./plans/completed/lisa-local-batch-scripts/tasks`
6. Update any `in_progress` tasks to `completed`
7. Commit changes
8. Push changes to the PR
**Metadata:** `{ "plan": "iridescent-imagining-pixel", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "ls ./plans/completed/lisa-local-batch-scripts/", "expected": "Plan file and tasks directory present" } }`

### Task Dependencies

- Tasks 1, 2, 3: Run in parallel (no dependencies)
- Task 4: Blocked by Tasks 1, 2, 3
- Tasks 5, 6: Run in parallel, blocked by Task 4
- Task 7: Blocked by Tasks 5, 6
- Task 8: Blocked by Task 7
- Tasks 9, 10: Run in parallel, blocked by Task 8
- Task 11: Blocked by Tasks 9, 10
- Task 12: Blocked by Task 11

## Verification

End-to-end test flow:
1. `bun run lisa:update:local --dry-run` - verify it lists all projects and simulates operations
2. `bun run lisa:commit-and-pr:local --dry-run` - verify it lists all projects and simulates commit/PR
3. `bun run lisa:update:local` - run for real against local projects
4. Review changes in each project
5. `bun run lisa:commit-and-pr:local` - commit and PR for real

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| 83cfb592-8503-4263-90f0-cacdbb697fcb | 2026-02-03T21:08:49Z | plan |
