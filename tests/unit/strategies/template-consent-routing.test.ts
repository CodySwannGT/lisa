/** Git cleanliness never selects template consent (#4759). */
import * as fs from "fs-extra";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LisaConfig } from "../../../src/core/config.js";
import { CopyContentsStrategy } from "../../../src/strategies/copy-contents.js";
import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import { cleanupTempDir, createTempDir } from "../../helpers/test-utils.js";

const MODES = [
  { yesMode: true, unattended: false, skipGitCheck: false },
  { yesMode: true, unattended: false, skipGitCheck: true },
  { yesMode: false, unattended: true, skipGitCheck: false },
  { yesMode: false, unattended: true, skipGitCheck: true },
];
const PRE_PUSH = ".husky/pre-push";
const SHARED_FILE = "shared.txt";
const REPLACEMENT_CASES = MODES.flatMap(mode =>
  ["vitest.config.ts", ".prettierignore"].map(relativePath => ({
    ...mode,
    relativePath,
  }))
);
const HOOK_CASES = MODES.flatMap(mode =>
  [PRE_PUSH, ".husky/post-checkout"].map(relativePath => ({
    ...mode,
    relativePath,
  }))
);
const BEGIN = "# BEGIN: AI GUARDRAILS";
const END = "# END: AI GUARDRAILS";
const OLD_BLOCK = `${BEGIN}\nold-managed-hook\n${END}\n`;
const NEW_BLOCK = `${BEGIN}\nnew-managed-hook\n${END}\n`;
const HOST_PREFIX = "#!/bin/sh\n# host prelude\n";
const HOST_SUFFIX = "# host epilogue\necho host\n";
const OLD_HOOK = HOST_PREFIX + OLD_BLOCK + HOST_SUFFIX;
const NEW_HOOK = HOST_PREFIX + NEW_BLOCK + HOST_SUFFIX;
const OLD = "previous-template\n";
let tempDir = "";

beforeEach(async () => {
  tempDir = await createTempDir();
});
afterEach(async () => {
  await cleanupTempDir(tempDir);
});

/**
 * Use real files; only the context callbacks are injected unit collaborators.
 * @param relativePath Destination being exercised.
 * @param source Current packaged template bytes.
 * @param destination Existing host bytes.
 * @param mode Actual consent and git-check inputs, independently varied.
 * @param overrides Additional configuration for a control.
 * @returns File paths and observed context callbacks.
 */
async function fixture(
  relativePath: string,
  source: string,
  destination: string,
  mode: (typeof MODES)[number],
  overrides: Partial<LisaConfig> = {}
) {
  const src = path.join(tempDir, "source", relativePath);
  const dest = path.join(tempDir, "host", relativePath);
  await fs.outputFile(src, source);
  await fs.outputFile(dest, destination);
  const backupFile = vi.fn(async (file: string) => {
    expect(await fs.readFile(file, "utf8")).toBe(destination);
  });
  const promptOverwrite = vi.fn(async () => true);
  const context: StrategyContext = {
    config: {
      lisaDir: path.join(tempDir, "source"),
      destDir: path.join(tempDir, "host"),
      dryRun: false,
      validateOnly: false,
      harness: "codex",
      yesMode: mode.yesMode,
      skipGitCheck: mode.skipGitCheck,
      ...overrides,
    },
    unattended: mode.unattended,
    backupFile,
    promptOverwrite,
  };
  return { src, dest, context, backupFile, promptOverwrite };
}

describe("declared replacement consent", () => {
  it.each(REPLACEMENT_CASES)(
    "delivers the real template with %j",
    async mode => {
      const { relativePath } = mode;
      const source = await fs.readFile(
        path.resolve("typescript/copy-overwrite", relativePath),
        "utf8"
      );
      expect(source).toContain("IS replaced on each");
      const f = await fixture(relativePath, source, OLD, mode);
      const strategy = new CopyOverwriteStrategy();
      expect(
        (await strategy.apply(f.src, f.dest, relativePath, f.context)).action
      ).toBe("overwritten");
      expect(await fs.readFile(f.dest, "utf8")).toBe(source);
      expect(f.backupFile).toHaveBeenCalledExactlyOnceWith(f.dest);
      expect(
        (await strategy.apply(f.src, f.dest, relativePath, f.context)).action
      ).toBe("skipped");
      expect(f.backupFile).toHaveBeenCalledTimes(1);
      if (mode.unattended) expect(f.promptOverwrite).not.toHaveBeenCalled();
    }
  );

  it.each(MODES)(
    "preserves both curated configurations with %j",
    async mode => {
      for (const relativePath of ["knip.json", "audit.ignore.config.json"]) {
        const source = await fs.readFile(
          path.resolve("typescript/copy-overwrite", relativePath),
          "utf8"
        );
        const host = '{"host-owned":["keep-this"]}\n';
        const f = await fixture(relativePath, source, host, mode);
        expect(
          (
            await new CopyOverwriteStrategy().apply(
              f.src,
              f.dest,
              relativePath,
              f.context
            )
          ).action
        ).toBe("stale");
        expect(await fs.readFile(f.dest, "utf8")).toBe(host);
        expect(f.backupFile).not.toHaveBeenCalled();
        expect(f.promptOverwrite).not.toHaveBeenCalled();
      }
    }
  );

  it.each([false, true])(
    "uses the attended prompt despite the git waiver: %s",
    async accepted => {
      const mode = { yesMode: false, unattended: false, skipGitCheck: true };
      const f = await fixture(SHARED_FILE, "new\n", OLD, mode);
      f.promptOverwrite.mockResolvedValue(accepted);
      const result = await new CopyOverwriteStrategy().apply(
        f.src,
        f.dest,
        SHARED_FILE,
        f.context
      );
      expect(result.action).toBe(accepted ? "overwritten" : "skipped");
      expect(f.promptOverwrite).toHaveBeenCalledExactlyOnceWith(
        SHARED_FILE,
        f.src,
        f.dest
      );
      expect(await fs.readFile(f.dest, "utf8")).toBe(accepted ? "new\n" : OLD);
      expect(f.backupFile).toHaveBeenCalledTimes(accepted ? 1 : 0);
    }
  );
});

describe("block merge consent", () => {
  it.each(HOOK_CASES)(
    "preserves the exact host prefix/suffix with %j",
    async mode => {
      const { relativePath } = mode;
      const f = await fixture(relativePath, NEW_BLOCK, OLD_HOOK, mode);
      const strategy = new CopyContentsStrategy();
      const first = await strategy.apply(
        f.src,
        f.dest,
        relativePath,
        f.context
      );
      expect(first.action).toBe(mode.unattended ? "stale" : "merged");
      expect(await fs.readFile(f.dest, "utf8")).toBe(
        mode.unattended ? OLD_HOOK : NEW_HOOK
      );
      expect(f.backupFile).toHaveBeenCalledTimes(mode.unattended ? 0 : 1);
      if (!mode.unattended) {
        expect(
          (await strategy.apply(f.src, f.dest, relativePath, f.context)).action
        ).toBe("skipped");
        expect(f.backupFile).toHaveBeenCalledTimes(1);
      }
      expect(f.promptOverwrite).not.toHaveBeenCalled();
    }
  );

  it.each([false, true])(
    "honors only the approved unattended refresh: skipGitCheck=%s",
    async skipGitCheck => {
      const mode = { yesMode: false, unattended: true, skipGitCheck };
      const context = {
        refreshTemplates: {
          mode: "paths" as const,
          paths: [PRE_PUSH],
        },
      };
      for (const relativePath of [PRE_PUSH, ".husky/post-checkout"]) {
        const f = await fixture(
          relativePath,
          NEW_BLOCK,
          OLD_HOOK,
          mode,
          context
        );
        const approved = relativePath === PRE_PUSH;
        expect(
          (
            await new CopyContentsStrategy().apply(
              f.src,
              f.dest,
              relativePath,
              f.context
            )
          ).action
        ).toBe(approved ? "merged" : "stale");
        expect(await fs.readFile(f.dest, "utf8")).toBe(
          approved ? NEW_HOOK : OLD_HOOK
        );
        expect(f.backupFile).toHaveBeenCalledTimes(approved ? 1 : 0);
      }
    }
  );

  it.each(MODES)(
    "dry-run leaves files and backups intact with %j",
    async mode => {
      for (const [relativePath, source, destination, strategy] of [
        [
          "vitest.config.ts",
          "// IS replaced on each lisa run\n",
          OLD,
          new CopyOverwriteStrategy(),
        ],
        [PRE_PUSH, NEW_BLOCK, OLD_HOOK, new CopyContentsStrategy()],
      ] as const) {
        const f = await fixture(relativePath, source, destination, mode, {
          dryRun: true,
        });
        await strategy.apply(f.src, f.dest, relativePath, f.context);
        expect(await fs.readFile(f.dest, "utf8")).toBe(destination);
        expect(f.backupFile).not.toHaveBeenCalled();
      }
    }
  );
});
