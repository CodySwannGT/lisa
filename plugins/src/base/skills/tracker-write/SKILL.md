---
name: tracker-write
description: "Vendor-neutral wrapper for ticket creation and updates. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-write-ticket or lisa:github-write-issue. Callers in vendor-neutral skills (notion-to-tracker, linear-to-tracker, confluence-to-tracker, github-to-tracker, implement, verify) MUST invoke this skill instead of the vendor-specific ones — that is what makes the tracker switchable per project. The Phase-5.5 validate-pre-write gate, post-write verify, and Phase-8 announce-comment behavior live in the vendor skills; this shim is dispatch only."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Write: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor write skill.

See the `tracker-resolution` rule for the full configuration schema and skill-mapping table.

## Workflow

1. **Resolve tracker config**

   Read `.lisa.config.local.json` first (if present), then `.lisa.config.json`. Local overrides global on a per-key basis. Use `jq` — never hand-parse JSON.

   ```bash
   tracker=$(jq -r '.tracker // "jira"' .lisa.config.local.json 2>/dev/null \
     || jq -r '.tracker // "jira"' .lisa.config.json 2>/dev/null \
     || echo "jira")
   ```

2. **Validate the value**

   - `jira` → continue to Step 3a.
   - `github` → continue to Step 3b. Also confirm `github.org` and `github.repo` are present. If either is missing, stop and report: `"tracker=github but github.org and github.repo are not set in .lisa.config.json."`
   - Any other value → stop and report: `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira' or 'github'."`

3. **Dispatch**

   - **3a (jira):** Invoke `lisa:jira-write-ticket` via the Skill tool, passing `$ARGUMENTS` verbatim.
   - **3b (github):** Invoke `lisa:github-write-issue` via the Skill tool, passing `$ARGUMENTS` verbatim.

4. **Surface the vendor skill's output unchanged.** Do not paraphrase; downstream callers parse the structured response.

## Rules

- Never bypass dispatch — calling the vendor skill directly from a vendor-neutral caller defeats the per-project switch.
- Never invent a third tracker.
- Never mutate `$ARGUMENTS` between layers. The vendor skills define their own input contract.
- Never inline gate logic here. All validation rules live in the vendor skills (`lisa:jira-validate-ticket` / `lisa:github-validate-issue`); this skill only routes.
