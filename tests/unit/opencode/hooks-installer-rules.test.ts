/** Unit coverage for mirroring Lisa's eager and reference rules into OpenCode. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  OPENCODE_LISA_RULES_SUBDIR,
  installHooks,
} from "../../../src/opencode/hooks-installer.js";
import { OPENCODE_CONFIG_DIR } from "../../../src/opencode/manifest.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const BASE_RULES = "base-rules.md";

describe("opencode/hooks-installer rule mirroring", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await Promise.all([fs.ensureDir(lisaDir), fs.ensureDir(destDir)]);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Write a fake Lisa rule file under plugins/<plugin>/rules/<relPath>.
   * @param pluginName - Plugin directory name.
   * @param relPath - Path under rules/ (for example eager/base-rules.md).
   * @param body - Rule Markdown body.
   */
  async function seedRule(
    pluginName: string,
    relPath: string,
    body: string
  ): Promise<void> {
    const rulesDir = path.join(lisaDir, "plugins", pluginName, "rules");
    const filePath = path.join(rulesDir, relPath);
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeFile(filePath, body, "utf8");
  }

  it("mirrors eager and reference rule files for OpenCode instructions", async () => {
    await seedRule(
      "lisa",
      path.join("eager", BASE_RULES),
      "Always do the thing.\n"
    );
    await seedRule(
      "lisa",
      path.join("reference", BASE_RULES),
      "Detailed body.\n"
    );
    const result = await installHooks(lisaDir, destDir, [], []);

    expect(result.managedFiles).toContain(
      path.join(OPENCODE_LISA_RULES_SUBDIR, "eager", BASE_RULES)
    );
    expect(result.managedFiles).toContain(
      path.join(OPENCODE_LISA_RULES_SUBDIR, "reference", BASE_RULES)
    );
    expect(
      await fs.readFile(
        path.join(
          destDir,
          OPENCODE_CONFIG_DIR,
          OPENCODE_LISA_RULES_SUBDIR,
          "eager",
          BASE_RULES
        ),
        "utf8"
      )
    ).toContain("Always do the thing.");
  });
});
