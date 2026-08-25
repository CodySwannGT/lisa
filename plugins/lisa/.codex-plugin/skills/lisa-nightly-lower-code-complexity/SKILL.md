---
name: lisa-nightly-lower-code-complexity
description: "Nightly direct-execution skill…"
allowed-tools: ["Edit", "MultiEdit", "Write", "Read", "Glob", "Grep", "Bash"]
---

# Nightly Code Complexity Reduction

The caller provides pre-computed context:
- **Package manager** (`npm`, `yarn`, or `bun`)
- **Current thresholds** (cognitiveComplexity, maxLinesPerFunction from eslint.thresholds.json)
- **Proposed thresholds** (each metric decreased toward target minimums)
- **Metrics being reduced** (which metrics are above target)

## Instructions

1. Update eslint.thresholds.json with the proposed new threshold values (do NOT change the maxLines threshold)
2. Run the project's lint script with the provided package manager (e.g., `npm run lint`, `yarn lint`, or `bun run lint`) to find functions that violate the new stricter thresholds
3. **Before editing**, check each violating file's total line count (`wc -l`). If a file is within 20 lines of its `max-lines` ESLint limit (typically 300), extract helpers into a **separate companion file** (e.g., `fooHelpers.ts`) instead of adding them to the same file. Extracting functions into the same file adds net lines and can create new max-lines violations.
4. Fix violations one file at a time. Read only the specific function that violates — do not pre-read all files upfront. Fix it, then move to the next.
5. For cognitive complexity violations: use early returns, extract helper functions, replace conditionals with lookup tables
6. For max-lines-per-function violations: split large functions, extract helper functions, separate concerns
7. After each file edit, run the project's formatter **with the provided package manager** (e.g., `npm run format`, `yarn format`, or `bun run format`) to ensure line counts reflect the final formatted state before moving on. Do not reach for a bare `npx prettier`: when the binary is absent `npx` silently installs and executes whatever the registry currently publishes under that name, which is an unpinned dependency introduced by a formatting step. If the project has no format script, run the lockfile-pinned binary directly (`./node_modules/.bin/prettier --write <file>`)
8. Re-run the lint script with the provided package manager to verify all violations are resolved (both the target metric AND max-lines)
9. Run the project's typecheck script with the provided package manager to catch type errors early — same reasoning as step 7, so `npm run typecheck` / `yarn typecheck` / `bun run typecheck`, falling back to `./node_modules/.bin/tsc --noEmit` rather than `npx tsc`:

   ```sh
   status=0
   bun run typecheck >tsc.log 2>&1 || status=$?
   head -n 30 tsc.log; echo "exit=$status"
   ```

   Capture the status before the pipe — a pipeline reports its LAST stage's exit code, and `head` always succeeds, so `tsc --noEmit | head -30` reads as clean however many errors it printed (`falsifiable-checks`, pager-shadowed status). `|| status=$?` rather than `; status=$?`: under `set -e` the `;` form exits before the assignment, so the failure is never reported at all. If there are type errors, fix them now — do NOT wait until the commit step. Pre-commit hooks run type checking, and discovering errors at commit time wastes turns.
10. Run the project's test script with the provided package manager (e.g., `npm run test`, `yarn test`, or `bun run test`) to verify no tests are broken by the refactoring
11. Commit all changes (refactored code + updated eslint.thresholds.json) with conventional commit messages
12. Create a PR with `gh pr create` with a title like "refactor: reduce code complexity: [metrics being reduced]" summarizing the changes
