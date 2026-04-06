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
4. **Before editing**, check each violating file's total line count (`wc -l`). If a file is within 20 lines of its `max-lines` ESLint limit (typically 300), extract helpers into a **separate companion file** (e.g., `fooHelpers.ts`) instead of adding them to the same file. Extracting functions into the same file adds net lines and can create new max-lines violations.
5. Fix violations one file at a time. Read only the specific function that violates — do not pre-read all files upfront. Fix it, then move to the next.
6. For cognitive complexity violations: use early returns, extract helper functions, replace conditionals with lookup tables
7. For max-lines-per-function violations: split large functions, extract helper functions, separate concerns
8. After each file edit, run the project's formatter (e.g., `bun run format` or `npx prettier --write <file>`) to ensure line counts reflect the final formatted state before moving on
9. Re-run the lint script with the provided package manager to verify all violations are resolved (both the target metric AND max-lines)
10. Run the TypeScript compiler to catch type errors early: `npx tsc --noEmit 2>&1 | head -30`. If there are type errors, fix them now — do NOT wait until the commit step. Pre-commit hooks run type checking, and discovering errors at commit time wastes turns.
11. Run the project's test script with the provided package manager (e.g., `npm run test`, `yarn test`, or `bun run test`) to verify no tests are broken by the refactoring
12. Commit all changes (refactored code + updated eslint.thresholds.json) with conventional commit messages
13. Create a PR with `gh pr create` with a title like "refactor: reduce code complexity: [metrics being reduced]" summarizing the changes
