/**
 * `--refresh-templates`: the supported way to deliver a changed managed file
 * to an already-installed project.
 *
 * A non-interactive apply cannot prompt, so by default it leaves a differing
 * managed file alone and reports it as `stale`. That default is right — it is
 * what stops an upgrade quietly replacing a `tsconfig.json` a project has
 * customised — but it left no route at all for shipping a fixed enforcement
 * guard. The only workaround was deleting the file so the create path would
 * pick it up.
 *
 * This flag is the operator saying in advance "take upstream's version of
 * these", scoped to the paths they name. These tests pin both halves: it must
 * refresh what was asked for, and must not touch anything else.
 * @module tests/unit/strategies/copy-overwrite-refresh-templates
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import { beforeEach, afterEach, describe, expect, it } from "vitest";

import { CopyOverwriteStrategy } from "../../../src/strategies/copy-overwrite.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import { createTempDir, cleanupTempDir } from "../../helpers/test-utils.js";

const TSCONFIG_JSON = "tsconfig.json";
const VULNERABLE_GUARD = "#!/usr/bin/env bash\n# vulnerable\n";

describe("CopyOverwriteStrategy", () => {
  let strategy: CopyOverwriteStrategy;
  let tempDir: string;
  let srcDir: string;
  let destDir: string;

  beforeEach(async () => {
    strategy = new CopyOverwriteStrategy();
    tempDir = await createTempDir();
    srcDir = path.join(tempDir, "src");
    destDir = path.join(tempDir, "dest");
    await fs.ensureDir(srcDir);
    await fs.ensureDir(destDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Create a strategy context for testing.
   * @param overrides - Configuration overrides
   * @returns Strategy context with test defaults
   */
  function createContext(overrides: Partial<LisaConfig> = {}): StrategyContext {
    const config: LisaConfig = {
      lisaDir: srcDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
      ...overrides,
    };

    return {
      config,
      backupFile: async () => {},
      promptOverwrite: async () => true,
    };
  }

  describe("--refresh-templates", () => {
    const GUARD = "scripts/lisa-hooks/block-no-verify.sh";
    const FIXED_GUARD = "#!/usr/bin/env bash\n# fixed\n";

    /**
     * Stage a differing managed file inside the temp project.
     * @param rel - Repo-relative path to stage
     * @param srcContent - Content of the packaged template
     * @param destContent - Content already installed in the project
     * @returns Absolute source and destination paths
     */
    async function stage(
      rel: string,
      srcContent: string,
      destContent: string
    ): Promise<{ srcFile: string; destFile: string }> {
      const srcFile = path.join(srcDir, rel);
      const destFile = path.join(destDir, rel);
      await fs.ensureDir(path.dirname(srcFile));
      await fs.ensureDir(path.dirname(destFile));
      await fs.writeFile(srcFile, srcContent);
      await fs.writeFile(destFile, destContent);
      return { srcFile, destFile };
    }

    it("replaces a stale guard when the operator opted in", async () => {
      const { srcFile, destFile } = await stage(
        GUARD,
        FIXED_GUARD,
        VULNERABLE_GUARD
      );

      const result = await strategy.apply(
        srcFile,
        destFile,
        GUARD,
        createContext({
          skipGitCheck: true,
          refreshTemplates: { mode: "all" },
        })
      );

      expect(result.action).toBe("overwritten");
      expect(await fs.readFile(destFile, "utf-8")).toBe(FIXED_GUARD);
    });

    it("backs up before replacing", async () => {
      // Opting in to an overwrite is not opting out of being able to undo it.
      const { srcFile, destFile } = await stage(
        GUARD,
        FIXED_GUARD,
        VULNERABLE_GUARD
      );

      let backedUp: string | null = null;
      const base = createContext({
        skipGitCheck: true,
        refreshTemplates: { mode: "all" },
      });

      await strategy.apply(srcFile, destFile, GUARD, {
        ...base,
        backupFile: async (p: string) => {
          backedUp = p;
        },
      });

      expect(backedUp).toBe(destFile);
    });

    it("refreshes only the scoped paths and leaves the rest stale", async () => {
      // The reason scoping exists: taking a security fix must not cost the
      // project its build config.
      const guard = await stage(GUARD, FIXED_GUARD, VULNERABLE_GUARD);
      const config = await stage(TSCONFIG_JSON, '{"strict":true}', "{}");

      const context = createContext({
        skipGitCheck: true,
        refreshTemplates: { mode: "paths", paths: ["scripts/lisa-hooks"] },
      });

      const guardResult = await strategy.apply(
        guard.srcFile,
        guard.destFile,
        GUARD,
        context
      );
      const configResult = await strategy.apply(
        config.srcFile,
        config.destFile,
        TSCONFIG_JSON,
        context
      );

      expect(guardResult.action).toBe("overwritten");
      expect(configResult.action).toBe("stale");
      expect(await fs.readFile(config.destFile, "utf-8")).toBe("{}");
    });

    it("writes nothing during a dry run", async () => {
      const { srcFile, destFile } = await stage(
        GUARD,
        FIXED_GUARD,
        VULNERABLE_GUARD
      );

      const result = await strategy.apply(
        srcFile,
        destFile,
        GUARD,
        createContext({
          skipGitCheck: true,
          dryRun: true,
          refreshTemplates: { mode: "all" },
        })
      );

      expect(result.action).toBe("overwritten");
      expect(await fs.readFile(destFile, "utf-8")).toBe(VULNERABLE_GUARD);
    });

    it("changes nothing host-owned when the flag is absent", async () => {
      // The default has to stay conservative — this is the behaviour that was
      // protecting customised host config all along.
      //
      // Lisa's own artifacts no longer need the flag: a version bump delivers
      // them, which is what the flag was standing in for. The flag still exists
      // for everything Lisa does not own, which is what this pins.
      const { srcFile, destFile } = await stage(
        TSCONFIG_JSON,
        '{"strict":true}',
        "{}"
      );

      const result = await strategy.apply(
        srcFile,
        destFile,
        TSCONFIG_JSON,
        createContext({ skipGitCheck: true })
      );

      expect(result.action).toBe("stale");
      expect(await fs.readFile(destFile, "utf-8")).toBe("{}");
    });
  });
});
