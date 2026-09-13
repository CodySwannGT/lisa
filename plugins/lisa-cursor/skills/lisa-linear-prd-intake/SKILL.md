---
name: lisa-linear-prd-intake
description: "Scans a Linear workspace (or a specific team) for projects carrying the configured `ready` PRD label and runs the first eligible one through the dry-run validation pipeline. A project that passes every gate gets tickets written and the label flipped to the configured `ticketed` label; a project that fails gets clarifying-question comments (on the project itself, and on the relevant sub-issue where the failure anchors to one) and the label flipped to the configured `blocked` label. Linear counterpart of `lisa-notion-prd-intake` and `lisa-confluence-prd-intake` — the workflow is identical; only the source-of-truth tools differ. Composes existing skills (linear-to-tracker, tracker-validate, tracker-source-artifacts, product-walkthrough)."
allowed-tools: ["Skill", "Bash"]
---

# Linear PRD Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

- A Linear **workspace** URL — scans every project in the workspace whose labels include the configured `ready` label. Example: `https://linear.app/acme`.
- A Linear **team** URL or team key — scans every project on the team whose labels include the configured `ready` label. Example: `https://linear.app/acme/team/ENG/projects` or bare `ENG`.
- The literal token `linear` — equivalent to "the default Linear workspace"; only valid if `linear.workspace` is configured in `.lisa.config.json`.

Run one intake cycle against that scope. The first eligible project with the `ready` label is claimed, validated, routed to either the `blocked` label (with clarifying comments on the project) or the `ticketed` label (with destination tickets created), then the cycle exits. Remaining ready projects stay queued for later scheduler invocations.

## Workflow resolution

PRD label names are read from `.lisa.config.json` `linear.labels.prd.*`, falling back to defaults documented in the `config-resolution` rule. Bash pattern:

```bash
# Read role with default fallback. Local overrides global per-key.
read_role() {
  # Single resolver — see config-resolution "The single resolver".
  # Exit 0 + empty output means an OPTIONAL role is unset: skip that transition,
  # never substitute the second argument. A default on an optional role is what
  # made "unset" indistinguishable from "not customized".
  node "${CLAUDE_PLUGIN_ROOT}/scripts/resolve-lifecycle-role.mjs" \
    --role "$1" --vendor linear --intent "${3:-read}" 2>/dev/null
}

READY=$(read_role ready "prd-ready")
IN_REVIEW=$(read_role in_review "prd-in-review")
BLOCKED=$(read_role blocked "prd-blocked")
TICKETED=$(read_role ticketed "prd-ticketed")
SHIPPED=$(read_role shipped "prd-shipped")
SENTINEL=$(read_role sentinel "prd-intake-feedback")
```

`$SENTINEL` is **legacy-read-only**. This skill no longer creates a sentinel
feedback issue — unanchored comments go on the project. The role is still
resolved because projects intake ran against before this change already carry
one, and the rollup phase must recognise it to keep it out of the denominator
(see "Legacy sentinel feedback issues").

In prose below, the role names refer to the resolved labels: e.g. "the `ready` label" means whatever `linear.labels.prd.ready` resolves to (default: `prd-ready`).

This skill is the Linear counterpart of `lisa-notion-prd-intake` and `lisa-confluence-prd-intake`, and shares its PRD shipped rollup phase (3f) with `lisa-github-prd-intake`. The phases, gates, comment templates, and rules are identical — the only differences are (1) the lifecycle is encoded as **project labels** instead of a status property, and (2) the fetch / update surface is `lisa-linear-access`. Unanchored clarifying-question comments land on the **project itself**, exactly as they do on a Notion or Confluence page — `lisa-linear-access operation: save-comment project_id:<ID>` maps to `commentCreate(input: { projectId, body })`, which Linear has always supported. Keep all four intake skills behaviorally aligned: when changing intake logic — including the rollup phase — change them together.

The **PRD shipped rollup phase (3f)** transitions a `$TICKETED` PRD project to `$SHIPPED` once all its generated top-level work is terminal, per the `prd-lifecycle-rollup` rule. This is the Linear leg of the same vendor-neutral rollup that `lisa-github-prd-intake` implements for GitHub (LPC-1.3 #584); only the vendor surface (Linear workflow states + project labels) differs.

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a workspace/team scope, run the cycle to completion for the first eligible project — claim, validate, branch to `$BLOCKED` or `$TICKETED`, write the summary, and exit. The caller (a human or a cron) has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background queue.

Specifically forbidden:

- Previewing projected scope (epic count, story count, write count) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip / dry-run only" — the documented behavior IS the default.
- Pausing because a PRD looks large, has many open questions, or is likely to end in `$BLOCKED`. The `blocked` label is a valid terminal state of this lifecycle, not a failure mode — routing a PRD there with gate-failure comments is exactly how this skill communicates "the PRD needs more work before it can be ticketed." That outcome is success.
- Pausing because the dry-run validation looks expensive. The cost of one cycle is bounded; the cost of stalling a scheduled cron waiting on a human is unbounded.

The only legitimate reasons to stop early:

- Missing scope argument or required configuration (`linear.workspace` in `.lisa.config.json`, `E2E_BASE_URL`, etc.). Surface the missing key(s) and exit this cycle — never invent values.
- Workspace/team unreachable, or the labelling convention not yet adopted (no projects carry any of `$READY` / `$IN_REVIEW` / `$BLOCKED` / `$TICKETED`). Surface and exit.
- Empty ready set. Exit cleanly with `"No Linear projects labelled $READY. Nothing to do."`

## Lifecycle assumed

The Linear PRD lifecycle is encoded as **project labels** (we deliberately do NOT key off Linear's native project state, since project state is product's day-to-day signal and we don't want to fight it). Exactly one of these labels is expected on a project at any time:

```text
draft → ready → in_review → blocked | ticketed → shipped → verified
        (product)  (us)      (us)                  (product)  (product)
```

(Defaults: `prd-draft` / `prd-ready` / `prd-in-review` / `prd-blocked` / `prd-ticketed` / `prd-shipped` / `prd-verified`.)

`verified` is the terminal state after `shipped`: it means the shipped product has been empirically checked against the PRD (set by `/lisa:verify-prd`, not by this intake skill). A failed post-ship verification does **not** use `blocked`; `/lisa:verify-prd` re-opens the PRD `shipped → ticketed` and creates build-ready fix tickets that auto-build and trigger a re-verify (the self-healing loop), introducing no `verifying` / `verification-failed` state. Like `draft` and `shipped`, `verified` is **product-owned** — this intake skill never sets, clears, or otherwise touches it. See the "PRD-level verification vs ticket verification" section of the `prd-lifecycle-rollup` rule.

This skill transitions:

- `$READY` → `$IN_REVIEW` (claim)
- `$IN_REVIEW` → `$BLOCKED` (gate failures or coverage gaps)
- `$IN_REVIEW` → `$TICKETED` (success)
- `$TICKETED` → `$BLOCKED` (post-write coverage gaps from Phase 3e)
- `$TICKETED` → `$SHIPPED` (PRD shipped rollup, Phase 3f — only when **all** generated top-level children are terminal)

It never touches the `draft` or `verified` labels — those labels are owned by product (`verified` is set by `/lisa:verify-prd` after empirical PRD-level acceptance). The `shipped` label is set by this skill's **rollup phase (3f)** when, and only when, the PRD project's generated top-level work is all terminal — per the `prd-lifecycle-rollup` rule; product may also set it by hand. Rollup never advances a PRD to `shipped` on partial completion, and never archives a PRD project at shipped. `/lisa:verify-prd` archives or completes the project only after a verified PASS.

A "transition" means: remove the old lifecycle label and add the new one in a single `save_project` call (passing the full new label set in the `labels` array). The skill MUST verify that exactly one lifecycle label exists on the project after the update — having two simultaneously breaks idempotency.

If the project does not yet use these labels, this skill cannot run. Adopting the convention is a one-time setup the project owner does (see "Adoption" at the bottom of this file).

## Phases

### Phase 1 — Resolve the scope

1. Parse `$ARGUMENTS`:
   - Workspace URL (`https://linear.app/<workspace>`) → extract workspace slug; the scope is the entire workspace.
   - Team URL containing `/team/<KEY>/...` → extract team key; the scope is that team.
   - Bare team key → use as-is; the scope is that team.
   - The literal `linear` → fall back to `linear.workspace` from `.lisa.config.json`; error if not set.
2. Verify the scope is reachable:
   - For a workspace: call `lisa-linear-access operation: list-teams` and confirm at least one team is returned (non-empty workspaces are readable; empty results indicate auth or workspace-mismatch).
   - For a team: call `lisa-linear-access operation: list-teams({query: <KEY>})` and confirm the team resolves.
3. Resolve the project-label IDs for `$READY`, `$IN_REVIEW`, `$BLOCKED`, `$TICKETED` via `lisa-linear-access operation: list-project-labels`. Cache them — every transition uses these IDs. If any of the four are missing, surface a label-convention error and exit (see "Adoption").

### Phase 2 — Find ready PRDs

Call `lisa-linear-access operation: list-projects({label: "$READY", ...scope-filter})`:

- For a workspace scope: pass `label: "$READY"` only.
- For a team scope: pass `label: "$READY"` AND `team: "<KEY>"`.

The query returns the list of candidate projects with IDs, names, and label sets. For each candidate, confirm that exactly one lifecycle label is present (the API filter is `$READY`, but a project could have ended up with two labels by hand — that's a misconfiguration, not a normal queue entry).

If the result set is empty, run a secondary query to distinguish between a genuinely empty queue and a workspace/team that has not yet adopted the label convention:

- Secondary query: `list_projects({...scope-filter})` with no label filter, then in-process check whether any returned project carries any of `$READY` / `$IN_REVIEW` / `$BLOCKED` / `$TICKETED`.

If the secondary query shows zero projects carrying any PRD lifecycle label → the convention has not been adopted. Surface a misconfiguration message: `"No Linear projects in this scope carry PRD lifecycle labels. If this is a new project, apply the $READY label to projects that are ready for ticketing (see Adoption section)."` Exit with an error — this is a setup issue, not a normal idle cycle.

If the secondary query shows projects with other PRD lifecycle labels but none with `$READY` → the queue is genuinely empty (all PRDs are already in `in_review`, `blocked`, `ticketed`, or `shipped`). Exit cleanly with `"No Linear projects labelled $READY. Nothing to do."`

### Phase 3 — Process the first eligible ready PRD

Select the first ready project returned by Phase 2 and process only that project. Later scheduler invocations process the remaining ready projects.

#### 3a. Claim

**Preflight project comments before any claim or destination-ticket creation.** Through
`lisa-linear-access`, resolve an identity-matched tier-1 GraphQL credential and the
`save-comment project_id` adapter, then read the candidate's complete project comment
history with `list-comments project_id:<id>`. The issue-only MCP is insufficient for
this flow. If the required credential, adapter or read is unavailable, return the
layer's `Error:` naming the project-comment operation and leave the project ready;
create no tickets and no substitute comment-holder Issue. This is a read-only
capability preflight, not a test comment. It establishes the available transport;
later permission changes or write failures still follow the normal error handler.

Transition labels via `lisa-linear-access operation: save-project({id, labels})`: pass the full new label set with `$READY` removed and `$IN_REVIEW` added. This is the idempotency lock — a re-entrant cycle running concurrently won't see this project because its query filters on `label: "$READY"`.

If the update fails (permission error, race condition), log it and skip this project. Do not proceed to validation on a project you didn't successfully claim.

The `save_project` call must preserve all other project fields (description, state, priority, lead, dates, teams, initiatives) untouched — pass only `id` and the new `labels` array. This skill never edits PRD body content.

#### 3b. Dry-run validation

Invoke the `lisa-linear-to-tracker` skill with `dry_run: true` and the project's URL. The skill returns a structured report containing:
- The planned ticket hierarchy
- Per-ticket validation verdicts and remediation
- An overall PASS / FAIL verdict
- A failure count

This call also indirectly invokes `lisa-tracker-source-artifacts` (artifact extraction + classification) and `lisa-product-walkthrough` (when the PRD touches existing user-facing surfaces). All gate logic lives in `lisa-tracker-validate`, which `lisa-linear-to-tracker` calls per ticket.

#### 3c. Branch on the verdict

**If `PASS`** (every planned ticket passed every applicable gate):

1. Re-invoke `lisa-linear-to-tracker` with `dry_run: false` to actually write the tickets. This re-runs Phases 1-5 and runs the preservation gate (Phase 5.5).
2. Capture the created ticket keys from the skill's output.
3. Post a comment on the project via `lisa-linear-access operation: save-comment project_id:<id>` listing the created tickets (epic, stories, sub-tasks) with the URLs returned by the configured destination tracker. Lead with: `"Ticketed by Claude. Created N tickets — see below. Add the $SHIPPED label to the Linear project after the work is delivered."`
4. Transition labels: remove `$IN_REVIEW`, add `$TICKETED` via `save_project`.
5. **Run Phase 3e (coverage audit)** before considering this PRD done.

**If `FAIL`** (one or more planned tickets failed one or more gates):

The audience for these comments is the **product team**, not engineers. They are not familiar with JIRA gate IDs, validator vocabulary, or skill internals. Follow the rules below strictly — the goal is for a non-engineer product owner to read a comment, understand what is unclear, and know what to do next.

##### 3c.1 Partition failures

1. Drop every failure where `product_relevant = false`. Those are internal data-quality problems — the agent should fix its own spec rather than ask product to clarify a missing core field. Record the dropped failures under `Errors` in the cycle summary so engineers can see them; never surface them on the PRD.
2. Group the remaining product-relevant failures by `prd_anchor` (which, for Linear, is a sub-issue identifier when the failure traces to a specific issue, or `null` otherwise). Failures that share an anchor become one comment thread on that issue. Failures with `prd_anchor: null` are batched into one comment on the **project itself**, since they have no source sub-issue to attach to.

##### 3c.2 Render each comment

For each anchored group (`prd_anchor` is a sub-issue identifier), post a comment on THAT sub-issue via `lisa-linear-access operation: save-comment issue_id:<prd_anchor> body:<template>`. For the unanchored group, post a single comment on the **project** via `lisa-linear-access operation: save-comment project_id:<id> body:<template>`, using the same template, prefixed with `Issues without a specific sub-issue anchor:` and one block per failure.

If `save-comment` fails for a specific anchored sub-issue (the issue was deleted between fetch and post, or the agent lacks comment permission), fall back to the **project** comment for that group. Do not silently drop the failure, and do not create an issue to hold it.

##### 3c.3 Comment template

Each comment body MUST contain these four parts, in this order, no exceptions:

```text
[<Category badge>] <prd_section heading text>

**What's unclear:** <validator's `what` field, verbatim — already product-readable>

**Recommendation:** <validator's `recommendation` field, verbatim — must contain 1–3 concrete options, never a generic "please clarify">

**Action:** Update this section in the PRD, then replace the `$BLOCKED` label with `$READY` on the Linear project and Claude will re-run intake.
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
- Internal skill names (`lisa-tracker-validate`, `linear-to-tracker`).
- Engineering shorthand (`AC`, `OOS`, `repo`, `env var`).
- "Clarify this" / "Please specify" without candidate resolutions. The validator is required to provide candidates; if `recommendation` is empty or vague, treat the failure as an Error and surface internally rather than posting a useless comment.

##### 3c.6 Label transition

After all comments are posted (anchored groups + the optional project-level summary), transition labels: remove `$IN_REVIEW`, add `$BLOCKED` via `save_project`. Do NOT write any destination tickets.

#### 3d. Stop

Stop immediately after the claimed PRD is ticketed, blocked, or recorded as an error.

#### 3e. Coverage audit (mandatory after $TICKETED)

Per-ticket gates prove each ticket is well-formed; they do NOT prove the *set* of created tickets covers the *whole* PRD. Silent drops happen — invoke the `lisa-prd-ticket-coverage` skill to catch them.

1. Invoke `lisa-prd-ticket-coverage` with `<PRD URL> tickets=[<created ticket keys from 3c step 2>]`. The coverage skill auto-detects the PRD vendor from the URL.
2. Read the verdict:

   | Verdict | Action |
   |---------|--------|
   | `COMPLETE` | Done. Leave label as `$TICKETED`. End the cycle. |
   | `COMPLETE_WITH_SCOPE_CREEP` | Post an advisory comment on the project naming the scope-creep tickets (so product can decide whether to close them as out-of-scope). Leave label as `$TICKETED`. |
   | `GAPS_FOUND` | The created ticket set is incomplete. (a) For each gap, post a comment using the same product-facing template as Phase 3c.3 — anchored on the relevant sub-issue when `prd_anchor` is non-null, on the project otherwise; category badge from the gap's `category` field; `What's unclear` and `Recommendation` from the audit report's `what` and `recommendation` fields. Apply the same forbidden-language rules from Phase 3c.5. (b) Post one summary comment on the project listing the tickets that *were* successfully created (so product knows what to keep vs. what to extend). (c) Transition labels from `$TICKETED` back to `$BLOCKED` via `save_project`. |
   | `NO_TICKETS_FOUND` | Should not happen if step 2 succeeded. If it does, log it as an Error in the cycle summary and leave label as `$TICKETED` with a comment flagging the audit failure for human review. |

3. The created tickets remain in the destination tracker regardless of the verdict — they are valid in their own right. The audit only tells us whether *more* are needed.

#### 3f. PRD shipped rollup

A PRD's lifecycle terminal state (`shipped`) is **derived** from whether the work it generated is done — it is never set by hand here on its own authority. This phase implements the Linear leg of that derivation, per the `prd-lifecycle-rollup` rule (cite it by slug; do not restate its taxonomy or terminal-state semantics here). It is behaviorally identical to `lisa-github-prd-intake`'s Phase 3f — only the vendor surface (Linear workflow states + project labels via Linear MCP) differs from GitHub's (issue close + labels via `gh`).

Rollup runs over PRD projects that are already `$TICKETED` (the only state from which a PRD can ship): the freshly-ticketed project from Phase 3c, and — because rollup also catches PRDs whose children finished in a *later* cycle — every project currently carrying `$TICKETED`. Process each independently; one PRD never blocks another's rollup.

##### 3f.0 Shipped remains active for verification

There is no close/archive configuration at the shipped hop. Rollup sets `$SHIPPED` and leaves the PRD project **active** so Phase 3g can dispatch `/lisa:verify-prd`. Provider-native archive/completion is owned by `/lisa:verify-prd` after it transitions `$SHIPPED → verified` on a PASS.

##### 3f.1 Idempotency guard (no-op if already shipped)

Rollup is keyed by the PRD's current state. If the PRD project already carries `$SHIPPED`, it is a **no-op** — do not re-transition, do not archive, do not re-comment. Record it as `already shipped (no-op)` in the cycle summary and move on. This is what makes re-running intake safe.

##### 3f.2 Read the generated top-level child set

Read the PRD's **generated top-level work** — its created Epics and any top-level Stories created directly under it, **excluding** leaf Sub-tasks and any Story nested under a generated Epic (`prd-lifecycle-rollup` rule, generated-top-level-work contract). Use two sources, native first:

1. **Native parent / project relationships (primary).** Linear records the PRD→child relationship natively where the PRD also lives in Linear: a generated top-level Issue uses `parentId`, or a generated Project groups the generated Issues. Read the PRD project's generated top-level Issues via `lisa-linear-access operation: list-issues({project: <id>})` and take the **top-level** ones (no `parentId`, or whose parent is the PRD itself) — those are the PRD's direct children. Fetch each with `lisa-linear-access operation: get-issue` for its workflow state.

2. **Documented `## Tickets` section (fallback).** When the native relationship is unavailable (the destination tracker is a *different* system — e.g. Linear PRD → JIRA tracker — so the children were never linked as Linear issues), parse the machine-readable generated-work section `lisa-prd-backlink` writes to the PRD (`## Tickets`, alias `## Generated Work`; see #582). Top-level children are the `### <Epic key>: <title>` group headers' first line (`- [<ref>](<url>) — Epic`) plus any top-level Story listed directly under `### Unparented items`. Lines nested deeper (`  - ... — Story:` under an Epic, `    - ... — Sub-task:`) are descendants, NOT top-level children — skip them.

**Exclude any Issue carrying the `$SENTINEL` label from the child set entirely — before the dedupe, before the predicate.** A legacy sentinel is an artifact of this skill, not generated work, and it can never be terminal: closing it was forbidden precisely so its comment history stayed intact. Counting it kept the PRD out of `$SHIPPED` forever — a project whose real children were all terminal still sat at `$TICKETED` because the one non-terminal child was the reporting mechanism itself. It is excluded regardless of its state, so projects that already have a sentinel unjam without anyone touching the sentinel. Record it in the cycle summary as `excluded: legacy sentinel <ref>` so the exclusion is visible rather than silent.

Dedupe the resulting child set by **child-ref identity** (the Linear issue/project identifier, e.g. `TEAM-123` or its UUID) so a child that appears both as a native relationship and in the documented section is counted once (`prd-lifecycle-rollup` idempotency dedupe key). If neither source yields any child (the PRD generated nothing, or the relationship was never recorded), record `no generated top-level children — rollup skipped` and leave the PRD as `$TICKETED`; do not ship an empty PRD.

##### 3f.3 Apply the terminal-state predicate

For each top-level child, fetch its workflow state and classify per the `prd-lifecycle-rollup` Linear predicate:

- **Terminal (shipped).** The child Issue/Project is in a **completed** workflow state (the `completed` / `done`-category state). A child Epic is terminal only when it has itself rolled up to its own terminal state per `leaf-only-lifecycle` — read the child's own resolved state; do not re-derive it from its leaves here.
- **Terminal-but-dropped.** The child is in a **canceled** workflow state (the `canceled`-category state). Like a not-planned leaf, it does not hold the PRD open and is excluded from the shipped set.
- **Incomplete / blocked.** Anything else: any backlog / unstarted / started / triage workflow state. Holds the PRD open.

The set of **required** children for the all-terminal check is the top-level children minus the canceled (terminal-but-dropped) ones. Legacy `$SENTINEL`-labelled Issues never reach this predicate at all — 3f.2 drops them from the child set, so they are absent from both the numerator and the denominator.

##### 3f.4 Branch on the rollup verdict

**All required children terminal** (every required top-level child is terminal; at least one required child exists):

1. Transition labels: remove `$TICKETED`, add `$SHIPPED` via `lisa-linear-access operation: save-project({id, labels})`. Verify exactly one lifecycle label remains (the single-label invariant).
2. Leave the PRD active for `/lisa:verify-prd`; do not archive at the shipped hop.
3. Post a short rollup comment on the project naming the terminal child set and (when dropped children exist) the dropped set, so the audit trail records *why* the PRD shipped. Lead with `"Shipped by Claude — all generated top-level work is complete."`

**Any required child incomplete / blocked**:

1. Leave the PRD label as `$TICKETED` and leave the project **active**. Do NOT add `$SHIPPED`. Do NOT archive.
2. Report the incomplete child set — both in the cycle summary and, when at least one cycle has previously ticketed this PRD, as a single advisory comment on the project listing the still-open children (`- <ref> "<title>" — <state>`), so product can see what's blocking the rollup. Keep it idempotent: regenerate the advisory rather than appending a fresh one each cycle.

##### 3f.5 Rollup cites the rule

This phase implements exactly one PRD-lifecycle hop — `$TICKETED → $SHIPPED` — and deliberately leaves native archive/completion to `/lisa:verify-prd` after `$SHIPPED → verified`. All terminal-state semantics, the generated-top-level-work boundary, and the dedupe-by-child-ref idempotency come from the `prd-lifecycle-rollup` rule; this skill is its Linear implementation, not a second source of truth.

#### 3g. PRD verification dispatch (close the loop on shipped PRDs)

`shipped` and `verified` are distinct facts about a PRD (see the `prd-lifecycle-rollup` rule's "PRD-level verification vs ticket verification" and "Closing the loop" sections). Rollup (3f) only reaches `$SHIPPED`; the `shipped → verified` (pass) / `shipped → ticketed` (fail) hops are owned by `/lisa:verify-prd`. This phase **closes that loop** by dispatching the initiative-level acceptance gate for shipped PRDs. It never performs the verification transition itself — the "never sets the verification outcome" invariant holds: `lisa-verify-prd`, not this skill, sets `verified` (or, on failure, re-opens the PRD to `ticketed`).

Re-query the projects currently carrying the `$SHIPPED` label via `lisa-linear-access operation: list-projects` (filtered by the `$SHIPPED` project label, **including archived projects** — so shipped PRDs remain active for `lisa-verify-prd`). Pick the **first** one and invoke `lisa-verify-prd <project-url>`. Process **one shipped PRD per cycle** — `lisa-verify-prd` is a heavy full flow (spec-conformance + empirical verification + fix-issue creation), so it is bounded exactly like the single-ready-PRD claim in Phase 3; the scheduler drains the rest.

**Per-cycle combined bound:** each scheduler cycle dispatches at most one ready PRD (the Phase 3 single-ready-PRD claim) **and** at most one shipped PRD for verification (this Phase 3g dispatch), for a maximum of two PRD operations per cycle. Ready intake runs first (Phase 3), then shipped verify (Phase 3g).

`lisa-verify-prd` owns the outcome: on a CONFORMS verdict with all empirical checks passing it transitions `$SHIPPED → verified` and posts evidence; on a conformance miss or a failing/unavailable check it **re-opens the PRD `$SHIPPED → ticketed`** (never `blocked`) and creates **build-ready** fix tickets registered as the PRD's generated work, then posts a failure report — the fix tickets auto-build, rollup (3f) re-ships the PRD once they are terminal, and a later cycle re-verifies (the self-healing loop). Either branch moves the PRD out of `$SHIPPED`, so it is not re-picked this cycle; a PRD whose generated work is not actually terminal is guard-stopped by `lisa-verify-prd` (left `$SHIPPED`) — that is verify-prd's gate, not this skill's. This phase, like 3f, is **behaviorally identical across all four intake skills** (`github-prd-intake`, `linear-prd-intake`, `notion-prd-intake`, `confluence-prd-intake`) — only the `$SHIPPED` query surface differs; keep them aligned. Record the dispatched PRD + verify-prd's verdict in the summary.

### Phase 4 — Summary report

After processing the single selected PRD, emit a summary:

```text
## linear-prd-intake summary

Scope: <workspace-slug | team-key> (<URL>)
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

PRDs processed: <n>
- $TICKETED: <n>
  - <project name> → <epic-key> + <story-count> stories + <subtask-count> sub-tasks (coverage: COMPLETE | COMPLETE_WITH_SCOPE_CREEP)
- $BLOCKED: <n>
  - <project name> → <gate-failure-count> gate failures (pre-write) OR <gap-count> coverage gaps (post-write)
- Errors (claim failed, etc): <n>
  - <project name> — <reason>

Total destination tickets created: <n>
Coverage audit summary: <n> COMPLETE / <n> COMPLETE_WITH_SCOPE_CREEP / <n> GAPS_FOUND
```

Print to the agent's output. Do not write this summary to Linear or the destination tracker — it's an operational record for the human.

## Legacy sentinel feedback issues

Earlier versions of this skill find-or-created one Issue per project — titled
`"PRD intake: clarifying questions"`, labelled `$SENTINEL` — to hold the
unanchored clarifying-question comments, on the belief that Linear had no
project-level comment channel. It does: `commentCreate(input: { projectId, body })`
and `Project.comments` are first-class operations, now exposed by
`lisa-linear-access` as the `project_id` forms of `save-comment` and
`list-comments`. The constraint was this wrapper, never the substrate.

**This skill no longer creates a sentinel.** There is no find-or-create step;
unanchored comments go on the project. New projects never get one.

Projects processed before this change still carry theirs, so:

- **Do not close, archive, delete, or repurpose an existing sentinel.** Its
  comment history is a real audit trail, and it has nowhere else to live yet.
  Retiring them is deliberately out of scope here.
- **Do not post to it either.** New unanchored comments go on the project, so the
  two channels do not interleave.
- **The rollup ignores it** (Phase 3f.2). That is what stops an existing sentinel
  from holding its project out of `$SHIPPED` forever.

`$SENTINEL` therefore survives in config as a **read-only recognizer** — the
label name the rollup matches on to exclude these issues. It is no longer a
label this skill writes.

## Idempotency & safety

- **One item per cycle**: this skill processes the first eligible ready project from Phase 2, then exits. New or remaining `$READY` projects are picked up by later scheduler invocations.
- **No writes outside the lifecycle**: this skill only ever writes to the destination tracker via `lisa-linear-to-tracker` (which delegates to `lisa-tracker-write`), only ever changes Linear project labels among `$IN_REVIEW`, `$BLOCKED`, `$TICKETED`, and `$SHIPPED` (the last via the rollup phase 3f only), only ever comments on the PRD project itself and on the sub-issues a failure anchors to (never on any other Linear issue, and it creates no Linear issue of its own). It never edits project descriptions, never edits Linear documents, never touches the `draft` label, never archives projects at the shipped hop, and never deletes projects.
- **Claim-first ordering**: the label flip to `$IN_REVIEW` happens BEFORE validation runs, so a re-entrant call won't double-process.
- **Failure handling**: an exception processing the selected project is caught and recorded under "Errors" in the summary, then the cycle exits. The project that errored is left labelled `$IN_REVIEW` — the human investigates from there.
- **Single-label invariant**: after every transition, verify exactly one lifecycle label is present on the project. If two are present (rare race), surface as an Error and skip — do NOT auto-resolve, the human decides.
- **Rollup idempotency**: rollup (Phase 3f) is a no-op on a PRD project already carrying `$SHIPPED` — no duplicate transition, no shipped-time archive, no duplicate comment. The all-terminal condition is a pure function of the children's current states (deduped by child-ref identity), so recomputing it is safe to re-run. Native archive/completion only follows verified PASS in `/lisa:verify-prd`.

## Configuration

Same configuration as `lisa-linear-to-tracker`. See that skill for the full table. Key items:

- **From `.lisa.config.json`**: `linear.workspace` (required for Linear MCP). When the destination tracker is `linear`, also `linear.teamKey`. Lifecycle label vocabulary lives under `linear.labels.prd.*` (all optional; defaults documented above).
- **From environment variables**: `E2E_BASE_URL`, `E2E_TEST_PHONE`, `E2E_TEST_OTP`, `E2E_TEST_ORG`, `E2E_GRAPHQL_URL` (operational E2E test config).

Destination tracker config (jira / github / linear) is consumed by `lisa-tracker-write` internally — this skill does NOT read it. If any required value is missing, surface the missing key(s) and exit this cycle — never invent values.

| Field | Default | Purpose |
|-------|---------|---------|
| `.lisa.config.json` `linear.labels.prd.ready` | `prd-ready` | Project label signalling "PRD ready for ticketing" |
| `.lisa.config.json` `linear.labels.prd.in_review` | `prd-in-review` | Project label set on claim |
| `.lisa.config.json` `linear.labels.prd.blocked` | `prd-blocked` | Project label set on validation failure |
| `.lisa.config.json` `linear.labels.prd.ticketed` | `prd-ticketed` | Project label set on success |
| `.lisa.config.json` `linear.labels.prd.shipped` | `prd-shipped` | Project label set by the rollup phase (3f) when all generated top-level work is terminal; product may also set it by hand |
| `.lisa.config.json` `linear.labels.prd.sentinel` | `prd-intake-feedback` | Issue-level label marking a **legacy** sentinel feedback issue. Read-only: matched so the rollup can exclude it (Phase 3f.2); never written by this skill |

## Rules

- Never write to the destination tracker outside of `lisa-linear-to-tracker` → `lisa-tracker-write`. The validator's verdict gates progress; bypassing it produces broken tickets.
- Never add or remove a label this skill doesn't own (`$IN_REVIEW`, `$BLOCKED`, `$TICKETED`, and `$SHIPPED` via the rollup phase only). Product owns the `draft` and `ready` labels; product and the rollup phase (3f) both set `shipped`. The issue-level `$SENTINEL` label is read-only here — matched to recognise legacy sentinel issues, never applied.
- Set `$SHIPPED` only from the rollup phase, and only when all generated top-level children are terminal per the `prd-lifecycle-rollup` rule. Never ship on partial completion and never archive at shipped.
- Never edit a project's description or any attached Linear document. Communication with product happens only through comments — on the project itself, or on the sub-issue a failure anchors to.
- Never post a single dump of all gate failures on one comment. One comment per `prd_anchor` group on the relevant sub-issue (or one comment on the project for unanchored failures only). Comments must be sub-issue-anchored where possible, categorized, plain-language, and contain a concrete recommendation.
- Never include a gate ID, internal skill name, or engineering shorthand in a comment body.
- Never run more than one intake cycle concurrently against the same scope. This skill assumes serial execution.
- Never create a Linear issue to hold a comment. Unanchored feedback belongs on the project. Never close, archive, repurpose, or post to a legacy sentinel issue either — its existing history is an audit trail, and retiring those issues is a separate, deliberate follow-up.
- If `lisa-linear-to-tracker` returns errors, treat them as gate failures: comment + `$BLOCKED`. Don't silently fail.

## Adoption (one-time per project)

Before this skill can run against a Linear workspace or team, the team must adopt the PRD lifecycle project-label convention (defaults shown; override via `linear.labels.prd.*` if you want different names):

1. Apply the `ready` label (default: `prd-ready`) to projects that are ready for ticketing (replaces the Notion `Status = Ready` flip and the Confluence `prd-ready` page label).
2. Reserve `in_review`, `blocked`, `ticketed` (defaults: `prd-in-review`, `prd-blocked`, `prd-ticketed`) for this skill — humans should not set them manually except to recover from an error.
3. (Optional but recommended) Add the `draft` and `shipped` labels (defaults: `prd-draft`, `prd-shipped`) for in-progress PRDs and delivered work respectively, so the full lifecycle is visible at a glance.
4. The labels must exist as **project labels** in Linear (`list-project-labels` should return them). Issue-level labels with the same names won't work; Linear keeps the two label kinds separate.

If the workspace hasn't adopted these labels, the first run exits with a label-convention error (not the idle empty-set message) — this distinguishes a setup issue from a genuinely empty queue so operators know to apply the convention rather than assuming there is no work. See Phase 2 for how the skill detects this case.
