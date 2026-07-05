---
name: lisa-tracker-sync
description: "Vendor-neutral wrapper for posting milestone updates to the linked ticket/issue. Reads the required `tracker` from .lisa.config.json and dispatches to lisa-jira-sync, lisa-github-sync, or lisa-linear-sync. Posts at: plan created, implementation in progress, PR ready, PR merged. Suggests (never auto-transitions) the next status."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Tracker Sync: $ARGUMENTS

Thin dispatcher. Resolves the configured destination tracker and delegates to the matching vendor sync skill.

See the `config-resolution` rule for configuration and dispatch table.

## Workflow

1. Resolve tracker config (same logic as `lisa-tracker-write`).
2. Dispatch:
   - Missing / empty → stop and report `"No tracker configured in .lisa.config.json. Run /lisa:setup:jira, /lisa:setup:github, or /lisa:setup:linear first."`
   - `jira` → invoke `lisa-jira-sync` with `$ARGUMENTS` verbatim.
   - `github` → invoke `lisa-github-sync` with `$ARGUMENTS` verbatim.
   - `linear` → invoke `lisa-linear-sync` with `$ARGUMENTS` verbatim.
   - Anything else → stop and report `"Unknown tracker '<value>' in .lisa.config.json. Expected 'jira', 'github', or 'linear'."`
3. Pass through the output.

`$ARGUMENTS` is forwarded verbatim, including the optional `--rollup` flag (see "Parent status rollup" below), `--update-label`, `pr_url=<url>`, and `merge_sha=<sha>`. The shim never interprets these — the vendor skill does.

If `$ARGUMENTS` is empty, all vendor skills auto-detect a ticket reference from the active plan file (most recently modified `.md` in `plans/`).

## Parent status rollup (`--rollup`)

When the caller passes `--rollup` after the milestone, the dispatch target additionally **derives the parent/container's lifecycle state from its children** instead of acting on the work item directly. This is the vendor-neutral implementation of the **Parent status rollup (the state machine)** section of the `leaf-only-lifecycle` rule — cite that rule, do not restate the policy here. The shim is dispatch only; the rollup mechanics live in the vendor sync skill (`lisa-github-sync`, `lisa-jira-sync`, `lisa-linear-sync`), which resolves child membership via its `*-read-*` skill and evaluates the state machine below.

The state machine (first match wins, evaluated over the **required** leaves only, on the env ladder `in-progress < dev < staging < production` — the ordered keys of the project's env-keyed `done` map):

| If among the required leaves… | …the parent rolls up to | Role |
|---|---|---|
| any leaf is **blocked** | blocked / attention-needed | `blocked` |
| else **every** required leaf has shipped to some env (each at a `done`-map value) | the **least-advanced** env among them | `done[min-env]` (terminal `done` at production) |
| else any leaf has **started** (claimed or in review, or shipped while a sibling has not) | active / in-progress | `claimed` (or `review` where supported) |
| else (leaves exist, none started) | unchanged | — |

- **Blocked dominates** — one blocked leaf surfaces blocked on the parent even while others progress.
- **Least-advanced env wins** — a parent reaches an env only once all required leaves have reached at least that env (all `On Stg` → `On Stg`; mixed dev/staging → the dev value). Native terminal closure fires only at the production `done`, never at an intermediate env.
- **The parent never carries `ready`** — `ready` is a human "claim this leaf" signal; rollup only moves a parent between non-ready container states.
- **Rollup is recursive** — an Epic rolls up from its Stories, each of which rolls up from its own leaves. Evaluate bottom-up.
- **The env rungs are the configured env-keyed `done`** — multi-env projects roll up to whichever `done` value (including intermediate `On Dev`/`On Stg`) their leaves have collectively reached (see `config-resolution` "Env-keyed `done`"). **Single-environment collapse (this repo):** `deploy.branches` declares only `production: main`, so `done` is a single value, the only env rung is production, and the GitHub build lifecycle collapses to `ready → claimed (in-progress) → done`; the rollup terminal is simply `done` (or the PRD-side `ticketed` for PRD containers), with **no** dev/staging promotion hops and **no** env-keyed multi-entry chain to resolve.

**Safe-by-default when not yet supported.** A vendor sync path that has not implemented native rollup MUST be a documented no-op that surfaces the derived state as a suggestion/comment rather than guessing a transition — never an unsafe default. Without `--rollup`, the sync skills behave exactly as before (milestone comment on the work item; no parent derivation).

## Pull request backlinking

When `$ARGUMENTS` includes `pr_url=<url>` with milestone `pr-ready` or `pr-merged`, the dispatch target must ensure ticket -> PR linkage, not just post a generic progress note:

1. Prefer the provider's native development-link primitive when Lisa can write and verify it for that provider.
2. Verify the native link using the provider read surface when available.
3. If the native link is unavailable, unconfigured, cross-system, or cannot be verified, create or update one managed backlink comment on the work item containing the PR URL and current milestone.
4. Keep the comment idempotent by using a stable marker such as `[lisa-pr-link]`; reruns update or skip the existing managed comment rather than appending duplicates.

This is the reverse half of `lisa-git-submit-pr`'s PR body linkage. A PR that mentions a ticket is not considered fully synced until the ticket also has either a verified native PR link or the managed fallback comment.

## Rules

- Idempotent updates — running sync at the same milestone twice should not produce duplicate comments. Vendor skills enforce this.
- Never auto-transition the underlying state. Linear's label-based transition (`status:*`) is the canonical signal and is updated only when the caller passes `--update-label`. Native states stay as suggestions.
- Parent rollup derives state from children per the `leaf-only-lifecycle` rule; it never sets a parent to `ready` and never resolves a dev/staging `done` in this single-environment repo.
- Pull request backlinks are mandatory when `pr_url=<url>` is present: native first, managed-comment fallback, never silently dropped.
