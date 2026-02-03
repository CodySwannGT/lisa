---
name: project-debrief
description: This skill should be used when aggregating learnings from completed project tasks and findings. It collects learnings from task metadata and findings.md, uses the skill-evaluator to categorize each learning (new skill, project rule, or omit), and applies the decisions accordingly.
allowed-tools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "Task", "TaskCreate", "TaskUpdate", "TaskList", "Skill"]
argument-hint: "<project-directory>"
---

> **DEPRECATED**: This skill is deprecated. Use Claude's native plan mode instead.
> Enter plan mode with `/plan`, describe your requirements, and Claude will create a plan with tasks automatically.
> This skill will be removed in a future release.

## Setup

Set active project marker: `echo "$ARGUMENTS" | sed 's|.*/||' > .claude-active-project`

Extract `<project-name>` from the last segment of `$ARGUMENTS`.

## Create and Execute Tasks

Create workflow tracking tasks with `metadata.project` set to the project name:

```
TaskCreate:
  subject: "Aggregate project learnings"
  description: "Collect all learnings from two sources: 1) Read $ARGUMENTS/findings.md for manual findings. 2) Read all task files in $ARGUMENTS/tasks/*.json and extract metadata.learnings arrays. Compile into a single list of distinct findings/learnings."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Evaluate each learning"
  description: "For each learning, use Task tool with subagent_type 'skill-evaluator' to determine: CREATE SKILL (complex, reusable pattern), ADD TO RULES (simple never/always rule), or OMIT ENTIRELY (already covered or too project-specific). Collect all decisions."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Apply decisions"
  description: "For each learning based on skill-evaluator decision: CREATE SKILL → run /skill-creator with details. ADD TO RULES → add succinctly to .claude/rules/PROJECT_RULES.md. OMIT → no action. Report summary: skills created, rules added, omitted count."
  metadata: { project: "<project-name>" }
```

**Execute each task via a subagent** to preserve main context. Launch up to 6 in parallel where tasks don't have dependencies. Do not stop until all are completed.

## Important: Rules vs Skills

**WARNING about PROJECT_RULES.md**: Rules in `.claude/rules/` are **always loaded** at session start for every request. Only add learnings to PROJECT_RULES.md if they:
- Apply to **every** request in this codebase (not just specific features)
- Are simple "never do X" or "always do Y" statements
- Cannot be scoped to a skill that's invoked on-demand

If a learning only applies to certain types of work (e.g., "when writing GraphQL resolvers..."), it should be a **skill** instead, not a rule.
