---
name: intake
description: "Vendor-agnostic batch scanner for Ready queues. Given a Notion PRD database URL → finds Ready PRDs and runs lisa:plan per item. Given a Confluence space or parent page URL → finds prd-ready PRDs and runs lisa:plan per item. Given a JIRA project key or JQL filter → finds Ready tickets and runs lisa:implement per item. Designed as the cron target for /schedule — one cycle per invocation, processes everything currently Ready, exits cleanly on empty. Symmetric counterpart to the single-item lisa:plan and lisa:implement skills."
allowed-tools: ["Skill", "Bash", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-search", "mcp__atlassian__getConfluencePage", "mcp__atlassian__getConfluenceSpaces", "mcp__atlassian__searchConfluenceUsingCql", "mcp__atlassian__getAccessibleAtlassianResources", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getJiraIssue"]
---

# Intake: $ARGUMENTS

Run one batch-intake cycle against the queue identified by `$ARGUMENTS`. Scans for `Status = Ready`, claims each item, and dispatches to the appropriate single-item lifecycle skill.

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

If you are NOT already operating inside an agent team (no prior `TeamCreate` in this session, not spawned via `Agent` with `team_name`), your FIRST tool call MUST be `TeamCreate`. Do not call `TaskCreate`, `Agent`, or implementation tools before the team exists.

If you ARE already inside an agent team (e.g., a teammate invoked this skill via the Skill tool), do NOT call `TeamCreate` — the harness rejects double-creates. Continue within the existing team. The team lead created the team; teammates inherit it.

The cycle's outer team is created by Intake. Each item it processes (a PRD via `lisa:plan`, a ticket via `lisa:implement`) executes within the same team — those skills' orchestration preambles detect the existing team and skip TeamCreate. One team per cron cycle, processes everything currently Ready.

## Source dispatch

Detect the queue type from `$ARGUMENTS` and route:

| If `$ARGUMENTS` is... | Queue type | Per-item dispatch |
|------------------------|------------|---------------------|
| A Notion **database** URL or database ID | PRD queue (Notion) | Invoke `lisa:notion-prd-intake` (which scans the DB for Status=Ready, claims each, runs `lisa:plan` per PRD via the dry-run validate → branch → write pipeline) |
| A Confluence **space** URL or space key (e.g. `https://acme.atlassian.net/wiki/spaces/PRD` or `PRD`) | PRD queue (Confluence) | Invoke `lisa:confluence-prd-intake` (which CQL-queries the space for `label = "prd-ready"`, claims each by relabeling to `prd-in-review`, runs the dry-run validate → branch → write pipeline) |
| A Confluence **parent page** URL or page ID (the page whose descendants are PRDs) | PRD queue (Confluence, narrowed) | Invoke `lisa:confluence-prd-intake` with the parent ID (CQL: `ancestor = <id> AND label = "prd-ready"`) |
| A JIRA project key (e.g. `SE`) | Work queue (JIRA) | Invoke `lisa:jira-build-intake` (which scans the project for Status=Ready, claims each via In Progress, runs `lisa:implement` per ticket, transitions to On Dev on success) |
| A full JQL filter (e.g. `project = SE AND component = "frontend"`) | Work queue (JIRA, narrowed) | Invoke `lisa:jira-build-intake` with the JQL |
| A Linear / GitHub Issues queue | Not yet implemented | Stop and report — no `linear-tracker` or `github-tracker` adapter has been built. Don't fall back. |

Disambiguation rules:

- A `notion.so` / `notion.site` URL → Notion queue.
- An Atlassian Confluence URL containing `/wiki/spaces/<KEY>` with no `/pages/...` segment → Confluence space queue.
- An Atlassian Confluence URL containing `/wiki/spaces/<KEY>/pages/<ID>/...` → Confluence parent-page queue (the page is the parent whose descendants are PRDs). If the user actually meant "this single page is a PRD, plan it", route to `lisa:plan` instead — this skill is batch-only.
- A bare alphanumeric token that matches the configured `JIRA_PROJECT` regex (uppercase letters / digits / hyphen, ≤10 chars) is treated as a JIRA project key by default. A token that does not match the regex is treated as a Confluence space key. The only time to stop and ask is when the token matches the JIRA_PROJECT regex AND is also a confirmed reachable Confluence space key (verified via Atlassian API) — in that specific overlap the user must disambiguate which queue to scan.
- A string starting with `project = ` or containing JQL operators (`AND`, `OR`, `=`, `!=`, `~`, etc.) → JQL filter.

The single-item skills (`lisa:plan`, `lisa:implement`) and the per-vendor batch skills (`lisa:notion-prd-intake`, `lisa:confluence-prd-intake`, `lisa:jira-build-intake`) are internal — Intake is the public entry point. Developers schedule `/lisa:intake <queue>`; the rest is composition.

## Cycle behavior

1. **Resolve the queue** — fetch the database/project metadata, confirm the Status property/workflow has the expected `Ready` value.
2. **Pre-flight check** — for JIRA, confirm `In Progress` and `On Dev` are reachable transitions before doing any per-ticket work. Stop with a clear error if the workflow is misconfigured.
3. **Find Ready items** — query the queue. Empty → exit cleanly with `"No items with Status=Ready. Nothing to do."` This is the common idle case for a scheduled run.
4. **Process each Ready item serially** (claim-first ordering for idempotency):
   - Notion PRDs → `lisa:notion-prd-intake` handles per-item: claim (Status=In Review), dry-run validate, branch to Blocked or Ticketed, coverage audit
   - Confluence PRDs → `lisa:confluence-prd-intake` handles per-item: claim (relabel to `prd-in-review`), dry-run validate, branch to `prd-blocked` or `prd-ticketed`, coverage audit
   - JIRA tickets → `lisa:jira-build-intake` handles per-item: claim, dispatch to `lisa:jira-agent`, transition to On Dev on success
5. **Failure isolation** — one item failing does not stop the cycle; record under "Errors" and continue.
6. **Summary report** — per-item outcomes, total processed, total errors.

## Schedule examples

```text
/schedule "every 30 minutes" /lisa:intake https://www.notion.so/<workspace>/<database-id>
/schedule "every 30 minutes" /lisa:intake https://acme.atlassian.net/wiki/spaces/PRD
/schedule "every 30 minutes" /lisa:intake SE
/schedule "every hour" /lisa:intake "project = SE AND component = 'frontend'"
```

## Rules

- Never run a cycle without an explicit queue. Side effects too high to default.
- Never modify the source/destination lifecycles directly — Intake delegates per-item to the vendor adapter, which owns status transitions.
- Never run two Intake cycles concurrently against overlapping queues — concurrent claims could race. The scheduling layer is responsible for serialization.
- Stop and surface failures rather than retry-loop.
