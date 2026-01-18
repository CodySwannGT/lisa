---
name: coding-philosophy
description: Enforces immutable coding principles, function structure ordering, functional programming patterns, TDD, clean deletion, and YAGNI+SOLID+DRY+KISS principles for this codebase. This skill should be used when writing or reviewing TypeScript/React code in this project, particularly when creating hooks, utility functions, or components. Use this skill to ensure code follows the established patterns for immutability, proper ordering of statements, functional transformations, test-driven development, and simplicity (preferring Occam's Razor/KISS when principles conflict).
---

# Coding Philosophy

## Overview

This skill enforces the core coding philosophy for this project: **immutability**, **predictable structure**, **functional transformations**, **test-driven development**, **clean deletion**, and **simplicity**. All code should follow these principles to maintain consistency, testability, and clarity.

## Guiding Principles: YAGNI + SOLID + DRY + KISS

Follow these software engineering principles, **deferring to Occam's Razor/KISS whenever principles conflict**:

### KISS (Keep It Simple, Stupid) - The Tiebreaker

When principles conflict, **always choose the simpler solution**. Occam's Razor applies to code: the simplest solution that works is usually correct.

```typescript
// KISS: Simple direct approach
const isAdmin = user.role === "admin";

// Over-engineered: Abstraction without value
const isAdmin = RoleChecker.getInstance().checkRole(user, RoleTypes.ADMIN);
```

### YAGNI (You Ain't Gonna Need It)

Don't build features, abstractions, or flexibility you don't need **right now**.

```typescript
// Correct: Solve today's problem
const formatDate = (date: Date) => date.toISOString().split("T")[0];

// Wrong: Building for hypothetical future needs
const formatDate = (date: Date, format?: string, locale?: string, timezone?: string) => {
  // 50 lines handling cases that may never be used
};
```

### DRY (Don't Repeat Yourself) - With KISS Constraint

Extract duplication only when:
1. The same logic appears **3+ times**
2. The abstraction is **simpler** than the duplication
3. The extracted code has a **clear single purpose**

```typescript
// DRY + KISS: Extract when clearly beneficial
const formatPlayerName = (first: string, last: string) => `${first} ${last}`;

// Anti-pattern: Premature abstraction for 2 usages
// Keep inline if simpler and only used twice
```

### SOLID Principles - Applied Pragmatically

Apply SOLID when it **reduces complexity**, not dogmatically:

| Principle                 | Apply When                                    | Skip When                               |
| ------------------------- | --------------------------------------------- | --------------------------------------- |
| **S**ingle Responsibility | Function does 2+ unrelated things             | Splitting adds complexity               |
| **O**pen/Closed           | Extension points have clear use cases         | No foreseeable extensions               |
| **L**iskov Substitution   | Using inheritance hierarchies                 | Using composition (preferred)           |
| **I**nterface Segregation | Consumers need different subsets              | Interface is already small              |
| **D**ependency Inversion  | Testing requires mocking external services    | Direct dependency is simpler            |

```typescript
// Good SRP: Each function has one job
const validateEmail = (email: string) => EMAIL_REGEX.test(email);
const formatEmail = (email: string) => email.toLowerCase().trim();

// Over-applied SRP: Don't split a simple 3-line function into 3 files
```

### Decision Framework

When unsure, ask in order:
1. **Do I need this now?** (YAGNI) → If no, don't build it
2. **Is there a simpler way?** (KISS) → Choose the simpler option
3. **Am I repeating myself 3+ times?** (DRY) → Extract if the abstraction is simpler
4. **Does this function do one thing?** (SOLID-SRP) → Split only if clearer

## Core Principles

### 1. Immutability First

Never mutate data. Always create new references.

```typescript
// Correct - spread creates new object
const updated = { ...user, name: "New Name" };

// Incorrect - mutation
user.name = "New Name";
```

### 2. Function Structure Ordering

All functions, hooks, and components follow a strict ordering:

```
1. Variable definitions and derived state (const, useState, useMemo, useCallback)
2. Side effects (useEffect, function calls with no return value)
3. Return statement
```

### 3. Functional Transformations

Use `map`, `filter`, `reduce` instead of imperative loops and mutations.

```typescript
// Correct - functional transformation
const names = users.map(u => u.name);

// Incorrect - imperative mutation
const names = [];
users.forEach(u => names.push(u.name));
```

### 4. Test-Driven Development (TDD)

**Always write failing tests before implementation code.** This is mandatory, not optional.

```
TDD Cycle:
1. RED: Write a failing test that defines expected behavior
2. GREEN: Write the minimum code to make the test pass
3. REFACTOR: Clean up while keeping tests green
```

```typescript
// Step 1: Write the failing test FIRST
describe("formatPlayerName", () => {
  it("should format first and last name", () => {
    expect(formatPlayerName("John", "Doe")).toBe("John Doe");
  });

  it("should handle empty last name", () => {
    expect(formatPlayerName("John", "")).toBe("John");
  });
});

// Step 2: THEN write implementation to make tests pass
const formatPlayerName = (first: string, last: string): string =>
  last ? `${first} ${last}` : first;
```

**TDD is non-negotiable because it:**
- Forces you to think about the API before implementation
- Ensures every feature has test coverage
- Prevents over-engineering (you only write what's needed to pass tests)
- Documents expected behavior

### 5. Clean Deletion

**Delete old code completely.** No deprecation warnings, migration shims, or backward-compatibility layers unless explicitly requested.

```typescript
// Correct: Remove the old code entirely
// (Old function is gone, new function exists)
const calculateScore = (player: Player): number => player.stats.overall;

// Wrong: Keeping deprecated versions around
/** @deprecated Use calculateScore instead */
const getPlayerScore = (player: Player): number => calculateScore(player);
const calculateScoreV2 = (player: Player): number => player.stats.overall;
```

**Clean deletion rules:**
- When replacing code, delete the old version completely
- Never create `V2`, `New`, or `Old` suffixed functions/variables
- Never add `@deprecated` comments - just remove the code
- Never write migration code unless explicitly asked
- Trust git history for recovery if needed

**Why clean deletion:**
- Reduces cognitive load (one way to do things)
- Prevents confusion about which version to use
- Keeps bundle size small
- YAGNI: If no one is using it, delete it

## Detailed Guidelines

For comprehensive examples and patterns, see the reference files:

- **[references/immutable-patterns.md](references/immutable-patterns.md)** - Detailed immutable patterns with reduce, spread, and functional transformations
- **[references/function-structure.md](references/function-structure.md)** - Function ordering rules and examples for hooks, utilities, and components

## Quick Reference

### Variable Declaration

| Pattern | Status    | Example                       |
| ------- | --------- | ----------------------------- |
| `const` | Required  | `const value = calculate();`  |
| `let`   | Forbidden | Use ternary or reduce instead |
| `var`   | Forbidden | Never use                     |

### Array Operations

| Instead of              | Use                                          |
| ----------------------- | -------------------------------------------- |
| `arr.push(item)`        | `[...arr, item]`                             |
| `arr.pop()`             | `arr.slice(0, -1)`                           |
| `arr.splice(i, 1)`      | `arr.filter((_, idx) => idx !== i)`          |
| `arr.sort()`            | `[...arr].sort()`                            |
| `arr[i] = value`        | `arr.map((v, idx) => idx === i ? value : v)` |
| `forEach` with mutation | `reduce` or `map`                            |

### Object Operations

| Instead of                | Use                           |
| ------------------------- | ----------------------------- |
| `obj.key = value`         | `{ ...obj, key: value }`      |
| `delete obj.key`          | `({ key: _, ...rest } = obj)` |
| `Object.assign(obj, ...)` | `{ ...obj, ...other }`        |

### Building Lookup Objects

```typescript
// Correct - reduce with spread
const lookup = items.reduce(
  (acc, item) => ({ ...acc, [item.id]: item }),
  {} as Record<string, Item>
);

// Incorrect - forEach with Map.set
const lookup = new Map();
items.forEach(item => lookup.set(item.id, item));
```

### Conditional Values

```typescript
// Correct - ternary expression
const status = isComplete ? "done" : "pending";

// Incorrect - let with reassignment
let status = "pending";
if (isComplete) {
  status = "done";
}
```

## Hook Structure Example

```typescript
export const usePlayerData = (playerId: string) => {
  // 1. VARIABLES & STATE (first)
  const [isLoading, setIsLoading] = useState(true);
  const { data } = useQuery(GetPlayerDocument, { variables: { playerId } });

  const playerName = useMemo(() => data?.player?.name ?? "Unknown", [data]);

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  // 2. SIDE EFFECTS (second)
  useEffect(() => {
    console.log("Player loaded:", playerName);
  }, [playerName]);

  // 3. RETURN (last)
  return { playerName, isLoading, handleRefresh };
};
```

## Container Component Example

```typescript
const PlayerCardContainer: React.FC<Props> = ({ playerId }) => {
  // 1. VARIABLES & STATE
  const { data, loading } = useQuery(GetPlayerDocument, { variables: { playerId } });
  const { colors } = useTheme();

  const formattedStats = useMemo(
    () => data?.stats?.map(s => ({ ...s, display: formatStat(s) })) ?? [],
    [data?.stats]
  );

  const handlePress = useCallback(() => {
    router.push(`/players/${playerId}`);
  }, [playerId]);

  // 2. SIDE EFFECTS (none in this example)

  // 3. RETURN
  return (
    <PlayerCardView
      stats={formattedStats}
      colors={colors}
      loading={loading}
      onPress={handlePress}
    />
  );
};
```

## Utility Function Example

```typescript
export const calculateTeamRankings = (
  players: readonly Player[]
): readonly TeamRanking[] => {
  // 1. VARIABLES & DERIVED VALUES
  const validPlayers = players.filter(p => p.team && p.score != null);

  const teamScores = validPlayers.reduce(
    (acc, player) => ({
      ...acc,
      [player.team.id]: {
        teamId: player.team.id,
        totalScore: (acc[player.team.id]?.totalScore ?? 0) + player.score,
        count: (acc[player.team.id]?.count ?? 0) + 1,
      },
    }),
    {} as Record<string, { teamId: string; totalScore: number; count: number }>
  );

  const rankings = Object.values(teamScores).map(t => ({
    teamId: t.teamId,
    avgScore: t.totalScore / t.count,
  }));

  const sorted = [...rankings].sort((a, b) => b.avgScore - a.avgScore);

  // 2. NO SIDE EFFECTS IN PURE FUNCTIONS

  // 3. RETURN
  return sorted;
};
```

## Anti-Patterns to Avoid

### Never use `let` for conditional assignment

```typescript
// Wrong
let result;
if (condition) {
  result = valueA;
} else {
  result = valueB;
}

// Correct
const result = condition ? valueA : valueB;
```

### Never mutate arrays

```typescript
// Wrong
const items = [];
data.forEach(d => items.push(transform(d)));

// Correct
const items = data.map(d => transform(d));
```

### Never use Map when Record suffices

```typescript
// Wrong
const lookup = new Map<string, User>();
users.forEach(u => lookup.set(u.id, u));
const user = lookup.get(userId);

// Correct
const lookup = users.reduce(
  (acc, u) => ({ ...acc, [u.id]: u }),
  {} as Record<string, User>
);
const user = lookup[userId];
```

### Never sort in place

```typescript
// Wrong - mutates original
const sorted = items.sort((a, b) => a.value - b.value);

// Correct - creates new array
const sorted = [...items].sort((a, b) => a.value - b.value);
```

### Never place useEffect before variable definitions

```typescript
// Wrong
useEffect(() => {
  /* ... */
}, [value]);
const value = useMemo(() => calculate(), [dep]);

// Correct
const value = useMemo(() => calculate(), [dep]);
useEffect(() => {
  /* ... */
}, [value]);
```
