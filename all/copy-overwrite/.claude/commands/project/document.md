---
description: Updates all documentation related to changes implemented in the project
argument-hint: <project-directory>
allowed-tools: Read, Write, Edit, Bash, Glob, Grep, Task, TaskCreate, TaskUpdate, TaskList, Skill
---

The current branch is a feature branch with implementation of the project in $ARGUMENTS.

Changes on this branch need corresponding documentation updates to keep README, API docs, changelogs, and JSDoc current.

**IMPORTANT**: Perform each step and move to the next without stopping.

## Setup

Set active project marker: `echo "$ARGUMENTS" | sed 's|.*/||' > .claude-active-project`

Extract `<project-name>` from the last segment of `$ARGUMENTS`.

## Create and Execute Tasks

Create workflow tracking tasks with `metadata.project` set to the project name:

```
TaskCreate:
  subject: "Identify changed files and documentation targets"
  description: "Use git to identify files changed on this branch (git diff main...HEAD --name-only). For each changed file, identify related documentation: README sections, API docs, inline JSDoc, CHANGELOG entries, architecture docs, configuration docs. Compile a mapping of: changed file → related documentation file(s). Save to $ARGUMENTS/doc-targets.json with structure: { \"file.ts\": [\"README.md#section\", \"docs/api.md\"], ... }"
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Update README and user-facing docs"
  description: "For each documentation target in $ARGUMENTS/doc-targets.json that is a README section or user guide: Read the changed implementation file. Read the current documentation section. Update the documentation to accurately reflect the new/changed behavior, examples, or configuration. Preserve existing structure and tone."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Update API and technical documentation"
  description: "For each documentation target that is API docs, architecture docs, or technical guides: Read the changed implementation. Read the current documentation. Update to reflect new endpoints, parameters, type signatures, behavior changes, or architectural decisions. Ensure consistency with code comments."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Update CHANGELOG"
  description: "If CHANGELOG.md or CHANGELOG.{md,txt,rst} exists in project root: Add entry for all user-facing changes. Group by type (Added, Changed, Fixed, Deprecated). Reference relevant files or features. Follow existing CHANGELOG format and conventions."
  metadata: { project: "<project-name>" }

TaskCreate:
  subject: "Verify JSDoc on changed files"
  description: "Read $ARGUMENTS/doc-targets.json. For each changed file (key), verify its JSDoc preamble and function/export documentation are current: Run /jsdoc-best-practices skill. Check that file-level preambles explain the module's purpose and when to use it. Check that exported functions/types have 'why' documentation (not just 'what'). Update any stale or missing documentation."
  metadata: { project: "<project-name>" }
```

**Execute each task via a subagent** to preserve main context. Launch up to 5 in parallel where tasks don't have dependencies. Do not stop until all are completed.

