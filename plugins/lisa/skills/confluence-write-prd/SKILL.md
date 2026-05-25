---
name: confluence-write-prd
description: "Creates or idempotently updates a PRD as a Confluence page parented under the configured lifecycle parent page (the draft parent by default, or the ready parent when initial_role is ready so lisa:confluence-prd-intake auto-claims it). The Confluence PRD-source writer behind lisa:prd-source-write. Confluence models PRD state by PARENT PAGE (not labels), per config-resolution. Dedupes by a stable marker embedded in the page body, found via CQL (matched by marker, never by title). All Atlassian access goes through lisa:atlassian-access."
allowed-tools: ["Skill", "Bash"]
---

# Write Confluence PRD: $ARGUMENTS

Create (or update) a PRD page in Confluence. Invoked by `lisa:prd-source-write` when
`source = confluence`; do not call directly from a vendor-neutral caller. **All Confluence
operations go through `lisa:atlassian-access`** — never call the Atlassian API/MCP or `acli` directly.

Confluence's PRD lifecycle uses **parent pages**, not labels (scoped API tokens can't write
Confluence labels — see `config-resolution` "Confluence PRD lifecycle uses parent pages"). A PRD's
state is which lifecycle parent it lives under; "promote to ready" = re-parent to the ready parent.

`$ARGUMENTS` carries the `lisa:prd-source-write` spec: `title`, `body` (full PRD markdown),
`initial_role` (`draft` | `ready`, default `draft`), `dedupe_key`, `marker`, optional `source_ref`.

## Phase 1 — Resolve lifecycle parents

```bash
read_g() { local lv gv; lv=$(jq -r "$1 // empty" .lisa.config.local.json 2>/dev/null); gv=$(jq -r "$1 // empty" .lisa.config.json 2>/dev/null); echo "${lv:-${gv:-$2}}"; }
SPACE=$(read_g '.confluence.spaceKey' '')
CLOUDID=$(read_g '.atlassian.cloudId' '')
[ -z "$CLOUDID" ] && { echo "Error: atlassian.cloudId not set in .lisa.config.json."; exit 1; }
# Resolve the FULL set of lifecycle parents from config (never hard-code) — needed for the target
# parent, the past-ready reverse-lookup, and to derive the space when spaceKey is absent.
DRAFT_PARENT=$(read_g '.confluence.parents.draft' '')
READY_PARENT=$(read_g '.confluence.parents.ready' '')
IN_REVIEW_PARENT=$(read_g '.confluence.parents.in_review' '')
BLOCKED_PARENT=$(read_g '.confluence.parents.blocked' '')
TICKETED_PARENT=$(read_g '.confluence.parents.ticketed' '')
SHIPPED_PARENT=$(read_g '.confluence.parents.shipped' '')
VERIFIED_PARENT=$(read_g '.confluence.parents.verified' '')
# "Progressed past ready" parents (never re-parent a PRD down from these):
PROGRESSED_PARENTS=("$IN_REVIEW_PARENT" "$BLOCKED_PARENT" "$TICKETED_PARENT" "$SHIPPED_PARENT" "$VERIFIED_PARENT")
```

Resolve the target parent from `initial_role`: `ready` → `$READY_PARENT`, otherwise `$DRAFT_PARENT`.
If the needed parent id is unset, stop and report that `/lisa:setup:confluence` must provision the
lifecycle parent pages — do not create a PRD outside the lifecycle scaffolding.

**Resolve the space (config allows parent-page-only setups with no `spaceKey`).** If `$SPACE` is
empty, derive it from the target lifecycle parent: `lisa:atlassian-access` `operation: read-page id:
<target parent>` and read its space key from the response. If neither `confluence.spaceKey` is set nor
a space can be derived from the parent, **stop and report** that a space could not be established —
do not attempt a CQL search or create without it.

## Phase 2 — Dedupe by marker (CQL search before create)

The `marker` is embedded in the page body. Find an existing PRD page carrying it — match the marker,
**never** the title:

```text
lisa:atlassian-access  operation: search-pages  cql: 'space = "<SPACE>" AND text ~ "<marker>"'
```

If `source_ref` was passed, target that page directly. If a page with the marker exists → **update**;
else → **create**.

## Phase 3 — Create or update

**Storage-format body + marker (both paths).** Convert the PRD markdown to Confluence **storage
format** (XHTML): `#`/`##`/`###` → `<h1>/<h2>/<h3>`, paragraphs → `<p>`, lists → `<ul>/<ol><li>`,
fenced code → `<ac:structured-macro ac:name="code">`. Embed the marker as a storage comment
(`<!-- $MARKER -->`) or a small `<p>` so future CQL dedupe finds it. The body must always contain
**exactly one** marker; never write a markerless page (CREATE or UPDATE).

**CREATE:** `lisa:atlassian-access` `operation: write-page` (create form) with a payload that sets:
- `title`: `$TITLE`
- `space`: `$SPACE` (resolved in Phase 1)
- `ancestors`/`parentId`: the resolved lifecycle parent (`$DRAFT_PARENT` or `$READY_PARENT`)
- `body`: the storage-format, marker-normalized body above.

**UPDATE** (existing page or `source_ref`):
1. **GET-then-PUT** (load-bearing, as `confluence-prd-intake` documents): first `operation: read-page
   id: <page-id>` to read the current `version.number`, then `operation: write-page` (edit form) with
   the marker-normalized storage body and `version.number` bumped to current+1. A PUT without the
   current version is rejected; never drop the marker on the edit.
2. Re-parent to the target lifecycle parent if the role changed — **unless** the page's current
   parent is in the resolved `${PROGRESSED_PARENTS[@]}` set (already past `ready`). If so, leave it
   and report `reused (already past ready)`. Reverse-lookup the current parent in
   `confluence.parents.*` to determine its role before re-parenting.

## Phase 4 — Return

```yaml
ref: "<confluence-page-id>"
url: "<page url>"
role: draft | ready          # derived from the lifecycle parent the page now lives under (or its current role when reused past ready)
marker: "<MARKER>"
outcome: created | reused
```

## Rules

- All access via `lisa:atlassian-access`; never call Atlassian directly.
- State is the parent page, not a label — never attempt Confluence label writes (they 401 on scoped
  tokens; see `config-resolution`).
- Match dedupe by marker, never by title.
- Never re-parent a PRD already past `ready` down to draft/ready.
- Resolve parents from config (`confluence.parents.{draft,ready}`) — never hardcode page ids.
