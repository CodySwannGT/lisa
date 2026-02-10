# Agent Team Workflow E2E Test Plan

## Purpose

End-to-end validation of the refactored `/plan:create` and `/plan:implement` skills after the plan.md governance split and agent team restructuring (PR #167).

## Prerequisites

- On branch `refactor/plan-agent-team-workflow` (or `main` after merge)
- Default permission mode (no special mode)
- No active agent teams running

## Test 1: plan-create — Full Workflow

### Setup

Run from the Lisa project root in a fresh Claude Code session (default mode).

### Command

```
/plan:create Add a fibonacci CLI tool that accepts a number N via command-line argument and prints the first N fibonacci numbers. Support three algorithms: recursive, iterative, and memoized. Include a --benchmark flag that times each algorithm and prints a comparison table.
```

> **Why this prompt?** It's complex enough (multiple files, CLI parsing, multiple algorithms, benchmarking) to avoid the "Trivial" complexity assessment shortcut in Step 3.

### Expected Results

#### Step 1-2: Parse Input & Detect Plan Type

- [ ] Input parsed as **free text**
- [ ] Plan type detected as **Task** (internal work, no user-facing UI)

#### Step 3: Complexity Assessment

- [ ] Classified as **Standard** or **Epic** (not Trivial)
- [ ] Proceeds through all phases (does NOT skip to Step 8)

#### Step 4: Phase 1 — Research (parallel)

- [ ] Agent team created
- [ ] `researcher` spawned as `general-purpose` with `bypassPermissions` mode
- [ ] `explorer` spawned as `Explore` agent
- [ ] Both agents run in parallel (not sequentially)
- [ ] Both report back via SendMessage (not file writes)
- [ ] `researcher` extracts requirements from the free text description
- [ ] `explorer` finds relevant files (e.g., `package.json` scripts, existing CLI patterns in `src/`, TypeScript conventions)

#### Step 5: Phase 1.5 — Research Brief

- [ ] Team lead synthesizes a structured Research Brief containing:
  - Ticket/spec details (requirements extracted from prompt)
  - Relevant files identified by explorer
  - Existing patterns (e.g., commander.js already in dependencies)
  - Architecture constraints
  - Reusable utilities

#### Step 6: Phase 2 — Domain Sub-Plans (parallel)

- [ ] `arch-planner` spawned as `architecture-planner` with `bypassPermissions`
- [ ] `test-strategist` spawned as `test-strategist` with `bypassPermissions`
- [ ] `security-planner` spawned as `security-planner` with `bypassPermissions`
- [ ] `product-planner` spawned as `product-planner` with `bypassPermissions`
- [ ] All four run in parallel
- [ ] Each receives the Research Brief in their prompt
- [ ] `arch-planner` returns: files to create/modify, dependency graph, design decisions
- [ ] `test-strategist` returns: test matrix, edge cases, coverage targets, TDD sequence
- [ ] `security-planner` returns: STRIDE analysis (likely "no security concerns" for a CLI tool)
- [ ] `product-planner` returns: user flows in Gherkin, acceptance criteria, error handling

#### Step 7: Phase 3 — Review (parallel)

- [ ] `devils-advocate` spawned as `general-purpose` with `bypassPermissions` and adversarial prompt
- [ ] `consistency-checker` spawned as `consistency-checker` with `bypassPermissions`
- [ ] Both run in parallel
- [ ] `devils-advocate` challenges assumptions, flags potential issues
- [ ] `consistency-checker` verifies cross-plan consistency (file lists align, tests cover arch changes)

#### Step 8: Phase 4 — Synthesis

- [ ] Team lead reads `@.claude/rules/plan-governance.md` for governance rules
- [ ] Team lead reads `@.claude/rules/plan.md` for task document format
- [ ] Unified plan includes:
  - Title and context
  - Plan type (Task)
  - Branch and PR (new branch created, draft PR opened)
  - Synthesized analysis from all teammates
  - Implementation approach
  - Tasks following Task Creation Specification from plan.md
  - Implementation Team instructions
- [ ] Required Tasks from plan-governance.md are included:
  - Product/UX review
  - CodeRabbit code review
  - Local code review
  - Technical review
  - Implement review suggestions
  - Simplify code
  - Update tests
  - Update documentation
  - Verify metadata
  - Collect learnings
  - Archive plan (always last)
- [ ] Plan written to `plans/<name>.md`
- [ ] Branch created
- [ ] Draft PR opened

#### Step 9-10: Present to User & Shutdown

- [ ] Plan presented for user review (approve/modify/reject)
- [ ] All teammates receive shutdown_request
- [ ] Team cleaned up

#### Governance Isolation

- [ ] Domain planners (Phase 2) did NOT mention branch/PR rules, required tasks, or git workflow in their sub-plans
- [ ] Only the team lead (Phase 4) applied governance rules
- [ ] No agent was spawned in `plan` mode (all use `bypassPermissions` or default)

### Actual Results

<!-- Fill in what actually happened -->

**Step 1-2 (Parse & Detect):**

**Step 3 (Complexity):**

**Step 4 (Phase 1 — Research):**

**Step 5 (Phase 1.5 — Research Brief):**

**Step 6 (Phase 2 — Domain Sub-Plans):**

**Step 7 (Phase 3 — Review):**

**Step 8 (Phase 4 — Synthesis):**

**Step 9-10 (Present & Shutdown):**

**Governance Isolation:**

**Issues Found:**

---

## Test 2: plan-implement — Full Workflow

### Setup

Run from the Lisa project root. Requires a plan file from Test 1 (or any valid plan file).

### Command

```
/plan:implement plans/<name-from-test-1>.md
```

### Expected Results

#### Step 1: Parse Plan

- [ ] Plan file read successfully
- [ ] All tasks extracted with dependencies, descriptions, and verification metadata
- [ ] Dependency graph built correctly

#### Step 2: Setup

- [ ] `@.claude/rules/plan-governance.md` read for governance rules
- [ ] `@.claude/rules/plan.md` read for task document format
- [ ] Branch verified/created
- [ ] Draft PR verified/created
- [ ] Implementer count determined based on task graph:
  - 1-2 independent tasks → 1 implementer
  - 3-5 independent tasks → 2 implementers
  - 6+ independent tasks → 3 implementers (cap)
- [ ] Actual count chosen: ___

#### Step 3: Create Agent Team

- [ ] Agent team created
- [ ] Implementers spawned as `implementer` with `bypassPermissions` (named `implementer-1`, `implementer-2`, etc.)
- [ ] All tasks created via TaskCreate with proper `blockedBy` relationships
- [ ] First batch of independent tasks assigned to implementers

#### Step 4: Phase 2 — Implementation

- [ ] Implementers follow TDD cycle:
  - [ ] RED: Write failing test first
  - [ ] GREEN: Write minimum code to pass
  - [ ] REFACTOR: Clean up while tests stay green
- [ ] Team lead commits after each completed task (`git add <files>` + `git commit`)
- [ ] Tasks assigned as dependencies resolve
- [ ] Conventional commit messages used

#### Step 5: Phase 3 — Reviews (parallel)

- [ ] `tech-reviewer` spawned as `tech-reviewer` with `bypassPermissions`
- [ ] `product-reviewer` spawned as `product-reviewer` with `bypassPermissions`
- [ ] `/plan-local-code-review` invoked by team lead
- [ ] `coderabbit` spawned as `coderabbit:code-reviewer` with `bypassPermissions`
- [ ] All reviews run in parallel

#### Step 6: Phase 4 — Post-Review

- [ ] Implementer re-spawned to fix valid review suggestions
- [ ] `code-simplifier` spawned as `code-simplifier:code-simplifier` with `bypassPermissions`
- [ ] `test-coverage-agent` spawned to update tests for post-review changes
- [ ] Team lead runs ALL proof commands from all tasks — all pass

#### Step 7: Phase 5 — Learning & Archive

- [ ] `learner` spawned as `learner` with `bypassPermissions`
- [ ] Learner processes task metadata for learnings
- [ ] Plan archived:
  - [ ] Folder created in `./plans/completed/<plan-name>`
  - [ ] Plan file moved and renamed
  - [ ] Task directories moved
  - [ ] All "in_progress" tasks updated to "completed"
- [ ] Final `git push`
- [ ] PR marked ready (`gh pr ready`)
- [ ] Auto-merge enabled (`gh pr merge --auto --merge`)

#### Step 8: Shutdown

- [ ] All teammates receive shutdown_request
- [ ] Team cleaned up

### Actual Results

<!-- Fill in what actually happened -->

**Step 1 (Parse Plan):**

**Step 2 (Setup):**

**Step 3 (Create Agent Team):**

**Step 4 (Phase 2 — Implementation):**

**Step 5 (Phase 3 — Reviews):**

**Step 6 (Phase 4 — Post-Review):**

**Step 7 (Phase 5 — Learning & Archive):**

**Step 8 (Shutdown):**

**Issues Found:**

---

## Test 3: plan-create — Trivial Complexity Shortcut

### Setup

Run from the Lisa project root in a fresh Claude Code session (default mode).

### Command

```
/plan:create Update the README.md to add a "Contributing" section
```

### Expected Results

#### Complexity Assessment

- [ ] Classified as **Trivial** (single file, documentation update)
- [ ] Skips directly to Step 8 (Synthesis) — no agent team spawned
- [ ] No domain planners, no adversarial review
- [ ] Plan still includes Required Tasks from plan-governance.md
- [ ] Plan still follows Task Creation Specification from plan.md
- [ ] Branch created, draft PR opened

### Actual Results

<!-- Fill in what actually happened -->

**Complexity Assessment:**

**Agent Team Spawned?** (should be No):

**Plan Quality:**

**Issues Found:**

---

## Test 4: plan-create — Bug Type Detection

### Setup

Run from the Lisa project root in a fresh Claude Code session (default mode).

### Command

```
/plan:create The fibonacci CLI crashes with a stack overflow when N > 40 using the recursive algorithm
```

> **Note:** This test only validates plan creation, not that the bug actually exists. The key behavior is that the plan-create workflow correctly identifies this as a Bug and applies bug-specific rules.

### Expected Results

#### Type Detection

- [ ] Plan type detected as **Bug**
- [ ] Researcher attempts empirical reproduction (runs the CLI, observes the crash)
- [ ] If reproduction fails: workflow STOPs and reports what additional info is needed
- [ ] If reproduction succeeds: plan includes:
  - [ ] Replication step task (mandatory)
  - [ ] Root cause analysis
  - [ ] Regression test (fails without fix, passes with fix)
  - [ ] Verification task (re-run replication after fix)

### Actual Results

<!-- Fill in what actually happened -->

**Type Detection:**

**Reproduction Attempted?:**

**Bug-Specific Tasks Included?:**

**Issues Found:**

---

## Test 5: Governance Isolation Verification

### Purpose

Verify that domain planner agents do NOT see governance rules from `plan-governance.md`. This is the core architectural improvement of the refactor.

### Method

During Test 1, observe the sub-plan outputs from Phase 2 agents (architecture-planner, test-strategist, security-planner, product-planner).

### Expected Results

- [ ] No Phase 2 agent mentions "draft PR", "gh pr create", or "git push"
- [ ] No Phase 2 agent mentions "archive the plan" or "plans/completed"
- [ ] No Phase 2 agent mentions "Required Tasks" or lists review tasks
- [ ] No Phase 2 agent mentions "auto-merge" or "gh pr merge"
- [ ] No Phase 2 agent was spawned in `plan` mode
- [ ] The `enforce-plan-rules.sh` hook did NOT fire for any teammate (only fires in plan mode)

### Actual Results


<!-- Fill in what actually happened -->

**Issues Found:**

All issues have been addressed in branch `fix/plan-skill-e2e-bugs` (PR #169):

1. **Bug A - Plan-create session tasks missing from archive**: After everything is completed, the plan is supposed to be archived to plans/completed with the original plan and all the tasks from the /plan:create and /plan:implement. the plan file was moved and the tasks for /plan:implement were moved over, but the tasks from /plan:create are missing. This might be due to the way tasks are structured when working with agent teams, but I am unclear. The docs seem to say it's like this: ~/.claude/tasks/{team-name}/
   - **Status**: FIXED - Mandated `mv` via Bash in plan-implement and plan.md to ensure all session task directories are moved to archive

2. **Bug B - Orphaned plan file in plans/ root after archive**: Despite the success of #1, @plans/fibonacci-demo-script.md remains directly in the plans/directly (duplicating what's in plans/completed). It should only be in the created/directory
   - **Status**: FIXED - Same fix as Bug A, using `mv` command with verification that source is deleted after move

3. **Bug C - Tasks missing metadata**: The tasks that were created for the agent team did not follow the task specification in @.claude/rules/plan.md. They all lacked the following meta data. This may be because of the changes we made to how/when plan.md is loaded:
   ```json
   {
     "skills": ["..."],
     "verification": {
       "type": "test|ui-recording|test-coverage|api-test|manual-check|documentation",
       "command": "the proof command",
       "expected": "what success looks like"
     }
   }
   ```
   - **Status**: FIXED - Added metadata parsing instructions to plan-implement skill

4. **Bug D - Task owner field lost after context compaction**: In the middle of /plan:implement, Claude compacted. After that, the tasks lost their "owner" field. I'm not sure if this is a bug or because the tasks were at this point "completed", but you can see it change in @plans/completed/fibonacci-generator/tasks/15.json where the previous tasks had the field.
   - **Status**: FIXED - Added compaction resilience section to plan-implement skill

5. **Bug E - Product agent doesn't identify spec gaps**: I think we need to change the purpose of the Product agent. We need an agent who is very well versed in product and can recongize gaps in the spec/plan and point them out. For example, I used the prompt: "/plan:create create a fibonachi generator - I know this is trivial, but it's a test, so I don't want you to skip anything" as a test, but I was never asked "what language do you want it written in?" or "How high do you want the numbers to go"? We have to assume the human providing the spec has a lot of blind spots.
   - **Status**: FIXED - Created spec-analyst agent, added to plan-create Phase 1, added Gap Resolution step between Phase 1 and Phase 2

---

## Summary

| Test | Description | Pass/Fail | Notes |
|------|-------------|-----------|-------|
| 1 | plan-create full workflow | | |
| 2 | plan-implement full workflow | | |
| 3 | Trivial complexity shortcut | | |
| 4 | Bug type detection | | |
| 5 | Governance isolation | | |

## Files Changed in This Refactor (for debugging context)

| File | What Changed |
|------|-------------|
| `.claude/rules/plan.md` | Stripped to document format only (no governance) |
| `.claude/rules/plan-governance.md` | NEW — extracted governance rules |
| `all/copy-overwrite/.claude/rules/plan.md` | Template version — same as above |
| `all/copy-overwrite/.claude/rules/plan-governance.md` | Template version — same as above |
| `.claude/rules/lisa.md` | Added plan-governance.md to managed files table |
| `all/copy-overwrite/.claude/rules/lisa.md` | Template version — same as above |
| `.claude/skills/plan-create/SKILL.md` | 4-phase workflow (Research → Sub-Plans → Review → Synthesis) |
| `all/copy-overwrite/.claude/skills/plan-create/SKILL.md` | Template version (minor wording diffs) |
| `.claude/skills/plan-implement/SKILL.md` | 5-phase workflow (Setup → Implementation → Reviews → Post-Review → Learning) |
| `all/copy-overwrite/.claude/skills/plan-implement/SKILL.md` | Template version (minor wording diffs) |
| `.claude/agents/implementer.md` | Added TDD (RED/GREEN/REFACTOR) to workflow |
| `all/copy-overwrite/.claude/agents/implementer.md` | Template version — same as above |
| `.claude/agents/architecture-planner.md` | NEW — technical architecture planning |
| `.claude/agents/test-strategist.md` | NEW — test strategy planning |
| `.claude/agents/security-planner.md` | NEW — security threat modeling |
| `.claude/agents/product-planner.md` | NEW — product/UX planning |
| `.claude/agents/consistency-checker.md` | NEW — cross-plan consistency verification |
| `all/copy-overwrite/.claude/agents/architecture-planner.md` | Template version |
| `all/copy-overwrite/.claude/agents/test-strategist.md` | Template version |
| `all/copy-overwrite/.claude/agents/security-planner.md` | Template version |
| `all/copy-overwrite/.claude/agents/product-planner.md` | Template version |
| `all/copy-overwrite/.claude/agents/consistency-checker.md` | Template version |
| `all/copy-overwrite/.claude/agents/tech-reviewer.md` | Moved from Lisa-only to template |
| `all/copy-overwrite/.claude/agents/product-reviewer.md` | Moved from Lisa-only to template |
| `all/copy-overwrite/.claude/agents/learner.md` | Moved from Lisa-only to template |

## Key Architecture Decisions (for debugging context)

| Decision | Choice | Why |
|----------|--------|-----|
| Teammate mode | `bypassPermissions` (not `plan`) | Plan mode restricts to read-only and triggers enforce-plan-rules.sh |
| Communication | SendMessage (not file writes) | Avoids filesystem coordination conflicts between parallel agents |
| Devil's advocate | `general-purpose` with adversarial prompt | Role is too context-specific for a reusable agent definition |
| Implementer count | Dynamic (1-3) based on task parallelism | Fixed count wastes resources or under-utilizes |
| Governance split | Separate file (`plan-governance.md`) | Prevents governance rules from bleeding into domain planner contexts |
| Complexity assessment | Trivial/Standard/Epic | Trivial plans skip full agent team to avoid overhead |
