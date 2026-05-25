---
name: prd-source-write
description: "Vendor-neutral wrapper for creating (or idempotently updating) a PRD in the configured PRD source. The PRD-side sibling of lisa:tracker-write. Resolves `source` from .lisa.config.local.json first (then .lisa.config.json — local overrides global) and dispatches to lisa:notion-write-prd, lisa:confluence-write-prd, lisa:github-write-prd, or lisa:linear-write-prd. Callers (notably lisa:research) MUST invoke this skill instead of a vendor PRD writer directly — that is what makes the PRD source switchable per project. Accepts an `initial_role` of `draft` (default) or `ready` so a freshly created PRD either waits for human promotion or is immediately picked up by lisa:intake; and a stable dedupe marker so re-runs reference the existing PRD instead of creating a duplicate. The PRD lives in the source — there is no separate document artifact."
allowed-tools: ["Skill", "Bash", "Read"]
---

# PRD Source Write: $ARGUMENTS

Thin dispatcher. Resolves the configured PRD `source` and delegates to the matching vendor PRD
writer, which owns the concrete create/update, the lifecycle-role application, and the marker-based
dedupe. When the supplied PRD body already contains the canonical `## Lisa Usage` ledger, the
vendor writer must preserve that managed section on update instead of dropping it or reformatting it
ad hoc. This skill only routes — it never talks to a source API itself.

See the `config-resolution` rule for the full configuration schema and the PRD lifecycle roles.

## Input contract

Callers pass a single structured spec:

```yaml
operation: create_or_update          # the only operation; create unless the marker already exists
title: "<PRD title>"
body: "<full PRD markdown — the entire spec>"
initial_role: draft | ready          # default: draft. ready = picked up by lisa:intake's PRD scan
dedupe_key: "<stable-key>"           # e.g. project-ideation's idea key
marker: "[lisa-project-ideation] idea=<stable-key>"   # embedded in the PRD body for dedupe
origin: { tool: project-ideation | research | manual }
source_ref: "<optional existing PRD ref to force an update>"
```

`initial_role` semantics are uniform across vendors (the role STRINGS resolve per vendor from
`config-resolution`):

- **`draft`** (default) → the PRD is created in the source's `draft` PRD role. It waits for a human
  (or a later `ready` promotion) before any intake claims it.
- **`ready`** → the PRD is created in the source's `ready` PRD role (`prd-ready`), so the PRD-side of
  `lisa:intake` / the `*-prd-intake` scanner auto-claims it on the next cycle.

There is no "omitted = legacy behavior" mode (unlike the ticket-side `build_ready`): there was no
prior PRD-source-write behavior to preserve, so omitted means `draft`.

## Workflow

1. **Resolve the source.** Read `.lisa.config.local.json` first (if present), then
   `.lisa.config.json`. Local overrides global per key. Use `jq` — never hand-parse JSON.

   ```bash
   local_source=$(jq -r '.source // empty' .lisa.config.local.json 2>/dev/null)
   global_source=$(jq -r '.source // empty' .lisa.config.json 2>/dev/null)
   source="${local_source:-${global_source}}"
   if [ -z "$source" ]; then
     echo "Error: 'source' is not set in .lisa.config.json. A PRD source (notion / confluence / github / linear) is required to create a PRD. Run /lisa:setup:notion (or :confluence, :github, :linear)." >&2
     exit 1
   fi
   ```

2. **Validate the value and dispatch** (pass the spec verbatim):

   - `notion` → confirm `notion.workspaceId` and `notion.prdDatabaseId` are present, then invoke
     `lisa:notion-write-prd`.
   - `confluence` → confirm `atlassian.cloudId` and (`confluence.spaceKey` or
     `confluence.parents.draft`/`.ready`) are present, then invoke `lisa:confluence-write-prd`.
   - `github` → confirm `github.org` and `github.repo` are present, then invoke
     `lisa:github-write-prd`.
   - `linear` → confirm `linear.workspace` (and team for project placement) is present, then invoke
     `lisa:linear-write-prd`.
   - `jira` → **stop and fail loudly**: `"source=jira is not a supported PRD source — config-resolution defines no JIRA PRD lifecycle roles. Use notion / confluence / github / linear, or set source accordingly."` (JIRA is a destination tracker, not a PRD source.)
   - Any other value (including `file`) → stop and report: `"Unknown PRD source '<value>'. Expected one of: notion, confluence, github, linear."`

3. **Surface the vendor writer's output unchanged.** It returns the created/reused PRD ref + URL,
   the applied role (`draft`/`ready`), the dedupe marker, and whether it was created or reused.
   Downstream callers (research, project-ideation) parse this — do not paraphrase.

## Rules

- Never bypass dispatch — a vendor-neutral caller calling a `*-write-prd` skill directly defeats the
  per-project source switch (exactly the `tracker-write` discipline, mirrored).
- Never drop or duplicate an existing managed `## Lisa Usage` section. Writer-specific preservation
  and fallback behavior belongs in the vendor writers and follows the `usage-accounting` contract.
- Never accept a source outside `{notion, confluence, github, linear}`. `jira` and `file` fail loudly.
- Never mutate the spec between layers. The vendor writers define their own create/dedupe contract.
- Never invent a PRD lifecycle role string — resolve every role from `config-resolution` per vendor.
- Idempotency is the vendor writer's job (marker search before create); this shim only routes.
