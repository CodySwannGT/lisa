---
name: linear-create
description: "Creates Linear Projects (Epic-equivalent), Issues (Story / Task / Bug / Spike), and sub-Issues (Sub-task) from code files or descriptions. Analyzes the input, determines the appropriate hierarchy, and creates items with comprehensive quality requirements including test-first development and Validation Journey. The Linear counterpart of lisa:jira-create — delegates every write to lisa:linear-write-issue."
allowed-tools: ["Read", "Glob", "LS", "Skill", "mcp__linear-server__list_teams", "mcp__linear-server__list_projects", "mcp__linear-server__list_issue_labels", "mcp__linear-server__list_project_labels"]
---

# Create Linear Work Items from $ARGUMENTS

Analyze the provided file(s) and plan a Linear hierarchy. **This skill plans structure only — every individual write is delegated to `lisa:linear-write-issue`.** Do not call `mcp__linear-server__save_project` or `mcp__linear-server__save_issue` from this skill; those write tools are intentionally not in `allowed-tools`.

This skill is the destination of the `lisa:tracker-create` shim when `tracker = "linear"`.

## Configuration

Reads `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).

## Process

1. **Analyze**: Read `$ARGUMENTS` to understand scope.
2. **Extract source artifacts**: invoke `lisa:tracker-source-artifacts`, then enumerate every external URL, embed, attachment, or example payload in the input and classify each by domain. Build the `artifacts` map (one entry per artifact: url, title, domain, source page, classification reason). See "Source Artifacts" below.
3. **Walk the live product** (when applicable): if the work touches existing user-facing surfaces, invoke `lisa:product-walkthrough` to capture current behavior, design-vs-product divergence, and reuse candidates. Skip when the work is purely backend or affects a screen that does not yet exist.
4. **Determine structure**:
   - Project (Epic) needed if: multiple features, major changes, >3 related files
   - Direct Issues if: bug fix, single file, minor change
5. **Plan hierarchy**:
   ```text
   Project (Epic) → Issue (Story) → sub-Issue (Sub-task)
   ```
   Mapping per Linear best practices: Epic → Linear Project, Story → Issue with `projectId`, Sub-task → Issue with `parentId`. See `config-resolution.md` "Linear destination semantics".
6. **Delegate every write to `lisa:linear-write-issue`** in dependency order (Project first, then Issues with `projectId` set, then sub-Issues with `parentId`). Pass artifacts (filtered by domain per `lisa:tracker-source-artifacts` inheritance rules) and walkthrough findings (under `## Current Product`).
7. **Run the artifact preservation gate** (`lisa:tracker-source-artifacts` §8): after all writes complete, build the preservation matrix and verify every extracted artifact is reachable from the created items. Fail loudly if anything was dropped.

## Mandatory for Every Code Issue

- **Test-First**: Write tests before implementation
- **Quality Gates**: All tests / checks must pass, no SonarCloud violations
- **Documentation**: Check existing, update / create new, remove obsolete
- **Cleanup**: Remove temporary code, scripts, dev configs

## Validation Journey

Items that change runtime behavior should include a `## Validation Journey` section. This section is consumed by `lisa:linear-journey` to automate verification.

### When to Include

- API endpoint changes (new, modified, or removed routes)
- Database schema changes (migrations, new columns, index changes)
- Background job / queue processing changes
- Library / utility function changes that affect exports
- Security fixes (authentication, authorization, input validation)
- Performance-critical changes requiring measurement

### When to Skip

- Documentation-only changes
- Config-only changes (env vars, CI/CD, feature flags with no code)
- Type-definition-only changes

### How to Write

Design the journey based on the **change type**. Place `[EVIDENCE: name]` markers at key verification points.

```markdown
## Validation Journey

### Prerequisites
- Local dev server running
- Database accessible
- Required environment variables set

### Steps
1. Verify the current state before changes
2. Apply the change (run migration, deploy, etc.)
3. Verify the expected new state [EVIDENCE: state-after-change]
4. Test error/edge cases [EVIDENCE: error-handling]
5. Verify rollback or cleanup if applicable [EVIDENCE: rollback-check]

### Assertions
- Describe what must be true after verification
- Each assertion is verified against the captured evidence
```

## Source Artifacts

If `$ARGUMENTS` includes (or references) any external artifact — PRD, design doc, Figma URL, Lovable prototype, Loom walkthrough, screenshot, example payload — those references MUST be preserved as attachments / remote links on the created items. Silent artifact loss is the single most common quality failure in this pipeline.

**Invoke `lisa:tracker-source-artifacts`** for the canonical rules: domains, per-tool classification, source precedence, conflict handling under `## Open Questions`, inheritance from Project → Issue → sub-Issue, and the existing-component reuse expectation. Do not restate the rules here — invoke the skill so any rule change propagates uniformly.

When delegating actual writes to `lisa:linear-write-issue`, pass the extracted artifact list so its Phase 4c (Remote Links) step can attach them.

## Live Product Walkthrough

When the work touches existing user-facing surfaces, invoke `lisa:product-walkthrough` before drafting items. The walkthrough findings (current behavior, design-vs-product divergence, reuse candidates, behavioral surprises) become inputs to the item plan and surface under `## Current Product` on the resulting items. Skip only when the work is purely backend or affects a screen that does not yet exist.

## Item Requirements

Each item must clearly communicate to:

- **Coding Assistants**: Implementation requirements
- **Developers**: Technical approach
- **Stakeholders**: Business value

Default team: from `linear.teamKey` config (override via arguments).

## Delegation to linear-write-issue

**Mandatory.** Every item created by this skill MUST go through `lisa:linear-write-issue`. This skill never calls `mcp__linear-server__save_*` itself — those tools are intentionally excluded from `allowed-tools` so the gate cannot be bypassed.

`lisa:linear-write-issue` enforces:
- 3-audience description (Context / Technical Approach / Acceptance Criteria)
- Gherkin acceptance criteria
- Project parent for Stories; parentId for Sub-tasks
- Explicit relationship discovery (`blocks` / `blocked_by` / `relates_to` / `duplicates`)
- Remote links / attachments
- Single-repo scope check for Bug / Task / Sub-task
- Sign-in account and target environment recorded in description
- Post-create verification

### Invocation order

Items must be created in parent-before-child order so each child can be passed its parent ID:

1. Invoke `lisa:linear-write-issue` for the Epic (Project). Capture the returned Project ID.
2. For each Story, invoke `lisa:linear-write-issue` with the Project ID as `parent_project_id`. Capture each Issue identifier.
3. For each Sub-task, invoke `lisa:linear-write-issue` with the Story Issue ID as `parent_issue_id`.

### What to pass to each invocation

For every delegated write, pass:
- The summary, issue type, team key, and priority you decided
- The 3-section description body you drafted (Context / Technical Approach / Acceptance Criteria)
- Gherkin acceptance criteria
- Parent ID (Project for Stories; Story for Sub-tasks)
- The artifact list extracted in "Source Artifacts", filtered by domain per the inheritance rules
- For items that change runtime behavior: the Validation Journey draft (or instruct it to call `lisa:linear-add-journey` after create)

### What this skill is responsible for

This skill owns:
- Deciding the *shape* of the hierarchy (what's a Project vs. Issue vs. sub-Issue)
- Drafting the description body and acceptance criteria from the input
- Extracting and classifying source artifacts
- Threading parent IDs through subsequent writes
- Running the Phase 5.5-style preservation check after all writes complete

It does not own the actual Linear write — that's `lisa:linear-write-issue`'s job.
