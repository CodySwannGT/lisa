---
name: lisa-tear-down-automations
description: "Remove every recurring Lisa…"
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tear down Lisa automations: $ARGUMENTS

This skill is a **specification, not a script.** It tells the current runtime which recurring Lisa
automations to remove — the ones `/setup-automations` created for THIS project — and the runtime
removes them with its **native** scheduling mechanism.

## Runtime scheduler (branch on the current runtime)

- **Codex** → list Codex automations and delete the `lisa-auto-<project>-*` set via the native
  automations mechanism (prefer the native delete over hand-removing
  `~/.codex/automations/<id>/`, which is only the backing store).
- **Claude** → use **`/schedule`** to list and remove the matching recurring routines.
- **Other runtimes** → use the runtime's native recurring-task mechanism. If it has none, state that
  and stop.

## Scope (remove only what setup created)

- Remove the six automations `/setup-automations` creates for the current project, matched by the
  stable `lisa-auto-<project>-` name prefix: `intake-repair`, `intake-prd`, `intake-tickets`,
  `exploratory-bugs`, `exploratory-prds`, `monitor`.
- **Never** remove automations for a different project, or any non-Lisa automation (e.g. unrelated
  crawlers/ingestors). Match strictly on the `lisa-auto-<project>-` prefix for THIS project; when in
  doubt about an automation's ownership, leave it and report it rather than deleting it.
- **Idempotent** — an automation that is already absent is a no-op, not an error.

## Report

List each automation removed, and any in the expected set that were already absent.
