# Project Rules

Project-specific rules and guidelines that apply to this codebase.

Rules in `.claude/rules/` are automatically loaded by Claude Code at session start.
Add project-specific patterns, conventions, and requirements below.

This file is **human-authored only** — the humans' decree surface. Automated
flows never append to it: machine-captured learnings land in the learnings
ledger (default `.lisa/PROJECT_LEARNINGS.md`) via the executable contract, and
the gardener (`/lisa:learnings:audit`) proposes promotions, demotions, and
retirements as human-gated tracker tickets. Existing sections of this file are
first-run gardener candidates like any other knowledge — expect prose that
restates what a lint or hook already enforces to earn a promote-and-delete
ticket over time, so this file shrinks instead of growing.

---

## Never edit generated plugin artifacts (plugins/lisa, plugins/lisa-*)

`plugins/lisa/` and every `plugins/lisa-<stack>/` directory are **generated build output**. `scripts/build-plugins.sh` (run via `bun run build:plugins`) does `rm -rf plugins/lisa && cp -r plugins/src/base`, so any edit made directly to an artifact is silently discarded on the next build or release.

The source of truth is **`plugins/src/`**:

- `plugins/src/base/` → builds `plugins/lisa`
- `plugins/src/<stack>/` (typescript, expo, nestjs, cdk, harper-fabric, rails) → builds `plugins/lisa-<stack>`

To change a skill, agent, rule, command, or hook:

1. Edit the file under `plugins/src/...`.
2. Run `bun run build:plugins`.
3. Commit **both** `plugins/src` and the regenerated `plugins/lisa*`.

The `🧩 Plugins Sync` CI workflow (and `bun run check:plugins` locally) rebuilds from source and fails if committed artifacts don't match — catching artifact-only edits. Two PRs (#471, #478) were wiped this way before the guard existed; do not reintroduce the pattern.

---

## package.json and package.lisa.json Management

When updating package.json, always check if there's a corresponding `package.lisa.json` template file. Update both together:

- **package.lisa.json** (source): Defines governance rules in `force`, `defaults`, and `merge` sections
- **package.json** (destination): Remains clean with no `//lisa-*` tags

For example:
- Changes to `typescript/package-lisa/package.lisa.json` apply to all TypeScript projects
- Changes to `package.lisa.json` force/defaults/merge sections determine how they affect project package.json files
- Project package.json files should never contain governance markers; they're purely application files

See README.md "Package.lisa.json" section for details on force/defaults/merge semantics.

### Semantic Merge Behaviors

Understanding force/defaults/merge is critical for template design:

- **force**: Lisa's values completely replace project's values. Use for governance-critical configs (linting rules, mandatory dependencies, commit hooks).
- **defaults**: Project's values are preserved; Lisa provides fallback. Use for helpful starting templates that projects can override (Node.js version, TypeScript version).
- **merge**: Arrays are concatenated and deduplicated. Use for shared lists (trusted dependencies, linting plugins) where both Lisa and project contributions are valuable.

When adding a new configuration:
1. Ask: "Is this governance-critical?" → Use `force`
2. Ask: "Can projects safely override this?" → Use `defaults`
3. Ask: "Is this a list where Lisa and projects both contribute?" → Use `merge`

## General Rules

When updating a project file, always check to see if it has a corresponding template file. IF it does, update it to match. This DOES NOT apply to "create-only" rules.

When upstreaming a governance pattern discovered in a downstream project (e.g., frontend-v2, backend-v2), trace it back to the Lisa template source files and update both the template and its tests. This ensures the pattern propagates to all projects using that stack template.

Never parse JSON in shell scripts using grep/sed/cut/awk - always use jq for robust JSON handling.

When creating Claude Code hooks for enforcement (linting, code quality, static analysis), always use blocking behavior (exit 2 on failures) so Claude receives feedback and can fix the errors. Notification-only hooks (like ntfy.sh) should exit 0 since they don't require Claude to take action.

## Skills and Commands

Skills and commands serve different roles across coding-agent harnesses:

- **Skills** (`.claude/skills/<name>/SKILL.md`): Contain implementation logic. Use hyphen-separated naming (e.g., `lisa-plan`, `lisa-git-commit`). Skills do NOT support `argument-hint` or `$ARGUMENTS` substitution.
- **Commands** (`.claude/commands/<namespace>/<name>.md`): User-facing interface with `argument-hint` and `$ARGUMENTS` support. Use colon-scoped namespaces whenever the target agent supports native commands. Directory nesting creates colon-separated names in slash-command UIs (e.g., `lisa/implement.md` becomes `/lisa:implement` in Claude/OpenCode-style harnesses). Commands pass through to skills.

Every user-facing workflow should have a colon-scoped command and a hyphenated skill target when both surfaces exist. Example: `/lisa:implement` delegates to `/lisa-implement`. Not every coding agent supports `/` commands; Codex does not. For agents without native command support, install the equivalent hyphenated skill alias and document its native invocation syntax, such as `$lisa-implement` for Codex.

Skills can invoke other skills via the Skill tool, enabling skill chaining and composition. Internal skill-to-skill references use hyphen names (e.g., `/lisa-git-commit`).

Lisa-specific skills (like `lisa-integration-test`, `lisa-learn`, `lisa-review-project`) should only exist in the root `.claude/skills/` and `.claude/commands/` directories, NOT in downstream template directories such as `all/merge/`, since they are only relevant to the Lisa repository itself, not downstream projects.

## Task Metadata

When creating tasks, do not include `/coding-philosophy` in the `skills` array of task metadata. The coding philosophy is distributed as a generated Lisa rule and does not need to be explicitly invoked.

## ESLint Statement Order

When writing utility functions, avoid calling shared validation helpers (expression statements/side effects) before const definitions, as this violates the enforce-statement-order rule. Instead, inline validation as `if` guard clauses, which are exempt from the ordering rule.

Example:

```typescript
// Wrong - validation helper call before const
function fibonacci(n: number): bigint {
  validateNonNegativeInteger(n, "n"); // Expression statement
  const result = compute(n); // Const after expression
  return result;
}

// Correct - inline validation as guard clause
function fibonacci(n: number): bigint {
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new RangeError(`Expected a non-negative integer for n, got ${String(n)}`);
  }
  const result = compute(n);
  return result;
}
```

## Test Isolation

Tests should not call other functions under test to compute expected values, as this creates coupling. Use hardcoded known values instead.

Example:

```typescript
// Wrong - creates coupling between tests
it("fibonacciSequence(5) returns correct sequence", () => {
  const expected = [fibonacci(0), fibonacci(1), fibonacci(2), fibonacci(3), fibonacci(4)];
  expect(fibonacciSequence(5)).toEqual(expected);
});

// Correct - uses hardcoded known values
it("fibonacciSequence(5) returns correct sequence", () => {
  expect(fibonacciSequence(5)).toEqual([0n, 1n, 1n, 2n, 3n]);
});
```
## Agent Team Workflows

When working with agent teams, follow these patterns to handle platform behaviors:

### Context Compaction Resilience

Context compaction can cause team leads to lose in-memory state (task assignments, owner fields). To mitigate this:

1. **Dual owner storage** - On every TaskUpdate that sets `owner`, also store it in `metadata.owner`:
   ```
   TaskUpdate({ taskId: "1", owner: "implementer-1", metadata: { owner: "implementer-1" } })
   ```
2. **Re-read after compaction** - Immediately call TaskList to reload all task state after compaction occurs
3. **Restore missing owners** - If any task has `metadata.owner` but no `owner` field, restore it via TaskUpdate
4. **Never rely on memory** - Always call TaskList before assigning new work

### Review Task Parallelization

Parallelize all independent review agents after implementation is complete:

- `product-specialist`, `coderabbit:code-reviewer`, `plan-local-code-review`, `quality-specialist` all run concurrently
- Gate a single "implement valid suggestions" task behind all review completions using `blockedBy`
- This minimizes review cycle time by running 4 reviews concurrently instead of sequentially

```text
[implementation] → [product] [coderabbit] [local] [quality] → [implement suggestions]
                    ↑ all run in parallel ↑                    ↑ blocked by all 4 ↑
```

### Plugin Agent Naming

Plugin agents use colon-separated naming format: `namespace:agent-name`

Examples:
- `coderabbit:code-reviewer` (not `coderabbit`)
- `code-simplifier:code-simplifier` (not `code-simplifier`)

This is a platform convention for spawning plugin agents via the Agent Team API.

## File Operations

### Plan Archival

When archiving plan files, always use `mv` via Bash, never Write or Edit tools. Write and Edit overwrite file contents, which loses the `## Sessions` table that tracks session IDs. Only `mv` preserves the complete file contents during relocation.

### Barrel Export Pre-commit Constraint

Cannot make "deletion-only" commits when barrel exports (index.ts files) reference the deleted files. Pre-commit hooks run lint/typecheck which will fail on broken imports.

Solution: Combine deletion of old file + creation of new file in the same atomic commit.

Example: Deleting `src/utils/fibonacci.ts` alone fails because `src/utils/index.ts` exports `export * from './fibonacci.js'`. Instead, delete the old implementation and add the new implementation in a single commit.

## ESLint Disable Comments

### Description Requirement

All `eslint-disable` directives must include a description to satisfy the `eslint-comments/require-description` rule.

Format: `/* eslint-disable rule-name -- description of why this exception is needed */`

Example from generator pattern — prefer a single tuple over separate variables to group related state:

```typescript
/* eslint-disable functional/no-let -- generator requires mutable pair to track consecutive Fibonacci values */
let pair: readonly [bigint, bigint] = [0n, 1n];
/* eslint-enable functional/no-let -- re-enable after generator state declaration */
```

Using a tuple (`readonly [bigint, bigint]`) instead of separate `let a, b` declarations keeps coupled state in a single structure and minimizes the number of mutable bindings.

## TypeScript Type System

### readonly is Compile-Time Only

TypeScript's `readonly` modifier (e.g., `readonly bigint[]`) is a compile-time constraint only and has no runtime representation.

Do NOT test runtime immutability with `Object.isFrozen()` for readonly types — TypeScript types are erased at runtime.

Runtime immutability tests (`Object.freeze()`, `Object.isFrozen()`) are separate from TypeScript readonly type checks.

## DRY Principle

### Prefer Delegation to Single Source of Truth

When multiple functions compute the same sequence or data structure, prefer delegating to a shared generator or canonical implementation rather than reimplementing the algorithm.

Example from fibonacci implementation:

```typescript
// Before: Reimplements Fibonacci logic with tuple-reduce (O(1) space but duplicates logic)
export function fibonacci(n: number): bigint {
  const [, result] = Array.from({ length: n - 1 }).reduce<readonly [bigint, bigint]>(
    ([prev, curr]) => [curr, prev + curr] as const,
    [0n, 1n]
  );
  return result;
}

// After: Delegates to fibonacciGenerator (DRY - single source of truth)
export function fibonacci(n: number): bigint {
  const gen = fibonacciGenerator();
  Array.from({ length: n }, () => gen.next());
  return gen.next().value;
}
```

Even when the reimplementation has theoretical performance benefits (O(1) space), prefer simplicity and DRY unless performance is empirically proven to be a bottleneck.

## Test Assertion Preservation During Rewrites

When rewriting or replacing a module from scratch, always review the old test file before deletion. Preserve assertion patterns that validate non-obvious behavior, especially:

- Error message content verification (`expect(error.message).toContain(...)`)
- Edge case and boundary condition assertions
- Type-level assertions (e.g., `typeof` checks on return values)

Do not assume new tests cover everything the old tests did. Compare old and new test coverage before marking the rewrite complete.

## TDD RED Phase with Deleted Source

When performing TDD RED by deleting the source module, Jest reports **0 tests found** (not N failed) because module-not-found prevents test file parsing entirely — `describe`/`it` blocks never register.

This is expected behavior. Verify RED by confirming either:
- `Tests: 0 total` (test file couldn't parse)
- A module resolution error in Jest output

Do **not** expect N individual test failures when the imported module doesn't exist.

## TDD 3-Commit Deletion Workflow

When replacing a module from scratch via TDD, use exactly 3 atomic commits:

1. **`refactor: remove existing <module>`** — delete source file, remove barrel export from `index.ts`, delete test file
2. **`test: add failing tests for new <module> (TDD RED)`** — write comprehensive tests importing the (non-existent) source directly
3. **`feat: implement new <module> (TDD GREEN)`** — create implementation and re-add barrel export to `index.ts`

This sequence is necessary because:
- Barrel exports must be removed in commit 1 (see [Barrel Export Pre-commit Constraint](#barrel-export-pre-commit-constraint))
- Barrel exports must be re-added in commit 3, not commit 2, since the source file doesn't exist yet during RED phase
- Pre-commit hooks (lint/typecheck) run on every commit and will fail if barrel exports reference missing files

Deviating from this sequence (e.g., deleting source without removing barrel export, or adding barrel export before implementation exists) causes pre-commit hook failures.

## Verify Auto-Merge Actually Shipped Your Fix (Ancestry Check)

Enabling auto-merge and pushing a fix commit does NOT guarantee the fix ships. GitHub auto-merge can merge the PRIOR head the instant required checks go green — before your new commit becomes the PR head. This shipped a real bug: release 2.124.5 shipped the `./hooks/` Cursor bug because a CodeRabbit fix commit raced past PR #1069's merge; it had to be fixed forward in 2.124.6 (issue #1055).

Before declaring any auto-merge PR done — do NOT rely on "pushed + thread resolved + checks green" as proof:

1. `git fetch origin`
2. Confirm the fix commit is an ancestor of the merged base: `git merge-base --is-ancestor <fix-sha> origin/main` (exit 0 = shipped).
3. Confirm the merge commit's parent is your fixed commit, not a stale head.

If CI or CodeRabbit forces another commit after auto-merge is enabled, re-confirm the merged head includes it.

## Local `lisa ui` verification

- CLI entrypoint is `bun src/index.ts ui` (or `bun dist/index.js ui` after build). Do not use `bun src/cli/index.ts ui` — that module has no `main()`.
- After source changes that register new `/api/status` probes, rebuild (`bun run build:dist`) or run via the source entrypoint before trusting live `dist/` output; a stale `dist/` can omit newly added probe modules.

## Committing in this repo: use `git commit -F`, never a heredoc

The parity-safety-net hook blocks `git commit -m "$(cat <<EOF … EOF)"` heredoc invocations. Write the message to a file and use `git commit -F <file>` instead. Every commit must also carry a `Co-authored-by: Claude <noreply@anthropic.com>` trailer (Codex commits use `Co-authored-by: Codex`) or the co-authorship hook rejects it — see [[reference_codex_commit_attribution]].

## Lisa Console UI (`ui/`)

The console UI ships as a single hand-written file, `ui/index.html` (there is no bundler/`ui/dist`). It is served by the `lisa ui` command in `src/cli/ui-cmd.ts` (`runUi`). Rules for working on it and its tests:

### Built CLI entry is `dist/index.js`, not `dist/src/...`

`tsconfig.local.json` sets `rootDir: "src"` + `outDir: "dist"`, which flattens `src/` out of the emitted tree. The CLI entry is `dist/index.js` (also `bin.lisa` in `package.json`) — **not** `dist/src/cli/index.js`. Verification, plan, and doctor commands that guess a nested `dist/src/...` path fail. Always target `dist/index.js`.

### `runUi(..., { sync: false })` in tests

Pass `sync: false` whenever calling `runUi` from a test. Without it, `runUi` calls `runConfigSync` and mutates the temp/working directory under test. All unit and e2e tests use `{ port: "0", sync: false }`.

### e2e tests run under Playwright's own TS pipeline

`playwright.config.ts` defines **one** global `webServer` on a fixed port (`UI_TEST_PORT = 4783`) with `baseURL: http://127.0.0.1:4783`. That single shared server cannot host per-test probe injection. To drive real code with stubbed edges (e.g. injected probes), a spec must bypass `baseURL`: `import { runUi }`, launch a per-test server on `port: "0"`, and navigate to the absolute `http://127.0.0.1:${address.port}` URL, closing the server in a `finally`. See `tests/e2e/ui-stacks.spec.ts`.

e2e spec files are **not** type-checked by `tsc --noEmit` (root `tsconfig` `include` is `src/**`, and tests are excluded) and are ESLint-ignored (`eslint.ignore.config.json` ignores `e2e/**`). Playwright's own TypeScript pipeline is what typechecks them — do not expect the repo's `lint`/`typecheck` gates to cover changes made only inside `tests/e2e/`.

### Toggle checkboxes need `dispatchEvent("click")`

The console's toggle controls are an `opacity-0` `<input type="checkbox">` layered under a styled `.trk`/`span`. Playwright's `.click()` hits the visual layer and does not fire the input's change handler. Use `card.getByRole("checkbox").dispatchEvent("click")` — it reliably fires the handler. Reuse this for every console toggle test. (Web analog of the Maestro `opacity-0`/`testID` gaps in [[reference_maestro_ios_ax_pitfalls]].)

### `esc()` / `el()` are a text-context escaper and a raw-HTML sink

In `ui/index.html`, `esc(s)` escapes `& < > "` but **not** `'` — it is safe only for text/element content interpolated into `innerHTML`, not for attribute-value contexts (which can be broken out of with a single quote). `el(tag, cls, html)` assigns its third argument straight to `innerHTML`, so it is a raw-HTML sink: only ever pass it `esc()`-wrapped values or trusted catalog constants. If you add attribute interpolation, add an attribute-safe escaper rather than reusing `esc()`.
