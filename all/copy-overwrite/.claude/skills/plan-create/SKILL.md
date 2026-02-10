---
name: plan-create
description: "Creates an implementation plan from a ticket URL, file path, or text description. Spawns an Agent Team for parallel research, review, and synthesis. Detects plan type (Bug/Task/Story/Epic) and applies type-specific requirements."
---

# Create Implementation Plan

Create an implementation plan for: $ARGUMENTS

All plans must follow the rules in @.claude/rules/plan.md (required tasks, branch/PR rules, task creation specification, metadata schema, and archive procedure).

## Step 1: Parse Input

Determine the input type from `$ARGUMENTS`:

1. **Ticket URL/ID** -- Fetch ticket details with the appropriate CLI or MCP Server. Extract: title, description, acceptance criteria, priority, epic/parent. Note the ticket URL for later integration updates.
2. **File path** -- Read the file contents and use as context for the plan.
3. **Free text** -- Treat the entire argument as a text description of the work.

If no argument provided, prompt the user for input.

## Step 2: Detect Plan Type

| Type | Indicators |
|------|------------|
| **Bug** | Symptoms, errors, incorrect behavior, "broken", "fails", "crash", "regression" |
| **Story/Feature** | New capability, user-facing change, "add", "implement", "create", "as a user" |
| **Task** | Internal work, refactoring, configuration, maintenance, "update", "migrate", "refactor" |
| **Epic** | Large scope with multiple features/stories, "overhaul", "redesign", multiple deliverables |

If ambiguous, default to **Task**.

## Step 3: Spawn Research Team

Create an Agent Team to research the work in parallel. The team lead operates in **delegate mode** (coordination only, no direct implementation). All teammates are spawned in **plan mode** so the team lead can review their findings before synthesis.

### Phase 1: Research (parallel)

Spawn these four teammates simultaneously:

#### Ticket/Task Researcher
- **Name**: `researcher` | **Agent type**: `general-purpose` | **Mode**: `plan`
- **Prompt**: Research the input (ticket, file, or description). If a ticket URL, fetch full details via JIRA MCP or GitHub CLI. If a bug, attempt to reproduce it empirically. Extract requirements, acceptance criteria, and context.

#### Codebase Explorer
- **Name**: `explorer` | **Agent type**: `Explore` | **Mode**: `plan`
- **Prompt**: Explore the codebase for relevant code, existing patterns, and reusable scripts. Read lint and format rules. Identify files needing modification, reusable utilities, and architecture constraints. Check `package.json` scripts for replication or verification.

#### Devil's Advocate
- **Name**: `devils-advocate` | **Agent type**: `general-purpose` | **Mode**: `plan`
- **Prompt**: Review the input critically. Identify anti-patterns, N+1 queries, missing edge cases, security concerns, and performance issues. Undocumented anti-patterns in the codebase should be flagged, not used as reference.

#### Spec Gap Analyst
- **Name**: `spec-analyst` | **Agent type**: `spec-analyst` | **Mode**: `plan`
- **Prompt**: Analyze the input for specification gaps. Read `package.json` and existing code for project context. Identify every ambiguity or unstated assumption that could lead to wrong architectural decisions. Report as a numbered list of clarifying questions, sorted by impact.

### Gap Resolution

After Phase 1 completes and before synthesizing the draft plan:

1. Collect gaps from the spec-analyst's findings
2. Present gaps to the user via AskUserQuestion -- group related questions and include why each matters
3. If no gaps identified, state "No specification gaps identified" and proceed to Phase 2
4. Incorporate answers into the draft plan context before Phase 2 review

### Phase 2: Review (parallel, after Phase 1 synthesis)

After synthesizing Phase 1 findings (including gap resolution answers) into a draft plan, spawn these two reviewers simultaneously:

#### Tech Reviewer
- **Name**: `tech-reviewer` | **Agent type**: `tech-reviewer` | **Mode**: `plan`
- **Prompt**: Review the draft plan for correctness, security, and coding-philosophy compliance. Validate the approach, identify technical risks, and flag issues ranked by severity.

#### Product Reviewer
- **Name**: `product-reviewer` | **Agent type**: `product-reviewer` | **Mode**: `plan`
- **Prompt**: Review the draft plan from a non-technical/UX perspective. Does the plan solve the right problem? Will the solution work for end users? Are there user-facing concerns the technical team missed?

### Bug-Specific Rules

If the plan type is **Bug**:

- The bug **must** be empirically replicated (Playwright, browser, direct API call, etc.) -- not guessed at
- If the research team cannot reproduce the bug, **STOP**. Update the ticket with findings and what additional information is needed, then end the session
- Do not attempt to fix a bug you cannot prove exists
- Never include solutions with obvious anti-patterns (e.g., N+1 queries). If unavoidable, **STOP** and update the ticket

## Step 4: Synthesize and Write Plan

After all teammates have reported and the team lead has approved their findings, synthesize into a unified plan file with these sections:

1. **Title and context** -- What is being done and why
2. **Input source** -- Ticket URL, file path, or description
3. **Plan type** -- Bug, Task, Story/Feature, or Epic
4. **Branch and PR** -- Following Branch and PR Rules from @.claude/rules/plan.md
5. **Analysis** -- Synthesized research findings from all teammates
6. **Implementation approach** -- How the work will be done
7. **Tasks** -- Following the Task Creation Specification from @.claude/rules/plan.md, including the JSON metadata block for each task
8. **Required tasks** -- All tasks from the Required Tasks section in @.claude/rules/plan.md (archive task must be last)
9. **Implementation team** -- Instructions to spawn a second Agent Team using the agents from the Implementation Team Guidance table in @.claude/rules/plan.md

Apply the Type-Specific Requirements from @.claude/rules/plan.md based on the detected plan type. For Bugs, also include a replication task before any fix and a proof command for every fix task. For Epics, include dependency mapping between sub-tasks.

## Step 5: Ticket Integration

If the input was a ticket ID or URL:

1. Include the ticket URL in the plan metadata
2. Associate the branch and PR with the ticket
3. Post the approved plan as a comment on the ticket
4. Use `/jira-sync` at key milestones
5. If blocked, update the ticket before stopping

## Step 6: Present to User

Present the synthesized plan to the user for review. The user may approve, request modifications, or reject.

All decisions in the plan must include a recommendation. If a decision is left unresolved, use the recommended option.
