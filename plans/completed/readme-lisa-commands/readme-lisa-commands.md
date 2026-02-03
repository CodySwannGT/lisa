# Plan: Add "Ask Claude how to use Lisa" section to all READMEs

## Branch

`feat/readme-lisa-commands-section` (branched from `main`, PR targets `main`)

## Pull Request

Draft PR to be opened during implementation.

## Summary

Add a new "Lisa Commands" section to every README template that directs users to ask Claude about available Lisa commands. When Claude sees this prompt, it reads `HUMAN.md` and summarizes the available slash commands and workflows.

## Placement

Insert a new `## Lisa Commands` section between **Step 4: Work on a Feature** and **Common Tasks** in every README. This is the natural spot because:
- It follows the setup/onboarding steps
- It precedes task-specific guidance
- It acts as a bridge: "you're set up, here's what Lisa can do for you"

## Content

The new section for template READMEs (all, expo, nestjs, cdk, npm-package):

```markdown
## Lisa Commands

> Ask Claude: "What Lisa commands are available and how do I use them? Read HUMAN.md and give me a summary."
```

For Lisa's own `README.md`, use the same section but adjust the prompt slightly since the audience is Lisa contributors/users rather than downstream project developers:

```markdown
## Lisa Commands

> Ask Claude: "What Lisa commands are available and how do I use them? Read HUMAN.md and give me a summary."
```

## Files to Modify

1. `all/copy-overwrite/README.md` - base template (all stacks inherit common structure)
2. `expo/copy-overwrite/README.md`
3. `nestjs/copy-overwrite/README.md`
4. `cdk/copy-overwrite/README.md`
5. `npm-package/copy-overwrite/README.md`
6. `README.md` - Lisa's own README

## Skills

- `/coding-philosophy`
- `/jsdoc-best-practices` (for any JSDoc if touched)
- `/git:commit`
- `/git:submit-pr`

## Task List

Create the following tasks using `TaskCreate`:

### Task 1: Add "Lisa Commands" section to all template READMEs

- **subject**: Add Lisa Commands section to all template READMEs
- **activeForm**: Adding Lisa Commands section to template READMEs
- **Description**: Add a `## Lisa Commands` section between "Step 4: Work on a Feature" and "## Common Tasks" in each template README. The section contains a single "Ask Claude" blockquote directing users to ask about Lisa commands via `HUMAN.md`.
- **Files**:
  - `all/copy-overwrite/README.md`
  - `expo/copy-overwrite/README.md`
  - `nestjs/copy-overwrite/README.md`
  - `cdk/copy-overwrite/README.md`
  - `npm-package/copy-overwrite/README.md`
- **Verification**: `grep -l "Lisa Commands" all/copy-overwrite/README.md expo/copy-overwrite/README.md nestjs/copy-overwrite/README.md cdk/copy-overwrite/README.md npm-package/copy-overwrite/README.md` returns all 5 files
- **Metadata**: `{ "plan": "curried-doodling-pearl", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "grep -c 'Lisa Commands' all/copy-overwrite/README.md expo/copy-overwrite/README.md nestjs/copy-overwrite/README.md cdk/copy-overwrite/README.md npm-package/copy-overwrite/README.md", "expected": "Each file shows count of 1" } }`

### Task 2: Add "Lisa Commands" section to Lisa's own README

- **subject**: Add Lisa Commands section to Lisa's own README.md
- **activeForm**: Adding Lisa Commands section to Lisa README
- **Description**: Add the same `## Lisa Commands` section to the root `README.md` between "Step 4" and "## Common Tasks".
- **Files**: `README.md`
- **Verification**: `grep -c "Lisa Commands" README.md` returns 1
- **Metadata**: `{ "plan": "curried-doodling-pearl", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "grep -c 'Lisa Commands' README.md", "expected": "1" } }`

### Task 3: Create branch and open draft PR

- **subject**: Create feature branch and open draft PR
- **activeForm**: Creating feature branch and draft PR
- **Description**: Create `feat/readme-lisa-commands-section` from `main`, commit changes, push, and open a draft PR targeting `main`.
- **Verification**: `gh pr view --json state,title` shows the draft PR
- **Metadata**: `{ "plan": "curried-doodling-pearl", "type": "task", "skills": ["/coding-philosophy", "/git:commit", "/git:submit-pr"], "verification": { "type": "manual-check", "command": "gh pr view --json state,title", "expected": "Draft PR exists" } }`

### Task 4: Review code with CodeRabbit

- **subject**: Review code with CodeRabbit
- **activeForm**: Running CodeRabbit code review
- **Description**: Run CodeRabbit review on the changes after implementation is complete.
- **Skills to Invoke**: `/coding-philosophy`, `/coderabbit:review`
- **Verification**: CodeRabbit review completes without critical findings
- **Metadata**: `{ "plan": "curried-doodling-pearl", "type": "task", "skills": ["/coding-philosophy", "/coderabbit:review"], "verification": { "type": "manual-check", "command": "echo 'CodeRabbit review completed'", "expected": "Review completed" } }`

### Task 5: Review code with local code review

- **subject**: Review code with local code review
- **activeForm**: Running local code review
- **Description**: Run `/plan:local-code-review` on the changes.
- **Skills to Invoke**: `/coding-philosophy`, `/plan:local-code-review`
- **Metadata**: `{ "plan": "curried-doodling-pearl", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "echo 'Local code review completed'", "expected": "Review completed" } }`

### Task 6: Implement valid review suggestions

- **subject**: Implement valid code review suggestions
- **activeForm**: Implementing code review suggestions
- **Description**: Address any valid findings from CodeRabbit and local code review.
- **Blocked by**: Task 4, Task 5
- **Metadata**: `{ "plan": "curried-doodling-pearl", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "echo 'Review suggestions implemented'", "expected": "All valid suggestions addressed" } }`

### Task 7: Simplify implemented code

- **subject**: Simplify implemented code with code-simplifier
- **activeForm**: Simplifying implemented code
- **Description**: Run code-simplifier agent on all modified files to ensure clarity and consistency.
- **Blocked by**: Task 6
- **Metadata**: `{ "plan": "curried-doodling-pearl", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "echo 'Code simplified'", "expected": "Code simplified" } }`

### Task 8: Update/verify documentation

- **subject**: Verify documentation is consistent
- **activeForm**: Verifying documentation consistency
- **Description**: Ensure all 6 README files have the identical "Lisa Commands" section (with the same Ask Claude prompt). Verify HUMAN.md content is still accurate and referenced correctly.
- **Blocked by**: Task 7
- **Metadata**: `{ "plan": "curried-doodling-pearl", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "manual-check", "command": "grep -A2 '## Lisa Commands' README.md all/copy-overwrite/README.md expo/copy-overwrite/README.md nestjs/copy-overwrite/README.md cdk/copy-overwrite/README.md npm-package/copy-overwrite/README.md", "expected": "All 6 files show identical Lisa Commands section" } }`

### Task 9: Verify all verification metadata

- **subject**: Verify all task verification commands pass
- **activeForm**: Running verification commands for all tasks
- **Description**: Run every verification command from all prior tasks and confirm they pass.
- **Blocked by**: Task 8
- **Metadata**: `{ "plan": "curried-doodling-pearl", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "echo 'All verifications passed'", "expected": "All verifications passed" } }`

### Task 10: Archive the plan

- **subject**: Archive the plan
- **activeForm**: Archiving the plan
- **Description**: After all tasks are complete:
  1. Create a folder named `readme-lisa-commands` in `./plans/completed`
  2. Rename this plan to `readme-lisa-commands.md`
  3. Move it into `./plans/completed/readme-lisa-commands/`
  4. Read the session IDs from `./plans/completed/readme-lisa-commands/readme-lisa-commands.md`
  5. For each session ID, move `~/.claude/tasks/<session-id>` directory to `./plans/completed/readme-lisa-commands/tasks`
  6. Update any "in_progress" task in `./plans/completed/readme-lisa-commands/tasks` to "completed"
  7. Commit changes
  8. Push changes to the PR
- **Blocked by**: Task 9
- **Metadata**: `{ "plan": "curried-doodling-pearl", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "ls ./plans/completed/readme-lisa-commands/", "expected": "Plan file and tasks directory exist" } }`

## Parallelization

- Tasks 1 and 2 can run in parallel (independent file edits)
- Task 3 runs after 1 and 2 (needs the changes committed)
- Tasks 4 and 5 can run in parallel after Task 3
- Tasks 6-10 are sequential (each depends on prior)

## Verification

End-to-end: After implementation, verify that all 6 README files contain the new section by running:

```bash
grep -c "## Lisa Commands" README.md all/copy-overwrite/README.md expo/copy-overwrite/README.md nestjs/copy-overwrite/README.md cdk/copy-overwrite/README.md npm-package/copy-overwrite/README.md
```

Expected: each file returns `1`.

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| 501cb606-88b3-4719-9ad7-e76f5055e003 | 2026-02-03T20:11:40Z | plan |
