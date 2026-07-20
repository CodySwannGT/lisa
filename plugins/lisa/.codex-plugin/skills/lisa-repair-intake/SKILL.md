---
name: lisa-repair-intake
description: "Vendor-agnostic repair scanner…"
allowed-tools: ["Skill", "Bash", "Read", "Write", "Edit"]
---

# Repair Intake: $ARGUMENTS

Run one batch-**repair** cycle against the queue identified by `$ARGUMENTS`, or by merged GitHub
config when the queue is omitted and a GitHub source/tracker default is resolvable. Where `lisa-intake`
scans the `ready` role and moves work *forward*, repair-intake scans the **stuck and
close-out** roles and moves work *unstuck* or *fully closed*:

- **Stalled in-progress** — an item left in an in-progress role (build `claimed`, PRD
  `in_review`) whose processing cycle died. It is technically "being worked" but nothing is
  happening, so it sits ignored forever. (The vendor PRD intakes explicitly leave an errored PRD
  in `in_review` "for the human to investigate from there" — that orphan is exactly what this
  skill recovers.) For a stalled **build**, repair-intake first diagnoses *why* it stalled by
  inspecting its PRs and deploys. A PR that **already merged** is recovered by applying the env
  transition build-intake never got to (its merge gate left the item `claimed` when the merge landed
  after its agent returned) — no re-dispatch. A PR that is merely **behind its base** (`BEHIND`, no
  conflict) is **re-synced in place** with `gh pr update-branch` so the already-enabled auto-merge can
  finally land — a clean rebase needs no human, and leaving it stranded is the exact gap that lets an
  auto-merge PR sit unmerged forever. A **true merge conflict** is first given **one bounded in-place
  re-dispatch** to the build agent — whose `drive-pr-to-merge` fix-mode loop resolves conflicts — because
  a conflict, unlike a failing external check, is fixable by re-running the build; only a conflict that
  survives that single attempt (or that the agent says needs design input) becomes a fix ticket. The
  genuinely non-resolvable blockers — failing checks / unaddressed CodeRabbit or `CHANGES_REQUESTED`
  review / a failed deploy — get a build-ready leaf fix ticket with the item moved to `blocked` (blocked
  by that ticket) instead of blindly re-dispatching the agent, which would just churn against them.
- **Recoverable blocked** — an item in `blocked` whose blocker may now be gone. The blocker is
  one of three classes, and repair re-checks **all** of them, not just dependencies: (a) an
  `is blocked by` **dependency** has since closed; (b) a **validation / quality-gate self-block** —
  the item was bounced to `blocked` by its own pre-flight `verify`/`validate` gate (missing
  Validation Journey, Sign-in Required, Acceptance Criteria, etc.) with **no dependency at all**,
  and a human has since edited the item to add what the gate demanded; or (c) **clarifying
  questions answered** / an **ambiguity** research can now settle. A self-block (b) is the common
  one missed by dependency-only re-checks: nothing else is blocking it, so re-running the same gate
  against its current content is the only way to know it is now passable.
- **Terminal-open drift** — an item already carrying its true terminal lifecycle role (for
  example GitHub `status:done`) but still open/active in the provider's native state. The inverse
  also drifts on Linear: a leaf whose native `state` was auto-completed by a magic-word / branch-linkage
  merge into a **non-terminal** env (Linear completes on merge to any branch, unlike GitHub's
  default-branch-scoped close) while its derived `status:*` label is still intermediate — reconcile
  it back to active via `lisa-linear-sync` Phase 4b per `leaf-only-lifecycle`.
- **Rollup drift** — a parent/container item (Epic, Story, PRD, Linear Project, or equivalent)
  whose own lifecycle state does not match the roll-up of its children's states per
  `leaf-only-lifecycle`. This covers the *completed* case (all children terminal → close the parent
  out) **and** the *intermediate-env* case (all children shipped to an env like `On Stg`, but the
  parent never advanced — including a parent left stranded in a status it should never carry).
- **Stale-`ready` container** — a parent/container (open child work, or a childless
  **Epic**) wrongly carrying the build-ready role. This is a leaf-only-invariant violation
  the build-intake claim gate deliberately leaves for a human; repair-intake reconciles it by
  rolling the parent up from its children (with an audit note), so a container never sits in `ready`
  indefinitely.
- **Missing official ready-label drift** — a GitHub issue that is missing every configured Lisa
  lifecycle label. repair-intake classifies it as a PRD or build ticket and adds the configured
  `ready` label (`prd-ready` for a PRD, build `status:ready` for a ticket) so normal intake can see
  it; if the later intake/implement gate finds the item incomplete, it moves the item to `blocked`.
- **Missing native child link drift** — a GitHub parent (a `ticketed`/other open non-product-owned
  PRD, **or a build Epic/Story container**) whose children are discoverable — from the generated-work
  section/comment for a PRD, or from body parentage (`Parent: #<n>` / `Parent Epic: #<n>`) for a build
  container resolved via the documented hierarchy fallback — but whose native sub-issue list is missing
  one or more of those children. This is the common shape when children were created by an external
  generator (e.g. Codex) or an older write path that recorded parentage only in prose and never called
  `addSubIssue`. repair-intake replays the `prd-backlink` / `github-write-issue` native-linking contract
  and attaches the missing same-repo children idempotently, so rollup and the GitHub UI can rely on the
  native graph again.

This skill is the symmetric counterpart to `lisa-intake`. It reuses the same queue-detection,
the same agent-team orchestration, the same "don't ask, just run" confirmation policy, and the
same per-item surfaces the vendor intakes use (`lisa:<source>-to-tracker` dry-run for PRDs;
`lisa:<tracker>-agent` + the scanner's lifecycle transitions for build) — it differs in *which
roles it scans* and, for stalled/blocked work, *that it skips the claim step* (the item is already
claimed/blocked). Close-out candidates do not dispatch agents; they only reconcile terminal
lifecycle state with provider-native closure and rollup state.

## Public contract

```text
/lisa:repair-intake [<queue>] [intake_mode=prd|build|both] [build_queue=owner/repo] [stale_after=2h] [max_candidates=100] [force=true]
```

| Token | Meaning | Default |
|-------|---------|---------|
| `<queue>` | Same queue identifier `lisa-intake` accepts (see Source dispatch). Optional only when merged config resolves a GitHub source/tracker and identity; otherwise required. | merged GitHub default when resolvable |
| `intake_mode` | `prd` \| `build` \| `both`. Only meaningful for a GitHub `org/repo` (or bare `github`) that hosts both PRD and build label namespaces. `both` is unique to repair — a repair sweep usefully covers both lifecycles in one schedule. Absent → `both` when both namespaces exist, else whichever lifecycle exists. | `both` for dual GitHub queues; otherwise infer |
| `build_queue` | GitHub build scan target used with literal `github`, especially `intake_mode=both`. Explicit `owner/repo` or URL for a build-only invocation wins over this token; otherwise this wins over `github.queueRepo`. It never redirects the PRD scan. | `github.queueRepo`, then `github.org/github.repo` |
| `stale_after` | How long since the last state-changing transition into the in-progress role, or since the last human / PR-side forward-progress activity, before an in-progress item counts as stalled. Automation self-comments do not reset this clock. Accepts `24h`, `90m`, `2d`, or `0` (treat any in-progress item as stalled — manual recovery, also the only way to resume work on a provider that exposes no reliable timestamp). Overrides config. | `2h` |
| `max_candidates` | Cap on how many stuck/close-out candidates to enumerate and evaluate. Repair every materially actionable candidate within this bounded set, then stop. Overrides config. | `100` |
| `force` | `true` bypasses the loop-prevention backoff window (so a manual re-run re-attempts items even if their fingerprint is unchanged). It does **not** change the staleness rule — use `stale_after=0` for that. | `false` |

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked, resolve the explicit or config-backed
queue and run the cycle to completion. The caller (a human at the CLI or a scheduled cron) has
already authorized the run by invoking the skill; re-prompting defeats the purpose of a
background repair sweep.

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

- Missing required input (no queue argument **and** no resolvable GitHub default, or missing
  project configuration). Surface the missing value and exit.
- The queue itself is misconfigured (Status property missing expected values, JIRA workflow
  can't reach required transitions). Surface and exit.
- No stuck/close-out candidates, or none actionable this cycle. Exit cleanly with the idle-case
  summary.

## Orchestration: thin dispatcher (no team of its own)

Repair-intake follows the same orchestration contract as `lisa-intake`: it creates NO agent team and spawns NO named teammates. It is a bounded scanner/dispatcher — resolve the queue, evaluate staleness, pick the actionable candidates, and run each repair in the current session.

The reasoning is the same as Intake's: a repair that resumes stalled build work may culminate in a team-first lifecycle skill (`lisa-implement`, `lisa-plan`), and those skills can only create their agent team from the lead session — a spawned teammate cannot add named teammates (Claude teams are flat), so pushing the repair into a subagent strands the lifecycle skill without its team and collapses it into a single inline worker. Therefore:

- **Scanning, staleness evaluation, and per-item repairs run inline in this session** (Bash / MCP / vendor skills via the Skill tool — `lisa-<source>-to-tracker` for a PRD, the `<tracker>-agent` workflow's gate skills for a build item).
- **Any repair that dispatches a lifecycle flow does so via the Skill tool in this same session — never an `Agent` spawn** — so the lifecycle skill's team-first preamble fires exactly as a direct invocation would.
- The only permissible `Agent` use is a bounded **anonymous** helper (`Agent` with `name` omitted) for scan-side legwork whose result returns directly to this session.

Codex: the same contract applies — run the scan inline in the root session and invoke any lifecycle skill there so it can `multi_agent_v1.spawn_agent` its own team; do not `spawn_agent` the lifecycle flow itself. Other runtimes: apply the same rule through their equivalent delegation surface; if the runtime has no team/subagent tooling at all, the lifecycle skill's own no-team fallback handles it.

If a teammate inside an existing team somehow invokes this skill (it is a session entry point, not a nested flow), do not scan or repair from there: return a structured `delegation-request` to the team lead asking it to run the repair cycle in the lead session, and surface the misrouting.

## Source dispatch

Detect the queue type from `$ARGUMENTS` using the **exact same detection and disambiguation
rules as `lisa-intake`** — read that skill's "Source dispatch" section for the authoritative
table; the detection is identical and only the per-item action changes (repair instead of
claim-and-advance). The essentials, inlined here so this skill is self-complete:

| If `$ARGUMENTS` is... | Queue / lifecycle | Source/tracker key | Candidates repaired |
|------------------------|-------------------|--------------------|----------------------|
| Notion **database** URL/ID | PRD (Notion) | source=notion | `in_review`, `blocked`, terminal/open PRDs, all-terminal generated-work rollups |
| Confluence **space** URL/key | PRD (Confluence) | source=confluence | `in_review`, `blocked`, terminal/open PRDs, all-terminal generated-work rollups |
| Confluence **parent page** URL/ID | PRD (Confluence, narrowed) | source=confluence | `in_review`, `blocked`, terminal/open PRDs, all-terminal generated-work rollups |
| Linear **workspace** URL, **team** URL/key, or literal `linear` | PRD (Linear) | source=linear | `in_review`, `blocked`, terminal/open PRDs, all-terminal generated-work rollups |
| GitHub **repo** URL / `org/repo` (PRD namespace) | PRD (GitHub) | source=github | `in_review`, `blocked`, terminal/open PRDs, missing PRD child links, all-terminal generated-work rollups |
| GitHub **repo** URL / `org/repo` with `tracker = github` (build namespace) | Build (GitHub) | tracker=github | `claimed`, `blocked`, terminal/open issues, parent rollups (intermediate-env + all-terminal), stale-`ready` containers |
| GitHub **repo** URL / `org/repo` with an open issue missing configured lifecycle labels | GitHub label normalization | per classified lifecycle | add configured `prd.ready` or build `ready` |
| Literal `github` or omitted GitHub repo when merged config resolves a GitHub source/tracker and identity | GitHub; PRD scans identity, build scans `build_queue` → merged `github.queueRepo` → identity; `both` runs those two lane-specific targets | per lifecycle | per lifecycle above, plus GitHub ready-label normalization |
| JIRA project key or full JQL | Build (JIRA) | tracker=jira | `claimed`, `blocked`, terminal/closure verification, parent rollups (intermediate-env + all-terminal), stale-`ready` containers |

Disambiguation (same as `lisa-intake`): a `notion.so`/`notion.site` URL → Notion; an Atlassian
`/wiki/spaces/<KEY>` URL → Confluence (with `/pages/<id>` → parent-page narrowing); a
`linear.app` workspace/team URL or literal `linear` → Linear; a `github.com` URL / `<org>/<repo>`
token / literal `github` → GitHub; a bare token matching the JIRA project-key regex → JIRA
(else try Confluence space, then Linear team); a string with JQL operators → JQL. **A single-item
URL is out of scope** — this skill is batch-only; repair one item by hand via `lisa-implement`
(build) or by re-running `lisa:<source>-to-tracker` (PRD).

For GitHub `intake_mode=build` (a build-only invocation), an explicit URL or `owner/repo` wins;
otherwise resolve `build_queue`, then local/global `github.queueRepo`, falling back to
`github.org/github.repo`. For `intake_mode=both`, the primary `<queue>` is the PRD identity/source
repo and `build_queue` controls the build lane, falling back through `github.queueRepo` to identity.
A short queueRepo is normalized to `github.org`. Thus `both` is a bounded split scan: PRD candidates
at the primary identity queue, build candidates at the resolved build queue, combined into one
summary. Never apply both lifecycle namespaces to the umbrella repo merely because
`github.queueRepo` is set. Repository identity remains distinct and continues to drive
`repo:<current>` filtering, writes, and automation names. If neither an explicit queue nor a
resolvable merged GitHub default exists, stop with the missing-input error.

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

In addition to the lifecycle roles above, the build lifecycle defines the **`human_needed` marker** — an additive label (`jira.labels.human_needed` / `github.labels.build.human_needed` / `linear.labels.build.human_needed`, default `Human Needed` / `human-needed`) that rides alongside `blocked` when the block needs human-only input no agent or retry can supply (see `config-resolution` "Build markers"). repair-intake's interaction with the marker is asymmetric and is the whole point of the distinction below:

- The blocks repair-intake **itself writes** are the auto-recoverable kind — it files a build-ready fix ticket and moves the item `blocked` *blocked by that ticket*, expecting the next cycle to self-heal. Those are **not** `human_needed`; if such an item arrives already carrying a stale `human_needed` marker, repair-intake **clears** it (the block is no longer waiting on a human).
- The blocks the **vendor agent** writes when repair-intake re-dispatches it (its pre-flight gate) carry `human_needed` already — the agent owns that marker. repair-intake leaves it in place.

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
intakes use. Never call Atlassian MCP or `acli` directly — go through `lisa-atlassian-access`.

| Vendor | Reads (scan / comments / links) | Writes (transition / comment / close-out) | Re-dispatch / re-validate |
|--------|---------------------------------|-------------------------------|---------------------------|
| JIRA (build) | `lisa-atlassian-access` `search-issues` / `lisa-jira-read-ticket` | `lisa-atlassian-access` `transition` / `comment` | `lisa-jira-agent` |
| GitHub (build) | `gh issue list` / `gh issue view --json` / `gh pr list` / GraphQL sub-issues | `gh issue edit` (labels) / `gh issue comment` / `gh issue close --reason completed` | `lisa-github-agent` |
| Linear (build) | Linear MCP `list_issues` / `get_issue` / `list_comments` | Linear MCP `save_issue` (labels) / `save_comment` | `lisa-linear-agent` |
| Notion (PRD) | `lisa-notion-access` (`query`, page comments) | `lisa-notion-access` `write-page` (status) / page comment | `lisa-notion-to-tracker` (dry-run) |
| GitHub (PRD) | `gh issue list/view` (PRD labels) / GraphQL sub-issues / generated-work section | `gh issue edit` / `gh issue comment` / `gh issue close --reason completed` | `lisa-github-to-tracker` (dry-run) |
| Linear (PRD) | Linear MCP `list_projects` / `get_project` (+ sentinel feedback issue) | Linear MCP `save_project` (labels) / `save_comment` | `lisa-linear-to-tracker` (dry-run) |
| Confluence (PRD) | `lisa-atlassian-access` CQL | `lisa-atlassian-access` page `parentId` update / comment | `lisa-confluence-to-tracker` (dry-run) |

## Staleness model

An in-progress item (build `claimed`, PRD `in_review`) is **stalled** when the last
state-changing transition into the in-progress role, or the last human / PR-side forward-progress
activity after that transition, is older than the `stale_after` threshold. `blocked` items are NOT
gated on staleness — their repairability is judged on current blocker/answer state, not elapsed
time.

Automation self-comments are not forward progress and must not reset the staleness clock. Status
comments like `[claude-build-intake] PR remains open...`, `[codex-build-intake] Follow-up pushed...`,
or `[lisa-repair-intake] ...` may be useful audit notes, but they cannot make a claimed item fresh
forever. If a provider exposes a changelog/history surface, prefer the timestamp of the last
transition into the claimed/In-Progress role over the item's generic `updated` timestamp. When the
history surface is unavailable, ignore comments whose author/marker clearly belongs to Lisa or its
automation agents, and use the newest human comment/edit or PR-side progress event instead.

A build `claimed` leaf whose linked PR has **already merged** (`state == MERGED`) is likewise NOT
gated on staleness. A merged PR is a settled terminal state, not in-flight work: the only thing
missing is the env transition build-intake never applied (its merge gate left the item `claimed`
because the merge landed after its agent returned). The recovery is judged on PR merge state, not
elapsed time — and crucially **post-merge activity does not defer it**. A freshly-merged PR keeps
producing activity that the signal below would otherwise read as keep-alive (a queued/in-progress
release or deploy check-run, a post-merge CodeRabbit summary comment), so gating merged-PR recovery
on staleness strands a *completed* leaf in `claimed` for as long as that activity keeps the clock
warm — exactly the failure that leaves a shipped Sub-task showing `status:in-progress` for a day
while its parents roll up against it. Recover it regardless of recent activity (Build `claimed`
decision tree step 0, and the dedicated high-confidence ordering bucket).

### Threshold resolution

1. `$ARGUMENTS` `stale_after=<dur>` (one-off override) — always wins. Parse `Nh` / `Nm` / `Nd` /
   `0` into hours.
2. `.lisa.config.json` `intake.repair.staleAfterHours` (durable project default).
3. Built-in default: **2 hours**.

`stale_after=0` means "treat any in-progress item as stalled" — a manual full-recovery lever,
and the only way to resume work on a provider that exposes no reliable activity timestamp.

### Activity signal (state-change first, portable across vendors)

Compute the item's newest eligible activity timestamp from the highest-priority signal the vendor
exposes, and compare it to `now - stale_after`:

1. Provider-native status/label **transition** time into the in-progress role, when the provider
   exposes it cleanly (JIRA changelog transition to `claimed` / In Progress, GitHub label event,
   Linear state/label history, Notion/Confluence page move/status history).
2. Latest human lifecycle/progress **comment** or edit on the item (and, for Linear PRDs, the
   sentinel feedback issue). Exclude automation self-comments and Lisa audit markers such as
   `[claude-build-intake]`, `[codex-build-intake]`, `[lisa-build-intake]`, and
   `[lisa-repair-intake]`.
3. For build items, latest **PR-side forward-progress activity** on the linked PR: newest commit,
   review, check-run,
   or PR comment.
4. Provider-native item `updatedAt` / `last_edited_time` / `updated` only when the provider cannot
   expose transition/comment authorship and the timestamp is not known to be driven by automation
   self-comments.

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

A **merged** linked PR is the same kind of non-keep-alive signal, in the other direction: the work
is settled and complete, so its post-merge check-runs and summary comments must NOT count as
keep-alive either. A build `claimed` leaf with a merged PR is recovered regardless of the staleness
clock (see the Staleness model note above and the dedicated ordering bucket); it is never recorded
`active` and skipped on the strength of post-merge activity.

If a provider cannot expose any reliable timestamp, do **not** auto-resume its in-progress
items unless the caller passed `stale_after=0`. (Dependency-cleared `blocked` repair still
proceeds — it is judged on blocker state, not time.)

## Repair decision tree

Apply per candidate. Continue through the ordered list until every candidate inside the
`max_candidates` cap has been evaluated. Each candidate may trigger a write (lifecycle transition,
native close/archive/complete, re-dispatch, or refreshed note), be recorded read-only, or be
recorded under Errors. Do not stop after the first write; the cap is the batch boundary.

### Build `claimed` (stalled in-progress) → diagnose blocker, else resume in place

**First check for an already-merged PR — this check is NOT gated on staleness.** Read the item's
linked PR state before applying the staleness gate (see "Stuck-cause diagnosis" step 1–2 for
discovery). If `state == MERGED`, recover it immediately via step 0's merged-PR arm regardless of
elapsed time or recent post-merge activity (per the Staleness model's merged-PR exemption): a merged
PR is a completed leaf, and deferring it behind the staleness clock is what strands shipped work in
`claimed`.

Only if the PR is **not** merged does the staleness gate apply. Once it passes, **diagnose why it
stalled** by inspecting the item's PRs and deploys (see "Stuck-cause diagnosis" below). A stalled
build usually stalled for a concrete external reason, and re-dispatching the agent at it will not fix
a PR that cannot merge or a deploy that failed — it just churns.

0. **Diagnose PR & deploy state.** Run "Stuck-cause diagnosis" below. It resolves, in order:
   - **PR already merged** (checked first, staleness-exempt) → the build effectively completed; the
     vendor build-intake's merge gate left the item `claimed` because the merge landed after its agent
     returned. Do **not** re-dispatch or file anything — apply the scanner's post-agent env-resolved
     `claimed → done` transition directly (step 2 below, env-resolved), and record it. This is the
     recovery arm for build-intake leaving merged-but-unadvanced items in `claimed`.
   - **PR only behind its base (a needed rebase)** → mechanically resolvable, **not** a human blocker.
     Re-sync the branch in place so the already-enabled auto-merge can land (see diagnosis step 3).
     Keep the item `claimed`; a later cycle confirms the merge and transitions. Do **not** file a fix
     ticket for a clean rebase.
   - **A true merge conflict** → **not** an immediate fix ticket. A conflict is fixable by re-running
     the build, so attempt **one** in-place re-dispatch first (the resume sequence below; the vendor
     agent re-enters `drive-pr-to-merge` fix mode, which resolves conflicts). Only a conflict that
     survives that single attempt — the same conflicting head still `CONFLICTING` on a later cycle — or
     that the agent reports needs design input, falls through to the fix-ticket path (diagnosis step 5).
   - **A real external blocker re-running the build cannot fix** (failing checks / `CHANGES_REQUESTED` /
     unaddressed CodeRabbit; or a failed deploy) → **do not dispatch the agent**. File a build-ready leaf
     fix ticket for the blocker, move this item `claimed → blocked` with an `is blocked by` link to that
     ticket, and record it. The existing "Build `blocked` → unblock if cleared" path resumes this item on
     a later cycle once the fix ticket is terminal — a self-healing loop. Skip the resume steps below.

If the PR is healthy in-flight and no blocker is found, the work simply died mid-flight — run the **same per-item sequence
the vendor build-intake runs**, skipping the claim transition (the item is already `claimed`):

1. Dispatch the item to the vendor agent — `lisa-jira-agent` / `lisa-github-agent` /
   `lisa-linear-agent` (matching the queue's tracker) — with the item ref. If repair-intake is
   running as a teammate rather than the lead/root agent, return a structured `delegation-request`
   to the lead instead of spawning that named peer yourself; only the lead can add named teammates
   in Claude's flat roster. This resumes the work in place, preserving its existing branch/PR and
   prior comments.
2. **On agent success**, apply the scanner's post-agent transition yourself: `claimed → done`,
   where `done` is **env-resolved** exactly as `lisa:<tracker>-build-intake` resolves it (per
   `config-resolution` env-keyed `done`: explicit `target_env` arg wins; else reverse-lookup the
   env from the resulting PR's base branch via `deploy.branches`; if `done` is a map and env is
   unresolvable, fail loudly — never guess). repair-intake owns this transition because it is
   standing in for the scanner that never got to finish it.
3. **On a surfaced blocker** (agent reports it cannot proceed), leave/move the item to `blocked`
   with a `[lisa-repair-intake]` note (see Loop prevention). When the surfaced blocker is something
   **only a human can supply** (credentials, access/permissions, a product or scoping decision), the
   item also carries the `human_needed` marker — the vendor agent's pre-flight gate applies it; if
   repair-intake makes the block transition itself for such a reason, it adds the marker too. (A
   block that another tracked ticket or retry will clear is *not* human-needed — that is the
   auto-recoverable fix-ticket path above.)

> Do **not** reset stalled in-progress items to `ready`. Reset throws away state, makes a
> partially-built item look freshly human-approved to the next `lisa-intake` claim, and forces a
> two-cycle recovery. Resume in place.

#### Stuck-cause diagnosis: PR & deploy blockers

Run this for every stalled `claimed` build item **before** considering an agent re-dispatch. The
goal is to distinguish "work died mid-flight, just resume it" from "work is blocked on a concrete
external state that resuming the agent cannot fix."

**1. Find the associated PR(s) and deploy(s).** From the item's linked PRs (GitHub: prefer the
native dev-link surface — `gh issue view <n> --json closedByPullRequestsReferences` — which lists
merged PRs that closed the issue, then `gh pr list --search <issue-ref> --state all`; JIRA:
dev-status / remote links; Linear: attachments and git-branch links) and the deploy(s) for the
resulting merge (the env-keyed `deploy.branches` mapping from `config-resolution`). The `--state all`
is load-bearing: `gh pr list --search` defaults to `--state open`, so a **merged** (closed) PR is
invisible on that surface — the exact state this recovery path exists to catch. A merged PR linked
only via search (no `Closes #` / native dev link) would otherwise never be discovered, and the leaf
would never recover. Read each PR with the vendor's native state, e.g. GitHub
`gh pr view <n> --json state,mergedAt,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,comments,reviews`.

**2. PR already merged → recover, don't re-dispatch.** If `state == MERGED`, the build is effectively
complete and the only thing missing is the env transition the build-intake never applied (its merge
gate left the item `claimed` because the merge landed after its agent returned). Do **not** re-dispatch
or file anything: apply the scanner's post-agent env-resolved `claimed → done` transition (the
resume-sequence step 2, env-resolved from the merged PR's base branch) and record it as a repair
write. Where the env deploy is observable, confirm it did not fail first; a failed post-merge deploy
falls through to the blocker path (step 4).

**3. PR only behind its base → re-sync in place (mechanical, not a blocker).** If the PR is clean but
behind its base — `mergeStateStatus == BEHIND` while `mergeable != CONFLICTING` and no required check
is failing — it does **not** need a human. This is exactly the case that strands a PR forever: GitHub
auto-merge will not advance a `BEHIND` branch on its own, so a PR opened with `--auto` sits unmerged
until something rebases it. Delegate this mechanical nudge + classification to the
`drive-pr-to-merge` skill in **report** mode — the single source of truth for the
"ensure auto-merge + re-sync a clean `BEHIND` branch" primitive — so this scanner does not
re-implement it:

```text
drive-pr-to-merge  pr=<n>  on_blocker=report
```

In report mode it ensures auto-merge is enabled and runs `gh pr update-branch <n>` only when the
PR is `BEHIND`-but-clean **and** the base branch's ruleset or classic branch protection requires
strict up-to-date status checks (`strict_required_status_checks_policy` / `required_status_checks.strict`).
If strict checks are off, it does not update the branch solely because the base moved; that avoids
CI cancellation storms in repos where updating the PR head restarts and cancels in-flight runs. It
never edits code, resolves threads, or dismisses reviews. It returns a classification (`merged` /
`will-merge-after-resync` / `blocked:<reason>`). On a `merged` / `will-merge-after-resync` result,
record this as a repair write (`resynced`), keep the item `claimed`, and move on — a later cycle sees
the now-`CLEAN` (or merged) PR and either lets auto-merge finish or applies the merged-PR recovery in
step 2. Only if `gh pr update-branch` itself reports a conflict it cannot apply does the PR become a
true conflict (step 4). Honor the backoff window so repeated cycles don't re-issue `update-branch` on
an unchanged head (Loop prevention). For JIRA/Linear items the PR is still the GitHub PR backing the
branch — operate on it the same way.

**4. Classify as a blocker.** Treat any of these as a real external blocker:

- **True merge conflict** — `mergeable = CONFLICTING` or `mergeStateStatus = DIRTY` (overlapping
  changes a plain rebase cannot resolve), or `gh pr update-branch` (step 3) reported a conflict. A
  merely `BEHIND` branch is **not** here — it was re-synced in step 3. Unlike the other classes below, a
  conflict is **resolvable by re-running the build**, so step 5 gives it one in-place re-dispatch before
  filing — see its conflict-first rule.
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

**5. On a blocker found → file a leaf fix ticket + block the item.**

**Conflict-first exception (try to resolve before filing).** A *true merge conflict* — and only a
conflict, not failing checks, change requests, or a failed deploy — is fixable by re-running the build:
the vendor agent's `drive-pr-to-merge` fix-mode loop resolves conflicts. So before filing a fix ticket
for a conflict, give the item **one** in-place re-dispatch: run the resume-in-place sequence (steps 1–3
of the parent path above), which re-enters `drive-pr-to-merge` in fix mode against the existing PR.
Bound it to a single attempt per conflicting head — when you re-dispatch, post a `[lisa-repair-intake]
conflict-resolve-attempt: <item-ref>@<head-sha>` marker keyed on the PR head SHA. On a later cycle, if
that marker already exists for the **same** head SHA and the PR is still `CONFLICTING`, the attempt
failed: stop retrying and file the fix ticket below. File immediately (skip the attempt) if the agent
reports the conflict needs design input. Every other blocker class files the fix ticket with no
re-dispatch. Honor the backoff window / state fingerprint (Loop prevention) so the re-dispatch is never
re-issued against an unchanged conflicting head.

1. **File one build-ready leaf fix ticket** per distinct blocker via `lisa-tracker-write` (the
   vendor-neutral leaf writer + validation gate; never a vendor `*-write-*` skill directly),
   `issue_type: Bug` for a failing-check/conflict/failed-deploy, `Task` for review-feedback
   follow-up, `build_ready: true` so it auto-builds. The ticket MUST name: the blocked item + its
   PR/deploy URL, the exact blocker (conflict / which checks failed with their logs link / which
   change requests / which deploy run), three-audience description, and Gherkin acceptance criteria
   for "PR is mergeable / deploy is green." Every created blocker fix ticket MUST end with the
   `rejection-detection` **operator footer** as a visible prose line:
   `To stop this from being raised again, close it as **Not planned**. Close it as **Completed** if it was fixed — a later recurrence may be re-filed as a regression.`
2. **Transition the stalled item `claimed → blocked`** and add an **`is blocked by`** link to the
   new fix ticket (vendor-native: JIRA issue link `is blocked by`; GitHub/Linear `Blocked by:` line
   + label). Post a `[lisa-repair-intake]` note naming what it is blocked by and why. This block is
   **auto-recoverable** — the fix ticket will build and close on its own — so do **not** add the
   `human_needed` marker, and if the item already carries a stale `human_needed` label, remove it
   here (it is no longer waiting on a human). The `human_needed` marker is reserved for blocks a
   human must clear; this one a later cycle clears automatically.
3. **Record it** as a repair write. Do **not** dispatch the vendor agent for this item this cycle.

The item now sits in `blocked`; once the fix ticket reaches a terminal state, the **Build
`blocked` → unblock if cleared** path (next section) detects the cleared `is blocked by`
dependency and resumes the original in place — a self-healing loop.

**Idempotency.** Before filing, check for a fix ticket already carrying the marker
`[lisa-repair-intake] blocker:<item-ref>/<blocker-key>` (blocker-key is a stable slug of the
blocker, e.g. `pr-1234/merge-conflict` or `pr-1234/checks-failing`). Per the `rejection-detection`
rule's **Proposal rejection memory** section, that marker search MUST cover **open AND closed**
tickets (body-enumeration fallback on search-index lag): an **open** match → reference it and ensure
the `is blocked by` link is present rather than creating a duplicate; a match **closed as _not
planned_** (GitHub `stateReason == "not_planned"`; the config-resolved equivalent on JIRA/Linear) is
a **human decline** of that fix ticket — do **not** re-file it unless evidence **postdates the
decline**, and the re-filed ticket MUST carry BOTH the machine token (`declined <date>; recurred
<date> in <ref>`) and the human acknowledgment sentence (`You declined this on <date>. It has
recurred (<date>, <ref>), so we're raising it once more for your review.`); a match closed as
_completed_ is a regression path, not a decline. Honor the backoff window and state fingerprint
(Loop prevention) so re-runs over the same unchanged blocker are no-ops.

### Build `blocked` → re-evaluate, unblock if cleared

1. Read the block reason and classify the blocker (see Blocker classification & clearing). An item
   may be held by a **dependency**, by a **validation / quality-gate self-block**, by a
   **deployed / runtime verification failure**, by an **ambiguity**, or by more than one at once.
   Re-check **every** class present — do not stop at "no `is blocked by` links, therefore nothing
   to do." A self-block has zero dependencies by definition, yet is fully re-checkable.
2. **Dependency cleared** — if every parsed `is blocked by` dependency is **cleared** → move
   `blocked → claimed`, then run the same agent-dispatch + post-agent `claimed → done` sequence as
   the stalled-`claimed` path above (one-cycle recovery). If the agent re-blocks, move back to
   `blocked` — a valid outcome.
3. **Validation / quality-gate self-block re-check** — if the block reason is a pre-flight
   `verify`/`validate` gate failure (its `[lisa-*]` block note carries a gate marker + a "Missing
   requirements" list and there is **no** open `is blocked by` dependency), re-run the **same gate**
   against the item's **current** content via `lisa-tracker-validate` (read-only; the vendor-neutral
   gate `lisa:<tracker>-build-intake` and `lisa:<tracker>-write-*` already use). This is the build
   mirror of the PRD `blocked → re-validate` path below.
   - **PASS now** (the human added what was missing) → move `blocked → claimed` and resume exactly
     as in (2): agent-dispatch + post-agent `claimed → done`.
   - **Still FAIL** → stay `blocked`, but refresh the note with the **current** (usually smaller)
     missing-requirement set so the human sees what remains. Because the fingerprint includes the
     gate verdict + missing-requirement set (Loop prevention), a partial human fix changes the
     fingerprint and re-checks next cycle, while a truly-unchanged gate result stays in backoff.
4. **Deployed / runtime verification blocker re-check** — if the block reason is a failed
   *deployed* or *runtime* verification (a smoke/E2E/health check or manual probe against a live
   environment that errored — e.g. an authenticated endpoint returning 500, a deploy health check
   red, a seeded-data assertion failing), re-check by **reproducing the original failing check with
   the same context it used**: the same auth identity/credentials, the same target environment, the
   same route, and the same scope/parameters. A probe that does **not** exercise the failed path is
   **not** evidence the blocker cleared — an *anonymous* request to an *auth-gated* resource, a
   request against a different environment, or a narrower scope can all return a healthy status
   while the originally-failing path is still broken. (This exact false-negative — an unauthenticated
   `GET` to an auth-gated resource returning 200 without touching the failing table — wrongly unblocked
   a build item whose authenticated path was still 500ing, sending it `ready → claimed → blocked` again.)
   - **Reproduces clean now** (the *same* check that failed now passes) → move `blocked → claimed`
     and resume as in (2).
   - **Still failing** → stay `blocked`; refresh the note with the current observed result. Because
     the root cause is external (a deployed defect, not item content), prefer filing/keeping a
     build-ready fix ticket and an `is blocked by` link to it (the "real external blocker" path),
     so a later cycle self-heals when that ticket goes terminal.
   - **Cannot reproduce this cycle** (the agent lacks the credentials/env access to run the original
     check) → stay `blocked`; do **not** unblock on the absence of a reproduction. If the missing
     access is human-only, apply the `human_needed` marker. Never unblock a deployed-verification
     blocker on a weaker signal than the one that set it.
5. If the block was an **ambiguity** research can settle and no dependency remains → run the
   research needed (`lisa-codebase-research` / `lisa-product-walkthrough`); if resolved, proceed
   as in (2).
6. Else → still blocked. Refresh the note with the current reason (Loop prevention) and leave it
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

### Build parent rollup reconciliation (intermediate-env or terminal close-out)

For each parent/container item (an Epic, a Linear Project, or any item — of any type — with open child work),
reconcile its lifecycle state with the roll-up of its children — **including the intermediate-env
case**, not only fully-terminal close-out. This is the recovery-side complement to the forward
rollup the `*-sync --rollup` skills perform; it catches a parent that was never rolled up (or was
left in a status it should not carry, including a stale build-ready `ready`).

1. Read the child set using the vendor-native hierarchy first (GitHub sub-issues, JIRA
   Epic/parent/sub-task hierarchy, Linear project/parent/sub-issues), with the same fallbacks the
   vendor read/sync skills document. **Record which children were resolved natively vs. only via the
   prose/body-parentage fallback** — the gap between the two sets is repairable native-link drift.
1a. **Heal native child links before rolling up (GitHub).** Whenever the resolved child set
   contains same-repo children that are *not* in the parent's native `subIssues` graph — the typical
   case when the children carry `Parent: #<n>` / `Parent Epic: #<n>` in prose but were never attached
   (external generators like Codex, or an older write path) — attach each missing same-repo child as a
   native sub-issue using the identical idempotent `addSubIssue` contract the "GitHub PRD missing child
   links" path documents below: dedupe by `owner/repo#number`, treat "already linked" as success, keep
   cross-repo/cross-vendor children documented-only with a warning, and on `subIssues`/`addSubIssue`
   unavailability record a capability warning and continue. A build parent attaches the children
   resolved by its hierarchy (its Stories/Sub-tasks), not only empty-parent-token top-level work — the
   PRD top-level-only restriction is a PRD rule, not a build one. Record repaired refs in the rollup
   state fingerprint so repeated cycles do not re-post. Do this even when step 2 derives `unchanged`:
   the native graph is what the GitHub UI rollup and progress bar depend on, independently of the
   parent's status.
2. **Compute the derived parent state** bottom-up per the `leaf-only-lifecycle` **Parent status
   rollup** state machine, evaluated over the env ladder `in-progress < dev < staging <
   production` (the ordered keys of the env-keyed `done` map): any required child blocked →
   `blocked`; else every required child shipped to some env → the **least-advanced** env among
   them (e.g. all `On Stg` → `On Stg`); else any child started → `claimed`; else unchanged.
   Optional / won't-do / not-planned children are terminal-but-dropped and do not hold the parent
   open.
3. **If the derived state differs from the parent's current state, apply it** via the vendor's
   lifecycle write (JIRA transition, GitHub/Linear label swap keeping exactly one `status:*`),
   removing any conflicting stale build lifecycle role — **including a stale `ready`** the parent
   should never carry. Post an idempotent `[lisa-repair-intake]` rollup note naming the derived
   state and the child tally (honor the backoff window + fingerprint).
4. **Perform native closure only at the true terminal `done`.** When — and only when — the derived
   env is the production/terminal value, finalize through the provider-native mechanism (GitHub
   `gh issue close --reason completed`, Linear move to Done state, JIRA resolved/closed verified at
   `statusCategory = Done`). An intermediate-env rollup (`On Dev`/`On Stg`) advances the parent's
   status but **must not** close it — it is still open per `leaf-only-lifecycle`.
5. If the derived state is `unchanged` (children exist but none started) or the required set is
   ambiguous / inaccessible, leave the parent as-is and record it as `active` or `still_blocked`
   with the current child tally; never guess a transition.

### PRD `in_review` (stalled in-progress) → re-run validate→route

After the staleness gate passes, run the **same dry-run validate→route pipeline the vendor PRD
intake runs per item**, targeted at this single PRD and **skipping the claim** (it is already
`in_review`):

1. Invoke `lisa:<source>-to-tracker` with `dry_run: true` and the PRD's URL (source = the queue's
   PRD vendor: `notion-to-tracker` / `confluence-to-tracker` / `linear-to-tracker` /
   `github-to-tracker`). This indirectly runs `lisa-tracker-source-artifacts`,
   `lisa-product-walkthrough`, and the `lisa-tracker-validate` gate, returning a structured
   PASS/FAIL report with `prd_anchor` snippets — the same report the PRD intake consumes.
2. **On PASS** → re-invoke `lisa:<source>-to-tracker` with `dry_run: false` to write the tickets
   (its full run already writes the PRD back-link via `lisa-prd-backlink`), run the
   `lisa-prd-ticket-coverage` audit as the PRD intake does, then transition the PRD to its
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

### GitHub PRD missing child links → native sub-issue repair

For each open GitHub PRD in `ticketed` or another non-product-owned PRD role, compare the durable
generated-work fallback against the PRD's native sub-issue graph and repair missing native links.
This is the recovery counterpart to `lisa-prd-backlink`'s GitHub native parent-linking section:
PRD intake/backlink should attach generated top-level work as native PRD children when possible,
but repair-intake must heal the graph when that write was skipped, failed, or later drifted.

1. Read the generated work exactly as PRD rollup does:
   - Prefer the machine-readable `## Tickets` / `## Generated Work` section (`lisa:gw` tokens).
   - If the machine-readable section is absent but an older Lisa ticketing comment exists, parse only
     its structured `Top-level work:` block as a compatibility fallback. Do not scrape arbitrary
     prose.
2. Select only generated **top-level** work:
   - `lisa:gw` entries whose `parent` token is empty.
   - Older ticketing-comment entries under `Top-level work:`.
   Leaf Sub-tasks and descendant Stories are never direct PRD children.
3. Restrict native repair to same-repo GitHub issues. Cross-repo or cross-vendor generated work stays
   documented-only; record a warning instead of failing.
4. Read the PRD's existing native sub-issues with the same GraphQL `subIssues` query documented by
   `lisa-prd-backlink` / `lisa-github-read-issue`, and dedupe by child-ref
   (`owner/repo#number`).
5. For each missing same-repo top-level child, resolve node IDs and call the same GitHub GraphQL
   mutation as `prd-backlink`:

   ```graphql
   mutation($parentId:ID!,$childId:ID!){
     addSubIssue(input:{issueId:$parentId,subIssueId:$childId}){issue{number}subIssue{number}}
   }
   ```

   Treat "already linked" duplicate rejections as success. If `subIssues` / `addSubIssue` is
   unavailable, leave the documented generated-work fallback intact, record a capability warning, and
   continue.
6. Post one idempotent `[lisa-repair-intake]` note when a missing native PRD child link is repaired
   or when the native-link capability is unavailable. Include the generated top-level child set, the
   pre-existing native child set, and repaired child refs in the state fingerprint so repeated cycles
   do not spam comments.
7. Do not transition the PRD lifecycle merely because child links were repaired. Rollup/ship remains
   governed by the PRD rollup path after the child graph is complete.

### GitHub missing official ready-label normalization → configured ready

For GitHub queues, enumerate open issues that have **no configured Lisa lifecycle label** in the
active lifecycle namespace(s). This is the repair path for issues created by older tools or humans
with labels like `build-ready`, or with no Lisa status label at all, that are invisible to
`lisa-intake`, whose scanner only reads the configured `ready` labels.

1. Resolve configured lifecycle labels from `.lisa.config.json` / `.lisa.config.local.json`:
   - PRD lifecycle labels: `draft`, `ready`, `in_review`, `blocked`, `ticketed`, `shipped`,
     `verified` when configured.
   - Build lifecycle labels: `ready`, `claimed`, `blocked`, every env-resolved `done` value,
     intermediate status labels where configured, and `human_needed`.
2. Query open GitHub issues that are missing all configured lifecycle labels for the lifecycle(s)
   selected by `intake_mode`. If `intake_mode=prd`, only PRD-classified issues are normalized. If
   `intake_mode=build`, every non-PRD issue is normalized as a build ticket. If `intake_mode=both`,
   classify PRDs first and normalize all remaining issues as build tickets.
3. Classify the issue:
   - **PRD** if it has PRD labels/markers (`prd`, `type:PRD`, `kind:prd`), PRD structure
     (`## Problem`, `## Goals`, `## Validation Journey`, generated-work/backlink sections), or
     body/comment text that explicitly says `prd-ready`.
   - **Build ticket** if it has build work labels/types (`bug`, `type:Bug`, `task`, `type:Task`,
     `sub-task`, `type:Sub-task`, `improvement`, `type:Improvement`, `story`, `spike`) or
     body/comment text that explicitly says `build-ready`. When PRD signals are absent and the
     selected lifecycle includes build, default to **Build ticket** even if no build type label is
     present; build-intake/implement will validate the item and move it to `blocked` if required
     sections are missing.
   - **Ambiguous PRD/build** if strong PRD and build classifications both match. In `intake_mode=prd`
     normalize as PRD; in `intake_mode=build` normalize as build; in `intake_mode=both`, prefer PRD
     only when the body has PRD structure, otherwise build.
4. Apply exactly one configured ready label for the classified lifecycle:
   - PRD → add the configured PRD `ready` label (default `prd-ready`).
   - Build ticket → add the configured build `ready` label (default `status:ready`).
   Keep any unofficial labels for auditability unless the project has explicitly configured one as a
   conflicting lifecycle label. Do not claim the item or dispatch an agent in the same repair cycle;
   normalization makes the next normal `lisa-intake` run pick it up.
5. Post one idempotent `[lisa-repair-intake]` note naming the classification and the configured label
   applied. Include the normalization result in the loop-prevention fingerprint so repeated repair
   cycles do not spam comments.

## Blocker classification & clearing (conservative, vendor-specific extraction)

A `blocked` build item is held by one or more of three blocker classes. Identify which are present
from the item's block note(s) and links, then clear-check **each present class** — an item with no
dependency is not automatically un-actionable; it may be a self-block that now passes.

### Class A — dependency blockers

`lisa-tracker-read` is a thin dispatcher that returns each vendor's bundle **verbatim** — there
is no normalized `is blocked by` field. Read the bundle, then extract blockers per vendor:

- **GitHub**: parse the durable forms `lisa-github-build-intake` documents — `Blocked by: #123`,
  qualified cross-repo refs (`owner/repo#123`), issue URLs in the body/comments — plus timeline
  cross-reference events.
- **JIRA**: inspect the native issue-link records `lisa-jira-read-ticket` returns and select the
  `is blocked by` link type.
- **Linear**: inspect the native issue **relations** from Linear MCP `get_issue` and select
  blocker relations.

Then classify each blocker:

- **Closed, or shipped to any environment** → **cleared**. A blocker is cleared at **any**
  env-staged `done` role — not only the production terminal. The `done` role is configured
  per-env as a `{dev, staging, production}` map (`config-resolution`), so `On Dev`, `On Stg`,
  **and** production `Done` all mean the blocker's code is merged and deployed to ≥1 environment.
  A post-build `review` role (e.g. `Code Review`) is likewise cleared — the change exists and is
  in flight. An `is blocked by` link is a **development** dependency: it is satisfied once the
  blocker's code is in trunk; it must NOT wait for the blocker to reach production. (This matches
  the intake-path dependency-hold gate in `lisa-intake-explain`, which already treats
  `code-review` / `on-dev` / `on-stg` / `done` as cleared — repair-intake must not be stricter.
  In an env-staged workflow where `Done` means "in production", a strict production-terminal
  check strands every dependent forever behind a blocker that is already merged and sitting at
  `On Stg` / `On Dev`.)
- **Open** in a pre-merge role (`ready` / `claimed` / unknown — code not yet in trunk) → **still
  blocking**.
- **Inaccessible** (deleted, cross-org, permission denied) → **still blocking**, unless the item
  body or a newer human comment explicitly states the dependency is resolved.

Only re-dispatch when **every** parsed blocker is cleared. When in doubt, stay blocked — a
false-negative (left blocked) is cheap; a false-positive (re-dispatched into a real blocker)
wastes a build cycle.

### Class B — validation / quality-gate self-block

A self-block has **no** `is blocked by` dependency: the build-intake/agent flow claimed the item,
its pre-flight `verify`/`validate` gate failed (missing Validation Journey, Sign-in Required,
Target Backend Environment, Repository, Out of Scope, Evidence manifest, weak Acceptance Criteria,
etc.), and the item was bounced to `blocked` carrying that gate's `[lisa-*]` note + "Missing
requirements" list. Detect it by: (1) the block note bears a known gate marker (e.g.
`Pre-flight verify gate: BLOCKED`, `jira-verify` / `*-validate-*`), **and** (2) there is no open
`is blocked by` dependency. (If both a dependency and a self-block are present, clear the
dependency via Class A first; the self-block re-check still gates the eventual re-dispatch.)

Clear-check by **re-running the same gate against current content** — `lisa-tracker-validate`
(read-only; never writes), which dispatches to `lisa:<tracker>-validate-*` exactly as the write
path and build-intake do, so the bar cannot drift:

- **PASS** → cleared. Proceed to re-dispatch (decision tree step 2).
- **FAIL** → still self-blocked. Refresh the note with the current missing set (Loop prevention).

Conservative, same as Class A: a still-failing gate is a real blocker — never re-dispatch a build
whose own gate has not yet passed. This is intentionally symmetric with the PRD `blocked →
re-validate` path: PRDs re-run their dry-run `validate→route` when source content changes; builds
re-run `tracker-validate` when item content changes. The asymmetry where build `blocked` checked
only dependencies — leaving verify-gate self-blocks stranded forever after a human filled in the
missing sections — is the gap this class closes.

### Class C — ambiguity / clarifying answers

A block that research or a human answer can settle (no dependency, no failing gate). Re-check by
running the needed research (`lisa-codebase-research` / `lisa-product-walkthrough`) or detecting a
human comment/edit newer than the last `[lisa-repair-intake]` note. Resolved → proceed to
re-dispatch; else stay blocked.

### Class D — deployed / runtime verification failure

A block set by a *deployed* or *runtime* check that failed against a live environment — a
smoke/E2E/health probe or manual reproduction that returned an error (an authenticated endpoint
500ing, a deploy health check red, a seeded-data assertion failing). This is neither a dependency
nor a content gate: the item is correct but the environment it must verify against is broken.

Clear-check by **reproducing the original failing check with the same context that set it** — same
auth identity/credentials, same environment, same route, same scope. The cardinal rule: **never
unblock on a probe weaker than the one that set the block.** A signal that does not exercise the
failed path is not a clear:

- Anonymous/unauthenticated request to an **auth-gated** resource (it can short-circuit to a
  healthy response without touching the failing code path).
- A request against a **different environment** than the one that failed.
- A **narrower scope** than the failing check (a subset that happens to pass).

Conservative, same as the other classes: reproduces-clean → cleared; still-failing or
not-reproducible-this-cycle → stay blocked. Because the cause is external (a deployed defect, not
item content), the durable handling is the **real external blocker** path — file/keep a build-ready
fix ticket for the deployed defect and `is blocked by`-link the item to it, so a later cycle
self-heals when that ticket is terminal. If reproducing the check needs human-only access the agent
lacks, apply `human_needed`.

## Loop prevention

A `blocked` item with a permanently unresolved problem must not be "repaired" and re-noted every
cron tick.

- Every note this skill writes is prefixed `[lisa-repair-intake]` and carries a compact **state
  fingerprint**: the lifecycle role, the set of blocker refs + their observed states, the
  validation verdict (PASS/FAIL) **plus the current missing-requirement set for a Class-B
  self-block** (so a human filling in one of several missing sections changes the fingerprint and
  triggers a re-check next cycle, rather than being suppressed as a no-op), terminal/open state,
  rollup child tally, and a timestamp.
- Before writing a note or re-attempting a `blocked` item, compute the current fingerprint. If
  an identical fingerprint was already posted within the **backoff window**, skip the item
  silently (record as `still_blocked` / `active`, no write).
- Backoff window default = `stale_after` (2h). `force=true` bypasses backoff for a manual run.
- A *changed* fingerprint (new blocker state, new answers, new verdict) always warrants a fresh
  note + re-attempt — backoff suppresses only no-op repeats.

## Lifecycle ownership guard

repair-intake owns the repair surfaces needed to recover stuck work and close-out drift:
build `claimed` / `blocked`, PRD `in_review` / `blocked`, terminal-labeled native-open items,
parent/container rollups (intermediate-env *and* fully-terminal), and stale-`ready` containers.
It MAY:

- Apply the build scanner's post-agent `claimed → done` on a successful resume (it is finishing
  the scanner's interrupted job), and move a dependency-cleared build item `blocked → claimed`.
- Manage the `human_needed` marker on build blocks: leave it where the vendor agent set it (a
  human-only pre-flight block), and **clear** it from an item it moves to an auto-recoverable
  `blocked` (blocked by a build-ready fix ticket) — that block self-heals and is not waiting on a
  human.
- Move a re-validated PRD `in_review`/`blocked → ticketed` (PASS) or `→ blocked` (FAIL), exactly
  as the PRD intake does.
- Close / complete / resolve build items that already carry the true terminal `done` role but are
  still natively open, per `leaf-only-lifecycle`.
- Roll up a parent/container to its derived state per the `leaf-only-lifecycle` state machine —
  **including an intermediate env value** (`On Dev`/`On Stg`) when all required children have
  reached that env — and close/complete/resolve it **only** when the derived env is the true
  terminal `done`.
- Reconcile a **container** wrongly carrying the build-ready `ready` role (a leaf-only-invariant
  violation) by rolling it up from its children and removing the `ready`, with a
  `[lisa-repair-intake]` audit note. This is the one `ready`-touching exception (see MUST NOT) and
  applies only to containers, never to leaves.
- Move a PRD with fully terminal generated work to `shipped` and close/archive the source artifact
  where the source vendor supports native close-out, per `prd-lifecycle-rollup`.
- Repair missing native GitHub child links by replaying the same-repo, idempotent `addSubIssue`
  contract — for a **PRD** from the generated-work fallback (top-level-only), and for a **build
  Epic/Story container** from its hierarchy/body-parentage children — so rollup and the GitHub UI can
  rely on the native graph. This repairs structure only; it does not ship, transition, or verify the
  parent.
- Normalize a GitHub issue with no configured lifecycle label by adding the configured PRD or build
  `ready` label after classifying the issue. This is a visibility repair, not a claim; the item
  remains open and unclaimed for normal intake.

It MUST NOT:

- Move a PRD out of `draft` or `verified` (those are product-owned), or set `verified` itself.
- Link leaf Sub-tasks or descendant Stories directly under a PRD. Only generated top-level work
  (empty parent token / `Top-level work:` entries) may become PRD children.
- Apply a build `done` value other than via the env-resolution rules, or close a native item at
  any value other than the true terminal `done` (see `leaf-only-lifecycle`).
- Touch `ready` **leaves** (that is `lisa-intake`'s lane). A container carrying `ready` is the
  documented exception above — repair-intake reconciles it because `ready` on a parent is an
  invariant violation, not the human "claim this leaf" signal intake owns.
- Move a GitHub issue that already carries a configured lifecycle label back to `ready` merely
  because some other label looks stale. Official lifecycle labels remain authoritative.

## Cycle behavior

1. **Resolve the queue** — detect vendor/lifecycle (Source dispatch); resolve stuck role names
   from config. For JIRA, confirm the needed transitions are reachable; stop on misconfig.
2. **Enumerate repair candidates** — query in-progress role(s), `blocked` role(s), terminal/open
   items, GitHub parents (PRDs **and build Epic/Story containers**) whose discoverable children —
   generated-work fallback for a PRD, hierarchy/body-parentage for a build container — are missing from
   their native sub-issue graph, rollup parents/PRDs with child work, **containers carrying the `ready`
   role** (a
   leaf-only-invariant violation to reconcile), and GitHub issues with no configured lifecycle label,
   for the detected lifecycle(s), up to `max_candidates`, via the Access layer reads.
3. **Order deterministically**, highest repair-confidence first:
   1. terminal-labeled items that only need native close / complete / resolve,
   2. build `claimed` leaves whose linked PR is **already merged** — apply the env-resolved
      `claimed → done` close-out (staleness-exempt; no re-dispatch). This MUST run before any rollup
      bucket: a merged-PR leaf is a settled terminal state, and recovering it first means its parent
      rolls up to its true derived state in the **same** cycle. If this ran after rollup (or last,
      among generic stalled items), the parent would be reconciled against a not-yet-closed child and
      the shipped leaf would linger another cron pass — the failure this ordering exists to prevent,
   3. GitHub parents (PRDs missing native links for generated top-level work, or build Epic/Story
      containers missing native links for prose/hierarchy children) needing structure-only repair,
   4. rollup parents/PRDs whose child sets are all terminal (close-out),
   5. rollup parents whose children have advanced to an intermediate env, or stale-`ready`
      containers, that need their derived state applied (status-only reconciliation, no native
      close),
   6. `blocked` items whose dependencies are now **cleared** (safe, high-value, one-cycle wins),
   7. `blocked` items whose **validation / quality-gate self-block now re-validates PASS** —
      a human filled in the missing sections (Class B; equally safe and high-value),
   8. `blocked` items with **new clarifying answers**,
   9. GitHub missing-official-label normalization candidates,
   10. **stalled** in-progress items (PR not merged), oldest activity first.
4. **Walk the ordered list**, evaluating each candidate (terminal close-out, rollup child tally,
   staleness, dependency, answer checks), and repair **every** candidate that is actionable inside
   the `max_candidates` cap. Continue after successful writes and after per-item errors.
5. **Empty / nothing actionable** → exit cleanly:
   `"No stuck items actionable this cycle (examined N, all active or in backoff)."`
6. **Failure isolation** — if evaluating one candidate errors, record it under Errors and
   continue to the next; one bad item never aborts the cycle.

Process **all materially actionable repairs among the enumerated candidates** — scan up to
`max_candidates`, repair the actionable subset, then exit. This intentionally differs from
`lisa-intake`'s one-ready-item claim contract because repair work is bounded by an explicit cap and
often consists of cheap close-out reconciliation that should drain in one cron pass.

## Summary report

Report outcomes in these buckets:

- `resumed` — stalled in-progress work re-dispatched in place.
- `resynced` — a stalled build whose PR was merely behind its base, re-synced via
  `gh pr update-branch` so the already-enabled auto-merge can land; the item stays `claimed` for a
  later cycle to confirm the merge and transition.
- `recovered` — a stalled build whose PR had already merged, advanced by applying the env-resolved
  `claimed → done` transition build-intake never got to (no re-dispatch).
- `unblocked` — blocker cleared (or answers resolved); re-dispatched or transitioned to
  `ticketed`.
- `closed_out` — terminal-labeled items whose native open/active state was closed, completed,
  resolved, or archived.
- `rolled_up` — parent/container/PRD rollups advanced to their derived state: an intermediate env
  (e.g. all children at `On Stg` → parent `On Stg`), a fully-terminal close-out, or a stale-`ready`
  container reconciled from its children.
- `relinked` — GitHub parents (PRDs from the generated-work fallback, or build Epic/Story containers
  from hierarchy/body-parentage) whose missing native sub-issue links were attached.
- `normalized_ready` — GitHub issues missing official lifecycle labels that were classified and
  given the configured PRD/build `ready` label so normal intake can claim them.
- `still_blocked` — examined and intentionally left `blocked`, with the active reason.
- `active` — skipped because current work is not stale (or within backoff).
- `errors` — items that failed evaluation, with the error.

State every item repaired this cycle and the action taken. If the output would be long, group by
bucket and show compact refs plus counts.

## Run outcome

As the registered `intake-repair` automation loop, each cycle conforms to the
`automation-runbook-contract` rule: it ends in **exactly one** of the six run outcomes and records it,
so a cycle that found nothing stuck and a cycle where the repair machinery itself broke never look
alike. A run outcome describes this *cycle*; the Summary-report buckets above describe *what happened
to each item* — the two never merge in the one-line summary.

| This cycle's exit path | Run outcome |
|---|---|
| Nothing actionable — the idle case (walk step 5): examined N, all active or in backoff — including a fix ticket suppressed by a prior decline (`rejection-detection` **Proposal rejection memory**), which the summary names in its suppression count | `nothing-needed` |
| Repairs applied **and confirmed** this cycle — `resumed` / `resynced` / `recovered` / `unblocked` / `closed_out` / `rolled_up` / `relinked` / `normalized_ready` | `change-proved` |
| Repair produced new work for a human to pick up — e.g. an unmergeable PR or failed deploy filed as a **build-ready fix ticket** and left `blocked` | `candidate-proposed` |
| A repair reached an autonomy boundary needing a human (a protected-deploy approval before it can proceed) | `approval-requested` |
| The loop itself could not run — the queue is unreadable, tracker credentials are revoked, or an open-and-closed rejection-memory / blocker-marker search is unreadable and therefore must not fall through to `nothing-needed` | `recovery-required` |
| The runbook's **Retirement condition** tripped | `policy-obsolete` — **never reached by design for this loop** (see Retirement evaluation below) |

Record **exactly one** outcome per invocation through the run-record CLI, naming this loop's runbook
(the `--summary` is the operator-readable one-liner in the contract's exemplar voice — plain,
specific, actionable, e.g. `Examined 14 items; all active or in backoff — nothing to repair.` for
`nothing-needed`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/automation-run-record.mjs" \
  --loop-id intake-repair --outcome change-proved \
  --summary "Recovered 3 stalled builds and closed out 2 rollups; all confirmed." \
  --runbook .lisa/automations/intake-repair.runbook.md [--ref <item-url>]...
```

If `${CLAUDE_PLUGIN_ROOT}` is unset, resolve the plugin scripts directory directly — the built copy
`plugins/lisa/scripts/automation-run-record.mjs` or the source
`plugins/src/base/scripts/automation-run-record.mjs`. If recording still fails, **degrade, never
abort** (per `automation-runbook-contract`): note the recording failure in the run output and finish
the cycle — a recording failure is a degradation to report, never a reason to block the loop.

**Retirement evaluation (every run).** The `intake-repair` loop is **structural to the
factory — it does not retire.** Its runbook says so plainly instead of leaving the Retirement
condition blank, so the `automation-runbook-contract` rule's two-part retirement test never fires
here: this loop never records `policy-obsolete` and never files a teardown proposal. An operator who
wants repair to stop runs `/lisa:tear-down-automations` themselves — the loop never removes its own
registration.

## Schedule examples

```text
/schedule "every 2 hours" /lisa:repair-intake https://www.notion.so/<workspace>/<database-id>
/schedule "every 2 hours" /lisa:repair-intake https://linear.app/acme
/schedule "every 2 hours" /lisa:repair-intake acme/product-prds
/schedule "every 2 hours" /lisa:repair-intake acme/frontend-v2 intake_mode=build
/schedule "every 2 hours" /lisa:repair-intake acme/frontend intake_mode=both build_queue=acme/planning
/schedule "every 4 hours" /lisa:repair-intake SE stale_after=12h
/lisa:repair-intake SE stale_after=0 force=true        # manual: treat all in-progress as stalled, ignore backoff
```

Run repair-intake **less frequently than** `lisa-intake` (the ready queue moves faster than
stuck work accumulates), or interleaved on a longer cadence.

## Rules

- Never run a cycle without an explicit queue. Side effects too high to default.
- Never reset stalled in-progress items to `ready` — resume in place (decision tree).
- Never mutate product-owned states (`draft`, `verified`) or set `verified`; PRD rollup close-out
  may move open generated-work PRDs to `shipped` and close/archive them only after all associated
  child work is terminal.
- Apply build `done` ONLY via the env-resolution rules, and trigger native closure only at the
  true terminal `done` value (`leaf-only-lifecycle`).
- A `blocked` build item's blocker may be a dependency, a validation/quality-gate self-block (no
  dependency — re-check by re-running `lisa-tracker-validate` against current content), or an
  ambiguity. Re-check every class present; do not treat "no `is blocked by` links" as "nothing to
  do."
- Never re-dispatch a `blocked` build item unless every parsed blocker is cleared (conservative
  dependency clearing).
- Repair every materially actionable candidate inside the `max_candidates` cap; default cap is 100.
- Default GitHub `intake_mode` is `both` when both PRD and build namespaces exist.
- Honor the backoff window — never re-post an identical `[lisa-repair-intake]` note within it
  (unless `force=true`).
- Never run two repair cycles concurrently against overlapping queues, and never run
  repair-intake against a queue `lisa-intake` is concurrently draining — the scheduling layer is
  responsible for serialization.
- Stop and surface failures rather than retry-loop.
