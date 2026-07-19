# Promotion Contract

When a learnings-ladder promotion ticket (PRD #1729) is implemented — turning a
prose learning, rule section, or ledger entry into an **executable control**
(lint, ast-grep, type constraint, test, hook, or `package.lisa.json` force) —
the implementing PR is governed by this contract. The gardener
(`lisa-learnings-audit`) files the tickets; a human gates them by flipping
`status:ready`; the factory implements them like any other work item. This rule
is what makes the resulting PR reviewable **by rule, not by reviewer taste**.

## The atomic promote-and-delete contract

A promotion PR must do **all four** of the following, in **one atomic PR**:

1. **Enable the control.** The lint rule, ast-grep pattern, type constraint,
   test, hook, or `package.lisa.json` force entry is active and blocking (CI
   and/or local gates), not merely added in a warn-only or disabled state.
2. **Fix the existing violation population.** Every current violation of the
   new control in the repository is migrated in the same PR, so the control
   lands green. Enabling a control against a red population either blocks all
   unrelated work or forces a blanket ignore — both defeat the promotion.
3. **Ship a remediation-teaching diagnostic.** The control's failure message
   meets the diagnostic-quality bar below. The prose being deleted is not
   lost — its content is **relocated into the error message**, so the agent
   that trips the control learns the rule at exactly the moment it matters.
4. **Delete the superseded prose.** The ledger entry, rules-file section,
   memory note, or wiki duplication that the control replaces is removed in
   the same PR. Keeping both means every session keeps paying context tax for
   knowledge the machine already enforces.

**A PR missing any of the four is rejected by rule.** Reviewers (human, bot,
or verification lifecycle) cite this contract and reject — no case-by-case
judgment call is needed. The failure modes are structural, not stylistic:

- **Promote-without-remove double-pays forever**: the control enforces the
  invariant while the prose keeps taxing every session, and the two drift
  apart over time.
- **Remove-without-diagnostic strands agents**: the prose is gone, the control
  fires, and the violator has no idea what invariant it tripped or how to
  repair it.
- **Enable-without-population-fix** reds the build for everyone or breeds
  blanket ignores that hollow the control out.

The same atomicity applies in reverse to **retirements** the gardener batches:
a prose deletion whose invariant is claimed to be mechanically owned must cite
the owning control (rule name, config location) in the deleting PR.

## The diagnostic-quality bar

The error message must **teach the repair**, because it is the only surface
the violating agent will see. Every promoted control's diagnostic states:

1. **The violated invariant** — what rule was broken, named precisely.
2. **Why the invariant holds** — the causal story that used to live in the
   prose (the incident, the failure class, the platform behavior).
3. **The concrete fix** — what to change, ideally with the typical corrected
   form inline.

Example shape (from this repo's own lint conventions):

> "Direct `process.env` access is forbidden. Config values bypass validation
> and typing when read ad hoc (past incidents: silent `undefined` in Lambda
> cold starts). Use the config module: `getStandaloneConfig().myValue`."

A diagnostic that merely restates the rule name ("no-direct-env: direct env
access is not allowed") fails the bar and fails the promotion PR with it.

## Eager-tier admission policy (demotion-biased)

The eager rules tier (auto-loaded rules trees) charges **every session,
unconditionally**. Admission is therefore **earned, never defaulted**:

- A rule enters (or stays in) the eager tier only on cited **repeated-miss
  evidence** — the knowledge was already retrievable (ledger, wiki, skill,
  reference body) and agents still failed repeatedly because they did not
  know to look. Absent that evidence, the content belongs on a cheaper rung.
- The policy is **demotion-biased**: when in doubt, move down the ladder.
  A wrongly demoted rule earns its way back with fresh failure evidence; a
  wrongly admitted rule taxes every session until someone notices.
- The gardener audits the eager tier **every run** — and that audit includes
  **Lisa's own shipped eager rules**, not just host-project additions. No
  rule is grandfathered; kernel rules demonstrating no repeated-miss evidence
  get demotion tickets like any other candidate, filed upstream
  (`template-candidate` or `self-hardening` lane as applicable).

## AC template for EXECUTABLE-CONTROL promotion tickets

The gardener embeds the following snippet **verbatim** (markers included) into
the acceptance criteria of every EXECUTABLE-CONTROL promotion ticket, so
implementing agents receive the contract inside the work item itself:

<!-- promotion-contract-ac-template:start -->
### Acceptance Criteria (promotion-to-control contract)

One atomic PR that satisfies all four legs — a PR missing any of the four is
rejected by rule (see the `promotion-contract` rule):

- [ ] **Enables the control** — the lint / ast-grep / type constraint / test /
      hook / `package.lisa.json` force entry is active and blocking.
- [ ] **Fixes the existing violation population** — every current violation is
      migrated in this same PR, so the control lands green with no blanket
      ignores.
- [ ] **Ships a remediation-teaching diagnostic** — the failure message states
      the violated invariant, why it holds, and the concrete fix.
- [ ] **Deletes the superseded prose** — the ledger entry / rules section this
      control replaces is removed in this same PR, citing the new mechanical
      owner.
<!-- promotion-contract-ac-template:end -->

Do not paraphrase, reorder, or partially quote the snippet when embedding it —
verbatim embedding is what keeps the contract identical across every ticket
and lets reviewers diff against a single source of truth.

## Who consumes this rule

- **Implementing agents** working a promotion ticket: structure the PR around
  the four legs before writing code.
- **Review flows** (human, CodeRabbit, `lisa-pull-request-review`,
  verification lifecycle): reject a promotion PR missing any leg, citing this
  rule.
- **The gardener** (`lisa-learnings-audit`): embeds the AC template above into
  EXECUTABLE-CONTROL promotion tickets and applies the eager-tier admission
  policy when auditing.
- **PROJECT_RULES.md owners**: that file is human-authored only; machine
  writes go to the learnings ledger, and promotions out of it arrive as
  gardener tickets governed by this contract.
