# Critique & Suggestions: `.claude/` Architecture Strategy

## Context

Cody asked for a strategic critique of his `.claude/` architecture philosophy. The existing files are partway to the goal — this evaluates whether the **overall strategy** is sound and identifies gaps between the vision and what needs to happen to fully realize it.

**The strategy in brief:**
1. Three input sources (ticket URL, file pointer, free text) supported by all workflows
2. Slash commands for discoverability → skills for implementation → agents for specialized work → hooks for enforcement
3. Convenience wrappers (e.g., `/plan:lower-code-complexity`) that add context and delegate to `/plan:create`
4. Four input types (bugs, tasks, questions, features) with appropriate verification
5. Continuous ticket integration when the source is an external ticket
6. A learning loop that feeds discoveries back into skills and rules

---

## Verdict: The Philosophy Is Sound

The layered architecture is well-designed and aligns with Claude Code best practices. The specific strengths:

### 1. The Three-Source Input Model Is Correct
Ticket URL, file pointer, and free text are the natural developer input types. Having skills handle all three via `$ARGUMENTS` parsing — where Claude reasons about the input type rather than rigid regex — is the right approach. This is explicitly recommended in Anthropic's skill authoring best practices.

### 2. The Wrapper-Delegates-to-Core Pattern Is Architecturally Sound
Having `/plan:lower-code-complexity` gather domain-specific context (thresholds, violations) then delegate to `/plan:create` is the right abstraction. It gives you:
- **One plan template** maintained in one place
- **N convenience wrappers** that each add their own context
- **Consistent output** regardless of entry point

This pattern isn't fully implemented yet (the current wrapper skills are self-contained), but the vision is correct.

### 3. Rules for Always-On Governance, Skills for On-Demand Knowledge
`coding-philosophy.md` as a rule (always loaded) is correct — it's governance that applies to every interaction. Skills like `jira-create` as on-demand is also correct — they're only relevant when invoked. The separation is right.

### 4. Hooks as the Enforcement Layer
CLAUDE.md and rules are advisory — Claude can ignore them. Hooks are the only guaranteed execution mechanism. Your use of hooks for formatting (PostToolUse → prettier), plan rule enforcement (UserPromptSubmit), and notifications (async ntfy.sh) is the correct pattern.

### 5. The Learning Loop Is Innovative
`learner` → `skill-evaluator` → `skill-creator` is a genuine improvement mechanism that I haven't seen in other Claude Code setups. The 5-criteria worthiness test prevents skill proliferation, which is a known anti-pattern.

### 6. Agent Specialization Is Well-Designed
Minimal tools per agent (product-reviewer can't write files, implementer can't create tasks) follows least-privilege. The agent roster covers the right concerns: implementation, tech review, product review, testing, learning.

---

## Strategic Gaps

### Gap 1: The Wrapper Skills Don't Actually Delegate Yet

**Vision:** `/plan:lower-code-complexity` adds context → delegates to `/plan:create`
**Reality:** Each `plan-*` skill is fully self-contained with its own plan-creation logic

**This is the biggest gap.** When you change the plan template (required tasks, metadata, verification format), you'd need to update 5+ skills independently. The `plan.md` rule provides shared instructions, but each skill re-interprets them independently.

**To implement the vision:** Skills CAN invoke other skills — Claude can call the `Skill` tool from within a skill's execution. The wrapper pattern would be:

```markdown
# plan-lower-code-complexity SKILL.md
1. Read eslint.thresholds.json for current cognitive-complexity threshold
2. Calculate new threshold (current - 2)
3. Run `bun run lint` and capture all cognitive-complexity violations
4. Compile a structured brief with: violations list, refactoring strategies, new threshold
5. Invoke `/plan:create` with the brief as the argument
```

`/plan:create` then handles all plan structure, required tasks, task creation specification, and ticket integration consistently.

Solution: Implement the delegation

### Gap 2: Continuous Ticket Integration Doesn't Exist

**Vision:** "If the source is an external ticket, it's critical that we update the ticket frequently"
**Reality:** `jira-create` creates tickets. `jira-verify` validates them. No continuous sync.

**Missing pieces:**
- Plan created → comment on ticket with plan contents
- Branch created → link branch to ticket
- Implementation complete → update ticket status
- PR ready → post PR link on ticket

**Recommendation:** Create a `jira:sync` skill and wire it into the workflow at key milestones. Optionally, add a `TaskCompleted` hook that auto-syncs when the plan has a ticket URL in its metadata.

Solution: Implement the recommendation. TaskCompleted should recognize if it's a ticket and inject a reminder to update the ticket if itis

### Gap 3: Free-Text → Skill Routing Is Unreliable

**Vision:** "Lower code complexity by 2" auto-activates `plan-lower-code-complexity`
**Reality:** Skill auto-invocation has a ~56% failure rate in testing (source: Vercel evals, Scott Spence's analysis). Claude might act directly without invoking the skill, skipping your required plan template and verification.

**Your existing mitigations are good:**
- `plan.md` rules loaded at session start catch plan-mode requirements
- Hook enforcement for critical rules

**Additional mitigations to consider:**
- A `UserPromptSubmit` hook that detects common patterns and injects reminders (e.g., "REMINDER: Use /plan:lower-code-complexity for complexity reduction requests")
- Improved skill descriptions with explicit trigger phrases
- CLAUDE.md instruction: "When a developer request matches a skill, always invoke that skill rather than acting directly"

Solution: Skip this

### Gap 4: The Four-Type Classification Needs Refinement

**Your types:** Bugs, Tasks, Questions, Features

**Questions don't belong in the plan workflow.** Questions need answers, not plans. They don't need empirical verification, task creation, or ticket integration. Including them in the same workflow as bugs/tasks/features adds complexity without value.

**Recommendation:** Keep three types for the plan workflow (Bug, Task, Story/Feature and Epic) and handle Questions separately — they're just Claude answering questions, no special workflow needed.

NOT SOLVED: I like the recommendation, but there is still a gap. First, it should be "Bug", "Task", "Story/Feature" and Epic. Do we need individual commands for each of those? i.e. /plan:bug:create, /plan:feature:create, etc or do we stick with /plan:create and let Claude determine it from context? This is important because, for example, we need a replication step for bugs.

**ANSWER: Stick with `/plan:create` — no separate type commands needed.** Here's why:

1. **Claude can determine type from context reliably.** A bug report describes symptoms ("the login page crashes when..."), a feature describes new capability ("add dark mode support"), a task describes work ("update the API version"). Claude is good at this classification.

2. **Type-specific requirements belong in the plan template, not separate commands.** The `plan.md` rule (or `/plan:create` skill) should have explicit conditional sections:

```markdown
## Type-Specific Requirements

When the plan type is determined, apply the corresponding requirements:

### Bug
- **Replication step** (mandatory): Reproduce the bug empirically before any fix
- **Root cause analysis**: Identify why the bug occurs
- **Regression test**: Write a test that fails without the fix and passes with it
- **Verification**: Run the replication step again to confirm the fix

### Story/Feature
- **UX review**: Product-reviewer agent validates from user perspective
- **Feature flag consideration**: Should this be behind a flag?
- **Documentation**: User-facing docs if applicable

### Task
- **Standard implementation** with empirical verification

### Epic
- **Decompose into sub-tasks** (Stories/Tasks/Bugs)
- **Each sub-task gets its own type-specific requirements**
```

3. **The wrapper pattern still works.** `/plan:create` detects the type early, then applies the right template. If Claude misclassifies, the developer can correct: "This is a bug, not a feature" — and the plan adjusts.

4. **Separate commands would create proliferation.** `/plan:bug:create`, `/plan:feature:create`, `/plan:task:create`, `/plan:story:create`, `/plan:epic:create` = 5 commands that all delegate to `/plan:create` anyway, each adding zero logic beyond setting a type flag.

**The implementation path:** Update `/plan:create` to include a type-detection step and type-specific requirement sections. The `plan.md` rule already defines types — make the conditional requirements explicit.

### Gap 5: Commands Directory Is Legacy

As of Claude Code v2.1.3, slash commands were unified into skills. Your `.claude/commands/` directory contains 20+ thin wrappers that add no logic — they just delegate to skills. Skills already appear in the `/` menu.

The only advantage of commands is namespace hierarchy (`/plan:create` vs `/plan-create`). But colon-separated skill names already work: naming a skill `plan:create` gives you `/plan:create` in the menu.

**Recommendation:** Consolidate to skills-only. This eliminates the maintenance burden of keeping commands and skills in sync. Low priority since the dual system works, but it's redundant.

NOT SOLVED: This sounds good, but do skills work both indirectly (i.e, "fix the bug at https://ticket.com/example) and directly like commands do? (i.e. /fix:bug https://ticket.com/example) and show the argument hints?

**ANSWER: Yes — skills are a strict superset of commands.** Confirmed via official docs and GitHub issues:

| Feature | Commands | Skills |
|---------|----------|--------|
| `/name <args>` invocation | Yes | Yes |
| `argument-hint` in autocomplete | Yes | Yes |
| `$ARGUMENTS` / `$N` placeholders | Yes | Yes |
| Auto-activation on free text | **No** | **Yes** |
| Supporting files directory | **No** | **Yes** (SKILL.md + scripts/ + references/) |
| `context: fork` (subagent execution) | **No** | **Yes** |
| `allowed-tools` restriction | **No** | **Yes** |
| Dynamic context (`!`command``) | **No** | **Yes** |
| `disable-model-invocation` control | N/A | **Yes** |

**Skill frontmatter supports `argument-hint`:**

```yaml
---
name: plan:create
description: "Creates an implementation plan from a ticket URL, file path, or text description"
argument-hint: "<ticket-url | @file-path | description>"
---
```

This shows `<ticket-url | @file-path | description>` in the `/` menu autocomplete when the developer types `/plan:create`.

**Both direct and indirect work simultaneously:**
- Direct: `/plan:create https://ticket.com/example` → skill invoked with `$ARGUMENTS = "https://ticket.com/example"`
- Indirect: "fix the bug at https://ticket.com/example" → Claude matches skill description → invokes it

**Known UX limitation:** The argument-hint disappears once the user starts typing arguments (GitHub issue #20667). The hint shows during autocomplete but not while typing. This is cosmetic and doesn't affect functionality.

**Conclusion:** The `.claude/commands/` directory can be safely removed. Skills provide everything commands did, plus auto-activation and supporting files. Per the official docs: "Custom slash commands have been merged into skills. Your existing `.claude/commands/` files keep working. Skills add optional features." If both a command and skill share the same name, the skill takes precedence.

### Gap 6: plan.md Has Redundant References to `/coding-philosophy`

Since `coding-philosophy.md` is a rule (always loaded), the following references in `plan.md` are redundant:

1. **Line ~22**: "covers correctness, security, coding-philosophy" — descriptive, minor issue
2. **Line ~75**: "Pre-loaded with coding-philosophy" — misleading (it's auto-loaded as a rule, not pre-loaded by the agent)
3. **Line ~76**: "covers correctness, security, performance, coding-philosophy" — same
4. **Line ~104**: `**Skills to Invoke:** /coding-philosophy is always required` — **wrong**, it's a rule not a skill
5. **Line ~120**: `"skills": ["/coding-philosophy", ...]` — **wrong** in the metadata example

These should be updated to remove the skill invocation references and instead note that coding-philosophy is automatically enforced via rules.

Solution: Remove

---

## Context Window Economics

### Current Always-On Context Cost

| Source | Lines | Tokens (est.) | Loaded When |
|--------|-------|---------------|-------------|
| CLAUDE.md | ~80 | ~1,500 | Always |
| rules/coding-philosophy.md | ~250 | ~4,500 | Always |
| rules/plan.md | ~150 | ~2,700 | Always |
| rules/verfication.md | ~50 | ~900 | Always |
| rules/PROJECT_RULES.md | ~50 | ~900 | Always |
| rules/lisa.md | ~50 | ~900 | Always |
| **Total** | **~630** | **~11,400** | **Every message** |

Plus skill descriptions (~2% of context window budget), plus the Claude Code system prompt itself.

### Known Issue: Skills May Load Fully at Startup (Bug #14882)

There's an open, unresolved bug where skills consume their **full token count at startup** rather than implementing progressive disclosure. Multiple duplicate issues (#15530, #15662, #15635, #16157) confirm this. If true, your 20+ skills may be adding significantly more context cost than expected.

**Recommendation:** Run `/context` in a session to check actual token consumption. If skills are loading fully, consider adding `disable-model-invocation: true` to skills that should only be explicitly invoked (like `git-commit`, deployment workflows, etc.).

### Should coding-philosophy.md Move to a Skill?

**No.** The user confirmed this is governance-critical and should always be loaded. The ~4,500 token cost is acceptable for ensuring every interaction follows the coding philosophy. It's correctly a rule.

**However**, consider whether `plan.md` (~2,700 tokens) could use `paths` frontmatter to only load when Claude is working with plan files:

```yaml
---
paths:
  - "plans/**"
---
```

The risk: plan.md needs to be loaded BEFORE plan mode is entered, not just when editing plan files. If Claude enters plan mode without having read plan.md, the plan won't follow the template. So keeping it as an unconditional rule is probably correct.

---

## Refined Strategy Recommendations

### 1. Implement True Skill Chaining via `/plan:create` as the Core

Make `/plan:create` the single plan-creation skill. All wrapper skills gather context then delegate:

```
/plan:lower-code-complexity → gathers violations → /plan:create <brief>
/plan:add-test-coverage     → gathers coverage  → /plan:create <brief>
/plan:fix-linter-error      → gathers errors    → /plan:create <brief>
/plan:reduce-max-lines      → gathers long files → /plan:create <brief>
Free text "lower complexity" → Claude matches    → /plan:lower-code-complexity → /plan:create
Ticket URL                  → /plan:create <url> → fetches + creates plan
File path                   → /plan:create <file> → reads + creates plan
```

`/plan:create` handles:
- Input type detection (URL vs file vs text)
- Plan template structure
- Required tasks creation
- Ticket integration (if URL provided)
- Metadata and verification

### 2. Add Ticket Lifecycle Management

Create a `jira:sync` skill for continuous updates:

```
Plan created  → jira:sync posts plan to ticket, links branch
Task complete → jira:sync posts progress update
PR ready      → jira:sync posts PR link, moves to "Review"
PR merged     → jira:sync moves to "Done"
```

Wire into `TaskCompleted` hook for automatic sync when ticket URL is in plan metadata.

### 3. Improve Free-Text Routing Reliability

Three-layer approach:
1. **Skill descriptions** with explicit trigger phrases
2. **CLAUDE.md instruction**: "When a request matches an available skill, invoke it"
3. **UserPromptSubmit hook** for common patterns → inject skill reminders

### 4. Consolidate Commands into Skills

Remove `.claude/commands/` directory. Rename skills to use colon namespacing (`plan:create`, `git:commit`, `jira:verify`). Update developer documentation.

### 5. Fix plan.md Redundant `/coding-philosophy` References

Remove skill invocation references. Note that coding-philosophy is enforced via rules, not skill invocation.

### 6. Refine Type Classification

Drop "Questions" from the plan workflow. Keep four plan types with type-specific requirements built into `/plan:create`:
- **Bug**: replication step, root cause analysis, regression test
- **Task**: standard implementation with verification
- **Story/Feature**: UX review, feature flag consideration, user-facing docs
- **Epic**: decompose into sub-tasks, each with own type-specific requirements

No separate `/plan:bug:create` or `/plan:feature:create` commands needed — `/plan:create` detects type from context and applies the right template.

---

## All Gaps Resolved

| Gap | Decision |
|-----|----------|
| 1. Skill chaining | **Implement** — wrappers delegate to `/plan:create` |
| 2. Ticket integration | **Implement** — `jira:sync` skill + `TaskCompleted` hook |
| 3. Free-text routing | **Skip** — existing mitigations (rules + hooks) are sufficient |
| 4. Type classification | **Implement** — four types (Bug/Task/Story/Epic) with type-specific requirements in `/plan:create`, no separate commands |
| 5. Commands → Skills | **Implement** — consolidate to skills-only, remove commands directory |
| 6. `/coding-philosophy` references | **Implement** — remove from plan.md |

---

## Architecture Diagram (Target State)

```
Developer Input
  │
  ├── /plan:create <ticket-url>      ──→ plan-create skill (fetches ticket)
  ├── /plan:create @file             ──→ plan-create skill (reads file)
  ├── /plan:create "free text"       ──→ plan-create skill (uses text)
  ├── /plan:lower-complexity         ──→ gathers violations → /plan:create <brief>
  ├── /plan:add-test-coverage 80     ──→ gathers coverage → /plan:create <brief>
  ├── "lower complexity by 2"        ──→ Claude matches → /plan:lower-code-complexity
  ├── "implement this ticket <url>"  ──→ Claude matches → /plan:create
  │
  ↓
Plan Mode (enforced by plan.md rules + coding-philosophy.md rule)
  │
  ├── Analysis (read-only tools)
  ├── Plan file creation (standardized template from plan:create)
  ├── Ticket sync via jira:sync (if URL provided)
  └── Required tasks created per plan.md specification
  │
  ↓
Implementation (Agent Team with specialized agents)
  │
  ├── implementer (code, follows coding-philosophy rule)
  ├── tech-reviewer (quality, correctness, security)
  ├── product-reviewer (UX, empirical validation)
  ├── test-coverage-agent (comprehensive tests)
  ├── code-simplifier (simplification pass)
  ├── coderabbit (automated review)
  └── learner → skill-evaluator → skill-creator (feedback loop)
  │
  ↓
Hooks (deterministic enforcement, zero context cost)
  │
  ├── PostToolUse (Write|Edit): prettier, ast-grep, lint
  ├── PostToolUse (TaskCreate|TaskUpdate): task sync
  ├── TaskCompleted: jira:sync (if ticket linked)
  ├── UserPromptSubmit: plan rule enforcement, skill routing hints
  ├── Pre-commit: lint-staged (ESLint, Prettier, ast-grep)
  └── Notification: ntfy.sh (async, non-blocking)
  │
  ↓
Rules (always-on governance, ~11K tokens)
  │
  ├── coding-philosophy.md (immutability, TDD, clean deletion)
  ├── plan.md (plan template, required tasks, task spec)
  ├── verfication.md (empirical proof requirements)
  ├── PROJECT_RULES.md (project-specific patterns)
  └── lisa.md (managed file inventory)
```

---

## Implementation Plan

### Branch & PR

- **Branch from:** `main`
- **Branch name:** `feat/consolidate-skills-and-commands`
- **PR target:** `main`

### Critical Files

| File | Action |
|------|--------|
| `all/deletions.json` | Add old command and skill paths |
| `.claude/rules/plan.md` | Remove `/coding-philosophy` references, add type-specific requirements |
| `.claude/rules/lisa.md` | Update managed file inventory (remove commands, add new skills) |
| `.claude/skills/plan-create/SKILL.md` | **Create** — core plan skill with type detection + input routing |
| `.claude/skills/plan-implement/SKILL.md` | **Create** — plan implementation skill |
| `.claude/skills/security-zap-scan/SKILL.md` | **Create** — ZAP scan skill |
| `.claude/skills/jira-sync/SKILL.md` | **Create** — continuous ticket sync skill |
| `.claude/settings.json` | Add `TaskCompleted` hook for ticket sync reminder |
| All 23 existing skill directories | **Rename** from hyphen to colon naming |
| `.claude/commands/` | **Delete** entirely (after skills confirmed) |

### Skill Rename Mapping (Hyphen → Colon)

| Old Directory | New Directory |
|---------------|---------------|
| `git-commit/` | `git:commit/` |
| `git-commit-and-submit-pr/` | `git:commit-and-submit-pr/` |
| `git-prune/` | `git:prune/` |
| `git-submit-pr/` | `git:submit-pr/` |
| `jira-create/` | `jira:create/` |
| `jira-verify/` | `jira:verify/` |
| `lisa-integration-test/` | `lisa:integration-test/` |
| `lisa-learn/` | `lisa:learn/` |
| `lisa-review-implementation/` | `lisa:review-implementation/` |
| `lisa-review-project/` | `lisa:review-project/` |
| `plan-add-test-coverage/` | `plan:add-test-coverage/` |
| `plan-fix-linter-error/` | `plan:fix-linter-error/` |
| `plan-local-code-review/` | `plan:local-code-review/` |
| `plan-lower-code-complexity/` | `plan:lower-code-complexity/` |
| `plan-reduce-max-lines/` | `plan:reduce-max-lines/` |
| `plan-reduce-max-lines-per-function/` | `plan:reduce-max-lines-per-function/` |
| `pull-request-review/` | `pull-request:review/` |
| `sonarqube-check/` | `sonarqube:check/` |
| `sonarqube-fix/` | `sonarqube:fix/` |
| `tasks-load/` | `tasks:load/` |
| `tasks-sync/` | `tasks:sync/` |

**Not renamed** (no namespace prefix):
- `skill-creator/` — stays as-is (meta-skill)
- `jsdoc-best-practices/` — stays as-is (standalone knowledge)

### New Skills to Create

| Skill | Source | Notes |
|-------|--------|-------|
| `plan:create/SKILL.md` | Content from `.claude/commands/plan/create.md` + type detection + input routing + skill chaining target | Core plan skill |
| `plan:implement/SKILL.md` | Content from `.claude/commands/plan/implement.md` | Plan execution skill |
| `security:zap-scan/SKILL.md` | Content from `.claude/commands/security/zap-scan.md` | ZAP scan skill |
| `jira:sync/SKILL.md` | New — continuous ticket sync | Posts plan/progress/PR to linked tickets |

### Deletions to Add (`all/deletions.json`)

```json
{
  "paths": [
    // Existing entries (keep as-is) ...
    // Old command directories
    ".claude/commands/plan",
    ".claude/commands/git",
    ".claude/commands/jira",
    ".claude/commands/lisa",
    ".claude/commands/pull-request",
    ".claude/commands/sonarqube",
    ".claude/commands/security",
    ".claude/commands/tasks",
    // Old hyphen-named skill directories
    ".claude/skills/git-commit",
    ".claude/skills/git-commit-and-submit-pr",
    ".claude/skills/git-prune",
    ".claude/skills/git-submit-pr",
    ".claude/skills/jira-create",
    ".claude/skills/jira-verify",
    ".claude/skills/lisa-integration-test",
    ".claude/skills/lisa-learn",
    ".claude/skills/lisa-review-implementation",
    ".claude/skills/lisa-review-project",
    ".claude/skills/plan-add-test-coverage",
    ".claude/skills/plan-create",
    ".claude/skills/plan-fix-linter-error",
    ".claude/skills/plan-implement",
    ".claude/skills/plan-local-code-review",
    ".claude/skills/plan-lower-code-complexity",
    ".claude/skills/plan-reduce-max-lines",
    ".claude/skills/plan-reduce-max-lines-per-function",
    ".claude/skills/pull-request-review",
    ".claude/skills/sonarqube-check",
    ".claude/skills/sonarqube-fix",
    ".claude/skills/tasks-load",
    ".claude/skills/tasks-sync",
    ".claude/skills/security-zap-scan"
  ]
}
```

### plan.md Changes

Remove these 5 references to `/coding-philosophy`:
1. Line ~22: Remove "coding-philosophy" from tech-reviewer description
2. Line ~75: Remove "coding-philosophy" from implementer description
3. Line ~76: Remove "coding-philosophy" from tech-reviewer table
4. Line ~104: Change `**Skills to Invoke:** /coding-philosophy is always required, plus other applicable skills` → `**Skills to Invoke:** List applicable skills (coding-philosophy is auto-loaded as a rule)`
5. Line ~120: Remove `/coding-philosophy` from metadata example `"skills"` array

Add type-specific requirements section (Bug/Task/Story-Feature/Epic).

### Skill Chaining Updates

Update wrapper skills to delegate to `/plan:create` instead of creating plans independently:

**Pattern for each wrapper:**
```markdown
## Workflow
1. [Gather domain-specific context — e.g., run linter, check coverage]
2. Compile a structured brief with findings
3. Invoke /plan:create with the brief
```

**Skills to update:**
- `plan:lower-code-complexity` — gather violations → `/plan:create`
- `plan:add-test-coverage` — gather coverage gaps → `/plan:create`
- `plan:fix-linter-error` — gather lint errors → `/plan:create`
- `plan:reduce-max-lines` — gather long files → `/plan:create`
- `plan:reduce-max-lines-per-function` — gather long functions → `/plan:create`

### TaskCompleted Hook

Add to `.claude/settings.json`:
```json
{
  "hooks": {
    "TaskCompleted": [
      {
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/ticket-sync-reminder.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

The hook script checks if the plan file contains a ticket URL and injects a reminder to update the ticket.

### lisa.md Updates

Update the managed file inventory:
- Remove `.claude/commands/*` from the managed files list
- Add new colon-namespaced skills to the managed list
- Update the "no local override" section

---

## Tasks

### Task 1: Create branch and open draft PR
Create `feat/consolidate-skills-and-commands` from `main`, open draft PR.

### Task 2: Rename all 21 skills from hyphen to colon naming
For each skill in the rename mapping: rename directory, update `name:` field in SKILL.md, update any internal cross-references (e.g., skills that reference other skills by name).

### Task 3: Create 3 missing skills
- `plan:create/SKILL.md` — core plan skill with type detection, three-source input handling, and type-specific requirements
- `plan:implement/SKILL.md` — plan execution skill (from command content)
- `security:zap-scan/SKILL.md` — ZAP scan skill (from command content)

### Task 4: Create jira:sync skill
New skill for continuous ticket integration. Posts plan contents, progress updates, branch links, and PR links to the linked ticket at key milestones.

### Task 5: Update wrapper skills for chaining
Update 5 plan wrapper skills to gather context then delegate to `/plan:create` instead of creating plans independently.

### Task 6: Update plan.md
Remove 5 redundant `/coding-philosophy` references. Add type-specific requirements section (Bug/Task/Story-Feature/Epic).

### Task 7: Add deletions to all/deletions.json
Add all old command directories and old hyphen-named skill directories to the deletions list.

### Task 8: Delete .claude/commands/ directory
Remove the entire commands directory from Lisa.

### Task 9: Update lisa.md
Update managed file inventory to reflect removed commands and renamed skills.

### Task 10: Add TaskCompleted hook
Create `ticket-sync-reminder.sh` hook script. Add `TaskCompleted` hook to settings.json.

### Task 11: Update internal skill cross-references
Search all skills, agents, rules, and CLAUDE.md for references to old hyphen-named skills and update to colon naming.

### Task 12-20: Standard required tasks
- Product/UX review (`product-reviewer` agent)
- CodeRabbit code review
- Local code review (`/plan:local-code-review`)
- Technical review (`tech-reviewer` agent)
- Implement valid review suggestions
- Simplify code (`code-simplifier` agent)
- Update tests
- Verify all verification metadata
- Collect learnings (`learner` agent)

### Task 21: Archive the plan
- Create folder `consolidate-skills-and-commands` in `./plans/completed`
- Rename plan to reflect actual contents
- Move plan into `./plans/completed/consolidate-skills-and-commands`
- Read session IDs from plan
- Move `~/.claude/tasks/<session-id>` directories to `./plans/completed/consolidate-skills-and-commands/tasks`
- Update any "in_progress" tasks to "completed"
- Final `git push`, mark PR ready (`gh pr ready`), enable auto-merge (`gh pr merge --auto --merge`)

---

## Verification

```bash
# 1. Verify no commands remain
ls .claude/commands/ 2>&1 | grep -c "No such file"
# Expected: 1 (directory doesn't exist)

# 2. Verify all skills use colon naming
ls .claude/skills/ | grep -v ":" | grep -v "skill-creator" | grep -v "jsdoc-best-practices"
# Expected: empty (all namespaced skills use colons)

# 3. Verify deletions.json includes old paths
cat all/deletions.json | jq '.paths | map(select(startswith(".claude/commands/") or (startswith(".claude/skills/") and contains(":")==false))) | length'
# Expected: 30+ entries

# 4. Verify plan.md has no /coding-philosophy skill references
grep -c "/coding-philosophy" .claude/rules/plan.md
# Expected: 0

# 5. Verify plan:create skill exists with type detection
grep -c "Type-Specific Requirements" .claude/skills/plan:create/SKILL.md
# Expected: 1+

# 6. Verify TaskCompleted hook exists
cat .claude/settings.json | jq '.hooks.TaskCompleted | length'
# Expected: 1+

# 7. Verify jira:sync skill exists
test -f .claude/skills/jira:sync/SKILL.md && echo "exists"
# Expected: exists

# 8. Run lint to ensure no issues
bun run lint
# Expected: passes

# 9. Run tests
bun run test
# Expected: passes

# 10. Run typecheck
bun run typecheck
# Expected: passes
```
