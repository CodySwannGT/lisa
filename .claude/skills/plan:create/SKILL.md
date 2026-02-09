---
name: plan:create
description: "Creates an implementation plan from a ticket URL, file path, or text description. Detects plan type (Bug/Task/Story/Epic) and applies type-specific requirements including replication steps for bugs and UX review for features."
argument-hint: "<ticket-url | @file-path | description>"
---

# Create Implementation Plan

Create an implementation plan for: $ARGUMENTS

## Step 1: Parse Input

Determine the input type from `$ARGUMENTS`:

1. **Ticket URL** — If the argument matches a URL pattern (starts with `http://` or `https://`):
   - Fetch ticket details via JIRA MCP (`mcp__atlassian__getJiraIssue`) or GitHub CLI (`gh issue view`)
   - Extract: title, description, acceptance criteria, priority, epic/parent
   - Note the ticket URL for continuous integration updates

2. **File path** — If the argument starts with `@` or `/` or is a relative path to an existing file:
   - Read the file contents
   - Use the file as context for the plan

3. **Free text** — Otherwise, treat the entire argument as a text description of the work

If no argument provided, prompt the user for input.

## Step 2: Detect Plan Type

Analyze the input to determine the plan type:

| Type | Indicators |
|------|------------|
| **Bug** | Describes symptoms, errors, incorrect behavior, "broken", "fails", "crash", "regression" |
| **Story/Feature** | Describes new capability, user-facing change, "add", "implement", "create", "as a user" |
| **Task** | Describes internal work, refactoring, configuration, maintenance, "update", "migrate", "refactor" |
| **Epic** | Describes large scope with multiple features/stories, "overhaul", "redesign", multiple distinct deliverables |

If the type is ambiguous, default to **Task**.

## Step 3: Enter Plan Mode

Use `EnterPlanMode` to create the plan. The plan must follow the template structure defined in the `plan.md` rule.

### Plan Structure

The plan file must include:

1. **Title and context** — What is being done and why
2. **Input source** — Ticket URL, file path, or description
3. **Plan type** — Bug, Task, Story/Feature, or Epic
4. **Branch and PR** — Following branch/PR rules from `plan.md`
5. **Analysis** — Research findings, code references, architecture constraints
6. **Implementation approach** — How the work will be done
7. **Tasks** — Following the Task Creation Specification from `plan.md`

### Type-Specific Requirements

Apply these additional requirements based on the detected type:

#### Bug
- **Replication step** (mandatory): Include a task to reproduce the bug empirically before any fix
- **Root cause analysis**: Identify why the bug occurs, not just what triggers it
- **Regression test**: Write a test that fails without the fix and passes with it
- **Verification**: Run the replication step again after the fix to confirm resolution

#### Story/Feature
- **UX review**: Include a product-reviewer agent task to validate from user perspective
- **Feature flag consideration**: Note whether this should be behind a feature flag
- **Documentation**: Include user-facing documentation if applicable

#### Task
- **Standard implementation** with empirical verification

#### Epic
- **Decompose into sub-tasks**: Break into Stories, Tasks, and/or Bugs
- **Each sub-task gets its own type-specific requirements**
- **Dependency mapping**: Identify which sub-tasks depend on others

## Step 4: Include Required Tasks

Every plan must include the required tasks defined in `plan.md`:

- Product/UX review using `product-reviewer` agent
- CodeRabbit code review
- Local code review via `/plan:local-code-review`
- Technical review using `tech-reviewer` agent
- Implement valid review suggestions
- Simplify code using code simplifier agent
- Update/add/remove tests as needed
- Update/add/remove documentation
- Verify all verification metadata
- Collect learnings using `learner` agent
- Archive the plan (always last)

## Step 5: Ticket Integration

If the input was a ticket URL:

1. Include the ticket URL in the plan metadata
2. Add a task to update the ticket with the working branch
3. Add a task to comment on the ticket with the finalized plan
4. Note that `/jira:sync` should be used at key milestones

## Execution

Enter plan mode and create the plan now, following all rules from `plan.md`.
