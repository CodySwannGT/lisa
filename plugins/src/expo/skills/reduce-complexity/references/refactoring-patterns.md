# Refactoring Patterns

This reference provides complete before/after examples for common complexity refactoring scenarios.

## Pattern 1: Flatten Nested Conditionals

### Problem

Nested conditional rendering creates exponential complexity:

```tsx
// Complexity: 6+ (each && and ternary adds complexity, nesting multiplies)
const BadView = ({ isLoading, hasError, data, isEmpty }: Props) => (
  <Box>
    {isLoading ? (
      <Spinner />
    ) : hasError ? (
      <ErrorState />
    ) : isEmpty ? (
      <EmptyState />
    ) : (
      <Box>
        {data.sections.map(section => (
          <Box key={section.id}>
            {section.isExpanded ? (
              <ExpandedContent items={section.items} />
            ) : (
              <CollapsedHeader title={section.title} />
            )}
          </Box>
        ))}
      </Box>
    )}
  </Box>
);
```

### Solution: Pre-compute State + Flatten

```tsx
// Container
type ViewState = "loading" | "error" | "empty" | "ready";

const ContainerComponent = () => {
  const { data, loading, error } = useQuery();

  const viewState = useMemo((): ViewState => {
    if (loading) return "loading";
    if (error) return "error";
    if (!data?.sections?.length) return "empty";
    return "ready";
  }, [loading, error, data?.sections?.length]);

  const sections = useMemo(() => data?.sections ?? [], [data?.sections]);

  return <ViewComponent viewState={viewState} sections={sections} />;
};

// View - Complexity reduced to ~3
const ViewComponent = ({ viewState, sections }: Props) => (
  <Box>
    {viewState === "loading" && <Spinner />}
    {viewState === "error" && <ErrorState />}
    {viewState === "empty" && <EmptyState />}
    {viewState === "ready" && <SectionList sections={sections} />}
  </Box>
);
```

## Pattern 2: Extract Repeated Map Patterns

### Problem

Same rendering pattern repeated with different data:

```tsx
// Complexity: 20+ (each map, conditional, and ternary adds up)
const FilterModalView = ({ filters, positions, tags, statuses }: Props) => (
  <Box>
    {/* Positions - Pattern A */}
    {positions.length > 0 && (
      <VStack>
        <Text>Positions</Text>
        <HStack>
          {positions.map(p => (
            <Chip
              key={p}
              label={p}
              selected={filters.positions.includes(p)}
              onPress={() => onToggle("position", p)}
            />
          ))}
        </HStack>
      </VStack>
    )}

    {/* Tags - Pattern A (repeated) */}
    {tags.length > 0 && (
      <VStack>
        <Text>Tags</Text>
        <HStack>
          {tags.map(t => (
            <Chip
              key={t.id}
              label={t.name}
              selected={filters.tags.includes(t.id)}
              onPress={() => onToggle("tag", t.id)}
            />
          ))}
        </HStack>
      </VStack>
    )}

    {/* Statuses - Pattern A (repeated again) */}
    {statuses.length > 0 && (
      <VStack>
        <Text>Status</Text>
        <HStack>
          {statuses.map(s => (
            <Chip
              key={s}
              label={s}
              selected={filters.statuses.includes(s)}
              onPress={() => onToggle("status", s)}
            />
          ))}
        </HStack>
      </VStack>
    )}
  </Box>
);
```

### Solution: Extract Reusable Component

```tsx
// New component: FilterSection/FilterSectionContainer.tsx
interface FilterSectionProps {
  readonly title: string;
  readonly items: readonly { id: string; label: string }[];
  readonly selectedIds: readonly string[];
  readonly onToggle: (id: string) => void;
}

const FilterSectionContainer = ({
  title,
  items,
  selectedIds,
  onToggle,
}: FilterSectionProps) => {
  const itemsWithSelection = useMemo(
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

  if (items.length === 0) return null;

  return (
    <FilterSectionView
      title={title}
      items={itemsWithSelection}
      onToggle={handleToggle}
    />
  );
};

// FilterSection/FilterSectionView.tsx
const FilterSectionView = ({ title, items, onToggle }: ViewProps) => (
  <VStack>
    <Text>{title}</Text>
    <HStack>
      {items.map(({ id, label, isSelected }) => (
        <Chip
          key={id}
          label={label}
          selected={isSelected}
          onPress={onToggle(id)}
        />
      ))}
    </HStack>
  </VStack>
);

FilterSectionView.displayName = "FilterSectionView";
export default memo(FilterSectionView);

// Updated parent - Complexity: ~3
const FilterModalView = ({ positionItems, tagItems, statusItems }: Props) => (
  <Box>
    <FilterSection
      title="Positions"
      items={positionItems}
      selectedIds={filters.positions}
      onToggle={onPositionToggle}
    />
    <FilterSection
      title="Tags"
      items={tagItems}
      selectedIds={filters.tags}
      onToggle={onTagToggle}
    />
    <FilterSection
      title="Status"
      items={statusItems}
      selectedIds={filters.statuses}
      onToggle={onStatusToggle}
    />
  </Box>
);
```

## Pattern 3: Simplify Conditional Styles

### Problem

Repeated conditional checks for styling:

```tsx
// Complexity: 12+ (each includes() and ternary)
const ChipView = ({ item, selectedItems, colors }: Props) => (
  <Pressable
    style={{
      backgroundColor: selectedItems.includes(item.id)
        ? colors.primary
        : colors.cardBackground,
      borderColor: selectedItems.includes(item.id)
        ? colors.primary
        : colors.border,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: 6,
    }}
  >
    <Text
      style={{
        color: selectedItems.includes(item.id)
          ? "#FFFFFF"
          : colors.textSecondary,
        fontWeight: selectedItems.includes(item.id) ? "600" : "400",
      }}
    >
      {item.label}
    </Text>
  </Pressable>
);
```

### Solution: Pre-compute and Use Style Objects

```tsx
// Container - compute selection state once
const ChipListContainer = ({ items, selectedIds }: Props) => {
  const itemsWithState = useMemo(
    () =>
      items.map(item => ({
        ...item,
        isSelected: selectedIds.includes(item.id),
      })),
    [items, selectedIds]
  );

  return <ChipListView items={itemsWithState} />;
};

// View - use pre-computed isSelected
const ChipView = ({ item, isSelected, colors }: Props) => (
  <Pressable
    style={isSelected ? styles.selected(colors) : styles.default(colors)}
  >
    <Text style={isSelected ? styles.selectedText : styles.defaultText(colors)}>
      {item.label}
    </Text>
  </Pressable>
);

// Style helpers (defined outside component)
const styles = {
  selected: (colors: Colors) => ({
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  }),
  default: (colors: Colors) => ({
    backgroundColor: colors.cardBackground,
    borderColor: colors.border,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  }),
  selectedText: {
    color: "#FFFFFF",
    fontWeight: "600" as const,
  },
  defaultText: (colors: Colors) => ({
    color: colors.textSecondary,
    fontWeight: "400" as const,
  }),
};
```

## Pattern 4: Replace Switch with Object Mapping

### Problem

Large switch statements or if-else chains:

```tsx
// Complexity: 8+ (each case adds complexity)
const getStatusIcon = (status: string) => {
  switch (status) {
    case "active":
      return <CheckCircle color="green" />;
    case "pending":
      return <Clock color="yellow" />;
    case "inactive":
      return <XCircle color="gray" />;
    case "error":
      return <AlertCircle color="red" />;
    default:
      return <HelpCircle color="gray" />;
  }
};

const StatusView = ({ status }: Props) => <Box>{getStatusIcon(status)}</Box>;
```

### Solution: Object Mapping

```tsx
// Define mapping outside component (no complexity cost)
const STATUS_ICONS: Record<string, ReactNode> = {
  active: <CheckCircle color="green" />,
  pending: <Clock color="yellow" />,
  inactive: <XCircle color="gray" />,
  error: <AlertCircle color="red" />,
};

const DEFAULT_ICON = <HelpCircle color="gray" />;

// View - Complexity: 1
const StatusView = ({ status }: Props) => (
  <Box>{STATUS_ICONS[status] ?? DEFAULT_ICON}</Box>
);
```

## Pattern 5: Extract Complex Render Sections

### Problem

Long View with multiple distinct sections:

```tsx
// Complexity: 25+ (multiple conditionals, maps, nested structures)
const DashboardView = ({ user, stats, notifications, activities }: Props) => (
  <Box>
    {/* Header section - 5 lines */}
    <HStack>
      <Avatar source={user.avatar} />
      <VStack>
        <Text>{user.name}</Text>
        <Text>{user.role}</Text>
      </VStack>
      {user.isAdmin && <AdminBadge />}
    </HStack>

    {/* Stats section - 15 lines */}
    <HStack>
      {stats.map(stat => (
        <Box key={stat.id}>
          <Text>{stat.value}</Text>
          <Text>{stat.label}</Text>
          {stat.trend > 0 ? <TrendUp /> : <TrendDown />}
        </Box>
      ))}
    </HStack>

    {/* Notifications section - 20 lines */}
    {notifications.length > 0 && (
      <VStack>
        <Text>Notifications ({notifications.length})</Text>
        {notifications.slice(0, 5).map(n => (
          <NotificationItem key={n.id} notification={n} />
        ))}
        {notifications.length > 5 && (
          <Text>+{notifications.length - 5} more</Text>
        )}
      </VStack>
    )}

    {/* Activities section - 15 lines */}
    <VStack>
      {activities.map(activity => (
        <ActivityRow key={activity.id} activity={activity} />
      ))}
    </VStack>
  </Box>
);
```

### Solution: Extract Helper Functions

```tsx
/**
 * Renders the user header section.
 * @param props - Section properties
 * @param props.user - User data object
 */
function renderHeader(props: { readonly user: User }) {
  const { user } = props;
  return (
    <HStack>
      <Avatar source={user.avatar} />
      <VStack>
        <Text>{user.name}</Text>
        <Text>{user.role}</Text>
      </VStack>
      {user.isAdmin && <AdminBadge />}
    </HStack>
  );
}

/**
 * Renders the stats row section.
 * @param props - Section properties
 * @param props.stats - Array of stat objects
 */
function renderStats(props: { readonly stats: readonly Stat[] }) {
  const { stats } = props;
  return (
    <HStack>
      {stats.map(stat => (
        <Box key={stat.id}>
          <Text>{stat.value}</Text>
          <Text>{stat.label}</Text>
          {stat.trend > 0 ? <TrendUp /> : <TrendDown />}
        </Box>
      ))}
    </HStack>
  );
}

/**
 * Renders the notifications section.
 * @param props - Section properties
 * @param props.notifications - Array of notification objects
 * @param props.maxVisible - Maximum notifications to show before truncating
 */
function renderNotifications(props: {
  readonly notifications: readonly Notification[];
  readonly maxVisible: number;
}) {
  const { notifications, maxVisible } = props;
  if (notifications.length === 0) return null;

  const visible = notifications.slice(0, maxVisible);
  const remaining = notifications.length - maxVisible;

  return (
    <VStack>
      <Text>Notifications ({notifications.length})</Text>
      {visible.map(n => (
        <NotificationItem key={n.id} notification={n} />
      ))}
      {remaining > 0 && <Text>+{remaining} more</Text>}
    </VStack>
  );
}

// Clean View - Complexity: ~5
const DashboardView = ({ user, stats, notifications, activities }: Props) => (
  <Box>
    {renderHeader({ user })}
    {renderStats({ stats })}
    {renderNotifications({ notifications, maxVisible: 5 })}
    <ActivityList activities={activities} />
  </Box>
);
```

## Complexity Calculation Reference

Understanding how SonarJS calculates cognitive complexity:

| Construct                    | Base Cost | Nesting Penalty |
| ---------------------------- | --------- | --------------- | --- | ------------ |
| `if` / `else if` / `else`    | +1        | +1 per level    |
| `? :` (ternary)              | +1        | +1 per level    |
| `&&` / `                     |           | ` (logical)     | +1  | +1 per level |
| `for` / `while` / `do-while` | +1        | +1 per level    |
| `.map()` / `.filter()` etc   | +1        | +1 per level    |
| `catch`                      | +1        | +1 per level    |
| `switch`                     | +1 total  | -               |
| `case` (in switch)           | +1 each   | -               |
| `break` / `continue`         | +1        | -               |
| Nested function              | +1        | +1 per level    |

### Example Calculation

```tsx
const Example = (
  { items, filter }: Props // Base: 0
) => (
  <Box>
    {items.length > 0 && ( // +1 (&&)
      <VStack>
        {items // +1 (map, nested in &&)
          .filter(i => i.active) // +1 (filter, nested)
          .map(item => (
            <Box key={item.id}>
              {item.isSpecial ? ( // +1 (ternary, deeply nested)
                <SpecialItem item={item} />
              ) : (
                <RegularItem item={item} />
              )}
            </Box>
          ))}
      </VStack>
    )}
  </Box>
);
// Total: 4 + nesting penalties ≈ 8-10
```

## Testing After Refactoring

Always verify the refactoring didn't break functionality:

```bash
# 1. Verify lint passes
bun run lint 2>&1 | grep "cognitive-complexity"

# 2. Run unit tests
bun run test:unit --watch --testPathPattern="ComponentName"

# 3. Run full test suite
bun run test:unit

# 4. Manual verification
bun run start:dev
# Navigate to the refactored component and test interactions
```

> **Note:** Replace `bun` with your project's package manager (`npm`, `yarn`, `pnpm`) as needed.
