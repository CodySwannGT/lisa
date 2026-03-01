# Mocking Patterns

This reference covers common mocking patterns for Expo and React Native testing.

## Global Setup Mocks

Place these in `jest/setup-jest.ts` or your Jest setup file.

### AsyncStorage

```typescript
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);
```

### Expo Fonts

Prevents async loading issues with icon fonts:

```typescript
jest.mock("expo-font", () => ({
  ...jest.requireActual("expo-font"),
  isLoaded: jest.fn(() => true),
  loadAsync: jest.fn(() => Promise.resolve()),
}));
```

### Expo Constants

```typescript
jest.mock("expo-constants", () => ({
  ...jest.requireActual("expo-constants"),
  expoConfig: {
    extra: {
      apiUrl: "https://test-api.example.com",
    },
  },
  manifest: {
    extra: {
      apiUrl: "https://test-api.example.com",
    },
  },
}));
```

### Expo SecureStore

```typescript
const mockSecureStore: Record<string, string> = {};

jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStore[key] = value;
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) => {
    return Promise.resolve(mockSecureStore[key] ?? null);
  }),
  deleteItemAsync: jest.fn((key: string) => {
    delete mockSecureStore[key];
    return Promise.resolve();
  }),
}));
```

### React Native Reanimated

```typescript
jest.mock("react-native-reanimated", () =>
  require("react-native-reanimated/mock")
);
```

### React Native Gesture Handler

```typescript
jest.mock("react-native-gesture-handler", () => ({
  GestureHandlerRootView: ({ children }: { children: React.ReactNode }) =>
    children,
  Swipeable: "Swipeable",
  DrawerLayout: "DrawerLayout",
  State: {},
  PanGestureHandler: "PanGestureHandler",
  TapGestureHandler: "TapGestureHandler",
  FlingGestureHandler: "FlingGestureHandler",
  ForceTouchGestureHandler: "ForceTouchGestureHandler",
  LongPressGestureHandler: "LongPressGestureHandler",
  NativeViewGestureHandler: "NativeViewGestureHandler",
  PinchGestureHandler: "PinchGestureHandler",
  RotationGestureHandler: "RotationGestureHandler",
  RawButton: "RawButton",
  BaseButton: "BaseButton",
  RectButton: "RectButton",
  BorderlessButton: "BorderlessButton",
  TouchableHighlight: "TouchableHighlight",
  TouchableNativeFeedback: "TouchableNativeFeedback",
  TouchableOpacity: "TouchableOpacity",
  TouchableWithoutFeedback: "TouchableWithoutFeedback",
  ScrollView: "ScrollView",
  Directions: {},
}));
```

### Expo Router Navigation

```typescript
const mockRouter = {
  push: jest.fn(),
  replace: jest.fn(),
  back: jest.fn(),
  canGoBack: jest.fn(() => true),
  setParams: jest.fn(),
  navigate: jest.fn(),
};

const mockSegments: string[] = [];
const mockPathname = "/";

jest.mock("expo-router", () => ({
  ...jest.requireActual("expo-router"),
  useRouter: () => mockRouter,
  useSegments: () => mockSegments,
  usePathname: () => mockPathname,
  useLocalSearchParams: () => ({}),
  useGlobalSearchParams: () => ({}),
  Link: "Link",
  Redirect: "Redirect",
}));

// Export for test access
export { mockRouter };
```

### React Navigation (for non-Expo Router)

```typescript
const mockNavigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  setOptions: jest.fn(),
  addListener: jest.fn(() => () => {}),
  removeListener: jest.fn(),
  dispatch: jest.fn(),
  reset: jest.fn(),
  isFocused: jest.fn(() => true),
  canGoBack: jest.fn(() => true),
  getParent: jest.fn(() => null),
  getState: jest.fn(() => ({ routes: [], index: 0 })),
};

const mockRoute = {
  params: {},
  name: "TestScreen",
  key: "test-key",
};

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
  useFocusEffect: jest.fn(callback => callback()),
  useIsFocused: jest.fn(() => true),
}));

export { mockNavigation, mockRoute };
```

## Module Mocks

### Mocking Default Exports

```typescript
jest.mock("./analytics", () => ({
  __esModule: true,
  default: {
    track: jest.fn(),
    identify: jest.fn(),
  },
}));
```

### Mocking Named Exports

```typescript
jest.mock("./utils", () => ({
  formatDate: jest.fn(date => "2024-01-01"),
  calculateTotal: jest.fn(() => 100),
}));
```

### Partial Module Mocking

```typescript
jest.mock("./api", () => ({
  ...jest.requireActual("./api"),
  fetchUser: jest.fn(), // Only mock this function
}));
```

### Auto-Mocking with Manual Override

```typescript
// Automatically mock all exports
jest.mock("./service");

// Then customize specific functions
import { myFunction } from "./service";
(myFunction as jest.Mock).mockReturnValue("custom value");
```

## Function Mocking

### Basic Mock Functions

```typescript
const mockCallback = jest.fn();

// With return value
const mockGetName = jest.fn(() => "John");

// With implementation
const mockCalculate = jest.fn((a, b) => a + b);

// Chained return values
const mockFetch = jest
  .fn()
  .mockReturnValueOnce("first")
  .mockReturnValueOnce("second")
  .mockReturnValue("default");
```

### Async Mock Functions

```typescript
// Resolved promise
const mockFetchData = jest.fn().mockResolvedValue({ id: 1, name: "John" });

// Rejected promise
const mockFetchError = jest.fn().mockRejectedValue(new Error("Network error"));

// Sequential async responses
const mockApi = jest
  .fn()
  .mockResolvedValueOnce({ status: "loading" })
  .mockResolvedValueOnce({ status: "complete", data: [] });
```

### Asserting Mock Calls

```typescript
// Was called
expect(mockFn).toHaveBeenCalled();

// Called specific number of times
expect(mockFn).toHaveBeenCalledTimes(3);

// Called with specific arguments
expect(mockFn).toHaveBeenCalledWith("arg1", "arg2");

// Last call arguments
expect(mockFn).toHaveBeenLastCalledWith("final");

// Nth call arguments
expect(mockFn).toHaveBeenNthCalledWith(1, "first");
expect(mockFn).toHaveBeenNthCalledWith(2, "second");

// Access all calls
expect(mockFn.mock.calls).toEqual([["first"], ["second"]]);

// Access results
expect(mockFn.mock.results[0].value).toBe("result");
```

### Clearing and Resetting Mocks

```typescript
beforeEach(() => {
  // Clear call history, keep implementation
  mockFn.mockClear();

  // Clear calls and reset implementation
  mockFn.mockReset();

  // Reset to original (unmocked) implementation
  mockFn.mockRestore();
});

// Clear all mocks at once
jest.clearAllMocks();
jest.resetAllMocks();
```

## Timer Mocking

### Fake Timers

```typescript
beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

test("debounced function", () => {
  const callback = jest.fn();
  debouncedFunction(callback);

  expect(callback).not.toHaveBeenCalled();

  jest.advanceTimersByTime(500);

  expect(callback).toHaveBeenCalled();
});
```

### Date Mocking

```typescript
beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2024-01-15T12:00:00Z"));
});

afterEach(() => {
  jest.useRealTimers();
});

test("displays current date", () => {
  render(<DateDisplay />);
  expect(screen.getByText("January 15, 2024")).toBeOnTheScreen();
});
```

## Apollo Client Mocking

### MockedProvider

```typescript
import { MockedProvider } from "@apollo/client/testing";

const mocks = [
  {
    request: {
      query: GET_USERS,
      variables: { limit: 10 },
    },
    result: {
      data: {
        users: [
          { id: "1", name: "John" },
          { id: "2", name: "Jane" },
        ],
      },
    },
  },
];

test("displays users", async () => {
  render(
    <MockedProvider mocks={mocks} addTypename={false}>
      <UserList limit={10} />
    </MockedProvider>
  );

  expect(await screen.findByText("John")).toBeOnTheScreen();
  expect(screen.getByText("Jane")).toBeOnTheScreen();
});
```

### Error Mocks

```typescript
const errorMocks = [
  {
    request: {
      query: GET_USER,
      variables: { id: "1" },
    },
    error: new Error("An error occurred"),
  },
];

// Or GraphQL errors
const graphqlErrorMocks = [
  {
    request: {
      query: GET_USER,
      variables: { id: "1" },
    },
    result: {
      errors: [{ message: "User not found" }],
    },
  },
];
```

### Mutation Mocks

```typescript
const mutationMocks = [
  {
    request: {
      query: CREATE_USER,
      variables: { name: "John", email: "john@example.com" },
    },
    result: {
      data: {
        createUser: {
          id: "1",
          name: "John",
          email: "john@example.com",
        },
      },
    },
  },
];

test("creates user on submit", async () => {
  const user = userEvent.setup();
  render(
    <MockedProvider mocks={mutationMocks} addTypename={false}>
      <UserForm />
    </MockedProvider>
  );

  await user.type(screen.getByLabelText("Name"), "John");
  await user.type(screen.getByLabelText("Email"), "john@example.com");
  await user.press(screen.getByRole("button", { name: "Create" }));

  expect(await screen.findByText("User created!")).toBeOnTheScreen();
});
```

### Loading Delay

```typescript
const delayedMocks = [
  {
    request: {
      query: GET_DATA,
    },
    result: {
      data: { items: [] },
    },
    delay: 500, // Simulates network delay
  },
];
```

## Context and Provider Mocking

### GluestackUIProvider Mock

GluestackUIProvider depends on NativeWind CSS variables that are not available in the test environment. Mock the entire module in integration tests:

```typescript
jest.mock("@/components/ui/gluestack-ui-provider", () => ({
  GluestackUIProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
```

Place this in integration test files or shared test utilities rather than global `jest.setup.js`, as it's only needed when testing components that use the provider.

### Custom Render with Providers

```typescript
import { render, RenderOptions } from "@testing-library/react-native";

interface WrapperProps {
  children: React.ReactNode;
}

const AllProviders = ({ children }: WrapperProps) => (
  <ThemeProvider theme={testTheme}>
    <AuthProvider value={mockAuthContext}>
      <MockedProvider mocks={defaultMocks}>
        {children}
      </MockedProvider>
    </AuthProvider>
  </ThemeProvider>
);

const customRender = (
  ui: React.ReactElement,
  options?: Omit<RenderOptions, "wrapper">
) => render(ui, { wrapper: AllProviders, ...options });

export * from "@testing-library/react-native";
export { customRender as render };
```

### Mocking Context Values

```typescript
const mockAuthContext = {
  user: { id: "1", name: "Test User" },
  isAuthenticated: true,
  login: jest.fn(),
  logout: jest.fn(),
};

test("displays user name", () => {
  render(
    <AuthContext.Provider value={mockAuthContext}>
      <UserProfile />
    </AuthContext.Provider>
  );

  expect(screen.getByText("Test User")).toBeOnTheScreen();
});
```

## Image and Asset Mocking

```typescript
jest.mock("@/assets/logo.png", () => "mocked-logo");

jest.mock(
  "*.png",
  () => ({
    __esModule: true,
    default: "mocked-image",
  }),
  { virtual: true }
);
```

## Fetch and API Mocking

### Global Fetch Mock

```typescript
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ data: "test" }),
    status: 200,
    headers: new Headers(),
  })
) as jest.Mock;
```

### MSW (Mock Service Worker) Alternative

For complex API mocking, consider using MSW:

```typescript
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";

const server = setupServer(
  http.get("/api/users", () => {
    return HttpResponse.json([
      { id: 1, name: "John" },
      { id: 2, name: "Jane" },
    ]);
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## Console Mocking

Suppress expected console warnings/errors:

```typescript
const originalError = console.error;

beforeAll(() => {
  console.error = jest.fn((...args) => {
    // Suppress specific warnings
    if (args[0]?.includes("Warning: Expected warning")) {
      return;
    }
    originalError.apply(console, args);
  });
});

afterAll(() => {
  console.error = originalError;
});
```
