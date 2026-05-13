---
name: jira-build-intake
description: "Symmetric counterpart to notion-prd-intake on the JIRA side. Scans a JIRA project (or JQL filter) for tickets in the configured `ready` status, claims each by transitioning to the configured `claimed` status, runs the implementation/build flow via jira-agent, and transitions to the configured `done` status on completion. The `ready` status is the human-flipped signal that a TODO ticket is truly ready for development — mirroring how Notion PRDs work product Draft → Ready → (us) In Review → Blocked|Ticketed."
allowed-tools: ["Skill", "Bash"]
---

# JIRA Build Intake: $ARGUMENTS

All Atlassian operations in this skill go through `lisa:atlassian-access`. Do not call MCP tools or `acli` directly.

`$ARGUMENTS` is one of:

1. A JIRA project key (e.g. `SE`) — scans that project for tickets in the configured `ready` status.
2. A full JQL filter (e.g. `project = SE AND component = "frontend" AND Status = Ready`) — used as-is. The skill will not append a `Status = <ready>` clause if the JQL already names a status, so callers can intentionally widen.

Run one build-intake cycle. Each ready ticket is claimed, built via the `lisa:jira-agent` flow, and transitioned to the configured `done` status (env-aware — see below). The cycle is the symmetric mirror of `lisa:notion-prd-intake`: humans flip the ready status, agents pick up and progress.

## Workflow resolution

Status names are read from `.lisa.config.json` `jira.workflow.*`, falling back to defaults documented in the `config-resolution` rule. Bash pattern:

```bash
# Read role with default fallback. Local overrides global per-key.
read_role() {
  local role="$1" default="$2"
  local local_v global_v
  local_v=$(jq -r ".jira.workflow.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".jira.workflow.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}

READY=$(read_role ready "Ready")
CLAIMED=$(read_role claimed "In Progress")
```

For env-keyed `done`, resolve the env first, then look up `done[<env>]`:

1. Explicit caller arg (`target_env=staging`) wins.
2. Otherwise, infer the env from the PR's base branch via `deploy.branches` (reverse lookup: if base is `staging`, env is `staging`).
3. If `done` in config is a **string** (not a map), use it directly regardless of env.
4. If `done` is a **map** and env cannot be resolved, **fail loudly** — do not pick arbitrarily.

```bash
# Resolve env, then DONE.
TARGET_ENV="${target_env:-}"  # from caller args if supplied
if [ -z "$TARGET_ENV" ] && [ -n "$PR_BASE_BRANCH" ]; then
  TARGET_ENV=$(jq -r --arg b "$PR_BASE_BRANCH" \
    '.deploy.branches // {} | to_entries[] | select(.value == $b) | .key' \
    .lisa.config.json 2>/dev/null | head -1)
fi

DONE_RAW=$(jq -r '.jira.workflow.done // empty' .lisa.config.json 2>/dev/null)
DONE_TYPE=$(jq -r '.jira.workflow.done | type' .lisa.config.json 2>/dev/null)
if [ "$DONE_TYPE" = "string" ]; then
  DONE="$DONE_RAW"
elif [ "$DONE_TYPE" = "object" ]; then
  [ -z "$TARGET_ENV" ] && { echo "ERROR: jira.workflow.done is env-keyed but env not resolvable"; exit 1; }
  DONE=$(jq -r --arg e "$TARGET_ENV" '.jira.workflow.done[$e] // empty' .lisa.config.json)
  [ -z "$DONE" ] && { echo "ERROR: jira.workflow.done has no entry for env '$TARGET_ENV'"; exit 1; }
else
  # Default: env-keyed map matching legacy hardcoded names.
  case "$TARGET_ENV" in
    dev) DONE="On Dev" ;;
    staging) DONE="On Stg" ;;
    production) DONE="Done" ;;
    *) echo "ERROR: cannot resolve done status without env"; exit 1 ;;
  esac
fi
```

Run one build-intake cycle. Each ticket in `$READY` is claimed by transitioning to `$CLAIMED`, built via the `lisa:jira-agent` flow, and transitioned to `$DONE` on completion.

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a project key or JQL, run the cycle to completion — claim, dispatch each ticket through `lisa:jira-agent`, transition successful builds to `$DONE`, write the summary. The caller (a human or a cron) has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background batch.

Specifically forbidden:

- Previewing projected scope (ticket count, projected PR count, build duration) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip a few / dry-run only" — the documented behavior IS the default.
- Pausing because the queue is large, tickets look complex, or tickets are likely to be `Blocked` by `lisa:jira-agent`'s pre-flight gate. The pre-flight `Blocked` outcome is a valid terminal state of the per-ticket lifecycle (owned by `lisa:jira-agent`), not a failure mode — surfacing those tickets to humans is success.
- Pausing because the build flow looks expensive. The cost of one cycle is bounded; the cost of stalling a scheduled cron waiting on a human is unbounded.

The only legitimate reasons to stop early:

- Missing project key / JQL or required configuration. Surface the missing value and exit.
- Workflow misconfigured (pre-flight check finds `$CLAIMED` or `$DONE` not reachable, or `$READY` status absent). Surface and exit.
- Empty ready set. Exit cleanly with `"No tickets with Status=$READY. Nothing to do."`

## Lifecycle assumed

The JIRA workflow has these statuses (configured per project — see Workflow resolution above for how role names map to actual workflow values):

```text
TODO → ready → claimed → done(env-keyed) → On QA → archive
       (PM/    (us claim)  (us done;        (downstream)
        human)              PR ready)
```

This skill ONLY transitions `$READY → $CLAIMED` on claim, and `$CLAIMED → $DONE` on completion. It never touches `TODO`, post-`done` statuses, or any blocked/closed states.

**Pre-flight check**: at start of each cycle, attempt the `$CLAIMED` and `$DONE` transitions against a sample ready ticket via `lisa:atlassian-access` `operation: transition key: <K> to: "<status>"` (in a probe / dry-run sense — or fetch transition metadata if the access skill exposes that). If the transitions are unreachable, stop and report the workflow misconfiguration to the caller — do not invent transitions.

## Phases

### Phase 1 — Resolve the query

1. Parse `$ARGUMENTS`:
   - Project key: build JQL `project = <KEY> AND Status = "$READY" ORDER BY priority DESC, created ASC`.
   - Full JQL: use as-is. If it does not include a `Status` clause, append `AND Status = "$READY"`.
2. Confirm the configured Atlassian site by invoking `lisa:atlassian-access` `operation: list-sites` (it enforces connection match against `.lisa.config.json`).

### Phase 2 — Find ready tickets

Invoke `lisa:atlassian-access` `operation: search-issues jql: "<JQL>"`. Capture each ticket's: key, summary, issue type, priority, assignee, parent (epic), labels, components.

If empty, report `"No tickets with Status=$READY. Nothing to do."` and exit. This is the common idle case.

### Phase 3 — Process each ready ticket (serial)

#### 3a. Claim

Transition the ticket from `$READY` to `$CLAIMED` by invoking `lisa:atlassian-access` `operation: transition key: <TICKET> to: "$CLAIMED"`.
- Post a `[claude-build-intake]` comment via `lisa:atlassian-access` `operation: comment key: <TICKET> body: "Claimed by Claude. Starting build."`
- This is the idempotency lock — a re-entrant cycle's `Status = $READY` filter will not see this ticket again.

If the transition fails (permission, missing transition, race), log under "Errors" in the cycle summary and skip this ticket. **Do not invoke the build flow on a ticket you didn't successfully claim.**

#### 3b. Run the build flow

Invoke the `lisa:jira-agent` (existing per-ticket lifecycle agent) with the ticket key. `lisa:jira-agent` owns:
- Reading the full ticket graph (`lisa:jira-read-ticket`)
- Running its own pre-flight quality gate (`lisa:jira-verify`)
- Running ticket triage (`lisa:ticket-triage`)
- Routing to the appropriate flow (Build / Fix / Investigate / Improve based on type)
- Posting progress comments via `lisa:jira-sync`
- Posting evidence via `lisa:jira-evidence`

Wait for `lisa:jira-agent` to return. Capture its outcome:
- **Success** — PR is ready (open or merged); evidence posted; ready for next status.
- **Blocked by jira-verify pre-flight gate** — `lisa:jira-agent` itself transitions the ticket to `Blocked` and reassigns to Reporter. This is correct and expected — let it stand. Record the outcome and move on.
- **Blocked by ticket-triage ambiguities** — `lisa:jira-agent` posts findings and stops. The ticket stays in `$CLAIMED`. Surface to human; do not auto-transition. Record under "Errors" with reason `"Triage found ambiguities — see comments on <ticket-key>"`.
- **Errored** — exception, missing config, etc. Leave the ticket in `$CLAIMED` for human investigation. Record under "Errors" with the exception summary.

#### 3c. Transition to $DONE (only on Success)

If `lisa:jira-agent` returned Success:
1. Resolve `$DONE` for this ticket's PR base branch using the Workflow resolution algorithm above. If env can't be resolved and `done` is env-keyed, record an Error and skip this transition — never guess.
2. Invoke `lisa:atlassian-access` `operation: transition key: <TICKET> to: "$DONE"`.
3. Post a `[claude-build-intake]` comment via `lisa:atlassian-access` `operation: comment key: <TICKET> body: "Build complete. PR <URL>. Transitioned to $DONE."`

For any non-Success outcome, do NOT transition. The ticket sits in `$CLAIMED` (or wherever `lisa:jira-agent` left it for the Blocked case) — the cycle's job is done; humans take it from there.

#### 3d. Continue

Move to the next ready ticket. One ticket failing does not stop others.

### Phase 4 — Summary report

```text
## jira-build-intake summary

Query: <JQL or project key>
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

Tickets processed: <n>
- $DONE (build complete, PR ready): <n>
  - <ticket-key> <summary> → PR <URL>
- Blocked (pre-flight verify failed): <n>
  - <ticket-key> <summary> — see ticket comments
- Held (triage found ambiguities): <n>
  - <ticket-key> <summary> — see ticket comments
- Errors: <n>
  - <ticket-key> <summary> — <reason>

Total PRs opened: <n>
```

## Idempotency & safety

- **Claim-first ordering**: `$CLAIMED` set BEFORE `lisa:jira-agent` invocation — no double-pickup.
- **No writes outside the lifecycle**: this skill only transitions `$READY → $CLAIMED` and `$CLAIMED → $DONE`. Every other status change is owned by `lisa:jira-agent` (which suggests transitions but only auto-transitions on the verify-FAIL path).
- **Failure isolation**: per-ticket exceptions caught and recorded; the cycle continues.
- **Single cycle per query**: do not run two `lisa:jira-build-intake` cycles in parallel against overlapping queries — concurrent claims could race. The scheduling layer (when added) is responsible for serialization.
- **Never invent a transition**: if `$CLAIMED` or `$DONE` aren't valid transitions in the project's workflow, stop and report rather than guessing alternative names.

## Configuration

Reads `atlassian.cloudId`, `jira.project`, and `jira.workflow.{ready,claimed,done}` from `.lisa.config.json` (with `.lisa.config.local.json` overriding per key). The project key is also accepted as `$ARGUMENTS` for ad-hoc invocations.

Status role names default to:
- `ready` → `"Ready"`
- `claimed` → `"In Progress"`
- `done` → env-keyed map `{ "dev": "On Dev", "staging": "On Stg", "production": "Done" }`

If a project uses different names (e.g. `Open` instead of `TODO`, `In Development` instead of `In Progress`, `Code Review` for terminal), override the relevant key in `.lisa.config.json` `jira.workflow.*`. The setup skills (`/lisa:setup:jira`) handle this interactively.

Per-invocation overrides via `$ARGUMENTS` (e.g. `claim_status="In Development"`) are accepted as a secondary escape hatch but `.lisa.config.json` is the canonical source.

If a ready-equivalent status does not exist in the JIRA project's workflow, this skill cannot run. The remediation is to add it to the project workflow scheme — JIRA admin task, not something this skill can do.

| Field / variable | Default | Purpose |
|------------------|---------|---------|
| `.lisa.config.json` `jira.project` | (from `$ARGUMENTS`) | Project key for the default JQL |
| `.lisa.config.json` `atlassian.cloudId` | — | Atlassian Cloud site UUID (required) |
| `.lisa.config.json` `jira.workflow.ready` | `Ready` | The status that signals "human says this is buildable" |
| `.lisa.config.json` `jira.workflow.claimed` | `In Progress` | The intermediate status the agent sets on pickup |
| `.lisa.config.json` `jira.workflow.done` | env-keyed map (`dev`/`staging`/`production`) or string | The status set after a successful build; env-aware |
| `.lisa.config.json` `deploy.branches` | — | Reverse-lookup map for env inference from PR base branch |

## Rules

- Never transition a ticket the cycle didn't claim. The `$CLAIMED` transition is the signature of cycle ownership.
- Never bypass `lisa:jira-agent` to do build work directly. `lisa:jira-agent` owns the per-ticket lifecycle (read, verify, triage, route, sync, evidence). This skill is the dispatcher, not the builder.
- Never auto-transition past `$DONE`. Downstream statuses are owned by QA / product / a future verification-intake skill — not this one.
- If the ticket has no Validation Journey or no sign-in credentials in its description, `lisa:jira-agent`'s pre-flight verify will catch it and transition to `Blocked` — **don't try to fix the ticket from here**. Pre-flight gating is `lisa:jira-agent`'s job; running build work on a thin ticket produces broken work.
- On any unexpected response from `lisa:jira-agent` (status it doesn't claim, missing PR URL on success, etc.), record as Error and surface — never assume.
- Never pick an arbitrary env for `$DONE` resolution. If `done` is a map and env is ambiguous, fail loudly.
