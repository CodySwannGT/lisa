# Container/View Pattern - Common Patterns and Anti-Patterns

## Correct Patterns

### 1. State in Container, Props in View

```tsx
// Container - owns state
const PlayerCardContainer = ({ playerId }: Props) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { data } = usePlayerQuery({ variables: { id: playerId } });

  const handleToggle = useCallback(() => {
    setIsExpanded(prev => !prev);
  }, []);

  return (
    <PlayerCardView
      player={data?.player}
      isExpanded={isExpanded}
      onToggle={handleToggle}
    />
  );
};

// View - receives props only
const PlayerCardView = ({ player, isExpanded, onToggle }: ViewProps) => (
  <Box>
    <Pressable onPress={onToggle}>
      <Text>{player?.name}</Text>
    </Pressable>
    {isExpanded && <PlayerDetails player={player} />}
  </Box>
);
```

### 2. Memoized Computed Values

```tsx
// Container - memoize all derived data
const ListContainer = ({ items }: Props) => {
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name)),
    [items]
  );

  const itemCount = useMemo(() => items.length, [items]);

  return <ListView items={sortedItems} count={itemCount} />;
};
```

### 3. Memoized Callbacks

```tsx
// Container - wrap all handlers
const FormContainer = ({ onSubmit }: Props) => {
  const [value, setValue] = useState("");

  const handleChange = useCallback((text: string) => {
    setValue(text);
  }, []);

  const handleSubmit = useCallback(() => {
    onSubmit(value);
  }, [onSubmit, value]);

  return (
    <FormView value={value} onChange={handleChange} onSubmit={handleSubmit} />
  );
};
```

### 4. Loading/Error/Empty States

```tsx
// Container - determines which state to show
const DataListContainer = () => {
  const { data, loading, error } = useDataQuery();

  const isEmpty = useMemo(
    () => !loading && !error && (!data?.items || data.items.length === 0),
    [loading, error, data?.items]
  );

  return (
    <DataListView
      items={data?.items ?? []}
      isLoading={loading}
      hasError={!!error}
      isEmpty={isEmpty}
    />
  );
};

// View - renders based on state props
const DataListView = ({ items, isLoading, hasError, isEmpty }: Props) => (
  <Box>
    {isLoading && <LoadingSpinner />}
    {hasError && <ErrorMessage />}
    {isEmpty && <EmptyState />}
    {!isLoading && !hasError && !isEmpty && (
      <FlashList data={items} renderItem={renderItem} />
    )}
  </Box>
);
```

### 5. Safe Area Insets

```tsx
// Container - gets insets from hook
const ScreenContainer = () => {
  const { bottom: bottomInset } = useSafeAreaInsets();

  return <ScreenView bottomInset={bottomInset} />;
};

// View - applies inset as style
const ScreenView = ({ bottomInset }: { readonly bottomInset: number }) => (
  <Box style={{ paddingBottom: bottomInset }}>
    <Content />
  </Box>
);
```

### 6. Platform-Specific Logic

```tsx
// Container - handles platform logic
const ActionContainer = ({ onDelete }: Props) => {
  const handleDelete = useCallback(() => {
    if (Platform.OS === "web") {
      if (window.confirm("Delete this item?")) {
        onDelete();
      }
    } else {
      Alert.alert("Confirm", "Delete this item?", [
        { text: "Cancel", style: "cancel" },
        { text: "Delete", onPress: onDelete, style: "destructive" },
      ]);
    }
  }, [onDelete]);

  return <ActionView onDelete={handleDelete} />;
};
```

## Anti-Patterns to Avoid

### 1. Hooks in View

```tsx
// WRONG - hooks in View
const BadView = ({ playerId }: Props) => {
  const { data } = usePlayerQuery({ variables: { id: playerId } }); // WRONG
  const [isOpen, setIsOpen] = useState(false); // WRONG

  return <Box>{data?.name}</Box>;
};

// CORRECT - hooks in Container
const GoodContainer = ({ playerId }: Props) => {
  const { data } = usePlayerQuery({ variables: { id: playerId } });
  const [isOpen, setIsOpen] = useState(false);

  return <GoodView player={data} isOpen={isOpen} />;
};
```

### 2. Block Body in View

```tsx
// WRONG - block body with return
const BadView = ({ items }: Props) => {
  return (
    <Box>
      {items.map(item => (
        <Item key={item.id} />
      ))}
    </Box>
  );
};

// CORRECT - arrow shorthand
const GoodView = ({ items }: Props) => (
  <Box>
    {items.map(item => (
      <Item key={item.id} />
    ))}
  </Box>
);
```

### 3. Inline Functions

```tsx
// WRONG - inline function creates new reference
const BadContainer = () => (
  <View onClick={() => console.log("clicked")} /> // WRONG
);

// CORRECT - memoized callback
const GoodContainer = () => {
  const handleClick = useCallback(() => {
    console.log("clicked");
  }, []);

  return <View onClick={handleClick} />;
};
```

### 4. Inline Objects

```tsx
// WRONG - inline object creates new reference
const BadContainer = ({ user }: Props) => (
  <View style={{ padding: 10 }} user={{ name: user.name }} /> // WRONG
);

// CORRECT - memoized values
const GoodContainer = ({ user }: Props) => {
  const style = useMemo(() => ({ padding: 10 }), []);
  const userData = useMemo(() => ({ name: user.name }), [user.name]);

  return <View style={style} user={userData} />;
};
```

### 5. Logic in View

```tsx
// WRONG - logic in View
const BadView = ({ items, filter }: Props) => {
  const filtered = items.filter(i => i.type === filter); // WRONG

  return <List items={filtered} />;
};

// CORRECT - pre-filtered in Container
const GoodContainer = ({ items, filter }: Props) => {
  const filtered = useMemo(
    () => items.filter(i => i.type === filter),
    [items, filter]
  );

  return <GoodView items={filtered} />;
};
```

### 6. Missing memo Wrapper

```tsx
// WRONG - no memo
const BadView = ({ data }: Props) => <Box>{data}</Box>;
export default BadView;

// CORRECT - wrapped with memo
const GoodView = ({ data }: Props) => <Box>{data}</Box>;
GoodView.displayName = "GoodView";
export default memo(GoodView);
```

### 7. Early Returns in View

```tsx
// WRONG - early return in View
const BadView = ({ data, isLoading }: Props) => {
  if (isLoading) return <Spinner />;
  if (!data) return <Empty />;
  return <Content data={data} />;
};

// CORRECT - ternary in View (or handle in Container)
const GoodView = ({ data, isLoading, isEmpty }: Props) => (
  <Box>
    {isLoading ? <Spinner /> : isEmpty ? <Empty /> : <Content data={data} />}
  </Box>
);
```

## Complex View Extraction

When Views become too complex, extract helper functions:

```tsx
/**
 * Renders loading state skeleton.
 * @param props - Helper props
 * @param props.isDark - Dark mode flag
 */
function renderLoading(props: { readonly isDark: boolean }) {
  return <Skeleton className={props.isDark ? "bg-gray-800" : "bg-gray-200"} />;
}

/**
 * Renders empty state message.
 * @param props - Helper props
 * @param props.message - Message to display
 */
function renderEmpty(props: { readonly message: string }) {
  return (
    <Box className="items-center justify-center p-8">
      <Text>{props.message}</Text>
    </Box>
  );
}

const ComplexView = ({ isLoading, isEmpty, isDark, items }: Props) => (
  <Box>
    {isLoading && renderLoading({ isDark })}
    {!isLoading && isEmpty && renderEmpty({ message: "No items found" })}
    {!isLoading && !isEmpty && (
      <FlashList data={items} renderItem={renderItem} />
    )}
  </Box>
);
```
