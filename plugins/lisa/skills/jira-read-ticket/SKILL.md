---
name: jira-read-ticket
description: "Fetches the full scope of a JIRA ticket — metadata, description, acceptance criteria, all comments, remote links (PRs, Confluence, dashboards), issue links (blocks/is blocked by/relates to/duplicates/clones), epic parent with siblings, and subtasks. Produces a consolidated context bundle that downstream agents consume so they never act on a single ticket in isolation."
allowed-tools: ["Bash", "mcp__atlassian__getJiraIssue", "mcp__atlassian__getJiraIssueRemoteIssueLinks", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getAccessibleAtlassianResources"]
---

# Read JIRA Ticket: $ARGUMENTS

Fetch the full scope of the ticket AND its related graph. Downstream agents must never act on a ticket in isolation — always call this skill first so they see blockers, epic siblings, linked PRs, and historical comments.

Repository name for scoped comments and logs: `basename $(git rev-parse --show-toplevel)`.

## Phase 1 — Resolve Context

1. Call `mcp__atlassian__getAccessibleAtlassianResources` to get the cloud ID.
2. If $ARGUMENTS is not a ticket key (e.g. `PROJ-123`), stop and report. Do NOT guess.

## Phase 2 — Fetch Primary Ticket

Call `mcp__atlassian__getJiraIssue` for the target ticket. Extract and preserve:

### Metadata

- Key, summary, issue type, status, resolution
- Priority, assignee, reporter, creator
- Labels, components, fix versions, affects versions
- Sprint, story points, original/remaining estimate
- Created, updated, resolved dates
- Parent (epic link or parent issue)
- Custom fields relevant to the project (read every custom field — do not filter)

### Body

- Full description (preserve formatting)
- Acceptance criteria section if separately structured
- **Validation Journey** section if present (pass verbatim to downstream)
- Attachments list — capture `id`, `filename`, `mimeType`, `size`, and `content` URL for each. Do not download unless a downstream task needs the bytes (see "Downloading attachments" below).

#### Downloading attachments (opt-in)

The Atlassian MCP exposes attachment metadata but no binary-fetch tool ([JRACLOUD-97830](https://jira.atlassian.com/browse/JRACLOUD-97830), [ECO-1265](https://jira.atlassian.com/browse/ECO-1265)). Fetch attachment bytes only when a downstream task explicitly needs them — e.g., a design-fidelity check on an image, log-file analysis, PDF text extraction. For everything else, keep the URL reference and move on.

```bash
bash .claude/skills/jira-read-ticket/scripts/download-attachment.sh <id-or-content-url> <output-path>
```

Requires `JIRA_SERVER`, `JIRA_LOGIN`, and `JIRA_API_TOKEN` in the environment (same contract as `jira-evidence`). If those are not set the helper exits with code 2 and a clear remediation message — record the URL only and continue.

After download, branch on `mimeType`:
- `image/*` — pass the local path to image-aware downstream tools
- `text/*`, `application/json`, `application/xml`, `application/x-yaml` — read inline as text
- `application/pdf` — extract text via downstream tooling if needed
- everything else — record path only; do not attempt to inline binary content

### Comments

Fetch ALL comments in chronological order. Do not truncate. For each:
- Author, timestamp, body
- Flag comments that contain: credentials, reproduction steps, status updates from stakeholders, decisions, or triage headers like `[repo-name]`

## Phase 3 — Fetch Remote Links

Call `mcp__atlassian__getJiraIssueRemoteIssueLinks`. For each remote link:

- **GitHub PR or commit** (`github.com/.../(pull|commit)/...`): run `gh pr view <url> --json title,state,body,mergedAt,reviewDecision,comments,reviews` (for PRs) or `gh api repos/<owner>/<repo>/commits/<sha>` (for commits). Capture title, state, body, unresolved review comments, merge status.
- **Confluence page**: capture title and URL. Do not fetch body unless a downstream task explicitly needs it.
- **Dashboard, log link, or external URL**: capture title and URL only.

If `gh` is not authenticated, note "gh auth required" and continue — do not abort.

## Phase 4 — Fetch Issue Links (Relationships)

Every linked ticket must be fetched. Do not skip any link type. For each link in the primary ticket's `issuelinks` field, group by type:

- `blocks` / `is blocked by`
- `relates to`
- `duplicates` / `is duplicated by`
- `clones` / `is cloned by`
- Any other custom link types configured in the project

For each linked ticket, call `mcp__atlassian__getJiraIssue` and capture:

- Key, summary, type, status, resolution
- Description (full, unless closed with resolution `Won't Do`/`Duplicate` — then summary only)
- Acceptance criteria
- Last 10 comments (chronological)
- Remote links (PR URLs and state only — skip deep fetch unless the link is `blocks` or `is blocked by`)

**Special handling for `is blocked by`:** fetch the full PR/commit details via `gh` for each blocker's remote links so the agent knows whether the blocker is actually shipped.

## Phase 5 — Fetch Epic Context

If the primary ticket has an epic parent (or IS an epic):

1. Fetch the epic itself via `mcp__atlassian__getJiraIssue` — full description, acceptance criteria, all comments, Validation Journey.
2. Find epic siblings via JQL:
   ```jql
   "Epic Link" = <EPIC-KEY> AND key != <TICKET-KEY>
   ```
   Use `mcp__atlassian__searchJiraIssuesUsingJql`. For each sibling capture: key, summary, type, status, assignee, priority.
3. Read each sibling's description at a SUMMARY level (first paragraph only) — the goal is to surface related in-flight work, not duplicate full content. If a sibling is `In Progress` or `In Review` with an assignee different from the current ticket, flag it prominently.

If the primary ticket IS an epic, also fetch all children via the JQL above.

## Phase 6 — Fetch Subtasks

If the primary ticket has subtasks, fetch each via `mcp__atlassian__getJiraIssue`: key, summary, type, status, assignee, description (first paragraph), acceptance criteria.

## Phase 7 — Assemble Context Bundle

Produce a single structured output that the caller can pass verbatim to downstream agents. Use this format:

```text
# Ticket Context: <KEY>

## Primary Ticket
- Key: <KEY>
- Type: <type>
- Status: <status>
- Priority: <priority>
- Assignee: <name>
- Epic: <epic-key> — <epic-summary>
- Sprint: <sprint>
- Labels: <labels>
- Components: <components>

### Description
<full description>

### Acceptance Criteria
<criteria>

### Validation Journey
<section or "None">

### Comments (<count>)
<chronological comments, flagged items called out>

### Attachments
<list with id, filename, mimeType, size, content URL — note any that were downloaded and their local paths>

## Remote Links
### Pull Requests (<count>)
- <url> — <title> — <state> — <reviewDecision>
  <body summary + unresolved review comments>

### Confluence
- <title> — <url>

### Other
- <title> — <url>

## Issue Links
### Blocks (<count>)
<per-ticket block>

### Is Blocked By (<count>)
<per-ticket block with PR state>

### Relates To (<count>)
<per-ticket block>

### Duplicates / Clones
<per-ticket block>

## Epic Context
### Epic <EPIC-KEY> — <summary>
- Status: <status>
- Description: <full>
- Comments: <chronological>
- Validation Journey: <section or None>

### Siblings In-Flight (<count>)
- <KEY> — <status> — <assignee> — <summary>  **[FLAG: in progress by other assignee]**

### Other Siblings (<count>)
- <KEY> — <status> — <summary>

## Subtasks (<count>)
- <KEY> — <status> — <assignee> — <summary>

## Summary for Downstream
- Full ticket count pulled: <N>
- Blockers still open: <list>
- Related in-flight work: <list>
- Relevant PRs: <list with state>
```

## Rules

- Never summarize or truncate the primary ticket's description or Validation Journey.
- Never skip a link type, even if it seems unrelated — the agent downstream decides relevance.
- If a linked ticket returns an access error, capture the error and continue. Do not abort the read.
- Flag in-flight sibling work prominently so the caller can avoid duplicate implementation.
- If the ticket has no epic parent, state this explicitly — do not silently skip Phase 5.
- Output is pure context. This skill never modifies the ticket.
