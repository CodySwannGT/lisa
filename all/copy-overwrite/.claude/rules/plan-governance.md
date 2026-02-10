# Plan Governance

Governance rules for planning workflows. Loaded at session start via `.claude/rules/` and available to team leads during plan synthesis. Domain planners and reviewers do NOT need these rules — they focus on their specialized analysis.

## Required Behaviors

When making a plan:

- Determine which skills are needed and include them in the plan
- Verify correct versions of third-party libraries
- Look for reusable code
- If a decision is left unresolved by the human, use the recommended option
- The plan MUST include TaskCreate instructions for each task (following the Task Creation Specification in `plan.md`). Specify that subagents should handle as many tasks in parallel as possible.

Do NOT include separate tasks for linting, type-checking, or formatting. These are handled automatically by PostToolUse hooks and lint-staged pre-commit hooks.

IMPORTANT: The `## Sessions` section in plan files is auto-maintained by `track-plan-sessions.sh` -- do not manually edit it.

### Required Tasks

The following tasks are always required unless the plan includes only trivial changes:

- Product/UX review using `product-reviewer` agent
- CodeRabbit code review
- Local code review via `/plan-local-code-review`
- Technical review using `tech-reviewer` agent
- Implement valid review suggestions (run after all reviews complete)
- Simplify code using `code-simplifier` agent (run after review implementation)
- Update/add/remove tests as needed (run after review implementation)
- Update/add/remove documentation -- JSDoc, markdown files, etc. (run after review implementation)
- Verify all verification metadata in existing tasks (run after review implementation)
- Collect learnings using `learner` agent (run after all reviews and simplification)

The following task is always required regardless of plan size:

- **Archive the plan** (run after all other tasks). See the Archive Procedure section below for the full steps this task must include.

### Archive Procedure

The archive task must follow these steps exactly. All file operations MUST use `mv` via Bash -- never use Write, Edit, or copy tools, as they overwrite the `## Sessions` table maintained by `track-plan-sessions.sh`.

1. Create destination folder: `mkdir -p ./plans/completed/<plan-name>`
2. Rename the plan file to reflect its actual contents
3. Move the plan file: `mv plans/<plan-file>.md ./plans/completed/<plan-name>/<renamed>.md`
4. Verify source is gone: `! ls plans/<plan-file>.md 2>/dev/null && echo "Source removed"`
5. Parse session IDs from the `## Sessions` table in the moved plan file
6. Move each task directory: `mv ~/.claude/tasks/<session-id> ./plans/completed/<plan-name>/tasks/`
   - **Fallback** (if Sessions table is empty): `grep -rl '"plan": "<plan-name>"' ~/.claude/tasks/*/` and move parent directories of matches
7. Update any `in_progress` tasks to `completed` via TaskUpdate
8. Final git operations:
   ```bash
   git add . && git commit -m "chore: archive <plan-name> plan"
   GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" git push
   gh pr ready
   gh pr merge --auto --merge
   ```

### Branch and PR Rules

- On a protected branch (dev, staging, main): create a new branch and target the PR to the protected branch you branched from
- On a non-protected branch with an open PR: push to the existing PR
- On a non-protected branch with no PR: clarify which protected branch to target
- Open a draft pull request
- Include the branch name and PR link in the plan

### Ticket Integration

When referencing a ticket (JIRA, Linear, etc.):

- Include the ticket URL in the plan
- Update the ticket with the working branch
- Add a comment on the ticket with the finalized plan

## Git Workflow

Every plan follows this workflow to keep PRs clean:

1. **First task:** Verify/create branch and open a draft PR (`gh pr create --draft`). No implementation before the draft PR exists.
2. **During implementation:** Commits only, no pushes. Pre-commit hooks validate lint, format, and typecheck.
3. **After archive task:** One final push, then mark PR ready, then enable auto-merge (see Archive Procedure step 8).

## Implementation Team Guidance

When plans spawn an Agent Team for implementation, recommend these specialized agents:

| Agent | Use For |
|-------|---------|
| `implementer` | Code implementation (pre-loaded with project conventions) |
| `tech-reviewer` | Technical review (correctness, security, performance) |
| `product-reviewer` | Product/UX review (validates from non-technical perspective) |
| `learner` | Post-implementation learning (processes learnings into skills/rules) |
| `test-coverage-agent` | Writing comprehensive, meaningful tests |
| `code-simplifier` (plugin) | Code simplification and refinement |
| `coderabbit` (plugin) | Automated AI code review |

The **team lead** handles git operations (commits, pushes, PR management) -- teammates focus on their specialized work.
