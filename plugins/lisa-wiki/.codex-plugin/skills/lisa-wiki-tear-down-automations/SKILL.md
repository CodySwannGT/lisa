---
name: lisa-wiki-tear-down-automations
description: "Remove the recurring LLM Wiki…"
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tear down LLM Wiki automations: $ARGUMENTS

This skill is a **specification, not a script.** It tells the current runtime which recurring wiki
automation to remove — the one `/lisa-wiki:setup-automations` created for THIS project — and the
runtime removes it with its **native** scheduling mechanism.

## Runtime scheduler (branch on the current runtime)

- **Codex** → list Codex automations and delete the `lisa-wiki-auto-<project>-*` set via the native
  automations mechanism (prefer the native delete over hand-removing
  `~/.codex/automations/<id>/`, which is only the backing store).
- **Claude** → use **`/schedule`** to list and remove the matching recurring routine.
- **Other runtimes** → use the runtime's native recurring-task mechanism. If it has none, state that
  and stop.

## Scope (remove only what setup created)

- Remove the wiki automation `/lisa-wiki:setup-automations` creates for the current project, matched
  by the stable `lisa-wiki-auto-<project>-` name prefix: `wiki-ingest`.
- **Never** remove the base `lisa-auto-<project>-*` automations, automations for a different project,
  or any non-Lisa automation (e.g. unrelated crawlers/ingestors). Match strictly on the
  `lisa-wiki-auto-<project>-` prefix for THIS project; when in doubt about an automation's ownership,
  leave it and report it rather than deleting it.
- **Idempotent** — an automation that is already absent is a no-op, not an error.

## Report

List the automation removed, or report it as already absent.
