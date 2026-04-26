---
name: jira-build-intake
description: "Symmetric counterpart to notion-prd-intake on the JIRA side. Scans a JIRA project (or JQL filter) for tickets in Status=Ready, claims each by transitioning to In Progress, runs the implementation/build flow via jira-agent, and transitions to On Dev on completion. The Ready status is the human-flipped signal that a TODO ticket is truly ready for development — mirroring how Notion PRDs work product Draft → Ready → (us) In Review → Blocked|Ticketed."
allowed-tools: ["Skill", "Bash", "mcp__atlassian__getAccessibleAtlassianResources", "mcp__atlassian__searchJiraIssuesUsingJql", "mcp__atlassian__getJiraIssue", "mcp__atlassian__getTransitionsForJiraIssue", "mcp__atlassian__transitionJiraIssue", "mcp__atlassian__addCommentToJiraIssue"]
---

# JIRA Build Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

1. A JIRA project key (e.g. `SE`) — scans that project for `Status = Ready` tickets.
2. A full JQL filter (e.g. `project = SE AND component = "frontend" AND Status = Ready`) — used as-is. The skill will not append a `Status = Ready` clause if the JQL already names a status, so callers can intentionally widen.

Run one build-intake cycle. Each Ready ticket is claimed, built via the `lisa:jira-agent` flow, and transitioned to `On Dev` (or the equivalent next-status for that project). The cycle is the symmetric mirror of `lisa:notion-prd-intake`: humans flip `Ready`, agents pick up and progress.

## Lifecycle assumed

The JIRA workflow has these statuses (or equivalents — see Configuration for renaming):

```text
TODO → Ready → In Progress → On Dev → On QA → Done
       (PM/   (us claim)    (us done; (downstream)
        human)               PR ready)
```

This skill ONLY transitions `Ready → In Progress` on claim, and `In Progress → On Dev` on completion. It never touches `TODO`, `On QA`, `Done`, or any blocked/closed states.

**Pre-flight check**: at start of each cycle, call `getTransitionsForJiraIssue` against a sample Ready ticket to confirm `In Progress` and `On Dev` are reachable transitions. If not, stop and report the workflow misconfiguration to the caller — do not invent transitions.

## Phases

### Phase 1 — Resolve the query

1. Parse `$ARGUMENTS`:
   - Project key: build JQL `project = <KEY> AND Status = "Ready" ORDER BY priority DESC, created ASC`.
   - Full JQL: use as-is. If it does not include a `Status` clause, append `AND Status = "Ready"`.
2. Resolve Atlassian cloud ID via `getAccessibleAtlassianResources`.

### Phase 2 — Find Ready tickets

Run the JQL via `searchJiraIssuesUsingJql`. Capture each ticket's: key, summary, issue type, priority, assignee, parent (epic), labels, components.

If empty, report `"No tickets with Status=Ready. Nothing to do."` and exit. This is the common idle case.

### Phase 3 — Process each Ready ticket (serial)

#### 3a. Claim

Transition the ticket from `Ready` to `In Progress` via `transitionJiraIssue`.
- Use `getTransitionsForJiraIssue` to find the transition ID for `In Progress`.
- Post a `[claude-build-intake]` comment via `addCommentToJiraIssue`: `"Claimed by Claude. Starting build."`
- This is the idempotency lock — a re-entrant cycle's `Status = Ready` filter will not see this ticket again.

If the transition fails (permission, missing transition, race), log under "Errors" in the cycle summary and skip this ticket. **Do not invoke the build flow on a ticket you didn't successfully claim.**

#### 3b. Run the build flow

Invoke the `lisa:jira-agent` (existing per-ticket lifecycle agent) with the ticket key. `lisa:jira-agent` owns:
- Reading the full ticket graph (`lisa:jira-read-ticket`)
- Running its own pre-flight quality gate (`lisa:jira-verify`)
- Running ticket triage (`ticket-triage`)
- Routing to the appropriate flow (Build / Fix / Investigate / Improve based on type)
- Posting progress comments via `lisa:jira-sync`
- Posting evidence via `lisa:jira-evidence`

Wait for `lisa:jira-agent` to return. Capture its outcome:
- **Success** — PR is ready (open or merged); evidence posted; ready for next status.
- **Blocked by jira-verify pre-flight gate** — `lisa:jira-agent` itself transitions the ticket to `Blocked` and reassigns to Reporter. This is correct and expected — let it stand. Record the outcome and move on.
- **Blocked by ticket-triage ambiguities** — `lisa:jira-agent` posts findings and stops. The ticket stays in `In Progress`. Surface to human; do not auto-transition. Record under "Errors" with reason `"Triage found ambiguities — see comments on <ticket-key>"`.
- **Errored** — exception, missing config, etc. Leave the ticket in `In Progress` for human investigation. Record under "Errors" with the exception summary.

#### 3c. Transition to On Dev (only on Success)

If `lisa:jira-agent` returned Success:
1. Use `getTransitionsForJiraIssue` to find the transition ID for `On Dev` (or the configured next-after-build status).
2. Transition via `transitionJiraIssue`.
3. Post a `[claude-build-intake]` comment: `"Build complete. PR <URL>. Transitioned to On Dev."`

For any non-Success outcome, do NOT transition. The ticket sits in `In Progress` (or wherever `lisa:jira-agent` left it for the Blocked case) — the cycle's job is done; humans take it from there.

#### 3d. Continue

Move to the next Ready ticket. One ticket failing does not stop others.

### Phase 4 — Summary report

```text
## jira-build-intake summary

Query: <JQL or project key>
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

Tickets processed: <n>
- On Dev (build complete, PR ready): <n>
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

- **Claim-first ordering**: `In Progress` set BEFORE `lisa:jira-agent` invocation — no double-pickup.
- **No writes outside the lifecycle**: this skill only transitions `Ready → In Progress` and `In Progress → On Dev`. Every other status change is owned by `lisa:jira-agent` (which suggests transitions but only auto-transitions on the verify-FAIL path).
- **Failure isolation**: per-ticket exceptions caught and recorded; the cycle continues.
- **Single cycle per query**: do not run two `lisa:jira-build-intake` cycles in parallel against overlapping queries — concurrent claims could race. The scheduling layer (when added) is responsible for serialization.
- **Never invent a transition**: if `In Progress` or `On Dev` aren't valid transitions in the project's workflow, stop and report rather than guessing alternative names.

## Configuration

Status names default to `Ready`, `In Progress`, `On Dev`. If a project uses different names (`Open` instead of `TODO`, `In Development` instead of `In Progress`, `Code Review` instead of `On Dev`), pass overrides in `$ARGUMENTS` as `claim_status="In Development" done_status="Code Review"`.

If a `Ready` status does not exist in the JIRA project's workflow, this skill cannot run. The remediation is to add `Ready` to the project workflow scheme — JIRA admin task, not something this skill can do.

| Variable | Default | Purpose |
|----------|---------|---------|
| `JIRA_PROJECT` | (from `$ARGUMENTS`) | Project key for the default JQL |
| Status: queue | `Ready` | The status that signals "human says this is buildable" |
| Status: claim | `In Progress` | The intermediate status the agent sets on pickup |
| Status: done | `On Dev` | The status set after a successful build |

## Rules

- Never transition a ticket the cycle didn't claim. The `In Progress` transition is the signature of cycle ownership.
- Never bypass `lisa:jira-agent` to do build work directly. `lisa:jira-agent` owns the per-ticket lifecycle (read, verify, triage, route, sync, evidence). This skill is the dispatcher, not the builder.
- Never auto-transition past `On Dev`. Downstream statuses (`On QA`, `Done`) are owned by QA / product / a future verification-intake skill — not this one.
- If the ticket has no Validation Journey or no sign-in credentials in its description, `lisa:jira-agent`'s pre-flight verify will catch it and transition to `Blocked` — **don't try to fix the ticket from here**. Pre-flight gating is `lisa:jira-agent`'s job; running build work on a thin ticket produces broken work.
- On any unexpected response from `lisa:jira-agent` (status it doesn't claim, missing PR URL on success, etc.), record as Error and surface — never assume.
