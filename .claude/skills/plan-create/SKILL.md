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

## Step 3: Assess Complexity

Evaluate the scope of work:

- **Trivial** (single file, config change, documentation update) → Skip to Step 8 (direct synthesis). No agent team needed.
- **Standard** (2-10 files, single feature or fix) → Proceed through all phases.
- **Epic** (10+ files, multiple features, cross-cutting changes) → Proceed through all phases with extra attention to dependency mapping.

## Step 4: Phase 1 - Research (parallel)

Create an Agent Team and spawn two research teammates simultaneously:

#### Researcher
- **Name**: `researcher`
- **Agent type**: `general-purpose`
- **Mode**: `bypassPermissions`
- **Prompt**: Research the input (ticket, file, or description). If a ticket URL, fetch full details via JIRA MCP or GitHub CLI. If a bug, attempt to reproduce it empirically (Playwright, browser, direct API call, etc.). Extract requirements, acceptance criteria, and context.

#### Codebase Explorer
- **Name**: `explorer`
- **Agent type**: `Explore`
- **Prompt**: Explore the codebase for relevant code, existing patterns, and reusable scripts. Read lint and format rules to understand project standards. Identify files that would need modification, existing utilities that can be reused, and architecture constraints. Check for existing scripts in `package.json` that could be used for replication or verification.

Wait for both to report back via SendMessage.

## Step 5: Phase 1.5 - Research Brief (team lead)

Synthesize Phase 1 findings into a structured **Research Brief**:

- **Ticket/spec details**: requirements, acceptance criteria, constraints
- **Reproduction results**: (for bugs) steps attempted, outcome observed
- **Relevant files**: paths, line ranges, what they do
- **Existing patterns**: conventions found in the codebase
- **Architecture constraints**: dependencies, limitations, integration points
- **Reusable utilities**: existing code that applies to this work

## Step 6: Phase 2 - Domain Sub-Plans (parallel)

Spawn four domain planners simultaneously, passing each the Research Brief:

#### Architecture Planner
- **Name**: `arch-planner`
- **Agent type**: `architecture-planner`
- **Mode**: `bypassPermissions`
- **Prompt**: [Research Brief] + Design the technical implementation approach. Identify files to create/modify, map dependencies, recommend patterns, flag risks.

#### Test Strategist
- **Name**: `test-strategist`
- **Agent type**: `test-strategist`
- **Mode**: `bypassPermissions`
- **Prompt**: [Research Brief] + Design the test matrix. Identify edge cases, set coverage targets, define verification commands, plan TDD sequence.

#### Security Planner
- **Name**: `security-planner`
- **Agent type**: `security-planner`
- **Mode**: `bypassPermissions`
- **Prompt**: [Research Brief] + Perform lightweight threat modeling (STRIDE). Identify auth/validation gaps, secrets exposure risks, and security measures needed.

#### Product Planner
- **Name**: `product-planner`
- **Agent type**: `product-planner`
- **Mode**: `bypassPermissions`
- **Prompt**: [Research Brief] + Define user flows in Gherkin. Write acceptance criteria from user perspective. Identify UX concerns and error states.

Wait for all four to report back via SendMessage.

## Step 7: Phase 3 - Review (parallel)

Spawn two reviewers simultaneously, passing them all sub-plans:

#### Devil's Advocate
- **Name**: `devils-advocate`
- **Agent type**: `general-purpose`
- **Mode**: `bypassPermissions`
- **Prompt**: [All sub-plans] + Review critically. Identify anti-patterns, N+1 queries, missing edge cases, security concerns, and performance issues. Do not assume anti-patterns are acceptable just because they exist in the codebase — undocumented anti-patterns should be flagged, not used as reference. Challenge assumptions and propose alternatives for weak points.

#### Consistency Checker
- **Name**: `consistency-checker`
- **Agent type**: `consistency-checker`
- **Mode**: `bypassPermissions`
- **Prompt**: [All sub-plans] + Verify cross-plan consistency. Check that file lists align, test strategy covers architecture changes, security measures are reflected in acceptance criteria, and no sub-plans contradict each other.

Wait for both to report back via SendMessage.

## Step 8: Phase 4 - Synthesis (team lead)

Read governance and format rules, then merge everything into a unified plan:

1. Read `@.claude/rules/plan-governance.md` for governance rules
2. Read `@.claude/rules/plan.md` for task document format
3. Merge sub-plans + review feedback into a unified plan
4. Apply governance: Required Tasks, Branch/PR rules, Git Workflow
5. Create TaskCreate specs per plan.md format
6. Write plan to `plans/<name>.md`
7. Create branch, open draft PR
8. Update ticket if applicable

### Plan Structure

The plan file must include:

1. **Title and context** — What is being done and why
2. **Input source** — Ticket URL, file path, or description
3. **Plan type** — Bug, Task, Story/Feature, or Epic
4. **Branch and PR** — Following branch/PR rules from plan-governance.md
5. **Analysis** — Synthesized research findings from all teammates
6. **Implementation approach** — How the work will be done
7. **Tasks** — Following the Task Creation Specification from plan.md
8. **Implementation Team** — Instructions to spawn an Agent Team (see Step 10)

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

## Step 9: Include Required Tasks

Include all required tasks defined in `@.claude/rules/plan-governance.md` (Required Tasks section), including the archive task which must always be last.

## Step 10: Implementation Team Instructions

The plan must include instructions to spawn an Agent Team for implementation. Recommend these specialized agents:

| Agent | Use For |
|-------|---------|
| `implementer` | Code implementation (pre-loaded with project conventions, TDD enforcement) |
| `tech-reviewer` | Technical review (correctness, security, performance) |
| `product-reviewer` | Product/UX review (validates from non-technical perspective) |
| `learner` | Post-implementation learning (processes learnings into skills/rules) |
| `test-coverage-agent` | Writing comprehensive tests |
| `code-simplifier` | Code simplification and refinement |
| `coderabbit` | Automated AI code review |

The **team lead** handles git operations (commits, pushes, PR management) — teammates focus on their specialized work.

## Step 11: Ticket Integration

If the input was a ticket ID or URL:

1. Include the ticket URL in the plan metadata
2. Associate the branch and PR with the ticket
3. Post the approved plan as a comment on the ticket
4. Use `/jira-sync` at key milestones
5. If blocked (cannot reproduce, unavoidable anti-pattern, missing information, etc.), update the ticket before stopping

## Step 12: Present to User

Present the synthesized plan to the user for review. The user should be able to:

- Approve the plan as-is
- Request modifications
- Reject the plan

All decisions in the plan must include a recommendation. If a decision is left unresolved, use the recommended option.

## Step 13: Shutdown Team

Send `shutdown_request` to all teammates and clean up the team.

### Bug-Specific Rules

If the plan type is **Bug**:

- The bug **must** be empirically replicated (Playwright, browser, direct API call, etc.) — not guessed at
- If the research team cannot reproduce the bug, **STOP**. Update the ticket with findings and what additional information is needed, then end the session
- Do not attempt to fix a bug you cannot prove exists
- Never include solutions with obvious anti-patterns (e.g., N+1 queries). If unavoidable due to API limitations, **STOP** and update the ticket with what is needed
