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

### Phase 1: Identify gaps

1. Run the project's coverage script with the provided package manager (e.g., `npm run test:cov`, `yarn test:cov`, or `bun run test:cov`) to get the coverage report -- identify gaps BEFORE reading any source files
2. Parse the coverage output to identify the specific files and lines with the lowest coverage. Prioritize files with the most uncovered lines/branches.
3. Read ONE existing test file to learn the project's testing patterns (mocks, imports, assertions). Do not read more than one.

### Phase 2: Write tests incrementally — one file at a time

For each source file with low coverage (starting with the lowest):

4. Read only the uncovered sections of the source file using the coverage report line numbers -- do not explore the codebase broadly
5. Write a test file targeting the uncovered branches/lines for that source file
6. Run the test file in isolation (e.g., `npx vitest run tests/my-new-test.test.ts`) to verify it passes before moving on
7. If the test fails, fix it immediately. Do not move to the next file until the current test passes.
8. Repeat steps 4-7 for the next source file. Stop once you estimate the proposed thresholds will be met.

### Phase 3: Verify and ship

9. Run the full coverage script to verify the new thresholds pass
10. Update the thresholds file with the proposed new threshold values
11. Re-run the coverage script to confirm the updated thresholds pass
12. Commit all changes (new tests + updated thresholds file) with conventional commit messages
13. Create a PR with `gh pr create` with a title like "test: increase test coverage: [metrics being bumped]" summarizing coverage improvements
