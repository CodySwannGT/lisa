---
description: Automated project setup and research with gap detection
argument-hint: <file-path|jira-issue|"text description">
---

Complete all of the following steps for $ARGUMENTS:

## Step 1: Setup

Run `/project:setup $ARGUMENTS` directly (not via Task tool).
- Creates project directory, brief.md, findings.md, git branch
- Creates `.claude-active-project` marker file
- Outputs the project name (e.g., `2026-01-26-my-feature`)

Capture the project name from the output for use in subsequent steps.

## Step 2: Create and Execute Tasks

Create workflow tracking tasks with `metadata.project` set to the project name from Step 1:

```
TaskCreate:
  subject: "Research project requirements"
  description: "Run /project:research projects/<project-name> to gather codebase and web research."
  metadata: { project: "<project-name-from-step-1>" }

TaskCreate:
  subject: "Gap detection and execution"
  description: "Read projects/<project-name>/research.md. Check '## Open Questions' section. If unresolved questions exist, STOP and report to human. If no gaps, immediately run /project:execute @projects/<project-name>"
  metadata: { project: "<project-name-from-step-1>" }
```

Work through these tasks in order. Do not stop until both are completed.

## Output to Human

- If gaps exist: "⚠️ Bootstrap complete but needs human review - see Open Questions in research.md"
- If no gaps: Execution will begin automatically

---

## Next Step

If the full execution doesn't start automatically after gap check, run `/project:execute @projects/<project-name>`.
