---
name: jira-create
description: This skill should be used when creating JIRA epics, stories, and tasks from code files or descriptions. It analyzes the provided input, determines the appropriate issue hierarchy, and creates issues with comprehensive quality requirements including test-first development and documentation.
allowed-tools: ["Read", "Glob", "LS", "Skill", "mcp__atlassian__getVisibleJiraProjects", "mcp__atlassian__getJiraProjectIssueTypesMetadata", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Create JIRA Issues from $ARGUMENTS

Analyze the provided file(s) and plan a JIRA hierarchy. **This skill plans structure only — every individual ticket write is delegated to `jira-write-ticket`.** Do not call `mcp__atlassian__createJiraIssue` from this skill; the necessary write tools are intentionally not in `allowed-tools`.

## Process

1. **Analyze**: Read $ARGUMENTS to understand scope.
2. **Extract source artifacts**: invoke the `jira-source-artifacts` skill, then enumerate every external URL, embed, attachment, or example payload in the input and classify each by domain per its rules. Build the `artifacts` map (one entry per artifact: url, title, domain, source page, classification reason). See "Source Artifacts" below.
3. **Walk the live product** (when applicable): if the work touches existing user-facing surfaces, invoke the `product-walkthrough` skill to capture current behavior, design-vs-product divergence, and reuse candidates. Skip when the work is purely backend or affects a screen that does not yet exist. See "Live Product Walkthrough" below.
4. **Determine structure**:
   - Epic needed if: multiple features, major changes, >3 related files
   - Direct tasks if: bug fix, single file, minor change
5. **Plan hierarchy**:
   ```
   Epic → User Story → Tasks (test, implement, document, cleanup)
   ```
6. **Delegate every write to `jira-write-ticket`** in dependency order (epic first, then stories with the epic as parent, then sub-tasks with their story as parent). Pass the artifacts (filtered by domain per `jira-source-artifacts` inheritance rules) and the walkthrough findings (under `## Current Product`). See "Delegation to jira-write-ticket" below.
7. **Run the artifact preservation gate** (`jira-source-artifacts` §8): after all writes complete, build the preservation matrix and verify every extracted artifact is reachable from the created tickets. Fail loudly if anything was dropped.

## Mandatory for Every Code Issue

**Test-First**: Write tests before implementation
**Quality Gates**: All tests/checks must pass, no SonarCloud violations
**Documentation**: Check existing, update/create new, remove obsolete
**Cleanup**: Remove temporary code, scripts, dev configs

## Validation Journey

Tickets that change runtime behavior should include a `Validation Journey` section in the description. This section is consumed by the `jira-journey` skill to automate verification.

### When to Include

Include a Validation Journey when the ticket involves:
- API endpoint changes (new, modified, or removed routes)
- Database schema changes (migrations, new columns, index changes)
- Background job or queue processing changes
- Library or utility function changes that affect exports
- Security fixes (authentication, authorization, input validation)
- Performance-critical changes requiring measurement

### When to Skip

Skip the Validation Journey for:
- Documentation-only changes
- Config-only changes (env vars, CI/CD, feature flags with no code)
- Type-definition-only changes (interfaces, types, no runtime effect)

### How to Write

Design the journey based on the **change type**. The agent executing the journey determines how to verify each step using patterns from the project's `verfication.md`. Place `[EVIDENCE: name]` markers at key verification points.

Add this section to the ticket description:

```text
h2. Validation Journey

h3. Prerequisites
- Local dev server running
- Database accessible
- Required environment variables set

h3. Steps
1. Verify the current state before changes
2. Apply the change (run migration, deploy, etc.)
3. Verify the expected new state [EVIDENCE: state-after-change]
4. Test error/edge cases [EVIDENCE: error-handling]
5. Verify rollback or cleanup if applicable [EVIDENCE: rollback-check]

h3. Assertions
- Describe what must be true after verification
- Each assertion is verified against the captured evidence
```

### Guidelines

1. **Steps must be concrete and verifiable** — "Run `curl -s localhost:3000/health`" not "Check the API"
2. **Evidence markers at verification points** — Place `[EVIDENCE: name]` at states that prove the change works. Use descriptive kebab-case names (e.g., `api-response`, `schema-check`, `rate-limit-hit`)
3. **Include 2-5 evidence markers** — Enough to prove the change works across happy path and error cases
4. **Assertions are testable statements** — "Health check returns 200 with status ok" not "API works"
5. **Prerequisites include environment setup** — Database connection, env vars, running services

## Source Artifacts

If $ARGUMENTS includes (or references) any external artifact — PRD, design doc, Figma URL, Lovable prototype, Loom walkthrough, screenshot, example payload — those references MUST be preserved as remote links on the created tickets. Silent artifact loss is the single most common quality failure in this pipeline.

**Invoke the `jira-source-artifacts` skill** for the canonical rules: domains, per-tool classification (Figma `/proto/` vs design, Lovable, Loom, screenshots), source precedence, conflict handling under `## Open Questions`, inheritance from epic → story → sub-task, and the existing-component reuse expectation. Do not restate the rules here — invoke the skill so any rule change propagates uniformly.

When delegating actual writes to `jira-write-ticket`, pass the extracted artifact list so its Phase 4c (Remote Links) step can attach them.

## Live Product Walkthrough

When the work touches existing user-facing surfaces, invoke the `product-walkthrough` skill before drafting tickets. The walkthrough findings (current behavior, design-vs-product divergence, reuse candidates, behavioral surprises) become inputs to the ticket plan and surface under `## Current Product` on the resulting tickets. Skip only when the work is purely backend or affects a screen that does not yet exist.

## Issue Requirements

Each issue must clearly communicate to:

- **Coding Assistants**: Implementation requirements
- **Developers**: Technical approach
- **Stakeholders**: Business value

Default project: from jira-cli config (override via arguments)
Exclude unless requested: migration plans, performance tests

## Delegation to jira-write-ticket

**Mandatory.** Every ticket created by this skill MUST go through `jira-write-ticket`. This skill never calls `mcp__atlassian__createJiraIssue` itself — that tool is intentionally excluded from `allowed-tools` so the gate cannot be bypassed.

`jira-write-ticket` enforces things this skill does not, and which determine ticket quality:
- 3-audience description (Context / Technical Approach / Acceptance Criteria)
- Gherkin acceptance criteria
- Epic parent validation (non-bug, non-epic types)
- Explicit link discovery (`blocks` / `is blocked by` / `relates to` / `duplicates` / `clones`)
- Remote links (PRs, Confluence, dashboards)
- Single-repo scope check for Bug / Task / Sub-task
- Sign-in account and target environment recorded in description
- Post-create verification

### Invocation order

Tickets must be created in parent-before-child order so each child can be passed its parent key:

1. Invoke `jira-write-ticket` for the epic. Capture the returned key.
2. For each story, invoke `jira-write-ticket` with the epic key as the epic parent. Capture each story key.
3. For each sub-task, invoke `jira-write-ticket` with the parent story key.

### What to pass to each invocation

For every delegated write, pass:
- The summary, issue type, project key, and priority you decided
- The 3-section description body you drafted (Context / Technical Approach / Acceptance Criteria)
- Gherkin acceptance criteria
- Parent key (epic key for stories; story key for sub-tasks)
- The artifact list extracted in "Source Artifact Preservation", filtered by domain per the inheritance rules — `jira-write-ticket` Phase 4c attaches them as remote links
- For tickets that change runtime behavior: the Validation Journey draft (or instruct it to call `jira-add-journey` after create)

### What this skill is responsible for

This skill owns:
- Deciding the *shape* of the hierarchy (what's an epic vs. story vs. sub-task)
- Drafting the description body and acceptance criteria from the input
- Extracting and classifying source artifacts
- Threading parent keys through subsequent writes
- Running the Phase 5.5-style preservation check after all writes complete

It does not own the actual JIRA write — that's `jira-write-ticket`'s job.
