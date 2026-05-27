---
name: repair-intake
description: "Vendor-agnostic repair scanner — the recovery counterpart to lisa:intake. Where intake claims `ready` work, repair-intake finds work that got stuck or was left half-closed: items left in `blocked`, stalled in an in-progress role (build `claimed`, PRD `in_review`), terminal-labeled items that are still natively open, and rollup/container items whose children are all terminal but whose parent is not closed out. Scans the same queues lisa:intake serves (Notion / Confluence / Linear / GitHub PRD databases; JIRA / GitHub / Linear build queues), enumerates candidates up to `max_candidates`, and repairs every materially actionable one in that bounded set: resumes stalled in-progress work IN PLACE (build → the vendor agent + the scanner's post-agent transition; PRD → the source `*-to-tracker` dry-run validate→route pipeline) — but for a stalled build it first diagnoses the PR/deploy state and, if the PR cannot merge (conflict, rebase-required, failing checks, unaddressed CodeRabbit/changes-requested) or a deploy failed, files a build-ready leaf fix ticket and moves the item to `blocked` (blocked by that ticket) rather than re-dispatching, re-validates blocked PRDs when new clarifying answers exist, re-dispatches blocked build items whose `is blocked by` dependencies have since closed, performs terminal native closure for terminal-labeled items, and closes rollups whose associated child work is fully terminal. Idempotent, loop-protected via a [lisa-repair-intake] marker + state fingerprint + backoff. Never mutates product-owned states (`draft`, `verified`) and never touches `ready` items. Designed as a /schedule cron target running alongside lisa:intake."
allowed-tools: ["Skill", "Bash", "Read", "Write", "Edit", "mcp__linear-server__list_teams", "mcp__linear-server__list_projects", "mcp__linear-server__get_project", "mcp__linear-server__save_project", "mcp__linear-server__list_project_labels", "mcp__linear-server__list_issues", "mcp__linear-server__get_issue", "mcp__linear-server__save_issue", "mcp__linear-server__list_comments", "mcp__linear-server__save_comment", "mcp__linear-server__list_issue_labels", "mcp__linear-server__create_issue_label"]
---

# Repair Intake: $ARGUMENTS

Run one batch-**repair** cycle against the queue identified by `$ARGUMENTS`. Where `lisa:intake`
scans the `ready` role and moves work *forward*, repair-intake scans the **stuck and
close-out** roles and moves work *unstuck* or *fully closed*:

- **Stalled in-progress** — an item left in an in-progress role (build `claimed`, PRD
  `in_review`) whose processing cycle died. It is technically "being worked" but nothing is
  happening, so it sits ignored forever. (The vendor PRD intakes explicitly leave an errored PRD
  in `in_review` "for the human to investigate from there" — that orphan is exactly what this
  skill recovers.) For a stalled **build**, repair-intake first diagnoses *why* it stalled by
  inspecting its PRs and deploys: if the PR cannot merge (conflict / rebase-required / failing
  checks / unaddressed CodeRabbit or `CHANGES_REQUESTED` review) or a deploy failed, it files a
  build-ready leaf fix ticket and moves the item to `blocked` (blocked by that ticket) instead of
  blindly re-dispatching the agent — which would just churn against an unmergeable PR.
- **Recoverable blocked** — an item in `blocked` whose blocker may now be gone: an
  `is blocked by` dependency has since closed, clarifying questions have been answered, or
  research/waiting resolves the ambiguity that stopped it.
- **Terminal-open drift** — an item already carrying its true terminal lifecycle role (for
  example GitHub `status:done`) but still open/active in the provider's native state.
- **Completed rollup drift** — a parent/container item (Epic, Story, PRD, Linear Project, or
  equivalent) whose associated child set is fully terminal but whose own lifecycle/native state has
  not been closed out.

This skill is the symmetric counterpart to `lisa:intake`. It reuses the same queue-detection,
the same agent-team orchestration, the same "don't ask, just run" confirmation policy, and the
same per-item surfaces the vendor intakes use (`lisa:<source>-to-tracker` dry-run for PRDs;
`lisa:<tracker>-agent` + the scanner's lifecycle transitions for build) — it differs in *which
roles it scans* and, for stalled/blocked work, *that it skips the claim step* (the item is already
claimed/blocked). Close-out candidates do not dispatch agents; they only reconcile terminal
lifecycle state with provider-native closure and rollup state.

## Public contract

```text
/lisa:repair-intake <queue> [intake_mode=prd|build|both] [stale_after=2h] [max_candidates=100] [force=true]
```

| Token | Meaning | Default |
|-------|---------|---------|
| `<queue>` | Same queue identifier `lisa:intake` accepts (see Source dispatch). Required. | — |
| `intake_mode` | `prd` \| `build` \| `both`. Only meaningful for a GitHub `org/repo` (or bare `github`) that hosts both PRD and build label namespaces. `both` is unique to repair — a repair sweep usefully covers both lifecycles in one schedule. Absent → `both` when both namespaces exist, else whichever lifecycle exists. | `both` for dual GitHub queues; otherwise infer |
| `stale_after` | How long with no observable activity before an in-progress item counts as stalled. Accepts `24h`, `90m`, `2d`, or `0` (treat any in-progress item as stalled — manual recovery, also the only way to resume work on a provider that exposes no reliable timestamp). Overrides config. | `2h` |
| `max_candidates` | Cap on how many stuck/close-out candidates to enumerate and evaluate. Repair every materially actionable candidate within this bounded set, then stop. Overrides config. | `100` |
| `force` | `true` bypasses the loop-prevention backoff window (so a manual re-run re-attempts items even if their fingerprint is unchanged). It does **not** change the staleness rule — use `stale_after=0` for that. | `false` |

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a queue, run the cycle to
completion. The caller (a human at the CLI or a scheduled cron) has already authorized the run
by invoking the skill; re-prompting defeats the purpose of a background repair sweep.

Specifically forbidden:

- Previewing projected scope (number of stuck items, projected re-dispatch count, write counts)
  and asking whether to continue.
- Offering A/B/C-style choices like "repair / skip / report-only" — the documented behavior IS
  the default.
- Pausing because many items are stuck, an item looks complex, or a repair is likely to land
  the item back in `blocked`. Returning an item to `blocked` with a current, accurate note is a
  valid outcome of the repair lifecycle, not a failure.
- Pausing because a re-dispatch looks expensive. The cost of one cycle is bounded by
  `max_candidates` and the actionable subset inside that cap; the cost of stalling a scheduled
  cron waiting on a human is unbounded.

The only legitimate reasons to stop early:

- Missing required input (no queue argument, missing project configuration). Surface the
  missing value and exit.
- The queue itself is misconfigured (Status property missing expected values, JIRA workflow
  can't reach required transitions). Surface and exit.
- No stuck/close-out candidates, or none actionable this cycle. Exit cleanly with the idle-case
  summary.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior successful team-creation or
subagent-delegation tool call in this session, not spawned into a team context), the very first
thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude: use `TeamCreate`. If `TeamCreate` has not been loaded yet, first use `ToolSearch` with
  `query: "select:TeamCreate"` to load its schema.
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search`
  with a query like `multi-agent tools` to load `multi_agent_v1`, then use
  `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent`
  call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the
  appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team
orchestration is unavailable in this runtime, continue as the lead agent, and preserve the
workflow's review, verification, and task-tracking obligations locally.

Until the team is established, the first Codex teammate has been spawned, or the no-team
fallback has been declared, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools
(Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`.
Scanning the queue, evaluating staleness, and dispatching per-item repairs — all of those are
tasks for the team you are about to create, not for the lead session before orchestration
exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill
tool), do NOT create a second team — many harnesses reject double-creates — and do NOT collapse the nested flow into a single inline worker. A nested team-first flow must still bring in the specialists it requires by adding them to the existing team, not by doing the work itself:

- **Claude:** teams are flat and only the lead can add named teammates, so do NOT call `Agent` with a `name` from a teammate (the harness rejects it: *"Teammates cannot spawn other teammates — the team roster is flat"*). Send the team lead a message naming the specialist teammate(s) this flow needs, their task assignments, and completion criteria, then coordinate through the shared task list until they finish. An anonymous subagent (`Agent` with `name` omitted) is permitted only for bounded one-shot work whose result returns directly to you — it is not a substitute for the required lifecycle specialists.
- **Codex:** do NOT call `TeamCreate`. If the lead/root agent is addressable (you were given its id/handle), send it a request to `multi_agent_v1.spawn_agent` the specialist agent(s), including each agent's prompt, ownership, and expected result. If no lead handle exists but `spawn_agent` is available to you, spawn only the bounded specialist agent(s) this flow needs, `wait_agent` for their results, and relay those results upward to the parent/lead.

Treat the first successful lead-spawn request (or, on the Codex fallback, the first specialist spawn) as preserving team orchestration. Never satisfy a team-first lifecycle flow by doing all the work inline. The cycle's outer team is created by repair-intake. Each per-item repair it runs
(`lisa:<source>-to-tracker` for a PRD, `lisa:<tracker>-agent` for a build item) executes within
the same team — those skills' orchestration preambles detect the existing team and skip creating
a second one. One team per cron cycle.

## Source dispatch

Detect the queue type from `$ARGUMENTS` using the **exact same detection and disambiguation
rules as `lisa:intake`** — read that skill's "Source dispatch" section for the authoritative
table; the detection is identical and only the per-item action changes (repair instead of
claim-and-advance). The essentials, inlined here so this skill is self-complete:

| If `$ARGUMENTS` is... | Queue / lifecycle | Source/tracker key | Candidates repaired |
|------------------------|-------------------|--------------------|----------------------|
| Notion **database** URL/ID | PRD (Notion) | source=notion | `in_review`, `blocked`, terminal/open PRDs, all-terminal generated-work rollups |
| Confluence **space** URL/key | PRD (Confluence) | source=confluence | `in_review`, `blocked`, terminal/open PRDs, all-terminal generated-work rollups |
| Confluence **parent page** URL/ID | PRD (Confluence, narrowed) | source=confluence | `in_review`, `blocked`, terminal/open PRDs, all-terminal generated-work rollups |
| Linear **workspace** URL, **team** URL/key, or literal `linear` | PRD (Linear) | source=linear | `in_review`, `blocked`, terminal/open PRDs, all-terminal generated-work rollups |
| GitHub **repo** URL / `org/repo` (PRD namespace) | PRD (GitHub) | source=github | `in_review`, `blocked`, terminal/open PRDs, all-terminal generated-work rollups |
| GitHub **repo** URL / `org/repo` with `tracker = github` (build namespace) | Build (GitHub) | tracker=github | `claimed`, `blocked`, terminal/open issues, all-terminal parent rollups |
| Literal `github` | GitHub; route by `intake_mode` (`prd` / `build` / `both`) | per lifecycle | per lifecycle above |
| JIRA project key or full JQL | Build (JIRA) | tracker=jira | `claimed`, `blocked`, terminal/closure verification, all-terminal parent rollups |

Disambiguation (same as `lisa:intake`): a `notion.so`/`notion.site` URL → Notion; an Atlassian
`/wiki/spaces/<KEY>` URL → Confluence (with `/pages/<id>` → parent-page narrowing); a
`linear.app` workspace/team URL or literal `linear` → Linear; a `github.com` URL / `<org>/<repo>`
token / literal `github` → GitHub; a bare token matching the JIRA project-key regex → JIRA
(else try Confluence space, then Linear team); a string with JQL operators → JQL. **A single-item
URL is out of scope** — this skill is batch-only; repair one item by hand via `lisa:implement`
(build) or by re-running `lisa:<source>-to-tracker` (PRD).

Role names for every vendor are resolved from `.lisa.config.json` per the `config-resolution`
rule — never hardcode status/label strings. The relevant repair roles:

| Lifecycle | Vendor | In-progress role key | Blocked role key | Terminal / rollup role key |
|-----------|--------|----------------------|------------------|----------------------------|
| Build | JIRA | `jira.workflow.claimed` (`In Progress`) | `jira.workflow.blocked` (`Blocked`) | env-resolved `jira.workflow.done` |
| Build | GitHub | `github.labels.build.claimed` (`status:in-progress`) | `github.labels.build.blocked` (`status:blocked`) | env-resolved `github.labels.build.done` (`status:done`) |
| Build | Linear | `linear.labels.build.claimed` (`status:in-progress`) | `linear.labels.build.blocked` (`status:blocked`) | env-resolved `linear.labels.build.done` (`status:done`) |
| PRD | Notion | `notion.values.in_review` (`In Review`) | `notion.values.blocked` (`Blocked`) | `notion.values.shipped` (`Shipped`) |
| PRD | GitHub | `github.labels.prd.in_review` (`prd-in-review`) | `github.labels.prd.blocked` (`prd-blocked`) | `github.labels.prd.shipped` (`prd-shipped`) |
| PRD | Linear | `linear.labels.prd.in_review` (`prd-in-review`) | `linear.labels.prd.blocked` (`prd-blocked`) | `linear.labels.prd.shipped` (`prd-shipped`) |
| PRD | Confluence | `confluence.parents.in_review` (page id) | `confluence.parents.blocked` (page id) | `confluence.parents.shipped` (page id) |

Resolve with the standard role-read pattern (local overrides global, default fallback):

```bash
read_role() {
  local path="$1" default="$2"
  local local_v global_v
  local_v=$(jq -r "${path} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r "${path} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}
# e.g. build/github:
CLAIMED=$(read_role '.github.labels.build.claimed' 'status:in-progress')
BLOCKED=$(read_role '.github.labels.build.blocked' 'status:blocked')
```

## Access layer (which surface does each write)

repair-intake stays vendor-neutral; concrete reads/writes go through the same layers the vendor
intakes use. Never call Atlassian MCP or `acli` directly — go through `lisa:atlassian-access`.

| Vendor | Reads (scan / comments / links) | Writes (transition / comment / close-out) | Re-dispatch / re-validate |
|--------|---------------------------------|-------------------------------|---------------------------|
| JIRA (build) | `lisa:atlassian-access` `search-issues` / `lisa:jira-read-ticket` | `lisa:atlassian-access` `transition` / `comment` | `lisa:jira-agent` |
| GitHub (build) | `gh issue list` / `gh issue view --json` / `gh pr list` / GraphQL sub-issues | `gh issue edit` (labels) / `gh issue comment` / `gh issue close --reason completed` | `lisa:github-agent` |
| Linear (build) | Linear MCP `list_issues` / `get_issue` / `list_comments` | Linear MCP `save_issue` (labels) / `save_comment` | `lisa:linear-agent` |
| Notion (PRD) | `lisa:notion-access` (`query`, page comments) | `lisa:notion-access` `write-page` (status) / page comment | `lisa:notion-to-tracker` (dry-run) |
| GitHub (PRD) | `gh issue list/view` (PRD labels) / GraphQL sub-issues / generated-work section | `gh issue edit` / `gh issue comment` / `gh issue close --reason completed` | `lisa:github-to-tracker` (dry-run) |
| Linear (PRD) | Linear MCP `list_projects` / `get_project` (+ sentinel feedback issue) | Linear MCP `save_project` (labels) / `save_comment` | `lisa:linear-to-tracker` (dry-run) |
| Confluence (PRD) | `lisa:atlassian-access` CQL | `lisa:atlassian-access` page `parentId` update / comment | `lisa:confluence-to-tracker` (dry-run) |

## Staleness model

An in-progress item (build `claimed`, PRD `in_review`) is **stalled** only if it shows no
observable activity newer than the `stale_after` threshold. `blocked` items are NOT gated on
staleness — their repairability is judged on current blocker/answer state, not elapsed time.

### Threshold resolution

1. `$ARGUMENTS` `stale_after=<dur>` (one-off override) — always wins. Parse `Nh` / `Nm` / `Nd` /
   `0` into hours.
2. `.lisa.config.json` `intake.repair.staleAfterHours` (durable project default).
3. Built-in default: **2 hours**.

`stale_after=0` means "treat any in-progress item as stalled" — a manual full-recovery lever,
and the only way to resume work on a provider that exposes no reliable activity timestamp.

### Activity signal (most-recent-wins, portable across vendors)

Compute the item's newest activity timestamp from the highest-priority signal the vendor
exposes, and compare it to `now - stale_after`:

1. Provider-native item `updatedAt` / `last_edited_time` / `updated`.
2. Latest lifecycle/progress **comment** on the item (and, for Linear PRDs, the sentinel
   feedback issue).
3. For build items, latest **PR activity** on the linked PR: newest commit, review, check-run,
   or PR comment.
4. Status/label **transition** time, when the provider exposes it cleanly.

If ANY of these is newer than the threshold, the item is **active** → record it as `active` and
skip it (read-only). For build `claimed`, an open PR with recent commits/checks is active. For
PRD `in_review`, a recent comment or page edit is active.

Count only **forward-progress** signals as keep-alive: new commits, a review that was just
requested or posted, an in-progress/queued check run, a fresh progress comment. A **settled
blocker state** — a failing/errored check run, `CONFLICTING` mergeability, a `CHANGES_REQUESTED`
review, an unaddressed CodeRabbit/reviewer change request, or a failed deployment — is NOT
keep-alive activity: it does not reset the staleness clock. The clock runs from the last genuine
progress event, so a PR that has been sitting failed/conflicted/awaiting-changes for longer than
`stale_after` counts as stalled and is diagnosed below.

If a provider cannot expose any reliable timestamp, do **not** auto-resume its in-progress
items unless the caller passed `stale_after=0`. (Dependency-cleared `blocked` repair still
proceeds — it is judged on blocker state, not time.)

## Repair decision tree

Apply per candidate. Continue through the ordered list until every candidate inside the
`max_candidates` cap has been evaluated. Each candidate may trigger a write (lifecycle transition,
native close/archive/complete, re-dispatch, or refreshed note), be recorded read-only, or be
recorded under Errors. Do not stop after the first write; the cap is the batch boundary.

### Build `claimed` (stalled in-progress) → diagnose blocker, else resume in place

After the staleness gate passes, **first diagnose why it stalled** by inspecting the item's PRs and
deploys (see "Stuck-cause diagnosis" below). A stalled build usually stalled for a concrete external
reason, and re-dispatching the agent at it will not fix a PR that cannot merge or a deploy that
failed — it just churns.

0. **Diagnose PR & deploy blockers.** If a real external blocker is found (PR cannot merge — merge
   conflict / rebase-required / failing checks / `CHANGES_REQUESTED` / unaddressed CodeRabbit; or a
   failed deploy), **do not dispatch the agent**. Instead file a build-ready leaf fix ticket for the
   blocker, move this item `claimed → blocked` with an `is blocked by` link to that ticket, and
   record it. The existing "Build `blocked` → unblock if cleared" path resumes this item on a later
   cycle once the fix ticket is terminal — a self-healing loop. Skip the resume steps below.

If no external blocker is found, the work simply died mid-flight — run the **same per-item sequence
the vendor build-intake runs**, skipping the claim transition (the item is already `claimed`):

1. Dispatch the item to the vendor agent — `lisa:jira-agent` / `lisa:github-agent` /
   `lisa:linear-agent` (matching the queue's tracker) — with the item ref. This resumes the work
   in place, preserving its existing branch/PR and prior comments.
2. **On agent success**, apply the scanner's post-agent transition yourself: `claimed → done`,
   where `done` is **env-resolved** exactly as `lisa:<tracker>-build-intake` resolves it (per
   `config-resolution` env-keyed `done`: explicit `target_env` arg wins; else reverse-lookup the
   env from the resulting PR's base branch via `deploy.branches`; if `done` is a map and env is
   unresolvable, fail loudly — never guess). repair-intake owns this transition because it is
   standing in for the scanner that never got to finish it.
3. **On a surfaced blocker** (agent reports it cannot proceed), leave/move the item to `blocked`
   with a `[lisa-repair-intake]` note (see Loop prevention).

> Do **not** reset stalled in-progress items to `ready`. Reset throws away state, makes a
> partially-built item look freshly human-approved to the next `lisa:intake` claim, and forces a
> two-cycle recovery. Resume in place.

#### Stuck-cause diagnosis: PR & deploy blockers

Run this for every stalled `claimed` build item **before** considering an agent re-dispatch. The
goal is to distinguish "work died mid-flight, just resume it" from "work is blocked on a concrete
external state that resuming the agent cannot fix."

**1. Find the associated PR(s) and deploy(s).** From the item's linked PRs (GitHub: remote/dev
links and `gh pr list --search <issue-ref>`; JIRA: dev-status / remote links; Linear: attachments
and git-branch links) and the deploy(s) for the resulting merge (the env-keyed `deploy.branches`
mapping from `config-resolution`). Read each PR with the vendor's native state, e.g. GitHub
`gh pr view <n> --json mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,comments,reviews`.

**2. Classify as a blocker.** Treat any of these as a real external blocker:

- **Merge conflict / rebase required** — `mergeable = CONFLICTING`, or `mergeStateStatus` in
  `DIRTY` / `BEHIND`.
- **Failing required checks** — `statusCheckRollup` has a `FAILURE`/`ERROR`/`TIMED_OUT` conclusion,
  or `mergeStateStatus = UNSTABLE`/`BLOCKED` due to checks.
- **Change requests outstanding** — `reviewDecision = CHANGES_REQUESTED`, or unresolved CodeRabbit
  (or other reviewer) comments that request changes and have not been addressed by a newer commit.
- **Branch-protection / approvals blocked** — `mergeStateStatus = BLOCKED` for a reason other than
  a transient check still running.
- **Failed deploy** — the deployment for the item's merge/branch reports a failed/errored status
  (failed deploy workflow run, failed deployment status, or the project's deploy check is red).

A check that is still **queued/in progress**, or a `CLEAN`/`HAS_HOOKS` mergeable PR with no
outstanding change request, is **not** a blocker — that is normal in-flight state. (Such a PR with
recent check/commit activity would already have been caught as `active` by the staleness gate.)

**3. On a blocker found → file a leaf fix ticket + block the item.**

1. **File one build-ready leaf fix ticket** per distinct blocker via `lisa:tracker-write` (the
   vendor-neutral leaf writer + validation gate; never a vendor `*-write-*` skill directly),
   `issue_type: Bug` for a failing-check/conflict/failed-deploy, `Task` for review-feedback
   follow-up, `build_ready: true` so it auto-builds. The ticket MUST name: the blocked item + its
   PR/deploy URL, the exact blocker (conflict / which checks failed with their logs link / which
   change requests / which deploy run), three-audience description, and Gherkin acceptance criteria
   for "PR is mergeable / deploy is green."
2. **Transition the stalled item `claimed → blocked`** and add an **`is blocked by`** link to the
   new fix ticket (vendor-native: JIRA issue link `is blocked by`; GitHub/Linear `Blocked by:` line
   + label). Post a `[lisa-repair-intake]` note naming what it is blocked by and why.
3. **Record it** as a repair write. Do **not** dispatch the vendor agent for this item this cycle.

The item now sits in `blocked`; once the fix ticket reaches a terminal state, the **Build
`blocked` → unblock if cleared** path (next section) detects the cleared `is blocked by`
dependency and resumes the original in place — a self-healing loop.

**Idempotency.** Before filing, check for an **open** fix ticket already carrying the marker
`[lisa-repair-intake] blocker:<item-ref>/<blocker-key>` (blocker-key is a stable slug of the
blocker, e.g. `pr-1234/merge-conflict` or `pr-1234/checks-failing`). If one exists, reference it
and ensure the `is blocked by` link is present rather than creating a duplicate. Honor the backoff
window and state fingerprint (Loop prevention) so re-runs over the same unchanged blocker are no-ops.

### Build `blocked` → re-evaluate, unblock if cleared

1. Read the block reason and dependencies (see Dependency clearing).
2. If every parsed blocker is **cleared** → move `blocked → claimed`, then run the same
   agent-dispatch + post-agent `claimed → done` sequence as the stalled-`claimed` path above
   (one-cycle recovery). If the agent re-blocks, move back to `blocked` — a valid outcome.
3. If the block was an **ambiguity** research can settle and no dependency remains → run the
   research needed (`lisa:codebase-research` / `lisa:product-walkthrough`); if resolved, proceed
   as in (2).
4. Else → still blocked. Refresh the note with the current reason (Loop prevention) and leave it
   `blocked`.

### Build terminal-open → native close / complete / resolve

For each build item that already carries the env-resolved true terminal `done` role but is still
native-open / active / unresolved:

1. Verify the item is a **leaf** or a **rollup parent whose all required children are terminal**.
   If it is a parent with incomplete children, do not close it; refresh a `[lisa-repair-intake]`
   note naming the incomplete child set.
2. Verify the terminal `done` role is the true final value per `leaf-only-lifecycle` and
   `config-resolution` env-keyed `done`. Intermediate env labels (for example `status:on-dev` or
   `status:on-stg`) are not terminal and must stay open.
3. Perform the provider-native terminal action idempotently:
   - GitHub: `gh issue close <number> --repo <org>/<repo> --reason completed`.
   - Linear: move the issue to the configured Done / Completed native workflow state if available;
     otherwise record the missing native state as a setup error.
   - JIRA: verify it is resolved / closed (`statusCategory = Done`, resolution set if required);
     if not, transition through the configured terminal workflow path or report the missing setup.
4. Post a compact `[lisa-repair-intake]` note only when the native close-out changed state or when
   an actionable setup error must be surfaced. Do not spam already-closed terminal items.

### Build rollup with all children terminal → close out parent/container

For each parent/container item (Epic, Story, Spike, Project, or any item with child work) whose
required child set is fully terminal:

1. Read the child set using the vendor-native hierarchy first (GitHub sub-issues, JIRA
   Epic/parent/sub-task hierarchy, Linear project/parent/sub-issues), with the same fallbacks the
   vendor read/sync skills document.
2. Evaluate bottom-up per `leaf-only-lifecycle`: every required child must already be terminal.
   Optional / won't-do / not-planned children are terminal-but-dropped and do not hold the parent
   open.
3. Apply the configured terminal rollup role to the parent/container, removing any stale build
   lifecycle role that conflicts.
4. Immediately perform terminal native closure where the provider supports it (GitHub close,
   Linear complete, JIRA resolved/closed). A completed rollup parent should not remain open in
   GitHub merely because no leaf agent touched it.
5. If any required child is incomplete, active, blocked, or inaccessible, leave the parent open and
   record it as `still_blocked` or `active` with the current child tally.

### PRD `in_review` (stalled in-progress) → re-run validate→route

After the staleness gate passes, run the **same dry-run validate→route pipeline the vendor PRD
intake runs per item**, targeted at this single PRD and **skipping the claim** (it is already
`in_review`):

1. Invoke `lisa:<source>-to-tracker` with `dry_run: true` and the PRD's URL (source = the queue's
   PRD vendor: `notion-to-tracker` / `confluence-to-tracker` / `linear-to-tracker` /
   `github-to-tracker`). This indirectly runs `lisa:tracker-source-artifacts`,
   `lisa:product-walkthrough`, and the `lisa:tracker-validate` gate, returning a structured
   PASS/FAIL report with `prd_anchor` snippets — the same report the PRD intake consumes.
2. **On PASS** → re-invoke `lisa:<source>-to-tracker` with `dry_run: false` to write the tickets
   (its full run already writes the PRD back-link via `lisa:prd-backlink`), run the
   `lisa:prd-ticket-coverage` audit as the PRD intake does, then transition the PRD to its
   `ticketed` role via the access layer.
3. **On FAIL** → post the clarifying-question comments grouped by `prd_anchor` (page-level for
   `prd_anchor: null`), tagged `[lisa-repair-intake]` (Loop prevention), and transition to
   `blocked`.

### PRD `blocked` → re-validate if new answers exist

1. Determine whether **new clarifying answers** exist: any comment/update on the PRD newer than
   the last `[lisa-repair-intake]` note or the original `blocked` note. For Linear include the
   sentinel feedback issue and anchored sub-issue comments; for Confluence include inline/footer
   comments where the access layer exposes them; for Notion include page comments and
   `last_edited_time`.
2. If new answers exist → run the `lisa:<source>-to-tracker` dry-run validate→route pipeline as
   in PRD `in_review` above (skipping claim). PASS → `ticketed`; FAIL → refresh note, stay
   `blocked`.
3. If no new answers and no dependency change → leave `blocked` untouched (subject to the
   backoff window — do not re-post an identical note).

### PRD terminal-open → close / archive source artifact

For each PRD source artifact that already carries the configured terminal source role (`shipped`
for generated-work completion, or a source-specific terminal role that the configured PRD source
declares closed-out) but is still native-open / active:

1. Verify the PRD's generated top-level work is terminal per `prd-lifecycle-rollup`, unless the
   source artifact is already in a stronger product-owned terminal role that explicitly permits
   closure. Do not move a PRD out of `draft` or `verified`.
2. Close or archive through the source vendor's native mechanism where one exists:
   - GitHub: close the PRD issue with `--reason completed`.
   - Linear: archive/close the PRD project through Linear MCP when supported by the workspace.
   - Confluence/Notion: archive the page only when the access layer exposes a supported archival
     action; otherwise record a capability-aware no-op.
3. Never set `verified`; `/lisa:verify-prd` remains the only automated writer of the verified
   role. This path only reconciles an already-terminal PRD with native closure.

### PRD rollup with all generated work terminal → ship and close out

For each PRD in `ticketed` or another non-product-owned open PRD role whose generated top-level
work is fully terminal:

1. Read the generated top-level child set exactly as `prd-ticket-coverage` / the vendor PRD intake
   does: native PRD children where supported, plus the durable generated-work section fallback.
2. Evaluate terminal state using `prd-lifecycle-rollup`'s vendor predicate. A generated Epic or
   Story is terminal only when it has itself rolled up and closed out; do not re-derive its leaf
   descendants directly when its own state is still open.
3. Transition the PRD to the configured `shipped` role.
4. Close/archive the PRD source artifact through the vendor-native close-out mechanism where
   supported. This repair path is the explicit close-out sweep for PRDs whose child work is done;
   it does not set `verified` and does not run `/lisa:verify-prd`.
5. If generated work is missing, ambiguous, or partially incomplete, leave the PRD open and report
   the incomplete child set. Never close a PRD on partial completion.

## Dependency clearing (conservative, vendor-specific extraction)

`lisa:tracker-read` is a thin dispatcher that returns each vendor's bundle **verbatim** — there
is no normalized `is blocked by` field. Read the bundle, then extract blockers per vendor:

- **GitHub**: parse the durable forms `lisa:github-build-intake` documents — `Blocked by: #123`,
  qualified cross-repo refs (`owner/repo#123`), issue URLs in the body/comments — plus timeline
  cross-reference events.
- **JIRA**: inspect the native issue-link records `lisa:jira-read-ticket` returns and select the
  `is blocked by` link type.
- **Linear**: inspect the native issue **relations** from Linear MCP `get_issue` and select
  blocker relations.

Then classify each blocker:

- **Closed / Done** (its true terminal role) → **cleared**.
- **Open** in any non-terminal role (`ready` / `claimed` / `review` / unknown) → **still
  blocking**.
- **Inaccessible** (deleted, cross-org, permission denied) → **still blocking**, unless the item
  body or a newer human comment explicitly states the dependency is resolved.

Only re-dispatch when **every** parsed blocker is cleared. When in doubt, stay blocked — a
false-negative (left blocked) is cheap; a false-positive (re-dispatched into a real blocker)
wastes a build cycle.

## Loop prevention

A `blocked` item with a permanently unresolved problem must not be "repaired" and re-noted every
cron tick.

- Every note this skill writes is prefixed `[lisa-repair-intake]` and carries a compact **state
  fingerprint**: the lifecycle role, the set of blocker refs + their observed states, the
  validation verdict (PASS/FAIL), terminal/open state, rollup child tally, and a timestamp.
- Before writing a note or re-attempting a `blocked` item, compute the current fingerprint. If
  an identical fingerprint was already posted within the **backoff window**, skip the item
  silently (record as `still_blocked` / `active`, no write).
- Backoff window default = `stale_after` (2h). `force=true` bypasses backoff for a manual run.
- A *changed* fingerprint (new blocker state, new answers, new verdict) always warrants a fresh
  note + re-attempt — backoff suppresses only no-op repeats.

## Lifecycle ownership guard

repair-intake owns the repair surfaces needed to recover stuck work and close-out drift:
build `claimed` / `blocked`, PRD `in_review` / `blocked`, terminal-labeled native-open items, and
parent/container rollups whose child sets are already terminal. It MAY:

- Apply the build scanner's post-agent `claimed → done` on a successful resume (it is finishing
  the scanner's interrupted job), and move a dependency-cleared build item `blocked → claimed`.
- Move a re-validated PRD `in_review`/`blocked → ticketed` (PASS) or `→ blocked` (FAIL), exactly
  as the PRD intake does.
- Close / complete / resolve build items that already carry the true terminal `done` role but are
  still natively open, per `leaf-only-lifecycle`.
- Roll up a parent/container to the configured terminal state and close/complete/resolve it when
  all required children are terminal.
- Move a PRD with fully terminal generated work to `shipped` and close/archive the source artifact
  where the source vendor supports native close-out, per `prd-lifecycle-rollup`.

It MUST NOT:

- Move a PRD out of `draft` or `verified` (those are product-owned), or set `verified` itself.
- Apply a build `done` value other than via the env-resolution rules, or close a native item at
  any value other than the true terminal `done` (see `leaf-only-lifecycle`).
- Touch `ready` items (that is `lisa:intake`'s lane).

## Cycle behavior

1. **Resolve the queue** — detect vendor/lifecycle (Source dispatch); resolve stuck role names
   from config. For JIRA, confirm the needed transitions are reachable; stop on misconfig.
2. **Enumerate repair candidates** — query in-progress role(s), `blocked` role(s), terminal/open
   items, and rollup parents/PRDs with child work for the detected lifecycle(s), up to
   `max_candidates`, via the Access layer reads.
3. **Order deterministically**, highest repair-confidence first:
   1. terminal-labeled items that only need native close / complete / resolve,
   2. rollup parents/PRDs whose child sets are all terminal,
   3. `blocked` items whose dependencies are now **cleared** (safe, high-value, one-cycle wins),
   4. `blocked` items with **new clarifying answers**,
   5. **stalled** in-progress items, oldest activity first.
4. **Walk the ordered list**, evaluating each candidate (terminal close-out, rollup child tally,
   staleness, dependency, answer checks), and repair **every** candidate that is actionable inside
   the `max_candidates` cap. Continue after successful writes and after per-item errors.
5. **Empty / nothing actionable** → exit cleanly:
   `"No stuck items actionable this cycle (examined N, all active or in backoff)."`
6. **Failure isolation** — if evaluating one candidate errors, record it under Errors and
   continue to the next; one bad item never aborts the cycle.

Process **all materially actionable repairs among the enumerated candidates** — scan up to
`max_candidates`, repair the actionable subset, then exit. This intentionally differs from
`lisa:intake`'s one-ready-item claim contract because repair work is bounded by an explicit cap and
often consists of cheap close-out reconciliation that should drain in one cron pass.

## Summary report

Report outcomes in these buckets:

- `resumed` — stalled in-progress work re-dispatched in place.
- `unblocked` — blocker cleared (or answers resolved); re-dispatched or transitioned to
  `ticketed`.
- `closed_out` — terminal-labeled items whose native open/active state was closed, completed,
  resolved, or archived.
- `rolled_up` — parent/container/PRD rollups advanced because all associated children were
  terminal.
- `still_blocked` — examined and intentionally left `blocked`, with the active reason.
- `active` — skipped because current work is not stale (or within backoff).
- `errors` — items that failed evaluation, with the error.

State every item repaired this cycle and the action taken. If the output would be long, group by
bucket and show compact refs plus counts.

## Schedule examples

```text
/schedule "every 2 hours" /lisa:repair-intake https://www.notion.so/<workspace>/<database-id>
/schedule "every 2 hours" /lisa:repair-intake https://linear.app/acme
/schedule "every 2 hours" /lisa:repair-intake acme/product-prds
/schedule "every 2 hours" /lisa:repair-intake acme/frontend-v2 intake_mode=build
/schedule "every 2 hours" /lisa:repair-intake github intake_mode=both
/schedule "every 4 hours" /lisa:repair-intake SE stale_after=12h
/lisa:repair-intake SE stale_after=0 force=true        # manual: treat all in-progress as stalled, ignore backoff
```

Run repair-intake **less frequently than** `lisa:intake` (the ready queue moves faster than
stuck work accumulates), or interleaved on a longer cadence.

## Rules

- Never run a cycle without an explicit queue. Side effects too high to default.
- Never reset stalled in-progress items to `ready` — resume in place (decision tree).
- Never mutate product-owned states (`draft`, `verified`) or set `verified`; PRD rollup close-out
  may move open generated-work PRDs to `shipped` and close/archive them only after all associated
  child work is terminal.
- Apply build `done` ONLY via the env-resolution rules, and trigger native closure only at the
  true terminal `done` value (`leaf-only-lifecycle`).
- Never re-dispatch a `blocked` build item unless every parsed blocker is cleared (conservative
  dependency clearing).
- Repair every materially actionable candidate inside the `max_candidates` cap; default cap is 100.
- Default GitHub `intake_mode` is `both` when both PRD and build namespaces exist.
- Honor the backoff window — never re-post an identical `[lisa-repair-intake]` note within it
  (unless `force=true`).
- Never run two repair cycles concurrently against overlapping queues, and never run
  repair-intake against a queue `lisa:intake` is concurrently draining — the scheduling layer is
  responsible for serialization.
- Stop and surface failures rather than retry-loop.
