---
description: Reduces the code complexity of the codebase by 2 on each run
allowed-tools: Read, Write, Bash(git*), Glob, Grep, Task, TodoWrite
---

## Step 0: MANDATORY SETUP

Create workflow tracking todos:
- Step 1: Lower complexity threshold
- Step 2: Run lint
- Step 3: Save spec file
- Step 4: Bootstrap project
- Step 5: Resolve questions
- Step 6: Execute project

⚠️ **CRITICAL**: DO NOT STOP until all 7 todos are marked completed.

## Step 1: Lower Complexity Threshold
Mark "Step 1: Lower complexity threshold" as in_progress.

In @eslint.config.mjs, lower the active cognitive complexity rule by two.
Save the file.

Mark "Step 1: Lower complexity threshold" as completed. Proceed to Step 2.

## Step 2: Run Lint
Mark "Step 2: Run lint" as in_progress.

Run the lint command from @package.json.

Mark "Step 2: Run lint" as completed. Proceed to Step 3.

## Step 3: Save Spec File
Mark "Step 3: Save spec file" as in_progress.

Save the output of the lint command to `specs/reduce-cognitive-complexity.md` along with the following instructions:

```text

Refactor the <files> to adhere to the cognitive complexity rule.

Common Solutions

1. Extract functions: Break complex logic into smaller, named functions
2. Early returns: Reduce nesting with guard clauses
3. Extract conditions: Move complex boolean logic into named variables
4. Use lookup tables: Replace complex switch/if-else chains
5. Break larger components into smaller components with their own View/Container pattern
```

Mark "Step 3: Save spec file" as completed. Proceed to Step 4.

## Step 4: Bootstrap Project
Mark "Step 4: Bootstrap project" as in_progress.

Run /project:bootstrap @specs/reduce-cognitive-complexity.md

Mark "Step 4: Bootstrap project" as completed. Proceed to Step 5.

## Step 5: Resolve Questions
Mark "Step 5: Resolve questions" as in_progress.

Answer any unresolved questions in the new project's `research.md` file.

Mark "Step 5: Resolve questions" as completed. Proceed to Step 6.

## Step 6: Execute Project
Mark "Step 6: Execute project" as in_progress.

Run /project:execute [project-dir] where [project-dir] is the directory created from Step 4.

Mark "Step 6: Execute project" as completed.

Report: "🎉 Code complexity reduction complete"
