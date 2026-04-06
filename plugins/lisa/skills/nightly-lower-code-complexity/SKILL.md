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

## Turn budget

You have a limited turn budget. Optimize for fewer tool calls:
- **Batch** `wc -l` for ALL violating files in a single command after lint
- **Fix all violations in a file** before moving to the next file (read the file once, make all edits)
- **Use parallel tool calls** when reading multiple independent files
- **Run formatter once** at the end, not after each file
- Do NOT spend turns exploring ESLint config — the thresholds are provided in the prompt

## Instructions

1. Update eslint.thresholds.json with the proposed new threshold values (do NOT change the maxLines threshold)
2. Run the project's lint script with the provided package manager (e.g., `npm run lint`, `yarn lint`, or `bun run lint`) to find functions that violate the new stricter thresholds
3. **Immediately after lint**, run `wc -l` on ALL violating files in a single command (e.g., `wc -l file1.ts file2.ts file3.ts`). If a file is within 20 lines of its `max-lines` ESLint limit (typically 300), extract helpers into a **separate companion file** (e.g., `fooHelpers.ts`) instead of adding them to the same file. Extracting functions into the same file adds net lines and can create new max-lines violations.
4. Fix violations file by file. When a file has multiple violations, read the file once and fix all violations in that file before moving on. Read only the region around the violating functions — do not read the entire file if it is large.
5. For cognitive complexity violations: use early returns, extract helper functions, replace conditionals with lookup tables
6. For max-lines-per-function violations: split large functions, extract helper functions, separate concerns
7. After all files are fixed, run the project's formatter on all changed files (e.g., `bun run format`) to ensure line counts reflect the final formatted state
8. Re-run the lint script with the provided package manager to verify all violations are resolved (both the target metric AND max-lines)
9. Run the TypeScript compiler to catch type errors early: `npx tsc --noEmit 2>&1 | head -30`. If there are type errors, fix them now — do NOT wait until the commit step. Pre-commit hooks run type checking, and discovering errors at commit time wastes turns.
10. Run the project's test script with the provided package manager (e.g., `npm run test`, `yarn test`, or `bun run test`) to verify no tests are broken by the refactoring
11. Commit all changes (refactored code + updated eslint.thresholds.json) with conventional commit messages
12. Create a PR with `gh pr create` with a title like "refactor: reduce code complexity: [metrics being reduced]" summarizing the changes
