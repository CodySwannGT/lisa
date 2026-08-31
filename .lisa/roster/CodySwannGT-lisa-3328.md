# Roster Decision — CodySwannGT/lisa#3328

## Governing constraint

The operator dispatching this flow constrained it explicitly to **one agent, no
subagents**. The runtime's delegation tool is present and functional, so this is
not the skill's "no team tool available" fallback — it is an operator override of
the team-first default, recorded here rather than silently taken.

Consequence, stated plainly so the audit is not misled: every specialist below is
EXCLUDED for the listed reasons — the operator constraint always, plus an
applicability note where one also applies — and the lead agent absorbed each
excluded role's obligations locally. Review, verification, and task tracking were preserved; the
*independence* that a separate reviewing agent provides was not. Two independence
properties this flow could not supply itself:

- The verification verdict is normally judged by an agent that did not implement
  the change. Here it is self-certified. It is marked as such in the verdict.
- Review findings normally arrive from an agent with no stake in the diff. Here
  the only genuinely independent review is CodeRabbit on the pull request.

Note the distinction from the fix itself: the *independent readback* this issue
requires is independent in the sense the acceptance criterion means — a fresh
tracker read rather than a write's own return value — and that property is
unaffected by the roster constraint.

## Decisions

- EXCLUDE - Explore - Operator constraint: no subagents. Codebase search performed inline by the lead; the writer, its contract resolver, its test harness, and every shipped copy were located and read directly.
- EXCLUDE - general-purpose - Operator constraint: no subagents.
- EXCLUDE - Plan - Operator constraint: no subagents. Implementation approach designed inline.
- EXCLUDE - claude - Operator constraint: no subagents.
- EXCLUDE - claude-code-guide - Operator constraint: no subagents; also not applicable, this is a repository defect rather than a harness question.
- EXCLUDE - lisa:bug-fixer - Operator constraint: no subagents. This is the role the lead absorbed: reproduce-first, then fix.
- EXCLUDE - lisa:builder - Operator constraint: no subagents; this is a Fix, not a Build.
- EXCLUDE - lisa:test-specialist - Operator constraint: no subagents. Regression design absorbed by the lead.
- EXCLUDE - lisa:verification-specialist - Operator constraint: no subagents. **The verdict is therefore self-certified, not independently judged.** Recorded as a known independence gap.
- EXCLUDE - lisa:quality-specialist - Operator constraint: no subagents. Repository lint, complexity, mutation and dead-code gates stand in as the mechanical half of this role.
- EXCLUDE - lisa:security-specialist - Operator constraint: no subagents. The change adds no new input surface; it reads labels the writer already read and removes a subset of them.
- EXCLUDE - lisa:architecture-specialist - Operator constraint: no subagents.
- EXCLUDE - lisa:debug-specialist - Operator constraint: no subagents. Root cause was already isolated to a single named function by the filed issue and confirmed by direct read.
- EXCLUDE - lisa:product-specialist - Operator constraint: no subagents. No user-visible UI surface.
- EXCLUDE - lisa:spec-conformance-specialist - Operator constraint: no subagents. Acceptance criteria mapped to evidence inline.
- EXCLUDE - lisa:performance-specialist - Operator constraint: no subagents. The change adds two read calls to a command that already spawns several; no hot path.
- EXCLUDE - lisa:learner - Operator constraint: no subagents. Learnings recorded in the plan artifact rather than persisted to the ledger.
- EXCLUDE - lisa:learning-judge - Operator constraint: no subagents; nothing was proposed for the ledger, so nothing needed judging.
- EXCLUDE - lisa:skill-evaluator - Operator constraint: no subagents; no candidate learning needed routing.
- EXCLUDE - lisa:learnings-synthesizer - Operator constraint: no subagents; not a Debrief flow.
- EXCLUDE - lisa:git-history-analyzer - Operator constraint: no subagents. History consulted inline where the writer's own comments cited prior measurements.
- EXCLUDE - lisa:eval-specialist - Operator constraint: no subagents; not an evaluation flow.
- EXCLUDE - lisa:pr-mining-specialist - Operator constraint: no subagents; not a Debrief flow.
- EXCLUDE - lisa:tracker-mining-specialist - Operator constraint: no subagents; not a Debrief flow.
- EXCLUDE - lisa:github-agent - Operator constraint: no subagents; this flow was dispatched directly, not through the tracker agent.
- EXCLUDE - lisa:jira-agent - Operator constraint: no subagents; tracker is GitHub.
- EXCLUDE - lisa:linear-agent - Operator constraint: no subagents; tracker is GitHub.
- EXCLUDE - lisa:github-build-intake - Operator constraint: no subagents; single named item, not a queue scan.
- EXCLUDE - lisa:jira-build-intake - Operator constraint: no subagents; tracker is GitHub.
- EXCLUDE - lisa:linear-build-intake - Operator constraint: no subagents; tracker is GitHub.
- EXCLUDE - lisa:github-prd-intake - Operator constraint: no subagents; not a PRD flow.
- EXCLUDE - lisa:confluence-prd-intake - Operator constraint: no subagents; not a PRD flow.
- EXCLUDE - lisa:linear-prd-intake - Operator constraint: no subagents; not a PRD flow.
- EXCLUDE - lisa:notion-prd-intake - Operator constraint: no subagents; not a PRD flow.
- EXCLUDE - lisa-expo:ops-specialist - Operator constraint: no subagents; this repository ships a CLI and plugin artifacts, with no deployed runtime to health-check.
- EXCLUDE - code-simplifier:code-simplifier - Operator constraint: no subagents.
- EXCLUDE - coderabbit:code-reviewer - Operator constraint: no subagents as a spawned teammate. CodeRabbit still reviews the pull request through its own GitHub integration, which is the one genuinely independent review this flow gets.
- EXCLUDE - hookify:conversation-analyzer - Operator constraint: no subagents; no hook authoring in scope.
- EXCLUDE - statusline-setup - Not applicable to this work.

<!-- [lisa-implement-roster] key=CodySwannGT/lisa#3328 -->
