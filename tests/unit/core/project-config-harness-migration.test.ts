/**
 * Unit tests for the legacy harness migration on the `.lisa.config.json`
 * read/apply boundary: retired values (e.g. `both`) are migrated to their
 * canonical form rather than hard-failing the apply.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PROJECT_CONFIG_FILENAME,
  detectLegacyHarnessMigration,
  readProjectConfig,
} from "../../../src/core/project-config.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

describe("legacy harness migration", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Write a `.lisa.config.json` with the given harness value.
   * @param harness - Value to persist under the `harness` key
   */
  async function writeHarness(harness: unknown): Promise<void> {
    await fs.writeFile(
      path.join(tempDir, PROJECT_CONFIG_FILENAME),
      JSON.stringify({ harness }),
      "utf8"
    );
  }

  describe("readProjectConfig", () => {
    it("migrates the retired 'both' harness to 'fleet' instead of throwing", async () => {
      await writeHarness("both");
      expect(await readProjectConfig(tempDir)).toEqual({ harness: "fleet" });
    });
  });

  describe("detectLegacyHarnessMigration", () => {
    it("returns the from/to mapping for a retired 'both' value", async () => {
      await writeHarness("both");
      expect(await detectLegacyHarnessMigration(tempDir)).toEqual({
        from: "both",
        to: "fleet",
      });
    });

    it("returns undefined when the file is absent", async () => {
      expect(await detectLegacyHarnessMigration(tempDir)).toBeUndefined();
    });

    // A canonical value and the advertised `all` alias must not churn the file;
    // a non-string value is left for the strict validator to reject on read.
    it.each([["fleet"], ["all"], [42]])(
      "returns undefined for a non-legacy value (%p)",
      async harness => {
        await writeHarness(harness);
        expect(await detectLegacyHarnessMigration(tempDir)).toBeUndefined();
      }
    );
  });
});
