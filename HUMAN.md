# Lisa Command Reference

This document describes all available slash commands and the recommended workflow for using Lisa.

## Quick Start Workflow

### Step 1: Create a Plan

```bash
/plan:create <description-of-what-you-want>
```

**What happens:**

1. Claude enters plan mode
2. Researches the codebase and gathers context
3. Creates a detailed implementation plan with tasks
4. Presents the plan for your review and approval

### Step 2: Review and Approve the Plan

Review the generated plan. You can:

- **Approve** the plan to proceed to implementation
- **Reject** with feedback to refine the approach
- **Edit** the plan file directly before approving

### Step 3: Implement the Plan

```bash
/plan:implement @plans/<plan-file>.md
```

**What happens:**

1. Reads the plan and creates tasks
2. Launches parallel subagents to implement tasks
3. Runs verification commands for each task
4. Commits changes and submits a PR

### Step 4: Address PR Feedback

After implementation completes and a PR is submitted, wait for CI/CD and code review to finish. Then:

```bash
/pull-request:review <github-pr-link>
```

**What happens:**

1. Fetches all review comments on the PR
2. Creates a task for each unresolved comment
3. Launches parallel subagents to evaluate and implement fixes
4. Commits changes and updates the PR

---

## Command Reference

Commands are organized by category.

### Plan Commands

| Command | Description | Arguments |
|---------|-------------|-----------|
| `/plan:create` | Create an implementation plan for a given prompt | `<request>` (required) |
| `/plan:implement` | Implement a plan | `<plan-file>` (required) |
| `/plan:local-code-review` | Review local branch changes compared to main | none |
| `/plan:fix-linter-error` | Fix all violations of one or more ESLint rules | `<rule-1> [rule-2] ...` (required) |
| `/plan:lower-code-complexity` | Reduce cognitive complexity threshold by 2 and fix violations | none |
| `/plan:add-test-coverage` | Increase test coverage to a specified threshold | `<threshold-percentage>` (required) |
| `/plan:reduce-max-lines` | Reduce max file lines threshold and fix violations | `<max-lines-value>` (required) |
| `/plan:reduce-max-lines-per-function` | Reduce max lines per function threshold and fix violations | `<max-lines-per-function-value>` (required) |

### Git Commands

| Command | Description | Arguments |
|---------|-------------|-----------|
| `/git:commit` | Create conventional commits for current changes | `[commit-message-hint]` (optional) |
| `/git:submit-pr` | Push changes and create or update a pull request | `[pr-title-or-description-hint]` (optional) |
| `/git:commit-and-submit-pr` | Create commits and submit PR for code review | `[commit-message-hint]` (optional) |
| `/git:prune` | Remove local branches deleted on remote | none |

### Pull Request Commands

| Command | Description | Arguments |
|---------|-------------|-----------|
| `/pull-request:review` | Fetch PR review comments and implement fixes | `<github-pr-link>` (required) |

### Task Commands

| Command | Description | Arguments |
|---------|-------------|-----------|
| `/tasks:load` | Load tasks from a project directory into current session | `<project-name>` (required) |
| `/tasks:sync` | Sync current session tasks to a project directory | `<project-name>` (required) |

### SonarQube Commands

| Command | Description | Arguments |
|---------|-------------|-----------|
| `/sonarqube:check` | Get reason last PR failed SonarQube checks | none |
| `/sonarqube:fix` | Check SonarQube failures, fix them, and commit | none |

### JIRA Commands

| Command | Description | Arguments |
|---------|-------------|-----------|
| `/jira:create` | Create JIRA epics/stories/tasks from code files | `<file-or-directory-path> [project-key]` (path required, key optional) |
| `/jira:verify` | Verify JIRA ticket meets standards for epic relationships | `<TICKET-ID>` (required) |

### Lisa Commands

| Command | Description | Arguments |
|---------|-------------|-----------|
| `/lisa:review-project` | Compare Lisa templates against a project's implementation | `<project-path>` (required) |
| `/lisa:review-implementation` | Compare project files against Lisa templates, offer to upstream | `[lisa-dir]` (optional) |

---

## Command Details

### `/plan:create`

**Arguments:** `<request>` (required)

Enters Claude's native plan mode and creates an implementation plan. Claude will:

1. Research the codebase to understand existing patterns and architecture
2. Create a detailed plan with tasks, dependencies, and verification commands
3. Present the plan for review and approval

**Output:** A plan file in `plans/` ready for review.

---

### `/plan:implement`

**Arguments:** `<plan-file>` (required)

Implements the requirements described in the referenced plan file. Creates tasks from the plan and executes them systematically.

---

### `/plan:local-code-review`

**Arguments:** none

Performs code review on local branch changes using 5 parallel agents:

1. CLAUDE.md compliance check
2. Shallow scan for obvious bugs
3. Git blame and history context
4. Previous PR comments that may apply
5. Code comments compliance

Scores issues 0-100 and filters to findings with score >= 80.

---

### `/plan:fix-linter-error`

**Arguments:** `<rule-1> [rule-2] [rule-3] ...` (required)

Enables specific ESLint rules, identifies all violations, creates a task for each file (ordered by violation count), and launches parallel subagents to fix them.

---

### `/plan:lower-code-complexity`

**Arguments:** none

Lowers the cognitive complexity threshold by 2, identifies all functions exceeding the new limit, creates tasks ordered by complexity score, and launches parallel code-simplifier agents to refactor.

---

### `/plan:add-test-coverage`

**Arguments:** `<threshold-percentage>` (required)

Updates coverage config thresholds, identifies the 20 files with lowest coverage, creates tasks for each, and launches parallel test-coverage agents. Iterates until all thresholds meet or exceed the target.

---

### `/plan:reduce-max-lines`

**Arguments:** `<max-lines-value>` (required)

Reduces the max file lines threshold, identifies all files exceeding the new limit, creates tasks ordered by line count, and launches parallel code-simplifier agents. Iterates until all files are under the target.

---

### `/plan:reduce-max-lines-per-function`

**Arguments:** `<max-lines-per-function-value>` (required)

Reduces the max lines per function threshold, identifies all functions exceeding the new limit, creates tasks ordered by line count, and launches parallel code-simplifier agents. Iterates until all functions are under the target.

---

### `/git:commit`

**Arguments:** `[commit-message-hint]` (optional)

Creates conventional commits for all current changes:

1. If on protected branch (dev/staging/main), creates a feature branch
2. Groups related changes into logical commits
3. Uses conventional prefixes (feat, fix, chore, docs, style, refactor, test)
4. Ensures working directory is clean

**Called by:** `/sonarqube:fix`, `/pull-request:review`, `/git:commit-and-submit-pr`

---

### `/git:submit-pr`

**Arguments:** `[pr-title-or-description-hint]` (optional)

Pushes current branch and creates or updates a pull request:

1. Verifies not on protected branch
2. Ensures all changes committed
3. Pushes with `-u` flag
4. Creates PR (or updates existing) with Summary and Test Plan
5. Enables auto-merge

**Called by:** `/git:commit-and-submit-pr`

---

### `/git:commit-and-submit-pr`

**Arguments:** `[commit-message-hint]` (optional)

Commits all changes and submits the branch as a PR.

**Called by:** `/pull-request:review`
**Calls:** `/git:commit` → `/git:submit-pr`

---

### `/git:prune`

**Arguments:** none

Removes local branches whose upstream tracking branches have been deleted on remote. Fetches with `--prune`, shows preview before deleting, uses safe delete (`-d`).

---

### `/pull-request:review`

**Arguments:** `<github-pr-link>` (required)

Fetches all review comments on a PR via GitHub CLI, creates a task for each unresolved comment with instructions to:

1. Evaluate if the requested change is valid
2. If not valid, reply explaining why
3. If valid, make code updates following project standards
4. Run relevant tests
5. Commit changes

Launches up to 6 parallel subagents. When complete, runs `/git:commit-and-submit-pr`.

**Calls:** `/git:commit`, `/git:commit-and-submit-pr`

---

### `/tasks:load`

**Arguments:** `<project-name>` (required)

Loads tasks from `projects/<project-name>/tasks/` into the current Claude Code session. Sets active project marker so new tasks auto-sync.

---

### `/tasks:sync`

**Arguments:** `<project-name>` (required)

Syncs all tasks from the current session to `projects/<project-name>/tasks/` as JSON files. Stages files for git.

---

### `/sonarqube:check`

**Arguments:** none

Uses SonarQube MCP to get the reason the last PR failed quality checks.

**Called by:** `/sonarqube:fix`

---

### `/sonarqube:fix`

**Arguments:** none

Checks SonarQube failures, fixes them, and commits the changes.

**Calls:** `/sonarqube:check` → fix → `/git:commit`

---

### `/lisa:review-project`

**Arguments:** `<project-path>` (required)

Run FROM the Lisa repository. Compares Lisa's templates against a target project's implementation to identify drift. Categorizes changes as Improvement, Customization, Bug fix, or Divergence. Offers to adopt improvements back into Lisa.

---

### `/lisa:review-implementation`

**Arguments:** `[lisa-dir]` (optional — auto-detects if Claude started with `--add-dir`)

Run FROM a project with Lisa applied. Compares the project's Lisa-managed files against Lisa source templates and offers to upstream changes back to Lisa.

---

### `/jira:create`

**Arguments:** `<file-or-directory-path> [project-key]` (path required, key optional)

Creates JIRA epics, stories, and tasks from code files or descriptions with comprehensive quality requirements.

---

### `/jira:verify`

**Arguments:** `<TICKET-ID>` (required)

Verifies a JIRA ticket meets organizational standards for epic relationships and description quality.

---

## Command Call Graph

```text
/plan:create → (plan mode) → /plan:implement

/sonarqube:fix
├── /sonarqube:check
└── /git:commit

/pull-request:review
├── /git:commit
└── /git:commit-and-submit-pr
    ├── /git:commit
    └── /git:submit-pr

/git:commit-and-submit-pr
├── /git:commit
└── /git:submit-pr
```
