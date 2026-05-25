---
name: github-prd-intake
description: "Scans a GitHub repository for issues carrying the configured `ready` PRD label and runs each one through the dry-run validation pipeline. PRDs that pass every gate get tickets written (to whatever destination tracker is configured — JIRA, GitHub Issues itself, or Linear) and the label flipped to the configured `ticketed` label; PRDs that fail get clarifying-question comments and the label flipped to the configured `blocked` label. The GitHub counterpart of lisa:notion-prd-intake / lisa:confluence-prd-intake / lisa:linear-prd-intake. Composes existing skills (github-to-tracker, tracker-validate, tracker-source-artifacts, product-walkthrough)."
allowed-tools: ["Skill", "Bash"]
---

# GitHub PRD Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

- A GitHub `org/repo` token (e.g., `acme/product-prds`) — scans the repo for issues carrying the configured `ready` PRD label.
- A full GitHub repo URL (e.g., `https://github.com/acme/product-prds`).
- The literal token `github` — falls back to `.lisa.config.json` (`github.org` / `github.repo`).

Run one intake cycle against that repo. Each issue with the `ready` label is claimed, validated, and routed to either the `blocked` label (with clarifying comments) or the `ticketed` label (with destination tickets created).

## Workflow resolution

PRD label names are read from `.lisa.config.json` `github.labels.prd.*`, falling back to defaults documented in the `config-resolution` rule. Bash pattern:

```bash
# Read role with default fallback. Local overrides global per-key.
read_role() {
  local role="$1" default="$2"
  local local_v global_v
  local_v=$(jq -r ".github.labels.prd.${role} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".github.labels.prd.${role} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}

READY=$(read_role ready "prd-ready")
IN_REVIEW=$(read_role in_review "prd-in-review")
BLOCKED=$(read_role blocked "prd-blocked")
TICKETED=$(read_role ticketed "prd-ticketed")
SHIPPED=$(read_role shipped "prd-shipped")
```

In prose below, the role names refer to the resolved labels: e.g. "the `ready` label" means whatever `github.labels.prd.ready` resolves to (default: `prd-ready`).

This skill is the GitHub counterpart of `lisa:notion-prd-intake`, `lisa:confluence-prd-intake`, and `lisa:linear-prd-intake`. Phases, gates, comment templates, and rules are identical — the only differences are (1) the lifecycle is encoded as **issue labels** (mirroring Linear's project labels and Confluence's page labels), (2) the fetch / update tools are the `gh` CLI, and (3) clarifying-question comments land directly on the source PRD issue (because GitHub Issues *do* have native comments — no sentinel issue required, unlike Linear). Keep all four skills behaviorally aligned: when changing intake logic, change them together.

The **PRD closure rollup phase (3f)** transitions a `$TICKETED` PRD to `$SHIPPED` (and optionally closes it) once all its generated top-level work is terminal, per the `prd-lifecycle-rollup` rule. This phase is GitHub-only here because its vendor surface (issue close + labels via `gh`) is GitHub-specific; the Linear / Confluence / Notion intake skills carry the **same** vendor-neutral rollup with their own surfaces (sibling sub-task #584, now landed). All four intake skills are behaviorally aligned across the rollup phase too — keep them in sync when changing rollup logic.

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a repo, run the cycle to completion — claim, validate, branch to `$BLOCKED` or `$TICKETED`, write the summary. The caller has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background batch.

Specifically forbidden:

- Previewing projected scope and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip / dry-run only" — the documented behavior IS the default.
- Pausing because a PRD looks large, has many open questions, or is likely to end in `$BLOCKED`. The `blocked` label is a valid terminal state of this lifecycle, not a failure mode.
- Pausing because the dry-run validation looks expensive.

The only legitimate reasons to stop early:

- Missing repo argument or required configuration. Surface and exit.
- Repo unreachable, or the labelling convention not yet adopted (no issue carries any of `$READY` / `$IN_REVIEW` / `$BLOCKED` / `$TICKETED`). Surface and exit.
- Empty ready set. Exit cleanly with `"No GitHub issues labeled $READY in <org>/<repo>. Nothing to do."`

## Lifecycle assumed

The PRD lifecycle is encoded as **issue labels**:

```text
draft → ready → in_review → blocked | ticketed → shipped → verified
        (product)  (us)      (us)                  (product)  (product)
```

(Defaults: `prd-draft` / `prd-ready` / `prd-in-review` / `prd-blocked` / `prd-ticketed` / `prd-shipped` / `prd-verified`.)

`verified` is the terminal state after `shipped`: it means the shipped product has been empirically checked against the PRD (set by `/lisa:verify-prd`, not by this intake skill). A failed post-ship verification reuses `blocked` rather than introducing a separate `verifying` / `verification-failed` state. Like `draft` and `shipped`, `verified` is **product-owned** — this intake skill never sets, clears, or otherwise touches it. See the "PRD-level verification vs ticket verification" section of the `prd-lifecycle-rollup` rule.

Exactly one of these labels is expected on a PRD issue at any time.

This skill transitions:

- `$READY` → `$IN_REVIEW` (claim)
- `$IN_REVIEW` → `$BLOCKED` (gate failures or coverage gaps)
- `$IN_REVIEW` → `$TICKETED` (success)
- `$TICKETED` → `$BLOCKED` (post-write coverage gaps from Phase 3e)
- `$TICKETED` → `$SHIPPED` (PRD closure rollup, Phase 3f — only when **all** generated top-level children are terminal)

The `draft` and `verified` labels are owned by product and are never touched here (`verified` is set by `/lisa:verify-prd` after empirical PRD-level acceptance). The `shipped` label is set by this skill's **rollup phase (3f)** when, and only when, the PRD's generated top-level work is all terminal — per the `prd-lifecycle-rollup` rule; product may also set it by hand. Rollup never advances a PRD to `shipped` on partial completion, and never closes a PRD issue unless `github.labels.prd.rollup.closeOnShipped` is configured `true` (default `false` → set `shipped`, leave open).

A "transition" means: remove the old lifecycle label and add the new one (`gh issue edit <num> --remove-label <old> --add-label <new>`). The skill MUST verify exactly one lifecycle label is present after the update.

If the repo has not yet adopted these labels, this skill cannot run. See "Adoption" at the bottom.

**Label namespace separation:** the PRD lifecycle uses the configured PRD labels (defaults `prd-*`). The build-queue lifecycle (used by `lisa:github-build-intake`) uses the configured build labels (defaults `status:*`). The two never overlap. When the destination tracker is also GitHub Issues (self-host case), the same repo can host both — but a single issue is either a PRD (carrying a PRD lifecycle label) or a build ticket (carrying a build label), never both.

## Phases

### Phase 1 — Resolve the repo

1. Parse `$ARGUMENTS`:
   - `org/repo` token → use as-is.
   - GitHub URL → extract `org` and `repo`.
   - Literal `github` → resolve from `.lisa.config.json`; error if not set.
2. Confirm `gh auth status` succeeds.
3. Confirm the repo is reachable: `gh repo view <org>/<repo> --json name`.
4. Verify the PRD label set exists:
   ```bash
   gh label list --repo <org>/<repo> --json name --jq '.[] | .name' \
     | grep -xE "$READY|$IN_REVIEW|$BLOCKED|$TICKETED|$SHIPPED"
   ```
   If none of the configured PRD labels are present, surface a label-convention error and exit (see "Adoption").

### Phase 2 — Find ready PRDs

```bash
gh issue list --repo <org>/<repo> --label "$READY" --state open --limit 100 \
  --json number,title,body,labels,author,milestone,createdAt,updatedAt,url
```

For each candidate, confirm exactly one lifecycle label is present (the `--label` filter selects `$READY` matches, but a PRD could have ended up with two labels by hand — that's a misconfiguration, not a normal queue entry).

If empty, run a secondary check:

```bash
gh issue list --repo <org>/<repo> --state open --limit 100 --json number,labels \
  --jq "[.[] | .labels[] | select(.name == \"$READY\" or .name == \"$IN_REVIEW\" or .name == \"$BLOCKED\" or .name == \"$TICKETED\") | .name] | unique"
```

If no PRD lifecycle labels appear on any open issue → convention not adopted; surface error and exit. If lifecycle labels exist but none are `$READY` → genuinely empty queue, exit cleanly with the idle message.

### Phase 3 — Process each ready PRD

Process serially to keep label transitions auditable.

#### 3a. Claim

```bash
gh issue edit <num> --repo <org>/<repo> --remove-label "$READY" --add-label "$IN_REVIEW"
```

This is the idempotency lock — a re-entrant cycle's `--label $READY` filter won't see this issue again.

If the relabel fails (permission, race), log and skip. Do not proceed to validation on a PRD you didn't successfully claim.

This skill never edits the PRD body. Communication with product happens only through comments.

#### 3b. Dry-run validation

Invoke the `lisa:github-to-tracker` skill with `dry_run: true` and the PRD issue ref. The skill returns a structured report containing:
- The planned ticket hierarchy
- Per-ticket validation verdicts and remediation
- An overall PASS / FAIL verdict
- A failure count

This call indirectly invokes `lisa:tracker-source-artifacts` (artifact extraction + classification) and `lisa:product-walkthrough` (when the PRD touches existing user-facing surfaces). All gate logic lives in `lisa:tracker-validate` (which dispatches to `lisa:jira-validate-ticket` or `lisa:github-validate-issue` depending on the configured destination).

#### 3c. Branch on the verdict

**If `PASS`** (every planned ticket passed every applicable gate):

1. Re-invoke `lisa:github-to-tracker` with `dry_run: false` to actually write tickets. This re-runs the planning phases and the preservation gate.
2. Capture the created ticket refs.
3. Post a comment on the PRD issue listing the created tickets with their URLs:
   ```bash
   gh issue comment <prd-num> --repo <org>/<repo> --body-file /tmp/ticketed-comment.md
   ```
   Lead with: `"Ticketed by Claude. Created N tickets in <destination> — see below. Add the $SHIPPED label after the work is delivered."` The destination is named (JIRA / GitHub Issues) so product knows where to look.
4. Transition labels: `gh issue edit <prd-num> --remove-label "$IN_REVIEW" --add-label "$TICKETED"`.
5. **Run Phase 3e (coverage audit)** before considering this PRD done.

**If `FAIL`**:

The audience is the **product team**, not engineers. Follow the strict comment rules below.

##### 3c.1 Partition failures

1. Drop every failure where `product_relevant = false`. Internal data-quality problems — the agent should fix its own spec, not ask product. Record dropped failures under `Errors` in the cycle summary.
2. Group remaining product-relevant failures by `prd_anchor` (a section heading or a `selection_with_ellipsis` snippet from the PRD body). Failures sharing an anchor become one comment.

##### 3c.2 Render each comment

GitHub Issues do not have selection-anchored comments (unlike Confluence inline comments). Approximate by quoting the relevant body excerpt at the top of each comment:

```bash
gh issue comment <prd-num> --repo <org>/<repo> --body-file /tmp/anchored-comment-N.md
```

Each comment template MUST contain these parts in this order, no exceptions:

```text
[<Category badge>] <prd_section heading text>

> <quoted excerpt from the PRD body, ~10–30 words around the anchor — this stands in for inline anchoring>

**What's unclear:** <validator's `what` field, verbatim — already product-readable>

**Recommendation:** <validator's `recommendation` field, verbatim — must contain 1–3 concrete options, never a generic "please clarify">

**Action:** Update this section in the PRD, then replace the `$BLOCKED` label with `$READY` on the issue and Claude will re-run intake.
```

If multiple failures share an anchor, render each as its own `**What's unclear:** ... **Recommendation:** ...` block within the same comment, separated by `---`. Keep the single `[Category badge]` heading at the top.

For unanchored failures (`prd_anchor: null`), post one rollup comment prefixed with `Issues without a specific section anchor:`.

##### 3c.3 Category badges

| Validator category | Badge label |
|---------------------|-------------|
| `product-clarity` | `[Product clarity]` |
| `acceptance-criteria` | `[Acceptance criteria]` |
| `design-ux` | `[Design / UX]` |
| `scope` | `[Scope]` |
| `dependency` | `[Dependency]` |
| `data` | `[Data]` |
| `technical` | `[Technical]` |

`structural` failures must never reach this step (filtered in 3c.1).

##### 3c.4 Forbidden in product comments

- Gate IDs (`S4`, `F2`, etc.).
- GitHub-Issues-specific terminology (`gh`, `sub-issue`, `label namespace`) — paraphrase before posting.
- Internal skill names (`lisa:tracker-validate`, `github-to-tracker`).
- Engineering shorthand (`AC`, `OOS`, `repo`, `env var`).
- "Clarify this" / "Please specify" without candidate resolutions.

##### 3c.5 Label transition

After all comments are posted, transition: `gh issue edit <num> --remove-label "$IN_REVIEW" --add-label "$BLOCKED"`. Do NOT write any tickets.

#### 3d. Continue

Move to the next ready PRD. One PRD failing does not affect others.

#### 3e. Coverage audit (mandatory after $TICKETED)

Per-ticket gates prove each ticket is well-formed; they do NOT prove the *set* of tickets covers the *whole* PRD. Invoke `lisa:prd-ticket-coverage` to catch silent drops.

1. Invoke `lisa:prd-ticket-coverage` with `<PRD URL> tickets=[<created refs from 3c step 2>]`. The coverage skill auto-detects the PRD vendor from the URL host (`github.com` → GitHub).
2. Read the verdict:

   | Verdict | Action |
   |---------|--------|
   | `COMPLETE` | Done. Leave label as `$TICKETED`. Move to next PRD. |
   | `COMPLETE_WITH_SCOPE_CREEP` | Post an advisory comment on the PRD issue naming the scope-creep tickets. Leave label as `$TICKETED`. |
   | `GAPS_FOUND` | The created ticket set is incomplete. (a) For each gap, post a comment using the same product-facing template as Phase 3c.2 — anchored when `prd_anchor` is non-null. (b) Post one summary comment listing the tickets that *were* successfully created. (c) Transition labels from `$TICKETED` back to `$BLOCKED`. |
   | `NO_TICKETS_FOUND` | Should not happen if step 2 succeeded. Log as Error; leave label as `$TICKETED` with a flag comment. |

3. The created tickets remain in the destination tracker regardless of the verdict. The audit only tells us whether *more* are needed.

#### 3f. PRD closure rollup (config-gated)

A PRD's lifecycle terminal state (`shipped`) is **derived** from whether the work it generated is done — it is never set by hand here on its own authority. This phase implements the GitHub leg of that derivation, per the `prd-lifecycle-rollup` rule (cite it by slug; do not restate its taxonomy or terminal-state semantics here). Linear / Confluence / Notion rollup is a sibling sub-task (#584) and is out of scope for this skill.

Rollup runs over PRD issues that are already `$TICKETED` (the only state from which a PRD can ship): the freshly-ticketed PRD from Phase 3c, and — because rollup also catches PRDs whose children finished in a *later* cycle — every issue currently carrying `$TICKETED`. Process each independently; one PRD never blocks another's rollup.

##### 3f.0 Resolve closure config

Closure is gated on `github.labels.prd.rollup.closeOnShipped` (default `false`). Resolve it with the same local-overrides-global precedence the lifecycle labels use:

```bash
# Resolve a boolean rollup flag. Local overrides global per-key; default when unset.
read_rollup_flag() {
  local key="$1" default="$2"
  local local_v global_v
  local_v=$(jq -r ".github.labels.prd.rollup.${key} // empty" .lisa.config.local.json 2>/dev/null)
  global_v=$(jq -r ".github.labels.prd.rollup.${key} // empty" .lisa.config.json 2>/dev/null)
  echo "${local_v:-${global_v:-$default}}"
}

CLOSE_ON_SHIPPED=$(read_rollup_flag closeOnShipped false)
```

When `false` (the default), rollup sets `$SHIPPED` but leaves the PRD issue **open** for a human to close. When `true`, rollup also closes the PRD issue after the `$SHIPPED` transition. Closure NEVER happens before all generated top-level work is terminal (`prd-lifecycle-rollup` rule; PRD #525 non-goal).

##### 3f.1 Idempotency guard (no-op if already shipped)

Rollup is keyed by the PRD's current state. If the PRD already carries `$SHIPPED` (and is already closed, when `$CLOSE_ON_SHIPPED` is `true`), it is a **no-op** — do not re-transition, do not re-close, do not re-comment. Record it as `already shipped (no-op)` in the cycle summary and move on. This is what makes re-running intake safe.

##### 3f.2 Read the generated top-level child set

Read the PRD's **generated top-level work** — its created Epics and any top-level Stories created directly under it, **excluding** leaf Sub-tasks and any Story nested under a generated Epic (`prd-lifecycle-rollup` rule, generated-top-level-work contract). Use two sources, native first:

1. **Native sub-issues (primary).** Traverse the PRD issue's native sub-issue graph via the GraphQL `subIssues` query (the same query `lisa:github-read-issue` Phase 3 uses). The PRD's direct `subIssues` nodes are its top-level children:

   ```bash
   gh api graphql -f query='
   query($org:String!,$repo:String!,$number:Int!){
     repository(owner:$org,name:$repo){
       issue(number:$number){
         subIssues(first: 100) {
           nodes {
             number title state url
             repository { nameWithOwner }
             labels(first: 50) { nodes { name } }
           }
         }
       }
     }
   }' -F org=<org> -F repo=<repo> -F number=<prd-num>
   ```

2. **Documented `## Tickets` section (fallback).** When native sub-issues are unavailable (older GHES, sub-issues feature off, or the source PRD and the destination tracker are different systems so the children were never linked as sub-issues), parse the machine-readable generated-work section `lisa:prd-backlink` writes to the PRD body (`## Tickets`, alias `## Generated Work`; see #582). Top-level children are the `### <Epic key>: <title>` group headers' first line (`- [<ref>](<url>) — Epic`) plus any top-level Story listed directly under `### Unparented items`. Lines nested deeper (`  - ... — Story:` under an Epic, `    - ... — Sub-task:`) are descendants, NOT top-level children — skip them.

   ```bash
   # Top-level child refs = Epic lines (top indent) + Unparented top-level Stories.
   # Sub-tasks and Stories nested under an Epic are descendants — excluded.
   gh issue view <prd-num> --repo <org>/<repo> --json body --jq '.body' \
     | awk '/^## (Tickets|Generated Work)/{insec=1;next} /^## /{insec=0}
            insec && /^- \[.*\] — Epic/{print}
            insec && /^### Unparented items/{unp=1;next}
            insec && unp && /^- \[.*\] — Story/{print}'
   ```

Dedupe the resulting child set by **child-ref identity** (`owner/repo#number`) so a child that appears both as a native sub-issue and in the documented section is counted once (`prd-lifecycle-rollup` idempotency dedupe key). If neither source yields any child (the PRD generated nothing, or the relationship was never recorded), record `no generated top-level children — rollup skipped` and leave the PRD as `$TICKETED`; do not ship an empty PRD.

##### 3f.3 Apply the terminal-state predicate

For each top-level child, fetch its state + labels (already present from the GraphQL nodes, or `gh issue view <child-num> --json state,labels`) and classify per the `prd-lifecycle-rollup` GitHub predicate:

- **Terminal (shipped).** The child issue is **CLOSED** *and* (where the build-status label is in use) carries the resolved build `done` role label (`status:done` by default). A child Epic is terminal only when it has itself rolled up to its own terminal state per `leaf-only-lifecycle` — read the child's own resolved state; do not re-derive it from its leaves here.
- **Terminal-but-dropped.** The child is closed **as not planned** (`stateReason == "not_planned"`). It does not hold the PRD open and is excluded from the shipped set — treated like a won't-do leaf.
- **Incomplete / blocked.** Anything else: still open, or closed without the `done` label. Holds the PRD open.

The set of **required** children for the all-terminal check is the top-level children minus the terminal-but-dropped ones.

##### 3f.4 Branch on the rollup verdict

**All required children terminal** (every required top-level child is terminal; at least one required child exists):

1. Transition labels: `gh issue edit <prd-num> --repo <org>/<repo> --remove-label "$TICKETED" --add-label "$SHIPPED"`. Verify exactly one lifecycle label remains (the single-label invariant).
2. **If `$CLOSE_ON_SHIPPED` is `true`**, close the PRD issue: `gh issue close <prd-num> --repo <org>/<repo> --reason completed`. When `false`, leave it open.
3. Post a short rollup comment naming the terminal child set and (when dropped children exist) the dropped set, so the audit trail records *why* the PRD shipped. Lead with `"Shipped by Claude — all generated top-level work is complete."`

**Any required child incomplete / blocked**:

1. Leave the PRD label as `$TICKETED` and leave the issue **open**. Do NOT add `$SHIPPED`. Do NOT close.
2. Report the incomplete child set — both in the cycle summary and, when at least one cycle has previously ticketed this PRD, as a single advisory comment listing the still-open children (`- <ref> "<title>" — <state>`), so product can see what's blocking the rollup. Keep it idempotent: regenerate the advisory rather than appending a fresh one each cycle.

##### 3f.5 Rollup is GitHub-only and cites the rule

This phase only touches GitHub PRD issues. It implements exactly one PRD-lifecycle hop — `$TICKETED → $SHIPPED` — and the optional config-gated close that follows it. All terminal-state semantics, the generated-top-level-work boundary, the env-keyed `done` resolution, and the dedupe-by-child-ref idempotency come from the `prd-lifecycle-rollup` rule; this skill is its GitHub implementation, not a second source of truth.

### Phase 4 — Summary report

```text
## github-prd-intake summary

Repo: <org>/<repo> (<URL>)
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

PRDs processed: <n>
- $TICKETED: <n>
  - <issue-ref> "<title>" → <epic-ref> + <story-count> stories + <subtask-count> sub-tasks (coverage: COMPLETE | COMPLETE_WITH_SCOPE_CREEP)
- $BLOCKED: <n>
  - <issue-ref> "<title>" → <gate-failure-count> gate failures (pre-write) OR <gap-count> coverage gaps (post-write)
- Errors (claim failed, etc): <n>
  - <issue-ref> "<title>" — <reason>

Rollup (Phase 3f):
- $SHIPPED: <n>
  - <issue-ref> "<title>" → all <child-count> top-level children terminal (<dropped-count> dropped); closed: <yes|no (closeOnShipped off)>
- Held open (incomplete children): <n>
  - <issue-ref> "<title>" → <incomplete-count> of <child-count> top-level children still open
- Already shipped (no-op): <n>
- No generated children (rollup skipped): <n>

Total tickets created: <n>
Coverage audit summary: <n> COMPLETE / <n> COMPLETE_WITH_SCOPE_CREEP / <n> GAPS_FOUND
```

Print to the agent's output. Do not write this summary to GitHub.

## Self-host edge case (PRD repo = destination repo)

When the configured destination tracker is GitHub Issues AND the PRD repo is the same as the destination repo, both reads and writes hit the same place. Disambiguation rules:

- A PRD issue carries a PRD lifecycle label (configured under `github.labels.prd.*`). Built tickets carry a `type:*` + build-status label set (configured under `github.labels.build.*`), but never a PRD lifecycle label.
- The "Ticketed by Claude" comment on the PRD links to the destination ticket numbers (which live in the same repo, so the links are simple `#<n>` refs).
- `lisa:prd-ticket-coverage` filters out the source PRD itself when listing destination tickets — the PRD is never a ticket of its own work.

## Idempotency & safety

- **Single-cycle scope**: this skill processes the ready set as it exists at the start of Phase 2. New ready issues added mid-cycle are picked up next run.
- **No writes outside the lifecycle**: this skill only ever writes to the destination tracker via `lisa:github-to-tracker` (which delegates to `lisa:tracker-write`), only ever changes labels among `$IN_REVIEW`, `$BLOCKED`, `$TICKETED`, `$SHIPPED`, only ever comments on the source PRD issue. It never edits PRD bodies and never touches the `draft` label. It sets the `$SHIPPED` label and may close the PRD issue **only** through the config-gated rollup phase (3f), and never deletes any issue.
- **Claim-first ordering**: the label flip to `$IN_REVIEW` happens BEFORE validation runs.
- **Failure isolation**: an exception processing one PRD must not stop the cycle. Catch, record under "Errors" in the summary, continue. The PRD that errored is left labeled `$IN_REVIEW` — humans investigate from there.
- **Single-label invariant**: after every transition, verify exactly one lifecycle label is present.
- **Rollup idempotency**: rollup (Phase 3f) is a no-op on a PRD already carrying `$SHIPPED` (and already closed when `closeOnShipped` is `true`) — no duplicate transition, no duplicate close, no duplicate comment. The all-terminal condition is a pure function of the children's current states, so recomputing it is safe to re-run. Closure NEVER precedes the all-terminal condition.

## Configuration

Same configuration as `lisa:github-to-tracker`. See that skill for the full table. Key items:

- **From `.lisa.config.json`**: `github.org` and `github.repo` (required for the source repo, and also for the destination repo when `tracker = "github"` — self-host case), plus `github.labels.prd.*` for the lifecycle label vocabulary (all optional; defaults documented above).
- **From environment variables**: `E2E_BASE_URL`, `E2E_TEST_PHONE`, `E2E_TEST_OTP`, `E2E_TEST_ORG`, `E2E_GRAPHQL_URL` (operational E2E test config).

Destination tracker config (jira / github / linear) is consumed by `lisa:tracker-write` internally — this skill does NOT read it. If any required value is missing, surface and exit — never invent values.

| Field | Default | Purpose |
|-------|---------|---------|
| `.lisa.config.json` `github.labels.prd.ready` | `prd-ready` | Label signalling "PRD ready for ticketing" |
| `.lisa.config.json` `github.labels.prd.in_review` | `prd-in-review` | Label set on claim |
| `.lisa.config.json` `github.labels.prd.blocked` | `prd-blocked` | Label set on validation failure |
| `.lisa.config.json` `github.labels.prd.ticketed` | `prd-ticketed` | Label set on success |
| `.lisa.config.json` `github.labels.prd.shipped` | `prd-shipped` | Label product sets after delivery |

## Rules

- Never write to the destination tracker outside of `lisa:github-to-tracker` → `lisa:tracker-write`.
- Never add or remove a label this skill doesn't own (`$IN_REVIEW`, `$BLOCKED`, `$TICKETED`, and `$SHIPPED` via the rollup phase only). Product owns the `draft` and `ready` PRD labels; product and the rollup phase (3f) both set `shipped`.
- Set `$SHIPPED` (and close the PRD when `closeOnShipped` is configured) only from the rollup phase, and only when all generated top-level children are terminal per the `prd-lifecycle-rollup` rule. Never ship or close on partial completion.
- Never edit a PRD's body. Communication with product happens only via comments.
- Never post a single dump of all gate failures on one comment. One comment per `prd_anchor` group, plus one rollup for unanchored failures.
- Never include a gate ID, internal skill name, or engineering shorthand in a comment body.
- Never run more than one intake cycle concurrently against the same repo.
- If `lisa:github-to-tracker` returns errors, treat them as gate failures: comment + `$BLOCKED`. Don't silently fail.

## Adoption (one-time per repo)

Before this skill can run, the repo must adopt the PRD lifecycle issue-label convention. Using the defaults:

1. Create the labels:
   ```bash
   gh label create prd-draft --color C5DEF5 --description "PRD in progress (product owns)" --repo <org>/<repo>
   gh label create prd-ready --color FBCA04 --description "PRD ready for ticketing" --repo <org>/<repo>
   gh label create prd-in-review --color 5319E7 --description "Claude is reviewing this PRD" --repo <org>/<repo>
   gh label create prd-blocked --color D93F0B --description "PRD blocked — see comments" --repo <org>/<repo>
   gh label create prd-ticketed --color 0E8A16 --description "Tickets created — see comments" --repo <org>/<repo>
   gh label create prd-shipped --color 1D76DB --description "Work delivered (product owns)" --repo <org>/<repo>
   ```
   If your project overrides any `github.labels.prd.*` role name in config, substitute the actual label names you configured.
2. Apply the `$READY` label to issues that are ready for ticketing.
3. Reserve `$IN_REVIEW`, `$BLOCKED`, `$TICKETED` for this skill — humans should not set them manually except to recover from an error.
4. Keep the PRD label namespace strictly separate from the build-queue label namespace owned by `lisa:github-build-intake`.

If the repo hasn't adopted these labels, the first run exits with a label-convention error (not the idle empty-set message) — this distinguishes setup from a genuinely empty queue.
