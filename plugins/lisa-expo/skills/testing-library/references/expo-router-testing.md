# Expo Router Testing

This reference covers testing patterns for applications using Expo Router.

## Setup

### Required Imports

```typescript
import { renderRouter, screen } from "expo-router/testing-library";
import userEvent from "@testing-library/user-event";
```

### Why renderRouter Over render

When testing components that use Expo Router features (navigation, params, pathname), use `renderRouter` instead of `render`:

```typescript
// Standard render - for components without routing
import { render } from "@testing-library/react-native";
render(<PureComponent />);

// renderRouter - for components using expo-router
import { renderRouter } from "expo-router/testing-library";
renderRouter({
  index: () => <HomeScreen />,
});
```

## Basic Usage

### Single Route Testing

```typescript
test("renders home screen", async () => {
  renderRouter({
    index: () => <HomeScreen />,
  });

  expect(screen.getByRole("heading", { name: "Welcome" })).toBeOnTheScreen();
});
```

### Multiple Routes

```typescript
test("navigates between screens", async () => {
  const user = userEvent.setup();

  renderRouter({
    index: () => <HomeScreen />,
    profile: () => <ProfileScreen />,
    settings: () => <SettingsScreen />,
  });

  // Start on home
  expect(screen.getByText("Home")).toBeOnTheScreen();

  // Navigate to profile
  await user.press(screen.getByRole("button", { name: "Go to Profile" }));
  expect(await screen.findByText("Profile")).toBeOnTheScreen();
});
```

### Dynamic Routes

```typescript
test("displays player details", async () => {
  renderRouter(
    {
      index: () => <PlayerList />,
      "players/[id]": () => <PlayerDetail />,
    },
    {
      initialUrl: "/players/123",
    }
  );

  expect(await screen.findByText("Player 123")).toBeOnTheScreen();
});
```

## Initial URL

### Setting Initial Route

```typescript
renderRouter(
  {
    index: () => <Home />,
    profile: () => <Profile />,
    "settings/account": () => <AccountSettings />,
  },
  {
    initialUrl: "/settings/account",
  }
);
```

### With Query Parameters

```typescript
renderRouter(
  {
    "search/[query]": () => <SearchResults />,
  },
  {
    initialUrl: "/search/players?filter=active&sort=name",
  }
);
```

## Route Mocking

### Inline Mock Components

```typescript
renderRouter({
  index: jest.fn(() => <Text>Home</Text>),
  about: jest.fn(() => <Text>About</Text>),
});
```

### Null Components (Placeholder Routes)

Use null for routes that don't need rendering in this test:

```typescript
renderRouter({
  index: () => <HomeScreen />,
  profile: null, // Route exists but won't render anything
  settings: null,
});
```

### String Array Shorthand

Create mock routes quickly:

```typescript
// Creates null components for each route
renderRouter(["index", "profile", "settings", "help"]);
```

## Navigation Testing

### Testing Navigation Actions

```typescript
test("navigates on button press", async () => {
  const user = userEvent.setup();

  renderRouter({
    index: () => (
      <Pressable onPress={() => router.push("/details")}>
        <Text>View Details</Text>
      </Pressable>
    ),
    details: () => <Text>Details Screen</Text>,
  });

  await user.press(screen.getByText("View Details"));
  expect(await screen.findByText("Details Screen")).toBeOnTheScreen();
});
```

### Testing Back Navigation

```typescript
test("goes back to previous screen", async () => {
  const user = userEvent.setup();

  renderRouter(
    {
      index: () => <Text>Home</Text>,
      details: () => (
        <Pressable onPress={() => router.back()}>
          <Text>Go Back</Text>
        </Pressable>
      ),
    },
    {
      initialUrl: "/details",
    }
  );

  await user.press(screen.getByText("Go Back"));
  expect(await screen.findByText("Home")).toBeOnTheScreen();
});
```

### Testing Replace Navigation

```typescript
test("replaces current route", async () => {
  const user = userEvent.setup();

  renderRouter(
    {
      login: () => (
        <Pressable onPress={() => router.replace("/dashboard")}>
          <Text>Login</Text>
        </Pressable>
      ),
      dashboard: () => <Text>Dashboard</Text>,
    },
    {
      initialUrl: "/login",
    }
  );

  await user.press(screen.getByText("Login"));
  expect(await screen.findByText("Dashboard")).toBeOnTheScreen();
});
```

## Testing Route Params

### useLocalSearchParams

```typescript
// Component using params
const PlayerDetail = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Text>Player ID: {id}</Text>;
};

test("displays player from params", async () => {
  renderRouter(
    {
      "players/[id]": () => <PlayerDetail />,
    },
    {
      initialUrl: "/players/456",
    }
  );

  expect(screen.getByText("Player ID: 456")).toBeOnTheScreen();
});
```

### useGlobalSearchParams

```typescript
const SearchWithFilters = () => {
  const { query, filter } = useGlobalSearchParams<{
    query: string;
    filter: string;
  }>();
  return <Text>{`Search: ${query}, Filter: ${filter}`}</Text>;
};

test("reads global search params", async () => {
  renderRouter(
    {
      "search/[query]": () => <SearchWithFilters />,
    },
    {
      initialUrl: "/search/players?filter=active",
    }
  );

  expect(screen.getByText("Search: players, Filter: active")).toBeOnTheScreen();
});
```

## Testing Pathname

### usePathname

```typescript
const BreadCrumb = () => {
  const pathname = usePathname();
  return <Text>Current: {pathname}</Text>;
};

test("displays current pathname", async () => {
  renderRouter(
    {
      "settings/account": () => <BreadCrumb />,
    },
    {
      initialUrl: "/settings/account",
    }
  );

  expect(screen.getByText("Current: /settings/account")).toBeOnTheScreen();
});
```

### Asserting Pathname in Tests

```typescript
test("navigates to correct path", async () => {
  const user = userEvent.setup();

  renderRouter({
    index: () => <HomeWithNavigation />,
    "players/[id]": () => <PlayerDetail />,
  });

  await user.press(screen.getByRole("button", { name: "View Player 123" }));

  // Assert the pathname
  expect(screen).toHavePathname("/players/123");
});
```

## Testing Segments

### useSegments

```typescript
const SegmentDisplay = () => {
  const segments = useSegments();
  return <Text>Segments: {segments.join("/")}</Text>;
};

test("displays route segments", async () => {
  renderRouter(
    {
      "settings/account/security": () => <SegmentDisplay />,
    },
    {
      initialUrl: "/settings/account/security",
    }
  );

  expect(screen.getByText("Segments: settings/account/security")).toBeOnTheScreen();
});
```

## Layout Testing

### Testing with Layout Components

```typescript
const RootLayout = () => (
  <View>
    <Header />
    <Slot />
    <Footer />
  </View>
);

test("layout wraps content", async () => {
  renderRouter({
    _layout: () => <RootLayout />,
    index: () => <Text>Home Content</Text>,
  });

  expect(screen.getByText("Header")).toBeOnTheScreen();
  expect(screen.getByText("Home Content")).toBeOnTheScreen();
  expect(screen.getByText("Footer")).toBeOnTheScreen();
});
```

### Tab Navigation Layout

```typescript
test("tab navigation works", async () => {
  const user = userEvent.setup();

  renderRouter({
    "(tabs)/_layout": () => <TabsLayout />,
    "(tabs)/home": () => <Text>Home Tab</Text>,
    "(tabs)/search": () => <Text>Search Tab</Text>,
    "(tabs)/profile": () => <Text>Profile Tab</Text>,
  });

  // Switch tabs
  await user.press(screen.getByRole("tab", { name: "Search" }));
  expect(await screen.findByText("Search Tab")).toBeOnTheScreen();
});
```

## Protected Routes Testing

### Authentication Flow

```typescript
const AuthenticatedRoute = () => {
  const { user } = useAuth();

  if (!user) {
    return <Redirect href="/login" />;
  }

  return <Text>Protected Content</Text>;
};

test("redirects unauthenticated users", async () => {
  mockUseAuth.mockReturnValue({ user: null });

  renderRouter(
    {
      dashboard: () => <AuthenticatedRoute />,
      login: () => <Text>Login Page</Text>,
    },
    {
      initialUrl: "/dashboard",
    }
  );

  expect(await screen.findByText("Login Page")).toBeOnTheScreen();
});

test("shows content for authenticated users", async () => {
  mockUseAuth.mockReturnValue({ user: { id: "1" } });

  renderRouter(
    {
      dashboard: () => <AuthenticatedRoute />,
    },
    {
      initialUrl: "/dashboard",
    }
  );

  expect(screen.getByText("Protected Content")).toBeOnTheScreen();
});
```

## File Location Rules

### Never Put Tests in app/ Directory

Expo Router treats all files in `app/` as routes. Test files must be outside:

```
✅ Correct structure:
__tests__/
  features/
    home/
      HomeScreen.test.tsx
  components/
    Button.test.tsx
features/
  home/
    components/
      HomeScreen.tsx

❌ Wrong structure:
app/
  __tests__/          # Tests will be treated as routes!
    home.test.tsx
```

### Recommended Test Location Patterns

```
# Option 1: Root __tests__ directory
__tests__/
  features/
    players/
      PlayerList.test.tsx
      PlayerDetail.test.tsx

# Option 2: Feature-level __tests__
features/
  players/
    __tests__/
      PlayerList.test.tsx
      PlayerDetail.test.tsx
    components/
      PlayerList.tsx
      PlayerDetail.tsx
```

## Common Issues

### Route Not Found

```typescript
// Error: Route not found
renderRouter({
  index: () => <Home />,
});
// Then navigating to /profile that doesn't exist

// Solution: Define all routes needed for the test
renderRouter({
  index: () => <Home />,
  profile: () => <Profile />, // Add missing route
});
```

### Async Navigation

```typescript
// Issue: Assertion runs before navigation completes
await user.press(navigationButton);
expect(screen.getByText("New Screen")).toBeOnTheScreen(); // May fail

// Solution: Use findBy for async assertions
await user.press(navigationButton);
expect(await screen.findByText("New Screen")).toBeOnTheScreen();
```

### useRouter Outside Router Context

```typescript
// Error: useRouter must be used within a Router
render(<ComponentUsingRouter />);

// Solution: Use renderRouter
renderRouter({
  index: () => <ComponentUsingRouter />,
});
```

## Integration with Other Providers

### Wrapping with Apollo and Other Providers

```typescript
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <MockedProvider mocks={graphqlMocks}>
    <ThemeProvider>{children}</ThemeProvider>
  </MockedProvider>
);

test("works with multiple providers", async () => {
  renderRouter(
    {
      index: () => (
        <Wrapper>
          <HomeWithData />
        </Wrapper>
      ),
    }
  );

  expect(await screen.findByText("Data loaded")).toBeOnTheScreen();
});
```

### Custom renderRouter Wrapper

```typescript
import { renderRouter as baseRenderRouter } from "expo-router/testing-library";

const customRenderRouter = (
  routes: Parameters<typeof baseRenderRouter>[0],
  options?: Parameters<typeof baseRenderRouter>[1]
) => {
  return baseRenderRouter(routes, {
    ...options,
    wrapper: ({ children }) => (
      <AllProviders>{children}</AllProviders>
    ),
  });
};

export { customRenderRouter as renderRouter };
```
