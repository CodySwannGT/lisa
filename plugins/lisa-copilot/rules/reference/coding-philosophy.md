# Coding Philosophy

This rule enforces the core coding philosophy: **immutability**, **predictable structure**, **functional transformations**, **test-driven development**, **clean deletion**, and **simplicity**.

## Guiding Principles: YAGNI + SOLID + DRY + KISS

Follow these software engineering principles, **deferring to Occam's Razor/KISS whenever principles conflict**:

### KISS (Keep It Simple, Stupid) - The Tiebreaker

When principles conflict, **always choose the simpler solution**.

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

### SOLID Principles - Applied Pragmatically

| Principle                 | Apply When                                    | Skip When                               |
| ------------------------- | --------------------------------------------- | --------------------------------------- |
| **S**ingle Responsibility | Function does 2+ unrelated things             | Splitting adds complexity               |
| **O**pen/Closed           | Extension points have clear use cases         | No foreseeable extensions               |
| **L**iskov Substitution   | Using inheritance hierarchies                 | Using composition (preferred)           |
| **I**nterface Segregation | Consumers need different subsets              | Interface is already small              |
| **D**ependency Inversion  | Testing requires mocking external services    | Direct dependency is simpler            |

### Decision Framework

When unsure, ask in order:
1. **Do I need this now?** (YAGNI) - If no, don't build it
2. **Is there a simpler way?** (KISS) - Choose the simpler option
3. **Am I repeating myself 3+ times?** (DRY) - Extract if the abstraction is simpler
4. **Does this function do one thing?** (SOLID-SRP) - Split only if clearer

---

## Core Principles

### 1. Immutability First

Never mutate data. Always create new references.

**Hot-path exception.** Where a stack rule forbids allocation on a measured hot path — a Phaser `update()` loop, a render loop, a tight numeric kernel — the stack rule wins: reuse pooled objects and plain loops there, and keep the immutable style everywhere else.

```typescript
// Correct - spread creates new object
const updated = { ...user, name: "New Name" };

// Incorrect - mutation
user.name = "New Name";
```

### 2. Function Structure Ordering

All functions, hooks, and components follow a strict ordering:

```text
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

**Write failing tests before implementation code for every behavior change.** Documentation, configuration, and pure refactors already covered by tests do not need a new failing test.

```text
TDD Cycle:
1. RED: Write a failing test that defines expected behavior
2. GREEN: Write the minimum code to make the test pass
3. REFACTOR: Clean up while keeping tests green
```

### 5. Clean Deletion

**Delete old code completely.** No deprecation warnings, migration shims, or backward-compatibility layers unless explicitly requested. Schema and data migrations a framework requires (Rails migrations, database migrations) are ordinary code, not shims.

```typescript
// Correct: Remove the old code entirely
const calculateScore = (player: Player): number => player.stats.overall;

// Wrong: Keeping deprecated versions around
/** @deprecated Use calculateScore instead */
const getPlayerScore = (player: Player): number => calculateScore(player);
```

**Clean deletion rules:**
- When replacing code, delete the old version completely
- Never create `V2`, `New`, or `Old` suffixed functions/variables
- Never add `@deprecated` comments - just remove the code
- Never write migration code unless explicitly asked
- Trust git history for recovery if needed

### 6. No Technical Debt

**Fix failures in the change that surfaces them.** Turning on a lint rule, type check, coverage floor or any other check often reveals failures that already exist. Fix them. Do not exempt them.

An exemption list only grows. Once a quarantine file exists, every hard case gets added to it rather than fixed, and nobody remembers why each entry is there. It hides exactly the failures the check exists to catch, so the check reports green while the code it covers drifts. One repository's test type-check quarantine grew to 311 files hiding 1,403 errors before anyone looked.

```text
Wrong: turn the check on and record today's failures as allowed
  typecheck-quarantine.json  ->  ["tests/a.test.ts", "tests/b.test.ts", ...]

Right: fix every failure, then turn the check on with nothing exempted
```

**No-technical-debt rules:**
- Never add quarantine, baseline, exemption, grandfather or "known failures" lists that let existing failures pass a check
- Never silence a check: no `@ts-ignore`, `eslint-disable`, `any`, loosened compiler or linter config, lowered coverage thresholds, or skipped tests to get green
- Never defer part of the requested job as "follow-up" or "known gap". Finish it, or say plainly that it is not done and why
- If the backlog is too large for one change, split the fix into parallel changes and land them together. The check still turns on strict, with nothing exempted
- An existing exemption list is debt to pay off: fix its entries and delete the list and the code that reads it

### 7. No Assumed Human

**No one is inside the factory.** Lisa's factories run unattended, and humans stand only at the gates outside them (`factory-model`). Unless a person was explicitly asked for, requiring one is a failure: there is nobody to read "you'll want to review this", so the work either stalls or is silently dropped. Do the work, or turn it into work the factory picks up.

Advice to an absent person is the same failure in a softer form. A report, PR or comment that ends in a to-do for "someone" hands the job to nobody.

```text
Wrong: "You'll want to manually check the migration on staging."
Right: run the migration on staging, check it, and attach the evidence.

Wrong: "Have someone confirm the Epic this belongs under."
Right: pick the Epic the evidence fits best, or create one, and record why on the item.

Wrong: "Consider reviewing the other call sites for the same bug."
Right: fix the call sites this change touches, and file one build-ready ticket for the rest.

Wrong: "Stop and ask the user to create the missing tracker label."
Right: create the label. Stop only if the tracker refuses for lack of permission, and name that permission.
```

**When you would normally ask:**
- A choice with a reasonable default is yours. Decide it and record it on the item as a `Decision:` line, where a person can reverse it later
- Work outside this change's scope becomes one build-ready ticket through the tracker, not a suggestion in a report
- A material question that the code, tracker, wiki, git history and standing decisions cannot answer, and that has no reasonable default, goes back through the gate: the flow's blocked exit with a specific clarifying comment and your recommended answer, not a mid-session question

**The gates that legitimately wait for a person.** This list only restates two sources and must match them: [`when-to-stop`](../eager/when-to-stop.md) (when a flow stops) and [`ready-role-filing`, "What a human gate is"](ready-role-filing.md) (which acts a held item may wait on). Where this summary and those two differ, they win; fix this list. Name the gate when you stop at one:
- **Missing access** — a repository, secret, API or tool stays out of reach after `lisa-secrets-access` and the matching `*-access` probe; a login or credential only a person holds; a system the agent cannot reach. Say exactly what is missing and stop (`when-to-stop`, `tool-access-gate`)
- **A destructive, irreversible or protected operation** (`when-to-stop`), including protected deployments and other approvals only a person's account can give
- **Spending money** — a paid plan, a purchase, an upgrade — and **opening an external account**
- **Signing a legal agreement** — a contract, BAA, DPA or license acceptance. A compliance *judgement* is not this gate: it is the agent's decision unless the project declares it human-only
- **Declared human gates and operator holds** — a leaf filed with `human_gate`, a decision class in `humanGate.humanOnly`, a stricter `humanGate.mode`, an operator's hold label, or an option a project turned on such as `dependencies.humanSignOff`
- **Human-authored-only surfaces** — `PROJECT_RULES.md`, and the human-gated tickets the learnings gardener files for promotions
- **A product question with no reasonable default** that nothing in the item, wiki, code or standing decisions settles (`when-to-stop`), raised through the gate rather than mid-session
- **`/lisa:agent-ready` gap questions** in `wiki/gaps.md`, which exist to collect what only a person knows
- **An explicit request** — the operator asked for a person, or invoked an interactive setup skill (`/lisa:setup:*`) and is answering its prompts

This does not conflict with writing for a non-technical reader (`communication`). That rule is about who reads a report, not about giving them to-dos.

---

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

---

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

---

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

---

## Immutable Patterns Reference

### Building Lookup Objects with Reduce

```typescript
const colorMap =
  edges?.reduce(
    (acc, edge) => (edge.color ? { ...acc, [edge.tagId]: edge.color } : acc),
    {} as Record<string, string>
  ) ?? {};
```

### Accumulating Multiple Properties

```typescript
const teamGprAccumulator = validPlayers.reduce(
  (acc, player) => {
    const teamId = player.team?.id;
    if (!teamId) return acc;

    const existing = acc[teamId];
    return {
      ...acc,
      [teamId]: {
        teamId,
        teamName: player.team.name,
        gprSum: (existing?.gprSum ?? 0) + player.gpr,
        playerCount: (existing?.playerCount ?? 0) + 1,
      },
    };
  },
  {} as Record<string, { teamId: string; teamName: string; gprSum: number; playerCount: number }>
);
```

### Nested Object Updates

```typescript
const updated = {
  ...state,
  user: {
    ...state.user,
    profile: {
      ...state.user.profile,
      avatar: newAvatar,
    },
  },
};
```

### Conditional Property Addition

```typescript
const result = {
  ...baseObj,
  ...(condition && { optionalProp: value }),
};
```

### Ternary Chain for Multiple Conditions

```typescript
const priority = score > 90 ? "high" : score > 70 ? "medium" : "low";
```

### Readonly Types for Function Parameters

```typescript
export const calculateTeamGprRank = (
  leaguePlayers: readonly (PlayerWithScores | null | undefined)[],
  myTeamId: string | null | undefined
): number | null => {
  // ...
};
```

## Optimize for Hill-Climbability

Write code that supports rapid, incremental, verifiable improvement. Favor localized changes, clear contracts, low coupling, and fast feedback loops. Each implementation should establish a working baseline that can be improved without significant restructuring.

Avoid premature abstraction and speculative generalization. Prefer simple, understandable implementations with obvious opportunities for refinement.

Structure the code so future agents can easily identify what to change, make a targeted modification, verify its effect, and retain or revert the change independently.

## Code-Level Intent Preservation

Write comments and docstrings that preserve engineering intent, not merely implementation details.

Code should generally explain **what** happens. Comments and docstrings should explain **why it happens that way**, especially when the reasoning is not obvious from the implementation.

When adding, modifying, or removing code:

- **Explain intent:** Document the underlying requirement, problem, or objective driving non-obvious implementation decisions.
- **Preserve rationale:** Explain why a particular approach was chosen, especially when a simpler or more obvious alternative might appear preferable.
- **Capture constraints:** Identify important invariants, assumptions, edge cases, and dependencies that future modifications must respect.
- **Document negative knowledge:** Explain deliberate omissions, rejected approaches, and seemingly unnecessary complexity that actually serves an important purpose.
- **Protect against regressions:** Where useful, describe what could go wrong if the implementation were simplified, replaced, or removed.
- **Keep documentation synchronized:** Update or remove comments and docstrings whenever the behavior, assumptions, or underlying intent changes.

### Documentation guidelines

- Favor explanations of *why* over descriptions of *what*.
- Document contracts, invariants, and side effects in function or class docstrings when they are not evident from signatures and types.
- Place implementation rationale as close as practical to the code it governs.
- Avoid comments that simply narrate operations already obvious from reading the code.
- Do not document every change indiscriminately. Focus on decisions whose rationale would otherwise be lost.
- Do not use comments as a historical changelog. Preserve enduring intent rather than a chronology of edits.
- Never invent rationale. If the reason for an existing implementation is unknown, investigate rather than speculate.

**Why this overrides "match the surrounding comment density".** Coding agents default to matching the comment style already in a file. Lisa's codebases are maintained by future agents with no memory of today's session, so a reason that is not written down is a reason that must be rediscovered — or, worse, a guard that gets "simplified" away. The goal is for future coding agents to understand not just what the code does, but why it was written that way, what constraints it protects, and what must remain true when improving it.
