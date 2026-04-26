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

## Modes

This skill supports two modes, controlled by a `dry_run` flag in `$ARGUMENTS`:

- **`dry_run: false`** (default — full mode): run all phases, write tickets via `lisa:jira-write-ticket`, run the preservation gate, report.
- **`dry_run: true`** (planning + validation only — no writes): run Phases 1, 1.5, 1.6, 2, 3, 4 to plan the hierarchy and draft each ticket spec, then call `lisa:jira-validate-ticket` (with `--spec-only`) on every drafted ticket. Aggregate the per-ticket validator reports into a single dry-run report. **Skip Phase 5 (sub-task creation), Phase 5.5 (preservation gate), and Phase 6 (results report)** — none of those make sense without writes. Return the dry-run report so the caller (e.g. `lisa:notion-prd-intake`) can decide whether to proceed.

Dry-run output format:

```text
## notion-to-jira dry-run: <PRD title>

### Planned hierarchy
- Epic: <summary>
  - Story 1.1: <summary>
    - Sub-task [<repo>]: <summary>
    - ...
  - Story 1.2: ...

### Per-ticket validation
- <ticket-id>: PASS | FAIL — <count> failures
  - <gate-id>: <one-line reason and remediation>

### Verdict: PASS | FAIL
### Total failures: <n>
```

The dry-run mode never writes to JIRA and never calls `mcp__atlassian__createJiraIssue`. It also never sets a Notion status — that is the orchestrating skill's responsibility.

## Hard Rule: All Writes Go Through `lisa:jira-write-ticket`

**Every JIRA ticket created by this skill — every epic, story, and sub-task — MUST be created by invoking the `lisa:jira-write-ticket` skill. Never call `mcp__atlassian__createJiraIssue`, `mcp__atlassian__editJiraIssue`, `mcp__atlassian__createIssueLink`, or any other Atlassian write tool directly from this skill or from any sub-agent it spawns.**

`lisa:jira-write-ticket` enforces gates this skill does not:
- 3-audience description (Context / Technical Approach / Acceptance Criteria)
- Gherkin acceptance criteria
- Epic parent validation
- Explicit issue-link discovery (`blocks` / `is blocked by` / `relates to` / `duplicates` / `clones`)
- Single-repo scope check on Bug / Task / Sub-task
- Sign-in account and target environment recorded in description
- Post-create verification

Bypassing `lisa:jira-write-ticket` produces thin tickets that the rest of the lifecycle (triage, ticket-verify, journey, evidence) treats as broken. This is the most common failure mode this skill has had — calling `createJiraIssue` directly is a regression, not an optimization. The Atlassian read tools (`getJiraIssue`, `searchJiraIssuesUsingJql`, `getJiraIssueRemoteIssueLinks`, `getAccessibleAtlassianResources`, `getJiraProjectIssueTypesMetadata`, `getVisibleJiraProjects`) ARE allowed for context gathering and the Phase 5.5 preservation gate.

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

2. **Classify each artifact and apply taxonomy rules** by invoking the `lisa:jira-source-artifacts` skill. That skill is the single source of truth for: domains (`ui-design` / `ux-flow` / `data` / `ops` / `reference`), per-tool classification rules (Figma `/proto/` vs design, Lovable as `ux-flow`, Loom, screenshots), and coverage smells. Do not restate the rules here — invoke the skill so any drift in the rules propagates uniformly.

3. **Build an `artifacts` map** keyed by domain. Each entry: `{ url, title, domain, source_page, source_page_url, classification_reason }`. The `classification_reason` makes disambiguation auditable ("Figma URL contains `/proto/` → ux-flow"). The `source_page` lets you trace each reference back to where it appeared in the PRD.

4. **Surface coverage smells** as defined in `lisa:jira-source-artifacts` §5 (zero artifacts, prototype-without-mock, mock-without-prototype, Lovable-without-business-rules). Record any detected smells on the epic.

### Phase 1.6: Source Precedence & Conflict Resolution

Source precedence rules and cross-axis conflict handling are defined in `lisa:jira-source-artifacts` §3 and §4. Apply them during ticket synthesis: every conflict between artifacts must be recorded under `## Open Questions` on the affected ticket, never silently reconciled.

The existing-component reuse expectation (mocks define visual intent, not implementation shortcut) is defined in `lisa:jira-source-artifacts` §7. Encode it on every UI-touching story.

### Phase 2: Codebase + Live Product Research

Two complementary inputs ground PRD analysis: the **code** (what's there to reuse / extend) and the **live product** (what users see today). Skipping either produces tickets that misjudge the change.

**2a. Codebase research.** If the session doesn't already have codebase context, explore the repos to understand what exists. Use Explore agents for repos not yet examined. Skip repos already explored in the current session.

Key things to look for:
- Existing entities/modules that overlap with the PRD
- Patterns to reuse (auth decorators, S3 services, existing UI components)
- Data model gaps the PRD requires (new fields, new entities)
- The tech stack per repo (framework, ORM, UI library, deployment)

**2b. Live product walkthrough.** If the PRD touches existing user-facing surfaces (modifies a screen, adds something next to existing functionality, fixes current behavior, re-styles an existing flow), invoke the `lisa:product-walkthrough` skill against `E2E_BASE_URL` using the test user from config. This grounds the ticket plan in what's actually shipped — design-vs-current-product divergence, reuse candidates, and behavioral surprises that the PRD didn't anticipate become inputs to ticket creation rather than discoveries during implementation.

Skip 2b only when the work is purely backend with no user-visible surface, or affects a screen that does not yet exist in dev/prod.

Walkthrough findings are attached to the originating Notion PRD as a comment ("Current product walkthrough — `<route>`") and inherited onto the resulting epic / stories under a `## Current Product` subsection.

### Phase 3: Create Epics

> **Mode guard**: In `dry_run: true` mode, do not invoke `lisa:jira-write-ticket` in this phase. Instead, draft the epic spec (summary, description_body, artifacts) and validate it with `jira-validate-ticket --spec-only`. Record the drafted spec (including a placeholder epic key like `DRY-RUN-EPIC-1`) for Phase 4 to use as parent references. In `dry_run: false` mode (default), proceed as described below.

For each PRD epic, **invoke the `lisa:jira-write-ticket` skill** (do not call `createJiraIssue` directly). Pass it everything it needs to enforce its quality gates:

- `project_key`: from `JIRA_PROJECT` config
- `issue_type`: `Epic`
- `summary`: epic title from the PRD
- `description_body`: a draft of the 3-audience description containing:
  - **Context / Business Value**: epic summary from the PRD, originating Notion URL, business outcome
  - **Technical Approach**: cross-cutting integration points and constraints surfaced in Phase 2 codebase research
  - List of user stories the epic contains
  - Key decisions from comments (with attribution)
  - Blockers and open questions
  - Dependencies on other epics or PRDs
  - A **Source Artifacts** section listing every artifact extracted in Phase 1.5 (grouped by domain)
- `artifacts`: the full Phase 1.5 artifact list — every artifact, regardless of domain. The epic is the canonical hub, and anyone working on the epic or its descendants must be able to reach the full set from one place. No filtering at the epic level. `lisa:jira-write-ticket` Phase 4c attaches them as remote links.
- `priority`, `labels`, `components`, `fix_version`: as appropriate

Capture the returned epic key — Phase 4 needs it as the parent for stories.

### Phase 4: Create Stories

> **Mode guard**: In `dry_run: true` mode, do not invoke `lisa:jira-write-ticket` in this phase. Instead, draft each story spec and validate it with `jira-validate-ticket --spec-only`. Use placeholder keys (e.g. `DRY-RUN-STORY-1.1`) for any downstream references. In `dry_run: false` mode (default), proceed as described below.

For each Epic, plan two kinds of stories:
- **One "X.0 Setup" story** for data model and infrastructure prerequisites (new entities, migrations, new fields, infrastructure like S3 buckets or SQS queues)
- **One story per user story** from the PRD (numbered to match the PRD)

**Story naming convention**: Prefix the summary with a short code derived from the PRD title:
- "Contract Upload" -> `[CU-1.1]`
- "Squad Planning" -> `[SP-1.1]`
- Use your judgment for other PRDs

For each story, **invoke `lisa:jira-write-ticket`** with:

- `project_key`: from `JIRA_PROJECT` config
- `issue_type`: `Story`
- `epic_parent`: the Epic key captured in Phase 3 (mandatory — `lisa:jira-write-ticket` rejects non-bug, non-epic tickets without an epic parent)
- `summary`: prefixed per the naming convention above
- `description_body`: a draft of the 3-audience description containing:
  - **Context / Business Value**: the user story statement from the PRD
  - **Technical Approach**: notes from engineering comments and Phase 2 codebase research
  - **Acceptance Criteria** (Gherkin) derived from the functional requirements — `lisa:jira-write-ticket` will reject prose-only acceptance criteria
  - Blockers with recommendation + alternatives (if any), under `## Open Questions`
  - A **Source Artifacts** section listing the artifacts inherited from the epic that match this story's scope (see propagation rules below)
- `artifacts`: the Phase 1.5 artifacts filtered by domain per the inheritance table below — `lisa:jira-write-ticket` Phase 4c attaches them as remote links
- `priority`, `labels`, `components`, `fix_version`: as appropriate

Capture each returned story key — Phase 5 needs it as the parent for sub-tasks.

**Inherit domain-matching artifacts as story remote links**. For each story, the artifact set passed to `lisa:jira-write-ticket` should be the Phase 1.5 artifacts whose domain matches the story's scope:

| Story type | Inherits domains |
|------------|------------------|
| Frontend / UI | `ui-design`, `ux-flow`, `reference` |
| Backend / API / data model | `data`, `reference` |
| Infrastructure | `ops`, `reference` |
| Mixed / setup ("X.0") | All domains |

When classification is ambiguous, err on the side of inclusion — a developer can ignore a link, but they can't inherit one that wasn't attached. Classification mistakes are caught by the preservation gate in Phase 5.5 and by the human reviewing the final report.

### Phase 5: Create Sub-tasks

Delegate sub-task creation to **parallel agents** (one per epic or batch of stories) for efficiency. **Every spawned agent must invoke `lisa:jira-write-ticket` for each sub-task — no agent may call `createJiraIssue` directly.** This is non-negotiable; see the Agent Prompt Template at the bottom of this skill for the exact instructions to pass.

Each sub-task MUST:
1. **Be scoped to exactly ONE repo** — indicated in brackets in the summary: `[repo-name]`. `lisa:jira-write-ticket` enforces single-repo scope on Sub-task; cross-repo sub-tasks will be rejected and must be split before delegation.
2. **Include an Empirical Verification Plan** — real user-like verification, NOT unit tests, linting, or typechecking

**Verification plan examples by stack:**
- **Backend APIs**: curl GraphQL/REST calls with auth token, database queries, checking audit entries
- **Frontend web**: Playwright browser tests (login with test user, navigate, interact, screenshot)
- **Infrastructure**: `cdk synth` / `terraform plan` verification, CLI checks after deploy

Use the test user credentials from config for all verification plans. The credentials are passed to `lisa:jira-write-ticket` as the sign-in account so it can record them in the description per its own rules.

For each sub-task, the spawned agent invokes `lisa:jira-write-ticket` with `issue_type: "Sub-task"` and `parent` set to the Story key. The Story key is the parent — the epic relationship is inherited transitively.

Sub-tasks inherit their parent story's artifacts by reference (the parent link). Do not pass the same artifact list to every sub-task — that creates noise. The only exception is when a sub-task depends on an artifact that the parent story doesn't (e.g., a sub-task spec'd from a specific Figma frame that the broader story doesn't cite) — in that case, pass the specific artifact in the `artifacts` parameter to `lisa:jira-write-ticket`.

### Phase 5.5: Artifact Preservation Gate (mandatory)

Run the preservation gate defined in `lisa:jira-source-artifacts` §8 against the artifacts extracted in Phase 1.5 and the tickets just created. Do NOT restate or modify the gate logic here — invoke the rules from `lisa:jira-source-artifacts` so any rule change propagates uniformly.

To run the gate, this skill must:

1. Pull the remote links of every epic and story created in this run via `mcp__atlassian__getJiraIssueRemoteIssueLinks`.
2. Apply the §8 preservation matrix and verdict rules.
3. If the gate fails: list each dropped/misrouted artifact (domain, title, source page, why it was dropped) and either re-attach via `lisa:jira-write-ticket` (UPDATE mode) or stop and ask the human. Never silently proceed past a gate failure.
4. If the gate passes: print the matrix compactly and proceed to Phase 6.

This gate is not optional. Skipping it is the failure mode the architecture exists to prevent.

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

When delegating to agents, provide this context. **The "MUST invoke jira-write-ticket" instruction is load-bearing — do not edit it out when adapting this template.**

```text
Create JIRA sub-tasks in the [PROJECT] project at [CLOUD_ID].

CRITICAL: For each sub-task, invoke the `lisa:jira-write-ticket` skill via the Skill tool.
Do NOT call `mcp__atlassian__createJiraIssue` directly. The `lisa:jira-write-ticket` skill
enforces required quality gates (Gherkin acceptance criteria, 3-audience description,
single-repo scope, sign-in/environment fields, post-create verification). Bypassing it
produces broken tickets that downstream skills (triage, journey, evidence) cannot use.

For each sub-task, invoke `lisa:jira-write-ticket` with:
- issue_type: "Sub-task"
- parent: the parent story key
- project_key: [PROJECT]
- summary: prefixed with the repo in brackets, e.g. "[backend-api] Add audit log table"
- description_body: a 3-section draft (Context / Technical Approach / Acceptance Criteria)
- gherkin_acceptance_criteria: derived from the story's functional requirements
- sign_in_account: [test user credentials from config — name + role + how to obtain]
- target_environment: "dev"
- empirical_verification_plan: real user-like verification (curl + auth token,
  Playwright browser flow, CLI check after deploy) using the test credentials.
  NOT unit tests, linting, or typechecking.

Each sub-task must:
1. Be scoped to ONE repo only — repo named in brackets in the summary
2. Include the Empirical Verification Plan in the description
3. Be created via `lisa:jira-write-ticket`, not via direct MCP calls

If `lisa:jira-write-ticket` rejects a sub-task (cross-repo scope, missing Gherkin, missing
sign-in, etc.), fix the input and re-invoke. Do NOT fall back to a direct
`createJiraIssue` call to bypass the gate.

Test user info: [credentials from config]

[Then list all sub-tasks grouped by parent story with details]
```

## Cross-PRD Shared Infrastructure

Track tickets that are shared across PRDs to avoid duplication.
When a sub-task overlaps with an existing ticket, reference it instead of creating a duplicate.
Search JIRA for existing tickets in the project before creating new ones for shared infrastructure.
