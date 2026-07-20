---
name: lisa-linear-build-intake
description: "Symmetric counterpart to…"
allowed-tools: ["Skill", "Bash"]
---

# Linear Build Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

1. A Linear team key (e.g. `ENG`) — scans that team for ready Issues.
2. The literal token `linear` — falls back to `linear.teamKey` from `.lisa.config.json`.
3. A pre-built Linear MCP filter (advanced) — used as-is.

Run one build-intake cycle. The first eligible ready Issue is claimed, built via the `linear-agent` workflow run in-session (Phase 3c, culminating in `lisa-implement`), relabeled to the configured `done` label on completion, then the cycle exits. Remaining ready Issues stay queued for later scheduler invocations.

This skill is the destination of the `lisa-tracker-build-intake` shim when `tracker = "linear"`.

## Workflow resolution

Build-queue label names are read from `.lisa.config.json` `linear.labels.build.*`, falling back to defaults documented in the `config-resolution` rule. Bash pattern:

```bash
# Read role with default fallback. Local overrides global per-key.
read_role() {
  local role="$1" default="$2"
  local local_v global_v
  local_v=$(jq -r ".linear.labels.build.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".linear.labels.build.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}

READY=$(read_role ready "status:ready")
CLAIMED=$(read_role claimed "status:in-progress")
REVIEW=$(read_role review "status:code-review")
```

For env-keyed `done`, resolve the env first, then look up `done[<env>]`:

1. Explicit caller arg (`target_env=staging`) wins.
2. Otherwise, infer the env from the PR's base branch via `deploy.branches` (reverse lookup).
3. If `done` is a **string** in config, use it directly regardless of env.
4. If `done` is a **map** and env cannot be resolved, **fail loudly** — do not pick arbitrarily.

```bash
TARGET_ENV="${target_env:-}"
if [ -z "$TARGET_ENV" ] && [ -n "$PR_BASE_BRANCH" ]; then
  TARGET_ENV=$(jq -r --arg b "$PR_BASE_BRANCH" \
    '.deploy.branches // {} | to_entries[] | select(.value == $b) | .key' \
    .lisa.config.json 2>/dev/null | head -1)
fi

DONE_TYPE=$(jq -r '.linear.labels.build.done | type' .lisa.config.json 2>/dev/null)
if [ "$DONE_TYPE" = "string" ]; then
  DONE=$(jq -r '.linear.labels.build.done' .lisa.config.json)
elif [ "$DONE_TYPE" = "object" ]; then
  [ -z "$TARGET_ENV" ] && { echo "ERROR: linear.labels.build.done is env-keyed but env not resolvable"; exit 1; }
  DONE=$(jq -r --arg e "$TARGET_ENV" '.linear.labels.build.done[$e] // empty' .lisa.config.json)
  [ -z "$DONE" ] && { echo "ERROR: linear.labels.build.done has no entry for env '$TARGET_ENV'"; exit 1; }
else
  case "$TARGET_ENV" in
    dev) DONE="status:on-dev" ;;
    staging) DONE="status:on-stg" ;;
    production) DONE="status:done" ;;
    *) echo "ERROR: cannot resolve done label without env"; exit 1 ;;
  esac
fi
```

In prose below, the role names refer to the resolved labels: e.g. "the `ready` label" means whatever `linear.labels.build.ready` resolves to (default: `status:ready`).

## Why labels, not native states

Linear's per-team workflow state names vary (`Todo` / `Backlog` / `Up Next` / etc.). Labels are workspace-scoped or team-scoped and stable across teams, so we drive the build queue off labels rather than chasing renamed native states. The native `state` field is informational until terminal completion; at the true terminal `done` value, the `leaf-only-lifecycle` rule requires native closure by moving the Issue to a configured Done / Completed workflow state when one exists.

## Configuration

Reads `linear.workspace`, `linear.teamKey`, and `linear.labels.build.*` from `.lisa.config.json` (with `.local` override).

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a team key, run the cycle to completion — claim and dispatch the first eligible Issue through the in-session lifecycle (Phase 3c), transition a successful build to `$DONE`, write the summary, and exit. The caller (a human or a cron) has already authorized the run by invoking the skill.

Specifically forbidden:

- Previewing projected scope (Issue count, projected PR count, build duration) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip a few / dry-run only" — the documented behavior IS the default.
- Pausing because the queue is large, items look complex, or items are likely to be `status:blocked` by the pre-flight gate. The pre-flight `status:blocked` outcome is a valid terminal state of the per-Issue lifecycle.
- Pausing because the build flow looks expensive.

The only legitimate reasons to stop early:

- Missing team key or required configuration. Surface and exit.
- Label convention not yet adopted (the `ready` label does not exist on the team's labels). Surface and exit with an Adoption hint.
- Empty ready set. Exit cleanly with `"No Linear Issues labeled $READY. Nothing to do."`

## Lifecycle assumed

Linear build queue uses these issue-level labels:

```text
ready → claimed → review → done(env-keyed) (downstream)
(human/PM)    (us claim)    (us PR ready)    (us build done)
```

(Defaults: `status:ready` / `status:in-progress` / `status:code-review` / `status:on-dev`/`status:on-stg`/`status:done`.)

This skill ONLY transitions `$READY → $CLAIMED` on claim, and `$CLAIMED → $DONE` on completion. It never touches `status:done`-as-terminal, `$REVIEW` (owned by the lifecycle / `lisa-linear-evidence`), or `status:blocked` (owned by the pre-flight gate).

**Pre-flight check**: at start of each cycle, confirm `$READY`, `$CLAIMED`, and the relevant `$DONE` variants exist on the team via `lisa-linear-access operation: list-issue-labels`. If `$READY` is missing, stop and report adoption needed. The other labels can be created on demand.

## Phases

### Phase 1 — Resolve scope

1. Parse `$ARGUMENTS`:
   - Bare team key → use as-is.
   - Literal `linear` → fall back to `linear.teamKey` from config.
2. Resolve team ID via `lisa-linear-access operation: list-teams({query: <teamKey>})`.

### Phase 2 — Find ready Issues

Query: `lisa-linear-access operation: list-issues({team: <teamId>, label: "$READY"})`.

Capture each Issue's: identifier, title, type label, priority, assignee, project, labels, description summary.

> **No query-time repo pre-filter here (by design).** Unlike `lisa-jira-build-intake`, which narrows its JQL with `AND (labels = "repo:<current>" OR labels IS EMPTY)` (the query-time arm of `repo-scope-split`), the Linear `list_issues` label filter is an AND-of-labels and cannot express "current-repo **or** unlabeled" in one query. Adding `repo:<current>` to this query would strand unlabeled Issues the determine + stamp path must see. So the Linear scanner keeps this query broad and relies on the per-candidate 3a.0 gate below for repo scoping.

If empty, report `"No Linear Issues labeled $READY. Nothing to do."` and exit. Common idle case.

### Phase 3 — Process the first eligible ready Issue

#### 3a.0 Repo-scope gate (claim only current-repo Issues)

A Linear team can oversee multiple repos (`frontend` / `backend` / `infrastructure`). This skill claims only Issues for the repo it is running in. Run this gate **before** the leaf-only gate (3a) and the claim (3b), per the `repo-scope-split` rule's "Claim-time repo scoping" section (cite it by slug; do not restate its decision table).

1. **Resolve the current repo** per `config-resolution` "Repo scoping" (`.repo` → `.github.repo` → `git remote get-url origin` basename). If unresolvable, stop and report.
2. **Cheap path first.** Prefer candidates already carrying the `repo:<current>` label. Keep the Phase 2 scan broad so unlabeled Issues are still seen, determined, and stamped.
3. **Per candidate, apply the repo-scope decision (`repo-scope-split`):**
   - Carries `repo:<other>` → **skip** (leave it `ready` for that repo's own intake); next candidate.
   - **Unlabeled** → determine the target repo(s) from the Issue + code surfaces, then **stamp** `repo:<name>` via `lisa-linear-access operation: save-issue` (resolve/create the label via `list_issue_labels`/`create_issue_label`) so later cycles filter cheaply; re-apply with the now-known repo.
   - **Multi-repo leaf → split, never claim.** Run the `repo-scope-split` work-time procedure into single-repo siblings, each created **build-ready** (`build_ready: true`) and stamped with its own `repo:<name>`; the current repo's sibling becomes a normal candidate.
   - **Single-repo leaf for the current repo** → fall through to 3a (leaf-only gate) and 3b (claim).
4. Continue until a claimable current-repo leaf is found (claim it; one per cycle) or the ready set is exhausted — exit cleanly with `"No ready Issues for repo <current>. Nothing to do."`.

#### 3a. Leaf-only claim gate (skip / safe-block containers)

Build intake claims **only independently implementable leaf work units**. This enforces the claim-time arm of the vendor-neutral `leaf-only-lifecycle` rule: a parent/container that still carries a stale build-ready label (e.g. `status:ready` applied before this rule existed, or hand-applied to a Project-grouped parent Issue) is **never claimed** — intake skips it or safe-blocks it with a clear lifecycle-repair message. It is the claim-time complement to the write-time labeling in `lisa-linear-write-issue` and the validate-time S15 gate in `lisa-linear-validate-issue`; all three cite the same rule so the classification never drifts. **Never silently implement a container.**

Run this gate **before** the claim relabel, starting with the oldest/highest-priority ready candidate. Do NOT relabel, comment "Claimed", or dispatch the lifecycle for an Issue that fails the gate.

**Resolve container vs. leaf — structural first, then nominal.** Per `leaf-only-lifecycle` the classification is structural: an Issue is a **container** if it has **open** child work, whatever its declared type; otherwise the **type label** decides. Resolve child work using the same hierarchy `lisa-linear-read-issue` uses — Linear's native parentage: an Issue groups **sub-issues** via `parentId`, and a **Project** (the Epic equivalent) groups Issues via `projectId`. Relations (`save_issue_relation` — `blocks` / `is blocked by`) express dependencies and are **not** parentage — do not count them as children.

Fetch the Issue's sub-issues via `lisa-linear-access operation: get-issue` (which returns the children) or `lisa-linear-access operation: list-issues({parentId: <issueId>})`, then count those still open (Linear `state.type` not in the completed/canceled set):

```text
# Children of <issueId>: native sub-issues via parentId.
# Count children whose Linear state.type is NOT terminal ("completed" / "canceled").
# A parent whose children are all completed is no longer holding open work and
# rolls up via leaf-only-lifecycle's rollup, not here.
OPEN_CHILDREN = count(list_issues({parentId: <issueId>})
                       where state.type not in {"completed", "canceled"})
```

For a Project-level parent (an Issue that itself anchors a `projectId` grouping rather than a `parentId` tree), resolve membership the same way `lisa-linear-read-issue` does and treat the parent as a container if any grouped Issue is still open. If sub-issue resolution is unavailable, fall back to the parentage `lisa-linear-read-issue` derives and treat the Issue as a container if any derived child is open. Note "sub-issues unavailable — parentage derived" so the operator knows how children were resolved.

Classify and act (first match wins). The type comes from the Issue's `type:` label (`type:Epic`, `type:Story`, `type:Spike`, `type:Bug`, `type:Task`, `type:Sub-task`, `type:Improvement`):

| Condition | Class | Action |
|---|---|---|
| `OPEN_CHILDREN > 0` (open child work, any type) | **Container** | **Skip / safe-block — do NOT claim** |
| no open children AND type = Epic (a Linear Project) | **Childless Epic/Project (pure rollup container)** | **Skip / safe-block — do NOT claim** |
| no open children AND type ≠ Epic (Bug, Task, Sub-task, Improvement, Story, Spike, or no `type:` label) | **Leaf work unit** | **Proceed to 3b claim** |

The childless-parent exception promotes every childless type **except Epic** to a claimable leaf: a childless Story is a directly shippable increment and a childless Spike *is* the investigation unit, so neither is stranded. Only a childless **Epic** (a Linear Project) stays unclaimed — it is a pure rollup container by design, and a childless one is an incomplete decomposition or a mis-applied role, never an implementable unit.

**Safe-block (default action for a flagged container).** Leave the build-ready label in place (don't silently strip it — that hides the lifecycle error), post a single lifecycle-repair comment, record the Issue under "Skipped (container)" in the summary, and end the cycle. Do NOT relabel to `$CLAIMED`. Keep the comment idempotent — skip posting if an identical `[claude-build-intake]` lifecycle-repair comment already exists on the Issue, so a re-entrant cycle doesn't spam it.

Post via `lisa-linear-access operation: save-comment` with:

```text
[claude-build-intake] Not claimed: this Issue carries the build-ready label ($READY) but is a container with open child work (or a childless Epic), which violates the leaf-only-lifecycle rule. Build-ready (status:ready) is leaf-only per leaf-only-lifecycle — an agent claims and implements leaves, never a container. Repair: move $READY off this parent onto its leaf children (or, for a childless Epic, decompose it into leaf children or reclassify it to a leaf type). A parent's lifecycle state rolls up from its children and is never set to ready directly.
```

This gate never blocks a legitimate flat Task/Bug: those have no open children and a leaf `type:`, so they fall straight through to the claim in 3b.

#### 3b. Claim

**Rejection detection runs first — before the relabel below.** Per the vendor-neutral `rejection-detection` rule (cite the slug; do not restate its classification table), classify this Issue at the **top of 3b, BEFORE** the `$READY → $CLAIMED` relabel — after the relabel the current-lane signal is gone. Read the Issue's history via `lisa-linear-access operation: history id: <ISSUE-ID>`, keyed on `status:*` **label** history (Linear build lanes are label-driven; resolve `addedLabelIds`/`removedLabelIds` against `list-issue-labels`), and classify it `rejection-reclaim | forward-only | never-left-ready | unknown` (a `rejection-reclaim` is the configured `$READY` label re-added after a later-lane label). Label names come from `.lisa.config.json`, never hardcoded. A failing/absent history yields `unknown` and the claim proceeds — detection never blocks the build. Issues carrying a learning marker (`[lisa-learning-drop]` / `[lisa-learning-pr]` / `[lisa-learning-upstream-handoff]`) or the `learning:needs-triage` label are never rejection triggers (no learning-about-learning). Carry the classification into the relabel and lifecycle below.

**On `rejection-reclaim`, reflect before re-implementing** (per `rejection-detection`): read the rejection evidence through the access layer — the Issue comments posted after the backward transition (the QA rejection comment) via `lisa-linear-access operation: list-comments` and the review threads on the rejected PR — assemble ONE candidate learning (rule, why, provenance linking the rejection comment + rejected PR, evidence links, scope hint, triggering issue, fingerprint `sll4-sha1(rule\ntriggering_issue)[:12]`), and route it to the `lisa-persist-learning` skill. If that skill is absent, record the candidate via `lisa-linear-access operation: save-comment` as a comment carrying a **visible prose line plus** the marker (a bare marker renders as an empty bubble) — `Recorded a candidate learning from this rejection (queued for the judgment gate): <one-line candidate rule>.` then `<!-- [lisa-rejection-candidate] key=<issue>-<transition-ts> -->` — and proceed. Dedupe on `<issue>-<backward-transition-timestamp>` — a second re-claim produces no duplicate. Unreadable/absent evidence → no candidate, still implement.

**Claim-time archaeology runs second — after rejection detection, still before the relabel below.** Classify this Issue per the vendor-neutral `claim-archaeology` rule, with the rejection classification above as its input. All shared semantics — ancestry signals, classification, learning-loop exclusion, cost budget, candidate derivation, marker dedupe, and the never-block degrade — live in that one slug; change them there, never here. Linear wiring only: the native relations are already in the read bundle; text-similarity searches run through `lisa-linear-access operation: list-issues` filtered to recently-closed Issues; the fallback candidate comment is posted via `lisa-linear-access operation: save-comment`.

Update labels via `lisa-linear-access operation: save-issue`: remove `$READY`, add `$CLAIMED`. Resolve label IDs via `list_issue_labels` (create `$CLAIMED` if missing).

**Assign to the authenticated user when the Issue is unassigned.** A claim must be attributable. If the Issue has no assignee, set its `assigneeId` to the authenticated viewer (resolve the viewer's id via the Linear MCP identity — e.g. `get_user` for the current actor) through `lisa-linear-access operation: save-issue`. Leave an already-assigned Issue's assignee untouched — never reassign work that already has an owner.

Post a `[claude-build-intake]` comment via `save_comment`: `"Claimed by Claude. Starting build."`

This is the idempotency lock — a re-entrant cycle's `label: $READY` filter will not see this Issue again.

If the relabel fails (permission, race), record under "Errors" and skip. **Do not invoke the build flow on an Issue you didn't successfully claim.**

#### 3c. Run the per-Issue lifecycle in-session (never as a subagent)

After the claim succeeds, run the per-Issue lifecycle defined by the `linear-agent` workflow **in the current session** — never by spawning `linear-agent` (or any named worker) via the `Agent` tool. The lifecycle culminates in a team-first flow (`lisa-implement`), and that flow can only create its agent team from the lead session: a spawned teammate cannot add named teammates (Claude teams are flat), so dispatching the build into a subagent strands `lisa-implement` without its team and collapses the build into a single inline worker. Concretely:

1. **Run the gates in-session** via their skills, exactly as `linear-agent.md` defines them and with all of its gating behaviors intact:
   - `lisa-linear-read-issue` — the full Issue graph (mandatory; never ad-hoc reads)
   - `lisa-linear-verify` — pre-flight quality gate, including the draft-then-block procedure on FAIL
   - `lisa-ticket-triage` — analytical triage gate (a `BLOCKED` verdict stops the cycle with findings posted)
   - Intent determination from the type label
2. **Dispatch the flow in-session:** when the gates pass, invoke the lifecycle skill via the Skill tool — `lisa-implement <ISSUE-ID>` for Build / Fix / Improve / Investigate-Only (or `lisa-plan` for an Epic-equivalent) — passing the full context bundle from the read step. **When 3b classified this Issue `rejection-reclaim`, the context bundle passed to `lisa-implement` MUST include the rejection evidence summary** (what was rejected, the defect the QA comment named, the approach named as wrong) — reuse the evidence already read in 3b, do not fetch it twice — so the plan can address it per `rejection-detection`; absence of evidence never blocks. `lisa-implement`'s own orchestration preamble then creates the per-item agent team (input-resolver, Roster Decision, specialist fanout) exactly as a direct invocation would.
3. **Milestone sync and evidence** (`lisa-linear-sync`, `lisa-linear-evidence`) happen at the milestones the `linear-agent` workflow defines, within the dispatched flow.

If you are somehow running this skill as a spawned teammate inside an existing team (nested misrouting — Intake keeps this chain in the lead session), do NOT run the lifecycle inline and do NOT spawn named peers. Return this payload to the lead so the lead session can run this Phase 3c in-session:

```json
{
  "type": "delegation-request",
  "phase": "linear-build-intake 3c",
  "workItem": "<ISSUE-ID>",
  "context": {
    "claimedLabel": "$CLAIMED",
    "doneResolution": "Resolve $DONE from the PR base branch per this skill's Workflow resolution section"
  },
  "onSuccess": "Confirm the returned PR is merged, then apply Phase 3d and Phase 3d.1",
  "onBlockedOrError": "Leave the Issue where the lifecycle left it and record the surfaced outcome"
}
```

The lifecycle run returns one of the following outcomes; resume this scanner with it:
- **Success** — the build flow completed and a PR exists; evidence posted. The PR may already be **merged** or still **open** (auto-merge enabled, awaiting checks/merge). "Success" means the build work is sound — it does **not** assert the change reached an environment. The env transition in 3d gates on the PR actually being merged; an open PR does not advance the Issue to a `done` env status.
- **Blocked by linear-verify pre-flight gate** — the pre-flight gate (linear-agent workflow step 2) relabels to `status:blocked` and assigns to creator. Let it stand. Record and move on.
- **Duplicate already fixed** — `lisa-ticket-triage` returned `DUPLICATE_ALREADY_FIXED` with a canonical Issue reference and empirical base-branch evidence. Post the triage finding, ensure the native `duplicates <canonical>` relationship exists when Linear exposes it (otherwise leave an explicit relation/comment reference), apply the terminal `$DONE` label, move the native Issue to the configured canceled-as-duplicate or completed terminal state, and do not open a PR. If the canonical fix is merged but not yet on the production branch, the close comment must say the production error can recur until the canonical Issue promotes and that recurrence is tracked by the canonical Issue; do not reopen this duplicate for that recurrence.
- **Blocked by ticket-triage ambiguities** — triage posts findings and the lifecycle stops. The Issue stays at `$CLAIMED`. Surface to human; do not auto-transition. Record under "Errors".
- **Errored** — exception, missing config, etc. Leave at `$CLAIMED`. Record with exception summary.

#### 3c.1 Close duplicate already fixed

Run this only when the returned triage verdict is exactly `DUPLICATE_ALREADY_FIXED`.

1. Verify the structured result includes a canonical Issue reference, the canonical PR/commit, and empirical evidence that the canonical fix is present on the base branch. If any piece is missing, treat the outcome as Held instead of closing.
2. Post or preserve the triage-finding comment that explains why this Issue is a duplicate and names the canonical Issue.
3. Ensure a native `duplicates <canonical>` relationship exists when Linear exposes one; if this workspace cannot create that relationship, leave an explicit relation/comment reference and record the limitation in the summary.
4. Resolve the terminal `$DONE` value exactly as in Phase 3d. For env-keyed workflows, duplicate closeout uses the production/final done label, not an intermediate `status:on-dev`/`status:on-stg` waypoint.
5. Update labels by removing `$CLAIMED` and adding terminal `$DONE`, then move the native Linear state to the configured canceled-as-duplicate state. If no duplicate/canceled state is configured, use the configured terminal completed state only when that is the project's duplicate-close convention; otherwise record setup as an Error rather than inventing a state.
6. Post a close comment naming the canonical Issue, PR/commit, and base-branch evidence.

If the canonical fix is merged but not yet present on the production branch, append the production-promotion caveat to the close comment: the production error can recur until the canonical Issue promotes, and recurrence is tracked by the canonical Issue rather than by reopening this duplicate.

This path is distinct from `BLOCKED`: ambiguity, open blockers, and duplicate-of-open findings remain held for human action and must not be auto-closed.

#### 3c.2 Confirm applied learnings (last_confirmed bump)

Run this at the end of 3c, after the lifecycle outcome is recorded and before 3d. It keeps the decay pass safe: a genuinely useful learning that keeps applying stays fresh, while dead weight ages out.

1. **Identify which learnings demonstrably applied.** Resolve the learnings surface with `resolveProjectLearningsFile` and parse it with `parseLearningsFile` from `@codyswann/lisa/learnings` (never hardcode the path; a missing file skips this step silently). An entry counts as applied ONLY when its rule was explicitly cited or observably followed in this claim's plan, diff, or review responses — the plan quotes the rule or its id, or the diff does specifically what the rule mandates where the default behavior would have differed. **Presence in context is NOT application**: entries reach a session only through the contract's bounded projection, so counting "it was projected" would confirm every projected entry on every claim and defeat decay entirely. A run that produced no plan or diff has nothing to confirm.
2. **Bump each applied entry exactly once** via the surgical writer:

   ```bash
   node -e 'import("@codyswann/lisa/learnings").then(async m => { const r = await m.confirmLearningEntry(process.cwd(), process.argv[1], new Date().toISOString().slice(0, 10)); console.log(JSON.stringify(r)); }).catch(error => { console.log(JSON.stringify({ status: "error", id: process.argv[1], message: String(error) })); })' <entry-id> || true
   ```

   The invocation is failure-safe by construction: a rejected import or write resolves to a structured `error` result instead of a crash, and the trailing `|| true` absorbs any remaining non-zero exit (missing `node`, unresolvable package). Record an `error` or non-zero outcome in the cycle summary and continue — the bump must never abort the lifecycle.

   `confirmLearningEntry` advances ONLY `last_confirmed` — rule text, why, provenance, `first_learned`, and confidence are untouched — and is idempotent within a claim: a repeat same-date bump returns `unchanged`, so an entry that applied repeatedly during one claim is bumped once, not once per application.
3. **Never block on it.** A failed bump, an unwritable file, or a `not-found` result (the entry was pruned) is recorded under the cycle summary and the claim proceeds — shipping the Issue always outranks confirming a learning about it.

#### 3d. Relabel to $DONE (only after the PR is merged)

A `done` env state (`status:on-dev`, `status:on-stg`, or the terminal value) asserts that the code has actually reached that environment. Never set it for a PR that is merely open: auto-merge can be blocked indefinitely (a required rebase / `BEHIND` branch, failing checks, an unaddressed review), and the change may never land. Relabeling an Issue `status:on-stg` on an open PR makes it *claim* a deploy that never happened. Transition only after confirming the PR merged.

If the lifecycle run returned Success:
1. **Confirm the PR merged.** Read the live state of the Issue's PR — `gh pr view <pr> --json state,mergedAt,mergeStateStatus,url`:
   - **Merged** (`state == MERGED`) → proceed to resolve and apply `$DONE` below. Where the env deploy is observable (a deploy workflow run / deployment status keyed to the merged-into branch via `deploy.branches`), confirm it did not fail before relabeling; a still-running deploy is treated like an open PR (leave at `$CLAIMED`), a failed deploy is recorded as an Error.
   - **Open / not yet merged** → do **not** transition. The build is sound but the change has reached no environment yet. Record the Issue under **"PR open — awaiting merge"** in the summary (with the PR URL and its `mergeStateStatus`), leave it at `$CLAIMED`, and stop. A later `lisa-repair-intake` cycle drives the open PR to merge — re-syncing a `BEHIND` branch so the already-enabled auto-merge can land, or surfacing a real blocker — and, once merged, applies this same env transition. Do **not** comment "Build complete" or change the native state.
   - **Closed without merging** → record an Error (the PR was abandoned unmerged); leave the Issue at `$CLAIMED`.
2. Resolve `$DONE` for this issue's PR base branch using the Workflow resolution algorithm above. If env can't be resolved and `done` is env-keyed, record an Error and skip this transition — never guess.
3. Determine whether `$DONE` is the true terminal done value per the `leaf-only-lifecycle` rule's Terminal native closure section:
   - If `linear.labels.build.done` is a string, that string is terminal.
   - If `linear.labels.build.done` is an object, only the production/final environment value is terminal (default: `status:done`). Intermediate env values such as `status:on-dev` and `status:on-stg` are not terminal and must keep the native Issue open.
   - If the project uses a different final environment name, resolve it from the configured deployment topology; if ambiguous, record an Error and do not change the native state.
4. Update labels via `lisa-linear-access operation: save-issue`: remove `$CLAIMED` (or `$REVIEW` if `lisa-linear-evidence` already moved it forward), add `$DONE`.
5. If `$DONE` is terminal, move the native Linear Issue state to the configured Done / Completed state. Resolve that state from project configuration if present; otherwise inspect the team workflow for a terminal state with `state.type = "completed"` and a name such as `Done` or `Completed`. If no terminal state can be resolved, record an Error and leave the labels as the source of truth — do not invent a state name. Conversely, if `$DONE` is an intermediate env yet Linear already natively completed the Issue (a magic-word / branch-linkage front-run — Linear auto-completes on merge to **any branch**, per the asymmetry documented in `git-submit-pr`), reconcile it back to active via `lisa-linear-sync` Phase 4b so the native state mirrors the non-terminal env instead of a premature closure.
6. Post a `[claude-build-intake]` comment: `"Build complete. PR <URL> merged. Transitioned to $DONE."` Include whether native closure was applied, already satisfied, skipped for an intermediate env, or unavailable for setup reasons.

For any non-Success outcome, do NOT transition. The Issue sits where the lifecycle left it — humans take it from there.

#### 3d.1 Roll up the parent chain (forward rollup)

Run this **only after a successful `$DONE` transition in 3d**. This is the **forward** arm of the `leaf-only-lifecycle` rule's *"rollup is evaluated whenever a child transitions"* requirement: a leaf reaching `$DONE` may complete its parent Issue, which may in turn complete its Project. Without this step a fully-built parent stays open until the recovery `lisa-repair-intake` cron happens to run.

1. Resolve the Issue's parent using the same hierarchy `lisa-linear-read-issue` uses — native parentage: a sub-issue's `parentId`, and Project membership via `projectId` for the Epic-equivalent. If the Issue has no parent, skip — nothing to roll up.
2. Walk **up the ancestor chain bottom-up** (sub-issue → parent Issue → Project): for each ancestor invoke `lisa-linear-sync <ANCESTOR-ID> --rollup`. That skill derives the ancestor's `status:*` from its children per `leaf-only-lifecycle`, applies it via `lisa-linear-access operation: save-issue` only when it differs (never `status:ready`), and moves the native Linear `state` to the configured Done / Completed state when the derived env is the terminal `$DONE`. It is idempotent and safe-defaults (suggests, does not guess) when the rolled state is ambiguous.
3. Stop walking up when an ancestor has no parent, or when `--rollup` reports no change. Record each rolled-up ancestor and its derived state in the summary.

This does not re-implement the state machine — it delegates to `lisa-linear-sync --rollup`, the single rollup implementation `lisa-repair-intake` also uses, so the forward and recovery paths can never drift. Children closed **outside** this flow are not observed here; `lisa-repair-intake` remains the recovery net for those.

#### 3e. Stop

Stop immediately after the first claimed, skipped, blocked, held, or errored Issue. Later scheduler invocations process the remaining ready Issues.

### Phase 4 — Summary report

```text
## linear-build-intake summary

Team: <teamKey>
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

Issues processed: <n>
- $DONE (build complete, PR merged): <n>
  - <ID> <title> → PR <URL>
- PR open — awaiting merge (left at $CLAIMED for repair-intake): <n>
  - <ID> <title> → PR <URL> (mergeStateStatus: <state>)
- Skipped (container — leaf-only-lifecycle): <n>
  - <ID> <title> — build-ready on a parent with open child work; lifecycle-repair comment posted
- Duplicate already fixed (closed as duplicate): <n>
  - <ID> <title> — duplicate of <canonical>; no PR opened
- status:blocked (pre-flight verify failed): <n>
  - <ID> <title> — see Issue comments
- Held (triage found ambiguities): <n>
  - <ID> <title> — see Issue comments
- Errors: <n>
  - <ID> <title> — <reason>

Total PRs opened: <n>
```

## Idempotency & safety

- **Leaf-only claim gate runs first**: Phase 3a classifies each candidate before any claim; a container with open child work (or a childless Epic) is skipped/safe-blocked, never claimed (the `leaf-only-lifecycle` rule's claim-time arm). The safe-block comment is idempotent — a re-entrant cycle does not re-post it.
- **Claim-first ordering**: `$CLAIMED` set BEFORE the lifecycle dispatch — no double-pickup.
- **No writes outside the lifecycle**: this skill only adds/removes `$READY`, `$CLAIMED`, `$DONE`, plus terminal-only native state completion required by `leaf-only-lifecycle`. Every other label change (and non-terminal native state change) is owned by the per-Issue lifecycle or `lisa-linear-evidence`.
- **Duplicate terminal exception**: `DUPLICATE_ALREADY_FIXED` is the only triage outcome that may close a claimed Issue without a PR from this cycle. It must include a canonical Issue reference and empirical base-branch evidence, and it closes through the configured duplicate/canceled terminal path rather than as completed build work.
- **Terminal native closure**: after the `$DONE` label is applied, move the Linear Issue to a native completed state only when `$DONE` is the true terminal done value; intermediate env labels stay open / active.
- **One item per cycle**: per-Issue exceptions are caught and recorded, then the cycle exits. The scheduler owns retrying or moving on to the next ready item.
- **Single cycle per team**: do not run two concurrent cycles against the same team — concurrent claims could race.
- **Single-label invariant**: after every transition, verify exactly one `status:*` label is present. Two simultaneously breaks the build queue.
- **Never pick an arbitrary env for `$DONE`**. If `done` is a map and env is ambiguous, fail loudly.

## Adoption (one-time per team)

Before this skill can run against a Linear team, the team must adopt the build-queue label convention. Using the defaults:

1. Create labels `status:ready`, `status:in-progress`, `status:code-review`, `status:on-dev`, `status:done`, `status:blocked` on the team (or workspace). If your project overrides any `linear.labels.build.*` role name in config, substitute the actual label names you configured.
2. Apply the `$READY` label to Issues that are ready for development.
3. Reserve `$CLAIMED`, `$REVIEW`, `$DONE` for Lisa — humans should not set them manually except to recover from an error.

If the team hasn't adopted these labels, the first run exits with an adoption hint.

## Rules

- **Claim leaves only.** Per the `leaf-only-lifecycle` rule, never claim a container — an Issue with open child work, or a childless Epic — even if it carries the build-ready label. Skip or safe-block it (Phase 3a); never silently implement a container.
- Never relabel an Issue the cycle didn't claim. The `$CLAIMED` transition is the signature of cycle ownership.
- Never do build work directly from this scanner — the per-Issue lifecycle (the `linear-agent` workflow culminating in `lisa-implement`) owns it. And never spawn that lifecycle as a subagent; run it in-session per Phase 3c so `lisa-implement` can create its agent team.
- Never auto-transition past `$DONE`. Downstream labels are owned by QA / product / a future verification-intake skill.
- Never move the native Linear state to Done / Completed for intermediate env states (`status:on-dev`, `status:on-stg`, or configured equivalents). Native completion happens only at the terminal `done` value.
- If the Issue has no Validation Journey or no sign-in credentials in its description, the pre-flight verify gate will catch it and relabel to `status:blocked` — don't try to fix the Issue from here.
- On any unexpected outcome from the lifecycle run (label it doesn't claim, missing PR URL on success, etc.), record as Error and surface — never assume.
- Never pick an arbitrary env for `$DONE` resolution. If `done` is a map and env is ambiguous, fail loudly.
