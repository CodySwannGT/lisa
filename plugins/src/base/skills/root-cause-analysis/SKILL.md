---
name: root-cause-analysis
description: "Root cause analysis methodology. Evidence gathering from logs, execution path tracing, strategic log placement, and building irrefutable proof chains."
---

# Root Cause Analysis

Definitively prove what is causing a problem. Do not guess. Do not theorize without evidence. Trace the actual execution path, read real logs, and produce irrefutable proof of root cause.

**Core principle: "Show me the proof."** Every conclusion must be backed by concrete evidence -- a log line, a stack trace, a reproducible sequence, or a failing test.

## Phase 1: Gather Evidence from Logs

### Local Logs

- Search application logs in the project directory (`logs/`, `tmp/`, stdout/stderr output)
- Run tests with verbose logging enabled to capture execution flow
- Check framework-specific log locations (e.g., `.next/`, `dist/`, build output)

### Remote Logs (AWS CloudWatch, etc.)

- Discover existing scripts and tools in the project for tailing logs:
  - Check `package.json` scripts for log-related commands
  - Search for shell scripts: `scripts/*log*`, `scripts/*tail*`, `scripts/*watch*`
  - Look for AWS CLI wrappers, CloudWatch log group configurations
  - Check for `.env` files referencing log groups or log streams
- Use discovered tools first before falling back to raw CLI commands
- When using AWS CLI directly:
  ```bash
  # Discover available log groups
  aws logs describe-log-groups --query 'logGroups[].logGroupName' --output text

  # Tail recent logs with filter
  aws logs filter-log-events \
    --log-group-name "/aws/lambda/function-name" \
    --start-time $(date -d '30 minutes ago' +%s000) \
    --filter-pattern "ERROR" \
    --query 'events[].message' --output text

  # Follow live logs
  aws logs tail "/aws/lambda/function-name" --follow --since 10m
  ```

## Phase 2: Trace the Execution Path

- Start from the error and work backward through the call stack
- Read every function in the chain -- do not skip intermediate code
- Identify the exact line where behavior diverges from expectation
- Map the data flow: what value was expected vs. what value was actually present

## Phase 3: Strategic Log Placement

When existing logs are insufficient, add targeted log statements to prove or disprove hypotheses.

### Log Statement Guidelines

- **Be surgical** -- add the minimum number of log statements needed to confirm the root cause
- **Include context** -- log the actual values, not just "reached here"
- **Use structured format** -- make logs easy to find and parse

```typescript
// Bad: Vague, unhelpful
console.log("here");
console.log("data:", data);

// Good: Precise, searchable, includes context
console.log("[DEBUG:issue-123] processOrder entry", {
  orderId: order.id,
  status: order.status,
  itemCount: order.items.length,
  timestamp: new Date().toISOString(),
});
```

### Placement Strategy

| Placement | Purpose |
|-----------|---------|
| Function entry | Confirm the function is called and with what arguments |
| Before conditional branches | Verify which branch is taken and why |
| Before/after async operations | Detect timing issues, race conditions, failed awaits |
| Before/after data transformations | Catch where data becomes corrupted or unexpected |
| Error handlers and catch blocks | Ensure errors are not silently swallowed |

### Hypothesis Elimination

When multiple hypotheses exist, design a log placement strategy that eliminates all but one. Each log statement should be placed to confirm or rule out a specific hypothesis.

## Phase 4: Prove the Root Cause

Build an evidence chain that is irrefutable:

1. **The symptom** -- what the user observes (error message, wrong output, crash)
2. **The proximate cause** -- the line of code that directly produces the symptom
3. **The root cause** -- the underlying reason the proximate cause occurs
4. **The proof** -- log output, test result, or reproduction steps that confirm each link

### Evidence Chain Format

```
Symptom: [exact error message or behavior]
    |
    v
Proximate cause: [file:line] -- [the line that directly produces the error]
    |
    v
Root cause: [file:line] -- [the underlying reason]
    |
    v
Proof: [log output / test result / reproduction that confirms the chain]
```

## Phase 5: Clean Up

After root cause is confirmed, **remove all debug log statements** added during investigation. Leave only:

- Log statements that belong in the application permanently (error logging, audit trails)
- Statements explicitly requested by the user

Verify cleanup:
```bash
# Search for any remaining debug markers
grep -rn "\[DEBUG:" src/ --include="*.ts" --include="*.tsx" --include="*.js"
```

## Output Format

```
## Root Cause Analysis

### Evidence Trail
| Step | Location | Evidence | Conclusion |
|------|----------|----------|------------|
| 1 | file:line | Log output or observed value | What this proves |
| 2 | file:line | Log output or observed value | What this proves |

### Root Cause
**Proximate cause:** The line that directly produces the error.
**Root cause:** The underlying reason this line behaves incorrectly.
**Proof:** The specific evidence that confirms this beyond doubt.

### Recommended Fix
What needs to change and why. Include file:line references.
```

## Rules

- Never guess at root cause -- prove it with evidence
- Read the actual code in the execution path -- do not rely on function names or comments to infer behavior
- When adding debug logs, use a consistent prefix (e.g., `[DEBUG:issue-name]`) so they are easy to find and clean up
- Remove all temporary debug log statements after investigation is complete
- If remote log access is unavailable, report what logs would be needed and from where
- Prefer project-specific tooling and scripts over raw CLI commands for log access
- If the root cause is in a third-party dependency, identify the exact version and known issue
- Always verify the fix resolves the issue -- do not mark investigation complete without proof
