---
name: tracker-build-intake
description: "Vendor-neutral wrapper for the build-queue batch scanner. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-build-intake (JQL/project-key queue) or lisa:github-build-intake (GitHub repo queue keyed off the `status:ready` label). Counterpart to lisa:intake's PRD-side dispatchers."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Build Intake: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor build-queue scanner.

See the `tracker-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-build-intake` with `$ARGUMENTS` verbatim. Arg shape: a JIRA project key (e.g., `SE`) or a JQL filter.
   - `github` → invoke `lisa:github-build-intake` with `$ARGUMENTS` verbatim. Arg shape: a GitHub `org/repo` token or a full GitHub repo URL.
3. Pass through the cycle summary verbatim.

## Rules

- Single cycle per invocation — the vendor skill processes the current `Ready` set and exits.
- The vendor skills run their own pre-flight checks (JIRA workflow transitions for the JIRA path; label namespace adoption for the GitHub path) before processing items. Never bypass.
- Never run two intake cycles concurrently against overlapping queues — the scheduling layer is responsible for serialization.
