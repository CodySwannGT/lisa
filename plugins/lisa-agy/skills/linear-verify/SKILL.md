---
name: linear-verify
description: "Verifies a Linear work item meets organizational standards by fetching the live item and running it through lisa:linear-validate-issue. Catches anything dropped or reformatted on write — same gates as the pre-write check, but applied to what Linear actually stored. Read-only."
allowed-tools: ["Bash", "Skill", "mcp__linear-server__list_teams", "mcp__linear-server__get_issue", "mcp__linear-server__get_project", "mcp__linear-server__list_issue_labels", "mcp__linear-server__list_project_labels"]
---

# Verify Linear Work Item: $ARGUMENTS

Fetch the live Linear work item and run it through `lisa:linear-validate-issue`. This catches any field that was dropped or reformatted between the pre-write spec and what Linear stored.

This skill is the destination of the `lisa:tracker-verify` shim when `tracker = "linear"`. Read-only — never writes.

## Configuration

Reads `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).

## Input

`$ARGUMENTS` is a Linear identifier:
- An Issue identifier (e.g. `ENG-123`)
- A Project URL or slug (e.g. `https://linear.app/<workspace>/project/<slug>-<id>`)

If `$ARGUMENTS` is not parseable, stop and report.

## Phase 1 — Resolve Context

1. Read `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).
2. Resolve team ID via `mcp__linear-server__list_teams({query: <teamKey>})`.
3. Determine entity type from the identifier shape:
   - `<TEAM>-<n>` → Issue
   - URL containing `/project/<slug>-<id>` → Project

## Phase 2 — Fetch Live State

Call `mcp__linear-server__get_issue` (for Issues) or `mcp__linear-server__get_project` (for Projects). Capture every field, label, relation, comment, milestone, and project membership.

## Phase 3 — Delegate to Validator

Pass the fetched item to `lisa:linear-validate-issue` (in identifier mode — let it derive the spec from the live state). The validator runs both Specification AND Feasibility gates against what Linear actually stored.

## Phase 4 — Report

Return the validator's report verbatim — same structured format as `lisa:linear-validate-issue`. Callers (especially `lisa:linear-write-issue` Phase 7) parse the verdict to decide whether to declare success.

If the verdict is `FAIL`, the caller should fix the item and re-run verify. Never declare success on a `FAIL` verdict.

## Rules

- Never write to Linear. Read-only.
- Never short-circuit the validator. Always run the full gate set.
- If `get_issue` / `get_project` returns an access error, surface it and exit — don't pretend the item is fine.
