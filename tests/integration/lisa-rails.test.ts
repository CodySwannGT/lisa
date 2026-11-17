/**
 * Lisa integration tests: the Rails stack and .lisaignore.
 * Sibling of lisa.test.ts, which owns the learnings-ledger apply cases.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import type { LisaConfig } from "../../src/core/config.js";
import { Lisa } from "../../src/core/lisa.js";
import {
  cleanupTempDir,
  createMockLisaDir,
  createRailsProject,
  createTempDir,
  createTypeScriptProject,
} from "../helpers/test-utils.js";
import {
  buildConfig,
  COPY_CONTENTS,
  createDeps,
  GITIGNORE,
  LEGACY_WORKFLOW,
  LISA_CONFIG_JSON,
  LISAIGNORE,
  TEST_TXT,
  TSCONFIG_BASE,
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

  describe("Rails stack", () => {
    it("applies configurations to Rails project", async () => {
      await createRailsProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("rails");
      const config = await fs.readJson(path.join(destDir, LISA_CONFIG_JSON));
      expect(config.gates["introduced-history-credential-leakage"]).toEqual({
        push: "required",
        "pull-request": {
          level: "required",
          caller_chain: ["Quality Checks", "History Secrets"],
        },
      });
    });

    it("does not apply typescript pack to Rails project", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      // TypeScript-specific files should NOT be present
      expect(
        await fs.pathExists(path.join(destDir, "tsconfig.base.json"))
      ).toBe(false);
    });

    it("overrides CLAUDE.md with Rails-specific version", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      const claudeContent = await fs.readFile(
        path.join(destDir, "CLAUDE.md"),
        "utf-8"
      );
      expect(claudeContent).toContain("Rails governance rules");
    });

    it("appends eval_gemfile to Gemfile with markers", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      const gemfileContent = await fs.readFile(
        path.join(destDir, "Gemfile"),
        "utf-8"
      );
      expect(gemfileContent).toContain("eval_gemfile");
      expect(gemfileContent).toContain("# BEGIN: AI GUARDRAILS");
      expect(gemfileContent).toContain("# END: AI GUARDRAILS");
    });

    it("deploys Gemfile.lisa via copy-overwrite", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      expect(await fs.pathExists(path.join(destDir, "Gemfile.lisa"))).toBe(
        true
      );
      const gemfileLisaContent = await fs.readFile(
        path.join(destDir, "Gemfile.lisa"),
        "utf-8"
      );
      expect(gemfileLisaContent).toContain("strong_migrations");
    });

    it("deletes .overcommit.yml via deletions.json", async () => {
      await createRailsProject(destDir);
      // Pre-create .overcommit.yml to simulate existing project
      await fs.writeFile(
        path.join(destDir, ".overcommit.yml"),
        "old overcommit config\n"
      );

      await createLisa().apply();

      expect(await fs.pathExists(path.join(destDir, ".overcommit.yml"))).toBe(
        false
      );
    });

    it("deploys .mise.toml via create-only", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      expect(await fs.pathExists(path.join(destDir, ".mise.toml"))).toBe(true);
      const content = await fs.readFile(
        path.join(destDir, ".mise.toml"),
        "utf-8"
      );
      expect(content).toContain("[tools]");
      expect(content).toContain("ruby");
    });

    it("deploys ci.yml wrapper via create-only", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      const ciPath = path.join(destDir, ".github", "workflows", "ci.yml");
      expect(await fs.pathExists(ciPath)).toBe(true);
      const content = await fs.readFile(ciPath, "utf-8");
      expect(content).toContain(
        "types: [opened, synchronize, reopened, labeled, unlabeled]"
      );
      expect(content).toContain(
        "uses: CodySwannGT/lisa/.github/workflows/quality-rails.yml@main"
      );
      expect(content).toContain("secrets:");
    });

    it("deploys quality.yml with workflow_call trigger via create-only", async () => {
      await createRailsProject(destDir);

      await createLisa().apply();

      const qualityPath = path.join(
        destDir,
        ".github",
        "workflows",
        "quality.yml"
      );
      expect(await fs.pathExists(qualityPath)).toBe(true);
      const content = await fs.readFile(qualityPath, "utf-8");
      expect(content).toContain("workflow_call:");
    });

    it("preserves create-only files on re-run", async () => {
      await createRailsProject(destDir);

      // First run — creates .rubocop.local.yml
      await createLisa().apply();

      // Modify the create-only file
      const localRubocopPath = path.join(destDir, ".rubocop.local.yml");
      await fs.writeFile(localRubocopPath, "# Custom project overrides\n");

      // Second run — should NOT overwrite
      await createLisa().apply();

      const content = await fs.readFile(localRubocopPath, "utf-8");
      expect(content).toBe("# Custom project overrides\n");
    });

    it("handles Rails + TypeScript project correctly", async () => {
      await createRailsProject(destDir);
      // Also add TypeScript indicators
      await fs.writeJson(path.join(destDir, "package.json"), {
        dependencies: { typescript: "^5.0.0" },
      });
      await fs.writeJson(path.join(destDir, "tsconfig.json"), {});

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("rails");
      expect(result.detectedTypes).toContain("typescript");
    });
  });

  describe(".lisaignore", () => {
    it("matches the real .gitignore destination when npm ships the template dotless", async () => {
      await createTypeScriptProject(destDir);
      const copyContentsDir = path.join(lisaDir, "all", COPY_CONTENTS);
      await fs.move(
        path.join(copyContentsDir, GITIGNORE),
        path.join(copyContentsDir, "gitignore")
      );
      await fs.writeFile(path.join(destDir, LISAIGNORE), `${GITIGNORE}\n`);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.counters.ignored).toBeGreaterThan(0);
      expect(await fs.pathExists(path.join(destDir, GITIGNORE))).toBe(false);
    });

    it("skips files matching patterns in .lisaignore", async () => {
      await createTypeScriptProject(destDir);

      // Create .lisaignore to skip test.txt
      await fs.writeFile(path.join(destDir, LISAIGNORE), TEST_TXT);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      // test.txt should NOT be copied because it's ignored
      expect(await fs.pathExists(path.join(destDir, TEST_TXT))).toBe(false);
      // Other files should still be copied
      expect(await fs.pathExists(path.join(destDir, TSCONFIG_BASE))).toBe(true);
      // Ignored count should be > 0
      expect(result.counters.ignored).toBeGreaterThan(0);
    });

    it("skips entire directories matching patterns", async () => {
      await createTypeScriptProject(destDir);

      // Create .lisaignore to skip typescript/ directory files
      // Since tsconfig.base.json comes from typescript/, ignoring it should work
      await fs.writeFile(path.join(destDir, LISAIGNORE), TSCONFIG_BASE);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      // tsconfig.base.json should NOT be copied
      expect(await fs.pathExists(path.join(destDir, TSCONFIG_BASE))).toBe(
        false
      );
      // test.txt should still be copied
      expect(await fs.pathExists(path.join(destDir, TEST_TXT))).toBe(true);
    });

    it("works with dry run mode", async () => {
      await createTypeScriptProject(destDir);
      await fs.writeFile(path.join(destDir, LISAIGNORE), TEST_TXT);

      const result = await createLisa({ dryRun: true }).apply();

      expect(result.success).toBe(true);
      expect(result.counters.ignored).toBeGreaterThan(0);
    });

    it("prevents deletions for files matching .lisaignore", async () => {
      await createTypeScriptProject(destDir);

      // Pre-create a file that typescript/deletions.json would delete
      await fs.writeFile(
        path.join(destDir, LEGACY_WORKFLOW),
        "legacy content\n"
      );

      // Create .lisaignore to protect it
      await fs.writeFile(path.join(destDir, LISAIGNORE), LEGACY_WORKFLOW);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      // File should still exist because .lisaignore protects it from deletion
      expect(await fs.pathExists(path.join(destDir, LEGACY_WORKFLOW))).toBe(
        true
      );
    });

    it("does nothing when .lisaignore is empty or missing", async () => {
      await createTypeScriptProject(destDir);
      // No .lisaignore file

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.counters.ignored).toBe(0);
      // All files should be copied
      expect(await fs.pathExists(path.join(destDir, TEST_TXT))).toBe(true);
    });
  });
});
