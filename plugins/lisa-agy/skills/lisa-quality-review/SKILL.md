---
name: lisa-quality-review
description: "Code quality review checklist. Correctness, coding philosophy compliance, test coverage, documentation quality. Findings ranked by severity in plain English."
---

# Quality Review

Review code quality for changed files. Explain all findings in plain English as if speaking to someone with no programming background.

## Review Checklist

For each changed file, evaluate:

1. **Correctness** -- Does the code do what the task says? Logic errors, off-by-one mistakes, missing edge cases?
2. **Coding philosophy** -- Immutability patterns (no `let`, no mutations, functional transformations)? Correct function structure (variables, side effects, return)?
3. **Test coverage** -- Tests present? Testing behavior, not implementation details? Edge cases covered?
4. **Documentation** -- JSDoc on new functions explaining "why"? Preambles on new files?
5. **Code clarity** -- Readable variable names? Unnecessary complexity? Could a new team member understand this?
6. **Design source** -- For UI surfaces, does each changed file say where its design came from? Run the deterministic gate rather than judging by eye:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT:-.}/scripts/design-source-gate.mjs" --base=main --head=HEAD
   ```

   Exit 1 is a **Critical** finding under the `design-source-of-truth` rule -- the change is blocked until every UI surface either cites a Figma node (`DESIGN-SOURCE: <figma-url>`, the preferred fix -- sync it back) or carries the exception marker `DESIGN-SOURCE: none — not in Figma`. The gate fails closed: an unreadable file or an uncomputable diff is a FAIL, not a pass. Host design-system rules (`figma-design-system`, `design-system`, `use-the-design-library`, or the project's equivalent) stay authoritative about what to build; this checks only that the source is declared. If the gate script is absent, say so in the review rather than skipping silently.

   Review the same surfaces against the `design-value-binding` rule as well — it asks the orthogonal question of whether each value is *bound* to what the design system publishes, not whether the source is declared. A literal in an axis the project publishes variables for is a **Critical** finding; the identical literal in an axis with no variable collection is correct and must not be flagged. Aesthetic disagreement is never a finding under this rule. Cite the rule; do not restate its conditions here.

## Output Format

Rank findings by severity:

### Critical (must fix before merge)
Broken logic or violates hard project rules.

### Warning (should fix)
Could cause problems later or reduce maintainability.

### Suggestion (nice to have)
Minor improvements, not blocking.

## Finding Format

For each finding:

- **What** -- Plain English description, no jargon
- **Why** -- What could go wrong? Concrete examples
- **Where** -- File path and line number
- **Fix** -- Specific, actionable suggestion

### Example

> **What:** The function changes the original list instead of creating a new one.
> **Why:** Other code using that list could see unexpected changes, causing hard-to-track bugs.
> **Where:** `src/utils/transform.ts:42`
> **Fix:** Use `[...items].sort()` instead of `items.sort()` to create a copy first.

## Rules

- Run `bun run test` to confirm tests pass
- Run the task's proof command to confirm the implementation works
- Never approve code with failing tests
- If no issues found, say so clearly -- do not invent problems
