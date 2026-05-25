---
name: github-build-intake
description: "GitHub counterpart to lisa:jira-build-intake. Scans a GitHub repository for issues carrying the configured `ready` build label, processes the first eligible issue, runs leaf work via lisa:github-agent, relabels to the configured `done` label on completion, then exits. Enforces the claim-time arm of the `leaf-only-lifecycle` rule: a parent/container with open child work (or a childless Epic/Story/Spike) that still carries a stale build-ready label is moved out of the ready pickup queue into the configured `claimed` label with a lifecycle-repair comment, never dispatched to lisa:github-agent. The `ready` label is the human-flipped signal that an issue is truly ready for direct development pickup — mirroring how Notion PRDs work product Draft → Ready → (us) In Review → Blocked|Ticketed."
allowed-tools: ["Skill", "Bash"]
---

# GitHub Build Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

1. A GitHub `org/repo` token (e.g., `acme/frontend-v2`).
2. A full GitHub repo URL (e.g., `https://github.com/acme/frontend-v2`).
3. The literal token `github` — falls back to `.lisa.config.json` (`github.org` / `github.repo`).

Run one build-intake cycle. The first eligible issue in the configured `ready` build label is claimed, built via the `lisa:github-agent` flow, relabeled to the configured `done` label (env-aware — see Workflow resolution), then the cycle exits. Remaining ready issues stay queued for later scheduler invocations.

## Workflow resolution

Build-queue label names are read from `.lisa.config.json` `github.labels.build.*`, falling back to defaults documented in the `config-resolution` rule. Bash pattern:

```bash
# Read role with default fallback. Local overrides global per-key.
read_role() {
  local role="$1" default="$2"
  local local_v global_v
  local_v=$(jq -r ".github.labels.build.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".github.labels.build.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}

READY=$(read_role ready "status:ready")
CLAIMED=$(read_role claimed "status:in-progress")
REVIEW=$(read_role review "status:code-review")
```

For env-keyed `done`, resolve the env first, then look up `done[<env>]`:

1. Explicit caller arg (`target_env=staging`) wins.
2. Otherwise, infer the env from the PR's base branch via `deploy.branches` (reverse lookup).
3. If `done` is a **string** in config, use it directly regardless of env.
4. If `done` is a **map** and env cannot be resolved, **fail loudly** — do not pick arbitrarily.

```bash
TARGET_ENV="${target_env:-}"
if [ -z "$TARGET_ENV" ] && [ -n "$PR_BASE_BRANCH" ]; then
  TARGET_ENV=$(jq -r --arg b "$PR_BASE_BRANCH" \
    '.deploy.branches // {} | to_entries[] | select(.value == $b) | .key' \
    .lisa.config.json 2>/dev/null | head -1)
fi

DONE_TYPE=$(jq -r '.github.labels.build.done | type' .lisa.config.json 2>/dev/null)
if [ "$DONE_TYPE" = "string" ]; then
  DONE=$(jq -r '.github.labels.build.done' .lisa.config.json)
elif [ "$DONE_TYPE" = "object" ]; then
  [ -z "$TARGET_ENV" ] && { echo "ERROR: github.labels.build.done is env-keyed but env not resolvable"; exit 1; }
  DONE=$(jq -r --arg e "$TARGET_ENV" '.github.labels.build.done[$e] // empty' .lisa.config.json)
  [ -z "$DONE" ] && { echo "ERROR: github.labels.build.done has no entry for env '$TARGET_ENV'"; exit 1; }
else
  case "$TARGET_ENV" in
    dev) DONE="status:on-dev" ;;
    staging) DONE="status:on-stg" ;;
    production) DONE="status:done" ;;
    *) echo "ERROR: cannot resolve done label without env"; exit 1 ;;
  esac
fi
```

In prose below, the role names refer to the resolved labels: e.g. "the `ready` label" means whatever `github.labels.build.ready` resolves to (default: `status:ready`).

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a repo, run the cycle to completion — claim and dispatch the first eligible issue through `lisa:github-agent`, relabel a successful build to `$DONE`, write the summary, and exit. The caller (a human or a cron) has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background queue.

Specifically forbidden:

- Previewing projected scope (issue count, projected PR count, build duration) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip a few / dry-run only".
- Pausing because the queue is large, issues look complex, or issues are likely to be `Blocked` by `lisa:github-agent`'s pre-flight gate. Pre-flight `Blocked` is a valid terminal state of the per-issue lifecycle, not a failure mode.
- Pausing because the build flow looks expensive.

The only legitimate reasons to stop early:

- Missing repo or required configuration. Surface the missing value and exit.
- Label namespace not adopted (no issue carries any of `$READY` / `$CLAIMED` / `$REVIEW` / `$DONE`). Surface a label-convention error and exit (this is setup, not a normal idle cycle — see "Adoption" at the bottom).
- Empty ready set. Exit cleanly with `"No GitHub issues labeled $READY in <org>/<repo>. Nothing to do."`

## Lifecycle assumed

The GitHub Issues build lifecycle uses **labels** (we deliberately do NOT key off open/closed alone — closed issues aren't always the right post-build state):

```text
ready → claimed → review → done(env-keyed) (downstream merge / archive)
(human)  (us claim)  (us / PR opens)  (us done; PR ready)
```

(Defaults: `status:ready` / `status:in-progress` / `status:code-review` / `status:on-dev`/`status:on-stg`/`status:done`.)

This skill ONLY transitions:

- `$READY` → `$CLAIMED` (claim)
- `$CLAIMED` → `$DONE` (build complete, PR ready)

It never touches `$REVIEW` (set by the agent / PR open hook), `status:done`-as-terminal (set by merge automation or PM), or any other status.

A "transition" means: remove the old role label and add the new one, in two `gh issue edit` calls (`--remove-label` + `--add-label`) or one combined call. The skill MUST verify exactly one build-lifecycle label (from the resolved `$READY`/`$CLAIMED`/`$REVIEW`/`$DONE` set) is present after the update — having two simultaneously breaks idempotency.

**Pre-flight check**: at the start of each cycle, confirm at least one of the resolved role labels (`$READY`, `$CLAIMED`, `$REVIEW`, or any `$DONE` value) exists on the repo via `gh label list --repo <org>/<repo> --json name`. If none exist, the convention has not been adopted — surface the label-convention error and exit.

## Phases

### Phase 1 — Resolve the repo

1. Parse `$ARGUMENTS`:
   - `org/repo` token → use as-is.
   - GitHub URL → extract `org` and `repo`.
   - Literal `github` → resolve from `.lisa.config.json` (`github.org`, `github.repo`); error if not set.
2. Confirm `gh auth status` succeeds.
3. Confirm the repo is reachable: `gh repo view <org>/<repo> --json name --jq '.name'`.

### Phase 2 — Find ready issues

```bash
gh issue list --repo <org>/<repo> --label "$READY" --state open --json number,title,labels,assignees,milestone,createdAt --limit 100
```

If empty, run a secondary check to distinguish a genuinely empty queue from an unconfigured repo:

```bash
gh label list --repo <org>/<repo> --json name \
  | jq -r --arg r "$READY" --arg c "$CLAIMED" --arg v "$REVIEW" --arg d "$DONE" \
      '[.[] | .name | select(. == $r or . == $c or . == $v or . == $d)] | length'
```

If none of the configured role labels exist on the repo → label convention not adopted, surface a setup error and exit. If the role labels exist but none are `$READY` on any open issue → genuinely empty queue, exit cleanly with `"No GitHub issues labeled $READY. Nothing to do."`

### Phase 3 — Process the first eligible ready issue

#### 3a. Leaf-only claim gate (repair containers)

Build intake dispatches **only independently implementable leaf work units** to the build agent. This enforces the claim-time arm of the vendor-neutral `leaf-only-lifecycle` rule: a parent/container that still carries a stale build-ready role (e.g. `status:ready` applied before this rule existed, or hand-applied to an Epic/Story) is **never dispatched** — intake moves it out of the pickup queue by replacing `$READY` with `$CLAIMED`, then posts a clear lifecycle-repair message. It is the claim-time complement to the write-time labeling in `lisa:github-write-issue` and the validate-time S15 gate in `lisa:github-validate-issue`; all three cite the same rule so the classification never drifts. **Never silently implement a container.**

Run this gate **before** the leaf claim relabel, starting with the oldest/highest-priority ready candidate. Do NOT comment "Claimed" or invoke `lisa:github-agent` for an issue that fails the gate. A container repair still changes labels: remove `$READY`, add `$CLAIMED`, explain that parent/container `$CLAIMED` means rollup/build-lane progress through child/leaf work rather than direct implementation, record it, and end the cycle.

**Resolve container vs. leaf — structural first, then nominal.** Per `leaf-only-lifecycle` the classification is structural: an issue is a **container** if it has **open** child work, whatever its declared type; otherwise the **type label** decides. Resolve child work using the same hierarchy `lisa:github-read-issue` uses — native sub-issues first, then body parentage (task-list checkboxes referencing other issues, `Parent: #<n>` references). Dependency links such as `Blocked by:` are not parentage; they are handled by the active dependency hold gate below.

```bash
# Native sub-issues via GraphQL (same query lisa:github-read-issue uses).
SUBS=$(gh api graphql -f query='
query($org:String!,$repo:String!,$number:Int!){
  repository(owner:$org,name:$repo){
    issue(number:$number){
      subIssues(first: 100) {
        nodes { number state }
      }
    }
  }
}' -F org=<org> -F repo=<repo> -F number=<number> 2>/dev/null)

# Count children still OPEN — a parent whose children are all closed is no longer
# holding open work and rolls up via lisa:github-read-issue's rollup, not here.
OPEN_CHILDREN=$(echo "$SUBS" | jq -r '[.data.repository.issue.subIssues.nodes[]? | select(.state == "OPEN")] | length' 2>/dev/null)
OPEN_CHILDREN=${OPEN_CHILDREN:-0}
```

If the GraphQL `subIssues` field is unavailable (older GHES), fall back to parsing the body for child references exactly as `lisa:github-read-issue` does, and treat the issue as a container if any referenced child issue is open. Note "GraphQL sub-issues unavailable" so the operator knows parentage was text-derived.

Classify and act (first match wins). `type:` is read from the issue's labels (`type:Epic`, `type:Story`, `type:Spike`, `type:Bug`, `type:Task`, `type:Sub-task`, `type:Improvement`):

| Condition | Class | Action |
|---|---|---|
| `OPEN_CHILDREN > 0` (open child work, any type) | **Container** | **Move to `$CLAIMED` as lifecycle repair — do NOT dispatch** |
| no open children AND `type ∈ {Epic, Story, Spike}` | **Childless container-type** | **Move to `$CLAIMED` as lifecycle repair — do NOT dispatch** |
| no open children AND `type ∈ {Bug, Task, Sub-task, Improvement}` (or no `type:` label) | **Leaf work unit** | **Proceed to 3b claim** |

The childless-parent exception is narrow: childlessness enables direct build-agent dispatch **only** for types that are leaf work units to begin with. A childless Epic/Story/Spike is an incomplete decomposition, not an implementable unit — it is moved out of the ready pickup queue for repair/rollup and never dispatched.

**Lifecycle repair (default action for a flagged container).** Move the issue out of the pickup queue by removing `$READY` and adding `$CLAIMED`, post a single lifecycle-repair comment, and record the issue under "Repaired (container)" in the summary. Do NOT invoke `lisa:github-agent`. Keep the comment idempotent — skip posting if an identical `[claude-build-intake]` lifecycle-repair comment already exists on the issue, so a re-entrant cycle doesn't spam it.

```bash
gh issue edit <number> --repo <org>/<repo> --remove-label "$READY" --add-label "$CLAIMED"
gh issue comment <number> --repo <org>/<repo> --body "[claude-build-intake] Lifecycle repair: this issue carried the build-ready role ($READY) but is a parent/container with open child work (or a childless Epic/Story/Spike). I moved it to $CLAIMED without invoking the build agent. For parent/container issues, $CLAIMED means rollup/build-lane progress through child/leaf work; direct implementation must happen on leaf issues. Build-ready is leaf-only per leaf-only-lifecycle — move $READY onto its leaf children, or decompose/reclassify a childless Epic/Story/Spike."
```

This gate never blocks a legitimate flat Task/Bug: those have no open children and a leaf `type:`, so they fall straight through to the claim in 3b.

**Active dependency hold gate.** After the leaf-only gate passes, but still before the claim relabel, parse explicit blocker relationships from the issue body and durable Lisa relationship sections. Support these forms at minimum:

- `Blocked by: #123`
- `Blocked by: #123, #456`
- `Blocked by: owner/repo#123`
- `Blocked by: https://github.com/owner/repo/issues/123`

Resolve local `#123` references against the candidate issue's repo. Resolve qualified refs and GitHub issue URLs against their named repo. For each blocker, read the blocker issue's status labels with `gh issue view <number> --repo <owner>/<repo> --json labels,state`.

Default cleared blocker labels for GitHub build intake are:

- `status:code-review`
- `status:on-dev`
- `status:on-stg`
- `status:done`

A blocker is active if it is open and has no cleared status label. Treat `status:ready`, `status:in-progress`, missing status labels, and inaccessible blockers as active. Closed blockers are cleared. If any blocker is active, skip the candidate without changing lifecycle labels, without posting "Claimed", and without invoking `lisa:github-agent`. Record it under "Skipped (active blockers)" in the summary and include the active blocker refs. Keep any dependency-hold comment idempotent with a `[claude-build-intake]` prefix.

#### 3b. Claim

```bash
gh issue edit <number> --repo <org>/<repo> --remove-label "$READY" --add-label "$CLAIMED"
gh issue comment <number> --repo <org>/<repo> --body "[claude-build-intake] Claimed by Claude. Starting build."
```

This is the idempotency lock — a re-entrant cycle's `--label $READY` filter will not see this issue again.

If the relabel fails (permission, race), log under "Errors" in the cycle summary and skip this issue. **Do not invoke the build flow on an issue you didn't successfully claim.**

#### 3c. Run the build flow

Invoke `lisa:github-agent` (the per-issue lifecycle agent) with the issue ref. `lisa:github-agent` owns:
- Reading the full issue graph (`lisa:github-read-issue`)
- Running its own pre-flight quality gate (`lisa:github-verify`)
- Running issue triage (`lisa:ticket-triage`)
- Routing to the appropriate flow (Build / Fix / Investigate / Improve based on `type:` label)
- Posting progress comments via `lisa:github-sync`
- Posting evidence via `lisa:github-evidence`

Wait for `lisa:github-agent` to return. Capture its outcome:

- **Success** — PR is ready (open or merged); evidence posted; ready for next status.
- **Blocked by github-verify pre-flight gate** — `lisa:github-agent` itself relabels the issue to `status:blocked` (or removes `$CLAIMED` and reassigns to the original author). This is correct and expected — let it stand. Record and move on.
- **Blocked by ticket-triage ambiguities** — `lisa:github-agent` posts findings and stops. The issue stays in `$CLAIMED`. Surface to human; do not auto-relabel. Record under "Errors".
- **Errored** — exception, missing config, etc. Leave the issue in `$CLAIMED` for human investigation. Record under "Errors".

#### 3d. Transition to $DONE (only on Success)

If `lisa:github-agent` returned Success:

1. Resolve `$DONE` for this issue's PR base branch using the Workflow resolution algorithm above. If env can't be resolved and `done` is env-keyed, record an Error and skip this transition — never guess.
2. Determine whether `$DONE` is the true terminal done value per the `leaf-only-lifecycle` rule's Terminal native closure section:
   - If `github.labels.build.done` is a string, that string is terminal.
   - If `github.labels.build.done` is an object, only the production/final environment value is terminal (default: `status:done`). Intermediate env values such as `status:on-dev` and `status:on-stg` are not terminal and must stay open.
   - If the project uses a different final environment name, resolve it from the configured deployment topology; if ambiguous, record an Error and do not close.

```bash
gh issue edit <number> --repo <org>/<repo> --remove-label "$CLAIMED" --add-label "$DONE"
gh issue comment <number> --repo <org>/<repo> --body "[claude-build-intake] Build complete. PR <URL>. Transitioned to $DONE."
```

If `$DONE` is terminal, immediately close the native GitHub issue:

```bash
gh issue close <number> --repo <org>/<repo> --reason completed
```

This close is idempotent: if the issue is already closed, record that native closure was already satisfied and continue. If `$DONE` is an intermediate env state, leave the issue open by design.

For any non-Success outcome, do NOT transition. The issue sits in `$CLAIMED` (or wherever `lisa:github-agent` left it) — humans take it from there.

#### 3e. Stop

Stop immediately after the first claimed, skipped, blocked, held, or errored issue. Later scheduler invocations process the remaining ready issues.

### Phase 4 — Summary report

```text
## github-build-intake summary

Repo: <org>/<repo>
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

Issues processed: <n>
- $DONE (build complete, PR ready): <n>
  - <org>/<repo>#<number> <title> → PR <URL>
- Repaired (container — leaf-only-lifecycle): <n>
  - <org>/<repo>#<number> <title> — build-ready on a parent/container; moved $READY → $CLAIMED without invoking lisa:github-agent; lifecycle-repair comment posted
- Skipped (active blockers): <n>
  - <org>/<repo>#<number> <title> — waiting on <blocker refs>
- Blocked (pre-flight verify failed): <n>
  - <org>/<repo>#<number> <title> — see issue comments
- Held (triage found ambiguities): <n>
  - <org>/<repo>#<number> <title> — see issue comments
- Errors: <n>
  - <org>/<repo>#<number> <title> — <reason>

Total PRs opened: <n>
```

## Idempotency & safety

- **Leaf-only claim gate runs first**: Phase 3a classifies each candidate before any leaf claim; a container with open child work (or a childless Epic/Story/Spike) is moved `$READY` → `$CLAIMED` as lifecycle repair and never dispatched. The lifecycle-repair comment is idempotent — a re-entrant cycle does not re-post it.
- **Dependency hold runs before leaf claim**: explicit `Blocked by:` relationships are resolved after container repair is ruled out but before `$READY → $CLAIMED`; active blockers leave the leaf candidate in `$READY` and are reported as skipped, not blocked.
- **Claim-first ordering**: `$CLAIMED` set BEFORE `lisa:github-agent` invocation for leaves; containers are also moved to `$CLAIMED` to leave the ready pickup queue, but are not dispatched.
- **No writes outside the lifecycle**: this skill only relabels `$READY → $CLAIMED` and `$CLAIMED → $DONE`. For containers, `$READY → $CLAIMED` is a lifecycle repair, not a direct build claim. Every other label change is owned by `lisa:github-agent`.
- **Terminal native closure**: after `$CLAIMED → $DONE`, close the GitHub issue only when `$DONE` is the true terminal done value per `leaf-only-lifecycle`; intermediate env labels stay open.
- **One item per cycle**: per-issue exceptions are caught and recorded, then the cycle exits. The scheduler owns retrying or moving on to the next ready item.
- **Single cycle per repo**: do not run two `lisa:github-build-intake` cycles in parallel against the same repo — concurrent claims could race. The scheduling layer is responsible for serialization.
- **Single-label invariant**: after every transition, verify exactly one `status:*` label is present on the issue. If two are present (rare race), surface as an Error and skip — do NOT auto-resolve.
- **Never pick an arbitrary env for `$DONE`**. If `done` is a map and env is ambiguous, fail loudly.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `.lisa.config.json` `github.org` | (from `$ARGUMENTS`) | GitHub org for the default queue |
| `.lisa.config.json` `github.repo` | (from `$ARGUMENTS`) | GitHub repo for the default queue |
| `.lisa.config.json` `github.labels.build.ready` | `status:ready` | The label that signals "human says this is buildable" |
| `.lisa.config.json` `github.labels.build.claimed` | `status:in-progress` | The label set on pickup |
| `.lisa.config.json` `github.labels.build.review` | `status:code-review` | The label set when the PR opens (owned by `lisa:github-evidence`) |
| `.lisa.config.json` `github.labels.build.done` | env-keyed map or string | The label set after a successful build; env-aware |
| `.lisa.config.json` `deploy.branches` | — | Reverse-lookup map for env inference from PR base branch |

If the repo has not adopted the `status:*` label namespace, this skill cannot run. The remediation is to create the labels — `gh label create status:ready --color FBCA04 --description "Ready for build"` and similar — typically a one-time setup. See "Adoption" below for the full command set using the defaults; if your project overrides the role names, substitute accordingly.

## Rules

- **Dispatch leaves only.** Per the `leaf-only-lifecycle` rule, never dispatch a container — an issue with open child work, or a childless Epic/Story/Spike — even if it carries the build-ready role. Move it `$READY → $CLAIMED` as lifecycle repair (Phase 3a); never silently implement a container.
- Never relabel an issue outside the cycle's allowed transitions. The `$CLAIMED` label is the signature of cycle ownership for leaves, and the parent/container progress state for lifecycle repairs.
- Never bypass `lisa:github-agent` to do build work directly. `lisa:github-agent` owns the per-issue lifecycle.
- Never auto-transition past `$DONE`. Downstream labels (terminal `status:done`, etc.) are owned by QA / PM / merge automation.
- Never close a GitHub issue at intermediate env states (`status:on-dev`, `status:on-stg`, or configured equivalents). Native close happens only at the terminal `done` value.
- If the issue has no Validation Journey or no sign-in credentials, `lisa:github-agent`'s pre-flight verify will catch it — **don't try to fix the issue from here**.
- On any unexpected response from `lisa:github-agent` (status it doesn't claim, missing PR URL on success), record as Error and surface — never assume.
- Never pick an arbitrary env for `$DONE` resolution. If `done` is a map and env is ambiguous, fail loudly.

## Adoption (one-time per repo)

Before this skill can run, the repo must adopt the `status:*` label namespace. Using the defaults:

1. Create the labels:
   ```bash
   gh label create status:ready --color FBCA04 --description "Ready for build" --repo <org>/<repo>
   gh label create status:in-progress --color 0E8A16 --description "Build in progress" --repo <org>/<repo>
   gh label create status:code-review --color 5319E7 --description "PR open, awaiting review" --repo <org>/<repo>
   gh label create status:on-dev --color 1D76DB --description "Built, deployed to dev" --repo <org>/<repo>
   gh label create status:done --color 0E8A16 --description "Shipped" --repo <org>/<repo>
   ```
   If your project overrides any `github.labels.build.*` role name in config, substitute the actual label names you configured.
2. Apply the `$READY` label to issues that are ready for development.
3. Reserve `$CLAIMED`, `$DONE` for this skill — humans should not set them manually except to recover from an error.
4. PRD-source labels (defaults: `prd-ready`, `prd-in-review`, etc.) are a SEPARATE namespace owned by `lisa:github-prd-intake`. Don't conflate.
