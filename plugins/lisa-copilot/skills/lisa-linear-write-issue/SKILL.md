---
name: lisa-linear-write-issue
description: "Creates or updates a Linear work item — Project (Epic), Issue (Story), or sub-Issue (Sub-task) — following organizational best practices. Polymorphic: dispatches internally on issue_type to save_project (Epic) or save_issue (Story / Sub-task). Enforces description quality (three audiences), Gherkin acceptance criteria, project-as-parent for Stories, parentId for Sub-tasks, explicit relationship discovery (blocks / is blocked by / relates to / duplicates), labels, components-as-labels, project milestones for fix versions, native priority and estimate fields, and Validation Journey. Rejects thin items — use this skill any time a Linear work item is created or significantly edited."
allowed-tools: ["Bash", "Skill"]
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
| `Epic` | **Project** | `lisa-linear-access operation: save-project` | (none — Projects are top-level within a team) |
| `Story` / `Task` / `Improvement` | **Issue** | `lisa-linear-access operation: save-issue` | `projectId` (the Epic Project) |
| `Sub-task` | **sub-Issue** | `lisa-linear-access operation: save-issue` | `parentId` (the Story Issue) |
| `Bug` | **Issue** | `lisa-linear-access operation: save-issue` | `projectId` if part of an Epic; else top-level |
| `Spike` | **Issue** | `lisa-linear-access operation: save-issue` | `projectId` if part of an Epic; else top-level |

The build lifecycle uses native **workflow states** (`Ready`, `In Progress`, `Blocked`, `On Dev`, `On Stg`, `Done`, plus an optional review state a project may bind), resolved per role from `linear.workflow` — see "Why Linear uses states, not labels" in `config-resolution`. A new **leaf** work unit is created in the configured `ready` state only on explicit `build_ready: true`; omitted or `false` leaves it in the team's default backlog state, and a container is never put in `ready` at all (see the Build-ready control input below).

## Phase 1 — Resolve Intent

Determine from `$ARGUMENTS` and context whether this is a CREATE or UPDATE:

- **CREATE**: no existing identifier provided.
- **UPDATE**: identifier provided (`<TEAM>-<n>` for Issue, project slug + short-id for Project) — call `/linear-read-issue <ref>` first to load the full current state. Never overwrite without reading.

Resolve the team ID for `linear.teamKey` via `lisa-linear-access operation: list-teams({query: <teamKey>})`. Cache it.

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
| Target backend environment | Runtime-behavior changes | For every work type, use an exact `deploy.branches` key when an environment is known. Human: bare key or `Confirmed: <env>`. Automation: `Inferred: <env> — evidence: <title\|body\|reproduction\|hostname>`, `Assumption: <env> — remote default branch <branch>` for a unique reverse-map, or `Assumption: remote default branch <branch>` otherwise. Human confirmation replaces an automated annotation with the bare key or `Confirmed: <env>`. |
| Sign-in account / credentials | Items that touch authenticated surfaces | Name the account (or source — 1Password item, env var, seeded fixture) and role; recorded in description. Omit when sign-in is not required. |
| Single-repo scope | Bug, Task, Sub-task | These types MUST cover one repo only. If the work crosses repos, split it before creating. Epic / Spike / Story may span repos. |
| Source Requirement | PRD-sourced Issues (`prd_source` provided) | `## Source Requirement` with PRD link + verbatim requirement quote(s) — see Phase 3; enforced at every level, sub-issues included. |

Optional but recommended: assignee, estimate (story points), labels, project milestone (fix-version equivalent), cycle.

## Phase 3 — Description Quality

Linear descriptions are markdown (NOT Jira wiki markup — no `h2.` headings, use `##` instead). The description MUST address three audiences. Reject and rewrite if any are missing.

```markdown
## Source Requirement
[Required whenever the Issue originates from a PRD (the caller passes
 `prd_source`). Answers "why was this done?" — cite the PRD and quote the
 requirement(s) VERBATIM, never paraphrased:
 - **PRD**: <PRD title + link> §"<section heading>"
 - **Requirement (R3)**: "<verbatim requirement text from the PRD>"
 One Requirement line per satisfied requirement. Derived / cross-cutting
 work that traces to no single requirement uses the supporting form:
 "Derived work supporting R3, R7 — no single PRD section." Close with:
 "This Issue exists to satisfy the quoted requirement. If implementation
 scope drifts from the quoted text, the PRD is the authority — raise the
 conflict rather than silently reinterpreting it." Omit the section only
 for ad-hoc Issues with no PRD lineage.]

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
[ALWAYS required on a leaf — the SECTION is unconditional, only its
 VALUE is conditional. It is where `runtime_behavior_change` is
 persisted, so omitting it records nothing rather than recording "no".
 When the item changes runtime behavior, use an exact
 `deploy.branches` key. A human-confirmed value is a bare key or
 `Confirmed: <env>`. An automated evidence write is
 `Inferred: <env> — evidence: <title|body|reproduction|hostname>`; an automated
 generic default is `Assumption: <env> — remote default branch <branch>`.
 Without a unique reverse-map use `Assumption: remote default branch <branch>`.
 Human confirmation replaces the automated annotation with a bare key or
 `Confirmed: <env>`. ALWAYS render this section — it is where
 `runtime_behavior_change` is persisted, and an absent section reads as
 *underivable*, not exempt. Work that changes no runtime behavior declares the
 exemption in place of an environment: `None — no runtime behavior change:
 doc-only` (or `config-only` / `type-only`). A Project/container declares
 `None — container: state rolls up from children`. Visible prose, not an HTML
 comment, for the same reason the Branch Plan provenance line is: a marker that
 survives in only one representation cannot be a vendor-neutral discriminator,
 and every tracker this contract binds stores its body in some rich-text or
 structured form that need not preserve HTML comments. A declaration a reader
 can see is one every backend can store. See the `derived-branch-plan` rule.]

## Branch Plan
[GENERATED, never hand-authored. Render only when the item has a Target
 Backend Environment; omit entirely when `runtime_behavior_change = false`
 (doc-only / config-only / type-only) or for a Project/container — absence is
 correct there. Derive per the `derived-branch-plan` rule: resolve the
 environment, map it forward through `.lisa.config.json` `deploy.branches`,
 and prove the branch exists on the remote. Do not accept caller-supplied
 branches; recompute them. Exactly three lines:
   Branch from: <branch>
   PR into: <branch>
   Derived from: Target Backend Environment <env> via .lisa.config.json deploy.branches
 Both fields name the same branch by construction. A missing, ambiguous, or
 non-unique mapping, or a branch absent from the remote, STOPS the write —
 never default to `main` or the remote default to keep the write alive.]

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
 Skip only for doc-only, config-only, or type-only items. Cross-work-item
 evidence pointers use `[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]`;
 they never replace this item's local S14 marker.]
```

Rules:
- PRD-sourced Issues (caller passed `prd_source`) MUST carry the Source Requirement section with verbatim quotes — paraphrases are rejected (validator gate S16). This applies at every level, sub-issues included: a leaf claimed in isolation must explain its own "why".
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
   lisa-linear-access operation: list-projects({team: <teamKey>, state: ["backlog", "planned", "started"]})
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
lisa-linear-access operation: list-issues({project: <projectId>, state_type: ["unstarted", "started"]})

# Open items with overlapping keywords (workspace-wide)
lisa-linear-access operation: list-issues({query: "<keyword>", state_type: ["unstarted", "started"]})

# Items with shared labels
lisa-linear-access operation: list-issues({label: "<label>", updatedAt: ">-30d"})

# Recently closed items in the same Project
lisa-linear-access operation: list-issues({project: <projectId>, state_type: ["completed", "canceled"], updatedAt: ">-30d"})
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
- **Source artifacts from the originating PRD / parent Project**: classify and inherit per the rules in `lisa-tracker-source-artifacts` (invoke that skill if you haven't loaded the rules in this session). Enumerate the parent Project's links and inherit the ones whose domain matches this item's scope (UI → `ui-design` + `ux-flow`; backend → `data`; infra → `ops`; always inherit `reference`). Never assume a developer will walk up to the Project to find design context — attach it here.

If the item was generated from a PRD (by `lisa-notion-to-tracker` or similar) and the parent Project has no source artifacts, surface that as a smell and ask whether artifacts were missed during extraction before proceeding.

### 4d. Source Precedence (must appear on the item)

Source precedence rules and cross-axis conflict handling are defined in `lisa-tracker-source-artifacts` §3 and §4. When an item carries both design artifacts and a description, record the precedence explicitly in the description (under Technical Approach or a dedicated `## Source Precedence` subsection) so the implementer doesn't silently reconcile conflicts. Cross-axis conflicts go under `## Open Questions` as BLOCKER items.

For UI-touching items, include the existing-component reuse expectation per `lisa-tracker-source-artifacts` §7.

### 4e. Live Product Walkthrough Findings (UI-touching items)

If the item modifies an existing user-facing surface, a `lisa-product-walkthrough` should already have been run upstream. Inherit its findings under a `## Current Product` subsection in the description so the implementer sees what's shipped today before changing it. If the upstream skill skipped the walkthrough but this item clearly modifies an existing surface, invoke `lisa-product-walkthrough` here before proceeding.

## Phase 5 — Set Metadata

Before create/update, verify each field is populated where applicable:

- **Workflow state**: set the resolved `ready` state (`linear.workflow.ready`, default `Ready`) on a new **leaf** work unit (Bug / Task / Sub-task / Improvement with no child work) per `leaf-only-lifecycle`, **only on explicit `build_ready: true`** (see the Build-ready control input below). A container (Epic Project / Story with sub-issues / Spike) is never put in the build-ready state.
- **Labels**: taxonomy only — `type:<Kind>`, `repo:<name>`, `component:<name>`, and the `prd-intake-feedback` sentinel. Lifecycle is **not** a label on Linear; do not add `status:*` labels.
- **Native priority field**: 0–4 per Linear's scale; explicit, not "unset".
- **Native estimate**: per Linear's team-configured estimate scale (often 0–8 Fibonacci); skip for Epic / Spike.
- **ProjectMilestone**: when the team uses dated milestones, set the milestone on the Project (Epic) or on the Issue (when an Issue belongs to a milestone).
- **Cycle**: only if actively in a cycle.
- **Assignee**: leave unset if unknown rather than auto-assigning.

For Bug / Task / Sub-task, ensure the summary is prefixed with `[<repo-name>]`.

### Build-ready control input (`build_ready`)

`build_ready` is a write-control input governed by the `ready-role-filing` rule — cite that slug for the full contract; do not restate its per-vendor normalization table here. It decides whether a **leaf** work unit is created **in the resolved `ready` workflow state**. It never overrides `leaf-only-lifecycle` — a container is never stamped build-ready regardless of `build_ready`. "Not build-ready" is not a special state: the Issue is simply left in the team's default backlog/unstarted state, which a human can promote later. This mirrors `lisa-jira-write-ticket`, because Linear is a state-driven tracker like JIRA, not a label-driven one like GitHub.

- **Omitted** → **not build-ready**: the leaf is left in the team's default backlog state. Ready is an explicit claim, never a vendor default. **This is a breaking change** — Linear previously created a leaf directly in the `ready` state on omission, so a caller that relied on that must now pass `build_ready: true`.
- **`build_ready: false`** → create the leaf **without** the `ready` state, leaving it in the team's default backlog state so it waits for a human to review and promote it into the queue.
- **`build_ready: true`** → declare `lifecycle_role: ready` so the access layer resolves `.linear.workflow.ready` and places the leaf there, and `lisa-intake` / `lisa-linear-build-intake` auto-picks it up. Best-effort **for the lane, never for the guard**: an access-layer refusal (`ready` unbound, absent from the team, ambiguous) is fail-closed and is never worked around here — surface its message verbatim, do not fail the write, leave the Issue in its default state and record the reason. The Issue is still created; what is refused is the unproven lane placement, which is the safe half to lose.

**A filing with neither is an incomplete handoff.** A leaf that is not build-ready must carry an explicit `human_gate: "<why a human must judge this first>"`; nothing in the ready lane means nothing ever claims it. When `human_gate` is supplied, stamp the hold on the Issue so it is auditable — a visible line plus the verbatim marker:

```text
Held for a human product call: <reason>.
<!-- [lisa-human-gate] reason=<short-slug> -->
```

If a leaf arrives with `build_ready` omitted or `false` **and** no `human_gate`, do not create it: report the incomplete handoff and name both ways to resolve it (`build_ready: true`, or a `human_gate` reason). Containers are exempt — their state rolls up from children, so they need neither.

## Phase 5.5 — Validate (Pre-write Gate)

Before any write, invoke `lisa-linear-validate-issue` with the full proposed spec assembled from Phases 2 / 3 / 4 / 5. Pass it as a YAML block per the `lisa-linear-validate-issue` schema, including `runtime_behavior_change`, `authenticated_surface`, and `artifacts_attached` flags so the right gates run.

The validator is the **single source of truth** for what makes a valid Linear work item. The same gates are used by `lisa-linear-to-tracker` dry-run, by `lisa-linear-verify` post-write, and here. Do not re-implement gate logic in this skill.

If the validator reports `FAIL`:
- Surface the failure list and the per-gate remediation to the user.
- Do NOT proceed to Phase 6. Fix the spec (or stop and ask the human) and re-run validation.
- Never call `lisa-linear-access operation: save-project` or `lisa-linear-access operation: save-issue` while the validator's verdict is FAIL.

If the validator reports `PASS`, continue to Phase 6.

## Phase 6 — Create or Update

### CREATE — Epic (Project)

1. Resolve any required Project labels (`prd-ticketed`, etc.) via `lisa-linear-access operation: list-project-labels` (create via `lisa-linear-access operation: create-project-label` if missing).
2. Call `lisa-linear-access operation: save-project` with: `name` (summary), `description` (markdown), `teamIds: [<teamId>]`, `labelIds`, `priority` (Linear Project priority is also 0–4), `state` (default `backlog`), milestones if dated.
3. Capture the returned Project ID and slug — Phase 4 children need these.
4. If the Project is the parent for downstream Stories, record the ID for `lisa-linear-to-tracker` Phase 4 to use.

### CREATE — Story / Task / Bug / Spike / Improvement (Issue with projectId)

1. Resolve any required Issue labels (`type:<Kind>`, `repo:<name>`, `component:<name>`, `prd-intake-feedback` only if this is a sentinel issue) via `lisa-linear-access operation: list-issue-labels` (create via `lisa-linear-access operation: create-issue-label` if missing). Separately, place a **leaf** work unit in the `ready` lane by passing `lifecycle_role: ready` on the create call below — and only on **explicit `build_ready: true`**, per the Build-ready control input below. Omit the role for a container, and for a leaf whose `build_ready` is `false` or omitted, which then waits in the team's default backlog state for a human to promote it. Ready is an explicit claim, never an omission's default. Never resolve a state ID here and pass it as `stateId`: the access layer resolves the configured `ready` state itself and refuses anything else.
2. Call `lisa-linear-access operation: save-issue` with: `team` (teamId), `title` (summary), `description` (markdown), `projectId` (the Epic Project), `priority` (0–4), `estimate`, `labelIds`, `assignee` if known.
3. Capture the returned identifier (e.g. `ENG-123`) — Phase 4 sub-tasks need it as `parentId`.
4. Add relationships from Phase 4b via `save_issue` (relations field) or paired relation calls.
5. If the item changes runtime behavior, invoke `lisa-linear-add-journey` to append the Validation Journey section.

### CREATE — Sub-task (Issue with parentId)

1. Resolve labels as above. A Sub-task is a **leaf**, so the same ready-lane rule applies: pass `lifecycle_role: ready` on the create call below only on explicit `build_ready: true`, and omit it otherwise. Never resolve a state ID here.
2. Call `lisa-linear-access operation: save-issue` with: `team` (teamId), `title` (`[<repo>] <summary>` prefix is mandatory), `description` (markdown), `parentId` (the Story Issue ID), `projectId` (inherit from parent), `priority`, `estimate`, `labelIds`, plus `lifecycle_role: ready` when `build_ready` is explicitly `true`.
3. Capture identifier.
4. Add relationships via Phase 4b.

### UPDATE

1. Call `lisa-linear-access operation: save-project` or `lisa-linear-access operation: save-issue` with **only the fields being changed**. Do NOT resend fields that weren't in the change set — Linear treats the call as a full overwrite of the listed fields.
2. Preserve description sections you are not editing — re-read via `/linear-read-issue` first, including any existing canonical managed `## Lisa Usage` section unless the caller intentionally supplied an updated canonical section. Use the shared `lisa-usage-accounting` serializer/merge path rather than freehand edits to ledger rows.

## Phase 7 — Verify

Call the `lisa-linear-verify` skill on the resulting item. `lisa-linear-verify` fetches the live item and runs `lisa-linear-validate-issue` against it — same gates as Phase 5.5, but applied to what Linear actually stored. If it reports failures, fix them before returning. Do not report success on an item that fails verify.

## Phase 8 — Announce

Post a creation comment via `lisa-linear-access operation: save-comment` (on the Issue, or on a sentinel issue under the Project for Epic-level announcements) with:

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
- Preserve an existing canonical `## Lisa Usage` section on update; never append a second usage
  section or silently drop ledger rows.
- All Linear writes go through this skill so best practices are enforced uniformly. Downstream skills (e.g. `lisa-linear-create`) should delegate here rather than calling the MCP write tools directly.
- The gate logic (what makes a valid item) lives in `lisa-linear-validate-issue`, NOT in this skill. This skill calls the validator at Phase 5.5 (pre-write) and Phase 7 (via `lisa-linear-verify` post-write). When a gate needs to change, change it in `lisa-linear-validate-issue` — every caller picks it up automatically.
- This skill is the destination of the `lisa-tracker-write` shim when `tracker = "linear"`. Vendor-neutral callers (`notion-to-tracker`, `confluence-to-tracker`, `linear-to-tracker`, `github-to-tracker`) MUST go through `lisa-tracker-write`, not call this skill directly.
