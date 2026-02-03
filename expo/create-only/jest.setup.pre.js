/**
 * Jest Pre-Setup File
 *
 * Runs before Jest loads any other modules to set up global flags needed
 * by React Native. This file must be JavaScript (not TypeScript) and must
 * not import any modules that depend on the global flags being set.
 *
 * @remarks
 * - Listed in `setupFiles` (runs before test framework loads)
 * - Sets `__DEV__`, `IS_REACT_ACT_ENVIRONMENT`, and other RN globals
 * - Stubs `__turboModuleProxy` so native module requires don't throw
 * - React 19 throws null on cleanup — the unhandledRejection handler
 *   suppresses those while still surfacing real errors
 * @see https://github.com/expo/expo/issues/38046 React 19 cleanup issue
 * @see https://github.com/expo/expo/issues/40184 Jest 30 + expo-router
 * @module jest.setup.pre
 */

// Polyfill structuredClone for jsdom environment
// structuredClone is available in Node.js 17+ but jsdom doesn't expose it
if (typeof global.structuredClone === "undefined") {
  global.structuredClone = val => JSON.parse(JSON.stringify(val));
}

// Handle unhandled promise rejections BEFORE any other code runs
// This must be set up first to catch React 19 "thrown: null" issues
// Store the handler so it can be removed after tests complete (in jest.setup.ts)
global.__unhandledRejectionHandler = (reason, _promise) => {
  // Silently ignore null rejections from React 19 cleanup
  if (reason === null) {
    return;
  }
  // Re-throw other unhandled rejections so tests still fail for real issues
  throw reason;
};
process.on("unhandledRejection", global.__unhandledRejectionHandler);

// Disable RTLRN's auto cleanup to avoid "thrown: null" errors from React 19
// We handle cleanup manually in jest.setup.ts
process.env.RNTL_SKIP_AUTO_CLEANUP = "true";

// Set React Native test environment flags BEFORE any modules are loaded
global.__DEV__ = true;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.IS_REACT_NATIVE_TEST_ENVIRONMENT = true;

// Mock React Native bridge for testing
global.__fbBatchedBridgeConfig = {
  remoteModuleConfig: [],
  localModulesConfig: [],
};

// Mock TurboModuleRegistry using external mock configuration
const mockModules = require("./jest.config.react-native-mock");

global.__turboModuleProxy = function (moduleName) {
  return mockModules[moduleName] || null;
};

// Ensure global timers are available (required by @testing-library/react-native)
// Jest's environment should have these, but we ensure they're set
if (typeof global.setTimeout === "undefined") {
  global.setTimeout = globalThis.setTimeout;
}
if (typeof global.clearTimeout === "undefined") {
  global.clearTimeout = globalThis.clearTimeout;
}
if (typeof global.setInterval === "undefined") {
  global.setInterval = globalThis.setInterval;
}
if (typeof global.clearInterval === "undefined") {
  global.clearInterval = globalThis.clearInterval;
}

// Mock window object for web-specific code in platform-agnostic tests
// This allows tests that check Platform.OS === 'web' branches to work
// Important: Include timer functions because RTLRN checks typeof window !== 'undefined'
global.window = {
  // Timer functions (required by RTLRN)
  setTimeout: global.setTimeout,
  clearTimeout: global.clearTimeout,
  setInterval: global.setInterval,
  clearInterval: global.clearInterval,
  setImmediate: global.setImmediate,
  // Web-specific mocks
  confirm: jest.fn(() => true),
  alert: jest.fn(),
  open: jest.fn(),
  location: {
    href: "",
    origin: "http://localhost",
    pathname: "/",
    search: "",
    hash: "",
  },
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  navigator: {
    userAgent: "jest-test",
  },
  matchMedia: jest.fn(() => ({
    matches: false,
    addListener: jest.fn(),
    removeListener: jest.fn(),
  })),
};
