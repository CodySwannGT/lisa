# Common Cross-Platform Issues and Solutions

This reference documents common cross-platform compatibility issues in Expo apps and their solutions.

## Table of Contents

- [API Compatibility Issues](#api-compatibility-issues)
- [Style and Layout Issues](#style-and-layout-issues)
- [Navigation Issues](#navigation-issues)
- [Gesture and Input Issues](#gesture-and-input-issues)
- [Media and File Issues](#media-and-file-issues)
- [Storage Issues](#storage-issues)
- [Debugging Platform Issues](#debugging-platform-issues)

## API Compatibility Issues

### MediaLibrary (Not Supported on Web)

**Issue:** `expo-media-library` has no web implementation.

```tsx
// ❌ Crashes on web
import * as MediaLibrary from "expo-media-library";
await MediaLibrary.saveToLibraryAsync(uri);
```

**Solution:**

```tsx
import { Platform } from "react-native";
import * as MediaLibrary from "expo-media-library";

const saveImage = async (uri: string, filename: string) => {
  if (Platform.OS === "web") {
    // Download via browser
    const link = document.createElement("a");
    link.href = uri;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    await MediaLibrary.saveToLibraryAsync(uri);
  }
};
```

### View Capture (Different Libraries per Platform)

**Issue:** `react-native-view-shot` doesn't work on web.

**Solution:**

```tsx
import { Platform } from "react-native";
import { captureRef } from "react-native-view-shot";

const captureView = async (ref: React.RefObject<View>) => {
  if (Platform.OS === "web") {
    const domToImage = await import("dom-to-image");
    return await domToImage.default.toJpeg(
      ref.current as unknown as HTMLElement
    );
  }
  return await captureRef(ref, { format: "jpg", quality: 0.9 });
};
```

### Haptics (No Web Support)

**Issue:** `expo-haptics` has no effect on web.

**Solution:**

```tsx
import { Platform } from "react-native";
import * as Haptics from "expo-haptics";

const triggerFeedback = () => {
  if (Platform.OS !== "web") {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }
  // Optionally add visual feedback for web
};
```

### Share API (Limited Web Support)

**Issue:** `Share.share()` has limited web support.

**Solution:**

```tsx
import { Platform, Share } from "react-native";

const shareContent = async (content: {
  title: string;
  message: string;
  url?: string;
}) => {
  if (Platform.OS === "web") {
    if (navigator.share) {
      await navigator.share({
        title: content.title,
        text: content.message,
        url: content.url,
      });
    } else {
      // Fallback: copy to clipboard
      await navigator.clipboard.writeText(content.url ?? content.message);
      alert("Link copied to clipboard!");
    }
  } else {
    await Share.share(content);
  }
};
```

### Linking (Behavior Differences)

**Issue:** `Linking.openURL()` works but behaves differently across platforms.

**Solution:**

```tsx
import { Linking, Platform } from "react-native";

const openExternalURL = (url: string, options?: { newTab?: boolean }) => {
  if (Platform.OS === "web" && options?.newTab) {
    window.open(url, "_blank", "noopener,noreferrer");
  } else {
    Linking.openURL(url);
  }
};
```

## Style and Layout Issues

### Shadows

**Issue:** Shadow properties differ significantly between platforms.

```tsx
// ❌ iOS shadows don't work on Android or web
const styles = StyleSheet.create({
  card: {
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
});
```

**Solution:**

```tsx
import { Platform, StyleSheet } from "react-native";

const createShadow = (elevation: number, color = "#000", opacity = 0.25) =>
  Platform.select({
    ios: {
      shadowColor: color,
      shadowOffset: { width: 0, height: elevation / 2 },
      shadowOpacity: opacity,
      shadowRadius: elevation,
    },
    android: {
      elevation,
    },
    web: {
      boxShadow: `0 ${elevation / 2}px ${elevation}px rgba(0,0,0,${opacity})`,
    },
  });

const styles = StyleSheet.create({
  card: {
    ...createShadow(4),
  },
});
```

### StatusBar Height

**Issue:** Status bar height varies and affects layout.

**Solution:**

```tsx
import { Platform, StatusBar } from "react-native";
import Constants from "expo-constants";

const getStatusBarHeight = () => {
  if (Platform.OS === "ios") {
    return Constants.statusBarHeight;
  }
  if (Platform.OS === "android") {
    return StatusBar.currentHeight ?? 0;
  }
  return 0; // Web has no status bar
};
```

### Safe Area

**Issue:** Safe areas differ across devices and platforms.

**Solution:**

```tsx
import { useSafeAreaInsets } from "react-native-safe-area-context";

const MyComponent = () => {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      {/* Content */}
    </View>
  );
};
```

### Keyboard Avoidance

**Issue:** Keyboard behavior differs between platforms.

**Solution:**

```tsx
import { KeyboardAvoidingView, Platform } from "react-native";

const FormContainer = ({ children }: { children: React.ReactNode }) => (
  <KeyboardAvoidingView
    behavior={Platform.OS === "ios" ? "padding" : "height"}
    keyboardVerticalOffset={Platform.select({ ios: 64, android: 0 })}
    style={{ flex: 1 }}
  >
    {children}
  </KeyboardAvoidingView>
);
```

### Scrolling Behavior

**Issue:** Scroll bounce and indicators differ.

**Solution:**

```tsx
import { Platform, ScrollView } from "react-native";

const CrossPlatformScrollView = ({
  children,
}: {
  children: React.ReactNode;
}) => (
  <ScrollView
    bounces={Platform.OS === "ios"}
    overScrollMode={Platform.OS === "android" ? "never" : undefined}
    showsVerticalScrollIndicator={Platform.OS !== "web"}
  >
    {children}
  </ScrollView>
);
```

## Navigation Issues

### Bottom Tabs on Web

**Issue:** Bottom tabs may not be ideal for web.

**Solution:**

```tsx
// app/_layout.tsx
import { Platform } from "react-native";
import { Tabs, Slot, Link } from "expo-router";

export default function Layout() {
  if (Platform.OS === "web") {
    return (
      <div
        style={{ display: "flex", flexDirection: "column", height: "100vh" }}
      >
        <nav style={{ display: "flex", gap: 16, padding: 16 }}>
          <Link href="/">Home</Link>
          <Link href="/settings">Settings</Link>
        </nav>
        <main style={{ flex: 1 }}>
          <Slot />
        </main>
      </div>
    );
  }

  return (
    <Tabs>
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="settings" options={{ title: "Settings" }} />
    </Tabs>
  );
}
```

### Drawer Navigation

**Issue:** Drawer gestures conflict with browser navigation on web.

**Solution:**

```tsx
import { Platform } from "react-native";
import { Drawer } from "expo-router/drawer";

export default function DrawerLayout() {
  return (
    <Drawer
      screenOptions={{
        swipeEnabled: Platform.OS !== "web",
        drawerType: Platform.OS === "web" ? "permanent" : "front",
      }}
    />
  );
}
```

### Back Button Behavior

**Issue:** Hardware back button (Android) vs browser back vs iOS gesture.

**Solution:**

```tsx
import { Platform } from "react-native";
import { useNavigation } from "expo-router";
import { useEffect } from "react";

const useBackHandler = (onBack: () => boolean) => {
  const navigation = useNavigation();

  useEffect(() => {
    if (Platform.OS === "android") {
      const backHandler = navigation.addListener("beforeRemove", e => {
        if (onBack()) {
          e.preventDefault();
        }
      });
      return () => backHandler();
    }
    // Web uses browser back button naturally
  }, [navigation, onBack]);
};
```

## Gesture and Input Issues

### Touch vs Mouse

**Issue:** Touch events work differently from mouse events.

**Solution:**

```tsx
import { Platform, Pressable } from "react-native";

const InteractiveCard = ({ onPress, children }: Props) => (
  <Pressable
    onPress={onPress}
    style={({ pressed, hovered }) => [
      styles.card,
      Platform.OS === "web" && hovered && styles.cardHovered,
      pressed && styles.cardPressed,
    ]}
  >
    {children}
  </Pressable>
);
```

### Long Press

**Issue:** Long press conflicts with context menu on web.

**Solution:**

```tsx
import { Platform, Pressable } from "react-native";

const LongPressable = ({ onLongPress, children }: Props) => (
  <Pressable
    onLongPress={Platform.OS !== "web" ? onLongPress : undefined}
    onContextMenu={
      Platform.OS === "web"
        ? e => {
            e.preventDefault();
            onLongPress?.();
          }
        : undefined
    }
    delayLongPress={Platform.select({ ios: 500, android: 400, web: 500 })}
  >
    {children}
  </Pressable>
);
```

### Text Selection

**Issue:** Text selection behavior differs.

**Solution:**

```tsx
import { Platform, Text } from "react-native";

const SelectableText = ({ children }: { children: string }) => (
  <Text
    selectable={Platform.OS !== "web"} // Web handles selection natively
    style={Platform.OS === "web" ? { userSelect: "text" } : undefined}
  >
    {children}
  </Text>
);
```

## Media and File Issues

### Image Formats

**Issue:** Some image formats not supported on all platforms.

**Solution:**

```tsx
const getOptimalImageFormat = () =>
  Platform.select({
    ios: "heic", // Efficient on iOS
    android: "webp", // Good on Android
    web: "webp", // Modern browsers support webp
    default: "jpg",
  });
```

### Video Playback

**Issue:** Video components have different APIs.

**Solution:**

```tsx
import { Platform } from "react-native";
import { Video } from "expo-av";

const VideoPlayer = ({ uri }: { uri: string }) => {
  if (Platform.OS === "web") {
    return (
      <video src={uri} controls style={{ width: "100%", maxHeight: 400 }} />
    );
  }

  return (
    <Video
      source={{ uri }}
      useNativeControls
      style={{ width: "100%", height: 300 }}
    />
  );
};
```

### File Picking

**Issue:** File system access differs significantly.

**Solution:**

```tsx
import { Platform } from "react-native";
import * as DocumentPicker from "expo-document-picker";

const pickFile = async () => {
  if (Platform.OS === "web") {
    return new Promise<File | null>(resolve => {
      const input = document.createElement("input");
      input.type = "file";
      input.onchange = () => resolve(input.files?.[0] ?? null);
      input.click();
    });
  }

  const result = await DocumentPicker.getDocumentAsync();
  return result.canceled ? null : result.assets[0];
};
```

## Storage Issues

### AsyncStorage vs localStorage

**Issue:** Different storage mechanisms per platform.

**Solution:**

```tsx
// utils/storage.ts
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

export const storage = {
  get: async (key: string): Promise<string | null> => {
    if (Platform.OS === "web") {
      return localStorage.getItem(key);
    }
    return await AsyncStorage.getItem(key);
  },

  set: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
    } else {
      await AsyncStorage.setItem(key, value);
    }
  },

  remove: async (key: string): Promise<void> => {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
    } else {
      await AsyncStorage.removeItem(key);
    }
  },
};
```

### SecureStore (No Web Support)

**Issue:** `expo-secure-store` doesn't work on web.

**Solution:**

```tsx
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

export const secureStorage = {
  get: async (key: string): Promise<string | null> => {
    if (Platform.OS === "web") {
      // Web fallback - consider using a more secure solution
      return sessionStorage.getItem(key);
    }
    return await SecureStore.getItemAsync(key);
  },

  set: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === "web") {
      sessionStorage.setItem(key, value);
    } else {
      await SecureStore.setItemAsync(key, value);
    }
  },
};
```

## Debugging Platform Issues

### Console Logging Platform

```tsx
console.log(`Running on: ${Platform.OS}`);
console.log(`Version: ${Platform.Version}`);
if (Platform.OS === "ios") {
  console.log(`iPad: ${Platform.isPad}`);
}
```

### Platform-Specific Debug Tools

```tsx
const enableDebugTools = () => {
  if (__DEV__) {
    if (Platform.OS === "web") {
      // Web DevTools are built-in
      console.log("Use browser DevTools (F12)");
    } else {
      // React Native Debugger or Flipper
      console.log("Shake device or Cmd+D for dev menu");
    }
  }
};
```

### Testing Platform-Specific Code

```tsx
// __tests__/platform.test.ts
import { Platform } from "react-native";

jest.mock("react-native", () => ({
  Platform: {
    OS: "ios", // Mock specific platform
    select: jest.fn(obj => obj.ios ?? obj.default),
  },
}));

describe("iOS-specific behavior", () => {
  it("should use iOS implementation", () => {
    expect(Platform.OS).toBe("ios");
  });
});
```
