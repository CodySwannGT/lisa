# PRD-to-Ticket Intake Workflow

End-to-end pipeline that takes a Notion PRD all the way through JIRA ticket creation, validation, coverage audit, and ultimately into the build flow that opens PRs. The pipeline is composed of two **intake skills** — one on the Notion side, one on the JIRA side — that mirror each other and run on the same `Status = Ready → claim → process → next status` pattern.

## Why this matters

Without this pipeline, the path from PRD to shipped code is manual at every step:
- Someone reads the PRD, decides it's ready, opens JIRA, types in epics/stories/sub-tasks one by one.
- Quality is uneven (Gherkin AC missing on some, no Validation Journey on others, scope spread across repos in one ticket).
- Silent gaps creep in — the PRD has 9 user stories, 8 tickets get created, nobody notices.
- Once tickets exist, someone has to triage them, verify them, and start the build flow per ticket.

This workflow automates the mechanical parts and **uses gates that already exist** (`jira-validate-ticket`, `prd-ticket-coverage`, `jira-verify`, `ticket-triage`) to keep quality high. Humans own the two decision points that matter: "is this PRD ready to be ticketed?" (Notion `Ready`) and "is this ticket ready to be built?" (JIRA `Ready`). Everything in between runs unattended.

## End-to-end pipeline

```
Notion (PRD lifecycle)             JIRA (ticket lifecycle)
─────────────────────              ─────────────────────────
Draft                              (n/a yet)
  ↓ (product flips)
Ready                              (n/a yet)
  ↓ (notion-prd-intake claims)
In Review
  ↓ (validate + coverage)
Blocked  OR  Ticketed   ─────►  To Do
                                   ↓ (PM/human flips)
                                 Ready
                                   ↓ (jira-build-intake claims)
                                 In Progress
                                   ↓ (build flow runs, PR opens)
                                 On Dev
                                   ↓ (downstream — QA, deploy)
                                 ... → Done
  ↑ (after delivery)
Shipped
```

Two human decision points, in bold:
- **Notion `Draft → Ready`** — product says "this PRD is buildable, hand it off."
- **JIRA `To Do → Ready`** — PM/lead says "this individual ticket is ready for the build agent to pick up."

Everything else is automated.

## Setup

### 1. Notion side

Your PRDs need to live in a **database** with a `Status` property whose options are at minimum: `Draft`, `Ready`, `In Review`, `Blocked`, `Ticketed`, `Shipped`. Freeform Notion pages don't have properties, so a database is required.

If your PRDs live as freeform pages today, migrate them into a database. Notion preserves page IDs and URLs through moves, child pages travel with their parents, and discussions stay attached — see the migration sequence used in this repo's session: create a new database via `notion-create-database`, then `notion-move-pages` to relocate each PRD into it.

Recommended schema (matches what `notion-prd-intake` expects):

| Property | Type | Notes |
|----------|------|-------|
| `Name` | Title | Required |
| `Status` | Select (or Status) | `Draft`, `Ready`, `In Review`, `Blocked`, `Ticketed`, `Shipped` — in workflow order |
| `Section (legacy)` | Select | Optional; useful during migration to track the original heading bucket |
| `Owner` | People | Optional |
| `Created` | Created time | Auto |

Recommended views:
- **Board by Status** (kanban) — replicates whatever heading-based layout you used before.
- **Ready for ticketing** (table, filtered to `Status = Ready`) — what `notion-prd-intake` queries.
- **All PRDs** (table) — fallback overview.

### 2. JIRA side

Add a `Ready` status to your JIRA project's workflow, between `To Do` and `In Progress`:

1. **Project settings** (bottom of left sidebar in the project) → **Workflows**, OR (if not visible) cogwheel → **Issues** → **Workflow schemes** → find the scheme for the project.
2. Click the workflow name → **Edit** (creates a draft).
3. **+ Add status**: type `Ready`. **Don't** pick existing `READY FOR STG` / `(Don't Use) Ready for QA` — those have other meanings. Click *Create new status: Ready*.
4. **Set status category to "To Do"** (blue). If you put it in "In Progress", it will skew burndown / cycle-time reports.
5. Drag transitions:
   - `To Do → Ready` (name it `"Ready for Build"` or similar)
   - `Ready → In Progress` (or rely on the existing global "In Progress" transition)
6. **Publish** the draft. JIRA warns about affected issues; confirm.
7. Repeat for each workflow in the scheme if Story / Task / Bug / Sub-task use separate workflows.

Verify after publishing — call `getTransitionsForJiraIssue` on a `To Do` ticket and confirm `Ready` appears as an available transition with category `To Do`.

**Gotcha**: classic (company-managed) JIRA workflow schemes are often shared across projects. If the workflow you edit is also used by other projects, those projects will also gain `Ready`. Check the scheme's "Used by" column before publishing — if you want it scoped to one project, copy the workflow first.

### 3. Environment variables

Both intake skills read configuration from env vars. Set these in your shell config or `.claude/env.local`:

| Variable | Purpose |
|----------|---------|
| `JIRA_PROJECT` | JIRA project key (e.g. `SE`) |
| `JIRA_SERVER` | Atlassian instance host (e.g. `geminisportsanalytics.atlassian.net`) |
| `E2E_BASE_URL` | Frontend URL for `product-walkthrough` (e.g. `https://dev.example.io/`) |
| `E2E_TEST_PHONE` / `E2E_TEST_OTP` / `E2E_TEST_ORG` | Test user credentials |
| `E2E_GRAPHQL_URL` | GraphQL endpoint for verification plans |

If a required value is missing, the skill stops and asks rather than inventing a value.

## Using the workflow

### Notion side: PRD intake

```
/notion-prd-intake <Notion database URL or ID>
```

Example:

```
/notion-prd-intake https://www.notion.so/yourworkspace/28fd00244d7d47c5866876f7de48c0fe
```

**What happens per cycle** (`notion-prd-intake` skill):

1. **Resolve the database** — parse the URL, fetch the database, get the data source ID, confirm the `Status` property has the expected options.
2. **Find Ready PRDs** — query the data source for `Status = Ready`. Empty → exit cleanly.
3. **Process each Ready PRD serially**:
   - **Claim**: set `Status = In Review` (idempotency lock — re-entrant cycles won't double-process).
   - **Dry-run validation** (`notion-to-jira` with `dry_run: true`): plan the ticket hierarchy, run each planned spec through `jira-validate-ticket --spec-only`, return PASS/FAIL with per-gate failures.
   - **Branch on verdict**:
     - **FAIL**: post one Notion comment per failed ticket (gate name + reason + concrete remediation), set `Status = Blocked`. No JIRA tickets are created.
     - **PASS**: invoke `notion-to-jira` with `dry_run: false` to actually write the tickets, post a Notion comment listing created ticket URLs, set `Status = Ticketed`.
   - **Coverage audit (post-Ticketed, mandatory)** via `prd-ticket-coverage`: extract every atomic PRD item (goals, user stories, functional/non-functional requirements, acceptance criteria, important notes, mobile specs, states, permissions, decisions from comments) and verify each one is covered by at least one created ticket.
     - `COMPLETE`: leave at `Ticketed`.
     - `COMPLETE_WITH_SCOPE_CREEP`: post advisory comment, leave at `Ticketed`.
     - `GAPS_FOUND`: post per-gap comments + a summary of which tickets *were* created, transition `Ticketed → Blocked`. Tickets remain in JIRA (they're valid in their own right); the next intake cycle adds the missing scope.
4. **Summary report** with per-PRD outcomes.

When a `Blocked` PRD's comments are addressed, product flips it back to `Ready` and the next cycle picks it up. After product confirms delivery, they flip `Ticketed → Shipped` (this skill never touches `Shipped`).

### JIRA side: build intake

```
/jira-build-intake <project key>
/jira-build-intake "<full JQL filter>"
```

Example:

```
/jira-build-intake SE
```

Or with a narrower filter:

```
/jira-build-intake "project = SE AND component = 'frontend' AND Status = Ready"
```

**What happens per cycle** (`jira-build-intake` skill):

1. **Resolve the query** — bare project key becomes `project = <KEY> AND Status = "Ready" ORDER BY priority DESC, created ASC`. Full JQL is used as-is.
2. **Pre-flight check** — confirm `In Progress` and `On Dev` are reachable transitions. Misconfigured workflow → stop with an actionable message; never invent transitions.
3. **Find Ready tickets** — JQL search. Empty → exit cleanly.
4. **Process each Ready ticket serially**:
   - **Claim**: transition `Ready → In Progress`. Post a `[claude-build-intake]` comment.
   - **Dispatch to `jira-agent`** (the existing per-ticket lifecycle agent), which owns: read full ticket graph (`jira-read-ticket`), pre-flight quality verify (`jira-verify`), analytical triage (`ticket-triage`), routing to the appropriate flow (Build / Fix / Investigate / Improve), progress sync (`jira-sync`), evidence posting (`jira-evidence`).
   - **On success**: transition `In Progress → On Dev`. Post a comment with the PR URL.
   - **On Blocked-by-verify** (`jira-agent`'s gate transitioned to `Blocked` and reassigned): leave it. Surface the count.
   - **On Held-by-triage** (ambiguities found, jira-agent stopped): leave the ticket in `In Progress`. Surface to human.
   - **On error**: leave in `In Progress`, log under "Errors" in the cycle summary.
5. **Summary report**.

`jira-build-intake` never auto-transitions past `On Dev`. Downstream statuses (`On QA`, `Done`) are owned by QA / product / a future verification-intake skill.

## Architecture: composed skills

Both intake skills are thin orchestrators on top of skills you already have. They don't reimplement logic — they sequence existing pieces.

```
notion-prd-intake
├── notion-to-jira (with dry_run flag)
│   ├── jira-source-artifacts (taxonomy + classification rules)
│   ├── product-walkthrough (Playwright-based current-product evaluation)
│   └── jira-write-ticket
│       ├── jira-validate-ticket (the gate; pre-write)
│       ├── jira-add-journey (Validation Journey appender)
│       └── jira-verify (post-write check, also delegates to jira-validate-ticket)
└── prd-ticket-coverage (post-write coverage audit)

jira-build-intake
└── jira-agent (per-ticket lifecycle)
    ├── jira-read-ticket
    ├── jira-verify
    ├── ticket-triage
    ├── (build / fix / investigate flows — dispatched per ticket type)
    ├── jira-sync
    └── jira-evidence
```

**Single source of truth for gate logic**: `jira-validate-ticket`. The same gates run pre-write (inside `jira-write-ticket`), post-write (inside `jira-verify`), and dry-run (inside `notion-to-jira` dry-run mode used by `notion-prd-intake`). Change a gate definition there; every caller picks it up.

**Single source of truth for source-artifact rules**: `jira-source-artifacts`. The taxonomy (Figma `/proto/` → `ux-flow`, plain Figma → `ui-design`, Lovable → `ux-flow`, etc.), source precedence, inheritance rules, and preservation gate are defined here and referenced by `notion-to-jira`, `jira-create`, `jira-write-ticket`.

**Single source of truth for live-product methodology**: `product-walkthrough`. Used by `notion-to-jira` Phase 2b (PRD intake) and by ticket-creation flows that touch existing user-facing surfaces.

## Operational notes

### Idempotency

Both intake skills use claim-first ordering: the `Ready → In Review` (Notion) and `Ready → In Progress` (JIRA) transitions happen *before* any other work. A re-entrant cycle's `Status = Ready` filter will not see claimed items, so the second run skips them. Safe to run two cycles overlapping in time as long as they target the same database/project — but the skills are designed for serial execution.

### Failure isolation

A single failed PRD or ticket does not stop the cycle. Errors are caught, recorded under "Errors" in the summary, and the cycle continues with the next item. Items that errored mid-flight are left in their claimed status (`In Review` or `In Progress`) for human investigation — never silently transitioned back.

### What the agents own vs. what humans own

| Status | Owner | Why |
|--------|-------|-----|
| Notion `Draft` | Product | Authoring; agent never touches |
| Notion `Ready` | Product | Hand-off signal |
| Notion `In Review` | Agent | Claim lock |
| Notion `Blocked` | Agent (sets), Product (resolves) | Gate failures with comments |
| Notion `Ticketed` | Agent | Tickets created + coverage verified |
| Notion `Shipped` | Product | Post-delivery confirmation; agent never touches |
| JIRA `To Do` | Default for new tickets | Agent never sets/changes |
| JIRA `Ready` | PM/human | Per-ticket build readiness signal |
| JIRA `In Progress` | Agent | Claim lock |
| JIRA `On Dev` | Agent | Build complete + PR ready |
| JIRA `Blocked` | `jira-agent` (via verify gate) | Pre-flight quality failure |
| Downstream JIRA statuses | Humans / future skills | Out of scope for this workflow |

### Coverage audit semantics

The coverage audit (`prd-ticket-coverage`) is the catch for silent drops between PRD and tickets. It explicitly does NOT count the following as gaps (so they don't generate noise):
- Open Questions / `[Needs validation]` items in the PRD (those are PRD-side blockers, not ticket scope)
- "Original concept thesis" or annex / historical content
- "Out of scope" items the PRD explicitly excluded

It surfaces scope creep (tickets that don't trace back to PRD content) as **informational only** — it doesn't block, because some tickets are legitimately scaffolding (`X.0 Setup` stories for data model / migrations are normal infra additions).

### Workflow gotchas

- **Classic vs team-managed JIRA**: this workflow assumes a JIRA Software project. Classic projects have shared workflow schemes (workflow change affects all projects using the scheme). Team-managed projects edit workflows per-project. The setup steps above are written for classic.
- **Status name overrides**: `jira-build-intake` defaults to status names `Ready` / `In Progress` / `On Dev`. If your project uses different names, pass overrides in `$ARGUMENTS` (e.g. `claim_status="In Development" done_status="Code Review"`).
- **Notion API auth**: the Notion MCP plugin must have access to the PRD database. If it returns "page not found" errors, check the integration permissions in Notion settings.
- **Pre-existing tickets**: this workflow does not retroactively process tickets that were created before `Ready` existed — those stay in their original status. Only tickets explicitly transitioned to `Ready` get picked up.

## Future work (intentionally not built yet)

- **Scheduling**: both intake skills are designed to be triggered by a `/schedule` cron later. Today they're invoked manually. Cadence likely 30 min during business hours for both.
- **Verification intake**: a third intake skill that picks up `On Dev` tickets, runs the Validation Journey, posts evidence, and transitions to the next state (`Awaiting QA / UAT`, `Done`, etc.). Same `Ready`-style claim/process pattern, applied to verification.
- **Notification integration**: when an intake cycle completes, push a notification (ntfy or Slack) listing how many PRDs were Ticketed / Blocked / how many tickets moved to `On Dev`. Avoid notification spam — only notify on non-empty cycles.

## Related skills

- `/notion-prd-intake <database URL>` — Notion-side intake
- `/jira-build-intake <project key | JQL>` — JIRA-side build intake
- `/prd-ticket-coverage <PRD URL> [tickets=...]` — standalone coverage audit (also runs automatically as Phase 3e of intake)
- `/jira-validate-ticket <ticket key | spec>` — standalone ticket validation
- `/jira-source-artifacts` — load the taxonomy doctrine
- `/product-walkthrough <route>` — standalone live-product walkthrough
