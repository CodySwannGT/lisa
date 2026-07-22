/* eslint-disable max-lines -- Test file requires extensive test cases for comprehensive coverage */
/* eslint-disable sonarjs/no-duplicate-string -- Test fixtures necessarily repeat values */
import * as fs from "fs-extra";
import * as path from "node:path";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig } from "../../../src/core/config.js";
import {
  createTempDir,
  cleanupTempDir,
  createTypeScriptProject,
  createExpoProject,
  createNestJSProject,
  createCDKProject,
  createHarperFabricProject,
} from "../../helpers/test-utils.js";

describe("PackageLisaStrategy", () => {
  let strategy: PackageLisaStrategy;
  let tempDir: string;
  let lisaDir: string;
  let projectDir: string;

  beforeEach(async () => {
    strategy = new PackageLisaStrategy();
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
    const config: LisaConfig = {
      lisaDir,
      destDir: projectDir,
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
    const dir = path.join(lisaDir, typeName, "package-lisa");
    await fs.ensureDir(dir);
    await fs.writeJson(path.join(dir, "package.lisa.json"), template);
  }

  describe("basic properties", () => {
    it("has correct name", () => {
      expect(strategy.name).toBe("package-lisa");
    });
  });

  describe("root package template verifier scripts", () => {
    it("preserves the learner frontmatter built verifier", () => {
      const repoRoot = process.cwd();
      const packageJson = fs.readJsonSync(path.join(repoRoot, "package.json"));
      const packageTemplate = fs.readJsonSync(
        path.join(repoRoot, "package.lisa.json")
      );
      const scriptName = "verify:learner-frontmatter-built";

      expect(packageTemplate.force.scripts[scriptName]).toBe(
        packageJson.scripts[scriptName]
      );
      expect(packageTemplate.force.scripts[scriptName]).toBe(
        "bun run build:dist && node scripts/verify-learner-frontmatter-built.mjs"
      );
    });
  });

  describe("when source does not exist", () => {
    it("skips when package.lisa.json not found", async () => {
      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {});

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("skipped");
      expect(_result.strategy).toBe("package-lisa");
    });
  });

  describe("when destination does not exist", () => {
    it("copies file when destination missing", async () => {
      await createPackageLisaTemplate("all", {
        force: { scripts: { test: "jest" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      // In production, Lisa passes package.lisa.json as destPath
      // The strategy should translate this to package.json
      const destPath = path.join(projectDir, "package.lisa.json");
      const actualPackageJson = path.join(projectDir, "package.json");

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.lisa.json",
        createContext()
      );

      expect(_result.action).toBe("copied");
      // Strategy should write to package.json, not package.lisa.json
      expect(_result.relativePath).toBe("package.json");
      const content = await fs.readJson(actualPackageJson);
      expect(content).toEqual({ scripts: { test: "jest" } });
    });
  });

  describe("force behavior", () => {
    it("overwrites existing values with force section", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "jest", build: "tsc" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      // Lisa passes package.lisa.json as destPath, strategy translates to package.json
      const destPath = path.join(projectDir, "package.lisa.json");
      const actualPackageJson = path.join(projectDir, "package.json");
      await fs.writeJson(actualPackageJson, {
        name: "my-project",
        scripts: { build: "rollup", start: "node index.js" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.lisa.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      expect(_result.relativePath).toBe("package.json");
      const content = await fs.readJson(actualPackageJson);
      expect(content.scripts.test).toBe("jest");
      expect(content.scripts.build).toBe("tsc");
      expect(content.scripts.start).toBe("node index.js"); // Preserved
      expect(content.name).toBe("my-project"); // Preserved
    });

    it("adds new values when force key missing from project", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          devDependencies: { eslint: "^9.0.0" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, { name: "my-project" });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.devDependencies).toEqual({ eslint: "^9.0.0" });
    });

    it("preserves existing package.json during skip-git-check applies", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "vitest run" },
          devDependencies: { oxlint: "^1.0.0" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.lisa.json");
      const actualPackageJson = path.join(projectDir, "package.json");
      await fs.writeJson(actualPackageJson, {
        name: "host-project",
        scripts: { test: "host test" },
        devDependencies: { oxlint: "^0.1.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.lisa.json",
        createContext({ skipGitCheck: true })
      );

      expect(_result.action).toBe("skipped");
      expect(await fs.readJson(actualPackageJson)).toEqual({
        name: "host-project",
        scripts: { test: "host test" },
        devDependencies: { oxlint: "^0.1.0" },
      });
    });

    // Regression: under skip-git-check (the postinstall / lisa-update-projects
    // path), host scripts/devDependencies stay preserved BUT the security-
    // critical force.resolutions/force.overrides pins must still apply. Skipping
    // them entirely let transitive-CVE force-bumps (e.g. ws) never reach the
    // project, blocking the pre-push audit hook fleet-wide.
    it("applies force.resolutions/overrides but preserves host scripts/deps under skip-git-check", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          resolutions: { ws: ">=8.21.0" },
          overrides: { ws: ">=8.21.0" },
          scripts: { test: "lisa test" },
          devDependencies: { oxlint: "^1.0.0" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "host-project",
        scripts: { test: "host test" },
        devDependencies: { oxlint: "^0.1.0" },
        resolutions: { ws: "^8.0.0", "other-pkg": "^1.0.0" },
        overrides: { ws: "^8.0.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext({ skipGitCheck: true })
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      // Security pins ARE forced even under skip-git-check
      expect(content.resolutions.ws).toBe(">=8.21.0");
      expect(content.overrides.ws).toBe(">=8.21.0");
      // Sibling entries in the same nested object are preserved
      expect(content.resolutions["other-pkg"]).toBe("^1.0.0");
      // Host scripts/devDependencies are NOT clobbered (preserve-host intent)
      expect(content.scripts.test).toBe("host test");
      expect(content.devDependencies.oxlint).toBe("^0.1.0");
    });

    // Regression: force.resolutions and force.overrides must replace project-side
    // values for package-level dep pinning (e.g. axios). This is the write that
    // was silently lost when `bun add -d @codyswann/lisa@latest` clobbered
    // postinstall changes; see utils/postinstall-trampoline.ts for the
    // package-manager race context.
    it("replaces project resolutions.<pkg> and overrides.<pkg> via force", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          resolutions: { axios: ">=1.15.0" },
          overrides: { axios: ">=1.15.0" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "my-project",
        resolutions: { axios: ">=1.13.5", "other-pkg": "^1.0.0" },
        overrides: { axios: ">=1.13.5", "other-pkg": "^1.0.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      // Force replaces the template-governed entries
      expect(content.resolutions.axios).toBe(">=1.15.0");
      expect(content.overrides.axios).toBe(">=1.15.0");
      // Sibling entries inside the same nested object are preserved
      expect(content.resolutions["other-pkg"]).toBe("^1.0.0");
      expect(content.overrides["other-pkg"]).toBe("^1.0.0");
    });
  });

  // Regression (CDK fleet break, 4/4 repos): a force.overrides/resolutions
  // `$name` self-reference must be accompanied by the backing direct dependency,
  // otherwise the postinstall (skip-git-check) apply writes a dangling `$esbuild`
  // that passes local checks but fails `npm ci` in CI only. See the fleet ledger:
  // qualis-infra #177, gemini infra-v2 #335, cdkstarter #13.
  describe("$name self-reference backing dependency", () => {
    it("materializes the forced devDependency backing a $ref under skip-git-check", async () => {
      await createPackageLisaTemplate("cdk", {
        force: {
          overrides: { esbuild: "$esbuild" },
          resolutions: { esbuild: "$esbuild" },
          devDependencies: { esbuild: "^0.28.1" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "cdk",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      // A CDK project that has NO esbuild direct devDependency yet.
      await createCDKProject(projectDir);
      await fs.writeJson(destPath, {
        name: "cdk-host",
        dependencies: { "aws-cdk-lib": "^2.0.0" },
        devDependencies: { typescript: "^5.0.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext({ skipGitCheck: true })
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      // BOTH the override AND the backing direct devDependency must be present.
      expect(content.overrides.esbuild).toBe("$esbuild");
      expect(content.resolutions.esbuild).toBe("$esbuild");
      expect(content.devDependencies.esbuild).toBe("^0.28.1");
      // Host devDependency untouched.
      expect(content.devDependencies.typescript).toBe("^5.0.0");
    });

    it("materializes the backing devDependency on a full (non-skip-git-check) apply", async () => {
      await createPackageLisaTemplate("cdk", {
        force: {
          overrides: { esbuild: "$esbuild" },
          devDependencies: { esbuild: "^0.28.1" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "cdk",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createCDKProject(projectDir);
      await fs.writeJson(destPath, {
        name: "cdk-host",
        dependencies: { "aws-cdk-lib": "^2.0.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.overrides.esbuild).toBe("$esbuild");
      expect(content.devDependencies.esbuild).toBe("^0.28.1");
    });

    it("fails the apply when a $ref has no backing direct dependency", async () => {
      await createPackageLisaTemplate("cdk", {
        force: {
          // $esbuild referenced but NO force.devDependencies.esbuild, and the
          // host has no esbuild direct dep either — a dangling $ref.
          overrides: { esbuild: "$esbuild" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "cdk",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createCDKProject(projectDir);
      await fs.writeJson(destPath, {
        name: "cdk-host",
        dependencies: { "aws-cdk-lib": "^2.0.0" },
      });

      await expect(
        strategy.apply(sourcePath, destPath, "package.json", createContext())
      ).rejects.toThrow(/Dangling \$esbuild/);
    });

    it("passes when the host already provides the $ref-backing direct dep", async () => {
      await createPackageLisaTemplate("cdk", {
        force: {
          overrides: { esbuild: "$esbuild" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "cdk",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createCDKProject(projectDir);
      await fs.writeJson(destPath, {
        name: "cdk-host",
        dependencies: { "aws-cdk-lib": "^2.0.0" },
        // Host already declares esbuild directly, so $esbuild resolves.
        devDependencies: { esbuild: "^0.25.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.overrides.esbuild).toBe("$esbuild");
      expect(content.devDependencies.esbuild).toBe("^0.25.0");
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
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
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
        "package.json",
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

  describe("defaults behavior", () => {
    it("only sets defaults when key missing from project", async () => {
      await createPackageLisaTemplate("all", {
        defaults: {
          engines: { node: "22.x" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, { name: "my-project" });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.engines).toEqual({ node: "22.x" });
    });

    it("applies default postinstall when project has no postinstall", async () => {
      await createPackageLisaTemplate("typescript", {
        defaults: {
          scripts: {
            build: "tsc",
            postinstall:
              "node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true",
          },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts.postinstall).toBe(
        "node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true"
      );
    });

    it("does not override existing postinstall with default", async () => {
      await createPackageLisaTemplate("typescript", {
        defaults: {
          scripts: {
            build: "tsc",
            postinstall:
              "node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true",
          },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "my-project",
        scripts: { postinstall: "patch-package" },
      });

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts.postinstall).toBe("patch-package");
    });

    it("preserves project values when defaults conflict", async () => {
      await createPackageLisaTemplate("all", {
        defaults: {
          engines: { node: "22.x" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        name: "my-project",
        engines: { node: "20.x", bun: "1.0.0" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.engines.node).toBe("20.x"); // Project value preserved
      expect(content.engines.bun).toBe("1.0.0"); // Project value preserved
    });
  });

  describe("merge behavior", () => {
    it("concatenates arrays without duplication", async () => {
      await createPackageLisaTemplate("all", {
        merge: {
          trustedDependencies: ["@ast-grep/cli", "@sentry/cli"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        trustedDependencies: ["custom-cli"],
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.trustedDependencies).toEqual([
        "@ast-grep/cli",
        "@sentry/cli",
        "custom-cli",
      ]);
    });

    it("deduplicates identical values in merge arrays", async () => {
      await createPackageLisaTemplate("all", {
        merge: {
          trustedDependencies: ["@ast-grep/cli"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      // Project already has the Lisa item plus custom item
      await fs.writeJson(destPath, {
        trustedDependencies: ["@ast-grep/cli", "custom-cli"],
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      // Result is identical to what's already there, so skipped
      expect(_result.action).toBe("skipped");
      const content = await fs.readJson(destPath);
      expect(content.trustedDependencies).toEqual([
        "@ast-grep/cli",
        "custom-cli",
      ]);
    });

    it("creates array if key missing from project", async () => {
      await createPackageLisaTemplate("all", {
        merge: {
          trustedDependencies: ["@ast-grep/cli"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, { name: "my-project" });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.trustedDependencies).toEqual(["@ast-grep/cli"]);
    });

    it("handles merge when project value is not an array", async () => {
      await createPackageLisaTemplate("all", {
        merge: {
          customField: ["item1"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        customField: "not-an-array",
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.customField).toEqual(["item1"]);
    });
  });

  describe("remove behavior", () => {
    it("deletes retired keys from the named section", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { "knip:check": "knip" },
        },
        remove: {
          scripts: ["knip"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        name: "my-project",
        scripts: { knip: "knip", start: "node index.js" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.knip).toBeUndefined(); // Retired key removed
      expect(content.scripts["knip:check"]).toBe("knip"); // Replacement forced
      expect(content.scripts.start).toBe("node index.js"); // Preserved
    });

    it("runs after force so a removed key cannot be reintroduced", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { retired: "should-not-survive" },
        },
        remove: {
          scripts: ["retired"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, { name: "my-project" });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.retired).toBeUndefined();
    });

    it("leaves missing or non-object sections alone", async () => {
      await createPackageLisaTemplate("all", {
        remove: {
          scripts: ["knip"],
          missingSection: ["whatever"],
          arraySection: ["item"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        name: "my-project",
        arraySection: ["item", "other"],
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      // Nothing to remove → output equals input → strategy reports skipped
      expect(_result.action).toBe("skipped");
      const content = await fs.readJson(destPath);
      expect(content.name).toBe("my-project");
      expect(content.scripts).toBeUndefined(); // Still absent, not created
      expect(content.missingSection).toBeUndefined();
      expect(content.arraySection).toEqual(["item", "other"]); // Untouched
    });

    it("concatenates remove lists across the inheritance chain", async () => {
      await createPackageLisaTemplate("typescript", {
        remove: {
          scripts: ["knip"],
        },
      });

      await createPackageLisaTemplate("expo", {
        remove: {
          scripts: ["legacy-expo-script"],
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createExpoProject(projectDir);
      await fs.writeJson(path.join(projectDir, "tsconfig.json"), {});
      await fs.writeJson(destPath, {
        name: "my-project",
        scripts: {
          knip: "knip",
          "legacy-expo-script": "expo legacy",
          start: "expo start",
        },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.knip).toBeUndefined(); // Parent removal applied
      expect(content.scripts["legacy-expo-script"]).toBeUndefined(); // Child removal applied
      expect(content.scripts.start).toBe("expo start"); // Preserved
    });
  });

  describe("inheritance and type hierarchy", () => {
    it("merges templates from all types in inheritance chain", async () => {
      // Setup all → typescript → expo hierarchy
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { lint: "eslint ." },
        },
      });

      await createPackageLisaTemplate("typescript", {
        force: {
          scripts: { typecheck: "tsc --noEmit" },
          devDependencies: { typescript: "^5.0.0" },
        },
      });

      await createPackageLisaTemplate("expo", {
        force: {
          scripts: { start: "expo start" },
        },
      });

      // Create Expo + TypeScript project
      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createExpoProject(projectDir);
      // Also create tsconfig.json to make it a TypeScript project
      await fs.writeJson(path.join(projectDir, "tsconfig.json"), {});

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.lint).toBe("eslint .");
      expect(content.scripts.typecheck).toBe("tsc --noEmit");
      expect(content.scripts.start).toBe("expo start");
      expect(content.devDependencies.typescript).toBe("^5.0.0");
    });

    it("child type overrides parent type in same section", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { build: "all-build" },
        },
      });

      await createPackageLisaTemplate("typescript", {
        force: {
          scripts: { build: "typescript-build" },
        },
      });

      // Create TypeScript project
      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.build).toBe("typescript-build");
    });

    it("CDK type overrides typescript type values", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { lint: "eslint ." },
        },
      });

      await createPackageLisaTemplate("typescript", {
        force: {
          scripts: { build: "tsc" },
        },
      });

      await createPackageLisaTemplate("cdk", {
        force: {
          scripts: { build: "tsc --noEmit" },
        },
      });

      // Create CDK project (which inherits from typescript)
      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createCDKProject(projectDir);

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      // CDK should override typescript's build script
      expect(content.scripts.build).toBe("tsc --noEmit");
      // All's lint script should still be applied
      expect(content.scripts.lint).toBe("eslint .");
    });

    it("Harper/Fabric type overrides typescript type values", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          scripts: { build: "tsc" },
        },
      });

      await createPackageLisaTemplate("harper-fabric", {
        force: {
          scripts: { build: "tsc && node dist/build/build.js" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createHarperFabricProject(projectDir);

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts.build).toBe("tsc && node dist/build/build.js");
    });
  });

  describe("Harper/Fabric real template script paths", () => {
    // Regression for the advisory-rankings build break: Harper/Fabric projects
    // follow the TypeScript-family convention (tsconfig rootDir "src"), so tsc
    // strips the leading "src/" and emits to dist/<subdir>/*.js (e.g.
    // src/build/build.ts -> dist/build/build.js). The shipped package.lisa.json
    // "defaults" must match that emitted layout, NOT a "src"-prefixed dist/src/*
    // path, or a fresh project's `bun run build` fails with
    // "Cannot find module .../dist/src/build/build.js". These tests load the
    // REAL templates (lisaDir = repo root) so the defaults can never drift back.
    const repoRoot = process.cwd();
    const harperSource = path.join(
      repoRoot,
      "harper-fabric",
      "package-lisa",
      "package.lisa.json"
    );

    it("fills a fresh project with dist/<subdir> build scripts, never dist/src/*", async () => {
      await createHarperFabricProject(projectDir);
      // A fresh Harper/Fabric project has no build-output-dependent scripts yet.
      await fs.writeJson(path.join(projectDir, "package.json"), {
        private: true,
        dependencies: { harperdb: "^4.7.29" },
        devDependencies: { typescript: "^6.0.0" },
        scripts: {},
      });
      const destPath = path.join(projectDir, "package.json");

      await strategy.apply(
        harperSource,
        destPath,
        "package.json",
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts.build).toBe("tsc && node dist/build/build.js");
      expect(content.scripts.seed).toBe(
        "bun run build && node dist/scripts/seed.js"
      );
      const srcPrefixed = Object.entries(
        content.scripts as Record<string, string>
      ).filter(([, value]) => value.includes("dist/src/"));
      expect(srcPrefixed).toEqual([]);
    });

    it("never clobbers a project's own build-output-dependent scripts (defaults semantics)", async () => {
      await createHarperFabricProject(projectDir);
      const destPath = path.join(projectDir, "package.json");
      // Project pins its own emit paths (e.g. a custom outDir layout).
      await fs.writeJson(destPath, {
        private: true,
        dependencies: { harperdb: "^4.7.29" },
        devDependencies: { typescript: "^6.0.0" },
        scripts: {
          build: "tsc && node dist/custom/build.js",
          seed: "bun run build && node dist/custom/seed.js",
        },
      });

      await strategy.apply(
        harperSource,
        destPath,
        "package.json",
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts.build).toBe("tsc && node dist/custom/build.js");
      expect(content.scripts.seed).toBe(
        "bun run build && node dist/custom/seed.js"
      );
    });
  });

  describe("TypeScript real template: security resolution floors", () => {
    // Governance: the typescript/package-lisa/package.lisa.json force blocks must
    // carry every security floor that package.json (root) carries. This test loads
    // the REAL template so drift can never silently creep back.
    const repoRoot = process.cwd();
    const tsSource = path.join(
      repoRoot,
      "typescript",
      "package-lisa",
      "package.lisa.json"
    );

    /**
     * Read and parse the real shipped TypeScript package.lisa.json template.
     * @returns The parsed template with force section.
     */
    function readTsTemplate(): {
      force: {
        resolutions: Record<string, string>;
        overrides: Record<string, string>;
      };
    } {
      return fs.readJsonSync(tsSource);
    }

    it("includes lodash floor in force.resolutions to match root package.json governance", () => {
      const template = readTsTemplate();
      expect(template.force.resolutions["lodash"]).toBeDefined();
      expect(template.force.resolutions["lodash"]).toBe(">=4.18.1");
    });

    it("includes lodash floor in force.overrides to match root package.json governance", () => {
      const template = readTsTemplate();
      expect(template.force.overrides["lodash"]).toBeDefined();
      expect(template.force.overrides["lodash"]).toBe(">=4.18.1");
    });

    it("keeps vite npm override compatible with the root direct dependency", () => {
      const rootPackageJson = fs.readJsonSync(
        path.join(repoRoot, "package.json")
      );
      const template = readTsTemplate();

      expect(template.force.resolutions["vite"]).toBe(">=8.0.16");
      expect(template.force.overrides["vite"]).toBe(
        rootPackageJson.devDependencies.vite
      );
    });
  });

  describe("Expo real template: dual SDK 54/57 support", () => {
    // Regression: the Expo package.lisa.json used to hard-pin the entire
    // SDK-coupled dependency set (expo, react, react-native, every expo-*,
    // jest-expo, the react-native-* runtime libs, @sentry/react-native, etc.)
    // in `force`. Because force REPLACES project values, updating Lisa on an
    // Expo SDK 54 app force-bundled a full SDK 54->56 + RN 0.81->0.85 major
    // upgrade (blocked propswap/frontend, thumbwar/frontend, expostarter).
    // The fix moves the SDK-version-coupled packages to `defaults` (project
    // value wins; Lisa is only a fallback for fresh projects), while pure
    // tooling stays in `force`. These tests load the REAL template
    // (lisaDir = repo root) so the placement can never drift back.
    const repoRoot = process.cwd();
    const expoSource = path.join(
      repoRoot,
      "expo",
      "package-lisa",
      "package.lisa.json"
    );
    const expectedMaestroScripts = {
      "maestro:test": "maestro test .maestro/flows",
      "maestro:test:ios": "maestro test -p ios .maestro/flows",
      "maestro:test:android": "maestro test -p android .maestro/flows",
      "maestro:test:smoke":
        "maestro test -p ios --include-tags=smoke .maestro/flows",
    } as const;

    /**
     * Read and parse the real shipped Expo package.lisa.json template.
     * @returns The parsed template with force/defaults sections.
     */
    function readExpoTemplate(): {
      force: {
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
        resolutions: Record<string, string>;
        overrides: Record<string, string>;
      };
      defaults: {
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
    } {
      return fs.readJsonSync(expoSource);
    }

    it("pins each platform-specific Maestro command to its intended device type", () => {
      const template = readExpoTemplate();

      expect(template.force.scripts).toMatchObject(expectedMaestroScripts);
    });

    it("repairs the fast-xml-parser advisory floor during full and postinstall applies", async () => {
      const vulnerableFloor = "^5.3.6";
      const patchedFloor = "^5.10.1";
      const destPath = path.join(projectDir, "package.json");
      await createExpoProject(projectDir);
      await fs.writeJson(destPath, {
        name: "expo-security-fixture",
        dependencies: { expo: "~57.0.0" },
        resolutions: { "fast-xml-parser": vulnerableFloor },
        overrides: { "fast-xml-parser": vulnerableFloor },
      });

      await strategy.apply(
        expoSource,
        destPath,
        "package.json",
        createContext({ lisaDir: repoRoot })
      );

      let content = await fs.readJson(destPath);
      expect(content.resolutions["fast-xml-parser"]).toBe(patchedFloor);
      expect(content.overrides["fast-xml-parser"]).toBe(patchedFloor);

      await fs.writeJson(destPath, {
        ...content,
        resolutions: { "fast-xml-parser": vulnerableFloor },
        overrides: { "fast-xml-parser": vulnerableFloor },
      });
      await strategy.apply(
        expoSource,
        destPath,
        "package.json",
        createContext({ lisaDir: repoRoot, skipGitCheck: true })
      );

      content = await fs.readJson(destPath);
      expect(content.resolutions["fast-xml-parser"]).toBe(patchedFloor);
      expect(content.overrides["fast-xml-parser"]).toBe(patchedFloor);
    });

    it("repairs unpinned Maestro commands when applying the Expo template", async () => {
      await createExpoProject(projectDir);
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        dependencies: {},
        devDependencies: {},
        scripts: {
          "maestro:test": "maestro test custom-flows",
          "maestro:test:ios": "maestro test .maestro/flows",
          "maestro:test:android": "maestro test .maestro/flows",
          "maestro:test:smoke":
            "maestro test --include-tags=smoke .maestro/flows",
        },
      });

      await strategy.apply(
        expoSource,
        destPath,
        "package.json",
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts).toMatchObject(expectedMaestroScripts);
    });

    it("keeps SDK-version-coupled packages in defaults, not force", () => {
      const template = readExpoTemplate();
      const sdkCoupled = [
        "expo",
        "react",
        "react-dom",
        "react-native",
        "expo-router",
        "expo-updates",
        "react-native-reanimated",
        "react-native-screens",
        "@sentry/react-native",
        "@shopify/react-native-skia",
      ];
      for (const pkg of sdkCoupled) {
        expect(template.defaults.dependencies[pkg]).toBeDefined();
        expect(template.force.dependencies[pkg]).toBeUndefined();
      }
      // Every expo-* runtime package must be a default, never forced.
      for (const pkg of Object.keys(template.defaults.dependencies)) {
        if (pkg.startsWith("expo")) {
          expect(template.force.dependencies[pkg]).toBeUndefined();
        }
      }
      // SDK-coupled jest-expo stays a default (never forced).
      expect(template.defaults.devDependencies["jest-expo"]).toBeDefined();
      expect(template.force.devDependencies["jest-expo"]).toBeUndefined();
      // react-test-renderer must NOT be pinned by Lisa at all. @testing-library/
      // react-native v13 requires react-test-renderer to match the project's
      // installed React exactly, and jest-expo already brings the matched version
      // transitively (54 → 19.1.0, 56 → 19.2.3). A hardcoded default (e.g. 19.2.3)
      // would override jest-expo's 19.1.0 on an SDK-54 project and break its test
      // suite with "Expected 19.1.0, but found 19.2.3".
      expect(
        template.defaults.devDependencies["react-test-renderer"]
      ).toBeUndefined();
      expect(
        template.force.devDependencies["react-test-renderer"]
      ).toBeUndefined();
    });

    it("removes the inherited TypeScript Vitest mutation runner for Expo", () => {
      const template = readExpoTemplate() as ReturnType<
        typeof readExpoTemplate
      > & {
        remove: { devDependencies: string[] };
      };

      expect(
        template.force.devDependencies["@stryker-mutator/jest-runner"]
      ).toBeDefined();
      expect(
        template.force.devDependencies["@stryker-mutator/vitest-runner"]
      ).toBeUndefined();
      expect(template.remove.devDependencies).toContain(
        "@stryker-mutator/vitest-runner"
      );
    });

    it("keeps non-SDK-coupled tooling/governance in force", () => {
      const template = readExpoTemplate();
      // Pure JS tooling stays forced (governance-critical).
      expect(template.force.dependencies["@apollo/client"]).toBeDefined();
      // apollo-link-sentry must be pinned to EXACTLY 4.4.0 — it is the only
      // release that satisfies BOTH forced majors simultaneously:
      //   - @apollo/client v3 (forced): 4.5.0 bumped its peer to
      //     `@apollo/client@^4.0.10`, so any >=4.5.0 (incl. a `^4.0.0` range)
      //     makes SentryLink fail to typecheck against v3 (blocked expostarter).
      //   - @sentry/react-native ~7.x (Sentry v8 SDK): the 3.x line imports and
      //     calls `Sentry.configureScope`, which Sentry v8 REMOVED — so 3.3.0
      //     throws `(0, t.configureScope) is not a function` on EVERY GraphQL
      //     request at runtime (broke geminisportsai/frontend-v2 in dev and the
      //     prod path of expostarter/thumbwar where the Sentry DSN is set).
      // 4.4.0 (Apollo v3 peer + Sentry v8 API) is the only compatible version,
      // so it is pinned exactly — a range re-opens one failure mode or the other.
      expect(template.force.dependencies["@apollo/client"]).toMatch(/^\^?3\./);
      expect(template.force.dependencies["apollo-link-sentry"]).toBe("4.4.0");
      expect(template.force.dependencies["zod"]).toBeDefined();
      // tailwindcss must stay in defaults, NEVER force: the tailwind major is
      // coupled to the project's gluestack-ui generation (v3/v4 → tailwind ^3 +
      // nativewind 4; v5 → tailwind ^4.2 + nativewind 5 per
      // https://gluestack.io/ui/docs/guides/more/upgrade-to-v5), and the fleet
      // runs both generations. A forced pin silently downgraded a tailwind-4
      // project (TunnlAI/frontend) on every apply and broke its frozen
      // lockfile in CI.
      expect(template.force.dependencies["tailwindcss"]).toBeUndefined();
      expect(template.defaults.dependencies["tailwindcss"]).toBeDefined();
      // @graphql-codegen/* must stay in defaults, NEVER force: the fleet is
      // split across codegen generations (backend-v2 on cli 6/typescript 4,
      // tunnl/gunnertech/nestjsstarter on cli 7/typescript 6), and a forced
      // pin downgrades whichever side the template doesn't match. Frontends
      // can drift the same way, so the expo template gets the same treatment
      // as the nestjs one.
      for (const pkg of [
        "@graphql-codegen/cli",
        "@graphql-codegen/typescript",
        "@graphql-codegen/typescript-operations",
        "@graphql-codegen/typescript-react-apollo",
      ]) {
        expect(template.force.devDependencies[pkg]).toBeUndefined();
        expect(template.defaults.devDependencies[pkg]).toBeDefined();
      }
      expect(template.force.devDependencies["jest"]).toBeDefined();
      expect(template.force.devDependencies["oxlint"]).toBeDefined();
      expect(template.force.devDependencies["@playwright/test"]).toBeDefined();
      // Lint/test config deps must never leak into defaults.
      expect(template.defaults.dependencies["zod"]).toBeUndefined();
      expect(template.defaults.devDependencies["oxlint"]).toBeUndefined();
    });

    it("preserves an existing SDK 54 project's installed Expo/RN versions on update", async () => {
      await createExpoProject(projectDir);
      const destPath = path.join(projectDir, "package.json");
      // An app already on Expo SDK 54 / RN 0.81.
      await fs.writeJson(destPath, {
        dependencies: {
          expo: "~54.0.0",
          react: "19.1.0",
          "react-native": "0.81.4",
          "expo-router": "~54.0.0",
          "react-native-reanimated": "~3.16.0",
        },
        devDependencies: {
          "jest-expo": "~54.0.0",
        },
        scripts: {},
      });

      await strategy.apply(
        expoSource,
        destPath,
        "package.json",
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      // The project stays on SDK 54 — Lisa must NOT force-bump it to 56.
      expect(content.dependencies.expo).toBe("~54.0.0");
      expect(content.dependencies.react).toBe("19.1.0");
      expect(content.dependencies["react-native"]).toBe("0.81.4");
      expect(content.dependencies["expo-router"]).toBe("~54.0.0");
      expect(content.dependencies["react-native-reanimated"]).toBe("~3.16.0");
      expect(content.devDependencies["jest-expo"]).toBe("~54.0.0");
    });

    it("gives a fresh project the default SDK 57 versions", async () => {
      await createExpoProject(projectDir);
      const destPath = path.join(projectDir, "package.json");
      // A fresh project that does not yet pin the SDK-coupled packages.
      await fs.writeJson(destPath, {
        dependencies: {},
        devDependencies: {},
        scripts: {},
      });

      await strategy.apply(
        expoSource,
        destPath,
        "package.json",
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      // Fresh projects get the sensible SDK 57 default.
      expect(content.dependencies.expo).toBe("~57.0.0");
      expect(content.dependencies.react).toBe("19.2.3");
      expect(content.dependencies["react-native"]).toBe("0.86.0");
      expect(content.devDependencies["jest-expo"]).toBe("~57.0.1");
    });

    it("still force-applies tooling versions even when the project pins older ones", async () => {
      await createExpoProject(projectDir);
      const destPath = path.join(projectDir, "package.json");
      // Project tries to pin an older governance-critical tooling version.
      await fs.writeJson(destPath, {
        dependencies: { zod: "^3.0.0" },
        devDependencies: { oxlint: "^1.0.0" },
        scripts: {},
      });

      await strategy.apply(
        expoSource,
        destPath,
        "package.json",
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      // Forced tooling wins over the project's pin.
      expect(content.dependencies.zod).toBe("^4.3.5");
      expect(content.devDependencies.oxlint).toBe("^1.62.0");
    });

    it("removes the inherited Vitest mutation runner from Expo projects", async () => {
      await createExpoProject(projectDir);
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        dependencies: { expo: "~56.0.0" },
        devDependencies: {
          "@stryker-mutator/vitest-runner": "^9.0.0",
        },
        scripts: {},
      });

      await strategy.apply(
        expoSource,
        destPath,
        "package.json",
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      expect(
        content.devDependencies["@stryker-mutator/vitest-runner"]
      ).toBeUndefined();
      expect(content.devDependencies["@stryker-mutator/jest-runner"]).toBe(
        "^9.0.0"
      );
    });
  });

  describe("NestJS real template: split-major pins stay in defaults", () => {
    // Regression: class-validator and the @graphql-codegen/* toolchain used
    // to sit in `force`, but the fleet is legitimately split across their
    // majors (geminisportsai/backend-v2 on codegen cli 6/typescript 4 +
    // class-validator 0.14; tunnl-backend, gunnertech/backend and
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
      "package-lisa",
      "package.lisa.json"
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

    it("keeps class-validator in defaults, not force", () => {
      const template = readNestTemplate();
      expect(template.force.dependencies["class-validator"]).toBeUndefined();
      expect(template.defaults.dependencies["class-validator"]).toBeDefined();
    });

    it("keeps @graphql-codegen/* in defaults, not force", () => {
      const template = readNestTemplate();
      for (const pkg of [
        "@graphql-codegen/cli",
        "@graphql-codegen/typescript",
        "@graphql-codegen/typescript-operations",
      ]) {
        expect(template.force.devDependencies[pkg]).toBeUndefined();
        expect(template.defaults.devDependencies[pkg]).toBeDefined();
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
    // project that had moved ahead (qualis/infrastructure on 2.259.0) got a
    // 13-minor downgrade on the next apply — which can break synth for
    // stacks using newer constructs. Projects own their aws-cdk-lib pace;
    // CVE-driven bumps go through per-repo security gates instead. The
    // paired @aws-cdk/aws-amplify-alpha must live in the same section since
    // its version tracks aws-cdk-lib. The $name overrides/resolutions
    // entries stay in force and resolve against the project's own direct
    // dep, so they remain valid with the pin in defaults.
    const repoRoot = process.cwd();
    const cdkSource = path.join(
      repoRoot,
      "cdk",
      "package-lisa",
      "package.lisa.json"
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

    it("keeps aws-cdk-lib and its alpha companion in defaults, not force", () => {
      const template = readCdkTemplate();
      for (const pkg of ["aws-cdk-lib", "@aws-cdk/aws-amplify-alpha"]) {
        expect(template.force.dependencies[pkg]).toBeUndefined();
      }
      // Exact pins (not just "is defined") so an accidental version bump in
      // the template is caught by this regression test.
      expect(template.defaults.dependencies["aws-cdk-lib"]).toBe("2.259.0");
      expect(template.defaults.dependencies["@aws-cdk/aws-amplify-alpha"]).toBe(
        "^2.259.0-alpha.0"
      );
    });

    it("keeps the aws-cdk CLI floor and $name overrides in force", () => {
      const template = readCdkTemplate();
      // A caret floor can only pull projects forward, never downgrade.
      expect(template.force.devDependencies["aws-cdk"]).toBe("^2.1127.0");
      expect(template.force.overrides["aws-cdk-lib"]).toBe("$aws-cdk-lib");
      expect(template.force.resolutions["aws-cdk-lib"]).toBe("$aws-cdk-lib");
    });
  });

  describe("empty sections", () => {
    it("handles template with empty force section", async () => {
      await createPackageLisaTemplate("all", {
        force: {},
        defaults: { engines: { node: "22.x" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, { name: "my-project" });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.name).toBe("my-project");
      expect(content.engines).toEqual({ node: "22.x" });
    });

    it("handles template with missing sections", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "jest" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, { name: "my-project" });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.scripts.test).toBe("jest");
    });
  });

  describe("nested object merging", () => {
    it("deeply merges nested objects in force section", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "jest", lint: "eslint ." },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        scripts: { build: "tsc", test: "mocha" },
      });

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts).toEqual({
        test: "jest", // Force value wins
        lint: "eslint .",
        build: "tsc", // Project value preserved
      });
    });
  });

  describe("dry-run mode", () => {
    it("respects dry-run and doesn't modify files", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "jest" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      const originalContent = { name: "original" };
      await fs.writeJson(destPath, originalContent);

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext({ dryRun: true })
      );

      expect(_result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content).toEqual(originalContent);
    });
  });

  describe("idempotency", () => {
    it("returns skipped when no changes needed", async () => {
      await createPackageLisaTemplate("all", {
        force: {
          scripts: { test: "jest" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        scripts: { test: "jest" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(_result.action).toBe("skipped");
    });
  });

  describe("error handling", () => {
    it("applies template when project package.json doesn't exist", async () => {
      await createPackageLisaTemplate("all", {
        force: { scripts: { test: "jest" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      // Don't create destPath; let strategy create it

      const context = createContext();
      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        context
      );

      expect(_result.action).toBe("copied");
      const content = await fs.readJson(destPath);
      expect(content.scripts.test).toBe("jest");
    });
  });

  describe("project type detection", () => {
    it("detects TypeScript project and applies typescript template", async () => {
      await createPackageLisaTemplate("all", {
        force: { scripts: { lint: "eslint ." } },
      });

      await createPackageLisaTemplate("typescript", {
        force: {
          devDependencies: { typescript: "^5.0.0" },
        },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.devDependencies.typescript).toBe("^5.0.0");
    });

    it("detects NestJS project and applies all necessary templates", async () => {
      await createPackageLisaTemplate("all", {
        force: { scripts: { lint: "eslint ." } },
      });

      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { typescript: "^5.0.0" } },
      });

      await createPackageLisaTemplate("nestjs", {
        force: { devDependencies: { "@nestjs/core": "^10.0.0" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "all",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createNestJSProject(projectDir);
      // Also create tsconfig.json to make it a TypeScript project
      await fs.writeJson(path.join(projectDir, "tsconfig.json"), {});

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.devDependencies.typescript).toBe("^5.0.0");
      expect(content.devDependencies["@nestjs/core"]).toBe("^10.0.0");
    });
  });
});
/* eslint-enable max-lines -- Re-enable after comprehensive test file */
/* eslint-enable sonarjs/no-duplicate-string -- Re-enable after test file */
