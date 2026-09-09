---
name: lisa-linear-verify
description: "Verifies a Linear work item…"
allowed-tools: ["Bash", "Skill"]
---

# Verify Linear Work Item: $ARGUMENTS

Fetch the live Linear work item and run it through `lisa-linear-validate-issue`. This catches any field that was dropped or reformatted between the pre-write spec and what Linear stored.

This skill is the destination of the `lisa-tracker-verify` shim when `tracker = "linear"`. Read-only — never writes.

## Configuration

Reads `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).

## Input

`$ARGUMENTS` is a Linear identifier:
- An Issue identifier (e.g. `ENG-123`)
- A Project URL or slug (e.g. `https://linear.app/<workspace>/project/<slug>-<id>`)

If `$ARGUMENTS` is not parseable, stop and report.

## Phase 1 — Resolve Context

1. Read `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).
2. Resolve team ID via `lisa-linear-access operation: list-teams({query: <teamKey>})`.
3. Determine entity type from the identifier shape:
   - `<TEAM>-<n>` → Issue
   - URL containing `/project/<slug>-<id>` → Project

## Phase 2 — Fetch Live State

Call `lisa-linear-access operation: get-issue` (for Issues) or `lisa-linear-access operation: get-project` (for Projects). Capture every field, label, relation, comment, milestone, and project membership.

## Phase 3 — Delegate to Validator

Pass the fetched item to `lisa-linear-validate-issue` (in identifier mode — let it derive the spec from the live state). The validator runs both Specification AND Feasibility gates against what Linear actually stored.

## Phase 4 — Report

Return the validator's report verbatim — same structured format as `lisa-linear-validate-issue`. Callers (especially `lisa-linear-write-issue` Phase 7) parse the verdict to decide whether to declare success.

If the verdict is `FAIL`, the caller should fix the item and re-run verify. Never declare success on a `FAIL` verdict.

## Rules

- Never write to Linear. Read-only.
- Never short-circuit the validator. Always run the full gate set.
- If `get_issue` / `get_project` returns an access error, surface it and exit — don't pretend the item is fine.

## Comparison is semantic, never byte-exact

Re-run the validator against the live item — an Issue or a Project, whichever
was written. Do NOT compare the stored body against what was sent byte for byte.

The shape does not change the method, and saying so matters here because the
access rule directly above already names both `get_issue` and `get_project`: a
Project's stored description is normalized on write exactly as an Issue's body
is, so a byte comparator is wrong about it for the same reason and to the same
degree.

The reason is measured rather than theoretical. Trackers normalize markdown on
write: `-` bullets become `*`, a bare URL is wrapped as `[url](<url>)`, bold
emphasis is re-segmented around inline code spans. All lossless, all
rendering-identical, and all of it makes a byte comparator report failure on a
write that was completely fine. A comparator that cannot tell vendor
normalization from corruption fails on healthy writes and trains its reader to
ignore it, which costs more than the check was ever worth.

Compare meaning: run `lisa-linear-validate-issue` against the stored item and let the gates
decide. Where a single field must be compared directly, normalize both sides
first.
