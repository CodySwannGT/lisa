---
name: lisa-jira-write-ticket
description: "Creates or updates a JIRA ticket following organizational best practices. Enforces description quality (coding assistant / developer / stakeholder sections), Gherkin acceptance criteria, epic parent relationship, explicit link discovery (blocks / is blocked by / relates to / duplicates / clones), remote links (PRs, Confluence, dashboards), labels, components, fix version, priority, story points, and Validation Journey. Rejects thin tickets — use this skill any time a ticket is created or significantly edited."
allowed-tools: ["Bash", "Skill"]
---

# Write JIRA Ticket: $ARGUMENTS

On runtimes without the rule tree (Antigravity), read **Worth doing** in `lisa-track` for the same value and decline policy.

## Before creating incidental work

Apply `do-it-now`'s **Worth doing** guidance before drafting a new incidental item. Decline low-value observations without writing a ticket or requesting a human gate; report the reason briefly to the caller. A complete spec is not evidence of value. This does not cancel explicit user requests or accepted requirements. Honor prior Not planned decisions through `rejection-detection`, including legacy issues without markers. Accepted work continues through the existing validation and readiness contract below.

## Human-gate release authorization

A release requires a trusted human author, not just matching comment text. Follow
`ready-role-filing` — **Human-gate release authorization**: preserve tracker-supplied comment
author IDs and bot metadata, resolve `trustedHumanActorIds` only from an explicit user instruction
or existing human-authored trusted project policy, and pass it with structured `comments` to every
hold classifier, reconciliation, normalization and release planner. Never derive trust from the
comment body, a display name, the actor's own assertion, or an automation posting on its own behalf.
Missing policy, missing/unreadable author identity, raw body strings, untrusted actors and known bots
cannot discharge a hold. Keep the item held and report the missing authorization; do not silently
replace these inputs with an empty history or an inferred allowlist. Authorized matching releases
continue through the existing path and never override an independently declared caller hold.


All Atlassian operations in this skill go through `lisa-atlassian-access`. Do not call MCP tools or `acli` directly.

Create or update a JIRA ticket with all required relationships, metadata, and quality gates. Every section below is mandatory. Thin tickets are rejected.

Repository name for scoped comments: `basename $(git rev-parse --show-toplevel)`.

## Writing by another path? The gates still apply

A team that talks to its tracker through its own script is doing a normal
thing — the script usually owns the credential plumbing, and Lisa neither
controls nor wants to control it. What that script does NOT get is either half
of this skill's quality gate, and nothing about the write says so.

**A read-back is not the missing check.** A bespoke path almost always re-reads
the ticket after writing and confirms the tracker stored what was sent. That is
worth doing and it is not this. It proves TRANSPORT: the API accepted the
payload and the field values round-tripped. It cannot fail for the reason these
gates exist, because it never looks at whether what was sent was any good — a
ticket with no acceptance criteria, no parent, and a human decision left sitting
in the middle of it round-trips perfectly. That is the dangerous half of the
shape: a failing control gets investigated, a misread one gets trusted.

So a write by any other path still owes both phases, and both run standalone
against an item that already exists:

| Phase | Skill | What it costs you |
|---|---|---|
| Pre-write validate | `lisa-jira-validate-ticket` | Run it on the draft before you send it |
| Post-write verify | `lisa-jira-verify` | Run it on the live ticket after you send it |

```text
Skill(lisa-jira-validate-ticket) with the draft ticket, or with a reference to a live one
Skill(lisa-jira-verify) with PROJ-1234
```

**These are plugin-resident skills invoked through the Skill tool.** They are
not shell scripts and will not appear in any repository's `scripts/` directory,
including yours. An agent that searches the repo it is standing in, finds
nothing, and concludes the capability is absent has made the one mistake that
turns a local script from the convenient option into the only one.

## Phase 1 — Resolve Intent

Determine from $ARGUMENTS and context whether this is a CREATE or UPDATE:

- **CREATE**: no existing ticket key provided
- **UPDATE**: ticket key provided — call `/jira-read-ticket <KEY>` first to load the full current state before editing. Never overwrite without reading.

Resolve the active Atlassian site via `lisa-atlassian-access` `operation: list-sites` (the access skill enforces connection match against `.lisa.config.json`).

## Phase 2 — Gather Required Inputs

Required fields (stop and ask if missing — do not invent values):

| Field | Required For | Notes |
|-------|--------------|-------|
| Project key | CREATE | Resolve from `.lisa.config.json` (`jira.project`); ask the human if not configured |
| Issue type | CREATE | Story, Task, Bug, Epic, Spike, Sub-task, Improvement |
| Summary | CREATE, UPDATE | One line, imperative voice, under 100 chars |
| Description | CREATE, UPDATE | Multi-section — see Phase 3 |
| Epic parent | Non-bug, non-epic | Enforced by `lisa-jira-verify` |
| Priority | CREATE | Default to project default if unstated |
| Acceptance criteria | Story, Task, Bug, Sub-task, Improvement | Gherkin — see Phase 3 |
| Validation Journey | Runtime-behavior changes | Delegate to `/jira-add-journey` |
| Target backend environment | Runtime-behavior changes | For every work type, use an exact `deploy.branches` key when an environment is known. Human: bare key or `Confirmed: <env>`. Automation: `Inferred: <env> — evidence: <title\|body\|reproduction\|hostname>`, `Assumption: <env> — remote default branch <branch>` for a unique reverse-map, or `Assumption: remote default branch <branch>` otherwise. Human confirmation replaces an automated annotation with the bare key or `Confirmed: <env>`. |
| Sign-in account / credentials | Tickets that touch authenticated surfaces | Name the account (or source — 1Password item, env var, seeded fixture) and role; recorded in description (Phase 3). Omit when sign-in is not required. |
| Single-repo scope | Bug, Task, Sub-task, Improvement | These leaf work units MUST cover one repo only. If the work crosses repos, split it before creating. Epic / Spike / Story may span repos. |
| Source Requirement | PRD-sourced tickets (`prd_source` provided) | `h2. Source Requirement` with PRD link + verbatim requirement quote(s) — see Phase 3; enforced at every level, sub-tasks included |

Optional but recommended: assignee, components, fix versions, labels, sprint, story points, reporter.

Issue-type validity and required custom fields are enforced by `lisa-jira-validate-ticket`'s F1 / F4 gates (which run via `lisa-atlassian-access` under the hood). If you need to inspect the metadata directly, request a new operation in `atlassian-access` rather than calling MCP / acli yourself.

## Phase 3 — Description Quality

The description MUST address three audiences. Reject and rewrite if any are missing.

```text
h2. Source Requirement
[Required whenever the ticket originates from a PRD (the caller passes
 `prd_source`). Answers "why was this done?" — cite the PRD and quote the
 requirement(s) VERBATIM, never paraphrased:
 - **PRD**: <PRD title + link> §"<section heading>"
 - **Requirement (R3)**: "<verbatim requirement text from the PRD>"
 One Requirement line per satisfied requirement. Derived / cross-cutting
 work that traces to no single requirement uses the supporting form:
 "Derived work supporting R3, R7 — no single PRD section." Close with:
 "This ticket exists to satisfy the quoted requirement. If implementation
 scope drifts from the quoted text, the PRD is the authority — raise the
 conflict rather than silently reinterpreting it." Omit the section only
 for ad-hoc tickets with no PRD lineage.]

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
[ALWAYS required on a leaf — the SECTION is unconditional, only its
 VALUE is conditional. It is where `runtime_behavior_change` is
 persisted, so omitting it records nothing rather than recording "no".
 When the ticket changes runtime behavior, use an exact
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
 doc-only` (or `config-only` / `type-only`). An Epic/container declares
 `None — container: state rolls up from children`. Visible prose, not an HTML
 comment, for the same reason the Branch Plan provenance line is: JIRA's ADF has
 no comment node. See the `derived-branch-plan` rule.]

h2. Branch Plan
[GENERATED, never hand-authored. Render only when the ticket has a Target
 Backend Environment; omit entirely when `runtime_behavior_change = false`
 (doc-only / config-only / type-only) or for an Epic/container — absence is
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

h2. Sign-in Required
[Include this section ONLY if the work touches authenticated surfaces.
 Specify: the account/role to sign in as, where to get the credentials
 (1Password item name, env var, seeded fixture), and any MFA/SSO notes.
 Omit the section entirely when sign-in is not required — its absence
 means "no sign-in needed for this ticket."]

h2. Repository
[Required for Bug / Task / Sub-task / Improvement. Name the single repo this ticket covers.
If the work spans repos, this ticket type is wrong — split into per-repo
Tasks/Subtasks under a parent Story or Epic. Epic / Spike / Story may
list multiple repos.]

h2. Validation Journey
[Delegate to /jira-add-journey if the ticket changes runtime behavior.
 Skip only for doc-only, config-only, or type-only tickets. Cross-work-item
 evidence pointers use `[EVIDENCE-REF: <work-item-ref> | <artifact-type>: <kebab-case-name>]`;
 they never replace this ticket's local S14 marker.]
```

Rules:
- PRD-sourced tickets (caller passed `prd_source`) MUST carry the Source Requirement section with verbatim quotes — paraphrases are rejected (validator gate S16). This applies at every level, sub-tasks included: a leaf claimed in isolation must explain its own "why".
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
   via `lisa-atlassian-access` `operation: search-issues jql: "<query>"`. Match on keywords from the summary and description.
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
- **Source artifacts from the originating PRD / parent epic**: classify and inherit per the rules in `lisa-tracker-source-artifacts` (invoke that skill if you haven't loaded the rules in this session). The short version: enumerate the parent epic's remote links and inherit the ones whose domain matches this ticket's scope (UI → `ui-design` + `ux-flow`; backend → `data`; infra → `ops`; always inherit `reference`). Never assume a developer will walk up to the epic to find design context — attach it here.

If the ticket was generated from a PRD (by `lisa-notion-to-tracker` or similar) and the parent epic has no source artifacts, surface that as a smell and ask whether artifacts were missed during extraction before proceeding.

### 4d. Source Precedence (must appear on the ticket)

Source precedence rules and cross-axis conflict handling are defined in `lisa-tracker-source-artifacts` §3 and §4. When a ticket carries both design artifacts and a description, record the precedence explicitly in the ticket description (under Technical Approach or a dedicated `## Source Precedence` subsection) so the implementer doesn't silently reconcile conflicts. Cross-axis conflicts go under `## Open Questions` as BLOCKER items.

For UI-touching tickets, include the existing-component reuse expectation per `lisa-tracker-source-artifacts` §7.

### 4e. Live Product Walkthrough Findings (UI-touching tickets)

If the ticket modifies an existing user-facing surface, a `lisa-product-walkthrough` should already have been run upstream (by `lisa-notion-to-tracker` Phase 2b or `lisa-jira-create`). Inherit its findings under a `## Current Product` subsection in the ticket description so the implementer sees what's shipped today before changing it. If the upstream skill skipped the walkthrough but this ticket clearly modifies an existing surface, invoke `lisa-product-walkthrough` here before proceeding.

Use Jira's web UI or `lisa-atlassian-access` `operation: write-ticket` (UPDATE form) to set the `Development` field / remote links where supported.

## Phase 5 — Set Metadata

Before create/update, verify each field is populated where applicable:

- Labels: include at minimum one triage label if relevant (e.g. `claude-triaged-{repo}` is added later by triage, not here)
- Components: map from the modules the work touches
- Fix Version: set if the team uses versioned releases
- Priority: explicit — no "unset"
- Story points: estimate for Story/Task/Bug, skip for Epic/Spike
- Sprint: only if actively sprinting this work
- Assignee: leave unset if unknown rather than auto-assigning

### Build-ready control input (`build_ready`)

`build_ready` is a write-control input governed by the `ready-role-filing` rule — cite that slug for the full contract; do not restate its per-vendor normalization table here. It decides whether a **leaf** work unit is promoted to the build-ready role on create. It never overrides `leaf-only-lifecycle` — a container is never promoted regardless of `build_ready`. Unlike the label-based trackers, JIRA tickets are **already created not-ready** (in the project's default initial status, e.g. `TODO`/`Backlog`); the build-ready role is the configured `ready` status (`jira.workflow.ready`, default `Ready`), reached by an explicit transition. JIRA is the vendor whose behavior the other two converged onto — this arm is unchanged by that normalization.

- **Omitted** → **not build-ready**: leave the ticket in the project's default created status. No transition. Ready is an explicit claim, never a vendor default.
- **`build_ready: false`** → same outcome as omitted, stated deliberately: the ticket waits in the project's default status for a human to promote it.
- **`build_ready: true`** → after create, transition the **leaf** to the resolved `ready` role so `lisa-intake` / `lisa-jira-build-intake` auto-picks it up (see Phase 6 CREATE step). Resolve the role name with the standard pattern (`.jira.workflow.ready` // `Ready`, local overrides global). Best-effort: if the transition is unreachable, record it and leave the ticket in its default status rather than failing the write.

**A filing with neither is an incomplete handoff.** A leaf that is not build-ready must carry an explicit `human_gate: "<why a human must judge this first>"`; nothing in the ready status means nothing ever claims it. When `human_gate` is supplied, stamp the hold on the ticket so it is auditable — a visible line plus the verbatim marker:

```text
Held for a human product call: <reason>.
<!-- [lisa-human-gate] reason=<short-slug> -->
```

**Stamp both surfaces, not just the marker.** Also apply the configured `human_needed` marker
label (`jira.labels.human_needed`, default `Human Needed`) to the ticket, via the ticket's `labels` field. The marker in the body and the label say the same thing,
and a filing that carries only one of them is a **half-armed gate**: sweeps that read the body
honour it, and sweeps that read labels do not. That is not hypothetical — the repair sweep that
normalizes items carrying no lifecycle label keys on the *absence* of `human_needed`, so a
marker-only hold was its population by construction and got promoted into the build queue (#3805).
The marker remains the authoritative declaration; the label is what makes the hold visible to a
person scanning a board and to any path that has not yet been routed through the shared reader.
If the label does not exist in the tracker, create it, or record that it could not be applied and
proceed — the marker still holds. Never file the label *instead of* the marker.

**Write a `reason=` the release can name.** The hold's reason is not decoration: a hold ends when a
`[lisa-human-gate-release]` comment repeating that same `reason=` is recorded on the item by an authorized human, and the
next intake sweep then takes the marker label off and puts the item back in the build-ready role on
its own. Matching is per-reason so that a hold declared *after* an earlier release is not born
discharged. A keyless hold is legal and is discharged by a keyless release; a hold whose reason is a
paragraph is legal and nobody will reproduce it. Prefer a short slug the person answering it can
retype. Do **not** instruct anyone to delete the marker from the description to lift the hold — the
only body write available is a whole-body replacement, so that asks them to rewrite the whole record
to clear one line, which is why answered holds accumulated instead of being lifted
(CodySwannGT/lisa#3852). The marker stays as history; the release is recorded beside it.

If a leaf arrives with `build_ready` omitted or `false` **and** no `human_gate`, do not create it: report the incomplete handoff and name both ways to resolve it (`build_ready: true`, or a `human_gate` reason). Containers are exempt — their status rolls up from children, so they need neither.

## Phase 5.5 — Validate (Pre-write Gate)

Before any write, invoke `lisa-jira-validate-ticket` with the full proposed spec assembled from Phases 2 / 3 / 4 / 5. Pass it as a YAML block per the `lisa-jira-validate-ticket` schema, including `runtime_behavior_change`, `authenticated_surface`, and `artifacts_attached` flags so the right gates run.

The validator is the **single source of truth** for what makes a valid ticket. The same gates are used by `lisa-notion-to-tracker` dry-run, by `lisa-jira-verify` post-write, and here. Do not re-implement gate logic in this skill — if a gate needs to change, change `lisa-jira-validate-ticket` so every caller benefits.

If the validator reports `FAIL`:
- Surface the failure list and the per-gate remediation to the user.
- Do NOT proceed to Phase 6. Fix the spec (or stop and ask the human) and re-run validation.
- Never invoke `lisa-atlassian-access` with `operation: write-ticket` while the validator's verdict is FAIL.

If the validator reports `PASS`, continue to Phase 6.

## Phase 6 — Create or Update

Before calling `lisa-atlassian-access`, keep the description in Lisa's normal Markdown/wiki-heading authoring shape; the access layer owns conversion through `scripts/markdown-to-adf.mjs` and writes ADF to JIRA. This is required because acli stores raw Markdown/wiki text as one literal paragraph when no ADF object is provided. Post-write verification must confirm the live description contains ADF `heading` nodes for the required sections, not literal `##` / `h2.` text in a paragraph.

### CREATE

1. Invoke `lisa-atlassian-access` via the Skill tool with `operation: write-ticket payload: {...}` containing all Phase 2/3/5 fields and the epic parent from Phase 4a (CREATE form — no existing key).
2. Capture the returned ticket key.
3. For each relationship from Phase 4b, invoke `lisa-atlassian-access` with `operation: link from: <K1> to: <K2> type: "<link-type>"`. Use the exact link-type names supported by the project; surface errors if an unknown type is passed.
4. Attach remote links from Phase 4c (via `lisa-atlassian-access` `operation: write-ticket` UPDATE form or whatever remote-link operation is dispatched).
5. If the ticket changes runtime behavior, invoke the `lisa-jira-add-journey` skill to append the Validation Journey section.
6. **Build-ready promotion (only when `build_ready: true` and the ticket is a leaf work unit):** transition the new ticket to the resolved `ready` status via `lisa-atlassian-access` `operation: transition key: <K> to: "<ready-status>"` (resolve `<ready-status>` as `.jira.workflow.ready` // `Ready`, local overrides global). Skip this step entirely when `build_ready` is omitted or `false`, or for any container. If the transition is unreachable, record it and leave the ticket in its default status — do not fail the write.

### UPDATE

1. Invoke `lisa-atlassian-access` with `operation: write-ticket payload: {key: <K>, ...fields-being-changed}`. Do NOT resend fields that weren't in the change set — it blows away history.
2. Add new relationships via `lisa-atlassian-access` `operation: link from: <K1> to: <K2> type: "<link-type>"`. Existing links are not touched unless explicitly removed.
3. If description changes, preserve sections you are not editing. Re-read via `/jira-read-ticket` first, including any existing canonical managed `## Lisa Usage` section unless the caller intentionally supplied an updated canonical section. Use the shared `lisa-usage-accounting` serializer/merge path rather than freehand edits to ledger rows.

## Phase 7 — Verify

Call the `lisa-jira-verify` skill on the resulting ticket. `lisa-jira-verify` fetches the live ticket and runs `lisa-jira-validate-ticket` against it — same gates as Phase 5.5, but applied to what JIRA actually stored (catches anything dropped or reformatted on write, including Markdown/wiki descriptions that degraded into one literal text paragraph instead of ADF heading nodes). If it reports failures, fix them before returning. Do not report success on a ticket that fails verify.

## Phase 8 — Announce

Post a creation comment via `lisa-atlassian-access` `operation: comment key: <K> body: "..."` with:
- `[{repo}]` prefix if the ticket is repo-scoped
- Who the ticket is assigned to (if known)
- The relationships that were set (`blocks`, `is blocked by`, `relates to`) with links
- Any remote PRs attached

Skip this step only on UPDATE when no material change was made.

## Writing by a bespoke path (your own script, direct API or GraphQL)

Nothing here stops a consumer from writing to JIRA through the JIRA REST API directly, `acli`, or your own script, and nothing should
try to — a script that owns the credential plumbing is often the only practical transport.
**The transport is not the gate.** A bespoke write path still owes both halves of the quality
gate this skill runs, and owes them explicitly, because no phase of this flow will ever run
for it.

A bespoke script's own read-back does not discharge either obligation. Re-reading the ticket
and confirming JIRA stored what was sent **proves transport, not quality**: it shows the
fields round-tripped and says nothing about whether what was sent clears a single gate. An
agent that reads `VERIFIED` out of such a script has been told the ticket was checked when it
was not. Measured once, on one ticket, on 2026-09-03 (CodySwannGT/lisa#3663): a local
script's read-back was clean on every field, and the ticket then failed gates S5, S9 and S18
when the validator was run against it by hand.

What a bespoke write path still owes — the same two checks, invoked by hand:

1. **Pre-write validate**, the obligation Phase 5.5 discharges here. Invoke `lisa-jira-validate-ticket` via
   the Skill tool with the proposed spec as a YAML block **before** writing. Never write on a
   `FAIL` verdict.
2. **Post-write verify**, the obligation Phase 7 discharges here. Invoke `lisa-jira-verify` via the
   Skill tool with the identifier of the ticket you just wrote — or `lisa-jira-validate-ticket` directly in
   identifier mode, which fetches and validates the live state. Never report success on a
   `FAIL` verdict.

Both run standalone against an existing live ticket; `lisa-jira-validate-ticket` documents the copy-pasteable
invocation under its standalone entry point.

**Three outcomes, never two.** `PASS`, `FAIL` and *could not validate* are distinct results.
If the validator did not run to a verdict — the skill was unavailable, a credential was
missing, the ticket could not be fetched — that is **not** a pass. Report it as unvalidated and
say why. Collapsing "could not validate" into "validated" is the same misreading as trusting
a read-back.

**These are skills, not scripts.** `lisa-jira-validate-ticket` and `lisa-jira-verify` are plugin-resident and invoked
through the Skill tool. They are **not** expected to appear in any repository's `scripts/`
directory, and their absence from one is not evidence that the capability is missing —
searching the repository you happen to be standing in is the wrong search.

## Rules

- Never create a non-bug ticket without an epic parent.
- Never skip relationship discovery — both the git history search AND the JQL search must run, and their outcomes must be recorded on the ticket. "None found" is acceptable only when it's documented.
- Never create a Bug, Task, Sub-task, or Improvement that spans multiple repos. Split it before creating.
- Never include a runtime-behavior ticket without a target backend environment, and never include an authenticated-surface ticket without sign-in credentials in the description.
- Never invent custom field values. If the project requires a field you don't have, stop and ask.
- Never overwrite a description without reading the current version first.
- Preserve an existing canonical `## Lisa Usage` section on update; never append a second usage
  section or silently drop ledger rows.
- All writes go through this skill so best practices are enforced uniformly. Downstream skills (e.g. `lisa-jira-create`) should delegate here rather than invoking `lisa-atlassian-access` write operations directly.
- The gate logic (what makes a valid ticket) lives in `lisa-jira-validate-ticket`, NOT in this skill. This skill calls the validator at Phase 5.5 (pre-write) and Phase 7 (via `lisa-jira-verify` post-write). When a gate needs to change, change it in `lisa-jira-validate-ticket` — every caller (write path, dry-run path, post-write verify) picks it up automatically.
