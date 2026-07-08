---
name: lisa-notion-prd-intake
description: "Scans a Notion PRD database for pages in the configured `ready` status and runs the first eligible one through the dry-run validation pipeline. A PRD that passes every gate gets tickets written and the status flipped to the configured `ticketed` value; a PRD that fails gets clarifying-question comments and the status flipped to the configured `blocked` value. The skill is the runtime for the ready → in_review → blocked|ticketed lifecycle. Composes existing skills (notion-to-tracker, tracker-validate, tracker-source-artifacts, product-walkthrough); does not reimplement their logic."
allowed-tools: ["Skill", "Bash", "Read", "Write", "Edit", "AskUserQuestion"]
---

# Notion PRD Intake: $ARGUMENTS

> **Notion access policy**: all Notion operations in this skill go through `lisa-notion-access`. Do not call Notion REST APIs (`api.notion.com/...`), Notion MCP tools (`mcp__*notion*`), or the `@notionhq/client` library directly. Invoke `lisa-notion-access` via the Skill tool with an operation name and arguments per its dispatch table.

`$ARGUMENTS` is a Notion database URL (or bare database ID) — for example:

```text
https://www.notion.so/acme/<database-id>?v=<view-id>
```

Run one intake cycle against that database. The first eligible PRD in the configured `ready` status is claimed, validated, routed to either `blocked` (with clarifying comments) or `ticketed` (with destination tickets created), then the cycle exits. Remaining ready PRDs stay queued for later scheduler invocations.

## Workflow resolution

Status names are read from `.lisa.config.json` `notion.values.*`, falling back to defaults documented in the `config-resolution` rule. Bash pattern:

```bash
# Read role with default fallback. Local overrides global per-key.
read_role() {
  local role="$1" default="$2"
  local local_v global_v
  local_v=$(jq -r ".notion.values.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".notion.values.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}

DRAFT=$(read_role draft "Draft")
READY=$(read_role ready "Ready")
IN_REVIEW=$(read_role in_review "In Review")
BLOCKED=$(read_role blocked "Blocked")
TICKETED=$(read_role ticketed "Ticketed")
SHIPPED=$(read_role shipped "Shipped")
STATUS_PROP=$(jq -r '.notion.statusProperty // "Status"' .lisa.config.json 2>/dev/null)
```

In prose below, the role names refer to the resolved values: e.g. "the `ready` status" means whatever `notion.values.ready` resolves to (default: `Ready`).

This skill shares its PRD shipped rollup phase (3f) with `lisa-github-prd-intake`, `lisa-linear-prd-intake`, and `lisa-confluence-prd-intake`. The phases, gates, comment templates, and rollup behavior are identical across all four intake skills — only the vendor surface differs. Keep all four behaviorally aligned: when changing intake logic — including the rollup phase — change them together. The **PRD shipped rollup phase (3f)** transitions a `$TICKETED` PRD to `$SHIPPED` once all its generated top-level work is terminal, per the `prd-lifecycle-rollup` rule; this is the Notion leg of the same vendor-neutral rollup (LPC-1.3 #584), using the documented generated-work section since Notion has no native ticket hierarchy.

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a database URL, run the cycle to completion for the first eligible PRD — claim, validate, branch to `blocked` or `ticketed`, write the summary, and exit. The caller (a human or a cron) has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background queue.

Specifically forbidden:

- Previewing projected scope (epic count, story count, write count) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip / dry-run only" — the documented behavior IS the default.
- Pausing because a PRD looks large, has many open questions, or is likely to end in the `blocked` status. The `blocked` status is a valid terminal state of this lifecycle, not a failure mode — routing a PRD there with gate-failure comments is exactly how this skill communicates "the PRD needs more work before it can be ticketed." That outcome is success.
- Pausing because the dry-run validation looks expensive. The cost of one cycle is bounded; the cost of stalling a scheduled cron waiting on a human is unbounded.

The only legitimate reasons to stop early:

- Missing database URL or required configuration (`atlassian.cloudId`, `jira.project` or destination-tracker equivalents in `.lisa.config.json`, `E2E_BASE_URL`, etc.). Surface the missing value and exit.
- Database misconfigured (status property missing expected values, data source unreachable). Surface and exit.
- Empty ready set. Exit cleanly with `"No PRDs with $STATUS_PROP=$READY. Nothing to do."`

## Lifecycle assumed

The PRD database has a status property (configurable via `notion.statusProperty`, default `Status`) whose value drives this skill:

```text
draft → ready → in_review → blocked | ticketed → shipped → verified
        (product)  (us)      (us)                  (product)  (product)
```

(Default status values: `Draft` / `Ready` / `In Review` / `Blocked` / `Ticketed` / `Shipped` / `Verified`.)

`verified` is the terminal status after `shipped`: it means the shipped product has been empirically checked against the PRD (set by `/lisa:verify-prd`, not by this intake skill). A failed post-ship verification does **not** use `blocked`; `/lisa:verify-prd` re-opens the PRD `shipped → ticketed` and creates build-ready fix tickets that auto-build and trigger a re-verify (the self-healing loop), introducing no `verifying` / `verification-failed` status. Like `draft` and `shipped`, `verified` is **product-owned** — this intake skill never sets, clears, or otherwise touches it. See the "PRD-level verification vs ticket verification" section of the `prd-lifecycle-rollup` rule.

This skill transitions `ready → in_review`, then `in_review → blocked` or `in_review → ticketed`, then (via the rollup phase 3f) `ticketed → shipped`. It never touches `draft` or `verified` — those statuses are owned by product (`verified` is set by `/lisa:verify-prd` after empirical PRD-level acceptance). The `shipped` status is set by this skill's **rollup phase (3f)** when, and only when, the PRD's generated top-level work is all terminal — per the `prd-lifecycle-rollup` rule; product may also set it by hand. Rollup never advances a PRD to `shipped` on partial completion, and never archives a PRD page at shipped. `/lisa:verify-prd` archives the page only after a verified PASS.

## Phases

### Phase 1 — Resolve the database

1. Parse `$ARGUMENTS`:
   - Full URL: extract the database ID from the path segment (the 32-hex-char ID after the last `/`, before `?`). Strip dashes if present. Ignore the `?v=...` view ID — we query the data source directly.
   - Bare ID: use as-is.
2. Invoke `lisa-notion-access` via the Skill tool with operation `read-database` and `id: <database-id>`. Capture:
   - The database schema (returned in the response's `properties` field) — needed to confirm the status property exists.
   - Confirm the schema includes the configured `$STATUS_PROP` property of type `select` (or `status`) with the expected option names (`$READY`, `$IN_REVIEW`, `$BLOCKED`, `$TICKETED` at minimum). If any are missing, stop and report — the database is misconfigured.
3. Resolve the destination tracker's workspace/cloud identifier via the tracker-specific config in `.lisa.config.json` (e.g., `atlassian.cloudId` for JIRA). Downstream skills consume this from config directly; this skill does not need to probe an external API for it.

### Phase 2 — Find ready PRDs

Query the database for pages where `$STATUS_PROP = $READY`. Invoke `lisa-notion-access` via the Skill tool with operation `query-database`, `id: <database-id>`, and a filter scoped to the status property. For a `status`-type property the filter shape is:

```json
{ "property": "<STATUS_PROP>", "status": { "equals": "<READY>" } }
```

For a `select`-type property substitute `"select"` for `"status"`. The response contains the matching pages with their properties inline — no per-page re-fetch is required for status filtering. If you need additional page content (body blocks, child blocks), invoke `lisa-notion-access` with operation `read-page` per page.

If the result set is empty, stop and report `"No PRDs with $STATUS_PROP=$READY. Nothing to do."` Exit cleanly — this is the common idle case for a scheduled run.

### Phase 3 — Process the first eligible ready PRD

Select the first ready PRD page returned by Phase 2 and process only that page. Later scheduler invocations process the remaining ready PRDs.

#### 3a. Claim

Set `$STATUS_PROP = $IN_REVIEW` by invoking `lisa-notion-access` via the Skill tool with operation `write-page` and payload:

```json
{ "id": "<PRD-page-id>", "properties": { "<STATUS_PROP>": { "status": { "name": "<IN_REVIEW>" } } } }
```

(Use `"select": { "name": ... }` instead of `"status": { "name": ... }` if the property is a `select`.) This is the idempotency lock — if a second cycle starts while this one is mid-flight, the second skip-filter (`$STATUS_PROP = $READY`) won't see this PRD.

If the update fails (permission error, race), log it and skip this PRD. Do not proceed to validation on a PRD you didn't successfully claim.

#### 3b. Dry-run validation

Invoke the `lisa-notion-to-tracker` skill with `dry_run: true` and the PRD's URL. The skill returns a structured report containing:
- The planned ticket hierarchy
- Per-ticket validation verdicts and remediation
- An overall PASS / FAIL verdict
- A failure count

This call also indirectly invokes `lisa-tracker-source-artifacts` (artifact extraction + classification) and `lisa-product-walkthrough` (when the PRD touches existing user-facing surfaces). All gate logic lives in `lisa-tracker-validate`, which `lisa-notion-to-tracker` calls per ticket.

#### 3c. Branch on the verdict

**If `PASS`** (every planned ticket passed every applicable gate):

1. Re-invoke `lisa-notion-to-tracker` with `dry_run: false` to actually write the tickets. This re-runs Phases 1-5 and runs the preservation gate (Phase 5.5).
2. Capture the created ticket keys from the skill's output.
3. Post a Notion comment on the PRD via `lisa-notion-access` operation `create-comment` (see "Commenting on PRDs" below), listing the created tickets (epic, stories, sub-tasks) with their JIRA URLs. Lead with: `"Ticketed by Claude. Created N JIRA issues — see below. Move $STATUS_PROP to $SHIPPED after the work is delivered."`
4. Set `$STATUS_PROP = $TICKETED` by invoking `lisa-notion-access` operation `write-page` with payload `{ "id": "<PRD-page-id>", "properties": { "<STATUS_PROP>": { "status": { "name": "<TICKETED>" } } } }`.
5. **Run Phase 3e (coverage audit)** before considering this PRD done.

#### 3e. Coverage audit (mandatory after ticketed)

Per-ticket gates prove each ticket is well-formed; they do NOT prove the *set* of created tickets covers the *whole* PRD. Silent drops happen — invoke the `lisa-prd-ticket-coverage` skill to catch them.

1. Invoke `lisa-prd-ticket-coverage` with `<PRD URL> tickets=[<created ticket keys from step 2 above>]`.
2. Read the verdict:

   | Verdict | Action |
   |---------|--------|
   | `COMPLETE` | Done. Leave `$STATUS_PROP = $TICKETED`. End the cycle. |
   | `COMPLETE_WITH_SCOPE_CREEP` | Post an advisory Notion comment naming the scope-creep tickets (so product can decide whether to close them as out-of-scope). Leave `$STATUS_PROP = $TICKETED`. |
   | `GAPS_FOUND` | The created ticket set is incomplete. (a) For each gap, post a Notion comment using the same product-facing template as Phase 3c.3 — block-anchored when `prd_anchor` is non-null, page-level otherwise; category badge from the gap's `category` field; `What's unclear` and `Recommendation` from the audit report's `what` and `recommendation` fields. Apply the same forbidden-language rules from Phase 3c.5. (b) Post one summary comment listing the tickets that *were* successfully created (so product knows what to keep vs. what to extend). (c) Transition `$STATUS_PROP` from `$TICKETED` back to `$BLOCKED` by invoking `lisa-notion-access` operation `write-page` with the blocked-status payload. |
   | `NO_TICKETS_FOUND` | Should not happen if step 2 succeeded. If it does, log it as an Error in the cycle summary and leave `$STATUS_PROP = $TICKETED` with a comment flagging the audit failure for human review. |

3. The created tickets remain in the destination tracker regardless of the verdict — they are valid in their own right (they passed `lisa-tracker-validate`). The audit only tells us whether *more* are needed.

The audit's report should be summarized in the cycle summary alongside the per-PRD outcome (e.g., `Ticketed (coverage: COMPLETE)` or `Blocked (coverage gaps: 3)`).

**If `FAIL`** (one or more planned tickets failed one or more gates):

The audience for these comments is the **product team**, not engineers. They are not familiar with JIRA gate IDs, validator vocabulary, or skill internals. Follow the rules below strictly — the goal is for a non-engineer product owner to read a comment, understand what is unclear, and know what to do next.

##### 3c.1 Partition failures

1. Drop every failure where `product_relevant = false`. Those are internal data-quality problems — the agent should fix its own spec rather than ask product to clarify a missing core field. Record the dropped failures under `Errors` in the cycle summary so engineers can see them; never surface them on the PRD.
2. Group the remaining product-relevant failures by `prd_anchor` (the snippet from `notion-to-tracker`'s dry-run report). Failures that share an anchor become one comment thread on that block. Failures with `prd_anchor: null` are batched into one page-level summary comment, since they have no source section to attach to.

##### 3c.2 Render each comment

For each anchored group, post via `lisa-notion-access` operation `create-comment` (see "Commenting on PRDs" below) with:
- `page_id`: the PRD page ID
- `block_anchor`: the `prd_anchor` value (e.g. `"# User taps Fol...esume action"`) — the access skill resolves this to a Notion block reference; pass `null` for page-level comments
- `rich_text`: the body, formatted using the template below

For the unanchored group, post a single page-level comment (omit `block_anchor` or pass `null`) using the same template, prefixed with `Issues without a specific section anchor:` and one block per failure.

##### 3c.3 Comment template

Each comment body MUST contain these four parts, in this order, no exceptions:

```text
[<Category badge>] <prd_section heading text>

**What's unclear:** <validator's `what` field, verbatim — already product-readable>

**Recommendation:** <validator's `recommendation` field, verbatim — must contain 1–3 concrete options, never a generic "please clarify">

**Action:** Update this section in the PRD, then set $STATUS_PROP back to `$READY` and Claude will re-run intake.
```

If multiple failures share an anchor, render each as its own `**What's unclear:** ... **Recommendation:** ...` block within the same comment, separated by horizontal lines (`---`). Keep the single `[Category badge]` heading at the top using the most-severe / most-blocking category from the group.

##### 3c.4 Category badges

Use these exact badge labels — they are the validator's category values translated for product readers:

| Validator category | Badge label |
|---------------------|-------------|
| `product-clarity` | `[Product clarity]` |
| `acceptance-criteria` | `[Acceptance criteria]` |
| `design-ux` | `[Design / UX]` |
| `scope` | `[Scope]` |
| `dependency` | `[Dependency]` |
| `data` | `[Data]` |
| `technical` | `[Technical]` |

`structural` failures must never reach this step (filtered in 3c.1). If you see one here, treat it as an Error and surface internally.

##### 3c.5 Forbidden in product comments

- Gate IDs (`S4`, `F2`, etc.). Never appear in a comment body.
- JIRA terminology that has no product meaning (e.g. "Gherkin", "epic parent", "issue link", "validation journey", "sub-task hierarchy"). If the validator's `what` field uses one of these terms, paraphrase before posting; do not pass through verbatim.
- Internal skill names (`lisa-tracker-validate`, `notion-to-tracker`).
- Engineering shorthand (`AC`, `OOS`, `repo`, `env var`).
- "Clarify this" / "Please specify" without candidate resolutions. The validator is required to provide candidates; if `recommendation` is empty or vague, treat the failure as an Error and surface internally rather than posting a useless comment.

##### 3c.6 Status transition

After all comments are posted (anchored groups + the optional page-level summary), set `$STATUS_PROP = $BLOCKED` by invoking `lisa-notion-access` operation `write-page` with payload `{ "id": "<PRD-page-id>", "properties": { "<STATUS_PROP>": { "status": { "name": "<BLOCKED>" } } } }`. Do NOT write any destination tickets.

## Commenting on PRDs

The Notion comments API (`POST /v1/comments`) is the correct endpoint for both page-level and block-anchored comments. Invoke `lisa-notion-access` via the Skill tool with:

```text
operation: create-comment
page_id: <PRD-page-id>
block_anchor: <prd_anchor string from notion-to-tracker, or null for page-level>
rich_text: <Notion rich_text array — the comment body>
```

The access skill resolves a `prd_anchor` substring to the matching block ID by paging through the PRD's children and posts the comment with `discussion_id` or `parent: { block_id }` as appropriate. If `block_anchor` is `null`, the access skill posts a page-level comment via `parent: { page_id }`.

#### 3d. Stop

Stop immediately after the claimed PRD is ticketed, blocked, or recorded as an error.

#### 3f. PRD shipped rollup

A PRD's lifecycle terminal state (`shipped`) is **derived** from whether the work it generated is done — it is never set by hand here on its own authority. This phase implements the Notion leg of that derivation, per the `prd-lifecycle-rollup` rule (cite it by slug; do not restate its taxonomy or terminal-state semantics here). It is behaviorally identical to `lisa-github-prd-intake`'s Phase 3f — only the vendor surface (a Notion status property via `lisa-notion-access` + the documented generated-work section) differs from GitHub's (issue close + labels via `gh`).

Rollup runs over PRD pages that are already `$TICKETED` (the only state from which a PRD can ship): the freshly-ticketed PRD from Phase 3c, and — because rollup also catches PRDs whose children finished in a *later* cycle — every page currently in `$STATUS_PROP = $TICKETED` (re-query the database with operation `query-database` filtered on the ticketed status). Process each independently; one PRD never blocks another's rollup.

##### 3f.0 Shipped remains active for verification

There is no archive configuration at the shipped hop. Rollup sets `$STATUS_PROP = $SHIPPED` and leaves the PRD page **active** so Phase 3g can dispatch `/lisa:verify-prd`. Provider-native archival is owned by `/lisa:verify-prd` after it transitions `$SHIPPED → verified` on a PASS.

##### 3f.1 Idempotency guard (no-op if already shipped)

Rollup is keyed by the PRD's current state. If the PRD already has `$STATUS_PROP = $SHIPPED`, it is a **no-op** — do not re-transition, do not archive, do not re-comment. Record it as `already shipped (no-op)` in the cycle summary and move on. This is what makes re-running intake safe.

##### 3f.2 Read the generated top-level child set

Read the PRD's **generated top-level work** — its created Epics and any top-level Stories created directly under it, **excluding** leaf Sub-tasks and any Story nested under a generated Epic (`prd-lifecycle-rollup` rule, generated-top-level-work contract). Notion has **no native ticket hierarchy**, so the child set comes from the documented section only:

1. **Documented `## Tickets` section (primary and only source).** Parse the machine-readable generated-work section `lisa-prd-backlink` writes to the PRD body (`## Tickets`, alias `## Generated Work`; see #582) by invoking `lisa-notion-access` operation `read-page` on the PRD. Top-level children are the `### <Epic key>: <title>` group headers' first line (`- [<ref>](<url>) — Epic`) plus any top-level Story listed directly under `### Unparented items`. Lines nested deeper (`  - ... — Story:` under an Epic, `    - ... — Sub-task:`) are descendants, NOT top-level children — skip them.

Dedupe the resulting child set by **child-ref identity** — the destination ticket ref recorded in each generated-work entry (the entry is keyed by that ref, not by list position) — per the `prd-lifecycle-rollup` idempotency dedupe key. If the section yields no child (the PRD generated nothing, or the relationship was never recorded), record `no generated top-level children — rollup skipped` and leave the PRD as `$TICKETED`; do not ship an empty PRD.

##### 3f.3 Apply the terminal-state predicate

For each top-level child, classify per the `prd-lifecycle-rollup` Confluence/Notion predicate:

- **Terminal (shipped).** The documented generated-work entry for the child is marked **done** in the PRD's machine-readable section (the durable equivalent of a closed ticket, since Notion has no native ticket state). A child Epic is terminal only when it has itself rolled up to its own terminal state per `leaf-only-lifecycle` — read the child's own recorded state; do not re-derive it from its leaves here.
- **Terminal-but-dropped.** The entry is marked won't-do / canceled. Like a not-planned leaf, it does not hold the PRD open and is excluded from the shipped set.
- **Incomplete / blocked.** Anything else: the entry is not yet marked done. Holds the PRD open.

The set of **required** children for the all-terminal check is the top-level children minus the terminal-but-dropped ones.

##### 3f.4 Branch on the rollup verdict

**All required children terminal** (every required top-level child is terminal; at least one required child exists):

1. Set `$STATUS_PROP = $SHIPPED` by invoking `lisa-notion-access` operation `write-page` with payload `{ "id": "<PRD-page-id>", "properties": { "<STATUS_PROP>": { "status": { "name": "<SHIPPED>" } } } }` (use `"select"` instead of `"status"` if the property is a select).
2. Leave the PRD active for `/lisa:verify-prd`; do not archive at the shipped hop.
3. Post a short rollup Notion comment naming the terminal child set and (when dropped children exist) the dropped set, so the audit trail records *why* the PRD shipped. Lead with `"Shipped by Claude — all generated top-level work is complete."`

**Any required child incomplete / blocked**:

1. Leave `$STATUS_PROP = $TICKETED` and leave the page **active**. Do NOT set `$SHIPPED`. Do NOT archive.
2. Report the incomplete child set — both in the cycle summary and, when at least one cycle has previously ticketed this PRD, as a single advisory Notion comment listing the still-open children (`- <ref> "<title>" — <state>`), so product can see what's blocking the rollup. Keep it idempotent: regenerate the advisory rather than appending a fresh one each cycle.

##### 3f.5 Rollup cites the rule

This phase implements exactly one PRD-lifecycle hop — `$TICKETED → $SHIPPED` — and deliberately leaves native archival to `/lisa:verify-prd` after `$SHIPPED → verified`. All terminal-state semantics, the generated-top-level-work boundary, and the dedupe-by-child-ref idempotency come from the `prd-lifecycle-rollup` rule; this skill is its Notion implementation, not a second source of truth.

#### 3g. PRD verification dispatch (close the loop on shipped PRDs)

`shipped` and `verified` are distinct facts about a PRD (see the `prd-lifecycle-rollup` rule's "PRD-level verification vs ticket verification" and "Closing the loop" sections). Rollup (3f) only reaches `$SHIPPED`; the `shipped → verified` (pass) / `shipped → ticketed` (fail) hops are owned by `/lisa:verify-prd`. This phase **closes that loop** by dispatching the initiative-level acceptance gate for shipped PRDs. It never performs the verification transition itself — the "never sets the verification outcome" invariant holds: `lisa-verify-prd`, not this skill, sets `verified` (or, on failure, re-opens the PRD to `ticketed`).

Re-query the PRDs currently in the `$SHIPPED` status via `lisa-notion-access` `operation: query-database` filtered on `$STATUS_PROP = $SHIPPED`. Pick the **first** one and invoke `lisa-verify-prd <PRD-page-url>`. Process **one shipped PRD per cycle** — `lisa-verify-prd` is a heavy full flow (spec-conformance + empirical verification + fix-issue creation), so it is bounded exactly like the single-ready-PRD claim in Phase 3; the scheduler drains the rest.

**Per-cycle combined bound:** each scheduler cycle dispatches at most one ready PRD (the Phase 3 single-ready-PRD claim) **and** at most one shipped PRD for verification (this Phase 3g dispatch), for a maximum of two PRD operations per cycle. Ready intake runs first (Phase 3), then shipped verify (Phase 3g).

`lisa-verify-prd` owns the outcome: on a CONFORMS verdict with all empirical checks passing it transitions `$SHIPPED → verified` and posts evidence; on a conformance miss or a failing/unavailable check it **re-opens the PRD `$SHIPPED → ticketed`** (never `blocked`) and creates **build-ready** fix tickets registered as the PRD's generated work, then posts a failure report — the fix tickets auto-build, rollup (3f) re-ships the PRD once they are terminal, and a later cycle re-verifies (the self-healing loop). Either branch moves the PRD out of `$SHIPPED`, so it is not re-picked this cycle; a PRD whose generated work is not actually terminal is guard-stopped by `lisa-verify-prd` (left `$SHIPPED`) — that is verify-prd's gate, not this skill's. This phase, like 3f, is **behaviorally identical across all four intake skills** (`github-prd-intake`, `linear-prd-intake`, `notion-prd-intake`, `confluence-prd-intake`) — only the `$SHIPPED` query surface differs; keep them aligned. Record the dispatched PRD + verify-prd's verdict in the summary.

### Phase 4 — Summary report

After processing the single selected PRD, emit a summary:

```text
## notion-prd-intake summary

Database: <name> (<URL>)
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

PRDs processed: <n>
- $TICKETED: <n>
  - <PRD title> → <epic-key> + <story-count> stories + <subtask-count> sub-tasks (coverage: COMPLETE | COMPLETE_WITH_SCOPE_CREEP)
- $BLOCKED: <n>
  - <PRD title> → <gate-failure-count> gate failures (pre-write) OR <gap-count> coverage gaps (post-write)
- Errors (claim failed, etc): <n>
  - <PRD title> — <reason>

Total destination tickets created: <n>
Coverage audit summary: <n> COMPLETE / <n> COMPLETE_WITH_SCOPE_CREEP / <n> GAPS_FOUND
```

Print to the agent's output. Do not write this summary to Notion or the destination tracker — it's an operational record for the human.

## Idempotency & safety

- **One item per cycle**: this skill processes the first eligible ready PRD from Phase 2, then exits. New or remaining ready PRDs are picked up by later scheduler invocations.
- **No writes outside the lifecycle**: this skill only ever writes to the destination tracker via `lisa-notion-to-tracker` (which delegates to `lisa-tracker-write`), and only ever changes the Notion status property to `$IN_REVIEW`, `$BLOCKED`, `$TICKETED`, or `$SHIPPED` (the last via the rollup phase 3f only). It never edits PRD content, never touches `$DRAFT`, never archives pages at the shipped hop, and never deletes pages.
- **Claim-first ordering**: the status flip to `$IN_REVIEW` is set BEFORE validation runs, so a re-entrant call won't double-process.
- **Failure handling**: an exception processing the selected PRD is caught and recorded under "Errors" in the summary, then the cycle exits. The PRD that errored is left in `$IN_REVIEW` — the human investigates from there.
- **Rollup idempotency**: rollup (Phase 3f) is a no-op on a PRD already in `$STATUS_PROP = $SHIPPED` — no duplicate transition, no shipped-time archive, no duplicate comment. The all-terminal condition is a pure function of the children's current states (deduped by child-ref identity), so recomputing it is safe to re-run. Native archival only follows verified PASS in `/lisa:verify-prd`.

## Configuration

This skill reads project configuration from `.lisa.config.json` (with `.lisa.config.local.json` overriding per key) and operational E2E test config from environment variables. See the `config-resolution` rule for the full schema. Destination tracker config (jira / github / linear) is consumed by `lisa-tracker-write` internally — this skill does NOT read it.

### From `.lisa.config.json`

| Field | Default | Purpose |
|-------|---------|---------|
| `notion.prdDatabaseId` | — | Notion database hosting PRDs (when `$ARGUMENTS` is the literal token `notion`) |
| `notion.statusProperty` | `Status` | Database property name driving the lifecycle |
| `notion.values.draft` | `Draft` | Value meaning "in progress; agent ignores" |
| `notion.values.ready` | `Ready` | Value meaning "ready for ticketing; agent claims" |
| `notion.values.in_review` | `In Review` | Value the agent sets on claim |
| `notion.values.blocked` | `Blocked` | Value the agent sets on validation failure |
| `notion.values.ticketed` | `Ticketed` | Value the agent sets on success |
| `notion.values.shipped` | `Shipped` | Value the rollup phase (3f) sets when all generated top-level work is terminal; product may also set it by hand |
### From environment variables

| Variable | Purpose |
|----------|---------|
| `E2E_BASE_URL` | Frontend URL for `lisa-product-walkthrough` |
| `E2E_TEST_PHONE` / `E2E_TEST_OTP` / `E2E_TEST_ORG` | Test user creds for walkthrough + verification plans |
| `E2E_GRAPHQL_URL` | API URL for verification plans |

## Rules

- Never write to the destination tracker outside of `lisa-notion-to-tracker` → `lisa-tracker-write`. The validator's verdict gates progress; bypassing it produces broken tickets.
- Never set the Notion status to a value this skill doesn't own (`$IN_REVIEW`, `$BLOCKED`, `$TICKETED`, and `$SHIPPED` via the rollup phase only). Product owns `$DRAFT` and `$READY`; product and the rollup phase (3f) both set `$SHIPPED`.
- Set `$SHIPPED` only from the rollup phase, and only when all generated top-level children are terminal per the `prd-lifecycle-rollup` rule. Never ship on partial completion and never archive at shipped.
- Never edit the PRD's body. Communication with product happens only through Notion comments.
- Never post a single page-level dump of all gate failures. One comment per `prd_anchor` group (or one page-level summary for unanchored failures only). The audience is product, not engineers — comments must be block-anchored, categorized, plain-language, and contain a concrete recommendation. See Phase 3c.3 for the required template and Phase 3c.5 for forbidden language.
- Never include a gate ID, internal skill name, or engineering shorthand in a Notion comment body. If the validator's `what` or `recommendation` field uses one, paraphrase before posting.
- Never run more than one intake cycle concurrently against the same database. This skill assumes serial execution. (Scheduling is a separate concern; the runtime should not start a new cycle if a previous one is still in flight.)
- If `lisa-notion-to-tracker` returns errors (e.g. unreachable artifact, malformed PRD structure), treat them as gate failures: comment + `$BLOCKED`. Don't silently fail.
