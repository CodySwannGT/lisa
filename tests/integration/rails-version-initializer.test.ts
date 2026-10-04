import * as path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CopyOverwriteStrategy } from "../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../src/strategies/strategy.interface.js";
import { createTempDir, cleanupTempDir } from "../helpers/test-utils.js";

const INITIALIZER = "config/initializers/version.rb";
const LISA_DIR = fileURLToPath(new URL("../../", import.meta.url));
const TEMPLATE = path.join(LISA_DIR, "rails/copy-overwrite", INITIALIZER);
const OWNERSHIP_WARNING =
  "# This file is managed by Lisa and IS replaced on each `lisa` run.";
const UPSTREAM_WARNING =
  "# Do not edit directly — durable changes belong upstream in Lisa.";

describe("Rails version initializer emission", () => {
  let destDir: string;

  beforeEach(async () => {
    destDir = await createTempDir();
  });

  afterEach(async () => {
    await cleanupTempDir(destDir);
  });

  it("emits the required magic-comment gap and keeps ownership idempotent", async () => {
    const context: StrategyContext = {
      config: {
        lisaDir: LISA_DIR,
        destDir,
        dryRun: false,
        yesMode: true,
        validateOnly: false,
        skipGitCheck: false,
        harness: "claude",
      },
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
    const strategy = new CopyOverwriteStrategy();
    const destination = path.join(destDir, INITIALIZER);

    expect(
      (await strategy.apply(TEMPLATE, destination, INITIALIZER, context)).action
    ).toBe("copied");
    const emitted = await readFile(destination, "utf8");
    const lines = emitted.split("\n");
    expect(lines.slice(0, 2)).toEqual(["# frozen_string_literal: true", ""]);
    expect(lines.filter(line => line === OWNERSHIP_WARNING)).toHaveLength(1);
    expect(lines.filter(line => line === UPSTREAM_WARNING)).toHaveLength(1);

    expect(
      (await strategy.apply(TEMPLATE, destination, INITIALIZER, context)).action
    ).toBe("skipped");
    expect(await readFile(destination, "utf8")).toBe(emitted);
  });
});
