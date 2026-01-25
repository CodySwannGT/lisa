# Lisa Command Reference

This document describes all available slash commands and the recommended workflow for using Lisa.

## Quick Start Workflow

The automated workflow eliminates the need for `/clear` between phases.

### Step 1: Create a Spec

Create a file inside `specs/` called `<something>.md` and describe what you want Claude to do in as much detail as possible. See any `brief.md` for an example.

### Step 2: Bootstrap the Project

```bash
/project:bootstrap @specs/<something>.md
```

**What happens:**

1. **Setup** (via `/project:setup`): Creates a dated project directory in `projects/`, moves/creates brief.md, creates empty findings.md, creates a git branch
2. **Research** (via `/project:research`): Conducts comprehensive codebase and web research, generates research.md with findings
3. **Gap Detection**: Reads research.md and checks the "Open Questions" section
   - **If gaps found**: Stops and reports "Research complete but has open questions. Review research.md and resolve questions before running /project:execute"
   - **If no gaps**: Reports "Bootstrap complete. Research has no gaps. Ready to run /project:execute"

### Step 3: Execute the Project

```bash
/project:execute @projects/<project-name>
```

**What happens:**

1. **Setup**: Sets active project marker, validates research.md has no unresolved open questions, checks if planning already complete
2. **Planning** (via `/project:plan`): Creates detailed task list from research.md and brief.md using Claude's native task tools
3. **Implementation** (via `/project:implement`): Systematically implements all tasks using subagents
4. **Review** (via `/project:review`): Performs Claude code review and CodeRabbit review, implements fixes
5. **Verification** (via `/project:verify`): Verifies implementation matches all requirements, documents drift
6. **Debrief** (via `/project:debrief`): Evaluates findings.md and creates skills or adds rules to .claude/rules/PROJECT_RULES.md
7. **Archive** (via `/project:archive`): Moves project to projects/archive and submits PR

### Step 4: Address PR Feedback

After `/project:execute` completes and submits a PR, wait for CI/CD and code review to finish. Then:

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

Commands are organized by category. Sub-commands (commands that are called by other commands) are marked with their parent command(s).

### Project Commands

| Command | Description | Arguments | Called By |
|---------|-------------|-----------|-----------|
| `/project:bootstrap` | Automated project setup and research with gap detection | `<brief-file-or-jira-issue>` (required) | - |
| `/project:execute` | Automated project execution from planning through debrief | `<project-directory>` (required) | - |
| `/project:setup` | Initialize project directory, brief.md, findings.md, and git branch | `<brief-file-or-jira-issue>` (required) | `/project:bootstrap` |
| `/project:research` | Conduct codebase and web research, compile to research.md | `<project-directory>` (required) | `/project:bootstrap` |
| `/project:plan` | Create detailed task list from research.md and brief.md | `<project-directory>` (required) | `/project:execute` |
| `/project:implement` | Systematically implement all tasks in a project | `<project-directory>` (required) | `/project:execute` |
| `/project:review` | Perform extensive code review and optimization | `<project-directory>` (required) | `/project:execute` |
| `/project:verify` | Verify implementation matches all project requirements | `<project-directory>` (required) | `/project:execute` |
| `/project:debrief` | Evaluate findings and create skills or rules from learnings | `<project-directory>` (required) | `/project:execute` |
| `/project:archive` | Move completed project to projects/archive | `<project-directory>` (required) | `/project:execute` |
| `/project:complete-task` | Complete a single task using a subagent with fresh context | `<task-file>` (required) | `/project:implement` |
| `/project:local-code-review` | Code review local changes on current branch | `<project-directory>` (required) | `/project:review` |
| `/project:fix-linter-error` | Fix all violations of a specific ESLint rule | `<eslint-rule-name>` (required) | - |
| `/project:lower-code-complexity` | Reduce code complexity threshold by 2 and fix violations | none | - |
| `/project:add-test-coverage` | Increase test coverage to a specified threshold | `<threshold-percentage>` (required) | - |

### Git Commands

| Command | Description | Arguments | Called By |
|---------|-------------|-----------|-----------|
| `/git:commit` | Create conventional commits for current changes | `[commit-message-hint]` (optional) | `/project:setup`, `/project:research`, `/sonarqube:fix`, `/pull-request:review`, `/git:commit-and-submit-pr` |
| `/git:submit-pr` | Push changes and create or update a pull request | `[pr-title-or-description-hint]` (optional) | `/git:commit-and-submit-pr` |
| `/git:commit-and-submit-pr` | Create commits and submit PR for code review | `[commit-message-hint]` (optional) | `/project:archive`, `/pull-request:review` |
| `/git:prune` | Remove local branches deleted on remote | none | - |

### Pull Request Commands

| Command | Description | Arguments | Called By |
|---------|-------------|-----------|-----------|
| `/pull-request:review` | Fetch PR review comments and implement fixes | `<github-pr-link>` (required) | - |

### Task Commands

| Command | Description | Arguments | Called By |
|---------|-------------|-----------|-----------|
| `/tasks:load` | Load tasks from a project directory into current session | `<project-name>` (required) | - |
| `/tasks:sync` | Sync current session tasks to a project directory | `<project-name>` (required) | - |

### JIRA Commands

| Command | Description | Arguments | Called By |
|---------|-------------|-----------|-----------|
| `/jira:create` | Create JIRA epics/stories/tasks from code files | `<file-or-directory-path> [project-key]` (path required, key optional) | - |
| `/jira:verify` | Verify JIRA ticket meets standards for epic relationships | `<TICKET-ID>` (required) | - |

### SonarQube Commands

| Command | Description | Arguments | Called By |
|---------|-------------|-----------|-----------|
| `/sonarqube:check` | Get reason last PR failed SonarQube checks | none | `/sonarqube:fix` |
| `/sonarqube:fix` | Check SonarQube failures, fix them, and commit | none | - |

### Lisa Commands

| Command | Description | Arguments | Called By |
|---------|-------------|-----------|-----------|
| `/lisa:review-project` | Compare Lisa templates against a project's implementation | `<project-path>` (required) | - |
| `/lisa:review-implementation` | Compare project files against Lisa templates, offer to upstream | `[lisa-dir]` (optional) | - |

---

## Command Details

### `/project:bootstrap`

**Arguments:** `<project-brief-file-or-jira-issue-number>` (required)

Orchestrates project initialization in 3 steps:

1. **Setup**: Uses Task tool to run `/project:setup` - creates project directory, brief.md, findings.md, git branch
2. **Research**: Uses Task tool to run `/project:research` - generates research.md with codebase and web findings
3. **Gap Detection**: Reads research.md and checks "Open Questions" section for unresolved questions

**Calls:** `/project:setup` → `/project:research`

**Output:**
- "✅ Bootstrap complete with no gaps - ready for execution" OR
- "⚠️ Bootstrap complete but needs human review - see Open Questions in research.md"

---

### `/project:execute`

**Arguments:** `<project-directory>` (required)

Orchestrates the full implementation workflow. Runs continuously without stopping between steps.

**Setup phase:**
1. Sets active project marker (`.claude-active-project`)
2. Validates research.md has no unresolved open questions (stops if gaps exist)
3. Checks if planning already complete (skips to implementation if task files exist)

**Execution phase:**
1. Planning → 2. Implementation → 3. Review → 4. Verification → 5. Debrief → 6. Archive

**Calls:** `/project:plan` → `/project:implement` → `/project:review` → `/project:verify` → `/project:debrief` → `/project:archive`

**Output:** "Project complete and archived"

---

### `/project:setup`

**Arguments:** `<project-brief-file-or-jira-issue-number>` (required)

Creates a dated project directory (`YYYY-MM-DD-<project-name>`), moves or creates brief.md, creates empty findings.md, and sets up a git branch. If argument is a Jira issue number, fetches the issue details via Atlassian MCP.

**Called by:** `/project:bootstrap`
**Calls:** `/git:commit`

---

### `/project:research`

**Arguments:** `<project-directory>` (required)

Conducts comprehensive codebase and web research. Spawns parallel sub-agents:
- **codebase-locator**: Find where files and components live
- **codebase-analyzer**: Understand how specific code works
- **codebase-pattern-finder**: Find examples of existing patterns
- **git-history-analyzer**: Understand file change history
- **web-search-researcher**: External documentation and resources

Compiles results into research.md with: Summary, Detailed Findings, Code References, Architecture Documentation, Testing Patterns, Documentation Patterns, and Open Questions.

**Called by:** `/project:bootstrap`
**Calls:** `/git:commit`

---

### `/project:plan`

**Arguments:** `<project-directory>` (required)

Creates a detailed task list using Claude Code's native task tools. Reads brief.md and research.md, validates research has no unanswered questions, discovers applicable skills, and creates tasks with:
- Subject and activeForm
- Type (Bug/Task/Epic/Story)
- Description with acceptance criteria
- Relevant research excerpts
- Skills to invoke
- Implementation details
- Testing requirements (unit, integration, E2E)
- Verification command and expected output

**Called by:** `/project:execute`

---

### `/project:implement`

**Arguments:** `<project-directory>` (required)

Systematically implements all tasks. For each pending, unblocked task:
1. Marks it in_progress
2. Retrieves full task details
3. Launches a subagent with the task description
4. Subagent runs verification command and confirms expected output
5. Marks task completed (or keeps in_progress if verification fails)
6. Checks for newly unblocked tasks

**Called by:** `/project:execute`

---

### `/project:review`

**Arguments:** `<project-directory>` (required)

Performs extensive code review in 5 steps:
1. **Claude Review**: Runs `/project:local-code-review` (if not already done)
2. **Implement Claude Fixes**: Fixes suggestions scoring above 45
3. **CodeRabbit Review**: Runs `coderabbit review --plain` (if not already done)
4. **Implement CodeRabbit Fixes**: Evaluates and implements valid findings
5. **Claude Optimizations**: Uses code-simplifier agent to clean up code

**Called by:** `/project:execute`
**Calls:** `/project:local-code-review`

---

### `/project:local-code-review`

**Arguments:** `<project-directory>` (required)

Performs code review on local branch changes using 5 parallel agents:
1. CLAUDE.md compliance check
2. Shallow scan for obvious bugs
3. Git blame and history context
4. Previous PR comments that may apply
5. Code comments compliance

Scores issues 0-100 and filters to findings with score ≥ 80. Writes results to `<project>/claude-review.md`.

**Called by:** `/project:review`

---

### `/project:verify`

**Arguments:** `<project-directory>` (required)

Verifies the implementation completely satisfies all requirements from brief.md and research.md. Documents any divergence to `<project>/drift.md`.

**Called by:** `/project:execute`

---

### `/project:debrief`

**Arguments:** `<project-directory>` (required)

Evaluates findings.md and uses skill-evaluator agent to decide where each learning belongs:
- **CREATE SKILL**: Complex, reusable pattern
- **ADD TO RULES**: Simple never/always rule for .claude/rules/PROJECT_RULES.md
- **OMIT ENTIRELY**: Already covered or too project-specific

**Called by:** `/project:execute`

---

### `/project:archive`

**Arguments:** `<project-directory>` (required)

Moves the completed project to `projects/archive` and submits a PR.

**Called by:** `/project:execute`
**Calls:** `/git:commit-and-submit-pr`

---

### `/project:complete-task`

**Arguments:** `<task-file>` (required)

Completes a single task within a project using a subagent with fresh context. Must execute verification commands before marking complete. If verification requires Docker/external services and they're unavailable, marks task as blocked.

**Called by:** `/project:implement`

---

### `/project:fix-linter-error`

**Arguments:** `<eslint-rule-name>` (required)

Enables a specific ESLint rule, identifies all violations, creates a task for each file (ordered by violation count), and launches up to 5 parallel subagents to fix them.

---

### `/project:lower-code-complexity`

**Arguments:** none

Lowers the cognitive complexity threshold by 2, identifies all functions exceeding the new limit, creates tasks ordered by complexity score, and launches up to 5 code-simplifier agents to refactor in parallel.

---

### `/project:add-test-coverage`

**Arguments:** `<threshold-percentage>` (required)

Updates coverage config thresholds, identifies the 20 files with lowest coverage, creates tasks for each, and launches up to 5 test-coverage-agents to add tests in parallel. Iterates until all thresholds meet or exceed the target.

---

### `/git:commit`

**Arguments:** `[commit-message-hint]` (optional)

Creates conventional commits for all current changes:
1. If on protected branch (dev/staging/main), creates a feature branch
2. Groups related changes into logical commits
3. Uses conventional prefixes (feat, fix, chore, docs, style, refactor, test)
4. Ensures working directory is clean

**Called by:** `/project:setup`, `/project:research`, `/sonarqube:fix`, `/pull-request:review`, `/git:commit-and-submit-pr`

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

**Called by:** `/project:archive`, `/pull-request:review`
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

### `/jira:create`

**Arguments:** `<file-or-directory-path>` (required), `[project-key]` (optional, defaults to SE)

Analyzes code files and creates a comprehensive JIRA hierarchy (Epic → User Story → Tasks) with mandatory quality gates: test-first, quality gates, documentation, feature flags, cleanup.

---

### `/jira:verify`

**Arguments:** `<TICKET-ID>` (required)

Verifies a JIRA ticket:
1. Has an epic parent (if not a bug or epic itself)
2. Has quality description addressing coding assistants, developers, and stakeholders

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

**Arguments:** `[lisa-dir]` (optional - auto-detects if Claude started with `--add-dir`)

Run FROM a project with Lisa applied. Compares the project's Lisa-managed files against Lisa source templates and offers to upstream changes back to Lisa.

---

## Command Call Graph

```text
/project:bootstrap
├── /project:setup
│   └── /git:commit
└── /project:research
    └── /git:commit

/project:execute
├── /project:plan
├── /project:implement
│   └── /project:complete-task
├── /project:review
│   └── /project:local-code-review
├── /project:verify
├── /project:debrief
└── /project:archive
    └── /git:commit-and-submit-pr
        ├── /git:commit
        └── /git:submit-pr

/sonarqube:fix
├── /sonarqube:check
└── /git:commit

/pull-request:review
├── /git:commit
└── /git:commit-and-submit-pr
    ├── /git:commit
    └── /git:submit-pr
```
