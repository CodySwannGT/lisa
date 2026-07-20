---
name: lisa-intake
description: "Vendor-agnostic scanner for Ready queues. Notion PRD database URL → first Ready PRD → lisa-plan. Confluence space or parent page URL → first prd-ready PRD → lisa-plan. Linear workspace URL or team key → first prd-ready project → lisa-plan. GitHub repo URL or `org/repo` token → first prd-ready issue → lisa-plan, or first `status:ready` issue → lisa-implement when `tracker = github`. JIRA project key or JQL filter → first Ready ticket → lisa-implement. On the PRD side it also closes the loop: each cycle rolls a ticketed PRD up to shipped and dispatches lisa-verify-prd for one shipped PRD (shipped → verified on pass; on fail, re-opened shipped → ticketed with build-ready fix tickets that auto-build and re-verify — never blocked). Designed as the cron target for /schedule — one eligible item per invocation, exits cleanly on empty. Symmetric counterpart to the single-item lisa-plan and lisa-implement skills."
allowed-tools: ["Skill", "Bash", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-search", "mcp__atlassian__getConfluencePage", "mcp__atlassian__getConfluenceSpaces", "mcp__atlassian__searchConfluenceUsingCql", "mcp__atlassian__getAccessibleAtlassianResources", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getJiraIssue"]
---

# Intake: $ARGUMENTS

Run one intake cycle against the queue identified by `$ARGUMENTS`, or by merged GitHub config when
the repo argument is omitted and a GitHub source/tracker default is resolvable. Scan for
`Status = Ready`, claim the first eligible item, dispatch it to the appropriate single-item
lifecycle skill, then exit. Remaining Ready items are left for later scheduler invocations.

For build-queue runs, Intake also accepts an optional `assignee=<vendor-user-id-or-login>` filter.
Resolution order is:

1. `$ARGUMENTS` `assignee=<...>`
2. `.lisa.config.local.json` `intake.assignee`
3. empty default

When the resolved assignee is empty, Intake keeps the shared queue behavior and scans any ready
item. When non-empty, it forwards the filter to the vendor build-intake skill so that only ready
items already assigned to that assignee are considered. Intake never assigns or reassigns tickets
as part of this filter.

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked, resolve the explicit or config-backed queue
and run the cycle to completion. The caller (a human at the CLI or a scheduled cron) has already
authorized the run by invoking the skill; re-prompting defeats the purpose of a background batch.

Specifically forbidden:

- Previewing projected scope (number of items, projected ticket counts, write counts) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip / dry-run only" — the documented behavior IS the default. Dry-run is a different skill, not an option here.
- Pausing because the queue is large, items have many open questions, or items are likely to end in `Blocked`. `Blocked` is a valid terminal state of the downstream lifecycles, not a failure mode — routing items to `Blocked` with clarifying comments is success.
- Pausing because validation looks expensive. The cost of one cycle is bounded; the cost of stalling a scheduled cron waiting on a human is unbounded.

The only legitimate reasons to stop early:

- Missing required input (no queue argument **and** no resolvable GitHub default, or missing project
  configuration). Surface the missing value and exit.
- The queue itself is misconfigured (Status property missing expected values, JIRA workflow can't reach required transitions). Surface and exit.
- Empty `Ready` set. Exit cleanly with the idle-case message.

## Orchestration: thin dispatcher (no team of its own)

Intake creates NO agent team and spawns NO named teammates. It is a bounded scanner/dispatcher: resolve the queue, find the first eligible Ready item, claim it, and hand it to the single-item lifecycle skill — all in the current session.

This is deliberate. The per-item lifecycle skills (`lisa-plan` for PRDs, `lisa-implement` for build tickets) are team-first flows: each contains its own orchestration preamble that creates the agent team, records the roster, and fans out specialists. That preamble only has authority when the skill runs in the lead session — a teammate cannot add named teammates (Claude teams are flat: *"Teammates cannot spawn other teammates — the team roster is flat"*), so pushing the lifecycle skill down into a spawned subagent strands it without its team and collapses the flow into the single inline worker every team-first skill forbids. Therefore:

- **Scanning and claiming run inline in this session** (Bash / MCP / vendor skills via the Skill tool). This is cheap, bounded work — it does not need a team.
- **Per-item dispatch is a Skill-tool invocation in this same session — never an `Agent` spawn.** The chain Intake → vendor batch skill → lifecycle skill stays in the lead session end-to-end, so when `lisa-plan` / `lisa-implement` starts, its team-first preamble fires exactly as if the user had invoked it directly: it creates the per-item agent team, records the Roster Decision, and fans out its specialists.
- **Fresh context per item comes from the scheduler, not from subagent isolation.** Intake processes ONE eligible item per invocation and exits; each scheduled invocation is a fresh session. Never claim or process a second item after the first item's lifecycle flow has run in this session — exit and let the next cycle take it with clean context.
- The only permissible `Agent` use inside an Intake cycle is a bounded **anonymous** helper (`Agent` with `name` omitted) for scan-side legwork whose result returns directly to this session — e.g., paging a large queue. Never spawn the lifecycle flow, a vendor lifecycle agent (`jira-agent` / `github-agent` / `linear-agent`), or any implementation worker as a subagent from Intake.

Codex: the same contract applies — run the scan inline in the root session and invoke the lifecycle skill there so it can `multi_agent_v1.spawn_agent` its own team; do not `spawn_agent` the lifecycle flow itself. Other runtimes: apply the same rule through their equivalent delegation surface. If the runtime has no team/subagent tooling at all, the lifecycle skill's own no-team fallback handles it — Intake's job is unchanged.

If a teammate inside an existing team somehow invokes Intake (this should not happen — Intake is a session entry point, not a nested flow), do not scan or claim from there: return a structured `delegation-request` to the team lead asking it to run the Intake cycle in the lead session, and surface the misrouting.

One item per cycle. One team per item, created and owned by the lifecycle skill. A fresh session per cycle, provided by the scheduler.

## Source dispatch

Detect the queue type from `$ARGUMENTS` and route:

| If `$ARGUMENTS` is... | Queue type | Per-item dispatch |
|------------------------|------------|---------------------|
| A Notion **database** URL or database ID | PRD queue (Notion) | Invoke `lisa-notion-prd-intake` (which scans the DB for Status=Ready, claims the first eligible PRD, runs `lisa-plan` via the dry-run validate → branch → write pipeline, then exits) |
| A Confluence **space** URL or space key (e.g. `https://acme.atlassian.net/wiki/spaces/PRD` or `PRD`) | PRD queue (Confluence) | Invoke `lisa-confluence-prd-intake` (which CQL-queries the space for `label = "prd-ready"`, claims the first eligible PRD by relabeling to `prd-in-review`, runs the dry-run validate → branch → write pipeline, then exits) |
| A Confluence **parent page** URL or page ID (the page whose descendants are PRDs) | PRD queue (Confluence, narrowed) | Invoke `lisa-confluence-prd-intake` with the parent ID (CQL: `ancestor = <id> AND label = "prd-ready"`) |
| A Linear **workspace** URL (e.g. `https://linear.app/acme`) | PRD queue (Linear) | Invoke `lisa-linear-prd-intake` (which queries `list_projects({label: "prd-ready"})` across the workspace, claims the first eligible project by relabeling to `prd-in-review`, runs the dry-run validate → branch → write pipeline, then exits) |
| A Linear **team** URL (e.g. `https://linear.app/acme/team/ENG/projects`) or a token already routed as a Linear team key | PRD queue (Linear, narrowed) | Invoke `lisa-linear-prd-intake` with the team key (`list_projects({team, label: "prd-ready"})`) |
| The literal token `linear` | PRD queue (Linear, default workspace) | Invoke `lisa-linear-prd-intake linear` — only valid if `linear.workspace` is configured in `.lisa.config.json` |
| A JIRA project key (e.g. `SE`) | Work queue (JIRA) | Invoke `lisa-jira-build-intake` (which scans the project for Status=Ready, claims the first eligible ticket via In Progress, runs `lisa-implement`, transitions to On Dev on success, then exits) |
| A full JQL filter (e.g. `project = SE AND component = "frontend"`) | Work queue (JIRA, narrowed) | Invoke `lisa-jira-build-intake` with the JQL |
| A GitHub **repository** URL or `org/repo` token (e.g. `https://github.com/acme/product-prds` or `acme/product-prds`) when used for **PRDs** | PRD queue (GitHub) | Invoke `lisa-github-prd-intake` (which queries `gh issue list --label prd-ready`, claims the first eligible PRD by relabeling to `prd-in-review`, runs the dry-run validate → branch → write pipeline, then exits). PRD discovery is independent of the destination tracker — the resulting tickets land wherever `.lisa.config.json` `tracker` says. |
| A GitHub **repository** URL or `org/repo` token when `tracker = github` is configured (build-queue mode) | Work queue (GitHub) | Invoke `lisa-tracker-build-intake` which dispatches to `lisa-github-build-intake` (which queries `gh issue list --label status:ready`, optionally narrows by the resolved assignee filter, claims the first eligible issue via `status:in-progress`, runs `lisa-implement`, relabels to `status:on-dev` on success, then exits). |
| The literal token `github` or omitted GitHub repo when merged config resolves a GitHub source/tracker and identity | Routes by **the `intake_mode` flag** in `$ARGUMENTS` (`prd` or `build`). Build mode defaults to merged `github.queueRepo`, then identity `github.org/github.repo`; PRD mode keeps its existing identity source. If the flag is absent, prefer the PRD queue when both label namespaces are present, otherwise pick whichever exists. | Invoke the matching skill (`lisa-github-prd-intake` or `lisa-tracker-build-intake`). |

Disambiguation rules:

- A `notion.so` / `notion.site` URL → Notion queue.
- An Atlassian Confluence URL containing `/wiki/spaces/<KEY>` with no `/pages/...` segment → Confluence space queue.
- An Atlassian Confluence URL containing `/wiki/spaces/<KEY>/pages/<ID>/...` → Confluence parent-page queue (the page is the parent whose descendants are PRDs). If the user actually meant "this single page is a PRD, plan it", route to `lisa-plan` instead — this skill is batch-only.
- A `linear.app` URL → Linear queue. If the path is `/<workspace>` only or `/<workspace>/team/<KEY>/...`, route here. If the path includes `/project/<slug>-<id>` it's a single-PRD URL — direct the caller to `lisa-plan` instead, this skill is batch-only.
- The literal token `linear` (case-insensitive) → Linear queue, default workspace from `linear.workspace` in `.lisa.config.json`.
- A `github.com` URL or an `<org>/<repo>` token → GitHub queue. The PRD-vs-build dispatch is determined by which label namespace the repo currently uses: PRD-side (`prd-ready`) → `lisa-github-prd-intake`; build-side (`status:ready` and `tracker = github` in `.lisa.config.json`) → `lisa-tracker-build-intake`. If both namespaces are present, prefer the PRD queue unless `$ARGUMENTS` includes `intake_mode=build`. If the URL points at a single issue (`https://github.com/<org>/<repo>/issues/<n>`), this skill is batch-only — direct the caller to `lisa-plan` (for a single PRD issue) or `lisa-implement` (for a single build issue).
- A GitHub URL or `owner/repo` token is an explicit queue and always wins. The literal token
  `github` (case-insensitive), or an omitted repo when merged config resolves a GitHub source/tracker
  and identity, resolves local then global `github.queueRepo`, then identity
  `github.org/github.repo` **for build dispatch**. Normalize a short queueRepo to `github.org`. PRD
  dispatch remains on the configured GitHub PRD source. Without an explicit queue or resolvable
  GitHub default, stop with the missing-input error. Do not use the build queue repo as current-repo
  identity for `repo:<name>` scoping.
- A bare alphanumeric token that matches the JIRA project key regex (uppercase letters / digits / hyphen, ≤10 chars — typically the value of `jira.project` in `.lisa.config.json`) is treated as a JIRA project key by default. A token that does not match the regex is treated as a Confluence space key. If it does not resolve as a Confluence space key either, attempt to resolve as a Linear team key via `lisa-linear-access operation: list-teams({query})` before giving up. The only time to stop and ask is when the token resolves to more than one of {JIRA project, Confluence space, Linear team, GitHub `org/repo`} simultaneously — in that overlap the user must disambiguate which queue to scan.
- An `<org>/<repo>` token (slash-separated, both halves are GitHub-name-shaped) → GitHub queue.
- A string starting with `project = ` or containing JQL operators (`AND`, `OR`, `=`, `!=`, `~`, etc.) → JQL filter.

The single-item skills (`lisa-plan`, `lisa-implement`) and the per-vendor batch skills (`lisa-notion-prd-intake`, `lisa-confluence-prd-intake`, `lisa-linear-prd-intake`, `lisa-github-prd-intake`, `lisa-jira-build-intake`, `lisa-github-build-intake`) are internal — Intake is the public entry point. Developers schedule `/lisa:intake <queue>`; the rest is composition.

## Cycle behavior

1. **Resolve the queue** — fetch the database/project metadata, confirm the Status property/workflow has the expected `Ready` value.
2. **Pre-flight check** — for JIRA, confirm `In Progress` and `On Dev` are reachable transitions before doing any per-ticket work. Stop with a clear error if the workflow is misconfigured.
3. **Find Ready items** — query the queue. Empty → exit cleanly with `"No items with Status=Ready. Nothing to do."` This is the common idle case for a scheduled run.
4. **Process the first eligible Ready item only** (claim-first ordering for idempotency):
   - Notion PRDs → `lisa-notion-prd-intake` handles per-item: claim (Status=In Review), dry-run validate, branch to Blocked or Ticketed, coverage audit
   - Confluence PRDs → `lisa-confluence-prd-intake` handles per-item: claim (relabel to `prd-in-review`), dry-run validate, branch to `prd-blocked` or `prd-ticketed`, coverage audit
   - Linear PRDs → `lisa-linear-prd-intake` handles per-item: claim (relabel project to `prd-in-review`), dry-run validate, branch to `prd-blocked` or `prd-ticketed` (with a sentinel feedback issue under each project hosting clarifying-question comments), coverage audit
   - GitHub PRDs → `lisa-github-prd-intake` handles per-item: claim (relabel issue to `prd-in-review`), dry-run validate, branch to `prd-blocked` or `prd-ticketed` (with clarifying-question comments posted directly on the PRD issue), coverage audit
   - JIRA tickets → `lisa-jira-build-intake` handles per-item: claim, dispatch to `lisa-jira-agent`, transition to On Dev on success
   - GitHub build issues (when `tracker = github`) → `lisa-tracker-build-intake` → `lisa-github-build-intake` handles per-item: optional ready-queue assignee filtering, claim (relabel to `status:in-progress`), dispatch to `lisa-github-agent`, relabel to `status:on-dev` on success
   - Duplicate-already-fixed build tickets are the one build-intake closeout exception: when `ticket-triage` returns `DUPLICATE_ALREADY_FIXED` with a canonical item and empirical base-branch evidence, the vendor build-intake skill closes the claimed ticket as a duplicate without opening a PR. This does not apply to `BLOCKED`, ambiguous, duplicate-of-open, or otherwise human-owned terminal dispositions.
   - **Closing the PRD loop:** beyond claiming one Ready PRD, every PRD scanner also runs the closure rollup (`ticketed → shipped`, Phase 3f) and **dispatches `lisa-verify-prd` for one shipped PRD** (Phase 3g) each cycle — so a shipped PRD does not sit unverified. On pass the PRD goes `shipped → verified`; on fail it is re-opened `shipped → ticketed` with **build-ready fix tickets** that auto-build and trigger a re-verify (never `blocked`). The scanner only dispatches; `lisa-verify-prd` owns the transition (per the `prd-lifecycle-rollup` rule's "Closing the loop" section), and the self-healing loop continues until the PRD verifies.
5. **Stop after one item** — a claimed Ready item, a safe-blocked container, or a per-item error ends the *ready-claim* portion of the cycle. The per-vendor PRD scanner still runs its rollup and one verify-prd dispatch. Remaining Ready items stay untouched for later scheduler invocations.
6. **Summary report** — the single processed/skipped/error item, total processed, total errors. Before returning, record intake usage on the persisted cycle-summary artifact via `lisa-usage-accounting` so the summary carries a direct `lisa-intake` entry in the canonical `## Lisa Usage` section. If the claimed / skipped work item's parent-child graph is already known, prefer `record_and_rollup` so ancestor totals refresh in the same cycle; otherwise still write the direct entry, and if runtime usage is unavailable, use `source: unavailable` with nullable token/cost fields instead of skipping the row.

## Run outcome

As a registered automation loop, each Intake cycle conforms to the `automation-runbook-contract`
rule: it ends in **exactly one** of the six run outcomes and records it, so a quiet queue and a
broken loop never look alike. Intake backs **two** registered loop-ids — record under the one that
matches the mode this cycle ran in: **`intake-prd`** (PRD-side dispatch) or **`intake-tickets`**
(build-queue dispatch).

| This cycle's exit path | Run outcome |
|---|---|
| Empty `Ready` set — the idle case (step 3), nothing to claim | `nothing-needed` |
| A PRD routed to `Blocked` (clarifying questions) or `Ticketed`; a build ticket claimed and dispatched | `candidate-proposed` |
| A build cycle that shipped and verified (merged PR + evidence), or a shipped PRD moved to `verified` | `change-proved` |
| A protected deployment (or other autonomy boundary the lifecycle hits) waiting on a human approval | `approval-requested` |
| The queue itself is misconfigured or unreadable — missing required input (step 1) or an unreachable Status/workflow (step 2/`3` misconfig) so the cycle could not run | `recovery-required` |
| The runbook's **Retirement condition** tripped | `policy-obsolete` — **never reached by design for either intake loop-id** (see Retirement evaluation below) |

**Seam warning (the #1 misread in this ticket).** A run outcome describes this *cycle*; `Blocked` is
a *work item's* lifecycle terminal state — the two never merge in the summary. When Intake correctly
routes to `Blocked` (an item whose requirements are unresolvable, carrying clarifying questions), the
cycle **produced something**, so it is a successful run — `candidate-proposed`, and **never
`recovery-required`** (the machinery is not broken) and **never `nothing-needed`** (the run did not
find nothing). The summary must say both plainly: the item was blocked *and* the run succeeded.

Record **exactly one** outcome per invocation through the run-record CLI, naming this loop's runbook
(the `--summary` is the operator-readable one-liner in the contract's exemplar voice — plain,
specific, actionable, e.g. `Scanned 12 ready items; nothing to propose.` for `nothing-needed`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/automation-run-record.mjs" \
  --loop-id intake-tickets --outcome candidate-proposed \
  --summary "Routed PRD #1810 to Blocked with clarifying questions; the run succeeded." \
  --runbook .lisa/automations/intake-tickets.runbook.md [--ref <item-url>]...
```

If `${CLAUDE_PLUGIN_ROOT}` is unset, resolve the plugin scripts directory directly — the built copy
`plugins/lisa/scripts/automation-run-record.mjs` or the source
`plugins/src/base/scripts/automation-run-record.mjs`. If recording still fails, **degrade, never
abort** (per `automation-runbook-contract`): note the recording failure in the run output and finish
the cycle — a recording failure is a degradation to report, never a reason to block the loop.

**Retirement evaluation (every run).** Both loop-ids this skill backs are **structural to the
factory — they do not retire.** Their runbooks say so plainly instead of leaving the Retirement
condition blank, so the `automation-runbook-contract` rule's two-part retirement test never fires
here: neither `intake-prd` nor `intake-tickets` ever records `policy-obsolete`, and neither ever
files a teardown proposal. An operator who wants intake to stop runs `/lisa:tear-down-automations`
themselves — the loop never removes its own registration.

## Schedule examples

```text
/schedule "every 30 minutes" /lisa:intake https://www.notion.so/<workspace>/<database-id>
/schedule "every 30 minutes" /lisa:intake https://acme.atlassian.net/wiki/spaces/PRD
/schedule "every 30 minutes" /lisa:intake https://linear.app/acme
/schedule "every 30 minutes" /lisa:intake https://linear.app/acme/team/ENG/projects
/schedule "every 30 minutes" /lisa:intake https://github.com/acme/product-prds
/schedule "every 30 minutes" /lisa:intake acme/product-prds
/schedule "every 30 minutes" /lisa:intake SE
/schedule "every 30 minutes" /lisa:intake acme/frontend-v2 intake_mode=build
/schedule "every 30 minutes" /lisa:intake acme/frontend-v2 intake_mode=build assignee=codyswanngt
/schedule "every hour" /lisa:intake "project = SE AND component = 'frontend'"
```

## Rules

- Never run a cycle without an explicit queue. Side effects too high to default.
- Never modify the source/destination lifecycles directly — Intake delegates per-item to the vendor adapter, which owns status transitions.
- Never run two Intake cycles concurrently against overlapping queues — concurrent claims could race. The scheduling layer is responsible for serialization.
- Stop and surface failures rather than retry-loop.
