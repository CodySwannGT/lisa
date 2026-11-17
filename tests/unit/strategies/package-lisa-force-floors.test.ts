import * as fs from "fs-extra";
import * as path from "node:path";
import { satisfies } from "semver";
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
  HOST_PROJECT,
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

  describe("force behavior", () => {
    // Regression: force.resolutions/force.overrides are a security FLOOR, not an
    // assignment. Writing them as a plain overwrite walked hosts BACKWARDS into
    // the vulnerable range they had already escaped — a project pinned at
    // `tar >=7.5.21` was reverted to `>=7.5.11` on every install, and upgrading
    // Lisa did not fix it because the shipped template was still `>=7.5.19`,
    // below the host. A floor can only be right by coincidence when it is
    // written as an overwrite, so the merge now keeps whichever side is higher.
    it("never lowers a host pin that already sits above the template floor", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          resolutions: {
            tar: ">=7.5.19",
            "brace-expansion": ">=5.0.9",
            ws: ">=8.21.0",
          },
          overrides: {
            tar: ">=7.5.19",
            "brace-expansion": ">=5.0.9",
            ws: ">=8.21.0",
          },
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
        name: HOST_PROJECT,
        // Host is AHEAD of the template — must survive.
        resolutions: {
          tar: ">=7.5.21",
          "brace-expansion": ">=5.0.9",
          ws: "^8.0.0",
        },
        overrides: {
          tar: ">=7.5.21",
          "brace-expansion": ">=5.0.9",
          ws: "^8.0.0",
        },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext({ skipGitCheck: true })
      );

      const content = await fs.readJson(destPath);
      for (const section of ["resolutions", "overrides"] as const) {
        // Host floor is HIGHER — the security write must not walk it back.
        expect(content[section].tar).toBe(">=7.5.21");
        // Equal floors — template value is fine, nothing to preserve.
        expect(content[section]["brace-expansion"]).toBe(">=5.0.9");
        // Host floor is LOWER — the force-bump still applies, which is the
        // whole point of the mechanism and must not regress.
        expect(content[section].ws).toBe(">=8.21.0");
      }
    });

    // Regression: the same floor guard covered `overrides`/`resolutions` only,
    // so a host that had raised `dependencies.tar` above the template was walked
    // backwards on every apply — the protection existed and the lowered value
    // simply sat in a section it never looked at.
    it("never lowers a host direct dependency that sits above the template floor", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          dependencies: { tar: ">=7.5.19", ws: ">=8.21.0" },
          devDependencies: { "some-tool": ">=2.0.0" },
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
        name: HOST_PROJECT,
        dependencies: { tar: ">=7.5.21", ws: "^8.0.0" },
        devDependencies: { "some-tool": ">=3.0.0" },
      });

      await strategy.apply(sourcePath, destPath, PACKAGE_JSON, createContext());

      const content = await fs.readJson(destPath);
      // Host floor is HIGHER in both direct-dependency sections — kept.
      expect(content.dependencies.tar).toBe(">=7.5.21");
      expect(content.devDependencies["some-tool"]).toBe(">=3.0.0");
      // Host floor is LOWER — the template still raises it.
      expect(content.dependencies.ws).toBe(">=8.21.0");
    });

    // The amplifier: `overrides.tar` / `resolutions.tar` are `"$tar"`, npm's
    // self-reference, so their effective floor IS `dependencies.tar`. Lowering
    // the direct dependency lowers every override that points at it, while the
    // override entry itself survives untouched — a test asserting only that the
    // `$tar` reference is still there would pass on a weakened tree. This is the
    // exact postinstall path: skip-git-check restricts the apply to the security
    // sections, which pulls the backing direct dependency in with them.
    it("keeps the effective floor of a $name override when the host direct dependency is higher", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          dependencies: { tar: ">=7.5.19" },
          overrides: { tar: "$tar" },
          resolutions: { tar: "$tar" },
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
        name: HOST_PROJECT,
        dependencies: { tar: ">=7.5.21" },
        overrides: { tar: "$tar" },
        resolutions: { tar: "$tar" },
      });

      await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext({ skipGitCheck: true })
      );

      const content = await fs.readJson(destPath);
      expect(content.overrides.tar).toBe("$tar");
      expect(content.resolutions.tar).toBe("$tar");
      expect(content.dependencies.tar).toBe(">=7.5.21");
      // What the `$tar` references now resolve to: 7.5.19 and 7.5.20 are the
      // two releases GHSA-r292-9mhp-454m covers and 7.5.21 is its patch, so
      // this assertion is the effective floor of every override consumer.
      expect(satisfies("7.5.19", content.dependencies.tar)).toBe(false);
      expect(satisfies("7.5.20", content.dependencies.tar)).toBe(false);
      expect(satisfies("7.5.21", content.dependencies.tar)).toBe(true);
    });

    // A host ahead of the template is only decidable when one range contains the
    // other. When neither does, both sides carry a constraint the other drops,
    // and picking either silently is how a lowered floor got shipped in the
    // first place — so the apply refuses and names both.
    it("refuses to merge a dependency pin when neither range contains the other", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { dependencies: { tar: "~7.5.19" } },
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
        name: HOST_PROJECT,
        dependencies: { tar: ">=7.5.21" },
      });

      const error = await strategy
        .apply(sourcePath, destPath, PACKAGE_JSON, createContext())
        .then(
          () => null,
          (caught: unknown) => caught as Error
        );

      expect(error).not.toBeNull();
      expect(error?.message).toContain("dependencies.tar");
      expect(error?.message).toContain(">=7.5.21");
      expect(error?.message).toContain("~7.5.19");
      // Refusing means refusing: the host manifest is left as it was.
      const content = await fs.readJson(destPath);
      expect(content.dependencies.tar).toBe(">=7.5.21");
    });

    it("reports the host pin it kept and why", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { dependencies: { tar: ">=7.5.19" } },
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
        name: HOST_PROJECT,
        dependencies: { tar: ">=7.5.21" },
      });

      const result = await strategy.apply(
        sourcePath,
        destPath,
        PACKAGE_JSON,
        createContext()
      );

      expect(result.note).toContain("dependencies.tar");
      expect(result.note).toContain(">=7.5.21");
      expect(result.note).toContain(">=7.5.19");
    });
  });
});
