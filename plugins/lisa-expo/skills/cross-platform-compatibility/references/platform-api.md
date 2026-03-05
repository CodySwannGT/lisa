# Platform Module API Reference

This reference documents the React Native Platform module for cross-platform development.

## Table of Contents

- [Platform.OS](#platformos)
- [Platform.select()](#platformselect)
- [Platform.Version](#platformversion)
- [Platform.isPad / Platform.isTV](#platformispad--platformistv)
- [Best Practices](#best-practices)

## Platform.OS

Returns the current platform as a string.

```tsx
import { Platform } from "react-native";

// Values: "ios" | "android" | "web" | "windows" | "macos"
const currentPlatform = Platform.OS;
```

### Usage Patterns

**Simple Conditional:**

```tsx
if (Platform.OS === "web") {
  // Web-only code
}
```

**Ternary Expression:**

```tsx
const buttonText = Platform.OS === "ios" ? "Done" : "OK";
```

**Switch Statement (for complex logic):**

```tsx
switch (Platform.OS) {
  case "ios":
    return handleIOS();
  case "android":
    return handleAndroid();
  case "web":
    return handleWeb();
  default:
    return handleDefault();
}
```

## Platform.select()

Returns platform-specific values from an object. Preferred for style objects and configuration.

```tsx
import { Platform, StyleSheet } from "react-native";

const styles = StyleSheet.create({
  container: {
    flex: 1,
    ...Platform.select({
      ios: {
        backgroundColor: "systemBackground",
      },
      android: {
        backgroundColor: "#FFFFFF",
      },
      web: {
        backgroundColor: "#FAFAFA",
      },
      default: {
        backgroundColor: "#FFFFFF",
      },
    }),
  },
});
```

### Key Features

- **default key**: Used when no platform-specific value matches
- **native key**: Shorthand for iOS + Android (not web)
- **Returns undefined**: If platform not found and no default

```tsx
// Using 'native' for iOS + Android
Platform.select({
  native: { padding: 20 },
  web: { padding: 16 },
});

// Using 'default' as fallback
Platform.select({
  ios: "iOS specific",
  default: "Everything else",
});
```

## Platform.Version

Returns the platform version.

```tsx
// iOS: Returns iOS version number (e.g., 17.0)
// Android: Returns API level (e.g., 33)
// Web: Returns undefined

if (Platform.OS === "android" && Platform.Version >= 33) {
  // Android 13+ specific code
}

if (Platform.OS === "ios" && parseInt(Platform.Version, 10) >= 17) {
  // iOS 17+ specific code
}
```

## Platform.isPad / Platform.isTV

Boolean values for device type detection (iOS only).

```tsx
if (Platform.OS === "ios" && Platform.isPad) {
  // iPad-specific layout
}

if (Platform.OS === "ios" && Platform.isTV) {
  // Apple TV specific code
}
```

## Best Practices

### 1. Always Handle All Platforms

```tsx
// BAD: Only checks for web, undefined behavior on other platforms
if (Platform.OS === "web") {
  doWebThing();
}
// What happens on iOS/Android?

// GOOD: Explicit handling or default
if (Platform.OS === "web") {
  doWebThing();
} else {
  doNativeThing();
}

// BETTER: Use Platform.select with default
const behavior = Platform.select({
  web: doWebThing,
  default: doNativeThing,
});
```

### 2. Prefer Platform.select for Objects

```tsx
// BAD: Verbose conditionals
const shadowStyle =
  Platform.OS === "ios"
    ? { shadowColor: "#000" }
    : Platform.OS === "android"
      ? { elevation: 4 }
      : { boxShadow: "0 2px 4px rgba(0,0,0,0.1)" };

// GOOD: Clean Platform.select
const shadowStyle = Platform.select({
  ios: { shadowColor: "#000", shadowOpacity: 0.25 },
  android: { elevation: 4 },
  web: { boxShadow: "0 2px 4px rgba(0,0,0,0.1)" },
});
```

### 3. Use Type Guards for TypeScript

```tsx
/**
 * Type guard for web platform.
 */
const isWeb = Platform.OS === "web";

/**
 * Type guard for native platforms.
 */
const isNative = Platform.OS === "ios" || Platform.OS === "android";

// Usage
if (isWeb) {
  // TypeScript knows this is web context
}
```

### 4. Extract Platform Logic to Utilities

```tsx
// utils/platform.ts

/**
 * Checks if the current platform is web.
 */
export const isWeb = () => Platform.OS === "web";

/**
 * Checks if the current platform is native (iOS or Android).
 */
export const isNative = () => Platform.OS === "ios" || Platform.OS === "android";

/**
 * Checks if the current platform is iOS.
 */
export const isIOS = () => Platform.OS === "ios";

/**
 * Checks if the current platform is Android.
 */
export const isAndroid = () => Platform.OS === "android";

/**
 * Returns platform-specific value.
 */
export const platformValue = <T>(config: {
  readonly ios?: T;
  readonly android?: T;
  readonly web?: T;
  readonly native?: T;
  readonly default?: T;
}): T | undefined => Platform.select(config);
```

### 5. Avoid Nested Platform Checks

```tsx
// BAD: Nested and hard to read
if (Platform.OS === "ios") {
  if (Platform.Version >= 17) {
    // ...
  }
} else if (Platform.OS === "android") {
  if (Platform.Version >= 33) {
    // ...
  }
}

// GOOD: Extract to named functions
const supportsNewFeature = () => {
  if (Platform.OS === "ios") return parseInt(Platform.Version, 10) >= 17;
  if (Platform.OS === "android") return Platform.Version >= 33;
  return true; // Web always supports
};

if (supportsNewFeature()) {
  // ...
}
```

### 6. Document Platform-Specific Behavior

```tsx
/**
 * Saves an image to the device.
 *
 * @remarks
 * - iOS/Android: Saves to device media library
 * - Web: Triggers browser download
 *
 * @param imageRef - Reference to the view to capture
 */
const saveImage = async (imageRef: React.RefObject<View>) => {
  // Implementation
};
```
