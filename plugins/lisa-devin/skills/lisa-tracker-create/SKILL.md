---
name: lisa-tracker-create
description: "Vendor-neutral wrapper for creating tickets/issues from code files or descriptions. Reads the required `tracker` from .lisa.config.json and dispatches to lisa-jira-create, lisa-github-create, or lisa-linear-create. Plans hierarchy structure (epic / story / sub-task), then delegates each individual write through the tracker-write shim."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Create: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor planning skill.

See the `config-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa-tracker-write`).
2. Dispatch:
   - Missing / empty → stop and report `"No tracker configured in .lisa.config.json. Run /lisa:setup:jira, /lisa:setup:github, or /lisa:setup:linear first."`
   - `jira` → invoke `lisa-jira-create` with `$ARGUMENTS` verbatim.
   - `github` → invoke `lisa-github-create` with `$ARGUMENTS` verbatim.
   - `linear` → invoke `lisa-linear-create` with `$ARGUMENTS` verbatim.
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Pass through the output.

## Rules

- All vendor skills delegate every individual ticket write through `lisa-tracker-write`. They never call vendor-specific write tools directly.
- **Declare readiness on every leaf write.** Per the `ready-role-filing` rule an omitted `build_ready` is **not build-ready** on any tracker, so pass `build_ready: true` on each Sub-task (the leaf work units this skill plans) and never on the Epic or Stories, which are containers per `leaf-only-lifecycle`. A leaf that is deliberately held instead passes `human_gate: "<why a human must judge this first>"`. Filing a leaf with neither is an incomplete handoff and `lisa-tracker-write` rejects it.
- This shim is for ad-hoc creation from code files / descriptions. PRD-driven creation goes through the `*-to-tracker` skills (notion / confluence / linear / github).
