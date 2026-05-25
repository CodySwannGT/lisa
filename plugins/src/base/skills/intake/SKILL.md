---
name: intake
description: "Vendor-agnostic scanner for Ready queues. Given a Notion PRD database URL → finds the first Ready PRD and runs lisa:plan. Given a Confluence space or parent page URL → finds the first prd-ready PRD and runs lisa:plan. Given a Linear workspace URL or team key → finds the first prd-ready Linear project and runs lisa:plan. Given a GitHub repo URL or `org/repo` token → finds the first prd-ready GitHub issue and runs lisa:plan. Given a JIRA project key or JQL filter → finds the first Ready ticket and runs lisa:implement. Given a GitHub repo URL or `org/repo` token when `tracker = github` → finds the first `status:ready` issue and runs lisa:implement. On the PRD side it also closes the loop: each cycle rolls a ticketed PRD up to shipped and dispatches lisa:verify-prd for one shipped PRD (shipped → verified on pass; on fail, re-opened shipped → ticketed with build-ready fix tickets that auto-build and re-verify — never blocked). Designed as the cron target for /schedule — one eligible item per invocation, exits cleanly on empty. Symmetric counterpart to the single-item lisa:plan and lisa:implement skills."
allowed-tools: ["Skill", "Bash", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-search", "mcp__atlassian__getConfluencePage", "mcp__atlassian__getConfluenceSpaces", "mcp__atlassian__searchConfluenceUsingCql", "mcp__atlassian__getAccessibleAtlassianResources", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getJiraIssue", "mcp__linear-server__list_projects", "mcp__linear-server__list_teams", "mcp__linear-server__list_project_labels"]
---

# Intake: $ARGUMENTS

Run one intake cycle against the queue identified by `$ARGUMENTS`. Scans for `Status = Ready`, claims the first eligible item, dispatches it to the appropriate single-item lifecycle skill, then exits. Remaining Ready items are left for later scheduler invocations.

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

Do NOT ask the caller whether to proceed. Once invoked with a queue, run the cycle to completion. The caller (a human at the CLI or a scheduled cron) has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background batch.

Specifically forbidden:

- Previewing projected scope (number of items, projected ticket counts, write counts) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip / dry-run only" — the documented behavior IS the default. Dry-run is a different skill, not an option here.
- Pausing because the queue is large, items have many open questions, or items are likely to end in `Blocked`. `Blocked` is a valid terminal state of the downstream lifecycles, not a failure mode — routing items to `Blocked` with clarifying comments is success.
- Pausing because validation looks expensive. The cost of one cycle is bounded; the cost of stalling a scheduled cron waiting on a human is unbounded.

The only legitimate reasons to stop early:

- Missing required input (no queue argument, missing project configuration). Surface the missing value and exit.
- The queue itself is misconfigured (Status property missing expected values, JIRA workflow can't reach required transitions). Surface and exit.
- Empty `Ready` set. Exit cleanly with the idle-case message.

## Orchestration: agent team

If you are NOT already operating inside an agent team (no prior successful team-creation or subagent-delegation tool call in this session, not spawned into a team context), the very first thing you do is establish team orchestration.

Use the team tool for the current runtime:

- Claude: use `TeamCreate`. If `TeamCreate` has not been loaded yet, first use `ToolSearch` with `query: "select:TeamCreate"` to load its schema.
- Codex: do not call `TeamCreate`; Codex does not expose that Claude tool. Use `tool_search` with a query like `multi-agent tools` to load `multi_agent_v1`, then use `multi_agent_v1.spawn_agent` for teammate delegation. Treat the first successful `spawn_agent` call as establishing team orchestration.
- Other runtimes: use the current runtime's tool-discovery mechanism to discover and call the appropriate multi-agent/team tool.

If no team creation or subagent delegation tool is available, explicitly state that team orchestration is unavailable in this runtime, continue as the lead agent, and preserve the workflow's review, verification, and task-tracking obligations locally.

Until the team is established, the first Codex teammate has been spawned, or the no-team fallback has been declared, do NOT call any of: `Agent`, `TaskCreate`, `Skill`, MCP tools (Atlassian / Linear / GitHub / Notion), `Read`, `Write`, `Edit`, `Bash`, `Grep`, `Glob`. Scanning the queue, claiming items, dispatching per-item flows — all of those are tasks for the team you are about to create, not for the lead session before orchestration exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT create a second team — many harnesses reject double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

The cycle's outer team is created by Intake. The one item it processes (a PRD via `lisa:plan`, a ticket via `lisa:implement`) executes within that team — those skills' orchestration preambles detect the existing team and skip creating a second team. One team per cron cycle, one eligible Ready item per cycle.

## Source dispatch

Detect the queue type from `$ARGUMENTS` and route:

| If `$ARGUMENTS` is... | Queue type | Per-item dispatch |
|------------------------|------------|---------------------|
| A Notion **database** URL or database ID | PRD queue (Notion) | Invoke `lisa:notion-prd-intake` (which scans the DB for Status=Ready, claims the first eligible PRD, runs `lisa:plan` via the dry-run validate → branch → write pipeline, then exits) |
| A Confluence **space** URL or space key (e.g. `https://acme.atlassian.net/wiki/spaces/PRD` or `PRD`) | PRD queue (Confluence) | Invoke `lisa:confluence-prd-intake` (which CQL-queries the space for `label = "prd-ready"`, claims the first eligible PRD by relabeling to `prd-in-review`, runs the dry-run validate → branch → write pipeline, then exits) |
| A Confluence **parent page** URL or page ID (the page whose descendants are PRDs) | PRD queue (Confluence, narrowed) | Invoke `lisa:confluence-prd-intake` with the parent ID (CQL: `ancestor = <id> AND label = "prd-ready"`) |
| A Linear **workspace** URL (e.g. `https://linear.app/acme`) | PRD queue (Linear) | Invoke `lisa:linear-prd-intake` (which queries `list_projects({label: "prd-ready"})` across the workspace, claims the first eligible project by relabeling to `prd-in-review`, runs the dry-run validate → branch → write pipeline, then exits) |
| A Linear **team** URL (e.g. `https://linear.app/acme/team/ENG/projects`) or a token already routed as a Linear team key | PRD queue (Linear, narrowed) | Invoke `lisa:linear-prd-intake` with the team key (`list_projects({team, label: "prd-ready"})`) |
| The literal token `linear` | PRD queue (Linear, default workspace) | Invoke `lisa:linear-prd-intake linear` — only valid if `linear.workspace` is configured in `.lisa.config.json` |
| A JIRA project key (e.g. `SE`) | Work queue (JIRA) | Invoke `lisa:jira-build-intake` (which scans the project for Status=Ready, claims the first eligible ticket via In Progress, runs `lisa:implement`, transitions to On Dev on success, then exits) |
| A full JQL filter (e.g. `project = SE AND component = "frontend"`) | Work queue (JIRA, narrowed) | Invoke `lisa:jira-build-intake` with the JQL |
| A GitHub **repository** URL or `org/repo` token (e.g. `https://github.com/acme/product-prds` or `acme/product-prds`) when used for **PRDs** | PRD queue (GitHub) | Invoke `lisa:github-prd-intake` (which queries `gh issue list --label prd-ready`, claims the first eligible PRD by relabeling to `prd-in-review`, runs the dry-run validate → branch → write pipeline, then exits). PRD discovery is independent of the destination tracker — the resulting tickets land wherever `.lisa.config.json` `tracker` says. |
| A GitHub **repository** URL or `org/repo` token when `tracker = github` is configured (build-queue mode) | Work queue (GitHub) | Invoke `lisa:tracker-build-intake` which dispatches to `lisa:github-build-intake` (which queries `gh issue list --label status:ready`, optionally narrows by the resolved assignee filter, claims the first eligible issue via `status:in-progress`, runs `lisa:implement`, relabels to `status:on-dev` on success, then exits). |
| The literal token `github` | Defaults to `.lisa.config.json` `github.org` / `github.repo`. Routes by **the `intake_mode` flag** in `$ARGUMENTS` (`prd` or `build`); if the flag is absent, prefer the PRD queue when both label namespaces are present, otherwise pick whichever exists. | Invoke the matching skill (`lisa:github-prd-intake` or `lisa:tracker-build-intake`). |

Disambiguation rules:

- A `notion.so` / `notion.site` URL → Notion queue.
- An Atlassian Confluence URL containing `/wiki/spaces/<KEY>` with no `/pages/...` segment → Confluence space queue.
- An Atlassian Confluence URL containing `/wiki/spaces/<KEY>/pages/<ID>/...` → Confluence parent-page queue (the page is the parent whose descendants are PRDs). If the user actually meant "this single page is a PRD, plan it", route to `lisa:plan` instead — this skill is batch-only.
- A `linear.app` URL → Linear queue. If the path is `/<workspace>` only or `/<workspace>/team/<KEY>/...`, route here. If the path includes `/project/<slug>-<id>` it's a single-PRD URL — direct the caller to `lisa:plan` instead, this skill is batch-only.
- The literal token `linear` (case-insensitive) → Linear queue, default workspace from `linear.workspace` in `.lisa.config.json`.
- A `github.com` URL or an `<org>/<repo>` token → GitHub queue. The PRD-vs-build dispatch is determined by which label namespace the repo currently uses: PRD-side (`prd-ready`) → `lisa:github-prd-intake`; build-side (`status:ready` and `tracker = github` in `.lisa.config.json`) → `lisa:tracker-build-intake`. If both namespaces are present, prefer the PRD queue unless `$ARGUMENTS` includes `intake_mode=build`. If the URL points at a single issue (`https://github.com/<org>/<repo>/issues/<n>`), this skill is batch-only — direct the caller to `lisa:plan` (for a single PRD issue) or `lisa:implement` (for a single build issue).
- The literal token `github` (case-insensitive) → GitHub queue, default repo from `.lisa.config.json` `github.org` / `github.repo`.
- A bare alphanumeric token that matches the JIRA project key regex (uppercase letters / digits / hyphen, ≤10 chars — typically the value of `jira.project` in `.lisa.config.json`) is treated as a JIRA project key by default. A token that does not match the regex is treated as a Confluence space key. If it does not resolve as a Confluence space key either, attempt to resolve as a Linear team key via `mcp__linear-server__list_teams({query})` before giving up. The only time to stop and ask is when the token resolves to more than one of {JIRA project, Confluence space, Linear team, GitHub `org/repo`} simultaneously — in that overlap the user must disambiguate which queue to scan.
- An `<org>/<repo>` token (slash-separated, both halves are GitHub-name-shaped) → GitHub queue.
- A string starting with `project = ` or containing JQL operators (`AND`, `OR`, `=`, `!=`, `~`, etc.) → JQL filter.

The single-item skills (`lisa:plan`, `lisa:implement`) and the per-vendor batch skills (`lisa:notion-prd-intake`, `lisa:confluence-prd-intake`, `lisa:linear-prd-intake`, `lisa:github-prd-intake`, `lisa:jira-build-intake`, `lisa:github-build-intake`) are internal — Intake is the public entry point. Developers schedule `/lisa:intake <queue>`; the rest is composition.

## Cycle behavior

1. **Resolve the queue** — fetch the database/project metadata, confirm the Status property/workflow has the expected `Ready` value.
2. **Pre-flight check** — for JIRA, confirm `In Progress` and `On Dev` are reachable transitions before doing any per-ticket work. Stop with a clear error if the workflow is misconfigured.
3. **Find Ready items** — query the queue. Empty → exit cleanly with `"No items with Status=Ready. Nothing to do."` This is the common idle case for a scheduled run.
4. **Process the first eligible Ready item only** (claim-first ordering for idempotency):
   - Notion PRDs → `lisa:notion-prd-intake` handles per-item: claim (Status=In Review), dry-run validate, branch to Blocked or Ticketed, coverage audit
   - Confluence PRDs → `lisa:confluence-prd-intake` handles per-item: claim (relabel to `prd-in-review`), dry-run validate, branch to `prd-blocked` or `prd-ticketed`, coverage audit
   - Linear PRDs → `lisa:linear-prd-intake` handles per-item: claim (relabel project to `prd-in-review`), dry-run validate, branch to `prd-blocked` or `prd-ticketed` (with a sentinel feedback issue under each project hosting clarifying-question comments), coverage audit
   - GitHub PRDs → `lisa:github-prd-intake` handles per-item: claim (relabel issue to `prd-in-review`), dry-run validate, branch to `prd-blocked` or `prd-ticketed` (with clarifying-question comments posted directly on the PRD issue), coverage audit
   - JIRA tickets → `lisa:jira-build-intake` handles per-item: claim, dispatch to `lisa:jira-agent`, transition to On Dev on success
   - GitHub build issues (when `tracker = github`) → `lisa:tracker-build-intake` → `lisa:github-build-intake` handles per-item: optional ready-queue assignee filtering, claim (relabel to `status:in-progress`), dispatch to `lisa:github-agent`, relabel to `status:on-dev` on success
   - **Closing the PRD loop:** beyond claiming one Ready PRD, every PRD scanner also runs the closure rollup (`ticketed → shipped`, Phase 3f) and **dispatches `lisa:verify-prd` for one shipped PRD** (Phase 3g) each cycle — so a shipped PRD does not sit unverified. On pass the PRD goes `shipped → verified`; on fail it is re-opened `shipped → ticketed` with **build-ready fix tickets** that auto-build and trigger a re-verify (never `blocked`). The scanner only dispatches; `lisa:verify-prd` owns the transition (per the `prd-lifecycle-rollup` rule's "Closing the loop" section), and the self-healing loop continues until the PRD verifies.
5. **Stop after one item** — a claimed Ready item, a safe-blocked container, or a per-item error ends the *ready-claim* portion of the cycle. The per-vendor PRD scanner still runs its rollup and one verify-prd dispatch. Remaining Ready items stay untouched for later scheduler invocations.
6. **Summary report** — the single processed/skipped/error item, total processed, total errors.

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
