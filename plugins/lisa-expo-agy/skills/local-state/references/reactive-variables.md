# Reactive Variables Reference

## Overview

Reactive variables are Apollo Client 3's mechanism for managing local state outside the GraphQL cache. They enable seamless reactivity without requiring GraphQL syntax and can store any data type.

## Creating Reactive Variables

### Basic Types

```typescript
import { makeVar } from "@apollo/client";

// Boolean
export const isLoadingVar = makeVar<boolean>(false);

// String
export const selectedIdVar = makeVar<string | null>(null);

// Number
export const countVar = makeVar<number>(0);
```

### Complex Types

```typescript
// Interface-based object
interface IFilterValues {
  readonly minAge: number;
  readonly maxAge: number;
  readonly positions: readonly string[];
}

const DEFAULT_FILTERS: IFilterValues = {
  minAge: 18,
  maxAge: 40,
  positions: [],
};

export const filterValuesVar = makeVar<IFilterValues>(DEFAULT_FILTERS);
```

### Record Types for Lookups

```typescript
// Key-value lookup
export const selectedPlayersVar = makeVar<Record<string, boolean>>({});

// Complex value lookup
interface PlayerNote {
  readonly playerId: string;
  readonly note: string;
  readonly updatedAt: string;
}

export const playerNotesVar = makeVar<Record<string, PlayerNote>>({});
```

### Array Types

```typescript
interface Todo {
  readonly id: string;
  readonly text: string;
  readonly completed: boolean;
}

type Todos = readonly Todo[];

export const todosVar = makeVar<Todos>([]);
```

## Reading Values

### Direct Read (Non-Reactive)

Call without arguments to read current value. Does NOT trigger component re-renders:

```typescript
const currentFilters = filterValuesVar();
const selectedPlayers = selectedPlayersVar();
```

Use for:

- Event handlers
- Utility functions
- Async operations
- Conditional logic outside JSX

### Reactive Read with Hook

Use `useReactiveVar` for components that should re-render on changes:

```typescript
import { useReactiveVar } from "@apollo/client";

const FilterDisplay = () => {
  const filters = useReactiveVar(filterValuesVar);

  return (
    <View>
      <Text>Age: {filters.minAge} - {filters.maxAge}</Text>
      <Text>Positions: {filters.positions.join(", ")}</Text>
    </View>
  );
};
```

## Updating Values

### Object Updates

Always create new object references:

```typescript
// Single field update
filterValuesVar({
  ...filterValuesVar(),
  minAge: 21,
});

// Multiple field update
filterValuesVar({
  ...filterValuesVar(),
  minAge: 21,
  maxAge: 35,
});

// Nested object update
settingsVar({
  ...settingsVar(),
  display: {
    ...settingsVar().display,
    showGrid: true,
  },
});
```

### Array Updates

```typescript
// Add item
todosVar([
  ...todosVar(),
  { id: crypto.randomUUID(), text: "New todo", completed: false },
]);

// Remove item
todosVar(todosVar().filter(todo => todo.id !== idToRemove));

// Update item
todosVar(
  todosVar().map(todo =>
    todo.id === idToUpdate ? { ...todo, completed: true } : todo
  )
);

// Clear all
todosVar([]);
```

### Record Updates

```typescript
// Add/update entry
selectedPlayersVar({
  ...selectedPlayersVar(),
  [playerId]: true,
});

// Remove entry (using destructuring)
const { [playerIdToRemove]: _, ...remaining } = selectedPlayersVar();
selectedPlayersVar(remaining);

// Toggle entry
const current = selectedPlayersVar();
selectedPlayersVar({
  ...current,
  [playerId]: !current[playerId],
});
```

## Custom Hooks Pattern

Encapsulate reactive variable logic in custom hooks for better testability:

```typescript
import { makeVar, ReactiveVar, useReactiveVar } from "@apollo/client";
import { useCallback } from "react";

interface IFilterValues {
  readonly minAge: number;
  readonly maxAge: number;
  readonly positions: readonly string[];
}

const DEFAULT_FILTERS: IFilterValues = {
  minAge: 18,
  maxAge: 40,
  positions: [],
};

export const filterValuesVar = makeVar<IFilterValues>(DEFAULT_FILTERS);

/**
 * Custom hook for filter operations
 * Encapsulates all filter state logic
 */
export const useFilters = () => {
  const filters = useReactiveVar(filterValuesVar);

  const setMinAge = useCallback((minAge: number) => {
    filterValuesVar({ ...filterValuesVar(), minAge });
  }, []);

  const setMaxAge = useCallback((maxAge: number) => {
    filterValuesVar({ ...filterValuesVar(), maxAge });
  }, []);

  const togglePosition = useCallback((position: string) => {
    const current = filterValuesVar();
    const hasPosition = current.positions.includes(position);
    const positions = hasPosition
      ? current.positions.filter(p => p !== position)
      : [...current.positions, position];
    filterValuesVar({ ...current, positions });
  }, []);

  const resetFilters = useCallback(() => {
    filterValuesVar(DEFAULT_FILTERS);
  }, []);

  return {
    filters,
    setMinAge,
    setMaxAge,
    togglePosition,
    resetFilters,
  };
};
```

## Dependency Injection for Testing

Pass reactive variables as parameters for testable hooks:

```typescript
/**
 * Testable hook with dependency injection
 * @param filtersVar - Reactive variable (can be mocked in tests)
 */
export const useFiltersWithDI = (
  filtersVar: ReactiveVar<IFilterValues> = filterValuesVar
) => {
  const filters = useReactiveVar(filtersVar);

  const setMinAge = useCallback(
    (minAge: number) => {
      filtersVar({ ...filtersVar(), minAge });
    },
    [filtersVar]
  );

  return { filters, setMinAge };
};

// Test usage
describe("useFiltersWithDI", () => {
  it("should update minAge", () => {
    const testVar = makeVar<IFilterValues>(DEFAULT_FILTERS);
    const { result } = renderHook(() => useFiltersWithDI(testVar));

    act(() => {
      result.current.setMinAge(25);
    });

    expect(testVar().minAge).toBe(25);
  });
});
```

## Cache Type Policy Integration

Connect reactive variables to GraphQL queries using field policies:

```typescript
import { InMemoryCache, makeVar } from "@apollo/client";
import { gql } from "@apollo/client";

// Reactive variable
export const filterValuesVar = makeVar<IFilterValues>(DEFAULT_FILTERS);

// Cache configuration
export const cache = new InMemoryCache({
  typePolicies: {
    Query: {
      fields: {
        filterValues: {
          read() {
            return filterValuesVar();
          },
        },
      },
    },
  },
});

// Query local state with @client directive
export const GET_FILTER_VALUES = gql`
  query GetFilterValues {
    filterValues @client {
      minAge
      maxAge
      positions
    }
  }
`;

// Use in component
const FilterComponent = () => {
  const { data } = useQuery(GET_FILTER_VALUES);
  // data.filterValues is reactive
};
```

## Performance Considerations

### Split Large State

Instead of one large reactive variable, use multiple smaller ones:

```typescript
// AVOID - single large state
const appStateVar = makeVar({
  user: {
    /* ... */
  },
  settings: {
    /* ... */
  },
  filters: {
    /* ... */
  },
  selectedItems: {
    /* ... */
  },
});

// PREFER - separate concerns
export const userVar = makeVar<User | null>(null);
export const settingsVar = makeVar<Settings>(DEFAULT_SETTINGS);
export const filtersVar = makeVar<Filters>(DEFAULT_FILTERS);
export const selectedItemsVar = makeVar<Record<string, boolean>>({});
```

### Batch Related Updates

Update multiple fields in a single call:

```typescript
// CORRECT - single update
filterValuesVar({
  ...filterValuesVar(),
  minAge: 21,
  maxAge: 35,
  positions: ["QB", "WR"],
});

// AVOID - multiple sequential updates
filterValuesVar({ ...filterValuesVar(), minAge: 21 });
filterValuesVar({ ...filterValuesVar(), maxAge: 35 });
filterValuesVar({ ...filterValuesVar(), positions: ["QB", "WR"] });
```

### Selector Pattern for Complex State

Create selector wrappers to minimize re-renders:

```typescript
// Store
export const allPlayersVar = makeVar<Record<string, Player>>({});

// Selector hook - only re-renders when specific player changes
export const usePlayer = (playerId: string): Player | undefined => {
  const allPlayers = useReactiveVar(allPlayersVar);
  return allPlayers[playerId];
};

// Component only re-renders when its specific player changes
const PlayerCard = ({ playerId }: { playerId: string }) => {
  const player = usePlayer(playerId);
  return player ? <Text>{player.name}</Text> : null;
};
```

## TypeScript Best Practices

### Use Readonly Types

Enforce immutability at the type level:

```typescript
interface IState {
  readonly items: readonly Item[];
  readonly metadata: Readonly<Metadata>;
}

export const stateVar = makeVar<IState>({
  items: [],
  metadata: { count: 0 },
});
```

### Use Generic Constraints

```typescript
// Generic updater function
const updateVar = <T extends Record<string, unknown>>(
  reactiveVar: ReactiveVar<T>,
  updates: Partial<T>
): void => {
  reactiveVar({ ...reactiveVar(), ...updates });
};

// Usage
updateVar(settingsVar, { theme: "dark" });
```

### Export Types with Variables

```typescript
// Export both type and variable
export interface IFilterValues {
  readonly minAge: number;
  readonly maxAge: number;
}

export const filterValuesVar = makeVar<IFilterValues>({
  minAge: 18,
  maxAge: 40,
});

// Re-export type for consumers
export type { IFilterValues };
```
