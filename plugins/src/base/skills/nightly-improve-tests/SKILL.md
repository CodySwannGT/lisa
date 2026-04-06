---
name: nightly-improve-tests
description: "Nightly direct-execution skill for improving test quality. In nightly mode, focuses on tests for recently changed files. In general mode, scans all tests for the weakest ones. Commits and creates a PR."
allowed-tools: ["Edit", "MultiEdit", "Write", "Read", "Glob", "Grep", "Bash"]
---

# Nightly Test Quality Improvement

The caller provides:
- **Mode**: "nightly" or "general"
- **Changed files** (nightly mode only): list of source files changed in the last 24 hours

## Nightly Mode

1. For each changed source file, find its corresponding test file(s)
2. Analyze those test files for: missing edge cases, weak assertions (toBeTruthy instead of specific values), missing error path coverage, tests that test implementation rather than behavior
3. Improve the test files with the most impactful changes
4. Run the full test suite to verify all tests pass
5. Commit changes with conventional commit messages
6. Create a PR with `gh pr create` summarizing what was improved and why

## General Mode

1. Scan the test files to find weak, brittle, or poorly-written tests
2. Look for: missing edge cases, weak assertions (toBeTruthy instead of specific values), missing error path coverage, tests that test implementation rather than behavior
3. Improve 3-5 test files with the most impactful changes
4. Run the full test suite to verify all tests pass
5. Commit changes with conventional commit messages
6. Create a PR with `gh pr create` summarizing what was improved and why
