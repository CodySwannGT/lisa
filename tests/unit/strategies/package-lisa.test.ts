/* eslint-disable max-lines -- Test file requires extensive test cases for comprehensive coverage */
/* eslint-disable sonarjs/no-duplicate-string -- Test fixtures necessarily repeat values */
import * as fs from "fs-extra";
import * as path from "node:path";
import { satisfies, subset, validRange } from "semver";
import { PackageLisaStrategy } from "../../../src/strategies/package-lisa.js";
import type { StrategyContext } from "../../../src/strategies/strategy.interface.js";
import type { LisaConfig, ProjectType } from "../../../src/core/config.js";
import { PROJECT_TYPE_HIERARCHY } from "../../../src/core/config.js";
import {
  createTempDir,
  cleanupTempDir,
  createTypeScriptProject,
  createExpoProject,
  createNestJSProject,
  createCDKProject,
  createHarperFabricProject,
} from "../../helpers/test-utils.js";
import { commandTools } from "../../helpers/template-toolchain.js";
import { describe, expect, it } from "vitest";

/**
 * The version these cases apply AS. Stated outright rather than read from the
 * repository, so an expectation never derives itself from the code under test.
 * Since #2953 every unrestricted apply pins `@codyswann/lisa` to the version
 * doing the applying, because the templates it writes call into that package.
 */
const APPLYING_VERSION = "9.9.9";

/** The pin an unrestricted apply leaves behind. */
const LISA_PIN = { "@codyswann/lisa": APPLYING_VERSION } as const;

describe("Phaser package template controls", () => {
  const template = fs.readJsonSync(
    path.resolve("phaser/package-lisa/package.lisa.json")
  ) as { readonly force?: { readonly scripts?: Record<string, string> } };

  it("ships the exact supervised Vitest scripts on the reserved bases", () => {
    // The values are unchanged; only the keys moved. These are governed PAIRS
    // now — Lisa forces `<key>:lisa` and merely defaults `<key>` to invoke it,
    // so a host can chain onto the host-facing name without an apply erasing
    // it. Asserting the host-facing key here would re-assert the defect.
    expect(template.force?.scripts).toMatchObject({
      "test:lisa":
        "node scripts/lib/worktree-dependencies.mjs && lisa-test-run --profile phaser --adapter vitest -- vitest run",
      "test:cov:lisa":
        "node scripts/lib/worktree-dependencies.mjs && lisa-test-run --profile phaser --adapter vitest -- vitest run --coverage",
    });
  });

  it("redispatches the complete wrapped command when discovering its tool", () => {
    expect(
      commandTools(
        "lisa-test-run --profile phaser --adapter vitest -- bun run --silent vitest"
      )
    ).toEqual(["vitest"]);
  });
});

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
      expect(content).toEqual({
        scripts: { test: "jest" },
        devDependencies: LISA_PIN,
      });
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
      expect(content.devDependencies).toEqual({
        eslint: "^9.0.0",
        ...LISA_PIN,
      });
    });

    it("preserves existing package.json during postinstall-safe applies", async () => {
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
        createContext({ skipGitCheck: true, postinstall: true })
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
    it("applies force.resolutions/overrides but preserves host scripts/deps under postinstall-safe", async () => {
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
        createContext({ skipGitCheck: true, postinstall: true })
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

    it("keeps forced direct deps that back literal override normalization under postinstall-safe", async () => {
      await createPackageLisaTemplate("typescript", {
        force: {
          overrides: { prettier: "3.8.3" },
          scripts: { test: "lisa test" },
          devDependencies: { prettier: "3.8.3", oxlint: "^1.0.0" },
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
        devDependencies: { prettier: "^3.3.3", oxlint: "^0.1.0" },
      });

      const result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext({ skipGitCheck: true, postinstall: true })
      );

      expect(result.action).toBe("merged");
      const content = await fs.readJson(destPath);
      expect(content.overrides.prettier).toBe("$prettier");
      expect(content.devDependencies.prettier).toBe("3.8.3");
      expect(content.devDependencies.oxlint).toBe("^0.1.0");
      expect(content.scripts.test).toBe("host test");
    });

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
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "host-project",
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
        "package.json",
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
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "host-project",
        dependencies: { tar: ">=7.5.21", ws: "^8.0.0" },
        devDependencies: { "some-tool": ">=3.0.0" },
      });

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

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
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "host-project",
        dependencies: { tar: ">=7.5.21" },
        overrides: { tar: "$tar" },
        resolutions: { tar: "$tar" },
      });

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
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
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "host-project",
        dependencies: { tar: ">=7.5.21" },
      });

      const error = await strategy
        .apply(sourcePath, destPath, "package.json", createContext())
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
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "host-project",
        dependencies: { tar: ">=7.5.21" },
      });

      const result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      expect(result.note).toContain("dependencies.tar");
      expect(result.note).toContain(">=7.5.21");
      expect(result.note).toContain(">=7.5.19");
    });

    it("still raises a host direct dependency that sits below the template floor", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { dependencies: { tar: ">=7.5.21" } },
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
        dependencies: { tar: ">=7.5.19" },
      });

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.dependencies.tar).toBe(">=7.5.21");
    });

    // Regression: a security floor that turns out to be harmful cannot be
    // corrected by lowering it — `preserveHigherHostPins` keeps whichever side
    // is higher, so the host's copy of the bad pin wins and the fix never
    // lands. Retiring the key through `remove` is the path that reaches an
    // already-written host, which is why `brace-expansion` left the templates
    // that way rather than by being re-pinned.
    it("deletes a retired override key from a host that already carries it", async () => {
      await createPackageLisaTemplate("typescript", {
        remove: {
          resolutions: ["brace-expansion"],
          overrides: ["brace-expansion"],
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
        // What a previous `lisa apply` wrote here.
        resolutions: { "brace-expansion": ">=5.0.9", tar: ">=7.5.21" },
        overrides: { "brace-expansion": ">=5.0.9", tar: ">=7.5.21" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext({ skipGitCheck: true })
      );

      const content = await fs.readJson(destPath);
      for (const section of ["resolutions", "overrides"] as const) {
        expect(content[section]["brace-expansion"]).toBeUndefined();
        // Neighbouring pins in the same section are untouched.
        expect(content[section].tar).toBe(">=7.5.21");
      }
    });

    // An unparseable range (a git URL, an npm alias) cannot be compared, so the
    // template value stands — the guard may only ever RAISE a pin, never block a
    // force-bump it failed to reason about. Uses a package that is NOT a direct
    // dependency, so `normalizeSelfReferencingOverrides` does not rewrite the
    // result into npm's `"$name"` form and mask what is being asserted.
    it("applies the template pin when the host range is not comparable", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { overrides: { "transitive-only": ">=2.0.0" } },
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
        overrides: { "transitive-only": "github:someone/transitive-only" },
      });

      const _result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext({ skipGitCheck: true })
      );

      const content = await fs.readJson(destPath);
      expect(content.overrides["transitive-only"]).toBe(">=2.0.0");
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

  // Regression (#3068): the host-ahead branch refused a host range that IS a
  // subset of Lisa's whenever the operator spelled it as a compound range. The
  // cause is NOT that the comparison "falls through on multi-comparator ranges"
  // — `semver.subset(">=5.0.9 <6.0.0", "^5.0.1")` is itself `false`, and
  // correctly so: `^5.0.1` desugars to `>=5.0.1 <6.0.0-0`, so the hand-written
  // `<6.0.0` ceiling is strictly taller and admits `6.0.0-0`. No install can
  // ever select those points, so the two spellings admit the same real versions
  // and must reach the same verdict. Putting both ceilings into npm's sentinel
  // convention is what makes them comparable.
  describe("compound host ranges are compared as intervals", () => {
    const PKG = "@isaacs/brace-expansion";

    /**
     * Apply a template pin against a host pin and report what happened.
     * @param templateRange - The range Lisa's `force` section carries.
     * @param hostRange - The range the host package.json already carries.
     * @returns The written host range plus any refusal error.
     */
    const applyPinPair = async (
      templateRange: string,
      hostRange: string
    ): Promise<{ written: unknown; error: Error | null; note?: string }> => {
      await createPackageLisaTemplate("typescript", {
        force: { overrides: { [PKG]: templateRange } },
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
        overrides: { [PKG]: hostRange },
      });
      const outcome = await strategy
        .apply(sourcePath, destPath, "package.json", createContext())
        .then(
          result => ({ error: null, note: result.note }),
          (caught: unknown) => ({ error: caught as Error, note: undefined })
        );
      const content = await fs.readJson(destPath);
      return {
        written: content.overrides?.[PKG],
        error: outcome.error,
        note: outcome.note,
      };
    };

    // THE BITE. This is the case the ticket reproduces: an operator followed the
    // refusal's own remedy — "pick one range that satisfies both constraints" —
    // wrote the strictest such range, and was refused again.
    it("keeps a compound host range that sits strictly inside Lisa's", async () => {
      const outcome = await applyPinPair("^5.0.1", ">=5.0.9 <6.0.0");

      expect(outcome.error).toBeNull();
      expect(outcome.written).toBe(">=5.0.9 <6.0.0");
      // The floor the host had hardened to is still the floor afterwards.
      expect(satisfies("5.0.5", outcome.written as string)).toBe(false);
      expect(satisfies("5.0.9", outcome.written as string)).toBe(true);
    });

    // NEGATIVE CONTROL. Already correct before the fix — its job is to prove the
    // probe is sound, so the compound row above reads as a measurement.
    it("keeps a caret host range that sits strictly inside Lisa's", async () => {
      const outcome = await applyPinPair("^5.0.1", "^5.0.9");

      expect(outcome.error).toBeNull();
      expect(outcome.written).toBe("^5.0.9");
    });

    // NEGATIVE CONTROL. `>=5.0.9` is unbounded above and admits `6.x`, which
    // `^5.0.1` forbids. Neither contains the other, so the refusal is the whole
    // point of the guard and must survive untouched.
    it("still refuses an unbounded host range and names both sides", async () => {
      const outcome = await applyPinPair("^5.0.1", ">=5.0.9");

      expect(outcome.error).not.toBeNull();
      expect(outcome.error?.message).toContain(`overrides.${PKG}`);
      expect(outcome.error?.message).toContain(">=5.0.9");
      expect(outcome.error?.message).toContain("^5.0.1");
      // Refusing means refusing: the host manifest is left as it was.
      expect(outcome.written).toBe(">=5.0.9");
    });

    // The nearest neighbour to the fix, and the reason it is a `<` rewrite and
    // not a `<=` one. `>=5.0.9 <=6.0.0` differs from the kept case by a single
    // character and genuinely admits `6.0.0`, which `^5.0.1` forbids — a fix
    // that widened "comparable" carelessly would swallow this one too.
    it("still refuses an inclusive ceiling that admits the next major", async () => {
      const outcome = await applyPinPair("^5.0.1", ">=5.0.9 <=6.0.0");

      expect(satisfies("6.0.0", ">=5.0.9 <=6.0.0")).toBe(true);
      expect(satisfies("6.0.0", "^5.0.1")).toBe(false);
      expect(outcome.error).not.toBeNull();
      expect(outcome.error?.message).toContain("<=6.0.0");
      expect(outcome.written).toBe(">=5.0.9 <=6.0.0");
    });

    // A spec semver cannot parse at all is not a range question. It never
    // reaches the subset test, so Lisa leaves Phase 1's value standing rather
    // than refusing — unchanged by this fix, and asserted so it stays that way.
    it("leaves an unparseable host spec to Phase 1 without refusing", async () => {
      const outcome = await applyPinPair(
        "^5.0.1",
        "npm:@isaacs/brace-expansion@^5.0.9"
      );

      expect(outcome.error).toBeNull();
      expect(outcome.written).toBe("^5.0.1");
    });

    // Upstream behaviour pin. The fix compensates for a `semver` convention, so
    // it must fail loudly if that convention ever moves — in EITHER direction. A
    // workaround for behaviour that changed underneath it is a bug of its own.
    it("pins the semver ceiling convention the normalization compensates for", () => {
      // `^` desugars with the `-0` sentinel; a hand-written `<` does not.
      expect(validRange("^5.0.1")).toBe(">=5.0.1 <6.0.0-0");
      expect(validRange(">=5.0.9 <6.0.0")).toBe(">=5.0.9 <6.0.0");

      // Consequence: subset says false, and is arithmetically right to.
      expect(subset(">=5.0.9 <6.0.0", "^5.0.1")).toBe(false);
      // Same interval in caret form: true. The disagreement is the defect.
      expect(subset("^5.0.9", "^5.0.1")).toBe(true);
      // `includePrerelease` does NOT reconcile them — it widens both sides.
      expect(
        subset(">=5.0.9 <6.0.0", "^5.0.1", { includePrerelease: true })
      ).toBe(false);
      // Once the ceilings agree, so does subset. This is what the fix does.
      expect(subset(">=5.0.9 <6.0.0-0", "^5.0.1")).toBe(true);

      // And why the widening is sound: the points that separate the two
      // intervals satisfy NEITHER range, so no install can select them.
      expect(satisfies("6.0.0-alpha.1", ">=5.0.9 <6.0.0")).toBe(false);
      expect(satisfies("6.0.0-alpha.1", "^5.0.1")).toBe(false);
      expect(satisfies("6.0.0-0", ">=5.0.9 <6.0.0")).toBe(false);
    });
  });

  // Regression (CDK fleet break, 4/4 repos): a force.overrides/resolutions
  // `$name` self-reference must be accompanied by the backing direct dependency,
  // otherwise the postinstall (skip-git-check) apply writes a dangling `$esbuild`
  // that passes local checks but fails `npm ci` in CI only. See the fleet ledger:
  // acmeorgc-infra #177, gemini infra-v2 #335, cdkstarter #13.
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

  // Regression (acmeorgd frontend, fleet-wide): npm rejects a manifest with
  // EOVERRIDE when an overrides/resolutions key that is ALSO a direct dependency
  // carries a literal version instead of the "$name" self-reference. npm runs
  // that validation before anything else, so the broken manifest breaks every
  // `npx`/`npm` in the project dir — surfacing as e.g. a plugin MCP server dying
  // with "Failed to reconnect ... -32000". A security remediation that
  // force-bumped `prettier` in overrides while `prettier` stayed a direct
  // devDependency is the canonical trigger. Lisa's apply must normalize these to
  // the npm-valid "$name" form so the manifest self-heals on the next apply.
  describe("EOVERRIDE self-referencing override normalization", () => {
    it("rewrites a literal override to $name when the direct dep preserves the constraint", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { prettier: "3.8.3" } },
      });

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      // Host: prettier is a direct devDep AND has a literal override (the
      // EOVERRIDE-invalid state a security fix left behind).
      await fs.writeJson(destPath, {
        name: "ts-host",
        devDependencies: { prettier: "3.8.3", typescript: "^5.0.0" },
        overrides: { prettier: "3.8.3", axios: ">=1.15.2" },
      });

      const result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      // The colliding override is normalized to the self-reference...
      expect(content.overrides.prettier).toBe("$prettier");
      // ...the backing direct dep is preserved so the $ref resolves...
      expect(content.devDependencies.prettier).toBe("3.8.3");
      // ...and a transitive-only override (not a direct dep) is left literal.
      expect(content.overrides.axios).toBe(">=1.15.2");
      expect(result.note).toContain(
        'Normalized overrides.prettier: replaced literal "3.8.3" with "$prettier" resolving to direct dependency range "3.8.3".'
      );
    });

    it("normalizes a colliding resolutions entry as well", async () => {
      await createPackageLisaTemplate("typescript", {});

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { lodash: "4.17.21" },
        resolutions: { lodash: "4.17.21" },
      });

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.resolutions.lodash).toBe("$lodash");
    });

    it("refuses to rewrite when $name would widen an exact override", async () => {
      await createPackageLisaTemplate("typescript", {});

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { tailwindcss: "^3.4.7" },
        overrides: { tailwindcss: "3.4.19" },
      });

      await expect(
        strategy.apply(sourcePath, destPath, "package.json", createContext())
      ).rejects.toThrow(
        'overrides.tailwindcss would widen if rewritten to "$tailwindcss"'
      );
    });

    it("leaves an existing $name reference and non-direct overrides untouched", async () => {
      await createPackageLisaTemplate("typescript", {});

      const sourcePath = path.join(
        lisaDir,
        "typescript",
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        devDependencies: { vite: "^8.0.0" },
        // vite already self-references (valid); ws is transitive-only (valid).
        overrides: { vite: "$vite", ws: ">=8.21.0" },
      });

      await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
        createContext()
      );

      const content = await fs.readJson(destPath);
      expect(content.overrides.vite).toBe("$vite");
      expect(content.overrides.ws).toBe(">=8.21.0");
    });
  });

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
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { tar: "$tar" },
      });

      await expect(
        strategy.apply(sourcePath, destPath, "package.json", createContext())
      ).rejects.toThrow(/dependencies\.tar/);
    });

    it("names every dependency section that carries a $name token", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { prettier: "3.8.3" } },
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
        name: "ts-host",
        devDependencies: { vite: "$vite" },
        optionalDependencies: { fsevents: "$fsevents" },
        peerDependencies: { react: "$react" },
      });

      await expect(
        strategy.apply(sourcePath, destPath, "package.json", createContext())
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
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { tar: "$tar" },
      });

      await expect(
        strategy.apply(
          sourcePath,
          destPath,
          "package.json",
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
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
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
        strategy.apply(sourcePath, destPath, "package.json", createContext())
      ).rejects.toThrow(/dependencies\.tar/);
    });

    it("leaves a legitimate npm self-reference alone", async () => {
      await createPackageLisaTemplate("typescript", {
        force: { devDependencies: { prettier: "3.8.3" } },
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
        name: "ts-host",
        dependencies: { tar: ">=7.5.11" },
        overrides: { tar: "$tar" },
        resolutions: { tar: "$tar" },
      });

      const result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
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
        "package-lisa",
        "package.lisa.json"
      );
      const destPath = path.join(projectDir, "package.json");
      await createTypeScriptProject(projectDir);
      await fs.writeJson(destPath, {
        name: "ts-host",
        dependencies: { tar: ">=7.5.11" },
        scripts: { prepare: "$npm_execpath run build" },
      });

      const result = await strategy.apply(
        sourcePath,
        destPath,
        "package.json",
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
        devDependencies: LISA_PIN,
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
        devDependencies: LISA_PIN,
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
      expect(content.scripts.build).toBe(
        "node scripts/lib/worktree-dependencies.mjs && tsc && node dist/build/build.js"
      );
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

      expect(template.force.resolutions["vite"]).toBe("^8.3.3");
      expect(template.force.overrides["vite"]).toBe(
        rootPackageJson.devDependencies.vite
      );
    });
  });

  describe("TypeScript real template: SI9 generative-testing tooling", () => {
    // Lisa asserts a criterion (SI9) that requires property-based testing with a
    // declared inventory of invariants. A governed project cannot satisfy an
    // obligation it has no tooling for, so the tooling is forced rather than
    // offered — the same reasoning that puts the Stryker mutation runner in
    // `force` beside it. Both exist to make a test suite honest rather than to
    // add a feature, which is what makes them governance-critical.
    //
    // `fast-check` is deliberately runner-agnostic in effect: unlike
    // @stryker-mutator/vitest-runner (which Expo has to strip in `remove` because
    // it runs Jest), it works under both runners, so inheriting it into every
    // TypeScript-descendant stack is correct rather than bleed.
    const repoRoot = process.cwd();

    /**
     * Read the real shipped TypeScript template's forced devDependencies.
     * @returns The parsed force.devDependencies map.
     */
    function readTsForcedDevDeps(): Record<string, string> {
      return fs.readJsonSync(
        path.join(repoRoot, "typescript", "package-lisa", "package.lisa.json")
      ).force.devDependencies;
    }

    it("forces fast-check rather than merely offering it as a default", () => {
      const template = fs.readJsonSync(
        path.join(repoRoot, "typescript", "package-lisa", "package.lisa.json")
      );

      expect(template.force.devDependencies["fast-check"]).toBeDefined();
      // A default would let a project silently not have it, which is exactly the
      // state SI9 cannot be satisfied from.
      expect(template.defaults.devDependencies?.["fast-check"]).toBeUndefined();
    });

    it("pins fast-check to the version Lisa itself runs", () => {
      const rootPackageJson = fs.readJsonSync(
        path.join(repoRoot, "package.json")
      );

      // Lisa's own property suite is the reference implementation of SI9 here.
      // If Lisa upgrades fast-check without moving the template, governed
      // projects run generative tests against a different library than the one
      // the pattern was proven on.
      expect(readTsForcedDevDeps()["fast-check"]).toBe(
        rootPackageJson.devDependencies["fast-check"]
      );
    });

    it("is stripped by no TypeScript-descendant stack", () => {
      // Not vacuous: Expo's remove list is non-empty and does strip the Vitest
      // mutation runner, so this asserts the de-inheritance mechanism was used
      // there and deliberately not used for fast-check.
      // The set under test is DERIVED from the hierarchy rather than hardcoded, so
      // a stack added later is checked automatically the moment it declares
      // `typescript` as its parent.
      const descendants = Object.entries(PROJECT_TYPE_HIERARCHY)
        .filter(([, parent]) => parent === "typescript")
        .map(([stack]) => stack);

      // The literal list is a tripwire, not the subject: it fails loudly when the
      // hierarchy gains or loses a TypeScript child, so that arrival is a decision
      // someone makes rather than something that happens quietly. `rails` is
      // deliberately absent — it has no `typescript` parent and no npm template.
      expect(new Set(descendants)).toEqual(
        new Set([
          "expo",
          "cdk",
          "nestjs",
          "phaser",
          "npm-package",
          "harper-fabric",
        ])
      );

      const removals = descendants.map(stack => ({
        stack,
        removed: (fs.readJsonSync(
          path.join(repoRoot, stack, "package-lisa", "package.lisa.json")
        ).remove?.devDependencies ?? []) as string[],
      }));

      expect(removals.some(entry => entry.removed.length > 0)).toBe(true);
      for (const entry of removals) {
        expect(entry.removed).not.toContain("fast-check");
      }
    });
  });

  describe("Expo real template: dual SDK 54/57 support", () => {
    // Regression: the Expo package.lisa.json used to hard-pin the entire
    // SDK-coupled dependency set (expo, react, react-native, every expo-*,
    // jest-expo, the react-native-* runtime libs, @sentry/react-native, etc.)
    // in `force`. Because force REPLACES project values, updating Lisa on an
    // Expo SDK 54 app force-bundled a full SDK 54->56 + RN 0.81->0.85 major
    // upgrade (blocked acmeorga/frontend, acmeorgd/frontend, expostarter).
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
    const maestroSupervision =
      "node scripts/lib/worktree-dependencies.mjs && lisa-test-run --profile expo --adapter direct -- ";
    const expectedMaestroScripts = {
      "maestro:test": `${maestroSupervision}maestro test .maestro/flows`,
      "maestro:test:ios": `${maestroSupervision}maestro test -p ios .maestro/flows`,
      "maestro:test:android": `${maestroSupervision}maestro test -p android .maestro/flows`,
      "maestro:test:smoke": `${maestroSupervision}maestro test -p ios --include-tags=smoke .maestro/flows`,
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
        scripts: Record<string, string>;
        dependencies: Record<string, string>;
        devDependencies: Record<string, string>;
      };
    } {
      return fs.readJsonSync(expoSource);
    }

    it("defaults each platform-specific Maestro command to its intended device type", () => {
      const template = readExpoTemplate();

      expect(template.defaults.scripts).toMatchObject(expectedMaestroScripts);
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

    it("preserves host-customized Maestro commands when applying the Expo template", async () => {
      await createExpoProject(projectDir);
      const destPath = path.join(projectDir, "package.json");
      const hostMaestroScripts = {
        "maestro:test": "maestro test custom-flows",
        "maestro:test:ios": "maestro test .maestro/flows",
        "maestro:test:android": "maestro test .maestro/flows",
        "maestro:test:smoke":
          "maestro test --include-tags=smoke .maestro/flows",
      };
      await fs.writeJson(destPath, {
        dependencies: {},
        devDependencies: {},
        scripts: hostMaestroScripts,
      });

      await strategy.apply(
        expoSource,
        destPath,
        "package.json",
        createContext({ lisaDir: repoRoot })
      );

      const content = await fs.readJson(destPath);
      expect(content.scripts).toMatchObject(hostMaestroScripts);
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
      //     request at runtime (broke acmeorgb/frontend-v2 in dev and the
      //     prod path of expostarter/acmeorgd where the Sentry DSN is set).
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
      // project (AcmeOrgD/frontend) on every apply and broke its frozen
      // lockfile in CI.
      expect(template.force.dependencies["tailwindcss"]).toBeUndefined();
      expect(template.defaults.dependencies["tailwindcss"]).toBeDefined();
      // @graphql-codegen/* must stay in defaults, NEVER force: the fleet is
      // split across codegen generations (backend-v2 on cli 6/typescript 4,
      // acmeorgd/acmeorgc/nestjsstarter on cli 7/typescript 6), and a forced
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
      expect(content.dependencies.zod).toBe("^4.6.6");
      expect(content.devDependencies.oxlint).toBe(">=1.62.0 <1.86.0");
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
      // jest-runner 9.x peers core 9.x exactly; the TypeScript parent forces
      // core ^10.1.1 for Vitest 5, so Expo's override must keep the pair matched.
      expect(content.devDependencies["@stryker-mutator/core"]).toBe("^9.0.0");
    });
  });

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
      const destPath = path.join(projectDir, "package.json");
      await fs.writeJson(destPath, {
        name: "host-project",
        devDependencies: Object.fromEntries(
          OXLINT_PACKAGES.map(pkg => [pkg, hostRange])
        ),
        scripts: {},
      });
      const error = await strategy
        .apply(
          path.join(repoRoot, stack, "package-lisa", "package.lisa.json"),
          destPath,
          "package.json",
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
      "package.lisa.json",
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
        devDependencies: LISA_PIN,
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

/**
 * `test:integration` must not force a directory that only some
 * repositories have.
 *
 * The defect (#3070): `cdk/package-lisa/package.lisa.json` carried
 * `test:integration` in `force` — where Lisa's value completely replaces the
 * host's — pinned to the literal path `vitest run tests/integration`. A
 * consumer that keeps integration tests beside their subjects
 * (`src/orders/orders.integration.test.ts`) has no such directory, so the
 * forced value did not narrow the run, it eliminated it: `No test files found,
 * exiting with code 1`, which failed the push gate. The same key was `defaults`
 * one template up in `typescript`, so the correct governance level appeared to
 * depend on which stack template you read.
 *
 * Neither half is enforceable by a spelling. What is governance-critical is
 * that integration tests RUN, not that they live in `tests/integration`, so the
 * fix follows the reserved-base pattern #2952 established for this exact class
 * of gate script: Lisa forces `test:integration:lisa` with a layout-agnostic
 * value, and merely DEFAULTS `test:integration` to invoke it. `adopt` reclaims
 * the values Lisa itself wrote, so a consumer already clobbered by the force
 * recovers on its next apply instead of needing a migration.
 *
 * These cases drive the templates this repository SHIPS, not a synthetic one —
 * a governance-classification defect lives in the shipped file, and a spec that
 * states its own template cannot see it.
 *
 * A later attempt made an empty suite green with `--passWithNoTests`. That lets
 * a generated command prove a required integration gate after collecting zero
 * tests — the exact vacuous-green contract Lisa's registry rejects. Projects
 * with no integration suite declare the gate off/optional; the required
 * generated command itself must remain non-vacuous.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");
const MANIFEST_PROFILES = {
  "package.json": "lisa",
  "typescript/package-lisa/package.lisa.json": "typescript",
  "npm-package/package-lisa/package.lisa.json": "npm-package",
  "nestjs/package-lisa/package.lisa.json": "nestjs",
  "cdk/package-lisa/package.lisa.json": "cdk",
  "harper-fabric/package-lisa/package.lisa.json": "harper-fabric",
  "phaser/package-lisa/package.lisa.json": "phaser",
  "expo/package-lisa/package.lisa.json": "expo",
} as const satisfies Readonly<Record<string, string>>;
const MANIFESTS = Object.keys(
  MANIFEST_PROFILES
) as readonly (keyof typeof MANIFEST_PROFILES)[];
const STACKS = Object.values(MANIFEST_PROFILES).filter(
  profile => profile !== "lisa"
) as readonly ProjectType[];

/** Both manifest script surfaces, with the root surface winning collisions. */
interface ManifestScripts {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly force?: { readonly scripts?: Readonly<Record<string, string>> };
}

/**
 * Compose both governed script maps without letting either hide the other.
 * @param parsed - Parsed manifest
 * @returns Governed scripts, with root scripts overriding force collisions
 */
const scriptsFrom = (
  parsed: ManifestScripts
): Readonly<Record<string, string>> => ({
  ...parsed.force?.scripts,
  ...parsed.scripts,
});

/**
 * Read one shipped manifest's governed scripts.
 * @param file - Repository-relative manifest path
 * @returns Merged governed scripts
 */
const scriptsIn = (file: string): Readonly<Record<string, string>> =>
  scriptsFrom(fs.readJsonSync(path.join(REPO_ROOT, file)) as ManifestScripts);

/**
 * Whether one managed script invokes a supervised test surface.
 * @param key - Script key
 * @returns Whether the route is managed
 */
const isManagedTestScript = (key: string): boolean =>
  /^(?:test(?::|$)|playwright:test(?::|$)|maestro:test(?::|$)|check:shell-guard-refusals$)/u.test(
    key
  );

/**
 * Expand package aliases while refusing cycles and multiple launchers.
 * @param scripts - Complete script map
 * @param key - Script key to resolve
 * @param active - Active alias chain
 * @returns Terminal command
 */
function terminalCommand(
  scripts: Readonly<Record<string, string>>,
  key: string,
  active: ReadonlySet<string> = new Set()
): string {
  if (active.has(key)) throw new Error(`Package script alias cycle at ${key}`);
  const command = scripts[key];
  if (command === undefined)
    throw new Error(`Missing package script alias ${key}`);
  const aliases = [
    ...command.matchAll(/\$npm_execpath run ([a-z0-9:-]+)(?: -- ([^;&]+))?/gu),
  ];
  if (aliases.length === 0) return command;
  if (aliases.length > 1)
    throw new Error(`Package script ${key} invokes more than one child alias`);
  const alias = aliases[0];
  const childKey = alias?.[1];
  if (alias === undefined || childKey === undefined) return command;
  const child = terminalCommand(scripts, childKey, new Set([...active, key]));
  const extra = alias[2]?.trim();
  const suffix = extra === undefined ? "" : ` ${extra}`;
  return command.replace(alias[0], `${child}${suffix}`);
}

/**
 * Resolve one stack exactly through package-lisa inheritance.
 * @param stack - Project stack
 * @returns Effective scripts
 */
async function resolvedScripts(
  stack: ProjectType
): Promise<Readonly<Record<string, string>>> {
  const planned = await new PackageLisaStrategy().planPackageJson(
    { name: "route-probe", version: "0.0.0" },
    [stack],
    REPO_ROOT
  );
  return (planned.scripts ?? {}) as Readonly<Record<string, string>>;
}

/**
 * Return a diagnostic unless one terminal route has one exact wrapper.
 * @param stack - Expected route profile
 * @param key - Script key
 * @param command - Terminal command
 * @returns Violation diagnostic, when any
 */
function routeFailure(
  stack: string,
  key: string,
  command: string
): string | undefined {
  const matches = command.match(/\blisa-test-run(?:\.js)?\b/gu) ?? [];
  const adapter = /\bvitest\b/u.test(command) ? "vitest" : "direct";
  const exact = new RegExp(
    `\\blisa-test-run(?:\\.js)? --profile ${stack} --adapter ${adapter} --\\s`,
    "u"
  );
  return matches.length === 1 && exact.test(command)
    ? undefined
    : `${stack}:${key}=${command}`;
}

/** The host-facing script name, which belongs to the host. */
const INTEGRATION = "test:integration";

/** The reserved base Lisa forces, which a host cannot delete or weaken. */
const INTEGRATION_LISA = "test:integration:lisa";

/** Every shipped template that governs the integration suite. */
const TEMPLATES = ["typescript", "cdk", "nestjs", "expo"] as const;

/** The templates whose stack runs the suite under vitest. */
const VITEST_TEMPLATES = ["typescript", "cdk", "nestjs"] as const;

/**
 * Real test-file paths from the three layouts consumers actually use.
 * @remarks
 * Vitest treats a bare positional argument as a substring filter over the test
 * file path — measured on vitest 4.1.9, the version these templates force:
 * `tests/integration` matched 1 of these 3 files, `.integration.` matched 1,
 * and the pair `.integration. integration/` matched all 3 while still leaving
 * `src/integration-helpers/helper.test.ts` out.
 */
const INTEGRATION_TEST_PATHS = [
  "src/orders/orders.integration.test.ts",
  "tests/integration/db.test.ts",
  "test/integration/api.test.ts",
] as const;

/** A unit test whose directory merely contains the word, which must not match. */
const NON_INTEGRATION_TEST_PATH = "src/integration-helpers/helper.test.ts";

/**
 * Read a shipped template off disk.
 * @param typeName - Stack template directory name
 * @returns The parsed template
 */
async function shippedTemplate(
  typeName: string
): Promise<Record<string, { scripts?: Record<string, string> }>> {
  return (await fs.readJson(
    path.join(process.cwd(), typeName, "package-lisa", "package.lisa.json")
  )) as Record<string, { scripts?: Record<string, string> }>;
}

/**
 * Name the template sections that carry a given script key.
 * @param template - A parsed `package.lisa.json`
 * @param scriptName - The script key to locate
 * @returns Section names, in a stable order
 */
function sectionsCarrying(
  template: Record<string, { scripts?: Record<string, string> }>,
  scriptName: string
): readonly string[] {
  return ["force", "defaults", "merge"].filter(
    section => template[section]?.scripts?.[scriptName] !== undefined
  );
}

/**
 * The positional filters a template's reserved base passes to vitest.
 * @remarks
 * Everything after `vitest run` that is not an option, with the surrounding
 * shell quotes removed. A missing base throws rather than yielding an empty
 * list: an empty list satisfies every assertion below, so a template that had
 * dropped the gate entirely would read as one that passes it.
 * @param typeName - Stack template directory name
 * @returns The filters, in command order
 * @throws {Error} When the template ships no reserved base
 */
async function forcedFilters(typeName: string): Promise<readonly string[]> {
  const template = await shippedTemplate(typeName);
  const command = template.force?.scripts?.[INTEGRATION_LISA];
  const words = command?.split(" ") ?? [];
  const vitest = words.findIndex(
    (word, index) => word === "vitest" && words[index + 1] === "run"
  );
  if (
    typeof command !== "string" ||
    vitest < 0 ||
    words[vitest + 1] !== "run"
  ) {
    throw new Error(
      `${typeName} ships no forced ${INTEGRATION_LISA}; got ${String(command)}`
    );
  }
  return words
    .slice(vitest + 2)
    .filter(token => !token.startsWith("-"))
    .map(token => token.replace(/^'|'$/gu, ""));
}

describe("managed package test supervision wiring", () => {
  it("merges force and root scripts, with root scripts winning collisions", () => {
    expect(
      scriptsFrom({
        force: {
          scripts: {
            "test:force-only": "bare-force-vitest",
            "test:collision": "force-command",
          },
        },
        scripts: {
          "test:root-only": "bare-root-vitest",
          "test:collision": "root-command",
        },
      })
    ).toEqual({
      "test:force-only": "bare-force-vitest",
      "test:root-only": "bare-root-vitest",
      "test:collision": "root-command",
    });
  });

  it.each(MANIFESTS)("routes every raw managed test command in %s", file => {
    const scripts = scriptsIn(file);
    const bypasses = Object.entries(scripts)
      .filter(([key]) => isManagedTestScript(key))
      .map(([key]) => [key, terminalCommand(scripts, key)] as const)
      .filter(
        ([key, command]) =>
          routeFailure(MANIFEST_PROFILES[file], key, command) !== undefined
      );

    expect(bypasses).toEqual([]);
  });

  it.each(STACKS)(
    "resolves every %s route to exactly one honest supervised command",
    async stack => {
      const scripts = await resolvedScripts(stack);
      const failures = Object.entries(scripts)
        .filter(([key]) => isManagedTestScript(key))
        .map(([key]) => [key, terminalCommand(scripts, key)] as const)
        .map(([key, command]) => routeFailure(stack, key, command))
        .filter((failure): failure is string => failure !== undefined);

      expect(failures).toEqual([]);
    }
  );
});

describe("test:integration governance and layout (#3070)", () => {
  const NORMALIZED_ROUTE_PROFILE = "--profile <route>";

  describe("every template classifies the key the same way", () => {
    it.each(TEMPLATES)(
      "%s: hands the host-facing name back as a default and forces only the reserved base",
      async typeName => {
        const template = await shippedTemplate(typeName);

        expect(sectionsCarrying(template, INTEGRATION)).toEqual(["defaults"]);
        expect(sectionsCarrying(template, INTEGRATION_LISA)).toEqual(["force"]);
      }
    );

    it("keeps the typescript and cdk templates in agreement, which is where the split was found", async () => {
      const [typescript, cdk] = await Promise.all(
        ["typescript", "cdk"].map(shippedTemplate)
      );

      expect(sectionsCarrying(cdk, INTEGRATION)).toEqual(
        sectionsCarrying(typescript, INTEGRATION)
      );
      expect(
        cdk.force?.scripts?.[INTEGRATION_LISA]?.replace(
          /--profile\s+\S+/u,
          NORMALIZED_ROUTE_PROFILE
        )
      ).toBe(
        typescript.force?.scripts?.[INTEGRATION_LISA]?.replace(
          /--profile\s+\S+/u,
          NORMALIZED_ROUTE_PROFILE
        )
      );
    });

    it("gives every vitest stack the same base value, so the copies cannot drift apart", async () => {
      const templates = await Promise.all(
        VITEST_TEMPLATES.map(shippedTemplate)
      );
      const values = templates.map(template =>
        template.force?.scripts?.[INTEGRATION_LISA]?.replace(
          /--profile\s+\S+/u,
          NORMALIZED_ROUTE_PROFILE
        )
      );

      // Truthiness first: three `undefined`s are also a set of size one, and
      // would report agreement from templates that ship no gate at all.
      expect(values.every(value => typeof value === "string")).toBe(true);
      expect(new Set(values).size).toBe(1);
    });

    it.each(VITEST_TEMPLATES)(
      "%s: cannot prove the required gate after collecting zero tests",
      async typeName => {
        const template = await shippedTemplate(typeName);
        const command = template.force?.scripts?.[INTEGRATION_LISA];

        expect(command).not.toContain("--passWithNoTests");
      }
    );

    it.each(VITEST_TEMPLATES)(
      "%s: adopts the old supervised empty-suite spelling without redelivering it",
      async typeName => {
        const template = (await fs.readJson(
          path.join(
            process.cwd(),
            typeName,
            "package-lisa",
            "package.lisa.json"
          )
        )) as {
          force?: { scripts?: Record<string, string> };
          adopt?: { scripts?: Record<string, readonly string[]> };
        };
        const forced = template.force?.scripts?.[INTEGRATION_LISA] ?? "";
        const adopted = template.adopt?.scripts?.[INTEGRATION] ?? [];

        const preflight = "node scripts/lib/worktree-dependencies.mjs && ";
        expect(forced.startsWith(preflight)).toBe(true);
        expect(forced.slice(preflight.length)).toMatch(
          new RegExp(
            `^lisa-test-run --profile ${typeName} --adapter vitest -- vitest run`,
            "u"
          )
        );
        expect(forced).not.toContain("--passWithNoTests");
        const historical = forced.slice(preflight.length);
        expect(adopted).toContain(`${historical} --passWithNoTests`);
        const profileLegacy = historical.replace(" --adapter vitest", "");
        const unprofiledLegacy = profileLegacy?.replace(
          `--profile ${typeName} `,
          ""
        );
        expect(adopted).toContain(profileLegacy);
        expect(adopted).toContain(`${profileLegacy} --passWithNoTests`);
        expect(adopted).toContain(unprofiledLegacy);
        expect(adopted).toContain(`${unprofiledLegacy} --passWithNoTests`);
      }
    );
  });

  describe("the forced value finds integration tests wherever a repository keeps them", () => {
    it.each(VITEST_TEMPLATES)(
      "%s: matches beside-subject, tests/integration and test/integration layouts alike",
      async typeName => {
        const filters = await forcedFilters(typeName);

        for (const testPath of INTEGRATION_TEST_PATHS) {
          expect(
            filters.some(filter => testPath.includes(filter)),
            `${typeName} must run ${testPath}`
          ).toBe(true);
        }
      }
    );

    it.each(VITEST_TEMPLATES)(
      "%s: still leaves a unit test out of the integration lane",
      async typeName => {
        const filters = await forcedFilters(typeName);

        expect(filters.length).toBeGreaterThan(0);
        expect(
          filters.some(filter => NON_INTEGRATION_TEST_PATH.includes(filter))
        ).toBe(false);
      }
    );
  });
});
/* eslint-enable max-lines -- Re-enable after comprehensive test file */
/* eslint-enable sonarjs/no-duplicate-string -- Re-enable after test file */
