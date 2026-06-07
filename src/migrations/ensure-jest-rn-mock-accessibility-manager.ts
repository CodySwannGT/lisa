import * as path from "node:path";
import * as fse from "fs-extra";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const MOCK_FILE = "jest.config.react-native-mock.js";

/** Anchor marking the start of the mocked TurboModule registry object */
const ANCHOR = "module.exports = {\n";

/** Presence of this key means the AccessibilityManager mock is already wired */
const MARKER = "AccessibilityManager:";

/**
 * The AccessibilityManager TurboModule mock block, inserted as the first entry
 * of the mocked module registry. Kept byte-for-byte in sync with the
 * `expo/create-only/jest.config.react-native-mock.js` template.
 */
const ACCESSIBILITY_MANAGER_BLOCK = `  // SDK 56 / RN 0.85: AccessibilityInfo eagerly reads the AccessibilityManager
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
`;

/**
 * Migration: add the RN 0.85 `AccessibilityManager` TurboModule mock to an
 * existing project's `jest.config.react-native-mock.js`.
 *
 * That file is create-only, so Lisa never overwrites it once a project has been
 * scaffolded. Projects created before the AccessibilityManager mock was added to
 * the template therefore keep a stale copy. After the Expo SDK 56 / React Native
 * 0.85 upgrade, `AccessibilityInfo` eagerly reads the `AccessibilityManager`
 * TurboModule; without the mock it resolves to null and every test suite that
 * touches accessibility crashes the Jest worker with
 * "NativeAccessibilityManagerIOS is not available".
 *
 * Idempotent and conservative: only acts on Expo projects whose mock file exists,
 * still exposes the `module.exports = {` registry anchor, and does not already
 * define `AccessibilityManager`. The block is inserted as the first registry
 * entry so it is unaffected by any project-specific module mocks that follow.
 */
export class EnsureJestRnMockAccessibilityManagerMigration implements Migration {
  readonly name = "ensure-jest-rn-mock-accessibility-manager";
  readonly description =
    "Add the RN 0.85 AccessibilityManager TurboModule mock to jest.config.react-native-mock.js";

  /**
   * Applies to Expo projects whose create-only mock file exists, exposes the
   * registry anchor, and does not already define the AccessibilityManager mock.
   * @param ctx - Migration context
   * @returns True when the mock is missing and can be safely inserted
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    if (!ctx.detectedTypes.includes("expo")) {
      return false;
    }
    const mockPath = path.join(ctx.projectDir, MOCK_FILE);
    if (!(await fse.pathExists(mockPath))) {
      return false;
    }
    const content = await fse.readFile(mockPath, "utf8");
    return content.includes(ANCHOR) && !content.includes(MARKER);
  }

  /**
   * Insert the AccessibilityManager mock block immediately after the
   * `module.exports = {` anchor. Re-checks the marker so the operation is
   * idempotent even if `applies` and `apply` are called out of step.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const mockPath = path.join(ctx.projectDir, MOCK_FILE);

    if (!(await fse.pathExists(mockPath))) {
      return { name: this.name, action: "noop" };
    }

    const content = await fse.readFile(mockPath, "utf8");
    if (content.includes(MARKER) || !content.includes(ANCHOR)) {
      return { name: this.name, action: "noop" };
    }

    const updated = content.replace(
      ANCHOR,
      ANCHOR + ACCESSIBILITY_MANAGER_BLOCK
    );
    const message = `Added AccessibilityManager TurboModule mock to ${MOCK_FILE}`;

    if (ctx.dryRun) {
      ctx.logger.dry(`Would add AccessibilityManager mock to ${MOCK_FILE}`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [MOCK_FILE],
        message,
      };
    }

    await fse.writeFile(mockPath, updated);
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [MOCK_FILE],
      message,
    };
  }
}
