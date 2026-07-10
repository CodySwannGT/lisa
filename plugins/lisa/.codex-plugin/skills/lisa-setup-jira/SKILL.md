---
name: lisa-setup-jira
description: "Configure JIRA as the…"
allowed-tools: ["Bash", "Read", "Write", "Edit", "Skill", "AskUserQuestion"]
---

# Setup JIRA: $ARGUMENTS

Set the JIRA project key and (optionally) make JIRA this project's destination tracker.

## Workflow

### Step 1 — Verify atlassian prerequisite

```bash
cloudid=$(jq -r '.atlassian.cloudId // empty' .lisa.config.json 2>/dev/null)
if [ -z "$cloudid" ]; then
  echo "Error: atlassian.cloudId not set. Run /lisa:setup:atlassian first." >&2
  exit 1
fi
```

If `atlassian` is missing, invoke `/lisa:setup-atlassian` via the Skill tool first, then resume.

### Step 2 — Resolve the JIRA project key

Honor any `--project=KEY` argument. Otherwise, list projects via the active access substrate:

- CLI: `acli jira project list --output json`
- MCP: `mcp__plugin_atlassian_atlassian__getVisibleJiraProjects` with `cloudId=$cloudid`

If only one project is returned, pick it. If multiple, present them via `AskUserQuestion` (label = project key, description = project name) so the user picks the one this project should target.

### Step 3 — Probe workflow & resolve role mapping

Lisa's build lifecycle uses three role-keyed statuses (`ready` → `claimed` → `done[env]`). Defaults are `Ready`, `In Progress`, and `{dev: "On Dev", staging: "On Stg", production: "Done"}`. Probe the project's workflow to confirm these exist; prompt for overrides if not.

```bash
# Fetch a sample ticket's available transitions (or use a project-level workflow scheme query)
# via lisa-atlassian-access operation: transitions key: <SAMPLE-KEY>
# Collect the union of status names visible in the project.
```

For each role:

1. If a status with the **default name** exists in the workflow → use the default; no config entry needed.
2. If the default name is missing but a status with a similar role exists (e.g. `Resolved` instead of `Done`) → present the project's status list via `AskUserQuestion` and let the user pick which maps to the role.
3. If nothing plausible exists → stop and tell the user to either add the missing status to their JIRA workflow (admin task) or pick a fallback that's close enough.

Collect overrides as a partial workflow map. ONLY write keys that differ from defaults — don't bloat the config with redundant values.

### Step 4 — Write `jira.project` + overrides

```bash
# Always write project key.
jq --arg key "$PROJECT_KEY" \
   '.jira = ((.jira // {}) | .project = $key)' \
   .lisa.config.json > .lisa.config.json.tmp \
   && mv .lisa.config.json.tmp .lisa.config.json

# Conditionally write workflow overrides (only if any role differs from default).
if [ -n "$WORKFLOW_OVERRIDES_JSON" ]; then
  jq --argjson wf "$WORKFLOW_OVERRIDES_JSON" \
     '.jira.workflow = $wf' \
     .lisa.config.json > .lisa.config.json.tmp \
     && mv .lisa.config.json.tmp .lisa.config.json
fi
```

### Step 5 — Verify transition reachability (A → B → C cascade)

Confirm every resolved role's status name is actually reachable in the JIRA workflow. **acli has no non-destructive workflow inspector** (the `workitem view --json` `transitions` key is always `null` because acli doesn't pass `expand=transitions`), so verification cascades through three modes, each more invasive than the last.

#### Cache check (skip if unchanged)

Hash the workflow-mapping object plus the project key:

```bash
WORKFLOW_HASH=$(jq -c '{project: .jira.project, workflow: .jira.workflow}' .lisa.config.json | shasum -a 256 | awk '{print $1}')
CACHED=$(jq -r '.jira.verified_workflow_hash // empty' .lisa.config.local.json 2>/dev/null)
if [ "$WORKFLOW_HASH" = "$CACHED" ]; then
  echo "Workflow already verified; skipping probe."
  # proceed to Step 6
fi
```

The verification cache key lives in `.lisa.config.local.json` (per-developer, gitignored) because the workflow on disk might be stale relative to the user's local view of it.

#### Mode A — Changelog inspection (non-destructive, fast)

Aggregate every status name ever observed in the project's ticket histories:

```bash
acli jira workitem search --jql "project = $PROJECT" --paginate --json \
  | jq -r '[.[].changelog.histories[]?.items[]? | select(.field == "status") | .fromString, .toString] | unique[]' \
  | sort -u > /tmp/lisa-observed-statuses.txt
```

For each role (`ready`, `claimed`, `blocked`, each `done.<env>`), check whether the resolved status name appears in the observed set. Roles that match are **verified**. Roles that don't are **unverified** — but that doesn't yet mean they're missing; freshly-added statuses simply haven't accumulated history.

If every role is verified, cache the hash and proceed to Step 6.

#### Mode B — Create-probe-delete (synthetic ticket)

For any role left unverified by Mode A, fall back to creating a throwaway ticket and walking it through.

Prompt via `AskUserQuestion`:

> Mode A could not verify these roles: `<list>`. Create a synthetic probe ticket to verify (recommended), or designate an existing ticket to use as the probe?

If user picks synthetic:

```bash
# Create a probe ticket. Title makes its purpose obvious so a teammate doesn't act on it.
PROBE_KEY=$(acli jira workitem create \
  --project "$PROJECT" \
  --type Task \
  --summary "lisa-setup-probe (DELETE ME)" \
  --description "Created by /lisa:setup:jira to verify workflow status reachability. Safe to delete." \
  --json \
  | jq -r '.key')

trap 'acli jira workitem delete --key "$PROBE_KEY" --yes 2>/dev/null || acli jira workitem archive --key "$PROBE_KEY" --yes 2>/dev/null' EXIT

# Walk through every unverified role's status in order.
for status in $UNVERIFIED_STATUSES; do
  if ! acli jira workitem transition --key "$PROBE_KEY" --status "$status" --yes 2>/dev/null; then
    echo "Error: status '$status' is not reachable in the workflow from the probe ticket's current state." >&2
    # Mark this role as missing; continue with remaining roles where possible (skip if transition is from a state we couldn't reach).
    break
  fi
done

# trap handles cleanup
```

If `acli jira workitem create` fails because the project has required fields, surface the field list and instruct the user to either (a) fill them in via `--field`/`--from-json`, (b) temporarily relax the required-fields configuration, or (c) fall through to Mode C.

#### Mode C — Probe an existing ticket (last resort)

If Mode B can't create a probe (mandatory fields, permission, etc.), prompt the user to designate a low-stakes existing ticket:

> Provide a ticket key in `To Do` (or wherever you want to start the probe). I'll walk it through the unverified statuses and revert.

Capture the ticket's starting status; walk through the unverified chain; revert to the starting status at the end. Use `trap` to ensure revert runs even on error.

#### Outcome

Once all roles are verified by some combination of A/B/C, cache the result:

```bash
jq --arg hash "$WORKFLOW_HASH" \
   '.jira = ((.jira // {}) | .verified_workflow_hash = $hash)' \
   .lisa.config.local.json > .lisa.config.local.json.tmp \
   && mv .lisa.config.local.json.tmp .lisa.config.local.json
```

If any role is **unreachable** after all three modes, stop and surface a concrete admin-task message (which transition needs to be added, between which two statuses, in which workflow). Do not write a config that points at unreachable transitions.

### Step 6 — Verify mid-build transition chain

Independent of role reachability, confirm the lifecycle's required *transition graph* is intact: `ready → claimed`, `claimed → done.<env>` for each env. Mode A's changelog includes paired `(fromString, toString)` entries — count any pair that matches a required transition as verified. Modes B and C do this implicitly by walking the chain in order. If any required transition is missing (e.g., `claimed → done.staging` requires going through `review` first per the workflow), surface and stop with an admin remediation.

### Step 7 — Offer to set top-level `tracker`

If `.tracker` is unset or differs from `"jira"`, ask via `AskUserQuestion`:

> JIRA project `<KEY>` written. Set top-level `tracker: "jira"` so all vendor-neutral skills target JIRA?

Recommend "Yes" unless the project is using a different destination (e.g., GitHub Issues for build-queue but JIRA for read-only mirror — rare).

If yes:

```bash
jq '.tracker = "jira"' .lisa.config.json > .lisa.config.json.tmp \
   && mv .lisa.config.json.tmp .lisa.config.json
```

### Step 8 — Verify

```bash
jq -e '.jira.project' .lisa.config.json >/dev/null
jq -e '.tracker' .lisa.config.json >/dev/null   # if user said yes in step 7
```

Report success with the resolved project key, the workflow mapping (defaults vs. overrides), and whether `tracker` was set.

## Idempotency

- Re-running replaces `jira.project` cleanly (jq merge, not append).
- Re-running does not re-prompt for `tracker` if it's already `"jira"`.
- Re-running with an unchanged workflow mapping skips the verification probe (Mode A/B/C) entirely via the `verified_workflow_hash` cache in `.lisa.config.local.json`. Editing any role name invalidates the cache and re-runs the probe.

## Rules

- Never invent a project key. If discovery fails (no projects visible), surface the error and ask the user to verify their JIRA permissions.
- Never set `tracker` without explicit user confirmation — `tracker` is project-wide and switching it changes every downstream skill's behavior.
- Never write env-level config (api tokens, server URLs) into `.lisa.config.json`.
