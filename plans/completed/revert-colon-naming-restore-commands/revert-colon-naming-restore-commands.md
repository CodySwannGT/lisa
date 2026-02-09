# Revert Skill Naming and Restore Commands as Pass-Throughs

## Context

The previous plan (consolidate-skills-and-commands) renamed all skills from hyphen to colon naming (e.g., `git-commit` → `git:commit`) and deleted all `.claude/commands/`, based on the incorrect assumption that skills support `argument-hint` and `$ARGUMENTS` substitution. They don't. Only commands support these features.

This plan reverses the naming and restores commands as the user-facing interface, creating a clean architecture:
- **Skills** (`.claude/skills/`): Implementation logic, hyphen-named (e.g., `plan-create`), no argument hints
- **Commands** (`.claude/commands/`): User-facing interface, directory-structured (e.g., `plan/create.md` → `/plan:create`), with argument hints and `$ARGUMENTS`, pass-through to skills

**Branch:** `feat/consolidate-skills-and-commands` (existing)
**PR:** #163 (open, push to it)

## Scope

### 1. Rename 25 colon-named skill directories back to hyphen names

**Root `.claude/skills/` (25 skills):**

| Current (colon) | Target (hyphen) |
|---|---|
| `git:commit` | `git-commit` |
| `git:commit-and-submit-pr` | `git-commit-and-submit-pr` |
| `git:prune` | `git-prune` |
| `git:submit-pr` | `git-submit-pr` |
| `jira:create` | `jira-create` |
| `jira:sync` | `jira-sync` |
| `jira:verify` | `jira-verify` |
| `lisa:integration-test` | `lisa-integration-test` |
| `lisa:learn` | `lisa-learn` |
| `lisa:review-implementation` | `lisa-review-implementation` |
| `lisa:review-project` | `lisa-review-project` |
| `plan:add-test-coverage` | `plan-add-test-coverage` |
| `plan:create` | `plan-create` |
| `plan:fix-linter-error` | `plan-fix-linter-error` |
| `plan:implement` | `plan-implement` |
| `plan:local-code-review` | `plan-local-code-review` |
| `plan:lower-code-complexity` | `plan-lower-code-complexity` |
| `plan:reduce-max-lines` | `plan-reduce-max-lines` |
| `plan:reduce-max-lines-per-function` | `plan-reduce-max-lines-per-function` |
| `pull-request:review` | `pull-request-review` |
| `security:zap-scan` | `security-zap-scan` |
| `sonarqube:check` | `sonarqube-check` |
| `sonarqube:fix` | `sonarqube-fix` |
| `tasks:load` | `tasks-load` |
| `tasks:sync` | `tasks-sync` |

`skill-creator` and `jsdoc-best-practices` are already hyphen-named — no change needed.

**Template `all/copy-overwrite/.claude/skills/` (23 skills):**
Same as root minus 3 Lisa-specific: `lisa-integration-test`, `lisa-learn`, `lisa-review-project`

**Template `nestjs/copy-overwrite/.claude/skills/` (1 skill):**
`security:zap-scan` → `security-zap-scan`

### 2. Update each renamed skill's SKILL.md

For each renamed skill:
- Update `name:` in frontmatter to hyphen name
- **Remove** `argument-hint:` from frontmatter (not supported in skills)
- Update any cross-references to other skills from colon to hyphen (e.g., `/git:commit` → `/git-commit`)

**Cross-references found that need updating:**

| File (after rename) | References to update |
|---|---|
| `sonarqube-fix/SKILL.md` | `/sonarqube:check` → `/sonarqube-check`, `/git:commit` → `/git-commit` |
| `git-commit-and-submit-pr/SKILL.md` | `/git:commit` → `/git-commit`, `/git:submit-pr` → `/git-submit-pr` |
| `plan-create/SKILL.md` | `/jira:sync` → `/jira-sync` |
| `plan-add-test-coverage/SKILL.md` | `/plan:create` → `/plan-create` |
| `plan-fix-linter-error/SKILL.md` | `/plan:create` → `/plan-create` |
| `plan-lower-code-complexity/SKILL.md` | `/plan:create` → `/plan-create` |
| `plan-reduce-max-lines/SKILL.md` | `/plan:create` → `/plan-create` |
| `plan-reduce-max-lines-per-function/SKILL.md` | `/plan:create` → `/plan-create` |
| `tasks-sync/SKILL.md` | `/git:commit` → `/git-commit` |
| `lisa-learn/SKILL.md` | `/lisa:integration-test` → `/lisa-integration-test`, `/lisa:learn` → `/lisa-learn`, `/lisa:review-project` → `/lisa-review-project` |
| `lisa-review-project/SKILL.md` | `/lisa:review-implementation` → `/lisa-review-implementation`, `/lisa:review-project` → `/lisa-review-project` |
| `lisa-review-implementation/SKILL.md` | `/lisa:review-implementation` → `/lisa-review-implementation` |

### 3. Create commands as pass-throughs to skills

Recreate commands following the exact pattern from before the consolidation (recovered from git history in commit `4e3fa4b`).

**Command format:**

```markdown
---
description: "Same description as the skill"
allowed-tools: ["Skill"]
argument-hint: "<from skill's old argument-hint>"
---

Use the /<skill-hyphen-name> skill to <action>. $ARGUMENTS
```

For skills without arguments, omit `argument-hint` and `$ARGUMENTS`.

**Locations:**
- Root `.claude/commands/` — all 25 skills (including 3 Lisa-specific)
- `all/copy-overwrite/.claude/commands/` — 23 distributed skills (excludes Lisa-specific: `lisa-integration-test`, `lisa-learn`, `lisa-review-project`)
- `nestjs/copy-overwrite/.claude/commands/` — 1 skill: `security/zap-scan.md`

**Commands to create (25 total, directory/file):**

| Command path | Points to skill | Has args |
|---|---|---|
| `git/commit.md` | `/git-commit` | `[commit-message-hint]` |
| `git/commit-and-submit-pr.md` | `/git-commit-and-submit-pr` | `[commit-message-hint]` |
| `git/prune.md` | `/git-prune` | No |
| `git/submit-pr.md` | `/git-submit-pr` | `[pr-title-or-description-hint]` |
| `jira/create.md` | `/jira-create` | `<file-or-directory-path> [project-key]` |
| `jira/sync.md` | `/jira-sync` | `<ticket-id>` |
| `jira/verify.md` | `/jira-verify` | `<TICKET-ID>` |
| `lisa/integration-test.md` | `/lisa-integration-test` | `<project-path>` |
| `lisa/learn.md` | `/lisa-learn` | `<project-path>` |
| `lisa/review-implementation.md` | `/lisa-review-implementation` | `[lisa-dir]` |
| `lisa/review-project.md` | `/lisa-review-project` | `<project-path>` |
| `plan/add-test-coverage.md` | `/plan-add-test-coverage` | `<threshold-percentage>` |
| `plan/create.md` | `/plan-create` | `<ticket-url \| @file-path \| description>` |
| `plan/fix-linter-error.md` | `/plan-fix-linter-error` | `<rule-1> [rule-2] [rule-3] ...` |
| `plan/implement.md` | `/plan-implement` | `<plan-file>` |
| `plan/local-code-review.md` | `/plan-local-code-review` | No |
| `plan/lower-code-complexity.md` | `/plan-lower-code-complexity` | No |
| `plan/reduce-max-lines.md` | `/plan-reduce-max-lines` | `<max-lines-value>` |
| `plan/reduce-max-lines-per-function.md` | `/plan-reduce-max-lines-per-function` | `<max-lines-per-function-value>` |
| `pull-request/review.md` | `/pull-request-review` | `<github-pr-link>` |
| `security/zap-scan.md` | `/security-zap-scan` | No |
| `sonarqube/check.md` | `/sonarqube-check` | No |
| `sonarqube/fix.md` | `/sonarqube-fix` | No |
| `tasks/load.md` | `/tasks-load` | `<project-name>` |
| `tasks/sync.md` | `/tasks-sync` | `<project-name>` |

### 4. Update `all/deletions.json`

**Remove** entries that delete commands and hyphen-named skills (lines 23-49):
- 8 command directory entries: `.claude/commands/plan`, `.claude/commands/git`, etc.
- 21 old hyphen-named skill entries: `.claude/skills/git-commit`, `.claude/skills/git-commit-and-submit-pr`, etc.

**Add** entries to clean up colon-named skill directories from downstream projects:
```json
".claude/skills/git:commit",
".claude/skills/git:commit-and-submit-pr",
".claude/skills/git:prune",
".claude/skills/git:submit-pr",
".claude/skills/jira:create",
".claude/skills/jira:sync",
".claude/skills/jira:verify",
".claude/skills/lisa:review-implementation",
".claude/skills/plan:add-test-coverage",
".claude/skills/plan:create",
".claude/skills/plan:fix-linter-error",
".claude/skills/plan:implement",
".claude/skills/plan:local-code-review",
".claude/skills/plan:lower-code-complexity",
".claude/skills/plan:reduce-max-lines",
".claude/skills/plan:reduce-max-lines-per-function",
".claude/skills/pull-request:review",
".claude/skills/security:zap-scan",
".claude/skills/sonarqube:check",
".claude/skills/sonarqube:fix",
".claude/skills/tasks:load",
".claude/skills/tasks:sync"
```

### 5. Update documentation and rules

**`.claude/rules/plan.md`** (root + template):
- Line 21: `/plan:local-code-review` → `/plan-local-code-review`

**`.claude/rules/lisa.md`** (root + template):
- Line 29: Update managed files list — change `(colon-named, e.g. plan:create.md)` to describe both skills (hyphen-named) and commands (directory-structured)
- Add `.claude/commands/*` to the managed files list

**`.claude/rules/PROJECT_RULES.md`** (root only):
- Update "Skills and Commands" section to describe the new architecture: commands are user-facing with argument hints, skills are implementation with logic

**`.claude/agents/implementer.md`** (root + template):
- Line 33: `/git:commit` → `/git-commit`

**`.claude/README.md`** (root + template):
- Lines 166-177: Update skill creation example from colon to hyphen naming, add command creation example

**`.claude/REFERENCE.0003.md`** (root only):
- Add new section "## Skills vs Commands" documenting the architectural difference:
  - Commands: user-facing, `.claude/commands/`, directory-structured (→ colon names in UI), support `$ARGUMENTS` and `argument-hint`, pass through to skills
  - Skills: implementation, `.claude/skills/`, hyphen-named, contain actual logic, invocable via Skill tool
  - How they work together: user types `/plan:create` → command loads → invokes `/plan-create` skill

## Tasks

### Task 1: Verify branch and PR state
- **Subject:** Verify branch and PR state
- **activeForm:** Verifying branch and PR state
- **Description:** Verify we're on `feat/consolidate-skills-and-commands`, PR #163 exists and is open. No implementation before confirming state.
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task", "verification": { "type": "manual-check", "command": "gh pr view 163 --json state,headRefName", "expected": "state: OPEN, headRefName: feat/consolidate-skills-and-commands" } }`

### Task 2: Rename all skill directories and update SKILL.md files
- **Subject:** Rename skill directories from colon to hyphen naming and update frontmatter
- **activeForm:** Renaming skill directories and updating frontmatter
- **Description:** For all 25 colon-named skills in root `.claude/skills/`, 23 in `all/copy-overwrite/.claude/skills/`, and 1 in `nestjs/copy-overwrite/.claude/skills/`: (1) rename directory from colon to hyphen, (2) update `name:` in frontmatter, (3) remove `argument-hint:` from frontmatter, (4) update all cross-references from colon to hyphen names per the cross-reference table in the plan. Apply changes to both root and template directories. Commit atomically.
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task", "verification": { "type": "manual-check", "command": "ls .claude/skills/ | grep ':' | wc -l && ls all/copy-overwrite/.claude/skills/ | grep ':' | wc -l", "expected": "0 and 0 (no colon-named directories remain)" } }`

### Task 3: Create command pass-through files
- **Subject:** Create command files as pass-throughs to skills
- **activeForm:** Creating command pass-through files
- **Description:** Create 25 command files in root `.claude/commands/`, 23 in `all/copy-overwrite/.claude/commands/`, and 1 in `nestjs/copy-overwrite/.claude/commands/` per the commands table in the plan. Each command uses the exact format recovered from git history: frontmatter with `description`, `allowed-tools: ["Skill"]`, and `argument-hint` (where applicable), body that invokes the hyphen-named skill with `$ARGUMENTS`. Commit atomically.
- **Blocked by:** Task 2
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task", "verification": { "type": "manual-check", "command": "ls .claude/commands/plan/create.md && ls all/copy-overwrite/.claude/commands/plan/create.md && head -10 .claude/commands/plan/create.md", "expected": "Files exist, frontmatter has description and argument-hint, body invokes /plan-create skill" } }`

### Task 4: Update deletions.json
- **Subject:** Update deletions.json to stop deleting commands and add colon-named skill cleanup
- **activeForm:** Updating deletions.json
- **Description:** In `all/deletions.json`: (1) Remove 8 command directory deletion entries (lines 23-30), (2) Remove 21 old hyphen-named skill deletion entries (lines 31-49) since we're reverting to hyphen names, (3) Add 22 new entries for colon-named skill directories to clean up downstream projects. Commit atomically.
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task", "verification": { "type": "manual-check", "command": "jq '.paths | map(select(startswith(\".claude/commands/\"))) | length' all/deletions.json && jq '.paths | map(select(contains(\":\"))) | length' all/deletions.json", "expected": "0 command deletions, 22 colon-named skill deletions" } }`

### Task 5: Update rules, agents, and documentation
- **Subject:** Update rules, agents, README, and REFERENCE.0003.md with new naming and commands docs
- **activeForm:** Updating rules, agents, and documentation
- **Description:** Update: (1) `.claude/rules/plan.md` — skill references to hyphen names, (2) `.claude/rules/lisa.md` — managed files list to include commands and use hyphen skill naming, (3) `.claude/rules/PROJECT_RULES.md` — Skills and Commands section, (4) `.claude/agents/implementer.md` — skill references, (5) `.claude/README.md` — skill/command creation examples, (6) `.claude/REFERENCE.0003.md` — add "Skills vs Commands" section documenting: commands are user-facing with `$ARGUMENTS` and `argument-hint`, skills are implementation logic, commands pass through to skills. Apply changes to both root and template files where applicable. Commit atomically.
- **Blocked by:** Task 2
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task", "verification": { "type": "documentation", "command": "grep -c 'Skills vs Commands' .claude/REFERENCE.0003.md && grep -c 'plan:local-code-review' .claude/rules/plan.md", "expected": "1 (section exists) and 0 (no colon references remain)" } }`

### Task 6: Product/UX review
- **Subject:** Product/UX review of skill and command changes
- **activeForm:** Running product/UX review
- **Description:** Use `product-reviewer` agent to validate: (1) commands are accessible via `/plan:create` etc., (2) argument hints display correctly, (3) skills invoke correctly when called from commands, (4) no broken references.
- **Blocked by:** Tasks 2, 3, 4, 5
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task", "verification": { "type": "manual-check", "command": "ls .claude/commands/plan/create.md .claude/skills/plan-create/SKILL.md", "expected": "Both files exist" } }`

### Task 7: CodeRabbit code review
- **Subject:** Run CodeRabbit code review
- **activeForm:** Running CodeRabbit code review
- **Description:** Invoke `/coderabbit:review` to review all changes.
- **Blocked by:** Tasks 2, 3, 4, 5
- **Skills:** `["coderabbit:review"]`
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task" }`

### Task 8: Local code review
- **Subject:** Run local code review
- **activeForm:** Running local code review
- **Description:** Invoke `/plan-local-code-review` to review local changes vs main.
- **Blocked by:** Tasks 2, 3, 4, 5
- **Skills:** `["plan-local-code-review"]`
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task" }`

### Task 9: Technical review
- **Subject:** Run technical review
- **activeForm:** Running technical review
- **Description:** Use `tech-reviewer` agent to review correctness, security, and performance of changes.
- **Blocked by:** Tasks 2, 3, 4, 5
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task" }`

### Task 10: Implement valid review suggestions
- **Subject:** Implement valid review suggestions
- **activeForm:** Implementing review suggestions
- **Description:** Implement valid suggestions from Tasks 6-9 reviews. Skip suggestions that conflict with the plan intent.
- **Blocked by:** Tasks 6, 7, 8, 9
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task" }`

### Task 11: Simplify code
- **Subject:** Simplify code using code simplifier
- **activeForm:** Simplifying code
- **Description:** Use `code-simplifier` agent on recently modified files to simplify and refine for clarity and maintainability.
- **Blocked by:** Task 10
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task" }`

### Task 12: Update tests
- **Subject:** Update tests as needed
- **activeForm:** Updating tests
- **Description:** Run `bun run test` to verify existing tests pass. Update any tests that reference colon-named skills. This is primarily a rename/restructure task so new tests are unlikely needed, but verify test suite passes.
- **Blocked by:** Task 10
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "test", "verification": { "type": "test", "command": "bun run test", "expected": "All tests pass" } }`

### Task 13: Update documentation (JSDoc, markdown)
- **Subject:** Update documentation
- **activeForm:** Updating documentation
- **Description:** Invoke `/jsdoc-best-practices` if any TypeScript files changed. Ensure all markdown files are accurate. Verify preambles are updated.
- **Blocked by:** Task 10
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task" }`

### Task 14: Verify all verification metadata
- **Subject:** Verify all task verification commands produce expected output
- **activeForm:** Verifying verification metadata
- **Description:** Run the verification command from each completed task's metadata and confirm expected output matches actual output.
- **Blocked by:** Task 10
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task" }`

### Task 15: Collect learnings
- **Subject:** Collect learnings using learner agent
- **activeForm:** Collecting learnings
- **Description:** Use `learner` agent to process learnings from this task, particularly about: (1) skills vs commands distinction, (2) `$ARGUMENTS` only works in commands, (3) `argument-hint` only works in commands, (4) architecture pattern of commands as pass-throughs to skills.
- **Blocked by:** Tasks 10, 11
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task" }`

### Task 16: Archive the plan
- **Subject:** Archive the plan
- **activeForm:** Archiving the plan
- **Description:** (1) Create folder `revert-colon-naming-restore-commands` in `./plans/completed`, (2) Rename this plan to reflect actual contents, (3) Move it into `./plans/completed/revert-colon-naming-restore-commands`, (4) Read session IDs from `./plans/completed/revert-colon-naming-restore-commands`, (5) Move each `~/.claude/tasks/<session-id>` directory to `./plans/completed/revert-colon-naming-restore-commands/tasks`, (6) Update any "in_progress" task to "completed", (7) Commit and push changes to PR #163, then mark PR ready (`gh pr ready`) and enable auto-merge (`gh pr merge --auto --merge`).
- **Blocked by:** All other tasks
- **Metadata:** `{ "plan": "sleepy-stirring-shannon", "type": "task" }`

## Verification

1. **No colon-named skill directories remain:** `ls .claude/skills/ | grep ':' | wc -l` → 0
2. **All commands exist:** `ls .claude/commands/plan/create.md .claude/commands/git/commit.md` → files exist
3. **Commands have argument hints:** `grep argument-hint .claude/commands/plan/create.md` → shows hint
4. **Skills have NO argument hints:** `grep argument-hint .claude/skills/plan-create/SKILL.md` → no match
5. **No stale colon references in skills:** `grep -r '/[a-z]*:[a-z]' .claude/skills/ --include='*.md'` → no matches
6. **Template files in sync:** diff between root and `all/copy-overwrite/` for shared skills and commands shows no differences
7. **Tests pass:** `bun run test` → all pass
8. **REFERENCE.0003.md has commands section:** `grep 'Skills vs Commands' .claude/REFERENCE.0003.md` → match
