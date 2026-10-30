---
name: lisa-github-read-issue
description: "Fetches the full scope of a GitHub Issue — metadata, body sections, all comments, native sub-issue parent and children, linked PRs, related issues parsed from `Blocks/Blocked by/Relates to/Duplicates/Cloned from` lines, and any cross-repo references. Produces a consolidated context bundle that downstream agents consume so they never act on an issue in isolation. The GitHub counterpart of lisa-jira-read-ticket."
allowed-tools: ["Bash", "Skill"]
---

# Read GitHub Issue: $ARGUMENTS

Fetch the full scope of the issue AND its related graph. Downstream agents must never act on an issue in isolation — always call this skill first so they see blockers, sibling sub-issues, linked PRs, and historical comments.

This skill is the GitHub counterpart of `lisa-jira-read-ticket`. The output bundle structure mirrors the JIRA bundle so vendor-neutral consumers can parse either with minimal branching.

Repository name for scoped comments and logs: `basename $(git rev-parse --show-toplevel)`.

## Phase 1 — Resolve Context

1. Use the existing secrets/access owner's bounded `--intake-read` route below.
   It proves the configured repository scope using native gh first and separately
   observes the authenticated actor when available. Installation tokens without
   `/user` retain established repository scope with actor explicitly unobserved;
   repository ownership never supplies an actor. Genuine unavailability may use the existing environment, supported
   materialized source, then configured provider; wrong identity stops. Native
   auth success needs no vault call. Do not require login or an ambient token
   before consulting that supported path. No requirements header is fabricated.
2. Parse `$ARGUMENTS`. Accept either:
   - `<org>/<repo>#<number>` token, OR
   - `https://github.com/<org>/<repo>/issues/<number>` URL.

   If `$ARGUMENTS` is just `#<number>` or `<number>`, resolve `<org>/<repo>` from `.lisa.config.json` (`github.org` / `github.repo`).
3. If the input doesn't parse cleanly, stop and report. Do NOT guess.

### Pre-header configured-source reader

Before the complete issue is known, invoke this exact installed owner command
with only the configured canonical ref, fixed read name and issue/PR number:

```text
node '<absolute installed lisa-secrets-access>/scripts/preflight-secrets.mjs' --intake-read --ref <org>/<repo>#<primary-number> --read <operation> --number <read-number>
```

Use `issue`, `comments`, `comment-count`, `graph`, `history`, `closing-prs`,
`blocked-by`, `blocking`, `pr`, or `review-threads`. For `thread-comments` ONLY,
replace `--number <read-number>` with `--thread <returned-thread-node-id>`.
Each invocation freshly proves the configured repository scope, validates any
observed actor, then executes only its fixed read. A selected credential is carried in child environment
memory, never command arguments/output/files or context. Comments are returned
as one flattened array; graph/history/thread connections retain all raw pages.
Read related issue/comment and PR/thread inputs with the same fixed operations;
compare comment counts and terminal pagination before declaring completeness.
Run the shipped hold classifier with the complete body/comments/actor inputs,
then prepare the truthful private context/header and evaluate full task readiness
before claim or implementation. This bounded repository read grants no mutation
and proves no unrelated task capability or provider health.

The gh snippets below specify the owner's fixed underlying API/JSON/query
contracts, not a separate login-first bootstrap route. Raw native/env gh reads
remain read-only orientation, but cannot discover configured materialization or
provider credentials by themselves. Use the owner above for the complete intake
route. Cross-repository/other-tracker operations outside this fixed configured
repository remain explicit access-owner duties; do not widen the shell allowlist.

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

Fetch ALL comments, always through the paginated endpoint, flattened into one array: `gh api repos/<org>/<repo>/issues/<number>/comments --paginate --slurp | jq 'add // []'` (author, body, created_at for each). `--paginate` alone emits one JSON array per page, so reading or counting its raw output undercounts; `--slurp` plus `jq 'add'` flattens the pages first. The `comments` field of `gh issue view --json` is not the source of record — it can be capped. Do not truncate. The fetched count is the number of comments after flattening (`... | jq 'add // [] | length'`); compare it with the issue's `comments` total (`gh api repos/<org>/<repo>/issues/<number> --jq .comments`); if they differ or a page fails, set `comments_complete: false` and say so at the top of the Comments section. Flag comments that contain:
- Credentials, reproduction steps
- Status updates from stakeholders
- Decisions
- Triage headers like `[<repo>]`

Pagination is unconditional — never skip `--paginate` because an issue looks short.

## Phase 3 — Fetch Sub-issue Graph (Parent + Children)

GitHub native sub-issues use the fixed read-only query below inside `--read graph`.
Only the parsed org/repo/number is substituted by the owner. The native
readiness adapter recognizes this owning contract, not arbitrary GraphQL or
shell loops. `--paginate --slurp` follows every `pageInfo`/`$endCursor` page.
Keep all raw pages and compare the terminal page before calling the graph complete.

```bash
gh api graphql --paginate --slurp -f query='query($org:String!,$repo:String!,$number:Int!,$endCursor:String){repository(owner:$org,name:$repo){issue(number:$number){id parent{number title state url repository{nameWithOwner}} subIssues(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{number title body state url repository{nameWithOwner} labels(first:50){nodes{name}} assignees(first:5){nodes{login}}}}}}}' -F org=<org> -F repo=<repo> -F number=<number>
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
gh pr view <link-number> --repo <link-org>/<link-repo> --json number,title,state,reviewDecision,mergedAt,url,reviewRequests,reviews,comments
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

## Phase 6 — Fetch Linked PRs and Label-Event History

GitHub's native `closingIssuesReferences` and timeline give the canonical PR↔Issue relationship. The same timeline read also exposes label events, which are Lisa's GitHub-native transition history. Keep this as one GraphQL read path; do not add a second REST timeline fetch.

Use these two fixed read-only paginated commands; preserve the complete raw
pages. The first contains the native cross-references and all label/unlabel
history; the second independently paginates closing PR references. Do not use a
shell loop or interpolate a caller-supplied query/cursor program.

```bash
gh api graphql --paginate --slurp -f query='query($org:String!,$repo:String!,$number:Int!,$endCursor:String){repository(owner:$org,name:$repo){issue(number:$number){timelineItems(first:100,after:$endCursor,itemTypes:[CROSS_REFERENCED_EVENT,LABELED_EVENT,UNLABELED_EVENT]){pageInfo{hasNextPage endCursor} nodes{__typename ...on CrossReferencedEvent{createdAt actor{login} source{...on PullRequest{number title state url repository{nameWithOwner}}}} ...on LabeledEvent{createdAt actor{login} label{name}} ...on UnlabeledEvent{createdAt actor{login} label{name}}}}}}}' -F org=<org> -F repo=<repo> -F number=<number>
gh api graphql --paginate --slurp -f query='query($org:String!,$repo:String!,$number:Int!,$endCursor:String){repository(owner:$org,name:$repo){issue(number:$number){closedByPullRequestsReferences(first:50,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{number title state merged mergedAt url repository{nameWithOwner}}}}}}' -F org=<org> -F repo=<repo> -F number=<number>
```

Also read both native dependency directions, preserving all pages:

```bash
gh api repos/<org>/<repo>/issues/<number>/dependencies/blocked_by --paginate --slurp
gh api repos/<org>/<repo>/issues/<number>/dependencies/blocking --paginate --slurp
```

Capture:
- **Linked PRs**: PR number, title, state, mergedAt, repo, url. Dedupe with PRs found in Phase 4. Preserve the existing `CrossReferencedEvent` behavior for PR linkage; widening the query must not change that consumer shape.
- **Label-event history**: chronological `LabeledEvent` and `UnlabeledEvent` entries with event kind, label name, actor login, and `createdAt`. Preserve oldest→newest order across all pages. Status labels (`status:*`) are the GitHub transition history that downstream rejection detection consumes, but keep non-status label events too so callers can audit the full label stream.

Pagination is mandatory. `timelineItems(first:100)` silently truncates busy issues unless `pageInfo.hasNextPage` / `endCursor` is followed. If a page fetch fails, record label-event history as `unknown` with the error and continue assembling the bundle; a history read failure must never block the build.

For each PR, use the fixed paginated GraphQL review-thread request below.
`gh pr view --json` does not expose `reviewThreads` or `merged`; derive merge
state from `state`/`mergedAt`, and keep native GraphQL `merged` separately.
For each thread whose nested comments page is incomplete, run the second fixed
query with that thread's returned node ID and merge/dedupe all comments by URL.
Do not call the review context complete while any page remains unread.

```bash
gh api graphql --paginate --slurp -f query='query($org:String!,$repo:String!,$number:Int!,$endCursor:String){repository(owner:$org,name:$repo){pullRequest(number:$number){reviewThreads(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{id isResolved isOutdated comments(first:100){pageInfo{hasNextPage endCursor} nodes{body author{login} createdAt url}}}}}}}' -F org=<org> -F repo=<repo> -F number=<number>
gh api graphql --paginate --slurp -f query='query($id:ID!,$endCursor:String){node(id:$id){...on PullRequestReviewThread{comments(first:100,after:$endCursor){pageInfo{hasNextPage endCursor} nodes{body author{login} createdAt url}}}}}' -F id=<thread-node-id>
```

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
- If a linked issue / PR returns an access error (private repo, deleted, etc.), capture the error and continue. Do not abort the read.
- Flag in-flight sibling work prominently so the caller can avoid duplicate implementation.
- If the issue has no parent sub-issue, state this explicitly — do not silently skip Phase 5.
- Output is pure context. This skill never modifies the issue.
- The body parser must be tolerant of small format variations (different `##` casings, missing optional sections) but strict enough that downstream skills can rely on the named sections being present when they exist.
