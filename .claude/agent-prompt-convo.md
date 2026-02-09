# Agent Teams + Plan Mode -- Conversation Notes (2026-02-08)

## Key Takeaway: Plan Mode is for Teammates, Not the Lead

The team lead (main Claude session) must NOT be in plan mode. It needs full tool access to call `TeamCreate`, `Task`, `SendMessage`, `TaskCreate`/`TaskUpdate`, and orchestrate teammates.

Plan mode is applied to **teammates** via `"mode": "plan"` when spawning them. This restricts them to read-only exploration until the team lead approves their plan.

## How Plan Mode for Teammates Works

1. User gives plain English prompt (NOT in plan mode)
2. Claude (team lead) spawns teammates with `"mode": "plan"`
3. Teammates explore codebase (read-only) and design an approach
4. Teammates call `ExitPlanMode`, sending `plan_approval_request` to team lead
5. Team lead approves or rejects (with feedback) via `plan_approval_response`
6. After approval, teammates gain full tool access and implement

## User-Facing Prompt Style

You write plain English, not JSON. To trigger plan mode for teammates:
> "Spawn all teammates in plan mode so I can review their findings before implementation"

## Two-Phase Workflow (Planning then Implementation)

This is a **two-prompt process**, not fully automatic:

1. **Phase 1 (Planning):** Planning prompt -> planning team researches and produces a plan -> user reviews and approves
2. **Phase 2 (Implementation):** User gives a second prompt like "implement the plan at `~/plans/xyz.md`" -> Claude creates a new implementation team

**Limitation:** One team per session. Claude must shut down Team 1 (via `shutdown_request` + `TeamDelete`) before creating Team 2, or the user starts a fresh session.

## Prompt Structure

The prompt template (see `agent-prompt.md` for bug-fix version, `agent-prompt-test.md` for simple test version) has these sections:

1. **Task** -- plain English description
2. **Team structure** -- roles, plan mode, synthesis instruction
3. **Requirements** -- standards, reuse, documentation
4. **Bug replication** (bug-fix only) -- hard gate: cannot reproduce = stop and update JIRA
5. **Verification** -- empirical proof required, no CI/CD, proof commands + expected output
6. **Anti-patterns** -- do not copy existing bad patterns; flag them instead
7. **JIRA updates** (bug-fix only) -- ticket association, plan comments, blocked updates
8. **Plan output** -- where to write it, second team instructions, human review requirements

## Critical Rules

- **Replication is a hard gate:** Cannot prove the bug exists? Stop. Do not guess.
- **Anti-patterns in codebase are not justification:** Existing bad code does not make it correct.
- **Teammates do not share context:** Each has its own context window. Important rules must be in the prompt or CLAUDE.md.
- **Verification must be local:** No CI/CD. Proof commands with expected output.
- **JIRA must stay in sync:** Branch association, plan comments, blocked updates.

## Files Created

- `.claude/agent-prompt.md` -- Bug-fix planning prompt (JIRA-integrated)
- `.claude/agent-prompt-test.md` -- Test prompt (Fibonacci function, no JIRA)
- `.claude/agent-prompt-convo.md` -- This file

## Improvements Made (2026-02-08)

After testing the workflow with a Fibonacci demo task, six deficiencies were identified and fixed:

1. **Learn phase** -- `learner` agent collects task learnings and processes them through `skill-evaluator`
2. **Specialized agents** -- `implementer`, `tech-reviewer`, `product-reviewer`, and `learner` replace all-`general-purpose` recommendations
3. **Product review** -- `product-reviewer` validates features from a non-technical perspective by running them
4. **Git workflow streamlined** -- draft PR first, commits only during implementation, one push at the end
5. **Lint task removed** -- PostToolUse hooks and lint-staged pre-commit hooks handle linting, formatting, and type-checking
6. **Default to recommended option** -- unresolved decisions use the recommendation instead of stalling

### New Agent Files

- `.claude/agents/implementer.md` -- Code implementation specialist
- `.claude/agents/tech-reviewer.md` -- Beginner-friendly technical reviewer
- `.claude/agents/product-reviewer.md` -- Product/UX reviewer with empirical validation
- `.claude/agents/learner.md` -- Post-implementation learning agent

### Updated Files

- `.claude/rules/plan.md` -- All 6 improvements integrated
- `.claude/agent-prompt.md` -- References specialized agents, product review, tech review, learner, lint automation
- `.claude/agent-prompt-test.md` -- Same updates

## Next Step

Test the flow with `agent-prompt-test.md` on a throwaway task to validate the two-phase handoff before using it on real JIRA tickets.
