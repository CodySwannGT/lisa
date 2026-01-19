---
description: Automated project execution from planning through debrief (requires gap-free research)
argument-hint: <project-directory>
---

Execute complete implementation workflow for $ARGUMENTS:

## ⚠️ EXECUTION RULES - READ FIRST

1. **CONTINUOUS EXECUTION**: After each step completes, IMMEDIATELY invoke the next step
2. **NO SUMMARIES**: Do NOT summarize progress between steps
3. **NO WAITING**: Do NOT wait for user confirmation between steps
4. **ONLY STOP WHEN DONE**: Only stop when ALL steps show completed

## Step 0: MANDATORY SETUP

### Gap Check
Read $ARGUMENTS/research.md and locate "## Open Questions" section.
- If gaps exist: ❌ STOP immediately with "Cannot proceed - research.md has unresolved open questions."
- If no gaps: ✅ Proceed with setup

### Planning Already Complete Check
Check if planning has already been done:
1. Check if `$ARGUMENTS/progress.md` exists
2. Check if `$ARGUMENTS/tasks/` directory exists with task files (task-*.md)

- If BOTH exist: ✅ Planning already complete - skip to "Create Workflow Tracking (Resume Mode)"
- If either is missing: ✅ Proceed with full workflow

### Create Workflow Tracking (Full Mode)
Use TodoWrite to create these workflow todos:
- Step 1: Planning
- Step 2: Implementation
- Step 3: Review
- Step 4: Verification
- Step 5: Debrief
- Step 6: Archive

⚠️ **CRITICAL**: DO NOT STOP until all 6 todos are marked completed.

**IMMEDIATELY invoke Step 1** - do not summarize or wait.

### Create Workflow Tracking (Resume Mode)
Use TodoWrite to create these workflow todos (marking Step 1 as already completed):
- Step 1: Planning ✓ (mark as completed immediately)
- Step 2: Implementation
- Step 3: Review
- Step 4: Verification
- Step 5: Debrief
- Step 6: Archive

Report: "📋 Resuming execution - planning already complete with existing progress.md and tasks/"

⚠️ **CRITICAL**: DO NOT STOP until all 6 todos are marked completed.

**IMMEDIATELY invoke Step 2** - do not summarize or wait.

## Step 1: Planning
⚠️ **CRITICAL**: DO NOT STOP use the Plan tool to do this. Use Task tool with prompt: "run /project:plan $ARGUMENTS" as directed below

Mark "Step 1: Planning" as in_progress.

Use Task tool with prompt: "run /project:plan $ARGUMENTS"

Mark "Step 1: Planning" as completed. **IMMEDIATELY invoke Step 2** - do not summarize or wait.

## Step 2: Implementation Loop
Mark "Step 2: Implementation" as in_progress.

Use Task tool with prompt: "run /project:implement $ARGUMENTS"

Mark "Step 2: Implementation" as completed. **IMMEDIATELY invoke Step 3** - do not summarize or wait.

## Step 3: Review
Mark "Step 3: Review" as in_progress.

run /project:review $ARGUMENTS

Mark "Step 3: Review" as completed. **IMMEDIATELY invoke Step 4** - do not summarize or wait.

## Step 4: Verification
Mark "Step 4: Verification" as in_progress.

Use Task tool with prompt: "run /project:verify $ARGUMENTS"

Mark "Step 4: Verification" as completed. **IMMEDIATELY invoke Step 5** - do not summarize or wait.

## Step 5: Debrief
Mark "Step 5: Debrief" as in_progress.

Use Task tool with prompt: "run /project:debrief $ARGUMENTS"

Mark "Step 5: Debrief" as completed. **IMMEDIATELY invoke Step 6** - do not summarize or wait.

## Step 6: Archive
Mark "Step 6: Archive" as in_progress.

Use Task tool with prompt: "run /project:archive $ARGUMENTS"

Mark "Step 6: Archive" as completed.

Report: "🎉 Project complete and archived"
