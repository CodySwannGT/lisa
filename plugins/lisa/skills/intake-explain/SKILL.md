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

Reuse the existing execution-side semantics instead of recreating them by hand:

- queue/source detection and lifecycle naming from intake + repair-intake
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

## Gate and ownership expectations

The explanation must stay aligned with existing Lisa rules:

- If a build item is a parent/container or a childless Epic/Story/Spike, explain the leaf-only gate and say direct build pickup is not allowed.
- If a build item has active blockers, list the blocker refs and explain that intake would hold or skip it until they clear.
- If a PRD is in a product-owned role such as `draft`, `shipped`, or `verified`, explain why intake or repair will not mutate it.
- If a claimed, in-review, or blocked item is not yet repairable, explain the relevant staleness or backoff condition at a human-readable level.
- If the repo or lifecycle namespace is unresolved, report `MISCONFIGURED` instead of pretending the item is idle or actionable.

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
