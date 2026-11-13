# Coding Philosophy (load-bearing)

- **KISS settles ties. YAGNI:** build what today's problem needs, with no speculative abstraction or options. Extract shared code only when it repeats three or more times and the abstraction is simpler than the duplication.
- **Hill-climbability.** Make localized changes with clear contracts and low coupling, and leave a working baseline. A later agent should be able to find what to change, change it, verify the effect, and keep or revert it on its own.
- **Immutability.** Create new values instead of mutating, and prefer `map`/`filter`/`reduce`. On a hot path where a stack rule forbids allocation, such as a game's `update()`, the stack rule wins.
- **TDD for behavior changes.** Write the failing test first, make it pass, then refactor. Learn real behavior by running code before you write expectations.
- **Delete replaced code completely**, with no `V2` copies or compatibility shims. Framework migrations, such as Rails migrations, are ordinary code. Simplify your diff before you finish.
- **Comments preserve intent.** Explain why, not what: the requirement behind a non-obvious choice, the rejected alternative, the invariant a change must respect, and what breaks if someone simplifies it. Keep comments true when code changes, and do not invent a rationale. If you do not know why code exists, find out (`history-audit`). This overrides any default to match the surrounding comment density, because future agents keep no memory of today.

Examples, documentation guidelines, and anti-patterns: [reference/coding-philosophy.md](../reference/coding-philosophy.md).
