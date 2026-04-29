---
name: github-read-issue
description: "Fetches the full scope of a GitHub Issue — metadata, body sections, all comments, native sub-issue parent and children, linked PRs, related issues parsed from `Blocks/Blocked by/Relates to/Duplicates/Cloned from` lines, and any cross-repo references. Produces a consolidated context bundle that downstream agents consume so they never act on an issue in isolation. The GitHub counterpart of lisa:jira-read-ticket."
allowed-tools: ["Bash", "Skill"]
---

# Read GitHub Issue: $ARGUMENTS

Fetch the full scope of the issue AND its related graph. Downstream agents must never act on an issue in isolation — always call this skill first so they see blockers, sibling sub-issues, linked PRs, and historical comments.

This skill is the GitHub counterpart of `lisa:jira-read-ticket`. The output bundle structure mirrors the JIRA bundle so vendor-neutral consumers can parse either with minimal branching.

Repository name for scoped comments and logs: `basename $(git rev-parse --show-toplevel)`.

## Phase 1 — Resolve Context

1. Confirm `gh auth status` succeeds.
2. Parse `$ARGUMENTS`. Accept either:
   - `<org>/<repo>#<number>` token, OR
   - `https://github.com/<org>/<repo>/issues/<number>` URL.

   If `$ARGUMENTS` is just `#<number>` or `<number>`, resolve `<org>/<repo>` from `.lisa.config.json` (`github.org` / `github.repo`).
3. If the input doesn't parse cleanly, stop and report. Do NOT guess.

## Phase 2 — Fetch Primary Issue

```bash
gh issue view <number> --repo <org>/<repo> --json number,title,body,state,stateReason,author,assignees,labels,milestone,createdAt,updatedAt,closedAt,url,comments,reactionGroups,projectItems
```

Extract and preserve:

### Metadata

- `number`, `title`, `state` (open/closed), `stateReason` (completed/not_planned/reopened/null)
- `author` (immutable original reporter), `assignees`
- All labels — partition by namespace: `type:<...>` (issue type), `status:<...>` (workflow status), `priority:<...>`, `component:<...>`, `points:<...>`, `fix-version:<...>`, `claude-triaged-<repo>`, plus any free-form labels
- `milestone` (name + url)
- `createdAt`, `updatedAt`, `closedAt`
- `url` (canonical issue URL)

### Body — parse markdown sections

Walk the markdown body and capture each top-level `## ` section by name. Standard sections (per `lisa:github-write-issue` Phase 3):

- `Context / Business Value`
- `Technical Approach`
- `Acceptance Criteria` (preserve the Gherkin code-fence verbatim)
- `Out of Scope`
- `Target Backend Environment`
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

Fetch ALL comments. Do not truncate. The `comments` field from `gh issue view --json comments` includes author, body, createdAt for each. Flag comments that contain:
- Credentials, reproduction steps
- Status updates from stakeholders
- Decisions
- Triage headers like `[<repo>]`

If pagination matters (issues with hundreds of comments), use `gh api repos/<org>/<repo>/issues/<number>/comments --paginate` to get the full set.

## Phase 3 — Fetch Sub-issue Graph (Parent + Children)

GitHub native sub-issues are exposed via GraphQL:

```graphql
query($org:String!,$repo:String!,$number:Int!){
  repository(owner:$org,name:$repo){
    issue(number:$number){
      id
      parent { number title state url repository { nameWithOwner } }
      subIssues(first: 100) {
        nodes {
          number title state url
          repository { nameWithOwner }
          labels(first: 50) { nodes { name } }
          assignees(first: 5) { nodes { login } }
        }
      }
    }
  }
}
```

```bash
gh api graphql -f query='<above>' -F org=<org> -F repo=<repo> -F number=<number>
```

Capture:
- **Parent sub-issue**: number, title, state, url, repo.
- **Child sub-issues**: list with number, title, state, url, repo, labels (especially `type:` and `status:`), assignees.

If the GraphQL `parent` / `subIssues` fields aren't available (older GHES), fall back to parsing `Parent: #<n>` text in the body and recording sub-issue text references — note "GraphQL sub-issues unavailable" in the bundle so callers know parent-link is text-based.

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
gh pr view <link-number> --repo <link-org>/<link-repo> --json number,title,state,reviewDecision,merged,mergedAt,url,reviewRequests,reviews,comments
```

For each linked **issue**, capture: number, title, state, type (from labels), status (from labels), assignees, url.

For each linked **PR**, capture: number, title, state, mergedAt, reviewDecision, unresolved review comments, url.

**Special handling for `is blocked by`:** include the linked issue's PR refs (parse `Resolves` lines in its body) and fetch each PR's state, so the agent knows whether the blocker is actually shipped.

## Phase 5 — Fetch Sibling Sub-issues (Epic Context)

If the primary issue has a parent sub-issue (i.e., is a Story / Task / Sub-task / Improvement under an Epic):

1. Fetch the parent Epic in full via Phase 2 logic — full body, all comments, Validation Journey if present.
2. Fetch the parent Epic's other sub-issues (siblings) via the same GraphQL `subIssues` query against the parent. Filter out the primary issue itself.
3. For each sibling, capture: number, title, type label, status label, assignee, url. Read the first paragraph of each sibling's body for context. If a sibling has `status:in-progress` with an assignee different from the primary issue's assignee, **flag prominently** so the caller can avoid duplicate work.

If the primary issue IS an Epic, capture all children via Phase 3's `subIssues` traversal (already done).

## Phase 6 — Fetch Linked PRs (Native `Resolves` / Cross-references)

GitHub's native `closingIssuesReferences` and timeline give the canonical PR↔Issue relationship:

```bash
gh api graphql -f query='query($org:String!,$repo:String!,$number:Int!){repository(owner:$org,name:$repo){issue(number:$number){closedByPullRequestsReferences(first:50){nodes{number title state merged mergedAt url repository{nameWithOwner}}}timelineItems(first:100,itemTypes:[CROSS_REFERENCED_EVENT]){nodes{...on CrossReferencedEvent{source{...on PullRequest{number title state url repository{nameWithOwner}}}}}}}}}' -F org=<org> -F repo=<repo> -F number=<number>
```

Capture: PR number, title, state, mergedAt, repo, url. Dedupe with PRs found in Phase 4.

For each PR, fetch unresolved review comments via `gh pr view <num> --repo <org>/<repo> --json reviews,reviewThreads`.

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

### Comments (<count>)
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
- If a linked issue / PR returns an access error (private repo, deleted, etc.), capture the error and continue. Do not abort the read.
- Flag in-flight sibling work prominently so the caller can avoid duplicate implementation.
- If the issue has no parent sub-issue, state this explicitly — do not silently skip Phase 5.
- Output is pure context. This skill never modifies the issue.
- The body parser must be tolerant of small format variations (different `##` casings, missing optional sections) but strict enough that downstream skills can rely on the named sections being present when they exist.
