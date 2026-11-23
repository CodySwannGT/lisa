# Every shared branch is always promotable

Date: 2026-11-23

Status: Accepted. Built in [#5188](https://github.com/CodySwannGT/lisa/issues/5188).

Source: [Always-Promotable Source](../sources/repository/2026-11-23-always-promotable.md)

## Decision

A piece of work must never block a deployment. The statement every agent works to:

> **Always promotable.** Whatever is on a shared branch can be promoted to the next environment as it stands. Most changes meet this by being complete and proven when they merge, and need nothing more. Only new behavior that merges before it is finished or verified is switched off, and that switch is removed once it is. If the branch is not promotable, fixing or reverting that comes before any other work.

The established names for this are keeping the main line always releasable and separating deployment from release: code can be in production without being switched on.

## Context

Work arrives on a shared branch all day. Without this rule, promoting one environment to the next can turn into working out which changes are ready and cherry-picking them. The owner asked for a principle that makes promotion a single step.

## The rulings

1. **The switch is the exception.** Bug fixes, small tweaks, copy changes, refactors and dependency updates need no switch: they are complete and proven when they merge, and reverting is their off switch. One question decides: if this were promoted to production right now, would a user see something unfinished or unproven?
2. **A project can turn the rule off.** `release.liveUsers` in `.lisa.config.json` states whether the project has live users. Absent means it has, and the rule applies. A project that is not launched sets `false`. The setting is a fact about the project and not a switch for a rule, so the moment to change it is obvious: launch day. Turning it off also waives the requirement that database and API changes stay backward-compatible, because there are no users and no live data to protect. Lisa names the setting whenever a production deployment happens while it is `false`, and never blocks one.
3. **The mechanism is the project's.** A project names what it uses in `release.switch.mechanism` and may document its convention at `release.switch.guide`. With nothing named, agents use a plain configuration value that defaults to off. Lisa wraps no flag tool.
4. **It is enforced, not only stated.** Each runtime-changing work item declares how it is safe to promote, the readiness validators check the declaration, and completion refuses the item that removes a switch while the switch is still referenced.
5. **An agent turns a finished feature on.** Once verification passes, the agent turns the switch on in production. A project reserves that step for a person by listing `feature-release` in `humanGate.humanOnly`.
6. **A failed live change is reverted.** A change that merged without a switch and then fails verification on a shared branch is reverted at once and reworked. It is never fixed forward in place and never holds a promotion.

## Consequences

- Live work has to be proven before it merges, because it is live the moment it ships. Verification after the merge still happens; when it fails, the answer is a revert.
- A change that cannot be switched off must be safe on its own: database changes add before they remove, and API changes are additive.
- A switch must be settable per environment, on outside production while off in production, so switched-off work can be verified. A project with one environment verifies it locally or for a test account only.
- A switch is temporary. Removing it is part of finishing the feature, which is how this rule stays consistent with deleting replaced code and with carrying no technical debt.
- The always-loaded rule tier was full, so the statement there is a short rendering and the full text is in the reference rule. Four existing bullets in the same file were tightened to make room; nothing they require changed.

## What was not built

- No shared flag library, adapter or wrapper.
- No static analysis of database migrations. Each stack would need its own tool, and a legitimate removal step cannot be told apart from an unsafe one without knowing what is deployed. The obligation is stated in the rule and proven for each change.
- No expiry date or timer on the opt-out.

## Where it lives

- Rule: `coding-philosophy` (always-loaded bullet and the "Always Promotable" reference section).
- Settings: `config-resolution`, and the README section "Keeping every branch promotable".
- Work items: the `## Release Switch` section, gate S22 in the three validators, and `work-item-definition-of-ready`.
- Checks: `scripts/lisa-release-switch.mjs`, the completion checker, and the `Always-promotable setting` doctor check.
