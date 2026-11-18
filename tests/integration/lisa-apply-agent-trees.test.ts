/**
 * Lisa integration tests: committed agent-tree regeneration and no-op re-apply.
 * Sibling of lisa.test.ts, which owns the learnings-ledger apply cases.
 */
import * as fs from "fs-extra";
import * as path from "node:path";
import type { LisaConfig } from "../../src/core/config.js";
import { Lisa } from "../../src/core/lisa.js";
import {
  cleanupTempDir,
  createMockLisaDir,
  createTempDir,
  createTypeScriptProject,
} from "../helpers/test-utils.js";
import {
  buildConfig,
  CODEX_DIR,
  createDeps,
  LISA_MANAGED_JSON,
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
    it("does not regenerate committed agent trees during postinstall-safe apply", async () => {
      await createTypeScriptProject(destDir);
      const codexManagedPath = path.join(destDir, CODEX_DIR, LISA_MANAGED_JSON);
      const codexAgentPath = path.join(
        destDir,
        CODEX_DIR,
        "agents",
        "lisa",
        "bug-fixer.toml"
      );
      const opencodeManagedPath = path.join(
        destDir,
        ".opencode",
        LISA_MANAGED_JSON
      );
      const opencodeSkillPath = path.join(
        destDir,
        ".opencode",
        "skills",
        "lisa",
        "build",
        "SKILL.md"
      );
      await fs.outputJson(codexManagedPath, {
        files: ["agents/lisa/bug-fixer.toml", "agents/lisa/stale.toml"],
      });
      await fs.outputFile(codexAgentPath, 'name = "bug-fixer"\n');
      await fs.outputJson(opencodeManagedPath, {
        files: ["skills/lisa/build/SKILL.md", "skills/lisa/stale/SKILL.md"],
      });
      await fs.outputFile(opencodeSkillPath, "# Build\n");

      const beforeCodexManifest = await fs.readFile(codexManagedPath, "utf8");
      const beforeCodexAgent = await fs.readFile(codexAgentPath, "utf8");
      const beforeOpencodeManifest = await fs.readFile(
        opencodeManagedPath,
        "utf8"
      );
      const beforeOpencodeSkill = await fs.readFile(opencodeSkillPath, "utf8");

      const result = await createLisa({
        harness: "fleet",
        skipGitCheck: true,
        postinstall: true,
      }).apply();

      expect(result.success).toBe(true);
      expect(await fs.readFile(codexManagedPath, "utf8")).toBe(
        beforeCodexManifest
      );
      expect(await fs.readFile(codexAgentPath, "utf8")).toBe(beforeCodexAgent);
      expect(await fs.readFile(opencodeManagedPath, "utf8")).toBe(
        beforeOpencodeManifest
      );
      expect(await fs.readFile(opencodeSkillPath, "utf8")).toBe(
        beforeOpencodeSkill
      );
      expect(await fs.pathExists(path.join(destDir, "AGENTS.md"))).toBe(false);
    });

    it("DOES regenerate committed agent trees when only the git check is waived", async () => {
      // The mirror of the test above, and the end-to-end bite for
      // CodySwannGT/lisa#3066. `--skip-git-check` used to select the reduced
      // subset as a side effect, so this combination was unreachable: a caller
      // that had just run an install — and therefore had a dirty tree by
      // construction — could not ask for a full apply at all. That is what made
      // the documented fleet-update procedure perform no agent-emit work on any
      // project at any version, leaving three measured consumer repositories
      // carrying a pre-2.198 `.codex` overlay across every update for months.
      await createTypeScriptProject(destDir);
      const codexManagedPath = path.join(destDir, CODEX_DIR, LISA_MANAGED_JSON);
      const staleCodexAgentPath = path.join(
        destDir,
        CODEX_DIR,
        "agents",
        "lisa",
        "stale.toml"
      );
      await fs.outputJson(codexManagedPath, {
        files: ["agents/lisa/stale.toml"],
      });
      await fs.outputFile(staleCodexAgentPath, 'name = "stale"\n');

      const result = await createLisa({
        harness: "fleet",
        skipGitCheck: true,
      }).apply();

      expect(result.success).toBe(true);
      // The emit ran: the stale entry Lisa no longer owns is gone, which is
      // precisely the `.codex` reconciliation no `bun install` can perform.
      expect(await fs.pathExists(staleCodexAgentPath)).toBe(false);
      expect(await fs.pathExists(path.join(destDir, "AGENTS.md"))).toBe(true);
      expect(
        await fs.readJson(
          path.join(tempDir, "home", ".gemini", "config", "mcp_config.json")
        )
      ).toEqual({ mcpServers: {} });
      const hooks = await fs.readJson(
        path.join(destDir, CODEX_DIR, "hooks.json")
      );
      expect(hooks.hooks.PreToolUse).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            matcher: "Bash|Edit|Write|apply_patch",
            hooks: [
              expect.objectContaining({
                _lisaManaged: true,
                _lisaId: "enforcement-fallback",
              }),
            ],
          }),
        ])
      );
      expect((await fs.readJson(codexManagedPath)).files).toContain(
        "hooks.json"
      );
    });

    it("is a no-op on the second apply to an unchanged managed tree", async () => {
      await createTypeScriptProject(destDir);

      const first = await createLisa().apply();
      expect(first.success).toBe(true);
      expect(first.counters.migrationsApplied).toBeGreaterThan(0);

      const second = await createLisa().apply();

      expect(second.success).toBe(true);
      expect(second.counters.overwritten).toBe(0);
      expect(second.counters.merged).toBe(0);
      expect(second.counters.migrationsApplied).toBe(0);
    });
  });
});
