---
name: repair-intake
description: "Vendor-agnostic repair scanner — the recovery counterpart to lisa:intake. Where intake claims `ready` work, repair-intake finds work that got stuck: items left in `blocked`, or stalled in an in-progress role (build `claimed`, PRD `in_review`) after a processing cycle died and nobody picked it back up. Scans the same queues lisa:intake serves (Notion / Confluence / Linear / GitHub PRD databases; JIRA / GitHub / Linear build queues), enumerates stuck candidates, and repairs the first materially actionable one per cycle: resumes stalled in-progress work IN PLACE (build → the vendor agent + the scanner's post-agent transition; PRD → the source `*-to-tracker` dry-run validate→route pipeline), re-validates blocked PRDs when new clarifying answers exist, and re-dispatches blocked build items whose `is blocked by` dependencies have since closed. One actionable repair per invocation, idempotent, loop-protected via a [lisa-repair-intake] marker + state fingerprint + backoff. Never mutates product-owned states (`draft`, `shipped`, `verified`) and never closes PRDs. Designed as a /schedule cron target running alongside lisa:intake."
allowed-tools: ["Skill", "Bash", "Read", "Write", "Edit", "mcp__linear-server__list_teams", "mcp__linear-server__list_projects", "mcp__linear-server__get_project", "mcp__linear-server__save_project", "mcp__linear-server__list_project_labels", "mcp__linear-server__list_issues", "mcp__linear-server__get_issue", "mcp__linear-server__save_issue", "mcp__linear-server__list_comments", "mcp__linear-server__save_comment", "mcp__linear-server__list_issue_labels", "mcp__linear-server__create_issue_label"]
---

# Repair Intake: $ARGUMENTS

Run one batch-**repair** cycle against the queue identified by `$ARGUMENTS`. Where `lisa:intake`
scans the `ready` role and moves work *forward*, repair-intake scans the **stuck** roles and
moves work *unstuck*:

- **Stalled in-progress** — an item left in an in-progress role (build `claimed`, PRD
  `in_review`) whose processing cycle died. It is technically "being worked" but nothing is
  happening, so it sits ignored forever. (The vendor PRD intakes explicitly leave an errored PRD
  in `in_review` "for the human to investigate from there" — that orphan is exactly what this
  skill recovers.)
- **Recoverable blocked** — an item in `blocked` whose blocker may now be gone: an
  `is blocked by` dependency has since closed, clarifying questions have been answered, or
  research/waiting resolves the ambiguity that stopped it.

This skill is the symmetric counterpart to `lisa:intake`. It reuses the same queue-detection,
the same agent-team orchestration, the same "don't ask, just run" confirmation policy, and the
same per-item surfaces the vendor intakes use (`lisa:<source>-to-tracker` dry-run for PRDs;
`lisa:<tracker>-agent` + the scanner's lifecycle transitions for build) — it differs only in
*which roles it scans* and *that it skips the claim step* (the item is already claimed/blocked).

## Public contract

```text
/lisa:repair-intake <queue> [intake_mode=prd|build|both] [stale_after=24h] [max_candidates=100] [force=true]
```

| Token | Meaning | Default |
|-------|---------|---------|
| `<queue>` | Same queue identifier `lisa:intake` accepts (see Source dispatch). Required. | — |
| `intake_mode` | `prd` \| `build` \| `both`. Only meaningful for a GitHub `org/repo` (or bare `github`) that hosts both PRD and build label namespaces. `both` is unique to repair — a repair sweep usefully covers both lifecycles in one schedule. Absent → prefer PRD when both namespaces exist, else whichever exists (matches `lisa:intake`). | (infer) |
| `stale_after` | How long with no observable activity before an in-progress item counts as stalled. Accepts `24h`, `90m`, `2d`, or `0` (treat any in-progress item as stalled — manual recovery, also the only way to resume work on a provider that exposes no reliable timestamp). Overrides config. | `24h` |
| `max_candidates` | Cap on how many stuck items to enumerate while looking for the first actionable one. Bounds scan cost. Overrides config. | `100` |
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
- Pausing because a re-dispatch looks expensive. The cost of one cycle is bounded (one
  actionable repair); the cost of stalling a scheduled cron waiting on a human is unbounded.

The only legitimate reasons to stop early:

- Missing required input (no queue argument, missing project configuration). Surface the
  missing value and exit.
- The queue itself is misconfigured (Status property missing expected values, JIRA workflow
  can't reach required transitions). Surface and exit.
- No stuck items, or none actionable this cycle. Exit cleanly with the idle-case summary.

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
tool), do NOT create a second team — many harnesses reject double-creates. Continue within the
existing team. The cycle's outer team is created by repair-intake. Each per-item repair it runs
(`lisa:<source>-to-tracker` for a PRD, `lisa:<tracker>-agent` for a build item) executes within
the same team — those skills' orchestration preambles detect the existing team and skip creating
a second one. One team per cron cycle.

## Source dispatch

Detect the queue type from `$ARGUMENTS` using the **exact same detection and disambiguation
rules as `lisa:intake`** — read that skill's "Source dispatch" section for the authoritative
table; the detection is identical and only the per-item action changes (repair instead of
claim-and-advance). The essentials, inlined here so this skill is self-complete:

| If `$ARGUMENTS` is... | Queue / lifecycle | Source/tracker key | Stuck roles repaired |
|------------------------|-------------------|--------------------|----------------------|
| Notion **database** URL/ID | PRD (Notion) | source=notion | `in_review`, `blocked` |
| Confluence **space** URL/key | PRD (Confluence) | source=confluence | `in_review`, `blocked` (parent-page roles) |
| Confluence **parent page** URL/ID | PRD (Confluence, narrowed) | source=confluence | `in_review`, `blocked` |
| Linear **workspace** URL, **team** URL/key, or literal `linear` | PRD (Linear) | source=linear | `in_review`, `blocked` (project labels) |
| GitHub **repo** URL / `org/repo` (PRD namespace) | PRD (GitHub) | source=github | `in_review`, `blocked` (PRD labels) |
| GitHub **repo** URL / `org/repo` with `tracker = github` (build namespace) | Build (GitHub) | tracker=github | `claimed`, `blocked` (build labels) |
| Literal `github` | GitHub; route by `intake_mode` (`prd` / `build` / `both`) | per lifecycle | per lifecycle above |
| JIRA project key or full JQL | Build (JIRA) | tracker=jira | `claimed`, `blocked` (statuses) |

Disambiguation (same as `lisa:intake`): a `notion.so`/`notion.site` URL → Notion; an Atlassian
`/wiki/spaces/<KEY>` URL → Confluence (with `/pages/<id>` → parent-page narrowing); a
`linear.app` workspace/team URL or literal `linear` → Linear; a `github.com` URL / `<org>/<repo>`
token / literal `github` → GitHub; a bare token matching the JIRA project-key regex → JIRA
(else try Confluence space, then Linear team); a string with JQL operators → JQL. **A single-item
URL is out of scope** — this skill is batch-only; repair one item by hand via `lisa:implement`
(build) or by re-running `lisa:<source>-to-tracker` (PRD).

Role names for every vendor are resolved from `.lisa.config.json` per the `config-resolution`
rule — never hardcode status/label strings. The relevant stuck roles:

| Lifecycle | Vendor | In-progress role key | Blocked role key |
|-----------|--------|----------------------|------------------|
| Build | JIRA | `jira.workflow.claimed` (`In Progress`) | `jira.workflow.blocked` (`Blocked`) |
| Build | GitHub | `github.labels.build.claimed` (`status:in-progress`) | `github.labels.build.blocked` (`status:blocked`) |
| Build | Linear | `linear.labels.build.claimed` (`status:in-progress`) | `linear.labels.build.blocked` (`status:blocked`) |
| PRD | Notion | `notion.values.in_review` (`In Review`) | `notion.values.blocked` (`Blocked`) |
| PRD | GitHub | `github.labels.prd.in_review` (`prd-in-review`) | `github.labels.prd.blocked` (`prd-blocked`) |
| PRD | Linear | `linear.labels.prd.in_review` (`prd-in-review`) | `linear.labels.prd.blocked` (`prd-blocked`) |
| PRD | Confluence | `confluence.parents.in_review` (page id) | `confluence.parents.blocked` (page id) |

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

| Vendor | Reads (scan / comments / links) | Writes (transition / comment) | Re-dispatch / re-validate |
|--------|---------------------------------|-------------------------------|---------------------------|
| JIRA (build) | `lisa:atlassian-access` `search-issues` / `lisa:jira-read-ticket` | `lisa:atlassian-access` `transition` / `comment` | `lisa:jira-agent` |
| GitHub (build) | `gh issue list` / `gh issue view --json` / `gh pr list` | `gh issue edit` (labels) / `gh issue comment` | `lisa:github-agent` |
| Linear (build) | Linear MCP `list_issues` / `get_issue` / `list_comments` | Linear MCP `save_issue` (labels) / `save_comment` | `lisa:linear-agent` |
| Notion (PRD) | `lisa:notion-access` (`query`, page comments) | `lisa:notion-access` `write-page` (status) / page comment | `lisa:notion-to-tracker` (dry-run) |
| GitHub (PRD) | `gh issue list/view` (PRD labels) | `gh issue edit` / `gh issue comment` | `lisa:github-to-tracker` (dry-run) |
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
3. Built-in default: **24 hours**.

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

If a provider cannot expose any reliable timestamp, do **not** auto-resume its in-progress
items unless the caller passed `stale_after=0`. (Dependency-cleared `blocked` repair still
proceeds — it is judged on blocker state, not time.)

## Repair decision tree

Apply per candidate. Stop the cycle after the **first** candidate that triggers a write
(lifecycle transition, re-dispatch, or refreshed note). Everything examined before it is
recorded read-only.

### Build `claimed` (stalled in-progress) → resume in place

After the staleness gate passes, run the **same per-item sequence the vendor build-intake runs**,
skipping the claim transition (the item is already `claimed`):

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
  validation verdict (PASS/FAIL), and a timestamp.
- Before writing a note or re-attempting a `blocked` item, compute the current fingerprint. If
  an identical fingerprint was already posted within the **backoff window**, skip the item
  silently (record as `still_blocked` / `active`, no write).
- Backoff window default = `stale_after` (24h). `force=true` bypasses backoff for a manual run.
- A *changed* fingerprint (new blocker state, new answers, new verdict) always warrants a fresh
  note + re-attempt — backoff suppresses only no-op repeats.

## Lifecycle ownership guard

repair-intake owns ONLY the four stuck roles: build `claimed` / `blocked` and PRD `in_review` /
`blocked`, plus the transitions a stuck item legitimately moves through during recovery. It MAY:

- Apply the build scanner's post-agent `claimed → done` on a successful resume (it is finishing
  the scanner's interrupted job), and move a dependency-cleared build item `blocked → claimed`.
- Move a re-validated PRD `in_review`/`blocked → ticketed` (PASS) or `→ blocked` (FAIL), exactly
  as the PRD intake does.

It MUST NOT:

- Move a PRD out of `draft`, `shipped`, or `verified`, or close/archive any PRD (those are
  product- and rollup-owned — see `prd-lifecycle-rollup`).
- Apply a build `done` value other than via the env-resolution rules, or close a native item at
  any value other than the true terminal `done` (see `leaf-only-lifecycle`).
- Touch `ready` items (that is `lisa:intake`'s lane).

## Cycle behavior

1. **Resolve the queue** — detect vendor/lifecycle (Source dispatch); resolve stuck role names
   from config. For JIRA, confirm the needed transitions are reachable; stop on misconfig.
2. **Enumerate stuck candidates** — query the in-progress role(s) and the `blocked` role for the
   detected lifecycle(s), up to `max_candidates`, via the Access layer reads.
3. **Order deterministically**, highest repair-confidence first:
   1. `blocked` items whose dependencies are now **cleared** (safe, high-value, one-cycle wins),
   2. `blocked` items with **new clarifying answers**,
   3. **stalled** in-progress items, oldest activity first.
4. **Walk the ordered list**, evaluating each read-only (staleness, dependency, answer checks),
   and **repair the first candidate that is actionable** per the decision tree. Stop after that
   one write-producing repair.
5. **Empty / nothing actionable** → exit cleanly:
   `"No stuck items actionable this cycle (examined N, all active or in backoff)."`
6. **Failure isolation** — if evaluating one candidate errors, record it under Errors and
   continue to the next; one bad item never aborts the cycle.

Process **at most one materially actionable repair per invocation** — scan many, repair one,
exit. This matches `lisa:intake`'s one-item-per-cycle contract: bounded cost, low race risk, no
surprise burst of PRs. Throughput is the scheduler's job, not one invocation's.

## Summary report

Report outcomes in these buckets:

- `resumed` — stalled in-progress work re-dispatched in place.
- `unblocked` — blocker cleared (or answers resolved); re-dispatched or transitioned to
  `ticketed`.
- `still_blocked` — examined and intentionally left `blocked`, with the active reason.
- `active` — skipped because current work is not stale (or within backoff).
- `errors` — items that failed evaluation, with the error.

State the single item repaired this cycle (if any) and what action was taken.

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
- Never mutate product-owned states (`draft`, `shipped`, `verified`) or close PRDs (Lifecycle
  ownership guard).
- Apply build `done` ONLY via the env-resolution rules, and trigger native closure only at the
  true terminal `done` value (`leaf-only-lifecycle`).
- Never re-dispatch a `blocked` build item unless every parsed blocker is cleared (conservative
  dependency clearing).
- One materially actionable repair per cycle. Stop after the first write-producing repair.
- Honor the backoff window — never re-post an identical `[lisa-repair-intake]` note within it
  (unless `force=true`).
- Never run two repair cycles concurrently against overlapping queues, and never run
  repair-intake against a queue `lisa:intake` is concurrently draining — the scheduling layer is
  responsible for serialization.
- Stop and surface failures rather than retry-loop.
