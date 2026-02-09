---
name: plan-create
description: "Creates an implementation plan from a ticket URL, file path, or text description. Spawns an Agent Team for parallel research, review, and synthesis. Detects plan type (Bug/Task/Story/Epic) and applies type-specific requirements."
---

# Create Implementation Plan

Create an implementation plan for: $ARGUMENTS

## Step 1: Parse Input

Determine the input type from `$ARGUMENTS`:

1. **Ticket URL/ID** — For when the argument references a JIRA, Github or Linear issue/ticket number or url
   - Fetch ticket details with the appropriate CLI or MCP Server
   - Extract: title, description, acceptance criteria, priority, epic/parent
   - Note the ticket URL for continuous integration updates

2. **File path** — If the the arguments reference a file:
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

## Step 3: Spawn Research Team

Create an Agent Team to research the work in parallel. The team lead operates in **delegate mode** (coordination only, no direct implementation). All teammates are spawned in **plan mode** so the team lead can review their findings before synthesis.

### Phase 1: Research (parallel)

Spawn these three teammates simultaneously:

#### Ticket/Task Researcher
- **Name**: `researcher`
- **Agent type**: `general-purpose`
- **Mode**: `plan`
- **Prompt**: Research the input (ticket, file, or description). If a ticket URL, fetch full details via JIRA MCP or GitHub CLI. If a bug, attempt to reproduce it empirically (Playwright, browser, direct API call, etc.). Extract requirements, acceptance criteria, and context.

#### Codebase Explorer
- **Name**: `explorer`
- **Agent type**: `Explore`
- **Mode**: `plan`
- **Prompt**: Explore the codebase for relevant code, existing patterns, and reusable scripts. Read lint and format rules to understand project standards. Identify files that would need modification, existing utilities that can be reused, and architecture constraints. Check for existing scripts in `package.json` that could be used for replication or verification.

#### Devil's Advocate
- **Name**: `devils-advocate`
- **Agent type**: `general-purpose`
- **Mode**: `plan`
- **Prompt**: Review the input from a critical perspective. Identify anti-patterns, N+1 queries, missing edge cases, security concerns, and performance issues. Do not assume anti-patterns are acceptable just because they exist in the codebase — undocumented anti-patterns should be flagged, not used as reference.

### Phase 2: Review (parallel, after Phase 1 findings are synthesized)

After collecting and synthesizing Phase 1 findings into a draft plan, spawn these two reviewers simultaneously:

#### Tech Reviewer
- **Name**: `tech-reviewer`
- **Agent type**: `tech-reviewer`
- **Mode**: `plan`
- **Prompt**: Review the draft plan for correctness, security, and coding-philosophy compliance. Validate the proposed approach, identify technical risks, and confirm the implementation strategy is sound. Flag any issues ranked by severity.

#### Product Reviewer
- **Name**: `product-reviewer`
- **Agent type**: `product-reviewer`
- **Mode**: `plan`
- **Prompt**: Review the draft plan from a non-technical/UX perspective. Does the plan solve the right problem? Will the proposed solution work for end users? Are there user-facing concerns the technical team may have missed?

### Bug-Specific Rules

If the plan type is **Bug**:

- The bug **must** be empirically replicated (Playwright, browser, direct API call, etc.) — not guessed at
- If the research team cannot reproduce the bug, **STOP**. Update the ticket with findings and what additional information is needed, then end the session
- Do not attempt to fix a bug you cannot prove exists
- Never include solutions with obvious anti-patterns (e.g., N+1 queries). If unavoidable due to API limitations, **STOP** and update the ticket with what is needed

## Step 4: Synthesize & Write Plan

After all teammates have reported and the team lead has approved their findings:

1. Synthesize findings into a unified plan and save it
2. The plan must include, at minimum, the info found in the @.claude/rules/plan.md rule

### Plan Structure

The plan file must include, at minimum:

1. **Title and context** — What is being done and why
2. **Input source** — Ticket URL, file path, or description
3. **Plan type** — Bug, Task, Story/Feature, or Epic
4. **Branch and PR** — Following branch/PR rules from @.claude/rules/plan.md
5. **Analysis** — Synthesized research findings from all teammates
6. **Implementation approach** — How the work will be done
7. **Tasks** — Following the Task Creation Specification from @.claude/rules/plan.md
8. **Implementation Team** — Instructions to spawn a second Agent Team (see Step 6)

### Type-Specific Requirements

Apply these additional requirements based on the detected type:

#### Bug
- **Replication step** (mandatory): Include a task to reproduce the bug empirically before any fix
- **Root cause analysis**: Identify why the bug occurs, not just what triggers it
- **Regression test**: Write a test that fails without the fix and passes with it
- **Verification**: Run the replication step again after the fix to confirm resolution
- **Proof command**: Every fix task must include a proof command and expected output

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

## Step 5: Include Required Tasks

Include all required tasks defined in the @.claude/rules/plan.md rule (Required Tasks section), including the archive task which must always be last.

## Step 6: Implementation Team Instructions

The plan must include explict instructions to "Create an agent team" for implementation. Recommend these specialized agents:

| Agent | Use For |
|-------|---------|
| `implementer` | Code implementation (pre-loaded with project conventions) |
| `tech-reviewer` | Technical review (correctness, security, performance) |
| `product-reviewer` | Product/UX review (validates from non-technical perspective) |
| `learner` | Post-implementation learning (processes learnings into skills/rules) |
| `test-coverage-agent` | Writing comprehensive tests |
| `code-simplifier` | Code simplification and refinement |
| `coderabbit` | Automated AI code review |

The **team lead** handles git operations (commits, pushes, PR management) — teammates focus on their specialized work.

## Step 7: Ticket Integration

If the input was a ticket ID or URL:

1. Include the ticket URL in the plan metadata
2. Associate the branch and PR with the ticket
3. Post the approved plan as a comment on the ticket
4. Use `/jira-sync` at key milestones
5. If blocked (cannot reproduce, unavoidable anti-pattern, missing information, etc.), update the ticket before stopping

## Step 8: Present to User

Present the synthesized plan to the user for review. The user should be able to:

- Approve the plan as-is
- Request modifications
- Reject the plan

All decisions in the plan must include a recommendation. If a decision is left unresolved, use the recommended option.
