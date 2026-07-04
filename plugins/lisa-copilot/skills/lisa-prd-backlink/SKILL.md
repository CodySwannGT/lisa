---
name: lisa-prd-backlink
description: "Update a source PRD with an always-written, machine-readable `## Tickets` (alias `## Generated Work`) section linking back to every work item created from it. Each entry carries a parseable ref + URL + type + parent token so the generated child set is readable without scraping prose. Vendor-aware on the source side (Notion / Confluence / Linear / GitHub Issue / file) and tracker-agnostic on the ticket side; the documented section is written for every vendor, additive to native hierarchy linking. Idempotent — regenerates the section on each run rather than appending, so re-planning never accumulates stale links. Invoked by the *-to-tracker skills at the end of their pipeline and standalone if a PRD's Tickets section needs to be refreshed."
allowed-tools: ["Skill", "Bash", "Read", "Edit", "Write", "Glob", "Grep"]
---

# PRD Back-link

Write or update the `## Tickets` section of a source PRD so it links to every work item created from that PRD. The Debrief flow (and a human reading the PRD months later) uses this section as the canonical work-item set for the initiative.

This documented section is the **always-written, machine-readable record** of the generated child set. It is written for **every** `source_type` — including the vendors that also get a native hierarchy link (`github` / `linear` / `jira`) — so the generated top-level work is readable later from the PRD body alone, without parsing free-form comments or depending on a native relationship that may be unavailable on older hosts or across vendors. Native hierarchy linking (see the per-vendor sections below) is **additive** to this section, never a substitute for it. This is the documented-section leg of the `prd-lifecycle-rollup` rule (cited by slug; its taxonomy is not restated here).

## Input

Pass `$ARGUMENTS` as a single JSON-style block:

```json
{
  "source_type": "notion" | "confluence" | "linear" | "github" | "file",
  "source_ref": "<URL, page id, project id, issue ref, or absolute file path>",
  "tickets": [
    { "key": "<tracker-key>", "title": "<summary>", "type": "Epic|Story|Task|Sub-task|Bug|Spike", "url": "<link>", "parent_key": "<key or null>" }
  ],
  "section_heading": "## Tickets"   // optional override; default "## Tickets"
}
```

## Behaviour

1. **Fetch the current PRD content** using the source's native read tool:
   - `notion` → `notion-fetch`
   - `confluence` → `getConfluencePage`
   - `linear` → Linear MCP project / issue read
   - `github` → `gh issue view`
   - `file` → `Read` tool on the absolute path
2. **Locate the existing section.** Search for `section_heading` (default `## Tickets`). The canonical heading is `## Tickets`; `## Generated Work` is an accepted alias that the reader recognizes — match either heading when locating an existing section so a PRD authored with either name is found and regenerated in place (never duplicated under the other name). If present under either name, you will replace it (keeping whichever heading was already there, or the explicit `section_heading` override). If not present, you will append a new section just before any closing footer / sign-off / signature block, otherwise at the end.
3. **Render the section.** Always render it — for every `source_type`, even when a native hierarchy link was also made (additive, not exclusive). Use the format below. Group by Epic. Within an Epic, group by Story. Sub-tasks nest under their Story. Bugs and Spikes that are not under a Story go in a flat list at the bottom. Each entry carries a machine-readable token (ref + URL + type + parent) so the generated child set is parseable without reading prose — see [Format](#format).
4. **Write the updated PRD back** using the source's native write tool:
   - `notion` → `notion-update-page`
   - `confluence` → `updateConfluencePage`
   - `linear` → Linear MCP update
   - `github` → `gh issue edit --body`
   - `file` → `Edit` (preferred) or `Write` (full rewrite if needed)
5. **Record the PRD→child relationship in the source tool's native hierarchy** where the source supports it and the destination tracker is the same system. Each supported source has its own native-linking section, all governed by the same generated-top-level-work contract, child-ref idempotency, and graceful-degradation discipline from the `prd-lifecycle-rollup` rule:
   - `github` (same repo as the created tickets) → native GitHub **sub-issue** of the PRD issue — see [Native parent linking (GitHub)](#native-parent-linking-github).
   - `linear` (PRD also lives in Linear) → native **parent / project** relationship — see [Native parent linking (Linear)](#native-parent-linking-linear).
   - `jira` (PRD also lives in the same JIRA/Atlassian instance) → native **parent / Epic link** or a documented **issue-link type** — see [Native parent linking (JIRA)](#native-parent-linking-jira).

   The documented `## Tickets` section from step 3 is always written regardless; native linking is **in addition to** it, not a replacement (the documented section is the cross-vendor and older-host fallback per the `prd-lifecycle-rollup` rule). Sources without native issue hierarchy (Notion, Confluence, file) rely on the documented section alone, as does any cross-vendor combination (e.g. a Notion PRD with a JIRA tracker).
6. **Return** the rendered section (so the caller can include it in its own report) and the source URL of the updated PRD.

## Format

The rendered section must be deterministic — same inputs produce identical output bytes. This is what makes idempotency reliable. Every entry is simultaneously **human-readable** (a nested markdown link) and **machine-readable** (a trailing structured token), so the generated child set can be enumerated by parsing this section alone — the contract LPC-1.3 rollup (`github-prd-intake` / `*-prd-intake`) reads against, with no need to scrape free-form comments.

```markdown
## Tickets

_Generated by `lisa-prd-backlink`. Regenerated on every Plan run; do not edit by hand._

### <Epic key>: <Epic title>

- [<Epic key>](<url>) — Epic <!-- lisa:gw ref=<ref> url=<url> type=Epic parent= -->
  - [<Story key>](<url>) — Story: <title> <!-- lisa:gw ref=<ref> url=<url> type=Story parent=<Epic ref> -->
    - [<Sub-task key>](<url>) — Sub-task: <title> <!-- lisa:gw ref=<ref> url=<url> type=Sub-task parent=<Story ref> -->
    - [<Sub-task key>](<url>) — Sub-task: <title> <!-- lisa:gw ref=<ref> url=<url> type=Sub-task parent=<Story ref> -->
  - [<Story key>](<url>) — Story: <title> <!-- lisa:gw ref=<ref> url=<url> type=Story parent=<Epic ref> -->

### <Epic key>: <Epic title>
...

### Unparented items

- [<Bug key>](<url>) — Bug: <title> <!-- lisa:gw ref=<ref> url=<url> type=Bug parent= -->
- [<Spike key>](<url>) — Spike: <title> <!-- lisa:gw ref=<ref> url=<url> type=Spike parent= -->
```

### Machine-readable entry token

Every list entry ends with a single-line HTML comment — invisible in rendered markdown, so the section stays clean for humans, but a stable, greppable record for machines:

```text
<!-- lisa:gw ref=<ref> url=<url> type=<type> parent=<parent-ref or empty> -->
```

- **`lisa-gw`** — a fixed sentinel (`gw` = generated work). A reader enumerates the generated child set by matching `<!-- lisa:gw ` lines; it never has to parse the surrounding prose, headings, or indentation.
- **`ref`** — the child-ref identity from the `prd-lifecycle-rollup` rule: `<org>/<repo>#<n>` for GitHub, the issue/project identifier (e.g. `TEAM-123`) for Linear, the issue key (e.g. `PROJ-123`) for JIRA. This is the same dedupe key native linking uses, so the documented record and the native record agree.
- **`url`** — the canonical URL of the work item.
- **`type`** — `Epic | Story | Task | Sub-task | Bug | Spike` (verbatim from the ticket's `type`).
- **`parent`** — the **`ref`** of this entry's parent (its `parent_key` resolved to the parent's ref), or **empty** when the entry is top-level (`parent_key` null/empty). A reader selects the **generated top-level child set** — exactly what the PRD owns per the rule — as every `lisa-gw` line whose `parent` is empty.

The visible markdown link and the token always carry the same `ref`/`url`/`type`; the token is the authoritative machine field (the prose may wrap or be reflowed by a host editor, the comment line will not). Field order within the token is fixed (`ref`, `url`, `type`, `parent`) so output is byte-stable.

If the input contains zero items, write the section header with a single line: `_No tickets created — Plan flow may not have completed._` Do not omit the section; presence-of-section is itself a signal to Debrief, and the always-written guarantee means a reader can always distinguish "ran, produced nothing" from "never ran."

## Idempotency

Rendering rules:
- Sort epics by key (lexical). Sort stories within an epic by key. Sort sub-tasks within a story by key. Sort the unparented list by `(type, key)`. The same sort applies to the `lisa-gw` tokens (each token sits on its entry's line), so the machine-readable order is identical across runs.
- The line `_Generated by ..._` is fixed text — does not include a timestamp. A timestamp would defeat the diff-equality check Debrief relies on.
- Regenerate the whole section from the current ticket set on every run — **never append**. Dedupe is by **child-ref** (the token's `ref`, per the `prd-lifecycle-rollup` idempotency dedupe key): the same ticket set produces a byte-identical section with no duplicate entries, and re-running over an existing section is a no-op diff. A ticket present in a prior run but absent now simply does not reappear (stale links never accumulate).
- **Match by stable ref, never by title** (`prd-lifecycle-rollup` idempotency dedupe key). A child is identified by its `ref` token alone — a ticket whose `title` changed but whose `ref` is unchanged is the **same** entry: its displayed title is refreshed in place and it appears exactly once, never duplicated. Title is rendered, never matched on.

## Native parent linking (GitHub)

When `source_type: github` **and** the PRD issue lives in the same repository as the created tickets, make the PRD the structural parent of the work it generated by linking each generated top-level work item as a native GitHub **sub-issue** of the PRD issue. This is the GitHub leg of the PRD→child native-hierarchy requirement in the `prd-lifecycle-rollup` rule (cite it by slug; do not restate its taxonomy here). The documented `## Tickets` section is still written either way — native linking is the first-class relationship; the documented section is the durable fallback for cross-vendor and older hosts.

This section is GitHub-only. The Linear and JIRA native parents have their own sections below ([Linear](#native-parent-linking-linear), [JIRA](#native-parent-linking-jira)); the documented-section-only fallback for Notion / Confluence / file / cross-vendor sources is governed by the `prd-lifecycle-rollup` rule and is out of scope for this GitHub section.

### What gets linked — generated top-level work only

Per the `prd-lifecycle-rollup` "generated top-level work" contract, the PRD owns **only** its generated top-level work as direct children:

- A ticket is **top-level** when its `parent_key` is null/empty — these are the created Epic(s) and any top-level Story created directly under the PRD. Link these as sub-issues of the PRD.
- A ticket with a non-null `parent_key` is a **descendant** (a Story under an Epic, or a leaf Sub-task) — it is owned by its own top-level parent, **never** linked directly to the PRD. Leaf Sub-tasks are explicitly NOT direct PRD children (PRD #525 non-goal).

So if the PRD generated `Epic E1 → Story S1 → Sub-task T1`, only `E1` becomes a sub-issue of the PRD; `S1` is a sub-issue of `E1` and `T1` of `S1` (those links were already made by the write path), and neither `S1` nor `T1` is a direct child of the PRD.

### Same-repo guard

Native sub-issue linking only applies when the PRD and the work item are in the same repository. Parse `owner/repo` from `source_ref` (the PRD URL or `<org>/<repo>#<n>` token) and from each top-level ticket's `key`/`url`. Skip native linking for any ticket whose repo differs from the PRD's repo (cross-repo or cross-vendor) — record those in the documented section only. The cross-vendor case (e.g. a GitHub PRD with a JIRA/Linear tracker) never reaches this path because the ticket is not a GitHub issue.

### Idempotency — dedupe by child-ref

The dedupe key is **child-ref identity** (`owner/repo#number`), per the `prd-lifecycle-rollup` idempotency rule. Before adding any link, read the PRD's current sub-issues and skip any child already linked, so re-running `prd-backlink` never creates duplicate sub-issue links and is a no-op when everything is already linked.

1. **Read the PRD's existing sub-issues** (same GraphQL `subIssues` query `lisa-github-read-issue` Phase 3 uses), and build the set of already-linked child refs:

   ```bash
   gh api graphql -f query='query($org:String!,$repo:String!,$number:Int!){repository(owner:$org,name:$repo){issue(number:$number){subIssues(first:100){nodes{number repository{nameWithOwner}}}}}}' \
     -F org=<prd_org> -F repo=<prd_repo> -F number=<prd_number> \
     --jq '.data.repository.issue.subIssues.nodes[] | "\(.repository.nameWithOwner)#\(.number)"'
   ```

   The resulting `owner/repo#number` strings are the existing child-ref set.

2. **For each generated top-level ticket** in the same repo whose child-ref is **not** already in that set, resolve node IDs and call `addSubIssue` (the same mutation `lisa-github-write-issue` Phase 6 step 3 uses):

   ```bash
   prd_id=$(gh api graphql -f query='query($org:String!,$repo:String!,$number:Int!){repository(owner:$org,name:$repo){issue(number:$number){id}}}' -F org=<prd_org> -F repo=<prd_repo> -F number=<prd_number> --jq '.data.repository.issue.id')
   child_id=$(gh api graphql -f query='query($org:String!,$repo:String!,$number:Int!){repository(owner:$org,name:$repo){issue(number:$number){id}}}' -F org=<org> -F repo=<repo> -F number=<child_number> --jq '.data.repository.issue.id')
   gh api graphql -f query='mutation($parentId:ID!,$childId:ID!){addSubIssue(input:{issueId:$parentId,subIssueId:$childId}){issue{number}subIssue{number}}}' -F parentId="$prd_id" -F childId="$child_id"
   ```

   A child already in the existing-sub-issue set is a no-op — do not call the mutation for it.

### Graceful degradation

- **Already linked.** Covered by the dedupe read above (no mutation issued). If a concurrent run linked it between the read and the mutation, GitHub rejects the duplicate — treat that rejection as success (the desired end state already holds), not a failure.
- **Mutation unavailable** (older GHES, sub-issues feature off, or the `addSubIssue`/`subIssues` fields are missing). Fall back to the documented `## Tickets` section only and surface a warning to the caller (`native sub-issue linking unavailable — documented section written`). Never silently drop the relationship and never abort the run — the documented section is the contract that always lands.

## Native parent linking (Linear)

When `source_type: linear` **and** the PRD also lives in Linear (same workspace as the created work items), make the PRD the structural parent of the work it generated using Linear's native **parent / project** relationship. This is the Linear leg of the PRD→child native-hierarchy requirement in the `prd-lifecycle-rollup` rule (cite it by slug; do not restate its taxonomy here). The documented `## Tickets` section is still written either way — native linking is the first-class relationship; the documented section is the durable fallback for cross-vendor and older hosts.

This section is Linear-only. The GitHub and JIRA native parents have their own sections; the documented-section-only fallback for Notion / Confluence / file / cross-vendor sources is out of scope here.

### Which Linear primitive — PRD shape decides

Linear models top-level grouping two ways, and the PRD's own entity type decides which native relationship to use:

- **PRD is a Linear Project** (the common case — a PRD project groups its generated work). Generated top-level **Issues** are attached to the PRD by setting their `projectId` to the PRD Project's id. The Project *is* the native parent of its Issues; no separate parent-issue link is needed.
- **PRD is a Linear Issue** (a parent issue, not a project). Generated top-level Issues are attached as native **sub-Issues** of the PRD Issue by setting their `parentId` to the PRD Issue's id.

Either way the write surface is `lisa-linear-access operation: save-issue` with the single relevant field (`projectId` or `parentId`) — the same primitive `lisa-linear-write-issue` uses to set a Story's `projectId` (Epic Project) and a Sub-task's `parentId` (Story Issue). Send **only** that field on update; Linear treats `save_issue` as a full overwrite of the fields named (`lisa-linear-write-issue` Phase 6 UPDATE), so resending other fields would clobber them.

### What gets linked — generated top-level work only

Per the `prd-lifecycle-rollup` "generated top-level work" contract, the PRD owns **only** its generated top-level work as direct children:

- A work item is **top-level** when its `parent_key` is null/empty — these are the created Epic(s) (Linear Projects) and any top-level Story (Linear Issue) created directly under the PRD. Attach these to the PRD via `projectId`/`parentId`.
- A work item with a non-null `parent_key` is a **descendant** (a Story under an Epic Project, or a leaf Sub-task) — it is owned by its own top-level parent, **never** linked directly to the PRD. Leaf Sub-tasks are explicitly NOT direct PRD children (PRD #525 non-goal); their `parentId` already points at their Story (set by the write path), and overwriting it to point at the PRD would break that hierarchy.

So if the PRD generated `Epic E1 (Project) → Story S1 (Issue) → Sub-task T1 (sub-Issue)`, only the top-level unit is attached to the PRD; `S1` already carries `projectId = E1` and `T1` already carries `parentId = S1` (set by the write path), and neither `S1` nor `T1` is a direct child of the PRD.

### Idempotency — dedupe by child-ref

The dedupe key is **child-ref identity** — the Linear issue/project identifier (e.g. `TEAM-123`) or its UUID — per the `prd-lifecycle-rollup` idempotency rule. Before attaching any child, read the PRD's current children and skip any child already attached, so re-running `prd-backlink` never duplicates a relationship and is a no-op when everything is already attached.

1. **Read the PRD's existing children** (the same reads `lisa-linear-read-issue` uses for Project members and sub-Issues):
   - PRD-as-Project → `lisa-linear-access operation: list-issues({project: <prd_project_id>})` and collect each member Issue's identifier/UUID.
   - PRD-as-Issue → `lisa-linear-access operation: get-issue({id: <prd_issue_id>})` and collect its sub-Issue identifiers/UUIDs.

   The resulting identifiers/UUIDs are the existing child-ref set.

2. **For each generated top-level item** whose child-ref is **not** already in that set, attach it with a single-field `save_issue`:
   - PRD-as-Project → `lisa-linear-access operation: save-issue({id: <child_id>, projectId: <prd_project_id>})`.
   - PRD-as-Issue → `lisa-linear-access operation: save-issue({id: <child_id>, parentId: <prd_issue_id>})`.

   A child already in the existing-children set is a no-op — do not issue the `save_issue` call for it. Reading the child's current `projectId`/`parentId` and finding it already equal to the PRD's id is the same no-op (attaching to the value it already holds changes nothing).

### Graceful degradation

- **Already attached.** Covered by the dedupe read above (no write issued). If a concurrent run attached it between the read and the write, re-setting the same `projectId`/`parentId` is harmless (the desired end state already holds) — treat it as success, not a failure.
- **No native hierarchy / cross-vendor.** If the PRD is not itself a Linear entity (cross-vendor — e.g. a Notion PRD with a Linear tracker, which reaches this skill as `source_type: notion`, not `linear`), or the workspace/team does not expose the relationship, this is a clean **no-op**: fall back to the documented `## Tickets` section only and surface a warning to the caller (`native Linear parent linking unavailable — documented section written`). Never silently drop the relationship and never abort the run — the documented section is the contract that always lands.

## Native parent linking (JIRA)

When `source_type: jira` **and** the PRD also lives in the same JIRA/Atlassian instance as the created tickets, make the PRD the structural parent of the work it generated using JIRA's native **parent / Epic link**, or — where the instance does not allow an Epic/Story to be a child of the PRD's issue type — a documented **issue-link type** (e.g. `relates to`). This is the JIRA leg of the PRD→child native-hierarchy requirement in the `prd-lifecycle-rollup` rule (cite it by slug; do not restate its taxonomy here). The documented `## Tickets` section is still written either way — native linking is the first-class relationship; the documented section is the durable fallback for cross-vendor and older hosts.

This section is JIRA-only. The GitHub and Linear native parents have their own sections; the documented-section-only fallback for Notion / Confluence / file / cross-vendor sources is out of scope here.

### Which JIRA primitive — native parent first, issue-link fallback

JIRA's hierarchy support varies by instance and issue-type scheme, so prefer the strongest relationship the instance allows:

1. **Native parent / Epic link (preferred).** If the PRD's issue type can be a parent of the generated top-level type in the instance's hierarchy (e.g. the PRD is a parent-level issue and the generated work is Epics/Stories beneath it), set the generated top-level issue's **parent** to the PRD — the same parent/Epic-link surface `lisa-jira-write-ticket` uses to set a Story's epic parent (Phase 4a + Phase 6 CREATE). Use `lisa-atlassian-access` `operation: write-ticket payload: {key: <child>, parent: <prd_key>}` (send only the parent field on update so other fields are preserved — `lisa-jira-write-ticket` Phase 6 UPDATE).
2. **Documented issue-link type (fallback).** If the instance's hierarchy does not allow the PRD to parent the generated type (common when both are Epics, or the PRD is itself an Epic and Epics cannot nest), create a native **issue link** of a documented type instead — `lisa-atlassian-access` `operation: link from: <prd_key> to: <child_key> type: "<link-type>"` — the same link surface `lisa-jira-write-ticket` Phase 6 step 3 uses for `blocks` / `relates to` / etc. Use the project's configured PRD→work link type (default `relates to`); surface an error if an unknown type is passed rather than inventing one.

Choosing between (1) and (2) is per the instance's capability — never invent a parent relationship the issue-type scheme rejects, and never silently downgrade without recording which relationship was used.

### What gets linked — generated top-level work only

Per the `prd-lifecycle-rollup` "generated top-level work" contract, the PRD owns **only** its generated top-level work as direct children:

- A ticket is **top-level** when its `parent_key` is null/empty — these are the created Epic(s) and any top-level Story created directly under the PRD. Attach these to the PRD via the native parent or the documented issue-link type.
- A ticket with a non-null `parent_key` is a **descendant** (a Story under an Epic, or a leaf Sub-task) — it is owned by its own top-level parent, **never** linked directly to the PRD. Leaf Sub-tasks are explicitly NOT direct PRD children (PRD #525 non-goal); their parent already points at their Story/Epic (set by the write path), and re-parenting them to the PRD would break that hierarchy.

So if the PRD generated `Epic E1 → Story S1 → Sub-task T1`, only `E1` is attached to the PRD; `S1` already carries its epic parent `E1` and `T1` its parent `S1` (set by the write path), and neither `S1` nor `T1` is a direct child of the PRD.

### Idempotency — dedupe by child-ref

The dedupe key is **child-ref identity** — the JIRA issue key (e.g. `PROJ-123`) — per the `prd-lifecycle-rollup` idempotency rule. Before attaching any child, read the PRD's current children/links and skip any child already attached, so re-running `prd-backlink` never duplicates a parent assignment or issue link and is a no-op when everything is already attached.

1. **Read the PRD's existing children and links** (the same reads `lisa-jira-read-ticket` uses):
   - Native-parent path → enumerate the PRD's children via the epic-link/parent JQL `lisa-jira-read-ticket` Phase 5 uses (`"Epic Link" = <PRD-KEY>` or `parent = <PRD-KEY>`), and collect their keys.
   - Issue-link path → read the PRD's `issuelinks` (`lisa-jira-read-ticket` Phase 4) and collect the keys already linked with the configured PRD→work link type.

   The resulting issue keys are the existing child-ref set.

2. **For each generated top-level ticket** whose key is **not** already in that set, attach it via the chosen primitive:
   - Native-parent → `lisa-atlassian-access` `operation: write-ticket payload: {key: <child>, parent: <prd_key>}`.
   - Issue-link → `lisa-atlassian-access` `operation: link from: <prd_key> to: <child> type: "<link-type>"`.

   A child already in the existing-children/links set is a no-op — do not issue the write/link for it.

### Graceful degradation

- **Already attached.** Covered by the dedupe read above (no write issued). If a concurrent run attached it between the read and the write, JIRA either no-ops the identical parent assignment or rejects the duplicate link — treat that as success (the desired end state already holds), not a failure.
- **No native hierarchy / cross-vendor.** If the PRD is not itself a JIRA issue (cross-vendor — e.g. a Notion or Confluence PRD with a JIRA tracker, which reaches this skill as `source_type: notion`/`confluence`, not `jira`), or neither a native parent nor a documented issue-link type is available in the instance, this is a clean **no-op**: fall back to the documented `## Tickets` section only and surface a warning to the caller (`native JIRA parent linking unavailable — documented section written`). Never silently drop the relationship and never abort the run — the documented section is the contract that always lands.

## Failures

- **Source unreachable / permission denied.** Stop and report. Do not silently swallow.
- **Section already present but in a non-standard format** (e.g., user hand-edited it). Replace it anyway — the warning line `_do not edit by hand_` is the contract. Note in the run output that an existing section was overwritten.
- **Source is a Notion database URL, a Confluence space URL, or any other non-page input.** Stop — back-linking only makes sense against a single PRD page, not a queue. Direct the caller to pass the specific page.

## Output

```text
PRD back-link updated: <source_url>
Section: ## Tickets — <n> epics, <n> stories, <n> sub-tasks, <n> unparented (<bugs/spikes>)
Native parent links: <n> linked, <n> already linked (<vendor> native hierarchy; documented section is the fallback)
```

The `Native parent links` line reports whichever vendor's native linking ran:
- **GitHub** (same-repo PRD) → sub-issues via `addSubIssue`.
- **Linear** (PRD in Linear) → `projectId`/`parentId` attachments via `save_issue`.
- **JIRA** (PRD in JIRA) → native parent / Epic link, or documented issue-link type.

Omit the `Native parent links` line when no native linking applies (Notion / Confluence / file source, or any cross-vendor combination — documented section only). If native linking was attempted but unavailable for the vendor, replace the counts with the degradation warning from that vendor's Graceful degradation subsection.

## Related rules

- `prd-lifecycle-rollup` — the vendor-neutral source of truth for PRD→generated-top-level-work ownership, the per-vendor terminal predicate, PRD `shipped` rollup, and the child-ref idempotency dedupe key. This skill implements both the **documented always-written, machine-readable generated-work section** leg (the universal fallback written for every vendor) and the GitHub, Linear, and JIRA native-linking legs of that rule; it cites the rule by slug rather than restating its taxonomy.
