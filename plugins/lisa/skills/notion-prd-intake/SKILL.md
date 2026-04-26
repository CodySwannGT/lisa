---
name: notion-prd-intake
description: "Scans a Notion PRD database for pages with Status=Ready and runs each one through the dry-run validation pipeline. PRDs that pass every gate get tickets written and Status=Ticketed; PRDs that fail get clarifying-question comments and Status=Blocked. The skill is the runtime for the Ready → In Review → Blocked|Ticketed lifecycle. Composes existing skills (notion-to-jira, jira-validate-ticket, jira-source-artifacts, product-walkthrough); does not reimplement their logic."
allowed-tools: ["Skill", "Bash", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-search", "mcp__claude_ai_Notion__notion-update-page", "mcp__claude_ai_Notion__notion-create-comment", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Notion PRD Intake: $ARGUMENTS

`$ARGUMENTS` is a Notion database URL (or bare database ID) — for example:

```text
https://www.notion.so/geminisports/28fd00244d7d47c5866876f7de48c0fe?v=34eba63a2800815891a3000c643f0ea8
```

Run one intake cycle against that database. Each PRD with `Status = Ready` is claimed, validated, and routed to either `Blocked` (with clarifying comments) or `Ticketed` (with JIRA tickets created).

## Lifecycle assumed

The PRD database has a `Status` property whose value drives this skill:

```text
Draft → Ready → In Review → Blocked | Ticketed → Shipped
        (product)  (us)      (us)                  (product)
```

This skill ONLY transitions `Ready → In Review`, then `In Review → Blocked` or `In Review → Ticketed`. Never touches `Draft` or `Shipped`.

## Phases

### Phase 1 — Resolve the database

1. Parse `$ARGUMENTS`:
   - Full URL: extract the database ID from the path segment (the 32-hex-char ID after the last `/`, before `?`). Strip dashes if present. Ignore the `?v=...` view ID — we query the data source directly.
   - Bare ID: use as-is.
2. Call `mcp__claude_ai_Notion__notion-fetch` on the database ID. Capture:
   - The data source ID from `<data-source url="collection://...">` — needed for queries.
   - Confirm the schema includes a `Status` property of type `select` (or `status`) with the expected option names (`Ready`, `In Review`, `Blocked`, `Ticketed` at minimum). If any are missing, stop and report — the database is misconfigured.
3. Resolve Atlassian cloud ID via `mcp__atlassian__getAccessibleAtlassianResources` (downstream skills need it).

### Phase 2 — Find Ready PRDs

Query the data source for pages where `Status = Ready`. Use `mcp__claude_ai_Notion__notion-search` with `data_source_url: collection://<data-source-id>` and a query that scopes to that collection. The search supports semantic queries; for an exact-status filter, scan the returned page list and keep only those whose `Status` property equals `Ready` (re-fetch each page if the search results don't expose properties).

If the result set is empty, stop and report `"No PRDs with Status=Ready. Nothing to do."` Exit cleanly — this is the common idle case for a scheduled run.

### Phase 3 — Process each Ready PRD

For each PRD page (process serially to keep status transitions auditable):

#### 3a. Claim

Set `Status = In Review` via `mcp__claude_ai_Notion__notion-update-page` with `command: update_properties`, `properties: { "Status": "In Review" }`. This is the idempotency lock — if a second cycle starts while this one is mid-flight, the second skip-filter (`Status = Ready`) won't see this PRD.

If the update fails (permission error, race), log it and skip this PRD. Do not proceed to validation on a PRD you didn't successfully claim.

#### 3b. Dry-run validation

Invoke the `notion-to-jira` skill with `dry_run: true` and the PRD's URL. The skill returns a structured report containing:
- The planned ticket hierarchy
- Per-ticket validation verdicts and remediation
- An overall PASS / FAIL verdict
- A failure count

This call also indirectly invokes `jira-source-artifacts` (artifact extraction + classification) and `product-walkthrough` (when the PRD touches existing user-facing surfaces). All gate logic lives in `jira-validate-ticket`, which `notion-to-jira` calls per ticket.

#### 3c. Branch on the verdict

**If `PASS`** (every planned ticket passed every applicable gate):

1. Re-invoke `notion-to-jira` with `dry_run: false` to actually write the tickets. This re-runs Phases 1-5 and runs the preservation gate (Phase 5.5).
2. Capture the created ticket keys from the skill's output.
3. Post a Notion comment on the PRD via `mcp__claude_ai_Notion__notion-create-comment` listing the created tickets (epic, stories, sub-tasks) with their JIRA URLs. Lead with: `"Ticketed by Claude. Created N JIRA issues — see below. Move Status to Shipped after the work is delivered."`
4. Set `Status = Ticketed` via `notion-update-page`.
5. **Run Phase 3e (coverage audit)** before considering this PRD done.

#### 3e. Coverage audit (mandatory after Ticketed)

Per-ticket gates prove each ticket is well-formed; they do NOT prove the *set* of created tickets covers the *whole* PRD. Silent drops happen — invoke the `prd-ticket-coverage` skill to catch them.

1. Invoke `prd-ticket-coverage` with `<PRD URL> tickets=[<created ticket keys from step 2 above>]`.
2. Read the verdict:

   | Verdict | Action |
   |---------|--------|
   | `COMPLETE` | Done. Leave `Status = Ticketed`. Move to next PRD. |
   | `COMPLETE_WITH_SCOPE_CREEP` | Post an advisory Notion comment naming the scope-creep tickets (so product can decide whether to close them as out-of-scope). Leave `Status = Ticketed`. |
   | `GAPS_FOUND` | The created ticket set is incomplete. (a) For each gap, post a Notion comment naming the missing PRD item and where it appears in the PRD, with the suggested fix from the audit report. (b) Post one summary comment listing the tickets that *were* successfully created (so product knows what to keep vs. what to extend). (c) Transition `Status` from `Ticketed` back to `Blocked` via `notion-update-page`. |
   | `NO_TICKETS_FOUND` | Should not happen if step 2 succeeded. If it does, log it as an Error in the cycle summary and leave `Status = Ticketed` with a comment flagging the audit failure for human review. |

3. The created tickets remain in JIRA regardless of the verdict — they are valid in their own right (they passed `jira-validate-ticket`). The audit only tells us whether *more* are needed.

The audit's report should be summarized in the cycle summary alongside the per-PRD outcome (e.g., `Ticketed (coverage: COMPLETE)` or `Blocked (coverage gaps: 3)`).

**If `FAIL`** (one or more planned tickets failed one or more gates):

1. Group the failures by planned ticket.
2. For each failed ticket, post a Notion comment via `notion-create-comment` with this format:

   ```text
   **Blocker — planned ticket: <ticket-summary>**

   The PRD as written can't produce a valid JIRA ticket for this scope. Specifically:

   - **<gate-id> (<gate-name>)**: <reason>. *Fix:* <concrete remediation>.
   - **<gate-id> (<gate-name>)**: <reason>. *Fix:* <concrete remediation>.

   Once these are addressed in the PRD, set Status back to `Ready` and Claude will re-run intake.
   ```

3. Set `Status = Blocked` via `notion-update-page`.
4. Do NOT write any JIRA tickets.

Each comment must name the specific planned ticket and the specific gate — vague guidance is useless to product. The remediation field on the validator's report is already concrete; pass it through.

#### 3d. Continue

Move to the next Ready PRD. One PRD failing does not affect others.

### Phase 4 — Summary report

After processing every Ready PRD, emit a summary:

```text
## notion-prd-intake summary

Database: <name> (<URL>)
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

PRDs processed: <n>
- Ticketed: <n>
  - <PRD title> → <epic-key> + <story-count> stories + <subtask-count> sub-tasks (coverage: COMPLETE | COMPLETE_WITH_SCOPE_CREEP)
- Blocked: <n>
  - <PRD title> → <gate-failure-count> gate failures (pre-write) OR <gap-count> coverage gaps (post-write)
- Errors (claim failed, etc): <n>
  - <PRD title> — <reason>

Total JIRA tickets created: <n>
Coverage audit summary: <n> COMPLETE / <n> COMPLETE_WITH_SCOPE_CREEP / <n> GAPS_FOUND
```

Print to the agent's output. Do not write this summary to Notion or JIRA — it's an operational record for the human.

## Idempotency & safety

- **Single-cycle scope**: this skill processes the Ready set as it exists at the start of Phase 2. New `Ready` PRDs added mid-cycle are picked up next run.
- **No writes outside the lifecycle**: this skill only ever writes to JIRA via `notion-to-jira` (which delegates to `jira-write-ticket`), and only ever changes Notion `Status` to `In Review`, `Blocked`, or `Ticketed`. It never edits PRD content, never touches `Draft` or `Shipped`, never deletes pages.
- **Claim-first ordering**: `Status = In Review` is set BEFORE validation runs, so a re-entrant call won't double-process.
- **Failure isolation**: an exception processing one PRD must not stop the cycle. Catch, record under "Errors" in the summary, continue to the next PRD. The PRD that errored is left in `In Review` — the human investigates from there.

## Configuration

This skill reads project configuration from environment variables (or `$ARGUMENTS` overrides). If any required value is missing, ask the user before proceeding — never invent values.

| Variable | Purpose |
|----------|---------|
| `JIRA_PROJECT` | JIRA project key for ticket creation (passed to `notion-to-jira`) |
| `JIRA_SERVER` | Atlassian instance host |
| `E2E_BASE_URL` | Frontend URL for `product-walkthrough` |
| `E2E_TEST_PHONE` / `E2E_TEST_OTP` / `E2E_TEST_ORG` | Test user creds for walkthrough + verification plans |
| `E2E_GRAPHQL_URL` | API URL for verification plans |

## Rules

- Never write to JIRA outside of `notion-to-jira` → `jira-write-ticket`. The validator's verdict gates progress; bypassing it produces broken tickets.
- Never set Notion `Status` to a value this skill doesn't own (`In Review`, `Blocked`, `Ticketed`). Product owns `Draft`, `Ready`, `Shipped`.
- Never edit the PRD's body. Communication with product happens only through Notion comments.
- Never run more than one intake cycle concurrently against the same database. This skill assumes serial execution. (Scheduling is a separate concern; the runtime should not start a new cycle if a previous one is still in flight.)
- If `notion-to-jira` returns errors (e.g. unreachable artifact, malformed PRD structure), treat them as gate failures: comment + Blocked. Don't silently fail.
