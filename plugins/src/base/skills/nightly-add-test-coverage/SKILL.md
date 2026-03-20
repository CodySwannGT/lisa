---
name: nightly-add-test-coverage
description: "Nightly direct-execution skill for increasing test coverage. Receives pre-computed threshold data, writes tests targeting coverage gaps, updates thresholds, commits, and creates a PR."
allowed-tools: ["Edit", "MultiEdit", "Write", "Read", "Glob", "Grep", "Bash"]
---

# Nightly Test Coverage Improvement

The caller provides pre-computed context:
- **Package manager** (`npm`, `yarn`, or `bun`)
- **Thresholds file** path (vitest.thresholds.json or jest.thresholds.json)
- **Current thresholds** (statements, branches, functions, lines percentages)
- **Proposed thresholds** (each metric increased by the coverage increment, capped at 90%)
- **Metrics being bumped** (which metrics are below target)

## Instructions

1. Read CLAUDE.md and package.json for project conventions
2. Run the project's coverage script with the provided package manager (e.g., `npm run test:cov`, `yarn test:cov`, or `bun run test:cov`) to get the coverage report -- identify gaps BEFORE reading any source files
3. Parse the coverage output to identify the specific files and lines with the lowest coverage. Prioritize files with the most uncovered lines/branches.
4. Read only the uncovered sections of source files using the coverage report line numbers -- do not explore the codebase broadly
5. Write new tests to increase coverage enough to meet the proposed thresholds. Focus on the metrics being bumped -- write tests that cover untested branches, statements, functions, and lines.
6. Re-run the coverage script with the provided package manager to verify the new thresholds pass
7. Update the thresholds file with the proposed new threshold values
8. Re-run the coverage script with the provided package manager to confirm the updated thresholds pass
9. Commit all changes (new tests + updated thresholds file) with conventional commit messages
10. Create a PR with `gh pr create` with a title like "test: increase test coverage: [metrics being bumped]" summarizing coverage improvements
