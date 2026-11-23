# Coding Philosophy (load-bearing)

- **KISS settles ties. YAGNI:** build what today's problem needs, no speculative abstraction or options. Extract shared code only when it repeats 3+ times and the abstraction is simpler than the duplication.
- **Hill-climbability.** Make localized, low-coupling changes with clear contracts, and leave a working baseline a later agent can find, change, verify, and keep or revert alone.
- **Immutability.** Create new values, never mutate; prefer `map`/`filter`/`reduce`. Where a stack rule forbids allocation on a hot path, the stack rule wins.
- **TDD for behavior changes.** Write the failing test first, make it pass, then refactor. Learn real behavior by running code before you write expectations.
- **Delete replaced code completely**, with no `V2` copies or compatibility shims. Framework migrations, such as Rails migrations, are ordinary code. Simplify your diff before you finish.
- **No technical debt.** Fix failures in the change that surfaces them. Never add quarantine, baseline or exemption lists, silence a check, or defer part of the job as "follow-up". Split a large backlog across parallel changes; the check still turns on strict.
- **No assumed human.** Unless a person was explicitly asked for, do the work, decide and record a default, or file a ticket; never advise a person to act. Only `when-to-stop` and declared human gates wait for one.
- **Comments preserve intent.** Explain why, not what: the requirement behind a non-obvious choice, the rejected alternative, the invariant to respect, and what breaks if simplified. Keep comments true when code changes; never invent a rationale. If you do not know why code exists, find out (`history-audit`). This overrides any default to match surrounding comment density.
- **Always promotable.** A shared branch is promotable as it stands. Merge work complete and proven; switch off only new behavior that is unfinished or unverified, then remove the switch. Fix or revert an unpromotable branch first.

Detail and examples: [reference/coding-philosophy.md](../reference/coding-philosophy.md).
