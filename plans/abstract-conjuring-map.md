# Plan: Redesign Intent Routing — 8 Flows to 4 Main Flows

## Context

The current intent-routing system has 8 flows (Fix, Build, Investigate, Plan, Verify, Ship, Review, Improve, Monitor) that evolved organically. The boundaries between them are blurry — Ship is a sub-flow, Verify is a sub-flow, Review is a sub-flow, but Fix/Build/Improve are top-level despite sharing 80% of their structure. Monitor is a top-level flow that just calls one agent.

The redesign consolidates into 4 main flows with clear goals, readiness gates, and composable sub-flows:

| Flow | Goal | Output |
|------|------|--------|
| **Research** | Understand a problem space | PRD document |
| **Plan** | Break a PRD into workable units | Tickets in a tracker |
| **Implement** | Code + validate + verify locally | Verified code + e2e test |
| **Verify** | Ship and verify in production | Merged PR + healthy deploy |

Each flow has a **readiness gate** — it refuses to start without the information needed to accomplish its goal.

Additionally, the system enforces flow selection via hooks and rules:
- If the agent can't determine the flow from context, it presents a multiple choice (Research, Plan, Implement, Verify, No flow)
- Subagents never ask — the parent agent passes flow context via hooks
- Hooks enforce readiness gates and required metadata

---

## Readiness Gates

| Flow | Required to Begin | If Missing |
|------|-------------------|------------|
| **Research** | Problem statement, feature idea, or business objective | Ask: "What problem are you trying to solve?" |
| **Plan** | PRD or spec with clear scope + acceptance criteria | Suggest: "Run /research first to produce a PRD" |
| **Implement (Build)** | Work item with acceptance criteria + verification method | Ask for missing criteria; if epic-level, suggest /plan |
| **Implement (Fix)** | Bug report with enough detail to attempt reproduction | Ask for reproduction steps, error messages, environment |
| **Implement (Improve)** | Target to improve + measurable baseline | Ask: "What should be improved and how will we measure it?" |
| **Implement (Investigate)** | Clear question or issue to investigate | Ask: "What are you trying to understand?" |
| **Verify** | Code passing local validation + local empirical verification | Go back to Implement |

---

## Files to Change

### 1. Rewrite `plugins/src/base/rules/intent-routing.md` (HIGH effort)

Complete rewrite. New structure:

**Flow Classification Protocol** — new section at the top:
- A `UserPromptSubmit` prompt hook uses haiku to pre-classify the user's request and injects the result as `additionalContext`. Use this classification as a strong hint but verify it against intent-routing rules.
- If the classification is "None" or you disagree with the hint, and the session is **interactive** (user is present), present a multiple choice using AskUserQuestion with options: Research, Plan, Implement, Verify, No flow.
- If the session is **headless/non-interactive** (running with `-p` flag, in a CI pipeline, or as a scheduled agent), do NOT ask the user. Classify to the best of your ability from the available context (ticket content, prompt text, current branch state). If you truly cannot classify, default to "No flow" and proceed with the request as-is.
- Once a flow is selected, check its readiness gate before proceeding.
- If you are a subagent: your parent agent has already determined the flow — do NOT ask the user to choose a flow. Execute your assigned work within the established flow context.

**Readiness Gate Protocol** — every flow checks prerequisites before starting.

**4 Main Flows:**

- **Research**: Gate requires a problem statement. Sequence: Investigate sub-flow -> `product-specialist` (user goals, flows, acceptance criteria) -> `architecture-specialist` (technical feasibility) -> synthesize PRD -> `learner`.
- **Plan**: Gate requires a PRD or detailed spec. Sequence: Investigate sub-flow -> `product-specialist` (validate/refine criteria) -> `architecture-specialist` (map dependencies) -> decompose into ordered work items -> create in tracker -> `learner`.
- **Implement**: Gate requires a well-defined work item with acceptance criteria. Determines work type and dispatches:
  - **Build** (features/stories): Investigate -> product -> architecture -> test-specialist -> builder -> validate -> verify locally -> write e2e test -> Review sub-flow -> learner
  - **Fix** (bugs): **Reproduce sub-flow** (mandatory) -> Investigate -> debug-specialist -> architecture -> test-specialist -> bug-fixer -> validate -> verify locally -> write e2e test -> Review sub-flow -> learner
  - **Improve** (refactoring): Investigate -> architecture (measure baseline) -> test-specialist (safety net) -> builder -> validate -> verify (prove improvement) -> write e2e test -> Review sub-flow -> learner
  - **Investigate Only** (spikes): Investigate sub-flow -> report findings -> recommend next action -> learner
- **Verify**: Gate requires code passing local validation. Sequence: commit -> PR -> PR watch loop (fix CI, resolve conflicts, handle bot reviews) -> merge -> monitor deploy -> remote verification (same checks as local, on target environment) -> ops-specialist (health check, error monitoring).

**Sub-flows** (reusable):
- **Investigate**: git-history-analyzer -> debug-specialist -> ops-specialist -> report findings
- **Reproduce**: Execute bug scenario -> capture evidence -> write failing test or script -> verify reproduction is reliable
- **Review**: quality + security + performance (parallel) -> product-specialist -> test-specialist -> consolidate findings
- **Monitor**: ops-specialist -> health checks, log inspection, error monitoring -> report findings

**JIRA Entry Point**: jira-agent reads ticket, validates, triages, then maps:
- Epic -> Plan
- Story/Task -> Implement (Build)
- Bug -> Implement (Fix)
- Spike -> Implement (Investigate Only)
- Improvement -> Implement (Improve)

**Flow Chaining**: Research -> Plan -> Implement (per item) -> Verify (per item). If any flow lacks what it needs, it stops and suggests the preceding flow.

### 2. Add `plugins/src/base/commands/research.md` (NEW)

```markdown
---
description: "Research a problem space and produce a PRD. Investigates codebase, defines user flows, assesses technical feasibility."
argument-hint: "<problem-statement-or-feature-idea>"
---

Read `.claude/rules/intent-routing.md` and execute the **Research** flow.

$ARGUMENTS
```

### 3. Add `plugins/src/base/commands/verify.md` (NEW)

```markdown
---
description: "Ship and verify code. Commits, opens PR, handles review loop, merges, deploys, and verifies in target environment."
argument-hint: "[commit-message-hint]"
---

Read `.claude/rules/intent-routing.md` and execute the **Verify** flow.

This includes: atomic commits, PR creation, CI/review-fix loop, merge, deploy monitoring, and remote verification.

$ARGUMENTS
```

### 4. Modify `plugins/src/base/commands/ship.md` (LOW)

Redirect to Verify:
```markdown
---
description: "Ship current changes. Alias for /verify."
argument-hint: "[commit-message-hint]"
---

Read `.claude/rules/intent-routing.md` and execute the **Verify** flow.

$ARGUMENTS
```

### 5. Modify `plugins/src/base/commands/fix.md` (LOW)

Change "execute the **Fix** flow" to "execute the **Implement** flow with the **Fix** work type". Update JIRA delegation text to say "delegate back to the Implement flow".

### 6. Modify `plugins/src/base/commands/build.md` (LOW)

Change "execute the **Build** flow" to "execute the **Implement** flow with the **Build** work type".

### 7. Modify `plugins/src/base/commands/improve.md` (LOW)

Change "execute the **Improve** flow" to "execute the **Implement** flow with the **Improve** work type". Keep the list of specialized sub-commands.

### 8. Modify `plugins/src/base/commands/investigate.md` (LOW)

Change "execute the **Investigate** flow" to "execute the **Implement** flow with the **Investigate Only** work type (spike)".

### 9. Modify `plugins/src/base/commands/plan.md` (LOW)

Add readiness gate language: "If no PRD or specification exists, suggest running the Research flow first."

### 10. Modify `plugins/src/base/commands/review.md` (LOW)

Change "execute the **Review** flow" to "execute the **Review** sub-flow". Clarify it's also invoked automatically by the Implement flow.

### 11. Modify `plugins/src/base/commands/monitor.md` (LOW)

Change "execute the **Monitor** flow" to "execute the **Monitor** sub-flow". Clarify it's also invoked as part of the Verify flow.

### 12. Modify `plugins/src/base/commands/plan/execute.md` (LOW)

Change "ship sub-flows" to "verify flow" in the description text.

### 13. Modify `plugins/src/base/commands/plan/create.md` (LOW)

Add readiness gate: if requirements are ambiguous, suggest Research first.

### 14. Modify `plugins/src/base/agents/jira-agent.md` (MEDIUM)

Update the intent mapping table in Step 4:

| Ticket Type | Flow | Work Type |
|-------------|------|-----------|
| Epic | Plan | -- |
| Story | Implement | Build |
| Task | Implement | Build |
| Bug | Implement | Fix |
| Spike | Implement | Investigate Only |
| Improvement | Implement | Improve |

Update description (line 3) from "Bug -> Fix, Story/Task -> Build, Epic -> Plan" to "Bug -> Implement/Fix, Story/Task -> Implement/Build, Epic -> Plan, Spike -> Implement/Investigate".

### 15. Modify `plugins/src/base/agents/bug-fixer.md` (LOW)

Line 17: Change "from the Fix flow" to "from the **Implement** flow (Fix work type)".

### 16. Modify `plugins/src/base/agents/builder.md` (LOW)

Line 17: Change "from the Build flow" to "from the **Implement** flow (Build or Improve work type)".

### 17. Modify `plugins/src/base/skills/plan-execute/SKILL.md` (MEDIUM)

Three changes:
1. **Work type classification** (lines 38-44): Replace the 5 types (Informational/Spike, Task, Bug, Feature/Story, Epic) with: first determine which main flow applies (Research, Plan, Implement, Verify), then if Implement determine the work type (Build, Fix, Improve, Investigate Only). Add readiness gate check.
2. **Bug reproduction** (lines 45-49): Strengthen to reference the mandatory Reproduce sub-flow. Bug reproduction MUST succeed before any fix is attempted.
3. **Shutdown sequence** (lines 81-89): Update to reference the Verify flow explicitly — local validation -> commit -> PR -> PR watch loop -> merge -> deploy monitoring -> remote verification.

### 18. Modify `plugins/src/base/rules/verification.md` (LOW)

Add a brief section distinguishing **local verification** (part of Implement — tests, typecheck, lint, empirical verification against local environment) from **remote verification** (part of Verify — post-deploy health check, smoke test, production monitoring). The existing content is accurate but doesn't make this distinction explicit.

### 19. Modify `OVERVIEW.md` (MEDIUM)

Update the Flows table (lines 249-256):

| Category | Command | Purpose |
|----------|---------|---------|
| **Flows** | `/research` | Research a problem space, produce a PRD |
| | `/plan` | Break down a PRD into work items |
| | `/fix` | Implement a bug fix (Implement/Fix) |
| | `/build` | Build a feature (Implement/Build) |
| | `/improve` | Improve existing code (Implement/Improve) |
| | `/investigate` | Investigate an issue (Implement/Investigate Only) |
| | `/verify` | Ship, deploy, and verify in production |
| | `/review` | Review code changes (sub-flow, also standalone) |
| | `/monitor` | Monitor application health (sub-flow, also standalone) |

### 20. Add flow classification hook to `plugins/src/base/.claude-plugin/plugin.json` (MEDIUM)

**UserPromptSubmit `prompt` hook** that uses a fast model (haiku) to classify the user's intent into a flow.

Unlike deterministic pattern matching, this uses haiku to understand nuance ("the login page is crashing" -> Implement/Fix, "we need to rethink how auth works" -> Research). The `prompt` hook type sends the prompt to a fast model and returns its response as `additionalContext`.

```json
{
  "type": "prompt",
  "prompt": "Classify this user request into exactly one flow. Output ONLY valid JSON.\n\nFlows:\n- Research: User needs requirements defined, wants a PRD, exploring a problem space, open-ended feature idea\n- Plan: User has requirements and wants them broken into tickets/work items\n- Implement/Build: User has a specific feature/story/task to code\n- Implement/Fix: User has a bug to fix, something is broken\n- Implement/Improve: User wants to refactor, optimize, or improve existing code\n- Implement/Investigate: User wants to understand why something works a certain way (spike)\n- Verify: User has code ready to ship (PR, deploy, merge)\n- None: Simple question, config change, one-off task, or not enough context to classify\n\nOutput format: {\"hookSpecificOutput\":{\"hookEventName\":\"UserPromptSubmit\",\"additionalContext\":\"Flow classification: [FLOW]. Reason: [one sentence].\"}}\n\nUser request: $ARGUMENTS"
}
```

This is registered in the `UserPromptSubmit` array in `plugin.json`. It only fires for the main session (not subagents, which use SubagentStart).

**Why haiku over regex:** Haiku understands intent ("users can't log in" is a Fix, not a Build). Regex would misclassify on phrasing like "add a fix for the crash" (contains both "add" and "fix"). Haiku is fast enough for a UserPromptSubmit hook (~200ms) and accurate enough for classification.

### 21. Add `plugins/src/base/hooks/inject-flow-context.sh` (NEW — LOW)

**SubagentStart hook** that tells subagents not to ask the user for flow selection.

```bash
#!/usr/bin/env bash
set -euo pipefail
jq -n '{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "You are a subagent operating within an established flow. Your parent agent has already determined the flow and work type. Do NOT ask the user to choose a flow or classify the request. Execute your assigned work within the context provided by your parent agent."
  }
}'
```

### 22. Modify `plugins/src/base/.claude-plugin/plugin.json` (MEDIUM)

Register the two new hooks:

1. Add the haiku prompt hook to the `UserPromptSubmit` array (from item 20 above):
```json
{
  "type": "prompt",
  "prompt": "Classify this user request into exactly one flow..."
}
```

2. Add `inject-flow-context.sh` to the `SubagentStart` array (alongside existing `inject-rules.sh`):
```json
{
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/hooks/inject-flow-context.sh"
}
```

### 23. Rebuild `plugins/lisa/` (AUTO)

Run `bun run build:plugins` after all source changes. This copies `plugins/src/base/` to `plugins/lisa/` and updates all affected built files.

---

## Files NOT Changing

- **All 40+ skills** (except `plan-execute`): Skills are self-contained methodologies that don't reference flow names. Confirmed via grep.
- **11 of 15 agents**: architecture-specialist, debug-specialist, git-history-analyzer, learner, performance-specialist, product-specialist, quality-specialist, security-specialist, skill-evaluator, test-specialist, verification-specialist — none reference flow names.
- **Existing hooks**: `inject-rules.sh`, `install-pkgs.sh`, `setup-jira-cli.sh`, `notify-ntfy.sh`, `sync-tasks.sh`, `debug-hook.sh`, `ticket-sync-reminder.sh`, `track-plan-sessions.sh` — all flow-agnostic.
- **Rules**: `base-rules.md`, `coding-philosophy.md`, `security-audit-handling.md` — no flow name references.
- **All git/jira/plan/security/pull-request sub-commands**: No flow name references.
- **Stack-specific plugins** (expo, rails, nestjs, cdk, typescript): No flow name references.
- **Source code** (`src/`), **tests** (`tests/`): No flow name references.

---

## Implementation Order

1. `plugins/src/base/rules/intent-routing.md` — the single source of truth, everything else references it
2. `plugins/src/base/hooks/inject-flow-context.sh` — subagent flow context hook
3. `plugins/src/base/.claude-plugin/plugin.json` — add haiku prompt hook to UserPromptSubmit + register inject-flow-context.sh in SubagentStart
4. `plugins/src/base/commands/research.md` and `verify.md` — new commands
5. `plugins/src/base/commands/{fix,build,improve,investigate,plan,ship,review,monitor}.md` and `plan/{execute,create}.md` — update flow references
6. `plugins/src/base/agents/jira-agent.md` — update ticket-to-flow mapping
7. `plugins/src/base/agents/{bug-fixer,builder}.md` — minor flow name updates
8. `plugins/src/base/skills/plan-execute/SKILL.md` — update orchestrator
9. `plugins/src/base/rules/verification.md` — add local vs remote distinction
10. `OVERVIEW.md` — update documentation table
11. `bun run build:plugins` — rebuild `plugins/lisa/`

---

## Summary of All Changes

| Action | Count | Files |
|--------|-------|-------|
| **REWRITE** | 1 | `intent-routing.md` |
| **NEW (commands)** | 2 | `research.md`, `verify.md` |
| **NEW (hooks)** | 1 | `inject-flow-context.sh` |
| **NEW (prompt hook)** | 1 | haiku classifier in `plugin.json` |
| **MODIFY (significant)** | 3 | `jira-agent.md`, `plan-execute/SKILL.md`, `plugin.json` |
| **MODIFY (low)** | 13 | 10 commands, 2 agents, 1 rule |
| **MODIFY (docs)** | 1 | `OVERVIEW.md` |
| **AUTO-REBUILD** | ~20 | All files in `plugins/lisa/` |
| **Total** | 22 | source files + ~20 rebuilt copies |

---

## Verification

1. **Grep for stale flow names**: `rg "Fix flow|Build flow|Ship flow|Improve flow|Investigate flow|Monitor flow|Review flow" plugins/src/` should return zero results
2. **Grep for new flow names**: `rg "Research flow|Plan flow|Implement flow|Verify flow" plugins/src/base/rules/intent-routing.md` should show all 4
3. **New commands exist**: `ls plugins/src/base/commands/{research,verify}.md`
4. **New hook exists and is executable**: `ls -la plugins/src/base/hooks/inject-flow-context.sh`
5. **Hooks registered**: `jq '.hooks.UserPromptSubmit, .hooks.SubagentStart' plugins/src/base/.claude-plugin/plugin.json` shows haiku prompt hook and inject-flow-context hook
6. **Build plugins**: `bun run build:plugins` succeeds
7. **Built copies match**: `diff -r plugins/src/base/ plugins/lisa/` (excluding plugin.json version differences)
8. **Manual walkthrough**: Read new `intent-routing.md` end-to-end, trace each flow through commands -> agents -> skills to confirm coherence
9. **Headless behavior**: Verify intent-routing.md explicitly says "do not ask" in non-interactive mode
10. **Subagent behavior**: Verify inject-flow-context.sh outputs valid JSON with additionalContext telling subagents not to ask for flow
