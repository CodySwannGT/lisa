---
name: linear-build-intake
description: "Symmetric counterpart to lisa:jira-build-intake on the Linear side. Scans a Linear team for Issues labeled status:ready, claims each by relabeling to status:in-progress, runs the implementation/build flow via lisa:linear-agent, and relabels to status:on-dev on completion. status:ready is the human-flipped signal that an Issue is truly ready for development — mirroring how Notion PRDs work Draft → Ready → (us) In Review → Blocked|Ticketed."
allowed-tools: ["Skill", "Bash", "mcp__linear-server__list_teams", "mcp__linear-server__list_issues", "mcp__linear-server__get_issue", "mcp__linear-server__save_issue", "mcp__linear-server__save_comment", "mcp__linear-server__list_issue_labels", "mcp__linear-server__create_issue_label"]
---

# Linear Build Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

1. A Linear team key (e.g. `ENG`) — scans that team for `status:ready` Issues.
2. The literal token `linear` — falls back to `linear.teamKey` from `.lisa.config.json`.
3. A pre-built Linear MCP filter (advanced) — used as-is.

Run one build-intake cycle. Each `status:ready` Issue is claimed, built via the `lisa:linear-agent` flow, and relabeled to `status:on-dev` on completion. The cycle is the symmetric mirror of `lisa:jira-build-intake` and `lisa:github-build-intake`: humans flip `status:ready`, agents pick up and progress.

This skill is the destination of the `lisa:tracker-build-intake` shim when `tracker = "linear"`.

## Why labels, not native states

Linear's per-team workflow state names vary (`Todo` / `Backlog` / `Up Next` / etc.). Labels are workspace-scoped or team-scoped and stable across teams, so we drive the build queue off labels rather than chasing renamed native states. The native `state` field is informational only for this skill.

## Configuration

Reads `linear.workspace`, `linear.teamKey` from `.lisa.config.json` (with `.local` override).

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a team key, run the cycle to completion — claim, dispatch each Issue through `lisa:linear-agent`, transition successful builds to `status:on-dev`, write the summary. The caller (a human or a cron) has already authorized the run by invoking the skill.

Specifically forbidden:

- Previewing projected scope (Issue count, projected PR count, build duration) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip a few / dry-run only" — the documented behavior IS the default.
- Pausing because the queue is large, items look complex, or items are likely to be `status:blocked` by `lisa:linear-agent`'s pre-flight gate. The pre-flight `status:blocked` outcome is a valid terminal state of the per-Issue lifecycle.
- Pausing because the build flow looks expensive.

The only legitimate reasons to stop early:

- Missing team key or required configuration. Surface and exit.
- Label convention not yet adopted (`status:ready` does not exist on the team's labels). Surface and exit with an Adoption hint.
- Empty `status:ready` set. Exit cleanly with `"No Linear Issues labeled status:ready. Nothing to do."`

## Lifecycle assumed

Linear build queue uses these issue-level labels:

```text
status:ready → status:in-progress → status:code-review → status:on-dev → status:done
(human/PM)    (us claim)            (us PR ready)        (us build done)  (downstream)
```

This skill ONLY transitions `status:ready → status:in-progress` on claim, and `status:in-progress → status:on-dev` on completion. It never touches `status:done`, `status:code-review` (owned by `lisa:linear-agent` / `lisa:linear-evidence`), or `status:blocked` (owned by `lisa:linear-agent`'s pre-flight gate).

**Pre-flight check**: at start of each cycle, confirm `status:ready`, `status:in-progress`, `status:on-dev` exist on the team via `mcp__linear-server__list_issue_labels`. If `status:ready` is missing, stop and report adoption needed. The other labels can be created on demand.

## Phases

### Phase 1 — Resolve scope

1. Parse `$ARGUMENTS`:
   - Bare team key → use as-is.
   - Literal `linear` → fall back to `linear.teamKey` from config.
2. Resolve team ID via `mcp__linear-server__list_teams({query: <teamKey>})`.

### Phase 2 — Find Ready Issues

Query: `mcp__linear-server__list_issues({team: <teamId>, label: "status:ready"})`.

Capture each Issue's: identifier, title, type label, priority, assignee, project, labels, description summary.

If empty, report `"No Linear Issues labeled status:ready. Nothing to do."` and exit. Common idle case.

### Phase 3 — Process each Ready Issue (serial)

#### 3a. Claim

Update labels via `mcp__linear-server__save_issue`: remove `status:ready`, add `status:in-progress`. Resolve label IDs via `list_issue_labels` (create `status:in-progress` if missing).

Post a `[claude-build-intake]` comment via `save_comment`: `"Claimed by Claude. Starting build."`

This is the idempotency lock — a re-entrant cycle's `label: status:ready` filter will not see this Issue again.

If the relabel fails (permission, race), record under "Errors" and skip. **Do not invoke the build flow on an Issue you didn't successfully claim.**

#### 3b. Run the build flow

Invoke `lisa:linear-agent` (per-Issue lifecycle agent) with the Issue identifier. `lisa:linear-agent` owns:
- Reading the full Issue graph (`lisa:linear-read-issue`)
- Running its own pre-flight quality gate (`lisa:linear-verify`)
- Running ticket triage (`lisa:ticket-triage`)
- Routing to the appropriate flow (Build / Fix / Investigate / Improve based on type)
- Posting progress comments via `lisa:linear-sync`
- Posting evidence via `lisa:linear-evidence`

Wait for the agent to return. Capture its outcome:
- **Success** — PR is ready (open or merged); evidence posted; ready for next status.
- **Blocked by linear-verify pre-flight gate** — `lisa:linear-agent` itself relabels to `status:blocked` and assigns to creator. Let it stand. Record and move on.
- **Blocked by ticket-triage ambiguities** — agent posts findings and stops. The Issue stays at `status:in-progress`. Surface to human; do not auto-transition. Record under "Errors".
- **Errored** — exception, missing config, etc. Leave at `status:in-progress`. Record with exception summary.

#### 3c. Relabel to status:on-dev (only on Success)

If `lisa:linear-agent` returned Success:
1. Update labels via `mcp__linear-server__save_issue`: remove `status:in-progress`, add `status:on-dev`. (Note: at this point `lisa:linear-evidence` has typically already moved the Issue to `status:code-review` after PR creation. The transition is `status:code-review → status:on-dev` if that's the current state.)
2. Post a `[claude-build-intake]` comment: `"Build complete. PR <URL>. Transitioned to status:on-dev."`

For any non-Success outcome, do NOT transition. The Issue sits where the agent left it — humans take it from there.

#### 3d. Continue

Move to the next Ready Issue. One Issue failing does not stop others.

### Phase 4 — Summary report

```text
## linear-build-intake summary

Team: <teamKey>
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

Issues processed: <n>
- status:on-dev (build complete, PR ready): <n>
  - <ID> <title> → PR <URL>
- status:blocked (pre-flight verify failed): <n>
  - <ID> <title> — see Issue comments
- Held (triage found ambiguities): <n>
  - <ID> <title> — see Issue comments
- Errors: <n>
  - <ID> <title> — <reason>

Total PRs opened: <n>
```

## Idempotency & safety

- **Claim-first ordering**: `status:in-progress` set BEFORE agent invocation — no double-pickup.
- **No writes outside the lifecycle**: this skill only adds/removes `status:ready`, `status:in-progress`, `status:on-dev`. Every other label change (and the native state) is owned by the agent or `lisa:linear-evidence`.
- **Failure isolation**: per-Issue exceptions caught and recorded; the cycle continues.
- **Single cycle per team**: do not run two concurrent cycles against the same team — concurrent claims could race.
- **Single-label invariant**: after every transition, verify exactly one `status:*` label is present. Two simultaneously breaks the build queue.

## Adoption (one-time per team)

Before this skill can run against a Linear team, the team must adopt the `status:*` issue-label convention:

1. Create labels `status:ready`, `status:in-progress`, `status:code-review`, `status:on-dev`, `status:done`, `status:blocked` on the team (or workspace).
2. Apply `status:ready` to Issues that are ready for development.
3. Reserve `status:in-progress`, `status:code-review`, `status:on-dev` for Lisa — humans should not set them manually except to recover from an error.

If the team hasn't adopted these labels, the first run exits with an adoption hint.

## Rules

- Never relabel an Issue the cycle didn't claim. The `status:in-progress` transition is the signature of cycle ownership.
- Never bypass `lisa:linear-agent` to do build work directly. The agent owns the per-Issue lifecycle.
- Never auto-transition past `status:on-dev`. Downstream labels (`status:done`) are owned by QA / product / a future verification-intake skill.
- If the Issue has no Validation Journey or no sign-in credentials in its description, `lisa:linear-agent`'s pre-flight verify will catch it and relabel to `status:blocked` — don't try to fix the Issue from here.
- On any unexpected response from `lisa:linear-agent` (label it doesn't claim, missing PR URL on success, etc.), record as Error and surface — never assume.
