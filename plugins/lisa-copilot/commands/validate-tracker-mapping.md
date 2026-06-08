---
description: "Detect (and optionally repair) drift between a project's configured Lisa status/label mappings and the live tracker/source workflow names. Read-only by default; repairs the config to canonical live names with repair=true. Audits the current repo or sweeps many via projects=/workspaces=."
argument-hint: "[projects=<glob> | workspaces=<file> [filter=<substr>]] [lane=build|prd|both] [repair=true]"
---

Use the /lisa:validate-tracker-mapping skill to check whether the status/label names in `.lisa.config.json` still match the live tracker and PRD source — catching renames, deletions, and case drift (e.g. config `On Stg` vs live `ON STG`). Read-only by default; pass `repair=true` to rewrite the config to the canonical live names. $ARGUMENTS

Common usage:

- `/lisa:validate-tracker-mapping` — audit the current repo's mapping (read-only).
- `/lisa:validate-tracker-mapping repair=true` — audit and repair config drift in the current repo.
- `/lisa:validate-tracker-mapping projects=~/workspace/geminisportsai/projects/*` — sweep every Lisa project under a directory.
- `/lisa:validate-tracker-mapping workspaces=~/workspace/lisa/.lisa.workspaces.json filter=geminisportsai` — sweep the projects in a workspaces file whose paths match a substring.

Use this when you suspect a JIRA/GitHub/Linear/Notion status, label, or option was renamed or deleted out from under Lisa — the failure mode that leaves builds unable to find their completion transition and items silently stuck. Run it read-only (or on a schedule) to detect drift; run it with `repair=true` to fix the config. Repair only ever edits the config to match the live names — it never renames anything in the tracker.
