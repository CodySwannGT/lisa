---
name: linear-write-issue
description: "Creates or updates a Linear work item — Project (Epic), Issue (Story), or sub-Issue (Sub-task) — following organizational best practices. Polymorphic: dispatches internally on issue_type to save_project (Epic) or save_issue (Story / Sub-task). Enforces description quality (three audiences), Gherkin acceptance criteria, project-as-parent for Stories, parentId for Sub-tasks, explicit relationship discovery (blocks / is blocked by / relates to / duplicates), labels, components-as-labels, project milestones for fix versions, native priority and estimate fields, and Validation Journey. Rejects thin items — use this skill any time a Linear work item is created or significantly edited."
allowed-tools: ["Bash", "Skill", "mcp__linear-server__list_teams", "mcp__linear-server__get_team", "mcp__linear-server__list_projects", "mcp__linear-server__get_project", "mcp__linear-server__save_project", "mcp__linear-server__list_issues", "mcp__linear-server__get_issue", "mcp__linear-server__save_issue", "mcp__linear-server__list_issue_labels", "mcp__linear-server__create_issue_label", "mcp__linear-server__list_project_labels", "mcp__linear-server__list_comments", "mcp__linear-server__save_comment"]
---

# Write Linear Work Item: $ARGUMENTS

Create or update a Linear work item — Project (for Epics), Issue (for Stories), or sub-Issue (for Sub-tasks) — with all required relationships, metadata, and quality gates. Every section below is mandatory. Thin items are rejected.

Repository name for scoped comments: `basename $(git rev-parse --show-toplevel)`.

## Configuration

This skill reads configuration from `.lisa.config.json` (with `.lisa.config.local.json` overriding per key). Required keys:

- `linear.workspace` — Linear workspace slug
- `linear.teamKey` — Linear team key (e.g. `ENG`); the team owns the destination items

If either is missing, stop and report — never invent values.

## Polymorphic dispatch

Linear's data model maps Epic / Story / Sub-task to **different entity types**. This skill dispatches on `issue_type`:

| `issue_type` | Linear entity | MCP write tool | Parent field |
|--------------|---------------|----------------|--------------|
| `Epic` | **Project** | `mcp__linear-server__save_project` | (none — Projects are top-level within a team) |
| `Story` / `Task` / `Improvement` | **Issue** | `mcp__linear-server__save_issue` | `projectId` (the Epic Project) |
| `Sub-task` | **sub-Issue** | `mcp__linear-server__save_issue` | `parentId` (the Story Issue) |
| `Bug` | **Issue** | `mcp__linear-server__save_issue` | `projectId` if part of an Epic; else top-level |
| `Spike` | **Issue** | `mcp__linear-server__save_issue` | `projectId` if part of an Epic; else top-level |

Status workflow uses **labels** (`status:ready`, `status:in-progress`, `status:on-dev`, `status:done`) for portability across teams — Linear's per-team workflow state names vary, but labels are workspace-scoped and stable. Native Linear `state` is set to the team's default `Todo` state on create.

## Phase 1 — Resolve Intent

Determine from `$ARGUMENTS` and context whether this is a CREATE or UPDATE:

- **CREATE**: no existing identifier provided.
- **UPDATE**: identifier provided (`<TEAM>-<n>` for Issue, project slug + short-id for Project) — call `/linear-read-issue <ref>` first to load the full current state. Never overwrite without reading.

Resolve the team ID for `linear.teamKey` via `mcp__linear-server__list_teams({query: <teamKey>})`. Cache it.

## Phase 2 — Gather Required Inputs

Required fields (stop and ask if missing — never invent values):

| Field | Required For | Notes |
|-------|--------------|-------|
| `team_key` | CREATE | From `linear.teamKey` config; required for both Project and Issue creation |
| `issue_type` | CREATE | One of: Epic, Story, Task, Bug, Spike, Sub-task, Improvement |
| Summary | CREATE, UPDATE | One line, imperative voice, under 100 chars |
| Description | CREATE, UPDATE | Multi-section markdown — see Phase 3 |
| Project parent (for Story / Task / Bug / Spike / Improvement when part of an Epic) | non-Epic, non-Sub-task in Epic context | Linear Project ID — the Epic |
| Sub-task parent | Sub-task | Linear Issue ID — the Story |
| Priority | CREATE | Native Linear priority: 0=No priority, 1=Urgent, 2=High, 3=Medium, 4=Low |
| Acceptance criteria | Story, Task, Bug, Sub-task, Improvement | Gherkin — see Phase 3 |
| Validation Journey | Runtime-behavior changes | Delegate to `/linear-add-journey` |
| Target backend environment | Runtime-behavior changes | `dev` / `staging` / `prod`; recorded in description (Phase 3). Skip only for doc/config/type-only items. |
| Sign-in account / credentials | Items that touch authenticated surfaces | Name the account (or source — 1Password item, env var, seeded fixture) and role; recorded in description. Omit when sign-in is not required. |
| Single-repo scope | Bug, Task, Sub-task | These types MUST cover one repo only. If the work crosses repos, split it before creating. Epic / Spike / Story may span repos. |

Optional but recommended: assignee, estimate (story points), labels, project milestone (fix-version equivalent), cycle.

## Phase 3 — Description Quality

Linear descriptions are markdown (NOT Jira wiki markup — no `h2.` headings, use `##` instead). The description MUST address three audiences. Reject and rewrite if any are missing.

```markdown
## Context / Business Value
[Why this matters. Stakeholder-facing. Concrete user impact or business outcome.
 Link to the originating Slack thread, Notion doc, incident, or customer report.]

## Technical Approach
[Developer-facing. Integration points, impacted modules, data model implications,
 relevant tradeoffs. Not a full design doc — a pointer for someone picking it up.]

## Acceptance Criteria
1. Given <precondition>
   When <action>
   Then <observable outcome>
2. Given <precondition>
   When <action>
   Then <observable outcome>

## Out of Scope
[Explicit list of what this item does NOT cover. Forces scope discipline.]

## Target Backend Environment
[Required when the item changes runtime behavior. One of: dev / staging / prod.
 Skip section entirely for doc-only, config-only, or type-only items.]

## Sign-in Required
[Include this section ONLY if the work touches authenticated surfaces.
 Specify: the account/role to sign in as, where to get the credentials
 (1Password item name, env var, seeded fixture), and any MFA/SSO notes.
 Omit the section entirely when sign-in is not required.]

## Repository
[Required for Bug / Task / Sub-task. Name the single repo this item covers.
 If the work spans repos, this issue type is wrong — split into per-repo
 Tasks/Sub-tasks under a parent Story or Epic.]

## Validation Journey
[Delegate to /linear-add-journey if the item changes runtime behavior.
 Skip only for doc-only, config-only, or type-only items.]
```

Rules:
- Every acceptance criterion uses Given/When/Then. No vague "should work" language.
- Every criterion is independently verifiable (UI, API, data, or performance check).
- If the item is a Bug, include reproduction steps, expected vs. actual behavior, and environment.
- If the item is a Spike, include the question being answered and the definition of done (decision doc, prototype, or findings).
- If sign-in is required, the implementer must be able to sign in from the description alone — never assume they will guess the account or hunt for credentials.

## Phase 4 — Relationship Discovery (Mandatory)

Before creating or updating, find candidate relationships. Do NOT skip — this is the step agents most often omit.

### 4a. Project Parent (Epic-equivalent)

If the item is **not an Epic** and **not a top-level Bug/Spike**, it MUST have a parent context:

- **Story / Task / Improvement** → must have a `projectId` (the Epic Project) set.
- **Sub-task** → must have a `parentId` (the Story Issue) set.

If the parent is explicitly provided, use it. Otherwise:

1. Search active Projects in the team:
   ```text
   mcp__linear-server__list_projects({team: <teamKey>, state: ["backlog", "planned", "started"]})
   ```
   Match on keywords from the summary and description.
2. If no matching Project exists, stop and ask the human to create or pick one. Do NOT orphan the item.

### 4b. Related Items

Relationship discovery is **mandatory** on every create and every update — never declare "no related work" without doing both searches below and recording their outcomes on the item.

**Search 1: local git history** (catches PRs / commits that touched the same area but were never linked):

```bash
git log --all --oneline --grep="<keyword>"
git log --all --oneline -- <path-or-glob>
git log --since=90.days --oneline -- <path-or-glob>
```

If the git search surfaces a PR or commit that relates to this work, capture the PR URL — it becomes a remote link (Phase 4c) and may also point to a sibling item worth linking.

**Search 2: Linear MCP** (catches open and recently-closed items):

```text
# Open items in the same Project
mcp__linear-server__list_issues({project: <projectId>, state_type: ["unstarted", "started"]})

# Open items with overlapping keywords (workspace-wide)
mcp__linear-server__list_issues({query: "<keyword>", state_type: ["unstarted", "started"]})

# Items with shared labels
mcp__linear-server__list_issues({label: "<label>", updatedAt: ">-30d"})

# Recently closed items in the same Project
mcp__linear-server__list_issues({project: <projectId>, state_type: ["completed", "canceled"], updatedAt: ">-30d"})
```

**Record the outcome.** Add a `## Relationship Search` subsection (or a comment if updating) listing the queries you ran and what they returned. If the searches yielded nothing, write that explicitly — "Searched git history for `<keywords>` and Linear for project=`X`, label=`Y`; no related work found." An item with zero relations and no documented search is rejected.

For each candidate, classify the relationship:

| Relation Type | When to Use |
|---------------|-------------|
| `blocks` | This item must ship before the linked item can proceed |
| `blocked_by` | The linked item must ship before this one can proceed |
| `relates_to` | Shared context, no ordering constraint |
| `duplicates` | This item already exists — close one as duplicate |

Linear native relations are set on the Issue via `save_issue`'s `relations` field (or via a paired `save_issue_relation` call if available in the MCP). For Project-level (Epic) relationships, capture them in the description under `## Related Projects` since Linear doesn't model relations between Projects natively.

### 4c. Remote Links

Identify and attach (Linear stores attachments / links on the Issue or in description body):

- GitHub PRs, branches, or commits related to this work
- Confluence pages (design docs, RFCs, runbooks)
- Dashboards (Grafana, Datadog, Sentry issue)
- Incident items (PagerDuty, Statuspage)
- **Source artifacts from the originating PRD / parent Project**: classify and inherit per the rules in `lisa:tracker-source-artifacts` (invoke that skill if you haven't loaded the rules in this session). Enumerate the parent Project's links and inherit the ones whose domain matches this item's scope (UI → `ui-design` + `ux-flow`; backend → `data`; infra → `ops`; always inherit `reference`). Never assume a developer will walk up to the Project to find design context — attach it here.

If the item was generated from a PRD (by `lisa:notion-to-tracker` or similar) and the parent Project has no source artifacts, surface that as a smell and ask whether artifacts were missed during extraction before proceeding.

### 4d. Source Precedence (must appear on the item)

Source precedence rules and cross-axis conflict handling are defined in `lisa:tracker-source-artifacts` §3 and §4. When an item carries both design artifacts and a description, record the precedence explicitly in the description (under Technical Approach or a dedicated `## Source Precedence` subsection) so the implementer doesn't silently reconcile conflicts. Cross-axis conflicts go under `## Open Questions` as BLOCKER items.

For UI-touching items, include the existing-component reuse expectation per `lisa:tracker-source-artifacts` §7.

### 4e. Live Product Walkthrough Findings (UI-touching items)

If the item modifies an existing user-facing surface, a `lisa:product-walkthrough` should already have been run upstream. Inherit its findings under a `## Current Product` subsection in the description so the implementer sees what's shipped today before changing it. If the upstream skill skipped the walkthrough but this item clearly modifies an existing surface, invoke `lisa:product-walkthrough` here before proceeding.

## Phase 5 — Set Metadata

Before create/update, verify each field is populated where applicable:

- **Labels**: include `status:ready` for new items; component labels (`component:<name>`); status / priority labels are NOT redundant with native fields — labels exist for portability and downstream queries.
- **Native priority field**: 0–4 per Linear's scale; explicit, not "unset".
- **Native estimate**: per Linear's team-configured estimate scale (often 0–8 Fibonacci); skip for Epic / Spike.
- **ProjectMilestone**: when the team uses dated milestones, set the milestone on the Project (Epic) or on the Issue (when an Issue belongs to a milestone).
- **Cycle**: only if actively in a cycle.
- **Assignee**: leave unset if unknown rather than auto-assigning.

For Bug / Task / Sub-task, ensure the summary is prefixed with `[<repo-name>]`.

## Phase 5.5 — Validate (Pre-write Gate)

Before any write, invoke `lisa:linear-validate-issue` with the full proposed spec assembled from Phases 2 / 3 / 4 / 5. Pass it as a YAML block per the `lisa:linear-validate-issue` schema, including `runtime_behavior_change`, `authenticated_surface`, and `artifacts_attached` flags so the right gates run.

The validator is the **single source of truth** for what makes a valid Linear work item. The same gates are used by `lisa:linear-to-tracker` dry-run, by `lisa:linear-verify` post-write, and here. Do not re-implement gate logic in this skill.

If the validator reports `FAIL`:
- Surface the failure list and the per-gate remediation to the user.
- Do NOT proceed to Phase 6. Fix the spec (or stop and ask the human) and re-run validation.
- Never call `mcp__linear-server__save_project` or `mcp__linear-server__save_issue` while the validator's verdict is FAIL.

If the validator reports `PASS`, continue to Phase 6.

## Phase 6 — Create or Update

### CREATE — Epic (Project)

1. Resolve any required Project labels (`prd-ticketed`, etc.) via `mcp__linear-server__list_project_labels` (create via `create_project_label` if missing).
2. Call `mcp__linear-server__save_project` with: `name` (summary), `description` (markdown), `teamIds: [<teamId>]`, `labelIds`, `priority` (Linear Project priority is also 0–4), `state` (default `backlog`), milestones if dated.
3. Capture the returned Project ID and slug — Phase 4 children need these.
4. If the Project is the parent for downstream Stories, record the ID for `lisa:linear-to-tracker` Phase 4 to use.

### CREATE — Story / Task / Bug / Spike / Improvement (Issue with projectId)

1. Resolve any required Issue labels (`status:ready`, `component:<name>`, `prd-intake-feedback` only if this is a sentinel issue, etc.) via `mcp__linear-server__list_issue_labels` (create via `create_issue_label` if missing).
2. Call `mcp__linear-server__save_issue` with: `team` (teamId), `title` (summary), `description` (markdown), `projectId` (the Epic Project), `priority` (0–4), `estimate`, `labelIds`, `assignee` if known.
3. Capture the returned identifier (e.g. `ENG-123`) — Phase 4 sub-tasks need it as `parentId`.
4. Add relationships from Phase 4b via `save_issue` (relations field) or paired relation calls.
5. If the item changes runtime behavior, invoke `lisa:linear-add-journey` to append the Validation Journey section.

### CREATE — Sub-task (Issue with parentId)

1. Resolve labels as above.
2. Call `mcp__linear-server__save_issue` with: `team` (teamId), `title` (`[<repo>] <summary>` prefix is mandatory), `description` (markdown), `parentId` (the Story Issue ID), `projectId` (inherit from parent), `priority`, `estimate`, `labelIds`.
3. Capture identifier.
4. Add relationships via Phase 4b.

### UPDATE

1. Call `mcp__linear-server__save_project` or `mcp__linear-server__save_issue` with **only the fields being changed**. Do NOT resend fields that weren't in the change set — Linear treats the call as a full overwrite of the listed fields.
2. Preserve description sections you are not editing — re-read via `/linear-read-issue` first.

## Phase 7 — Verify

Call the `lisa:linear-verify` skill on the resulting item. `lisa:linear-verify` fetches the live item and runs `lisa:linear-validate-issue` against it — same gates as Phase 5.5, but applied to what Linear actually stored. If it reports failures, fix them before returning. Do not report success on an item that fails verify.

## Phase 8 — Announce

Post a creation comment via `mcp__linear-server__save_comment` (on the Issue, or on a sentinel issue under the Project for Epic-level announcements) with:

- `[<repo>]` prefix if the item is repo-scoped
- Who the item is assigned to (if known)
- The relationships that were set (`blocks`, `blocked_by`, `relates_to`) with Linear identifiers
- Any remote PRs attached

Skip this step only on UPDATE when no material change was made.

## Rules

- Never create a non-Epic, non-top-level item without a parent context (Project for Stories, parentId for Sub-tasks).
- Never skip relationship discovery — both the git history search AND the Linear MCP search must run, and their outcomes must be recorded on the item. "None found" is acceptable only when it's documented.
- Never create a Bug, Task, or Sub-task that spans multiple repos. Split it before creating.
- Never include a runtime-behavior item without a target backend environment, and never include an authenticated-surface item without sign-in credentials in the description.
- Never invent custom field values. If the team requires a field you don't have, stop and ask.
- Never overwrite a description without reading the current version first.
- All Linear writes go through this skill so best practices are enforced uniformly. Downstream skills (e.g. `lisa:linear-create`) should delegate here rather than calling the MCP write tools directly.
- The gate logic (what makes a valid item) lives in `lisa:linear-validate-issue`, NOT in this skill. This skill calls the validator at Phase 5.5 (pre-write) and Phase 7 (via `lisa:linear-verify` post-write). When a gate needs to change, change it in `lisa:linear-validate-issue` — every caller picks it up automatically.
- This skill is the destination of the `lisa:tracker-write` shim when `tracker = "linear"`. Vendor-neutral callers (`notion-to-tracker`, `confluence-to-tracker`, `linear-to-tracker`, `github-to-tracker`) MUST go through `lisa:tracker-write`, not call this skill directly.
