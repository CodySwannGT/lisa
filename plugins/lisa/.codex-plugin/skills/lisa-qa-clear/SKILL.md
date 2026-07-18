---
name: lisa-qa-clear
description: "Bulk-clear tickets a human QA…"
allowed-tools: ["Skill", "Bash", "Read", "Glob", "Grep"]
---

# QA Clear: $ARGUMENTS

Human QA can only judge what a user can see. Tickets whose entire scope is a
non-user-facing repo were already verified by the automated lifecycle before reaching the
QA queue; holding them for a human who cannot observe them is pure queue noise. Clear
them in one auditable batch.

## Config resolution

Read `.lisa.config.json`:

- **QA queue status** — `jira.workflow.qa.queue`, falling back to
  `jira.workflow.done.staging`.
- **Certified status** — `jira.workflow.qa.certified`. Required; if missing, stop and
  instruct the operator — never guess a terminal status.
- **Tracker dispatch** — `tracker` decides the surface as everywhere; on GitHub or
  Linear the status names above map to the equivalent labels/states.
- **Non-user-facing repos** — `qa.nonUserFacingRepos` (array of repo names, e.g.
  `["api", "infrastructure"]`). If the key is missing, derive a proposal from
  the project registry (repos with no UI framework signals — no expo/react/native/web
  app surface) and **present it for operator confirmation before moving anything**; never
  bulk-transition on an unconfirmed inference. Recommend persisting the confirmed list to
  the config.

## Procedure

1. Query all tickets in the QA queue status.
2. Classify each by repo scope, in order:
   - `repo:<name>` label or matching component → that repo.
   - Unlabeled → determine the repo from the ticket content (description, AC, technical
     approach) exactly as build-intake's repo-scope gate does, and stamp the
     `repo:<name>` label while you're there so the next sweep is cheap.
   - Undeterminable → leave in place; flag for the operator.
3. Partition:
   - **Every** touched repo is non-user-facing → eligible to clear.
   - Any user-facing repo in scope (including mixed-scope) → stays in the queue for the
     human pass via `lisa-qa-queue`.
4. For each eligible ticket: transition to the certified status and post
   `[lisa-qa-clear] Certified without human QA: scope is <repo(s)>, not observable with
   end-user access. Verified by the automated lifecycle pre-promotion.`
5. Report the batch:

```text
## QA Clear — <date>
Moved to <certified>: <n> (<KEY-1>, <KEY-2>, …) — repo per ticket
Left in queue (user-facing): <n>
Left in queue (undeterminable repo — needs operator): <keys or none>
```

The operator (or tester) reviews the moved list; anything that "sounds user-facing" can
be pulled back with a single instruction — the transition is reversible and the comment
marks exactly what was auto-cleared.

## Rules

- Never clear a mixed-scope ticket — partial human-verifiability means human QA.
- Never bulk-move on an inferred repo list without explicit operator confirmation.
- Every cleared ticket carries the audit comment; a transition without the comment is a
  bug in this procedure.
- Idempotent: tickets already in the certified status, or already carrying this sweep's
  `[lisa-qa-clear]` comment, are skipped silently.
