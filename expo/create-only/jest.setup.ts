/**
 * Jest Setup File
 *
 * Configures the testing environment after Jest loads modules.
 * Sets up React Native Testing Library matchers, global mocks,
 * and manual cleanup for React 19 compatibility.
 *
 * @remarks
 * - Listed in `setupFilesAfterEnv` (runs after test framework loads)
 * - Basic globals like `__DEV__` are set earlier in `jest.setup.pre.js`
 * - Manual cleanup replaces RTLRN auto-cleanup to handle React 19's
 *   null-throw behavior during component teardown
 * @see https://github.com/expo/expo/issues/38046 React 19 cleanup issue
 * @see https://github.com/expo/expo/issues/40184 Jest 30 + expo-router
 * @see {@link https://callstack.github.io/react-native-testing-library/ | RTLRN Docs}
 * @module jest.setup
 */

// Import from pure to avoid auto-cleanup (we set RNTL_SKIP_AUTO_CLEANUP in pre-setup)
// Then extend Jest matchers with React Native Testing Library matchers
import { cleanup } from "@testing-library/react-native/pure";
import "@testing-library/react-native/build/matchers/extend-expect";

// Mock environment variables module for type-safe env access in tests
// Tests can override specific values via jest.spyOn or jest.doMock
// Replace the mock below with your project's actual env module and values
jest.mock("@/lib/env", () => ({
  env: {
    EXPO_PUBLIC_ENV: "dev",
    // Add your project-specific environment variables here
  },
}));

// Extend global type for the unhandledRejection handler set in jest.setup.pre.js
declare global {
  let __unhandledRejectionHandler:
    | ((reason: unknown, promise: Promise<unknown>) => void)
    | undefined;
}

// Manual cleanup after each test (replacing RTLRN's auto cleanup)
// This handles React 19's cleanup which can throw null
afterEach(async () => {
  try {
    await cleanup();
  } catch (error) {
    // Silently ignore null throws from React 19 cleanup
    if (error !== null) {
      throw error;
    }
  }
});

// Mock ResizeObserver for tests that use it
// eslint-disable-next-line functional/no-classes -- Mock implementation required for testing
global.ResizeObserver = class ResizeObserver {
  /** Starts observing an element — no-op for tests */
  observe(): void {}
  /** Stops observing an element — no-op for tests */
  unobserve(): void {}
  /** Disconnects observer — no-op for tests */
  disconnect(): void {}
};

// Mock expo-router for tests using navigation hooks
jest.mock("expo-router", () => ({
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    canGoBack: jest.fn(() => true),
  })),
  usePathname: jest.fn(() => "/"),
  useLocalSearchParams: jest.fn(() => ({})),
  useGlobalSearchParams: jest.fn(() => ({})),
  useSegments: jest.fn(() => []),
  useNavigation: jest.fn(() => ({
    navigate: jest.fn(),
    goBack: jest.fn(),
    getParent: jest.fn(() => ({
      setOptions: jest.fn(),
    })),
  })),
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: {
    Screen: () => null,
  },
  Tabs: {
    Screen: () => null,
  },
}));

// Mock @react-native-firebase/analytics
jest.mock("@react-native-firebase/analytics", () => {
  const logEvent = jest.fn();
  const getAnalytics = jest.fn(() => ({}));
  return { logEvent, getAnalytics };
});

// Mock firebase/analytics
jest.mock("firebase/analytics", () => {
  const logEvent = jest.fn();
  const getAnalytics = jest.fn(() => ({}));
  return { logEvent, getAnalytics };
});

// Clear mocks after each test
afterEach(() => {
  jest.clearAllMocks();
});

// Remove the unhandledRejection handler after all tests to allow Jest to exit cleanly
// The handler is registered in jest.setup.pre.js and stored on global
afterAll(() => {
  if (__unhandledRejectionHandler) {
    process.removeListener("unhandledRejection", __unhandledRejectionHandler);
  }
});
