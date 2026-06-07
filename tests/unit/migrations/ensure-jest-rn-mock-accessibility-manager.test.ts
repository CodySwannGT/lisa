import * as fs from "fs-extra";
import * as path from "node:path";
import type { ProjectType } from "../../../src/core/config.js";
import { SilentLogger } from "../../../src/logging/silent-logger.js";
import { EnsureJestRnMockAccessibilityManagerMigration } from "../../../src/migrations/ensure-jest-rn-mock-accessibility-manager.js";
import type { MigrationContext } from "../../../src/migrations/migration.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const MOCK_FILE = "jest.config.react-native-mock.js";

/** A mock file as it looked before the AccessibilityManager block was added */
const STALE_MOCK = `module.exports = {
  PlatformConstants: {
    getConstants: () => ({}),
  },
  AccessibilityInfo: {
    getConstants: () => ({}),
    isScreenReaderEnabled: () => Promise.resolve(false),
  },
};
`;

describe("EnsureJestRnMockAccessibilityManagerMigration", () => {
  let migration: EnsureJestRnMockAccessibilityManagerMigration;
  let tempDir: string;
  let lisaDir: string;
  let projectDir: string;

  beforeEach(async () => {
    migration = new EnsureJestRnMockAccessibilityManagerMigration();
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    projectDir = path.join(tempDir, "project");
    await fs.ensureDir(lisaDir);
    await fs.ensureDir(projectDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Build a migration context for testing.
   * @param detectedTypes - Detected project types
   * @param dryRun - Whether to run in dry-run mode
   * @returns A migration context suitable for tests
   */
  function createContext(
    detectedTypes: readonly ProjectType[] = ["expo"],
    dryRun = false
  ): MigrationContext {
    return {
      projectDir,
      lisaDir,
      detectedTypes,
      dryRun,
      logger: new SilentLogger(),
    };
  }

  /**
   * Write a mock file into the project dir.
   * @param content - File contents
   */
  async function seedMock(content: string): Promise<void> {
    await fs.writeFile(path.join(projectDir, MOCK_FILE), content);
  }

  /**
   * Read the project's mock file.
   * @returns File contents
   */
  async function readMock(): Promise<string> {
    return fs.readFile(path.join(projectDir, MOCK_FILE), "utf8");
  }

  it("applies to an Expo project whose mock lacks AccessibilityManager", async () => {
    await seedMock(STALE_MOCK);
    expect(await migration.applies(createContext())).toBe(true);
  });

  it("does not apply to non-Expo projects", async () => {
    await seedMock(STALE_MOCK);
    expect(await migration.applies(createContext(["typescript"]))).toBe(false);
  });

  it("does not apply when the mock file is absent", async () => {
    expect(await migration.applies(createContext())).toBe(false);
  });

  it("does not apply when AccessibilityManager is already present", async () => {
    await seedMock(
      STALE_MOCK.replace("PlatformConstants:", "AccessibilityManager:")
    );
    expect(await migration.applies(createContext())).toBe(false);
  });

  it("does not apply when the module.exports anchor is missing", async () => {
    await seedMock("export default {\n  PlatformConstants: {},\n};\n");
    expect(await migration.applies(createContext())).toBe(false);
  });

  it("inserts the AccessibilityManager block as the first registry entry", async () => {
    await seedMock(STALE_MOCK);

    const result = await migration.apply(createContext());

    expect(result.action).toBe("applied");
    expect(result.changedFiles).toEqual([MOCK_FILE]);

    const content = await readMock();
    expect(content).toContain("AccessibilityManager: {");
    expect(content).toContain(
      "getCurrentVoiceOverState: onSuccess => onSuccess(false)"
    );
    // Inserted immediately after the registry anchor, before existing entries
    expect(content.indexOf("AccessibilityManager:")).toBeLessThan(
      content.indexOf("PlatformConstants:")
    );
    // Existing mocks are preserved
    expect(content).toContain("AccessibilityInfo: {");
  });

  it("is idempotent (second apply is a noop)", async () => {
    await seedMock(STALE_MOCK);
    await migration.apply(createContext());
    const afterFirst = await readMock();

    const result = await migration.apply(createContext());

    expect(result.action).toBe("noop");
    expect(await readMock()).toBe(afterFirst);
    // Exactly one AccessibilityManager entry
    expect(afterFirst.match(/AccessibilityManager:/g)).toHaveLength(1);
  });

  it("does not write in dry-run mode but reports the change", async () => {
    await seedMock(STALE_MOCK);

    const result = await migration.apply(createContext(["expo"], true));

    expect(result.action).toBe("applied");
    expect(result.changedFiles).toEqual([MOCK_FILE]);
    expect(await readMock()).toBe(STALE_MOCK);
  });
});
