---
description: Complete a single task within a project using a subagent with fresh context
argument-hint: <task-file>
---

1. Read $ARGUMENTS without offset or limit
2. Follow the instructions literally and specifically

## Verification Requirements

**CRITICAL**: Before marking ANY task as complete:

1. **Check for Verification section** - If the task has a "Verification" or "Proof Command" section, you MUST execute it
2. **`manual-check` verification type** - These require actual execution, not just configuration review:
   - If the check requires Docker and Docker is unavailable → Task is **BLOCKED**, not complete
   - If the check requires external services → Actually test against them
   - If the check requires running a command → Run the command and verify output
3. **Never assume configuration is correct** - Always empirically verify by running the actual tool/service
4. **If verification cannot be performed**:
   - Do NOT mark the task as complete
   - Document the blocker in findings.md
   - Mark the task status as "blocked: <reason>"

The rule "Never make assumptions about whether something worked. Test it empirically to confirm" applies especially to verification tasks.
