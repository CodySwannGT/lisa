---
name: block-suppression-directives
enabled: true
event: file
action: block
pattern: "(//|/\\*)\\s*(@ts-(ignore|nocheck)|eslint-disable|biome-ignore|prettier-ignore)"
---

🚫 **Error-suppression directive detected**

You're adding a `@ts-ignore`, `@ts-nocheck`, or `eslint-disable` directive. These silence the type checker or linter instead of fixing the underlying problem, which is not allowed unless there is genuinely no other way around it.

**Do this first:**
- Fix the actual type or lint error rather than suppressing it.
- Narrow types, add the missing annotation, or restructure the code so the rule passes legitimately.
- If a dependency's types are wrong, prefer a typed wrapper or module augmentation over a blanket suppression.

**Suppression is a last resort.** If — and only if — you have confirmed there is no other way (e.g. a known upstream bug, an unavoidable third-party type defect), then:
- Prefer `@ts-expect-error` over `@ts-ignore` (it fails if the error ever goes away).
- Scope `eslint-disable` to a single line and a single rule (`eslint-disable-next-line <rule>`), never a whole file.
- Add a `-- <reason>` description explaining why it's unavoidable (required by this project's `eslint-comments/require-description` rule).

Re-attempt only after you've exhausted a real fix and can justify the suppression.
