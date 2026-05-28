# Coding Philosophy (load-bearing)

When writing or modifying code, follow these principles. Examples, hook structure templates, and anti-pattern catalogs live in [reference/coding-philosophy.md](../reference/coding-philosophy.md).

## Principle priority

**KISS is the tiebreaker.** When principles conflict, choose the simpler solution.

1. **YAGNI** — Don't build features, abstractions, or flexibility you don't need right now. Solve today's problem.
2. **KISS** — Choose the simpler option.
3. **DRY** — Extract only when (a) the same logic appears 3+ times, (b) the abstraction is simpler than the duplication, and (c) the extracted code has a clear single purpose.
4. **SOLID** — Apply pragmatically. Split a function only when it does 2+ unrelated things AND splitting reduces complexity. Use composition over inheritance.

## Mandatory practices

- **Immutability first.** Never mutate. Spread/clone to create new references.
- **TDD is mandatory.** Write the failing test BEFORE the implementation. Red → Green → Refactor.
- **Function structure order**: (1) variables & derived state, (2) side effects, (3) return. Never interleave.
- **Functional transformations.** Prefer `map`/`filter`/`reduce` over imperative loops with mutation.
- **Clean deletion.** When replacing code, delete the old version completely. No `V2`/`Old`/`New` suffixes, no `@deprecated` comments, no migration shims unless explicitly requested. Trust git history.

## What NOT to write

- Comments that explain WHAT the code does (well-named identifiers do that).
- Error handling, fallbacks, or validation for scenarios that can't happen.
- Backwards-compatibility shims, feature flags, or unused `_var` renames when you can just change the code.
- Half-finished implementations, placeholders, or TODOs.
