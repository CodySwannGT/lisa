# Plan: Refactor Subcommands to Skills

## Overview

Convert all 30 subcommand files (`.claude/commands/**/*.md`) into skills (`.claude/skills/*/SKILL.md`), making each command a thin pass-through that invokes the corresponding skill via the Skill tool.

## Decisions

- **Naming**: Hyphenated (e.g., `git:commit` → `git-commit`)
- **Templates**: Only mirror skills to `all/copy-overwrite/` for commands that already have template copies there
- **Method**: Direct SKILL.md creation (no `init_skill.py` ceremony)

## Naming Map

| Command | Skill Name | Has Template |
|---|---|---|
| `git/commit` | `git-commit` | yes |
| `git/submit-pr` | `git-submit-pr` | yes |
| `git/commit-and-submit-pr` | `git-commit-and-submit-pr` | yes |
| `git/prune` | `git-prune` | yes |
| `project/setup` | `project-setup` | yes |
| `project/research` | `project-research` | yes |
| `project/bootstrap` | `project-bootstrap` | yes |
| `project/plan` | `project-plan` | yes |
| `project/implement` | `project-implement` | yes |
| `project/review` | `project-review` | yes |
| `project/local-code-review` | `project-local-code-review` | yes |
| `project/verify` | `project-verify` | yes |
| `project/document` | `project-document` | yes |
| `project/debrief` | `project-debrief` | yes |
| `project/execute` | `project-execute` | yes |
| `project/fix-linter-error` | `project-fix-linter-error` | yes |
| `project/lower-code-complexity` | `project-lower-code-complexity` | yes |
| `project/reduce-max-lines` | `project-reduce-max-lines` | yes |
| `project/reduce-max-lines-per-function` | `project-reduce-max-lines-per-function` | yes |
| `project/add-test-coverage` | `project-add-test-coverage` | yes |
| `project/archive` | `project-archive` | yes |
| `tasks/load` | `tasks-load` | yes |
| `tasks/sync` | `tasks-sync` | yes |
| `jira/create` | `jira-create` | yes |
| `jira/verify` | `jira-verify` | yes |
| `lisa/review-implementation` | `lisa-review-implementation` | yes |
| `lisa/review-project` | `lisa-review-project` | **no** (root only) |
| `pull-request/review` | `pull-request-review` | yes |
| `sonarqube/check` | `sonarqube-check` | yes |
| `sonarqube/fix` | `sonarqube-fix` | yes |

## Transformation Pattern

### New skill file (`.claude/skills/<skill-name>/SKILL.md`):

```yaml
---
name: <skill-name>
description: <description rewritten in third-person: "This skill should be used when...">
allowed-tools: <carried from command frontmatter>
argument-hint: <carried from command frontmatter, if present>
---

<All workflow/logic content from the original command, rewritten in imperative/infinitive form>
```

### Replaced command file (`.claude/commands/<category>/<name>.md`):

```yaml
---
description: "<original description>"
allowed-tools: ["Skill"]
argument-hint: "<if applicable>"
---

Use the /<skill-name> skill to <what it does>. $ARGUMENTS
```

### Template mirroring (for commands with `Has Template = yes`):

- Copy new skill to `all/copy-overwrite/.claude/skills/<skill-name>/SKILL.md`
- Update template command at `all/copy-overwrite/.claude/commands/<category>/<name>.md`

## Cross-Reference Updates

Commands that reference other commands must update references to use skill names:

- `sonarqube-fix`: `/sonarqube:check` → `/sonarqube-check`, `/git:commit` → `/git-commit`
- `git-commit-and-submit-pr`: `/git:commit` → `/git-commit`, `/git:submit-pr` → `/git-submit-pr`
- `project-bootstrap`: `/project:setup` → `/project-setup`, `/project:research` → `/project-research`, `/project:execute` → `/project-execute`
- `project-execute`: All `/project:*` references → `/project-*`
- `project-review`: `/project:local-code-review` → `/project-local-code-review`
- `project-archive`: `/git:commit-and-submit-pr` → `/git-commit-and-submit-pr`
- `project-document`: `/jsdoc-best-practices` stays as-is (already a skill)

## Task List for Parallel Subagent Execution

### Batch 1 (6 parallel subagents — standalone commands)

| # | Task | Files |
|---|---|---|
| 1 | Convert `git/prune` → `git-prune` skill | `.claude/commands/git/prune.md`, `.claude/skills/git-prune/SKILL.md`, + template copies |
| 2 | Convert `git/commit` → `git-commit` skill | `.claude/commands/git/commit.md`, `.claude/skills/git-commit/SKILL.md`, + template copies |
| 3 | Convert `git/submit-pr` → `git-submit-pr` skill | `.claude/commands/git/submit-pr.md`, `.claude/skills/git-submit-pr/SKILL.md`, + template copies |
| 4 | Convert `jira/create` → `jira-create` skill | `.claude/commands/jira/create.md`, `.claude/skills/jira-create/SKILL.md`, + template copies |
| 5 | Convert `jira/verify` → `jira-verify` skill | `.claude/commands/jira/verify.md`, `.claude/skills/jira-verify/SKILL.md`, + template copies |
| 6 | Convert `sonarqube/check` → `sonarqube-check` skill | `.claude/commands/sonarqube/check.md`, `.claude/skills/sonarqube-check/SKILL.md`, + template copies |

### Batch 2 (6 parallel subagents — standalone commands)

| # | Task | Files |
|---|---|---|
| 7 | Convert `tasks/load` → `tasks-load` skill | `.claude/commands/tasks/load.md`, `.claude/skills/tasks-load/SKILL.md`, + template copies |
| 8 | Convert `tasks/sync` → `tasks-sync` skill | `.claude/commands/tasks/sync.md`, `.claude/skills/tasks-sync/SKILL.md`, + template copies |
| 9 | Convert `pull-request/review` → `pull-request-review` skill | `.claude/commands/pull-request/review.md`, `.claude/skills/pull-request-review/SKILL.md`, + template copies |
| 10 | Convert `project/setup` → `project-setup` skill | `.claude/commands/project/setup.md`, `.claude/skills/project-setup/SKILL.md`, + template copies |
| 11 | Convert `project/research` → `project-research` skill | `.claude/commands/project/research.md`, `.claude/skills/project-research/SKILL.md`, + template copies |
| 12 | Convert `project/plan` → `project-plan` skill | `.claude/commands/project/plan.md`, `.claude/skills/project-plan/SKILL.md`, + template copies |

### Batch 3 (6 parallel subagents — standalone commands)

| # | Task | Files |
|---|---|---|
| 13 | Convert `project/implement` → `project-implement` skill | `.claude/commands/project/implement.md`, `.claude/skills/project-implement/SKILL.md`, + template copies |
| 14 | Convert `project/local-code-review` → `project-local-code-review` skill | `.claude/commands/project/local-code-review.md`, `.claude/skills/project-local-code-review/SKILL.md`, + template copies |
| 15 | Convert `project/verify` → `project-verify` skill | `.claude/commands/project/verify.md`, `.claude/skills/project-verify/SKILL.md`, + template copies |
| 16 | Convert `project/document` → `project-document` skill | `.claude/commands/project/document.md`, `.claude/skills/project-document/SKILL.md`, + template copies |
| 17 | Convert `project/debrief` → `project-debrief` skill | `.claude/commands/project/debrief.md`, `.claude/skills/project-debrief/SKILL.md`, + template copies |
| 18 | Convert `project/archive` → `project-archive` skill (cross-ref: update `/git:commit-and-submit-pr` → `/git-commit-and-submit-pr`) | `.claude/commands/project/archive.md`, `.claude/skills/project-archive/SKILL.md`, + template copies |

### Batch 4 (6 parallel subagents — linting/quality commands)

| # | Task | Files |
|---|---|---|
| 19 | Convert `project/fix-linter-error` → `project-fix-linter-error` skill | `.claude/commands/project/fix-linter-error.md`, `.claude/skills/project-fix-linter-error/SKILL.md`, + template copies |
| 20 | Convert `project/lower-code-complexity` → `project-lower-code-complexity` skill | `.claude/commands/project/lower-code-complexity.md`, `.claude/skills/project-lower-code-complexity/SKILL.md`, + template copies |
| 21 | Convert `project/reduce-max-lines` → `project-reduce-max-lines` skill | `.claude/commands/project/reduce-max-lines.md`, `.claude/skills/project-reduce-max-lines/SKILL.md`, + template copies |
| 22 | Convert `project/reduce-max-lines-per-function` → `project-reduce-max-lines-per-function` skill | `.claude/commands/project/reduce-max-lines-per-function.md`, `.claude/skills/project-reduce-max-lines-per-function/SKILL.md`, + template copies |
| 23 | Convert `project/add-test-coverage` → `project-add-test-coverage` skill | `.claude/commands/project/add-test-coverage.md`, `.claude/skills/project-add-test-coverage/SKILL.md`, + template copies |
| 24 | Convert `lisa/review-implementation` → `lisa-review-implementation` skill | `.claude/commands/lisa/review-implementation.md`, `.claude/skills/lisa-review-implementation/SKILL.md`, + template copies |

### Batch 5 (4 parallel subagents — cross-referencing commands)

| # | Task | Notes |
|---|---|---|
| 25 | Convert `lisa/review-project` → `lisa-review-project` skill | **Root only** (no template copy) |
| 26 | Convert `project/review` → `project-review` skill | Update ref to `/project-local-code-review` |
| 27 | Convert `git/commit-and-submit-pr` → `git-commit-and-submit-pr` skill | Update refs to `/git-commit`, `/git-submit-pr` |
| 28 | Convert `sonarqube/fix` → `sonarqube-fix` skill | Update refs to `/sonarqube-check`, `/git-commit` |

### Batch 6 (2 parallel subagents — orchestrator commands)

| # | Task | Notes |
|---|---|---|
| 29 | Convert `project/bootstrap` → `project-bootstrap` skill | Update refs to `/project-setup`, `/project-research`, `/project-execute` |
| 30 | Convert `project/execute` → `project-execute` skill | Update refs to all `/project-*` skills |

### Batch 7: Verification & Cleanup (1 subagent)

| # | Task |
|---|---|
| 31 | Verify all 30 skills exist with proper frontmatter, all commands are thin pass-throughs, template copies match root, and cross-references are consistent |
| 32 | Update any CLAUDE.md or documentation references to old command names (e.g., `/git:commit` → `/git-commit` in CLAUDE.md instructions) |

## Per-Task Subagent Instructions

For each conversion task, the subagent should:

1. **Read** the original command file at `.claude/commands/<category>/<name>.md`
2. **Create** `.claude/skills/<skill-name>/SKILL.md` with:
   - YAML frontmatter: `name`, `description` (third-person), `allowed-tools`, `argument-hint` (if applicable)
   - Body: All workflow/logic from the command, in imperative/infinitive form
   - Update any `/category:name` cross-references to `/skill-name` format
3. **Replace** the command file with thin pass-through (see pattern above)
4. **If template exists** in `all/copy-overwrite/`:
   - Copy the new SKILL.md to `all/copy-overwrite/.claude/skills/<skill-name>/SKILL.md`
   - Update the command at `all/copy-overwrite/.claude/commands/<category>/<name>.md`

## Skills to Use During Execution

- `/skill-creator` — Reference for skill format best practices
- `/jsdoc-best-practices` — For any JSDoc documentation
- `/git-commit` (after conversion) or `/git:commit` (before) — For committing batches

## Verification

```bash
# Count all skill directories (should be 32: 30 new + 2 existing)
ls -d .claude/skills/*/SKILL.md | wc -l

# Verify all commands are thin pass-throughs (< 10 lines each)
wc -l .claude/commands/**/*.md

# Verify template copies exist and match for skills with templates
for skill in .claude/skills/*/SKILL.md; do
  name=$(basename $(dirname "$skill"))
  template="all/copy-overwrite/.claude/skills/$name/SKILL.md"
  if [ -f "$template" ]; then
    diff "$skill" "$template" || echo "MISMATCH: $name"
  fi
done

# Lint and test pass
bun run lint && bun run test
```
