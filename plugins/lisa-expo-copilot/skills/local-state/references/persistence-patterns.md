# Persistence Patterns Reference

## Overview

This reference covers patterns for persisting reactive variables to AsyncStorage, ensuring that local state survives app restarts while maintaining reactive UI updates.

## Why Persistence is Needed

Reactive variables are in-memory only. When the app restarts:

- All reactive variable values reset to their defaults
- User preferences are lost
- Feature flag states reset
- Filter selections disappear

Persistence bridges this gap by saving state to AsyncStorage and restoring it on app launch.

## Pattern 1: Immediate Persistence

Update storage immediately on every change. Best for critical user preferences that must never be lost.

### Implementation

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import { makeVar, useReactiveVar } from "@apollo/client";
import { useCallback, useEffect } from "react";

// Types
interface IUserPreferences {
  readonly theme: "light" | "dark";
  readonly language: string;
  readonly notifications: boolean;
}

// Constants
const STORAGE_KEY = "@whatever:user-preferences";
const DEFAULT_PREFERENCES: IUserPreferences = {
  theme: "light",
  language: "en",
  notifications: true,
};

// Reactive Variable
export const userPreferencesVar =
  makeVar<IUserPreferences>(DEFAULT_PREFERENCES);

/**
 * Update preferences and immediately persist to storage
 * @param updates - Partial preferences to merge
 */
const updatePreferences = async (
  updates: Partial<IUserPreferences>
): Promise<void> => {
  const current = userPreferencesVar();
  const newPrefs: IUserPreferences = { ...current, ...updates };

  // Update reactive variable first (immediate UI update)
  userPreferencesVar(newPrefs);

  // Persist to storage (async, but starts immediately)
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newPrefs));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to persist preferences:", message);
    // Note: UI already updated, storage just failed to persist
  }
};

/**
 * Load persisted preferences on app start
 */
export const loadUserPreferences = async (): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<IUserPreferences>;
      // Merge with defaults to handle missing fields from older versions
      userPreferencesVar({ ...DEFAULT_PREFERENCES, ...parsed });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to load preferences:", message);
  }
};

/**
 * Custom hook for consuming and updating preferences
 */
export const useUserPreferences = () => {
  const preferences = useReactiveVar(userPreferencesVar);

  const setTheme = useCallback((theme: "light" | "dark") => {
    updatePreferences({ theme });
  }, []);

  const setLanguage = useCallback((language: string) => {
    updatePreferences({ language });
  }, []);

  const setNotifications = useCallback((notifications: boolean) => {
    updatePreferences({ notifications });
  }, []);

  return {
    preferences,
    setTheme,
    setLanguage,
    setNotifications,
  };
};
```

### App Initialization

```typescript
// In root layout or app entry
import { useEffect } from "react";
import { loadUserPreferences } from "@/features/settings/stores/userPreferences";

export default function RootLayout() {
  useEffect(() => {
    loadUserPreferences();
  }, []);

  return (
    // ... app content
  );
}
```

### When to Use

- User preferences that are critical
- Settings that affect app behavior immediately
- Data that users expect to persist always

### Trade-offs

- **Pro**: Data is always persisted, minimal data loss risk
- **Con**: More storage operations, potential performance impact with frequent changes

## Pattern 2: AppState-Based Persistence

Save to storage when app goes to background. Better for non-critical state that changes frequently.

### Implementation

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import { makeVar, useReactiveVar } from "@apollo/client";
import { useEffect, useCallback } from "react";
import { AppState, AppStateStatus } from "react-native";

// Types
interface IFilterState {
  readonly minAge: number;
  readonly maxAge: number;
  readonly positions: readonly string[];
  readonly teams: readonly string[];
}

// Constants
const STORAGE_KEY = "@whatever:filter-state";
const DEFAULT_FILTERS: IFilterState = {
  minAge: 18,
  maxAge: 40,
  positions: [],
  teams: [],
};

// Reactive Variable
export const filterStateVar = makeVar<IFilterState>(DEFAULT_FILTERS);

/**
 * Load persisted filter state on app start
 */
const loadFilterState = async (): Promise<void> => {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Partial<IFilterState>;
      filterStateVar({ ...DEFAULT_FILTERS, ...parsed });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to load filter state:", message);
  }
};

/**
 * Save filter state to storage
 */
const saveFilterState = async (): Promise<void> => {
  try {
    const current = filterStateVar();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to save filter state:", message);
  }
};

/**
 * Hook to set up persistence lifecycle
 * Call once in a top-level component
 */
export const useFilterStatePersistence = (): void => {
  useEffect(() => {
    // Load on mount
    loadFilterState();

    // Save on background/inactive
    const handleAppStateChange = (nextAppState: AppStateStatus): void => {
      if (nextAppState === "background" || nextAppState === "inactive") {
        saveFilterState();
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange
    );

    return () => {
      // Save on unmount as well
      saveFilterState();
      subscription.remove();
    };
  }, []);
};

/**
 * Custom hook for consuming and updating filters
 */
export const useFilterState = () => {
  const filters = useReactiveVar(filterStateVar);

  const setMinAge = useCallback((minAge: number) => {
    filterStateVar({ ...filterStateVar(), minAge });
  }, []);

  const setMaxAge = useCallback((maxAge: number) => {
    filterStateVar({ ...filterStateVar(), maxAge });
  }, []);

  const togglePosition = useCallback((position: string) => {
    const current = filterStateVar();
    const positions = current.positions.includes(position)
      ? current.positions.filter(p => p !== position)
      : [...current.positions, position];
    filterStateVar({ ...current, positions });
  }, []);

  const resetFilters = useCallback(() => {
    filterStateVar(DEFAULT_FILTERS);
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

### When to Use

- Filter states and UI preferences
- Data that changes frequently during a session
- Non-critical state where occasional loss is acceptable

### Trade-offs

- **Pro**: Fewer storage operations, better performance for frequently changing data
- **Con**: Risk of data loss if app crashes before backgrounding

## Pattern 3: Debounced Persistence

Persist after a delay following the last change. Good for data that changes in bursts.

### Implementation

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import { makeVar, useReactiveVar } from "@apollo/client";
import { useCallback, useEffect, useRef } from "react";

// Types
interface ISearchHistory {
  readonly queries: readonly string[];
  readonly lastUpdated: string;
}

// Constants
const STORAGE_KEY = "@whatever:search-history";
const DEBOUNCE_MS = 1000;
const MAX_HISTORY_ITEMS = 20;
const DEFAULT_HISTORY: ISearchHistory = {
  queries: [],
  lastUpdated: new Date().toISOString(),
};

// Reactive Variable
export const searchHistoryVar = makeVar<ISearchHistory>(DEFAULT_HISTORY);

/**
 * Custom hook with debounced persistence
 */
export const useSearchHistory = () => {
  const history = useReactiveVar(searchHistoryVar);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load on mount
  useEffect(() => {
    const loadHistory = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as ISearchHistory;
          searchHistoryVar(parsed);
        }
      } catch (error) {
        console.error("Failed to load search history:", error);
      }
    };
    loadHistory();
  }, []);

  // Debounced save function
  const scheduleSave = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        const current = searchHistoryVar();
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
      } catch (error) {
        console.error("Failed to save search history:", error);
      }
    }, DEBOUNCE_MS);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        // Final save on unmount
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(searchHistoryVar()));
      }
    };
  }, []);

  const addQuery = useCallback(
    (query: string) => {
      const current = searchHistoryVar();
      const trimmedQuery = query.trim();

      if (!trimmedQuery) return;

      // Remove duplicate if exists, add to front
      const filtered = current.queries.filter(q => q !== trimmedQuery);
      const queries = [trimmedQuery, ...filtered].slice(0, MAX_HISTORY_ITEMS);

      searchHistoryVar({
        queries,
        lastUpdated: new Date().toISOString(),
      });

      scheduleSave();
    },
    [scheduleSave]
  );

  const clearHistory = useCallback(() => {
    searchHistoryVar(DEFAULT_HISTORY);
    scheduleSave();
  }, [scheduleSave]);

  return {
    queries: history.queries,
    addQuery,
    clearHistory,
  };
};
```

### When to Use

- Search history or recent items
- Form draft auto-save
- Any data with burst updates

### Trade-offs

- **Pro**: Optimal balance between persistence and performance
- **Con**: More complex implementation, potential for lost updates during debounce window

## Pattern 4: Context Provider with Persistence

For state that needs to be available throughout the app with persistence.

### Implementation

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  ReactNode,
} from "react";

// Types
interface IFeatureFlags {
  readonly darkModeEnabled: boolean;
  readonly betaFeaturesEnabled: boolean;
  readonly debugModeEnabled: boolean;
}

interface IFeatureFlagsContext extends IFeatureFlags {
  readonly isLoaded: boolean;
  readonly setDarkModeEnabled: (enabled: boolean) => void;
  readonly setBetaFeaturesEnabled: (enabled: boolean) => void;
  readonly setDebugModeEnabled: (enabled: boolean) => void;
}

// Constants
const STORAGE_KEY = "@whatever:feature-flags";
const DEFAULT_FLAGS: IFeatureFlags = {
  darkModeEnabled: false,
  betaFeaturesEnabled: false,
  debugModeEnabled: false,
};

// Context
const FeatureFlagsContext = createContext<IFeatureFlagsContext | null>(null);

interface ProviderProps {
  readonly children: ReactNode;
}

/**
 * Feature flags provider with AsyncStorage persistence
 */
export const FeatureFlagsProvider = ({ children }: ProviderProps) => {
  const [flags, setFlags] = useState<IFeatureFlags>(DEFAULT_FLAGS);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load from storage on mount
  useEffect(() => {
    const loadFlags = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<IFeatureFlags>;
          setFlags(prev => ({ ...prev, ...parsed }));
        }
      } catch (error) {
        console.error("Failed to load feature flags:", error);
      } finally {
        setIsLoaded(true);
      }
    };
    loadFlags();
  }, []);

  // Save helper
  const saveFlags = useCallback(async (newFlags: IFeatureFlags) => {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newFlags));
    } catch (error) {
      console.error("Failed to save feature flags:", error);
    }
  }, []);

  // Individual setters
  const setDarkModeEnabled = useCallback(
    (enabled: boolean) => {
      setFlags(prev => {
        const newFlags = { ...prev, darkModeEnabled: enabled };
        saveFlags(newFlags);
        return newFlags;
      });
    },
    [saveFlags]
  );

  const setBetaFeaturesEnabled = useCallback(
    (enabled: boolean) => {
      setFlags(prev => {
        const newFlags = { ...prev, betaFeaturesEnabled: enabled };
        saveFlags(newFlags);
        return newFlags;
      });
    },
    [saveFlags]
  );

  const setDebugModeEnabled = useCallback(
    (enabled: boolean) => {
      setFlags(prev => {
        const newFlags = { ...prev, debugModeEnabled: enabled };
        saveFlags(newFlags);
        return newFlags;
      });
    },
    [saveFlags]
  );

  const contextValue = useMemo(
    (): IFeatureFlagsContext => ({
      ...flags,
      isLoaded,
      setDarkModeEnabled,
      setBetaFeaturesEnabled,
      setDebugModeEnabled,
    }),
    [flags, isLoaded, setDarkModeEnabled, setBetaFeaturesEnabled, setDebugModeEnabled]
  );

  return (
    <FeatureFlagsContext.Provider value={contextValue}>
      {children}
    </FeatureFlagsContext.Provider>
  );
};

/**
 * Hook to consume feature flags
 * @throws Error if used outside provider
 */
export const useFeatureFlags = (): IFeatureFlagsContext => {
  const context = useContext(FeatureFlagsContext);
  if (!context) {
    throw new Error("useFeatureFlags must be used within FeatureFlagsProvider");
  }
  return context;
};
```

### Usage

```typescript
// In app root
export default function RootLayout() {
  return (
    <FeatureFlagsProvider>
      <App />
    </FeatureFlagsProvider>
  );
}

// In any component
const SettingsScreen = () => {
  const { darkModeEnabled, setDarkModeEnabled, isLoaded } = useFeatureFlags();

  if (!isLoaded) {
    return <LoadingSpinner />;
  }

  return (
    <Switch
      value={darkModeEnabled}
      onValueChange={setDarkModeEnabled}
    />
  );
};
```

### When to Use

- Feature flags
- App-wide settings
- State that needs to be accessed before Apollo Client initializes

### Trade-offs

- **Pro**: Works without Apollo Client, clear loading state
- **Con**: More boilerplate, separate from Apollo ecosystem

## Choosing the Right Pattern

| Pattern          | Best For           | Performance         | Reliability |
| ---------------- | ------------------ | ------------------- | ----------- |
| Immediate        | Critical user data | Lower (more writes) | Highest     |
| AppState-based   | Frequent changes   | Higher              | Medium      |
| Debounced        | Burst updates      | Highest             | Medium      |
| Context Provider | Non-Apollo state   | Medium              | High        |

## Combined Pattern Example

For complex features, combine patterns:

```typescript
// stores/playerFilters.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { makeVar, useReactiveVar } from "@apollo/client";
import { useCallback, useEffect, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";

interface IPlayerFilters {
  readonly minAge: number;
  readonly maxAge: number;
  readonly positions: readonly string[];
  readonly searchQuery: string;
}

const STORAGE_KEY = "@whatever:player-filters";
const SEARCH_DEBOUNCE_MS = 300;
const DEFAULT_FILTERS: IPlayerFilters = {
  minAge: 18,
  maxAge: 45,
  positions: [],
  searchQuery: "",
};

export const playerFiltersVar = makeVar<IPlayerFilters>(DEFAULT_FILTERS);

export const usePlayerFilters = () => {
  const filters = useReactiveVar(playerFiltersVar);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load on mount
  useEffect(() => {
    const load = async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<IPlayerFilters>;
          playerFiltersVar({ ...DEFAULT_FILTERS, ...parsed });
        }
      } catch (error) {
        console.error("Failed to load filters:", error);
      }
    };
    load();
  }, []);

  // Save on background (for non-search fields)
  useEffect(() => {
    const handleAppState = (state: AppStateStatus) => {
      if (state === "background") {
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(playerFiltersVar()));
      }
    };

    const sub = AppState.addEventListener("change", handleAppState);
    return () => sub.remove();
  }, []);

  // Immediate save for critical changes (positions)
  const togglePosition = useCallback((position: string) => {
    const current = playerFiltersVar();
    const positions = current.positions.includes(position)
      ? current.positions.filter(p => p !== position)
      : [...current.positions, position];

    const newFilters = { ...current, positions };
    playerFiltersVar(newFilters);

    // Immediate persist for position changes
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(newFilters));
  }, []);

  // Debounced for search query
  const setSearchQuery = useCallback((searchQuery: string) => {
    playerFiltersVar({ ...playerFiltersVar(), searchQuery });

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    searchTimeoutRef.current = setTimeout(() => {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(playerFiltersVar()));
    }, SEARCH_DEBOUNCE_MS);
  }, []);

  // Standard setters (saved on background)
  const setMinAge = useCallback((minAge: number) => {
    playerFiltersVar({ ...playerFiltersVar(), minAge });
  }, []);

  const setMaxAge = useCallback((maxAge: number) => {
    playerFiltersVar({ ...playerFiltersVar(), maxAge });
  }, []);

  return {
    filters,
    setMinAge,
    setMaxAge,
    togglePosition,
    setSearchQuery,
  };
};
```

This combined approach uses:

- **AppState persistence** for age filters (saved on background)
- **Immediate persistence** for position toggles (critical user selections)
- **Debounced persistence** for search query (changes with every keystroke)
