---
description: Evaluates findings.md and uses skill-evaluator to decide where each learning belongs (new skill, PROJECT_RULES.md, or omit)
argument-hint: <project-directory>
---

## Step 0: MANDATORY SETUP

Use TodoWrite to create workflow tracking todos:
- Step 1: Read project findings
- Step 2: Evaluate each finding
- Step 3: Apply decisions

⚠️ **CRITICAL**: DO NOT STOP until all 3 todos are marked completed.

## Step 1: Read Project Findings
Mark "Step 1: Read project findings" as in_progress.

Read the `findings.md` file inside $ARGUMENTS FULLY (no limit/offset).

Extract each distinct finding/learning as a separate item.

Mark "Step 1: Read project findings" as completed. Proceed to Step 2.

## Step 2: Evaluate Each Finding
Mark "Step 2: Evaluate each finding" as in_progress.

For each finding extracted from findings.md:

Use the Task tool with `subagent_type: "skill-evaluator"` to evaluate where (and if) the finding should be recorded:

```
Evaluate this finding from a project debrief:

"[FINDING TEXT]"

Determine if this should be:
1. CREATE SKILL - if it's a complex, reusable pattern
2. ADD TO RULES - if it's a simple never/always rule for PROJECT_RULES.md
3. OMIT ENTIRELY - if it's already covered or too project-specific
```

Collect all decisions from the skill-evaluator.

Mark "Step 2: Evaluate each finding" as completed. Proceed to Step 3.

## Step 3: Apply Decisions
Mark "Step 3: Apply decisions" as in_progress.

For each finding based on skill-evaluator's decision:

| Decision | Action |
|----------|--------|
| CREATE SKILL | Use Task tool: "run /skill-creator with [finding details]" |
| ADD TO RULES | Add the rule succinctly to @PROJECT_RULES.md |
| OMIT ENTIRELY | No action needed |

Mark "Step 3: Apply decisions" as completed.

Report summary:
```
📝 Debrief complete:
- Skills created: [X]
- Rules added: [Y]
- Omitted (redundant/narrow): [Z]
```
