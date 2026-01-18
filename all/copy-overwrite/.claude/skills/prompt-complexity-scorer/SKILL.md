---
name: prompt-complexity-scorer
description: Evaluates user prompts for effort and complexity on a 1-10 scale. This skill should be invoked on every user request to determine if the request warrants planning via a spec file. For scores 5-10, the agent suggests writing the prompt to specs/<spec-name>.md for proper planning.
model: haiku
---

# Prompt Complexity Scorer

This skill evaluates user prompts to determine if they require planning before implementation.

## Scoring Criteria

Score each prompt on a 1-10 scale based on these factors:

| Factor | Low (1-3) | Medium (4-6) | High (7-10) |
|--------|-----------|--------------|-------------|
| **Scope** | Single file/function | Multiple files/module | Multiple systems/services |
| **Clarity** | Specific, well-defined | Some ambiguity | Vague, open-ended |
| **Dependencies** | None or obvious | Some coordination | Multiple unknown deps |
| **Unknowns** | None | Some research needed | Significant discovery |
| **Risk** | Low/reversible | Moderate | High/architectural |

### Score Calculation

1. Evaluate each factor independently
2. Average the factor scores
3. Round to nearest integer

## Behavior by Score

### Score 1-4: Continue Normally

Do not mention the scoring. Proceed with the request immediately.

### Score 5-10: Suggest Spec

Pause and ask the user:

```text
This request scores [X]/10 on complexity. I suggest writing it as a spec to plan it out properly.

Would you like me to create `specs/<suggested-name>.md`?
```

Where `<suggested-name>` is a kebab-case name derived from the request (e.g., "add-websockets", "refactor-auth-system").

## Spec File Format

When creating a spec file, capture ONLY the user's original prompt:

```markdown
# <Title derived from prompt>

## Original Request

<User's exact prompt/request>
```

## Examples

### Example 1: Simple Request (Score 1)

**Prompt**: "Fix the typo in the error message on line 45 of user.service.ts"

**Factors**:
- Scope: 1 (single line)
- Clarity: 1 (exact location specified)
- Dependencies: 1 (none)
- Unknowns: 1 (none)
- Risk: 1 (trivial change)

**Score**: 1 → Continue normally

### Example 2: Complex Request (Score 7)

**Prompt**: "Add WebSocket support to this project"

**Factors**:
- Scope: 8 (new system, multiple files)
- Clarity: 6 (what kind of WebSocket? real-time features?)
- Dependencies: 7 (infrastructure, client changes)
- Unknowns: 7 (architecture decisions needed)
- Risk: 7 (architectural change)

**Score**: 7 → Suggest creating `specs/add-websockets.md`

### Example 3: Medium Request (Score 3)

**Prompt**: "Add a new field 'nickname' to the User entity"

**Factors**:
- Scope: 4 (entity, migration, possibly resolvers)
- Clarity: 2 (clear requirement)
- Dependencies: 3 (migration, schema)
- Unknowns: 2 (standard pattern)
- Risk: 3 (database change but reversible)

**Score**: 3 → Continue normally

### Example 4: Nebulous Request (Score 8)

**Prompt**: "Make the app faster"

**Factors**:
- Scope: 9 (entire application)
- Clarity: 9 (completely vague)
- Dependencies: 8 (unknown until investigated)
- Unknowns: 9 (what's slow? why?)
- Risk: 6 (depends on changes)

**Score**: 8 → Suggest creating `specs/performance-optimization.md`

## Important Notes

- This evaluation should be quick and silent for low-complexity requests
- Never mention the scoring system for scores 1-4
- For borderline cases (score 4-5), lean toward continuing normally
- The goal is to catch truly complex/nebulous requests that benefit from planning
