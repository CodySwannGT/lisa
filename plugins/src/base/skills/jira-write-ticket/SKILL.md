---
name: jira-write-ticket
description: "Creates or updates a JIRA ticket following organizational best practices. Enforces description quality (coding assistant / developer / stakeholder sections), Gherkin acceptance criteria, epic parent relationship, explicit link discovery (blocks / is blocked by / relates to / duplicates / clones), remote links (PRs, Confluence, dashboards), labels, components, fix version, priority, story points, and Validation Journey. Rejects thin tickets — use this skill any time a ticket is created or significantly edited."
allowed-tools: ["Bash", "Skill", "mcp__atlassian__getJiraIssue", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__createJiraIssue", "mcp__atlassian__editJiraIssue", "mcp__atlassian__createIssueLink", "mcp__atlassian__getIssueLinkTypes", "mcp__atlassian__addCommentToJiraIssue", "mcp__atlassian__getVisibleJiraProjects", "mcp__atlassian__getJiraProjectIssueTypesMetadata", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Write JIRA Ticket: $ARGUMENTS

Create or update a JIRA ticket with all required relationships, metadata, and quality gates. Every section below is mandatory. Thin tickets are rejected.

Repository name for scoped comments: `basename $(git rev-parse --show-toplevel)`.

## Phase 1 — Resolve Intent

Determine from $ARGUMENTS and context whether this is a CREATE or UPDATE:

- **CREATE**: no existing ticket key provided
- **UPDATE**: ticket key provided — call `/jira-read-ticket <KEY>` first to load the full current state before editing. Never overwrite without reading.

Resolve cloud ID via `mcp__atlassian__getAccessibleAtlassianResources`.

## Phase 2 — Gather Required Inputs

Required fields (stop and ask if missing — do not invent values):

| Field | Required For | Notes |
|-------|--------------|-------|
| Project key | CREATE | Call `getVisibleJiraProjects` if unknown |
| Issue type | CREATE | Story, Task, Bug, Epic, Spike, Sub-task, Improvement |
| Summary | CREATE, UPDATE | One line, imperative voice, under 100 chars |
| Description | CREATE, UPDATE | Multi-section — see Phase 3 |
| Epic parent | Non-bug, non-epic | Enforced by `lisa:jira-verify` |
| Priority | CREATE | Default to project default if unstated |
| Acceptance criteria | Story, Task, Bug, Sub-task, Improvement | Gherkin — see Phase 3 |
| Validation Journey | Runtime-behavior changes | Delegate to `/jira-add-journey` |
| Target backend environment | Runtime-behavior changes | `dev` / `staging` / `prod`; recorded in description (Phase 3). Skip only for doc/config/type-only tickets. |
| Sign-in account / credentials | Tickets that touch authenticated surfaces | Name the account (or source — 1Password item, env var, seeded fixture) and role; recorded in description (Phase 3). Omit when sign-in is not required. |
| Single-repo scope | Bug, Task, Sub-task | These types MUST cover one repo only. If the work crosses repos, split it before creating. Epic / Spike / Story may span repos. |

Optional but recommended: assignee, components, fix versions, labels, sprint, story points, reporter.

Use `mcp__atlassian__getJiraProjectIssueTypesMetadata` to verify the issue type exists in the project and discover required custom fields.

## Phase 3 — Description Quality

The description MUST address three audiences. Reject and rewrite if any are missing.

```text
h2. Context / Business Value
[Why this matters. Stakeholder-facing. Concrete user impact or business outcome.
 Link to the originating Slack thread, Notion doc, incident, or customer report.]

h2. Technical Approach
[Developer-facing. Integration points, impacted modules, data model implications,
 relevant tradeoffs. Not a full design doc — a pointer for someone picking it up.]

h2. Acceptance Criteria
# Given <precondition>
  When <action>
  Then <observable outcome>
# Given <precondition>
  When <action>
  Then <observable outcome>

h2. Out of Scope
[Explicit list of what this ticket does NOT cover. Forces scope discipline.]

h2. Target Backend Environment
[Required when the ticket changes runtime behavior. One of: dev / staging / prod.
 This is the environment QA/product reported against and the backend the
 implementer points their local stack at during verification before CI/CD.
 Backend-only tickets state the deployed env they target. Skip section
 entirely for doc-only, config-only, or type-only tickets.]

h2. Sign-in Required
[Include this section ONLY if the work touches authenticated surfaces.
 Specify: the account/role to sign in as, where to get the credentials
 (1Password item name, env var, seeded fixture), and any MFA/SSO notes.
 Omit the section entirely when sign-in is not required — its absence
 means "no sign-in needed for this ticket."]

h2. Repository
[Required for Bug / Task / Sub-task. Name the single repo this ticket covers.
 If the work spans repos, this ticket type is wrong — split into per-repo
 Tasks/Subtasks under a parent Story or Epic. Epic / Spike / Story may
 list multiple repos.]

h2. Validation Journey
[Delegate to /jira-add-journey if the ticket changes runtime behavior.
 Skip only for doc-only, config-only, or type-only tickets.]
```

Rules:
- Every acceptance criterion uses Given/When/Then. No vague "should work" language.
- Every criterion is independently verifiable (UI, API, data, or performance check).
- If the ticket is a Bug, include reproduction steps, expected vs. actual behavior, and environment.
- If the ticket is a Spike, include the question being answered and the definition of done (decision doc, prototype, or findings).
- If sign-in is required, the implementer must be able to sign in from the description alone — never assume they will guess the account or hunt for credentials.

## Phase 4 — Relationship Discovery (Mandatory)

Before creating or updating, find candidate relationships. Do NOT skip — this is the step agents most often omit.

### 4a. Epic Parent

If the ticket is not a Bug and not an Epic, it MUST have an epic parent:

1. If explicitly provided, use it.
2. Otherwise search active epics:
   ```jql
   project = <PROJECT> AND issuetype = Epic AND statusCategory != Done
   ```
   via `mcp__atlassian__searchJiraIssuesUsingJql`. Match on keywords from the summary and description.
3. If no epic matches, stop and ask the human to create or pick one. Do NOT orphan the ticket.

### 4b. Related Tickets

Relationship discovery is **mandatory** on every create and every update — never declare "no related work" without doing both searches below and recording their outcomes on the ticket.

**Search 1: local git history** (catches PRs/commits that touched the same area but were never linked to a ticket):

```bash
# Commits mentioning the keyword
git log --all --oneline --grep="<keyword>"

# Commits that touched the relevant paths
git log --all --oneline -- <path-or-glob>

# Recent activity in this area (last 90 days)
git log --since=90.days --oneline -- <path-or-glob>
```

If the git search surfaces a PR or commit that relates to this work, capture the PR URL — it becomes a remote link (Phase 4c) and may also point to a sibling ticket worth linking.

**Search 2: Jira JQL** (catches open and recently-closed tickets):

```jql
# Open tickets touching the same component
project = <PROJECT> AND component = "<component>" AND statusCategory != Done

# Open tickets with overlapping keywords
project = <PROJECT> AND (summary ~ "<keyword>" OR description ~ "<keyword>") AND statusCategory != Done

# Epic siblings
"Epic Link" = <EPIC-KEY>

# Recent tickets touching the same labels
project = <PROJECT> AND labels in (<labels>) AND updated >= -30d

# Recently closed tickets in the same area (catches duplicates of work just shipped)
project = <PROJECT> AND component = "<component>" AND status = Done AND updated >= -30d
```

**Record the outcome.** Add a `## Relationship Search` subsection (or a comment if updating an existing ticket) listing the queries you ran and what they returned. If the searches yielded nothing, write that explicitly — "Searched git history for `<keywords>` and JQL for component=`X`, label=`Y`, epic siblings; no related work found." A ticket with zero links and no documented search is rejected.

For each candidate, classify the relationship:

| Link Type | When to Use |
|-----------|-------------|
| `blocks` | This ticket must ship before the linked ticket can proceed |
| `is blocked by` | The linked ticket must ship before this one can proceed |
| `relates to` | Shared context, no ordering constraint |
| `duplicates` | This ticket already exists — close one as duplicate |
| `clones` | This ticket was created from the linked one (e.g. per-repo copies) |

### 4c. Remote Links

Identify and attach:
- GitHub PRs, branches, or commits related to this work
- Confluence pages (design docs, RFCs, runbooks)
- Dashboards (Grafana, Datadog, Sentry issue)
- Incident tickets (PagerDuty, Statuspage)
- **Source artifacts from the originating PRD / parent epic**: classify and inherit per the rules in `lisa:jira-source-artifacts` (invoke that skill if you haven't loaded the rules in this session). The short version: enumerate the parent epic's remote links and inherit the ones whose domain matches this ticket's scope (UI → `ui-design` + `ux-flow`; backend → `data`; infra → `ops`; always inherit `reference`). Never assume a developer will walk up to the epic to find design context — attach it here.

If the ticket was generated from a PRD (by `lisa:notion-to-tracker` or similar) and the parent epic has no source artifacts, surface that as a smell and ask whether artifacts were missed during extraction before proceeding.

### 4d. Source Precedence (must appear on the ticket)

Source precedence rules and cross-axis conflict handling are defined in `lisa:jira-source-artifacts` §3 and §4. When a ticket carries both design artifacts and a description, record the precedence explicitly in the ticket description (under Technical Approach or a dedicated `## Source Precedence` subsection) so the implementer doesn't silently reconcile conflicts. Cross-axis conflicts go under `## Open Questions` as BLOCKER items.

For UI-touching tickets, include the existing-component reuse expectation per `lisa:jira-source-artifacts` §7.

### 4e. Live Product Walkthrough Findings (UI-touching tickets)

If the ticket modifies an existing user-facing surface, a `lisa:product-walkthrough` should already have been run upstream (by `lisa:notion-to-tracker` Phase 2b or `lisa:jira-create`). Inherit its findings under a `## Current Product` subsection in the ticket description so the implementer sees what's shipped today before changing it. If the upstream skill skipped the walkthrough but this ticket clearly modifies an existing surface, invoke `lisa:product-walkthrough` here before proceeding.

Use Jira's web UI or `mcp__atlassian__editJiraIssue` to set the `Development` field / remote links where supported.

## Phase 5 — Set Metadata

Before create/update, verify each field is populated where applicable:

- Labels: include at minimum one triage label if relevant (e.g. `claude-triaged-{repo}` is added later by triage, not here)
- Components: map from the modules the work touches
- Fix Version: set if the team uses versioned releases
- Priority: explicit — no "unset"
- Story points: estimate for Story/Task/Bug, skip for Epic/Spike
- Sprint: only if actively sprinting this work
- Assignee: leave unset if unknown rather than auto-assigning

## Phase 5.5 — Validate (Pre-write Gate)

Before any write, invoke `lisa:jira-validate-ticket` with the full proposed spec assembled from Phases 2 / 3 / 4 / 5. Pass it as a YAML block per the `lisa:jira-validate-ticket` schema, including `runtime_behavior_change`, `authenticated_surface`, and `artifacts_attached` flags so the right gates run.

The validator is the **single source of truth** for what makes a valid ticket. The same gates are used by `lisa:notion-to-tracker` dry-run, by `lisa:jira-verify` post-write, and here. Do not re-implement gate logic in this skill — if a gate needs to change, change `lisa:jira-validate-ticket` so every caller benefits.

If the validator reports `FAIL`:
- Surface the failure list and the per-gate remediation to the user.
- Do NOT proceed to Phase 6. Fix the spec (or stop and ask the human) and re-run validation.
- Never call `mcp__atlassian__createJiraIssue` or `mcp__atlassian__editJiraIssue` while the validator's verdict is FAIL.

If the validator reports `PASS`, continue to Phase 6.

## Phase 6 — Create or Update

### CREATE

1. Call `mcp__atlassian__createJiraIssue` with all Phase 2/3/5 fields and the epic parent from Phase 4a.
2. Capture the returned ticket key.
3. For each relationship from Phase 4b, call `mcp__atlassian__createIssueLink` with the correct link type (verify names via `mcp__atlassian__getIssueLinkTypes` if unsure).
4. Attach remote links from Phase 4c.
5. If the ticket changes runtime behavior, invoke the `lisa:jira-add-journey` skill to append the Validation Journey section.

### UPDATE

1. Call `mcp__atlassian__editJiraIssue` with only the fields being changed. Do NOT resend fields that weren't in the change set — it blows away history.
2. Add new relationships via `mcp__atlassian__createIssueLink`. Existing links are not touched unless explicitly removed.
3. If description changes, preserve sections you are not editing. Re-read via `/jira-read-ticket` first.

## Phase 7 — Verify

Call the `lisa:jira-verify` skill on the resulting ticket. `lisa:jira-verify` fetches the live ticket and runs `lisa:jira-validate-ticket` against it — same gates as Phase 5.5, but applied to what JIRA actually stored (catches anything dropped or reformatted on write). If it reports failures, fix them before returning. Do not report success on a ticket that fails verify.

## Phase 8 — Announce

Post a creation comment via `mcp__atlassian__addCommentToJiraIssue` with:
- `[{repo}]` prefix if the ticket is repo-scoped
- Who the ticket is assigned to (if known)
- The relationships that were set (`blocks`, `is blocked by`, `relates to`) with links
- Any remote PRs attached

Skip this step only on UPDATE when no material change was made.

## Rules

- Never create a non-bug ticket without an epic parent.
- Never skip relationship discovery — both the git history search AND the JQL search must run, and their outcomes must be recorded on the ticket. "None found" is acceptable only when it's documented.
- Never create a Bug, Task, or Sub-task that spans multiple repos. Split it before creating.
- Never include a runtime-behavior ticket without a target backend environment, and never include an authenticated-surface ticket without sign-in credentials in the description.
- Never invent custom field values. If the project requires a field you don't have, stop and ask.
- Never overwrite a description without reading the current version first.
- All writes go through this skill so best practices are enforced uniformly. Downstream skills (e.g. `lisa:jira-create`) should delegate here rather than calling the MCP write tools directly.
- The gate logic (what makes a valid ticket) lives in `lisa:jira-validate-ticket`, NOT in this skill. This skill calls the validator at Phase 5.5 (pre-write) and Phase 7 (via `lisa:jira-verify` post-write). When a gate needs to change, change it in `lisa:jira-validate-ticket` — every caller (write path, dry-run path, post-write verify) picks it up automatically.
