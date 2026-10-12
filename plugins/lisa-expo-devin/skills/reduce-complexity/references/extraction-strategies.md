# Extraction Strategies

This reference provides detailed patterns for extracting code to reduce cognitive complexity.

## Strategy 1: Helper Functions in View Files

Helper functions are the simplest extraction strategy. Use them for rendering logic that doesn't need its own component lifecycle.

### Pattern: Render Helper with Props Object

Always use a props object (not positional arguments) for type safety and clarity:

```tsx
/**
 * Renders a section header with title and count.
 * @param props - Helper function properties
 * @param props.title - Section title text
 * @param props.count - Item count to display
 * @param props.colors - Theme colors object
 */
function renderSectionHeader(props: {
  readonly title: string;
  readonly count: number;
  readonly colors: KanbanColors;
}) {
  const { title, count, colors } = props;
  return (
    <HStack className="items-center justify-between py-2">
      <Text
        className="text-xs font-semibold uppercase tracking-wider"
        style={{ color: colors.textMuted }}
      >
        {title}
      </Text>
      <Text className="text-xs" style={{ color: colors.textSecondary }}>
        ({count})
      </Text>
    </HStack>
  );
}
```

### Pattern: Conditional Render Helper

For sections that render conditionally based on data:

```tsx
/**
 * Renders the empty state when no items exist.
 * @param props - Helper function properties
 * @param props.message - Empty state message
 * @param props.colors - Theme colors object
 */
function renderEmptyState(props: {
  readonly message: string;
  readonly colors: KanbanColors;
}) {
  const { message, colors } = props;
  return (
    <Box
      className="items-center justify-center p-8"
      style={{ backgroundColor: colors.cardBackground }}
    >
      <Text style={{ color: colors.textMuted }}>{message}</Text>
    </Box>
  );
}

// Usage in View
const ListView = ({ items, isEmpty, colors }: Props) => (
  <Box>
    {isEmpty
      ? renderEmptyState({ message: "No items found", colors })
      : items.map(item => <Item key={item.id} item={item} />)}
  </Box>
);
```

### Pattern: List Item Render Helper

For repeated item rendering with complex styling:

```tsx
/**
 * Renders a selectable chip/pill item.
 * @param props - Helper function properties
 * @param props.label - Display text for the chip
 * @param props.isSelected - Whether the chip is currently selected
 * @param props.colors - Theme colors for styling
 * @param props.onPress - Callback when chip is pressed
 */
function renderChip(props: {
  readonly label: string;
  readonly isSelected: boolean;
  readonly colors: KanbanColors;
  readonly onPress: () => void;
}) {
  const { label, isSelected, colors, onPress } = props;
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 6,
        backgroundColor: isSelected ? colors.primary : colors.cardBackground,
        borderWidth: 1,
        borderColor: isSelected ? colors.primary : colors.border,
      }}
    >
      <Text
        className="text-xs font-medium"
        style={{ color: isSelected ? "#FFFFFF" : colors.textSecondary }}
      >
        {label}
      </Text>
    </Pressable>
  );
}
```

### When NOT to Use Helper Functions

Do not use helper functions when:

1. **The helper would need hooks** - Extract as full component instead
2. **The helper is used in multiple files** - Extract as shared component
3. **The helper has complex event handling** - Container should handle this
4. **The helper exceeds 30 lines** - Consider full component extraction

## Strategy 2: Pre-compute in Container

Move complexity from View to Container by pre-computing values.

### Pattern: Selection State Pre-computation

**Before (complexity in View):**

```tsx
// View has repeated .includes() checks
<Pressable
  style={{
    backgroundColor: filters.positions.includes(position)
      ? colors.primary
      : colors.cardBackground,
  }}
/>
```

**After (pre-computed in Container):**

```tsx
// Container
const positionItems = useMemo(
  () =>
    availablePositions.map(position => ({
      value: position,
      label: position,
      isSelected: filters.positions.includes(position),
    })),
  [availablePositions, filters.positions]
);

// View - simple prop access
{
  positionItems.map(({ value, label, isSelected }) => (
    <Chip
      key={value}
      label={label}
      isSelected={isSelected}
      onPress={() => onPositionToggle(value)}
    />
  ));
}
```

### Pattern: View State Enumeration

**Before (nested ternaries):**

```tsx
{
  isLoading ? (
    <Spinner />
  ) : error ? (
    <ErrorView error={error} />
  ) : data.length === 0 ? (
    <EmptyState />
  ) : (
    <DataList data={data} />
  );
}
```

**After (enumerated state):**

```tsx
// Container
type ViewState = "loading" | "error" | "empty" | "ready";

const viewState = useMemo((): ViewState => {
  if (isLoading) return "loading";
  if (error) return "error";
  if (data.length === 0) return "empty";
  return "ready";
}, [isLoading, error, data.length]);

// View - switch or map
const ComponentView = ({ viewState, data, error }: Props) => (
  <Box>
    {viewState === "loading" && <Spinner />}
    {viewState === "error" && <ErrorView error={error} />}
    {viewState === "empty" && <EmptyState />}
    {viewState === "ready" && <DataList data={data} />}
  </Box>
);
```

### Pattern: Style Pre-computation

**Before (inline style objects create complexity and perf issues):**

```tsx
<Box
  style={{
    backgroundColor: isDark ? colors.dark.bg : colors.light.bg,
    padding: isCompact ? 8 : 16,
    borderRadius: isRounded ? 12 : 0,
  }}
/>
```

**After (computed style in Container):**

```tsx
// Container
const boxStyle = useMemo(
  () => ({
    backgroundColor: isDark ? colors.dark.bg : colors.light.bg,
    padding: isCompact ? 8 : 16,
    borderRadius: isRounded ? 12 : 0,
  }),
  [isDark, isCompact, isRounded, colors]
);

// View
<Box style={boxStyle} />;
```

## Strategy 3: Full Component Extraction

When helper functions aren't sufficient, extract a full Container/View component.

### Decision Checklist

Extract as full component when 3+ of these apply:

- [ ] Pattern repeats in 2+ files
- [ ] Section needs its own state
- [ ] Section has 4+ props
- [ ] Section has callbacks that could be simplified
- [ ] Section represents a meaningful domain concept
- [ ] Section could be tested independently

### Extraction Steps

1. **Identify the repeated/complex pattern**
2. **Define the component's props interface**
3. **Create directory structure:**
   ```text
   ComponentName/
   ├── ComponentNameContainer.tsx
   ├── ComponentNameView.tsx
   └── index.tsx
   ```
4. **Write Container with logic/state**
5. **Write View with pure rendering**
6. **Update parent to use new component**
7. **Write tests for new component**

### Example: Extracting FilterChipList

**Before (in FilterModalView.tsx):**

```tsx
{
  /* Positions - repeated pattern */
}
{
  availablePositions.length > 0 && (
    <VStack className="gap-3">
      <Text style={{ color: colors.textMuted }}>Positions</Text>
      <HStack className="flex-wrap gap-2">
        {availablePositions.map(position => (
          <Pressable
            key={position}
            onPress={() => onPositionToggle(position)}
            style={{
              backgroundColor: filters.positions.includes(position)
                ? colors.primary
                : colors.cardBackground,
              // ... more styles
            }}
          >
            <Text>{position}</Text>
          </Pressable>
        ))}
      </HStack>
    </VStack>
  );
}

{
  /* Tags - same pattern with slight variation */
}
{
  availableTags.length > 0 && (
    <VStack className="gap-3">
      <Text style={{ color: colors.textMuted }}>Tags</Text>
      <HStack className="flex-wrap gap-2">
        {availableTags.map(tag => (
          <Pressable
            key={tag.id}
            onPress={() => onTagToggle(tag.id)}
            // ... same pattern
          >
            <Text>{tag.name}</Text>
          </Pressable>
        ))}
      </HStack>
    </VStack>
  );
}
```

**After (FilterChipList component):**

```tsx
// FilterChipListContainer.tsx
interface FilterChipListProps {
  readonly title: string;
  readonly items: readonly { id: string; label: string; color?: string }[];
  readonly selectedIds: readonly string[];
  readonly colors: KanbanColors;
  readonly onToggle: (id: string) => void;
}

const FilterChipListContainer = ({
  title,
  items,
  selectedIds,
  colors,
  onToggle,
}: FilterChipListProps) => {
  const chipItems = useMemo(
    () =>
      items.map(item => ({
        ...item,
        isSelected: selectedIds.includes(item.id),
      })),
    [items, selectedIds]
  );

  const handleToggle = useCallback(
    (id: string) => () => onToggle(id),
    [onToggle]
  );

  return (
    <FilterChipListView
      title={title}
      items={chipItems}
      colors={colors}
      onToggle={handleToggle}
    />
  );
};
```

```tsx
// FilterChipListView.tsx
interface FilterChipListViewProps {
  readonly title: string;
  readonly items: readonly {
    id: string;
    label: string;
    color?: string;
    isSelected: boolean;
  }[];
  readonly colors: KanbanColors;
  readonly onToggle: (id: string) => () => void;
}

const FilterChipListView = ({
  title,
  items,
  colors,
  onToggle,
}: FilterChipListViewProps) => (
  <VStack className="gap-3">
    <Text
      className="text-xs font-semibold uppercase tracking-wider"
      style={{ color: colors.textMuted }}
    >
      {title}
    </Text>
    <HStack className="flex-wrap gap-2">
      {items.map(({ id, label, color, isSelected }) => (
        <Pressable
          key={id}
          onPress={onToggle(id)}
          style={{
            paddingHorizontal: 10,
            paddingVertical: 5,
            borderRadius: 6,
            backgroundColor: isSelected
              ? (color ?? colors.primary)
              : colors.cardBackground,
            borderWidth: 1,
            borderColor: isSelected ? (color ?? colors.primary) : colors.border,
          }}
        >
          <Text
            className="text-xs font-medium"
            style={{ color: isSelected ? "#FFFFFF" : colors.textSecondary }}
          >
            {label}
          </Text>
        </Pressable>
      ))}
    </HStack>
  </VStack>
);

FilterChipListView.displayName = "FilterChipListView";
export default memo(FilterChipListView);
```

**Usage in parent:**

```tsx
<FilterChipList
  title="Positions"
  items={positionItems}
  selectedIds={filters.positions}
  colors={colors}
  onToggle={onPositionToggle}
/>
<FilterChipList
  title="Tags"
  items={tagItems}
  selectedIds={filters.tags}
  colors={colors}
  onToggle={onTagToggle}
/>
```
