---
name: lisa-tracker-write
description: "Vendor-neutral wrapper for ticket creation and updates. Reads the required `tracker` from .lisa.config.json and dispatches to lisa-jira-write-ticket, lisa-github-write-issue, or lisa-linear-write-issue. Callers in vendor-neutral skills (notion-to-tracker, linear-to-tracker, confluence-to-tracker, github-to-tracker, implement, verify) MUST invoke this skill instead of the vendor-specific ones — that is what makes the tracker switchable per project. The Phase-5.5 validate-pre-write gate, post-write verify, and Phase-8 announce-comment behavior live in the vendor skills; this shim is dispatch only."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Write: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor
write skill.

When the incoming description/body already contains the canonical `## Lisa Usage` ledger, the vendor
writer must preserve that managed section on update and use the `lisa-lisa-usage-accounting` contract for any
body-vs-comment fallback. This shim only routes — it never edits tracker artifacts itself.

See the `config-resolution` rule for the full configuration schema and skill-mapping table.

## Workflow

1. **Resolve tracker config**

   Read `.lisa.config.local.json` first (if present), then `.lisa.config.json`. Local overrides global on a per-key basis. Use `jq` — never hand-parse JSON.

   ```bash
   local_tracker=$(jq -r '.tracker // empty' .lisa.config.local.json 2>/dev/null)
   global_tracker=$(jq -r '.tracker // empty' .lisa.config.json 2>/dev/null)
   tracker="${local_tracker:-$global_tracker}"
   ```

2. **Validate the value**

   - Missing / empty → stop and report: `"No tracker configured in .lisa.config.json. Run /lisa:setup:jira, /lisa:setup:github, or /lisa:setup:linear first."`
   - `jira` → confirm `atlassian.cloudId` and `jira.project` are present. If either is missing, stop and report: `"tracker=jira but atlassian.cloudId and jira.project are not set in .lisa.config.json."` Continue to Step 3a.
   - `github` → confirm `github.org` and `github.repo` are present. If either is missing, stop and report: `"tracker=github but github.org and github.repo are not set in .lisa.config.json."` Continue to Step 3b.
   - `linear` → confirm `linear.workspace` and `linear.teamKey` are present. If either is missing, stop and report: `"tracker=linear but linear.workspace and linear.teamKey are not set in .lisa.config.json."` Continue to Step 3c.
   - Any other value → stop and report: `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`

3. **Dispatch**

   - **3a (jira):** Invoke `lisa-jira-write-ticket` via the Skill tool, passing `$ARGUMENTS` verbatim.
   - **3b (github):** Invoke `lisa-github-write-issue` via the Skill tool, passing `$ARGUMENTS` verbatim.
   - **3c (linear):** Invoke `lisa-linear-write-issue` via the Skill tool, passing `$ARGUMENTS` verbatim.

4. **Surface the vendor skill's output unchanged.** Do not paraphrase; downstream callers parse the structured response.

## Rules

- Never bypass dispatch — calling the vendor skill directly from a vendor-neutral caller defeats the per-project switch.
- Never drop, duplicate, or hand-rewrite an existing managed `## Lisa Usage` section in this shim.
  Writer-specific preservation logic belongs in the vendor writers and follows the
  `lisa-lisa-usage-accounting` contract.
- Never accept a tracker value outside `{jira, github, linear}`.
- Never mutate `$ARGUMENTS` between layers. The vendor skills define their own input contract.
- Never inline gate logic here. All validation rules live in the vendor skills (`lisa-jira-validate-ticket` / `lisa-github-validate-issue` / `lisa-linear-validate-issue`); this skill only routes.
