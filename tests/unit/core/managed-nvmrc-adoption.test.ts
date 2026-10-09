/** Exact nvmrc ownership uses provenance without replacing custom content. */
import * as fs from "fs-extra";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LisaConfig } from "../../../src/core/config.js";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const NODE_PATCH = "24.21.0";

describe("managed nvmrc runtime adoption", () => {
  let tempDir: string;
  beforeEach(async () => {
    tempDir = await createTempDir();
  });
  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  it("advances a known older managed nvmrc without replacing unknown host bytes", async () => {
    const source = path.join(tempDir, "source-nvmrc");
    const destination = path.join(tempDir, ".nvmrc");
    const older = "22.23.3\n";
    const current = `${NODE_PATCH}\n`;
    const custom = "25.0.0\n";
    const digest = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    await fs.writeFile(source, current);
    const config: LisaConfig = {
      lisaDir: ROOT,
      destDir: tempDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
    };
    const strategy = new CopyOverwriteStrategy();
    const context = {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
      hashLedger: { ".nvmrc": [digest(older), digest(current)] },
    };
    await fs.writeFile(destination, older);
    await strategy.apply(source, destination, ".nvmrc", context);
    expect(await fs.readFile(destination, "utf8")).toBe(current);
    await fs.writeFile(destination, custom);
    await strategy.apply(source, destination, ".nvmrc", context);
    expect(await fs.readFile(destination, "utf8")).toBe(custom);
  });
});
