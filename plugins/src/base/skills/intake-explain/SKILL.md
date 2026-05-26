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

## Gate and ownership expectations

The explanation must stay aligned with existing Lisa rules:

- If a build item is a parent/container or a childless Epic/Story/Spike, explain the leaf-only gate and say direct build pickup is not allowed.
- If a build item has active blockers, list the blocker refs and explain that intake would hold or skip it until they clear.
- If a PRD is in a product-owned role such as `draft`, `shipped`, or `verified`, explain why intake or repair will not mutate it.
- If a claimed, in-review, or blocked item is not yet repairable, explain the relevant staleness or backoff condition at a human-readable level.
- If the repo or lifecycle namespace is unresolved, report `MISCONFIGURED` instead of pretending the item is idle or actionable.

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

## Rules

- Stay **read-only**. Never claim, relabel, transition, comment on, create, decompose, or repair work from this skill.
- Keep the explanation repo-scoped to the current project rather than aggregating unrelated repos or trackers.
- Reuse intake and repair-intake contract semantics so diagnosis and execution do not drift.
- Prefer existing vendor read surfaces and validators over creating a second lifecycle engine.
- If the current runtime or vendor surface cannot expose a needed signal, say that explicitly instead of guessing.
