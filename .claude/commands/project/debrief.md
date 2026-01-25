---
description: Evaluates findings.md and uses skill-evaluator to decide where each learning belongs (new skill, .claude/rules/PROJECT_RULES.md, or omit)
argument-hint: <project-directory>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, Skill
---

## Setup

Create workflow tracking tasks with `metadata: { "project": "<project-name>", "phase": "debrief" }`:

1. Read project findings
2. Evaluate each finding
3. Apply decisions

## Step 1: Read Project Findings

Read `$ARGUMENTS/findings.md` FULLY (no limit/offset).

Extract each distinct finding/learning as a separate item.

## Step 2: Evaluate Each Finding

For each finding, use the Task tool with `subagent_type: "skill-evaluator"`:

```
Evaluate this finding from a project debrief:

"[FINDING TEXT]"

Determine if this should be:
1. CREATE SKILL - if it's a complex, reusable pattern
2. ADD TO RULES - if it's a simple never/always rule for .claude/rules/PROJECT_RULES.md
3. OMIT ENTIRELY - if it's already covered or too project-specific
```

Collect all decisions from the skill-evaluator.

## Step 3: Apply Decisions

For each finding based on skill-evaluator's decision:

| Decision | Action |
|----------|--------|
| CREATE SKILL | Use Task tool: "run /skill-creator with [finding details]" |
| ADD TO RULES | Add the rule succinctly to @.claude/rules/PROJECT_RULES.md |
| OMIT ENTIRELY | No action needed |

Report summary:
```
Debrief complete:
- Skills created: [X]
- Rules added: [Y]
- Omitted (redundant/narrow): [Z]
```
