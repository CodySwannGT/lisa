/** Rails refresh ownership boundaries complement the real Ruby API harness. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import { CreateOnlyStrategy } from "../../../src/strategies/create-only.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const ROOT = resolve(__dirname, "../../..");
const SEEDS = [
  ".simplecov",
  "spec/spec_helper.rb",
  "spec/rails_helper.rb",
] as const;
const MANAGED = ["Gemfile.lisa", ".rubocop.yml"] as const;

describe("Rails tooling refresh ownership", () => {
  let destination: string;
  let context: StrategyContext;

  beforeEach(async () => {
    destination = await createTempDir();
    context = {
      config: {
        lisaDir: ROOT,
        destDir: destination,
        dryRun: false,
        yesMode: true,
        validateOnly: false,
        skipGitCheck: false,
        harness: "codex",
      },
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
  });

  afterEach(async () => {
    await cleanupTempDir(destination);
  });

  it("emits fresh Rails tooling and helper seeds, then applies idempotently", async () => {
    for (const [strategy, directory, files, action] of [
      [new CreateOnlyStrategy(), "create-only", SEEDS, "created"],
      [new CopyOverwriteStrategy(), "copy-overwrite", MANAGED, "copied"],
    ] as const) {
      for (const file of files) {
        const source = resolve(ROOT, "rails", directory, file);
        const emitted = resolve(destination, file);
        expect(
          (await strategy.apply(source, emitted, file, context)).action
        ).toBe(action);
        expect(await readFile(emitted)).toEqual(await readFile(source));
        expect(
          (await strategy.apply(source, emitted, file, context)).action
        ).toBe("skipped");
      }
    }
  });

  it("preserves existing project-owned coverage/helpers during a tooling refresh", async () => {
    const strategy = new CreateOnlyStrategy();
    for (const file of SEEDS) {
      const emitted = resolve(destination, file);
      const custom = `# Project-owned ${file}\n# Existing coverage and test customizations\n`;
      await mkdir(dirname(emitted), { recursive: true });
      await writeFile(emitted, custom);
      expect(
        (
          await strategy.apply(
            resolve(ROOT, "rails/create-only", file),
            emitted,
            file,
            context
          )
        ).action
      ).toBe("skipped");
      expect(await readFile(emitted, "utf8")).toBe(custom);
    }
    for (const file of MANAGED) {
      expect(
        (
          await new CopyOverwriteStrategy().apply(
            resolve(ROOT, "rails/copy-overwrite", file),
            resolve(destination, file),
            file,
            context
          )
        ).action
      ).toBe("copied");
    }
  });
});
