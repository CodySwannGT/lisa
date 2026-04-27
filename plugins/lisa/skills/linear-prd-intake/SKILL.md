---
name: linear-prd-intake
description: "Scans a Linear workspace (or a specific team) for projects labelled `prd-ready` and runs each one through the dry-run validation pipeline. Projects that pass every gate get tickets written and the label flipped to `prd-ticketed`; projects that fail get clarifying-question comments (on a sentinel feedback issue under the project) and the label flipped to `prd-blocked`. Linear counterpart of `lisa:notion-prd-intake` and `lisa:confluence-prd-intake` — the workflow is identical; only the source-of-truth tools differ. Composes existing skills (linear-to-jira, jira-validate-ticket, jira-source-artifacts, product-walkthrough)."
allowed-tools: ["Skill", "Bash", "mcp__linear-server__list_projects", "mcp__linear-server__get_project", "mcp__linear-server__save_project", "mcp__linear-server__list_project_labels", "mcp__linear-server__list_issues", "mcp__linear-server__get_issue", "mcp__linear-server__save_issue", "mcp__linear-server__list_comments", "mcp__linear-server__save_comment", "mcp__linear-server__list_issue_labels", "mcp__linear-server__create_issue_label", "mcp__linear-server__list_documents", "mcp__linear-server__get_document", "mcp__linear-server__list_teams"]
---

# Linear PRD Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

- A Linear **workspace** URL — scans every project in the workspace whose labels include `prd-ready`. Example: `https://linear.app/acme`.
- A Linear **team** URL or team key — scans every project on the team whose labels include `prd-ready`. Example: `https://linear.app/acme/team/ENG/projects` or bare `ENG`.
- The literal token `linear` — equivalent to "the default Linear workspace"; only valid if `LINEAR_WORKSPACE` is configured.

Run one intake cycle against that scope. Each project with the `prd-ready` label is claimed, validated, and routed to either `prd-blocked` (with clarifying comments on a sentinel feedback issue) or `prd-ticketed` (with JIRA tickets created).

This skill is the Linear counterpart of `lisa:notion-prd-intake` and `lisa:confluence-prd-intake`. The phases, gates, comment templates, and rules are identical — the only differences are (1) the lifecycle is encoded as **project labels** instead of a Status property, (2) the fetch / update tools are Linear MCP, and (3) clarifying-question comments land on a sentinel feedback Issue under the project (because Linear's MCP does not expose project-level comments). Keep all three skills behaviorally aligned: when changing intake logic, change them together.

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a workspace/team scope, run the cycle to completion — claim, validate, branch to `prd-blocked` or `prd-ticketed`, write the summary. The caller (a human or a cron) has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background batch.

Specifically forbidden:

- Previewing projected scope (epic count, story count, write count) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip / dry-run only" — the documented behavior IS the default.
- Pausing because a PRD looks large, has many open questions, or is likely to end in `prd-blocked`. `prd-blocked` is a valid terminal state of this lifecycle, not a failure mode — routing a PRD to `prd-blocked` with gate-failure comments is exactly how this skill communicates "the PRD needs more work before it can be ticketed." That outcome is success.
- Pausing because the dry-run validation looks expensive. The cost of one cycle is bounded; the cost of stalling a scheduled cron waiting on a human is unbounded.

The only legitimate reasons to stop early:

- Missing scope argument or required configuration (`JIRA_PROJECT`, `JIRA_SERVER`, `LINEAR_WORKSPACE`, `E2E_BASE_URL`, etc.). Surface the missing key(s) and exit this cycle — never invent values.
- Workspace/team unreachable, or the labelling convention not yet adopted (no projects carry any of `prd-ready` / `prd-in-review` / `prd-blocked` / `prd-ticketed`). Surface and exit.
- Empty `prd-ready` set. Exit cleanly with `"No Linear projects labelled prd-ready. Nothing to do."`

## Lifecycle assumed

The Linear PRD lifecycle is encoded as **project labels** (we deliberately do NOT key off Linear's native project state, since project state is product's day-to-day signal and we don't want to fight it). Exactly one of these labels is expected on a project at any time:

```text
prd-draft → prd-ready → prd-in-review → prd-blocked | prd-ticketed → prd-shipped
            (product)    (us)            (us)                          (product)
```

This skill ONLY transitions:

- `prd-ready` → `prd-in-review` (claim)
- `prd-in-review` → `prd-blocked` (gate failures or coverage gaps)
- `prd-in-review` → `prd-ticketed` (success)
- `prd-ticketed` → `prd-blocked` (post-write coverage gaps from Phase 3e)

It never adds, removes, or touches `prd-draft` or `prd-shipped`. Those labels are owned by product.

A "transition" means: remove the old lifecycle label and add the new one in a single `save_project` call (passing the full new label set in the `labels` array). The skill MUST verify that exactly one lifecycle label exists on the project after the update — having two simultaneously breaks idempotency.

If the project does not yet use `prd-*` labels, this skill cannot run. Adopting the convention is a one-time setup the project owner does (see "Adoption" at the bottom of this file).

## Phases

### Phase 1 — Resolve the scope

1. Parse `$ARGUMENTS`:
   - Workspace URL (`https://linear.app/<workspace>`) → extract workspace slug; the scope is the entire workspace.
   - Team URL containing `/team/<KEY>/...` → extract team key; the scope is that team.
   - Bare team key → use as-is; the scope is that team.
   - The literal `linear` → fall back to `LINEAR_WORKSPACE` env var; error if not set.
2. Verify the scope is reachable:
   - For a workspace: call `mcp__linear-server__list_teams` and confirm at least one team is returned (non-empty workspaces are readable; empty results indicate auth or workspace-mismatch).
   - For a team: call `mcp__linear-server__list_teams({query: <KEY>})` and confirm the team resolves.
3. Resolve the project-label IDs for `prd-ready`, `prd-in-review`, `prd-blocked`, `prd-ticketed` via `mcp__linear-server__list_project_labels`. Cache them — every transition uses these IDs. If any of the four are missing, surface a label-convention error and exit (see "Adoption").

### Phase 2 — Find Ready PRDs

Call `mcp__linear-server__list_projects({label: "prd-ready", ...scope-filter})`:

- For a workspace scope: pass `label: "prd-ready"` only.
- For a team scope: pass `label: "prd-ready"` AND `team: "<KEY>"`.

The query returns the list of candidate projects with IDs, names, and label sets. For each candidate, confirm that exactly one lifecycle label is present (the API filter is `prd-ready`, but a project could have ended up with two labels by hand — that's a misconfiguration, not a normal queue entry).

If the result set is empty, run a secondary query to distinguish between a genuinely empty queue and a workspace/team that has not yet adopted the label convention:

- Secondary query: `list_projects({...scope-filter})` with no label filter, then in-process check whether any returned project carries any of `prd-ready` / `prd-in-review` / `prd-blocked` / `prd-ticketed`.

If the secondary query shows zero projects carrying any `prd-*` label → the convention has not been adopted. Surface a misconfiguration message: `"No Linear projects in this scope carry prd-* labels. If this is a new project, apply the prd-ready label to projects that are ready for ticketing (see Adoption section)."` Exit with an error — this is a setup issue, not a normal idle cycle.

If the secondary query shows projects with other `prd-*` labels but none with `prd-ready` → the queue is genuinely empty (all PRDs are already in-review, blocked, ticketed, or shipped). Exit cleanly with `"No Linear projects labelled prd-ready. Nothing to do."`

### Phase 3 — Process each Ready PRD

For each project (process serially to keep label transitions auditable):

#### 3a. Claim

Transition labels via `mcp__linear-server__save_project({id, labels})`: pass the full new label set with `prd-ready` removed and `prd-in-review` added. This is the idempotency lock — a re-entrant cycle running concurrently won't see this project because its query filters on `label: "prd-ready"`.

If the update fails (permission error, race condition), log it and skip this project. Do not proceed to validation on a project you didn't successfully claim.

The `save_project` call must preserve all other project fields (description, state, priority, lead, dates, teams, initiatives) untouched — pass only `id` and the new `labels` array. This skill never edits PRD body content.

#### 3b. Dry-run validation

Invoke the `lisa:linear-to-jira` skill with `dry_run: true` and the project's URL. The skill returns a structured report containing:
- The planned ticket hierarchy
- Per-ticket validation verdicts and remediation
- An overall PASS / FAIL verdict
- A failure count

This call also indirectly invokes `lisa:jira-source-artifacts` (artifact extraction + classification) and `lisa:product-walkthrough` (when the PRD touches existing user-facing surfaces). All gate logic lives in `lisa:jira-validate-ticket`, which `lisa:linear-to-jira` calls per ticket.

#### 3c. Branch on the verdict

**If `PASS`** (every planned ticket passed every applicable gate):

1. Re-invoke `lisa:linear-to-jira` with `dry_run: false` to actually write the tickets. This re-runs Phases 1-5 and runs the preservation gate (Phase 5.5).
2. Capture the created ticket keys from the skill's output.
3. Ensure the project has a sentinel feedback issue (see "Sentinel feedback issue" below for the helper). Post a comment on it via `mcp__linear-server__save_comment` listing the created tickets (epic, stories, sub-tasks) with their JIRA URLs. Lead with: `"Ticketed by Claude. Created N JIRA issues — see below. Add the prd-shipped label to the Linear project after the work is delivered."`
4. Transition labels: remove `prd-in-review`, add `prd-ticketed` via `save_project`.
5. **Run Phase 3e (coverage audit)** before considering this PRD done.

**If `FAIL`** (one or more planned tickets failed one or more gates):

The audience for these comments is the **product team**, not engineers. They are not familiar with JIRA gate IDs, validator vocabulary, or skill internals. Follow the rules below strictly — the goal is for a non-engineer product owner to read a comment, understand what is unclear, and know what to do next.

##### 3c.1 Partition failures

1. Drop every failure where `product_relevant = false`. Those are internal data-quality problems — the agent should fix its own spec rather than ask product to clarify a missing core field. Record the dropped failures under `Errors` in the cycle summary so engineers can see them; never surface them on the PRD.
2. Group the remaining product-relevant failures by `prd_anchor` (which, for Linear, is a sub-issue identifier when the failure traces to a specific issue, or `null` otherwise). Failures that share an anchor become one comment thread on that issue. Failures with `prd_anchor: null` are batched into one comment on the sentinel feedback issue, since they have no source sub-issue to attach to.

##### 3c.2 Render each comment

Ensure the project has a sentinel feedback issue (see helper below). For each anchored group (`prd_anchor` is a sub-issue identifier), post a comment on THAT sub-issue via `mcp__linear-server__save_comment({issueId: <prd_anchor>, body: <template>})`. For the unanchored group, post a single comment on the sentinel feedback issue using the same template, prefixed with `Issues without a specific sub-issue anchor:` and one block per failure.

If `save_comment` fails for a specific anchored sub-issue (the issue was deleted between fetch and post, or the agent lacks comment permission), fall back to the sentinel feedback issue for that group. Do not silently drop the failure.

##### 3c.3 Comment template

Each comment body MUST contain these four parts, in this order, no exceptions:

```text
[<Category badge>] <prd_section heading text>

**What's unclear:** <validator's `what` field, verbatim — already product-readable>

**Recommendation:** <validator's `recommendation` field, verbatim — must contain 1–3 concrete options, never a generic "please clarify">

**Action:** Update this section in the PRD, then replace the `prd-blocked` label with `prd-ready` on the Linear project and Claude will re-run intake.
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
- Internal skill names (`lisa:jira-validate-ticket`, `linear-to-jira`).
- Engineering shorthand (`AC`, `OOS`, `repo`, `env var`).
- "Clarify this" / "Please specify" without candidate resolutions. The validator is required to provide candidates; if `recommendation` is empty or vague, treat the failure as an Error and surface internally rather than posting a useless comment.

##### 3c.6 Label transition

After all comments are posted (anchored groups + the optional sentinel-issue summary), transition labels: remove `prd-in-review`, add `prd-blocked` via `save_project`. Do NOT write any JIRA tickets.

#### 3d. Continue

Move to the next Ready PRD. One PRD failing does not affect others.

#### 3e. Coverage audit (mandatory after prd-ticketed)

Per-ticket gates prove each ticket is well-formed; they do NOT prove the *set* of created tickets covers the *whole* PRD. Silent drops happen — invoke the `lisa:prd-ticket-coverage` skill to catch them.

1. Invoke `lisa:prd-ticket-coverage` with `<PRD URL> tickets=[<created ticket keys from 3c step 2>]`. The coverage skill auto-detects the PRD vendor from the URL.
2. Read the verdict:

   | Verdict | Action |
   |---------|--------|
   | `COMPLETE` | Done. Leave label as `prd-ticketed`. Move to next PRD. |
   | `COMPLETE_WITH_SCOPE_CREEP` | Post an advisory comment on the sentinel feedback issue naming the scope-creep tickets (so product can decide whether to close them as out-of-scope). Leave label as `prd-ticketed`. |
   | `GAPS_FOUND` | The created ticket set is incomplete. (a) For each gap, post a comment using the same product-facing template as Phase 3c.3 — anchored on the relevant sub-issue when `prd_anchor` is non-null, on the sentinel feedback issue otherwise; category badge from the gap's `category` field; `What's unclear` and `Recommendation` from the audit report's `what` and `recommendation` fields. Apply the same forbidden-language rules from Phase 3c.5. (b) Post one summary comment on the sentinel feedback issue listing the tickets that *were* successfully created (so product knows what to keep vs. what to extend). (c) Transition labels from `prd-ticketed` back to `prd-blocked` via `save_project`. |
   | `NO_TICKETS_FOUND` | Should not happen if step 2 succeeded. If it does, log it as an Error in the cycle summary and leave label as `prd-ticketed` with a comment flagging the audit failure for human review. |

3. The created tickets remain in JIRA regardless of the verdict — they are valid in their own right. The audit only tells us whether *more* are needed.

### Phase 4 — Summary report

After processing every Ready PRD, emit a summary:

```text
## linear-prd-intake summary

Scope: <workspace-slug | team-key> (<URL>)
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

PRDs processed: <n>
- prd-ticketed: <n>
  - <project name> → <epic-key> + <story-count> stories + <subtask-count> sub-tasks (coverage: COMPLETE | COMPLETE_WITH_SCOPE_CREEP)
- prd-blocked: <n>
  - <project name> → <gate-failure-count> gate failures (pre-write) OR <gap-count> coverage gaps (post-write)
- Errors (claim failed, etc): <n>
  - <project name> — <reason>

Total JIRA tickets created: <n>
Coverage audit summary: <n> COMPLETE / <n> COMPLETE_WITH_SCOPE_CREEP / <n> GAPS_FOUND
```

Print to the agent's output. Do not write this summary to Linear or JIRA — it's an operational record for the human.

## Sentinel feedback issue

Linear's MCP does not expose project-level comments. To preserve the comment-based feedback channel that Notion and Confluence intake have natively, this skill maintains a single sentinel **feedback Issue** under each project. All clarifying-question comments that don't anchor to a specific sub-issue land here.

The sentinel issue is identified by:

- A stable title: `"PRD intake: clarifying questions"`
- A stable label: `prd-intake-feedback` (issue-level label, distinct from the project-level `prd-*` labels)
- Membership in the project being processed

Helper behavior — call this **before** posting any clarifying-question comment in Phase 3c or 3e:

1. Search for an existing feedback issue: `list_issues({project: <id>, label: "prd-intake-feedback"})`. If multiple match (shouldn't happen, but defensive), use the oldest by `createdAt`.
2. If none exists: ensure the `prd-intake-feedback` label exists on the project's team via `list_issue_labels` then `create_issue_label` if needed; then create the sentinel via `save_issue({team: <team-id>, project: <id>, title: "PRD intake: clarifying questions", description: "Auto-created by lisa:linear-prd-intake. This issue collects clarifying-question comments that don't anchor to a specific sub-issue. Do not close manually — it is reused across intake cycles.", labels: ["prd-intake-feedback"]})`. Capture the new issue identifier.
3. Return the issue identifier to the caller for use in `save_comment({issueId: <id>, body: ...})`.

Idempotency: the helper finds-or-creates. Re-runs of the cycle reuse the same sentinel issue. Comments accumulate; product reads top-down to see the latest cycle's findings. Do not delete or repurpose old comments — history is the audit trail.

## Idempotency & safety

- **Single-cycle scope**: this skill processes the `prd-ready` set as it exists at the start of Phase 2. New `prd-ready` projects added mid-cycle are picked up next run.
- **No writes outside the lifecycle**: this skill only ever writes to JIRA via `lisa:linear-to-jira` (which delegates to `lisa:jira-write-ticket`), only ever changes Linear project labels among `prd-in-review`, `prd-blocked`, `prd-ticketed`, only ever creates/comments on the sentinel feedback issue (never any other Linear issue). It never edits project descriptions, never edits Linear documents, never touches `prd-draft` or `prd-shipped`, never archives or deletes projects.
- **Claim-first ordering**: the label flip to `prd-in-review` happens BEFORE validation runs, so a re-entrant call won't double-process.
- **Failure isolation**: an exception processing one project must not stop the cycle. Catch, record under "Errors" in the summary, continue to the next project. The project that errored is left labelled `prd-in-review` — the human investigates from there.
- **Single-label invariant**: after every transition, verify exactly one lifecycle label is present on the project. If two are present (rare race), surface as an Error and skip — do NOT auto-resolve, the human decides.

## Configuration

Same env vars as `lisa:linear-to-jira` — `JIRA_PROJECT`, `JIRA_SERVER`, `LINEAR_WORKSPACE`, `E2E_BASE_URL`, `E2E_TEST_PHONE`, `E2E_TEST_OTP`, `E2E_TEST_ORG`, `E2E_GRAPHQL_URL`. If any required value is missing, surface the missing key(s) and exit this cycle — never invent values.

## Rules

- Never write to JIRA outside of `lisa:linear-to-jira` → `lisa:jira-write-ticket`. The validator's verdict gates progress; bypassing it produces broken tickets.
- Never add or remove a label this skill doesn't own (`prd-in-review`, `prd-blocked`, `prd-ticketed`). Product owns `prd-draft`, `prd-ready`, `prd-shipped`. The issue-level `prd-intake-feedback` label is owned by this skill but is not a lifecycle label.
- Never edit a project's description or any attached Linear document. Communication with product happens only through comments on sub-issues or on the sentinel feedback issue.
- Never post a single dump of all gate failures on one comment. One comment per `prd_anchor` group on the relevant sub-issue (or one comment on the sentinel feedback issue for unanchored failures only). Comments must be sub-issue-anchored where possible, categorized, plain-language, and contain a concrete recommendation.
- Never include a gate ID, internal skill name, or engineering shorthand in a comment body.
- Never run more than one intake cycle concurrently against the same scope. This skill assumes serial execution.
- Never close, archive, or otherwise modify the sentinel feedback issue except to post comments on it. Its longevity is the audit trail.
- If `lisa:linear-to-jira` returns errors, treat them as gate failures: comment + `prd-blocked`. Don't silently fail.

## Adoption (one-time per project)

Before this skill can run against a Linear workspace or team, the team must adopt the `prd-*` project-label convention:

1. Apply `prd-ready` to projects that are ready for ticketing (replaces the Notion `Status = Ready` flip and the Confluence `prd-ready` page label).
2. Reserve `prd-in-review`, `prd-blocked`, `prd-ticketed` for this skill — humans should not set them manually except to recover from an error.
3. (Optional but recommended) Add `prd-draft` for in-progress PRDs and `prd-shipped` for delivered work, so the full lifecycle is visible at a glance.
4. The labels must exist as **project labels** in Linear (`list_project_labels` should return them). Issue-level labels with the same names won't work; Linear keeps the two label kinds separate.

If the workspace hasn't adopted these labels, the first run exits with a label-convention error (not the idle empty-set message) — this distinguishes a setup issue from a genuinely empty queue so operators know to apply the convention rather than assuming the queue is drained. See Phase 2 for how the skill detects this case.
