# Project Rules

Project-specific rules and guidelines that apply to this codebase.

Rules in `.claude/rules/` are automatically loaded by Claude Code at session start.
Add project-specific patterns, conventions, and requirements below.

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

Never parse JSON in shell scripts using grep/sed/cut/awk - always use jq for robust JSON handling.

When creating Claude Code hooks for enforcement (linting, code quality, static analysis), always use blocking behavior (exit 1 on failures) so Claude receives feedback and can fix the errors. Notification-only hooks (like ntfy.sh) should exit 0 since they don't require Claude to take action.

## Skills and Commands

Skills and commands serve different roles in Claude Code:

- **Skills** (`.claude/skills/<name>/SKILL.md`): Contain implementation logic. Use hyphen-separated naming (e.g., `plan-create`, `git-commit`). Skills do NOT support `argument-hint` or `$ARGUMENTS` substitution.
- **Commands** (`.claude/commands/<namespace>/<name>.md`): User-facing interface with `argument-hint` and `$ARGUMENTS` support. Directory nesting creates colon-separated names in the UI (e.g., `plan/create.md` becomes `/plan:create`). Commands pass through to skills.

Every skill should have a corresponding command that acts as a pass-through. The command provides the user-facing description, argument hints, and delegates to the skill via "Use the /<skill-name> skill... $ARGUMENTS".

Skills can invoke other skills via the Skill tool, enabling skill chaining and composition. Internal skill-to-skill references use hyphen names (e.g., `/git-commit`).

Lisa-specific skills (like `lisa-integration-test`, `lisa-learn`, `lisa-review-project`) should only exist in the root `.claude/skills/` and `.claude/commands/` directories, NOT in `all/copy-overwrite/`, since they are only relevant to the Lisa repository itself, not downstream projects.

## Task Metadata

When creating tasks, do not include `/coding-philosophy` in the `skills` array of task metadata. The coding philosophy is auto-loaded as a rule via `.claude/rules/coding-philosophy.md` and does not need to be explicitly invoked.

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

Example from generator pattern:

```typescript
/* eslint-disable functional/no-let -- generator requires mutable state for iterative Fibonacci computation */
let a = 0n;
let b = 1n;
/* eslint-enable functional/no-let -- re-enable after generator state declarations */
```

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
