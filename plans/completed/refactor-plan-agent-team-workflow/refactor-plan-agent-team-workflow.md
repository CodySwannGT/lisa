# Plan: Refactor Plan-Create and Plan-Implement Agent Team Workflow

## Context

The current `/plan:create` and `/plan:implement` skills have architectural issues that prevent them from working as intended:

1. **`.claude/rules/plan.md` governance bleed** — This rule is auto-loaded into every agent's context (team lead and all teammates). It contains governance rules (Required Tasks, Branch/PR rules, Git Workflow) that only the team lead needs during synthesis. Domain planners and reviewers see irrelevant instructions about opening draft PRs and archiving plans.

2. **Wrong use of Claude Code "plan mode"** — plan-create spawns all teammates in `plan` mode, which restricts them to read-only and triggers `enforce-plan-rules.sh` to reinject the full plan.md on every prompt. Teammates should use `bypassPermissions` with restricted tool sets instead.

3. **Agent roles don't match the desired workflow** — The user wants domain-specific sub-planners (architecture, testing, security, product) that each produce specialized sub-plans, followed by adversarial review, then team lead synthesis. Current agents are research-oriented (researcher, explorer, devil's advocate) without domain specialization.

4. **plan-implement lacks phased structure** — Missing explicit phases for reviews, post-review fixes, and dynamic implementer count. The implementer agent doesn't enforce TDD.

## Branch

`refactor/plan-agent-team-workflow` → PR targeting `main`

## Files to Create

### Template files (`all/copy-overwrite/`)

| File | Purpose |
|------|---------|
| `all/copy-overwrite/.claude/rules/plan-governance.md` | Governance rules extracted from plan.md (Required Tasks, Branch/PR, Git Workflow, Implementation Team Guidance, Ticket Integration) |
| `all/copy-overwrite/.claude/agents/architecture-planner.md` | Technical architecture planning agent for plan-create Phase 2 |
| `all/copy-overwrite/.claude/agents/test-strategist.md` | Test strategy planning agent for plan-create Phase 2 |
| `all/copy-overwrite/.claude/agents/security-planner.md` | Security planning agent for plan-create Phase 2 |
| `all/copy-overwrite/.claude/agents/product-planner.md` | Product/UX planning agent for plan-create Phase 2 |
| `all/copy-overwrite/.claude/agents/consistency-checker.md` | Cross-plan consistency verification agent for plan-create Phase 3 |
| `all/copy-overwrite/.claude/agents/implementer.md` | Moved from Lisa-only to template — needed by plan-implement in downstream projects |
| `all/copy-overwrite/.claude/agents/tech-reviewer.md` | Moved from Lisa-only to template — needed by plan-implement in downstream projects |
| `all/copy-overwrite/.claude/agents/product-reviewer.md` | Moved from Lisa-only to template — needed by plan-implement in downstream projects |
| `all/copy-overwrite/.claude/agents/learner.md` | Moved from Lisa-only to template — needed by plan-implement in downstream projects |

### Lisa project files (`.claude/`)

| File | Purpose |
|------|---------|
| `.claude/rules/plan-governance.md` | Copy of template (Lisa eats its own dogfood) |
| `.claude/agents/architecture-planner.md` | Copy of template |
| `.claude/agents/test-strategist.md` | Copy of template |
| `.claude/agents/security-planner.md` | Copy of template |
| `.claude/agents/product-planner.md` | Copy of template |
| `.claude/agents/consistency-checker.md` | Copy of template |

## Files to Modify

### Template files (`all/copy-overwrite/`)

| File | Changes |
|------|---------|
| `all/copy-overwrite/.claude/rules/plan.md` | Remove governance sections. Keep only: Task Creation Specification, Type-Specific Requirements, Task Sizing. Rename header to "Plan Document Format". ~70 lines down from ~154. |
| `all/copy-overwrite/.claude/rules/lisa.md` | Add `plan-governance.md` to "Files with local overrides" table. Add new agents to "no local override" list. |
| `all/copy-overwrite/.claude/skills/plan-create/SKILL.md` | Rewrite with 4-phase workflow: Research → Domain Sub-Plans → Adversarial Review → Synthesis |
| `all/copy-overwrite/.claude/skills/plan-implement/SKILL.md` | Rewrite with 5-phase workflow: Setup → Implementation (TDD) → Reviews → Post-Review → Learning & Archive |

### Lisa project files (`.claude/`)

| File | Changes |
|------|---------|
| `.claude/rules/plan.md` | Mirror template changes (same content, different header — "Plan Rules" vs "Plan Mode Rules") |
| `.claude/rules/lisa.md` | Mirror template changes |
| `.claude/skills/plan-create/SKILL.md` | Mirror template changes (minor wording diffs maintained) |
| `.claude/skills/plan-implement/SKILL.md` | Mirror template changes (minor wording diffs maintained) |
| `.claude/agents/implementer.md` | Add TDD cycle enforcement to workflow (template copy gets TDD from the start) |
| `.claude/agents/tech-reviewer.md` | No content changes — now also exists as template copy |
| `.claude/agents/product-reviewer.md` | No content changes — now also exists as template copy |
| `.claude/agents/learner.md` | No content changes — now also exists as template copy |

## Files NOT Modified (and why)

| File | Reason |
|------|--------|
| `.claude/hooks/enforce-plan-rules.sh` | Still works — reinjects plan.md (now slimmed to document format only). Teammates not in plan mode won't trigger it. |
| `.claude/hooks/track-plan-sessions.sh` | Tracks plan file writes regardless of workflow. No changes needed. |
| `.claude/commands/plan/create.md` | Pass-through to skill, no changes needed |
| `.claude/commands/plan/implement.md` | Pass-through to skill, no changes needed |
| `.claude/rules/verfication.md` | Unchanged — referenced by tasks, not affected by this refactor |
| `.claude/rules/coding-philosophy.md` | Unchanged |
| `.claude/agents/test-coverage-agent.md` | Unchanged — works as-is in plan-implement Phase 4 |

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Split plan.md vs scoping language | Split into two files | Scoping language is fragile; LLMs may still be influenced. Separate file keeps governance out of teammate context entirely. |
| New agents in template vs Lisa-only | Template (`all/copy-overwrite/`) | Domain planners are generically useful for any downstream project, not Lisa-specific |
| Teammate mode | `bypassPermissions` for all | All planning agents have restricted tool sets (Read, Grep, Glob, Bash). No write tools. Pre-commit hooks guard quality for implementers. |
| Communication pattern | SendMessage (not file writes) | Avoids file system coordination conflicts between parallel agents. Team lead receives messages automatically. |
| Phase 1→2 handoff | Team lead synthesizes "Research Brief" and passes to Phase 2 prompts | Team lead is idle during Phase 1; synthesis is natural next step. Each Phase 2 agent gets tailored context. |
| Devil's advocate agent definition | No dedicated agent — use `general-purpose` with adversarial prompt | Role is too context-specific for plan creation to warrant a reusable agent definition. |
| Number of implementers | Team lead decides at runtime (1-3 based on task graph parallelism) | Fixed count wastes resources for small plans or under-utilizes for large ones. |
| TDD enforcement | In implementer agent prompt, not in SKILL.md | Implementer owns its own workflow discipline. SKILL.md assigns tasks; implementer follows TDD internally. |
| Move 4 agents to template | Yes — implementer, tech-reviewer, product-reviewer, learner | plan-implement is a template skill that references these agents. Without them, downstream projects fall back to generic agents. |

## Implementation Details

### Task 1: Create branch and draft PR

Create `refactor/plan-agent-team-workflow` from `main`. Open draft PR.

### Task 2: Split plan.md into plan.md + plan-governance.md

**plan.md** keeps only (both template and project):
- Task Creation Specification (Parameters, Description Template)
- Type-Specific Requirements (Bug, Story, Task, Epic sections)
- Task Sizing
- Metadata schema

**plan-governance.md** gets (new file, both template and project):
- Required Behaviors ("When making a plan" intro)
- Required Tasks list (product review, CodeRabbit, local code review, etc.)
- Branch and PR Rules
- Ticket Integration
- Git Workflow
- Implementation Team Guidance table
- Note about lint/format hooks
- Note about Sessions section auto-maintenance

The template version (`all/copy-overwrite/.claude/rules/plan.md`) keeps its "Plan Mode Rules" header and introductory paragraph about enforcement hooks. The project version (`.claude/rules/plan.md`) keeps its "Plan Rules" header.

### Task 3: Create domain planner agents + move existing agents to template

**Part A: Create 5 new agent definitions** in both template and project directories. Follow the pattern of existing agents (`codebase-analyzer.md` for structure, `product-reviewer.md` for review-style output format).

All new agents share: `tools: Read, Grep, Glob, Bash` and `model: inherit`.

**architecture-planner.md**: Designs technical approach, identifies files to modify, maps dependencies, recommends patterns. Output: files to create/modify, dependency graph, design decisions, reusable code references.

**test-strategist.md**: Designs test matrix (unit/integration/E2E), identifies edge cases, sets coverage targets, recommends test patterns from existing codebase conventions. Output: test matrix table, edge case list, coverage targets, verification commands.

**security-planner.md**: Lightweight threat modeling (STRIDE), identifies auth/validation gaps, checks for secrets exposure patterns, recommends security measures. Output: threat model, security checklist, specific vulnerabilities to guard against.

**product-planner.md**: Defines user flows in Gherkin Given/When/Then, writes acceptance criteria from user perspective, identifies UX concerns and error states. Output: user flows, acceptance criteria checklist, UX concerns, error handling requirements.

**consistency-checker.md**: Compares sub-plan outputs for contradictions, verifies file lists align across sub-plans, confirms test strategy covers architecture changes, checks security measures reflected in acceptance criteria. Output: contradictions found, gaps identified, alignment confirmation.

**Part B: Move 4 existing agents to template.** Copy the following from `.claude/agents/` to `all/copy-overwrite/.claude/agents/`:
- `implementer.md` — with TDD workflow update (see Task 6)
- `tech-reviewer.md` — as-is
- `product-reviewer.md` — as-is
- `learner.md` — as-is

These agents are needed by plan-implement which is a template skill. Without them in the template, downstream projects would fall back to generic agents.

### Task 4: Rewrite plan-create SKILL.md

New 4-phase workflow (both template and project, maintaining existing minor diffs):

**Step 1: Parse Input** — Same as current (ticket URL, file path, free text)

**Step 2: Detect Plan Type** — Same as current (Bug, Story, Task, Epic)

**Step 3: Assess Complexity** — NEW. Trivial plans (single file, config, docs) skip to direct synthesis. Standard/Epic plans proceed through all phases.

**Step 4: Phase 1 - Research (parallel)**
- Spawn `researcher` (agent type: `general-purpose`, mode: `bypassPermissions`) — Research ticket/spec, reproduce bugs, extract requirements
- Spawn `explorer` (agent type: `Explore`) — Find relevant code, patterns, existing utilities
- Wait for both to report back via SendMessage

**Step 5: Phase 1.5 - Research Brief (team lead)**
- Synthesize Phase 1 findings into a structured Research Brief
- Include: ticket details, reproduction results, relevant files, patterns found, architecture constraints, reusable utilities

**Step 6: Phase 2 - Domain Sub-Plans (parallel)**
- Spawn `arch-planner` (agent type: `architecture-planner`, mode: `bypassPermissions`) — Pass Research Brief + architecture-specific instructions
- Spawn `test-strategist` (agent type: `test-strategist`, mode: `bypassPermissions`) — Pass Research Brief + testing-specific instructions
- Spawn `security-planner` (agent type: `security-planner`, mode: `bypassPermissions`) — Pass Research Brief + security-specific instructions
- Spawn `product-planner` (agent type: `product-planner`, mode: `bypassPermissions`) — Pass Research Brief + product-specific instructions
- Wait for all four to report back

**Step 7: Phase 3 - Review (parallel)**
- Spawn `devils-advocate` (agent type: `general-purpose`, mode: `bypassPermissions`) — Pass all sub-plans + adversarial prompt
- Spawn `consistency-checker` (agent type: `consistency-checker`, mode: `bypassPermissions`) — Pass all sub-plans + alignment verification instructions
- Wait for both to report back

**Step 8: Phase 4 - Synthesis (team lead)**
- Read `@.claude/rules/plan-governance.md` for governance rules
- Read `@.claude/rules/plan.md` for task document format
- Merge sub-plans + review feedback into unified plan
- Apply governance: Required Tasks, Branch/PR rules, Git Workflow
- Create TaskCreate specs per plan.md format
- Write plan to `plans/<name>.md`
- Create branch, open draft PR
- Update ticket if applicable

**Step 9: Present to User** — Same as current

**Step 10: Shutdown Team** — Send shutdown_request to all teammates

**Bug-Specific Rules** — Same as current (must reproduce empirically, STOP if cannot reproduce)

### Task 5: Rewrite plan-implement SKILL.md

New 5-phase workflow (both template and project, maintaining existing minor diffs):

**Step 1: Parse Plan** — Read plan file, extract tasks with dependencies and verification

**Step 2: Setup (team lead)**
- Read `@.claude/rules/plan-governance.md` for governance rules
- Verify branch exists (create if needed)
- Verify draft PR exists (create if needed)
- Build dependency graph from tasks
- Determine implementer count:
  - 1-2 independent tasks → 1 implementer
  - 3-5 independent tasks → 2 implementers
  - 6+ independent tasks → 3 implementers (cap)

**Step 3: Create Agent Team**
- Spawn implementers (named `implementer-1`, `implementer-2`, etc.) — agent type: `implementer`, mode: `bypassPermissions`
- Create all tasks via TaskCreate with proper `blockedBy` relationships
- Assign first batch of independent tasks

**Step 4: Phase 2 - Implementation**
- Implementers work on assigned tasks using TDD (red-green-refactor)
- Team lead monitors completion via messages
- After each task: team lead runs `git add <files>` + `git commit` with conventional message
- Assign next tasks as dependencies resolve

**Step 5: Phase 3 - Reviews (parallel)**
- Spawn `tech-reviewer` — agent type: `tech-reviewer`, mode: `bypassPermissions`
- Spawn `product-reviewer` — agent type: `product-reviewer`, mode: `bypassPermissions`
- Invoke `/plan-local-code-review` skill (team lead runs directly)
- Invoke `coderabbit:review` skill if plugin available

**Step 6: Phase 4 - Post-Review (sequential)**
- Re-spawn implementer to fix valid review findings
- Invoke `code-simplifier` plugin for simplification
- Spawn `test-coverage-agent` to update tests for post-review changes
- Team lead runs ALL proof commands from all tasks to verify

**Step 7: Phase 5 - Learning & Archive**
- Spawn `learner` agent to collect and process learnings
- After learner completes, team lead archives:
  - Create folder `<plan-name>` in `./plans/completed`
  - Rename plan to reflect actual contents
  - Move into `./plans/completed/<plan-name>`
  - Read session IDs, move task directories
  - Update any "in_progress" tasks to "completed"
  - `git push`, `gh pr ready`, `gh pr merge --auto --merge`

**Step 8: Shutdown Team**

### Task 6: Update implementer agent with TDD enforcement

Modify both `.claude/agents/implementer.md` (project) and `all/copy-overwrite/.claude/agents/implementer.md` (template) to add TDD cycle:

Current workflow step 4 is "Run tests after changes". Replace the entire Workflow section with:

```
## Workflow

1. **Read before writing** -- read existing code before modifying it
2. **Follow existing patterns** -- match the style, naming, and structure of surrounding code
3. **One task at a time** -- complete the current task before moving on
4. **RED** -- Write a failing test that captures the expected behavior from the task description
5. **GREEN** -- Write the minimum production code to make the test pass
6. **REFACTOR** -- Clean up while keeping tests green
7. **Verify empirically** -- run the task's proof command and confirm expected output
```

### Task 7: Update lisa.md managed files list

In both template and project versions of `.claude/rules/lisa.md`:

**"Files with local overrides" table** — Add row:

| `plan-governance.md` | `.claude/rules/PROJECT_RULES.md` |

This follows the same pattern as plan.md — downstream projects can override governance rules via PROJECT_RULES.md.

**"No local override" list** — The `.claude/agents/*` entry already covers all agents. No change needed for agents. Verify `plan-governance.md` is covered by the table addition above.

### Task 8-17: Required review and post-implementation tasks

Per plan-governance.md Required Tasks:

- **Task 8**: Product/UX review using `product-reviewer` agent
- **Task 9**: CodeRabbit code review
- **Task 10**: Local code review via `/plan-local-code-review`
- **Task 11**: Technical review using `tech-reviewer` agent
- **Task 12**: Implement valid review suggestions (blocked by Tasks 8-11)
- **Task 13**: Simplify code using code simplifier agent (blocked by Task 12)
- **Task 14**: Update/add/remove tests as needed (blocked by Task 12)
- **Task 15**: Update/add/remove documentation (blocked by Task 12)
- **Task 16**: Verify all verification metadata in existing tasks (blocked by Task 12)
- **Task 17**: Collect learnings using `learner` agent (blocked by Tasks 13-16)

### Task 18: Archive the plan

- Create a folder named `refactor-plan-agent-team-workflow` in `./plans/completed`
- Rename this plan to reflect its actual contents
- Move it into `./plans/completed/refactor-plan-agent-team-workflow`
- Read session IDs from `./plans/completed/refactor-plan-agent-team-workflow`
- Move each `~/.claude/tasks/<session-id>` directory to `./plans/completed/refactor-plan-agent-team-workflow/tasks`
- Update any "in_progress" task to "completed"
- Commit and push changes to the PR

## Task Dependency Graph

```
Task 1 (branch + PR)
└── Task 2 (split plan.md) ─────────────────────────────┐
    ├── Task 3 (create domain planner agents)            │
    │   └── Task 4 (rewrite plan-create SKILL.md) ──┐   │
    ├── Task 5 (rewrite plan-implement SKILL.md) ────┤   │
    ├── Task 6 (update implementer TDD) ─────────────┤   │
    └── Task 7 (update lisa.md) ─────────────────────┘   │
        ├── Task 8 (product review) ─────────────┐       │
        ├── Task 9 (CodeRabbit review) ──────────┤       │
        ├── Task 10 (local code review) ─────────┤       │
        └── Task 11 (tech review) ───────────────┘       │
            └── Task 12 (implement review suggestions)   │
                ├── Task 13 (simplify code)              │
                ├── Task 14 (update tests)               │
                ├── Task 15 (update docs)                │
                └── Task 16 (verify metadata)            │
                    └── Task 17 (collect learnings)      │
                        └── Task 18 (archive) ───────────┘
```

Tasks 3, 5, 6, 7 can run in parallel after Task 2.
Task 4 depends on Task 3 (needs new agents to exist).
Tasks 8-11 can run in parallel after Tasks 4-7 complete.
Tasks 13-16 can run in parallel after Task 12.

## Implementation Team

When ready to implement, spawn an Agent Team with these roles:

| Agent | Type | Tasks | Why |
|-------|------|-------|-----|
| `implementer-1` | `implementer` | Tasks 2, 4, 6 | plan.md split, plan-create rewrite, implementer TDD update |
| `implementer-2` | `implementer` | Tasks 3, 5, 7 | Agent definitions, plan-implement rewrite, lisa.md update |
| `tech-reviewer` | `tech-reviewer` | Task 11 | Technical correctness review |
| `product-reviewer` | `product-reviewer` | Task 8 | Product/UX validation |
| `learner` | `learner` | Task 17 | Collect learnings |

Tasks 1, 9, 10, 12-16, 18 should be done by the team lead.

## Skills to Invoke

- `/git-commit` — For atomic conventional commits during implementation
- `/plan-local-code-review` — For Task 10
- `/jsdoc-best-practices` — When writing agent definition preambles
- `coderabbit:review` — For Task 9

## Verification

End-to-end verification after all tasks complete:

```bash
# Verify plan.md only contains document format (no governance)
grep -c "Required Tasks\|Branch and PR Rules\|Git Workflow\|Implementation Team Guidance" .claude/rules/plan.md
# Expected: 0

# Verify plan-governance.md exists with governance content
grep -c "Required Tasks" .claude/rules/plan-governance.md
# Expected: 1

# Verify new domain planner agents exist in template
ls all/copy-overwrite/.claude/agents/{architecture-planner,test-strategist,security-planner,product-planner,consistency-checker}.md
# Expected: all 5 files listed

# Verify new domain planner agents exist in project
ls .claude/agents/{architecture-planner,test-strategist,security-planner,product-planner,consistency-checker}.md
# Expected: all 5 files listed

# Verify moved agents exist in template (previously Lisa-only)
ls all/copy-overwrite/.claude/agents/{implementer,tech-reviewer,product-reviewer,learner}.md
# Expected: all 4 files listed

# Verify plan-create references plan-governance.md
grep "plan-governance" all/copy-overwrite/.claude/skills/plan-create/SKILL.md
# Expected: at least 1 match

# Verify plan-implement references plan-governance.md
grep "plan-governance" all/copy-overwrite/.claude/skills/plan-implement/SKILL.md
# Expected: at least 1 match

# Verify implementer has TDD workflow in both locations
grep "RED" .claude/agents/implementer.md
grep "RED" all/copy-overwrite/.claude/agents/implementer.md
# Expected: at least 1 match each

# Verify template and project agent files are in sync
diff all/copy-overwrite/.claude/rules/plan-governance.md .claude/rules/plan-governance.md
diff all/copy-overwrite/.claude/agents/architecture-planner.md .claude/agents/architecture-planner.md
diff all/copy-overwrite/.claude/agents/implementer.md .claude/agents/implementer.md
# Expected: no diff (or expected header diffs only)

# Lint check
bun run lint
# Expected: no errors

# Typecheck
bun run typecheck
# Expected: no errors
```
