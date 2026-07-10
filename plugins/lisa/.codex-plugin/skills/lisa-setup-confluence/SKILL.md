---
name: lisa-setup-confluence
description: "Configure Confluence as the PRD…"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill", "AskUserQuestion"]
---

# Setup Confluence: $ARGUMENTS

Pin a Confluence space (or a parent page within one) as the PRD-discovery scope for this project.

## Workflow

### Step 1 — Verify atlassian prerequisite

```bash
cloudid=$(jq -r '.atlassian.cloudId // empty' .lisa.config.json 2>/dev/null)
if [ -z "$cloudid" ]; then
  echo "Error: atlassian.cloudId not set. Run /lisa:setup:atlassian first." >&2
  exit 1
fi
```

If `atlassian` is missing, invoke `/lisa:setup-atlassian` via the Skill tool first, then resume.

### Step 2 — Resolve scope

Two scoping modes (mutually compatible; both can be set):

- **Space scope** — discover PRDs anywhere in a Confluence space. Honor `--space=KEY` or list spaces via the active substrate:
  - CLI: `acli confluence space list --output json`
  - MCP: `mcp__plugin_atlassian_atlassian__getConfluenceSpaces` with `cloudId=$cloudid`
- **Parent-page scope** — discover PRDs only as descendants of one page. Honor `--parent=PAGE_ID` or ask the user via `AskUserQuestion` to provide it.

If neither arg is supplied, ask which mode (or both). Setting only `parentPageId` is valid; setting only `spaceKey` is valid; setting both narrows the scope.

### Step 3 — Create lifecycle parent pages

Confluence PRD lifecycle is **parent-page-based**, not label-based (see the `config-resolution` rule for why — Atlassian's scoped API tokens cannot write labels). Each lifecycle role gets its own parent page; a PRD's state = which parent it's a child of. The full PRD lifecycle is `draft → ready → in_review → (blocked | ticketed) → shipped → verified` (the `prd-lifecycle-rollup` rule, slug `prd-lifecycle-rollup`): rollup performs the `ticketed → shipped` hop, then `/lisa:verify-prd` performs the terminal `shipped → verified` (pass) / `shipped → ticketed` (fail) hop. `verified` is the terminal lifecycle state after `shipped` (the `verified` role from the `config-resolution` rule, #591).

#### 3a. Decide where the parents live

If `confluence.parentPageId` is set in config, the seven parent pages are created as children of that page (keeps the lifecycle scoped to a sub-tree of the space). Otherwise, they're created at the space root.

```bash
SPACE_ID=$(curl -s -H "Authorization: Basic $AUTH" \
  "${GW}/api/v2/spaces?keys=$(jq -r '.confluence.spaceKey' .lisa.config.json)" \
  | jq -r '.results[0].id')
PARENT_ROOT=$(jq -r '.confluence.parentPageId // empty' .lisa.config.json)
```

#### 3b. Create each parent page

For each role in `[draft, ready, in_review, blocked, ticketed, shipped, verified]`, create a page named after the role (`Draft`, `Ready`, `In Review`, `Blocked`, `Ticketed`, `Shipped`, `Verified`). Body: a short description of what PRDs in this state mean.

```bash
create_parent() {
  local role="$1" title="$2" body="$3"
  local payload
  payload=$(jq -n \
    --arg sid "$SPACE_ID" \
    --arg pid "$PARENT_ROOT" \
    --arg t "$title" \
    --arg b "$body" '
    {
      spaceId: $sid,
      status: "current",
      title: $t,
      body: { representation: "storage", value: $b }
    } + (if $pid != "" then { parentId: $pid } else {} end)
  ')
  curl -s -X POST -H "Authorization: Basic $AUTH" -H "Content-Type: application/json" \
    -d "$payload" "${GW}/api/v2/pages" | jq -r '.id'
}

P_DRAFT=$(create_parent     draft     "Draft"     "PRDs being authored; not yet ready for the agent queue.")
P_READY=$(create_parent     ready     "Ready"     "PRDs flagged by humans as ready for agent ticketing.")
P_REVIEW=$(create_parent    in_review "In Review" "PRDs the agent has claimed and is validating.")
P_BLOCKED=$(create_parent   blocked   "Blocked"   "Validation failed — clarifying comments posted by the agent. Edit the PRD, then move back to Ready.")
P_TICKETED=$(create_parent  ticketed  "Ticketed"  "Validated and tickets created. Tracked through the build queue from here.")
P_SHIPPED=$(create_parent   shipped   "Shipped"   "All child tickets shipped.")
P_VERIFIED=$(create_parent  verified  "Verified"  "Shipped product empirically checked against the PRD. Terminal state.")
```

Handle the "title already exists" case (400 BAD_REQUEST) by searching for an existing page with that title first and re-using its id rather than failing. This find-or-reuse path is what makes the scaffolding **idempotent** — re-running `setup-confluence` reuses an existing `Verified` parent page rather than creating a duplicate.

#### 3c. Write `confluence.parents` to config

```bash
jq --arg d "$P_DRAFT" --arg r "$P_READY" --arg iv "$P_REVIEW" \
   --arg b "$P_BLOCKED" --arg t "$P_TICKETED" --arg s "$P_SHIPPED" \
   --arg v "$P_VERIFIED" '
  .confluence = ((.confluence // {})
    | .parents = {
        draft:     $d,
        ready:     $r,
        in_review: $iv,
        blocked:   $b,
        ticketed:  $t,
        shipped:   $s,
        verified:  $v
      })
' .lisa.config.json > .lisa.config.json.tmp \
   && mv .lisa.config.json.tmp .lisa.config.json
```

This persists `confluence.parents.verified` to config, matching the `confluence.parents.verified` schema from the `config-resolution` rule, #591.

### Step 4 — Write top-level `confluence` section (spaceKey / parentPageId)

```bash
jq --arg space "$SPACE_KEY" --arg parent "$PARENT_ID" '
  .confluence = (
    (.confluence // {})
    | (if $space != ""  then .spaceKey     = $space  else . end)
    | (if $parent != "" then .parentPageId = $parent else . end)
  )
' .lisa.config.json > .lisa.config.json.tmp \
   && mv .lisa.config.json.tmp .lisa.config.json
```

This step is small now that the heavy lifting moved into 3c — but it's still where `spaceKey` and (optionally) `parentPageId` get persisted.

### Step 5 — Offer to set top-level `source`

If `.source` is unset or differs from `"confluence"`, ask via `AskUserQuestion`:

> Confluence configured. Set top-level `source: "confluence"` so `/lisa:intake` (with no args) scans this space for PRDs?

Recommend "Yes" if the team's PRDs live in Confluence. If the team uses Notion or Linear for PRDs and Confluence is only for ad-hoc reference, recommend "No".

If yes:

```bash
jq '.source = "confluence"' .lisa.config.json > .lisa.config.json.tmp \
   && mv .lisa.config.json.tmp .lisa.config.json
```

### Step 6 — Create / update PRD Dashboard page

Confluence has no native swimlane / kanban view for label-driven lifecycles. To approximate the Notion-board experience, create a single "PRD Dashboard" page in the configured space that renders seven `Children Display` macros side-by-side — one per PRD lifecycle status (`draft`, `ready`, `in_review`, `blocked`, `ticketed`, `shipped`, `verified`). The dashboard is the team's single-screen view of the PRD pipeline.

The `draft` column captures PRDs that have been created but not yet flipped to `ready` — useful for authors to track their own in-flight work and for editors to find PRDs that need a polish pass before they hit the agent queue.

#### Idempotency

If `confluence.dashboardPageId` already exists in `.lisa.config.json`, update that page rather than create a new one. Otherwise create.

#### Build the page body (Confluence storage format)

Seven columns inside a `ac:layout` block. Each column is a `Children Display` macro targeting one lifecycle parent, scoped to the configured space (or parent page, if set).

Read the parent page IDs from config:

```bash
P_DRAFT=$(jq -r '.confluence.parents.draft' .lisa.config.json)
P_READY=$(jq -r '.confluence.parents.ready' .lisa.config.json)
P_REVIEW=$(jq -r '.confluence.parents.in_review' .lisa.config.json)
P_BLOCKED=$(jq -r '.confluence.parents.blocked' .lisa.config.json)
P_TICKETED=$(jq -r '.confluence.parents.ticketed' .lisa.config.json)
P_SHIPPED=$(jq -r '.confluence.parents.shipped' .lisa.config.json)
P_VERIFIED=$(jq -r '.confluence.parents.verified' .lisa.config.json)
```

Build a `Children Display` macro per parent. The macro shows direct children of the specified page, automatically updating as PRDs move between parents:

```xml
<ac:structured-macro ac:name="children" ac:schema-version="2">
  <ac:parameter ac:name="page"><ac:link><ri:page ri:content-title="<TITLE>"/></ac:link></ac:parameter>
  <ac:parameter ac:name="depth">1</ac:parameter>
  <ac:parameter ac:name="sort">modified</ac:parameter>
  <ac:parameter ac:name="reverse">true</ac:parameter>
  <ac:parameter ac:name="all">false</ac:parameter>
</ac:structured-macro>
```

Children Display targets a parent by **content-title** (not by id, in storage format). The `ri:content-title` attribute references the parent by its title within the current space.

Wrap the seven macros in three rows of `ac:layout-section`. Confluence's `ac:layout` has no native 7-column preset, so lay out as three rows: two `three_equal` rows plus a final single-column row for the seventh tile. Row 1 (`three_equal`): Draft, Ready, In Review. Row 2 (`three_equal`): Blocked, Ticketed, Shipped. Row 3 (`single`): Verified.

The grouping is semantic too — top row covers the human-driven lead-up to agent pickup; middle row covers agent-driven build states post-pickup; the final row is the terminal `verified` state where the shipped product has been empirically checked against the PRD itself (`/lisa:verify-prd`).

Heading each column with the status name and count keeps the board scannable:

```xml
<ac:layout-cell>
  <h2>Ready</h2>
  <!-- Content by Label macro for prd-ready -->
</ac:layout-cell>
```

Above the layout, include a short header describing what the page is and how to use it:

```xml
<p>This page is the PRD pipeline view. PRDs live as child pages of one of seven lifecycle
   parents: <strong>Draft</strong>, <strong>Ready</strong>, <strong>In Review</strong>,
   <strong>Blocked</strong>, <strong>Ticketed</strong>, <strong>Shipped</strong>,
   <strong>Verified</strong>.
   Move a PRD between states by re-parenting the page (drag in the page tree, or
   via the page's location settings).</p>
<p>To add a new PRD: create a page under <strong>Draft</strong>. When ready for
   agent pickup, move it to <strong>Ready</strong>.</p>
```

#### Write the page

Invoke `lisa-atlassian-access` with `operation: write-page`. The payload differs by mode:

- **Create**: `{ "spaceKey": "$SPACE", "title": "PRD Dashboard", "body": "<the storage-format XML built above>", "parentId": "$PARENT" }` (omit `parentId` if not set).
- **Update**: `{ "id": "<dashboardPageId>", "title": "PRD Dashboard", "body": "<...>" }` — body is fully replaced.

`atlassian-access`'s `write-page` CLI adapter is currently nominal (acli's Confluence surface is `view`-only as of writing), so this call falls through to the MCP adapter. That's acceptable — the dashboard is a one-time setup-only write; the lifecycle hot path (label add/remove) doesn't go through this.

#### Persist the page ID

```bash
jq --arg id "$DASHBOARD_PAGE_ID" --arg url "$DASHBOARD_URL" \
   '.confluence = ((.confluence // {})
                   | .dashboardPageId = $id
                   | .dashboardUrl    = $url)' \
   .lisa.config.json > .lisa.config.json.tmp \
   && mv .lisa.config.json.tmp .lisa.config.json
```

Both fields are committed (shared across developers — same dashboard for everyone).

#### Skip conditions

Skip Step 6 entirely if:

- `$ARGUMENTS` includes `--no-dashboard`.
- The MCP fallback is unavailable AND acli can't create pages (i.e., we have no path to write).
- The user declines via `AskUserQuestion` when offered.

### Step 7 — Verify

```bash
jq -e '.confluence.spaceKey // .confluence.parentPageId' .lisa.config.json >/dev/null
jq -e '.confluence.parents.verified' .lisa.config.json >/dev/null
```

Report success with the resolved scope (`spaceKey`, `parentPageId`, or both), the seven lifecycle parents created or reused (including the terminal `verified` parent), whether `source` was set, and the PRD Dashboard URL if Step 6 ran.

## Idempotency

- Re-running replaces fields cleanly (jq merge).
- Re-running does not re-prompt for `source` if it's already `"confluence"`.
- Re-running reuses an existing lifecycle parent page (by title) rather than duplicating it — so the terminal `Verified` parent is created once and reused on every subsequent run.
- Re-running with an existing `dashboardPageId` updates the page in place rather than creating duplicates.

## Rules

- Never invent a `spaceKey` or `parentPageId`. Resolve via the substrate or have the user provide it explicitly.
- Setting `source` is opt-in — per-skill invocations with an explicit URL always win, so `source` is just the no-arg default for batch flows.
- If the user wants both Notion and Confluence as PRD sources (rare), pick one for `source` and document that the other requires explicit URLs.
