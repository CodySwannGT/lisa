---
name: github-write-prd
description: "Creates or idempotently updates a PRD as a GitHub Issue in the configured source repo, carrying exactly one PRD lifecycle label (`prd-draft` by default, or `prd-ready` when initial_role is ready so lisa:github-prd-intake auto-claims it). The GitHub PRD-source writer behind lisa:prd-source-write — the source-side counterpart of lisa:github-write-issue. Dedupes by a stable marker embedded in the issue body (matched by marker, never by title) so re-running ideation references the existing PRD instead of opening a duplicate, and when `github.projects.v2` is enabled it coordinates PRD issue membership through `lisa:github-project-v2` without replacing the issue as the lifecycle source of truth. Uses the `gh` CLI exclusively."
allowed-tools: ["Skill", "Bash"]
---

# Write GitHub PRD: $ARGUMENTS

Create (or update) a PRD issue in the configured source repo. Invoked by `lisa:prd-source-write`
when `source = github`; do not call directly from a vendor-neutral caller.

`$ARGUMENTS` carries the `lisa:prd-source-write` spec: `title`, `body` (full PRD markdown),
`initial_role` (`draft` | `ready`, default `draft`), `dedupe_key`, `marker`, optional `source_ref`,
and optional `ideation_ledger_payload` from `lisa:project-ideation` via `lisa:research`.

## Phase 1 — Resolve repo and PRD lifecycle labels

```bash
ORG=$(jq -r '.github.org // empty' .lisa.config.local.json 2>/dev/null); ORG="${ORG:-$(jq -r '.github.org // empty' .lisa.config.json)}"
REPO=$(jq -r '.github.repo // empty' .lisa.config.local.json 2>/dev/null); REPO="${REPO:-$(jq -r '.github.repo // empty' .lisa.config.json)}"
[ -z "$ORG" ] || [ -z "$REPO" ] && { echo "Error: github.org / github.repo not set in .lisa.config.json."; exit 1; }

read_role() { # path default
  local lv gv; lv=$(jq -r "$1 // empty" .lisa.config.local.json 2>/dev/null); gv=$(jq -r "$1 // empty" .lisa.config.json 2>/dev/null)
  echo "${lv:-${gv:-$2}}"
}
# Resolve the FULL PRD lifecycle vocabulary from config (never hard-code names) — needed so the
# "exactly one role" reconcile and the past-ready check work for projects that renamed any label.
PRD_DRAFT=$(read_role '.github.labels.prd.draft' 'prd-draft')
PRD_READY=$(read_role '.github.labels.prd.ready' 'prd-ready')
PRD_IN_REVIEW=$(read_role '.github.labels.prd.in_review' 'prd-in-review')
PRD_BLOCKED=$(read_role '.github.labels.prd.blocked' 'prd-blocked')
PRD_TICKETED=$(read_role '.github.labels.prd.ticketed' 'prd-ticketed')
PRD_SHIPPED=$(read_role '.github.labels.prd.shipped' 'prd-shipped')
PRD_VERIFIED=$(read_role '.github.labels.prd.verified' 'prd-verified')
# All lifecycle labels (for one-of reconcile) and the "progressed past ready" set (never down-rank):
ALL_PRD_LABELS=("$PRD_DRAFT" "$PRD_READY" "$PRD_IN_REVIEW" "$PRD_BLOCKED" "$PRD_TICKETED" "$PRD_SHIPPED" "$PRD_VERIFIED")
PROGRESSED=("$PRD_IN_REVIEW" "$PRD_BLOCKED" "$PRD_TICKETED" "$PRD_SHIPPED" "$PRD_VERIFIED")
```

Resolve the target role label from `initial_role`: `ready` → `$PRD_READY`, otherwise `$PRD_DRAFT`.
Create the label lazily if missing (`gh label create <name> --repo $ORG/$REPO ...`).

## Phase 2 — Dedupe by marker (search before create)

The `marker` (e.g. `[lisa-project-ideation] idea=<key>`) is embedded in the issue body. Search for an
existing **open** PRD issue carrying it — match on the marker, **never** on the title:

```bash
EXISTING=$(gh issue list --repo "$ORG/$REPO" --state open --search "\"$MARKER\" in:body" --json number,url --jq '.[0].number // empty')
```

- If `source_ref` was passed, use that issue as the target (skip the search).
- If an existing open PRD issue is found, this is an **update** — reuse it, do not create a second.
- If `gh`'s search index hasn't caught up (eventual consistency), additionally `gh issue list … --json number,body` and grep the body for the marker before deciding to create.

## Phase 3 — Create or update

**Marker + usage-ledger preservation (both paths).** Before writing any body, ensure it contains
**exactly one** marker line — inject `<!-- $MARKER -->` if the caller's synthesized body doesn't
already carry it. **Never write a markerless body** (including on UPDATE or when `source_ref` is
passed): a body without the marker breaks future dedupe. If the body already has the marker, leave
the single instance. If the live issue body already contains the canonical managed `## Lisa Usage`
section, preserve it verbatim unless the caller intentionally supplied an updated canonical section;
use the shared `usage-accounting` serializer/merge path rather than hand-editing ledger rows.

**Exploratory ideation run ledger (both paths).** When the write was initiated by
`lisa:project-ideation`, carries a project-ideation marker, or includes
`ideation_ledger_payload`, persist a managed `## Exploratory Ideation Run Ledger` section in the PRD
body. Prefer the managed section over a comment so the PRD itself remains the operator's source of
truth; use a managed comment only if the body cannot be updated. Populate the fields from
`ideation_ledger_payload` when present, falling back to `marker`, `initial_role`, repo config, and
runtime metadata only for missing fields. Keep one managed section by replacing the content between
stable markers:

```markdown
## Exploratory Ideation Run Ledger
<!-- lisa:exploratory-ideation-run-ledger:start -->
- timestamp: <ISO-8601 run timestamp>
- automation_id: <Codex/Claude automation id or unavailable>
- repo: <org>/<repo>
- prd_ready: true|false
- persona_evidence_refs: <comma-separated source refs or unavailable>
- selected_idea: <selected idea title/key>
- dedupe_marker: <MARKER>
- prd_url: <created or reused PRD URL>
- outcome: created|reused
- lifecycle_role_after_write: draft|ready|in_review|blocked|ticketed|shipped|verified
- rejected_overlap_candidates: <issue refs/titles considered and rejected, or none>
- expected_empirical_verification_artifact: <artifact ref or unavailable>
<!-- lisa:exploratory-ideation-run-ledger:end -->
```

On CREATE, write a ledger entry with `outcome: created`, the selected marker, the created PRD URL,
and the lifecycle role applied by this write. On UPDATE/reuse, write `outcome: reused`, preserve the
same dedupe marker, record the reused PRD URL, and report the lifecycle role that remains after
reconciliation. If the live PRD has progressed past ready, do not downgrade it while recording the
reuse ledger; the `lifecycle_role_after_write` value must be the existing progressed role. Preserve
exactly one PRD lifecycle label in the same pass as the ledger write.

**CREATE** (no existing issue):

1. Write the marker-normalized PRD body to a temp file.
2. ```bash
   gh issue create --repo "$ORG/$REPO" --title "$TITLE" --body-file /tmp/prd-body.md --label "$ROLE_LABEL"
   ```
3. Capture the returned issue number/URL.
4. Rewrite the PRD body with the managed `## Exploratory Ideation Run Ledger` section populated for
   `outcome: created` when the caller supplied project-ideation ledger inputs, then
   `gh issue edit <n> --body-file /tmp/prd-body.md`. This second write is allowed because the URL is
   not known until after creation.
5. If `github.projects.v2` is enabled, resolve the created PRD issue node id and invoke
   `lisa:github-project-v2` with `operation: ensure-item` and `content_node_id: <issue-node-id>`.
   - `outcome: disabled` → continue normally.
   - `outcome: added` or `reused` → continue normally; membership is now present.
   - `outcome: warning` (`required: false`) → preserve the exact warning and keep the PRD issue write as the durable success.
   - `outcome: blocked` (`required: true`) → surface the exact failure and stop returning success; do not report Project coordination as completed.

**UPDATE** (existing issue or `source_ref`):

1. `gh issue edit <n> --repo "$ORG/$REPO" --body-file /tmp/prd-body.md` with the **marker-normalized**
   body (regenerate in place; never drop the marker, the managed `## Exploratory Ideation Run Ledger`
   section, or an existing managed `## Lisa Usage` section). When the caller supplied
   project-ideation ledger inputs, replace the managed ledger content with an `outcome: reused` entry.
2. Reconcile the lifecycle label to **exactly one**: add `$ROLE_LABEL`, remove every other label in
   the resolved `${ALL_PRD_LABELS[@]}` set (the config-resolved names — not a hard-coded list) via
   `gh issue edit <n> --add-label / --remove-label`. Never leave a PRD carrying two lifecycle labels.
   - Exception: do **not** down-rank a PRD whose current label is in the resolved `${PROGRESSED[@]}`
     set (already past `ready`). If so, leave it and report `reused (already past ready)`.
3. Re-resolve the live PRD issue node id and invoke `lisa:github-project-v2` with
   `operation: ensure-item` so updates keep the PRD present in the configured shared Project without
   duplicating membership writes. Branch on `disabled` / `added` / `reused` / `warning` / `blocked`
   exactly as in CREATE.

## Phase 4 — Return

Return a structured result for `lisa:prd-source-write` to surface:

```yaml
ref: "<org>/<repo>#<n>"
url: "https://github.com/<org>/<repo>/issues/<n>"
role: draft | ready          # the lifecycle label now applied (or the PRD's current role when reused past ready)
marker: "<MARKER>"
outcome: created | reused
```

## Rules

- Exactly one PRD lifecycle label at all times (leaf-only does not apply — PRDs are not build leaves).
- Match dedupe by marker, never by title.
- Preserve an existing canonical `## Lisa Usage` section on update; never append a second usage
  section or silently drop ledger rows.
- Never down-rank a PRD already past `ready`.
- A *closed* prior PRD does not suppress a new one — a recurrence after closure is a genuine new PRD.
- This is a source-side writer (`prd-*` labels). It never touches build labels (`status:*`) — that is
  `lisa:github-write-issue`'s lane. See `config-resolution` "Self-host edge case".
- When GitHub Project coordination is enabled, always delegate membership to `lisa:github-project-v2`; never inline separate ProjectV2 GraphQL from this skill.
