---
name: tracker-verify
description: "Vendor-neutral wrapper for the post-write verification gate. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-verify or lisa:github-verify. Fetches the live ticket/issue and runs the validator gates against the stored state — catches anything dropped or reformatted on write. Read-only."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Verify: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor post-write verifier.

See the `tracker-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-verify` with `$ARGUMENTS` verbatim.
   - `github` → invoke `lisa:github-verify` with `$ARGUMENTS` verbatim.
3. Pass through the verifier's structured report unchanged.

## Rules

- Read-only.
- The same gates run pre-write and post-write — this shim simply chooses the vendor implementation.
- If the vendor verify reports `FAIL`, callers must NOT auto-fix from this layer. Surface the failures to the caller and let the higher-level skill decide.
