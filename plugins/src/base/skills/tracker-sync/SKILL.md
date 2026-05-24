---
name: tracker-sync
description: "Vendor-neutral wrapper for posting milestone updates to the linked ticket/issue. Reads `tracker` from .lisa.config.json (default: jira) and dispatches to lisa:jira-sync, lisa:github-sync, or lisa:linear-sync. Posts at: plan created, implementation in progress, PR ready, PR merged. Suggests (never auto-transitions) the next status."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Sync: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor sync skill.

See the `config-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa:tracker-write`).
2. Dispatch:
   - `jira` → invoke `lisa:jira-sync` with `$ARGUMENTS` verbatim.
   - `github` → invoke `lisa:github-sync` with `$ARGUMENTS` verbatim.
   - `linear` → invoke `lisa:linear-sync` with `$ARGUMENTS` verbatim.
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Pass through the output.

`$ARGUMENTS` is forwarded verbatim, including the optional `--rollup` flag (see "Parent status rollup" below) and `--update-label`. The shim never interprets these — the vendor skill does.

If `$ARGUMENTS` is empty, all vendor skills auto-detect a ticket reference from the active plan file (most recently modified `.md` in `plans/`).

## Parent status rollup (`--rollup`)

When the caller passes `--rollup` after the milestone, the dispatch target additionally **derives the parent/container's lifecycle state from its children** instead of acting on the work item directly. This is the vendor-neutral implementation of the **Parent status rollup (the state machine)** section of the `leaf-only-lifecycle` rule — cite that rule, do not restate the policy here. The shim is dispatch only; the rollup mechanics live in the vendor sync skill (`lisa:github-sync`, `lisa:jira-sync`, `lisa:linear-sync`), which resolves child membership via its `*-read-*` skill and evaluates the state machine below.

The state machine (first match wins, evaluated over the **required** leaves only):

| If among the required leaves… | …the parent rolls up to | Role |
|---|---|---|
| any leaf is **blocked** | blocked / attention-needed | `blocked` |
| else any leaf is **in progress** (claimed or in review) | active / in-progress | `claimed` |
| else **all** required leaves are **terminal** | the configured rollup terminal | `done` (or `review` where supported) |
| else (leaves exist, none started) | unchanged | — |

- **Blocked dominates** — one blocked leaf surfaces blocked on the parent even while others progress.
- **The parent never carries `ready`** — `ready` is a human "claim this leaf" signal; rollup only moves a parent between non-ready container states.
- **Rollup is recursive** — an Epic rolls up from its Stories, each of which rolls up from its own leaves. Evaluate bottom-up.
- **The terminal is the configured env-keyed `done`** — multi-env projects roll up to whichever `done` value matches the env their leaves shipped to (see `config-resolution` "Env-keyed `done`"). **Single-environment collapse (this repo):** `deploy.branches` declares only `production: main`, so `done` is a single value and the lifecycle collapses to `ready → claimed (in-progress) → review (code-review) → done`; the rollup terminal is simply `done` (or the PRD-side `ticketed` for PRD containers), with **no** dev/staging promotion hops and **no** env-keyed multi-entry chain to resolve.

**Safe-by-default when not yet supported.** A vendor sync path that has not implemented native rollup MUST be a documented no-op that surfaces the derived state as a suggestion/comment rather than guessing a transition — never an unsafe default. Without `--rollup`, the sync skills behave exactly as before (milestone comment on the work item; no parent derivation).

## Rules

- Idempotent updates — running sync at the same milestone twice should not produce duplicate comments. Vendor skills enforce this.
- Never auto-transition the underlying state. Linear's label-based transition (`status:*`) is the canonical signal and is updated only when the caller passes `--update-label`. Native states stay as suggestions.
- Parent rollup derives state from children per the `leaf-only-lifecycle` rule; it never sets a parent to `ready` and never resolves a dev/staging `done` in this single-environment repo.
