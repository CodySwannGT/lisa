---
name: lisa-track
description: "Find or create exactly one live tracker ticket for durable project work, claim it, and remember it for this worktree. Takes a ticket ref, a spec file, or plain text. lisa-implement's first step; also use it directly to file related work."
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

For accepted work this flow must return exactly one canonical `(tracker_provider, work_item_ref)` pair or fail closed. A declined incidental finding returns only its reason and authorizes no durable implementation. It never returns an unvalidated textual guess.

## Worth doing

Before filing, promoting, or claiming an incidental finding, ask whether the expected benefit justifies implementation, verification, maintenance, CI, and operator attention. Use the evidence already available; no numeric score, new tracking system, or speculative audit is required.

- **Act** on concrete delivery failures, incorrect results, credible material security or data-loss risks, and recurring friction whose repair is worth its cost. A small fix can have a large consequence; security need not wait for an incident.
- **Bundle** related small repairs when one bounded maintenance task is worth doing. Reuse an existing relevant item where possible. Do not expand unrelated work or create one ticket per wording fix.
- **Decline** cosmetic preferences, speculative edge cases, duplicate controls, or changes whose likely benefit is smaller than their ongoing cost. Acceptable as-is is a valid engineering decision. Say why briefly in the current report, review, or issue; do not create a ticket, ledger entry, new rule, or human gate merely to record a declined observation.

A reproducible imperfection proves that something happens, not that it deserves factory capacity. A complete specification establishes buildability, not value. Missing enforcement or test coverage alone does not justify new machinery; name the required behavior or credible consequence at risk. Honor explicit user requests, accepted product requirements, and material safety obligations. This rule cannot silently cancel those commitments or excuse failing required checks.

## Prefer less machinery

Start with the smallest sufficient correction at the owning component. Consider removing or consolidating redundant machinery before adding a hook, workflow, abstraction, registry, or test framework. Preserve required behavior and protection, and verify the consequence of the change. An isolated failure does not automatically justify a permanent control for every future session.

For an existing incidental item, read its discussion, linked PRs and dependencies before declining. Close as **Not planned** (configured Jira/Linear equivalent), give the reason, and remove active lifecycle labels. Preserve human holds and committed scope unless cancellation is authorized; resolve effects on active PRs and dependent delivery first. Before re-filing, search open AND closed issues, read legacy unmarked matches, and require materially changed consequences that address the earlier reason. A later observation of the same accepted limitation is insufficient.

## Phase 1 — Resolve tracker and classify input

1. Resolve merged `.lisa.config.local.json` over `.lisa.config.json` exactly as `lisa-tracker-read` / `lisa-tracker-write` do. Missing, unknown, or incomplete tracker configuration is a blocking error.
2. Classify `$ARGUMENTS` as exactly one of:
   - an explicit reference matching the configured tracker (`KEY-123`, `org/repo#123` or issue URL, Linear team identifier);
   - an existing file path containing a specification (read the entire file, without offset/limit);
   - plain-text work description.
3. Detect the caller's readiness declaration, which is orthogonal to the classification above. Absent any declaration this is the default build-ready path. A caller deliberately holding the work because it needs an act an agent cannot perform (an access act: `credential` (complete a login or supply a credential only a person holds), `spend`, `external-account`, `legal-signoff` (sign a legal agreement on the company's behalf), `person-only-account` (a protected deployment, a required reviewer, an account only a person holds), `unreachable-system`, or `operator-hold` (a hold the operator explicitly asked for); `human-authored-surface` (an edit to a surface declared human-authored, which no agent writes: an authorship rule, valid in both modes); `own-dependency-copy` (approve maintaining our own fork, patch or vendored copy of an open-source library, the last rung of the `lisa-security-audit-handling` ladder, valid in both modes); or a decision class the project declared human-only (`humanGate.humanOnly`). Under `humanGate.mode: "strict"` the strict-only acts `compliance-signoff`, `accountable-person` and `lisa-policy` also count) passes `human_gate: "<the act a person must perform>"`. A choice with a reasonable default is not a gate: decide it, record the decision on the item, and take the build-ready path (`ready-role-filing`, "What a human gate is"). The writer refuses a topic-only reason with exit 1 from `scripts/human-gate-act.mjs check`; the two declarations are mutually exclusive and a `human_gate` present but empty is a blocking error, because an unexplained hold is indistinguishable from an accident.
4. Preserve the full resolved specification for the caller. Do not treat a ticket-like token for a different provider/project as plain text; report the mismatch.

## Phase 2 — Resolve one live work item

### Explicit reference

Invoke `lisa-tracker-read <ref>` and require a live result from the configured project. Reject nonexistent, inaccessible, closed/resolved/terminal, wrong-project, wrong-repository, or container items. Read the returned body, labels and all comments; Phase 3 uses the shared hold classifier so a historical `[lisa-human-gate]` marker with a matching release is not mistaken for an active hold. This live read is mandatory even if caller context already includes ticket text.

### File or plain text

For incidental findings, apply `do-it-now` before resolving a new leaf. If the finding is declined, return the reason without creating or claiming anything; durable implementation does not start. Explicit user requests and accepted requirements remain in scope.

Search conservatively before creating:

1. Normalize the requested outcome and derive a short keyword set; never search with the whole prompt or secrets.
2. Search open AND closed items in the configured project and current repository through the configured provider's documented read surface. Closed items supply decision history, never an active binding:
   - GitHub: `gh issue list --repo <org>/<repo> --state all --search "<keywords> in:title,body"`.
   - Jira: `lisa-atlassian-access operation: search-issues` with project-scoped JQL and no status filter.
   - Linear: `lisa-linear-access operation: list-issues` scoped to the configured team/workspace and including all states.
3. Treat search results as candidates, never proof. Live-read each plausible candidate and its discussion through `lisa-tracker-read`. Apply `rejection-detection` to prior **Not planned** decisions, including legacy unmarked matches, before creating: suppress the same accepted limitation unless materially changed post-decline evidence addresses its reason, with the required token and acknowledgment in any new item. A completed fix may have a verified regression. For active binding, discard terminal, container, blocked, held-by-gate, cross-repo, and materially different outcomes. A held candidate is never reused: attaching new work to an item a human is holding is how the hold gets spent.
4. Reuse only when **exactly one** live leaf is a high-confidence semantic match for the same requested outcome and repository. A shared keyword or similar title is not enough. Record the search queries, candidates, and rejection reasons in the returned resolution evidence.
5. If there is no unique high-confidence match (zero or ambiguous candidates), create **exactly one** item by invoking `lisa-tracker-write` once. Synthesize one complete single-repository leaf (`Bug`, `Task`, `Sub-task`, or `Improvement`, never Epic/container) with the writer's required three-audience body, Gherkin acceptance criteria, repository, target environment, relationship search, and executable Validation Journey. Pass `build_ready: true` unless the caller declared a `human_gate`, in which case pass that `human_gate: "<why>"` reason instead of `build_ready: true` and never alongside it, so the writer leaves the leaf in the tracker's default backlog role — out of the lane build-intake claims from — and stamps the hold on the body as a `[lisa-human-gate]` marker. Discarding a declared gate and filing build-ready anyway is the one outcome this step must never produce. Do not create placeholder/thin tickets, do not create a hierarchy, and do not retry creation by making another item if validation fails; repair the proposed spec and retry the same writer operation only if the vendor contract supports idempotent reuse.
6. Live-read the writer's canonical returned reference with `lisa-tracker-read`. A create response without a verified live leaf is failure.

This is intentionally conservative: ambiguity creates one explicit work item instead of silently attaching work to the wrong existing item. Across the entire invocation, at most one new work item may be created.

## Phase 3 — Claim and bind

### CI-rework route (first, before any claim write)

Decide the dispatch route from the item's comments as they stand **before** this phase writes anything (CodySwannGT/lisa#4677). When the configured tracker is `github` **and** `scripts/lisa-ci-rework-route.mjs` exists at the repository root, run it from the repository root:

```bash
node scripts/lisa-ci-rework-route.mjs --item <canonical-ref>
```

It only reads, and prints one JSON object. It is the one place the trust rules live, shared with `lisa-github-build-intake` 3b so the two dispatch paths cannot disagree: the newest counted Lisa marker must be an uncleared `[lisa-ci-failed]` marker authored by `github-actions[bot]` — claim comments and session-manager notes (`[lisa-tracker-claim]`, `[claude-build-intake]`, `[lisa-session-manager]`) never count as Lisa markers for this purpose, failure markers count only from `github-actions[bot]`, and any other later Lisa marker counts only from a trusted author — `github-actions[bot]`, the item's author, or a configured `sessionManager.trustedAuthorIds` entry; only entries committed in `.lisa.config.json` count, never `.lisa.config.local.json`, because the producer runs in CI on a fresh checkout, and the account Lisa posts as counts as trusted only when it is the item's author or is listed in `sessionManager.trustedAuthorIds` — and the pull request it names must be open, from this repository rather than a fork, and bound to this item by its `Work-Item:` line. Act on its `route`:

- When `route` is `implement` (any `reason`): resolve and claim the item the normal way below, and return `route: implement`.
- When `route` is `ci-rework`: return `route: ci-rework pr=<n>`, `failing_checks` and `head_ref` (the JSON's `pr`, `failingChecks` and `headRefName`). Continue through the hold check and the claim below unchanged: the claim is what moves the item from the ready lane back to the claimed lane, the same re-claim build intake 3b performs, and the binding names the same item. A ci-rework item is CI rework, not a rejection: it takes no rejection detection and records no rejection learning (the `rejection-detection` rule's CI-rework exemption).
- When `route` is `blocked` (`reason: ci-loop-bound`, 3 or more bot-authored `[lisa-ci-failed]` markers for the same PR): first run the hold check below; if the item is held, return its `held-by-gate` outcome and stop without changing labels or posting anything. Otherwise do not claim and write no binding — the same loop bound build intake 3b applies. Move the item to the configured blocked role from whichever lane it is in: remove the configured ready and claimed labels if present (`github.labels.build.ready`, `github.labels.build.claimed` — on the session-manager path the item is already claimed), then apply the configured blocked role and the `human_needed` label (`github.labels.build.blocked` and `github.labels.build.human_needed`, per `config-resolution`), post a plain-English comment naming the PR and its failing checks (for example: "Pull request #<n> has failed its required checks <k> times (<check names>). Lisa has stopped retrying; a person needs to look at why it keeps failing."), return `route: blocked pr=<n>`, `claim_outcome: blocked-ci-loop` and `binding_outcome: skipped-ci-loop`, then stop.

Skip this step silently and return `route: implement` when the tracker is Jira or Linear (only this repository's GitHub workflow writes the marker) or when the script is absent: `scripts/` at the Lisa repository root is not shipped to host projects, so a host never has the helper and never receives the marker. A non-zero exit or output that is not one JSON object is also `route: implement` — falling back to the normal path is always recoverable. A held item still stops at the hold check below, whatever its route.

**Why claim comments are ignored.** On the session-manager path the manager has already claimed the item before the worker starts, so the helper runs after a claim and the claim below comes back `reused`; a re-claim can also post another claim comment. Claim comments are ignored for exactly that reason: an uncleared marker on an open, bound pull request still means that pull request is red, whoever has claimed the item since.

### Hold check and claim

The work item is **held** when the caller declared a `human_gate`, independently of any item history,
or `classifyReadyCandidate({ labels, body, comments, trustedHumanActorIds, humanNeededLabel, humanOnly, humanGateMode })` from the shipped
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
`planHumanGateRelease({ labels, body, comments, trustedHumanActorIds, humanNeededLabel, humanOnly, humanGateMode, readyLabel, lifecycleLabels, alreadyNotified })`
and apply only the returned actions before claiming. Keep the body marker as history; a release
never overrides a new caller-declared hold or another eligibility check.

Otherwise:

**Required-access preclaim gate.** Before this claim mutation, follow `tool-access-gate` → Task readiness. Enumerate the live body, all comments, proof and delivery requirements into the leading requirements-only header in the ignored context; run the existing secrets preflight `--task --ref <canonical-ref>`. `ESTABLISHED` proves only its exercised scope. `DENIED` stops affected work. `NATIVE_OWNER_REQUIRED` (CLI exit3, not PASS) hands the remaining route to its documented native access owner: that owner must perform the actual immediate identity/resource probe before claim or the affected continuation, retaining write/readback duties. Do not repeat an unobservable shell probe forever or accept a stored passed field. Report the exact shell/native enforcement gap. Only the bounded local intake metadata write may precede this gate. Held/leaf/scope/idempotency and failed tracker-read/write stops remain independent.

For a native tool without structured terminal stdin, use the exact canonical
ignored-context `Write` data adapter in `tool-access-gate`: supply the validated
leading requirements-only header and complete unedited body as tool data. The
existing atomic0600 owner prepares that file and DENIES the redundant raw Write
with "Context prepared; run readiness". Read back the context, then run readiness;
do not retry the raw Write or put private context/comments into Bash/heredoc argv.
The permission to load Write does not authorize other files or bypass the guard.

1. Invoke `lisa-tracker-claim <canonical-ref>`. Require its post-read verified `claim_outcome: claimed|reused`; no binding may be written after a failed/unverified claim.
2. Persist only the canonical reference in worktree-local machine state:

   ```bash
   node scripts/lisa-work-item.mjs link <canonical-ref>
   ```

3. Read the binding back through `node scripts/lisa-work-item.mjs current` and require it to equal the canonical reference. If binding fails, stop before durable project work.
   - A detached-HEAD worktree is valid at this stage: the binding records `branch: null` as a pending state. Create the feature branch only after the gate succeeds, then run `node scripts/lisa-work-item.mjs attach-branch`. Commit preparation and validation fail closed until that attachment succeeds.
4. **Token estimate before any work** (`work-item-definition-of-ready`, gate S21; contract in the `lisa-usage-accounting` skill's `references/estimate.md`). Write the item's live body to a scratch file and run `node scripts/lisa-estimate.mjs check --phase claim --body-file <file>`. Exit 0 (`PASS`, or `N/A` because `workItem.estimate.required` is `false`) → continue. Exit 1 because the estimate is missing → estimate it now, yourself; never ask a person and never stop for one:
   1. Pick a first token range and a recommended model from `workItem.estimate.models` (`node scripts/lisa-estimate.mjs config` prints them) by reading the item: scope, files it touches, type, how much verification it needs.
   2. Calibrate it. Fetch the bodies of up to 20 comparable finished items in this repository — same type, closed or done, carrying a `## Lisa Estimate` section — as a JSON array (GitHub: `gh issue list --repo <org>/<repo> --state closed --label <type label> --search '"Lisa Estimate" in:body' --limit 20 --json body`. Jira and Linear projects can serve several repositories, so scope those searches to this one by its `repo:<name>` label (the repo marker in the `config-resolution` rule; `<name>` is this repository's short name). Jira: through `lisa-atlassian-access`, `operation: search-issues jql:"project = <KEY> AND labels = \"repo:<name>\" AND issuetype = <type> AND statusCategory = Done AND text ~ \"Lisa Estimate\" ORDER BY resolved DESC"`, the first 20. Linear: through `lisa-linear-access`, `operation: list-issues team:<ID> label:repo:<name> state_type:["completed"]`. A listing may not carry full descriptions and has no body search, so read each candidate with `lisa-linear-access` `operation: get-issue id:<ID>` and keep the first 20 that carry the item's type label and a `## Lisa Estimate` section in that full description. Save each item's description as markdown text in `[{"body": "..."}]`). Run `node scripts/lisa-estimate.mjs calibrate --tokens-low <n> --tokens-high <n> --history-file <file>` and use the range and `basis` it prints. With no history it says so; keep your range.
   3. Render and write it: `node scripts/lisa-estimate.mjs render --tokens-low <n> --tokens-high <n> --model <id> --basis "<basis>" --body-file <file>` prints the whole body with the section in place. Write that body back through `lisa-tracker-write` (update), read the item back, and rerun the claim-phase check on the stored body; it must exit 0.

   Exit 1 because a present estimate is malformed → re-render it the same way.

   An estimate failure never blocks the work. The item is already claimed, and stopping here would strand it in the claimed state with no trace of why. When a check exits 2, calibration or rendering fails, or the written body does not read back with a passing claim-phase check, continue to step 5 with `estimate_outcome: failed` and `estimate_failure: <reason>`, and post one comment on the item through `lisa-tracker-write` that a non-technical reader can follow, for example: "Lisa could not record a cost estimate for this item before starting work, because the project's estimate settings could not be read. The work is going ahead without one. What it actually cost will still be recorded when it is done." Name the real reason in plain words, not an exit code. Record `estimate_outcome: present|written|failed|n/a` in the result.
   **Release switch before any work** (`work-item-definition-of-ready`, gate S22; `coding-philosophy`, "Always Promotable"). Run `node scripts/lisa-release-switch.mjs check --existing true --body-file <file>` on the same stored body. `PASS`, or `N/A` because the item changes no runtime behavior or the project sets `release.liveUsers: false` → continue. `N/A` with a repair note (a runtime-changing item with no `## Release Switch` section) → decide it now, yourself, with one question: if this were promoted to production right now, would a user see something unfinished or unproven? If no, the work is live (bug fixes, small tweaks, copy changes, refactors and dependency updates almost always are; the question decides, not the kind of work); if yes, it is switched off behind a switch you name, removed by this item unless a later item of the same feature removes it. A new name must appear nowhere else in the repository: `node scripts/lisa-release-switch.mjs references --switch <name>` must report none. Render it with `node scripts/lisa-release-switch.mjs render --mode live --body-file <file>`, or `--mode off --switch <name> --removed-by "this item"` when this item removes the switch, or `--removed-by <work-item ref>` naming the later item when that one does (writing `this item` on an earlier item would make it look like the remover, and the remover is the item that turns the feature on). Write the body back through `lisa-tracker-write` (update), and re-run the check on the stored body. `FAIL` (a malformed declaration) → re-render it the same way; if the check still fails because other text follows the declaration in that section, move that text into another section. Never ask a person which form applies. For work you judged live, a failure to write the declaration never blocks the work: continue with `release_switch_outcome: failed` and post one plain-English comment saying why. For work you judged switched off, the declaration must be on the item before any work starts, because without it the item is treated as live and the done gate cannot hold its switch: a declaration that cannot be put on the item (the tracker write fails, or `render` refuses the body) stops the flow here. Keep the claim and the binding so the item stays attributable, post one plain-English comment saying the declaration could not be written and why, record `release_switch_outcome: failed`, and report it as a tracker write failure. Record `release_switch_outcome: present|written|failed|n/a` in the result. Where the script is absent (a host that has not received it yet), record `n/a`.
5. **Ignore guard before any write.** A host can receive these skills before its shipped `.gitignore` entry, so prove the path is ignored first, from the worktree root: `git check-ignore -q .lisa/work-item-context.md || printf '%s\n' '.lisa/work-item-context.md' >> "$(git rev-parse --git-common-dir)/info/exclude"`, then re-run `git check-ignore -q .lisa/work-item-context.md`. If it is still not ignored, stop and report — do not write the bundle. If an `.easignore` exists and `grep -qxF '.lisa/work-item-context.md' .easignore` fails, stop and report instead of writing: EAS uploads read `.easignore`, which is derived from `.gitignore`, not from `info/exclude`. Keep the preclaim full vendor context and requirements header intact. Append the complete post-claim live read without trimming earlier body/comments, then refresh that same header through the preflight owner's `--prepare` mode and recheck task readiness. The live vendor read bundle stays unedited, every comment included, in the worktree-local, git-ignored `<worktree root>/.lisa/work-item-context.md`, then return this structured result (the file is the context; a summary in the reply never substitutes for it). When a `caller_bundle_path` was forwarded for this work item and the file already exists, do not overwrite it — it holds the caller's bundle (or a previous run's) and is left for the resolver step. Otherwise this is the first write; when `lisa-implement` forwarded a `caller_bundle_path`, its resolver step then keeps the bundle at that path as the base and appends only what this live read adds, and in every case finishes it with the `## Comment inventory` section:

   ```text
   tracker_provider: jira|github|linear
   work_item_ref: <canonical-ref>
   resolution_outcome: explicit|reused|created
   readiness_declaration: build-ready|human-gate
   held_by: none|caller-declaration|item-marker
   gate_reason: <the act a person must perform>|null
   claim_outcome: claimed|reused|held-by-gate|blocked-ci-loop
   binding_outcome: verified|skipped-human-gate|skipped-ci-loop
   estimate_outcome: present|written|failed|n/a
   estimate_failure: <plain-English reason>|null
   release_switch_outcome: present|written|failed|n/a
   route: implement|ci-rework pr=<n>|blocked pr=<n>
   failing_checks: <comma-separated check names from the marker comment>|none
   head_ref: <the pull request's head branch>|null
   work_item_context: <absolute path to .lisa/work-item-context.md>
   ```

## Lifecycle

- The binding is worktree-local, uncommitted machine state. Never write it into tracked source files.
- Branch setup may call `node scripts/lisa-work-item.mjs attach-branch` after the feature branch exists.
- Keep the binding across ordinary interruptions and blocked outcomes so resumed work remains attributable.
- Clear it only after true terminal completion — merged, deployed/verified where required, tracker evidence/backlink complete, and the work item terminal — by running `node scripts/lisa-work-item.mjs clear` and verifying no current binding remains.
- A held filing writes no binding at all, so there is nothing to clear. The gate is released by a human decision, but not by a human edit: the person records the decision as a comment on the leaf beginning `[lisa-human-gate-release]` and, for a keyed hold, repeating its `reason=` verbatim. For a keyless hold, the comment begins `[lisa-human-gate-release]` without a `reason=` field. The next intake sweep takes the human-needed marker off and puts the leaf back in the build-ready role on its own (`planHumanGateRelease` in `scripts/intake-blocker-reprobe.mjs`). A later invocation then resolves it on the ordinary path. **Do not tell anyone to delete the marker from the description, and do not delete it here.** The only description write available is a whole-body replacement, so clearing one line means rewriting the entire record — which is why, before this, the rational move was always to leave a hold in place and answered holds only accumulated (CodySwannGT/lisa#3852). The hold stays in the body as history; the release is recorded beside it.
- A tracker outage, invalid item, failed claim, or failed binding blocks durable work. Never continue untracked and never ask a Git hook to create the item.
