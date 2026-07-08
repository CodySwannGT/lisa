---
name: lisa-validate-tracker-mapping
description: "Detect and repair drift between a project's configured Lisa status/label mappings and the live tracker/source workflow. Compares every lifecycle role in `.lisa.config.json` (JIRA `jira.workflow` statuses, GitHub/Linear `labels.{build,prd}`, Notion `notion.values` select options, Confluence `confluence.parents`) against the authoritative live names the access layer reports — catching renames, deletions, and case drift (e.g. config `On Stg` vs live `ON STG`). Read-only by default; `repair=true` rewrites the config to the canonical live names (config is fixed, never the tracker). Audits the current repo by default, or sweeps a set of projects via `projects=<glob>` / `workspaces=<file>`. Safe to schedule for continuous drift detection."
allowed-tools: ["Skill", "Bash", "Read", "Write", "Edit", "AskUserQuestion"]
---

# Validate Tracker Mapping: $ARGUMENTS

`/lisa:validate-tracker-mapping` answers one question: **do the status/label names this project's `.lisa.config.json` maps each lifecycle role to still exist — with the exact name — in the live tracker and PRD source?**

Lisa's lifecycle is driven by configured role → name mappings (`ready` → `"Ready"`, `done.staging` → `"On Stg"`, a GitHub `ready` build label → `"status:ready"`, a Notion `ticketed` value → `"Ticketed"`, …). When someone renames or deletes a status in JIRA, a label in GitHub/Linear, or a select option in Notion, the config silently points at a name that no longer resolves. The symptom is downstream: a build finishes but the completion transition can't be found, so the item stalls — exactly the kind of half-broken state `/lisa:repair-intake` then has to clean up. This skill catches that drift at the source: the config-to-live mapping itself.

It is the audit/repair counterpart to `/lisa:setup:jira` (and the other `setup:*` skills): where `setup:*` *establishes* the mapping interactively, this skill *re-validates an existing mapping* against the live workflow and, on request, repairs the config to match.

## Confirmation policy

- **Default mode is read-only.** Detect drift and report. Never mutate config or the tracker.
- **`repair=true` enables writes — to the config only, never to the tracker.** Within repair mode:
  - **Case drift** (the live workflow has the same name with different casing — the configured name resolves case-insensitively but the canonical case differs) is repaired automatically: rewrite the config value to the live canonical name. This is non-destructive and unambiguous.
  - **Missing name** (no case-insensitive match exists in the live set — renamed beyond recognition or deleted) is **never** auto-repaired. Compute the closest live candidates and confirm via `AskUserQuestion` before writing. Default to leaving the value unchanged.
- This skill never renames or deletes anything in the tracker/source. Repair fixes the Lisa config to match reality; correcting the tracker itself is a human/admin decision made elsewhere.

## Arguments

- (none) — audit the **current repo** (`./.lisa.config.json`).
- `projects=<glob-or-path>` — batch sweep. Expands to every directory under the glob that contains a `.lisa.config.json`. Example: `projects=~/workspace/acme/projects/*`.
- `workspaces=<file>` — batch sweep driven by a Lisa workspaces file (the `{ "<project-path>": "<branch>" }` map used by `/lisa:update-projects`). Each key is a project path to audit. Combine with `filter=<substring>` to restrict to matching paths (e.g. `filter=acme`).
- `repair=true` — enable config repair (see confirmation policy). Default `false`.
- `lane=build|prd|both` — which mapping family to check. Default `both`. `build` = the destination `tracker` workflow; `prd` = the PRD `source` status/label mapping.

Batch mode runs the identical per-project audit on each resolved project and prints one section per project plus a roll-up summary.

## Step 1 — Resolve scope

```bash
# Single-repo (default): the audit target is the current directory.
# Batch: expand projects=<glob> to dirs containing .lisa.config.json,
# or read workspaces=<file> keys (optionally filtered).
```

For `workspaces=<file>`, parse with `jq` (never grep/sed JSON):

```bash
jq -r 'keys[]' "$WORKSPACES_FILE" \
  | sed "s#^~#$HOME#" \
  | while read -r proj; do
      [ -n "$FILTER" ] && case "$proj" in *"$FILTER"*) : ;; *) continue ;; esac
      [ -f "$proj/.lisa.config.json" ] && echo "$proj"
    done
```

Skip (and note) any path with no `.lisa.config.json`.

## Step 2 — Load the project's mappings

For each project, resolve the effective config from `.lisa.config.local.json` first, then `.lisa.config.json`:

```bash
read_config() {
  local path="$1" local_v global_v
  local_v=$(jq -r "$path // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r "$path // empty" .lisa.config.json 2>/dev/null)
  printf '%s\n' "${local_v:-$global_v}"
}
tracker=$(read_config '.tracker')
source=$(read_config '.source')
```

Resolve the **effective** role → name mapping using the same defaults `/lisa:intake` and `/lisa:setup:jira` use (config-resolution contract). The tracker field is required; only vendor-specific role-name keys present in config override the defaults, and absent vendor-specific role-name keys fall back to the documented defaults. Build the list of `(role, configured-name)` pairs to validate:

- **Missing / empty tracker**: report `UNRESOLVABLE` with setup guidance (`/lisa:setup:jira`, `/lisa:setup:github`, or `/lisa:setup:linear`). Do not default to JIRA.
- **JIRA build workflow** (`jira.workflow`): `ready`, `claimed`, optional `review`, `blocked`, and each `done.<env>` (`dev` / `staging` / `production`). Defaults: `Ready`, `In Progress`, `Code Review`, `Blocked`, `{dev: "On Dev", staging: "On Stg", production: "Done"}`.
- **GitHub build/prd labels** (`github.labels.build`, `github.labels.prd`): each configured label string.
- **Linear build/prd labels** (`linear.labels.build`, `linear.labels.prd`): each configured label/state string.
- **Notion PRD values** (`notion.values`): each configured select-option value, validated against the `notion.statusProperty` property's options.
- **Confluence PRD parents** (`confluence.parents`): each configured parent page id, validated by existence.

## Step 3 — Enumerate the authoritative live name set

Resolve the live, canonical names per vendor through the **same access layer the rest of Lisa uses** — never a second source of truth.

### JIRA (via `/lisa:atlassian-access`)

First confirm the active substrate is authenticated to **this project's** `atlassian.cloudId` / `atlassian.site`. `/lisa:atlassian-access` already enforces account identity: a substrate authed as a different Atlassian account is skipped, not used. If no substrate matches the configured account, mark the project `UNRESOLVABLE` (auth mismatch) and move on — do **not** validate against the wrong instance, and do **not** trust a case-insensitive JQL pass as proof.

Enumerate the project's full workflow status set, preferring the most authoritative substrate:

1. **curl** (authoritative — all statuses, including empty ones):
   ```bash
   # GET /rest/api/3/project/<KEY>/statuses → union of canonical status names across issue types
   # via lisa-atlassian-access curl substrate
   # jq: '[.[].statuses[].name] | unique'
   ```
2. **MCP fallback** (when curl creds aren't available): union of `to.name` from `getTransitionsForJiraIssue` (with `includeUnavailableTransitions=true`) on a sample ticket, plus changelog-observed names (`fromString`/`toString`). This can miss a status that is empty *and* unreachable from the sample, so when only this substrate is available, report the enumeration method in the output so the operator knows the set may be partial.

> Note: JQL `status = "<name>"` matching is **case-insensitive**, so a JQL probe that "passes" does **not** prove the configured casing matches. Always compare against the canonical `status.name` strings from the enumeration above, case-sensitively.

### GitHub (via `gh`)

```bash
gh label list --repo "$REPO" --limit 200 --json name -q '.[].name'
```

### Linear / Notion / Confluence

Enumerate via the corresponding access surface (Linear MCP workflow states + labels; Notion data-source select options for `notion.statusProperty`; Confluence page-exists check per parent id). Same compare-exact-case contract as JIRA.

## Step 4 — Compare (exact case)

For each `(role, configured-name)` pair, classify against the live name set:

- **VALID** — an exact-case match exists in the live set.
- **CASE_DRIFT** — a case-insensitive match exists but no exact-case match (e.g. config `"On Stg"` vs live `"ON STG"`). Canonical = the live exact name.
- **MISSING** — no case-insensitive match exists. The name was renamed beyond recognition or deleted.

A project's verdict:

- **VALID** — every role is VALID.
- **DRIFTED** — at least one CASE_DRIFT or MISSING role, none of which is UNRESOLVABLE.
- **UNRESOLVABLE** — the live set couldn't be enumerated (auth mismatch, missing tracker config, access failure). Distinguish this loudly from VALID — an unresolved audit is not a passing audit.

## Step 5 — Report

Per project, print a terminal-first section:

```
<project-path>  [tracker=<vendor> project/repo=<id>]  VERDICT
  role            configured        live (canonical)    status
  ready           Ready             Ready               VALID
  claimed         In Progress       In Progress         VALID
  blocked         Blocked           Blocked             VALID
  done.dev        On Dev            On Dev              VALID
  done.staging    On Stg            ON STG              CASE_DRIFT  → fix: "ON STG"
  done.production Done              Done                VALID
```

End with a roll-up: counts of VALID / DRIFTED / UNRESOLVABLE projects and the exact next command (`… repair=true` when drift is auto-repairable; an admin note when a status is genuinely MISSING).

## Step 6 — Repair (only when `repair=true`)

For each drifted role, repair the **config** (preserve everything else; only write changed keys; always `jq … > tmp && mv`):

### CASE_DRIFT — automatic

Rewrite the configured value to the live canonical name. Examples:

```bash
# scalar role (ready/claimed/blocked/review)
jq --arg v "$CANONICAL" '.jira.workflow.<role> = $v' \
  .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json

# done.<env>
jq --arg v "$CANONICAL" '.jira.workflow.done.<env> = $v' \
  .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json

# github/linear label
jq --arg v "$CANONICAL" '.github.labels.<lane>.<role> = $v' \
  .lisa.config.json > .lisa.config.json.tmp && mv .lisa.config.json.tmp .lisa.config.json
```

### MISSING — confirm first

Compute the closest live candidates (case-insensitive token/substring overlap, then edit distance). Present via `AskUserQuestion`:

> Role `<role>` maps to `<configured>`, which no longer exists in `<vendor>`. Closest live names: `<c1>`, `<c2>`, `<c3>`. Pick the replacement, leave unchanged, or enter a name manually.

Only write on an explicit pick. Never auto-select. If the user leaves it unchanged, keep the project `DRIFTED` and surface the admin remediation (add the status back, or fix it in the tracker).

### Invalidate the verification cache

After any JIRA repair, clear the `setup-jira` reachability cache so it re-verifies the new mapping:

```bash
jq 'if .jira then .jira.verified_workflow_hash = null else . end' \
  .lisa.config.local.json > .lisa.config.local.json.tmp 2>/dev/null \
  && mv .lisa.config.local.json.tmp .lisa.config.local.json || true
```

Re-print the project section showing the post-repair mapping and the new verdict (VALID if every role now resolves).

## Idempotency & repeatability

- Re-running on a clean config reports `VALID` and writes nothing.
- Read-only mode has no side effects and is safe to schedule. Pair with `/schedule` (or run in CI) to detect drift continuously; run `repair=true` interactively when drift appears (the `MISSING` path needs a human decision and should not run unattended).
- Repair only ever touches `.lisa.config.json` (and clears the local verification-cache key) — it preserves all unrelated config and never stages secrets or env values.

## Rules

- Compare status/label names **case-sensitively** against the live canonical set. A case-insensitive tracker query (e.g. JQL) that resolves is not proof the casing matches.
- Verify the access substrate is authenticated to the **configured** account before trusting any enumeration. An audit run against the wrong instance is `UNRESOLVABLE`, not `VALID`.
- Repair fixes the **config**, never the tracker. Do not rename or delete tracker statuses, labels, or options.
- Never auto-repair a `MISSING` mapping; confirm the replacement via `AskUserQuestion`.
- Use `jq` for all JSON reads/writes; write only changed keys via `jq … > tmp && mv`.
- In batch mode, audit each project independently — one project's `UNRESOLVABLE` (e.g. an auth mismatch) must not abort the rest of the sweep.
- Reuse the config-resolution defaults and the vendor access skills (`atlassian-access`, `gh`, Linear/Notion MCP); do not invent a parallel mapping or lifecycle vocabulary.
