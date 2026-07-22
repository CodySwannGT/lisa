---
name: lisa-github-build-intake
description: "GitHub counterpart to lisa-jira-build-intake. Scans a GitHub repository for issues carrying the configured `ready` build label, processes the first eligible issue, runs leaf work via the github-agent workflow in-session (culminating in lisa-implement), relabels to the configured `done` label on completion, then exits. Enforces the claim-time arm of the `leaf-only-lifecycle` rule: a parent/container with open child work (or a childless Epic) that still carries a stale build-ready label is moved out of the ready pickup queue into the configured `claimed` label with a lifecycle-repair comment, never dispatched to the build lifecycle. The `ready` label is the human-flipped signal that an issue is truly ready for direct development pickup — mirroring how Notion PRDs work product Draft → Ready → (us) In Review → Blocked|Ticketed."
allowed-tools: ["Skill", "Bash"]
---

# GitHub Build Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

1. A GitHub `org/repo` token (e.g., `acme/frontend-v2`).
2. A full GitHub repo URL (e.g., `https://github.com/acme/frontend-v2`).
3. The literal token `github` (or an omitted repo) — resolves merged config
   `github.queueRepo`, falling back to the identity `github.org/github.repo`.

An explicit `org/repo` token or GitHub URL always wins. `github.queueRepo` may be canonical
`owner/repo` or a short repo name normalized to `github.org`. It changes only the scanned queue;
the Phase 3a.0 `repo:<current>` gate still resolves the code repository from `repo` /
`github.repo` / the git remote.

Run one build-intake cycle. The first eligible issue in the configured `ready` build label is claimed, built via the `github-agent` workflow run in-session (Phase 3c, culminating in `lisa-implement`), relabeled to the configured `done` label (env-aware — see Workflow resolution), then the cycle exits. Remaining ready issues stay queued for later scheduler invocations.

This skill also accepts an optional `assignee=<github-login>` queue filter. Resolve it in this
order:

1. `$ARGUMENTS` `assignee=<login>`
2. `.lisa.config.local.json` `intake.assignee`
3. empty default

When the resolved assignee is empty, scan the shared ready queue exactly as before. When it is
non-empty, filter the ready-item query to issues already assigned to that login. This filter is
selection-only: never assign or reassign issues as part of build intake.

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

read_intake_assignee() {
  local cli_value local_v
  cli_value=$(printf '%s\n' "$ARGUMENTS" | sed -n 's/.*assignee=\([^[:space:]]*\).*/\1/p' | head -1)
  local_v=$(jq -r '.intake.assignee // empty' .lisa.config.local.json 2>/dev/null)
  echo "${cli_value:-${local_v:-}}"
}

ASSIGNEE=$(read_intake_assignee)
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
  DONE_LABELS_JSON=$(jq -c '[.github.labels.build.done]' .lisa.config.json)
elif [ "$DONE_TYPE" = "object" ]; then
  [ -z "$TARGET_ENV" ] && { echo "ERROR: github.labels.build.done is env-keyed but env not resolvable"; exit 1; }
  DONE=$(jq -r --arg e "$TARGET_ENV" '.github.labels.build.done[$e] // empty' .lisa.config.json)
  [ -z "$DONE" ] && { echo "ERROR: github.labels.build.done has no entry for env '$TARGET_ENV'"; exit 1; }
  DONE_LABELS_JSON=$(jq -c '[.github.labels.build.done[]]' .lisa.config.json)
else
  case "$TARGET_ENV" in
    dev) DONE="status:on-dev" ;;
    staging) DONE="status:on-stg" ;;
    production) DONE="status:done" ;;
    *) echo "ERROR: cannot resolve done label without env"; exit 1 ;;
  esac
  DONE_LABELS_JSON=$(jq -cn --arg d "$DONE" '[$d]')
fi
```

In prose below, the role names refer to the resolved labels: e.g. "the `ready` label" means whatever `github.labels.build.ready` resolves to (default: `status:ready`).

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a repo, run the cycle to completion — claim and dispatch the first eligible issue through the in-session lifecycle (Phase 3c), relabel a successful build to `$DONE`, write the summary, and exit. The caller (a human or a cron) has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background queue.

Specifically forbidden:

- Previewing projected scope (issue count, projected PR count, build duration) and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip a few / dry-run only".
- Pausing because the queue is large, issues look complex, or issues are likely to be `Blocked` by the pre-flight gate. Pre-flight `Blocked` is a valid terminal state of the per-issue lifecycle, not a failure mode.
- Pausing because the build flow looks expensive.

The only legitimate reasons to stop early:

- Missing repo or required configuration. Surface the missing value and exit.
- Label namespace not adopted (no issue carries any of `$READY` / `$CLAIMED` / `$DONE`). Surface a label-convention error and exit (this is setup, not a normal idle cycle — see "Adoption" at the bottom).
- Empty ready set. Exit cleanly with `"No GitHub issues labeled $READY in <org>/<repo>. Nothing to do."`

## Lifecycle assumed

The GitHub Issues build lifecycle uses **labels** (we deliberately do NOT key off open/closed alone — closed issues aren't always the right post-build state):

```text
ready → claimed → done(env-keyed)
(human)  (us claim)  (us done; PR ready)
```

(Defaults: `status:ready` / `status:in-progress` / `status:on-dev`/`status:on-stg`/`status:done`.)

This skill ONLY transitions:

- `$READY` → `$CLAIMED` (claim)
- `$CLAIMED` → `$DONE` (build complete, PR ready)

A "transition" means: remove the old role label and add the new one, in two `gh issue edit` calls (`--remove-label` + `--add-label`) or one combined call. The skill MUST verify exactly one build-lifecycle label (from the resolved `$READY`/`$CLAIMED`/`$DONE` set) is present after the update — having two simultaneously breaks idempotency.

**Pre-flight check**: at the start of each cycle, confirm at least one of the resolved role labels (`$READY`, `$CLAIMED`, or any `$DONE` value) exists on the repo via `gh label list --repo <org>/<repo> --json name`. If none exist, the convention has not been adopted — surface the label-convention error and exit.

## Phases

### Phase 1 — Resolve the repo

1. Parse `$ARGUMENTS`:
   - `org/repo` token → use as-is.
   - GitHub URL → extract `org` and `repo`.
   - Literal `github` or omitted repo → resolve local then global `github.queueRepo`, falling back
     to `github.org/github.repo`; normalize a short `queueRepo` to `github.org`; error if the
     resulting identity/queue cannot be resolved.
   - Never replace current-repo identity with the queue repo. An umbrella queue is only a scan target.
2. Confirm `gh auth status` succeeds.
3. Confirm the repo is reachable: `gh repo view <org>/<repo> --json name --jq '.name'`.

### Phase 2 — Find ready issues

```bash
if [ -n "$ASSIGNEE" ]; then
  gh issue list --repo <org>/<repo> --label "$READY" --assignee "$ASSIGNEE" --state open \
    --json number,title,labels,assignees,milestone,createdAt --limit 100
else
  gh issue list --repo <org>/<repo> --label "$READY" --state open \
    --json number,title,labels,assignees,milestone,createdAt --limit 100
fi
```

If empty, run a secondary check to distinguish a genuinely empty queue from an unconfigured repo:

```bash
gh label list --repo <org>/<repo> --json name \
  | jq -r --arg r "$READY" --arg c "$CLAIMED" --argjson d "$DONE_LABELS_JSON" \
      '[.[] | .name | select(. == $r or . == $c or (. as $n | $d | index($n)))] | length'
```

If none of the configured role labels exist on the repo → label convention not adopted, surface a setup error and exit. If the role labels exist but none are `$READY` on any open issue matching the resolved assignee filter (or any open issue when the filter is empty) → genuinely empty queue, exit cleanly with `"No GitHub issues labeled $READY. Nothing to do."`

### Phase 3 — Process the first eligible ready issue

#### 3a.0 Repo-scope gate (claim only current-repo issues)

GitHub Issues live in one repo by definition, so the scanned repo's issues are usually inherently current-repo. But a planning/umbrella repo's issues can target sibling repos, so this skill still claims only issues for the repo it is running in. Run this gate **before** the leaf-only gate (3a) and the claim (3b), per the `repo-scope-split` rule's "Claim-time repo scoping" section (cite it by slug; do not restate its decision table).

1. **Resolve the current repo** per `config-resolution` "Repo scoping" (`.repo` → `.github.repo` → `git remote get-url origin` basename). If unresolvable, stop and report.
2. **Cheap path first.** Prefer candidates already carrying the `repo:<current>` label. Keep the Phase 2 scan broad so unlabeled issues are still seen, determined, and stamped.
3. **Per candidate, apply the repo-scope decision (`repo-scope-split`):**
   - Carries `repo:<other>` → **skip** (leave it `ready` for that repo's own intake); next candidate.
   - **Unlabeled** → determine the target repo(s) from the issue + code surfaces, then **stamp** `repo:<name>` via `gh issue edit <n> --add-label "repo:<name>"` (create the label lazily) so later cycles filter cheaply; re-apply with the now-known repo. (An issue whose work is entirely in the scanned repo is simply labeled `repo:<current>`.)
   - **Container visibility is allowed.** A multi-repo Epic / Story / Spike may legitimately carry multiple `repo:<name>` labels for operator visibility. Do not split or claim it here; leave the repo markers intact and fall through to the leaf-only gate, which repairs the stale build-ready label instead of dispatching the container.
   - **Multi-repo leaf → split, never claim.** Run the `repo-scope-split` work-time procedure into single-repo siblings, each created **build-ready** (`build_ready: true`) and stamped with its own `repo:<name>`; the current repo's sibling becomes a normal candidate.
   - **Single-repo leaf for the current repo** → fall through to 3a (leaf-only gate) and 3b (claim).
4. Continue until a claimable current-repo leaf is found (claim it; one per cycle) or the ready set is exhausted — exit cleanly with `"No ready issues for repo <current>. Nothing to do."`.

#### 3a. Leaf-only claim gate (repair containers)

Build intake dispatches **only independently implementable leaf work units** to the build agent. This enforces the claim-time arm of the vendor-neutral `leaf-only-lifecycle` rule: a parent/container that still carries a stale build-ready role (e.g. `status:ready` applied before this rule existed, or hand-applied to an Epic/Story) is **never dispatched** — intake moves it out of the pickup queue by replacing `$READY` with `$CLAIMED`, then posts a clear lifecycle-repair message. It is the claim-time complement to the write-time labeling in `lisa-github-write-issue` and the validate-time S15 gate in `lisa-github-validate-issue`; all three cite the same rule so the classification never drifts. **Never silently implement a container.**

Run this gate **before** the leaf claim relabel, starting with the oldest/highest-priority ready candidate. Do NOT comment "Claimed" or dispatch the lifecycle for an issue that fails the gate. A container repair still changes labels: remove `$READY`, add `$CLAIMED`, explain that parent/container `$CLAIMED` means rollup/build-lane progress through child/leaf work rather than direct implementation, record it, and end the cycle.

**Resolve container vs. leaf — structural first, then nominal.** Per `leaf-only-lifecycle` the classification is structural: an issue is a **container** if it has **open** child work, whatever its declared type; otherwise the **type label** decides. Resolve child work using the same hierarchy `lisa-github-read-issue` uses — native sub-issues first, then body parentage (task-list checkboxes referencing other issues, `Parent: #<n>` references). Dependency links such as `Blocked by:` are not parentage; they are handled by the active dependency hold gate below.

```bash
# Native sub-issues via GraphQL (same query lisa-github-read-issue uses).
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
# holding open work and rolls up via lisa-github-read-issue's rollup, not here.
OPEN_CHILDREN=$(echo "$SUBS" | jq -r '[.data.repository.issue.subIssues.nodes[]? | select(.state == "OPEN")] | length' 2>/dev/null)
OPEN_CHILDREN=${OPEN_CHILDREN:-0}
```

If the GraphQL `subIssues` field is unavailable (older GHES), fall back to parsing the body for child references exactly as `lisa-github-read-issue` does, and treat the issue as a container if any referenced child issue is open. Note "GraphQL sub-issues unavailable" so the operator knows parentage was text-derived.

Classify and act (first match wins). `type:` is read from the issue's labels (`type:Epic`, `type:Story`, `type:Spike`, `type:Bug`, `type:Task`, `type:Sub-task`, `type:Improvement`):

| Condition | Class | Action |
|---|---|---|
| `OPEN_CHILDREN > 0` (open child work, any type) | **Container** | **Move to `$CLAIMED` as lifecycle repair — do NOT dispatch** |
| no open children AND `type = Epic` | **Childless Epic (pure rollup container)** | **Move to `$CLAIMED` as lifecycle repair — do NOT dispatch** |
| no open children AND `type ≠ Epic` (Bug, Task, Sub-task, Improvement, Story, Spike, or no `type:` label) | **Leaf work unit** | **Proceed to 3b claim** |

The childless-parent exception promotes every childless type **except Epic** to a dispatchable leaf: a childless Story is a directly shippable increment and a childless Spike *is* the investigation unit, so neither is stranded. Only a childless **Epic** is held back — an Epic is a pure rollup container by design, and a childless one is an incomplete decomposition or a mis-applied role, moved out of the ready pickup queue for repair/rollup and never dispatched.

**Lifecycle repair (default action for a flagged container).** Move the issue out of the pickup queue by removing `$READY` and adding `$CLAIMED`, post a single lifecycle-repair comment, and record the issue under "Repaired (container)" in the summary. Do NOT dispatch the lifecycle. Keep the comment idempotent — skip posting if an identical `[claude-build-intake]` lifecycle-repair comment already exists on the issue, so a re-entrant cycle doesn't spam it.

```bash
gh issue edit <number> --repo <org>/<repo> --remove-label "$READY" --add-label "$CLAIMED"
gh issue comment <number> --repo <org>/<repo> --body "[claude-build-intake] Lifecycle repair: this issue carried the build-ready role ($READY) but is a parent/container with open child work (or a childless Epic). I moved it to $CLAIMED without invoking the build agent. For parent/container issues, $CLAIMED means rollup/build-lane progress through child/leaf work; direct implementation must happen on leaf issues. Build-ready is leaf-only per leaf-only-lifecycle — move $READY onto its leaf children, or decompose/reclassify a childless Epic."
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

A blocker is active if it is open and has no cleared status label. Treat `status:ready`, `status:in-progress`, missing status labels, and inaccessible blockers as active. Closed blockers are cleared. If any blocker is active, skip the candidate without changing lifecycle labels, without posting "Claimed", and without dispatching the lifecycle. Record it under "Skipped (active blockers)" in the summary and include the active blocker refs. Keep any dependency-hold comment idempotent with a `[claude-build-intake]` prefix.

#### 3b. Claim

**Rejection detection runs first — before the relabel below.** Per the vendor-neutral `rejection-detection` rule (cite the slug; do not restate its classification table), classify this item at the **top of 3b, BEFORE** the `$READY → $CLAIMED` relabel — after the relabel the current-lane signal is gone. Read the item's Label-Event History from `lisa-github-read-issue` (chronological `LabeledEvent` / `UnlabeledEvent` on the configured `$READY` label) and classify it `rejection-reclaim | forward-only | never-left-ready | unknown`. Lane names come from `.lisa.config.json` (`github.labels.build.*`), never hardcoded. A failing/absent history yields `unknown` and the claim proceeds — detection never blocks the build. Items carrying a learning marker (`[lisa-learning-drop]` / `[lisa-learning-pr]` / `[lisa-learning-upstream-handoff]`) or the `learning:needs-triage` label are never rejection triggers (no learning-about-learning). Carry the classification into the relabel and lifecycle below.

**On `rejection-reclaim`, reflect before re-implementing** (per `rejection-detection`): read the rejection evidence through the access layer — the issue comments posted after the backward transition (the QA rejection comment) and the review threads on the rejected PR via `lisa-github-read-issue` — assemble ONE candidate learning (rule, why, provenance linking the rejection comment + rejected PR, evidence links, scope hint, triggering issue, fingerprint `sll4-sha1(rule\ntriggering_issue)[:12]`), and route it to the `lisa-persist-learning` skill. If that skill is absent, record the candidate as a comment carrying a **visible prose line plus** the marker (a bare marker renders as an empty bubble) — `Recorded a candidate learning from this rejection (queued for the judgment gate): <one-line candidate rule>.` then `<!-- [lisa-rejection-candidate] key=<issue>-<transition-ts> -->` — and proceed. Dedupe on `<issue>-<backward-transition-timestamp>` — a second re-claim produces no duplicate. Unreadable/absent evidence → no candidate, still implement.

**Claim-time archaeology runs second — after rejection detection, still before the relabel below.** Classify this item per the vendor-neutral `claim-archaeology` rule, with the rejection classification above as its input. All shared semantics — ancestry signals, classification, learning-loop exclusion, cost budget, candidate derivation, marker dedupe, and the never-block degrade — live in that one slug; change them there, never here. GitHub wiring only: the typed relations and `closingIssuesReferences` are already in the read bundle; text-similarity searches use `gh search issues` over recently-closed issues; the fallback candidate comment is posted with `gh issue comment`.

```bash
gh issue edit <number> --repo <org>/<repo> --remove-label "$READY" --add-label "$CLAIMED"
# Assign to the authenticated user ONLY when the issue is currently unassigned (attributable claim;
# do not pile a second assignee onto an issue that already has an owner):
gh issue view <number> --repo <org>/<repo> --json assignees -q '.assignees | length' # → if 0:
gh issue edit <number> --repo <org>/<repo> --add-assignee "@me"
gh issue comment <number> --repo <org>/<repo> --body "[claude-build-intake] Claimed by Claude. Starting build."
```

This is the idempotency lock — a re-entrant cycle's `--label $READY` filter will not see this issue again.

If the relabel fails (permission, race), log under "Errors" in the cycle summary and skip this issue. **Do not invoke the build flow on an issue you didn't successfully claim.**

#### 3c. Run the per-issue lifecycle in-session (never as a subagent)

After the claim succeeds, run the per-issue lifecycle defined by the `github-agent` workflow **in the current session** — never by spawning `github-agent` (or any named worker) via the `Agent` tool. The lifecycle culminates in a team-first flow (`lisa-implement`), and that flow can only create its agent team from the lead session: a spawned teammate cannot add named teammates (Claude teams are flat), so dispatching the build into a subagent strands `lisa-implement` without its team and collapses the build into a single inline worker. Concretely:

1. **Run the gates in-session** via their skills, exactly as `github-agent.md` defines them and with all of its gating behaviors intact:
   - `lisa-github-read-issue` — the full issue graph (mandatory; never ad-hoc `gh` reads)
   - `lisa-github-verify` — pre-flight quality gate, including the draft-then-block procedure on FAIL
   - `lisa-ticket-triage` — analytical triage gate (a `BLOCKED` verdict stops the cycle with findings posted)
   - Intent determination from the `type:` label
2. **Dispatch the flow in-session:** when the gates pass, invoke the lifecycle skill via the Skill tool — `lisa-implement <org>/<repo>#<number>` for Build / Fix / Improve / Investigate-Only (or `lisa-plan` for an Epic) — passing the full context bundle from the read step. **When 3b classified this item `rejection-reclaim`, the context bundle passed to `lisa-implement` MUST include the rejection evidence summary** (what was rejected, the defect the QA comment named, the approach named as wrong) — reuse the evidence already read in 3b, do not fetch it twice — so the plan can address it per `rejection-detection`; absence of evidence never blocks. `lisa-implement`'s own orchestration preamble then creates the per-item agent team (input-resolver, Roster Decision, specialist fanout) exactly as a direct invocation would.
3. **Milestone sync and evidence** (`lisa-github-sync`, `lisa-github-evidence`) happen at the milestones the `github-agent` workflow defines, within the dispatched flow.

If you are somehow running this skill as a spawned teammate inside an existing team (nested misrouting — Intake keeps this chain in the lead session), do NOT run the lifecycle inline and do NOT spawn named peers. Return this payload to the lead so the lead session can run this Phase 3c in-session:

```json
{
  "type": "delegation-request",
  "phase": "github-build-intake 3c",
  "workItem": "<org>/<repo>#<number>",
  "context": {
    "claimedLabel": "$CLAIMED",
    "doneResolution": "Resolve $DONE from the PR base branch per this skill's Workflow resolution section"
  },
  "onSuccess": "Confirm the returned PR is merged, then apply Phase 3d and Phase 3d.1",
  "onBlockedOrError": "Leave the issue where the lifecycle left it and record the surfaced outcome"
}
```

The lifecycle run returns one of the following outcomes; resume this scanner with it:

- **Success** — the build flow completed and a PR exists; evidence posted. The PR may already be **merged** or still **open** (auto-merge enabled, awaiting checks/merge). "Success" means the build work is sound — it does **not** assert the change reached an environment. The env transition in 3d gates on the PR actually being merged; an open PR does not advance the issue to a `done` env status.
- **Blocked by github-verify pre-flight gate** — the pre-flight gate (github-agent workflow step 2) relabels the issue to `status:blocked` (or removes `$CLAIMED` and reassigns to the original author). This is correct and expected — let it stand. Record and move on.
- **Duplicate already fixed** — `lisa-ticket-triage` returned `DUPLICATE_ALREADY_FIXED` with a canonical issue reference and empirical base-branch evidence. Post the triage finding, ensure the native `duplicates <canonical>` relationship exists when GitHub exposes it (otherwise leave an explicit cross-reference comment/body link), remove `$CLAIMED`, add the terminal `$DONE` label, close the issue with `gh issue close --reason "not planned"`, and do not open a PR. If the canonical fix is merged but not yet on the production branch, the close comment must say the production error can recur until the canonical issue promotes and that recurrence is tracked by the canonical issue; do not reopen this duplicate for that recurrence.
- **Blocked by ticket-triage ambiguities** — triage posts findings and the lifecycle stops. The issue stays in `$CLAIMED`. Surface to human; do not auto-relabel. Record under "Errors".
- **Errored** — exception, missing config, etc. Leave the issue in `$CLAIMED` for human investigation. Record under "Errors".

#### 3c.1 Close duplicate already fixed

Run this only when the returned triage verdict is exactly `DUPLICATE_ALREADY_FIXED`.

1. Verify the structured result includes a canonical issue reference, the canonical PR/commit, and empirical evidence that the canonical fix is present on the base branch. If any piece is missing, treat the outcome as Held instead of closing.
2. Post or preserve the triage-finding comment that explains why this issue is a duplicate and names the canonical issue.
3. Ensure a native `duplicates <canonical>` link exists when GitHub exposes issue relationships; if this installation cannot create that relationship, leave an explicit issue cross-reference comment/body link and record the limitation in the summary.
4. Resolve terminal `$DONE` exactly as in Phase 3d. For a single-env repo, `$DONE` is terminal; for env-keyed config, only the production/final value is terminal.
5. Replace `$CLAIMED` with `$DONE`, then close the issue as duplicate/not-planned:

```bash
gh issue edit <number> --repo <org>/<repo> --remove-label "$CLAIMED" --add-label "$DONE"
gh issue comment <number> --repo <org>/<repo> --body "[claude-build-intake] Closed as duplicate of <canonical>. Canonical fix: <PR-or-commit>. Evidence: <base-branch-proof>."
gh issue close <number> --repo <org>/<repo> --reason "not planned"
```

If the canonical fix is merged but not yet present on the production branch, append the production-promotion caveat to the close comment: the production error can recur until the canonical issue promotes, and recurrence is tracked by the canonical issue rather than by reopening this duplicate.

This path is distinct from `BLOCKED`: ambiguity, open blockers, and duplicate-of-open findings remain held for human action and must not be auto-closed.

#### 3c.2 Confirm applied learnings (last_confirmed bump)

Run this at the end of 3c, after the lifecycle outcome is recorded and before 3d. It keeps the decay pass safe: a genuinely useful learning that keeps applying stays fresh, while dead weight ages out.

1. **Identify which learnings demonstrably applied.** Resolve the learnings surface with `resolveProjectLearningsFile` and parse it with `parseLearningsFile` from `@codyswann/lisa/learnings` (never hardcode the path; a missing file skips this step silently). An entry counts as applied ONLY when its rule was explicitly cited or observably followed in this claim's plan, diff, or review responses — the plan quotes the rule or its id, or the diff does specifically what the rule mandates where the default behavior would have differed. **Presence in context is NOT application**: entries reach a session only through the contract's bounded projection, so counting "it was projected" would confirm every projected entry on every claim and defeat decay entirely. A run that produced no plan or diff has nothing to confirm.
2. **Bump each applied entry exactly once** via the surgical writer:

   ```bash
   node -e 'import("@codyswann/lisa/learnings").then(async m => { const r = await m.confirmLearningEntry(process.cwd(), process.argv[1], new Date().toISOString().slice(0, 10)); console.log(JSON.stringify(r)); }).catch(error => { console.log(JSON.stringify({ status: "error", id: process.argv[1], message: String(error) })); })' <entry-id> || true
   ```

   The invocation is failure-safe by construction: a rejected import or write resolves to a structured `error` result instead of a crash, and the trailing `|| true` absorbs any remaining non-zero exit (missing `node`, unresolvable package). Record an `error` or non-zero outcome in the cycle summary and continue — the bump must never abort the lifecycle.

   `confirmLearningEntry` advances ONLY `last_confirmed` — rule text, why, provenance, `first_learned`, and confidence are untouched — and is idempotent within a claim: a repeat same-date bump returns `unchanged`, so an entry that applied repeatedly during one claim is bumped once, not once per application.
3. **Never block on it.** A failed bump, an unwritable file, or a `not-found` result (the entry was pruned) is recorded under the cycle summary and the claim proceeds — shipping the issue always outranks confirming a learning about it.

#### 3d. Transition to $DONE (only after the PR is merged)

A `done` env state (`status:on-dev`, `status:on-stg`, or the terminal value) asserts that the code has actually reached that environment. Never set it for a PR that is merely open: auto-merge can be blocked indefinitely (a required rebase / `BEHIND` branch, failing checks, an unaddressed review), and the change may never land. Relabeling an issue `status:on-stg` on an open PR makes it *claim* a deploy that never happened. Transition only after confirming the PR merged.

If the lifecycle run returned Success:

1. **Confirm the PR merged.** Read the live state of the issue's PR — `gh pr view <pr> --json state,mergedAt,mergeStateStatus,url`:
   - **Merged** (`state == MERGED`) → proceed to resolve and apply `$DONE` below. Where the env deploy is observable (a deploy workflow run / deployment status keyed to the merged-into branch via `deploy.branches`), confirm it did not fail before relabeling; a still-running deploy is treated like an open PR (leave in `$CLAIMED`), a failed deploy is recorded as an Error.
   - **Open / not yet merged** → do **not** transition. The build is sound but the change has reached no environment yet. Record the issue under **"PR open — awaiting merge"** in the summary (with the PR URL and its `mergeStateStatus`), leave it in `$CLAIMED`, and stop. A later `lisa-repair-intake` cycle drives the open PR to merge — re-syncing a `BEHIND` branch so the already-enabled auto-merge can land, or surfacing a real blocker — and, once merged, applies this same env transition. Do **not** comment "Build complete" or close anything.
   - **Closed without merging** → record an Error (the PR was abandoned unmerged); leave the issue in `$CLAIMED`.
2. Resolve `$DONE` for this issue's PR base branch using the Workflow resolution algorithm above. If env can't be resolved and `done` is env-keyed, record an Error and skip this transition — never guess.
3. Determine whether `$DONE` is the true terminal done value per the `leaf-only-lifecycle` rule's Terminal native closure section:
   - If `github.labels.build.done` is a string, that string is terminal.
   - If `github.labels.build.done` is an object, only the production/final environment value is terminal (default: `status:done`). Intermediate env values such as `status:on-dev` and `status:on-stg` are not terminal and must stay open.
   - If the project uses a different final environment name, resolve it from the configured deployment topology; if ambiguous, record an Error and do not close.

```bash
gh issue edit <number> --repo <org>/<repo> --remove-label "$CLAIMED" --add-label "$DONE"
gh issue comment <number> --repo <org>/<repo> --body "[claude-build-intake] Build complete. PR <URL> merged. Transitioned to $DONE."
```

If `$DONE` is terminal, immediately close the native GitHub issue:

```bash
gh issue close <number> --repo <org>/<repo> --reason completed
```

This close is idempotent: if the issue is already closed, record that native closure was already satisfied and continue. If `$DONE` is an intermediate env state, leave the issue open by design.

For any non-Success outcome, do NOT transition. The issue sits in `$CLAIMED` (or wherever the lifecycle left it) — humans take it from there.

#### 3d.1 Roll up the parent chain (forward rollup)

Run this **only after a successful `$DONE` transition in 3d** (the leaf actually reached an env — intermediate or terminal). This is the **forward** arm of the `leaf-only-lifecycle` rule's *"rollup is evaluated whenever a child transitions"* requirement: a leaf reaching `$DONE` is exactly such a transition, so its parent's derived state may now have changed — the last open child of a Story just shipped, so the Story rolls up to `$DONE` and closes, which may in turn complete its Epic. Without this step a fully-built parent stays open until the recovery `lisa-repair-intake` cron happens to run.

1. Resolve the leaf's parent using the same hierarchy `lisa-github-read-issue` uses — native sub-issue parent first (GraphQL `parent`), then body parentage (`Parent: #<n>` / `Parent Epic: #<n>`). If the leaf has no parent, skip — nothing to roll up.
2. Walk **up the ancestor chain bottom-up**: for the immediate parent, then its parent, and so on, invoke `lisa-github-sync <org>/<repo>#<ancestor> --rollup`. That skill derives the ancestor's `status:*` from its children per `leaf-only-lifecycle`, applies it only when it differs (never `status:ready`), and performs terminal native closure (`gh issue close --reason completed`) when the derived env is the production/terminal `$DONE`. It is idempotent and safe-defaults (suggests, does not guess) when the rolled state is ambiguous.
3. Stop walking up when an ancestor has no parent, or when `--rollup` reports no change (a higher ancestor cannot advance past an unchanged child). Record each rolled-up ancestor and its derived state in the summary.

This does not re-implement the state machine — it delegates to `lisa-github-sync --rollup`, the single rollup implementation `lisa-repair-intake` also uses, so the forward and recovery paths can never drift. Children closed **outside** this flow (e.g. by external automation) are not observed here; `lisa-repair-intake` remains the recovery net for those.

#### 3e. Stop

Stop immediately after the first claimed, skipped, blocked, held, or errored issue. Later scheduler invocations process the remaining ready issues.

### Phase 4 — Summary report

```text
## github-build-intake summary

Repo: <org>/<repo>
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

Issues processed: <n>
- $DONE (build complete, PR merged): <n>
  - <org>/<repo>#<number> <title> → PR <URL>
- PR open — awaiting merge (left in $CLAIMED for repair-intake): <n>
  - <org>/<repo>#<number> <title> → PR <URL> (mergeStateStatus: <state>)
- Repaired (container — leaf-only-lifecycle): <n>
  - <org>/<repo>#<number> <title> — build-ready on a parent/container; moved $READY → $CLAIMED without dispatching the lifecycle; lifecycle-repair comment posted
- Skipped (active blockers): <n>
  - <org>/<repo>#<number> <title> — waiting on <blocker refs>
- Duplicate already fixed (closed as duplicate): <n>
  - <org>/<repo>#<number> <title> — duplicate of <canonical>; no PR opened
- Blocked (pre-flight verify failed): <n>
  - <org>/<repo>#<number> <title> — see issue comments
- Held (triage found ambiguities): <n>
  - <org>/<repo>#<number> <title> — see issue comments
- Errors: <n>
  - <org>/<repo>#<number> <title> — <reason>

Total PRs opened: <n>
```

## Idempotency & safety

- **Leaf-only claim gate runs first**: Phase 3a classifies each candidate before any leaf claim; a container with open child work (or a childless Epic) is moved `$READY` → `$CLAIMED` as lifecycle repair and never dispatched. The lifecycle-repair comment is idempotent — a re-entrant cycle does not re-post it.
- **Dependency hold runs before leaf claim**: explicit `Blocked by:` relationships are resolved after container repair is ruled out but before `$READY → $CLAIMED`; active blockers leave the leaf candidate in `$READY` and are reported as skipped, not blocked.
- **Claim-first ordering**: `$CLAIMED` set BEFORE the lifecycle dispatch for leaves; containers are also moved to `$CLAIMED` to leave the ready pickup queue, but are not dispatched.
- **No writes outside the lifecycle**: this skill only relabels `$READY → $CLAIMED` and `$CLAIMED → $DONE`. For containers, `$READY → $CLAIMED` is a lifecycle repair, not a direct build claim. Every other label change is owned by the per-issue lifecycle (github-agent workflow).
- **Duplicate terminal exception**: `DUPLICATE_ALREADY_FIXED` is the only triage outcome that may close a claimed item without a PR from this cycle. It must include a canonical issue reference and empirical base-branch evidence, and it closes as duplicate/not-planned rather than as completed build work.
- **Terminal native closure**: after `$CLAIMED → $DONE`, close the GitHub issue only when `$DONE` is the true terminal done value per `leaf-only-lifecycle`; intermediate env labels stay open.
- **One item per cycle**: per-issue exceptions are caught and recorded, then the cycle exits. The scheduler owns retrying or moving on to the next ready item.
- **Single cycle per repo**: do not run two `lisa-github-build-intake` cycles in parallel against the same repo — concurrent claims could race. The scheduling layer is responsible for serialization.
- **Single-label invariant**: after every transition, verify exactly one `status:*` label is present on the issue. If two are present (rare race), surface as an Error and skip — do NOT auto-resolve.
- **Never pick an arbitrary env for `$DONE`**. If `done` is a map and env is ambiguous, fail loudly.

## Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `.lisa.config.json` `github.org` | (from `$ARGUMENTS`) | GitHub org for the default queue |
| `.lisa.config.json` `github.repo` | (from `$ARGUMENTS`) | Current code-repo identity and `repo:<current>` scope |
| `.lisa.config.json` `github.queueRepo` | `github.org/github.repo` | Default GitHub scan repo when no explicit repo/URL is passed |
| `.lisa.config.json` `github.labels.build.ready` | `status:ready` | The label that signals "human says this is buildable" |
| `.lisa.config.json` `github.labels.build.claimed` | `status:in-progress` | The label set on pickup |
| `.lisa.config.json` `github.labels.build.done` | env-keyed map or string | The label set after a successful build; env-aware |
| `.lisa.config.json` `deploy.branches` | — | Reverse-lookup map for env inference from PR base branch |

If the repo has not adopted the `status:*` label namespace, this skill cannot run. The remediation is to create the labels — `gh label create status:ready --color FBCA04 --description "Ready for build"` and similar — typically a one-time setup. See "Adoption" below for the full command set using the defaults; if your project overrides the role names, substitute accordingly.

## Rules

- **Dispatch leaves only.** Per the `leaf-only-lifecycle` rule, never dispatch a container — an issue with open child work, or a childless Epic — even if it carries the build-ready role. Move it `$READY → $CLAIMED` as lifecycle repair (Phase 3a); never silently implement a container.
- Never relabel an issue outside the cycle's allowed transitions. The `$CLAIMED` label is the signature of cycle ownership for leaves, and the parent/container progress state for lifecycle repairs.
- Never do build work directly from this scanner — the per-issue lifecycle (the `github-agent` workflow culminating in `lisa-implement`) owns it. And never spawn that lifecycle as a subagent; run it in-session per Phase 3c so `lisa-implement` can create its agent team.
- Never auto-transition past `$DONE`. Downstream labels (terminal `status:done`, etc.) are owned by QA / PM / merge automation.
- Never close a GitHub issue at intermediate env states (`status:on-dev`, `status:on-stg`, or configured equivalents). Native close happens only at the terminal `done` value.
- Never auto-close a `BLOCKED`, ambiguous, or duplicate-of-open issue. Auto-close is allowed only for `DUPLICATE_ALREADY_FIXED`.
- If the issue has no Validation Journey or no sign-in credentials, the pre-flight verify gate will catch it — **don't try to fix the issue from here**.
- On any unexpected outcome from the lifecycle run (status it doesn't claim, missing PR URL on success), record as Error and surface — never assume.
- Never pick an arbitrary env for `$DONE` resolution. If `done` is a map and env is ambiguous, fail loudly.

## Adoption (one-time per repo)

Before this skill can run, the repo must adopt the `status:*` label namespace. Using the defaults:

1. Create the labels:
   ```bash
   gh label create status:ready --color FBCA04 --description "Ready for build" --repo <org>/<repo>
   gh label create status:in-progress --color 0E8A16 --description "Build in progress" --repo <org>/<repo>
   gh label create status:on-dev --color 1D76DB --description "Built, deployed to dev" --repo <org>/<repo>
   gh label create status:done --color 0E8A16 --description "Shipped" --repo <org>/<repo>
   ```
   If your project overrides any `github.labels.build.*` role name in config, substitute the actual label names you configured.
2. Apply the `$READY` label to issues that are ready for development.
3. Reserve `$CLAIMED`, `$DONE` for this skill — humans should not set them manually except to recover from an error.
4. PRD-source labels (defaults: `prd-ready`, `prd-in-review`, etc.) are a SEPARATE namespace owned by `lisa-github-prd-intake`. Don't conflate.
