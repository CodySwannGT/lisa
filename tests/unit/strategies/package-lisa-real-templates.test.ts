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
  createExpoProject,
} from "../../helpers/test-utils.js";
import { describe, expect, it } from "vitest";
import {
  APPLYING_VERSION,
  buildStrategyContext,
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

  // Regression (#4508): every template forced oxlint and eslint-plugin-oxlint
  // to the EXACT release 1.62.0, so an apply rewrote a host's `^1.62.0` to
  // `1.62.0` and walked a lockfile that had resolved a compatible newer
  // release back down, re-dirtying the host on every session-start sync. The
  // constraint that actually exists is a ceiling, not a point: 1.86.0 is the
  // release the parity review stopped at (its preset disables five JSDoc rules;
  // Lisa's shared ESLint rules restore the two that were live, and the parity
  // test records the other three as deliberately off). So the force is a
  // bounded range, and the existing host-ahead logic decides the rest. These
  // cases drive the REAL shipped templates so the range cannot drift.
  describe("oxlint pair is forced as a bounded range, not an exact pin", () => {
    const repoRoot = process.cwd();
    const OXLINT_RANGE = ">=1.62.0 <1.86.0";
    const OXLINT_PACKAGES = ["oxlint", "eslint-plugin-oxlint"] as const;

    /**
     * Apply a real shipped template over a host that pins the oxlint pair.
     * @param stack - The template stack whose package.lisa.json is applied.
     * @param hostRange - The range the host already carries for both packages.
     * @returns The ranges written for both packages plus any refusal error.
     */
    const applyRealOxlintPin = async (
      stack: "typescript" | "expo",
      hostRange: string
    ): Promise<{
      written: Record<string, unknown>;
      error: Error | null;
    }> => {
      if (stack === "expo") {
        await createExpoProject(projectDir);
      } else {
        await createTypeScriptProject(projectDir);
      }
      const destPath = path.join(projectDir, PACKAGE_JSON);
      await fs.writeJson(destPath, {
        name: HOST_PROJECT,
        devDependencies: Object.fromEntries(
          OXLINT_PACKAGES.map(pkg => [pkg, hostRange])
        ),
        scripts: {},
      });
      const error = await strategy
        .apply(
          path.join(repoRoot, stack, PACKAGE_LISA_DIR, PACKAGE_LISA_JSON),
          destPath,
          PACKAGE_JSON,
          createContext({ lisaDir: repoRoot })
        )
        .then(
          () => null,
          (caught: unknown) => caught as Error
        );
      const content = await fs.readJson(destPath);
      return {
        written: Object.fromEntries(
          OXLINT_PACKAGES.map(pkg => [pkg, content.devDependencies?.[pkg]])
        ),
        error,
      };
    };

    // THE BITE. The reported repro: a host on `^1.62.0` must not be rewritten
    // to an exact pin that drags its lockfile back to 1.62.0.
    it("does not collapse a host caret range to an exact 1.62.0 pin", async () => {
      const outcome = await applyRealOxlintPin("typescript", "^1.62.0");

      expect(outcome.error).toBeNull();
      expect(outcome.written).toEqual({
        oxlint: OXLINT_RANGE,
        "eslint-plugin-oxlint": OXLINT_RANGE,
      });
      // The reported host's resolved release stays installable, and the
      // unreviewed preset does not.
      expect(satisfies("1.73.0", OXLINT_RANGE)).toBe(true);
      expect(satisfies("1.86.0", OXLINT_RANGE)).toBe(false);
    });

    it("keeps a host that pins a newer release inside the validated range", async () => {
      const outcome = await applyRealOxlintPin("typescript", "1.73.0");

      expect(outcome.error).toBeNull();
      expect(outcome.written).toEqual({
        oxlint: "1.73.0",
        "eslint-plugin-oxlint": "1.73.0",
      });
    });

    it("keeps an in-range newer pin on the Expo template too", async () => {
      const outcome = await applyRealOxlintPin("expo", "1.73.0");

      expect(outcome.error).toBeNull();
      expect(outcome.written).toEqual({
        oxlint: "1.73.0",
        "eslint-plugin-oxlint": "1.73.0",
      });
    });

    // `^1.73.0` admits 1.86.0+, whose preset has not been reviewed against
    // Lisa's lint policy, so it is neither "behind" (template raises it) nor a
    // provable subset (host kept). `classifyHostPin` calls that incomparable
    // and REFUSES, naming both sides — Lisa must neither silently admit an
    // unreviewed preset nor silently downgrade the host.
    it("refuses a host range that admits releases above the ceiling and names both sides", async () => {
      const outcome = await applyRealOxlintPin("typescript", "^1.73.0");

      expect(outcome.error).not.toBeNull();
      expect(outcome.error?.message).toContain("^1.73.0");
      expect(outcome.error?.message).toContain(OXLINT_RANGE);
      // Refusing means refusing: the host manifest is left as it was.
      expect(outcome.written.oxlint).toBe("^1.73.0");
    });

    it("raises a stale host floor to the bounded range", async () => {
      const outcome = await applyRealOxlintPin("typescript", "^1.0.0");

      expect(outcome.error).toBeNull();
      expect(outcome.written).toEqual({
        oxlint: OXLINT_RANGE,
        "eslint-plugin-oxlint": OXLINT_RANGE,
      });
    });

    // Every stack template (and the root governance file) must force the same
    // range, so no stack silently reintroduces the exact pin.
    it.each([
      PACKAGE_LISA_JSON,
      "typescript/package-lisa/package.lisa.json",
      "expo/package-lisa/package.lisa.json",
      "nestjs/package-lisa/package.lisa.json",
      "cdk/package-lisa/package.lisa.json",
      "phaser/package-lisa/package.lisa.json",
      "harper-fabric/package-lisa/package.lisa.json",
    ])("%s forces the oxlint pair as the bounded range", file => {
      const template = fs.readJsonSync(path.join(repoRoot, file)) as {
        force: { devDependencies: Record<string, string> };
      };
      for (const pkg of OXLINT_PACKAGES) {
        expect(template.force.devDependencies[pkg]).toBe(OXLINT_RANGE);
      }
    });
  });

  describe("NestJS real template: split-major pins stay in defaults", () => {
    // Regression: class-validator and the @graphql-codegen/* toolchain used
    // to sit in `force`, but the fleet is legitimately split across their
    // majors (acmeorgb/backend-v2 on codegen cli 6/typescript 4 +
    // class-validator 0.14; acmeorgd-backend, acmeorgc/backend and
    // nestjsstarter on codegen cli 7/typescript 6 + class-validator 0.15).
    // Because force REPLACES project values, whichever side the template
    // didn't match got a silent major downgrade/upgrade on every apply, plus
    // a frozen-lockfile CI break. These packages live in `defaults` (project
    // value wins); the convergent framework core (@nestjs/*, typeorm, pg)
    // legitimately stays in force.
    const repoRoot = process.cwd();
    const nestSource = path.join(
      repoRoot,
      "nestjs",
      PACKAGE_LISA_DIR,
      PACKAGE_LISA_JSON
    );

    /**
     * Read and parse the real shipped NestJS package.lisa.json template.
     * @returns The parsed template with force/defaults sections.
     */
    function readNestTemplate(): {
      force: {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
      defaults: {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
    } {
      return fs.readJsonSync(nestSource);
    }

    it("leaves class-validator to the host: never forced, no longer defaulted", () => {
      // Split-major across hosts, so it was never forced; and unused until a
      // host writes a DTO, so Lisa stopped defaulting it (CodySwannGT/lisa#4932).
      const template = readNestTemplate();
      expect(template.force.dependencies["class-validator"]).toBeUndefined();
      expect(template.defaults.dependencies["class-validator"]).toBeUndefined();
    });

    it("leaves @graphql-codegen/* to the host: never forced, no longer defaulted", () => {
      const template = readNestTemplate();
      for (const pkg of [
        "@graphql-codegen/cli",
        "@graphql-codegen/typescript",
        "@graphql-codegen/typescript-operations",
      ]) {
        expect(template.force.devDependencies[pkg]).toBeUndefined();
        expect(template.defaults.devDependencies[pkg]).toBeUndefined();
      }
    });

    it("keeps the convergent NestJS framework core in force", () => {
      const template = readNestTemplate();
      for (const pkg of ["@nestjs/common", "@nestjs/core", "typeorm", "pg"]) {
        expect(template.force.dependencies[pkg]).toBeDefined();
      }
    });
  });

  describe("CDK real template: aws-cdk-lib stays in defaults", () => {
    // Regression: aws-cdk-lib was force-pinned EXACTLY (2.246.0), so a
    // project that had moved ahead (acmeorgc/infrastructure on 2.259.0) got a
    // 13-minor downgrade on the next apply — which can break synth for
    // stacks using newer constructs. Projects own their aws-cdk-lib pace;
    // CVE-driven bumps go through per-repo security gates instead. The
    // paired @aws-cdk/aws-amplify-alpha is no longer declared at all: it is
    // an opt-in construct library the host owns (#4451). The $name overrides/resolutions
    // entries stay in force and resolve against the project's own direct
    // dep, so they remain valid with the pin in defaults.
    const repoRoot = process.cwd();
    const cdkSource = path.join(
      repoRoot,
      "cdk",
      PACKAGE_LISA_DIR,
      PACKAGE_LISA_JSON
    );

    /**
     * Read and parse the real shipped CDK package.lisa.json template.
     * @returns The parsed template with force/defaults sections.
     */
    function readCdkTemplate(): {
      force: {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        overrides: Record<string, string>;
        resolutions: Record<string, string>;
      };
      defaults: {
        dependencies: Record<string, string>;
      };
    } {
      return fs.readJsonSync(cdkSource);
    }

    it("keeps aws-cdk-lib in defaults, not force", () => {
      const template = readCdkTemplate();
      expect(template.force.dependencies["aws-cdk-lib"]).toBeUndefined();
      // Exact pin (not just "is defined") so an accidental version bump in
      // the template is caught by this regression test.
      expect(template.defaults.dependencies["aws-cdk-lib"]).toBe("2.272.0");
    });

    it("declares no opt-in construct library in force or defaults", () => {
      // An app opts into these by importing them; Lisa generates no code that
      // does. A defaults entry re-adds a key the host removed on every apply,
      // so an unused one fails the dead-code gate forever (#4451).
      const template = readCdkTemplate();
      for (const pkg of ["@aws-cdk/aws-amplify-alpha", "aws-cdk-github-oidc"]) {
        expect(Object.keys(template.force.dependencies)).not.toContain(pkg);
        expect(Object.keys(template.defaults.dependencies)).not.toContain(pkg);
      }
    });

    it("keeps the aws-cdk CLI floor and $name overrides in force", () => {
      const template = readCdkTemplate();
      // A caret floor can only pull projects forward, never downgrade.
      expect(template.force.devDependencies["aws-cdk"]).toBe("^2.1127.0");
      expect(template.force.overrides["aws-cdk-lib"]).toBe("$aws-cdk-lib");
      expect(template.force.resolutions["aws-cdk-lib"]).toBe("$aws-cdk-lib");
    });
  });
});
