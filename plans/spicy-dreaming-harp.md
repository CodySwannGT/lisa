# Agent Flow Architecture Redesign

## Context

The current agent system has 16 base agents with no skills loaded via frontmatter, triage workflows stuffed into rules that load into every prompt, and no intent routing. The ops-specialist agents (Expo/Rails) already demonstrate the right pattern — composing from modular skills via frontmatter. This plan extends that pattern to all agents, introduces intent-based flow routing, and removes redundant/deprecated components.

The goal: **Intent → Flow → Agents (with skills)**. Every user request maps to a flow. Every flow is a sequence of hyper-focused agents. Each agent loads exactly the skills it needs via frontmatter. Flows can invoke sub-flows recursively.

## Architecture

### Intents and Flows

#### Fix
```
git-history-analyzer     →  understand why code exists, find related past fixes
  → debug-specialist     →  reproduce, prove root cause
    → architecture-specialist  →  assess fix risk, plan approach
      → test-specialist  →  design regression test strategy
        → bug-fixer      →  TDD: implement fix
          → Verify sub-flow
            → Ship sub-flow
              → learner  →  capture discoveries
```

#### Build
```
product-specialist       →  define acceptance criteria, user flows, error states
  → architecture-specialist  →  research codebase, design approach, map dependencies
    → test-specialist    →  design test strategy
      → builder          →  TDD: acceptance criteria → tests → implement
        → Verify sub-flow
          → Review sub-flow
            → Ship sub-flow
              → learner  →  capture discoveries
```

#### Investigate
```
git-history-analyzer     →  understand code evolution, find related changes
  → debug-specialist     →  reproduce, trace execution, prove root cause
    → ops-specialist     →  check logs, errors, health (if runtime issue)
      → (report findings with evidence)
```

#### Plan
```
product-specialist       →  define acceptance criteria for the whole scope
  → architecture-specialist  →  understand scope, map dependencies
    → (break down into ordered tasks with acceptance criteria + verification type)
```

#### Ship
```
(commit via git-commit skill)
  → (PR via git-submit-pr skill)
    → Review sub-flow (if not already done)
      → PR Watch Loop (until mergeable):
        → If status checks fail → fix and push
        → If merge conflicts → resolve and push
        → If bot review feedback (CodeRabbit, etc.):
          → If valid → implement fix, push, resolve comment
          → If invalid → reply explaining why, resolve comment
        → Repeat until all checks pass, all comments resolved
      → Merge PR
        → ops-specialist  →  deploy to target environment
          → verifier      →  post-deploy health + smoke test
            → ops-specialist  →  monitor for errors
```

#### Review
```
quality-specialist + security-specialist + performance-specialist  →  (parallel)
  → product-specialist   →  verify acceptance criteria met
    → test-specialist     →  verify test coverage and quality
      → (consolidate findings, ranked by severity)
```

#### Improve
```
architecture-specialist  →  identify target, measure baseline, plan approach
  → test-specialist      →  ensure existing test coverage (safety net)
    → builder            →  implement improvements via TDD
      → verifier         →  measure again, prove improvement
        → Ship sub-flow
          → learner      →  capture discoveries
```

#### Monitor
```
ops-specialist           →  health checks, logs, errors, performance
  → (report findings)
```

### JIRA Entry Point

When work originates from a JIRA ticket, route to `jira-agent` first:

```
jira-agent  →  read ticket → validate quality → determine intent → delegate to flow → sync progress → post evidence
```

### Agent Roster

#### New Agents

| Agent | Focus | Skills |
|-------|-------|--------|
| `bug-fixer` | Fix bugs via TDD | `bug-triage`, `tdd-implementation`, `jsdoc-best-practices` |
| `builder` | Build features via TDD | `task-triage`, `tdd-implementation`, `jsdoc-best-practices` |
| `jira-agent` | JIRA lifecycle: read ticket, determine intent, wrap flow | `jira-sync`, `jira-evidence`, `jira-verify`, `jira-add-journey` |

#### Updated Agents (add skills frontmatter)

| Agent | Skills to add |
|-------|---------------|
| `debug-specialist` | `reproduce-bug`, `root-cause-analysis` |
| `architecture-specialist` | `codebase-research`, `task-decomposition` |
| `verification-specialist` | `verification-lifecycle` |
| `quality-specialist` | `quality-review` |
| `security-specialist` | `security-review`, `security-zap-scan` |
| `performance-specialist` | `performance-review` |
| `test-specialist` | `test-strategy` |
| `product-specialist` | `acceptance-criteria` |
| `git-history-analyzer` | (no change — knowledge is in body) |
| `learner` | (no change — already delegates to skill-evaluator) |
| `skill-evaluator` | (no change) |
| `ops-specialist` | (no change — already has stack-specific skills) |

#### Agents to Delete

| Agent | Reason |
|-------|--------|
| `web-search-researcher` | Removed — any agent can use WebSearch tool directly |
| `slash-command-architect` | Removed — meta tooling no longer needed |
| `hooks-expert` | Removed — meta tooling no longer needed |
| `agent-architect` | Removed — meta tooling no longer needed |
| `implementer` | Replaced by `bug-fixer` + `builder` |

### New Skills (extracted from rules/agent bodies)

| Skill | Content source | Loaded by |
|-------|---------------|-----------|
| `bug-triage` | base-rules.md Bug Triage + Bug Implementation sections | `bug-fixer` |
| `task-triage` | base-rules.md Task Triage + Task Implementation sections | `builder` |
| `epic-triage` | base-rules.md Epic Triage + Epic Implementation sections | `architecture-specialist` |
| `tdd-implementation` | Current `implementer.md` body + coding-philosophy TDD section | `bug-fixer`, `builder` |
| `verification-lifecycle` | verification.md operational content (lifecycle, surfaces, escalation, proof artifacts, self-correction) | `verification-specialist` |
| `reproduce-bug` | New — how to create reliable reproduction scenarios | `debug-specialist` |
| `root-cause-analysis` | Extracted from `debug-specialist` investigation methodology | `debug-specialist` |
| `codebase-research` | Extracted from `architecture-specialist` analysis process | `architecture-specialist` |
| `task-decomposition` | New — how to break work into ordered tasks with acceptance criteria | `architecture-specialist` |
| `quality-review` | Extracted from `quality-specialist` review checklist | `quality-specialist` |
| `security-review` | Extracted from `security-specialist` threat modeling/OWASP checklist | `security-specialist` |
| `performance-review` | Extracted from `performance-specialist` checklist | `performance-specialist` |
| `test-strategy` | Extracted from `test-specialist` strategy methodology | `test-specialist` |
| `acceptance-criteria` | Extracted from `product-specialist` Gherkin/UX methodology | `product-specialist` |

### Skills to Delete

| Skill | Reason |
|-------|--------|
| `sonarqube-check` | Removed |
| `sonarqube-fix` | Removed |
| `git-commit-and-submit-pr` | Redundant with Ship sub-flow |
| `git-commit-submit-pr-and-verify` | Redundant with Ship sub-flow |
| `git-commit-submit-pr-deploy-and-verify` | Redundant with Ship sub-flow |
| `jira-fix` | Replaced by jira-agent → Fix flow |
| `jira-implement` | Replaced by jira-agent → Build flow |
| `tasks-load` | Removed |
| `tasks-sync` | Removed |

### Rules Changes

| Rule | Change |
|------|--------|
| `base-rules.md` | Remove Bug/Task/Epic Triage and Implementation sections (→ skills). Keep: Requirement Verification, Project Discovery, Code Quality, Git Discipline, Testing Discipline, JIRA Discipline, Agent Behavior, NEVER, ASK FIRST, Multi-Repository Awareness. |
| `verification.md` | Keep only: Core Principle, Roles, Verification Levels, Verification Types taxonomy table. Move everything else → `verification-lifecycle` skill. |
| `coding-philosophy.md` | No change |
| `intent-routing.md` | **New** — flow definitions and routing table |

### Existing Skills Disposition (plan-* family)

These are parameterized Improve flows. Keep as user-invocable commands but update them to use the Improve flow internally:

- `plan-add-test-coverage` — Improve flow with "increase coverage" parameter
- `plan-fix-linter-error` — Improve flow with "fix lint rule" parameter
- `plan-lower-code-complexity` — Improve flow with "reduce complexity" parameter
- `plan-reduce-max-lines` — Improve flow with "reduce file length" parameter
- `plan-reduce-max-lines-per-function` — Improve flow with "reduce function length" parameter
- `plan-local-code-review` — Review flow variant
- `plan-execute` — Replaced by intent-routing + flows

### Existing Skills to Keep

- `git-commit` — used in Ship sub-flow
- `git-submit-pr` — used in Ship sub-flow
- `git-prune` — standalone maintenance utility
- `pull-request-review` — used in Ship sub-flow review-fix loop
- `jira-sync` — loaded by jira-agent
- `jira-evidence` — loaded by jira-agent
- `jira-verify` — loaded by jira-agent
- `jira-create` — used in Plan flow
- `jira-journey` — loaded by verifier for validation journeys
- `jira-add-journey` — loaded by jira-agent
- `security-zap-scan` — loaded by security-specialist
- `jsdoc-best-practices` — loaded by bug-fixer and builder
- `agent-design-best-practices` — standalone reference (no agent loads it, kept as documentation)
- `lisa-review-implementation` — Lisa-only, not for downstream
- All stack-specific ops skills (ops-run-local, ops-deploy, ops-check-logs, etc.)
- All stack-specific skills (expo/*, nestjs/*, rails/*)

## Implementation Phases

### Phase 1: Create new skills

Extract content from rules and agent bodies into new skill files. Each skill goes in `plugins/src/base/skills/{name}/SKILL.md`.

**Files to create:**
- `plugins/src/base/skills/bug-triage/SKILL.md`
- `plugins/src/base/skills/task-triage/SKILL.md`
- `plugins/src/base/skills/epic-triage/SKILL.md`
- `plugins/src/base/skills/tdd-implementation/SKILL.md`
- `plugins/src/base/skills/verification-lifecycle/SKILL.md`
- `plugins/src/base/skills/reproduce-bug/SKILL.md`
- `plugins/src/base/skills/root-cause-analysis/SKILL.md`
- `plugins/src/base/skills/codebase-research/SKILL.md`
- `plugins/src/base/skills/task-decomposition/SKILL.md`
- `plugins/src/base/skills/quality-review/SKILL.md`
- `plugins/src/base/skills/security-review/SKILL.md`
- `plugins/src/base/skills/performance-review/SKILL.md`
- `plugins/src/base/skills/test-strategy/SKILL.md`
- `plugins/src/base/skills/acceptance-criteria/SKILL.md`

**Source mapping:**
- `bug-triage` ← base-rules.md lines 72-85 (Bug Triage + Bug Implementation)
- `task-triage` ← base-rules.md lines 87-100 (Task Triage + Task Implementation)
- `epic-triage` ← base-rules.md lines 102-120 (Epic Triage + Epic Implementation)
- `tdd-implementation` ← `plugins/src/base/agents/implementer.md` workflow section + coding-philosophy.md TDD section
- `verification-lifecycle` ← `all/copy-overwrite/.claude/rules/verification.md` (everything except Core Principle, Roles, Verification Levels, Verification Types table)
- `reproduce-bug` ← new content, based on debug-specialist's "Reproduce the Problem" section
- `root-cause-analysis` ← `plugins/src/base/agents/debug-specialist.md` sections 2-5 (evidence gathering, tracing, log placement, proving root cause)
- `codebase-research` ← `plugins/src/base/agents/architecture-specialist.md` analysis process
- `task-decomposition` ← new content, methodology for breaking work into tasks
- `quality-review` ← `plugins/src/base/agents/quality-specialist.md` review methodology
- `security-review` ← `plugins/src/base/agents/security-specialist.md` threat modeling methodology
- `performance-review` ← `plugins/src/base/agents/performance-specialist.md` analysis methodology
- `test-strategy` ← `plugins/src/base/agents/test-specialist.md` strategy methodology
- `acceptance-criteria` ← `plugins/src/base/agents/product-specialist.md` Gherkin/UX methodology

### Phase 2: Create new agents

**Files to create:**
- `plugins/src/base/agents/bug-fixer.md`
- `plugins/src/base/agents/builder.md`
- `plugins/src/base/agents/jira-agent.md`

**Agent design:**
- `bug-fixer`: tools: Read, Write, Edit, Bash, Grep, Glob. skills: bug-triage, tdd-implementation, jsdoc-best-practices. Focused body describing bug fix TDD cycle.
- `builder`: tools: Read, Write, Edit, Bash, Grep, Glob. skills: task-triage, tdd-implementation, jsdoc-best-practices. Focused body describing feature build TDD cycle.
- `jira-agent`: tools: Read, Grep, Glob, Bash (+ JIRA MCP tools). skills: jira-sync, jira-evidence, jira-verify, jira-add-journey. Body describes: read ticket → validate → determine intent → delegate → sync → post evidence.

### Phase 3: Update existing agents (add skills frontmatter + slim bodies)

For each agent: add `skills:` to frontmatter, move extracted methodology to the corresponding skill, keep the agent body focused on its core philosophy, output format, and rules.

**Files to modify:**
- `plugins/src/base/agents/debug-specialist.md` — add skills: reproduce-bug, root-cause-analysis. Slim body (methodology moves to skills).
- `plugins/src/base/agents/architecture-specialist.md` — add skills: codebase-research, task-decomposition, epic-triage. Slim body.
- `plugins/src/base/agents/verification-specialist.md` — add skills: verification-lifecycle, jira-journey. Body already slimmed in Phase 0.
- `plugins/src/base/agents/quality-specialist.md` — add skills: quality-review. Slim body.
- `plugins/src/base/agents/security-specialist.md` — add skills: security-review, security-zap-scan. Slim body.
- `plugins/src/base/agents/performance-specialist.md` — add skills: performance-review. Slim body.
- `plugins/src/base/agents/test-specialist.md` — add skills: test-strategy. Slim body.
- `plugins/src/base/agents/product-specialist.md` — add skills: acceptance-criteria. Slim body.

### Phase 4: Create intent-routing rule + slim down existing rules

**Files to create:**
- `all/copy-overwrite/.claude/rules/intent-routing.md`

**Files to modify:**
- `all/copy-overwrite/.claude/rules/base-rules.md` — Remove Bug Triage, Bug Implementation, Task Triage, Task Implementation, Epic Triage, Epic Implementation sections. Keep everything else.
- `all/copy-overwrite/.claude/rules/verification.md` — Keep only: Core Principle, Roles, Verification Levels, Verification Types taxonomy table. Move everything else to `verification-lifecycle` skill.

### Phase 5: Delete deprecated agents, skills, and commands

**Agent files to delete (src + built):**
- `plugins/src/base/agents/web-search-researcher.md` + `plugins/lisa/agents/web-search-researcher.md`
- `plugins/src/base/agents/slash-command-architect.md` + `plugins/lisa/agents/slash-command-architect.md`
- `plugins/src/base/agents/hooks-expert.md` + `plugins/lisa/agents/hooks-expert.md`
- `plugins/src/base/agents/agent-architect.md` + `plugins/lisa/agents/agent-architect.md`
- `plugins/src/base/agents/implementer.md` + `plugins/lisa/agents/implementer.md`

**Skill directories to delete:**
- `plugins/src/base/skills/sonarqube-check/`
- `plugins/src/base/skills/sonarqube-fix/`
- `plugins/src/base/skills/git-commit-and-submit-pr/`
- `plugins/src/base/skills/git-commit-submit-pr-and-verify/`
- `plugins/src/base/skills/git-commit-submit-pr-deploy-and-verify/`
- `plugins/src/base/skills/jira-fix/`
- `plugins/src/base/skills/jira-implement/`
- `plugins/src/base/skills/tasks-load/`
- `plugins/src/base/skills/tasks-sync/`

**Command files to delete:**
- `plugins/src/base/commands/git/commit-and-submit-pr.md`
- `plugins/src/base/commands/git/commit-submit-pr-and-verify.md`
- `plugins/src/base/commands/git/commit-submit-pr-deploy-and-verify.md`
- `plugins/src/base/commands/jira/fix.md`
- `plugins/src/base/commands/jira/implement.md`
- `plugins/src/base/commands/sonarqube/check.md`
- `plugins/src/base/commands/sonarqube/fix.md`
- `plugins/src/base/commands/tasks/load.md`
- `plugins/src/base/commands/tasks/sync.md`

### Phase 6: Create new flow commands + update existing commands

**New flow command files to create** (in `plugins/src/base/commands/`):
- `fix.md` — `/fix <description-or-ticket>`: Route to Fix flow. Auto-detect JIRA ticket → jira-agent entry point.
- `build.md` — `/build <description-or-ticket>`: Route to Build flow. Auto-detect JIRA ticket → jira-agent entry point.
- `investigate.md` — `/investigate <description>`: Route to Investigate flow.
- `ship.md` — `/ship`: Route to Ship sub-flow (commit → PR → review → deploy → monitor).
- `review.md` — `/review [pr-link]`: Route to Review flow.
- `improve.md` — `/improve <target>`: Route to Improve flow.
- `monitor.md` — `/monitor [environment]`: Route to Monitor flow.
- `plan.md` — `/plan <description-or-ticket>`: Route to Plan flow (replaces plan/create + plan/execute).

**Command files to update:**
- `plugins/src/base/commands/plan/create.md` — Update to use `/plan` flow command instead of `plan-execute` skill
- `plugins/src/base/commands/plan/execute.md` — Update to use `/plan` flow command instead of `plan-execute` skill

**Commands to keep as-is:**
- `git/commit.md`, `git/prune.md`, `git/submit-pr.md`
- `jira/add-journey.md`, `jira/create.md`, `jira/evidence.md`, `jira/journey.md`, `jira/sync.md`, `jira/verify.md`
- `plan/add-test-coverage.md`, `plan/fix-linter-error.md`, `plan/local-code-review.md`, `plan/lower-code-complexity.md`, `plan/reduce-max-lines.md`, `plan/reduce-max-lines-per-function.md`
- `pull-request/review.md`, `review/implementation.md`, `security/zap-scan.md`

### Phase 7: Sync built copies

Copy all new/modified agents from `plugins/src/base/agents/` to `plugins/lisa/agents/`.

### Phase 8: Update plan-* skills

Update `plan-execute` to use intent-routing flow model instead of its current orchestration. Update other plan-* skills to invoke the Improve flow with appropriate parameters.

## Files Summary

### Create (new)
- 14 new skill files (Phase 1)
- 3 new agent files (Phase 2)
- 1 new rule file — `intent-routing.md` (Phase 4)
- 8 new flow command files (Phase 6)

### Modify
- 8 existing agent files — add skills frontmatter, slim bodies (Phase 3)
- `base-rules.md` — remove triage sections (Phase 4)
- `verification.md` — slim to types taxonomy only (Phase 4)
- 2 existing command files — `plan/create.md`, `plan/execute.md` (Phase 6)

### Delete
- 5 agent files × 2 (src + built) = 10 files (Phase 5)
- 9 skill directories (Phase 5)
- 9 command files (Phase 5)

## Verification

- All remaining agents have `skills:` in frontmatter (except git-history-analyzer, learner, skill-evaluator which don't need them)
- `intent-routing.md` contains all 8 flows with complete agent sequences
- All 8 flow commands exist and route to the correct flow
- `base-rules.md` contains no triage workflows
- `verification.md` contains only types taxonomy + minimal framework
- No deleted agent/skill/command is referenced by any remaining file
- `bun run lint` and `bun run typecheck` pass
- `git diff` review before committing
- Grep for deleted agent/skill names across the codebase to catch stale references
