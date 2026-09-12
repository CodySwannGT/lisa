---
name: lisa-track
description: "Resolves exactly one live configured-tracker leaf for durable project work, claims it idempotently, and persists its canonical reference in worktree-local state. Accepts an existing Jira/GitHub/Linear ref, a spec file, or plain text. Also accepts human_gate: <why a human must judge this first>, which files the leaf held — outside the build-ready lane, never claimed — instead of build-ready. Use directly to mention/create the related ticket, and as lisa-implement's mandatory input gate."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Track Work: $ARGUMENTS

## Human-gate release authorization

A release requires a trusted human author, not just matching comment text. Follow
`ready-role-filing` — **Human-gate release authorization**: preserve tracker-supplied comment
author IDs and bot metadata, resolve `trustedHumanActorIds` only from an explicit user instruction
or existing human-authored trusted project policy, and pass it with structured `comments` to every
hold classifier, reconciliation, normalization and release planner. Never derive trust from the
comment body, a display name, the actor's own assertion, or an automation posting on its own behalf.
Missing policy, missing/unreadable author identity, raw body strings, untrusted actors and known bots
cannot discharge a hold. Keep the item held and report the missing authorization; do not silently
replace these inputs with an empty history or an inferred allowlist. Authorized matching releases
continue through the existing path and never override an independently declared caller hold.


Establish the tracked-work invariant before any durable project mutation. Discussion and read-only orientation may proceed without this skill; code, configuration, documentation, research artifacts, plans, investigation findings, tests, commits, and pull requests may not.

This flow must return exactly one canonical `(tracker_provider, work_item_ref)` pair or fail closed. It never returns an unvalidated textual guess.

## Phase 1 — Resolve tracker and classify input

1. Resolve merged `.lisa.config.local.json` over `.lisa.config.json` exactly as `lisa-tracker-read` / `lisa-tracker-write` do. Missing, unknown, or incomplete tracker configuration is a blocking error.
2. Classify `$ARGUMENTS` as exactly one of:
   - an explicit reference matching the configured tracker (`KEY-123`, `org/repo#123` or issue URL, Linear team identifier);
   - an existing file path containing a specification (read the entire file, without offset/limit);
   - plain-text work description.
3. Detect the caller's readiness declaration, which is orthogonal to the classification above. Absent any declaration this is the default build-ready path. A caller deliberately holding the work for a pending human product call passes `human_gate: "<why a human must judge this first>"`; the two declarations are mutually exclusive and a `human_gate` present but empty is a blocking error, because an unexplained hold is indistinguishable from an accident.
4. Preserve the full resolved specification for the caller. Do not treat a ticket-like token for a different provider/project as plain text; report the mismatch.

## Phase 2 — Resolve one live work item

### Explicit reference

Invoke `lisa-tracker-read <ref>` and require a live result from the configured project. Reject nonexistent, inaccessible, closed/resolved/terminal, wrong-project, wrong-repository, or container items. Read the returned body, labels and all comments; Phase 3 uses the shared hold classifier so a historical `[lisa-human-gate]` marker with a matching release is not mistaken for an active hold. This live read is mandatory even if caller context already includes ticket text.

### File or plain text

Search conservatively before creating:

1. Normalize the requested outcome and derive a short keyword set; never search with the whole prompt or secrets.
2. Search only open/non-terminal items in the configured project and current repository through the configured provider's documented read surface:
   - GitHub: `gh issue list --repo <org>/<repo> --state open --search "<keywords> in:title,body"`.
   - Jira: `lisa-atlassian-access operation: search-issues` with project-scoped JQL.
   - Linear: `lisa-linear-access operation: list-issues` scoped to the configured team/workspace.
3. Treat search results as candidates, never proof. Live-read each plausible candidate through `lisa-tracker-read`, and discard terminal, container, blocked, held-by-gate, cross-repo, and materially different outcomes. A held candidate is never reused: attaching new work to an item a human is holding is how the hold gets spent.
4. Reuse only when **exactly one** live leaf is a high-confidence semantic match for the same requested outcome and repository. A shared keyword or similar title is not enough. Record the search queries, candidates, and rejection reasons in the returned resolution evidence.
5. If there is no unique high-confidence match (zero or ambiguous candidates), create **exactly one** item by invoking `lisa-tracker-write` once. Synthesize one complete single-repository leaf (`Bug`, `Task`, `Sub-task`, or `Improvement`, never Epic/container) with the writer's required three-audience body, Gherkin acceptance criteria, repository, target environment, relationship search, and executable Validation Journey. Pass `build_ready: true` unless the caller declared a `human_gate`, in which case pass that `human_gate: "<why>"` reason instead of `build_ready: true` and never alongside it, so the writer leaves the leaf in the tracker's default backlog role — out of the lane build-intake claims from — and stamps the hold on the body as a `[lisa-human-gate]` marker. Discarding a declared gate and filing build-ready anyway is the one outcome this step must never produce. Do not create placeholder/thin tickets, do not create a hierarchy, and do not retry creation by making another item if validation fails; repair the proposed spec and retry the same writer operation only if the vendor contract supports idempotent reuse.
6. Live-read the writer's canonical returned reference with `lisa-tracker-read`. A create response without a verified live leaf is failure.

This is intentionally conservative: ambiguity creates one explicit work item instead of silently attaching work to the wrong existing item. Across the entire invocation, at most one new work item may be created.

## Phase 3 — Claim and bind

The work item is **held** when the caller declared a `human_gate`, independently of any item history,
or `classifyReadyCandidate({ labels, body, comments, trustedHumanActorIds, humanNeededLabel })` from the shipped
`scripts/intake-blocker-reprobe.mjs` returns `claimable: false`. Pass the complete live comment
history so a matching `[lisa-human-gate-release]` discharges the historical body marker. Never
reimplement heldness as a substring test or as the negation of `planHumanGateRelease().released`:
that planner also returns `released: false` for an item that was never held. Missing comments fail
closed for a hold; never infer release from a missing label.

A held item stops the flow here, whatever roles or labels it carries. Do not invoke
`lisa-tracker-claim`, write the worktree binding, or begin durable project work. Return
`claim_outcome: held-by-gate` and `binding_outcome: skipped-human-gate`, name the signal in `held_by`
and carry its reason verbatim in `gate_reason` (null for a keyless hold), then stop.

For a discharged item, call
`planHumanGateRelease({ labels, body, comments, trustedHumanActorIds, humanNeededLabel, readyLabel, lifecycleLabels, alreadyNotified })`
and apply only the returned actions before claiming. Keep the body marker as history; a release
never overrides a new caller-declared hold or another eligibility check.

Otherwise:

1. Invoke `lisa-tracker-claim <canonical-ref>`. Require its post-read verified `claim_outcome: claimed|reused`; no binding may be written after a failed/unverified claim.
2. Persist only the canonical reference in worktree-local machine state:

   ```bash
   node scripts/lisa-work-item.mjs link <canonical-ref>
   ```

3. Read the binding back through `node scripts/lisa-work-item.mjs current` and require it to equal the canonical reference. If binding fails, stop before durable project work.
   - A detached-HEAD worktree is valid at this stage: the binding records `branch: null` as a pending state. Create the feature branch only after the gate succeeds, then run `node scripts/lisa-work-item.mjs attach-branch`. Commit preparation and validation fail closed until that attachment succeeds.
4. Return this structured result plus the full resolved work-item context:

   ```text
   tracker_provider: jira|github|linear
   work_item_ref: <canonical-ref>
   resolution_outcome: explicit|reused|created
   readiness_declaration: build-ready|human-gate
   held_by: none|caller-declaration|item-marker
   gate_reason: <why a human must judge this first>|null
   claim_outcome: claimed|reused|held-by-gate
   binding_outcome: verified|skipped-human-gate
   ```

## Lifecycle

- The binding is worktree-local, uncommitted machine state. Never write it into tracked source files.
- Branch setup may call `node scripts/lisa-work-item.mjs attach-branch` after the feature branch exists.
- Keep the binding across ordinary interruptions and blocked outcomes so resumed work remains attributable.
- Clear it only after true terminal completion — merged, deployed/verified where required, tracker evidence/backlink complete, and the work item terminal — by running `node scripts/lisa-work-item.mjs clear` and verifying no current binding remains.
- A held filing writes no binding at all, so there is nothing to clear. The gate is released by a human decision, but not by a human edit: the person records the decision as a comment on the leaf beginning `[lisa-human-gate-release]` and, for a keyed hold, repeating its `reason=` verbatim. For a keyless hold, the comment begins `[lisa-human-gate-release]` without a `reason=` field. The next intake sweep takes the human-needed marker off and puts the leaf back in the build-ready role on its own (`planHumanGateRelease` in `scripts/intake-blocker-reprobe.mjs`). A later invocation then resolves it on the ordinary path. **Do not tell anyone to delete the marker from the description, and do not delete it here.** The only description write available is a whole-body replacement, so clearing one line means rewriting the entire record — which is why, before this, the rational move was always to leave a hold in place and answered holds only accumulated (CodySwannGT/lisa#3852). The hold stays in the body as history; the release is recorded beside it.
- A tracker outage, invalid item, failed claim, or failed binding blocks durable work. Never continue untracked and never ask a Git hook to create the item.
