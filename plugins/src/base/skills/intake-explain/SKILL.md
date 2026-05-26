---
name: intake-explain
description: "Read-only operator surface for diagnosing one repo-scoped PRD or build item against Lisa's current intake and repair contracts. Resolves the item's queue family, lifecycle role, ownership boundary, and gate outcomes using the same source/tracker detection, lifecycle naming, leaf-only, dependency, staleness, and backoff semantics the write-side intake and repair flows already enforce."
allowed-tools: ["Skill", "Bash", "Read"]
---

# Intake Explain: $ARGUMENTS

`/lisa:intake-explain` is the operator-facing explanation surface for one specific item in the **current repo or project**. It answers the per-item diagnosis question Lisa's batch flows intentionally do not answer directly: what lifecycle lane the item belongs to, which Lisa rule or gate applies right now, whether the item is eligible for intake or repair, and what the next relevant action should be.

This command is **read-only** in v1. It does not claim, relabel, repair, transition, comment on, decompose, or otherwise mutate the item. It complements `/lisa:intake`, `/lisa:repair-intake`, `/lisa:queue-status`, `/lisa:automation-status`, and tracker-native inspection; it does not replace them.

## Confirmation policy

Do **not** ask for confirmation once invoked. This skill inspects one item and reports what the current Lisa contract says about it. There are no write-side effects in the v1 surface.

## Scope

Inspect exactly one repo-scoped item reference:

- a GitHub issue URL or `owner/repo#123` ref
- a Linear issue or project URL
- a JIRA issue key
- a Notion PRD/item URL
- a Confluence PRD page URL

The skill must determine whether the item belongs to the PRD lifecycle or the build lifecycle, then explain the item's status using the **same contract** Lisa already uses for `/lisa:intake` and `/lisa:repair-intake`. Do **not** invent a second source of truth for queue detection, lifecycle role naming, repo scoping, or repair eligibility.

## Operator usage

Typical entrypoints:

```text
/lisa:intake-explain https://github.com/acme/repo/issues/123
/lisa:intake-explain owner/repo#123
/lisa:intake-explain ENG-123
/lisa:intake-explain https://linear.app/acme/issue/ENG-123/example
```

Use this command when an operator needs one deterministic answer to questions like:

- "Would Lisa intake this item right now, or skip it?"
- "Is this state still product-owned, or has it crossed into a Lisa-owned lane?"
- "Is repair eligible yet, or am I still waiting on staleness or backoff?"
- "Is the real next step `/lisa:intake`, `/lisa:repair-intake`, blocker cleanup, decomposition, or manual product clarification?"

Keep the diagnosis terminal-first and human-readable: observable item facts first, then the smallest useful next command or manual action.

## Contract reuse

Resolve item family, queue source/tracker, and lifecycle role names from `.lisa.config.json` plus the same defaults the active intake and repair flows already consume.

Route one-item diagnosis through the same contract surfaces the write-side flows already trust:

- determine whether the item belongs to the configured PRD **source** lane or build **tracker** lane using the same `source` / `tracker` settings that `/lisa:intake` and `/lisa:repair-intake` already resolve
- read vendor lifecycle role names from the same config keys and fallback defaults documented in the `config-resolution` rule rather than inventing hardcoded status names
- keep repo/project scoping aligned with the same current-repo detection and queue-target rules the active intake scanners use

When the runtime can identify the item but cannot confidently resolve its source lane, tracker lane, lifecycle namespace, or current repo/project scope from that contract, report `MISCONFIGURED` instead of guessing.

Reuse the existing execution-side semantics instead of recreating them by hand:

- queue/source detection and lifecycle naming from intake + repair-intake
- one-item routing helpers for resolving the item's queue family against the correct source/tracker contract
- product-owned versus Lisa-owned lifecycle roles
- leaf-only and repo-scope build eligibility
- active dependency holds
- repair staleness thresholds and activity signals
- repair backoff / loop-prevention suppression

Work from the same vendor families Lisa already supports for intake and repair: GitHub, Linear, JIRA, Notion, and Confluence.

## What to report

Render a stable terminal-first diagnosis for one item:

1. Item identity and resolved lifecycle family (`PRD` or `BUILD`).
2. The current lifecycle role and whether that role is product-owned or Lisa-owned.
3. The exact rule, gate, or ownership boundary currently driving behavior.
4. A verdict such as `ELIGIBLE_FOR_INTAKE`, `ELIGIBLE_FOR_REPAIR`, `WAITING_ON_STALENESS`, `HELD_BY_BLOCKERS`, `NON_LEAF_CONTAINER`, `PRODUCT_OWNED_STATE`, or `MISCONFIGURED`.
5. The smallest useful next action, such as `/lisa:intake`, `/lisa:repair-intake`, decomposition, blocker resolution, or manual product clarification.

Keep observable item facts separate from the recommended next step so operators can tell what Lisa knows versus what Lisa suggests.

## Verdicts and next actions

Use verdicts as stable operator language, not as an excuse to dump raw tracker state:

- `ELIGIBLE_FOR_INTAKE`: the item is in the correct actionable lane and Lisa could pick it up with `/lisa:intake`.
- `ELIGIBLE_FOR_REPAIR`: the item is Lisa-owned, stale or stuck enough to qualify for `/lisa:repair-intake`, and repair suppression rules are not currently preventing action.
- `WAITING_ON_STALENESS`: the item is Lisa-owned but too fresh to repair yet; explain which activity signal or freshness window is still protecting it from a repair loop.
- `HELD_BY_BLOCKERS`: the item is otherwise actionable, but explicit blockers or dependency holds mean Lisa would wait rather than claim it.
- `NON_LEAF_CONTAINER`: the item is structurally a container, childless Epic/Story/Spike, or otherwise not directly buildable; explain that direct build pickup is disallowed until decomposition or reclassification happens.
- `PRODUCT_OWNED_STATE`: the item is currently in a product-owned role or pre-intake lane, so Lisa should not mutate it yet.
- `MISCONFIGURED`: Lisa could not resolve the item's queue, lifecycle namespace, repo scope, or another required contract signal confidently enough to explain actionability.

Each verdict must carry a concrete next action:

- Prefer `/lisa:intake` for `ELIGIBLE_FOR_INTAKE`.
- Prefer `/lisa:repair-intake` for `ELIGIBLE_FOR_REPAIR`.
- Prefer "wait and re-check later" for `WAITING_ON_STALENESS`.
- Prefer blocker resolution for `HELD_BY_BLOCKERS`.
- Prefer decomposition or type correction for `NON_LEAF_CONTAINER`.
- Prefer manual product clarification or the upstream product workflow for `PRODUCT_OWNED_STATE`.
- Prefer fixing config, lifecycle adoption, or repo scoping for `MISCONFIGURED`.

## Ownership and repair readiness

Classify ownership before recommending any command. Intake-explain should make clear whether the item is waiting for a human/product promotion, already belongs to Lisa automation, or is terminal enough that normal intake should leave it alone.

Product-owned roles are roles that Lisa must not mutate from this read-only diagnosis and that normal intake/repair should not "fix" just because the item exists:

- PRD `draft`: still being authored; next action is manual product clarification or promotion to `ready`.
- PRD `shipped`: generated work is complete and the next automated owner is `/lisa:verify-prd`, not PRD intake or repair.
- PRD `verified`: empirically checked terminal state; no intake or repair action is required unless a human reopens scope.
- Build items with no build lifecycle role or without the configured current-repo scope: outside the build pickup lane until a human adopts the lifecycle label or fixes repo scoping.

Lisa-owned roles are roles where the framework has accepted responsibility for moving the item forward or surfacing a precise blocker:

- PRD `ready`: actionable for `/lisa:intake`.
- PRD `in_review`: already claimed by PRD intake; repairable only when the item is stale beyond `stale_after` and not suppressed by repair backoff.
- PRD `blocked`: Lisa asked for clarification or failed validation; repairable only when new answers, dependency changes, or other current signals make another validate-to-route pass materially different.
- PRD `ticketed`: generated work exists; normal PRD intake owns rollup toward `shipped`, while repair-intake may reconcile rollup drift when all generated top-level work is terminal.
- Build `ready`: actionable for `/lisa:intake` if repo-scope, leaf-only, and dependency gates pass.
- Build `claimed`: already claimed by build intake; repairable only when stale beyond `stale_after` and not protected by recent PR/check/comment activity.
- Build `blocked`: Lisa surfaced an implementation blocker; repairable only when every parsed blocker is cleared or the blocker fingerprint changed enough to justify a new attempt.
- Build `done`: terminal build role; repair-intake may only reconcile provider-native close-out drift, not re-run implementation.

Report repair readiness in this order:

1. If the role is product-owned, return `PRODUCT_OWNED_STATE` and name the product or verification workflow that owns the next move.
2. If the item is Lisa-owned but in an in-progress role, compare the newest activity signal with the configured staleness threshold. Fresh activity returns `WAITING_ON_STALENESS`; stale activity can return `ELIGIBLE_FOR_REPAIR`.
3. If the item is Lisa-owned but blocked, evaluate current blockers, clarifying answers, and the `[lisa-repair-intake]` fingerprint/backoff window. Active blockers or unchanged fingerprints stay held; cleared blockers or new answers can return `ELIGIBLE_FOR_REPAIR`.
4. If the item is ready for first pickup, run the same repo-scope, leaf-only, and dependency checks used by intake before returning `ELIGIBLE_FOR_INTAKE`.

## Gate and ownership expectations

The explanation must stay aligned with existing Lisa rules:

- If a build item is a parent/container or a childless Epic/Story/Spike, explain the leaf-only gate and say direct build pickup is not allowed.
- If a build item has active blockers, list the blocker refs and explain that intake would hold or skip it until they clear.
- If a PRD is in a product-owned role such as `draft`, `shipped`, or `verified`, explain why intake or repair will not mutate it.
- If a claimed, in-review, or blocked item is not yet repairable, explain the relevant staleness or backoff condition at a human-readable level.
- If the source lane, tracker lane, repo/project scope, or lifecycle namespace is unresolved, report `MISCONFIGURED` instead of pretending the item is idle or actionable.

## Build item gate diagnosis

For build lifecycle items, run the same read-side checks that build intake runs before it would claim an issue. This is still a read-only explanation: if execution intake would stamp repo labels, split a cross-repo leaf, move a stale container from `ready` to `claimed`, or post a dependency-hold comment, intake-explain reports what intake would do but does not stamp, does not split, does not move labels, and does not comment.

Resolve the current repo using the same repo-scope contract as build intake: local config `repo`, then `.lisa.config.json` `github.repo`, then the git remote basename. Resolve the build lifecycle roles from `.lisa.config.json` `github.labels.build.*` with the usual defaults (`status:ready`, `status:in-progress`, `status:blocked`, `status:done`, plus any configured env-specific done labels). If those signals cannot be resolved, return `MISCONFIGURED`.

For GitHub build items, collect these reader signals before choosing a verdict:

- current build lifecycle role label and any conflicting `status:*` labels
- `repo:<current>` / `repo:<other>` labels, including whether the item is unlabeled for repo scope
- type labels such as `type:Epic`, `type:Story`, `type:Spike`, `type:Bug`, `type:Task`, `type:Sub-task`, and `type:Improvement`
- native GitHub sub-issues and their open/closed state
- body parentage used by `github-read-issue`, including task-list child references and `Parent: #123` style references
- explicit dependency holds from `Blocked by: #123`, comma-separated refs, `owner/repo#123`, and GitHub issue URLs
- blocker issue state and blocker status labels

Apply gate verdicts in the same order as build intake:

1. **Repo-scope gate.** A build item carrying `repo:<other>` and not `repo:<current>` is outside this repo's pickup lane. Return `MISCONFIGURED` when repo scope is absent or contradictory enough that the current repo cannot be determined confidently; otherwise explain the repo-scope mismatch and recommend running intake in the target repo or fixing the `repo:<name>` label. For an unlabeled item whose target repo is obvious from the item body, report the inferred repo signal but stay read-only: execution intake would stamp `repo:<name>`, while intake-explain only says it would do so. A multi-repo leaf is not directly buildable; explain that execution intake would split it per `repo-scope-split`, but this read-only diagnosis does not split.
2. **Leaf-only gate.** If the item has open child work from native GitHub sub-issues or body parentage, return `NON_LEAF_CONTAINER` and explain that direct build pickup is leaf-only per `leaf-only-lifecycle`. If it has no open children but carries a container type (`type:Epic`, `type:Story`, or `type:Spike`), also return `NON_LEAF_CONTAINER` because a childless container type still needs decomposition or reclassification. The next action is decomposition, moving `status:ready` to leaf children, or correcting the issue type. Execution build intake would move such a stale ready container out of the pickup queue; this read-only diagnosis must not perform that repair.
3. **Dependency hold gate.** If a single-repo leaf for the current repo has explicit blockers, read each blocker. Closed blockers are clear. Open blockers are clear only when they carry a cleared build status such as `status:code-review`, `status:on-dev`, `status:on-stg`, `status:done`, or the configured done-equivalent labels. Open blockers with `status:ready`, `status:in-progress`, no cleared status label, or inaccessible state are active. Return `HELD_BY_BLOCKERS`, list the active blocker refs, and make the next action blocker resolution rather than `/lisa:intake`.
4. **Ready leaf.** A build item in the configured ready role, scoped to the current repo, with no open child work and no active blockers returns `ELIGIBLE_FOR_INTAKE`. The `Why:` line should say it is a single-repo leaf for the current repo and that leaf-only, repo-scope, and dependency gates all pass.

Relevant `Signals:` should include the decisive context, not every field: for example `repo:lisa; type:Sub-task; no open children`, `open children #12/#13`, `repo:api but current repo is web`, or `active blockers CodySwannGT/lisa#123`.

## Rule explanation expectations

The `Why:` line should name the decisive Lisa contract in plain English rather than only echoing a raw status label. Good explanations usually mention one of:

- the lifecycle role boundary (`product-owned` versus `Lisa-owned`)
- the leaf-only gate
- the repo-scope gate
- an active blocker or dependency hold
- staleness or repair-backoff suppression
- an unresolved config or lifecycle-adoption contract

The `Next action:` line should stay small and specific. Prefer one actionable follow-up over a menu:

- `/lisa:intake <queue>` when the item is ready for normal pickup
- `/lisa:repair-intake <queue>` when Lisa-owned stuck work is now repairable
- "resolve blocker `#123`" when a dependency hold is decisive
- "decompose into leaf tickets" when the issue is a non-leaf container
- "manual product clarification" when Lisa is not the current owner
- "fix `.lisa.config.json` or lifecycle labels" when the problem is misconfiguration

## Output shape

Use a stable grouped shape so one diagnosis is easy to scan:

```text
Item: <identity>
Lifecycle: <PRD|BUILD>
Role: <current role> (<product-owned|Lisa-owned>)
Verdict: <VERDICT>
Why: <rule or gate explanation>
Next action: <smallest useful follow-up>
```

When helpful, include one short `Signals:` or `Relevant refs:` line for the exact blockers, staleness timestamps, parent/child classification, or repair markers that justify the verdict.

One acceptable rendering pattern is:

```text
Item: CodySwannGT/lisa#123
Lifecycle: BUILD
Role: status:blocked (Lisa-owned)
Verdict: ELIGIBLE_FOR_REPAIR
Why: The issue is already in a Lisa-owned blocked lane, its last meaningful activity is stale, and no repair-backoff marker is suppressing a new repair pass.
Next action: /lisa:repair-intake github
Signals: blocker cleared; last activity 6d ago; repo:lisa
```

## Rules

- Stay **read-only**. Never claim, relabel, transition, comment on, create, decompose, or repair work from this skill.
- Keep the explanation repo-scoped to the current project rather than aggregating unrelated repos or trackers.
- Reuse intake and repair-intake contract semantics so diagnosis and execution do not drift.
- Prefer existing vendor read surfaces and validators over creating a second lifecycle engine.
- If the current runtime or vendor surface cannot expose a needed signal, say that explicitly instead of guessing.
