---
description: Complete a single task within a project using a subagent with fresh context
argument-hint: <task-file>
---

1. Read $ARGUMENTS without offset or limit
2. Follow the instructions literally and specifically

## Verification Requirements

**CRITICAL**: Before marking ANY task as complete:

### For JSON Tasks (`.json` files)

If the task file is JSON and contains `metadata.verification`:

1. **Extract verification data**:
   ```json
   {
     "metadata": {
       "verification": {
         "type": "manual-check",
         "command": "the command to run",
         "expected": "description of expected output"
       }
     }
   }
   ```

2. **Run the verification command** using Bash tool
3. **Compare output to expected** - Verify the output matches the `expected` description
4. **Only mark complete if verification passes**

### For Markdown Tasks (`.md` files)

If the task has a "## Verification" section with "### Proof Command":

1. **Extract the Proof Command** from the markdown
2. **Run the command** using Bash tool
3. **Compare output to Expected Output** section
4. **Only mark complete if verification passes**

### Verification Rules

1. **`manual-check` verification type** - These require actual execution, not just configuration review:
   - If the check requires Docker and Docker is unavailable → Task is **BLOCKED**, not complete
   - If the check requires external services → Actually test against them
   - If the check requires running a command → Run the command and verify output
2. **Never assume configuration is correct** - Always empirically verify by running the actual tool/service
3. **If verification cannot be performed**:
   - Do NOT mark the task as complete
   - Document the blocker in findings.md
   - Mark the task status as "blocked: <reason>"
4. **If verification fails**:
   - Do NOT mark the task as complete
   - Fix the issue and re-run verification
   - Only mark complete when verification passes

The rule "Never make assumptions about whether something worked. Test it empirically to confirm" applies especially to verification tasks.
