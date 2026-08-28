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

`$ARGUMENTS` is forwarded verbatim, including the optional `--rollup` flag (see "Parent status rollup" below), `pr_url=<url>`, and `merge_sha=<sha>`. The shim never interprets these — the vendor skill does.

> **There is no per-milestone lane-write flag on any vendor.** This paragraph previously documented `--update-label` on GitHub and `--update-state` on Linear. `--update-label` was never implemented — `lisa-github-sync` says flatly *"This skill never relabels"* — so a caller passing it got a silent no-op on GitHub and a real write on Linear for the equivalent flag. Both are gone. `--rollup` is the only write path a sync skill has.

## Tracker status vocabulary — binding on all three arms

Every suggested or performed transition names **only a role the project configured**, never a status, state or label discovered from the tracker's live workflow (transition lists, board columns, `type`-derived matches, other tickets). This binds a lead performing tracker writes exactly as it binds a subagent.

Two consequences the vendor arms must not restate differently:

- **A milestone whose role is unset gets a comment, not a transition.** `review` and the `qa.*` roles are optional and carry **no default** — omitting one means the project does not run that step, and the lifecycle skips it. "Unset" must never resolve to a built-in name; that is the difference between "not customized" and "we deliberately don't do this".
- **A fallback may inform a read; it may never supply a write target.** Where a vendor exposes one (Linear resolves states by `type`), it selects by board position rather than intent — so on a board carrying more than one plausible state it returns whichever sits earliest, which is exactly the human-only lane a project left out of its config on purpose.

Resolve roles through the shared resolver rather than an inlined helper:

```bash
node "${CLAUDE_PLUGIN_ROOT:-${PLUGIN_ROOT:-plugins/lisa}}/scripts/resolve-lifecycle-role.mjs" \
  --role <role> --vendor <jira|linear|github> --intent <read|write> [--env <env>]
```

Exit `0` with a value means configured; exit `0` with **empty** output means an optional role is unset — skip the transition; exit `2` means a required role is unset or a write was refused a fallback value. Any other exit is a resolver failure, never an unset role.

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

- **Blocked dominates** — one blocked leaf surfaces blocked on the parent even while others progress. It never says *which* child or *which kind* of hold. Resolve the shared classifier with the trusted-root ladder below, run it over the resolved child graph, and carry its per-class report — blocking leaf, path, and who must act — into the rollup note. A missing, unusable, or non-zero classifier is a strict **no-write** result: no lifecycle mutation and no rollup comment. Its bounded diagnostic names attempted paths only; it never prints environment values or child payloads. Report the failure, never an all-clear. See `leaf-only-lifecycle` → **Classifying a hold**.

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
```
- **Least-advanced env wins** — a parent reaches an env only once all required leaves have reached at least that env (all `On Stg` → `On Stg`; mixed dev/staging → the dev value). Native terminal closure fires only at the production `done`, never at an intermediate env.
- **The parent never carries `ready`** — `ready` is a human "claim this leaf" signal; rollup only moves a parent between non-ready container states.
- **Rollup is recursive** — an Epic rolls up from its Stories, each of which rolls up from its own leaves. Evaluate bottom-up.
- **The env rungs are the configured env-keyed `done`** — multi-env projects roll up to whichever `done` value (including intermediate `On Dev`/`On Stg`) their leaves have collectively reached (see `config-resolution` "Env-keyed `done`"). **Single-environment collapse (this repo):** `deploy.branches` declares only `production: main`, so `done` is a single value, the only env rung is production, and the GitHub build lifecycle collapses to `ready → claimed (in-progress) → done`; the rollup terminal is simply `done` (or the PRD-side `ticketed` for PRD containers), with **no** dev/staging promotion hops and **no** env-keyed multi-entry chain to resolve.

**Safe-by-default when not yet supported.** A vendor sync path that has not implemented native rollup MUST be a documented no-op that surfaces the derived state as a suggestion/comment rather than guessing a transition — never an unsafe default. Without `--rollup`, the sync skills behave exactly as before (milestone comment on the work item; no parent derivation).

## Pull request backlinking

When `$ARGUMENTS` includes `pr_url=<url>` with milestone `pr-ready` or `pr-merged`, the dispatch target must ensure ticket -> PR linkage, not just post a generic progress note:

1. Prefer the provider's native development-link primitive when Lisa can write and verify it for that provider.
2. Verify the native link using the provider read surface when available.
3. Whether or not the native link exists or cannot be verified, establish the managed backlink comment with the one command that owns it:

   ```bash
   node scripts/lisa-work-item.mjs backlink --ref <work-item> --pr-url <url>
   ```

4. That command is idempotent by construction — it updates the existing `[lisa-pr-link]` comment rather than appending duplicates — and it refuses loudly for a tracker it cannot write. Do not restate its procedure in a vendor skill; the file that writes the comment is the file that checks it, and that is what stops the two from drifting.

This is the reverse half of `lisa-git-submit-pr`'s PR body linkage. A PR that mentions a ticket is not considered fully synced until the ticket also has either a verified native PR link or the managed fallback comment.

## Rules

- Idempotent updates — running sync at the same milestone twice should not produce duplicate comments. Vendor skills enforce this.
- Never transition a leaf's lane from a sync milestone on any vendor. The canonical signal differs — the `status:*` label on GitHub, the workflow status on JIRA, the native workflow state on Linear — but the owner is the same everywhere: build-intake / the vendor agent. Every arm only suggests. `--rollup` (parent derivation) is the sole exception, and it derives the parent from its children rather than advancing a leaf.
- Parent rollup derives state from children per the `leaf-only-lifecycle` rule; it never sets a parent to `ready` and never resolves a dev/staging `done` in this single-environment repo.
- Pull request backlinks are mandatory when `pr_url=<url>` is present: native first, managed-comment fallback, never silently dropped.
