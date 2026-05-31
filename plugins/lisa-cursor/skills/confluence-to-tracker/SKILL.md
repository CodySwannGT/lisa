---
name: confluence-to-tracker
description: >
  Break down a Confluence PRD page into Epics, Stories, and Sub-tasks in the configured destination tracker (JIRA, GitHub Issues, or Linear per .lisa.config.json). Use this skill whenever the
  user shares a Confluence PRD URL and wants it converted into tracker tickets, or asks to "break down
  this Confluence spec", "create tickets from a Confluence page", "turn this Confluence doc into tickets",
  or similar. This skill mirrors `lisa:notion-to-tracker` for projects whose PRDs live in Confluence —
  the workflow, gates, dry-run mode, and validation rules are identical; only the source-of-truth tool
  surface differs (Confluence MCP instead of Notion MCP).
allowed-tools: ["Skill", "Bash"]
---

# Confluence PRD to Tracker Breakdown

All Atlassian operations in this skill go through `lisa:atlassian-access`. Do not call MCP tools or `acli` directly.

Convert a Confluence PRD into a structured ticket hierarchy in the configured destination tracker (JIRA, GitHub Issues, or Linear per .lisa.config.json): Epics > Stories > Sub-tasks.
Each sub-task is scoped to exactly one repo and includes an empirical verification plan.

This skill is the Confluence counterpart of `lisa:notion-to-tracker`. The two skills share the same
phases, gates, dry-run contract, and per-ticket validation logic. Only the PRD-side fetch / comment
tools differ. When changing workflow logic, change BOTH skills together so the two source vendors
stay behaviorally identical.

## Modes

This skill supports two modes, controlled by a `dry_run` flag in `$ARGUMENTS`:

- **`dry_run: false`** (default — full mode): run all phases, write tickets via `lisa:tracker-write`, run the preservation gate, report.
- **`dry_run: true`** (planning + validation only — no writes): run Phases 1, 1.5, 1.6, 2, 3, 4 to plan the hierarchy and draft each ticket spec, then call `lisa:tracker-validate` (with `--spec-only`) on every drafted ticket. Aggregate the per-ticket validator reports into a single dry-run report. **Skip Phase 5 (sub-task creation), Phase 5.5 (preservation gate), and Phase 6 (results report)** — none of those make sense without writes. Return the dry-run report so the caller (e.g. `lisa:confluence-prd-intake`) can decide whether to proceed.

Dry-run output format is identical to `lisa:notion-to-tracker`'s. Reuse the same fields, including
`prd_anchor` and `prd_section`. The only difference: `prd_anchor` is the inline-comment anchor text
that `lisa:atlassian-access` `operation: comment-page kind: inline` accepts (typically the full
selected substring; truncate if it exceeds the substrate's max anchor length and emit `null` if no
resolvable anchor exists).

```text
## confluence-to-tracker dry-run: <PRD title>

### Planned hierarchy
- Epic: <summary>
  prd_section: "<heading text from the PRD that produced this epic>"
  prd_anchor: "<inline-comment anchor text>"   # null if no specific section
  - Story 1.1: <summary>
    prd_section: "<heading or user-story line>"
    prd_anchor: "<anchor>"
    - Sub-task [<repo>]: <summary>
      prd_section: "<heading or AC bullet>"
      prd_anchor: "<anchor>"
    - ...
  - Story 1.2: ...

### Per-ticket validation
- <ticket-id>: PASS | FAIL — <count> failures
  prd_section: "<heading text>"
  prd_anchor: "<anchor>"
  failures:
    - gate: <gate-id>
      category: <category from validator>
      product_relevant: <true|false>
      what: <plain-language description from validator>
      recommendation: <1–3 candidate resolutions from validator>

### Verdict: PASS | FAIL
### Total failures: <n>
```

The dry-run mode never writes to the destination tracker. It also never modifies the source Confluence
page, never re-parents the PRD between lifecycle parents, and never posts comments — that is the
orchestrating skill's responsibility (`lisa:confluence-prd-intake`).

## PRD lifecycle is parent-page-based on Confluence

Unlike GitHub and Linear (which use labels for PRD lifecycle state), Confluence encodes PRD lifecycle as **parent-page placement**: each lifecycle role (`draft`, `ready`, `in_review`, `blocked`, `ticketed`, `shipped`) corresponds to a dedicated parent page in the project's Confluence space, listed in `.lisa.config.json` under `confluence.parents.<role>`. A PRD's current state is determined by which of those parents it sits under; a "transition" is a `PUT /wiki/api/v2/pages/{id}` that swaps `parentId`.

This skill itself does NOT transition the PRD between lifecycle parents — that is the orchestrating skill's job (`lisa:confluence-prd-intake`). This skill consumes the PRD content and produces tickets; lifecycle state changes (`ready` → `in_review`, `in_review` → `ticketed` / `blocked`) happen in the orchestrator, before and after this skill runs.

Why parent-page-based, not label-based: scoped Atlassian API tokens cannot write Confluence labels via the v1 endpoint, and the v2 Label API group has no POST endpoint at all. Parent-id transitions, by contrast, are first-class in v2 and work with `write:page:confluence` scope. See `config-resolution` rule, section "Confluence PRD lifecycle uses parent pages, not labels," for the full rationale.

## Hard Rule: All Writes Go Through `lisa:tracker-write`

**Every ticket created by this skill — every epic, story, and sub-task — MUST be created by invoking the `lisa:tracker-write` skill. Never invoke `lisa:atlassian-access` write operations (`write-ticket`, `link`, `comment`, `transition`) directly from this skill or from any sub-agent it spawns.**

`lisa:tracker-write` enforces gates this skill does not:
- 3-audience description (Context / Technical Approach / Acceptance Criteria)
- Gherkin acceptance criteria
- Epic parent validation
- Explicit issue-link discovery (`blocks` / `is blocked by` / `relates to` / `duplicates` / `clones`)
- Single-repo scope check on Bug / Task / Sub-task / Improvement
- Sign-in account and target environment recorded in description
- Post-create verification

Bypassing `lisa:tracker-write` produces thin tickets that the rest of the lifecycle (triage, ticket-verify, journey, evidence) treats as broken. Read operations on Atlassian (ticket reads, JQL search, Confluence page reads, comment fetches) are still performed in this skill — but ONLY via `lisa:atlassian-access` (`operation: read-ticket | search-issues | read-page | search-pages | list-sites`), never via direct MCP tool calls or `acli`.

## Input

A Confluence PRD page URL or page ID. The PRD is expected to have:
- A main page with context, problems, and child pages for each Epic
- Epic child pages with User Stories and functional/non-functional requirements
- Page comments (footer + inline) with engineering notes and product decisions

URL parsing — Confluence URLs come in two common shapes:

```text
https://<host>/wiki/spaces/<SPACE>/pages/<PAGE-ID>/<slug>
https://<host>/wiki/spaces/<SPACE>/pages/<PAGE-ID>
```

Extract `<PAGE-ID>` (the numeric segment after `/pages/`). If only a space URL is provided
(`/wiki/spaces/<SPACE>` with no `/pages/...`), stop and report — single-PRD mode requires a specific
page. The caller wanted `lisa:confluence-prd-intake` (batch mode).

## Configuration

This skill reads project configuration from `.lisa.config.json` (with `.lisa.config.local.json` overriding per key) and operational E2E test config from environment variables. See the `config-resolution` rule for the full schema.

### From `.lisa.config.json`

This skill is a **PRD source** (Confluence); destination tracker resolution is handled by `lisa:tracker-write` and `lisa:tracker-validate` internally — this skill does NOT read `tracker` directly. The relevant config for the source side:

| Field | Purpose | Required when |
|-------|---------|---------------|
| `atlassian.cloudId` | Atlassian Cloud site UUID for Confluence MCP calls | always |
| `confluence.spaceKey` | Confluence space hosting PRDs | invoked without an explicit page URL (batch / arg-less mode) and `confluence.parentPageId` is unset |
| `confluence.parentPageId` | Confluence parent page under which PRDs live | invoked without an explicit page URL (batch / arg-less mode) and `confluence.spaceKey` is unset |

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

1. **Confirm the configured Atlassian site** by invoking `lisa:atlassian-access` `operation: list-sites` (it enforces connection match against `.lisa.config.json`).
2. **Fetch the main PRD page** by invoking `lisa:atlassian-access` `operation: read-page id: <PAGE-ID>`. Capture body, parent page id (used by `lisa:confluence-prd-intake` to determine the PRD's lifecycle state — see "PRD lifecycle is parent-page-based" below), and child page references.
3. **Identify all Epic child pages** by invoking `lisa:atlassian-access` `operation: read-page-descendants id: <PAGE-ID>` (one level deep first; recurse if the PRD nests epics under a "Specs" parent). If `atlassian-access` does not yet expose `read-page-descendants`, request its addition (see report at bottom).
4. **Fetch all Epic pages** in parallel via `lisa:atlassian-access` `operation: read-page id: <EPIC-PAGE-ID>`.
5. **Fetch full comments** for the main page and every epic page in parallel via `lisa:atlassian-access`:
   - `operation: read-page-comments id: <PAGE-ID> kind: footer` — page-level threaded comments (equivalent to Notion's page-level discussions)
   - `operation: read-page-comments id: <PAGE-ID> kind: inline` — block-anchored comments tied to specific text spans
   - For any comment with replies, walk the tree via `operation: read-comment-children id: <COMMENT-ID>` until exhausted
   (If any of these read-comment operations is not yet in `atlassian-access`'s dispatch table, request their addition — they are intentionally listed here so the access skill can be extended.)
6. **Synthesize decisions and blockers** from the PRD content + all comments:
   - Decisions already confirmed by the team (look for agreement in comment threads)
   - Open questions that need product/engineering input
   - Engineering comments (prefixed with "Engineering:" or wrench emoji) that identify technical constraints
   - Cross-PRD dependencies (references to other features or shared infrastructure)

### Phase 1.5: Extract Source Artifacts

PRDs typically reference external design, UX, and data artifacts (Figma files, Lovable prototypes, Loom walkthroughs, screenshots, example payloads, peer Confluence pages). These MUST be preserved onto the resulting tickets — otherwise developers picking up a ticket lose the source of truth. This is the failure mode this step exists to prevent.

1. **Scan the PRD main page, all Epic child pages, and every fetched comment thread** for:
   - URLs to design/prototype tools (Figma, FigJam, Figma Make, Lovable, Framer, Penpot)
   - URLs to recording/walkthrough tools (Loom, YouTube, Vimeo, Descript)
   - URLs to collaborative docs (Google Docs/Slides/Sheets, peer Confluence pages, Notion peer pages)
   - URLs to code sandboxes (CodeSandbox, StackBlitz, Replit, GitHub permalinks/gists)
   - URLs to diagramming tools (Miro, Mural, Excalidraw, Mermaid Live, draw.io, Lucid)
   - URLs to data/observability tools (Grafana, Datadog, Sentry, Metabase, Looker)
   - Embedded images and file attachments on the page itself
   - Fenced code blocks with example data (JSON, SQL, GraphQL, cURL request/response)

2. **Classify each artifact and apply taxonomy rules** by invoking the `lisa:tracker-source-artifacts` skill. That skill is the single source of truth for: domains (`ui-design` / `ux-flow` / `data` / `ops` / `reference`), per-tool classification rules (Figma `/proto/` vs design, Lovable as `ux-flow`, Loom, screenshots), and coverage smells. Do not restate the rules here — invoke the skill so any drift in the rules propagates uniformly.

3. **Build an `artifacts` map** keyed by domain. Each entry: `{ url, title, domain, source_page, source_page_url, classification_reason }`. The `classification_reason` makes disambiguation auditable. The `source_page` lets you trace each reference back to where it appeared in the PRD.

4. **Surface coverage smells** as defined in `lisa:tracker-source-artifacts` §5. Record any detected smells on the epic.

### Phase 1.6: Source Precedence & Conflict Resolution

Source precedence rules and cross-axis conflict handling are defined in `lisa:tracker-source-artifacts` §3 and §4. Apply them during ticket synthesis: every conflict between artifacts must be recorded under `## Open Questions` on the affected ticket, never silently reconciled.

The existing-component reuse expectation is defined in `lisa:tracker-source-artifacts` §7. Encode it on every UI-touching story.

### Phase 2: Codebase + Live Product Research

Identical to `lisa:notion-to-tracker` Phase 2. Two complementary inputs ground PRD analysis: the **code** (what's there to reuse / extend) and the **live product** (what users see today). Skipping either produces tickets that misjudge the change.

**2a. Codebase research.** If the session doesn't already have codebase context, explore the repos to understand what exists. Use Explore agents for repos not yet examined.

**2b. Live product walkthrough.** If the PRD touches existing user-facing surfaces, invoke the `lisa:product-walkthrough` skill against `E2E_BASE_URL` using the test user from config.

Skip 2b only when the work is purely backend with no user-visible surface, or affects a screen that does not yet exist in dev/prod.

Walkthrough findings are attached to the originating Confluence PRD as a **footer comment** (Confluence has no general "page-level discussion attached to a heading" — footer comments are the page-level equivalent), via `lisa:atlassian-access` `operation: comment-page id: <PAGE-ID> kind: footer body: "..."`. Title the comment "Current product walkthrough — `<route>`". Inherited onto the resulting epic / stories under a `## Current Product` subsection.

### Phase 3: Create Epics

> **Mode guard**: In `dry_run: true` mode, do not invoke `lisa:tracker-write` in this phase. Instead, draft the epic spec (summary, description_body, artifacts) and validate it with `lisa:tracker-validate --spec-only`. Record the drafted spec (including a placeholder epic key like `DRY-RUN-EPIC-1`) for Phase 4 to use as parent references. In `dry_run: false` mode (default), proceed as described below.

For each PRD epic, **invoke the `lisa:tracker-write` skill** (do not invoke `lisa:atlassian-access` write operations directly). Pass it everything it needs to enforce its quality gates:

- `project_key`: resolved by `lisa:tracker-write` from `.lisa.config.json`
- `issue_type`: `Epic`
- `summary`: epic title from the PRD
- `description_body`: a draft of the 3-audience description containing:
  - **Context / Business Value**: epic summary from the PRD, originating Confluence URL, business outcome
  - **Technical Approach**: cross-cutting integration points and constraints surfaced in Phase 2 codebase research
  - List of user stories the epic contains
  - Key decisions from comments (with attribution)
  - Blockers and open questions
  - Dependencies on other epics or PRDs
  - A **Source Artifacts** section listing every artifact extracted in Phase 1.5 (grouped by domain)
- `artifacts`: the full Phase 1.5 artifact list — every artifact, regardless of domain. The epic is the canonical hub. No filtering at the epic level.
- `priority`, `labels`, `components`, `fix_version`: as appropriate

**Leaf-only build-ready (`leaf-only-lifecycle`)**: an Epic is a container, not a leaf work unit. Do NOT mark it build-ready — `lisa:tracker-write` must not be passed `status:ready` for an Epic, and the Epic's lifecycle state rolls up from its children. The build-ready label is applied only in Phase 5.

Capture the returned epic key — Phase 4 needs it as the parent for stories.

### Phase 4: Create Stories

> **Mode guard**: In `dry_run: true` mode, do not invoke `lisa:tracker-write` in this phase. Instead, draft each story spec and validate it with `lisa:tracker-validate --spec-only`. Use placeholder keys (e.g. `DRY-RUN-STORY-1.1`) for any downstream references. In `dry_run: false` mode (default), proceed as described below.

For each Epic, plan two kinds of stories:
- **One "X.0 Setup" story** for data model and infrastructure prerequisites
- **One story per user story** from the PRD (numbered to match the PRD)

**Story naming convention**: Prefix the summary with a short code derived from the PRD title (e.g., `[CU-1.1]` for "Contract Upload").

For each story, **invoke `lisa:tracker-write`** with:

- `project_key`: resolved by `lisa:tracker-write` from `.lisa.config.json`
- `issue_type`: `Story`
- `epic_parent`: the Epic key captured in Phase 3 (mandatory)
- `summary`: prefixed per the naming convention above
- `description_body`: 3-audience description as in `lisa:notion-to-tracker` Phase 4
- `artifacts`: the Phase 1.5 artifacts filtered by domain per the inheritance table below

| Story type | Inherits domains |
|------------|------------------|
| Frontend / UI | `ui-design`, `ux-flow`, `reference` |
| Backend / API / data model | `data`, `reference` |
| Infrastructure | `ops`, `reference` |
| Mixed / setup ("X.0") | All domains |

**Leaf-only build-ready (`leaf-only-lifecycle`)**: a Story is a container (it has child Sub-tasks), not a leaf work unit. Do NOT mark it build-ready — never pass `status:ready` to `lisa:tracker-write` for a Story. Its lifecycle state rolls up from its Sub-tasks. The build-ready label is applied only in Phase 5.

Capture each returned story key — Phase 5 needs it as the parent for sub-tasks.

### Phase 5: Create Sub-tasks

**Auto-split cross-repo work before delegation.** For each candidate sub-task, apply `lisa:task-decomposition` step 1.5: if the work touches more than one repo, split it into one sub-task per repo under the same parent Story (e.g., `[backend-api] Add field` + `[mobile-app] Display field`), and encode the producer-before-consumer ordering via dependencies. Work units that may span repos (Epic, Story, Spike) stay as planned; work units that must be single-repo (Bug, Task, Sub-task, Improvement) are split now. Splitting is this skill's responsibility — the validator's S10 gate is `product_relevant: false` because cross-repo failures are decomposition errors caught here, not product questions sent back to the PRD.

**S10 hard gate repair loop.** Dry-run validation is not advisory. Before any Phase 5 write, every planned leaf spec MUST pass `lisa:tracker-validate --spec-only` for S10 Single-repo scope. If any Bug / Task / Sub-task / Improvement fails S10 (missing `Repository`, more than one repo, or cross-repo AC), stop the write path, auto-split or restamp the spec using `lisa:task-decomposition` step 1.5, add the repo bracket and `## Repository` / `h2. Repository` section, then re-run `lisa:tracker-validate --spec-only`. If S10 still fails after repair, abort the ticket write and record an internal Error in the dry-run report; do not create the ticket, do not bypass with direct vendor writes, and do not surface the `product_relevant: false` failure as a product clarification.

Delegate sub-task creation to **parallel agents** (one per epic or batch of stories) for efficiency. **Every spawned agent must invoke `lisa:tracker-write` for each sub-task — no agent may invoke `lisa:atlassian-access` write operations directly.**

Each sub-task MUST:
1. **Be scoped to exactly ONE repo** — indicated in brackets in the summary: `[repo-name]` and in the description's `## Repository` / `h2. Repository` section
2. **Include an Empirical Verification Plan** — real user-like verification, NOT unit tests, linting, or typechecking

**Leaf-only build-ready (`leaf-only-lifecycle`)**: Sub-tasks are the **leaf work units** of the decomposition — they are the ONLY items in the hierarchy that receive the build-ready label. `lisa:tracker-write` applies `status:ready` here so downstream build intake (`lisa:tracker-build-intake`) claims the leaves and never the Epic or Stories. Apply `status:ready` to each Sub-task; never to its parent Story or Epic (Phases 3–4). `lisa:tracker-write` enforces the same invariant on the write side, so a Sub-task split into per-repo children (the cross-repo case above) carries build-ready on the children, not on any intermediate parent that gains child work.

Sub-tasks inherit their parent story's artifacts by reference (the parent link). Do not pass the same artifact list to every sub-task.

### Phase 5.5: Artifact Preservation Gate (mandatory)

Run the preservation gate defined in `lisa:tracker-source-artifacts` §8 against the artifacts extracted in Phase 1.5 and the tickets just created. Do NOT restate or modify the gate logic here — invoke the rules from `lisa:tracker-source-artifacts`.

To run the gate, this skill must:

1. Pull the remote links of every epic and story created in this run via `lisa:tracker-read (vendor-neutral; dispatches to jira-read-ticket or github-read-issue)`.
2. Apply the §8 preservation matrix and verdict rules.
3. If the gate fails: list each dropped/misrouted artifact and either re-attach via `lisa:tracker-write` (UPDATE mode) or stop and ask the human.
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

### Phase 7: PRD Back-link

> **Mode guard**: In `dry_run: true` mode, skip this phase entirely — no tickets exist to link.

After Phase 6, invoke the `lisa:prd-backlink` skill to write a `## Tickets` section back into the source Confluence PRD page. The section becomes the canonical anchor for the **Debrief** flow once the initiative ships.

Invoke `lisa:prd-backlink` with:

- `source_type: "confluence"`
- `source_ref`: the original Confluence page URL
- `tickets`: the full list created in Phases 3–5, each entry as `{ key, title, type, url, parent_key }`

If `lisa:prd-backlink` fails (page permission denied, Confluence unreachable), surface the error in the Phase 6 report rather than aborting — the tickets are already created. Recommend the user re-run `lisa:prd-backlink` standalone once the source is reachable.

## Handling Ambiguities and Blockers

When you encounter something the PRD + comments + codebase can't resolve:

1. **Don't guess** — mark the ticket with a BLOCKER section
2. **Include your recommendation** with rationale
3. **List 2-3 alternatives** so the user/product can choose
4. **State what's needed to unblock**

## Agent Prompt Template for Sub-task Creation

When delegating to agents, provide this context. **The "MUST invoke lisa:tracker-write" instruction is load-bearing — do not edit it out when adapting this template.**

```text
Create sub-tasks in the [PROJECT] project.

CRITICAL: For each sub-task, invoke the `lisa:tracker-write` skill via the Skill tool.
Do NOT invoke `lisa:atlassian-access` write operations (write-ticket / link / comment /
transition) directly. The `lisa:tracker-write` skill enforces required quality gates
(Gherkin acceptance criteria, 3-audience description, single-repo scope,
sign-in/environment fields, post-create verification). Bypassing it produces broken
tickets that downstream skills (triage, journey, evidence) cannot use.

For each sub-task, invoke `lisa:tracker-write` with:
- issue_type: "Sub-task"
- parent: the parent story key
- project_key: [PROJECT]
- summary: prefixed with the repo in brackets, e.g. "[backend-api] Add audit log table"
- description_body: a 3-section draft (Context / Technical Approach / Acceptance Criteria) plus `h2. Repository` naming exactly one repo
- gherkin_acceptance_criteria: derived from the story's functional requirements
- sign_in_account: [test user credentials from config — name + role + how to obtain]
- target_environment: "dev"
- empirical_verification_plan: real user-like verification (curl + auth token,
  Playwright browser flow, CLI check after deploy) using the test credentials.
  NOT unit tests, linting, or typechecking.

Each sub-task must:
1. Be scoped to ONE repo only — repo named in brackets in the summary and in `h2. Repository`
2. Include the Empirical Verification Plan in the description
3. Be created via `lisa:tracker-write`, not via direct `lisa:atlassian-access` write operations

If `lisa:tracker-write` rejects a sub-task, fix the input and re-invoke. Do NOT fall back
to a direct `lisa:atlassian-access` `operation: write-ticket` call to bypass the gate.

Test user info: [credentials from config]

[Then list all sub-tasks grouped by parent story with details]
```

## Cross-PRD Shared Infrastructure

Track tickets that are shared across PRDs to avoid duplication. When a sub-task overlaps with an existing ticket, reference it instead of creating a duplicate. Search JIRA for existing tickets in the project before creating new ones for shared infrastructure.

## Confluence-specific notes

- **Page bodies** come back from `getConfluencePage` as either Atlassian Document Format (ADF / storage format) or rendered HTML depending on flags. Treat headings (`<h1>`–`<h3>`) as section markers for `prd_section`. For ADF, walk the document tree.
- **Inline comment anchors**: `prd_anchor` is the inline-comment selection text (the exact substring `createConfluenceInlineComment` will match). If the section is too long for an inline anchor (Confluence has a practical upper bound on selection length), pick the first sentence of the section. If the section has no stable anchor (e.g., a generated table cell), set `prd_anchor: null` and the caller will fall back to a footer comment.
- **Comment threading**: Confluence has separate footer and inline comment streams. When fetching comments in Phase 1, merge both into the analysis — they are equally authoritative for capturing decisions and engineering notes.
