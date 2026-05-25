---
name: linear-write-prd
description: "Creates or idempotently updates a PRD as a Linear Project carrying exactly one PRD lifecycle project-label (`prd-draft` by default, or `prd-ready` when initial_role is ready so lisa:linear-prd-intake auto-claims it). The Linear PRD-source writer behind lisa:prd-source-write. Dedupes by a stable marker embedded in the Project description (matched by marker, never by name). Uses the Linear MCP."
allowed-tools: ["Skill", "Bash", "mcp__linear-server__list_teams", "mcp__linear-server__list_projects", "mcp__linear-server__get_project", "mcp__linear-server__save_project", "mcp__linear-server__list_project_labels", "mcp__linear-server__create_project_label"]
---

# Write Linear PRD: $ARGUMENTS

Create (or update) a PRD as a Linear **Project** in the configured workspace/team. Invoked by
`lisa:prd-source-write` when `source = linear`; do not call directly from a vendor-neutral caller.

Linear's PRD lifecycle uses **project-level labels** (`prd-*`), per `config-resolution`. (The Linear
PRD source models a PRD as a Project — the same shape `lisa:linear-prd-intake` scans.)

`$ARGUMENTS` carries the `lisa:prd-source-write` spec: `title`, `body` (full PRD markdown),
`initial_role` (`draft` | `ready`, default `draft`), `dedupe_key`, `marker`, optional `source_ref`.

## Phase 1 — Resolve workspace/team + PRD lifecycle labels

```bash
read_g() { local lv gv; lv=$(jq -r "$1 // empty" .lisa.config.local.json 2>/dev/null); gv=$(jq -r "$1 // empty" .lisa.config.json 2>/dev/null); echo "${lv:-${gv:-$2}}"; }
WORKSPACE=$(read_g '.linear.workspace' '')
TEAM=$(read_g '.linear.teamKey' '')
# Resolve the FULL PRD lifecycle vocabulary from config (never hard-code names) so the one-of
# reconcile and the past-ready check are correct even when a project renamed any label.
PRD_DRAFT=$(read_g '.linear.labels.prd.draft' 'prd-draft')
PRD_READY=$(read_g '.linear.labels.prd.ready' 'prd-ready')
PRD_IN_REVIEW=$(read_g '.linear.labels.prd.in_review' 'prd-in-review')
PRD_BLOCKED=$(read_g '.linear.labels.prd.blocked' 'prd-blocked')
PRD_TICKETED=$(read_g '.linear.labels.prd.ticketed' 'prd-ticketed')
PRD_SHIPPED=$(read_g '.linear.labels.prd.shipped' 'prd-shipped')
PRD_VERIFIED=$(read_g '.linear.labels.prd.verified' 'prd-verified')
ALL_PRD_LABELS=("$PRD_DRAFT" "$PRD_READY" "$PRD_IN_REVIEW" "$PRD_BLOCKED" "$PRD_TICKETED" "$PRD_SHIPPED" "$PRD_VERIFIED")
PROGRESSED=("$PRD_IN_REVIEW" "$PRD_BLOCKED" "$PRD_TICKETED" "$PRD_SHIPPED" "$PRD_VERIFIED")
[ -z "$WORKSPACE" ] && { echo "Error: linear.workspace not set in .lisa.config.json."; exit 1; }
```

Resolve the target project-label from `initial_role`: `ready` → `$PRD_READY`, else `$PRD_DRAFT`.
Resolve its label id via `mcp__linear-server__list_project_labels` (create via
`mcp__linear-server__create_project_label` if missing).

## Phase 2 — Dedupe by marker (search before create)

The `marker` is embedded in the Project description. Find an existing Project carrying it — match the
marker, **never** the project name:

1. `mcp__linear-server__list_projects` scoped to the team/workspace (filtered by the `prd-*` label
   set when supported), then inspect each candidate's description via
   `mcp__linear-server__get_project` for the marker. If `source_ref` was passed, target it directly.
2. If a Project with the marker exists → **update**; else → **create**.

## Phase 3 — Create or update

**Marker normalization (both paths).** Before writing the `description`, ensure it contains
**exactly one** marker line — inject the marker if the synthesized description lacks it. **Never write
a markerless description** (including UPDATE / `source_ref`): that breaks future dedupe.

**CREATE:** `mcp__linear-server__save_project` with:
- `name`: `$TITLE`
- `description`: the marker-normalized full PRD markdown
- `teamIds`: `[<resolved team id>]`
- `labelIds`: `[<role label id>]` (exactly one PRD lifecycle label)
- `state`: Linear Project default (e.g. `backlog`)

**UPDATE** (existing project or `source_ref`): `save_project` with the project id and **only** the
changed fields — regenerate the marker-normalized `description`, and reconcile labels to **exactly
one** PRD lifecycle label: add the role label, remove every other label in the resolved
`${ALL_PRD_LABELS[@]}` set (config-resolved names, not a hard-coded list). Do **not** down-rank a
Project whose current label is in the resolved `${PROGRESSED[@]}` set (already past `ready`) — leave
it and report `reused (already past ready)`.

## Phase 4 — Return

```yaml
ref: "<linear-project-id-or-slug>"
url: "<project url>"
role: draft | ready          # (or the Project's current role when reused past ready)
marker: "<MARKER>"
outcome: created | reused
```

## Rules

- Exactly one PRD lifecycle project-label at all times.
- Match dedupe by marker, never by project name.
- Never down-rank a Project already past `ready`.
- Source-side writer (`prd-*` project labels) — never touches issue-level build labels (`status:*`),
  which are `lisa:linear-write-issue`'s lane (see `config-resolution` self-host separation).
- Resolve label names from config (`linear.labels.prd.*`) — never hardcode.
