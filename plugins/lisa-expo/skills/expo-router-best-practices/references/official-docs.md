# Expo Router Official Documentation Reference

This reference contains condensed official documentation from Expo Router.

## Core Concepts

### The Six Rules of Expo Router

1. **All screens/pages are files inside the app directory** - Every file inside `app/` has a default export that defines a distinct page (except `_layout` files).

2. **All pages have a URL** - All pages have a URL path matching the file's location, enabling universal deep-linking across platforms.

3. **First index.tsx is the initial route** - Expo Router looks for the first `index.tsx` file matching the `/` URL. Use route groups `(groupName)` to organize without affecting URLs.

4. **Root \_layout.tsx replaces App.jsx/tsx** - The root layout is rendered before any other route and contains initialization code (fonts, splash screen, providers).

5. **Non-navigation components live outside app directory** - Components, hooks, utilities belong in other top-level directories. Alternatively, use `src/app/` with `src/components/`, `src/utils/`, etc.

6. **It's still React Navigation under the hood** - Expo Router translates file structure into React Navigation components. Same options apply for styling/configuration.

## Navigation Methods

### Link Component (Declarative)

```typescript
import { Link } from "expo-router";

// Basic
<Link href="/about">About</Link>

// With custom component
<Link href="/profile" asChild>
  <Pressable><Text>Profile</Text></Pressable>
</Link>

// Dynamic route with params object
<Link href={{ pathname: "/user/[id]", params: { id: "bacon" } }}>
  View User
</Link>

// Prefetching
<Link href="/about" prefetch />
```

### useRouter Hook (Imperative)

```typescript
import { useRouter } from "expo-router";

const router = useRouter();

// Navigate (adds to history, won't duplicate)
router.navigate("/about");

// Push (always adds to stack)
router.push("/details");

// Replace (no back navigation)
router.replace("/home");

// Back
router.back();

// Dismiss modal
router.dismiss();

// Dismiss all modals
router.dismissAll();

// Can go back check
router.canGoBack();
```

### Redirect Component

```typescript
import { Redirect } from "expo-router";

export default function Page() {
  if (!isAuthenticated) {
    return <Redirect href="/sign-in" />;
  }
  return <Content />;
}
```

## Route Parameters

### Reading Parameters

```typescript
import { useLocalSearchParams, useGlobalSearchParams } from "expo-router";

// Local params (current route only)
const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();

// Global params (entire URL tree)
const params = useGlobalSearchParams();
```

### Updating Parameters Without Navigation

```typescript
// Via Link
<Link href={{ pathname: "/current", params: { filter: "new" } }}>
  Update Filter
</Link>

// Via router
router.setParams({ filter: "new" });
```

## Layout Components

### Stack Navigator

```typescript
import { Stack } from "expo-router";

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: "#f4511e" },
        headerTintColor: "#fff",
      }}
    >
      <Stack.Screen name="index" options={{ title: "Home" }} />
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
```

### Tab Navigator

```typescript
import { Tabs } from "expo-router";

export default function Layout() {
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: "blue" }}>
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => <Icon name="home" color={color} />,
        }}
      />
    </Tabs>
  );
}
```

### Drawer Navigator

```typescript
import { Drawer } from "expo-router/drawer";

export default function Layout() {
  return (
    <Drawer>
      <Drawer.Screen name="index" options={{ title: "Home" }} />
      <Drawer.Screen name="settings" options={{ title: "Settings" }} />
    </Drawer>
  );
}
```

### Slot (No Navigator)

```typescript
import { Slot } from "expo-router";

export default function Layout() {
  return (
    <>
      <Header />
      <Slot />
      <Footer />
    </>
  );
}
```

## Protected Routes (SDK 53+)

```typescript
import { Stack } from "expo-router";

export default function RootLayout() {
  const { isLoggedIn } = useAuth();

  return (
    <Stack>
      <Stack.Protected guard={isLoggedIn}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>
      <Stack.Protected guard={!isLoggedIn}>
        <Stack.Screen name="sign-in" />
      </Stack.Protected>
    </Stack>
  );
}
```

## Special Files

| File                 | Purpose                        |
| -------------------- | ------------------------------ |
| `_layout.tsx`        | Define navigator for directory |
| `index.tsx`          | Default route for directory    |
| `+not-found.tsx`     | 404 error page                 |
| `+html.tsx`          | Custom HTML wrapper (web)      |
| `+native-intent.tsx` | Handle unmatched deep links    |

## unstable_settings

```typescript
export const unstable_settings = {
  // Initial route for deep links
  initialRouteName: "index",

  // Anchor for route groups
  anchor: "(root)",
};
```

## Testing

```typescript
import { renderRouter, screen } from "expo-router/testing-library";

it("navigates correctly", async () => {
  renderRouter(
    {
      index: () => <Home />,
      "user/[id]": () => <User />,
    },
    { initialUrl: "/" }
  );

  expect(screen).toHavePathname("/");
});
```

### Test Matchers

- `expect(screen).toHavePathname("/path")`
- `expect(screen).toHavePathnameWithParams("/path?q=test")`
- `expect(screen).toHaveSegments(["[id]"])`
- `expect(screen).useLocalSearchParams({ id: "123" })`

## Hooks Reference

| Hook                          | Purpose                 |
| ----------------------------- | ----------------------- |
| `useRouter()`                 | Imperative navigation   |
| `useLocalSearchParams()`      | Current route params    |
| `useGlobalSearchParams()`     | All URL params          |
| `useSegments()`               | Current route segments  |
| `usePathname()`               | Current pathname        |
| `useNavigation()`             | React Navigation object |
| `useFocusEffect()`            | Run effect on focus     |
| `useNavigationContainerRef()` | Navigation ref          |

## URL Scheme Configuration

```json
// app.json
{
  "expo": {
    "scheme": "myapp",
    "web": {
      "bundler": "metro"
    }
  }
}
```

## Sources

- [Introduction to Expo Router](https://docs.expo.dev/router/introduction/)
- [Core Concepts](https://docs.expo.dev/router/basics/core-concepts/)
- [Router Notation](https://docs.expo.dev/router/basics/notation/)
- [Navigation Layouts](https://docs.expo.dev/router/basics/layout/)
- [Navigation](https://docs.expo.dev/router/basics/navigation/)
- [Common Patterns](https://docs.expo.dev/router/basics/common-navigation-patterns/)
- [Authentication](https://docs.expo.dev/router/advanced/authentication/)
- [Testing](https://docs.expo.dev/router/reference/testing/)
