---
name: project-bootstrap
description: This skill should be used when performing automated project setup and research with gap detection. It runs project setup, conducts research, checks for open questions, and if no gaps exist, proceeds directly to project execution.
argument-hint: "<file-path|jira-issue|\"text description\">"
---

> **DEPRECATED**: This skill is deprecated. Use Claude's native plan mode instead.
> Enter plan mode with `/plan`, describe your requirements, and Claude will create a plan with tasks automatically.
> This skill will be removed in a future release.

Complete all of the following steps for $ARGUMENTS:

## Step 1: Setup

Run `/project-setup $ARGUMENTS`

Capture the project name from the output for use in subsequent steps.

## Step 2: Research

Run `/project-research @projects/<project-name>`

## Step 3: Gap Detection

Read @projects/<project-name>/research.md.

Check '## Open Questions' section. If unresolved questions exist, STOP and report to human.

If no gaps, immediately run `/project-execute @projects/<project-name>`

## Output to Human

- If gaps exist: "Bootstrap complete but needs human review - see Open Questions in research.md"
