---
name: lisa-github-sync
description: "Syncs plan progress to a linked…"
allowed-tools: ["Bash", "Read", "Glob", "Grep"]
---

# GitHub Issue Sync

Sync current plan progress to a GitHub Issue: `$ARGUMENTS`

If no argument is provided, search for an issue ref (`org/repo#<number>` or `https://github.com/<org>/<repo>/issues/<n>` URL) in the active plan file (most recently modified `.md` in `plans/`).

Optional arguments include `pr_url=<url>` for the live pull request and `merge_sha=<sha>` once merged.

## Workflow

### Step 1: Identify Issue and Context

1. **Parse issue ref** from `$ARGUMENTS` or extract from the active plan file.
2. **Fetch current issue state**:

   ```bash
   gh issue view <number> --repo <org>/<repo> --json number,title,state,labels,milestone,assignees,comments,url
   ```

3. **Determine current milestone** by checking:
   - Does a plan file exist? → Plan created
   - Is there a working branch? → Implementation started
   - Are tasks in progress? → Active implementation
   - Is there an open PR? → PR ready for review
   - Is the PR merged? → Complete

### Step 2: Gather Update Content

| Milestone | Content to post |
|-----------|-----------------|
| **Plan created** | Plan summary, branch name, link to PR (if draft exists) |
| **Implementation in progress** | Task completion summary (X of Y tasks done), any blockers |
| **PR ready** | PR link, summary of changes, test results |
| **PR merged** | Final summary, suggest moving issue to `status:done` |

### Step 3: Post Update

1. **Idempotency check** — read the issue's recent comments. If the most recent comment with the prefix `[claude-sync] <milestone>` matches the current milestone AND the body content is unchanged, skip the post (no duplicate).
2. **Add the comment**:

   ```bash
   gh issue comment <number> --repo <org>/<repo> --body-file /tmp/sync-comment.md
   ```

   The body must start with `[claude-sync] <milestone>` so the next sync run can dedupe.

3. **Report** to the user what was synced.

### Step 3b: Ensure PR Backlink

When `$ARGUMENTS` includes `pr_url=<url>` for `PR ready` or `PR merged`, ensure the GitHub Issue has a durable ticket -> PR link:

1. Make sure the PR body contains `Refs #<n>` (or the fully qualified cross-repo form) — never a closing keyword, per the GitHub rule in `lisa-git-submit-pr`. Read the issue side with `gh api graphql` against `issue.timelineItems`, or `gh issue view <number> --json closedByPullRequestsReferences`. **Not** `gh issue view --json timelineItems`: `timelineItems` is not a supported field for that command, so the check silently returns nothing useful rather than failing loudly.
2. Establish the managed backlink comment by running the command that owns it — never by hand, and never by describing the procedure here:

   ```bash
   node scripts/lisa-work-item.mjs backlink --ref <work-item> --pr-url <url>
   ```

   It creates the `[lisa-pr-link]` comment or updates the one already present, instead of appending duplicates, so it is safe to run on every milestone. This is **unconditional**, not contingent on step 1 failing: under the non-closing rule GitHub never creates a native development link (that surface is the closing-reference mechanism), so this comment is the only ticket-side backlink there will be — run it whether or not native linkage exists or cannot be verified, because the required Work-Item Traceability check reads this comment and nothing else guarantees one. The comment carries the marker and the PR URL only; the milestone (`pr-ready` / `pr-merged`) and merge SHA belong in the milestone progress note, so that a rerun at a new milestone still converges on one backlink comment.

Native GitHub linkage cannot be verified under the non-closing rule because it is never created in the first place, so the managed comment is not a contingency here — it is the mechanism. The issue must show the PR from at least one ticket-side surface, and this is the only one available.

### Step 4: Suggest Status Transition

Based on the milestone, suggest (but do NOT automatically perform) a label transition:

| Milestone | Suggested label |
|-----------|-----------------|
| Plan created | `status:in-progress` |
| PR ready | configured `done` label (`status:done` in this repo) |
| PR merged | no additional build-label transition |

The actual `status:in-progress` flip is owned by `lisa-github-build-intake` (claim) and `lisa-github-agent`. The configured `done` flip is owned by the build-intake owner after a successful build and evidence post. This skill never relabels.

Every suggested transition is bound by the **Tracker status vocabulary** section of `lisa-tracker-sync` — cite it, do not restate the policy. GitHub has **no review lane** (`BUILD_LABEL_DEFAULTS` seeds no `review` key, and `config-resolution` records "no default review label"), so the `pr-ready` milestone suggests the configured `done` label directly; there is no intermediate hop to skip. Resolve every label through the shared resolver rather than an inlined helper.

### Step 5: Parent Status Rollup (`--rollup`)

When invoked with `--rollup`, this skill **derives a parent/container issue's `status:*` label from the roll-up of its child sub-issues** instead of posting a milestone update on a leaf. This implements the GitHub sub-issue-completion arm of the **Parent status rollup (the state machine)** section of the `leaf-only-lifecycle` rule — cite that rule, do not restate the policy. It is the sync-side complement to the write-time labeling (`lisa-github-write-issue`), the validate-time S15 gate (`lisa-github-validate-issue`), and the claim-time gate (`lisa-github-build-intake`); all four cite the same rule so the classification never drifts.

**Resolve the child set the same way `lisa-github-read-issue` does** — native sub-issues via GraphQL, each with its `status:*` label and open/closed state:

```bash
gh api graphql -f query='
  query($owner:String!,$repo:String!,$number:Int!){
    repository(owner:$owner,name:$repo){
      issue(number:$number){
        number title state
        subIssues(first:100){ nodes { number state labels(first:20){ nodes { name } } } }
      }
    }
  }' -F owner=<org> -F repo=<repo> -F number=<parent-number>
```

If the `subIssues` field is unavailable (older GHES), fall back to body parentage exactly as `lisa-github-read-issue` does. If the issue has **no** children it is a leaf, not a parent — rollup is N/A; behave as a normal milestone sync.

**Evaluate the required children over the env ladder `in-progress < dev < staging < production` (the ordered keys of the GitHub env-keyed `done` map, e.g. `status:on-dev < status:on-stg < status:done`) and take the first match** (canonical roles from `config-resolution`; the GitHub label map is `status:blocked`, `status:in-progress`, env-keyed `done`):

| If among the required child leaves… | Derived parent role | GitHub label |
|---|---|---|
| any child carries `status:blocked` (or is otherwise blocked) | `blocked` | `status:blocked` |
| else **every** required child has shipped to some env (each at a `done`-map label, e.g. `status:on-dev`/`status:on-stg`/`status:done`) | `done[min-env]` | the **least-advanced** env label among them (all `status:on-stg` → `status:on-stg`; mixed dev+staging → `status:on-dev`; all production → `status:done`) |
| else any child has **started** (`status:in-progress`, or shipped to an env while a sibling has not) | `claimed` | `status:in-progress` |
| else (children exist, none started) | — | unchanged — parent keeps its non-ready container label |

- **Blocked dominates — and the rollup must say which child and which kind** — a single blocked child surfaces `status:blocked` on the parent even while siblings progress, so a human sees the parent needs attention. `status:blocked` alone is a single bit and cannot tell a child waiting on an external event from one whose acceptance criteria are unbuildable; the second never clears on its own.
- **Run the shared classifier for every derived rollup state before writing the label or comment**, not only for `status:blocked`. Include the exact rendered state and child tally in the classifier input alongside the resolved child graph, so its fingerprint and `change.summary` deduplicate the complete rollup note for `status:in-progress`, every env-keyed `done`, and `status:blocked` alike:

```bash
run_rollup_classifier() {
  local input_path="$1"
  local attempted_paths=""
  local seen_root=""
  local candidate_suffix="scripts/rollup-blocker-classification.mjs"
  local root root_real candidate candidate_real expected_candidate
  local classifier_output

  for root in "${CLAUDE_PLUGIN_ROOT:-}" "${PLUGIN_ROOT:-}"; do
    [ -n "$root" ] || continue
    [ "$root" != "$seen_root" ] || continue
    seen_root="$root"
    case "$root" in
      /*) ;;
      *) continue ;;
    esac
    case "$root" in
      */../*|*/..|*/./*|*/.) continue ;;
    esac

    candidate="${root%/}/$candidate_suffix"
    if [ -z "$attempted_paths" ]; then
      attempted_paths="$candidate"
    else
      attempted_paths="$attempted_paths, $candidate"
    fi

    root_real="$(realpath "$root" 2>/dev/null)" || continue
    [ -f "$candidate" ] && [ -r "$candidate" ] || continue
    candidate_real="$(realpath "$candidate" 2>/dev/null)" || continue
    expected_candidate="${root_real%/}/$candidate_suffix"
    [ "$candidate_real" = "$expected_candidate" ] || continue

    if classifier_output="$(
      node "$candidate" --input="$input_path" 2>/dev/null
    )"; then
      printf '%s\n' "$classifier_output"
      return 0
    fi

    printf 'Rollup classifier failed at trusted path: %.4000s\n' \
      "$candidate" >&2
    return 1
  done

  printf 'No usable rollup classifier; attempted paths: %.4032s\n' \
    "$attempted_paths" >&2
  return 1
}

if ! CLASSIFIER_REPORT="$(run_rollup_classifier "<graph.json>")"; then
  echo "Rollup classifier failed before any lifecycle or comment write." >&2
  exit 1
fi
```

  When the derived state is blocked, its report names, per class, the blocking leaf, the path to it (`#1495 -> #1515 -> #1547`) and **who must act** — that text goes in the rollup comment verbatim. It exits non-zero when it classified nothing (unreadable graph, no children, no readable child): that is a strict **no-write** result. Do not change a label and do not post/update a rollup comment; report the classifier failure to the caller. Never fall through to "no blocked children", infer a class from prose, or apply the `spec_defect` marker from a flow — see `leaf-only-lifecycle` → **Classifying a hold**.
- **Least-advanced env wins** — the parent reaches an env only when every required child has reached at least that env; it never sits ahead of its laggard child. Native closure (`gh issue close --reason completed`) fires only when the resolved env is the production `status:done`, never at `status:on-dev`/`status:on-stg`.
- **"Required" children only** — a child labelled won't-do / optional does not hold the parent open; only leaves that must ship count toward the env-rollup check.
- **Recursive** — a parent reaches an env only when its children have all reached at least that env; an Epic reaches it only when its Stories have themselves rolled up to it. Evaluate bottom-up.
- **Never set the parent to `status:ready`** — `ready` is leaf-only (the human "claim this" signal). Rollup only moves the parent between non-ready container labels.

**Single-environment collapse (this repo).** `.lisa.config.json` `deploy.branches` declares only `production: main`, so the env-keyed `done` resolves to the single label `status:done` — there is no `status:on-dev` / `status:on-stg` and **no dev → staging → prod promotion chain**. Resolve the env rungs via the env-keyed `done` logic in `config-resolution`, but in the single-environment case the only rung is production and it collapses to the one `status:done` value; the rollup never attempts to resolve a dev or staging `done`. Projects that DO have multiple environments keep the env-keyed map and roll the parent up to whichever `done` (including intermediate `status:on-dev`/`status:on-stg`) its leaves have collectively reached.

**Apply the derived label** (only when it differs from the parent's current `status:*`): remove the parent's existing `status:*` label and add the derived one, keeping exactly one `status:*` label so the build-queue invariant holds. Re-read the labels immediately after the edit and require exactly one `status:*`; if the count differs, surface an error and stop without trying to normalize the ambiguous set automatically. Post an idempotent `[claude-sync] rollup` comment naming the derived state and the child tally (e.g. `3/4 leaves terminal, 1 blocked → status:blocked`); when the derived state is `status:blocked` the comment also carries the classifier's per-class section, so the blocking child and its actor are one read rather than a descent. Persist the classifier's `change.fingerprint` with the rollup comment and use `change.changed` as the dedupe decision for every rollup. Use `change.summary` only as display text; it describes the transition and is not a stable key.

```bash
gh issue edit <parent-number> --repo <org>/<repo> \
  --remove-label "<current status:*>" --add-label "<derived status:*>"
```

**Safe default.** If a successfully-read rollup cannot be applied automatically (e.g. ambiguous required-set or a derived terminal that the env logic cannot resolve), this skill does **not** guess — it posts the derived suggestion as a comment and leaves the parent's label untouched. A classifier/read failure is stricter: it writes neither label nor comment. No unsafe transition is ever made.

## Important Notes

- **Never auto-transition labels** — always suggest and let the user / pipeline confirm. The one exception is the explicit `--rollup` parent derivation (Step 5), which moves a *parent's* `status:*` label as the `leaf-only-lifecycle` rule mandates — never a leaf's, and never to `status:ready`.
- **Idempotent updates** — the `[claude-sync] <milestone>` prefix on the most-recent comment is the dedupe key; the rollup path uses `[claude-sync] rollup`.
- **Comment format** — use GitHub-flavored markdown (`##` headings, fenced code blocks). The same template is used for the JIRA path (rendered as wiki markup there); keep the markdown source canonical.
- **Rollup cites the rule by slug** — parent state derivation follows the `leaf-only-lifecycle` rule's state machine; this skill does not restate the policy.

## Execution

Sync the issue now.
