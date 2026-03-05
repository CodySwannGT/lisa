# Apollo Client Mutation Patterns

This reference provides comprehensive examples of mutation patterns for Apollo Client 3.10.

## Complete Mutation Hook Pattern

Every custom mutation hook should follow this structure:

```typescript
import { useCallback } from "react";
import {
  useUpdateKanbanCardMutation,
  KanbanCardFragment,
  KanbanCardFragmentDoc,
} from "@/generated/graphql";

/**
 * Hook for updating kanban card with optimistic UI
 * @param boardId - The board ID for context
 * @returns Object containing update function and loading state
 */
export const useUpdateCard = (boardId: string) => {
  const [updateCardMutation, { loading }] = useUpdateKanbanCardMutation({
    // 1. OPTIMISTIC RESPONSE - Provides instant UI feedback
    optimisticResponse: variables => ({
      __typename: "Mutation",
      updateKanbanCard: {
        __typename: "KanbanCard",
        id: variables.id,
        notes: variables.input.notes ?? null,
        position: variables.input.position ?? 0,
        kanbanPhaseId: variables.input.kanbanPhaseId ?? "",
        kanbanPhase: {
          __typename: "KanbanPhase",
          id: variables.input.kanbanPhaseId ?? "",
          name: "", // Will be updated by server response
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    }),

    // 2. CACHE UPDATE - Ensures UI stays in sync
    update(cache, { data }) {
      if (!data?.updateKanbanCard) return;

      // For simple field updates, Apollo handles automatically
      // For complex scenarios, use cache.modify:
      cache.modify({
        id: cache.identify({
          __typename: "KanbanCard",
          id: data.updateKanbanCard.id,
        }),
        fields: {
          notes: () => data.updateKanbanCard.notes,
          position: () => data.updateKanbanCard.position,
        },
      });
    },

    // 3. ERROR HANDLING - Never pollutes console
    onError: () => {
      // Set error state in UI, don't console.log
    },
  });

  // 4. WRAPPED CALLBACK - Proper memoization
  const updateCard = useCallback(
    async (cardId: string, notes: string) => {
      await updateCardMutation({
        variables: {
          id: cardId,
          input: { notes },
        },
      });
    },
    [updateCardMutation]
  );

  return { updateCard, isUpdating: loading };
};
```

## Adding Items to a List

When creating new items that need to appear in a list:

```typescript
const [addPlayerMutation] = useAddPlayerToKanbanMutation({
  optimisticResponse: variables => ({
    __typename: "Mutation",
    addPlayerToKanban: {
      __typename: "KanbanCard",
      id: crypto.randomUUID(), // Temporary ID for new items
      position: 0,
      notes: variables.input.notes ?? null,
      kanbanPhaseId: variables.input.kanbanPhaseId,
      kanbanPhase: {
        __typename: "KanbanPhase",
        id: variables.input.kanbanPhaseId,
        name: "", // Will be replaced by server
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }),

  update(cache, { data }) {
    if (!data?.addPlayerToKanban) return;

    cache.modify({
      fields: {
        listKanbanCards(existingCards = { edges: [] }) {
          const newCardRef = cache.writeFragment({
            data: data.addPlayerToKanban,
            fragment: KanbanCardFragmentDoc,
          });

          return {
            ...existingCards,
            edges: [
              ...existingCards.edges,
              {
                __typename: "KanbanCardEdge",
                cursor: "",
                node: { __ref: newCardRef.__ref },
              },
            ],
          };
        },
      },
    });
  },

  onError: () => {
    // Handle error in UI state
  },
});
```

## Removing Items from a List

When deleting items that should disappear from a list:

```typescript
const [removePlayerMutation] = useRemovePlayerFromKanbanMutation({
  optimisticResponse: variables => ({
    __typename: "Mutation",
    removePlayerFromKanban: {
      __typename: "KanbanCard",
      id: variables.cardId,
      position: 0,
      notes: null,
      kanbanPhaseId: "",
      kanbanPhase: {
        __typename: "KanbanPhase",
        id: "",
        name: "",
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }),

  update(cache, { data }) {
    if (!data?.removePlayerFromKanban) return;

    const removedId = data.removePlayerFromKanban.id;

    cache.modify({
      fields: {
        listKanbanCards(existingCards = { edges: [] }, { readField }) {
          return {
            ...existingCards,
            edges: existingCards.edges.filter(
              (edge: { node: { __ref: string } }) => {
                const cardRef = edge.node.__ref;
                return readField("id", { __ref: cardRef }) !== removedId;
              }
            ),
          };
        },
      },
    });

    // Evict the removed item from cache entirely
    cache.evict({
      id: cache.identify({
        __typename: "KanbanCard",
        id: removedId,
      }),
    });
    cache.gc();
  },

  onError: () => {
    // Handle error in UI state
  },
});
```

## Moving Items Between Lists

When an item moves from one parent to another:

```typescript
const [moveCardMutation] = useMoveKanbanCardMutation({
  optimisticResponse: variables => ({
    __typename: "Mutation",
    moveKanbanCard: {
      __typename: "KanbanCard",
      id: variables.input.cardId,
      position: variables.input.targetPosition,
      notes: null, // Preserve from existing cache
      kanbanPhaseId: variables.input.targetPhaseId,
      kanbanPhase: {
        __typename: "KanbanPhase",
        id: variables.input.targetPhaseId,
        name: "", // Will be updated by server
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  }),

  // For moves, refetchQueries is often cleaner than manual cache updates
  refetchQueries: ["ListKanbanCards"],
  awaitRefetchQueries: false, // Don't block UI

  onError: () => {
    // Handle error in UI state
  },
});
```

## Batch Updates with Reordering

When updating positions of multiple items:

```typescript
const [updatePositionsMutation] = useUpdateKanbanPhasePositionsMutation({
  optimisticResponse: variables => ({
    __typename: "Mutation",
    updateKanbanPhasePositions: variables.input.phasePositions.map(pp => ({
      __typename: "KanbanPhase",
      id: pp.phaseId,
      position: pp.position,
      name: "", // Preserve from cache
      kanbanBoardId: variables.input.kanbanBoardId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
  }),

  refetchQueries: ["ListKanbanPhases"],
  awaitRefetchQueries: false,

  onError: () => {
    // Handle error in UI state
  },
});
```

## Conditional Optimistic Updates

Skip optimistic updates when conditions aren't met:

```typescript
const [updateMutation] = useUpdateMutation({
  optimisticResponse: (variables, { IGNORE }) => {
    // Skip optimistic update if we don't have enough data
    if (!variables.input.name) {
      return IGNORE;
    }

    return {
      __typename: "Mutation",
      update: {
        __typename: "Entity",
        id: variables.id,
        name: variables.input.name,
        updatedAt: new Date().toISOString(),
      },
    };
  },
});
```

## Cache Update with cache.identify

Use `cache.identify` to get the correct cache key:

```typescript
update(cache, { data }) {
  if (!data?.updatePlayer) return;

  const cacheId = cache.identify({
    __typename: "Player",
    id: data.updatePlayer.id,
  });
  // cacheId = "Player:abc-123"

  cache.modify({
    id: cacheId,
    fields: {
      isActive: () => true,
      updatedAt: () => new Date().toISOString(),
    },
  });
}
```

## Using readonly Types for Cache Modifiers

Apollo cache data is readonly. Use proper typing:

```typescript
cache.modify({
  fields: {
    players(existingPlayers: readonly { __ref: string }[] = [], { readField }) {
      return existingPlayers.filter(ref => readField("id", ref) !== removedId);
    },
  },
});
```

## Decision Tree: Cache Update Strategy

```
Mutation creates/updates/deletes entity
            │
            ▼
┌───────────────────────────────┐
│ Does mutation return entity   │
│ with id and __typename?       │
└───────────────────────────────┘
            │
     ┌──────┴──────┐
     │ YES         │ NO
     ▼             ▼
┌─────────┐   ┌─────────────────┐
│Automatic│   │ Use             │
│ Update  │   │ refetchQueries  │
└─────────┘   └─────────────────┘
     │
     ▼
┌───────────────────────────────┐
│ Does entity need to appear    │
│ in or disappear from a list?  │
└───────────────────────────────┘
            │
     ┌──────┴──────┐
     │ YES         │ NO
     ▼             ▼
┌─────────────┐   ┌─────────────┐
│cache.modify │   │ Automatic   │
│ with list   │   │ is enough   │
│ manipulation│   │             │
└─────────────┘   └─────────────┘
```
