---
name: verify-prd
description: "Initiative-level PRD acceptance gate. Given a PRD ref/URL (GitHub Issue, Linear project/issue, Notion page, Confluence page, or JIRA issue), resolves the source vendor, reads the PRD body and its generated top-level child work set via the prd-lifecycle-rollup contract (native hierarchy first, machine-readable generated-work section fallback — never reimplementing child enumeration), and confirms every required generated top-level work item is terminal before any empirical verification runs. If any required top-level child is non-terminal, it reports the incomplete child set and STOPS without verifying or transitioning the PRD. The entry point of the PRD-level verification flow; the PASS path (spec-conformance + empirical verification + shipped → verified), the FAIL path (shipped → blocked + fix issues), and idempotency are handled by sibling work."
allowed-tools: ["Skill", "Bash", "Read", "mcp__claude_ai_Notion__notion-fetch", "mcp__claude_ai_Notion__notion-get-comments", "mcp__atlassian__getConfluencePage", "mcp__atlassian__getConfluencePageDescendants", "mcp__atlassian__getJiraIssue", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getAccessibleAtlassianResources", "mcp__linear-server__get_project", "mcp__linear-server__list_issues", "mcp__linear-server__get_issue", "mcp__linear-server__list_documents", "mcp__linear-server__get_document"]
---

# PRD-level Verification: $ARGUMENTS

`/lisa:verify-prd <prd>` is the **initiative-level acceptance gate**. It runs *after* a PRD is `shipped` (all generated top-level work terminal, per `prd-lifecycle-rollup`'s rollup phase) and proves the shipped product actually matches the PRD — not merely that every ticket is closed. `shipped` is **necessary but not sufficient** for `verified`: a PRD can have every child ticket closed while still missing a requirement, diverging from its acceptance criteria, or failing a real user workflow.

This is distinct from `/lisa:verify`, which empirically verifies a **single work item** (a ticket / story / sub-task) in its target environment as part of that item's Build/Fix/Improve flow. `/lisa:verify` drives a build ticket to `done` at the leaf/build level; it does not read the PRD or judge initiative-level acceptance. `/lisa:verify-prd` operates one level up, over the whole initiative. See the `prd-lifecycle-rollup` rule's "PRD-level verification vs ticket verification" section for the full distinction.

`$ARGUMENTS` is a single PRD reference: a **GitHub issue URL** (or `<org>/<repo>#<n>`), a **Linear project/issue URL**, a **Notion page URL**, a **Confluence page URL**, or a **JIRA issue key/URL**.

## Confirmation policy

Do **not** re-prompt once invoked. Like the `*-prd-intake` skills, the caller has already authorized the run by invoking the skill; asking the user to confirm before reading or before applying the guard defeats the purpose of a batchable acceptance gate. Run the front-half (resolve → read child set → guard) to completion and report.

## Scope of this skill

This skill is the **read/guard front-half** of PRD-level verification:

1. Resolve the PRD ref and detect its source vendor.
2. Read the PRD body and its **generated top-level child work set** via the `prd-lifecycle-rollup` contract.
3. Apply the per-vendor terminal predicate to the generated top-level work and run the **terminal-child guard**: if any required top-level child is non-terminal, report the incomplete set and STOP — do not run empirical verification, do not transition the PRD.

The remaining phases of PRD-level verification are **out of scope** here and are delivered by sibling work (this skill is their entry point):

- **PASS path** — spec-conformance against the PRD's requirements + empirical verification of the shipped surface, then the `shipped → verified` transition with evidence.
- **FAIL path** — on verification failure, the `shipped → blocked` transition, a product-readable failure report, and linked fix issues for the missing/incorrect behavior.
- **Idempotency** — re-runs producing no duplicate evidence, fix issues, or lifecycle transitions.

When the terminal-child guard passes (all required generated top-level work is terminal), this front-half hands off to the PASS/FAIL phases. Until those phases land, a passing guard means "ready for verification"; this skill does not itself transition the PRD to `verified` or `blocked`.

## Phase 1 — Resolve the PRD ref and detect the source vendor

Detect the vendor from `$ARGUMENTS` the same way `prd-ticket-coverage` / `prd-backlink` do — from the host (or key shape for JIRA), never by guessing:

| Input shape | Vendor | Read surface |
|---|---|---|
| `github.com/<org>/<repo>/issues/<n>` or `<org>/<repo>#<n>` | **GitHub Issues** | `gh` CLI (Lisa uses the CLI exclusively for GitHub — no GitHub MCP) |
| `linear.app/...` | **Linear** | `mcp__linear-server__get_project` / `get_issue` |
| `notion.so` / `notion.site` | **Notion** | `mcp__claude_ai_Notion__notion-fetch` (`include_discussions: true`) |
| `*.atlassian.net/wiki/...` | **Confluence** | `mcp__atlassian__getConfluencePage` (+ descendants) |
| JIRA issue key (e.g. `PROJ-123`) or `*.atlassian.net/browse/...` | **JIRA** | `mcp__atlassian__getJiraIssue` |

Read the PRD body via the vendor-appropriate surface. The vendor that owns the PRD source is what Phase 2 reads the child set from; it is independent of which tracker hosts the generated tickets (a Notion PRD can own JIRA tickets — the cross-vendor case is handled by the documented generated-work section in Phase 2).

Where the PRD lives in the same vendor as the configured `tracker` (`.lisa.config.json`), prefer reading the PRD ticket through `lisa:tracker-read` so this skill stays agnostic of which tracker hosts the work — `tracker-read` dispatches to `lisa:github-read-issue` / `lisa:jira-read-ticket` / `lisa:linear-read-issue` per config and returns the consolidated context bundle (PRD body, native children, links). For PRD sources with no tracker counterpart (Notion / Confluence / cross-vendor), read the PRD body directly via the vendor surface above.

## Phase 2 — Read the generated top-level child work set

**Do NOT reimplement child enumeration.** Consume the PRD→generated-top-level-work relationship recorded by the merged child-linking work (`prd-backlink` native linking + its always-written machine-readable generated-work section), exactly as `github-prd-intake`'s rollup phase consumes it. Read the **generated top-level work** only — the PRD's created Epics and any top-level Story created directly under it — and **exclude** leaf Sub-tasks and any Story nested under a generated Epic, per the `prd-lifecycle-rollup` rule's generated-top-level-work contract.

Use two sources, **native first**, deduped by child-ref identity:

1. **Native hierarchy (primary).** Read the PRD's direct native children — these are its top-level children:
   - **GitHub** — the PRD issue's direct `subIssues` nodes (the GraphQL `subIssues` query `lisa:github-read-issue` Phase 3 uses; capture `number title state url stateReason labels`).
   - **Linear** — for a PRD Project, its member Issues (`list_issues({project})`); for a PRD Issue, its sub-Issues (`get_issue` children). Capture each child's `state` (workflow state + category).
   - **JIRA** — the PRD's children via the epic-link/parent JQL `lisa:jira-read-ticket` Phase 5 uses (`"Epic Link" = <PRD-KEY>` or `parent = <PRD-KEY>`). Capture each child's `statusCategory`.
   - **Notion / Confluence** — no native issue hierarchy; use the documented section below.

2. **Documented generated-work section (fallback / cross-vendor).** When native hierarchy is unavailable (older host, cross-vendor PRD→tracker, or the relationship was only recorded in the PRD body), parse the machine-readable generated-work section `prd-backlink` writes to the PRD body (`## Tickets`, alias `## Generated Work`). Enumerate the `<!-- lisa:gw ref=… url=… type=… parent=… -->` tokens; the **generated top-level child set is every token whose `parent` is empty** (top-level), exactly as `prd-backlink` documents. Tokens with a non-empty `parent` are descendants — skip them. For GitHub, this is the same `awk` extraction `github-prd-intake` Phase 3f.2 uses.

**Dedupe by child-ref identity** (`owner/repo#number` for GitHub, the issue/project identifier for Linear, the issue key for JIRA, the recorded ref for Notion/Confluence — the `prd-lifecycle-rollup` idempotency dedupe key) so a child appearing in both the native graph and the documented section is counted once. **Match by stable ref, never by title.**

If neither source yields any generated top-level child (the PRD generated nothing, or the relationship was never recorded), report `no generated top-level children — cannot verify an empty PRD` and STOP. Do not transition the PRD.

## Phase 3 — Terminal-child guard

Apply the **per-vendor terminal-state predicate from the `prd-lifecycle-rollup` rule** to every generated **top-level** work item (cite the rule by slug — do not restate its predicate table here). In summary, a top-level child is:

- **Terminal** — it has reached its source/tracker's done/shipped state (GitHub: closed + the resolved build `done` role label where used; Linear: a `done`-category completed state; JIRA: `statusCategory.key == "done"`; Notion/Confluence: the documented generated-work entry marked done). A generated Epic is terminal only when *it* has rolled up to its own terminal state per `leaf-only-lifecycle` — read the child's own resolved state; do not re-derive it from its leaves.
- **Terminal-but-dropped** — closed-as-not-planned (GitHub `stateReason == "not_planned"`) / canceled (Linear) / won't-do. It does **not** hold the PRD open and is excluded from the required set.
- **Incomplete / blocked** — anything else (still open, or closed without the `done` role). It holds the PRD open.

The **required** set is the top-level children minus the terminal-but-dropped ones. Branch:

**Any required top-level child is non-terminal** (the "Given a PRD has generated child work that is not terminal" scenario):

1. **STOP.** Do **not** run empirical verification or spec-conformance.
2. **Leave the PRD lifecycle untouched** — it stays at `shipped`. Do not transition it to `verified` or `blocked`; do not close or archive it.
3. **Report the incomplete child set** — list each non-terminal required top-level child as `- <ref> "<title>" — <state>`, so product can see exactly what is blocking PRD-level verification.

This guard exists because PRD-level acceptance is only meaningful once the work graph is actually complete. `shipped` is the precondition; verifying a PRD whose generated work is still in flight would produce a false PASS or FAIL against an incomplete product.

**All required top-level children are terminal** (at least one required child exists): the guard passes. Hand off to the PASS/FAIL verification phases (sibling work, out of scope here — see [Scope of this skill](#scope-of-this-skill)). Until those phases land, report `terminal-child guard PASSED — <n> required top-level children terminal; ready for PRD-level verification` and stop.

## Output

Emit a single fenced text block so callers can parse it.

```text
## verify-prd: <PRD title>

PRD: <ref/URL>  (vendor: <github|linear|notion|confluence|jira>)
PRD lifecycle state: shipped
Generated top-level children read: <n>  (source: native | documented | both)

### Terminal-child guard
- <ref> "<title>" — <terminal|terminal-but-dropped|incomplete>: <state>
- ...

Required top-level children: <n>   Terminal: <n>   Incomplete: <n>

### Verdict: GUARD_PASSED | GUARD_BLOCKED | NO_CHILDREN
```

- `GUARD_BLOCKED` — one or more required top-level children are non-terminal; verification did not run; the PRD was left at `shipped`.
- `GUARD_PASSED` — all required top-level children are terminal; ready to hand off to PRD-level verification (PASS/FAIL phases — sibling work).
- `NO_CHILDREN` — no generated top-level children found; cannot verify; the PRD was left untouched.

## Rules

- **Read-only in this front-half.** This skill resolves the PRD, reads the child set, and applies the guard. It never transitions the PRD lifecycle — neither the guard-blocked path (leave at `shipped`) nor the guard-passed path (hand off; the `shipped → verified | blocked` hops are owned by the PASS/FAIL sibling work, not by this scaffold).
- **Never reimplement child enumeration.** Consume the recorded PRD→child relationship (`prd-lifecycle-rollup` native linking + machine-readable generated-work section). The two-source read here mirrors `github-prd-intake` Phase 3f.2 — same sources, same dedupe-by-child-ref, same top-level-only boundary.
- **Top-level only.** Exclude leaf Sub-tasks and Stories nested under a generated Epic. The PRD owns its top-level work; those top-level units own their descendants (`prd-lifecycle-rollup` generated-top-level-work contract).
- **Cite, don't restate.** The generated-top-level-work boundary, the per-vendor terminal predicate, the env-keyed `done` resolution, and the dedupe-by-child-ref idempotency key all come from the `prd-lifecycle-rollup` rule. This skill is a consumer of that contract, not a second source of truth.

## Related rules

- `prd-lifecycle-rollup` — the vendor-neutral source of truth for PRD→generated-top-level-work ownership, the per-vendor terminal predicate, the `shipped` rollup, the `shipped → verified | blocked` PRD-level verification hops, and the child-ref idempotency dedupe key. This skill consumes that contract; it cites the rule by slug rather than restating its taxonomy.
- `leaf-only-lifecycle` — governs the build lifecycle of leaf work units and how a generated Epic rolls up from its own children; this skill trusts that bottom-up rollup when reading a top-level child's resolved state.
- `config-resolution` — the PRD-lifecycle role vocabulary (`shipped`, `verified`, `blocked`) and the env-keyed `done` map the terminal predicate resolves against.
