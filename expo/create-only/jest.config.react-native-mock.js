/**
 * React Native TurboModule Mock Configuration
 *
 * Provides mock implementations for React Native's TurboModule native
 * modules used in the test environment. These mocks are loaded by
 * `jest.setup.pre.js` via `__turboModuleProxy`.
 *
 * @remarks Projects should add additional module mocks as needed.
 * Only the baseline modules required by React Native core are included
 * here — project-specific native modules (e.g., camera, maps) should
 * be added to the project's copy of this file.
 * @see https://reactnative.dev/docs/the-new-architecture/pillars-turbomodules
 * @module jest.config.react-native-mock
 */

// Dynamically read React Native version from package.json
const fs = require("fs");
const path = require("path");

/**
 * Parses React Native version from package.json for PlatformConstants mock
 * @returns The React Native version object with major, minor, and patch numbers
 * @remarks Falls back to 0.81.4 if parsing fails — update the fallback
 * when upgrading React Native
 */
const getReactNativeVersion = () => {
  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(__dirname, "package.json"), "utf8")
    );
    const version = packageJson.dependencies["react-native"];
    // Handle version formats: "0.81.4", "^0.81.4", "~0.81.4"
    const versionMatch = version.match(/(\d+)\.(\d+)\.(\d+)/);
    if (versionMatch) {
      return {
        major: parseInt(versionMatch[1], 10),
        minor: parseInt(versionMatch[2], 10),
        patch: parseInt(versionMatch[3], 10),
      };
    }
  } catch (error) {
    // Fallback to a default version if parsing fails
    console.warn(
      "Failed to parse React Native version from package.json:",
      error
    );
  }
  // Fallback version
  return { major: 0, minor: 81, patch: 4 };
};

module.exports = {
  PlatformConstants: {
    getConstants: () => ({
      reactNativeVersion: getReactNativeVersion(),
      forceTouchAvailable: false,
      osVersion: "14.4",
      systemName: "iOS",
      interfaceIdiom: "phone",
    }),
  },
  AppState: {
    getConstants: () => ({ initialAppState: "active" }),
    getCurrentAppState: () => Promise.resolve({ app_state: "active" }),
    addListener: () => {},
    addEventListener: () => {},
    removeListeners: () => {},
    removeEventListener: () => {},
    currentState: "active",
  },
  Appearance: {
    getConstants: () => ({ initialColorScheme: "light" }),
    getColorScheme: () => "light",
    setColorScheme: () => {},
    addChangeListener: () => ({ remove: () => {} }),
    removeChangeListener: () => {},
    addListener: () => ({ remove: () => {} }),
    removeListeners: () => {},
  },
  // SDK 56 / RN 0.85: AccessibilityInfo eagerly reads the AccessibilityManager
  // TurboModule. Without a mock the module resolves to null and AccessibilityInfo
  // methods reject with "NativeAccessibilityManagerIOS is not available", which
  // the unhandledRejection handler escalates into a Jest worker crash that takes
  // down every suite touching accessibility.
  AccessibilityManager: {
    getCurrentBoldTextState: onSuccess => onSuccess(false),
    getCurrentGrayscaleState: onSuccess => onSuccess(false),
    getCurrentInvertColorsState: onSuccess => onSuccess(false),
    getCurrentReduceMotionState: onSuccess => onSuccess(false),
    getCurrentDarkerSystemColorsState: onSuccess => onSuccess(false),
    getCurrentPrefersCrossFadeTransitionsState: onSuccess => onSuccess(false),
    getCurrentReduceTransparencyState: onSuccess => onSuccess(false),
    getCurrentVoiceOverState: onSuccess => onSuccess(false),
    setAccessibilityContentSizeMultipliers: () => {},
    setAccessibilityFocus: () => {},
    announceForAccessibility: () => {},
    announceForAccessibilityWithOptions: () => {},
    addListener: () => {},
    removeListeners: () => {},
    getConstants: () => ({}),
  },
  DeviceInfo: {
    getConstants: () => ({
      Dimensions: {
        window: { width: 375, height: 667, scale: 2, fontScale: 1 },
        screen: { width: 375, height: 667, scale: 2, fontScale: 1 },
      },
    }),
  },
};
