# Plan: Deprecate Project Workflow, Document Plan Workflow

## Branch

Create new branch `chore/deprecate-project-workflow` off `main`. Open draft PR targeting `main`.

## Summary

Deprecate the 16 project-* skills and their 17 command wrappers in favor of Claude's native plan mode. Create 6 new `plan-*` skills for utility workflows that still need skill-driven analysis. Update all documentation (README, OVERVIEW, .claude/README, stack templates, rules) to reference the plan workflow instead.

## Scope

### 1. Deprecate 16 project skills (both locations)

Add a deprecation notice after the YAML frontmatter in each `SKILL.md`. The notice tells users to use plan mode or the replacement `plan-*` skill.

**Lisa's own skills** (`.claude/skills/project-*/SKILL.md`):
- `project-setup`, `project-bootstrap`, `project-research`, `project-plan`, `project-execute`, `project-implement`, `project-review`, `project-document`, `project-verify`, `project-debrief`, `project-archive`
- `project-add-test-coverage`, `project-fix-linter-error`, `project-local-code-review`, `project-lower-code-complexity`, `project-reduce-max-lines`, `project-reduce-max-lines-per-function`

**Template skills** (`all/copy-overwrite/.claude/skills/project-*/SKILL.md`) — same 16 files.

**Deprecation notice format for core workflow skills** (setup, bootstrap, research, plan, execute, implement, review, document, verify, debrief, archive):

```markdown
> **DEPRECATED**: This skill is deprecated. Use Claude's native plan mode instead.
> Enter plan mode with `/plan`, describe your requirements, and Claude will create a plan with tasks automatically.
> This skill will be removed in a future release.
```

**Deprecation notice format for utility skills with replacements** (add-test-coverage, fix-linter-error, local-code-review, lower-code-complexity, reduce-max-lines, reduce-max-lines-per-function):

```markdown
> **DEPRECATED**: This skill is deprecated. Use `/plan-<name>` instead, which integrates with Claude's native plan mode.
> This skill will be removed in a future release.
```

### 2. Deprecate 17 project commands (both locations)

Add deprecation notice to each command `.md` file in `.claude/commands/project/` and `all/copy-overwrite/.claude/commands/project/`.

**Files** (17 each location, 34 total):
`add-test-coverage.md`, `archive.md`, `bootstrap.md`, `debrief.md`, `document.md`, `execute.md`, `fix-linter-error.md`, `implement.md`, `local-code-review.md`, `lower-code-complexity.md`, `plan.md`, `reduce-max-lines-per-function.md`, `reduce-max-lines.md`, `research.md`, `review.md`, `setup.md`, `verify.md`

### 3. Create 6 new plan-* skills (both locations)

Each new skill copies Step 1 (Gather Requirements) and Step 2 (Generate Brief) from its `project-*` counterpart verbatim, but replaces Step 3 (Bootstrap Project) with plan-mode integration.

**New Step 3 template (for 5 brief-based skills):**

```markdown
## Step 3: Create Plan

1. Write the generated brief to a new plan file at `plans/<descriptive-name>.md`
2. Use TaskCreate to create tasks for each item identified in the brief
   - Size each task for a single verification command
   - Include `/coding-philosophy` in skills metadata
   - Include verification command and expected output
   - Set `metadata.plan` to the plan name
3. Report the plan file path and number of tasks created
```

**Skills to create:**

| New Skill | Source | Location |
|-----------|--------|----------|
| `plan-add-test-coverage` | `project-add-test-coverage` | `.claude/skills/` + `all/copy-overwrite/.claude/skills/` |
| `plan-fix-linter-error` | `project-fix-linter-error` | same |
| `plan-lower-code-complexity` | `project-lower-code-complexity` | same |
| `plan-reduce-max-lines` | `project-reduce-max-lines` | same |
| `plan-reduce-max-lines-per-function` | `project-reduce-max-lines-per-function` | same |
| `plan-local-code-review` | `project-local-code-review` | same |

**Special case: `plan-local-code-review`** — This skill does NOT use the brief/bootstrap pattern. It runs multi-agent code review directly. The refactoring is:
- Remove the `$ARGUMENTS` project directory dependency
- Write review output to `claude-review.md` in the current directory (not a project subdirectory)
- Keep all 5 parallel review agents and scoring logic unchanged

### 4. Create 6 new plan commands (both locations)

Create thin command wrappers in `.claude/commands/plan/` and `all/copy-overwrite/.claude/commands/plan/`:

- `add-test-coverage.md` → invokes `/plan-add-test-coverage`
- `fix-linter-error.md` → invokes `/plan-fix-linter-error`
- `local-code-review.md` → invokes `/plan-local-code-review`
- `lower-code-complexity.md` → invokes `/plan-lower-code-complexity`
- `reduce-max-lines.md` → invokes `/plan-reduce-max-lines`
- `reduce-max-lines-per-function.md` → invokes `/plan-reduce-max-lines-per-function`

### 5. Update pull-request-review skill (both locations)

Files:
- `.claude/skills/pull-request-review/SKILL.md`
- `all/copy-overwrite/.claude/skills/pull-request-review/SKILL.md`

Change Step 3 from `Run /project-bootstrap with the generated brief` to plan-mode instructions (write brief to plan file, use TaskCreate).

### 6. Update .claude/rules/plan.md (both locations)

Files:
- `.claude/rules/plan.md`
- `all/copy-overwrite/.claude/rules/plan.md`

Change `/project-local-code-review` reference to `/plan-local-code-review`.

### 7. Update documentation

#### `README.md` (root)
- Line 30: Change `(/project:implement, /git:commit)` to `(/plan:add-test-coverage, /git:commit)`
- Lines 60-66: Replace `/project:*` command list with plan-mode guidance:
  ```markdown
  Or use utility commands:

  - `/plan:add-test-coverage` - Increase test coverage to a threshold
  - `/plan:fix-linter-error` - Fix ESLint rule violations
  - `/plan:local-code-review` - Review local branch changes
  - `/plan:lower-code-complexity` - Reduce cognitive complexity
  - `/plan:reduce-max-lines` - Reduce max file lines threshold
  - `/plan:reduce-max-lines-per-function` - Reduce max function lines
  ```

#### `all/copy-overwrite/README.md` (template for target projects)
- Lines 29-34: Same replacement as root README — replace `/project:*` with plan-mode guidance

#### Stack-specific READMEs
These extend `all/copy-overwrite/README.md` with extra content. Update the same `/project:*` block:
- `expo/copy-overwrite/README.md`
- `nestjs/copy-overwrite/README.md`
- `cdk/copy-overwrite/README.md`
- `npm-package/copy-overwrite/README.md`

#### `.claude/README.md`
- Line 118: Change `project/` to `project/ (deprecated)` and add `plan/` entry
- Skills section: Add note about plan-* skills

#### `OVERVIEW.md`
Multiple sections need updating:
- Lines 87, 103-106: Replace `/project:bootstrap` and `/project:execute` examples with plan mode
- Lines 109-170: Replace "The Bootstrap Phase" and "The Execute Phase" sections with plan mode workflow description
- Line 237: Update skill directory listing
- Lines 273-289: Replace the Project commands table with deprecated notice and plan commands
- Lines 406-407: Update code review references from `/project:local-code-review` to `/plan:local-code-review` and `/project:review` to CodeRabbit skill
- Lines 877-878, 892, 952: Update workflow references at bottom of doc

## Skills to Invoke During Execution

- `/coding-philosophy` — always required
- `/jsdoc-best-practices` — when updating JSDoc in skill files
- `/skill-creator` — reference when creating new plan-* skills

## Task List (TaskCreate)

Create the following tasks. Run tasks in parallel where possible (tasks with no dependencies).

### Implementation Tasks (run in parallel where possible)

1. **Create branch and draft PR**
   - subject: "Create branch chore/deprecate-project-workflow and open draft PR"
   - activeForm: "Creating branch and draft PR"
   - Create branch off main, open draft PR targeting main
   - Verification: `gh pr view --json state,url | jq '.state'` → `"OPEN"`

2. **Create 6 plan-* skills in .claude/skills/** (can run in parallel with task 3)
   - subject: "Create plan-* skills in .claude/skills/"
   - activeForm: "Creating plan-* skills in .claude/skills/"
   - Create `plan-add-test-coverage`, `plan-fix-linter-error`, `plan-local-code-review`, `plan-lower-code-complexity`, `plan-reduce-max-lines`, `plan-reduce-max-lines-per-function`
   - Copy Step 1 and Step 2 from corresponding `project-*` skill verbatim, replace Step 3 with plan-mode integration
   - For `plan-local-code-review`: remove `$ARGUMENTS` dependency, write to `claude-review.md` in current directory
   - Verification: `ls .claude/skills/plan-*/SKILL.md | wc -l` → `6`

3. **Create 6 plan-* skills in all/copy-overwrite/.claude/skills/** (can run in parallel with task 2)
   - subject: "Create plan-* skills in all/copy-overwrite/.claude/skills/"
   - activeForm: "Creating plan-* template skills"
   - Mirror of task 2 for the template location
   - Verification: `ls all/copy-overwrite/.claude/skills/plan-*/SKILL.md | wc -l` → `6`

4. **Create 6 plan commands in both locations** (depends on tasks 2, 3)
   - subject: "Create plan command wrappers in .claude/commands/plan/ and all/copy-overwrite/.claude/commands/plan/"
   - activeForm: "Creating plan command wrappers"
   - Create thin wrappers invoking `/plan-*` skills
   - Verification: `ls .claude/commands/plan/*.md all/copy-overwrite/.claude/commands/plan/*.md | wc -l` → `12`

5. **Add deprecation notices to 16 project skills in .claude/skills/** (can run in parallel with task 6)
   - subject: "Add deprecation notices to project-* skills in .claude/skills/"
   - activeForm: "Adding deprecation notices to Lisa project skills"
   - Add appropriate deprecation notice after YAML frontmatter in each SKILL.md
   - Verification: `grep -l "DEPRECATED" .claude/skills/project-*/SKILL.md | wc -l` → `16`

6. **Add deprecation notices to 16 project skills in all/copy-overwrite/.claude/skills/** (can run in parallel with task 5)
   - subject: "Add deprecation notices to project-* skills in all/copy-overwrite/.claude/skills/"
   - activeForm: "Adding deprecation notices to template project skills"
   - Verification: `grep -l "DEPRECATED" all/copy-overwrite/.claude/skills/project-*/SKILL.md | wc -l` → `16`

7. **Add deprecation notices to 17 project commands in both locations** (can run in parallel with tasks 5, 6)
   - subject: "Add deprecation notices to project command wrappers"
   - activeForm: "Adding deprecation notices to project commands"
   - Add deprecation notice to all `.claude/commands/project/*.md` and `all/copy-overwrite/.claude/commands/project/*.md`
   - Verification: `grep -l "DEPRECATED" .claude/commands/project/*.md all/copy-overwrite/.claude/commands/project/*.md | wc -l` → `34`

8. **Update pull-request-review skill** (depends on tasks 2, 3)
   - subject: "Update pull-request-review skill to use plan mode instead of /project-bootstrap"
   - activeForm: "Updating pull-request-review skill"
   - Update Step 3 in both `.claude/skills/pull-request-review/SKILL.md` and `all/copy-overwrite/.claude/skills/pull-request-review/SKILL.md`
   - Verification: `grep -c "project-bootstrap" .claude/skills/pull-request-review/SKILL.md all/copy-overwrite/.claude/skills/pull-request-review/SKILL.md` → `0` in both

9. **Update .claude/rules/plan.md references** (depends on tasks 2, 3)
   - subject: "Update plan.md rules to reference /plan-local-code-review"
   - activeForm: "Updating plan.md references"
   - Change `/project-local-code-review` to `/plan-local-code-review` in both locations
   - Verification: `grep -c "project-local-code-review" .claude/rules/plan.md all/copy-overwrite/.claude/rules/plan.md` → `0` in both

10. **Update README.md** (can run in parallel with tasks 11-14)
    - subject: "Update root README.md to replace project workflow with plan workflow"
    - activeForm: "Updating root README.md"
    - Replace `/project:*` references with plan mode guidance and `/plan:*` commands
    - Verification: `grep -c "project:" README.md` → `0`

11. **Update all/copy-overwrite/README.md and stack-specific READMEs** (can run in parallel with task 10)
    - subject: "Update template READMEs to replace project workflow with plan workflow"
    - activeForm: "Updating template READMEs"
    - Update `all/copy-overwrite/README.md`, `expo/copy-overwrite/README.md`, `nestjs/copy-overwrite/README.md`, `cdk/copy-overwrite/README.md`, `npm-package/copy-overwrite/README.md`
    - Verification: `grep -c "project:" all/copy-overwrite/README.md expo/copy-overwrite/README.md nestjs/copy-overwrite/README.md cdk/copy-overwrite/README.md npm-package/copy-overwrite/README.md` → `0` in all

12. **Update .claude/README.md** (can run in parallel with tasks 10, 11)
    - subject: "Update .claude/README.md to document plan commands and deprecate project commands"
    - activeForm: "Updating .claude/README.md"
    - Add `plan/` to commands section, mark `project/` as deprecated
    - Verification: `grep "plan/" .claude/README.md` → matches found

13. **Update OVERVIEW.md** (can run in parallel with tasks 10-12)
    - subject: "Update OVERVIEW.md to replace project workflow with plan workflow documentation"
    - activeForm: "Updating OVERVIEW.md"
    - Replace Bootstrap/Execute phase docs, update command tables, update workflow references
    - Verification: `grep -c "/project:bootstrap\|/project:execute" OVERVIEW.md` → `0`

### Post-Implementation Tasks (sequential, after all implementation tasks)

14. **Review code with CodeRabbit**
    - subject: "Review changes with CodeRabbit"
    - activeForm: "Running CodeRabbit review"
    - Invoke `/coderabbit:review`
    - Verification: manual-check — review output exists

15. **Review code with /plan:local-code-review**
    - subject: "Review changes with plan-local-code-review"
    - activeForm: "Running local code review"
    - Invoke `/plan:local-code-review` (the newly created skill)
    - Verification: manual-check — `claude-review.md` exists

16. **Implement valid review suggestions**
    - subject: "Implement valid suggestions from code reviews"
    - activeForm: "Implementing code review suggestions"
    - Address findings from CodeRabbit and local code review
    - Verification: manual-check — all valid suggestions addressed

17. **Simplify implemented code**
    - subject: "Simplify implemented code with code simplifier agent"
    - activeForm: "Simplifying implemented code"
    - Run code simplifier on changed files
    - Verification: manual-check — simplified code passes lint

18. **Update/add/remove tests**
    - subject: "Update tests for deprecated project skills and new plan skills"
    - activeForm: "Updating tests"
    - No new unit tests expected (skill/command files are markdown, not code). Verify existing tests still pass.
    - Verification: `bun run test` → passes

19. **Update/add/remove documentation (JSDoc, markdown)**
    - subject: "Update JSDoc and markdown documentation for changes"
    - activeForm: "Updating documentation"
    - Ensure all new skill SKILL.md files have proper preambles
    - Verification: `grep -l "DEPRECATED\|plan-" .claude/skills/*/SKILL.md | wc -l` → at least 22

20. **Verify all task verification metadata**
    - subject: "Run all verification commands from task metadata"
    - activeForm: "Verifying all task verifications"
    - Run each task's proof command and confirm expected output
    - Verification: manual-check — all proof commands pass

21. **Archive the plan**
    - subject: "Archive the deprecate-project-workflow plan"
    - activeForm: "Archiving plan"
    - Steps:
      1. Create folder `plans/completed/deprecate-project-workflow`
      2. Rename this plan to `deprecate-project-workflow.md`
      3. Move it into `plans/completed/deprecate-project-workflow/`
      4. Read session IDs from the plan's Sessions section
      5. For each session ID, move `~/.claude/tasks/<session-id>` to `plans/completed/deprecate-project-workflow/tasks/`
      6. Update any "in_progress" tasks in the archived tasks to "completed"
      7. Commit changes
      8. Push to PR
    - Verification: `ls plans/completed/deprecate-project-workflow/deprecate-project-workflow.md` → exists

## Verification (End-to-End)

1. `grep -rl "DEPRECATED" .claude/skills/project-*/SKILL.md | wc -l` → `16`
2. `grep -rl "DEPRECATED" all/copy-overwrite/.claude/skills/project-*/SKILL.md | wc -l` → `16`
3. `grep -rl "DEPRECATED" .claude/commands/project/*.md | wc -l` → `17`
4. `grep -rl "DEPRECATED" all/copy-overwrite/.claude/commands/project/*.md` → `17`
5. `ls .claude/skills/plan-*/SKILL.md | wc -l` → `6`
6. `ls all/copy-overwrite/.claude/skills/plan-*/SKILL.md | wc -l` → `6`
7. `ls .claude/commands/plan/*.md | wc -l` → `6`
8. `ls all/copy-overwrite/.claude/commands/plan/*.md | wc -l` → `6`
9. `grep -c "project-bootstrap" .claude/skills/pull-request-review/SKILL.md` → `0`
10. `grep -c "project-local-code-review" .claude/rules/plan.md` → `0`
11. `grep -c "/project:" README.md` → `0`
12. `bun run test` → passes
13. `bun run lint` → passes

## Sessions

<!-- Auto-maintained by track-plan-sessions.sh -->
| Session ID | First Seen | Phase |
|------------|------------|-------|
| b90bc57f-322f-4258-afe1-47232af02f74 | 2026-02-03T17:50:42Z | plan |
