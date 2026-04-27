---
name: linear-to-jira
description: >
  Break down a Linear PRD (a Linear Project) into JIRA epics, stories, and sub-tasks. Use this skill
  whenever the user shares a Linear project URL and wants it converted into JIRA tickets, or asks to
  "break down this Linear project", "create tickets from a Linear project", "turn this Linear PRD into
  JIRA", or similar. This skill mirrors `lisa:notion-to-jira` and `lisa:confluence-to-jira` for projects
  whose PRDs live in Linear — the workflow, gates, dry-run mode, and validation rules are identical;
  only the source-of-truth tool surface differs (Linear MCP instead of Notion / Confluence MCP).
allowed-tools: ["Skill", "Bash", "mcp__linear-server__get_project", "mcp__linear-server__list_projects", "mcp__linear-server__list_issues", "mcp__linear-server__get_issue", "mcp__linear-server__list_comments", "mcp__linear-server__list_documents", "mcp__linear-server__get_document", "mcp__linear-server__list_project_labels", "mcp__linear-server__list_teams", "mcp__atlassian__getJiraIssueRemoteIssueLinks"]
---

# Linear PRD to JIRA Breakdown

Convert a Linear PRD (a Linear **Project**) into a structured JIRA ticket hierarchy: Epics > Stories > Sub-tasks.
Each sub-task is scoped to exactly one repo and includes an empirical verification plan.

This skill is the Linear counterpart of `lisa:notion-to-jira` and `lisa:confluence-to-jira`. The three skills share the same phases, gates, dry-run contract, and per-ticket validation logic. Only the PRD-side fetch tools differ. When changing workflow logic, change ALL THREE skills together so the source vendors stay behaviorally identical.

## What "PRD" means in Linear

Linear has no native "PRD" entity. This skill treats a **Linear Project** as the PRD container:

- **Project description** (markdown) is the PRD body — equivalent to a Notion page body or a Confluence page body.
- **Project documents** (Linear's long-form markdown docs attached to projects, fetched via `list_documents({projectId})` / `get_document`) are treated as additional spec content and merged into the analysis. A multi-document Linear PRD is the analog of a multi-page Confluence PRD.
- **Project sub-issues** (`list_issues({project})`) act as the candidate set for epics and user stories — the same role child Epic pages play in a Notion/Confluence PRD.
- **Linear comments live on Issues, not on Projects.** This skill aggregates comments from every issue under the project to capture decisions and engineering notes. Project-level discussion that isn't reflected on an issue is invisible to this skill.

## Modes

This skill supports two modes, controlled by a `dry_run` flag in `$ARGUMENTS`:

- **`dry_run: false`** (default — full mode): run all phases, write tickets via `lisa:jira-write-ticket`, run the preservation gate, report.
- **`dry_run: true`** (planning + validation only — no writes): run Phases 1, 1.5, 1.6, 2, 3, 4 to plan the hierarchy and draft each ticket spec, then call `lisa:jira-validate-ticket` (with `--spec-only`) on every drafted ticket. Aggregate the per-ticket validator reports into a single dry-run report. **Skip Phase 5 (sub-task creation), Phase 5.5 (preservation gate), and Phase 6 (results report)** — none of those make sense without writes. Return the dry-run report so the caller (e.g. `lisa:linear-prd-intake`) can decide whether to proceed.

Dry-run output format is identical to `lisa:notion-to-jira`'s and `lisa:confluence-to-jira`'s. Reuse the same fields, including `prd_anchor` and `prd_section`. The only difference: Linear has no inline-comment selection-anchor primitive at the project level — `prd_anchor` is the anchor a downstream caller would use to *post a comment on the related sub-issue* (typically the issue identifier, e.g. `LIN-123`, scoped to a section heading). When the failure does not map to any single sub-issue, set `prd_anchor: null` and the caller falls back to its sentinel feedback channel.

```text
## linear-to-jira dry-run: <PRD title>

### Planned hierarchy
- Epic: <summary>
  prd_section: "<heading text from the project description / document that produced this epic>"
  prd_anchor: "<linear issue identifier or null>"
  - Story 1.1: <summary>
    prd_section: "<heading or user-story line>"
    prd_anchor: "<linear issue identifier or null>"
    - Sub-task [<repo>]: <summary>
      prd_section: "<heading or AC bullet>"
      prd_anchor: "<linear issue identifier or null>"
    - ...
  - Story 1.2: ...

### Per-ticket validation
- <ticket-id>: PASS | FAIL — <count> failures
  prd_section: "<heading text>"
  prd_anchor: "<linear issue identifier or null>"
  failures:
    - gate: <gate-id>
      category: <category from validator>
      product_relevant: <true|false>
      what: <plain-language description from validator>
      recommendation: <1–3 candidate resolutions from validator>

### Verdict: PASS | FAIL
### Total failures: <n>
```

The dry-run mode never writes to JIRA and never calls `mcp__atlassian__createJiraIssue`. It also never modifies the source Linear project, never adds/removes labels, never edits sub-issues, and never posts comments — that is the orchestrating skill's responsibility (`lisa:linear-prd-intake`).

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

Bypassing `lisa:jira-write-ticket` produces thin tickets that the rest of the lifecycle (triage, ticket-verify, journey, evidence) treats as broken. Atlassian reads in this skill are limited to the tools listed in `allowed-tools` (currently `getJiraIssueRemoteIssueLinks`) for the Phase 5.5 preservation gate. The Linear read tools listed in `allowed-tools` above are PRD-side only and never write.

## Input

A Linear project URL, slug, or ID. The PRD is expected to have:
- A project with a description containing context, problems, and (optionally) a list of user stories
- One or more sub-issues that act as candidate epics or user stories
- Optionally one or more Linear documents attached to the project, with deeper spec content
- Issue comments capturing engineering notes and product decisions

URL parsing — Linear project URLs come in this shape:

```text
https://linear.app/<workspace>/project/<slug>-<short-id>
https://linear.app/<workspace>/project/<slug>-<short-id>/<view>
```

Extract the trailing `<short-id>` (the alphanumeric segment after the last `-` in the slug). If only a workspace or team URL is provided (no `/project/<slug>-<id>` segment), stop and report — single-PRD mode requires a specific project. The caller wanted `lisa:linear-prd-intake` (batch mode).

## Configuration

This skill reads project-specific configuration from environment variables. If these are not set, ask the user for the values before proceeding.

| Variable | Purpose | Example |
|----------|---------|---------|
| `JIRA_PROJECT` | JIRA project key for ticket creation | `SE` |
| `JIRA_SERVER` | Atlassian instance URL (site host) | `mycompany.atlassian.net` |
| `LINEAR_WORKSPACE` | Linear workspace slug (used for URL synthesis on JIRA remote links) | `acme` |
| `E2E_TEST_PHONE` | Test user phone number for verification plans | `0000000099` |
| `E2E_TEST_OTP` | Test user OTP code | `555555` |
| `E2E_TEST_ORG` | Test organization name | `Arsenal` |
| `E2E_BASE_URL` | Frontend base URL for Playwright tests | `https://dev.example.io/` |
| `E2E_GRAPHQL_URL` | GraphQL API URL for curl verification | `https://gql.dev.example.io/graphql` |

If env vars are not available, ask the user to provide them explicitly before proceeding. Do not retrieve credentials from repository files or local agent settings.

## Workflow

### Phase 1: Fetch & Analyze the PRD

1. **Resolve the project** via `mcp__linear-server__get_project` with the slug or ID, including milestones and resources (`includeMilestones: true`, `includeResources: true`). Capture the project title, description, state, labels, lead, dates, attached documents, attached links.
2. **Fetch attached Linear documents** via `mcp__linear-server__list_documents({projectId})` then `get_document` per result. Treat each as additional PRD content. (A Linear PRD with a single rich project description and no attached documents is the common case; multi-document PRDs are valid too.)
3. **Identify candidate epics and user stories** from project sub-issues via `mcp__linear-server__list_issues({project: <id>})`. Capture identifier, title, description, labels, state, parent issue, and `parentId` chain so the issue hierarchy is reproducible.
4. **Fetch full comments per sub-issue** via `mcp__linear-server__list_comments({issueId})` for every issue surfaced in step 3. Walk thread parents/children — comments are threaded via `parentId` references on the comment object.
5. **Synthesize decisions and blockers** from the project description + every document + every issue comment:
   - Decisions already confirmed by the team (look for agreement in comment threads)
   - Open questions that need product/engineering input
   - Engineering comments (prefixed with "Engineering:" or wrench emoji) that identify technical constraints
   - Cross-PRD dependencies (references to other Linear projects, documents, or shared infrastructure)

### Phase 1.5: Extract Source Artifacts

PRDs typically reference external design, UX, and data artifacts (Figma files, Lovable prototypes, Loom walkthroughs, screenshots, example payloads, peer Linear or Confluence pages). These MUST be preserved onto the resulting tickets — otherwise developers picking up a ticket lose the source of truth. This is the failure mode this step exists to prevent.

1. **Scan the project description, every attached document body, every sub-issue description, and every fetched comment thread** for:
   - URLs to design/prototype tools (Figma, FigJam, Figma Make, Lovable, Framer, Penpot)
   - URLs to recording/walkthrough tools (Loom, YouTube, Vimeo, Descript)
   - URLs to collaborative docs (Google Docs/Slides/Sheets, peer Confluence pages, Notion peer pages, peer Linear documents)
   - URLs to code sandboxes (CodeSandbox, StackBlitz, Replit, GitHub permalinks/gists)
   - URLs to diagramming tools (Miro, Mural, Excalidraw, Mermaid Live, draw.io, Lucid)
   - URLs to data/observability tools (Grafana, Datadog, Sentry, Metabase, Looker)
   - Embedded images and file attachments referenced in the project / documents
   - Fenced code blocks with example data (JSON, SQL, GraphQL, cURL request/response)

2. **Classify each artifact and apply taxonomy rules** by invoking the `lisa:jira-source-artifacts` skill. That skill is the single source of truth for: domains (`ui-design` / `ux-flow` / `data` / `ops` / `reference`), per-tool classification rules (Figma `/proto/` vs design, Lovable as `ux-flow`, Loom, screenshots), and coverage smells. Do not restate the rules here — invoke the skill so any drift in the rules propagates uniformly.

3. **Build an `artifacts` map** keyed by domain. Each entry: `{ url, title, domain, source_page, source_page_url, classification_reason }`. The `classification_reason` makes disambiguation auditable. The `source_page` lets you trace each reference back to where it appeared (project description vs a specific document title vs a specific sub-issue comment).

4. **Surface coverage smells** as defined in `lisa:jira-source-artifacts` §5. Record any detected smells on the epic.

### Phase 1.6: Source Precedence & Conflict Resolution

Source precedence rules and cross-axis conflict handling are defined in `lisa:jira-source-artifacts` §3 and §4. Apply them during ticket synthesis: every conflict between artifacts must be recorded under `## Open Questions` on the affected ticket, never silently reconciled.

The existing-component reuse expectation is defined in `lisa:jira-source-artifacts` §7. Encode it on every UI-touching story.

### Phase 2: Codebase + Live Product Research

Identical to `lisa:notion-to-jira` Phase 2 and `lisa:confluence-to-jira` Phase 2. Two complementary inputs ground PRD analysis: the **code** (what's there to reuse / extend) and the **live product** (what users see today). Skipping either produces tickets that misjudge the change.

**2a. Codebase research.** If the session doesn't already have codebase context, explore the repos to understand what exists. Use Explore agents for repos not yet examined.

**2b. Live product walkthrough.** If the PRD touches existing user-facing surfaces, invoke the `lisa:product-walkthrough` skill against `E2E_BASE_URL` using the test user from config.

Skip 2b only when the work is purely backend with no user-visible surface, or affects a screen that does not yet exist in dev/prod.

Walkthrough findings are surfaced back to product via the orchestrating intake skill (`lisa:linear-prd-intake`), which posts them on the project's sentinel feedback issue. This skill itself does NOT post to Linear — it only reads. The walkthrough section is also inherited onto the resulting epic / stories under a `## Current Product` subsection in the JIRA description.

### Phase 3: Create Epics

> **Mode guard**: In `dry_run: true` mode, do not invoke `lisa:jira-write-ticket` in this phase. Instead, draft the epic spec (summary, description_body, artifacts) and validate it with `lisa:jira-validate-ticket --spec-only`. Record the drafted spec (including a placeholder epic key like `DRY-RUN-EPIC-1`) for Phase 4 to use as parent references. In `dry_run: false` mode (default), proceed as described below.

For each epic identified in Phase 1, **invoke the `lisa:jira-write-ticket` skill** (do not call `createJiraIssue` directly). Pass it everything it needs to enforce its quality gates:

- `project_key`: from `JIRA_PROJECT` config
- `issue_type`: `Epic`
- `summary`: epic title from the PRD
- `description_body`: a draft of the 3-audience description containing:
  - **Context / Business Value**: epic summary from the PRD, originating Linear project URL, business outcome
  - **Technical Approach**: cross-cutting integration points and constraints surfaced in Phase 2 codebase research
  - List of user stories the epic contains
  - Key decisions from comments (with attribution)
  - Blockers and open questions
  - Dependencies on other epics or PRDs
  - A **Source Artifacts** section listing every artifact extracted in Phase 1.5 (grouped by domain)
- `artifacts`: the full Phase 1.5 artifact list — every artifact, regardless of domain. The epic is the canonical hub. No filtering at the epic level.
- `priority`, `labels`, `components`, `fix_version`: as appropriate

Capture the returned epic key — Phase 4 needs it as the parent for stories.

### Phase 4: Create Stories

> **Mode guard**: In `dry_run: true` mode, do not invoke `lisa:jira-write-ticket` in this phase. Instead, draft each story spec and validate it with `lisa:jira-validate-ticket --spec-only`. Use placeholder keys (e.g. `DRY-RUN-STORY-1.1`) for any downstream references. In `dry_run: false` mode (default), proceed as described below.

For each Epic, plan two kinds of stories:
- **One "X.0 Setup" story** for data model and infrastructure prerequisites
- **One story per user story** from the PRD (numbered to match the PRD's structure or the source Linear sub-issues)

**Story naming convention**: Prefix the summary with a short code derived from the PRD title (e.g., `[CU-1.1]` for "Contract Upload").

For each story, **invoke `lisa:jira-write-ticket`** with:

- `project_key`: from `JIRA_PROJECT` config
- `issue_type`: `Story`
- `epic_parent`: the Epic key captured in Phase 3 (mandatory)
- `summary`: prefixed per the naming convention above
- `description_body`: 3-audience description as in `lisa:notion-to-jira` Phase 4
- `artifacts`: the Phase 1.5 artifacts filtered by domain per the inheritance table below

| Story type | Inherits domains |
|------------|------------------|
| Frontend / UI | `ui-design`, `ux-flow`, `reference` |
| Backend / API / data model | `data`, `reference` |
| Infrastructure | `ops`, `reference` |
| Mixed / setup ("X.0") | All domains |

Capture each returned story key — Phase 5 needs it as the parent for sub-tasks.

### Phase 5: Create Sub-tasks

Delegate sub-task creation to **parallel agents** (one per epic or batch of stories) for efficiency. **Every spawned agent must invoke `lisa:jira-write-ticket` for each sub-task — no agent may call `createJiraIssue` directly.**

Each sub-task MUST:
1. **Be scoped to exactly ONE repo** — indicated in brackets in the summary: `[repo-name]`
2. **Include an Empirical Verification Plan** — real user-like verification, NOT unit tests, linting, or typechecking

Sub-tasks inherit their parent story's artifacts by reference (the parent link). Do not pass the same artifact list to every sub-task.

### Phase 5.5: Artifact Preservation Gate (mandatory)

Run the preservation gate defined in `lisa:jira-source-artifacts` §8 against the artifacts extracted in Phase 1.5 and the tickets just created. Do NOT restate or modify the gate logic here — invoke the rules from `lisa:jira-source-artifacts`.

To run the gate, this skill must:

1. Pull the remote links of every epic and story created in this run via `mcp__atlassian__getJiraIssueRemoteIssueLinks`.
2. Apply the §8 preservation matrix and verdict rules.
3. If the gate fails: list each dropped/misrouted artifact and either re-attach via `lisa:jira-write-ticket` (UPDATE mode) or stop and ask the human.
4. If the gate passes: print the matrix compactly and proceed to Phase 6.

This gate is not optional.

### Phase 6: Report Results

After all tickets are created, present a summary table to the user:
- All Epics with keys and URLs
- All Stories grouped by Epic
- All Sub-tasks grouped by Story with repo tags
- Repo distribution
- **Artifact Preservation Matrix**
- Blockers list with recommendations and alternatives
- Cross-PRD dependencies

## Handling Ambiguities and Blockers

When you encounter something the PRD + comments + codebase can't resolve:

1. **Don't guess** — mark the ticket with a BLOCKER section
2. **Include your recommendation** with rationale
3. **List 2-3 alternatives** so the user/product can choose
4. **State what's needed to unblock**

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

If `lisa:jira-write-ticket` rejects a sub-task, fix the input and re-invoke. Do NOT fall back
to a direct `createJiraIssue` call to bypass the gate.

Test user info: [credentials from config]

[Then list all sub-tasks grouped by parent story with details]
```

## Cross-PRD Shared Infrastructure

Track tickets that are shared across PRDs to avoid duplication. When a sub-task overlaps with an existing ticket, reference it instead of creating a duplicate. Search JIRA for existing tickets in the project before creating new ones for shared infrastructure.

## Linear-specific notes

- **Project description format**: Linear project descriptions are markdown. Treat headings (`#`, `##`, `###`) as section markers for `prd_section`.
- **Document parents**: Linear documents are attached to either a Project or an Issue (exactly one). For PRD intake, only documents attached to the project being processed are in scope. Documents attached to a child Issue are picked up via that issue's content surface.
- **Comment threading**: Linear comments are threaded via a `parentId` field on each comment. When fetching comments via `list_comments`, capture the full reply tree — replies often hold the actual decision while the root comment was the question.
- **No project-level comments via MCP**: clarifying-question comments cannot land directly on the project itself. The orchestrating skill (`lisa:linear-prd-intake`) handles this by maintaining a sentinel feedback issue under the project. This skill does not write to Linear at all — it only reads.
- **Issue identifiers** (`LIN-123`, `ENG-456`, etc.) are the closest analog to a Confluence inline-comment anchor. When dry-run output sets `prd_anchor` to an issue identifier, the caller knows it can post a clarifying-question comment on that specific issue if it wants block-level anchoring.
