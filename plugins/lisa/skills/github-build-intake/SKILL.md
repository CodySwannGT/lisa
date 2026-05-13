---
name: github-build-intake
description: "GitHub counterpart to lisa:jira-build-intake. Scans a GitHub repository for issues labeled `status:ready`, claims each by relabeling to `status:in-progress`, runs the implementation/build flow via lisa:github-agent, and relabels to `status:on-dev` on completion. The `status:ready` label is the human-flipped signal that an issue is truly ready for development — mirroring how Notion PRDs work product Draft → Ready → (us) In Review → Blocked|Ticketed."
allowed-tools: ["Skill", "Bash"]
---

# GitHub Build Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

1. A GitHub `org/repo` token (e.g., `acme/frontend-v2`).
2. A full GitHub repo URL (e.g., `https://github.com/acme/frontend-v2`).
3. The literal token `github` — falls back to `.lisa.config.json` (`github.org` / `github.repo`).

Run one build-intake cycle. Each `status:ready` issue is claimed, built via the `lisa:github-agent` flow, and relabeled to `status:on-dev` (or the equivalent next-label for that repo). The cycle is the symmetric mirror of `lisa:notion-prd-intake`: humans flip `status:ready`, agents pick up and progress.

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a repo, run the cycle to completion — claim, dispatch each issue through `lisa:github-agent`, relabel successful builds to `status:on-dev`, write the summary. The caller (a human or a cron) has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background batch.

Specifically forbidden:

- Previewing projected scope (issue count, projected PR count, build duration) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip a few / dry-run only".
- Pausing because the queue is large, issues look complex, or issues are likely to be `Blocked` by `lisa:github-agent`'s pre-flight gate. Pre-flight `Blocked` is a valid terminal state of the per-issue lifecycle, not a failure mode.
- Pausing because the build flow looks expensive.

The only legitimate reasons to stop early:

- Missing repo or required configuration. Surface the missing value and exit.
- Label namespace not adopted (no issue carries any of `status:ready` / `status:in-progress` / `status:code-review` / `status:on-dev` / `status:done`). Surface a label-convention error and exit (this is setup, not a normal idle cycle — see "Adoption" at the bottom).
- Empty `status:ready` set. Exit cleanly with `"No GitHub issues labeled status:ready in <org>/<repo>. Nothing to do."`

## Lifecycle assumed

The GitHub Issues build lifecycle uses **labels** (we deliberately do NOT key off open/closed alone — closed issues aren't always the right post-build state):

```text
status:ready → status:in-progress → status:code-review → status:on-dev → status:done
   (human)       (us claim)            (us / PR opens)        (us done; PR ready)   (downstream / merge)
```

This skill ONLY transitions:

- `status:ready` → `status:in-progress` (claim)
- `status:in-progress` → `status:on-dev` (build complete, PR ready)

It never touches `status:code-review` (set by the agent / PR open hook), `status:done` (set by merge automation or PM), or any other status.

A "transition" means: remove the old `status:*` label and add the new one, in two `gh issue edit` calls (`--remove-label` + `--add-label`) or one combined call. The skill MUST verify exactly one `status:*` label is present after the update — having two simultaneously breaks idempotency.

**Pre-flight check**: at the start of each cycle, confirm at least one of the `status:*` labels exists on the repo via `gh label list --repo <org>/<repo> --json name`. If none exist, the convention has not been adopted — surface the label-convention error and exit.

## Phases

### Phase 1 — Resolve the repo

1. Parse `$ARGUMENTS`:
   - `org/repo` token → use as-is.
   - GitHub URL → extract `org` and `repo`.
   - Literal `github` → resolve from `.lisa.config.json` (`github.org`, `github.repo`); error if not set.
2. Confirm `gh auth status` succeeds.
3. Confirm the repo is reachable: `gh repo view <org>/<repo> --json name --jq '.name'`.

### Phase 2 — Find Ready issues

```bash
gh issue list --repo <org>/<repo> --label status:ready --state open --json number,title,labels,assignees,milestone,createdAt --limit 100
```

If empty, run a secondary check to distinguish a genuinely empty queue from an unconfigured repo:

```bash
gh label list --repo <org>/<repo> --json name --jq '.[] | select(startswith("status:")) | .name'
```

If no `status:*` labels exist → label namespace not adopted, surface a setup error and exit. If `status:*` labels exist but none are `status:ready` on any open issue → genuinely empty queue, exit cleanly with `"No GitHub issues labeled status:ready. Nothing to do."`

### Phase 3 — Process each Ready issue (serial)

#### 3a. Claim

```bash
gh issue edit <number> --repo <org>/<repo> --remove-label status:ready --add-label status:in-progress
gh issue comment <number> --repo <org>/<repo> --body "[claude-build-intake] Claimed by Claude. Starting build."
```

This is the idempotency lock — a re-entrant cycle's `--label status:ready` filter will not see this issue again.

If the relabel fails (permission, race), log under "Errors" in the cycle summary and skip this issue. **Do not invoke the build flow on an issue you didn't successfully claim.**

#### 3b. Run the build flow

Invoke `lisa:github-agent` (the per-issue lifecycle agent) with the issue ref. `lisa:github-agent` owns:
- Reading the full issue graph (`lisa:github-read-issue`)
- Running its own pre-flight quality gate (`lisa:github-verify`)
- Running issue triage (`lisa:ticket-triage`)
- Routing to the appropriate flow (Build / Fix / Investigate / Improve based on `type:` label)
- Posting progress comments via `lisa:github-sync`
- Posting evidence via `lisa:github-evidence`

Wait for `lisa:github-agent` to return. Capture its outcome:

- **Success** — PR is ready (open or merged); evidence posted; ready for next status.
- **Blocked by github-verify pre-flight gate** — `lisa:github-agent` itself relabels the issue to `status:blocked` (or removes `status:in-progress` and reassigns to the original author). This is correct and expected — let it stand. Record and move on.
- **Blocked by ticket-triage ambiguities** — `lisa:github-agent` posts findings and stops. The issue stays in `status:in-progress`. Surface to human; do not auto-relabel. Record under "Errors".
- **Errored** — exception, missing config, etc. Leave the issue in `status:in-progress` for human investigation. Record under "Errors".

#### 3c. Transition to On Dev (only on Success)

If `lisa:github-agent` returned Success:

```bash
gh issue edit <number> --repo <org>/<repo> --remove-label status:in-progress --add-label status:on-dev
gh issue comment <number> --repo <org>/<repo> --body "[claude-build-intake] Build complete. PR <URL>. Transitioned to status:on-dev."
```

For any non-Success outcome, do NOT transition. The issue sits in `status:in-progress` (or wherever `lisa:github-agent` left it) — humans take it from there.

#### 3d. Continue

Move to the next Ready issue. One issue failing does not stop others.

### Phase 4 — Summary report

```text
## github-build-intake summary

Repo: <org>/<repo>
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

Issues processed: <n>
- status:on-dev (build complete, PR ready): <n>
  - <org>/<repo>#<number> <title> → PR <URL>
- Blocked (pre-flight verify failed): <n>
  - <org>/<repo>#<number> <title> — see issue comments
- Held (triage found ambiguities): <n>
  - <org>/<repo>#<number> <title> — see issue comments
- Errors: <n>
  - <org>/<repo>#<number> <title> — <reason>

Total PRs opened: <n>
```

## Idempotency & safety

- **Claim-first ordering**: `status:in-progress` set BEFORE `lisa:github-agent` invocation — no double-pickup.
- **No writes outside the lifecycle**: this skill only relabels `status:ready → status:in-progress` and `status:in-progress → status:on-dev`. Every other label change is owned by `lisa:github-agent`.
- **Failure isolation**: per-issue exceptions caught and recorded; the cycle continues.
- **Single cycle per repo**: do not run two `lisa:github-build-intake` cycles in parallel against the same repo — concurrent claims could race. The scheduling layer is responsible for serialization.
- **Single-label invariant**: after every transition, verify exactly one `status:*` label is present on the issue. If two are present (rare race), surface as an Error and skip — do NOT auto-resolve.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `.lisa.config.json` `github.org` | (from `$ARGUMENTS`) | GitHub org for the default queue |
| `.lisa.config.json` `github.repo` | (from `$ARGUMENTS`) | GitHub repo for the default queue |
| Label: queue | `status:ready` | The label that signals "human says this is buildable" |
| Label: claim | `status:in-progress` | The label set on pickup |
| Label: done | `status:on-dev` | The label set after a successful build |

If the repo has not adopted the `status:*` label namespace, this skill cannot run. The remediation is to create the labels — `gh label create status:ready --color FBCA04 --description "Ready for build"` and similar — typically a one-time setup.

## Rules

- Never relabel an issue the cycle didn't claim. The `status:in-progress` label is the signature of cycle ownership.
- Never bypass `lisa:github-agent` to do build work directly. `lisa:github-agent` owns the per-issue lifecycle.
- Never auto-transition past `status:on-dev`. Downstream labels (`status:done`, etc.) are owned by QA / PM / merge automation.
- If the issue has no Validation Journey or no sign-in credentials, `lisa:github-agent`'s pre-flight verify will catch it — **don't try to fix the issue from here**.
- On any unexpected response from `lisa:github-agent` (status it doesn't claim, missing PR URL on success), record as Error and surface — never assume.

## Adoption (one-time per repo)

Before this skill can run, the repo must adopt the `status:*` label namespace:

1. Create the labels:
   ```bash
   gh label create status:ready --color FBCA04 --description "Ready for build" --repo <org>/<repo>
   gh label create status:in-progress --color 0E8A16 --description "Build in progress" --repo <org>/<repo>
   gh label create status:code-review --color 5319E7 --description "PR open, awaiting review" --repo <org>/<repo>
   gh label create status:on-dev --color 1D76DB --description "Built, deployed to dev" --repo <org>/<repo>
   gh label create status:done --color 0E8A16 --description "Shipped" --repo <org>/<repo>
   ```
2. Apply `status:ready` to issues that are ready for development.
3. Reserve `status:in-progress`, `status:on-dev` for this skill — humans should not set them manually except to recover from an error.
4. PRD-source labels (`prd-ready`, `prd-in-review`, etc.) are a SEPARATE namespace owned by `lisa:github-prd-intake`. Don't conflate.
