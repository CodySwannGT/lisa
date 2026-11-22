/**
 * Lisa integration tests: child-stack overrides of parent templates and the all/ fallback.
 * Sibling of lisa.test.ts, which owns the learnings-ledger apply cases.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import type { LisaConfig } from "../../src/core/config.js";
import { Lisa } from "../../src/core/lisa.js";
import {
  cleanupTempDir,
  createCDKProject,
  createExpoProject,
  createHarperFabricProject,
  createMockLisaDir,
  createTempDir,
  createTypeScriptProject,
} from "../helpers/test-utils.js";
import { ioLatencyBudgetMs } from "../helpers/io-latency-budget.js";
import {
  buildConfig,
  COPY_OVERWRITE,
  CREATE_ONLY,
  createDeps,
  HARPER_FABRIC_TYPE,
  PACKAGE_JSON,
  SETTINGS_JSON,
  TEST_TXT,
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
    it.each([
      { project: "fresh", existing: undefined },
      {
        project: "customized",
        existing: `${JSON.stringify({
          compilerOptions: { strict: true },
          include: ["src/**/*.ts"],
          exclude: ["dist", "project-tests"],
          files: [],
        })}\n`,
      },
    ])(
      "keeps the intended Expo local TypeScript config on a $project apply",
      async ({ existing }) => {
        const localName = "tsconfig.local.json";
        const projectLocal = path.join(destDir, localName);
        const template = await fs.readFile(
          path.resolve(
            import.meta.dirname,
            "../../expo/create-only",
            localName
          ),
          "utf8"
        );
        const applyTemplate = path.join(
          lisaDir,
          "expo",
          CREATE_ONLY,
          localName
        );
        await createExpoProject(destDir);
        await fs.outputFile(applyTemplate, template);
        if (existing !== undefined) await fs.writeFile(projectLocal, existing);

        const result = await createLisa().apply();

        expect(result.success).toBe(true);
        expect(await fs.readFile(projectLocal, "utf8")).toBe(
          existing ?? template
        );
      }
    );

    it("child stack create-only overrides parent stack create-only for the same path", async () => {
      // Regression for the CDK ci.yml clobber bug:
      // typescript/create-only/.github/workflows/ci.yml ships a bun-mode CI
      // workflow. cdk/create-only/.github/workflows/ci.yml ships an npm-mode
      // CI workflow with CDK-specific determine_environment / cdk-checks
      // jobs. Without the create-only ownership gate, typescript runs first
      // and the CreateOnlyStrategy silently no-ops cdk's version because the
      // destination already exists, leaving CDK projects with the wrong
      // (bun-mode) workflow — which fails immediately in CI because CDK
      // projects pin bun to "please-use-npm" and only ship a
      // package-lock.json.
      const CI_YML = ".github/workflows/ci.yml";
      const TS_CI = "package_manager: 'bun'\n# typescript/create-only\n";
      const CDK_CI =
        "package_manager: 'npm'\n# cdk/create-only — determine_environment\n";

      await createCDKProject(destDir);

      const tsCreateOnly = path.join(
        lisaDir,
        "typescript",
        CREATE_ONLY,
        ".github",
        "workflows"
      );
      await fs.ensureDir(tsCreateOnly);
      await fs.writeFile(path.join(tsCreateOnly, "ci.yml"), TS_CI);

      const cdkCreateOnly = path.join(
        lisaDir,
        "cdk",
        CREATE_ONLY,
        ".github",
        "workflows"
      );
      await fs.ensureDir(cdkCreateOnly);
      await fs.writeFile(path.join(cdkCreateOnly, "ci.yml"), CDK_CI);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      const finalCi = await fs.readFile(path.join(destDir, CI_YML), "utf-8");
      // The CDK version (npm + determine_environment) must win, not the
      // typescript bun version. This is the load-bearing assertion — if it
      // flips, CI breaks for every CDK project on the next Lisa update.
      expect(finalCi).toBe(CDK_CI);
      expect(finalCi).not.toBe(TS_CI);
    });

    it("child stack create-only suppresses parent copy-overwrite for the same path", async () => {
      const TS_CONFIG = `${JSON.stringify({
        extends: [
          "@codyswann/lisa/tsconfig/typescript",
          "./tsconfig.local.json",
        ],
      })}\n`;
      const EXPO_CONFIG = `${JSON.stringify({
        extends: ["@codyswann/lisa/tsconfig/expo", "./tsconfig.local.json"],
        compilerOptions: { jsx: "react-jsx" },
      })}\n`;

      await createExpoProject(destDir);

      const tsCopyOverwrite = path.join(lisaDir, "typescript", COPY_OVERWRITE);
      await fs.ensureDir(tsCopyOverwrite);
      await fs.writeFile(path.join(tsCopyOverwrite, TSCONFIG_JSON), TS_CONFIG);

      const expoCreateOnly = path.join(lisaDir, "expo", CREATE_ONLY);
      await fs.ensureDir(expoCreateOnly);
      await fs.writeFile(path.join(expoCreateOnly, TSCONFIG_JSON), EXPO_CONFIG);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      const finalConfig = await fs.readFile(
        path.join(destDir, TSCONFIG_JSON),
        "utf-8"
      );
      expect(finalConfig).toBe(EXPO_CONFIG);
      expect(finalConfig).not.toBe(TS_CONFIG);
      expect(result.counters.overwritten).toBe(0);
    });

    it("Harper/Fabric child stack overrides TypeScript parent templates", async () => {
      const SHARED_CONFIG = "shared-stack-config.txt";
      const TS_CONFIG = "typescript parent\n";
      const HARPER_CONFIG = "harper child\n";

      await createHarperFabricProject(destDir);

      const tsCopyOverwrite = path.join(lisaDir, "typescript", COPY_OVERWRITE);
      await fs.ensureDir(tsCopyOverwrite);
      await fs.writeFile(path.join(tsCopyOverwrite, SHARED_CONFIG), TS_CONFIG);

      const harperCopyOverwrite = path.join(
        lisaDir,
        HARPER_FABRIC_TYPE,
        COPY_OVERWRITE
      );
      await fs.ensureDir(harperCopyOverwrite);
      await fs.writeFile(
        path.join(harperCopyOverwrite, SHARED_CONFIG),
        HARPER_CONFIG
      );

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      const finalConfig = await fs.readFile(
        path.join(destDir, SHARED_CONFIG),
        "utf-8"
      );
      expect(finalConfig).toBe(HARPER_CONFIG);
    });

    it("writes an overlapping copy-overwrite path exactly once (no parent-then-child clobber window)", async () => {
      // Crash-safety regression for the postinstall half-apply bug (#318):
      // when a parent (typescript) and child (harper-fabric) stack both ship
      // the same copy-overwrite path, the apply must NOT write the parent
      // version and then overwrite it with the child's — that intermediate
      // write is the window in which a killed lifecycle process left projects
      // with TypeScript configs clobbering the child stack's. The
      // copyOverwriteOwnership map makes the most-specific stack the sole
      // writer, so on a fresh destination the path is "copied" once and never
      // "overwritten". If ownership regresses, the parent writes first and the
      // child's write becomes an overwrite — exactly what this asserts against.
      const SHARED_CONFIG = "shared-stack-config.txt";
      const TS_CONFIG = "typescript parent\n";
      const HARPER_CONFIG = "harper child\n";

      await createHarperFabricProject(destDir);

      const tsCopyOverwrite = path.join(lisaDir, "typescript", COPY_OVERWRITE);
      await fs.ensureDir(tsCopyOverwrite);
      await fs.writeFile(path.join(tsCopyOverwrite, SHARED_CONFIG), TS_CONFIG);

      const harperCopyOverwrite = path.join(
        lisaDir,
        HARPER_FABRIC_TYPE,
        COPY_OVERWRITE
      );
      await fs.ensureDir(harperCopyOverwrite);
      await fs.writeFile(
        path.join(harperCopyOverwrite, SHARED_CONFIG),
        HARPER_CONFIG
      );

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      // The child version still wins (final-state correctness).
      const finalConfig = await fs.readFile(
        path.join(destDir, SHARED_CONFIG),
        "utf-8"
      );
      expect(finalConfig).toBe(HARPER_CONFIG);
      // Load-bearing crash-safety assertion: nothing was overwritten in place.
      // The mock lisaDir ships no cross-type copy-overwrite collisions, so on a
      // fresh destination the only candidate for an overwrite is SHARED_CONFIG.
      // Zero overwrites proves the typescript source was skipped, not written
      // first and clobbered.
      expect(result.counters.overwritten).toBe(0);
    });

    it(
      "registers plugins at project scope when settings.json has enabledPlugins",
      async () => {
        await createTypeScriptProject(destDir);

        // Pre-create destination settings so merge path is exercised
        const destClaudeDir = path.join(destDir, ".claude");
        await fs.ensureDir(destClaudeDir);
        await fs.writeJson(path.join(destClaudeDir, SETTINGS_JSON), {
          env: { SOME_VAR: "1" },
        });

        // Create merge source with enabledPlugins
        const mergeDir = path.join(lisaDir, "all", "merge", ".claude");
        await fs.ensureDir(mergeDir);
        await fs.writeJson(path.join(mergeDir, SETTINGS_JSON), {
          enabledPlugins: {
            "test-plugin@test-marketplace": true,
          },
        });

        // Stub the `claude` CLI so plugin registration doesn't hit network/real
        // marketplace and the test stays fast under full-suite contention.
        const stubBin = path.join(tempDir, "stub-bin");
        await fs.ensureDir(stubBin);
        const stubClaude = path.join(stubBin, "claude");
        await fs.writeFile(stubClaude, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
        const originalPath = process.env.PATH;
        process.env.PATH = `${stubBin}:${originalPath ?? ""}`;

        try {
          const result = await createLisa().apply();

          expect(result.success).toBe(true);
          const settings = await fs.readJson(
            path.join(destDir, ".claude", SETTINGS_JSON)
          );
          expect(settings.enabledPlugins["test-plugin@test-marketplace"]).toBe(
            true
          );
          // Existing project keys preserved
          expect(settings.env.SOME_VAR).toBe("1");
        } finally {
          process.env.PATH = originalPath;
        }
        // Scaled rather than fixed: this case spawns the stubbed `claude` CLI, and
        // a fixed 15s budget over a spawn measures the machine. It timed out here
        // inside a full `test:integration:push` run at 63 sibling vitest processes
        // and a 1-minute load average of 50-94 on 18 cores, then completed in
        // 10.6-14.9s in isolation on both this branch and its merge base
        // (CodySwannGT/lisa#2822).
      },
      ioLatencyBudgetMs(15_000)
    );

    it("applies all/ configs to project with no detected types", async () => {
      await fs.ensureDir(destDir);
      await fs.writeJson(path.join(destDir, PACKAGE_JSON), {});

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toHaveLength(0);

      // all/ configs should still be applied
      expect(await fs.pathExists(path.join(destDir, TEST_TXT))).toBe(true);
    });
  });
});
