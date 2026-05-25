---
name: lisa-wiki-setup-automations
description: "Set up the recurring LLM Wiki ingest automation on the local workstation using the CURRENT runtime's native scheduler — Codex automations (the native automations / automation_update mechanism) or, on Claude, /schedule. This skill is a declarative specification: it states WHICH automation to create, how often, and with which command; it does not template schedule files or run scheduling code itself — the runtime's native automation mechanism does the creating. Creates one automation: wiki-ingest, a full /lisa-wiki:ingest cycle, once a day by default (override with cadence). Named and scoped lisa-wiki-auto-<project>-* so it never collides with or clobbers the base /setup-automations set. The wiki counterpart of /lisa:setup-automations — it lives here because the wiki plugin is standalone and installable without the base plugin. Tear down with /lisa-wiki:tear-down-automations."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Set up LLM Wiki automations: $ARGUMENTS

This skill is a **specification, not a script.** It tells the current runtime which recurring wiki
automation to create, on what cadence, and with which command — and the runtime creates it with its
**native** scheduling mechanism. Do **not** hand-template schedule files or write shell to create
them; invoke the runtime's automation tool with the spec below.

It is the wiki counterpart of the base `/lisa:setup-automations`. It is a **separate** skill because
the wiki plugin (`lisa-wiki`) is standalone — it can be installed without the base Lisa plugin, in
which case `/lisa:setup-automations` is not present to schedule ingest. The two skills are
independent and use disjoint name prefixes, so running both is safe.

## Runtime scheduler (branch on the current runtime)

- **Codex** → create a Codex **automation** via the native automations mechanism (prefer the
  `automation_update` tool over hand-writing `~/.codex/automations/<id>/automation.toml`; the TOML is
  only its backing store). Set the execution environment to **local** so it runs on this
  workstation, scoped to this project's working directory.
- **Claude** → use **`/schedule`** to create a local recurring routine.
- **Other runtimes** → use the runtime's native recurring-task mechanism. If the runtime has none,
  state that scheduling is unavailable and stop.

## Parameters

- `cadence` (default **daily**) — how often the full ingest runs. Accepts `daily`, `weekly`, or an
  `every-<n>-hours` form. Map to a Codex `rrule`: daily → `FREQ=DAILY;INTERVAL=1`; weekly →
  `FREQ=WEEKLY;INTERVAL=1`; every N hours → `FREQ=HOURLY;INTERVAL=<n>`. On Claude, pass the
  equivalent `/schedule` cadence. Default is **daily** (`FREQ=DAILY;INTERVAL=1`).

## The automation to create

The automation runs **one cycle** of the full wiki ingest and respects that command's own confirmation
and commit/PR policy (never ask before running; run a full ingest across every enabled
non-external-write source; commit/PR per the ingest skill's bookends; report the cycle summary).

| Automation | Command it runs | Cadence |
|---|---|---|
| **wiki-ingest** | `/lisa-wiki:ingest` (no argument → full ingest across all enabled sources) | once a day (or `cadence`) |

**Naming + scope (so teardown is precise).** Name the automation with the stable prefix
`lisa-wiki-auto-<project>-` (i.e. `lisa-wiki-auto-<project>-ingest`), where `<project>` identifies
this repo, and scope it to this project's working directory. This prefix is deliberately distinct
from the base `lisa-auto-<project>-` set so `/lisa-wiki:tear-down-automations` removes exactly this
automation and never touches the base automations or any other project's. Use a project identifier
stable across runs and distinct from other repos (qualify it, e.g. with the owner — don't rely on a
bare repo basename that could collide).

**Idempotent.** Re-running this skill updates the existing `lisa-wiki-auto-<project>-ingest`
automation in place (same name) rather than creating a duplicate.

## Conditions / guards

- Create the automation only when this repo actually has an LLM Wiki — i.e. `wiki/` exists with a
  `wiki/lisa-wiki.config.json`. If there is no configured wiki, **stop and report** that the wiki
  must be set up first (run `/lisa-wiki:setup`); do not schedule ingest against a non-existent wiki.
- If the runtime has no native scheduler, stop and report what's missing rather than guessing.

## Report

List the automation created or updated (name, the command it runs, the resolved cadence), or report
that it was skipped and why (no configured wiki / no runtime scheduler).
