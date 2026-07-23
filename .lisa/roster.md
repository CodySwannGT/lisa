# Lisa Implement Roster Decision

Work item: queue campaign starting `CodySwannGT/lisa#1546`
Plan: `implement-ready-queue-1546`
Runtime: Cursor (Task tool specialists)
Recorded: 2026-07-18T20:55:00Z

## Queue (status:ready)

1. #1546 Wire the top-bar version status to the existing npm update check
2. #1545 Detect connected observability providers
3. #1544 Populate the automations section from the harness scheduler
4. #1543 Populate the GitHub repository panel from live gh api reads
5. #1542 Compute deploy pipeline stages from deploy.yml and github.environments
6. #1541 Compute the CI quality-jobs Active column from ci.yml
7. #1540 Wire the plugins & MCP section to .claude/settings.json enabledPlugins

SKIP this session: #1539 (status:in-progress, other branch). BLOCKED/human-needed and unlabeled self-hardening issues are out of the formal ready queue.

## Base branch assumption

Ticket #1546 names target environment `dev` (local-only UI on 127.0.0.1). `.lisa.config.json` `deploy.branches` only maps `production → main`. Interpreting `dev` as local verification (not a missing deploy branch); PR base = remote default `main`.

## Runtime agent inventory

INCLUDE|EXCLUDE - agent type - reason

INCLUDE - generalPurpose - Explore/research equivalent; plan naming, branch sync, task planning when no narrower specialist fits
INCLUDE - architecture-specialist - design approach, file map, reuse of checkVersion / live-status probe
INCLUDE - builder - TDD implementation of #1546 and subsequent ready items
INCLUDE - test-specialist - unit + Playwright regression for version status surface
INCLUDE - product-specialist - acceptance criteria / Validation Journey alignment
INCLUDE - verification-specialist - local empirical proof + verification-status.json
INCLUDE - quality-specialist - correctness / coverage / philosophy review
INCLUDE - code-reviewer - PR-oriented code review before merge drive
INCLUDE - code-simplifier - clarify recently modified code after green tests
INCLUDE - security-specialist - threat pass on live probe / npm registry reads
INCLUDE - learner - post-task learnings review (required by implement skill)
INCLUDE - github-agent - claim/sync issue labels, PR linkage, done transitions between queue items
INCLUDE - debug-specialist - only if reproduction or verification fails
INCLUDE - performance-specialist - only if version probe or UI polling shows latency issues
INCLUDE - spec-conformance-specialist - verify shipped work matches ticket AC before done
EXCLUDE - bug-fixer - work type is Build, not Fix; builder covers TDD
EXCLUDE - bugbot - only when explicitly requested
EXCLUDE - security-review - only when explicitly requested; security-specialist covers inline
EXCLUDE - best-of-n-runner - no parallel experiment need
EXCLUDE - cursor-guide - not a Cursor product question
EXCLUDE - *-prd-intake / *-build-intake - this is implement, not intake
EXCLUDE - jira-agent / linear-agent / confluence-* / notion-* - tracker is github
EXCLUDE - pr-mining-specialist / tracker-mining-specialist / learnings-synthesizer - debrief-only
EXCLUDE - skill-evaluator - no new skill authoring in this flow
EXCLUDE - git-history-analyzer - architecture-specialist + generalPurpose cover needed history

## Effective completion (queue)

Queue is clean when `gh issue list --label status:ready --state open` returns zero issues (or only items that transitioned to blocked with human_needed / linked dependency). Per-issue: verification-status.json all-pass, PR merged to main, tracker sync to env-keyed done.

---

Work item: `CodySwannGT/lisa#1539` — plan: `wire-stacks-detector-registry-1539`

Runtime: Claude Code implicit-team model (Agent tool). No shared task-list tool in this runtime (TaskCreate/TaskList absent) — task plan persisted in `.lisa/plan-1539.md`; verification verdict in `.lisa/verification-status.json`.

- `INCLUDE - Explore - read-only research; already served as the bounded input-resolver for this flow.`
- `INCLUDE - lisa:builder - owns the TDD implementation of the detected-stacks probe + UI wiring (Build work type).`
- `INCLUDE - lisa:test-specialist - authors the Playwright regression spec codifying the validation journey, alongside unit tests.`
- `INCLUDE - lisa:product-specialist - reviews behavior against the Gherkin AC from the user's perspective (parallel review lane).`
- `INCLUDE - lisa:quality-specialist - coding-philosophy/correctness review (parallel review lane).`
- `INCLUDE - coderabbit:code-reviewer - CodeRabbit review lane per the project review-parallelization rule.`
- `INCLUDE - lisa:spec-conformance-specialist - verifies shipped work matches the spec exactly (AC, Out of Scope, journey assertions).`
- `INCLUDE - lisa:verification-specialist - independent empirical verification (live browser journey, doctor agreement) + writes verification-status.json; never the implementer.`
- `INCLUDE - lisa:learner - collects and routes task learnings before team shutdown.`
- `INCLUDE - general-purpose - fallback for bounded mechanical chores only when no specialist fits; not a build lane.`
- `EXCLUDE - lisa:architecture-specialist - design fully pinned by the ticket + shipped #1537 probe contract; no open architectural decision.`
- `EXCLUDE - lisa:security-specialist - no new external input surface: /api/status pre-exists; new probe reads local filesystem only, loopback-bound.`
- `EXCLUDE - lisa:performance-specialist - bounded 5s-timeout filesystem probe already used by lisa doctor; no perf-sensitive path.`
- `EXCLUDE - lisa:debug-specialist / lisa:bug-fixer - Build flow, not Fix; no bug to reproduce.`
- `EXCLUDE - lisa:git-history-analyzer - relationship search already documented in the ticket and re-verified at triage.`
- `EXCLUDE - lisa:github-agent - its lifecycle is already running in this lead session via intake dispatch; spawning it would nest lifecycles.`
- `EXCLUDE - lisa:jira-agent / lisa:linear-agent - wrong tracker (tracker=github).`
- `EXCLUDE - lisa:*-build-intake / lisa:*-prd-intake - queue scanners, not per-item workers; the item is already claimed.`
- `EXCLUDE - lisa:learnings-synthesizer / lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief-flow agents, out of scope for a build ticket.`
- `EXCLUDE - lisa:skill-evaluator - reached through the learner flow, not a team lane.`
- `EXCLUDE - code-simplifier:code-simplifier - small change; quality-specialist + CodeRabbit cover simplification.`
- `EXCLUDE - claude-code-guide / hookify:conversation-analyzer / statusline-setup - unrelated utilities.`
- `EXCLUDE - claude - generic catch-all; specific specialists selected.`
- `EXCLUDE - Plan - decomposition exists; this IS the leaf work item.`

Base-branch resolution (recorded assumption): ticket env is `dev — local only; there is no deployed environment for this surface`. Merged `deploy.branches` maps only `production → main` (single-env repo; the npm release IS the deploy). Surface has no deployable environment → base = remote default `main` per the no-environment fallback. PR targets `main`.

---

# Roster Decision — plan: `sll-self-learning-loop-1548` (PRD #1548 open descendants)

Recorded: 2026-07-19. Runtime: Claude Code implicit-team model; no TaskCreate/TaskList in this runtime — task plan persisted in `.lisa/plan-1548.md`. Model floor per /goal: never below Opus 4.8 — every teammate spawn uses `model: opus`; the highest-complexity design/build lanes (#1589 gate, #1574/#1580 archaeology, #1582 attribution) inherit the lead's Fable 5 (model omitted).

INCLUDE - Explore - Mandatory read-only research; feeds every task's metadata.relevant_documentation.
INCLUDE - general-purpose - Bounded lead-session chores the skill assigns (input resolution done; branch sync, preflight probes); never a build lane.
INCLUDE - lisa:architecture-specialist - Designs cross-cutting seams: vendor transition-history substrate ops, archaeology gate seam, attribution procedure, auto-merge-off mode.
INCLUDE - lisa:builder - Primary TDD implementer for all Build leaves (one instance per phase batch).
INCLUDE - lisa:test-specialist - Test strategy + regression coverage for contract/script/workflow-template/skill changes.
INCLUDE - lisa:quality-specialist - Review lane (correctness, philosophy, coverage) — parallel with the other reviewers.
INCLUDE - lisa:product-specialist - Reviews operator-facing text surfaces (dropped-with-reason notes, upstream ticket bodies, rule prose) for three-audience readability.
INCLUDE - coderabbit:code-reviewer - Independent review lane per Agent Team Workflows parallel-review rule.
INCLUDE - lisa:spec-conformance-specialist - Per-batch conformance check against each ticket's Gherkin AC; catches scope drift across 18 leaves.
INCLUDE - lisa:verification-specialist - Independent empirical verification + writes .lisa/verification-status.json; never the implementer.
INCLUDE - lisa:learner - Mandatory per-task learnings review before team dismissal.
INCLUDE - lisa:skill-evaluator - Reached via learner; ALSO research input for #1589 (the gate reuses its discipline).
INCLUDE - lisa:git-history-analyzer - Research input for SLL-3 archaeology (#1574/#1580) and #1582 doctor-attribution generalization.
INCLUDE - lisa:security-specialist - Reviews #1581 (host CI workflow-template step) and #1583 (auto-filing upstream tickets) for permission/credential hazards.
EXCLUDE - lisa:bug-fixer - Build work type, not Fix; no reproduction sub-flow.
EXCLUDE - lisa:debug-specialist - No live defect; roster will be amended before spawning if CI failures need root-causing.
EXCLUDE - lisa:performance-specialist - No perf-sensitive surface; archaeology cost budget (#1584) is a design constraint, not a perf investigation.
EXCLUDE - lisa:jira-agent / lisa:github-agent / lisa:linear-agent - Lifecycle wrappers; we are already inside Implement.
EXCLUDE - lisa:*-build-intake / lisa:*-prd-intake / lisa:tracker-* intake surfaces - Queue scanners; dispatch already happened via /goal.
EXCLUDE - lisa:learnings-synthesizer / lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief-flow specialists.
EXCLUDE - Plan - Decomposition exists as the SLL tree.
EXCLUDE - claude / claude-code-guide / hookify:conversation-analyzer / statusline-setup / code-simplifier:code-simplifier - Generic or unrelated; review lanes bounded to product/quality/coderabbit/spec-conformance to control cycle time per the convergent-review principle.

Scope: 18 in-scope leaves in 5 PR batches (see plan-1548.md). #1585 excluded — superseded by gardener #1735 (same rationale as parent #1556); being closed with a supersession comment. #1579 in scope per the #1729 amendment carve-in. Ledger path always via the executable contract resolver. Base branch: main (single-env; ticket `dev` values are placeholder enum per #1561/#1564 self-notes).

---

# Roster Decision — plan: `improve-harness-skill-1744` (CodySwannGT/lisa#1744)

Recorded: 2026-07-20. Runtime: Claude Code implicit-team model (Agent tool); no TaskCreate/TaskList in this runtime — task plan persisted in `.lisa/plan-1744.md`. Model floor per /goal: never below Opus 4.8 — mechanical/bounded lanes use `model: opus`; the skill-authoring build lane and spec-conformance lane inherit the lead's Fable 5 (model omitted).

INCLUDE - general-purpose - bounded input-resolver (already run) and lead-session legwork (branch/env resolution, preflight probes); never a build lane.
INCLUDE - Explore - mandatory read-only research: existing skill/command conventions, plugin fanout surfaces, adjacent skills (debrief, attribute-failure, rework-triage, learnings ladder) to ground the new skill and avoid overlap.
INCLUDE - lisa:architecture-specialist - designs SKILL.md structure, command wiring, six-agent parity surfaces, idempotency marker, and template embedding before implementation.
INCLUDE - lisa:builder - implements the skill + command + regenerated plugin artifacts from acceptance criteria.
INCLUDE - lisa:quality-specialist - review lane: correctness/philosophy/convention compliance of skill text and wiring.
INCLUDE - coderabbit:code-reviewer - independent review lane per Agent Team Workflows parallel-review rule.
INCLUDE - lisa:product-specialist - operator-readability lane: result-record/job-contract templates must read for non-technical gate operators.
INCLUDE - lisa:spec-conformance-specialist - verifies shipped work against the 4 Gherkin scenarios, Out of Scope, and cross-cutting invariants (headless-safe, idempotent marker, parity).
INCLUDE - lisa:verification-specialist - independent empirical verification (build:plugins, check:plugins, artifact presence across agent surfaces, skill loadability) + writes .lisa/verification-status.json; never the implementer.
INCLUDE - lisa:learner - captures task learnings to the ledger before team dismissal.
EXCLUDE - lisa:bug-fixer / lisa:debug-specialist - Build flow, no defect to reproduce.
EXCLUDE - lisa:performance-specialist - markdown skill authoring; no runtime perf surface.
EXCLUDE - lisa:security-specialist - no new credential/permission/attack surface; skill is documentation-plane and files tickets via existing tracker-write.
EXCLUDE - lisa:test-specialist - deliverable is a skill document + generated artifacts; artifact-parity checks covered by builder + verification-specialist (check:plugins, existing artifact tests).
EXCLUDE - lisa:git-history-analyzer - referenced BY the new skill's content but not needed to author it; Explore covers context.
EXCLUDE - lisa:github-agent / lisa:jira-agent / lisa:linear-agent - lifecycle wrappers; already inside Implement via intake dispatch.
EXCLUDE - lisa:*-build-intake / lisa:*-prd-intake - queue scanners; item already claimed.
EXCLUDE - lisa:learnings-synthesizer / lisa:pr-mining-specialist / lisa:tracker-mining-specialist - Debrief-flow agents, out of scope per ticket.
EXCLUDE - lisa:learning-judge / lisa:skill-evaluator - gardener/judgment lanes reached via learner, not team lanes here.
EXCLUDE - code-simplifier:code-simplifier - prose deliverable; quality-specialist covers refinement.
EXCLUDE - claude / claude-code-guide / hookify:conversation-analyzer / statusline-setup / Plan / fork - generic or unrelated; decomposition exists (this IS the leaf).

Base-branch resolution: ticket Target Backend Environment = `production`; `deploy.branches` maps `production → main` → base = `main`. PR targets `main`.

---

# Roster Decision — plan: `readiness-warning-parity-1859` (CodySwannGT/lisa#1859)

Recorded: 2026-07-21. Runtime: Codex collaboration. The runtime exposes one
delegation type, the generic collaboration agent; it exposes no distinct native
specialist-type selector.

INCLUDE - generic collaboration agent - the only exposed type; use bounded role assignments for the mandatory read-only Explore pass, implementation support, independent review/verification, and learner review.
EXCLUDE - no additional runtime agent types - none are exposed by the current collaboration surface; Lisa specialist skills may guide assignments but are not separately spawnable agent types here.

Required assignments: one read-only Explore/research pass before planning; one
independent review/verification pass after implementation; one learner pass
before shutdown. The lead owns branch sync, implementation integration, tracker
transitions, PR merge drive, and release proof.

Work type: Build. Target environment is the human-confirmed configured key
`production`; `.lisa.config.json` maps it uniquely to remote `main`. The existing
feature branch `1859-setup-automations-warn` is reused and must be rebased onto
`origin/main` before source work.
