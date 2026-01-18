# Immutable Patterns Reference

This document provides comprehensive examples of immutable patterns used in this codebase.

## Building Lookup Objects with Reduce

### Basic Pattern

```typescript
const colorMap =
  edges?.reduce(
    (acc, edge) => (edge.color ? { ...acc, [edge.tagId]: edge.color } : acc),
    {} as Record<string, string>
  ) ?? {};
```

### With Null Safety

```typescript
const boardColorMap =
  data?.edges?.reduce(
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
  {} as Record<
    string,
    { teamId: string; teamName: string; gprSum: number; playerCount: number }
  >
);
```

### With Parallel Array Lookups (using index)

```typescript
const formattedMetricsMap = useMemo(
  () =>
    metrics.reduce(
      (acc, metric, index) => ({
        ...acc,
        [metric.displayName]: formattedMetrics[index],
      }),
      {} as Record<string, ICompositeMetric>
    ),
  [metrics, formattedMetrics]
);
```

## Record vs Map

Always prefer `Record<string, T>` over `Map<string, T>` for simple lookups.

### Record Pattern (Preferred)

```typescript
type UserNameMap = Record<string, string>;
const userNames: UserNameMap = { id1: "John Doe", id2: "Jane Smith" };

// Access
const name = userNames[userId];
const hasPlayer = playerId in playersOnKanban;
```

### Why Not Map

```typescript
// Avoid this pattern
const lookup = new Map<string, User>();
users.forEach(u => lookup.set(u.id, u));
const user = lookup.get(userId);

// Use this instead
const lookup = users.reduce(
  (acc, u) => ({ ...acc, [u.id]: u }),
  {} as Record<string, User>
);
const user = lookup[userId];
```

## Array Transformations

### Spread Before Sort

Never sort in place. Always spread first.

```typescript
// Correct
const sorted = [...Object.values(seasonData)].sort((a, b) =>
  a.season > b.season ? 1 : -1
);

// Incorrect - mutates original
const sorted = seasonData.sort((a, b) => a.season - b.season);
```

### Filter with Boolean

```typescript
const validPlayers = leaguePlayers.filter(
  Boolean
) as readonly PlayerWithScores[];
```

### Map for Transformation

```typescript
const teamGprData: readonly TeamGprData[] = Object.values(
  teamGprAccumulator
).map(team => ({
  teamId: team.teamId,
  teamName: team.teamName,
  averageGpr: team.playerCount > 0 ? team.gprSum / team.playerCount : 0,
}));
```

### Updating Array Item at Index

```typescript
// Correct - creates new array
const updated = current.map((item, idx) => (idx === target ? newItem : item));

// Incorrect - mutation
current[target] = newItem;
```

### Adding to Array

```typescript
// Correct
const withNew = [...existing, newItem];

// Incorrect
existing.push(newItem);
```

### Removing from Array

```typescript
// Correct
const without = items.filter(item => item.id !== idToRemove);

// Incorrect
const idx = items.findIndex(item => item.id === idToRemove);
items.splice(idx, 1);
```

## Object Updates

### Spread for Updates

```typescript
// Correct
const updated = { ...user, name: "New Name" };

// Incorrect
user.name = "New Name";
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

## Conditional Values Without Let

### Ternary for Simple Conditions

```typescript
// Correct
const status = isComplete ? "done" : "pending";

// Incorrect
let status = "pending";
if (isComplete) {
  status = "done";
}
```

### Ternary Chain for Multiple Conditions

```typescript
const priority = score > 90 ? "high" : score > 70 ? "medium" : "low";
```

### Nullish Coalescing

```typescript
const displayName = user.name ?? "Unknown User";
const count = existing?.count ?? 0;
```

### Optional Chaining with Nullish Coalescing

```typescript
const firstName =
  user.cognitoUser?.Attributes?.find(attr => attr.Name === "given_name")
    ?.Value ?? "";
```

## Apollo Reactive Variables

### Immutable Updates

```typescript
// Direct update for simple values
isLoadingVar(true);
errorVar("Error message");

// Spread for array updates
messagesVar([...messagesVar(), newMessage]);

// Spread for complex updates
const current = messagesVar();
messagesVar([...current, newMessage]);
```

### Operation Hooks for Complex Updates

```typescript
export const useMessageOperations = () => {
  const addMessage = useCallback((message: IMessage) => {
    const current = messagesVar();
    messagesVar([...current, message]);
  }, []);

  const clearMessages = useCallback(() => {
    messagesVar([]);
  }, []);

  return { addMessage, clearMessages };
};
```

## Readonly Types

### Function Parameters

```typescript
export const calculateTeamGprRank = (
  leaguePlayers: readonly (PlayerWithScores | null | undefined)[],
  myTeamId: string | null | undefined
): number | null => {
  // ...
};
```

### Apollo Cache Modifiers

```typescript
modify({
  fields: {
    myField(existingData: readonly { __ref: string }[] = [], { readField }) {
      return existingData.filter(ref => readField("id", ref) !== idToRemove);
    },
  },
});
```

## Testing Immutability

### Verify New Object Creation

```typescript
test("should create new object on each reduce iteration", () => {
  expect(result1).not.toBe(result2); // Different references
  expect(result1).toEqual(result2); // Same values
});
```

### Verify Record vs Map

```typescript
test("should return plain object, not Map", () => {
  expect(result).toBeInstanceOf(Object);
  expect(result).not.toBeInstanceOf(Map);
});
```
