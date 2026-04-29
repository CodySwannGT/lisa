---
name: confluence-prd-intake
description: "Scans a Confluence space (or a parent page) for PRD pages labelled `prd-ready` and runs each one through the dry-run validation pipeline. PRDs that pass every gate get tickets written and the label flipped to `prd-ticketed`; PRDs that fail get clarifying-question comments and the label flipped to `prd-blocked`. Confluence counterpart of `lisa:notion-prd-intake` — the workflow is identical; only the source-of-truth tools differ. Composes existing skills (confluence-to-tracker, tracker-validate, jira-source-artifacts, product-walkthrough)."
allowed-tools: ["Skill", "Bash", "mcp__atlassian__getConfluencePage", "mcp__atlassian__getConfluenceSpaces", "mcp__atlassian__getPagesInConfluenceSpace", "mcp__atlassian__getConfluencePageDescendants", "mcp__atlassian__searchConfluenceUsingCql", "mcp__atlassian__updateConfluencePage", "mcp__atlassian__createConfluenceFooterComment", "mcp__atlassian__createConfluenceInlineComment", "mcp__atlassian__getConfluencePageFooterComments", "mcp__atlassian__getConfluencePageInlineComments", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Confluence PRD Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

- A Confluence **space** URL or space key — scans every page in the space whose labels include `prd-ready`. Example: `https://mycompany.atlassian.net/wiki/spaces/PRD` or `PRD`.
- A Confluence **parent page** URL or page ID — scans every descendant of the parent whose labels include `prd-ready`. Example: `https://mycompany.atlassian.net/wiki/spaces/PRD/pages/123456789/PRDs`.

Run one intake cycle against that scope. Each PRD with the `prd-ready` label is claimed, validated, and routed to either `prd-blocked` (with clarifying comments) or `prd-ticketed` (with JIRA tickets created).

This skill is the Confluence counterpart of `lisa:notion-prd-intake`. The phases, gates, comment templates, and rules are identical — the only differences are (1) the lifecycle is encoded as **page labels** instead of a Status property, and (2) the fetch / comment / update tools are Confluence MCP instead of Notion MCP. Keep the two skills behaviorally aligned: when changing intake logic, change BOTH skills together.

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a space or parent-page URL, run the cycle to completion — claim, validate, branch to `prd-blocked` or `prd-ticketed`, write the summary. The caller (a human or a cron) has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background batch.

Specifically forbidden:

- Previewing projected scope (epic count, story count, write count) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip / dry-run only" — the documented behavior IS the default.
- Pausing because a PRD looks large, has many open questions, or is likely to end in `prd-blocked`. `prd-blocked` is a valid terminal state of this lifecycle, not a failure mode — routing a PRD to `prd-blocked` with gate-failure comments is exactly how this skill communicates "the PRD needs more work before it can be ticketed." That outcome is success.
- Pausing because the dry-run validation looks expensive. The cost of one cycle is bounded; the cost of stalling a scheduled cron waiting on a human is unbounded.

The only legitimate reasons to stop early:

- Missing space/parent argument or required configuration (`JIRA_PROJECT`, `JIRA_SERVER`, `E2E_BASE_URL`, etc.). Surface the missing value and exit.
- Space/parent unreachable, or the labelling convention not yet adopted (no PRDs carry any of `prd-ready` / `prd-in-review` / `prd-blocked` / `prd-ticketed`). Surface and exit.
- Empty `prd-ready` set. Exit cleanly with `"No PRDs labelled prd-ready. Nothing to do."`

## Lifecycle assumed

The Confluence PRD lifecycle is encoded as **page labels** (Confluence has no native status field). Exactly one of these labels is expected on a PRD page at any time:

```text
prd-draft → prd-ready → prd-in-review → prd-blocked | prd-ticketed → prd-shipped
            (product)    (us)            (us)                          (product)
```

This skill ONLY transitions:

- `prd-ready` → `prd-in-review` (claim)
- `prd-in-review` → `prd-blocked` (gate failures or coverage gaps)
- `prd-in-review` → `prd-ticketed` (success)

It never adds, removes, or touches `prd-draft` or `prd-shipped`. Those labels are owned by product.

A "transition" means: remove the old lifecycle label and add the new one in a single `updateConfluencePage` call. The skill MUST verify that exactly one lifecycle label exists on the page after the update — having two simultaneously breaks idempotency.

If the project does not yet use `prd-*` labels, this skill cannot run. Adopting the convention is a one-time setup the project owner does (see "Adoption" at the bottom of this file).

## Phases

### Phase 1 — Resolve the scope

1. Parse `$ARGUMENTS`:
   - Space URL → extract space key from `/wiki/spaces/<KEY>`.
   - Bare space key → use as-is.
   - Parent page URL → extract numeric page ID from `/pages/<ID>/...`.
   - Bare page ID → use as-is.
2. Resolve Atlassian cloud ID via `mcp__atlassian__getAccessibleAtlassianResources` (downstream tools need it).
3. Verify the scope is reachable:
   - For a space: call `mcp__atlassian__getConfluenceSpaces` and confirm the key resolves.
   - For a parent page: call `mcp__atlassian__getConfluencePage` on the ID and confirm it loads.

### Phase 2 — Find Ready PRDs

Build a CQL query and call `mcp__atlassian__searchConfluenceUsingCql`:

- For a space: `space = "<KEY>" AND label = "prd-ready" AND type = page`
- For a parent: `ancestor = <PARENT-ID> AND label = "prd-ready" AND type = page`

The query returns the list of candidate pages with IDs and titles. For each candidate, confirm the label set on the page (CQL hits should be authoritative, but a follow-up `getConfluencePage` with labels included guards against eventual-consistency lag) and ensure exactly one lifecycle label is present.

If the result set is empty, run a secondary CQL to distinguish between a genuinely empty queue and a project that has not yet adopted the label convention:

- Secondary query (space scope): `space = "<KEY>" AND (label = "prd-ready" OR label = "prd-in-review" OR label = "prd-blocked" OR label = "prd-ticketed") AND type = page`
- Secondary query (parent scope): `ancestor = <PARENT-ID> AND (label = "prd-ready" OR label = "prd-in-review" OR label = "prd-blocked" OR label = "prd-ticketed") AND type = page`

If the secondary query also returns nothing → the `prd-*` label convention has not been adopted. Surface a misconfiguration message: `"No pages in this scope carry prd-* labels. If this is a new project, apply the prd-ready label to PRDs that are ready for ticketing (see Adoption section)."` Exit with an error — this is a setup issue, not a normal idle cycle.

If the secondary query returns results → the queue is genuinely empty (all PRDs are already in-review, blocked, ticketed, or shipped). Exit cleanly with `"No PRDs labelled prd-ready. Nothing to do."`

### Phase 3 — Process each Ready PRD

For each PRD page (process serially to keep label transitions auditable):

#### 3a. Claim

Transition labels via `mcp__atlassian__updateConfluencePage`: remove `prd-ready`, add `prd-in-review`. This is the idempotency lock — a re-entrant cycle running concurrently won't see this PRD because its CQL query filters on `label = "prd-ready"`.

If the update fails (permission error, version conflict / 409 race), log it and skip this PRD. Do not proceed to validation on a PRD you didn't successfully claim.

The `updateConfluencePage` call must preserve the page body; only the labels change. (If the MCP tool requires a full body in the update payload, fetch the current body via `getConfluencePage` immediately before the update and pass it back unchanged — preserving body content is non-negotiable, this skill never edits PRD content.)

#### 3b. Dry-run validation

Invoke the `lisa:confluence-to-tracker` skill with `dry_run: true` and the PRD's URL. The skill returns a structured report containing:
- The planned ticket hierarchy
- Per-ticket validation verdicts and remediation
- An overall PASS / FAIL verdict
- A failure count

This call also indirectly invokes `lisa:jira-source-artifacts` (artifact extraction + classification) and `lisa:product-walkthrough` (when the PRD touches existing user-facing surfaces). All gate logic lives in `lisa:tracker-validate`, which `lisa:confluence-to-tracker` calls per ticket.

#### 3c. Branch on the verdict

**If `PASS`** (every planned ticket passed every applicable gate):

1. Re-invoke `lisa:confluence-to-tracker` with `dry_run: false` to actually write the tickets. This re-runs Phases 1-5 and runs the preservation gate (Phase 5.5).
2. Capture the created ticket keys from the skill's output.
3. Post a Confluence **footer comment** on the PRD via `mcp__atlassian__createConfluenceFooterComment` listing the created tickets (epic, stories, sub-tasks) with their JIRA URLs. Lead with: `"Ticketed by Claude. Created N JIRA issues — see below. Add the prd-shipped label after the work is delivered."`
4. Transition labels: remove `prd-in-review`, add `prd-ticketed` via `updateConfluencePage`.
5. **Run Phase 3e (coverage audit)** before considering this PRD done.

**If `FAIL`** (one or more planned tickets failed one or more gates):

The audience for these comments is the **product team**, not engineers. They are not familiar with JIRA gate IDs, validator vocabulary, or skill internals. Follow the rules below strictly — the goal is for a non-engineer product owner to read a comment, understand what is unclear, and know what to do next.

##### 3c.1 Partition failures

1. Drop every failure where `product_relevant = false`. Those are internal data-quality problems — the agent should fix its own spec rather than ask product to clarify a missing core field. Record the dropped failures under `Errors` in the cycle summary so engineers can see them; never surface them on the PRD.
2. Group the remaining product-relevant failures by `prd_anchor` (the inline-comment anchor from `confluence-to-tracker`'s dry-run report). Failures that share an anchor become one comment thread on that block. Failures with `prd_anchor: null` are batched into one footer comment, since they have no source section to attach to.

##### 3c.2 Render each comment

For each anchored group, post via `mcp__atlassian__createConfluenceInlineComment` with:
- `page_id`: the PRD page ID
- `inline_text` (or whatever the MCP tool calls the selection-anchor parameter): the `prd_anchor` value
- `body`: the comment body, formatted using the template below

For the unanchored group, post a single footer comment via `mcp__atlassian__createConfluenceFooterComment` using the same template, prefixed with `Issues without a specific section anchor:` and one block per failure.

If `createConfluenceInlineComment` returns "anchor not found" (the page text changed between fetch and post), fall back to a footer comment for that group. Do not silently drop the failure.

##### 3c.3 Comment template

Each comment body MUST contain these four parts, in this order, no exceptions:

```text
[<Category badge>] <prd_section heading text>

**What's unclear:** <validator's `what` field, verbatim — already product-readable>

**Recommendation:** <validator's `recommendation` field, verbatim — must contain 1–3 concrete options, never a generic "please clarify">

**Action:** Update this section in the PRD, then replace the `prd-blocked` label with `prd-ready` and Claude will re-run intake.
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
- JIRA terminology that has no product meaning (e.g. "Gherkin", "epic parent", "issue link", "validation journey", "sub-task hierarchy"). Paraphrase before posting.
- Internal skill names (`lisa:tracker-validate`, `confluence-to-tracker`).
- Engineering shorthand (`AC`, `OOS`, `repo`, `env var`).
- "Clarify this" / "Please specify" without candidate resolutions. The validator is required to provide candidates; if `recommendation` is empty or vague, treat the failure as an Error and surface internally rather than posting a useless comment.

##### 3c.6 Label transition

After all comments are posted (anchored groups + the optional footer summary), transition labels: remove `prd-in-review`, add `prd-blocked` via `updateConfluencePage`. Do NOT write any JIRA tickets.

#### 3d. Continue

Move to the next Ready PRD. One PRD failing does not affect others.

#### 3e. Coverage audit (mandatory after prd-ticketed)

Per-ticket gates prove each ticket is well-formed; they do NOT prove the *set* of created tickets covers the *whole* PRD. Silent drops happen — invoke the `lisa:prd-ticket-coverage` skill to catch them.

1. Invoke `lisa:prd-ticket-coverage` with `<PRD URL> tickets=[<created ticket keys from 3c step 2>]`. The coverage skill auto-detects the PRD vendor from the URL.
2. Read the verdict:

   | Verdict | Action |
   |---------|--------|
   | `COMPLETE` | Done. Leave label as `prd-ticketed`. Move to next PRD. |
   | `COMPLETE_WITH_SCOPE_CREEP` | Post an advisory footer comment naming the scope-creep tickets (so product can decide whether to close them as out-of-scope). Leave label as `prd-ticketed`. |
   | `GAPS_FOUND` | The created ticket set is incomplete. (a) For each gap, post a comment using the same product-facing template as Phase 3c.3 — inline-anchored when `prd_anchor` is non-null, footer otherwise; category badge from the gap's `category` field; `What's unclear` and `Recommendation` from the audit report's `what` and `recommendation` fields. Apply the same forbidden-language rules from Phase 3c.5. (b) Post one footer summary comment listing the tickets that *were* successfully created (so product knows what to keep vs. what to extend). (c) Transition labels from `prd-ticketed` back to `prd-blocked` via `updateConfluencePage`. |
   | `NO_TICKETS_FOUND` | Should not happen if step 2 succeeded. If it does, log it as an Error in the cycle summary and leave label as `prd-ticketed` with a comment flagging the audit failure for human review. |

3. The created tickets remain in the destination tracker regardless of the verdict — they are valid in their own right. The audit only tells us whether *more* are needed.

### Phase 4 — Summary report

After processing every Ready PRD, emit a summary:

```text
## confluence-prd-intake summary

Scope: <space-key | parent-page-title> (<URL>)
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

PRDs processed: <n>
- prd-ticketed: <n>
  - <PRD title> → <epic-key> + <story-count> stories + <subtask-count> sub-tasks (coverage: COMPLETE | COMPLETE_WITH_SCOPE_CREEP)
- prd-blocked: <n>
  - <PRD title> → <gate-failure-count> gate failures (pre-write) OR <gap-count> coverage gaps (post-write)
- Errors (claim failed, etc): <n>
  - <PRD title> — <reason>

Total JIRA tickets created: <n>
Coverage audit summary: <n> COMPLETE / <n> COMPLETE_WITH_SCOPE_CREEP / <n> GAPS_FOUND
```

Print to the agent's output. Do not write this summary to Confluence or JIRA — it's an operational record for the human.

## Idempotency & safety

- **Single-cycle scope**: this skill processes the `prd-ready` set as it exists at the start of Phase 2. New `prd-ready` PRDs added mid-cycle are picked up next run.
- **No writes outside the lifecycle**: this skill only ever writes to the destination tracker via `lisa:confluence-to-tracker` (which delegates to `lisa:tracker-write`), and only ever changes Confluence labels among `prd-in-review`, `prd-blocked`, `prd-ticketed`. It never edits PRD body content, never touches `prd-draft` or `prd-shipped`, never deletes pages.
- **Claim-first ordering**: the label flip to `prd-in-review` happens BEFORE validation runs, so a re-entrant call won't double-process.
- **Failure isolation**: an exception processing one PRD must not stop the cycle. Catch, record under "Errors" in the summary, continue to the next PRD. The PRD that errored is left labelled `prd-in-review` — the human investigates from there.
- **Single-label invariant**: after every transition, verify exactly one lifecycle label is present on the page. If two are present (rare race), surface as an Error and skip — do NOT auto-resolve, the human decides.

## Configuration

Same env vars as `lisa:confluence-to-tracker` — `JIRA_PROJECT`, `JIRA_SERVER`, `CONFLUENCE_HOST`, `E2E_BASE_URL`, `E2E_TEST_PHONE`, `E2E_TEST_OTP`, `E2E_TEST_ORG`, `E2E_GRAPHQL_URL`. If any required value is missing, surface the missing key(s) and exit this cycle — never invent values.

## Rules

- Never write to the destination tracker outside of `lisa:confluence-to-tracker` → `lisa:tracker-write`. The validator's verdict gates progress; bypassing it produces broken tickets.
- Never add or remove a label this skill doesn't own (`prd-in-review`, `prd-blocked`, `prd-ticketed`). Product owns `prd-draft`, `prd-ready`, `prd-shipped`.
- Never edit the PRD's body. Communication with product happens only through Confluence comments. If `updateConfluencePage` requires a body in the payload, refetch and pass it back unchanged.
- Never post a single page-level dump of all gate failures. One inline comment per `prd_anchor` group (or one footer summary for unanchored failures only). Comments must be inline-anchored where possible, categorized, plain-language, and contain a concrete recommendation.
- Never include a gate ID, internal skill name, or engineering shorthand in a comment body.
- Never run more than one intake cycle concurrently against the same scope. This skill assumes serial execution.
- If `lisa:confluence-to-tracker` returns errors, treat them as gate failures: comment + `prd-blocked`. Don't silently fail.

## Adoption (one-time per project)

Before this skill can run against a project, the project must adopt the `prd-*` label convention:

1. Apply `prd-ready` to PRDs that are ready for ticketing (replaces the Notion `Status = Ready` flip).
2. Reserve `prd-in-review`, `prd-blocked`, `prd-ticketed` for this skill — humans should not set them manually except to recover from an error.
3. (Optional but recommended) Add `prd-draft` for in-progress PRDs and `prd-shipped` for delivered work, so the full lifecycle is visible at a glance.

If the project hasn't adopted these labels, the first run exits with a label-convention error (not the idle empty-set message) — this distinguishes a setup issue from a genuinely empty queue so operators know to apply the convention rather than assuming the queue is drained. See Phase 2 for how the skill detects this case.
