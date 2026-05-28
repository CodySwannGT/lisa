---
name: linear-read-issue
description: "Fetches the full scope of a Linear work item — Issue or Project — including metadata, description, acceptance criteria, all comments, attachments, native relations (blocks/blocked_by/relates_to/duplicates), Project parent (if any) with siblings, and sub-Issues. Produces a consolidated context bundle that downstream agents consume so they never act on a single item in isolation."
allowed-tools: ["Bash", "Skill", "mcp__linear-server__list_teams", "mcp__linear-server__get_issue", "mcp__linear-server__get_project", "mcp__linear-server__list_issues", "mcp__linear-server__list_comments", "mcp__linear-server__list_documents", "mcp__linear-server__get_document"]
---

# Read Linear Work Item: $ARGUMENTS

Fetch the full scope of the item AND its related graph. Downstream agents must never act on an item in isolation — always call this skill first so they see blockers, project siblings, linked PRs, and historical comments.

This skill is the destination of the `lisa:tracker-read` shim when `tracker = "linear"`. Read-only.

Repository name for scoped comments and logs: `basename $(git rev-parse --show-toplevel)`.

## Configuration

Reads `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).

## Phase 1 — Resolve Context

1. If `$ARGUMENTS` matches `<TEAM>-<n>` → Issue mode.
2. If `$ARGUMENTS` is a URL containing `/project/<slug>-<short-id>` → Project mode (extract `<short-id>`).
3. Otherwise stop and report. Do NOT guess.
4. Resolve team ID via `mcp__linear-server__list_teams({query: <teamKey>})`.

## Phase 2 — Fetch Primary Item

### Issue mode

Call `mcp__linear-server__get_issue`. Extract and preserve:

**Metadata**
- Identifier, title, issue type (typically a label or workflow state), state, priority (0–4)
- Assignee, creator, subscribers
- Labels (capture full names — `status:*`, `component:*`, `priority:*`, `prd-*`)
- Project (parent), parent Issue (if Sub-task), cycle, milestone (ProjectMilestone)
- Estimate, due date
- Created, updated, completed dates

**Body**
- Full description (preserve markdown)
- **Validation Journey** section if present (pass verbatim to downstream)
- Attachment URLs (capture, do not download unless needed)

**Comments**
Fetch ALL comments via `mcp__linear-server__list_comments({issueId: <id>})` in chronological order. Walk thread parents/children — Linear comments are threaded via `parentId`. Do not truncate. For each comment:
- Author, timestamp, body
- Flag comments that contain: credentials, reproduction steps, status updates from stakeholders, decisions, or triage headers.

### Project mode

Call `mcp__linear-server__get_project` with `includeMilestones: true`, `includeResources: true`. Extract:

**Metadata**
- ID, slug, name, state, priority, lead, color
- Teams, labels, milestones, target date, start date
- Created, updated dates

**Body**
- Description (markdown)
- Attached documents — call `mcp__linear-server__list_documents({projectId})` then `get_document` per result. Treat each as additional spec content.

**Member Issues**
- Call `mcp__linear-server__list_issues({project: <id>})` to enumerate the Project's Issues. Capture identifier, title, state, parent Issue (for sub-Issue tree).

## Phase 3 — Fetch Attachments / Remote Links

Linear stores remote URLs as attachments on the Issue. For each:

- **GitHub PR or commit**: run `gh pr view <url> --json title,state,body,mergedAt,reviewDecision,comments,reviews` (PRs) or `gh api repos/<owner>/<repo>/commits/<sha>` (commits). Capture title, state, unresolved review comments, merge status.
- **Confluence page**: capture title and URL. Do not fetch body unless a downstream task explicitly needs it.
- **Dashboard / log link / external URL**: capture title and URL only.

If `gh` is not authenticated, note "gh auth required" and continue — do not abort.

## Phase 4 — Fetch Relations

Linear native Issue relations are returned in the `get_issue` response under `relations`. Group by type:

- `blocks` / `blocked_by`
- `relates_to`
- `duplicates` / `duplicated_by`

For each related Issue, call `mcp__linear-server__get_issue` and capture:
- Identifier, title, state, priority, assignee
- Description (full, unless cancelled — then summary only)
- Acceptance Criteria section
- Last 10 comments (chronological)
- Attachments (URLs only — skip deep PR fetch unless the relation is `blocks` or `blocked_by`)

**Special handling for `blocked_by`:** fetch full PR details via `gh` for each blocker's GitHub attachments so the agent knows whether the blocker is actually shipped.

For Project-level relationships (Project ↔ Project), Linear doesn't model native relations — check the Project description and resources for cross-references and capture them as plain links.

## Phase 5 — Fetch Project Context

If the primary Item is an Issue with a Project parent:

1. Fetch the Project via `mcp__linear-server__get_project` — full description, milestones, labels, lead.
2. Fetch Project documents (Phase 2 procedure).
3. Find Project siblings via `mcp__linear-server__list_issues({project: <projectId>})` excluding the primary identifier.
4. For each sibling, capture: identifier, title, state, priority, assignee, summary (first paragraph of description).
5. If a sibling is `Started` or `In Review` with a different assignee, flag it prominently.

If the primary Item IS a Project, Phase 5 is the same as fetching all member Issues (already done in Phase 2 Project mode).

## Phase 6 — Fetch Sub-Issues

If the primary Issue has children (sub-Issues), fetch each via `mcp__linear-server__get_issue`: identifier, title, state, assignee, description (first paragraph), Acceptance Criteria.

## Phase 7 — Assemble Context Bundle

Produce a single structured output the caller can pass verbatim to downstream agents.

```text
# Linear Work Item Context: <IDENTIFIER>

## Primary Item
- Identifier: <ID>
- Type: <Issue | Project>
- State: <state>
- Priority: <0–4 or named>
- Assignee: <name or none>
- Project (parent): <project-slug — name> or none
- Parent Issue: <ID — title> or none (Sub-task only)
- Cycle: <name or none>
- Milestone: <project-milestone or none>
- Labels: <comma-separated>
- Estimate: <points>

### Description
<full description>

### Acceptance Criteria
<criteria>

### Validation Journey
<section or "None">

### Comments (<count>)
<chronological comments, flagged items called out>

### Attachments
<list of URLs with titles>

## Remote Links
### Pull Requests (<count>)
- <url> — <title> — <state> — <reviewDecision>
  <body summary + unresolved review comments>

### Confluence
- <title> — <url>

### Other
- <title> — <url>

## Relations
### Blocks (<count>)
<per-issue block>

### Blocked By (<count>)
<per-issue block with PR state>

### Relates To (<count>)
<per-issue block>

### Duplicates / Duplicated By
<per-issue block>

## Project Context (when primary is an Issue under a Project)
### Project <slug> — <name>
- State: <state>
- Description: <full markdown>
- Milestones: <list>
- Documents: <list of doc titles + identifiers>

### Siblings In-Flight (<count>)
- <ID> — <state> — <assignee> — <title>  **[FLAG: in progress by other assignee]**

### Other Siblings (<count>)
- <ID> — <state> — <title>

## Sub-Issues (<count>)
- <ID> — <state> — <assignee> — <title>

## Summary for Downstream
- Full item count pulled: <N>
- Blockers still open: <list>
- Related in-flight work: <list>
- Relevant PRs: <list with state>
```

## Rules

- Never summarize or truncate the primary item's description or Validation Journey.
- Never skip a relation type, even if it seems unrelated — the downstream agent decides relevance.
- If a related item returns an access error, capture the error and continue. Do not abort the read.
- Flag in-flight sibling work prominently so the caller can avoid duplicate implementation.
- If the Issue has no Project parent, state this explicitly — do not silently skip Phase 5.
- Output is pure context. This skill never modifies the item.
