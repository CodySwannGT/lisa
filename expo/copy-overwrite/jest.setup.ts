/**
 * This file is managed by Lisa.
 * Do not edit directly — changes will be overwritten on the next `lisa` run.
 */

/**
 * Jest Setup File - Base Configuration
 *
 * Configures the testing environment after Jest loads modules.
 * Sets up React Native Testing Library matchers, global mocks,
 * and manual cleanup for React 19 compatibility.
 *
 * Project-specific mocks belong in `jest.setup.local.ts` (create-only).
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

// Project-local mocks and setup (create-only — Lisa never overwrites this)
import "./jest.setup.local";

// Import from pure to avoid auto-cleanup (we set RNTL_SKIP_AUTO_CLEANUP in pre-setup)
// Then extend Jest matchers with React Native Testing Library matchers
import { cleanup } from "@testing-library/react-native/pure";
import "@testing-library/react-native/build/matchers/extend-expect";

// Extend global type for the unhandledRejection handler set in jest.setup.pre.js
declare global {
  let __unhandledRejectionHandler:
    | ((reason: unknown, promise: Promise<unknown>) => void)
    | undefined;
}

// Manual cleanup and mock reset after each test
// Replaces RTLRN's auto cleanup to handle React 19's null-throw during teardown
afterEach(async () => {
  try {
    await cleanup();
  } catch (error) {
    // Silently ignore null throws from React 19 cleanup
    if (error !== null) {
      throw error;
    }
  }
  jest.clearAllMocks();
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

// Remove the unhandledRejection handler after all tests to allow Jest to exit cleanly
// The handler is registered in jest.setup.pre.js and stored on global
afterAll(() => {
  if (__unhandledRejectionHandler) {
    process.removeListener("unhandledRejection", __unhandledRejectionHandler);
  }
});
