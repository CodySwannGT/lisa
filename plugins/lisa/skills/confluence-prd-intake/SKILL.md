---
name: confluence-prd-intake
description: "Scans a Confluence space (or a parent page) for PRD pages currently parented under the configured `ready` lifecycle page and runs the first eligible one through the dry-run validation pipeline. A PRD that passes every gate gets tickets written and is re-parented under the `ticketed` lifecycle page; a PRD that fails gets clarifying-question comments and is re-parented under the `blocked` lifecycle page. Confluence counterpart of `lisa:notion-prd-intake` — the workflow is identical; only the source-of-truth tools and the state encoding differ (parent-page re-parenting instead of a status property). Composes existing skills (confluence-to-tracker, tracker-validate, tracker-source-artifacts, product-walkthrough)."
allowed-tools: ["Skill", "Bash"]
---

# Confluence PRD Intake: $ARGUMENTS

All Atlassian operations in this skill go through `lisa:atlassian-access`. Do not call MCP tools or `acli` directly.

`$ARGUMENTS` is one of:

- A Confluence **space** URL or space key — used as the surrounding scope sanity check. Example: `https://mycompany.atlassian.net/wiki/spaces/PRD` or `PRD`.
- A Confluence **parent page** URL or page ID — overrides the configured `confluence.parents.ready` page for this run (useful when an operator wants to target an alternative lifecycle parent). Example: `https://mycompany.atlassian.net/wiki/spaces/PRD/pages/123456789/PRDs`.
- Empty — use `confluence.parents.ready` from `.lisa.config.json` as the scope.

Run one intake cycle against the resolved `ready` lifecycle parent. Each direct child of that parent is treated as a PRD currently in the `ready` state. The first eligible PRD is claimed (re-parented to `in_review`), validated, routed to either the `blocked` parent (with clarifying comments) or the `ticketed` parent (with destination tickets created), then the cycle exits. Remaining ready PRDs stay queued for later scheduler invocations.

## Why parent pages, not labels

GitHub and Linear PRD lifecycles use labels (`prd-ready` / `prd-in-review` / etc.). Confluence does NOT — it uses parent pages instead. Scoped Atlassian API tokens (the only secure form Atlassian offers) cannot write Confluence labels via the v1 endpoint, and the v2 Label API group has no POST endpoint at all. Parent-id transitions, by contrast, are first-class in v2 and work with `write:page:confluence` scope. See `config-resolution` rule, section "Confluence PRD lifecycle uses parent pages, not labels," for the full rationale.

## Workflow resolution

Lifecycle parent-page IDs are read from `.lisa.config.json` `confluence.parents.*`. Local overrides global per-key. Bash pattern:

```bash
# Read a lifecycle parent-page id by role. Local overrides global per-key.
read_parent_id() {
  local role="$1"
  local local_v global_v
  local_v=$(jq -r ".confluence.parents.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".confluence.parents.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-$global_v}"
}

READY_PARENT=$(read_parent_id ready)
IN_REVIEW_PARENT=$(read_parent_id in_review)
BLOCKED_PARENT=$(read_parent_id blocked)
TICKETED_PARENT=$(read_parent_id ticketed)
SHIPPED_PARENT=$(read_parent_id shipped)
DRAFT_PARENT=$(read_parent_id draft)

# Fail fast if any required role is unmapped — the lifecycle scaffolding hasn't been provisioned.
for role in ready in_review blocked ticketed; do
  if [ -z "$(read_parent_id "$role")" ]; then
    echo "Error: confluence.parents.${role} is not set in .lisa.config.json. Run /lisa:setup:confluence to provision the lifecycle parent pages." >&2
    exit 1
  fi
done

# Reverse-lookup: given a page's parentId, return which lifecycle role it currently occupies.
current_role_for_prd() {
  local parent_id="$1"
  for role in draft ready in_review blocked ticketed shipped; do
    if [ "$(read_parent_id "$role")" = "$parent_id" ]; then
      echo "$role"; return
    fi
  done
  echo "unknown"
}

# Resolve a boolean rollup flag. Local overrides global per-key; default when unset.
# NOTE: Confluence rollup config lives under `confluence.rollup` (NOT
# `confluence.parents.rollup`) — see the config-resolution rule.
read_rollup_flag() {
  local key="$1" default="$2"
  local local_v global_v
  local_v=$(jq -r ".confluence.rollup.${key} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".confluence.rollup.${key} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}

CLOSE_ON_SHIPPED=$(read_rollup_flag closeOnShipped false)
```

In prose below, the role names refer to the resolved parent-page IDs: e.g. "the `ready` parent" means whatever `confluence.parents.ready` resolves to.

This skill is the Confluence counterpart of `lisa:notion-prd-intake`, and shares its PRD closure rollup phase (3f) with `lisa:github-prd-intake` and `lisa:linear-prd-intake`. The phases, gates, comment templates, and rules are identical — the only differences are (1) the lifecycle is encoded as **parent-page placement** instead of a status property, and (2) the fetch / comment / update tools route through `lisa:atlassian-access`. Keep all four intake skills behaviorally aligned: when changing intake logic — including the rollup phase — change them together.

The **PRD closure rollup phase (3f)** re-parents a `ticketed` PRD to the `shipped` parent (and optionally archives it) once all its generated top-level work is terminal, per the `prd-lifecycle-rollup` rule. This is the Confluence leg of the same vendor-neutral rollup that `lisa:github-prd-intake` implements for GitHub (LPC-1.3 #584); only the vendor surface (parent-page placement + documented generated-work section, since Confluence has no native ticket hierarchy) differs.

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked, run the cycle to completion for the first eligible PRD — claim, validate, branch to the `blocked` or `ticketed` parent, write the summary, and exit. The caller (a human or a cron) has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background queue.

Specifically forbidden:

- Previewing projected scope (epic count, story count, write count) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip / dry-run only" — the documented behavior IS the default.
- Pausing because a PRD looks large, has many open questions, or is likely to end under the `blocked` parent. The `blocked` parent is a valid terminal state of this lifecycle, not a failure mode — routing a PRD there with gate-failure comments is exactly how this skill communicates "the PRD needs more work before it can be ticketed." That outcome is success.
- Pausing because the dry-run validation looks expensive. The cost of one cycle is bounded; the cost of stalling a scheduled cron waiting on a human is unbounded.

The only legitimate reasons to stop early:

- Missing required configuration (`atlassian.cloudId`, `confluence.parents.{ready,in_review,blocked,ticketed}` in `.lisa.config.json`, `E2E_BASE_URL`, etc.). Surface the missing value and exit.
- Lifecycle parent unreachable. Surface and exit.
- Empty ready set. Exit cleanly with `"No PRDs currently parented under the 'ready' lifecycle page. Nothing to do."`

## Lifecycle assumed

The Confluence PRD lifecycle is encoded as **parent-page placement** — Confluence has no native status field, and scoped API tokens cannot write labels. Each lifecycle role corresponds to a dedicated parent page in the project's Confluence space:

```text
draft → ready → in_review → blocked | ticketed → shipped → verified
        (product)  (us)      (us)                  (product)  (product)
```

(Each role corresponds to a dedicated parent page; the `verified` parent is resolved from `confluence.parents.verified`.)

`verified` is the terminal state after `shipped`: it means the shipped product has been empirically checked against the PRD (set by `/lisa:verify-prd`, not by this intake skill). A failed post-ship verification re-parents back under `blocked` rather than introducing a separate `verifying` / `verification-failed` parent. Like `draft` and `shipped`, `verified` is **product-owned** — this intake skill never re-parents a PRD into or out of the `verified` parent. See the "PRD-level verification vs ticket verification" section of the `prd-lifecycle-rollup` rule.

A PRD's current state is determined entirely by which lifecycle parent it sits under. Re-parenting is the transition.

This skill transitions:

- `ready` → `in_review` (claim)
- `in_review` → `blocked` (gate failures or coverage gaps)
- `in_review` → `ticketed` (success)
- `ticketed` → `blocked` (post-write coverage gaps from Phase 3e)
- `ticketed` → `shipped` (PRD closure rollup, Phase 3f — only when **all** generated top-level children are terminal)

It never re-parents PRDs into or out of the `draft` or `verified` parents — those parents are owned by product (`verified` is set by `/lisa:verify-prd` after empirical PRD-level acceptance). The `shipped` parent is set by this skill's **rollup phase (3f)** when, and only when, the PRD's generated top-level work is all terminal — per the `prd-lifecycle-rollup` rule; product may also re-parent there by hand. Rollup never advances a PRD to `shipped` on partial completion, and never archives a PRD page unless `confluence.rollup.closeOnShipped` is configured `true` (default `false` → re-parent under `shipped`, leave the page active).

A "transition" means: update the PRD's `parentId` to the new role's parent-page id via `lisa:atlassian-access` `operation: write-page payload: { id, parentId, title, version: { number: <next> } }`. The v2 PUT endpoint requires the next version number and the page title in the payload; the body content is not strictly required for a re-parent-only edit, but some Atlassian deployments reject PUTs without a body. The skill MUST therefore GET the page first via `read-page`, capture title + current version + current body, then PUT with `parentId` swapped and `version.number` bumped — preserving body content is non-negotiable, this skill never edits PRD content. See `transition_prd` helper in Phase 3a for the canonical implementation.

If the project does not yet have the lifecycle parent pages provisioned, this skill cannot run. Provisioning is a one-time setup the project owner does (see "Adoption" at the bottom of this file).

## Phases

### Phase 1 — Resolve the scope

1. Parse `$ARGUMENTS`:
   - Space URL → extract space key from `/wiki/spaces/<KEY>`. (Used only as a sanity check that the operator's scope matches the configured space.)
   - Bare space key → same.
   - Parent page URL → extract numeric page ID from `/pages/<ID>/...`; use as the override for `READY_PARENT` for this run.
   - Bare page ID → same.
   - Empty → use `confluence.parents.ready` from config as `READY_PARENT`.
2. Confirm the configured Atlassian site by invoking `lisa:atlassian-access` `operation: list-sites` (it enforces connection match against `.lisa.config.json`).
3. Verify `READY_PARENT` is reachable: invoke `lisa:atlassian-access` `operation: read-page id: $READY_PARENT` and confirm it loads. If 404, surface a provisioning error and exit.

### Phase 2 — Find ready PRDs

Invoke `lisa:atlassian-access` `operation: read-page-descendants id: $READY_PARENT` and take the **direct children** (depth 1) of the ready lifecycle parent. Those are the PRDs currently in the `ready` state. Capture each child's id and title.

For each candidate, follow up with `lisa:atlassian-access` `operation: read-page id: <PAGE-ID>` and read its `parentId` to confirm it is still parented under `$READY_PARENT` (guards against eventual-consistency lag and concurrent re-parenting by another operator).

If the result set is empty, run a sanity probe across the other lifecycle parents to distinguish between a genuinely empty queue and a project where the lifecycle scaffolding is misconfigured:

- For each of `IN_REVIEW_PARENT`, `BLOCKED_PARENT`, `TICKETED_PARENT`: invoke `read-page-descendants id: <parent>` and count direct children.
- If every lifecycle parent has zero direct children → the lifecycle scaffolding is provisioned but unused, OR PRDs are still parented under the legacy structure. Surface: `"No PRDs found under any of the configured lifecycle parent pages (ready, in_review, blocked, ticketed). If this is a new project, move PRDs that are ready for ticketing under the configured 'ready' parent page (see Adoption section)."` Exit with an error — this is a setup / migration issue, not a normal idle cycle.
- If any non-ready parent has children → the queue is genuinely empty (PRDs exist but are in `in_review`, `blocked`, `ticketed`, or `shipped`). Exit cleanly with `"No PRDs currently parented under the 'ready' lifecycle page. Nothing to do."`

### Phase 3 — Process the first eligible ready PRD

Select the first ready PRD page returned by Phase 2 and process only that page. Later scheduler invocations process the remaining ready PRDs.

#### 3a. Claim

Transition the PRD from `ready` to `in_review` by re-parenting it:

```bash
# Pseudo-code; the actual call is a Skill tool invocation of lisa:atlassian-access.
#
# NOTE: the v2 PUT endpoint that backs write-page requires:
#   - id
#   - title (unchanged)
#   - version.number (current + 1)
#   - parentId (the new lifecycle parent)
#   - body (some deployments reject PUTs without a body; preserving the body
#     also matches this skill's invariant of never editing PRD content)
# We therefore GET-then-PUT: fetch via read-page to capture title, version,
# and body, then write-page with parentId swapped.
transition_prd() {
  local prd_id="$1" target_role="$2"
  local new_parent
  new_parent=$(read_parent_id "$target_role")
  # 1. read-page id: $prd_id  -> capture title, version.number (=N), body.storage.value
  # 2. write-page payload: {
  #      "id":       "$prd_id",
  #      "title":    "<unchanged>",
  #      "parentId": "$new_parent",
  #      "version":  { "number": N+1 },
  #      "body":     { "storage": { "value": "<unchanged>", "representation": "storage" } }
  #    }
}

# Claim:
transition_prd "$PRD_ID" in_review
```

This re-parent is the idempotency lock — a re-entrant cycle running concurrently won't see this PRD because `read-page-descendants id: $READY_PARENT` no longer includes it once parentId has moved.

If the update fails (permission error, version conflict / 409 race), log it and skip this PRD. Do not proceed to validation on a PRD you didn't successfully claim.

#### 3b. Dry-run validation

Invoke the `lisa:confluence-to-tracker` skill with `dry_run: true` and the PRD's URL. The skill returns a structured report containing:
- The planned ticket hierarchy
- Per-ticket validation verdicts and remediation
- An overall PASS / FAIL verdict
- A failure count

This call also indirectly invokes `lisa:tracker-source-artifacts` (artifact extraction + classification) and `lisa:product-walkthrough` (when the PRD touches existing user-facing surfaces). All gate logic lives in `lisa:tracker-validate`, which `lisa:confluence-to-tracker` calls per ticket.

#### 3c. Branch on the verdict

**If `PASS`** (every planned ticket passed every applicable gate):

1. Re-invoke `lisa:confluence-to-tracker` with `dry_run: false` to actually write the tickets. This re-runs Phases 1-5 and runs the preservation gate (Phase 5.5).
2. Capture the created ticket keys from the skill's output.
3. Post a Confluence **footer comment** on the PRD via `lisa:atlassian-access` `operation: comment-page id: <PAGE-ID> kind: footer body: "..."` listing the created tickets (epic, stories, sub-tasks) with their JIRA URLs. Lead with: `"Ticketed by Claude. Created N JIRA issues — see below. Move this page under the 'shipped' lifecycle parent after the work is delivered."`
4. Re-parent to `ticketed`: `transition_prd "$PRD_ID" ticketed`.
5. **Run Phase 3e (coverage audit)** before considering this PRD done.

**If `FAIL`** (one or more planned tickets failed one or more gates):

The audience for these comments is the **product team**, not engineers. They are not familiar with JIRA gate IDs, validator vocabulary, or skill internals. Follow the rules below strictly — the goal is for a non-engineer product owner to read a comment, understand what is unclear, and know what to do next.

##### 3c.1 Partition failures

1. Drop every failure where `product_relevant = false`. Those are internal data-quality problems — the agent should fix its own spec rather than ask product to clarify a missing core field. Record the dropped failures under `Errors` in the cycle summary so engineers can see them; never surface them on the PRD.
2. Group the remaining product-relevant failures by `prd_anchor` (the inline-comment anchor from `confluence-to-tracker`'s dry-run report). Failures that share an anchor become one comment thread on that block. Failures with `prd_anchor: null` are batched into one footer comment, since they have no source section to attach to.

##### 3c.2 Render each comment

For each anchored group, invoke `lisa:atlassian-access` `operation: comment-page kind: inline` with:
- `id`: the PRD page ID
- `anchor`: the `prd_anchor` value (the substring the inline comment will be attached to)
- `body`: the comment body, formatted using the template below

For the unanchored group, post a single footer comment via `lisa:atlassian-access` `operation: comment-page kind: footer body: "..."` using the same template, prefixed with `Issues without a specific section anchor:` and one block per failure.

If the inline comment call returns "anchor not found" (the page text changed between fetch and post), fall back to a footer comment for that group via the same access skill operation. Do not silently drop the failure.

##### 3c.3 Comment template

Each comment body MUST contain these four parts, in this order, no exceptions:

```text
[<Category badge>] <prd_section heading text>

**What's unclear:** <validator's `what` field, verbatim — already product-readable>

**Recommendation:** <validator's `recommendation` field, verbatim — must contain 1–3 concrete options, never a generic "please clarify">

**Action:** Update this section in the PRD, then move the page back under the 'ready' lifecycle parent and Claude will re-run intake.
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

##### 3c.6 Lifecycle transition

After all comments are posted (anchored groups + the optional footer summary), re-parent the PRD to the `blocked` lifecycle parent: `transition_prd "$PRD_ID" blocked`. Do NOT write any destination tickets.

#### 3d. Stop

Stop immediately after the claimed PRD is ticketed, blocked, or recorded as an error.

#### 3e. Coverage audit (mandatory after re-parenting to `ticketed`)

Per-ticket gates prove each ticket is well-formed; they do NOT prove the *set* of created tickets covers the *whole* PRD. Silent drops happen — invoke the `lisa:prd-ticket-coverage` skill to catch them.

1. Invoke `lisa:prd-ticket-coverage` with `<PRD URL> tickets=[<created ticket keys from 3c step 2>]`. The coverage skill auto-detects the PRD vendor from the URL.
2. Read the verdict:

   | Verdict | Action |
   |---------|--------|
   | `COMPLETE` | Done. Leave PRD under `ticketed` parent. End the cycle. |
   | `COMPLETE_WITH_SCOPE_CREEP` | Post an advisory footer comment naming the scope-creep tickets (so product can decide whether to close them as out-of-scope). Leave PRD under `ticketed` parent. |
   | `GAPS_FOUND` | The created ticket set is incomplete. (a) For each gap, post a comment using the same product-facing template as Phase 3c.3 — inline-anchored when `prd_anchor` is non-null, footer otherwise; category badge from the gap's `category` field; `What's unclear` and `Recommendation` from the audit report's `what` and `recommendation` fields. Apply the same forbidden-language rules from Phase 3c.5. (b) Post one footer summary comment listing the tickets that *were* successfully created (so product knows what to keep vs. what to extend). (c) Re-parent the PRD from `ticketed` back to `blocked`: `transition_prd "$PRD_ID" blocked`. |
   | `NO_TICKETS_FOUND` | Should not happen if step 2 succeeded. If it does, log it as an Error in the cycle summary and leave the PRD under `ticketed` with a comment flagging the audit failure for human review. |

3. The created tickets remain in the destination tracker regardless of the verdict — they are valid in their own right. The audit only tells us whether *more* are needed.

#### 3f. PRD closure rollup (config-gated)

A PRD's lifecycle terminal state (`shipped`) is **derived** from whether the work it generated is done — it is never set by hand here on its own authority. This phase implements the Confluence leg of that derivation, per the `prd-lifecycle-rollup` rule (cite it by slug; do not restate its taxonomy or terminal-state semantics here). It is behaviorally identical to `lisa:github-prd-intake`'s Phase 3f — only the vendor surface (parent-page re-parenting via `lisa:atlassian-access` + the documented generated-work section) differs from GitHub's (issue close + labels via `gh`).

Rollup runs over PRD pages that are already under the `ticketed` parent (the only state from which a PRD can ship): the freshly-ticketed PRD from Phase 3c, and — because rollup also catches PRDs whose children finished in a *later* cycle — every page currently parented under `$TICKETED_PARENT`. (Re-read its direct children via `lisa:atlassian-access` `operation: read-page-descendants id: $TICKETED_PARENT`.) Process each independently; one PRD never blocks another's rollup.

##### 3f.0 Resolve closure config

Closure is gated on `confluence.rollup.closeOnShipped` (default `false`), resolved via `read_rollup_flag` (defined in the Workflow resolution block, same local-overrides-global precedence the lifecycle parents use). Note the config lives under `confluence.rollup` (NOT `confluence.parents.rollup`):

```bash
CLOSE_ON_SHIPPED=$(read_rollup_flag closeOnShipped false)
```

When `false` (the default), rollup re-parents the PRD under `$SHIPPED_PARENT` but leaves the page **active** for a human to archive. When `true`, rollup also archives the page (where the deployment supports archival) after the `shipped` re-parent. Closure NEVER happens before all generated top-level work is terminal (`prd-lifecycle-rollup` rule; PRD #525 non-goal).

##### 3f.1 Idempotency guard (no-op if already shipped)

Rollup is keyed by the PRD's current state. If the PRD is already parented under `$SHIPPED_PARENT` (and is already archived, when `$CLOSE_ON_SHIPPED` is `true`), it is a **no-op** — do not re-parent, do not re-archive, do not re-comment. Record it as `already shipped (no-op)` in the cycle summary and move on. This is what makes re-running intake safe.

##### 3f.2 Read the generated top-level child set

Read the PRD's **generated top-level work** — its created Epics and any top-level Stories created directly under it, **excluding** leaf Sub-tasks and any Story nested under a generated Epic (`prd-lifecycle-rollup` rule, generated-top-level-work contract). Confluence has **no native ticket hierarchy**, so the child set comes from the documented section only:

1. **Documented `## Tickets` section (primary and only source).** Parse the machine-readable generated-work section `lisa:prd-backlink` writes to the PRD body (`## Tickets`, alias `## Generated Work`; see #582) via `lisa:atlassian-access` `operation: read-page id: <PRD-ID>`. Top-level children are the `### <Epic key>: <title>` group headers' first line (`- [<ref>](<url>) — Epic`) plus any top-level Story listed directly under `### Unparented items`. Lines nested deeper (`  - ... — Story:` under an Epic, `    - ... — Sub-task:`) are descendants, NOT top-level children — skip them.

Dedupe the resulting child set by **child-ref identity** — the destination ticket ref recorded in each generated-work entry (the entry is keyed by that ref, not by list position) — per the `prd-lifecycle-rollup` idempotency dedupe key. If the section yields no child (the PRD generated nothing, or the relationship was never recorded), record `no generated top-level children — rollup skipped` and leave the PRD under `$TICKETED_PARENT`; do not ship an empty PRD.

##### 3f.3 Apply the terminal-state predicate

For each top-level child, classify per the `prd-lifecycle-rollup` Confluence/Notion predicate:

- **Terminal (shipped).** The documented generated-work entry for the child is marked **done** in the PRD's machine-readable section (the durable equivalent of a closed ticket, since Confluence has no native ticket state). A child Epic is terminal only when it has itself rolled up to its own terminal state per `leaf-only-lifecycle` — read the child's own recorded state; do not re-derive it from its leaves here.
- **Terminal-but-dropped.** The entry is marked won't-do / canceled. Like a not-planned leaf, it does not hold the PRD open and is excluded from the shipped set.
- **Incomplete / blocked.** Anything else: the entry is not yet marked done. Holds the PRD open.

The set of **required** children for the all-terminal check is the top-level children minus the terminal-but-dropped ones.

##### 3f.4 Branch on the rollup verdict

**All required children terminal** (every required top-level child is terminal; at least one required child exists):

1. Re-parent to `shipped`: `transition_prd "$PRD_ID" shipped` (GET-then-PUT via `lisa:atlassian-access` preserving the body verbatim). After the re-parent, re-read the page and confirm `parentId` matches `$SHIPPED_PARENT` (the single-parent invariant).
2. **If `$CLOSE_ON_SHIPPED` is `true`**, archive the PRD page where the deployment supports archival. When `false`, leave it active.
3. Post a short rollup footer comment via `lisa:atlassian-access` `operation: comment-page kind: footer` naming the terminal child set and (when dropped children exist) the dropped set, so the audit trail records *why* the PRD shipped. Lead with `"Shipped by Claude — all generated top-level work is complete."`

**Any required child incomplete / blocked**:

1. Leave the PRD under `$TICKETED_PARENT` and leave the page **active**. Do NOT re-parent to `shipped`. Do NOT archive.
2. Report the incomplete child set — both in the cycle summary and, when at least one cycle has previously ticketed this PRD, as a single advisory footer comment listing the still-open children (`- <ref> "<title>" — <state>`), so product can see what's blocking the rollup. Keep it idempotent: regenerate the advisory rather than appending a fresh one each cycle.

##### 3f.5 Rollup cites the rule

This phase implements exactly one PRD-lifecycle hop — `ticketed → shipped` — and the optional config-gated archive that follows it. All terminal-state semantics, the generated-top-level-work boundary, and the dedupe-by-child-ref idempotency come from the `prd-lifecycle-rollup` rule; this skill is its Confluence implementation, not a second source of truth.

### Phase 4 — Summary report

After processing the single selected PRD, emit a summary:

```text
## confluence-prd-intake summary

Scope: ready parent = <READY_PARENT> (<URL>)
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

PRDs processed: <n>
- Ticketed: <n>
  - <PRD title> → <epic-key> + <story-count> stories + <subtask-count> sub-tasks (coverage: COMPLETE | COMPLETE_WITH_SCOPE_CREEP)
- Blocked: <n>
  - <PRD title> → <gate-failure-count> gate failures (pre-write) OR <gap-count> coverage gaps (post-write)
- Errors (claim failed, etc): <n>
  - <PRD title> — <reason>

Total destination tickets created: <n>
Coverage audit summary: <n> COMPLETE / <n> COMPLETE_WITH_SCOPE_CREEP / <n> GAPS_FOUND
```

Print to the agent's output. Do not write this summary to Confluence or the destination tracker — it's an operational record for the human.

## Idempotency & safety

- **One item per cycle**: this skill processes the first eligible ready PRD from Phase 2, then exits. New or remaining PRDs under the `ready` parent are picked up by later scheduler invocations.
- **No writes outside the lifecycle**: this skill only ever writes to the destination tracker via `lisa:confluence-to-tracker` (which delegates to `lisa:tracker-write`), and only ever re-parents PRDs among `in_review`, `blocked`, `ticketed`, and `shipped` (the last via the rollup phase 3f only) via `lisa:atlassian-access` `operation: write-page`. It never edits PRD body content, never re-parents into or out of `draft`, never deletes pages. It re-parents under `shipped` and may archive the PRD page **only** through the config-gated rollup phase (3f).
- **Claim-first ordering**: the re-parent to `in_review` happens BEFORE validation runs, so a re-entrant call won't double-process.
- **Failure handling**: an exception processing the selected PRD is caught and recorded under "Errors" in the summary, then the cycle exits. The PRD that errored is left under whatever parent it currently occupies (usually `in_review` if claim succeeded) — the human investigates from there.
- **Single-parent invariant**: a page has exactly one parent by construction in Confluence — the multi-state ambiguity that label-based systems can hit (two `prd-*` labels simultaneously) cannot occur here. After every transition, re-read the page and confirm `parentId` matches the expected role; if not, surface as an Error and skip.
- **Rollup idempotency**: rollup (Phase 3f) is a no-op on a PRD already parented under `$SHIPPED_PARENT` (and already archived when `closeOnShipped` is `true`) — no duplicate re-parent, no duplicate archive, no duplicate comment. The all-terminal condition is a pure function of the children's current states (deduped by child-ref identity), so recomputing it is safe to re-run. Archival NEVER precedes the all-terminal condition.

## Configuration

Same configuration as `lisa:confluence-to-tracker`. See that skill for the full table. Key items:

- **From `.lisa.config.json`**: `atlassian.cloudId` (required), `confluence.spaceKey` and/or `confluence.parentPageId` (for breadth-of-scope sanity checks), and `confluence.parents.{draft,ready,in_review,blocked,ticketed,shipped}` for the lifecycle parent-page IDs.
- **From environment variables**: `E2E_BASE_URL`, `E2E_TEST_PHONE`, `E2E_TEST_OTP`, `E2E_TEST_ORG`, `E2E_GRAPHQL_URL` (operational E2E test config).

Destination tracker config (jira / github / linear) is consumed by `lisa:tracker-write` internally — this skill does NOT read it. If any required value is missing, surface the missing key(s) and exit this cycle — never invent values.

| Field | Required | Purpose |
|-------|----------|---------|
| `.lisa.config.json` `confluence.parents.ready` | yes | Parent page id for "ready for ticketing" |
| `.lisa.config.json` `confluence.parents.in_review` | yes | Parent page id for "claimed by the agent" |
| `.lisa.config.json` `confluence.parents.blocked` | yes | Parent page id for "validation failure" |
| `.lisa.config.json` `confluence.parents.ticketed` | yes | Parent page id for "successfully ticketed" |
| `.lisa.config.json` `confluence.parents.draft` | recommended | Parent page id for PRDs still being drafted by product |
| `.lisa.config.json` `confluence.parents.shipped` | recommended | Parent page id the rollup phase (3f) re-parents delivered PRDs under; product may also use it by hand |
| `.lisa.config.json` `confluence.rollup.closeOnShipped` | no (default `false`) | When `true`, rollup archives the PRD page after the `shipped` re-parent; when `false`, re-parents under `shipped` and leaves the page active |

## Rules

- Never write to the destination tracker outside of `lisa:confluence-to-tracker` → `lisa:tracker-write`. The validator's verdict gates progress; bypassing it produces broken tickets.
- Never re-parent a PRD into a lifecycle parent this skill doesn't own (`in_review`, `blocked`, `ticketed`, and `shipped` via the rollup phase only). Product owns `draft` and `ready` (as the entry signal); product and the rollup phase (3f) both re-parent under `shipped`.
- Re-parent under `shipped` (and archive the PRD page when `closeOnShipped` is configured) only from the rollup phase, and only when all generated top-level children are terminal per the `prd-lifecycle-rollup` rule. Never ship or archive on partial completion.
- Never edit the PRD's body. Communication with product happens only through Confluence comments. The `write-page` call preserves the body verbatim — fetch then PUT with body unchanged.
- Never post a single page-level dump of all gate failures. One inline comment per `prd_anchor` group (or one footer summary for unanchored failures only). Comments must be inline-anchored where possible, categorized, plain-language, and contain a concrete recommendation.
- Never include a gate ID, internal skill name, or engineering shorthand in a comment body.
- Never run more than one intake cycle concurrently against the same scope. This skill assumes serial execution.
- If `lisa:confluence-to-tracker` returns errors, treat them as gate failures: comment + re-parent to `blocked`. Don't silently fail.

## Adoption (one-time per project)

Before this skill can run against a project, the project must adopt the lifecycle parent-page convention:

1. Create six pages in the project's Confluence space, one per lifecycle role: `Draft`, `Ready`, `In Review`, `Blocked`, `Ticketed`, `Shipped`. (Page titles are not significant — they exist to be re-parenting targets.)
2. Record each page's numeric id in `.lisa.config.json` under `confluence.parents.<role>`. `/lisa:setup:confluence` automates this.
3. Move each existing PRD page under the appropriate lifecycle parent based on its current state. Product moves PRDs from `draft` → `ready` when they are ready for ticketing (replaces the Notion `Status = Ready` flip).
4. Reserve the `in_review`, `blocked`, and `ticketed` parents for this skill — humans should not re-parent PRDs into them manually except to recover from an error.

If the project hasn't adopted these parent pages, the first run exits with a provisioning error (not the idle empty-set message) — this distinguishes a setup issue from a genuinely empty queue so operators know to run `/lisa:setup:confluence` rather than assuming there is no work. See Phase 2 for how the skill detects this case.
