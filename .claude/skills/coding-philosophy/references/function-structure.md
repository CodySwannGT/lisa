# Function Structure Reference

This document defines the required ordering of statements within functions, hooks, and components.

## The Three Sections

Every function body follows this order:

```
1. VARIABLES & STATE
   - Variable declarations (const)
   - useState hooks
   - useQuery/useMutation hooks
   - useMemo computations
   - useCallback handlers
   - Regular function definitions

2. SIDE EFFECTS
   - useEffect hooks
   - Function calls with no return value

3. RETURN
   - Return statement (always last)
```

## ESLint Enforcement

This ordering is enforced by the `code-organization/enforce-hook-order` ESLint rule.

```
Expected order: variables/state/functions → useEffects → return statement
```

## Hook Structure

### Complete Example

```typescript
export const usePlayerData = (playerId: string): UsePlayerDataReturn => {
  // ========================================
  // 1. VARIABLES & STATE
  // ========================================

  // UI state
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // External hooks
  const { colors } = useTheme();
  const router = useRouter();

  // GraphQL queries
  const { data, loading, refetch } = useQuery(GetPlayerDocument, {
    variables: { playerId },
    skip: !playerId,
  });

  // Derived state with useMemo
  const playerName = useMemo(
    () => data?.player?.name ?? "Unknown",
    [data?.player?.name]
  );

  const filteredStats = useMemo(
    () => data?.stats?.filter(s => s.name.includes(searchQuery)) ?? [],
    [data?.stats, searchQuery]
  );

  // Handlers with useCallback
  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleNavigate = useCallback(() => {
    if (!playerId) {
      console.error("Cannot navigate: player ID is missing");
      return;
    }
    router.push(`/players/${playerId}/details`);
  }, [playerId, router]);

  // Helper functions (defined as const arrow functions or regular functions)
  const formatPlayerLabel = (name: string, position: string): string => {
    return `${name} (${position})`;
  };

  // ========================================
  // 2. SIDE EFFECTS
  // ========================================

  useEffect(() => {
    console.log("Player loaded:", playerName);
  }, [playerName]);

  useEffect(() => {
    if (data?.player) {
      trackAnalytics("player_viewed", { playerId });
    }
  }, [data?.player, playerId]);

  // ========================================
  // 3. RETURN
  // ========================================

  return {
    playerName,
    filteredStats,
    isExpanded,
    loading,
    handleRefresh,
    handleNavigate,
    formatPlayerLabel,
    setIsExpanded,
    setSearchQuery,
  };
};
```

## Container Component Structure

### Complete Example

```typescript
const PlayerCardContainer: React.FC<PlayerCardContainerProps> = ({
  playerId,
  onPress,
  showDetails = false,
}) => {
  // ========================================
  // 1. VARIABLES & STATE
  // ========================================

  // Theme and styling
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const isDark = useColorScheme() === "dark";

  // Local state
  const [isHovered, setIsHovered] = useState(false);

  // Data fetching
  const { data, loading, error } = useQuery(GetPlayerDocument, {
    variables: { playerId },
  });

  // Derived values
  const player = data?.player;

  const cardStyle = useMemo(
    () => ({
      backgroundColor: isDark ? colors.cardDark : colors.cardLight,
      maxWidth: width > 768 ? 400 : width - 32,
    }),
    [isDark, colors, width]
  );

  const formattedStats = useMemo(
    () => player?.stats?.map(s => ({
      ...s,
      displayValue: formatStatValue(s.value, s.type),
    })) ?? [],
    [player?.stats]
  );

  // Handlers
  const handlePress = useCallback(() => {
    if (!playerId) {
      console.error("Cannot navigate: player ID is missing");
      return;
    }
    onPress?.(playerId);
  }, [playerId, onPress]);

  const handleHoverIn = useCallback(() => {
    setIsHovered(true);
  }, []);

  const handleHoverOut = useCallback(() => {
    setIsHovered(false);
  }, []);

  // ========================================
  // 2. SIDE EFFECTS
  // ========================================

  useEffect(() => {
    if (player) {
      console.log("Player card rendered:", player.name);
    }
  }, [player]);

  // ========================================
  // 3. RETURN
  // ========================================

  // Early returns are acceptable after side effects
  if (loading) {
    return <LoadingSkeleton />;
  }

  if (error) {
    return <ErrorCard message={error.message} />;
  }

  return (
    <PlayerCardView
      player={player}
      stats={formattedStats}
      cardStyle={cardStyle}
      isHovered={isHovered}
      showDetails={showDetails}
      onPress={handlePress}
      onHoverIn={handleHoverIn}
      onHoverOut={handleHoverOut}
    />
  );
};
```

## Utility Function Structure

### Pure Function Example

```typescript
export const calculateTeamRankings = (
  players: readonly Player[],
  teamId: string
): TeamRanking => {
  // ========================================
  // 1. VARIABLES & DERIVED VALUES
  // ========================================

  const validPlayers = players.filter(p => p.team && p.score != null);

  const teamScores = validPlayers.reduce(
    (acc, player) => {
      const id = player.team.id;
      const existing = acc[id];
      return {
        ...acc,
        [id]: {
          teamId: id,
          totalScore: (existing?.totalScore ?? 0) + player.score,
          count: (existing?.count ?? 0) + 1,
        },
      };
    },
    {} as Record<string, { teamId: string; totalScore: number; count: number }>
  );

  const rankings = Object.values(teamScores).map(t => ({
    teamId: t.teamId,
    avgScore: t.totalScore / t.count,
  }));

  const sorted = [...rankings].sort((a, b) => b.avgScore - a.avgScore);

  const targetRank = sorted.findIndex(r => r.teamId === teamId) + 1;

  // ========================================
  // 2. NO SIDE EFFECTS IN PURE FUNCTIONS
  // ========================================

  // ========================================
  // 3. RETURN
  // ========================================

  return {
    rank: targetRank || null,
    totalTeams: sorted.length,
    avgScore: teamScores[teamId]?.totalScore / teamScores[teamId]?.count ?? 0,
  };
};
```

## Helper Function Extraction

When reducing cognitive complexity, extract helper functions and place them between types and the main component.

### File Structure

```typescript
// ========================================
// TYPES
// ========================================

interface Props {
  readonly players: readonly Player[];
  readonly isDark: boolean;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Renders the loading skeleton state.
 * @param props - Component properties
 * @param props.isDark - Whether dark mode is active
 * @returns Loading skeleton UI
 */
function renderLoadingState(props: { readonly isDark: boolean }) {
  const { isDark } = props;
  return <LoadingSkeleton isDark={isDark} />;
}

/**
 * Renders the empty state when no players exist.
 * @param props - Component properties
 * @param props.message - Message to display
 * @returns Empty state UI
 */
function renderEmptyState(props: { readonly message: string }) {
  const { message } = props;
  return <EmptyState message={message} />;
}

// ========================================
// MAIN COMPONENT
// ========================================

export const PlayerListView = memo(function PlayerListView({
  players,
  isDark,
}: Props) {
  if (!players.length) {
    return renderEmptyState({ message: "No players found" });
  }

  return (
    <Box>
      {players.map(player => (
        <PlayerCard key={player.id} player={player} />
      ))}
    </Box>
  );
});
```

## Common Mistakes

### Wrong: useEffect Before useMemo

```typescript
// WRONG
useEffect(() => {
  console.log("Value:", computedValue);
}, [computedValue]);

const computedValue = useMemo(() => calculate(data), [data]);

// CORRECT
const computedValue = useMemo(() => calculate(data), [data]);

useEffect(() => {
  console.log("Value:", computedValue);
}, [computedValue]);
```

### Wrong: Return Before useEffect

```typescript
// WRONG
const Component = () => {
  const data = useData();

  if (!data) {
    return null; // Early return before useEffect!
  }

  useEffect(() => {
    // This breaks the rules of hooks
  }, []);

  return <View />;
};

// CORRECT
const Component = () => {
  const data = useData();

  useEffect(() => {
    if (data) {
      // Handle data
    }
  }, [data]);

  if (!data) {
    return null;
  }

  return <View />;
};
```

### Wrong: Handler Definition After useEffect

```typescript
// WRONG
useEffect(() => {
  handleInit();
}, [handleInit]);

const handleInit = useCallback(() => {
  // ...
}, []);

// CORRECT
const handleInit = useCallback(() => {
  // ...
}, []);

useEffect(() => {
  handleInit();
}, [handleInit]);
```
