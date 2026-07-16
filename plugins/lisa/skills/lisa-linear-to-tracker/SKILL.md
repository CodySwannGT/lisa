---
name: lisa-linear-to-tracker
description: >
  Break down a Linear PRD (a Linear Project) into Epics, Stories, and Sub-tasks in the configured destination tracker (JIRA, GitHub Issues, or Linear per .lisa.config.json). Use this skill
  whenever the user shares a Linear project URL and wants it converted into tracker tickets, or asks to
  "break down this Linear project", "create tickets from a Linear project", "turn this Linear PRD into tickets", or similar. This skill mirrors `lisa-notion-to-tracker` and `lisa-confluence-to-tracker` for projects
  whose PRDs live in Linear — the workflow, gates, dry-run mode, and validation rules are identical;
  only the source-of-truth tool surface differs (Linear MCP instead of Notion / Confluence MCP).
allowed-tools: ["Skill", "Bash"]
---

# Linear PRD to Tracker Breakdown

Convert a Linear PRD (a Linear **Project**) into a structured ticket hierarchy in the configured destination tracker (JIRA, GitHub Issues, or Linear per .lisa.config.json): Epics > Stories > Sub-tasks.
Each sub-task is scoped to exactly one repo and includes an empirical verification plan.

This skill is the Linear counterpart of `lisa-notion-to-tracker` and `lisa-confluence-to-tracker`. The three skills share the same phases, gates, dry-run contract, and per-ticket validation logic. Only the PRD-side fetch tools differ. When changing workflow logic, change ALL THREE skills together so the source vendors stay behaviorally identical.

## What "PRD" means in Linear

Linear has no native "PRD" entity. This skill treats a **Linear Project** as the PRD container:

- **Project description** (markdown) is the PRD body — equivalent to a Notion page body or a Confluence page body.
- **Project documents** (Linear's long-form markdown docs attached to projects, fetched via `list-documents({projectId})` / `get-document`) are treated as additional spec content and merged into the analysis. A multi-document Linear PRD is the analog of a multi-page Confluence PRD.
- **Project sub-issues** (`list-issues({project})`) act as the candidate set for epics and user stories — the same role child Epic pages play in a Notion/Confluence PRD.
- **Linear comments live on Issues, not on Projects.** This skill aggregates comments from every issue under the project to capture decisions and engineering notes. Project-level discussion that isn't reflected on an issue is invisible to this skill.

## Modes

This skill supports two modes, controlled by a `dry_run` flag in `$ARGUMENTS`:

- **`dry_run: false`** (default — full mode): run all phases, write tickets via `lisa-tracker-write`, run the preservation gate, report.
- **`dry_run: true`** (planning + validation only — no writes): run Phases 1, 1.5, 1.6, 2, 3, 4 to plan the hierarchy and draft each ticket spec, then call `lisa-tracker-validate` (with `--spec-only`) on every drafted ticket. Aggregate the per-ticket validator reports into a single dry-run report. **Skip Phase 5 (sub-task creation), Phase 5.5 (preservation gate), and Phase 6 (results report)** — none of those make sense without writes. Return the dry-run report so the caller (e.g. `lisa-linear-prd-intake`) can decide whether to proceed.

Dry-run output format is identical to `lisa-notion-to-tracker`'s and `lisa-confluence-to-tracker`'s. Reuse the same fields, including `prd_anchor` and `prd_section`, the `### Requirement register` section, and the per-node `requirements:` lists. The only difference: Linear has no inline-comment selection-anchor primitive at the project level — `prd_anchor` is the anchor a downstream caller would use to *post a comment on the related sub-issue* (typically the issue identifier, e.g. `LIN-123`, scoped to a section heading). When the failure does not map to any single sub-issue, set `prd_anchor: null` and the caller falls back to its sentinel feedback channel.

```text
## linear-to-tracker dry-run: <PRD title>

### Requirement register
- R1 §"<section heading>": "<verbatim requirement text>"
- R2 §"<section heading>": "<verbatim requirement text>"
- ...

### Planned hierarchy
- Epic: <summary>
  prd_section: "<heading text from the project description / document that produced this epic>"
  prd_anchor: "<linear issue identifier or null>"
  requirements: [R1, R2]   # register ids this ticket exists to satisfy; [] only for derived work
  - Story 1.1: <summary>
    prd_section: "<heading or user-story line>"
    prd_anchor: "<linear issue identifier or null>"
    requirements: [R1]
    - Sub-task [<repo>]: <summary>
      prd_section: "<heading or AC bullet>"
      prd_anchor: "<linear issue identifier or null>"
      requirements: [R1]
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

The dry-run mode never writes to JIRA and never calls `mcp__atlassian__createJiraIssue`. It also never modifies the source Linear project, never adds/removes labels, never edits sub-issues, and never posts comments — that is the orchestrating skill's responsibility (`lisa-linear-prd-intake`).

## Hard Rule: All Writes Go Through `lisa-tracker-write`

**Every JIRA ticket created by this skill — every epic, story, and sub-task — MUST be created by invoking the `lisa-tracker-write` skill. Never call `mcp__atlassian__createJiraIssue`, `mcp__atlassian__editJiraIssue`, `mcp__atlassian__createIssueLink`, or any other Atlassian write tool directly from this skill or from any sub-agent it spawns.**

`lisa-tracker-write` enforces gates this skill does not:
- 3-audience description (Context / Technical Approach / Acceptance Criteria)
- Gherkin acceptance criteria
- Epic parent validation
- Explicit issue-link discovery (`blocks` / `is blocked by` / `relates to` / `duplicates` / `clones`)
- Single-repo scope check on Bug / Task / Sub-task / Improvement
- Sign-in account and target environment recorded in description
- Post-create verification

Bypassing `lisa-tracker-write` produces thin tickets that the rest of the lifecycle (triage, ticket-verify, journey, evidence) treats as broken. Atlassian reads in this skill are limited to the tools listed in `allowed-tools` (currently `getJiraIssueRemoteIssueLinks`) for the Phase 5.5 preservation gate. The Linear read tools listed in `allowed-tools` above are PRD-side only and never write.

## Source Requirement Section (shared format)

Every ticket created by this skill — epic, story, and sub-task alike —
carries a `## Source Requirement` section in its description so anyone can
answer "why was this done?" without leaving the ticket:

```markdown
## Source Requirement

- **PRD**: [<PRD title>](<PRD URL>) §"<section heading>"
- **Requirement (R3)**: "<verbatim requirement text from the PRD>"

This ticket exists to satisfy the quoted requirement. If implementation
scope drifts from the quoted text, the PRD is the authority — raise the
conflict rather than silently reinterpreting it.
```

Rules:

- **Verbatim quotes, never paraphrases.** The quote is what survives later
  PRD edits, and it must be readable by a non-technical operator.
- **Multiple requirements** → one `**Requirement (Rn)**` line each.
- **Derived / cross-cutting work** (no single requirement) uses the
  supporting form instead:
  `- **Requirement**: Derived work supporting R3, R7 — no single PRD section.`
- **All the way down**: sub-tasks carry full quotes, not just a pointer at
  the parent Story, so a leaf claimed by build-intake in isolation is
  self-explanatory.
- JIRA descriptions render the section as `h2. Source Requirement`;
  GitHub/Linear use the markdown heading. `lisa-tracker-write` and the
  validators treat the section as mandatory for PRD-sourced tickets.

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

Extract the trailing `<short-id>` (the alphanumeric segment after the last `-` in the slug). If only a workspace or team URL is provided (no `/project/<slug>-<id>` segment), stop and report — single-PRD mode requires a specific project. The caller wanted `lisa-linear-prd-intake` (batch mode).

## Configuration

This skill reads project configuration from `.lisa.config.json` (with `.lisa.config.local.json` overriding per key) and operational E2E test config from environment variables. See the `config-resolution` rule for the full schema.

### From `.lisa.config.json`

This skill is a **PRD source** (Linear); destination tracker resolution is handled by `lisa-tracker-write` and `lisa-tracker-validate` internally — this skill does NOT read `tracker` directly. The relevant config for the source side:

| Field | Purpose | Required when |
|-------|---------|---------------|
| `linear.workspace` | Linear workspace slug (used for URL synthesis on remote links) | always |

### From environment variables (E2E test config — operational, not tracker)

| Variable | Purpose | Example |
|----------|---------|---------|
| `E2E_TEST_PHONE` | Test user phone number for verification plans | `0000000099` |
| `E2E_TEST_OTP` | Test user OTP code | `555555` |
| `E2E_TEST_ORG` | Test organization name | `Arsenal` |
| `E2E_BASE_URL` | Frontend base URL for Playwright tests | `https://dev.example.io/` |
| `E2E_GRAPHQL_URL` | GraphQL API URL for curl verification | `https://gql.dev.example.io/graphql` |

If env vars are not available, ask the user to provide them explicitly before proceeding. Do not retrieve credentials from repository files or local agent settings.

## Workflow

### Phase 1: Fetch & Analyze the PRD

1. **Resolve the project** via `lisa-linear-access operation: get-project` with the slug or ID, including milestones and resources (`includeMilestones: true`, `includeResources: true`). Capture the project title, description, state, labels, lead, dates, attached documents, attached links.
2. **Fetch attached Linear documents** via `lisa-linear-access operation: list-documents({projectId})` then `lisa-linear-access operation: get-document` per result. Treat each as additional PRD content. (A Linear PRD with a single rich project description and no attached documents is the common case; multi-document PRDs are valid too.)
3. **Identify candidate epics and user stories** from project sub-issues via `lisa-linear-access operation: list-issues({project: <id>})`. Capture identifier, title, description, labels, state, parent issue, and `parentId` chain so the issue hierarchy is reproducible.
4. **Fetch full comments per sub-issue** via `lisa-linear-access operation: list-comments({issueId})` for every issue surfaced in step 3. Walk thread parents/children — comments are threaded via `parentId` references on the comment object.
5. **Synthesize decisions and blockers** from the project description + every document + every issue comment:
   - Decisions already confirmed by the team (look for agreement in comment threads)
   - Open questions that need product/engineering input
   - Engineering comments (prefixed with "Engineering:" or wrench emoji) that identify technical constraints
   - Cross-PRD dependencies (references to other Linear projects, documents, or shared infrastructure)

### Phase 1.4: Requirement Register (traceability)

Every ticket this skill creates must be able to answer "why was this done?"
by pointing at the PRD requirement it satisfies. Build that mapping now,
while parsing the PRD — it cannot be reliably reconstructed afterwards.

1. **Atomize the PRD into requirements** in document order: goals, user
   stories, functional and non-functional requirements, acceptance-criteria
   bullets, and important notes — across the project description, every
   attached document, and every sub-issue description. Use the same
   atomization `lisa-prd-ticket-coverage` uses so the two views line up.
2. **Assign sequential register ids** (`R1`, `R2`, …). Ids are
   per-generation, not durable — the **verbatim quote is the durable
   anchor**; if the PRD is edited and re-planned, ids may shift but quotes
   still identify the requirement.
3. **Record each entry** as `{ id, verbatim_text, section_heading }`,
   where `section_heading` is the markdown heading (or the sub-issue
   identifier) the requirement lives under — the same value used for
   `prd_anchor`.
4. **Tag every planned ticket** — epic, story, AND sub-task — with the
   register ids it exists to satisfy. All the way down: sub-tasks carry
   their own requirement quotes so a leaf dispatched in isolation is
   self-explanatory. A ticket that genuinely traces to no single
   requirement (cross-cutting infrastructure, derived enablement work)
   gets `requirements: []` and must say which requirements it *supports*
   in its Source Requirement section instead.

The register feeds three consumers: the `## Source Requirement` section on
every created ticket (Phases 3–5), the dry-run report (above), and the
requirement tokens in the PRD back-link (Phase 7).

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

2. **Classify each artifact and apply taxonomy rules** by invoking the `lisa-tracker-source-artifacts` skill. That skill is the single source of truth for: domains (`ui-design` / `ux-flow` / `data` / `ops` / `reference`), per-tool classification rules (Figma `/proto/` vs design, Lovable as `ux-flow`, Loom, screenshots), and coverage smells. Do not restate the rules here — invoke the skill so any drift in the rules propagates uniformly.

3. **Build an `artifacts` map** keyed by domain. Each entry: `{ url, title, domain, source_page, source_page_url, classification_reason }`. The `classification_reason` makes disambiguation auditable. The `source_page` lets you trace each reference back to where it appeared (project description vs a specific document title vs a specific sub-issue comment).

4. **Surface coverage smells** as defined in `lisa-tracker-source-artifacts` §5. Record any detected smells on the epic.

### Phase 1.6: Source Precedence & Conflict Resolution

Source precedence rules and cross-axis conflict handling are defined in `lisa-tracker-source-artifacts` §3 and §4. Apply them during ticket synthesis: every conflict between artifacts must be recorded under `## Open Questions` on the affected ticket, never silently reconciled.

The existing-component reuse expectation is defined in `lisa-tracker-source-artifacts` §7. Encode it on every UI-touching story.

### Phase 2: Codebase + Live Product Research

Identical to `lisa-notion-to-tracker` Phase 2 and `lisa-confluence-to-tracker` Phase 2. Two complementary inputs ground PRD analysis: the **code** (what's there to reuse / extend) and the **live product** (what users see today). Skipping either produces tickets that misjudge the change.

**2a. Codebase research.** If the session doesn't already have codebase context, explore the repos to understand what exists. Use Explore agents for repos not yet examined.

**2b. Live product walkthrough.** If the PRD touches existing user-facing surfaces, invoke the `lisa-product-walkthrough` skill against `E2E_BASE_URL` using the test user from config.

Skip 2b only when the work is purely backend with no user-visible surface, or affects a screen that does not yet exist in dev/prod.

Walkthrough findings are surfaced back to product via the orchestrating intake skill (`lisa-linear-prd-intake`), which posts them on the project's sentinel feedback issue. This skill itself does NOT post to Linear — it only reads. The walkthrough section is also inherited onto the resulting epic / stories under a `## Current Product` subsection in the JIRA description.

### Phase 3: Create Epics

> **Mode guard**: In `dry_run: true` mode, do not invoke `lisa-tracker-write` in this phase. Instead, draft the epic spec (summary, description_body, artifacts) and validate it with `lisa-tracker-validate --spec-only`. Record the drafted spec (including a placeholder epic key like `DRY-RUN-EPIC-1`) for Phase 4 to use as parent references. In `dry_run: false` mode (default), proceed as described below.

For each epic identified in Phase 1, **invoke the `lisa-tracker-write` skill** (do not call `createJiraIssue` directly). Pass it everything it needs to enforce its quality gates:

- `project_key`: resolved by `lisa-tracker-write` from `.lisa.config.json`
- `issue_type`: `Epic`
- `prd_source`: the originating PRD URL — mandatory for every ticket this skill creates; it arms the validator's S16 traceability gate
- `summary`: epic title from the PRD
- `description_body`: a draft of the 3-audience description containing:
  - A **Source Requirement** section (see the shared format above) citing the Linear project URL, section heading, and the verbatim text of every register requirement (`R-id`) this epic exists to satisfy
  - **Context / Business Value**: epic summary from the PRD, originating Linear project URL, business outcome
  - **Technical Approach**: cross-cutting integration points and constraints surfaced in Phase 2 codebase research
  - List of user stories the epic contains
  - Key decisions from comments (with attribution)
  - Blockers and open questions
  - Dependencies on other epics or PRDs
  - A **Source Artifacts** section listing every artifact extracted in Phase 1.5 (grouped by domain)
- `artifacts`: the full Phase 1.5 artifact list — every artifact, regardless of domain. The epic is the canonical hub. No filtering at the epic level.
- `priority`, `labels`, `components`, `fix_version`: as appropriate

**Leaf-only build-ready (`leaf-only-lifecycle`)**: an Epic is a container, not a leaf work unit. Do NOT mark it build-ready — `lisa-tracker-write` must not be passed `status:ready` for an Epic, and the Epic's lifecycle state rolls up from its children. The build-ready label is applied only in Phase 5.

Capture the returned epic key — Phase 4 needs it as the parent for stories.

### Phase 4: Create Stories

> **Mode guard**: In `dry_run: true` mode, do not invoke `lisa-tracker-write` in this phase. Instead, draft each story spec and validate it with `lisa-tracker-validate --spec-only`. Use placeholder keys (e.g. `DRY-RUN-STORY-1.1`) for any downstream references. In `dry_run: false` mode (default), proceed as described below.

For each Epic, plan two kinds of stories:
- **One "X.0 Setup" story** for data model and infrastructure prerequisites
- **One story per user story** from the PRD (numbered to match the PRD's structure or the source Linear sub-issues)

**Story naming convention**: Prefix the summary with a short code derived from the PRD title (e.g., `[CU-1.1]` for "Contract Upload").

For each story, **invoke `lisa-tracker-write`** with:

- `project_key`: resolved by `lisa-tracker-write` from `.lisa.config.json`
- `issue_type`: `Story`
- `prd_source`: the originating PRD URL — mandatory for every ticket this skill creates; it arms the validator's S16 traceability gate
- `epic_parent`: the Epic key captured in Phase 3 (mandatory)
- `summary`: prefixed per the naming convention above
- `description_body`: 3-audience description as in `lisa-notion-to-tracker` Phase 4, including as its first element a **Source Requirement** section (shared format above) quoting the register requirement(s) this story satisfies
- `artifacts`: the Phase 1.5 artifacts filtered by domain per the inheritance table below

| Story type | Inherits domains |
|------------|------------------|
| Frontend / UI | `ui-design`, `ux-flow`, `reference` |
| Backend / API / data model | `data`, `reference` |
| Infrastructure | `ops`, `reference` |
| Mixed / setup ("X.0") | All domains |

**Leaf-only build-ready (`leaf-only-lifecycle`)**: a Story is a container (it has child Sub-tasks), not a leaf work unit. Do NOT mark it build-ready — never pass `status:ready` to `lisa-tracker-write` for a Story. Its lifecycle state rolls up from its Sub-tasks. The build-ready label is applied only in Phase 5.

Capture each returned story key — Phase 5 needs it as the parent for sub-tasks.

### Phase 5: Create Sub-tasks

**Auto-split cross-repo work before delegation.** For each candidate sub-task, apply `lisa-task-decomposition` step 1.5: if the work touches more than one repo, split it into one sub-task per repo under the same parent Story (e.g., `[backend-api] Add field` + `[mobile-app] Display field`), and encode the producer-before-consumer ordering via dependencies. Work units that may span repos (Epic, Story, Spike) stay as planned; work units that must be single-repo (Bug, Task, Sub-task, Improvement) are split now. Splitting is this skill's responsibility — the validator's S10 gate is `product_relevant: false` because cross-repo failures are decomposition errors caught here, not product questions sent back to the PRD.

**S10 hard gate repair loop.** Dry-run validation is not advisory. Before any Phase 5 write, every planned leaf spec MUST pass `lisa-tracker-validate --spec-only` for S10 Single-repo scope. If any Bug / Task / Sub-task / Improvement fails S10 (missing `Repository`, more than one repo, or cross-repo AC), stop the write path, auto-split or restamp the spec using `lisa-task-decomposition` step 1.5, add the repo bracket and `## Repository` / `h2. Repository` section, then re-run `lisa-tracker-validate --spec-only`. If S10 still fails after repair, abort the ticket write and record an internal Error in the dry-run report; do not create the ticket, do not bypass with direct vendor writes, and do not surface the `product_relevant: false` failure as a product clarification.

Delegate sub-task creation to **parallel agents** (one per epic or batch of stories) for efficiency. **Every spawned agent must invoke `lisa-tracker-write` for each sub-task — no agent may call `createJiraIssue` directly.**

Each sub-task MUST:
1. **Be scoped to exactly ONE repo** — indicated in brackets in the summary: `[repo-name]` and in the description's `## Repository` / `h2. Repository` section
2. **Include an Empirical Verification Plan** — real user-like verification, NOT unit tests, linting, or typechecking
3. **Carry its own `## Source Requirement` section** (shared format above) with the full verbatim quote(s) from the Phase 1.4 register — a leaf claimed by build-intake in isolation must be self-explanatory. When a sub-task is split per-repo, every split child inherits the same requirement quote(s).

**Leaf-only build-ready (`leaf-only-lifecycle`)**: Sub-tasks are the **leaf work units** of the decomposition — they are the ONLY items in the hierarchy that receive the build-ready label. `lisa-tracker-write` applies `status:ready` here so downstream build intake (`lisa-tracker-build-intake`) claims the leaves and never the Epic or Stories. Apply `status:ready` to each Sub-task; never to its parent Story or Epic (Phases 3–4). `lisa-tracker-write` enforces the same invariant on the write side, so a Sub-task split into per-repo children (the cross-repo case above) carries build-ready on the children, not on any intermediate parent that gains child work.

Sub-tasks inherit their parent story's artifacts by reference (the parent link). Do not pass the same artifact list to every sub-task.

### Phase 5.5: Artifact Preservation Gate (mandatory)

Run the preservation gate defined in `lisa-tracker-source-artifacts` §8 against the artifacts extracted in Phase 1.5 and the tickets just created. Do NOT restate or modify the gate logic here — invoke the rules from `lisa-tracker-source-artifacts`.

To run the gate, this skill must:

1. Pull the remote links of every epic and story created in this run via `lisa-tracker-read (vendor-neutral; dispatches to jira-read-ticket or github-read-issue)`.
2. Apply the §8 preservation matrix and verdict rules.
3. If the gate fails: list each dropped/misrouted artifact and either re-attach via `lisa-tracker-write` (UPDATE mode) or stop and ask the human.
4. If the gate passes: print the matrix compactly and proceed to Phase 6.

This gate is not optional.

### Phase 6: Report Results

After all tickets are created, present a summary table to the user:
- All Epics with keys and URLs
- All Stories grouped by Epic
- All Sub-tasks grouped by Story with repo tags
- **Requirement coverage** — one row per Phase 1.4 register entry (`R-id`, quote excerpt, tickets that declare it); requirements with zero tickets are a gap to resolve before reporting success
- Repo distribution
- **Artifact Preservation Matrix**
- Blockers list with recommendations and alternatives
- Cross-PRD dependencies

### Phase 7: PRD Back-link

> **Mode guard**: In `dry_run: true` mode, skip this phase entirely — no tickets exist to link.

After Phase 6, invoke the `lisa-prd-backlink` skill to write a `## Tickets` section back into the source Linear project (or its description). The section becomes the canonical anchor for the **Debrief** flow once the initiative ships.

Invoke `lisa-prd-backlink` with:

- `source_type: "linear"`
- `source_ref`: the original Linear project URL
- `tickets`: the full list created in Phases 3–5, each entry as `{ key, title, type, url, parent_key, requirements }` — `requirements` is the list of Phase 1.4 register ids the ticket satisfies (empty for derived work)
- `requirement_register`: the Phase 1.4 register (`{ id, verbatim_text, section_heading }` entries), so the back-link section can render the requirement → tickets view

If `lisa-prd-backlink` fails (permission denied, Linear unreachable), surface the error in the Phase 6 report rather than aborting — the tickets are already created. Recommend the user re-run `lisa-prd-backlink` standalone once the source is reachable.

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

CRITICAL: For each sub-task, invoke the `lisa-tracker-write` skill via the Skill tool.
Do NOT call `mcp__atlassian__createJiraIssue` directly. The `lisa-tracker-write` skill
enforces required quality gates (Gherkin acceptance criteria, 3-audience description,
single-repo scope, sign-in/environment fields, post-create verification). Bypassing it
produces broken tickets that downstream skills (triage, journey, evidence) cannot use.

For each sub-task, invoke `lisa-tracker-write` with:
- issue_type: "Sub-task"
- prd_source: [the originating PRD URL — mandatory; arms the S16 traceability gate]
- parent: the parent story key
- project_key: [PROJECT]
- summary: prefixed with the repo in brackets, e.g. "[backend-api] Add audit log table"
- description_body: a 3-section draft (Context / Technical Approach / Acceptance Criteria) plus `h2. Repository` naming exactly one repo, plus `h2. Source Requirement` quoting the PRD requirement(s) this sub-task satisfies VERBATIM with the PRD link and register id(s) — [paste the exact requirement text and R-ids for each sub-task from the requirement register; do not let the agent paraphrase]
- gherkin_acceptance_criteria: derived from the story's functional requirements
- sign_in_account: [test user credentials from config — name + role + how to obtain]
- target_environment: "dev"
- empirical_verification_plan: real user-like verification (curl + auth token,
  Playwright browser flow, CLI check after deploy) using the test credentials.
  NOT unit tests, linting, or typechecking.

Each sub-task must:
1. Be scoped to ONE repo only — repo named in brackets in the summary and in `h2. Repository`
2. Include the Empirical Verification Plan in the description
3. Be created via `lisa-tracker-write`, not via direct MCP calls

If `lisa-tracker-write` rejects a sub-task, fix the input and re-invoke. Do NOT fall back
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
- **No project-level comments via MCP**: clarifying-question comments cannot land directly on the project itself. The orchestrating skill (`lisa-linear-prd-intake`) handles this by maintaining a sentinel feedback issue under the project. This skill does not write to Linear at all — it only reads.
- **Issue identifiers** (`LIN-123`, `ENG-456`, etc.) are the closest analog to a Confluence inline-comment anchor. When dry-run output sets `prd_anchor` to an issue identifier, the caller knows it can post a clarifying-question comment on that specific issue if it wants block-level anchoring.
