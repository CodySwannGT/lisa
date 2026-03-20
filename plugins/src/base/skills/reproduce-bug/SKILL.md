---
name: reproduce-bug
description: "How to create reliable bug reproduction scenarios. Covers failing tests, minimal scripts, environment verification, and reproduction evidence capture."
---

# Reproduce Bug

Before investigating root cause, reproduce the issue empirically. A bug that cannot be reproduced cannot be verified as fixed.

## Reproduction Process

### 1. Run the Failing Scenario

- Execute the exact command, test, or request that triggers the bug
- Capture the complete error output, stack trace, or unexpected behavior
- Record the exact command used so it can be repeated

### 2. Capture Evidence

- Save the full error output (not just a summary)
- Note the timestamp and environment details (OS, runtime version, dependency versions)
- Screenshot or log any visual/UI issues
- Record the actual behavior vs. the expected behavior

### 3. Investigate Environment Differences (If Cannot Reproduce)

If the issue does not reproduce locally:

- Compare environment configurations (env vars, config files, feature flags)
- Check runtime versions (Node.js, Python, Java, etc.)
- Compare dependency versions (`package-lock.json`, `poetry.lock`, etc.)
- Check data differences (database state, seed data, user roles)
- Verify network conditions (DNS, proxies, firewalls, VPN)
- Check for platform-specific behavior (OS, architecture, container vs. host)

### 4. Create a Minimal Reproduction

Create the smallest possible reproduction that triggers the bug:

**Preferred: Failing test**
- Write a test that exercises the exact code path and asserts the expected behavior
- The test should fail with the same symptom as the reported bug
- A failing test is the most reliable reproduction because it runs in CI and prevents regression

**Fallback: Reproduction script**
- Write a standalone script that triggers the issue
- Minimize dependencies -- remove anything not needed to reproduce
- Include setup steps (data seeding, config) in the script itself
- The script should be runnable by anyone with access to the repo

**Last resort: Manual steps**
- Document exact click-by-click or command-by-command steps
- Include prerequisite state (logged-in user, specific data, feature flags)
- Note any timing-sensitive aspects (race conditions, timeouts)

### 5. Verify Reproduction Is Reliable

- Run the reproduction multiple times to confirm it consistently fails
- For intermittent bugs, run enough iterations to establish the failure rate
- If intermittent, note any patterns (timing, load, specific data)

## Output Format

```text
## Reproduction

### Command/Steps
The exact command or steps to trigger the bug.

### Actual Behavior
What happens (error message, wrong output, crash).

### Expected Behavior
What should happen instead.

### Environment
- Runtime: [version]
- OS: [platform]
- Dependencies: [relevant versions]

### Reproduction Type
[ ] Failing test: [path to test file]
[ ] Script: [path to script]
[ ] Manual steps: [documented above]

### Reliability
[Always / Intermittent (N/M runs) / Conditional (only when X)]
```

## Rules

- Never skip reproduction. If you cannot reproduce, report what you tried and what you observed.
- A failing test is always the preferred reproduction method.
- Capture complete error output -- do not truncate or summarize.
- If the bug is environment-specific, document exactly which environment triggers it.
- Do not begin root cause analysis until you have a reliable reproduction.
