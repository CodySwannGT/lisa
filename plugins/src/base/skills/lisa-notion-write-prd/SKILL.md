---
name: lisa-notion-write-prd
description: "Creates or idempotently updates a PRD as a page in the configured Notion PRD database, setting the lifecycle Status property to the draft value by default (or the ready value when initial_role is ready so lisa-notion-prd-intake auto-claims it). The Notion PRD-source writer behind lisa-prd-source-write. Dedupes by a stable marker embedded in the page (matched by marker, never by title). All Notion access goes through lisa-notion-access — never call the Notion API or MCP directly."
allowed-tools: ["Skill", "Bash"]
---

# Write Notion PRD: $ARGUMENTS

Create (or update) a PRD page in the configured Notion PRD database. Invoked by
`lisa-prd-source-write` when `source = notion`; do not call directly from a vendor-neutral caller.
**All Notion operations go through `lisa-notion-access`** (the access chokepoint) — never curl the
Notion API or call a `mcp__*notion*` tool yourself.

`$ARGUMENTS` carries the `lisa-prd-source-write` spec: `title`, `body` (full PRD markdown),
`initial_role` (`draft` | `ready`, default `draft`), `dedupe_key`, `marker`, optional `source_ref`.

## Phase 1 — Resolve database + Status vocabulary

```bash
read_g() { local lv gv; lv=$(jq -r "$1 // empty" .lisa.config.local.json 2>/dev/null); gv=$(jq -r "$1 // empty" .lisa.config.json 2>/dev/null); echo "${lv:-${gv:-$2}}"; }
PRD_DB=$(read_g '.notion.prdDatabaseId' '')
[ -z "$PRD_DB" ] && { echo "Error: notion.prdDatabaseId not set in .lisa.config.json."; exit 1; }
STATUS_PROP=$(read_g '.notion.statusProperty' 'Status')
# Resolve the FULL PRD Status vocabulary from config (never hard-code) so the past-ready check is
# correct even when a project renamed any Status value.
DRAFT=$(read_g '.notion.values.draft' 'Draft')
READY=$(read_g '.notion.values.ready' 'Ready')
IN_REVIEW=$(read_g '.notion.values.in_review' 'In Review')
BLOCKED=$(read_g '.notion.values.blocked' 'Blocked')
TICKETED=$(read_g '.notion.values.ticketed' 'Ticketed')
SHIPPED=$(read_g '.notion.values.shipped' 'Shipped')
VERIFIED=$(read_g '.notion.values.verified' 'Verified')
# "Progressed past ready" set (never down-rank): the resolved in_review/blocked/ticketed/shipped/verified.
PROGRESSED=("$IN_REVIEW" "$BLOCKED" "$TICKETED" "$SHIPPED" "$VERIFIED")
```

Resolve the target Status value from `initial_role`: `ready` → `$READY`, otherwise `$DRAFT`.

## Phase 2 — Dedupe by marker (search before create)

The `marker` is embedded in the page (as the first body block). Find an existing PRD page in the DB
carrying it — match the marker, **never** the title:

1. `lisa-notion-access` `operation: search query: "<marker>"` (Notion indexes page content).
2. Filter results to pages whose parent is `$PRD_DB`. If `source_ref` was passed, target that page
   directly and skip the search.
3. If a matching page is found, this is an **update** — reuse it. If none is found, **create**.
   Note: Notion search is eventually consistent; if a just-created page isn't found yet, the marker
   still lives in the page so a later run will dedupe — surface "dedupe degraded (search lag)" rather
   than silently creating a duplicate when uncertain.

## Phase 3 — Create or update

**Markdown → Notion blocks (conversion boundary).** Convert the PRD markdown to Notion block objects:
`#`/`##`/`###` → `heading_1/2/3`, paragraphs → `paragraph`, `-`/`*` → `bulleted_list_item`, `1.` →
`numbered_list_item`, fenced code → `code`. The Notion API caps a single request at **100 blocks**
and ~2000 characters of rich text per block: split long paragraphs across blocks, and if the PRD
exceeds 100 blocks, create the page with the first ≤100 blocks then add the remainder with batched
`operation: append-blocks` calls (≤100 each). When the MCP substrate is active, `create-page` may
accept the markdown content directly (it performs this conversion) — prefer that; the explicit block
conversion is the curl-substrate path.

**Marker + usage-ledger preservation (both paths).** The page must always carry **exactly one**
marker. On CREATE the marker is the first body block; on UPDATE never remove it. Never write a markerless body. Never write a markerless page. If the existing page content already contains the canonical managed `## Lisa Usage` section, preserve that section when regenerating the page body unless the caller intentionally supplied an updated canonical section; use the shared `lisa-usage-accounting` serializer/merge path rather than freehand block edits to ledger rows.

**CREATE:**

1. Build the page body as Notion blocks per the conversion above: the **first block is the marker**
   (a paragraph/callout containing `<!-- $MARKER -->`), then the converted PRD blocks.
2. Invoke `lisa-notion-access` `operation: create-page` with:
   ```json
   { "parent_database_id": "<PRD_DB>",
     "properties": { "<title-prop>": { "title": [{ "text": { "content": "<TITLE>" } }] },
                     "<STATUS_PROP>": { "status": { "name": "<ROLE_VALUE>" } } },
     "children": [ <marker block>, <PRD body blocks> ] }
   ```
   Use the DB's actual title property name (read it via `operation: read-database id: <PRD_DB>` if
   unknown) and the correct property type for `$STATUS_PROP` (`status` vs `select`).
3. Capture the returned page id + URL.

**UPDATE** (existing page or `source_ref`):

1. Set the Status to the resolved role via `lisa-notion-access` `operation: write-page payload: { "id": "<page-id>", "properties": { "<STATUS_PROP>": { "status": { "name": "<ROLE_VALUE>" } } } }` — **unless** the page's current Status is in the resolved `${PROGRESSED[@]}` set (already past `ready`), in which case leave the Status and report `reused (already past ready)`.
2. Refresh the canonical spec, not append-only notes: keep the existing marker block, then make the
   managed PRD body current — archive the previously generated body blocks below the marker
   (`operation: archive-page` is page-level, so for blocks delete via the blocks API through
   `notion-access` or, where block deletion isn't available, replace their text in place) and
   `operation: append-blocks` the regenerated blocks. Do not duplicate the whole spec as a dated
   note, and never drop the marker or an existing managed `## Lisa Usage` section.

## Phase 4 — Return

```yaml
ref: "<notion-page-id>"
url: "<page url>"
role: draft | ready          # (or the page's current Status role when reused past ready)
marker: "<MARKER>"
outcome: created | reused
```

## Rules

- All access via `lisa-notion-access`; never touch the Notion API/MCP directly.
- Match dedupe by marker, never by title.
- Preserve an existing canonical `## Lisa Usage` section on update; never append a second usage
  section or silently drop ledger rows.
- Never down-rank a PRD whose Status is already past `ready`.
- Resolve the Status vocabulary from config (`notion.statusProperty`, `notion.values.*`) — never
  hardcode value names.
