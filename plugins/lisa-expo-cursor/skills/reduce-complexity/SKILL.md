---
name: reduce-complexity
description: This skill provides strategies and patterns for reducing cognitive complexity in React components. It should be used when ESLint reports sonarjs/cognitive-complexity violations, when refactoring complex View components, or when planning how to break down large components. The skill enforces this project's Container/View pattern requirements when extracting components.
---

# Reduce Complexity

This skill provides systematic approaches for reducing cognitive complexity in React components while adhering to this project's Container/View pattern requirements.

## When to Use This Skill

- ESLint reports `sonarjs/cognitive-complexity` violations (threshold: 28)
- A View component exceeds 200 lines
- A component has deeply nested conditionals or repeated patterns
- Planning refactoring of a complex component
- Deciding between extracting helper functions vs full components

## Complexity Sources in React Components

Cognitive complexity increases with:

| Source                 | Complexity Impact | Common in View Components |
| ---------------------- | ----------------- | ------------------------- |
| Nested conditionals    | +1 per nesting    | Yes                       |
| Ternary expressions    | +1 each           | Yes                       |
| Logical operators (&&) | +1 each           | Yes                       |
| Loops (map, filter)    | +1 each           | Yes                       |
| Switch/case statements | +1 per case       | Rare                      |
| Catch blocks           | +1 each           | No (Container only)       |
| Nested functions       | +1 per nesting    | Yes                       |

## Decision Framework: Helper Function vs Full Component

Before extracting code, determine the appropriate strategy:

### Extract as Helper Function When:

- The JSX renders a static or simple section with no logic of its own
- The section does not need its own state, hooks, or callbacks
- The pattern appears only in this file
- The complexity comes from rendering, not behavior

```tsx
// Helper function - no logic, just rendering
function renderSectionHeader(props: {
  readonly title: string;
  readonly count: number;
}) {
  return (
    <HStack className="justify-between">
      <Text className="font-bold">{props.title}</Text>
      <Text className="text-sm">({props.count})</Text>
    </HStack>
  );
}
```

### Extract as Full Component (Container/View) When:

- The section has reusable logic or could be used elsewhere
- The section would benefit from its own state management
- The pattern repeats across multiple files
- The section has 3+ props that could be simplified with a Container
- Extracting would create a meaningful, named abstraction

```
FilterChipList/
├── FilterChipListContainer.tsx  # Handles selection logic
├── FilterChipListView.tsx       # Renders chip list
└── index.tsx                    # Exports Container
```

## Refactoring Process

### Step 1: Analyze Complexity Sources

Run ESLint to identify the violation:

```bash
bun run lint 2>&1 | grep "cognitive-complexity"
```

> **Note:** Replace `bun` with your project's package manager (`npm`, `yarn`, `pnpm`) as needed.

Read the file and identify:

1. Which function has the violation (line number from ESLint)
2. What patterns repeat (copy-pasted JSX with slight variations)
3. What conditionals nest deeply (ternaries inside ternaries)
4. What could be pre-computed in Container

### Step 2: Choose Extraction Strategy

Use the decision framework above. For View components:

| Situation                  | Strategy                          |
| -------------------------- | --------------------------------- |
| Repeated JSX, no logic     | Helper function                   |
| Repeated JSX, needs props  | Helper function with props object |
| Repeated pattern, 3+ files | Full Container/View component     |
| Complex section, own state | Full Container/View component     |
| Deeply nested ternaries    | Pre-compute flags in Container    |

### Step 3: Write Tests First (TDD)

Before refactoring, ensure test coverage exists:

```bash
# Check existing coverage
bun run test:unit --coverage --collectCoverageFrom='<file-path>'
```

If no tests exist, write tests that verify current behavior before refactoring.

### Step 4: Implement Extraction

For helper functions, see `references/extraction-strategies.md`.
For full components, use the Container/View pattern skill.

### Step 5: Verify Complexity Resolved

```bash
bun run lint 2>&1 | grep "cognitive-complexity"
bun run test:unit
```

## Quick Fixes for Common Patterns

### Repeated Conditional Styling

**Before (high complexity):**

```tsx
<Pressable
  style={{
    backgroundColor: selected.includes(item) ? colors.primary : colors.bg,
    borderColor: selected.includes(item) ? colors.primary : colors.border,
  }}
>
  <Text style={{ color: selected.includes(item) ? "#FFF" : colors.text }}>
    {item}
  </Text>
</Pressable>
```

**After (reduced complexity):**

```tsx
// In Container - pre-compute selection state
const itemStates = useMemo(
  () =>
    items.map(item => ({
      item,
      isSelected: selected.includes(item),
    })),
  [items, selected]
);

// In View - simple conditional
<Pressable style={isSelected ? styles.selected : styles.default}>
  <Text style={isSelected ? styles.selectedText : styles.defaultText}>
    {item}
  </Text>
</Pressable>;
```

### Repeated Section Patterns

**Before (4x repeated pattern = high complexity):**

```tsx
{positions.length > 0 && (
  <VStack>
    <Text>Positions</Text>
    <HStack>{positions.map(p => <Chip key={p} ... />)}</HStack>
  </VStack>
)}
{tags.length > 0 && (
  <VStack>
    <Text>Tags</Text>
    <HStack>{tags.map(t => <Chip key={t.id} ... />)}</HStack>
  </VStack>
)}
// ... repeated 2 more times
```

**After (extract FilterChipList component):**

```tsx
<FilterChipList
  title="Positions"
  items={positions}
  selectedItems={filters.positions}
  onToggle={onPositionToggle}
/>
<FilterChipList
  title="Tags"
  items={tags}
  selectedItems={filters.tags}
  onToggle={onTagToggle}
/>
```

### Nested Ternaries

**Before:**

```tsx
{
  isLoading ? (
    <Spinner />
  ) : hasError ? (
    <Error />
  ) : isEmpty ? (
    <Empty />
  ) : (
    <Content />
  );
}
```

**After (pre-compute state in Container):**

```tsx
// Container
const viewState = useMemo(() => {
  if (isLoading) return "loading";
  if (hasError) return "error";
  if (isEmpty) return "empty";
  return "content";
}, [isLoading, hasError, isEmpty]);

// View - map directly
const VIEW_STATES = {
  loading: <Spinner />,
  error: <Error />,
  empty: <Empty />,
  content: <Content />,
} as const;

{
  VIEW_STATES[viewState];
}
```

## Reference Documentation

For detailed patterns and complete examples:

- `references/extraction-strategies.md` - Helper function patterns and when to use each
- `references/refactoring-patterns.md` - Step-by-step refactoring examples with before/after code
