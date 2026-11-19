/**
 * Lisa integration tests: TypeScript apply, Lisa self-apply, and postinstall-safe apply.
 * Sibling of lisa.test.ts, which owns the learnings-ledger apply cases.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import type { LisaConfig } from "../../src/core/config.js";
import { Lisa } from "../../src/core/lisa.js";
import { LISA_INVOCATION } from "../../src/migrations/ensure-lisa-postinstall.js";
import {
  cleanupTempDir,
  createMockLisaDir,
  createTempDir,
  createTypeScriptProject,
} from "../helpers/test-utils.js";
import {
  buildConfig,
  COPY_OVERWRITE,
  createDeps,
  ESLINT_IGNORE_CONFIG,
  GITHUB_ACTIONS_MD,
  GITIGNORE,
  KNIP_JSON,
  LEGACY_WORKFLOW,
  LINT_STAGED_JSON,
  LISA_MANIFEST,
  PACKAGE_JSON,
  PACKAGE_LISA_DIR,
  SAFETY_NET_JSON,
  TEST_TXT,
  TSC_BUILD_SCRIPT,
  TSCONFIG_BASE,
  TSCONFIG_JSON,
} from "./lisa-fixtures.js";

// Marketplace installation is outside this suite's file-generation assertions.
// Never install into the operator's real agents while generating test projects.
vi.mock("../../src/agy/plugin-installer.js", () => ({
  installAgyPlugin: vi.fn().mockResolvedValue({
    attempted: false,
    installed: false,
  }),
}));
vi.mock("../../src/copilot/plugin-installer.js", () => ({
  installCopilotPlugin: vi.fn().mockResolvedValue({
    attempted: false,
    installed: false,
  }),
}));

describe("Lisa Integration Tests", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    // Full fleet apply also reconciles user-scoped Antigravity MCP settings.
    // Keep that real filesystem behavior inside this fixture's owned tree.
    const home = path.join(tempDir, "home");
    await fs.ensureDir(home);
    vi.stubEnv("HOME", home);
    vi.stubEnv("USERPROFILE", home);
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await createMockLisaDir(lisaDir);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await cleanupTempDir(tempDir);
  });

  /**
   * Create a Lisa instance with optional config overrides
   * @param overrides - Configuration overrides
   * @returns Lisa instance ready for apply/validate
   */
  function createLisa(overrides: Partial<LisaConfig> = {}): Lisa {
    const config = buildConfig(lisaDir, destDir, overrides);
    return new Lisa(config, createDeps(config));
  }

  describe("apply", () => {
    it("applies configurations to TypeScript project", async () => {
      await createTypeScriptProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("typescript");

      // Check that files were copied
      expect(await fs.pathExists(path.join(destDir, TEST_TXT))).toBe(true);
      expect(await fs.pathExists(path.join(destDir, TSCONFIG_BASE))).toBe(true);
    });

    // Regression (#1659): a self-apply against the Lisa source repo must skip
    // template application and deletions.json processing (which would delete
    // repo-internal files) while STILL applying package.lisa.json dependency
    // governance to Lisa's own package.json.
    it("self-apply (Lisa source repo): skips templates/deletions, keeps dependency governance", async () => {
      await createTypeScriptProject(destDir);
      // Mark the destination AS the Lisa source repo and give it hand-authored
      // scripts the template must not clobber.
      await fs.writeJson(path.join(destDir, PACKAGE_JSON), {
        name: "@codyswann/lisa",
        dependencies: { typescript: "^5.0.0" },
        scripts: { build: TSC_BUILD_SCRIPT },
        resolutions: { ws: "^8.0.0" },
      });
      // A package.lisa.json forcing a security pin (must apply) plus a script
      // (must NOT overwrite Lisa's own).
      await fs.ensureDir(path.join(lisaDir, "typescript", PACKAGE_LISA_DIR));
      await fs.writeJson(
        path.join(lisaDir, "typescript", PACKAGE_LISA_DIR, "package.lisa.json"),
        {
          force: {
            resolutions: { ws: ">=8.21.0" },
            scripts: { build: "template build" },
          },
        }
      );
      // Files a template application / deletions run would touch.
      await fs.writeFile(path.join(destDir, LISA_MANIFEST), "legacy\n");
      await fs.writeFile(path.join(destDir, LEGACY_WORKFLOW), "legacy\n");

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      // Template application skipped: template-shipped files are NOT created.
      expect(await fs.pathExists(path.join(destDir, TEST_TXT))).toBe(false);
      expect(await fs.pathExists(path.join(destDir, TSCONFIG_BASE))).toBe(
        false
      );
      // Deletions skipped: repo-internal files survive.
      expect(await fs.pathExists(path.join(destDir, LISA_MANIFEST))).toBe(true);
      expect(await fs.pathExists(path.join(destDir, LEGACY_WORKFLOW))).toBe(
        true
      );
      // Dependency governance still applied; Lisa's own scripts preserved.
      const pkg = await fs.readJson(path.join(destDir, PACKAGE_JSON));
      expect(pkg.resolutions.ws).toBe(">=8.21.0");
      expect(pkg.scripts.build).toBe(TSC_BUILD_SCRIPT);
    });

    it.each([false, true])(
      "preserves host-owned config during postinstall-safe apply (git waiver=%s)",
      async skipGitCheck => {
        await createTypeScriptProject(destDir);
        // The duplicated form is the pre-#2467 spelling that still sits in
        // installed projects; apply must collapse it to the current invocation,
        // which surfaces failures instead of discarding them.
        const swallowingPostinstall =
          '[ -n "$CI" ] || LISA_BOOTSTRAP=1 node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true';
        const guardedPostinstall = LISA_INVOCATION;
        const duplicatedPostinstall = `[ -n "$CI" ] || LISA_BOOTSTRAP=1 ${swallowingPostinstall}`;
        const hostPackageJson = {
          name: "host-project",
          dependencies: { typescript: "^5.0.0" },
          scripts: { postinstall: duplicatedPostinstall, test: "host test" },
          devDependencies: { oxlint: "^0.1.0" },
        };
        const expectedPackageJson = {
          ...hostPackageJson,
          scripts: {
            ...hostPackageJson.scripts,
            postinstall: guardedPostinstall,
          },
        };
        const hostKnip = { ignoreDependencies: ["shell-quote"] };
        const hostLintStaged = { "*.ts": "host-lint" };
        const hostSafetyNet = { rules: [] };
        const hostGitignore = "node_modules/\n.env.local\n";
        const hostEslintIgnore = { ignores: ["dist/**", "host-owned/**"] };
        const hostTsconfig = {
          compilerOptions: { strict: true },
          include: ["src/**/*.ts", "host/**/*.ts"],
        };
        const hostGithubActions = "# Host GitHub Actions guidance\n";

        await fs.writeJson(path.join(destDir, PACKAGE_JSON), hostPackageJson);
        await fs.writeJson(path.join(destDir, KNIP_JSON), hostKnip);
        await fs.writeJson(
          path.join(destDir, LINT_STAGED_JSON),
          hostLintStaged
        );
        await fs.writeJson(path.join(destDir, SAFETY_NET_JSON), hostSafetyNet);
        await fs.writeFile(path.join(destDir, GITIGNORE), hostGitignore);
        await fs.writeJson(
          path.join(destDir, ESLINT_IGNORE_CONFIG),
          hostEslintIgnore
        );
        await fs.writeJson(path.join(destDir, TSCONFIG_JSON), hostTsconfig);
        await fs.outputFile(
          path.join(destDir, GITHUB_ACTIONS_MD),
          hostGithubActions
        );

        const tsCopyOverwrite = path.join(
          lisaDir,
          "typescript",
          COPY_OVERWRITE
        );
        await fs.writeJson(path.join(tsCopyOverwrite, KNIP_JSON), {
          ignoreDependencies: ["from-lisa"],
        });
        await fs.writeJson(path.join(tsCopyOverwrite, LINT_STAGED_JSON), {
          "*.ts": "lisa-lint",
        });
        await fs.writeJson(path.join(tsCopyOverwrite, SAFETY_NET_JSON), {
          rules: [{ match: "no-verify" }],
        });
        await fs.writeFile(path.join(tsCopyOverwrite, GITIGNORE), "dist/\n");
        await fs.writeJson(path.join(tsCopyOverwrite, ESLINT_IGNORE_CONFIG), {
          ignores: ["lisa-template/**"],
        });
        await fs.writeJson(path.join(tsCopyOverwrite, TSCONFIG_JSON), {
          extends: "./tsconfig.base.json",
        });
        await fs.outputFile(
          path.join(tsCopyOverwrite, GITHUB_ACTIONS_MD),
          "# Lisa GitHub Actions guidance\n"
        );
        const packageLisaDir = path.join(lisaDir, "typescript", "package-lisa");
        await fs.ensureDir(packageLisaDir);
        await fs.writeJson(path.join(packageLisaDir, "package.lisa.json"), {
          force: {
            scripts: { test: "vitest run" },
            devDependencies: { oxlint: "^1.0.0" },
          },
        });

        const result = await createLisa({
          skipGitCheck,
          postinstall: true,
        }).apply();

        expect(result.success).toBe(true);
        expect(await fs.readJson(path.join(destDir, PACKAGE_JSON))).toEqual(
          expectedPackageJson
        );
        expect(await fs.readJson(path.join(destDir, KNIP_JSON))).toEqual(
          hostKnip
        );
        expect(await fs.readJson(path.join(destDir, LINT_STAGED_JSON))).toEqual(
          hostLintStaged
        );
        expect(await fs.readJson(path.join(destDir, SAFETY_NET_JSON))).toEqual(
          hostSafetyNet
        );
        expect(await fs.readFile(path.join(destDir, GITIGNORE), "utf8")).toBe(
          hostGitignore
        );
        expect(
          await fs.readJson(path.join(destDir, ESLINT_IGNORE_CONFIG))
        ).toEqual(hostEslintIgnore);
        expect(await fs.readJson(path.join(destDir, TSCONFIG_JSON))).toEqual(
          hostTsconfig
        );
        expect(
          await fs.readFile(path.join(destDir, GITHUB_ACTIONS_MD), "utf8")
        ).toBe(hostGithubActions);
      }
    );
  });
});
