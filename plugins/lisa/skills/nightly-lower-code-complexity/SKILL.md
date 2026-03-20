---
name: nightly-lower-code-complexity
description: "Nightly direct-execution skill for reducing code complexity thresholds. Receives pre-computed threshold data, refactors violations, updates thresholds, commits, and creates a PR."
allowed-tools: ["Edit", "MultiEdit", "Write", "Read", "Glob", "Grep", "Bash"]
---

# Nightly Code Complexity Reduction

The caller provides pre-computed context:
- **Package manager** (`npm`, `yarn`, or `bun`)
- **Current thresholds** (cognitiveComplexity, maxLinesPerFunction from eslint.thresholds.json)
- **Proposed thresholds** (each metric decreased toward target minimums)
- **Metrics being reduced** (which metrics are above target)

## Instructions

1. Read CLAUDE.md and package.json for project conventions
2. Update eslint.thresholds.json with the proposed new threshold values (do NOT change the maxLines threshold)
3. Run the project's lint script with the provided package manager (e.g., `npm run lint`, `yarn lint`, or `bun run lint`) to find functions that violate the new stricter thresholds
4. For cognitive complexity violations: use early returns, extract helper functions, replace conditionals with lookup tables
5. For max-lines-per-function violations: split large functions, extract helper functions, separate concerns
6. Re-run the lint script with the provided package manager to verify all violations are resolved
7. Run the project's test script with the provided package manager (e.g., `npm run test`, `yarn test`, or `bun run test`) to verify no tests are broken by the refactoring
8. Commit all changes (refactored code + updated eslint.thresholds.json) with conventional commit messages
9. Create a PR with `gh pr create` with a title like "refactor: reduce code complexity: [metrics being reduced]" summarizing the changes
