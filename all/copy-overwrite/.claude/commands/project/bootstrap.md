---
description: Automated project setup and research with gap detection
argument-hint: <project-brief-file-or-jira-issue-number>
---

Complete all of the following steps for $ARGUMENTS:

## Step 0: MANDATORY SETUP

Create workflow tracking todos:
- Step 1: Setup
- Step 2: Research
- Step 3: Gap Detection

⚠️ **CRITICAL**: DO NOT STOP until all 3 todos are marked completed.

## Step 1: Setup
Mark "Step 1: Setup" as in_progress.

Use Task tool with prompt: "run /project:setup $ARGUMENTS"
- Creates project directory, brief.md, findings.md, git branch

Mark "Step 1: Setup" as completed. Proceed to Step 2.

## Step 2: Research
Mark "Step 2: Research" as in_progress.

Use Task tool with prompt: "run /project:research [project-dir]" where [project-dir] is the directory created in Step 1
- Generates research.md with findings

Mark "Step 2: Research" as completed. Proceed to Step 3.

## Step 3: Gap Detection
Mark "Step 3: Gap Detection" as in_progress.

Read the generated research.md file:
- Locate "## Open Questions" section
- Check if it contains actual unresolved questions (not just template/empty)
- If gaps exist:
  ❌ STOP and report: "Research complete but has open questions. Review $PROJECT/research.md and resolve questions before running /project:execute"
- If no gaps:
  ✅ Report: "Bootstrap complete. Research has no gaps. Ready to run /project:execute @projects/$PROJECT"

Mark "Step 3: Gap Detection" as completed.

## Output to Human

- "✅ Bootstrap complete with no gaps - ready for execution" OR
- "⚠️ Bootstrap complete but needs human review - see Open Questions in research.md"
