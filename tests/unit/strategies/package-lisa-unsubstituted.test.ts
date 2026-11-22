import * as fs from "fs-extra";
import * as path from "node:path";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import {
  createTempDir,
  cleanupTempDir,
  createTypeScriptProject,
} from "../../helpers/test-utils.js";
import { describe, expect, it } from "vitest";
import {
  APPLYING_VERSION,
  buildStrategyContext,
  writePackageLisaTemplate,
  PACKAGE_JSON,
  PACKAGE_LISA_DIR,
  PACKAGE_LISA_JSON,
} from "./package-lisa-fixtures.js";

describe("PackageLisaStrategy", () => {
  let strategy: PackageLisaStrategy;
  let tempDir: string;
  let lisaDir: string;
  let projectDir: string;

  beforeEach(async () => {
    strategy = new PackageLisaStrategy(() => APPLYING_VERSION);
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
   * Create a strategy context for testing
   * @param overrides - Configuration overrides for this test case
   * @returns StrategyContext with mocked callbacks
   */
  function createContext(overrides: Partial<LisaConfig> = {}): StrategyContext {
    return buildStrategyContext(lisaDir, projectDir, overrides);
  }

  /**
   * Create package.lisa.json template in Lisa directory
   * @param typeName - The project type (e.g., "all", "typescript", "expo")
   * @param template - The package.lisa.json template object with force/defaults/merge sections
   * @returns Promise resolving when template is created
   */
  async function createPackageLisaTemplate(
    typeName: string,
    template: object
  ): Promise<void> {
    await writePackageLisaTemplate(lisaDir, typeName, template);
  }

  // `$name` is real npm syntax, but ONLY as an overrides/resolutions value
  // backed by a direct dependency carrying a real range — there it means
  // "resolve to that dependency's version" and npm honours it (measured: an
  // overrides `"tar": "$tar"` over `dependencies: {"tar": ">=7.5.11"}` installs
  // tar 7.5.22). Anywhere else the token is not syntax at all, it is a
  // placeholder something failed to substitute, and npm refuses the manifest:
  //
  //   npm error code EINVALIDTAGNAME
  //   npm error Invalid tag name "$tar" of package "tar@$tar"
  //
  // npm runs that validation before doing anything, so every `npm`/`npx` in the
  // project directory fails from then on — including the plugin MCP servers
  // Lisa spawns via `npx`. A manifest that fails loudly at apply time is
  // recoverable; one written silently is found later by someone else.
  describe("unsubstituted $name tokens never reach the written file", () => {
    it("fails the apply when dependencies carries a $name token", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { prettier: "3.8.3" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { tar: "$tar" },
      });

      await expect(
        strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext())
      ).rejects.toThrow(/dependencies\.tar/);
    });

    it("names every dependency section that carries a $name token", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { prettier: "3.8.3" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        devDependencies: { vite: "$vite" },
        optionalDependencies: { fsevents: "$fsevents" },
        peerDependencies: { react: "$react" },
      });

      await expect(
        strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext())
      ).rejects.toThrow(
        /devDependencies\.vite[\s\S]*optionalDependencies\.fsevents[\s\S]*peerDependencies\.react/
      );
    });

    it("fails the apply under skip-git-check too, where nobody is watching", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { prettier: "3.8.3" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { tar: "$tar" },
      });

      await expect(
        strategy.apply(
          sourcePath,
          destPath,
          PACKAGE_JSON,
          createContext({ skipGitCheck: true })
        )
      ).rejects.toThrow(/dependencies\.tar/);
    });

    it("fails when a $ref is backed by another $ref rather than a real range", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { prettier: "3.8.3" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      // `dependencies.tar` satisfies the presence-only backing check, so the
      // dangling-$ref guard passes — but npm cannot resolve a reference that
      // points at another reference.
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { tar: "$tar" },
        overrides: { tar: "$tar" },
      });

      await expect(
        strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext())
      ).rejects.toThrow(/dependencies\.tar/);
    });

    it("leaves a legitimate npm self-reference alone", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { prettier: "3.8.3" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { tar: ">=7.5.11" },
        overrides: { tar: "$tar" },
        resolutions: { tar: "$tar" },
      });

      const result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      // The file was actually rewritten, so these assertions are not vacuous.
      expect(result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.devDependencies.prettier).toBe("3.8.3");
      expect(content.overrides.tar).toBe("$tar");
      expect(content.resolutions.tar).toBe("$tar");
      expect(content.dependencies.tar).toBe(">=7.5.11");
    });

    it("leaves shell variables in scripts alone", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { prettier: "3.8.3" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { tar: ">=7.5.11" },
        scripts: { prepare: "$npm_execpath run build" },
      });

      const result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      expect(result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.prepare).toBe("$npm_execpath run build");
    });
  });

  // Regression (#1659): running the apply inside the Lisa source repo must
  // apply only dependency governance (security floors) to Lisa's own
  // package.json — never overwrite Lisa's hand-authored scripts/defaults with
  // the templates it ships. Detected via package.json name === @codyswann/lisa.
  describe("self-apply against the Lisa source repo", () => {
    it("applies only dependency governance, preserving Lisa's own scripts", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          resolutions: { ws: ">=8.21.0" },
          overrides: { ws: ">=8.21.0" },
          scripts: { test: "template test" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        PACKAGE_LISA_DIR,
        PACKAGE_LISA_JSON
      );
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "@codyswann/lisa",
        scripts: { test: "vitest run", "build:dist": "tsc" },
        resolutions: { ws: "^8.0.0" },
      });

      // No skip-git-check flag: self-apply must restrict regardless.
      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      const content = await fs.readJson(destPath);
      // Security pins ARE forced even on the source repo.
      expect(content.resolutions.ws).toBe(">=8.21.0");
      expect(content.overrides.ws).toBe(">=8.21.0");
      // Lisa's own scripts are NOT clobbered by the template's force.scripts.
      expect(content.scripts.test).toBe("vitest run");
      expect(content.scripts["build:dist"]).toBe("tsc");
    });
  });
});
