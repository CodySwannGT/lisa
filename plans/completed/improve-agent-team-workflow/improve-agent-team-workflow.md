# Plan: Improve Agent Team Plan Workflow

## Context

After testing the Agent Teams planning workflow with a Fibonacci demo task (`.claude/agent-prompt-test.md` -> `plans/fibonacci-demo-script.md`), six deficiencies were identified in how plans are generated and executed. The plan rules (`.claude/rules/plan.md`) and the agent prompt templates need to be updated so that ALL future plans automatically incorporate these improvements.

**Branch:** `feat/reference-0003-agent-teams` (existing, non-protected)
**PR:** #162 — https://github.com/CodySwannGT/lisa/pull/162
**PR target:** `main`

## Problem Statement

The current plan-generation rules produce plans that:
1. Have no "learn" phase — learnings from tasks are never collected or acted on
2. Recommend only `general-purpose` teammates — no specialization
3. Lack a product review — only technical reviews exist
4. Have too many git pushes — should be draft PR first, one push at the end
5. Include a redundant "Run linter and type checker" task — hooks/pre-commit already handle this
6. Don't specify what to do with unresolved decisions — should default to the recommended option

## Research Summary

### Existing Infrastructure

| Component | Status | Location |
|-----------|--------|----------|
| `skill-evaluator` agent | Exists | `.claude/agents/skill-evaluator.md` |
| `agent-architect` agent | Exists | `.claude/agents/agent-architect.md` |
| `test-coverage-agent` agent | Exists | `.claude/agents/test-coverage-agent.md` |
| `code-simplifier` plugin | Enabled | `.claude/settings.json` |
| `coderabbit` plugin | Enabled | `.claude/settings.json` |
| `plan-local-code-review` skill | Exists | `.claude/skills/plan-local-code-review/SKILL.md` |
| `git-commit` skill | Exists | `.claude/skills/git-commit/SKILL.md` |
| `git-submit-pr` skill | Exists | `.claude/skills/git-submit-pr/SKILL.md` |
| lint-staged pre-commit | Runs ESLint + ast-grep + prettier | `.lintstagedrc.json` |
| PostToolUse lint hook | Runs on Write/Edit | `.claude/hooks/lint-on-edit.sh` |
| PostToolUse format hook | Runs on Write/Edit | `.claude/hooks/format-on-edit.sh` |

### Key Findings

- **Linting is already automated 3 ways**: (1) PostToolUse hooks lint on every file edit, (2) lint-staged runs ESLint+prettier on every commit, (3) format-on-edit.sh runs prettier on every Write/Edit. A separate "run linter" task is redundant.
- **`skill-evaluator` agent already exists** and knows how to decide whether learnings should become skills, rules in PROJECT_RULES.md, or be discarded. It just needs to be invoked as part of the plan workflow.
- **No product-review agent exists.** Need to create one that validates from a non-technical user perspective.
- **No tech-review agent exists** that explains findings in beginner-friendly language. The existing `plan-local-code-review` skill is comprehensive but assumes technical sophistication.
- **`git-submit-pr` creates a non-draft PR.** The plan rules need to override this for the initial push (draft) and only mark ready-for-review at the end.

## Implementation

### Files to Create

1. **`.claude/agents/implementer.md`** — Specialized teammate agent for code implementation tasks. Has full tool access. Follows coding-philosophy, runs tests after changes, focuses on one task at a time. More efficient than generic `general-purpose` because its prompt pre-loads project conventions.

2. **`.claude/agents/tech-reviewer.md`** — Technical review agent that explains findings in beginner-friendly language. Read-only tools + Bash for running tests. Validates: correctness, security, performance, coding-philosophy compliance. Outputs findings ranked by severity with plain-English explanations.

3. **`.claude/agents/product-reviewer.md`** — Product/UX review agent that validates from a non-technical user's perspective. Checks: does the feature work as described? Is the behavior intuitive? Are error messages helpful? Does the output match requirements? Uses Bash + Playwright/browser tools to actually run the feature and verify behavior empirically.

4. **`.claude/agents/learner.md`** — Post-implementation learning agent. Reads all task metadata `learnings` fields, collects them, feeds each to the `skill-evaluator` agent. Outputs a summary of what was learned and what actions were taken (skill created, rule added, or discarded).

### Files to Modify

5. **`.claude/rules/plan.md`** — Major updates to the plan rules:

   **Add to Required Behaviors:**
   - "If a decision is left unresolved by the human, use the recommended option"
   - A task for product review (using `product-reviewer` agent) after implementation
   - A task for the "learn" phase (using `learner` agent) as the second-to-last task (before archive)
   - Remove references to a separate "lint/typecheck" task — add a note that linting, formatting, and type-checking are handled automatically by pre-commit hooks and PostToolUse hooks
   - Git workflow rules:
     - First task in every plan: create branch (if needed) and open a **draft** PR
     - No git push during implementation — only commits (pre-commit hooks validate quality)
     - After archive task: one final push, mark PR "Ready for Review", enable auto-merge
   - Implementation Team section: recommend specialized agents (`implementer`, `tech-reviewer`, `product-reviewer`, `learner`) instead of all `general-purpose`

   **Remove from Required Behaviors:**
   - The separate lint/typecheck/format task requirement

6. **`.claude/agent-prompt-test.md`** — Update the test prompt template to align with new plan rules:
   - Add "learner" role to team structure
   - Reference specialized agents instead of generic roles
   - Add product review to requirements
   - Add "If a decision is left unresolved, use the recommended option"

7. **`.claude/agent-prompt.md`** — Update the bug-fix prompt template to align:
   - Same changes as agent-prompt-test.md adapted for bug-fix context
   - Add product-reviewer for verifying fix from user perspective

### Files NOT Modified (and why)

- `plans/fibonacci-demo-script.md` — Already-created plan. New rules apply to future plans only.
- `.claude/settings.json` — Lisa-managed, no changes needed. Agent Teams already enabled.
- `.lintstagedrc.json` — Lisa-managed, already correct.
- `.claude/hooks/*` — Already correct. Lint/format hooks stay as-is.

### Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| New agents vs. modifying existing | Create new agents | Existing agents serve different purposes; team roles need dedicated prompts |
| Product reviewer scope | Empirical behavioral validation | Human is assumed to be a beginner; reviewer must actually run the feature |
| Tech reviewer scope | Beginner-friendly technical review | Complement CodeRabbit with human-readable explanations |
| Learner agent approach | Invoke `skill-evaluator` per learning | Reuses existing agent; no new decision logic needed |
| Git push strategy | Draft PR first, one push at end | Reduces noise, keeps PR clean until ready |
| Lint task removal | Remove from plan rules | 3 existing automation layers already cover it |
| Unresolved decisions | Default to recommended | Prevents plan stalls; human can always override |

### Skills to Invoke During Implementation

- `/coding-philosophy` — always required
- `/jsdoc-best-practices` — for agent file documentation
- `/git:commit` — for atomic conventional commits
- `/git:submit-pr` — for final push

### Plugins Required

- `code-review@claude-plugins-official` — CodeRabbit review of the changes
- `code-simplifier@claude-plugins-official` — Code simplification pass

## Tasks

Create task list using TaskCreate with the following tasks:

### Task 1: Create branch and draft PR
- **Subject:** Open draft PR for agent team workflow improvements
- **ActiveForm:** Opening draft PR
- **Description:**

  **Type:** Task

  **Description:** Verify we are on branch `feat/reference-0003-agent-teams`. If there is already a PR open (#162), skip PR creation. If not, open a draft PR targeting `main` with title "feat: improve agent team plan workflow". This MUST be the first task — no implementation happens before the PR exists.

  **Acceptance Criteria:**
  - [ ] On branch `feat/reference-0003-agent-teams`
  - [ ] Draft PR exists targeting `main`

  **Skills to Invoke:** `/coding-philosophy`

  **Verification:**
  - Type: `manual-check`
  - Command: `gh pr view 162 --json state,isDraft --jq '{state, isDraft}'`
  - Expected: PR exists (state=OPEN)

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "gh pr view 162 --json state --jq '.state'", "expected": "OPEN" } }`

### Task 2: Create `implementer` agent
- **Subject:** Create .claude/agents/implementer.md specialized teammate agent
- **ActiveForm:** Creating implementer agent
- **Description:**

  **Type:** Task

  **Description:** Create a new agent at `.claude/agents/implementer.md` for code implementation tasks in Agent Teams. The agent should:
  - Have full tool access (omit `tools` field to inherit all)
  - Include a focused system prompt covering: follow coding-philosophy, run tests after changes, focus on one task at a time, always verify empirically, read CLAUDE.md rules, invoke `/coding-philosophy` skill
  - Use `model: sonnet` for cost efficiency
  - Include JSDoc-style preamble comment in the markdown

  **Acceptance Criteria:**
  - [ ] File exists at `.claude/agents/implementer.md`
  - [ ] Has valid YAML frontmatter with name, description
  - [ ] System prompt covers coding-philosophy, testing, empirical verification
  - [ ] Specifies `model: sonnet`

  **Relevant Research:** See existing agents for format: `.claude/agents/test-coverage-agent.md`, `.claude/agents/skill-evaluator.md`

  **Skills to Invoke:** `/coding-philosophy`, `/jsdoc-best-practices`

  **Verification:**
  - Type: `manual-check`
  - Command: `test -f .claude/agents/implementer.md && head -5 .claude/agents/implementer.md`
  - Expected: File exists with YAML frontmatter starting with `---`

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "manual-check", "command": "test -f .claude/agents/implementer.md && head -5 .claude/agents/implementer.md", "expected": "File exists with YAML frontmatter" } }`
- **Blocked by:** Task 1

### Task 3: Create `tech-reviewer` agent
- **Subject:** Create .claude/agents/tech-reviewer.md beginner-friendly technical review agent
- **ActiveForm:** Creating tech-reviewer agent
- **Description:**

  **Type:** Task

  **Description:** Create a new agent at `.claude/agents/tech-reviewer.md` for technical code review that explains findings in beginner-friendly language. The agent should:
  - Have read-only tools + Bash (for running tests): `Read, Grep, Glob, Bash`
  - Validate: correctness, security, performance, coding-philosophy compliance, test coverage
  - Output findings ranked by severity (critical/warning/suggestion) with plain-English explanations
  - Assume the human reader has NO technical background — explain "why" something is a problem and "what" the impact is in everyday language
  - Use `model: sonnet`

  **Acceptance Criteria:**
  - [ ] File exists at `.claude/agents/tech-reviewer.md`
  - [ ] Has valid YAML frontmatter with name, description, tools
  - [ ] Limits tools to read-only + Bash
  - [ ] System prompt requires beginner-friendly explanations
  - [ ] Covers: correctness, security, performance, coding-philosophy

  **Skills to Invoke:** `/coding-philosophy`, `/jsdoc-best-practices`

  **Verification:**
  - Type: `manual-check`
  - Command: `test -f .claude/agents/tech-reviewer.md && grep -c "beginner\|plain.English\|non.technical" .claude/agents/tech-reviewer.md`
  - Expected: File exists, at least 1 match for beginner-friendly language requirement

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "manual-check", "command": "test -f .claude/agents/tech-reviewer.md && grep -c 'beginner' .claude/agents/tech-reviewer.md", "expected": "File exists with at least 1 match" } }`
- **Blocked by:** Task 1

### Task 4: Create `product-reviewer` agent
- **Subject:** Create .claude/agents/product-reviewer.md product/UX review agent
- **ActiveForm:** Creating product-reviewer agent
- **Description:**

  **Type:** Task

  **Description:** Create a new agent at `.claude/agents/product-reviewer.md` for product/UX review that validates from a non-technical user's perspective. The agent should:
  - Have tools: `Read, Grep, Glob, Bash` (needs Bash to actually run the feature)
  - Validate: does the feature work as described? Is output correct? Are error messages helpful and clear? Is the behavior intuitive? Does it match the plan's requirements?
  - Actually RUN the feature/script to verify behavior empirically — do not just read the code
  - Assume the human is a product beginner — protect them from approving something that doesn't work
  - Flag any gap between "what was asked for" and "what was built"
  - Use `model: sonnet`

  **Acceptance Criteria:**
  - [ ] File exists at `.claude/agents/product-reviewer.md`
  - [ ] Has valid YAML frontmatter with name, description, tools
  - [ ] System prompt requires empirical behavioral validation (running the feature)
  - [ ] Focuses on user-facing behavior, not implementation details
  - [ ] Assumes human is a beginner

  **Skills to Invoke:** `/coding-philosophy`, `/jsdoc-best-practices`

  **Verification:**
  - Type: `manual-check`
  - Command: `test -f .claude/agents/product-reviewer.md && grep -c "empirical\|run\|execute\|behavior" .claude/agents/product-reviewer.md`
  - Expected: File exists, at least 2 matches for empirical/behavioral validation language

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "manual-check", "command": "test -f .claude/agents/product-reviewer.md && grep -c 'empirical\\|behavior' .claude/agents/product-reviewer.md", "expected": "File exists with at least 2 matches" } }`
- **Blocked by:** Task 1

### Task 5: Create `learner` agent
- **Subject:** Create .claude/agents/learner.md post-implementation learning agent
- **ActiveForm:** Creating learner agent
- **Description:**

  **Type:** Task

  **Description:** Create a new agent at `.claude/agents/learner.md` that runs after implementation to collect and act on learnings. The agent should:
  - Have tools: `Read, Write, Edit, Grep, Glob, Bash, Skill, Task` (needs Skill to invoke `skill-evaluator`, needs Task tools to read task metadata)
  - Workflow:
    1. Read all tasks from the current task list
    2. Collect `learnings` from task metadata
    3. For each learning, invoke the `skill-evaluator` agent to determine: CREATE SKILL, ADD TO RULES, or OMIT
    4. Act on the decision: invoke `skill-creator` skill, or append to `.claude/rules/PROJECT_RULES.md`, or discard
    5. Output a summary of what was learned and what actions were taken
  - Use `model: sonnet`

  **Acceptance Criteria:**
  - [ ] File exists at `.claude/agents/learner.md`
  - [ ] Has valid YAML frontmatter with name, description, tools
  - [ ] Workflow references `skill-evaluator` agent and `skill-creator` skill
  - [ ] Includes all necessary tools for reading tasks and creating skills/rules
  - [ ] Outputs a summary of actions taken

  **Relevant Research:** See `.claude/agents/skill-evaluator.md` for the evaluation criteria. See `.claude/skills/skill-creator/SKILL.md` for skill creation process.

  **Skills to Invoke:** `/coding-philosophy`, `/jsdoc-best-practices`

  **Verification:**
  - Type: `manual-check`
  - Command: `test -f .claude/agents/learner.md && grep -c "skill-evaluator\|skill-creator\|learnings" .claude/agents/learner.md`
  - Expected: File exists, at least 2 matches

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "manual-check", "command": "test -f .claude/agents/learner.md && grep -c 'skill-evaluator\\|learnings' .claude/agents/learner.md", "expected": "File exists with at least 2 matches" } }`
- **Blocked by:** Task 1

### Task 6: Update `.claude/rules/plan.md` with all 6 improvements
- **Subject:** Update plan rules with learn phase, specialized agents, product review, git workflow, lint removal, default recommendations
- **ActiveForm:** Updating plan rules
- **Description:**

  **Type:** Task

  **Description:** Update `.claude/rules/plan.md` to incorporate all 6 improvements. Specific changes:

  **1. Add "learn" phase task (new required task in the task list):**
  Add to the required task list (before the archive task):
  ```
  - a task to be run after all reviews and simplification to collect learnings from all completed tasks and process them through the `learner` agent (which uses `skill-evaluator` to determine if learnings should become skills, rules, or be discarded)
  ```

  **2. Recommend specialized agents (new section):**
  Add an "## Implementation Team Guidance" section that recommends:
  - `implementer` agent for code implementation tasks
  - `tech-reviewer` agent for technical review (beginner-friendly)
  - `product-reviewer` agent for product/UX review (beginner-friendly)
  - `learner` agent for post-implementation learning
  - `test-coverage-agent` for writing tests
  - `code-simplifier` plugin for simplification
  - `coderabbit:review` plugin for CodeRabbit review
  Note: team lead handles git commits/pushes

  **3. Add product review task requirement:**
  Add to the required task list:
  ```
  - (unless the plan includes only trivial changes) a task to be run after implementation to perform a product/UX review using the `product-reviewer` agent, validating the feature works as described from a non-technical user's perspective
  ```

  **4. Git workflow rules (new section "## Git Workflow"):**
  - First task in every plan: verify/create branch, open a **draft** PR (use `gh pr create --draft`)
  - During implementation: only commits (no pushes). Pre-commit hooks validate lint/format/typecheck automatically.
  - After archive task is complete: one final `git push`, then mark PR "Ready for Review" (`gh pr ready`), then enable auto-merge (`gh pr merge --auto --merge`)

  **5. Remove lint/typecheck as separate task:**
  Add a note:
  ```
  NOTE: Do NOT include a separate task for running linter, type checker, or formatter. These are handled automatically by:
  - PostToolUse hooks (lint-on-edit.sh, format-on-edit.sh) on every file edit
  - lint-staged pre-commit hooks (ESLint, prettier, ast-grep) on every git commit
  ```

  **6. Default to recommended option:**
  Add to Required Behaviors:
  ```
  - If a decision is left unresolved by the human, use the recommended option
  ```

  **Acceptance Criteria:**
  - [ ] Learn phase task added to required task list
  - [ ] Implementation Team Guidance section added with specialized agents
  - [ ] Product review task added to required task list
  - [ ] Git Workflow section added (draft PR first, one push at end)
  - [ ] Note about lint/typecheck automation added
  - [ ] "use recommended option" rule added
  - [ ] Existing content preserved (task creation specification, metadata, sizing, etc.)

  **Relevant Research:**
  - Current plan.md: `.claude/rules/plan.md`
  - lint-staged config: `.lintstagedrc.json`
  - PostToolUse hooks: `.claude/settings.json` lines 93-128
  - New agents: `.claude/agents/implementer.md`, `.claude/agents/tech-reviewer.md`, `.claude/agents/product-reviewer.md`, `.claude/agents/learner.md`

  **Skills to Invoke:** `/coding-philosophy`, `/jsdoc-best-practices`

  **Verification:**
  - Type: `documentation`
  - Command: `grep -c "learner\|product-reviewer\|draft PR\|recommended option\|Do NOT include a separate task for running linter" .claude/rules/plan.md`
  - Expected: At least 5 matches (one for each major change)

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy", "/jsdoc-best-practices"], "verification": { "type": "documentation", "command": "grep -c 'learner\\|product-reviewer\\|draft PR\\|recommended option\\|Do NOT include a separate task for running linter' .claude/rules/plan.md", "expected": "At least 5 matches" } }`
- **Blocked by:** Tasks 2, 3, 4, 5 (agents must exist before referencing them in plan rules)

### Task 7: Update `.claude/agent-prompt-test.md`
- **Subject:** Update test prompt template to align with improved plan rules
- **ActiveForm:** Updating test prompt template
- **Description:**

  **Type:** Task

  **Description:** Update `.claude/agent-prompt-test.md` to reflect the new conventions:
  - Add learner role to team structure section
  - Reference specialized agents by name (`implementer`, `tech-reviewer`, `product-reviewer`, `learner`)
  - Add "If a decision is left unresolved, use the recommended option" to Plan output section
  - Add product review to Requirements section
  - Mention that lint/typecheck are handled by hooks (no separate task needed)

  **Acceptance Criteria:**
  - [ ] Learner role mentioned in team structure
  - [ ] Specialized agent names referenced
  - [ ] Default recommendation rule present
  - [ ] Product review mentioned
  - [ ] Lint automation note present

  **Skills to Invoke:** `/coding-philosophy`

  **Verification:**
  - Type: `documentation`
  - Command: `grep -c "learner\|product-reviewer\|recommended option" .claude/agent-prompt-test.md`
  - Expected: At least 3 matches

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "documentation", "command": "grep -c 'learner\\|product-reviewer\\|recommended option' .claude/agent-prompt-test.md", "expected": "At least 3 matches" } }`
- **Blocked by:** Task 6

### Task 8: Update `.claude/agent-prompt.md`
- **Subject:** Update bug-fix prompt template to align with improved plan rules
- **ActiveForm:** Updating bug-fix prompt template
- **Description:**

  **Type:** Task

  **Description:** Update `.claude/agent-prompt.md` (the bug-fix/JIRA template) with the same improvements as Task 7, adapted for bug-fix context:
  - Add learner role to team structure
  - Add product-reviewer for verifying the fix from user perspective
  - Reference specialized agents
  - Add default recommendation rule
  - Mention lint automation

  **Acceptance Criteria:**
  - [ ] Learner role in team structure
  - [ ] Product reviewer for fix verification
  - [ ] Specialized agent names
  - [ ] Default recommendation rule
  - [ ] Lint automation note

  **Skills to Invoke:** `/coding-philosophy`

  **Verification:**
  - Type: `documentation`
  - Command: `grep -c "learner\|product-reviewer\|recommended option" .claude/agent-prompt.md`
  - Expected: At least 3 matches

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "documentation", "command": "grep -c 'learner\\|product-reviewer\\|recommended option' .claude/agent-prompt.md", "expected": "At least 3 matches" } }`
- **Blocked by:** Task 6

### Task 9: Review with CodeRabbit
- **Subject:** Review agent team workflow improvements with CodeRabbit
- **ActiveForm:** Running CodeRabbit review
- **Description:**

  **Type:** Task

  **Description:** Run CodeRabbit code review on all changes. Invoke `coderabbit:review` skill.

  **Skills to Invoke:** `/coding-philosophy`, `coderabbit:review`

  **Verification:**
  - Type: `manual-check`
  - Command: Review output contains no critical issues
  - Expected: Clean or advisory-only review

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "Review output", "expected": "Clean or advisory-only" } }`
- **Blocked by:** Tasks 6, 7, 8

### Task 10: Run local code review
- **Subject:** Run local code review on agent team workflow improvements
- **ActiveForm:** Running local code review
- **Description:**

  **Type:** Task

  **Description:** Run `/plan-local-code-review` skill to review all changes against coding standards and CLAUDE.md compliance.

  **Skills to Invoke:** `/coding-philosophy`, `/plan-local-code-review`

  **Verification:**
  - Type: `manual-check`
  - Command: Review output
  - Expected: Clean or advisory-only review

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "Review output", "expected": "Clean or advisory-only" } }`
- **Blocked by:** Tasks 6, 7, 8

### Task 11: Implement valid review suggestions
- **Subject:** Implement valid suggestions from code reviews
- **ActiveForm:** Implementing review suggestions
- **Description:**

  **Type:** Task

  **Description:** Review findings from Tasks 9 and 10. Implement valid suggestions. Skip suggestions that conflict with project philosophy or are cosmetic-only.

  **Skills to Invoke:** `/coding-philosophy`

  **Verification:**
  - Type: `documentation`
  - Command: `grep -c "learner\|product-reviewer\|draft PR\|recommended option" .claude/rules/plan.md`
  - Expected: Core content still present after review changes

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "documentation", "command": "grep -c 'learner\\|product-reviewer\\|draft PR' .claude/rules/plan.md", "expected": "At least 3 matches" } }`
- **Blocked by:** Tasks 9, 10

### Task 12: Simplify with code simplifier
- **Subject:** Simplify agent and rule files with code simplifier agent
- **ActiveForm:** Simplifying implementation
- **Description:**

  **Type:** Task

  **Description:** Run the `code-simplifier` plugin on the new/modified files to identify simplification opportunities in agent prompts and rule text.

  **Skills to Invoke:** `code-simplifier` plugin

  **Verification:**
  - Type: `documentation`
  - Command: `test -f .claude/agents/implementer.md && test -f .claude/agents/tech-reviewer.md && test -f .claude/agents/product-reviewer.md && test -f .claude/agents/learner.md`
  - Expected: All 4 agent files still exist after simplification

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "documentation", "command": "test -f .claude/agents/implementer.md && test -f .claude/agents/learner.md", "expected": "Files exist" } }`
- **Blocked by:** Task 11

### Task 13: Update/verify documentation
- **Subject:** Verify all documentation is complete and accurate
- **ActiveForm:** Verifying documentation
- **Description:**

  **Type:** Task

  **Description:** Verify JSDoc-style preambles on all new agent files. Verify plan.md is internally consistent. Verify agent-prompt templates reference correct agent names. Verify `.claude/agent-prompt-convo.md` is updated with the latest learnings from this session.

  **Skills to Invoke:** `/jsdoc-best-practices`

  **Verification:**
  - Type: `documentation`
  - Command: `grep -l "description:" .claude/agents/implementer.md .claude/agents/tech-reviewer.md .claude/agents/product-reviewer.md .claude/agents/learner.md`
  - Expected: All 4 files returned (all have description field)

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/jsdoc-best-practices"], "verification": { "type": "documentation", "command": "grep -l 'description:' .claude/agents/implementer.md .claude/agents/tech-reviewer.md .claude/agents/product-reviewer.md .claude/agents/learner.md", "expected": "All 4 files listed" } }`
- **Blocked by:** Task 12

### Task 14: Verify all task verifications
- **Subject:** Run all verification commands from all tasks
- **ActiveForm:** Running all verification commands
- **Description:**

  **Type:** Task

  **Description:** Go through every task in this plan and re-run its verification command. Confirm all pass.

  **Verification:**
  - Type: `manual-check`
  - Command: `test -f .claude/agents/implementer.md && test -f .claude/agents/tech-reviewer.md && test -f .claude/agents/product-reviewer.md && test -f .claude/agents/learner.md && grep -c "learner\|product-reviewer\|draft PR\|recommended option\|Do NOT include a separate task for running linter" .claude/rules/plan.md`
  - Expected: All file existence checks pass, grep returns at least 5

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "test -f .claude/agents/implementer.md && test -f .claude/agents/learner.md && grep -c 'learner\\|product-reviewer\\|draft PR' .claude/rules/plan.md", "expected": "All pass, grep >= 3" } }`
- **Blocked by:** Tasks 12, 13

### Task 15: Collect and process learnings
- **Subject:** Collect learnings from all tasks and process through learner agent
- **ActiveForm:** Collecting and processing learnings
- **Description:**

  **Type:** Task

  **Description:** This is the "learn" phase. Collect `learnings` metadata from all completed tasks. For each learning, use the `skill-evaluator` agent to determine disposition (create skill, add to PROJECT_RULES.md, or discard). Act on each decision. Output a summary.

  **Skills to Invoke:** `/coding-philosophy`

  **Verification:**
  - Type: `manual-check`
  - Command: Summary of learnings and actions taken
  - Expected: At least one learning processed (even if discarded)

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "Learnings summary output", "expected": "At least one learning processed" } }`
- **Blocked by:** Task 14

### Task 16: Archive plan
- **Subject:** Archive the plan to ./plans/completed
- **ActiveForm:** Archiving plan
- **Description:**

  **Type:** Task

  **Description:**
  - Create folder `improve-agent-team-workflow` in `./plans/completed`
  - Rename this plan file to `improve-agent-team-workflow.md`
  - Move it into `./plans/completed/improve-agent-team-workflow/`
  - Read the session IDs from `./plans/completed/improve-agent-team-workflow/improve-agent-team-workflow.md`
  - For each session ID, move `~/.claude/tasks/<session-id>` directory to `./plans/completed/improve-agent-team-workflow/tasks`
  - Update any "in_progress" tasks to "completed"
  - Commit all changes using `/git:commit`
  - Push to PR #162: `GIT_SSH_COMMAND="ssh -o ServerAliveInterval=30 -o ServerAliveCountMax=5" git push`
  - Mark PR ready for review: `gh pr ready 162`
  - Enable auto-merge: `gh pr merge 162 --auto --merge`

  **Skills to Invoke:** `/git:commit`

  **Verification:**
  - Type: `manual-check`
  - Command: `git status && gh pr view 162 --json state,isDraft --jq '{state, isDraft}'`
  - Expected: Clean working directory, PR is OPEN and isDraft=false

- **Metadata:** `{ "plan": "improve-agent-team-workflow", "type": "task", "skills": ["/coding-philosophy"], "verification": { "type": "manual-check", "command": "git status && gh pr view 162 --json state,isDraft", "expected": "Clean directory, isDraft=false" } }`
- **Blocked by:** Task 15

## Task Dependency Graph

```
Task 1 (draft PR)
├── Task 2 (implementer agent)     ─┐
├── Task 3 (tech-reviewer agent)    │── can run in parallel
├── Task 4 (product-reviewer agent) │
├── Task 5 (learner agent)        ─┘
│
└── Tasks 2-5 all complete
    └── Task 6 (update plan.md)
        ├── Task 7 (update agent-prompt-test.md)  ─┐── can run in parallel
        └── Task 8 (update agent-prompt.md)       ─┘
            ├── Task 9 (CodeRabbit review)   ─┐── can run in parallel
            └── Task 10 (local code review)  ─┘
                └── Task 11 (implement review suggestions)
                    └── Task 12 (simplify)
                        ├── Task 13 (verify docs)  ─┐── can run in parallel
                        └── Task 14 (verify all)   ─┘
                            └── Task 15 (learn)
                                └── Task 16 (archive + push + ready PR)
```

## Implementation Team

When ready to implement, spawn an Agent Team with these roles:

> Based on the contents of this plan and its tasks, create a world-class agent team to implement it, then refactor, test, verify, review, and learn from the implementation.

Suggested team structure:
- **implementer** (`general-purpose`): Tasks 2-5, 7-8 — creates the agent files and updates prompt templates
- **rule-writer** (`general-purpose`): Task 6 — updates `.claude/rules/plan.md` (complex, benefits from dedicated focus)
- **reviewer** (`general-purpose`): Tasks 9-11 — runs code reviews and implements suggestions
- **verifier** (`general-purpose`): Tasks 12-14 — simplifies, verifies docs and task verifications
- **learner** (`learner`): Task 15 — collects and processes learnings

Tasks 1 and 16 (git operations) should be done by the team lead.

Note: These use `general-purpose` because the specialized agents we're CREATING in this plan don't exist yet. Future plans will use the specialized agents.

## Verification

End-to-end verification after all tasks complete:

```bash
# All 4 new agents exist
test -f .claude/agents/implementer.md && echo "implementer: OK"
test -f .claude/agents/tech-reviewer.md && echo "tech-reviewer: OK"
test -f .claude/agents/product-reviewer.md && echo "product-reviewer: OK"
test -f .claude/agents/learner.md && echo "learner: OK"

# Plan rules updated
grep -c "learner\|product-reviewer\|draft PR\|recommended option\|Do NOT include a separate task for running linter" .claude/rules/plan.md

# Prompt templates updated
grep -c "learner\|product-reviewer\|recommended option" .claude/agent-prompt-test.md
grep -c "learner\|product-reviewer\|recommended option" .claude/agent-prompt.md

# Git state clean, PR ready
git status
gh pr view 162 --json state,isDraft --jq '{state, isDraft}'
```

## Sessions
