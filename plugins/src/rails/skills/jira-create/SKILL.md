---
name: jira-create
description: This skill should be used when creating JIRA epics, stories, and tasks from code files or descriptions. It analyzes the provided input, determines the appropriate issue hierarchy, and creates issues with comprehensive quality requirements including test-first development and documentation.
allowed-tools: ["Read", "Glob", "LS", "mcp__atlassian__createJiraIssue", "mcp__atlassian__getVisibleJiraProjects", "mcp__atlassian__getJiraProjectIssueTypesMetadata", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Create JIRA Issues from $ARGUMENTS

Analyze the provided file(s) and create a comprehensive JIRA hierarchy with all mandatory quality gates.

## Process

1. **Analyze**: Read $ARGUMENTS to understand scope
2. **Determine Structure**:
   - Epic needed if: multiple features, major changes, >3 related files
   - Direct tasks if: bug fix, single file, minor change
3. **Create Issues** with hierarchy:
   ```
   Epic → User Story → Tasks (test, implement, document, cleanup)
   ```

## Mandatory for Every Code Issue

**Test-First**: Write tests before implementation
**Quality Gates**: All tests/checks must pass, no SonarCloud violations
**Documentation**: Check existing, update/create new, remove obsolete
**Feature Flags**: All features behind flags with lifecycle plan
**Cleanup**: Remove temporary code, scripts, dev configs

## Source Artifact Preservation

If $ARGUMENTS includes a PRD, design doc, Figma URL, Lovable prototype, or similar external artifact — or if a referenced file links out to one — those references MUST be preserved as remote links on the created tickets. Dropping source artifacts during ticket creation is the single most common quality failure in this pipeline, because developers picking up a ticket then lose the design/UX source of truth.

Rules:

1. **Extract before creating**: enumerate every external URL, embed, attachment, or example payload in the input. Classify by domain (`ui-design`, `ux-flow`, `data`, `ops`, `reference`) — see `notion-to-jira` Phase 1.5 for the canonical taxonomy.
2. **Epic gets everything**: attach all extracted artifacts as remote links on the epic, regardless of domain.
3. **Stories inherit by domain**: frontend/view stories get `ui-design` + `ux-flow` + `reference`; backend/model/controller stories get `data` + `reference`; infra stories get `ops` + `reference`. When ambiguous, err on the side of inclusion.
4. **Sub-tasks inherit via parent**: do not re-attach on every sub-task unless a specific artifact applies only to that sub-task.
5. **Verify before reporting**: before declaring done, confirm every extracted artifact is reachable from the tickets. If any are missing, fail loudly and surface the dropped list to the human — do not silently drop.

When delegating actual writes to `jira-write-ticket`, pass the extracted artifact list so its Phase 4c (Remote Links) step can attach them.

**Classification disambiguation** (applied during extraction):
- Figma URL with `/proto/` or `starting-point-node-id=` → `ux-flow`; plain design frame URL → `ui-design`.
- Lovable output → always `ux-flow` (its code/styling/logic is NOT authoritative).
- Loom / annotated screenshot with flow arrows → `ux-flow`; bare screenshot → `ui-design`.

**Source precedence** (must be recorded on every ticket carrying design artifacts):
- Business rules (fields, validation, permissions, constraints) come from the **description / PRD body**.
- Visual treatment (layout, spacing, typography, color) comes from **mocks** (`ui-design`).
- Flow and interaction (navigation, transitions, state changes, empty/error/loading states) come from **prototypes** (`ux-flow`).
- API / data shape comes from **`data` artifacts**.
- Cross-axis conflicts are surfaced as `## Open Questions` BLOCKERs, never silently reconciled.

**Existing-component reuse** (applies to every view/partial-touching ticket): the story description must instruct the implementer to locate the closest existing view partial or ViewComponent in the codebase and prefer reuse over pixel-matching a mock. Design-vs-code divergence is raised on the ticket, not resolved by the implementer alone.

## Issue Requirements

Each issue must clearly communicate to:

- **Coding Assistants**: Implementation requirements
- **Developers**: Technical approach
- **Stakeholders**: Business value

Default project: SE (override via arguments)
Exclude unless requested: migration plans, performance tests

Execute the analysis and create the complete JIRA structure with proper parent-child relationships.
