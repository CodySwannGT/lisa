---
name: lisa-jira-build-intake
description: "Symmetric counterpart to…"
allowed-tools: ["Skill", "Bash"]
---

# JIRA Build Intake: $ARGUMENTS

All Atlassian operations in this skill go through `lisa-atlassian-access`. Do not call MCP tools or `acli` directly.

`$ARGUMENTS` is one of:

1. A JIRA project key (e.g. `SE`) — scans that project for tickets in the configured `ready` status.
2. A full JQL filter (e.g. `project = SE AND component = "frontend" AND Status = Ready`) — used as-is. The skill will not append a `Status = <ready>` clause if the JQL already names a status, so callers can intentionally widen. It also auto-scopes the query to the current repo (Phase 1 step 2) unless the JQL already constrains repo (a `repo:` label or `component =` term), so a multi-repo project / forwarded assignee filter is not widened to sibling repos by accident.

Run one build-intake cycle. The first eligible ready ticket is claimed, built via the `jira-agent` workflow run in-session (Phase 3c, culminating in `lisa-implement`), transitioned to the configured `done` status (env-aware — see below), then the cycle exits. Remaining ready tickets stay queued for later scheduler invocations.

## Workflow resolution

Status names are read from `.lisa.config.json` `jira.workflow.*`, falling back to defaults documented in the `config-resolution` rule. Bash pattern:

```bash
# Read role with default fallback. Local overrides global per-key.
read_role() {
  local role="$1" default="$2"
  local local_v global_v
  local_v=$(jq -r ".jira.workflow.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".jira.workflow.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}

READY=$(read_role ready "Ready")
CLAIMED=$(read_role claimed "In Progress")
```

For env-keyed `done`, resolve the env first, then look up `done[<env>]`:

1. Explicit caller arg (`target_env=staging`) wins.
2. Otherwise, infer the env from the PR's base branch via `deploy.branches` (reverse lookup: if base is `staging`, env is `staging`).
3. If `done` in config is a **string** (not a map), use it directly regardless of env.
4. If `done` is a **map** and env cannot be resolved, **fail loudly** — do not pick arbitrarily.

```bash
# Resolve env, then DONE.
TARGET_ENV="${target_env:-}"  # from caller args if supplied
if [ -z "$TARGET_ENV" ] && [ -n "$PR_BASE_BRANCH" ]; then
  TARGET_ENV=$(jq -r --arg b "$PR_BASE_BRANCH" \
    '.deploy.branches // {} | to_entries[] | select(.value == $b) | .key' \
    .lisa.config.json 2>/dev/null | head -1)
fi

DONE_RAW=$(jq -r '.jira.workflow.done // empty' .lisa.config.json 2>/dev/null)
DONE_TYPE=$(jq -r '.jira.workflow.done | type' .lisa.config.json 2>/dev/null)
if [ "$DONE_TYPE" = "string" ]; then
  DONE="$DONE_RAW"
elif [ "$DONE_TYPE" = "object" ]; then
  [ -z "$TARGET_ENV" ] && { echo "ERROR: jira.workflow.done is env-keyed but env not resolvable"; exit 1; }
  DONE=$(jq -r --arg e "$TARGET_ENV" '.jira.workflow.done[$e] // empty' .lisa.config.json)
  [ -z "$DONE" ] && { echo "ERROR: jira.workflow.done has no entry for env '$TARGET_ENV'"; exit 1; }
else
  # Default: env-keyed map matching legacy hardcoded names.
  case "$TARGET_ENV" in
    dev) DONE="On Dev" ;;
    staging) DONE="On Stg" ;;
    production) DONE="Done" ;;
    *) echo "ERROR: cannot resolve done status without env"; exit 1 ;;
  esac
fi
```

Run one build-intake cycle. The first eligible ticket in `$READY` is claimed by transitioning to `$CLAIMED`, built via the in-session lifecycle (Phase 3c), transitioned to `$DONE` on completion, then the cycle exits.

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a project key or JQL, run the cycle to completion — claim and dispatch the first eligible ticket through the in-session lifecycle (Phase 3c), transition a successful build to `$DONE`, write the summary, and exit. The caller (a human or a cron) has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background queue.

Specifically forbidden:

- Previewing projected scope (ticket count, projected PR count, build duration) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip a few / dry-run only" — the documented behavior IS the default.
- Pausing because the queue is large, tickets look complex, or tickets are likely to be `Blocked` by the pre-flight gate. The pre-flight `Blocked` outcome is a valid terminal state of the per-ticket lifecycle, not a failure mode — surfacing those tickets to humans is success.
- Pausing because the build flow looks expensive. The cost of one cycle is bounded; the cost of stalling a scheduled cron waiting on a human is unbounded.

The only legitimate reasons to stop early:

- Missing project key / JQL or required configuration. Surface the missing value and exit.
- Workflow misconfigured (pre-flight check finds `$CLAIMED` or `$DONE` not reachable, or `$READY` status absent). Surface and exit.
- Empty ready set. Exit cleanly with `"No tickets with Status=$READY. Nothing to do."`

## Lifecycle assumed

The JIRA workflow has these statuses (configured per project — see Workflow resolution above for how role names map to actual workflow values):

```text
TODO → ready → claimed → done(env-keyed) → On QA → archive
       (PM/    (us claim)  (us done;        (downstream)
        human)              PR ready)
```

This skill ONLY transitions `$READY → $CLAIMED` on claim, and `$CLAIMED → $DONE` on completion. It never touches `TODO`, post-`done` statuses, or any blocked/closed states.

**Pre-flight check**: at start of each cycle, attempt the `$CLAIMED` and `$DONE` transitions against a sample ready ticket via `lisa-atlassian-access` `operation: transition key: <K> to: "<status>"` (in a probe / dry-run sense — or fetch transition metadata if the access skill exposes that). If the transitions are unreachable, stop and report the workflow misconfiguration to the caller — do not invent transitions.

## Phases

### Phase 1 — Resolve the query

1. Parse `$ARGUMENTS` into a base JQL:
   - Project key: `project = <KEY> AND Status = "$READY"`.
   - Full JQL: use as-is. If it does not include a `Status` clause, append `AND Status = "$READY"`.
2. **Repo-scope pre-filter (query-time arm of `repo-scope-split`).** A JIRA project can oversee multiple repos (`frontend` / `backend` / `infrastructure`), so an unscoped `project = <KEY> AND Status = $READY` — or an `assignee = … AND Status = $READY` filter forwarded by `lisa-intake` — pulls in **every** sibling repo's ready tickets and forces the claim-time gate (3a.0) to skip them one-by-one: a full wasted scan when none belong to the current repo. Narrow the candidate set at query time so other-repo tickets never enter it:
   1. **Resolve the current repo** per `config-resolution` "Repo scoping" (`.repo` → `.github.repo` → `git remote get-url origin` basename) — the same resolution 3a.0 uses.
   2. **If the base JQL already constrains repo** — it contains a `repo:` label term or a `component = "<repo>"` term — the caller has already scoped (or intentionally widened) it; leave it untouched.
   3. **Else, if the current repo resolved**, append (before the `ORDER BY`):
      ```text
      AND (labels = "repo:<current>" OR labels IS EMPTY)
      ```
      This drops tickets explicitly stamped for a **sibling** repo up front, while still surfacing **unlabeled** tickets (`labels IS EMPTY`) so the claim-time gate can determine + stamp them — i.e. it pre-applies only the unambiguous "wrong-repo → skip" arm of 3a.0 and never hides work the stamping path must see. The JIRA **component** alias and any rarer residual cases stay with the authoritative claim-time gate in 3a.0.
   4. **If the current repo cannot be resolved**, skip this augmentation and fall back to the broad scan (3a.0 still enforces scoping). Do not fail the cycle solely because the pre-filter could not be built.
3. Append the ordering: `ORDER BY priority DESC, created ASC`.

```bash
# CURRENT_REPO resolved per config-resolution "Repo scoping" (see 3a.0).
# Append a repo pre-filter only when the JQL does not already constrain repo.
if [ -n "$CURRENT_REPO" ] && ! printf '%s' "$BASE_JQL" | grep -qiE 'repo:|component[[:space:]]*='; then
  BASE_JQL="${BASE_JQL} AND (labels = \"repo:${CURRENT_REPO}\" OR labels IS EMPTY)"
fi
JQL="${BASE_JQL} ORDER BY priority DESC, created ASC"
```

4. Confirm the configured Atlassian site by invoking `lisa-atlassian-access` `operation: list-sites` (it enforces connection match against `.lisa.config.json`).

### Phase 2 — Find ready tickets

Invoke `lisa-atlassian-access` `operation: search-issues jql: "<JQL>"`. Capture each ticket's: key, summary, issue type, priority, assignee, parent (epic), labels, components.

If empty, report `"No tickets with Status=$READY. Nothing to do."` and exit. This is the common idle case.

### Phase 3 — Process the first eligible ready ticket

#### 3a.0 Repo-scope gate (claim only current-repo tickets)

A JIRA project can oversee multiple repos (`frontend` / `backend` / `infrastructure`). This skill claims only tickets for the repo it is running in. Run this gate **before** the leaf-only gate (3a) and the claim (3b), per the `repo-scope-split` rule's "Claim-time repo scoping" section (cite it by slug; do not restate its decision table).

1. **Resolve the current repo** per `config-resolution` "Repo scoping" (`.repo` → `.github.repo` → `git remote get-url origin` basename). If unresolvable, stop and report — do not claim tickets you cannot scope.
2. **Cheap path first.** Phase 1's query-time pre-filter has already dropped tickets explicitly stamped for a sibling repo, so the Phase 2 result set is current-repo-labeled + unlabeled tickets. Prefer candidates already carrying `repo:<current>` — a JIRA **label**, or a **component** equal to the repo name (accepted as an alias); the pre-filter is label-only, so a ticket scoped solely by a sibling-repo **component** can still appear and is skipped here. The result set still includes unlabeled tickets so they can be determined and stamped; this gate orders/filters what remains.
3. **Per candidate, apply the repo-scope decision (`repo-scope-split`):**
   - Carries `repo:<other>` (label or component) → **skip** (leave it `ready` for that repo's own intake); next candidate.
   - **Unlabeled** → determine the target repo(s) from the ticket (description, AC, technical approach) confirmed against the code surfaces, then **stamp** `repo:<name>` via `lisa-atlassian-access` `operation: write-ticket` (add the label / set the component) so later cycles filter cheaply; re-apply with the now-known repo.
   - **Multi-repo leaf → split, never claim.** Run the `repo-scope-split` work-time procedure to break it into single-repo siblings, each created **build-ready** (`build_ready: true`) and stamped with its own `repo:<name>`; the current repo's sibling becomes a normal candidate.
   - **Single-repo leaf for the current repo** → fall through to 3a (leaf-only gate) and 3b (claim).
4. Continue until a claimable current-repo leaf is found (claim it; one per cycle) or the ready set is exhausted — exit cleanly with `"No ready tickets for repo <current>. Nothing to do."`.

#### 3a. Leaf-only claim gate (skip / safe-block containers)

Build intake claims **only independently implementable leaf work units**. This enforces the claim-time arm of the vendor-neutral `leaf-only-lifecycle` rule: a parent/container that still carries a stale build-ready status (e.g. `Ready` applied before this rule existed, or hand-applied to an Epic/Story) is **never claimed** — intake skips it or safe-blocks it with a clear lifecycle-repair message. It is the claim-time complement to the write-time labeling in `lisa-jira-write-ticket` and the validate-time S15 gate in `lisa-jira-validate-ticket`; all three cite the same rule so the classification never drifts. **Never silently implement a container.**

Run this gate **before** the claim transition, starting with the oldest/highest-priority ready candidate. Do NOT transition, comment "Claimed", or dispatch the lifecycle for a ticket that fails the gate.

**Resolve container vs. leaf — structural first, then nominal.** Per `leaf-only-lifecycle` the classification is structural: a ticket is a **container** if it has **open** child work, whatever its declared type; otherwise the **issue type** decides. Resolve child work using the same hierarchy `lisa-jira-read-ticket` uses — JIRA's native Epic → Story → Sub-task parentage (Epic link / parent field for Stories under an Epic, and the subtask relationship for Sub-tasks under a Story/Task). Issue links (`blocks` / `is blocked by`) express cross-item dependencies and are **not** parentage — do not count them as children.

Fetch the ticket's children via `lisa-atlassian-access` `operation: search-issues` with a JQL that resolves both subtasks and Epic-linked Stories, then count those still open (not in a resolved/Done status):

```bash
# Children of <TICKET>: native subtasks plus, for an Epic, its linked Stories.
# (parent = <TICKET>) covers Sub-tasks and child issues; ("Epic Link" = <TICKET>)
# covers Stories under an Epic on JIRA instances that expose the Epic Link field.
CHILDREN_JQL='(parent = "<TICKET>" OR "Epic Link" = "<TICKET>")'
# Count children whose status is NOT a resolved/terminal one. A parent whose
# children are all Done is no longer holding open work and rolls up via
# leaf-only-lifecycle's rollup, not here.
OPEN_CHILDREN_JQL="${CHILDREN_JQL} AND statusCategory != Done"
```

Invoke `lisa-atlassian-access` `operation: search-issues jql: "<OPEN_CHILDREN_JQL>"` and let `OPEN_CHILDREN` be the count of returned issues (0 if none). If the JQL cannot resolve the `Epic Link` field on this instance (older JIRA / team-managed projects expose parentage differently), fall back to the parentage `lisa-jira-read-ticket` derives and treat the ticket as a container if any derived child is open. Note "Epic Link unavailable — parentage derived" so the operator knows how children were resolved.

Classify and act (first match wins). The issue type comes from the ticket's `issuetype` field (`Epic`, `Story`, `Spike`, `Bug`, `Task`, `Sub-task`, `Improvement`):

| Condition | Class | Action |
|---|---|---|
| `OPEN_CHILDREN > 0` (open child work, any type) | **Container** | **Skip / safe-block — do NOT claim** |
| no open children AND type = Epic | **Childless Epic (pure rollup container)** | **Skip / safe-block — do NOT claim** |
| no open children AND type ≠ Epic (Bug, Task, Sub-task, Improvement, Story, Spike, or no recognized type) | **Leaf work unit** | **Proceed to 3b claim** |

The childless-parent exception promotes every childless type **except Epic** to a claimable leaf: a childless Story is a directly shippable increment and a childless Spike *is* the investigation unit, so neither is stranded. Only a childless **Epic** stays unclaimed — an Epic is a pure rollup container by design, and a childless one is an incomplete decomposition or a mis-applied role, never an implementable unit.

**Safe-block (default action for a flagged container).** Leave the build-ready status in place (don't silently transition it away — that hides the lifecycle error), post a single lifecycle-repair comment, record the ticket under "Skipped (container)" in the summary, and end the cycle. Do NOT transition to `$CLAIMED`. Keep the comment idempotent — skip posting if an identical `[claude-build-intake]` lifecycle-repair comment already exists on the ticket, so a re-entrant cycle doesn't spam it.

Post via `lisa-atlassian-access` `operation: comment key: <TICKET> body: "<message>"` with:

```text
[claude-build-intake] Not claimed: this ticket carries the build-ready status ($READY) but is a container with open child work (or a childless Epic), which violates the leaf-only-lifecycle rule. Build-ready (status:ready) is leaf-only per leaf-only-lifecycle — an agent claims and implements leaves, never a container. Repair: move $READY off this parent onto its leaf children (or, for a childless Epic, decompose it into leaf children or reclassify it to a leaf type). A parent's lifecycle state rolls up from its children and is never set to ready directly.
```

This gate never blocks a legitimate flat Task/Bug: those have no open children and a leaf type, so they fall straight through to the claim in 3b.

#### 3b. Claim

**Rejection detection runs first — before the transition below.** Per the vendor-neutral `rejection-detection` rule (cite the slug; do not restate its classification table), classify this ticket at the **top of 3b, BEFORE** the `$READY → $CLAIMED` transition — after the transition the current-status signal is gone. Read the ticket's status changelog via `lisa-atlassian-access operation: changelog key: <TICKET>` and classify it `rejection-reclaim | forward-only | never-left-ready | unknown` (a `rejection-reclaim` is a changelog entry whose `to` is the configured `$READY` status following an earlier `review`/`done`-ward status). Status names come from `.lisa.config.json`, never hardcoded. A failing/absent changelog yields `unknown` and the claim proceeds — detection never blocks the build. Tickets carrying a learning marker (`[lisa-learning-drop]` / `[lisa-learning-pr]` / `[lisa-learning-upstream-handoff]`) or the `learning:needs-triage` label are never rejection triggers (no learning-about-learning). Carry the classification into the transition and lifecycle below.

**On `rejection-reclaim`, reflect before re-implementing** (per `rejection-detection`): read the rejection evidence through the access layer — the ticket comments posted after the backward transition (the QA rejection comment) via `lisa-atlassian-access operation: read-ticket` / `comment` reads and the review threads on the rejected PR — assemble ONE candidate learning (rule, why, provenance linking the rejection comment + rejected PR, evidence links, scope hint, triggering issue, fingerprint `sll4-sha1(rule\ntriggering_issue)[:12]`), and route it to the `lisa-persist-learning` skill. If that skill is absent, record the candidate via `lisa-atlassian-access operation: comment` as a comment carrying a **visible prose line plus** the marker (a bare marker renders as an empty bubble) — `Recorded a candidate learning from this rejection (queued for the judgment gate): <one-line candidate rule>.` then `<!-- [lisa-rejection-candidate] key=<issue>-<transition-ts> -->` — and proceed. Dedupe on `<issue>-<backward-transition-timestamp>` — a second re-claim produces no duplicate. Unreadable/absent evidence → no candidate, still implement.

**Claim-time archaeology runs second — after rejection detection, still before the transition below.** Classify this ticket per the vendor-neutral `claim-archaeology` rule, with the rejection classification above as its input. All shared semantics — ancestry signals, classification, learning-loop exclusion, cost budget, candidate derivation, marker dedupe, and the never-block degrade — live in that one slug; change them there, never here. JIRA wiring only: the typed relations are already in the read bundle; text-similarity searches run through `lisa-atlassian-access operation: search-issues jql:` over recently-closed tickets; the fallback candidate comment is posted via `lisa-atlassian-access operation: comment`.

Transition the ticket from `$READY` to `$CLAIMED` by invoking `lisa-atlassian-access` `operation: transition key: <TICKET> to: "$CLAIMED"`.
- **Assign to the authenticated user when the ticket is unassigned.** A claim must be attributable. If the ticket has no assignee, assign it to the authenticated account — prefer acli `--assignee @me` (resolves server-side to the authenticated user, which avoids the federated-`accountId` mis-assignment), or `write-ticket` with the `accountId` from the `/rest/api/3/myself` identity probe the access skill already documents. Leave an already-assigned ticket's assignee untouched — never reassign work that already has an owner.
- Post a `[claude-build-intake]` comment via `lisa-atlassian-access` `operation: comment key: <TICKET> body: "Claimed by Claude. Starting build."`
- This is the idempotency lock — a re-entrant cycle's `Status = $READY` filter will not see this ticket again.

If the transition fails (permission, missing transition, race), log under "Errors" in the cycle summary and skip this ticket. **Do not invoke the build flow on a ticket you didn't successfully claim.**

#### 3c. Run the per-ticket lifecycle in-session (never as a subagent)

After the claim succeeds, run the per-ticket lifecycle defined by the `jira-agent` workflow **in the current session** — never by spawning `jira-agent` (or any named worker) via the `Agent` tool. The lifecycle culminates in a team-first flow (`lisa-implement`), and that flow can only create its agent team from the lead session: a spawned teammate cannot add named teammates (Claude teams are flat), so dispatching the build into a subagent strands `lisa-implement` without its team and collapses the build into a single inline worker. Concretely:

1. **Run the gates in-session** via their skills, exactly as `jira-agent.md` defines them and with all of its gating behaviors intact:
   - `lisa-jira-read-ticket` — the full ticket graph (mandatory; never ad-hoc reads)
   - `lisa-jira-verify` — pre-flight quality gate, including the draft-then-block procedure on FAIL
   - `lisa-ticket-triage` — analytical triage gate (a `BLOCKED` verdict stops the cycle with findings posted)
   - Intent determination from the issue type
2. **Dispatch the flow in-session:** when the gates pass, invoke the lifecycle skill via the Skill tool — `lisa-implement <TICKET>` for Build / Fix / Improve / Investigate-Only (or `lisa-plan` for an Epic) — passing the full context bundle from the read step. **When 3b classified this ticket `rejection-reclaim`, the context bundle passed to `lisa-implement` MUST include the rejection evidence summary** (what was rejected, the defect the QA comment named, the approach named as wrong) — reuse the evidence already read in 3b, do not fetch it twice — so the plan can address it per `rejection-detection`; absence of evidence never blocks. `lisa-implement`'s own orchestration preamble then creates the per-item agent team (input-resolver, Roster Decision, specialist fanout) exactly as a direct invocation would.
3. **Milestone sync and evidence** (`lisa-jira-sync`, `lisa-jira-evidence`) happen at the milestones the `jira-agent` workflow defines, within the dispatched flow.

If you are somehow running this skill as a spawned teammate inside an existing team (nested misrouting — Intake keeps this chain in the lead session), do NOT run the lifecycle inline and do NOT spawn named peers. Return this payload to the lead so the lead session can run this Phase 3c in-session:

```json
{
  "type": "delegation-request",
  "phase": "jira-build-intake 3c",
  "workItem": "<TICKET>",
  "context": {
    "claimedStatus": "$CLAIMED",
    "doneResolution": "Resolve $DONE from the PR base branch per this skill's Workflow resolution section"
  },
  "onSuccess": "Confirm the returned PR is merged, then apply Phase 3d and Phase 3d.1",
  "onBlockedOrError": "Leave the ticket where the lifecycle left it and record the surfaced outcome"
}
```

The lifecycle run returns one of the following outcomes; resume this scanner with it:
- **Success** — the build flow completed and a PR exists; evidence posted. The PR may already be **merged** or still **open** (auto-merge enabled, awaiting checks/merge). "Success" means the build work is sound — it does **not** assert the change reached an environment. The env transition in 3d gates on the PR actually being merged; an open PR does not advance the ticket to a `done` env status.
- **Blocked by jira-verify pre-flight gate** — the pre-flight gate (jira-agent workflow step 2) transitions the ticket to `Blocked` and reassigns to Reporter. This is correct and expected — let it stand. Record the outcome and move on.
- **Duplicate already fixed** — `lisa-ticket-triage` returned `DUPLICATE_ALREADY_FIXED` with a canonical ticket reference and empirical base-branch evidence. Post the triage finding, ensure the native `duplicates <canonical>` link exists, transition to the terminal `$DONE` status with resolution `Duplicate`, and do not open a PR. If the canonical fix is merged but not yet on the production branch, the close comment must say the production error can recur until the canonical ticket promotes and that recurrence is tracked by the canonical ticket; do not reopen this duplicate for that recurrence.
- **Blocked by ticket-triage ambiguities** — triage posts findings and the lifecycle stops. The ticket stays in `$CLAIMED`. Surface to human; do not auto-transition. Record under "Errors" with reason `"Triage found ambiguities — see comments on <ticket-key>"`.
- **Errored** — exception, missing config, etc. Leave the ticket in `$CLAIMED` for human investigation. Record under "Errors" with the exception summary.

#### 3c.1 Close duplicate already fixed

Run this only when the returned triage verdict is exactly `DUPLICATE_ALREADY_FIXED`.

1. Verify the structured result includes a canonical ticket reference, the canonical PR/commit, and empirical evidence that the canonical fix is present on the base branch. If any piece is missing, treat the outcome as Held instead of closing.
2. Post or preserve the triage-finding comment that explains why this ticket is a duplicate and names the canonical ticket.
3. Ensure the native `duplicates <canonical>` link exists through `lisa-atlassian-access`.
4. Resolve the terminal `$DONE` value exactly as in Phase 3d. For env-keyed workflows, duplicate closeout uses the production/final done status, not an intermediate `On Dev`/`On Stg` waypoint.
5. Transition to `$DONE` with JIRA resolution `Duplicate`. If `acli` cannot set resolution on transition, use the Atlassian REST transition-with-fields path exposed by `lisa-atlassian-access`, or a documented follow-up edit that sets the resolution immediately after transition. Do not report success with an empty resolution when the workflow requires one.
6. Post a close comment naming the canonical ticket, PR/commit, and base-branch evidence.

If the canonical fix is merged but not yet present on the production branch, append the production-promotion caveat to the close comment: the production error can recur until the canonical ticket promotes, and recurrence is tracked by the canonical ticket rather than by reopening this duplicate.

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
3. **Never block on it.** A failed bump, an unwritable file, or a `not-found` result (the entry was pruned) is recorded under the cycle summary and the claim proceeds — shipping the ticket always outranks confirming a learning about it.

#### 3d. Transition to $DONE (only after the PR is merged)

A `done` env status (`On Dev`, `On Stg`, or the terminal value) asserts that the code has actually reached that environment. Never set it for a PR that is merely open: auto-merge can be blocked indefinitely (a required rebase / `BEHIND` branch, failing checks, an unaddressed review), and the change may never land. Setting `On Stg` on an open PR makes a ticket *claim* a deploy that never happened. Transition only after confirming the PR merged.

If the lifecycle run returned Success:
1. **Confirm the PR merged.** Read the live state of the ticket's PR — `gh pr view <pr> --json state,mergedAt,mergeStateStatus,url`:
   - **Merged** (`state == MERGED`) → proceed to resolve and apply `$DONE` below. Where the env deploy is observable (a deploy workflow run / deployment status keyed to the merged-into branch via `deploy.branches`), confirm it did not fail before transitioning; a still-running deploy is treated like an open PR (leave in `$CLAIMED` for a later cycle), a failed deploy is recorded as an Error.
   - **Open / not yet merged** → do **not** transition. The build is sound but the change has reached no environment yet. Record the ticket under **"PR open — awaiting merge"** in the summary (with the PR URL and its `mergeStateStatus`), leave it in `$CLAIMED`, and stop. A later `lisa-repair-intake` cycle drives the open PR to merge — re-syncing a `BEHIND` branch so the already-enabled auto-merge can land, or surfacing a real blocker — and, once it is merged, applies this same env transition. Do **not** comment "Build complete" or file anything: the work is in-flight, not done.
   - **Closed without merging** → record an Error (the PR was abandoned unmerged); leave the ticket in `$CLAIMED` for human investigation.
2. Resolve `$DONE` for this ticket's PR base branch using the Workflow resolution algorithm above. If env can't be resolved and `done` is env-keyed, record an Error and skip this transition — never guess.
3. Determine whether `$DONE` is the true terminal done value per the `leaf-only-lifecycle` rule's Terminal native closure section:
   - If `jira.workflow.done` is a string, that status is terminal.
   - If `jira.workflow.done` is an object, only the production/final environment value is terminal (default: `Done`). Intermediate env statuses such as `On Dev` and `On Stg` are not terminal and must remain unresolved / open.
   - If the project uses a different final environment name, resolve it from the configured deployment topology; if ambiguous, record an Error and do not finalize native resolution.
4. Invoke `lisa-atlassian-access` `operation: transition key: <TICKET> to: "$DONE"`.
5. If `$DONE` is terminal, verify the resulting JIRA issue is natively closed/resolved: status category is `Done`, and resolution is set when the project's workflow requires one. If the transition screen requires an explicit resolution, use the configured default resolution if present; otherwise record an Error naming the missing workflow setup rather than silently landing in an unresolved Done-named status.
6. Post a `[claude-build-intake]` comment via `lisa-atlassian-access` `operation: comment key: <TICKET> body: "Build complete. PR <URL> merged. Transitioned to $DONE."` Include whether terminal native resolution was verified, already satisfied, skipped for an intermediate env, or blocked by workflow setup.

For any non-Success outcome, do NOT transition. The ticket sits in `$CLAIMED` (or wherever the lifecycle left it for the Blocked case) — the cycle's job is done; humans take it from there.

#### 3d.1 Roll up the parent chain (forward rollup)

Run this **only after a successful `$DONE` transition in 3d**. This is the **forward** arm of the `leaf-only-lifecycle` rule's *"rollup is evaluated whenever a child transitions"* requirement: a leaf reaching `$DONE` may complete its parent Story, which may in turn complete its Epic. Without this step a fully-built parent stays open until the recovery `lisa-repair-intake` cron happens to run.

1. Resolve the ticket's parent using the same hierarchy `lisa-jira-read-ticket` uses — the native Epic → Story → Sub-task parentage (parent field / Epic link). If the ticket has no parent, skip — nothing to roll up.
2. Walk **up the ancestor chain bottom-up** (Sub-task → Story → Epic): for each ancestor invoke `lisa-jira-sync <ANCESTOR-KEY> --rollup`. That skill derives the ancestor's status from its children per `leaf-only-lifecycle`, applies it via `lisa-atlassian-access` `operation: transition` only when it differs (never the build-ready status), and performs terminal native resolution (`statusCategory = Done` with a resolution when the workflow requires one) when the derived env is the terminal `$DONE`. It is idempotent and safe-defaults (suggests, does not guess) when the rolled state is ambiguous.
3. Stop walking up when an ancestor has no parent, or when `--rollup` reports no change. Record each rolled-up ancestor and its derived state in the summary.

This does not re-implement the state machine — it delegates to `lisa-jira-sync --rollup`, the single rollup implementation `lisa-repair-intake` also uses, so the forward and recovery paths can never drift. Children closed **outside** this flow are not observed here; `lisa-repair-intake` remains the recovery net for those.

#### 3e. Stop

Stop immediately after the first claimed, skipped, blocked, held, or errored ticket. Later scheduler invocations process the remaining ready tickets.

### Phase 4 — Summary report

```text
## jira-build-intake summary

Query: <JQL or project key>
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

Tickets processed: <n>
- $DONE (build complete, PR merged): <n>
  - <ticket-key> <summary> → PR <URL>
- PR open — awaiting merge (left in $CLAIMED for repair-intake): <n>
  - <ticket-key> <summary> → PR <URL> (mergeStateStatus: <state>)
- Skipped (container — leaf-only-lifecycle): <n>
  - <ticket-key> <summary> — build-ready on a parent with open child work; lifecycle-repair comment posted
- Duplicate already fixed (closed as Duplicate): <n>
  - <ticket-key> <summary> — duplicate of <canonical>; no PR opened
- Blocked (pre-flight verify failed): <n>
  - <ticket-key> <summary> — see ticket comments
- Held (triage found ambiguities): <n>
  - <ticket-key> <summary> — see ticket comments
- Errors: <n>
  - <ticket-key> <summary> — <reason>

Total PRs opened: <n>
```

## Idempotency & safety

- **Leaf-only claim gate runs first**: Phase 3a classifies each candidate before any claim; a container with open child work (or a childless Epic) is skipped/safe-blocked, never claimed (the `leaf-only-lifecycle` rule's claim-time arm). The safe-block comment is idempotent — a re-entrant cycle does not re-post it.
- **Claim-first ordering**: `$CLAIMED` set BEFORE the lifecycle dispatch — no double-pickup.
- **No writes outside the lifecycle**: this skill only transitions `$READY → $CLAIMED` and `$CLAIMED → $DONE`, then verifies terminal native resolution when `$DONE` is the true terminal state per `leaf-only-lifecycle`. Every other status change is owned by the per-ticket lifecycle (jira-agent workflow, which suggests transitions but only auto-transitions on the verify-FAIL path).
- **Duplicate terminal exception**: `DUPLICATE_ALREADY_FIXED` is the only triage outcome that may close a claimed ticket without a PR from this cycle. It must include a canonical ticket reference and empirical base-branch evidence, and it resolves as Duplicate rather than as completed build work.
- **Terminal native closure**: for terminal `$DONE`, the resulting JIRA issue must be in a resolved / closed state (`statusCategory = Done` and resolution set when required). Intermediate env statuses stay unresolved / open.
- **One item per cycle**: per-ticket exceptions are caught and recorded, then the cycle exits. The scheduler owns retrying or moving on to the next ready item.
- **Single cycle per query**: do not run two `lisa-jira-build-intake` cycles concurrently against overlapping queries — concurrent claims could race. The scheduling layer (when added) is responsible for serialization.
- **Never invent a transition**: if `$CLAIMED` or `$DONE` aren't valid transitions in the project's workflow, stop and report rather than guessing alternative names.

## Configuration

Reads `atlassian.cloudId`, `jira.project`, and `jira.workflow.{ready,claimed,done}` from `.lisa.config.json` (with `.lisa.config.local.json` overriding per key). The project key is also accepted as `$ARGUMENTS` for ad-hoc invocations.

Status role names default to:
- `ready` → `"Ready"`
- `claimed` → `"In Progress"`
- `done` → env-keyed map `{ "dev": "On Dev", "staging": "On Stg", "production": "Done" }`

If a project uses different names (e.g. `Open` instead of `TODO`, `In Development` instead of `In Progress`, `Code Review` for terminal), override the relevant key in `.lisa.config.json` `jira.workflow.*`. The setup skills (`/lisa:setup:jira`) handle this interactively.

Per-invocation overrides via `$ARGUMENTS` (e.g. `claim_status="In Development"`) are accepted as a secondary escape hatch but `.lisa.config.json` is the canonical source.

If a ready-equivalent status does not exist in the JIRA project's workflow, this skill cannot run. The remediation is to add it to the project workflow scheme — JIRA admin task, not something this skill can do.

| Field / variable | Default | Purpose |
|------------------|---------|---------|
| `.lisa.config.json` `jira.project` | (from `$ARGUMENTS`) | Project key for the default JQL |
| `.lisa.config.json` `atlassian.cloudId` | — | Atlassian Cloud site UUID (required) |
| `.lisa.config.json` `jira.workflow.ready` | `Ready` | The status that signals "human says this is buildable" |
| `.lisa.config.json` `jira.workflow.claimed` | `In Progress` | The intermediate status the agent sets on pickup |
| `.lisa.config.json` `jira.workflow.done` | env-keyed map (`dev`/`staging`/`production`) or string | The status set after a successful build; env-aware |
| `.lisa.config.json` `deploy.branches` | — | Reverse-lookup map for env inference from PR base branch |
| `.lisa.config.json` `repo` / `github.repo` (or git remote basename) | (git remote basename) | Current repo for the Phase 1 query-time repo pre-filter and the 3a.0 claim-time gate |

## Rules

- **Scope the query to the current repo.** Per `repo-scope-split`, append the repo pre-filter (Phase 1 step 2) so a multi-repo JIRA project — or a forwarded `assignee` filter — never pulls sibling repos' ready tickets into the candidate set. It is the cheap query-time arm of the same rule whose authoritative claim-time arm is the 3a.0 gate; the two must agree on how the current repo is resolved. Skip the augmentation (do not fail) only when the current repo can't be resolved or the JQL already constrains repo.
- **Claim leaves only.** Per the `leaf-only-lifecycle` rule, never claim a container — a ticket with open child work, or a childless Epic — even if it carries the build-ready status. Skip or safe-block it (Phase 3a); never silently implement a container.
- Never transition a ticket the cycle didn't claim. The `$CLAIMED` transition is the signature of cycle ownership.
- Never do build work directly from this scanner — the per-ticket lifecycle (the `jira-agent` workflow culminating in `lisa-implement`) owns it (read, verify, triage, route, sync, evidence). This skill is the dispatcher, not the builder. And never spawn that lifecycle as a subagent; run it in-session per Phase 3c so `lisa-implement` can create its agent team.
- Never auto-transition past `$DONE`. Downstream statuses are owned by QA / product / a future verification-intake skill — not this one.
- Never resolve / close a JIRA ticket at intermediate env statuses (`On Dev`, `On Stg`, or configured equivalents). Native resolution is terminal-only.
- If the ticket has no Validation Journey or no sign-in credentials in its description, the pre-flight verify gate will catch it and transition to `Blocked` — **don't try to fix the ticket from here**. Pre-flight gating is the lifecycle's job; running build work on a thin ticket produces broken work.
- On any unexpected outcome from the lifecycle run (status it doesn't claim, missing PR URL on success, etc.), record as Error and surface — never assume.
- Never pick an arbitrary env for `$DONE` resolution. If `done` is a map and env is ambiguous, fail loudly.
