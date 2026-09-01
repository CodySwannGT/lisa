/**
 * The learnings block is a closed, validated ProjectConfig subtree.
 *
 * Merge-driver registration mutates git-local state, so a typo or malformed
 * opt-out must be rejected by the same snapshot that resolves the ledger path
 * before either migration can write anything.
 * @module tests/unit/core/project-config-learnings
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PROJECT_CONFIG_FILENAME,
  readProjectConfig,
  type ProjectConfig,
} from "../../../src/core/project-config.js";
import {
  resolveLearningsSettings,
  type LearningsConfig,
} from "../../../src/core/project-config-learnings.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const DEFAULT_LEARNINGS_FILE = ".lisa/PROJECT_LEARNINGS.md";
const RELOCATED_LEARNINGS_FILE = "docs/knowledge/PROJECT_LEARNINGS.md";

describe("project-config learnings", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Persist one raw config fixture for validation.
   * @param config - Untrusted config value to serialize
   */
  async function writeConfig(config: unknown): Promise<void> {
    await fs.writeJson(path.join(tempDir, PROJECT_CONFIG_FILENAME), config);
  }

  it.each([
    [undefined, true],
    [{}, true],
    [{ mergeDriver: true }, true],
    [{ mergeDriver: false }, false],
  ] as const)(
    "resolves merge-driver setting %j to enabled=%s",
    (learnings, mergeDriverEnabled) => {
      const config: ProjectConfig =
        learnings === undefined ? {} : { learnings };
      expect(resolveLearningsSettings(config)).toEqual({
        learningsFile: DEFAULT_LEARNINGS_FILE,
        mergeDriverEnabled,
      });
    }
  );

  it("preserves a validated file override and explicit merge-driver choice", async () => {
    await writeConfig({
      learnings: {
        file: RELOCATED_LEARNINGS_FILE,
        mergeDriver: false,
      },
    });
    const config = await readProjectConfig(tempDir);
    expect(config).toEqual({
      learnings: {
        file: RELOCATED_LEARNINGS_FILE,
        mergeDriver: false,
      },
    });
    expect(resolveLearningsSettings(config)).toEqual({
      learningsFile: RELOCATED_LEARNINGS_FILE,
      mergeDriverEnabled: false,
    });
  });

  it("accepts the two declared nested fields together", async () => {
    await writeConfig({
      learnings: {
        file: RELOCATED_LEARNINGS_FILE,
        mergeDriver: true,
      },
    });
    await expect(readProjectConfig(tempDir)).resolves.toEqual({
      learnings: {
        file: RELOCATED_LEARNINGS_FILE,
        mergeDriver: true,
      },
    });
  });

  it.each(["mergedriver", "merge_driver", "futureNestedField"])(
    "rejects unknown nested field learnings.%s while top-level stays open",
    async field => {
      await writeConfig({
        futureTopLevelField: { retainedByWriter: true },
        learnings: { [field]: false },
      });
      await expect(readProjectConfig(tempDir)).rejects.toThrow(
        new RegExp(`learnings\\.${field}.*unknown field`, "iu")
      );
    }
  );

  it.each([
    ["false", '"false"'],
    [0, "0"],
    [null, "null"],
    [{ enabled: false }, '{"enabled":false}'],
    [[false], "[false]"],
  ])(
    "rejects non-boolean mergeDriver %j with expected and received diagnostics",
    async (mergeDriver, rendered) => {
      await writeConfig({ learnings: { mergeDriver } });
      await expect(readProjectConfig(tempDir)).rejects.toThrow(
        `Invalid learnings.mergeDriver in ${path.join(
          tempDir,
          PROJECT_CONFIG_FILENAME
        )}: expected boolean, received ${rendered}`
      );
    }
  );

  it("keeps the public LearningsConfig type compatible with valid values", () => {
    const learnings: LearningsConfig = {
      file: RELOCATED_LEARNINGS_FILE,
      mergeDriver: false,
    };
    const config: ProjectConfig = { learnings };
    expect(resolveLearningsSettings(config).mergeDriverEnabled).toBe(false);
  });
});
