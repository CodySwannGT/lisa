# AsyncStorage Reference

## Overview

AsyncStorage is an asynchronous, unencrypted, persistent key-value storage system for React Native. The community package `@react-native-async-storage/async-storage` is the standard solution for Expo projects.

## Key Characteristics

- **Asynchronous**: All operations return Promises (non-blocking)
- **String-only**: Stores only string values (JSON serialization required for objects)
- **Persistent**: Data survives app restarts
- **Unencrypted**: Not suitable for sensitive data
- **Size limits**: ~6 MB total storage, ~2 MB per record (varies by platform)

## Core API

### Basic Operations

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";

// Set a value
await AsyncStorage.setItem("@app:key", "string value");

// Get a value (returns string | null)
const value = await AsyncStorage.getItem("@app:key");

// Remove a value
await AsyncStorage.removeItem("@app:key");

// Get all keys
const allKeys = await AsyncStorage.getAllKeys();

// Clear all storage (use with caution)
await AsyncStorage.clear();
```

### Batch Operations

More efficient than multiple single operations:

```typescript
// Get multiple values
const keyValuePairs = await AsyncStorage.multiGet([
  "@app:user-prefs",
  "@app:filters",
  "@app:theme",
]);
// Returns: [["@app:user-prefs", "..."], ["@app:filters", "..."], ...]

// Set multiple values
await AsyncStorage.multiSet([
  ["@app:user-prefs", JSON.stringify(prefs)],
  ["@app:filters", JSON.stringify(filters)],
]);

// Remove multiple keys
await AsyncStorage.multiRemove(["@app:temp-data", "@app:cache"]);

// Merge values (shallow merge for JSON objects)
await AsyncStorage.multiMerge([
  ["@app:user", JSON.stringify({ name: "John" })],
  ["@app:user", JSON.stringify({ age: 30 })],
]);
// Result: { name: "John", age: 30 }
```

## Type-Safe Utilities

### Generic Storage Functions

```typescript
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Save typed data to AsyncStorage with error handling
 * @param key - Storage key (should include namespace prefix)
 * @param value - Value to store (will be JSON stringified)
 */
export const saveToStorage = async <T>(
  key: string,
  value: T
): Promise<void> => {
  try {
    const jsonValue = JSON.stringify(value);
    await AsyncStorage.setItem(key, jsonValue);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to save ${key}:`, message);
    throw error;
  }
};

/**
 * Load typed data from AsyncStorage with error handling
 * @param key - Storage key
 * @param defaultValue - Default value if key doesn't exist or parsing fails
 * @returns Parsed value or default
 */
export const loadFromStorage = async <T>(
  key: string,
  defaultValue: T
): Promise<T> => {
  try {
    const jsonValue = await AsyncStorage.getItem(key);
    if (jsonValue === null) {
      return defaultValue;
    }
    return JSON.parse(jsonValue) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to load ${key}:`, message);
    return defaultValue;
  }
};

/**
 * Remove data from AsyncStorage
 * @param key - Storage key to remove
 */
export const removeFromStorage = async (key: string): Promise<void> => {
  try {
    await AsyncStorage.removeItem(key);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`Failed to remove ${key}:`, message);
  }
};
```

### Result-Based Error Handling

For operations where you need to know if they succeeded:

```typescript
interface StorageResult<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly error?: string;
}

/**
 * Safely get item with success/failure result
 */
export const safeGetItem = async <T>(
  key: string,
  defaultValue: T
): Promise<StorageResult<T>> => {
  try {
    const jsonValue = await AsyncStorage.getItem(key);
    if (jsonValue === null) {
      return { success: true, data: defaultValue };
    }
    const parsed = JSON.parse(jsonValue) as T;
    return { success: true, data: parsed };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: errorMessage, data: defaultValue };
  }
};

/**
 * Safely set item with success/failure result
 */
export const safeSetItem = async <T>(
  key: string,
  value: T
): Promise<StorageResult<void>> => {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
    return { success: true };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: errorMessage };
  }
};

// Usage
const result = await safeGetItem<UserPrefs>("@app:prefs", DEFAULT_PREFS);
if (!result.success) {
  console.warn("Storage read failed:", result.error);
}
const prefs = result.data;
```

## Key Naming Conventions

### Namespace Prefix

Always use a namespace prefix to avoid collisions with other libraries:

```typescript
// Project namespace
const STORAGE_PREFIX = "@whatever";

// Key examples
const KEYS = {
  USER_PREFERENCES: `${STORAGE_PREFIX}:user-preferences`,
  FILTER_VALUES: `${STORAGE_PREFIX}:filter-values`,
  FEATURE_FLAGS: `${STORAGE_PREFIX}:feature-flags`,
  ONBOARDING_COMPLETE: `${STORAGE_PREFIX}:onboarding-complete`,
} as const;
```

### Key Organization

```typescript
// Feature-scoped keys
const PLAYER_KEYS = {
  FAVORITES: "@whatever:players:favorites",
  RECENT_VIEWS: "@whatever:players:recent-views",
  COMPARISONS: "@whatever:players:comparisons",
} as const;

const SETTINGS_KEYS = {
  THEME: "@whatever:settings:theme",
  LANGUAGE: "@whatever:settings:language",
  NOTIFICATIONS: "@whatever:settings:notifications",
} as const;
```

## Error Handling Patterns

### Always Use Try/Catch

AsyncStorage operations can fail for various reasons (storage full, permissions, corrupted data):

```typescript
// CORRECT - proper error handling
const loadSettings = async (): Promise<Settings> => {
  try {
    const stored = await AsyncStorage.getItem(SETTINGS_KEY);
    if (stored) {
      return JSON.parse(stored) as Settings;
    }
    return DEFAULT_SETTINGS;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to load settings:", message);
    return DEFAULT_SETTINGS; // Graceful fallback
  }
};

// INCORRECT - unhandled errors can crash the app
const loadSettings = async (): Promise<Settings> => {
  const stored = await AsyncStorage.getItem(SETTINGS_KEY);
  return stored ? JSON.parse(stored) : DEFAULT_SETTINGS;
};
```

### Handle JSON Parse Errors Separately

```typescript
const loadData = async <T>(key: string, defaultValue: T): Promise<T> => {
  try {
    const jsonValue = await AsyncStorage.getItem(key);
    if (jsonValue === null) {
      return defaultValue;
    }

    try {
      return JSON.parse(jsonValue) as T;
    } catch (parseError) {
      // Corrupted data - clear and return default
      console.warn(`Corrupted data for ${key}, resetting to default`);
      await AsyncStorage.removeItem(key);
      return defaultValue;
    }
  } catch (storageError) {
    const message =
      storageError instanceof Error ? storageError.message : "Unknown error";
    console.error(`Storage error for ${key}:`, message);
    return defaultValue;
  }
};
```

## Security Considerations

### Never Store Sensitive Data

AsyncStorage is unencrypted and readable by anyone with device access:

```typescript
// NEVER store these in AsyncStorage:
// - Access tokens
// - Refresh tokens
// - Passwords
// - API keys
// - Personal identification numbers
// - Financial data

// Use expo-secure-store instead:
import * as SecureStore from "expo-secure-store";

const saveToken = async (token: string): Promise<void> => {
  await SecureStore.setItemAsync("accessToken", token);
};

const getToken = async (): Promise<string | null> => {
  return await SecureStore.getItemAsync("accessToken");
};
```

### What IS Safe for AsyncStorage

- User preferences (theme, language, notifications)
- Feature flags
- UI state (last viewed tab, collapsed sections)
- Non-sensitive cache data
- Onboarding completion flags
- Search history (non-sensitive queries)

## Performance Best Practices

### Use Batch Operations

```typescript
// EFFICIENT - single batch operation
await AsyncStorage.multiSet([
  ["@app:pref1", JSON.stringify(pref1)],
  ["@app:pref2", JSON.stringify(pref2)],
  ["@app:pref3", JSON.stringify(pref3)],
]);

// INEFFICIENT - multiple sequential operations
await AsyncStorage.setItem("@app:pref1", JSON.stringify(pref1));
await AsyncStorage.setItem("@app:pref2", JSON.stringify(pref2));
await AsyncStorage.setItem("@app:pref3", JSON.stringify(pref3));
```

### Debounce Frequent Writes

For values that change frequently (e.g., form inputs):

```typescript
import { useDebouncedCallback } from "use-debounce";

const usePersistedFilter = () => {
  const [filter, setFilter] = useState("");

  const persistFilter = useDebouncedCallback(
    async (value: string) => {
      try {
        await AsyncStorage.setItem("@app:filter", value);
      } catch (error) {
        console.error("Failed to persist filter");
      }
    },
    500 // 500ms debounce
  );

  const updateFilter = useCallback(
    (value: string) => {
      setFilter(value);
      persistFilter(value);
    },
    [persistFilter]
  );

  return { filter, updateFilter };
};
```

### Load Only What You Need

```typescript
// EFFICIENT - load specific keys
const loadUserContext = async () => {
  const keys = ["@app:user-prefs", "@app:theme"];
  const results = await AsyncStorage.multiGet(keys);
  return results.reduce(
    (acc, [key, value]) => ({
      ...acc,
      [key]: value ? JSON.parse(value) : null,
    }),
    {} as Record<string, unknown>
  );
};

// INEFFICIENT - loading all keys
const loadEverything = async () => {
  const allKeys = await AsyncStorage.getAllKeys();
  const allData = await AsyncStorage.multiGet(allKeys);
  // Processing potentially hundreds of keys...
};
```

### Consider Storage Limits

```typescript
// Check data size before storing
const safeStore = async <T>(key: string, data: T): Promise<boolean> => {
  const serialized = JSON.stringify(data);
  const sizeInBytes = new Blob([serialized]).size;

  // Warn if approaching 2MB limit per key
  if (sizeInBytes > 1_500_000) {
    console.warn(
      `Data for ${key} is ${(sizeInBytes / 1_000_000).toFixed(2)}MB`
    );
  }

  if (sizeInBytes > 2_000_000) {
    console.error(`Data for ${key} exceeds 2MB limit, not storing`);
    return false;
  }

  try {
    await AsyncStorage.setItem(key, serialized);
    return true;
  } catch (error) {
    console.error("Storage failed:", error);
    return false;
  }
};
```

## Migration Patterns

### Versioned Storage Keys

```typescript
const STORAGE_VERSION = "v2";
const PREFS_KEY = `@app:preferences:${STORAGE_VERSION}`;

// Migration on app start
const migrateStorageIfNeeded = async (): Promise<void> => {
  const allKeys = await AsyncStorage.getAllKeys();

  // Find old version keys
  const oldKeys = allKeys.filter(
    key => key.startsWith("@app:preferences:") && !key.includes(STORAGE_VERSION)
  );

  if (oldKeys.length === 0) return;

  // Migrate each old key
  const migrations = oldKeys.map(async oldKey => {
    try {
      const oldData = await AsyncStorage.getItem(oldKey);
      if (oldData) {
        const parsed = JSON.parse(oldData);
        const migrated = migratePreferences(parsed); // Your migration logic
        await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(migrated));
      }
      await AsyncStorage.removeItem(oldKey);
    } catch (error) {
      console.error(`Failed to migrate ${oldKey}:`, error);
    }
  });

  await Promise.all(migrations);
};
```

### Schema Validation

```typescript
interface StoredPreferences {
  readonly theme: "light" | "dark";
  readonly language: string;
  readonly schemaVersion: number;
}

const CURRENT_SCHEMA_VERSION = 2;

const isValidPreferences = (data: unknown): data is StoredPreferences => {
  if (typeof data !== "object" || data === null) return false;
  const obj = data as Record<string, unknown>;
  return (
    (obj.theme === "light" || obj.theme === "dark") &&
    typeof obj.language === "string" &&
    typeof obj.schemaVersion === "number"
  );
};

const loadPreferences = async (): Promise<StoredPreferences> => {
  try {
    const stored = await AsyncStorage.getItem(PREFS_KEY);
    if (!stored) return DEFAULT_PREFERENCES;

    const parsed = JSON.parse(stored);

    if (!isValidPreferences(parsed)) {
      console.warn("Invalid preferences schema, resetting");
      await AsyncStorage.removeItem(PREFS_KEY);
      return DEFAULT_PREFERENCES;
    }

    if (parsed.schemaVersion < CURRENT_SCHEMA_VERSION) {
      const migrated = migrateToCurrentSchema(parsed);
      await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(migrated));
      return migrated;
    }

    return parsed;
  } catch (error) {
    console.error("Failed to load preferences:", error);
    return DEFAULT_PREFERENCES;
  }
};
```
