---
name: linear-build-intake
description: "Symmetric counterpart to lisa:jira-build-intake on the Linear side. Scans a Linear team for Issues carrying the configured `ready` build label, claims each by relabeling to the configured `claimed` label, runs the implementation/build flow via lisa:linear-agent, and relabels to the configured `done` label on completion. Enforces the claim-time arm of the `leaf-only-lifecycle` rule: a parent/container with open child work (or a childless Epic/Story/Spike) that still carries a stale build-ready label is skipped or safe-blocked with a lifecycle-repair comment, never claimed. The `ready` label is the human-flipped signal that an Issue is truly ready for development — mirroring how Notion PRDs work Draft → Ready → (us) In Review → Blocked|Ticketed."
allowed-tools: ["Skill", "Bash", "mcp__linear-server__list_teams", "mcp__linear-server__list_issues", "mcp__linear-server__get_issue", "mcp__linear-server__save_issue", "mcp__linear-server__save_comment", "mcp__linear-server__list_issue_labels", "mcp__linear-server__create_issue_label"]
---

# Linear Build Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

1. A Linear team key (e.g. `ENG`) — scans that team for ready Issues.
2. The literal token `linear` — falls back to `linear.teamKey` from `.lisa.config.json`.
3. A pre-built Linear MCP filter (advanced) — used as-is.

Run one build-intake cycle. Each ready Issue is claimed, built via the `lisa:linear-agent` flow, and relabeled to the configured `done` label on completion. The cycle is the symmetric mirror of `lisa:jira-build-intake` and `lisa:github-build-intake`: humans flip the `ready` label, agents pick up and progress.

This skill is the destination of the `lisa:tracker-build-intake` shim when `tracker = "linear"`.

## Workflow resolution

Build-queue label names are read from `.lisa.config.json` `linear.labels.build.*`, falling back to defaults documented in the `config-resolution` rule. Bash pattern:

```bash
# Read role with default fallback. Local overrides global per-key.
read_role() {
  local role="$1" default="$2"
  local local_v global_v
  local_v=$(jq -r ".linear.labels.build.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".linear.labels.build.${role} // empty" .lisa.config.json 2>/dev/null)
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

DONE_TYPE=$(jq -r '.linear.labels.build.done | type' .lisa.config.json 2>/dev/null)
if [ "$DONE_TYPE" = "string" ]; then
  DONE=$(jq -r '.linear.labels.build.done' .lisa.config.json)
elif [ "$DONE_TYPE" = "object" ]; then
  [ -z "$TARGET_ENV" ] && { echo "ERROR: linear.labels.build.done is env-keyed but env not resolvable"; exit 1; }
  DONE=$(jq -r --arg e "$TARGET_ENV" '.linear.labels.build.done[$e] // empty' .lisa.config.json)
  [ -z "$DONE" ] && { echo "ERROR: linear.labels.build.done has no entry for env '$TARGET_ENV'"; exit 1; }
else
  case "$TARGET_ENV" in
    dev) DONE="status:on-dev" ;;
    staging) DONE="status:on-stg" ;;
    production) DONE="status:done" ;;
    *) echo "ERROR: cannot resolve done label without env"; exit 1 ;;
  esac
fi
```

In prose below, the role names refer to the resolved labels: e.g. "the `ready` label" means whatever `linear.labels.build.ready` resolves to (default: `status:ready`).

## Why labels, not native states

Linear's per-team workflow state names vary (`Todo` / `Backlog` / `Up Next` / etc.). Labels are workspace-scoped or team-scoped and stable across teams, so we drive the build queue off labels rather than chasing renamed native states. The native `state` field is informational only for this skill.

## Configuration

Reads `linear.workspace`, `linear.teamKey`, and `linear.labels.build.*` from `.lisa.config.json` (with `.local` override).

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a team key, run the cycle to completion — claim, dispatch each Issue through `lisa:linear-agent`, transition successful builds to `$DONE`, write the summary. The caller (a human or a cron) has already authorized the run by invoking the skill.

Specifically forbidden:

- Previewing projected scope (Issue count, projected PR count, build duration) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip a few / dry-run only" — the documented behavior IS the default.
- Pausing because the queue is large, items look complex, or items are likely to be `status:blocked` by `lisa:linear-agent`'s pre-flight gate. The pre-flight `status:blocked` outcome is a valid terminal state of the per-Issue lifecycle.
- Pausing because the build flow looks expensive.

The only legitimate reasons to stop early:

- Missing team key or required configuration. Surface and exit.
- Label convention not yet adopted (the `ready` label does not exist on the team's labels). Surface and exit with an Adoption hint.
- Empty ready set. Exit cleanly with `"No Linear Issues labeled $READY. Nothing to do."`

## Lifecycle assumed

Linear build queue uses these issue-level labels:

```text
ready → claimed → review → done(env-keyed) (downstream)
(human/PM)    (us claim)    (us PR ready)    (us build done)
```

(Defaults: `status:ready` / `status:in-progress` / `status:code-review` / `status:on-dev`/`status:on-stg`/`status:done`.)

This skill ONLY transitions `$READY → $CLAIMED` on claim, and `$CLAIMED → $DONE` on completion. It never touches `status:done`-as-terminal, `$REVIEW` (owned by `lisa:linear-agent` / `lisa:linear-evidence`), or `status:blocked` (owned by `lisa:linear-agent`'s pre-flight gate).

**Pre-flight check**: at start of each cycle, confirm `$READY`, `$CLAIMED`, and the relevant `$DONE` variants exist on the team via `mcp__linear-server__list_issue_labels`. If `$READY` is missing, stop and report adoption needed. The other labels can be created on demand.

## Phases

### Phase 1 — Resolve scope

1. Parse `$ARGUMENTS`:
   - Bare team key → use as-is.
   - Literal `linear` → fall back to `linear.teamKey` from config.
2. Resolve team ID via `mcp__linear-server__list_teams({query: <teamKey>})`.

### Phase 2 — Find ready Issues

Query: `mcp__linear-server__list_issues({team: <teamId>, label: "$READY"})`.

Capture each Issue's: identifier, title, type label, priority, assignee, project, labels, description summary.

If empty, report `"No Linear Issues labeled $READY. Nothing to do."` and exit. Common idle case.

### Phase 3 — Process each ready Issue (serial)

#### 3a. Leaf-only claim gate (skip / safe-block containers)

Build intake claims **only independently implementable leaf work units**. This enforces the claim-time arm of the vendor-neutral `leaf-only-lifecycle` rule: a parent/container that still carries a stale build-ready label (e.g. `status:ready` applied before this rule existed, or hand-applied to a Project-grouped parent Issue) is **never claimed** — intake skips it or safe-blocks it with a clear lifecycle-repair message. It is the claim-time complement to the write-time labeling in `lisa:linear-write-issue` and the validate-time S15 gate in `lisa:linear-validate-issue`; all three cite the same rule so the classification never drifts. **Never silently implement a container.**

Run this gate **before** the claim relabel, for every candidate Issue. Do NOT relabel, comment "Claimed", or invoke `lisa:linear-agent` for an Issue that fails the gate.

**Resolve container vs. leaf — structural first, then nominal.** Per `leaf-only-lifecycle` the classification is structural: an Issue is a **container** if it has **open** child work, whatever its declared type; otherwise the **type label** decides. Resolve child work using the same hierarchy `lisa:linear-read-issue` uses — Linear's native parentage: an Issue groups **sub-issues** via `parentId`, and a **Project** (the Epic equivalent) groups Issues via `projectId`. Relations (`save_issue_relation` — `blocks` / `is blocked by`) express dependencies and are **not** parentage — do not count them as children.

Fetch the Issue's sub-issues via `mcp__linear-server__get_issue` (which returns the children) or `mcp__linear-server__list_issues({parentId: <issueId>})`, then count those still open (Linear `state.type` not in the completed/canceled set):

```text
# Children of <issueId>: native sub-issues via parentId.
# Count children whose Linear state.type is NOT terminal ("completed" / "canceled").
# A parent whose children are all completed is no longer holding open work and
# rolls up via leaf-only-lifecycle's rollup, not here.
OPEN_CHILDREN = count(list_issues({parentId: <issueId>})
                       where state.type not in {"completed", "canceled"})
```

For a Project-level parent (an Issue that itself anchors a `projectId` grouping rather than a `parentId` tree), resolve membership the same way `lisa:linear-read-issue` does and treat the parent as a container if any grouped Issue is still open. If sub-issue resolution is unavailable, fall back to the parentage `lisa:linear-read-issue` derives and treat the Issue as a container if any derived child is open. Note "sub-issues unavailable — parentage derived" so the operator knows how children were resolved.

Classify and act (first match wins). The type comes from the Issue's `type:` label (`type:Epic`, `type:Story`, `type:Spike`, `type:Bug`, `type:Task`, `type:Sub-task`, `type:Improvement`):

| Condition | Class | Action |
|---|---|---|
| `OPEN_CHILDREN > 0` (open child work, any type) | **Container** | **Skip / safe-block — do NOT claim** |
| no open children AND type ∈ {Epic, Story, Spike} | **Childless container-type** | **Skip / safe-block — do NOT claim** |
| no open children AND type ∈ {Bug, Task, Sub-task, Improvement} (or no `type:` label) | **Leaf work unit** | **Proceed to 3b claim** |

The childless-parent exception is narrow: childlessness enables a claim **only** for types that are leaf work units to begin with. A childless Epic/Story/Spike is an incomplete decomposition, not an implementable unit — it is never claimed.

**Safe-block (default action for a flagged container).** Leave the build-ready label in place (don't silently strip it — that hides the lifecycle error), post a single lifecycle-repair comment, and record the Issue under "Skipped (container)" in the summary. Do NOT relabel to `$CLAIMED`. Keep the comment idempotent — skip posting if an identical `[claude-build-intake]` lifecycle-repair comment already exists on the Issue, so a re-entrant cycle doesn't spam it.

Post via `mcp__linear-server__save_comment` with:

```text
[claude-build-intake] Not claimed: this Issue carries the build-ready label ($READY) but is a container with open child work (or a childless Epic/Story/Spike), which violates the leaf-only-lifecycle rule. Build-ready (status:ready) is leaf-only per leaf-only-lifecycle — an agent claims and implements leaves, never a container. Repair: move $READY off this parent onto its leaf children (or, for a childless Epic/Story/Spike, decompose it into leaf children or reclassify it to a leaf type). A parent's lifecycle state rolls up from its children and is never set to ready directly.
```

This gate never blocks a legitimate flat Task/Bug: those have no open children and a leaf `type:`, so they fall straight through to the claim in 3b.

#### 3b. Claim

Update labels via `mcp__linear-server__save_issue`: remove `$READY`, add `$CLAIMED`. Resolve label IDs via `list_issue_labels` (create `$CLAIMED` if missing).

Post a `[claude-build-intake]` comment via `save_comment`: `"Claimed by Claude. Starting build."`

This is the idempotency lock — a re-entrant cycle's `label: $READY` filter will not see this Issue again.

If the relabel fails (permission, race), record under "Errors" and skip. **Do not invoke the build flow on an Issue you didn't successfully claim.**

#### 3c. Run the build flow

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
- **Blocked by ticket-triage ambiguities** — agent posts findings and stops. The Issue stays at `$CLAIMED`. Surface to human; do not auto-transition. Record under "Errors".
- **Errored** — exception, missing config, etc. Leave at `$CLAIMED`. Record with exception summary.

#### 3d. Relabel to $DONE (only on Success)

If `lisa:linear-agent` returned Success:
1. Resolve `$DONE` for this issue's PR base branch using the Workflow resolution algorithm above. If env can't be resolved and `done` is env-keyed, record an Error and skip this transition — never guess.
2. Update labels via `mcp__linear-server__save_issue`: remove `$CLAIMED` (or `$REVIEW` if `lisa:linear-evidence` already moved it forward), add `$DONE`.
3. Post a `[claude-build-intake]` comment: `"Build complete. PR <URL>. Transitioned to $DONE."`

For any non-Success outcome, do NOT transition. The Issue sits where the agent left it — humans take it from there.

#### 3e. Continue

Move to the next ready Issue. One Issue failing does not stop others.

### Phase 4 — Summary report

```text
## linear-build-intake summary

Team: <teamKey>
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

Issues processed: <n>
- $DONE (build complete, PR ready): <n>
  - <ID> <title> → PR <URL>
- Skipped (container — leaf-only-lifecycle): <n>
  - <ID> <title> — build-ready on a parent with open child work; lifecycle-repair comment posted
- status:blocked (pre-flight verify failed): <n>
  - <ID> <title> — see Issue comments
- Held (triage found ambiguities): <n>
  - <ID> <title> — see Issue comments
- Errors: <n>
  - <ID> <title> — <reason>

Total PRs opened: <n>
```

## Idempotency & safety

- **Leaf-only claim gate runs first**: Phase 3a classifies each candidate before any claim; a container with open child work (or a childless Epic/Story/Spike) is skipped/safe-blocked, never claimed (the `leaf-only-lifecycle` rule's claim-time arm). The safe-block comment is idempotent — a re-entrant cycle does not re-post it.
- **Claim-first ordering**: `$CLAIMED` set BEFORE agent invocation — no double-pickup.
- **No writes outside the lifecycle**: this skill only adds/removes `$READY`, `$CLAIMED`, `$DONE`. Every other label change (and the native state) is owned by the agent or `lisa:linear-evidence`.
- **Failure isolation**: per-Issue exceptions caught and recorded; the cycle continues.
- **Single cycle per team**: do not run two concurrent cycles against the same team — concurrent claims could race.
- **Single-label invariant**: after every transition, verify exactly one `status:*` label is present. Two simultaneously breaks the build queue.
- **Never pick an arbitrary env for `$DONE`**. If `done` is a map and env is ambiguous, fail loudly.

## Adoption (one-time per team)

Before this skill can run against a Linear team, the team must adopt the build-queue label convention. Using the defaults:

1. Create labels `status:ready`, `status:in-progress`, `status:code-review`, `status:on-dev`, `status:done`, `status:blocked` on the team (or workspace). If your project overrides any `linear.labels.build.*` role name in config, substitute the actual label names you configured.
2. Apply the `$READY` label to Issues that are ready for development.
3. Reserve `$CLAIMED`, `$REVIEW`, `$DONE` for Lisa — humans should not set them manually except to recover from an error.

If the team hasn't adopted these labels, the first run exits with an adoption hint.

## Rules

- **Claim leaves only.** Per the `leaf-only-lifecycle` rule, never claim a container — an Issue with open child work, or a childless Epic/Story/Spike — even if it carries the build-ready label. Skip or safe-block it (Phase 3a); never silently implement a container.
- Never relabel an Issue the cycle didn't claim. The `$CLAIMED` transition is the signature of cycle ownership.
- Never bypass `lisa:linear-agent` to do build work directly. The agent owns the per-Issue lifecycle.
- Never auto-transition past `$DONE`. Downstream labels are owned by QA / product / a future verification-intake skill.
- If the Issue has no Validation Journey or no sign-in credentials in its description, `lisa:linear-agent`'s pre-flight verify will catch it and relabel to `status:blocked` — don't try to fix the Issue from here.
- On any unexpected response from `lisa:linear-agent` (label it doesn't claim, missing PR URL on success, etc.), record as Error and surface — never assume.
- Never pick an arbitrary env for `$DONE` resolution. If `done` is a map and env is ambiguous, fail loudly.
