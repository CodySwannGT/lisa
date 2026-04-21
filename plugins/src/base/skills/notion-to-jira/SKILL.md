---
name: notion-to-jira
description: >
  Break down a Notion PRD into JIRA epics, stories, and sub-tasks. Use this skill whenever the user
  shares a Notion PRD URL and wants it converted into JIRA tickets, or asks to "break down a PRD",
  "create tickets from a PRD", "turn this PRD into JIRA", or similar. Also trigger when the user
  mentions creating epics/stories/tasks from a Notion document. This skill handles the full pipeline:
  fetching the PRD, analyzing comments, researching the codebase, identifying blockers, and creating
  all tickets with empirical verification plans.
---

# Notion PRD to JIRA Breakdown

Convert a Notion PRD into a structured JIRA ticket hierarchy: Epics > Stories > Sub-tasks.
Each sub-task is scoped to exactly one repo and includes an empirical verification plan.

## Input

A Notion PRD URL. The PRD is expected to have:
- A main page with context, problems, and links to Epic sub-pages
- Epic sub-pages with User Stories and functional/non-functional requirements
- Comments/discussions on each page with engineering notes and product decisions

## Configuration

This skill reads project-specific configuration from environment variables. If these are not set,
ask the user for the values before proceeding.

| Variable | Purpose | Example |
|----------|---------|---------|
| `JIRA_PROJECT` | JIRA project key for ticket creation | `SE` |
| `JIRA_SERVER` | Atlassian instance URL (site host) | `mycompany.atlassian.net` |
| `E2E_TEST_PHONE` | Test user phone number for verification plans | `0000000099` |
| `E2E_TEST_OTP` | Test user OTP code | `555555` |
| `E2E_TEST_ORG` | Test organization name | `Arsenal` |
| `E2E_BASE_URL` | Frontend base URL for Playwright tests | `https://dev.example.io/` |
| `E2E_GRAPHQL_URL` | GraphQL API URL for curl verification | `https://gql.dev.example.io/graphql` |

If env vars are not available, ask the user to provide them explicitly before proceeding.
Do not retrieve credentials from repository files or local agent settings.

## Workflow

### Phase 1: Fetch & Analyze the PRD

1. **Fetch the main PRD page** with `include_discussions: true`
2. **Identify all Epic sub-pages** from the content (look for child page links)
3. **Fetch all Epic pages** in parallel with `include_discussions: true`
4. **Fetch full comments** from every page using `notion-get-comments` with `include_all_blocks: true`
5. **Synthesize decisions and blockers** from the PRD content + all comments:
   - Decisions already confirmed by the team (look for agreement in comment threads)
   - Open questions that need product/engineering input
   - Engineering comments (prefixed with "Engineering:" or wrench emoji) that identify technical constraints
   - Cross-PRD dependencies (references to other features or shared infrastructure)

### Phase 1.5: Extract Source Artifacts

PRDs typically reference external design, UX, and data artifacts (Figma files, Lovable prototypes, Loom walkthroughs, screenshots, example payloads, Confluence pages). These MUST be preserved onto the resulting tickets — otherwise developers picking up a ticket lose the source of truth. This is the failure mode this step exists to prevent.

1. **Scan the PRD main page, all Epic sub-pages, and every fetched comment thread** for:
   - URLs to design/prototype tools (Figma, FigJam, Figma Make, Lovable, Framer, Penpot)
   - URLs to recording/walkthrough tools (Loom, YouTube, Vimeo, Descript)
   - URLs to collaborative docs (Google Docs/Slides/Sheets, Confluence, Notion peer pages)
   - URLs to code sandboxes (CodeSandbox, StackBlitz, Replit, GitHub permalinks/gists)
   - URLs to diagramming tools (Miro, Mural, Excalidraw, Mermaid Live, draw.io, Lucid)
   - URLs to data/observability tools (Grafana, Datadog, Sentry, Metabase, Looker)
   - Embedded images and file attachments on the page itself
   - Fenced code blocks with example data (JSON, SQL, GraphQL, cURL request/response)

2. **Classify each artifact by domain**. The split matters — each domain is the source of truth for different implementation decisions:

   | Domain | What it defines | Examples |
   |--------|-----------------|----------|
   | `ui-design` (mocks) | **Visual treatment only** — layout, spacing, typography, color, iconography | Figma design frames, Framer static frames, bare screenshots, mockup PNGs |
   | `ux-flow` (prototypes) | **Interaction and flow only** — navigation, transitions, state changes, timing, empty/error/loading states | Lovable output, Loom walkthroughs, Figma prototype links, annotated screenshots, Miro/Mural flow diagrams, user journey maps |
   | `data` | Request/response shape, schema constraints | Example JSON, SQL schemas, GraphQL snippets, API contracts |
   | `ops` | Deployment/runtime context | Runbooks, dashboards, Terraform refs, deployment diagrams |
   | `reference` | Cross-cutting context | Confluence, Notion peer pages, Google Docs, related PRDs |

3. **Apply disambiguation rules** when an artifact could fit multiple domains. These rules exist because agents consistently misclassify Figma and Lovable artifacts, which are the two most common sources of dropped context.

   - **Figma URL**: classify as `ux-flow` if the URL is a prototype share link — it contains `/proto/`, or has `starting-point-node-id=` in the query, or the sharing context labels it "prototype" / "play mode". Otherwise classify as `ui-design`. Never assume.
   - **Lovable output**: always `ux-flow`. Lovable ships working code, but its code, styling, and any embedded business rules are NOT authoritative. Treat Lovable strictly as a UX/flow reference. Implementation uses existing project components; business rules come from the PRD description, not from Lovable.
   - **Screenshot with annotations** (arrows between frames, flow labels, numbered steps): `ux-flow`. A bare unannotated screenshot: `ui-design`. A side-by-side gallery of state variants (empty/error/loading): `ui-design` with state variants noted.
   - **Loom / video walkthrough**: `ux-flow` in the vast majority of cases. The rare exception — a video that's only a static-frame design review with no interaction — is still `ux-flow` for routing purposes (both UX and UI stories benefit from it).
   - **Figma file with both design frames and a prototype**: emit two entries — one `ui-design` for the file, one `ux-flow` for the prototype URL — so both propagate correctly.

4. **Build an `artifacts` map** keyed by domain. Each entry: `{ url, title, domain, source_page, source_page_url, classification_reason }`. The `classification_reason` makes disambiguation auditable ("Figma URL contains `/proto/` → ux-flow"). The `source_page` lets you trace each reference back to where it appeared in the PRD.

5. **Surface coverage smells** — incomplete artifact sets are a common root cause of implementation drift:
   - **Zero artifacts** on a non-trivial PRD: almost always an extraction bug, not a design decision. Say so explicitly.
   - **Prototype but no mock** (`ux-flow` present, `ui-design` absent): flag "missing UI mocks". UI will have to be inferred from prototype frames — note that prototype styling is typically placeholder and must NOT be treated as visual source of truth. Record the smell on the epic.
   - **Mocks but no prototype** (`ui-design` present, `ux-flow` absent): flag "missing UX prototype". UX will have to be inferred from static mock states (empty/error/loading/hover) — any flow that isn't explicitly depicted in the mocks must be raised as a BLOCKER with recommendation + alternatives, not silently invented.
   - **Lovable output without a description covering business rules**: flag "business rules missing". Lovable's embedded logic is not authoritative; the PRD description must explicitly state required fields, validation, permissions, and edge cases.

### Phase 1.6: Source Precedence & Conflict Resolution

Different artifact domains answer different questions. When they disagree, silent reconciliation is a known failure mode — these rules must be encoded on the tickets and respected during implementation.

**Authoritative source by question**:

| Question | Authoritative source |
|----------|---------------------|
| Does this field exist? Is it required? Who can see/edit it? What validation applies? What are the edge cases, permission rules, data constraints? | **Description / PRD body** (business rules) |
| What does it look like — layout, spacing, typography, color, iconography? | **Mocks (`ui-design`)** |
| How does it flow — navigation, transitions, state changes, timing, empty/error/loading states? | **Prototypes (`ux-flow`)** |
| Where does the data come from, what shape is it, what are the API contracts? | **`data` artifacts** |

**Cross-axis conflicts must be surfaced, not reconciled silently**:

- Mock shows a field the description doesn't mention → BLOCKER on the story: "Figma shows field `X` not in PRD; confirm it exists, and if so add business rules (required/optional, validation)."
- Description mandates behavior the prototype contradicts → BLOCKER: "PRD says Y, prototype shows Z; which is correct?"
- Prototype shows a flow the mocks don't cover (e.g., an error state) → Note on the story: "Error state flow from prototype; no mock exists for the error UI. Use existing error component or request mock."
- Multiple artifacts of the same domain disagree (e.g., two Figma links showing different layouts) → BLOCKER: list both, ask which is current.

Record every conflict on the ticket description under a `## Open Questions` subsection so the developer picking up the ticket sees it before writing code.

**Existing-component reuse (applies to `ui-design` consumers)**:

Mocks define *visual intent*, not *implementation shortcut*. Before a developer builds UI from a mock, they must search the codebase for the closest-matching existing component. Encode this expectation on every UI-touching story:

- Story description includes: "Before implementing, identify the closest existing component in the codebase. Prefer reuse even if the Figma mock specifies different styling — flag the design-vs-code divergence as a discussion point on this ticket rather than pixel-matching Figma from scratch."
- If no existing component fits, building a new one is an explicit decision that must be recorded in the ticket (with rationale) before implementation.
- Lovable-generated components are never the reuse target — always use the project's own components.

### Phase 2: Codebase Research (if needed)

If the session doesn't already have codebase context, explore the repos to understand what exists.
Use Explore agents for repos not yet examined. Skip repos already explored in the current session.

Key things to look for:
- Existing entities/modules that overlap with the PRD
- Patterns to reuse (auth decorators, S3 services, existing UI components)
- Data model gaps the PRD requires (new fields, new entities)
- The tech stack per repo (framework, ORM, UI library, deployment)

### Phase 3: Create Epics

Create one Epic per PRD epic using the JIRA project key from config. Each Epic description should include:
- Summary of the epic from the PRD
- List of user stories it contains
- Key decisions from comments (with attribution)
- Blockers and open questions
- Dependencies on other epics or PRDs
- A **Source Artifacts** section listing every artifact extracted in Phase 1.5 (grouped by domain)

Use `contentFormat: "markdown"` for all descriptions.

**Attach every artifact from Phase 1.5 as an Epic remote link** — regardless of domain. The epic is the canonical hub, and anyone working on the epic or its descendants must be able to reach the full set from one place. No filtering at the epic level.

### Phase 4: Create Stories

For each Epic, create Stories:
- **One "X.0 Setup" story** for data model and infrastructure prerequisites (new entities, migrations, new fields, infrastructure like S3 buckets or SQS queues)
- **One story per user story** from the PRD (numbered to match the PRD)

**Story naming convention**: Prefix with a short code derived from the PRD title:
- "Contract Upload" -> `[CU-1.1]`
- "Squad Planning" -> `[SP-1.1]`
- Use your judgment for other PRDs

Each story description should include:
- The user story statement from the PRD
- Acceptance criteria (from functional requirements)
- Technical notes from engineering comments
- Blockers with recommendation + alternatives (if any)
- A **Source Artifacts** section listing the artifacts inherited from the epic that match this story's scope (see propagation rules below)

Set `parent` to the Epic key to link stories to their epic.

**Inherit domain-matching artifacts as story remote links**. For each story, attach the Phase 1.5 artifacts whose domain matches the story's scope:

| Story type | Inherits domains |
|------------|------------------|
| Frontend / UI | `ui-design`, `ux-flow`, `reference` |
| Backend / API / data model | `data`, `reference` |
| Infrastructure | `ops`, `reference` |
| Mixed / setup ("X.0") | All domains |

When classification is ambiguous, err on the side of inclusion — a developer can ignore a link, but they can't inherit one that wasn't attached. Classification mistakes are caught by the preservation gate in Phase 6.5 and by the human reviewing the final report.

### Phase 5: Create Sub-tasks

Delegate sub-task creation to **parallel agents** (one per epic or batch of stories) for efficiency.

Each sub-task MUST:
1. **Be scoped to exactly ONE repo** — indicated in brackets in the summary: `[repo-name]`
2. **Include an Empirical Verification Plan** — real user-like verification, NOT unit tests, linting, or typechecking

**Verification plan examples by stack:**
- **Backend APIs**: curl GraphQL/REST calls with auth token, database queries, checking audit entries
- **Frontend web**: Playwright browser tests (login with test user, navigate, interact, screenshot)
- **Infrastructure**: `cdk synth` / `terraform plan` verification, CLI checks after deploy

Use the test user credentials from config for all verification plans.

Set `parent` to the Story key. Use `issueTypeName: "Sub-task"`.

Sub-tasks inherit their parent story's artifacts by reference (the parent link). Do not re-attach the same remote links on every sub-task — that creates noise. The only exception is when a sub-task depends on an artifact that the parent story doesn't (e.g., a sub-task spec'd from a specific Figma frame that the broader story doesn't cite) — in that case, attach the specific artifact directly.

### Phase 5.5: Artifact Preservation Gate

Before reporting, verify that every artifact extracted in Phase 1.5 is reachable from the created tickets. This gate exists because silent artifact loss is the failure mode this skill is designed to prevent.

1. Pull the remote links of every epic and story created in this run (via the JIRA API).
2. Build a preservation matrix: `artifact URL → [ticket keys that reference it]`.
3. For every artifact from Phase 1.5:
   - It MUST appear on the epic it belongs to (no exceptions).
   - It SHOULD appear on at least one story whose scope matches its domain (except `reference`-domain artifacts, which may be epic-only if no story is domain-matched).
4. If any artifact has zero references anywhere, or is missing from its epic, FAIL LOUDLY:
   - List each dropped artifact with its domain, title, and source page.
   - State why it was dropped (domain classification error, propagation skipped, attach failure).
   - Ask the human to confirm the drop or point at the right epic/story, then re-attach before continuing.
5. If classification seems misrouted (e.g., a Figma link ended up on a backend story and nowhere else), surface the misroute and offer to re-propagate.

Do NOT skip this gate. If every artifact is preserved, print the matrix compactly and proceed to Phase 6.

### Phase 6: Report Results

After all tickets are created, present a summary table to the user:
- All Epics with keys and URLs
- All Stories grouped by Epic
- All Sub-tasks grouped by Story with repo tags
- Repo distribution (how many tasks per repo)
- **Artifact Preservation Matrix** — one row per artifact showing which epic/stories reference it
- Blockers list with recommendations and alternatives
- Cross-PRD dependencies

## Handling Ambiguities and Blockers

When you encounter something the PRD + comments + codebase can't resolve:

1. **Don't guess** — mark the ticket with a BLOCKER section
2. **Include your recommendation** with rationale (what you'd pick and why)
3. **List 2-3 alternatives** so the user/product can choose
4. **State what's needed to unblock** (e.g., "Product decision on X", "Sync with Y on Z")

Common blocker categories:
- Missing data model decisions (field types, entity relationships)
- Permission model unclear (who can view/edit)
- UX decisions not finalized (display format, input mechanism)
- Cross-team dependencies (shared infrastructure, coordinated rollouts)
- Preset values not defined (enums, tags, labels)

## Agent Prompt Template for Sub-task Creation

When delegating to agents, provide this context:

```text
Create JIRA sub-tasks in the [PROJECT] project at [CLOUD_ID].
Use issueTypeName "Sub-task" and set parent to the story key.
Use contentFormat "markdown".

Test user info: [credentials from config]

Each sub-task must:
1. Be scoped to ONE repo only
2. Include an **Empirical Verification Plan** section
3. Include the repo in brackets in the summary

[Then list all sub-tasks grouped by parent story with details]
```

## Cross-PRD Shared Infrastructure

Track tickets that are shared across PRDs to avoid duplication.
When a sub-task overlaps with an existing ticket, reference it instead of creating a duplicate.
Search JIRA for existing tickets in the project before creating new ones for shared infrastructure.
