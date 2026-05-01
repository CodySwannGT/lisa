---
name: github-prd-intake
description: "Scans a GitHub repository for issues labeled `prd-ready` and runs each one through the dry-run validation pipeline. PRDs that pass every gate get tickets written (to whatever destination tracker is configured — JIRA, GitHub Issues itself, or Linear) and the label flipped to `prd-ticketed`; PRDs that fail get clarifying-question comments and the label flipped to `prd-blocked`. The GitHub counterpart of lisa:notion-prd-intake / lisa:confluence-prd-intake / lisa:linear-prd-intake. Composes existing skills (github-to-tracker, tracker-validate, tracker-source-artifacts, product-walkthrough)."
allowed-tools: ["Skill", "Bash"]
---

# GitHub PRD Intake: $ARGUMENTS

`$ARGUMENTS` is one of:

- A GitHub `org/repo` token (e.g., `acme/product-prds`) — scans the repo for issues labeled `prd-ready`.
- A full GitHub repo URL (e.g., `https://github.com/acme/product-prds`).
- The literal token `github` — falls back to `.lisa.config.json` (`github.org` / `github.repo`).

Run one intake cycle against that repo. Each issue with the `prd-ready` label is claimed, validated, and routed to either `prd-blocked` (with clarifying comments) or `prd-ticketed` (with destination tickets created).

This skill is the GitHub counterpart of `lisa:notion-prd-intake`, `lisa:confluence-prd-intake`, and `lisa:linear-prd-intake`. Phases, gates, comment templates, and rules are identical — the only differences are (1) the lifecycle is encoded as **issue labels** (mirroring Linear's project labels and Confluence's page labels), (2) the fetch / update tools are the `gh` CLI, and (3) clarifying-question comments land directly on the source PRD issue (because GitHub Issues *do* have native comments — no sentinel issue required, unlike Linear). Keep all four skills behaviorally aligned: when changing intake logic, change them together.

## Confirmation policy

Do NOT ask the caller whether to proceed. Once invoked with a repo, run the cycle to completion — claim, validate, branch to `prd-blocked` or `prd-ticketed`, write the summary. The caller has already authorized the run by invoking the skill; re-prompting defeats the purpose of a background batch.

Specifically forbidden:

- Previewing projected scope and asking whether to continue.
- Offering A/B/C-style choices like "proceed / skip / dry-run only" — the documented behavior IS the default.
- Pausing because a PRD looks large, has many open questions, or is likely to end in `prd-blocked`. `prd-blocked` is a valid terminal state of this lifecycle, not a failure mode.
- Pausing because the dry-run validation looks expensive.

The only legitimate reasons to stop early:

- Missing repo argument or required configuration. Surface and exit.
- Repo unreachable, or the labelling convention not yet adopted (no issue carries any of `prd-ready` / `prd-in-review` / `prd-blocked` / `prd-ticketed`). Surface and exit.
- Empty `prd-ready` set. Exit cleanly with `"No GitHub issues labeled prd-ready in <org>/<repo>. Nothing to do."`

## Lifecycle assumed

The PRD lifecycle is encoded as **issue labels**:

```text
prd-draft → prd-ready → prd-in-review → prd-blocked | prd-ticketed → prd-shipped
            (product)    (us)            (us)                          (product)
```

Exactly one of these labels is expected on a PRD issue at any time.

This skill ONLY transitions:

- `prd-ready` → `prd-in-review` (claim)
- `prd-in-review` → `prd-blocked` (gate failures or coverage gaps)
- `prd-in-review` → `prd-ticketed` (success)
- `prd-ticketed` → `prd-blocked` (post-write coverage gaps from Phase 3e)

It never adds, removes, or touches `prd-draft` or `prd-shipped`. Those labels are owned by product.

A "transition" means: remove the old lifecycle label and add the new one (`gh issue edit <num> --remove-label <old> --add-label <new>`). The skill MUST verify exactly one lifecycle label is present after the update.

If the repo has not yet adopted `prd-*` labels, this skill cannot run. See "Adoption" at the bottom.

**Label namespace separation:** the PRD lifecycle uses the `prd-*` namespace. The build-queue lifecycle (used by `lisa:github-build-intake`) uses the `status:*` namespace. The two never overlap. When the destination tracker is also GitHub Issues (self-host case), the same repo can host both — but a single issue is either a PRD (carrying a `prd-*` label) or a build ticket (carrying a `status:*` label), never both.

## Phases

### Phase 1 — Resolve the repo

1. Parse `$ARGUMENTS`:
   - `org/repo` token → use as-is.
   - GitHub URL → extract `org` and `repo`.
   - Literal `github` → resolve from `.lisa.config.json`; error if not set.
2. Confirm `gh auth status` succeeds.
3. Confirm the repo is reachable: `gh repo view <org>/<repo> --json name`.
4. Verify the `prd-*` label set exists:
   ```bash
   gh label list --repo <org>/<repo> --json name --jq '[.[] | select(startswith("prd-"))] | sort'
   ```
   If none of `prd-ready` / `prd-in-review` / `prd-blocked` / `prd-ticketed` are present, surface a label-convention error and exit (see "Adoption").

### Phase 2 — Find Ready PRDs

```bash
gh issue list --repo <org>/<repo> --label prd-ready --state open --limit 100 \
  --json number,title,body,labels,author,milestone,createdAt,updatedAt,url
```

For each candidate, confirm exactly one lifecycle label is present (the `--label` filter selects `prd-ready` matches, but a PRD could have ended up with two labels by hand — that's a misconfiguration, not a normal queue entry).

If empty, run a secondary check:

```bash
gh issue list --repo <org>/<repo> --state open --limit 100 --json number,labels --jq '[.[] | .labels[] | select(.name | startswith("prd-")) | .name] | unique'
```

If no `prd-*` labels appear on any open issue → convention not adopted; surface error and exit. If `prd-*` labels exist but none are `prd-ready` → genuinely empty queue, exit cleanly with the idle message.

### Phase 3 — Process each Ready PRD

Process serially to keep label transitions auditable.

#### 3a. Claim

```bash
gh issue edit <num> --repo <org>/<repo> --remove-label prd-ready --add-label prd-in-review
```

This is the idempotency lock — a re-entrant cycle's `--label prd-ready` filter won't see this issue again.

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
   Lead with: `"Ticketed by Claude. Created N tickets in <destination> — see below. Add the prd-shipped label after the work is delivered."` The destination is named (JIRA / GitHub Issues) so product knows where to look.
4. Transition labels: `gh issue edit <prd-num> --remove-label prd-in-review --add-label prd-ticketed`.
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

**Action:** Update this section in the PRD, then replace the `prd-blocked` label with `prd-ready` on the issue and Claude will re-run intake.
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

After all comments are posted, transition: `gh issue edit <num> --remove-label prd-in-review --add-label prd-blocked`. Do NOT write any tickets.

#### 3d. Continue

Move to the next Ready PRD. One PRD failing does not affect others.

#### 3e. Coverage audit (mandatory after prd-ticketed)

Per-ticket gates prove each ticket is well-formed; they do NOT prove the *set* of tickets covers the *whole* PRD. Invoke `lisa:prd-ticket-coverage` to catch silent drops.

1. Invoke `lisa:prd-ticket-coverage` with `<PRD URL> tickets=[<created refs from 3c step 2>]`. The coverage skill auto-detects the PRD vendor from the URL host (`github.com` → GitHub).
2. Read the verdict:

   | Verdict | Action |
   |---------|--------|
   | `COMPLETE` | Done. Leave label as `prd-ticketed`. Move to next PRD. |
   | `COMPLETE_WITH_SCOPE_CREEP` | Post an advisory comment on the PRD issue naming the scope-creep tickets. Leave label as `prd-ticketed`. |
   | `GAPS_FOUND` | The created ticket set is incomplete. (a) For each gap, post a comment using the same product-facing template as Phase 3c.2 — anchored when `prd_anchor` is non-null. (b) Post one summary comment listing the tickets that *were* successfully created. (c) Transition labels from `prd-ticketed` back to `prd-blocked`. |
   | `NO_TICKETS_FOUND` | Should not happen if step 2 succeeded. Log as Error; leave label as `prd-ticketed` with a flag comment. |

3. The created tickets remain in the destination tracker regardless of the verdict. The audit only tells us whether *more* are needed.

### Phase 4 — Summary report

```text
## github-prd-intake summary

Repo: <org>/<repo> (<URL>)
Cycle started: <ISO timestamp>
Cycle completed: <ISO timestamp>

PRDs processed: <n>
- prd-ticketed: <n>
  - <issue-ref> "<title>" → <epic-ref> + <story-count> stories + <subtask-count> sub-tasks (coverage: COMPLETE | COMPLETE_WITH_SCOPE_CREEP)
- prd-blocked: <n>
  - <issue-ref> "<title>" → <gate-failure-count> gate failures (pre-write) OR <gap-count> coverage gaps (post-write)
- Errors (claim failed, etc): <n>
  - <issue-ref> "<title>" — <reason>

Total tickets created: <n>
Coverage audit summary: <n> COMPLETE / <n> COMPLETE_WITH_SCOPE_CREEP / <n> GAPS_FOUND
```

Print to the agent's output. Do not write this summary to GitHub.

## Self-host edge case (PRD repo = destination repo)

When the configured destination tracker is GitHub Issues AND the PRD repo is the same as the destination repo, both reads and writes hit the same place. Disambiguation rules:

- A PRD issue carries a `prd-*` label. Built tickets carry a `type:*` + `status:*` label set, but never a `prd-*` label.
- The "Ticketed by Claude" comment on the PRD links to the destination ticket numbers (which live in the same repo, so the links are simple `#<n>` refs).
- `lisa:prd-ticket-coverage` filters out the source PRD itself when listing destination tickets — the PRD is never a ticket of its own work.

## Idempotency & safety

- **Single-cycle scope**: this skill processes the `prd-ready` set as it exists at the start of Phase 2. New `prd-ready` issues added mid-cycle are picked up next run.
- **No writes outside the lifecycle**: this skill only ever writes to the destination tracker via `lisa:github-to-tracker` (which delegates to `lisa:tracker-write`), only ever changes labels among `prd-in-review`, `prd-blocked`, `prd-ticketed`, only ever comments on the source PRD issue. It never edits PRD bodies, never touches `prd-draft` or `prd-shipped`, never closes or deletes PRD issues.
- **Claim-first ordering**: the label flip to `prd-in-review` happens BEFORE validation runs.
- **Failure isolation**: an exception processing one PRD must not stop the cycle. Catch, record under "Errors" in the summary, continue. The PRD that errored is left labeled `prd-in-review` — humans investigate from there.
- **Single-label invariant**: after every transition, verify exactly one lifecycle label is present.

## Configuration

Same configuration as `lisa:github-to-tracker`. See that skill for the full table. Key items:

- **From `.lisa.config.json`**: `github.org` and `github.repo` (required for the source repo, and also for the destination repo when `tracker = "github"` — self-host case).
- **From environment variables**: `E2E_BASE_URL`, `E2E_TEST_PHONE`, `E2E_TEST_OTP`, `E2E_TEST_ORG`, `E2E_GRAPHQL_URL` (operational E2E test config).

Destination tracker config (jira / github / linear) is consumed by `lisa:tracker-write` internally — this skill does NOT read it. If any required value is missing, surface and exit — never invent values.

## Rules

- Never write to the destination tracker outside of `lisa:github-to-tracker` → `lisa:tracker-write`.
- Never add or remove a label this skill doesn't own (`prd-in-review`, `prd-blocked`, `prd-ticketed`). Product owns `prd-draft`, `prd-ready`, `prd-shipped`.
- Never edit a PRD's body. Communication with product happens only via comments.
- Never post a single dump of all gate failures on one comment. One comment per `prd_anchor` group, plus one rollup for unanchored failures.
- Never include a gate ID, internal skill name, or engineering shorthand in a comment body.
- Never run more than one intake cycle concurrently against the same repo.
- If `lisa:github-to-tracker` returns errors, treat them as gate failures: comment + `prd-blocked`. Don't silently fail.

## Adoption (one-time per repo)

Before this skill can run, the repo must adopt the `prd-*` issue-label convention:

1. Create the labels:
   ```bash
   gh label create prd-draft --color C5DEF5 --description "PRD in progress (product owns)" --repo <org>/<repo>
   gh label create prd-ready --color FBCA04 --description "PRD ready for ticketing" --repo <org>/<repo>
   gh label create prd-in-review --color 5319E7 --description "Claude is reviewing this PRD" --repo <org>/<repo>
   gh label create prd-blocked --color D93F0B --description "PRD blocked — see comments" --repo <org>/<repo>
   gh label create prd-ticketed --color 0E8A16 --description "Tickets created — see comments" --repo <org>/<repo>
   gh label create prd-shipped --color 1D76DB --description "Work delivered (product owns)" --repo <org>/<repo>
   ```
2. Apply `prd-ready` to issues that are ready for ticketing.
3. Reserve `prd-in-review`, `prd-blocked`, `prd-ticketed` for this skill — humans should not set them manually except to recover from an error.
4. Keep the `prd-*` namespace strictly separate from the build-queue `status:*` namespace owned by `lisa:github-build-intake`.

If the repo hasn't adopted these labels, the first run exits with a label-convention error (not the idle empty-set message) — this distinguishes setup from a genuinely empty queue.
