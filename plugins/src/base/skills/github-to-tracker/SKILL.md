---
name: github-to-tracker
description: >
  Break down a GitHub Issue PRD into Epics, Stories, and Sub-tasks in the configured destination tracker
  (JIRA via lisa:tracker-write → lisa:jira-write-ticket, or GitHub Issues itself via lisa:tracker-write
  → lisa:github-write-issue). Use this skill whenever the user shares a GitHub issue URL and wants it
  converted into tickets, or asks to "break down this GitHub PRD", "create tickets from a GitHub issue",
  or similar. This skill mirrors lisa:notion-to-tracker / lisa:confluence-to-tracker /
  lisa:linear-to-tracker for projects whose PRDs live in GitHub Issues — the workflow, gates, dry-run
  mode, and validation rules are identical; only the source-of-truth tool surface differs (the `gh` CLI
  instead of Notion / Confluence / Linear MCP).
allowed-tools: ["Skill", "Bash", "Read"]
---

# GitHub PRD to Tracker Breakdown

Convert a GitHub Issue PRD into a structured ticket hierarchy in the configured destination tracker: Epics > Stories > Sub-tasks. Each Sub-task is scoped to exactly one repo and includes an empirical verification plan.

This skill is the GitHub counterpart of `lisa:notion-to-tracker` / `lisa:confluence-to-tracker` / `lisa:linear-to-tracker`. The four skills share the same phases, gates, dry-run contract, and per-ticket validation logic. Only the PRD-side fetch tools differ. When changing workflow logic, change ALL FOUR skills together so the PRD vendors stay behaviorally identical.

## What "PRD" means in GitHub Issues

GitHub Issues has no native "PRD" entity. This skill treats a single GitHub Issue (carrying the `prd-ready` label) as the PRD container:

- **Issue body** (markdown) is the PRD body — equivalent to a Notion page body, a Confluence page body, or a Linear project description.
- **Sub-issues** (native GitHub sub-issues, traversable via `gh api graphql`) act as the candidate set for Epics or User Stories — the same role child Epic pages play in a Notion/Confluence PRD.
- **Issue comments** capture decisions, engineering notes, product clarifications.
- **Linked PRs** (parsed from `Resolves #<n>` lines and from native cross-references) provide implementation context.

A multi-Epic PRD is encoded as a parent Issue with several child sub-issues. A simple PRD is a single Issue with body content only.

## Modes

This skill supports two modes, controlled by a `dry_run` flag in `$ARGUMENTS`:

- **`dry_run: false`** (default — full mode): run all phases, write tickets via `lisa:tracker-write`, run the preservation gate, report.
- **`dry_run: true`** (planning + validation only — no writes): run Phases 1, 1.5, 1.6, 2, 3, 4 to plan the hierarchy and draft each ticket spec, then call `lisa:tracker-validate` (with `--spec-only`) on every drafted ticket. Aggregate the per-ticket validator reports into a single dry-run report. **Skip Phase 5 (sub-task creation), Phase 5.5 (preservation gate), and Phase 6 (results report)** — none of those make sense without writes. Return the dry-run report so the caller (e.g. `lisa:github-prd-intake`) can decide whether to proceed.

Dry-run output format is identical to `lisa:notion-to-tracker` / `lisa:confluence-to-tracker` / `lisa:linear-to-tracker`. Reuse the same fields, including `prd_anchor` and `prd_section`. For GitHub, `prd_anchor` is a section heading from the PRD body when the failure traces to a specific section; otherwise `null` (the caller posts unanchored failures as a rollup comment on the PRD issue).

```text
## github-to-tracker dry-run: <PRD title>

### Planned hierarchy
- Epic: <summary>
  prd_section: "<heading text from the PRD body or sub-issue title that produced this epic>"
  prd_anchor: "<heading text or sub-issue ref or null>"
  - Story 1.1: <summary>
    prd_section: "<heading or user-story line>"
    prd_anchor: "<heading or sub-issue ref or null>"
    - Sub-task [<repo>]: <summary>
      prd_section: "<heading or AC bullet>"
      prd_anchor: "<heading or sub-issue ref or null>"
    - ...
  - Story 1.2: ...

### Per-ticket validation
- <ticket-ref>: PASS | FAIL — <count> failures
  prd_section: "<heading text>"
  prd_anchor: "<heading or sub-issue ref or null>"
  failures:
    - gate: <gate-id>
      category: <category from validator>
      product_relevant: <true|false>
      what: <plain-language description from validator>
      recommendation: <1–3 candidate resolutions from validator>

### Verdict: PASS | FAIL
### Total failures: <n>
```

The dry-run mode never writes to the destination tracker. It also never modifies the source PRD issue, never adds/removes labels, never edits sub-issues, and never posts comments — that is the orchestrating skill's responsibility (`lisa:github-prd-intake`).

## Hard Rule: All Writes Go Through `lisa:tracker-write`

**Every ticket created by this skill — every Epic, Story, and Sub-task — MUST be created by invoking the `lisa:tracker-write` shim. Never call `lisa:jira-write-ticket`, `lisa:github-write-issue`, `mcp__atlassian__createJiraIssue`, or `gh issue create` directly from this skill or from any sub-agent it spawns.**

`lisa:tracker-write` enforces:
- Vendor-agnostic dispatch (so a project's destination is one config edit away).
- The vendor writer's pre-write gate (`lisa:tracker-validate` Phase 5.5).
- Post-write verify (`lisa:tracker-verify`).
- 3-audience description, Gherkin acceptance criteria, parent / Epic validation, link discovery, single-repo scope, sign-in / target environment fields, source-artifact preservation.

Bypassing the shim layer produces tickets that the rest of the lifecycle (triage, verify, journey, evidence) treats as broken.

The `gh` reads in this skill are limited to reading the source PRD issue, its sub-issues, and its comments. They never write.

## Input

A GitHub issue ref. The PRD is expected to have:

- An issue body containing context, problems, and (optionally) a list of user stories.
- One or more sub-issues that act as candidate Epics or user stories (optional — single-issue PRDs are valid).
- Issue comments capturing engineering notes and product decisions.
- The `prd-ready` label (if invoked from `lisa:github-prd-intake`; for ad-hoc / direct invocation the label is informational, not gating).

URL parsing — accept either:

- `org/repo#<number>`
- `https://github.com/<org>/<repo>/issues/<number>`

Resolve `<org>/<repo>` from `.lisa.config.json` if `$ARGUMENTS` is just `#<n>` or a bare number.

## Configuration

This skill reads project-specific configuration from environment variables and from `.lisa.config.json`. If these are not set, ask the user before proceeding — never invent values.

| Variable / config | Purpose | Example |
|-------------------|---------|---------|
| `.lisa.config.json` `tracker` | Destination tracker (jira / github) | `github` |
| `.lisa.config.json` `github.org` / `github.repo` | GitHub org/repo when tracker=github (and the source repo) | `acme` / `frontend-v2` |
| `JIRA_PROJECT` | Destination JIRA project key when tracker=jira | `SE` |
| `JIRA_SERVER` | Atlassian instance URL | `mycompany.atlassian.net` |
| `E2E_TEST_PHONE` | Test user phone for verification plans | `0000000099` |
| `E2E_TEST_OTP` | Test user OTP code | `555555` |
| `E2E_TEST_ORG` | Test organization name | `Arsenal` |
| `E2E_BASE_URL` | Frontend base URL for Playwright tests | `https://dev.example.io/` |
| `E2E_GRAPHQL_URL` | GraphQL API URL for curl verification | `https://gql.dev.example.io/graphql` |

## Workflow

### Phase 1: Fetch & Analyze the PRD

1. **Confirm `gh auth status` succeeds.**
2. **Fetch the PRD issue** via `gh issue view <num> --repo <org>/<repo> --json number,title,body,labels,milestone,assignees,author,createdAt,comments,url`. Capture title, body, labels, author, assignees, dates, comments.
3. **Fetch native sub-issues** via the GraphQL `subIssues` traversal (see `lisa:github-read-issue` Phase 3). Each sub-issue's `{number, title, body, labels, state, url}` becomes a candidate epic / story node.
4. **Recursively fetch grandchild sub-issues** (one more level — typical PRD depth is 2: PRD → Epic candidate → maybe a Story candidate). Stop after depth 3 unless the user explicitly requested deeper.
5. **Fetch full comments per sub-issue** via `gh issue view <num> --repo <org>/<repo> --json comments` for every sub-issue surfaced in step 3. Capture body, author, timestamp.
6. **Synthesize decisions and blockers** from the PRD body + every sub-issue body + every comment thread:
   - Decisions already confirmed by the team (look for agreement in comments).
   - Open questions that need product/engineering input.
   - Engineering comments (prefixed with "Engineering:" or 🔧) that identify technical constraints.
   - Cross-PRD dependencies (references to other GitHub issues, Notion / Confluence / Linear PRDs, shared infrastructure).

### Phase 1.5: Extract Source Artifacts

PRDs typically reference external design, UX, and data artifacts (Figma files, Lovable prototypes, Loom walkthroughs, screenshots, example payloads, peer Notion / Confluence / Linear pages). These MUST be preserved onto the resulting tickets — otherwise developers picking up a ticket lose the source of truth. This is the failure mode this step exists to prevent.

1. **Scan the PRD body, every sub-issue body, and every comment** for:
   - URLs to design/prototype tools (Figma, FigJam, Figma Make, Lovable, Framer, Penpot)
   - URLs to recording/walkthrough tools (Loom, YouTube, Vimeo, Descript)
   - URLs to collaborative docs (Google Docs/Slides/Sheets, peer Confluence pages, Notion peer pages, peer Linear documents)
   - URLs to code sandboxes (CodeSandbox, StackBlitz, Replit, GitHub permalinks/gists)
   - URLs to diagramming tools (Miro, Mural, Excalidraw, Mermaid Live, draw.io, Lucid)
   - URLs to data/observability tools (Grafana, Datadog, Sentry, Metabase, Looker)
   - Embedded images and file attachments referenced in the body
   - Fenced code blocks with example data (JSON, SQL, GraphQL, cURL request/response)

2. **Classify each artifact and apply taxonomy rules** by invoking the `lisa:jira-source-artifacts` skill. That skill is the single source of truth for: domains (`ui-design` / `ux-flow` / `data` / `ops` / `reference`), per-tool classification rules, and coverage smells.

3. **Build an `artifacts` map** keyed by domain. Each entry: `{ url, title, domain, source_page, source_page_url, classification_reason }`. `source_page` lets you trace each reference back to where it appeared (PRD body vs a specific sub-issue vs a specific comment).

4. **Surface coverage smells** as defined in `lisa:jira-source-artifacts` §5. Record on the Epic.

### Phase 1.6: Source Precedence & Conflict Resolution

Source precedence rules and cross-axis conflict handling are defined in `lisa:jira-source-artifacts` §3 and §4. Apply them during ticket synthesis: every conflict between artifacts must be recorded under `## Open Questions` on the affected ticket, never silently reconciled.

The existing-component reuse expectation is defined in `lisa:jira-source-artifacts` §7. Encode it on every UI-touching story.

### Phase 2: Codebase + Live Product Research

Identical to `lisa:notion-to-tracker` Phase 2 / `lisa:confluence-to-tracker` / `lisa:linear-to-tracker`. Two complementary inputs ground PRD analysis: the **code** and the **live product**.

**2a. Codebase research.** If the session doesn't already have codebase context, explore the repos. Use Explore agents for repos not yet examined.

**2b. Live product walkthrough.** If the PRD touches existing user-facing surfaces, invoke `lisa:product-walkthrough` against `E2E_BASE_URL` using the test user from config.

Skip 2b only when the work is purely backend with no user-visible surface, or affects a screen that does not yet exist.

Walkthrough findings are surfaced back to product via the orchestrating intake skill (`lisa:github-prd-intake`), which posts them as a comment on the PRD issue. This skill itself does NOT post to GitHub — it only reads. The walkthrough section is also inherited onto the resulting Epic / Stories under a `## Current Product` subsection.

### Phase 3: Create Epics

> **Mode guard**: In `dry_run: true` mode, do not invoke `lisa:tracker-write` in this phase. Instead, draft the epic spec (summary, body, artifacts) and validate it with `lisa:tracker-validate --spec-only`. Record the drafted spec (with a placeholder ref like `DRY-RUN-EPIC-1`) for Phase 4 to use as parent references. In `dry_run: false` mode, proceed as described below.

For each epic identified in Phase 1, **invoke the `lisa:tracker-write` shim** (do not call `lisa:jira-write-ticket` or `lisa:github-write-issue` directly). Pass it everything it needs to enforce its quality gates:

- `issue_type`: `Epic`
- `summary`: epic title from the PRD
- `body`: a draft of the multi-section description containing:
  - **Context / Business Value**: epic summary from the PRD, originating GitHub PRD URL, business outcome
  - **Technical Approach**: cross-cutting integration points and constraints surfaced in Phase 2 codebase research
  - List of user stories the epic contains
  - Key decisions from comments (with attribution)
  - Blockers and open questions
  - Dependencies on other epics or PRDs
  - A **Source Artifacts** section listing every artifact extracted in Phase 1.5 (grouped by domain)
- `artifacts`: the full Phase 1.5 artifact list — every artifact, regardless of domain. The Epic is the canonical hub.
- `priority`, `labels`, `components`, `fix_version`: as appropriate

Capture the returned epic ref — Phase 4 needs it as the parent for Stories.

### Phase 4: Create Stories

> **Mode guard**: In `dry_run: true` mode, do not invoke `lisa:tracker-write`. Draft each story spec and validate it with `lisa:tracker-validate --spec-only`. Use placeholder refs (e.g. `DRY-RUN-STORY-1.1`).

For each Epic, plan two kinds of Stories:
- **One "X.0 Setup" story** for data model and infrastructure prerequisites
- **One story per user story** from the PRD (numbered to match the PRD's structure or the source sub-issues)

**Story naming convention**: Prefix the summary with a short code derived from the PRD title (e.g., `[CU-1.1]` for "Contract Upload").

For each Story, **invoke `lisa:tracker-write`** with:

- `issue_type`: `Story`
- `parent_ref` / `epic_parent`: the Epic ref captured in Phase 3 (mandatory)
- `summary`: prefixed per the naming convention above
- `body`: multi-section description as in `lisa:notion-to-tracker` Phase 4
- `artifacts`: the Phase 1.5 artifacts filtered by domain per the inheritance table:

| Story type | Inherits domains |
|------------|------------------|
| Frontend / UI | `ui-design`, `ux-flow`, `reference` |
| Backend / API / data model | `data`, `reference` |
| Infrastructure | `ops`, `reference` |
| Mixed / setup ("X.0") | All domains |

Capture each returned story ref — Phase 5 needs it.

### Phase 5: Create Sub-tasks

Delegate sub-task creation to **parallel agents** (one per epic or batch of stories) for efficiency. **Every spawned agent must invoke `lisa:tracker-write` for each sub-task — no agent may call `lisa:jira-write-ticket` / `lisa:github-write-issue` / `gh issue create` directly.**

Each sub-task MUST:
1. **Be scoped to exactly ONE repo** — indicated in brackets in the summary: `[repo-name]`.
2. **Include an Empirical Verification Plan** — real user-like verification, NOT unit tests, linting, or typechecking.

Sub-tasks inherit their parent Story's artifacts by reference (the parent link). Do not pass the same artifact list to every sub-task.

### Phase 5.5: Artifact Preservation Gate (mandatory)

Run the preservation gate defined in `lisa:jira-source-artifacts` §8 against the artifacts extracted in Phase 1.5 and the tickets just created. Do NOT restate or modify the gate logic here — invoke the rules from `lisa:jira-source-artifacts`.

To run the gate, this skill must:

1. Pull the remote links / `## Source Artifacts` section / `## Links` section of every Epic and Story created in this run via `lisa:tracker-read`.
2. Apply the §8 preservation matrix and verdict rules.
3. If the gate fails: list each dropped/misrouted artifact and either re-attach via `lisa:tracker-write` (UPDATE mode) or stop and ask the human.
4. If the gate passes: print the matrix compactly and proceed to Phase 6.

This gate is not optional.

### Phase 6: Report Results

After all tickets are created, present a summary table to the user:
- All Epics with refs and URLs
- All Stories grouped by Epic
- All Sub-tasks grouped by Story with repo tags
- Repo distribution
- **Artifact Preservation Matrix**
- Blockers list with recommendations and alternatives
- Cross-PRD dependencies

### Phase 7: PRD Back-link

> **Mode guard**: In `dry_run: true` mode, skip this phase entirely — no tickets exist to link.

After Phase 6, invoke the `lisa:prd-backlink` skill to write a `## Tickets` section back into the source GitHub Issue PRD body. The section becomes the canonical anchor for the **Debrief** flow once the initiative ships.

Invoke `lisa:prd-backlink` with:

- `source_type: "github"`
- `source_ref`: the original GitHub Issue URL or `<org>/<repo>#<n>` token
- `tickets`: the full list created in Phases 3–5, each entry as `{ key, title, type, url, parent_key }`

If `lisa:prd-backlink` fails (permission denied, GitHub unreachable, issue locked), surface the error in the Phase 6 report rather than aborting — the tickets are already created. Recommend the user re-run `lisa:prd-backlink` standalone once the source is reachable.

## Handling Ambiguities and Blockers

When you encounter something the PRD + comments + codebase can't resolve:

1. **Don't guess** — mark the ticket with a BLOCKER section.
2. **Include your recommendation** with rationale.
3. **List 2-3 alternatives** so the user/product can choose.
4. **State what's needed to unblock.**

## Agent Prompt Template for Sub-task Creation

When delegating to agents, provide this context. **The "MUST invoke tracker-write" instruction is load-bearing — do not edit it out when adapting this template.**

```text
Create Sub-tasks via the configured destination tracker.

CRITICAL: For each sub-task, invoke the `lisa:tracker-write` skill via the Skill tool.
Do NOT call `lisa:jira-write-ticket`, `lisa:github-write-issue`, or `gh issue create` directly.
The `lisa:tracker-write` shim dispatches to the configured destination AND enforces required
quality gates (Gherkin acceptance criteria, multi-section description, single-repo scope,
sign-in/environment fields, post-create verification). Bypassing it produces broken tickets
that downstream skills (triage, journey, evidence) cannot use.

For each sub-task, invoke `lisa:tracker-write` with:
- issue_type: "Sub-task"
- parent_ref: the parent story ref
- summary: prefixed with the repo in brackets, e.g. "[backend-api] Add audit log table"
- body: a multi-section draft (Context / Technical Approach / Acceptance Criteria / etc.)
- gherkin_acceptance_criteria: derived from the story's functional requirements
- sign_in_account: [test user credentials from config]
- target_environment: "dev"
- empirical_verification_plan: real user-like verification (curl + auth token, Playwright
  browser flow, CLI check after deploy) using the test credentials. NOT unit tests.

Each sub-task must:
1. Be scoped to ONE repo only — repo named in brackets in the summary.
2. Include the Empirical Verification Plan in the body.
3. Be created via `lisa:tracker-write`, not via direct calls.

If `lisa:tracker-write` rejects a sub-task, fix the input and re-invoke. Do NOT fall back
to a direct vendor-write call to bypass the gate.

Test user info: [credentials from config]

[Then list all sub-tasks grouped by parent story with details]
```

## Cross-PRD Shared Infrastructure

Track tickets that are shared across PRDs to avoid duplication. When a sub-task overlaps with an existing ticket, reference it instead of creating a duplicate. Use `lisa:tracker-read` to search the destination for existing tickets in the same area before creating new ones for shared infrastructure.

## GitHub-specific notes

- **Body format**: GitHub Issues bodies are markdown. Treat headings (`#`, `##`, `###`) as section markers for `prd_section`.
- **Native sub-issues**: GitHub native sub-issues (the `addSubIssue` GraphQL mutation) are how Epic→Story→Sub-task is encoded when the destination is also GitHub Issues. The PRD-side reads them via the `subIssues` GraphQL field.
- **Comment threading**: GitHub Issues comments are flat — there's no `parentId` (unlike Linear). Decision context is captured by chronological position; quote the comment author + timestamp when surfacing it.
- **Anchoring on PRD comments**: GitHub Issues do not have a Confluence-style selection-anchored inline-comment primitive. The orchestrating skill (`lisa:github-prd-intake`) approximates by quoting the relevant body excerpt at the top of each comment. The dry-run report's `prd_anchor` is the section heading the failure traces to (or `null` for body-wide failures).
- **Self-host edge case**: when `tracker = "github"` AND the source PRD repo is the same as the destination repo, both reads and writes hit one place. The PRD carries `prd-*` labels; built tickets carry `type:*` + `status:*` labels. The two namespaces never overlap. `lisa:prd-ticket-coverage` filters out the source PRD itself when listing destination tickets.
