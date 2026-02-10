# Plan: Fix Agent Team E2E Test Bugs

## Context

Five bugs were discovered during E2E testing of `/plan:create` and `/plan:implement` (documented in `AGENT_TEAM_TEST.md`). These bugs affect plan archival, task metadata, context compaction resilience, and specification gap detection. The fixes are all to markdown instruction files (skills, rules, agents) — no TypeScript code changes.

- **Type**: Task
- **Branch**: `fix/plan-skill-e2e-bugs` (from `main`)
- **PR target**: `main`

## Bugs and Fixes

### Bug A: Plan-create session tasks missing from archive

**Symptom:** After archival, only plan-implement session tasks were moved. Plan-create session tasks were missing.
**Root cause:** The `## Sessions` table in the archived plan was empty. The archive step likely used the Write tool to create the file at `plans/completed/` (overwriting sessions data) instead of `mv` via Bash.
**Fix:** Mandate `mv` via Bash in both `plan-implement/SKILL.md` archive instructions and `plan.md` archive task description.

### Bug B: Orphaned plan file in plans/ root after archive

**Symptom:** `plans/fibonacci-demo-script.md` remains in plans/ root after archival — source file wasn't deleted.
**Root cause:** Same as Bug A — archive copied rather than moved.
**Fix:** Same as Bug A — use `mv`, verify source deletion.

### Bug C: Tasks missing metadata (skills, verification)

**Symptom:** TaskCreate metadata only had `{ "plan": "...", "type": "task" }` — missing `skills` and `verification`.
**Root cause:** `plan-implement/SKILL.md` says "Create tasks using TaskCreate" but doesn't instruct the team lead to include full metadata from the plan's JSON code fences.
**Fix:** Add explicit metadata parsing instructions to `plan-implement/SKILL.md`. Reinforce metadata requirements in `plan-create/SKILL.md` plan output.

### Bug D: Task owner field lost after context compaction

**Symptom:** Tasks created/updated after mid-session compaction lost their `owner` field.
**Root cause:** Platform limitation — compaction loses in-memory state. Team lead "forgot" to set owners after compaction.
**Fix:** Add compaction resilience section to `plan-implement/SKILL.md`: store owner in metadata as backup, re-read TaskList after compaction.

### Bug E: Product agent doesn't identify spec gaps during planning

**Symptom:** User said "create a fibonacci generator" but was never asked "What language?", "How high should numbers go?", etc.
**Root cause:** The product-reviewer in plan-create Phase 2 reviews the draft plan from a UX perspective but doesn't analyze the raw input for specification gaps BEFORE the draft is written.
**Fix:** Create a new `spec-analyst` agent (`.claude/agents/spec-analyst.md` + template copy) dedicated to identifying specification gaps. Add it to plan-create Phase 1. Add a "Gap Resolution" step between Phase 1 and Phase 2 where the team lead asks the user about identified gaps via AskUserQuestion.

## Files to Modify

| # | File | Template Copy | Change |
|---|------|---------------|--------|
| 1 | `.claude/skills/plan-implement/SKILL.md` | `all/copy-overwrite/.claude/skills/plan-implement/SKILL.md` | Full rewrite (26 → ~80 lines): metadata requirements, compaction resilience, archive instructions |
| 2 | `.claude/skills/plan-create/SKILL.md` | `all/copy-overwrite/.claude/skills/plan-create/SKILL.md` | Add spec-analyst to Phase 1, add Gap Resolution step, reinforce metadata in Step 4 |
| 3 | `.claude/rules/plan.md` | `all/copy-overwrite/.claude/rules/plan.md` | Rewrite archive task bullets to mandate `mv` via Bash, verify source deletion |
| 4 | `.claude/agents/spec-analyst.md` (NEW) | `all/copy-overwrite/.claude/agents/spec-analyst.md` (NEW) | Dedicated agent for identifying specification gaps during plan-create |

**Not modified (and why):**
- `track-plan-sessions.sh` — Hook works correctly; the bug is that archive overwrites the file, not that the hook fails to write
- `product-reviewer.md` — Remains focused on post-implementation validation; gap analysis handled by the new `spec-analyst` agent

## Implementation Details

### 1. plan-implement/SKILL.md — Full Rewrite

Expand from 26 lines to ~80 lines with these new sections:

**Task Metadata Requirements section:**
- Step 3 must instruct team lead to parse JSON metadata code fences from each plan task
- Include ALL fields: `plan`, `type`, `skills`, `verification`
- Flag tasks with missing metadata blocks as errors before proceeding

**Compaction Resilience section:**
- Store owner in both `owner` field and `metadata.owner` on every TaskUpdate
- After compaction: re-read TaskList, restore missing owners from `metadata.owner`
- Always call TaskList before assigning new work (don't rely on memory)

**Archive Instructions section:**
- Create destination folder with `mkdir -p`
- Verify `## Sessions` table has entries before moving
- Use `mv` via Bash (NOT Write/Edit) to move plan file — this preserves the Sessions table
- Verify original file is gone from `plans/`
- Parse session IDs from the moved file's `## Sessions` table
- Move each `~/.claude/tasks/<session-id>` to `./plans/completed/<plan-name>/tasks/` via Bash `mv`
- Fallback: if Sessions table is empty, search `~/.claude/tasks/*/` for task files with matching `"plan": "<plan-name>"` in metadata
- Update remaining in_progress tasks to completed
- Final git push, `gh pr ready`, `gh pr merge --auto --merge`

### 2. spec-analyst.md — New Agent

Create `.claude/agents/spec-analyst.md` and `all/copy-overwrite/.claude/agents/spec-analyst.md`:
- **Tools**: Read, Grep, Glob (read-only — no Bash, no Write/Edit)
- **Model**: not specified (inherits session default)
- **Purpose**: Analyze requirements for ambiguities, missing details, and unstated assumptions
- **Output**: Numbered list of clarifying questions with why each matters
- **Focus areas**: Technology/language choice, scale/performance limits, input/output format, error handling behavior, target audience, deployment context, integration points, edge cases
- **Rules**: Never assume defaults for ambiguous requirements. Never answer questions on behalf of the user. Flag every gap, even if it seems obvious. Prioritize questions by impact on architecture.

### 3. plan-create/SKILL.md — Add Gap Analysis and Metadata

**New Phase 1 teammate — Spec Gap Analyst:**
- **Name**: `spec-analyst`
- **Agent type**: `spec-analyst` (new dedicated agent)
- **Mode**: `plan`
- **Prompt**: Analyze the input for specification gaps. Identify every ambiguity or unstated assumption that could lead to wrong architectural decisions. Report as a numbered list of questions.

**New Gap Resolution step** (between Phase 1 synthesis and Phase 2 review):
1. Collect gaps from spec-analyst's findings
2. Present gaps to user via AskUserQuestion
3. If no gaps: state "No specification gaps identified" and proceed
4. Incorporate answers into the draft plan before Phase 2

**Metadata reinforcement in Step 4:**
- Add note that every task in the plan MUST include a JSON metadata code fence with `plan`, `type`, `skills`, and `verification` — plan-implement parses these blocks for TaskCreate calls

### 4. plan.md — Archive Task Description

Replace the current archive bullet list with explicit instructions:
- Mandate `mv` via Bash tool (NOT Write/Edit/copy)
- Add "verify source is gone" step
- Add "read and parse `## Sessions` table" step
- Add fallback for empty Sessions table (search by plan name in task metadata)

## Tasks

### Task 1: Create branch and draft PR

**Type:** Task

**Description:** Switch to main, create branch `fix/plan-skill-e2e-bugs`, push, and open a draft PR targeting main.

**Verification:**
```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "gh pr view --json state,baseRefName,headRefName",
    "expected": "Draft PR from fix/plan-skill-e2e-bugs targeting main"
  }
}
```

### Task 2: Rewrite plan-implement SKILL.md

**Type:** Task

**Description:** Full rewrite of `.claude/skills/plan-implement/SKILL.md` expanding from 26 to ~80 lines. Add: Task Metadata Requirements section (parse JSON code fences, include all metadata fields), Compaction Resilience section (dual owner storage, re-read after compaction), Archive Instructions section (use `mv` via Bash, verify Sessions table, parse session IDs, fallback search). Update template copy at `all/copy-overwrite/.claude/skills/plan-implement/SKILL.md` to match.

**Acceptance Criteria:**
- [ ] Metadata section instructs team lead to parse JSON code fences and include `skills` + `verification`
- [ ] Compaction section instructs dual owner storage (`owner` + `metadata.owner`)
- [ ] Archive section mandates `mv` via Bash, prohibits Write/Edit for plan file moves
- [ ] Archive section includes fallback for empty Sessions table
- [ ] Template copy matches root copy exactly

**blockedBy:** [1]

**Verification:**
```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "manual-check",
    "command": "diff .claude/skills/plan-implement/SKILL.md all/copy-overwrite/.claude/skills/plan-implement/SKILL.md",
    "expected": "No differences (files match)"
  }
}
```

### Task 3: Create spec-analyst agent

**Type:** Task

**Description:** Create `.claude/agents/spec-analyst.md` and `all/copy-overwrite/.claude/agents/spec-analyst.md`. Dedicated agent for identifying specification gaps during plan-create. Read-only tools (Read, Grep, Glob). Model: sonnet. Outputs a numbered list of clarifying questions.

**Acceptance Criteria:**
- [ ] Agent file exists at `.claude/agents/spec-analyst.md`
- [ ] Template copy exists at `all/copy-overwrite/.claude/agents/spec-analyst.md`
- [ ] Both files are identical
- [ ] Agent has read-only tools (no Bash, no Write/Edit)
- [ ] Agent focuses on gap detection, not answering questions on behalf of user

**blockedBy:** [1]

**Verification:**
```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "manual-check",
    "command": "diff .claude/agents/spec-analyst.md all/copy-overwrite/.claude/agents/spec-analyst.md",
    "expected": "No differences (files match)"
  }
}
```

### Task 4: Update plan-create SKILL.md

**Type:** Task

**Description:** Add `spec-analyst` agent to Phase 1 teammates, add Gap Resolution step between Phase 1 and Phase 2 (team lead asks user via AskUserQuestion), reinforce metadata requirements in Step 4. Update template copy at `all/copy-overwrite/.claude/skills/plan-create/SKILL.md` to match.

**Acceptance Criteria:**
- [ ] Phase 1 includes `spec-analyst` teammate (spec-analyst agent type, plan mode)
- [ ] Gap Resolution step added between Phase 1 and Phase 2
- [ ] Step 4 reinforces that every task MUST have JSON metadata code fence
- [ ] Template copy matches root copy exactly

**blockedBy:** [1]

**Verification:**
```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "manual-check",
    "command": "diff .claude/skills/plan-create/SKILL.md all/copy-overwrite/.claude/skills/plan-create/SKILL.md",
    "expected": "No differences (files match)"
  }
}
```

### Task 5: Update plan.md archive instructions

**Type:** Task

**Description:** Rewrite the archive task bullet list in `.claude/rules/plan.md` to mandate `mv` via Bash, verify source deletion, parse Sessions table, and include fallback. Update template copy at `all/copy-overwrite/.claude/rules/plan.md` to match.

**Acceptance Criteria:**
- [ ] Archive bullets mandate `mv` via Bash (NOT Write/Edit)
- [ ] Includes "verify source is gone" step
- [ ] Includes "parse `## Sessions` table" step
- [ ] Includes fallback for empty Sessions table
- [ ] Template copy matches root copy exactly

**blockedBy:** [1]

**Verification:**
```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "diff .claude/rules/plan.md all/copy-overwrite/.claude/rules/plan.md",
    "expected": "No differences (files match)"
  }
}
```

### Task 6: Product/UX review

**Type:** Task
**Description:** Run product/UX review using `product-reviewer` agent. Validate the skill instructions are clear from a non-technical perspective. Read all modified files and verify instructions are unambiguous.
**blockedBy:** [2, 3, 4, 5]

```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Product review completed'",
    "expected": "Review findings documented"
  }
}
```

### Task 7: CodeRabbit code review

**Type:** Task
**Description:** Run CodeRabbit code review on all changes.
**blockedBy:** [2, 3, 4, 5]

```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": ["coderabbit:code-review"],
  "verification": {
    "type": "manual-check",
    "command": "echo 'CodeRabbit review completed'",
    "expected": "Review findings documented"
  }
}
```

### Task 8: Local code review

**Type:** Task
**Description:** Run local code review via `/plan-local-code-review`.
**blockedBy:** [2, 3, 4, 5]

```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": ["plan-local-code-review"],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Local review completed'",
    "expected": "Review findings documented"
  }
}
```

### Task 9: Technical review

**Type:** Task
**Description:** Run technical review using `tech-reviewer` agent. Check for consistency across all modified files — archive instructions in plan.md should align with plan-implement SKILL.md.
**blockedBy:** [2, 3, 4, 5]

```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Technical review completed'",
    "expected": "Review findings documented"
  }
}
```

### Task 10: Implement review suggestions

**Type:** Task
**Description:** Implement valid suggestions from tasks 6-9. Update both root and template copies.
**blockedBy:** [6, 7, 8, 9]

```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "diff .claude/skills/plan-implement/SKILL.md all/copy-overwrite/.claude/skills/plan-implement/SKILL.md && diff .claude/skills/plan-create/SKILL.md all/copy-overwrite/.claude/skills/plan-create/SKILL.md && diff .claude/rules/plan.md all/copy-overwrite/.claude/rules/plan.md",
    "expected": "No differences between root and template copies"
  }
}
```

### Task 11: Simplify code

**Type:** Task
**Description:** Run `code-simplifier` agent on modified files. Ensure instructions are clear, concise, and free of redundancy.
**blockedBy:** [10]

```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "wc -l .claude/skills/plan-implement/SKILL.md .claude/skills/plan-create/SKILL.md",
    "expected": "Reasonable line counts (plan-implement ~80, plan-create ~200)"
  }
}
```

### Task 12: Update tests

**Type:** Task
**Description:** N/A — these are markdown instruction files, not code. No unit tests exist or are needed. Verification is via E2E re-testing (documented in AGENT_TEAM_TEST.md).
**blockedBy:** [10]

```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'No tests needed for markdown instruction files'",
    "expected": "N/A confirmed"
  }
}
```

### Task 13: Update documentation

**Type:** Task
**Description:** Update AGENT_TEAM_TEST.md to reflect the fixes. Mark the Issues Found section as addressed with references to the PR.
**blockedBy:** [10]

```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": ["jsdoc-best-practices"],
  "verification": {
    "type": "documentation",
    "command": "grep -c 'fix/plan-skill-e2e-bugs' AGENT_TEAM_TEST.md",
    "expected": "At least 1 match"
  }
}
```

### Task 14: Verify all verification metadata

**Type:** Task
**Description:** Read all task files and verify every task has complete metadata with `plan`, `type`, `skills`, and `verification` fields.
**blockedBy:** [10]

```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'All task metadata verified'",
    "expected": "Every task has plan, type, skills, verification"
  }
}
```

### Task 15: Collect learnings

**Type:** Task
**Description:** Run `learner` agent to process task metadata for learnings about agent team workflows, archive processes, and specification gap detection.
**blockedBy:** [11, 12, 13, 14]

```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "echo 'Learnings collected'",
    "expected": "Learner agent completed processing"
  }
}
```

### Task 16: Archive the plan

**Type:** Task
**Description:** Archive this plan following the updated archive instructions:
- Create folder `calm-squishing-toucan` in `./plans/completed`
- Rename plan to reflect actual contents (e.g., `fix-plan-skill-e2e-bugs.md`)
- Move it to `./plans/completed/calm-squishing-toucan/` using `mv` via Bash
- Read session IDs from the `## Sessions` table in the moved plan file
- Move each `~/.claude/tasks/<session-id>` directory to `./plans/completed/calm-squishing-toucan/tasks`
- Update any "in_progress" tasks to "completed"
- Commit and push changes
- `gh pr ready`
- `gh pr merge --auto --merge`
**blockedBy:** [15]

```json
{
  "plan": "calm-squishing-toucan",
  "type": "task",
  "skills": [],
  "verification": {
    "type": "manual-check",
    "command": "ls plans/completed/calm-squishing-toucan/ && ! ls plans/calm-squishing-toucan.md 2>/dev/null",
    "expected": "Plan in completed dir, not in plans root"
  }
}
```

## Implementation Team

| Agent | Use For |
|-------|---------|
| `implementer` | Writing the SKILL.md and plan.md changes |
| `tech-reviewer` | Technical review |
| `product-reviewer` | Product/UX review |
| `code-simplifier` | Simplify instruction text |
| `coderabbit` | CodeRabbit review |
| `learner` | Post-implementation learning |

Team lead handles git operations. Tasks 2-5 can run in parallel (1-2 implementers). Tasks 6-9 can run in parallel (4 review agents).

## Verification

After merge, re-run the E2E test from AGENT_TEAM_TEST.md:
1. `/plan:create create a fibonacci generator` — verify spec-analyst identifies gaps and user is asked clarifying questions
2. `/plan:implement <plan>` — verify tasks have full metadata, archive uses `mv`, sessions are preserved
