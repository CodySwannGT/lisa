# Plan: Update OVERVIEW.md to Reflect Current Architecture

## Overview

OVERVIEW.md is outdated in several areas after the command-to-skill conversion. The primary issue is the execute phase listing only 5 steps instead of the actual 7, but there are additional stale sections.

## Changes

### 1. Fix Execute Phase (Lines 135-162)

Update from 5 steps to 7 steps:

**Current (5 steps):** Plan → Implement → Verify → Debrief → Archive

**Correct (7 steps):** Plan → Implement → Review → Documentation → Verify → Debrief → Archive

Replace the execute phase block with:

```
1. Plan
   • Break work into small, independent tasks
   • Create progress tracking

2. Implement (TDD Loop)
   • Write failing tests first
   • Write implementation
   • Run tests until passing
   • Create atomic commits

3. Review
   • Run local code review and CodeRabbit review
   • Implement fixes from review feedback

4. Documentation
   • Update all documentation related to changes
   • Update README, API docs, JSDoc documentation

5. Verify
   • Confirm all requirements met
   • Run verification commands
   • Document any drift

6. Debrief
   • Extract reusable patterns
   • Update .claude/rules/PROJECT_RULES.md for future projects

7. Archive
   • Move completed project to archive
   • Final commit and PR
```

**File:** `OVERVIEW.md` lines 139-162

### 2. Update Skills Section (Lines 192-211)

The skills section lists only 2 skills (`jsdoc-best-practices`, `skill-creator`). There are now 31 skills. Update to categorize them:

- **Foundational skills** (auto-applied): `jsdoc-best-practices`, `skill-creator`
- **Workflow skills** (invoked by commands): All 29 command-delegation skills organized by category (git, project, tasks, jira, sonarqube, pull-request, lisa)

Add a note explaining the two-tier architecture:
- Foundational skills teach patterns and are applied automatically
- Workflow skills contain command logic and are invoked by slash commands

Update the directory structure example to show representative skills from each category (not all 31, but enough to convey the structure).

**File:** `OVERVIEW.md` lines 192-211

### 3. Add Commands → Skills Architecture Note (Lines 234-237)

After the "What they are" description for Slash Commands, add a brief note:

> Each command delegates to a corresponding skill in `.claude/skills/`. Commands serve as thin entry points; the workflow logic lives in the skill's `SKILL.md` file.

**File:** `OVERVIEW.md` lines 234-237

### 4. Update Phase 2 Skills Guidance (Lines 755-776)

The "Phase 2: Write Rules and Skills" section says to start with 2 skills. Update to acknowledge the two tiers:

- **Foundational skills** (documentation standards, skill creation) — teach patterns
- **Workflow skills** — automatically created when you build commands that delegate to skills

**File:** `OVERVIEW.md` lines 755-776

## Files Modified

- `OVERVIEW.md` — All 4 changes above

## Verification

```bash
# Confirm the 7-step execute phase is present
grep -c "^[0-9]\." OVERVIEW.md  # Should see 7 numbered items in the execute block

# Confirm skills section mentions workflow skills
grep "Workflow skills" OVERVIEW.md

# Confirm architecture note exists
grep "delegates to a corresponding skill" OVERVIEW.md

# Run format check
bun run format:check -- OVERVIEW.md
```
