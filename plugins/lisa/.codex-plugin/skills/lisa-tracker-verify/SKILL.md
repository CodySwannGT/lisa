---
name: lisa-tracker-verify
description: "Vendor-neutral wrapper for the…"
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Verify: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor post-write verifier.

See the `config-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa-tracker-write`).
2. Dispatch:
   - Missing / empty → stop and report `"No tracker configured in .lisa.config.json. Run /lisa:setup:jira, /lisa:setup:github, or /lisa:setup:linear first."`
   - `jira` → invoke `lisa-jira-verify` with `$ARGUMENTS` verbatim.
   - `github` → invoke `lisa-github-verify` with `$ARGUMENTS` verbatim.
   - `linear` → invoke `lisa-linear-verify` with `$ARGUMENTS` verbatim.
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Pass through the verifier's structured report unchanged.

## Rules

- Read-only.
- The same gates run pre-write and post-write — this shim simply chooses the vendor implementation.
- If the vendor verify reports `FAIL`, callers must NOT auto-fix from this layer. Surface the failures to the caller and let the higher-level skill decide.
- Duplicate closeout is not a verifier shortcut. A build-intake ticket may be auto-closed as duplicate only when downstream triage returns `DUPLICATE_ALREADY_FIXED` with a canonical ticket reference and empirical evidence that the canonical fix is present on the relevant base branch; ordinary verifier `FAIL`/`PASS` output never implies duplicate resolution.
