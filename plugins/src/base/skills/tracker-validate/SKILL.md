---
name: tracker-validate
description: "Vendor-neutral wrapper for the pre-write quality gate. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-validate-ticket or lisa:github-validate-issue. Read-only — never writes to either tracker. Used by tracker-write Phase 5.5 (pre-write gate), tracker-verify (post-write checks), and the *-to-tracker dry-run paths. Output is structured PASS/FAIL per gate so callers can parse it."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Validate: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor validator.

See the `tracker-resolution` rule for the full configuration schema and skill-mapping table.

## Workflow

1. **Resolve tracker config** (same logic as `lisa:tracker-write` Step 1):

   ```bash
   tracker=$(jq -r '.tracker // "jira"' .lisa.config.local.json 2>/dev/null \
     || jq -r '.tracker // "jira"' .lisa.config.json 2>/dev/null \
     || echo "jira")
   ```

2. **Dispatch**

   - `jira` → invoke `lisa:jira-validate-ticket` with `$ARGUMENTS` verbatim.
   - `github` → invoke `lisa:github-validate-issue` with `$ARGUMENTS` verbatim.
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json."`

3. **Pass through the validator's structured report unchanged.** Callers (e.g. `lisa:jira-write-ticket` Phase 5.5) parse the gate lines; do not paraphrase.

## Rules

- Read-only — never write to either tracker.
- Never re-implement gate logic here. The gate definitions are the vendor validator's responsibility.
- Never silently transform the input — pass `$ARGUMENTS` through verbatim.
