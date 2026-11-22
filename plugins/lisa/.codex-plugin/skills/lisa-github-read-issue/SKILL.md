---
name: lisa-github-read-issue
description: "Fetch a GitHub issue with…"
allowed-tools: ["Bash", "Skill"]
---
Fetch a GitHub issue with everything related — comments, parent and sub-issues, linked PRs, related and cross-repo issues — so work is never done on an issue in isolation.


# Read GitHub Issue: $ARGUMENTS

Fetch the full scope of the issue AND its related graph. Downstream agents must never act on an issue in isolation — always call this skill first so they see blockers, sibling sub-issues, linked PRs, and historical comments.

This skill is the GitHub counterpart of `lisa-jira-read-ticket`. The output bundle structure mirrors the JIRA bundle so vendor-neutral consumers can parse either with minimal branching.

Repository name for scoped comments and logs: `basename $(git rev-parse --show-toplevel)`.

## Phase 1 — Resolve Context

Pass the issue number, `<org>/<repo>#<number>`, or GitHub issue URL to the reader from the Lisa checkout. The reader resolves `.lisa.config.local.json` over `.lisa.config.json` before any GitHub request. A bare number uses `github.org` and `github.repo`. Configuration or syntax failure stops the read.

## Phase 2 — Fetch Primary Issue

```bash
lisa --no-update-check github-read-issue '<issue-ref>'
```

Use `issue`, `comments`, `graph`, `timeline`, and `pullRequests` from the returned JSON. The reader checks the native GitHub session and requests repository data on its existing identity. A failed required read stops the operation. Report the exact diagnostic before work.

`project` describes only the repository's configured coordination service:

- `unconfigured` means repository reads ran without Projects requests or scope requirements.
- `verified` supplies metadata for the one configured Project. It establishes the Project's identity, with issue membership still unknown.
- `unverified` carries the exact warning for an unavailable best-effort Project. Preserve the warning and continue with verified repository data.
- A failure of a required Project read exits with its exact diagnostic. Stop before claiming work or returning a complete context bundle.

Extract and preserve:

### Metadata

- `number`, `title`, `state` (open/closed), `stateReason` (completed/not_planned/reopened/null)
- `author` (immutable original reporter), `assignees`
- All labels — partition by namespace: `type:<...>` (issue type), `status:<...>` (workflow status), `priority:<...>`, `component:<...>`, `points:<...>`, `fix-version:<...>`, `claude-triaged-<repo>`, plus any free-form labels
- `milestone` (name + url)
- `createdAt`, `updatedAt`, `closedAt`
- `url` (canonical issue URL)

### Body — parse markdown sections

Walk the markdown body and capture each top-level `## ` section by name. Standard sections (per `lisa-github-write-issue` Phase 3):

- `Context / Business Value`
- `Technical Approach`
- `Acceptance Criteria` (preserve the Gherkin code-fence verbatim)
- `Out of Scope`
- `Target Backend Environment`
- `Branch Plan` (derived output per `derived-branch-plan` — parsed so callers can *compare* it against a recomputation, never so they can use it as the base branch)
- `Sign-in Required`
- `Repository`
- `Source Artifacts`
- `Source Precedence`
- `Links`
- `Relationship Search`
- `Validation Journey` (preserve verbatim — pass through to verifier agents)
- `Open Questions`
- `Current Product`

Any other `##` section: capture under `extra_sections` so callers can see PRDs that adopt non-standard sections.

### Comments

Use every comment returned in `comments`, including author, body, and creation time. The reader flattens native pages and verifies the count against the issue before it returns a bundle. Flag reproduction details, status updates, decisions, and scoped triage headers. Handle credential-shaped text according to the existing privacy rules.

## Phase 3 — Fetch Sub-issue Graph (Parent + Children)

Use `graph.parent` and every item in `graph.children`, with repository, number, title, state, URL, labels, and assignees where returned. When the GitHub Enterprise schema lacks native parent or sub-issue support, `graph.warning` preserves the provider message. In that case parse the body's `Parent: #<n>` and sub-issue text references and label them as text-based.

## Phase 4 — Parse Issue Links from Body

The body's `## Links` section encodes typed relationships. Parse:

| Pattern (case-insensitive) | Link type |
|----------------------------|-----------|
| `Blocks #<n>` or `Blocks <org>/<repo>#<n>` | `blocks` |
| `Blocked by #<n>` or `Blocked by <org>/<repo>#<n>` | `is blocked by` |
| `Relates to #<n>` or `Relates to <org>/<repo>#<n>` | `relates to` |
| `Duplicates #<n>` or `Duplicates <org>/<repo>#<n>` | `duplicates` |
| `Cloned from #<n>` or `Cloned from <org>/<repo>#<n>` | `clones` |
| `Resolves #<n>` or `Closes #<n>` or `Fixes #<n>` (PR refs) | remote-link to PR |

For each parsed reference, fetch the linked issue/PR:

```bash
gh issue view <link-number> --repo <link-org>/<link-repo> --json number,title,state,labels,assignees,url
gh pr view <link-number> --repo <link-org>/<link-repo> --json number,title,state,reviewDecision,mergedAt,url,reviewRequests,reviews,comments
```

For each linked **issue**, capture: number, title, state, type (from labels), status (from labels), assignees, url.

For each linked **PR**, capture: number, title, state, mergedAt, reviewDecision, unresolved review comments, url.

**Special handling for `is blocked by`:** include the linked issue's PR refs (parse `Resolves` lines in its body) and fetch each PR's state, so the agent knows whether the blocker is actually shipped.

## Phase 5 — Fetch Sibling Sub-issues (Epic Context)

If the primary issue has a parent sub-issue (i.e., is a Story / Task / Sub-task / Improvement under an Epic):

1. Read the parent Epic with the Phase 2 command for its native reference. Preserve the full body, all comments, and Validation Journey when present.
2. Use `graph.children` from the parent's response to identify siblings. Filter out the primary issue itself.
3. For each sibling, capture: number, title, type label, status label, assignee, url. Read the first paragraph of each sibling's body for context. If a sibling has `status:in-progress` with an assignee different from the primary issue's assignee, **flag prominently** so the caller can avoid duplicate work.

If the primary issue IS an Epic, capture all children via Phase 3's `subIssues` traversal (already done).

## Phase 6 — Fetch Linked PRs and Label-Event History

Use the native `pullRequests` list from the Phase 2 command and deduplicate it against body references. Include each PR's actual base, head, review status, reviews, and unresolved threads. Surface any warning on a linked PR as incomplete access to that PR.

Use `timeline.events` for the label-event history, preserving oldest-to-newest ordering and the label, actor, and time on each event. Status labels remain the transition history and other label events stay available for audit. If `timeline.warning` is present, record the history as unknown with the provider error. A missing history does not remove separately verified PR links or stop the build.

## Phase 7 — Assemble Context Bundle

Produce a single structured output that the caller can pass verbatim to downstream agents. Use this format:

```text
# Issue Context: <org>/<repo>#<number>

## Primary Issue
- Ref: <org>/<repo>#<number>
- URL: <url>
- Type: <type from `type:` label>
- Status: <status from `status:` label>
- State: <open|closed> (<stateReason>)
- Priority: <priority from `priority:` label>
- Author: <login>
- Assignees: <list>
- Parent: <parent-ref> — <parent-title>  (or "None")
- Milestone: <name>  (or "None")
- Labels: <comma-separated raw labels>
- Components: <list from `component:` labels>
- Story points: <n from `points:` label>  (or "None")
- Fix version: <from `fix-version:` label or milestone>
- Created: <ISO> | Updated: <ISO> | Closed: <ISO or "—">

### Body sections
#### Context / Business Value
<verbatim>

#### Technical Approach
<verbatim>

#### Acceptance Criteria
<verbatim, including the gherkin fence>

#### Validation Journey
<verbatim or "None">

#### Out of Scope
<verbatim>

#### Source Artifacts / Source Precedence / Links / Relationship Search / Repository / Sign-in Required / Target Backend Environment / Open Questions / Current Product
<each verbatim, omit those not present>

### Comments (<fetched> of <total>; comments_complete: <true|false>)
<when incomplete: "INCOMPLETE — <fetched> of <total> comments read via <substrate>">
<chronological comments with author + ISO timestamp + body. Flagged items called out.>

## Sub-issue graph
### Parent
<parent block: ref, title, state, url, type label> (or "None — this is an Epic / unparented")

### Sub-issues (children, <count>)
- <ref> — <type> — <status> — <state> — <title>
  - <one-paragraph body summary>
  - <FLAG: in progress by other assignee> if applicable

## Linked Issues (parsed from body `## Links`)
### Blocks (<count>)
<per-issue block>

### Is Blocked By (<count>)
<per-issue block; include shipped/not-shipped state of any linked PRs>

### Relates To (<count>)
<per-issue block>

### Duplicates / Clones
<per-issue block>

## Linked Pull Requests
### Native (closedByPullRequestsReferences + cross-references)
- <pr-ref> — <state> — <title> — <reviewDecision>
  <body summary + unresolved review comments>

### Body-referenced (`Resolves #<n>`)
<per-PR block>

## Project coordination
<status and configured Project metadata or exact warning from the reader>

## Label-Event History
- Status: <known|unknown>
- Events:
  - <ISO> — <labeled|unlabeled> — <label-name> — <actor-login>
  - ...

## Sibling Sub-issues (other children of the same parent, <count>)
- <ref> — <type> — <status> — <assignee> — <title>  **[FLAG: in progress by other assignee]**

## Summary for Downstream
- Full graph fetched: <issue-count>
- Blockers still open: <list>
- Related in-flight work: <list>
- Relevant PRs: <list with state>
```

## Rules

- Never summarize or truncate the primary issue's body or Validation Journey section.
- Never skip a link type, even if it seems unrelated — the agent downstream decides relevance.
- For an additional linked issue or PR read, capture any access error and carry it with that link. If the Phase 2 command stopped, report its diagnostic before proceeding with work.
- Flag in-flight sibling work prominently so the caller can avoid duplicate implementation.
- If the issue has no parent sub-issue, state this explicitly — do not silently skip Phase 5.
- Output is pure context. This skill never modifies the issue.
- The body parser must be tolerant of small format variations (different `##` casings, missing optional sections) but strict enough that downstream skills can rely on the named sections being present when they exist.
