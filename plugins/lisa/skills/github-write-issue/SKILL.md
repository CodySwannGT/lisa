---
name: github-write-issue
description: "Creates or updates a GitHub Issue following the same organizational best practices as lisa:jira-write-ticket — three-audience description, Gherkin acceptance criteria, parent sub-issue (Epic/Story hierarchy), explicit relationship discovery, remote links, labels for status/components/priority/story-points, and Validation Journey. Uses the `gh` CLI exclusively (no MCP). Rejects thin issues. The GitHub counterpart of lisa:jira-write-ticket."
allowed-tools: ["Bash", "Skill", "Read"]
---

# Write GitHub Issue: $ARGUMENTS

Create or update a GitHub Issue with all required relationships, metadata, and quality gates. Every section below is mandatory. Thin issues are rejected.

This skill is the GitHub counterpart of `lisa:jira-write-ticket`. The two skills share the same gates, description structure, acceptance-criteria format, and verification flow. The data-model translation is documented under "GitHub Issues data model" below — keep that table in sync with `lisa:github-validate-issue` so what one skill writes the other accepts.

Repository name for scoped comments: `basename $(git rev-parse --show-toplevel)`.

## Prerequisites

- `gh` CLI installed and authenticated (`gh auth status` must succeed). The skill never falls back to a different transport — if `gh` is unauthenticated, stop and surface the auth error.
- `.lisa.config.json` must declare `github.org` and `github.repo` for the destination repository. The configured repo is the issue's home; pass it on every `gh` invocation via `--repo <org>/<repo>`.
- `jq` installed (used to parse `gh` JSON outputs without hand-rolling parsers).

## Phase 1 — Resolve Intent

Determine from `$ARGUMENTS` and context whether this is a CREATE or UPDATE:

- **CREATE**: no existing issue ref provided.
- **UPDATE**: an issue ref provided (`org/repo#<number>` or a full `https://github.com/<org>/<repo>/issues/<number>` URL). Call `lisa:github-read-issue <ref>` first to load the full current state before editing. Never overwrite without reading.

Resolve `<ORG>` and `<REPO>` from the ref or from `.lisa.config.json`.

## Phase 2 — Gather Required Inputs

| Field | Required For | Notes |
|-------|--------------|-------|
| Issue type | CREATE | `Epic`, `Story`, `Task`, `Bug`, `Sub-task`, `Spike`, `Improvement`. Encoded as a label `type:<value>`. |
| Summary (title) | CREATE, UPDATE | One line, imperative voice, under 100 chars. |
| Description (body) | CREATE, UPDATE | Multi-section markdown — see Phase 3. |
| Parent sub-issue | Non-bug, non-epic | Native GitHub sub-issue link. Enforced by `lisa:github-verify`. |
| Priority | CREATE | Label `priority:<low|medium|high|critical>`. |
| Acceptance criteria | Story, Task, Bug, Sub-task, Improvement | Gherkin in `## Acceptance Criteria` — see Phase 3. |
| Validation Journey | Runtime-behavior changes | Delegate to `/github-add-journey`. |
| Target backend environment | Runtime-behavior changes | Recorded under `## Target Backend Environment`. Skip only for doc / config / type-only. |
| Sign-in account / credentials | Authenticated-surface tickets | Recorded under `## Sign-in Required`. |
| Repository | Bug, Task, Sub-task | GitHub Issues live in exactly one repo by definition — record the repo name under `## Repository`, and reject any AC bullet that references a different repo. |

Optional but recommended: assignee, milestone, components (label `component:<name>`), story points (label `points:<n>`), labels.

Use `gh api repos/<org>/<repo>/labels --paginate` to discover existing labels before referencing one. If a required label doesn't exist (e.g., `type:Story`, `status:ready`, `priority:high`), create it via `gh label create <name> --color <hex> --description <desc> --repo <org>/<repo>`. The first run on a fresh repo will create the full label set; subsequent runs reuse them.

## Phase 3 — Description Quality

The description (issue body) MUST address three audiences. Reject and rewrite if any are missing.

```markdown
## Context / Business Value
[Why this matters. Stakeholder-facing. Concrete user impact or business outcome.
 Link to the originating Slack thread, PRD page, incident, or customer report.]

## Technical Approach
[Developer-facing. Integration points, impacted modules, data model implications,
 relevant tradeoffs. Not a full design doc — a pointer for someone picking it up.]

## Acceptance Criteria
```gherkin
Scenario: <name>
  Given <precondition>
  When <action>
  Then <observable outcome>

Scenario: <name>
  Given <precondition>
  When <action>
  Then <observable outcome>
```

## Out of Scope
[Explicit list of what this issue does NOT cover. Forces scope discipline.]

## Target Backend Environment
[Required when the issue changes runtime behavior. One of: dev / staging / prod.
 Skip section entirely for doc-only, config-only, or type-only issues.]

## Sign-in Required
[Include this section ONLY if the work touches authenticated surfaces.
 Specify: the account/role, where to get the credentials (1Password item,
 env var, seeded fixture), and any MFA/SSO notes.]

## Repository
[Required for Bug / Task / Sub-task. Name the single repo this issue covers.
 If the work spans repos, this issue type is wrong — split into per-repo
 Tasks/Sub-tasks under a parent Story or Epic.]

## Source Artifacts
[Group by domain (UI / UX flow / Data / Ops / Reference). One bullet per
 artifact with title and URL. Inherited from the parent epic per the rules
 in lisa:jira-source-artifacts.]

## Source Precedence
[When artifacts are attached, name the authoritative source per axis:
 business rules → PRD body, visual treatment → mocks, flow → prototypes,
 API/data → data artifacts. Cross-axis conflicts go under Open Questions.]

## Links
[Remote links: PRs (`Resolves <org>/<repo>#<pr>`), Confluence pages,
 dashboards, incident tickets. Native `Resolves #<pr>` lines are picked up
 by GitHub for auto-close.]

## Relationship Search
[Document the git+search outcomes from Phase 4b. "Searched git history
 for `<keywords>` and `gh issue list` for label `component:X`; no related
 work found." A no-result outcome is acceptable when documented.]

## Validation Journey
[Delegate to /github-add-journey if the issue changes runtime behavior.
 Skip only for doc-only, config-only, or type-only issues.]
```

Rules:
- Every acceptance criterion uses Given/When/Then. No vague "should work" language.
- Every criterion is independently verifiable.
- If the issue is a Bug, include reproduction steps, expected vs. actual behavior, and environment.
- If the issue is a Spike, include the question being answered and the definition of done.
- If sign-in is required, the implementer must be able to sign in from the description alone.

## Phase 4 — Relationship Discovery (Mandatory)

### 4a. Parent sub-issue

If the issue is not a Bug and not an Epic, it MUST have a parent sub-issue:

1. If explicitly provided, use that issue number.
2. Otherwise search active Epic issues:
   ```bash
   gh issue list --repo <org>/<repo> --label type:Epic --state open --json number,title,body --limit 100
   ```
   Match on keywords from the summary and description.
3. If no Epic matches, stop and ask the human to create or pick one. Do NOT orphan the issue.

### 4b. Related issues

Run BOTH searches and document outcomes — never declare "no related work" without doing both.

**Search 1: local git history**

```bash
git log --all --oneline --grep="<keyword>"
git log --all --oneline -- <path-or-glob>
git log --since=90.days --oneline -- <path-or-glob>
```

If a PR or commit surfaces, capture the PR URL — it becomes a Phase 4c link.

**Search 2: GitHub issue search**

```bash
gh issue list --repo <org>/<repo> --search "<keyword>" --state all --limit 50 --json number,title,state,labels,updatedAt
gh issue list --repo <org>/<repo> --label "component:<component>" --state open --limit 100 --json number,title,state
gh issue list --repo <org>/<repo> --search "epic:#<epic-number>" --state all --limit 50 --json number,title,state
```

For each candidate, classify the relationship using these markdown conventions in the issue body (under `## Links`):

| Link type | How it's encoded |
|-----------|------------------|
| `blocks` | `Blocks #<number>` (or full `org/repo#<number>` for cross-repo) |
| `is blocked by` | `Blocked by #<number>` |
| `relates to` | `Relates to #<number>` |
| `duplicates` | `Duplicates #<number>` (and close one as duplicate via `gh issue close <number> --reason "duplicate of #<other>"`) |
| `clones` | `Cloned from #<number>` |

GitHub does not have a native typed-link primitive for issues (only `Resolves #<pr>` for PR↔Issue). The text conventions above are parsed by `lisa:github-read-issue` to reconstruct the relationship graph.

### 4c. Remote links

Identify and attach (under `## Links`):
- Related GitHub PRs, branches, or commits.
- Confluence / Notion / Linear PRD pages (the originating PRD).
- Dashboards (Grafana, Datadog, Sentry).
- **Source artifacts from the originating PRD / parent Epic**: classify and inherit per `lisa:jira-source-artifacts`. Inherit by domain — UI → `ui-design` + `ux-flow`; backend → `data`; infra → `ops`; always inherit `reference`. Never assume a developer will walk up to the Epic to find design context.

If the issue was generated from a PRD and the parent Epic has no source artifacts, surface that as a smell and ask whether artifacts were missed during extraction.

### 4d. Source Precedence (must appear in description)

Same rule as `lisa:jira-write-ticket` Phase 4d — record source precedence under `## Source Precedence` (or a paragraph under `## Technical Approach`) when artifacts are attached. Cross-axis conflicts go under `## Open Questions`.

### 4e. Live Product Walkthrough Findings (UI-touching issues)

If the issue modifies an existing user-facing surface, a `lisa:product-walkthrough` should already have been run upstream. Inherit findings under `## Current Product`.

## Phase 5 — Set Metadata

GitHub Issues uses **labels** for the structured metadata that JIRA stores in custom fields. Apply the conventions:

| Concept | Label format | Example |
|---------|--------------|---------|
| Issue type | `type:<value>` | `type:Story`, `type:Bug`, `type:Epic`, `type:Sub-task`, `type:Spike`, `type:Improvement` |
| Status | `status:<value>` | `status:ready`, `status:in-progress`, `status:code-review`, `status:on-dev`, `status:done` |
| Priority | `priority:<value>` | `priority:low`, `priority:medium`, `priority:high`, `priority:critical` |
| Components | `component:<name>` | `component:auth`, `component:billing` |
| Story points | `points:<n>` | `points:3`, `points:5`, `points:8` |
| Fix version | `fix-version:<value>` | `fix-version:2.7.0` |
| Repo (multi-repo orgs) | implicit (issue lives in the repo) | — |
| Triage marker | `claude-triaged-<repo>` | `claude-triaged-frontend-v2` |

Milestones map to `fix-version:<value>` labels OR native GitHub Milestones — pick one convention per repo and document it in `.lisa.config.json` if needed. Default to labels for parity with the JIRA fix-version concept.

Create labels lazily — call `gh label create` if a referenced label doesn't exist. Use a stable color palette per category so the issue board reads cleanly.

## Phase 5.5 — Validate (Pre-write Gate)

Before any write, invoke `lisa:github-validate-issue` with the full proposed spec assembled from Phases 2 / 3 / 4 / 5. Pass it as a YAML block per the `lisa:github-validate-issue` schema, including `runtime_behavior_change`, `authenticated_surface`, and `artifacts_attached` flags so the right gates run.

`lisa:github-validate-issue` is the **single source of truth** for what makes a valid GitHub Issue in this pipeline — same gate definitions as `lisa:jira-validate-ticket`, translated to GitHub's data model. Do not re-implement gate logic here.

If the validator reports `FAIL`, do NOT proceed to Phase 6. Fix the spec and re-run validation. Never call `gh issue create` while the validator's verdict is FAIL.

## Phase 6 — Create or Update

### CREATE

1. Compose the body markdown from Phases 2/3/4 in a temp file (avoid quoting hell):
   ```bash
   gh issue create \
     --repo <org>/<repo> \
     --title "<summary>" \
     --body-file /tmp/issue-body.md \
     --label "type:<type>" --label "status:ready" --label "priority:<priority>" \
     [--label "component:<name>" ...] [--milestone "<milestone>"] \
     [--assignee "<login>"]
   ```
2. Capture the returned issue number.
3. **Link to parent sub-issue** (if non-Epic): use the GraphQL sub-issue API.

   Resolve the new issue's GraphQL node ID:
   ```bash
   child_id=$(gh api graphql -f query='query($org:String!,$repo:String!,$number:Int!){repository(owner:$org,name:$repo){issue(number:$number){id}}}' -F org=<org> -F repo=<repo> -F number=<new_number> --jq '.data.repository.issue.id')
   ```
   Resolve the parent issue's GraphQL node ID the same way. Then call:
   ```bash
   gh api graphql -f query='mutation($parentId:ID!,$childId:ID!){addSubIssue(input:{issueId:$parentId,subIssueId:$childId}){issue{number}subIssue{number}}}' -F parentId=$parent_id -F childId=$child_id
   ```
   If the GraphQL mutation isn't available on the repo (older GHES, sub-issues feature off), fall back to text linkage in the body (`Parent: #<parent>`) and surface a warning to the caller. Do NOT silently proceed without recording the parent.
4. Phase 4b relationship lines (`Blocks #...`, `Blocked by #...`, etc.) are already in the body. No separate API call is needed — `lisa:github-read-issue` parses them on read.
5. If the issue changes runtime behavior, invoke the `lisa:github-add-journey` skill to append the Validation Journey section.

### UPDATE

1. Re-read the current body via `gh issue view <number> --repo <org>/<repo> --json body --jq '.body'`. Edit only the sections being changed; preserve everything else verbatim.
2. Apply the edit:
   ```bash
   gh issue edit <number> --repo <org>/<repo> --body-file /tmp/updated-body.md
   ```
3. Add labels: `gh issue edit <number> --add-label "<new-label>"`. Remove labels: `--remove-label`.
4. Add new relationship lines to `## Links` if needed. Existing links are not touched unless explicitly removed.

## Phase 7 — Verify

Call the `lisa:github-verify` skill on the resulting issue. `lisa:github-verify` re-fetches the issue and runs `lisa:github-validate-issue` against the live state — same gates as Phase 5.5, applied to what GitHub actually stored.

If it reports failures, fix them before returning.

## Phase 8 — Announce

Post a creation comment via `gh issue comment <number> --repo <org>/<repo> --body-file /tmp/announce.md` with:
- `[<repo>]` prefix when the issue is repo-scoped (Bug / Task / Sub-task).
- Who the issue is assigned to.
- The relationships set in Phase 4b (`Blocks`, `Blocked by`, `Relates to`) with links.
- Any remote PRs attached.

Skip on UPDATE when no material change was made.

## GitHub Issues data model

The mapping below is the single source of truth for how JIRA concepts translate to GitHub Issues. Mirror this in `lisa:github-validate-issue` and `lisa:github-read-issue` so the shape is symmetric.

| JIRA concept | GitHub Issues equivalent |
|---|---|
| Issue type | Label `type:<value>` |
| Status (Ready / In Progress / Code Review / On Dev / Done) | Label `status:<value>` |
| Epic / Story / Sub-task hierarchy | Native sub-issues via `gh api graphql addSubIssue` |
| Acceptance Criteria | `## Acceptance Criteria` markdown section with a Gherkin code-fence |
| Validation Journey | `## Validation Journey` markdown section |
| Source artifacts | `## Source Artifacts` markdown section grouped by domain |
| Epic parent | Native parent sub-issue link |
| Issue links (`blocks` / `is blocked by` / `relates to` / `duplicates` / `clones`) | Quick-action lines under `## Links`: `Blocks #N`, `Blocked by #N`, `Relates to #N`, `Duplicates #N`, `Cloned from #N` |
| Remote links (PRs, dashboards) | Markdown links under `## Links` plus native `Resolves #<pr>` for PR↔Issue auto-close |
| Components | Label `component:<name>` |
| Fix version | Label `fix-version:<value>` (or native milestone) |
| Story points | Label `points:<n>` |
| Priority | Label `priority:<value>` |
| Custom-field "Reporter" (the human) | The issue's `author` (immutable) plus the `Filed by:` line in the body |
| Worklog | Comments (no native time tracking) |
| Triage marker | Label `claude-triaged-<repo>` |

## Rules

- Never create a non-bug issue without a parent Epic / Story (sub-issue link).
- Never skip relationship discovery — both git history AND `gh issue list` searches must run; outcomes documented under `## Relationship Search`. "None found" is acceptable only when documented.
- Never create a Bug, Task, or Sub-task whose AC references work in a different repo. GitHub Issues already live in one repo; reject AC bullets that span others — split into per-repo issues under a shared Epic.
- Never include a runtime-behavior issue without a target backend environment, and never include an authenticated-surface issue without sign-in credentials.
- Never overwrite an issue body without reading the current version first.
- All writes go through this skill (or the `tracker-write` shim). Other vendor-neutral skills must NEVER call `gh issue create` directly.
- The gate logic lives in `lisa:github-validate-issue`, NOT here. This skill calls the validator at Phase 5.5 and Phase 7. When a gate needs to change, change it in `lisa:github-validate-issue`.
- Never bypass the sub-issue mutation by encoding the parent only in the body. The native sub-issue link is what `lisa:github-read-issue` and the GitHub UI use to render the hierarchy.
