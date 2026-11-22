import * as fs from "fs-extra";
import * as path from "node:path";
import type { LisaConfig } from "../../src/core/config.js";
import { Lisa } from "../../src/core/lisa.js";
import {
  parseLearningsFile,
  renderLearningsFile,
} from "../../src/core/learnings-writer.js";
import {
  cleanupTempDir,
  createMockLisaDir,
  createTempDir,
  createTypeScriptProject,
} from "../helpers/test-utils.js";
import {
  buildConfig,
  COPY_OVERWRITE,
  CREATE_ONLY,
  createDeps,
  DEPENDENCY_DECISIONS,
  LISA_CONFIG_JSON,
  LISA_STATE_DIR,
  PROJECT_LEARNINGS,
} from "./lisa-fixtures.js";
import { createSymlink } from "../support/borrowed-node-modules.mjs";

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
    it("creates, preserves, and repeatedly leaves the default project learnings file byte-identical", async () => {
      await createTypeScriptProject(destDir);
      const learningsPath = path.join(
        destDir,
        LISA_STATE_DIR,
        PROJECT_LEARNINGS
      );

      const first = await createLisa().apply();

      expect(first.success).toBe(true);
      const emptySeed = await fs.readFile(learningsPath, "utf8");
      expect(emptySeed).toBe(renderLearningsFile([]));
      expect(parseLearningsFile(emptySeed)).toEqual([]);

      const populated = renderLearningsFile([
        {
          id: "learning-1576-sentinel",
          fingerprint: "learning-1576-sentinel",
          rule: "Preserve the host-owned project learnings file.",
          why: "Lisa apply must not erase durable project memory.",
          provenance: ["https://github.com/CodySwannGT/lisa/issues/1576"],
          first_learned: "2026-07-16T12:00:00.000Z",
          last_confirmed: "2026-07-16T12:00:00.000Z",
          confidence: "high",
        },
      ]);
      await fs.writeFile(learningsPath, populated);

      const second = await createLisa().apply();
      const third = await createLisa().apply();

      expect(second.success).toBe(true);
      expect(third.success).toBe(true);
      expect(await fs.readFile(learningsPath, "utf8")).toBe(populated);
    });

    it("seeds the governed dependency decision-record scaffold and never overwrites it", async () => {
      await createTypeScriptProject(destDir);
      const recordPath = path.join(
        destDir,
        LISA_STATE_DIR,
        DEPENDENCY_DECISIONS
      );

      const first = await createLisa().apply();

      expect(first.success).toBe(true);
      const seeded = await fs.readFile(recordPath, "utf8");

      // Every required decision-record field reaches the host project.
      expect(seeded).toContain("<!-- lisa-dependency-decisions:v1 -->");
      expect(seeded).toContain("**Why we keep it:**");
      expect(seeded).toContain("**What it is (dependency):**");
      expect(seeded).toContain("**What it does for us (owned capability):**");
      expect(seeded).toContain("**Why we believe it's safe (trust basis):**");
      expect(seeded).toContain(
        "**What breaks if this is compromised (exposure):**"
      );
      expect(seeded).toContain(
        "**What it would take to replace (replacement cost):**"
      );
      expect(seeded).toContain(
        "**What would catch a bad update (detection evidence):**"
      );
      expect(seeded).toContain(
        "**Who owns this and how often we recheck (owner / review cadence):**"
      );
      expect(seeded).toContain("**Last reviewed:**");
      expect(seeded).toContain("### ESLint (EXAMPLE — a complete entry)");

      // The operator gets a sanctioned next action, and sees an honest gap
      // in place rather than only a perfectly-filled example.
      expect(seeded).toContain("## When to escalate");
      expect(seeded).toContain(
        "### sharp (EXAMPLE — an entry still being filled in)"
      );
      expect(seeded).toContain(
        "**Last reviewed:** _Not yet decided_ (example entry — never reviewed)"
      );

      // Host-owned content survives re-apply: Lisa seeds once, never rewrites.
      const hostAuthored = `${seeded}\n### internal-billing-sdk\n\n- **Why we keep it:** It bills our customers.\n`;
      await fs.writeFile(recordPath, hostAuthored);

      const second = await createLisa().apply();

      expect(second.success).toBe(true);
      expect(await fs.readFile(recordPath, "utf8")).toBe(hostAuthored);
    });

    it("keeps the ledger at .lisa regardless of a custom projectRulesFile", async () => {
      await createTypeScriptProject(destDir);
      await fs.writeJson(path.join(destDir, LISA_CONFIG_JSON), {
        harness: "claude",
        projectRulesFile: "rules/CUSTOM_RULES.md",
      });
      const ledgerPath = path.join(destDir, LISA_STATE_DIR, PROJECT_LEARNINGS);
      const legacySibling = path.join(destDir, "rules", PROJECT_LEARNINGS);

      const first = await createLisa().apply();

      expect(first.success).toBe(true);
      // Relocating the rules file must NOT drag the ledger back to its sibling.
      expect(await fs.readFile(ledgerPath, "utf8")).toBe(
        renderLearningsFile([])
      );
      expect(await fs.pathExists(legacySibling)).toBe(false);

      const sentinel = `${renderLearningsFile([])}<!-- custom sentinel -->\n`;
      await fs.writeFile(ledgerPath, sentinel);
      await createLisa().apply();
      expect(await fs.readFile(ledgerPath, "utf8")).toBe(sentinel);
      expect(await fs.pathExists(legacySibling)).toBe(false);
    });

    it("honors a learnings.file override for the ledger destination", async () => {
      await createTypeScriptProject(destDir);
      await fs.writeJson(path.join(destDir, LISA_CONFIG_JSON), {
        harness: "claude",
        learnings: { file: "docs/LEARNINGS.md" },
      });
      const overridePath = path.join(destDir, "docs", "LEARNINGS.md");
      const defaultPath = path.join(destDir, LISA_STATE_DIR, PROJECT_LEARNINGS);

      const first = await createLisa().apply();

      expect(first.success).toBe(true);
      expect(await fs.readFile(overridePath, "utf8")).toBe(
        renderLearningsFile([])
      );
      expect(await fs.pathExists(defaultPath)).toBe(false);
    });

    it("relocates a populated legacy ledger on the bootstrap/skip-git-check path without seeding an empty one (#1730 fleet upgrade)", async () => {
      await createTypeScriptProject(destDir);
      const legacyPath = path.join(
        destDir,
        ".claude",
        "rules",
        PROJECT_LEARNINGS
      );
      const ledgerPath = path.join(destDir, LISA_STATE_DIR, PROJECT_LEARNINGS);
      const populated = renderLearningsFile([
        {
          id: "fleet-upgrade-sentinel",
          fingerprint: "fleet-upgrade-sentinel",
          rule: "Never strand a populated legacy ledger on upgrade.",
          why: "The fleet updater forces LISA_BOOTSTRAP=1 + --skip-git-check.",
          provenance: ["https://github.com/CodySwannGT/lisa/issues/1730"],
          first_learned: "2026-07-16",
          last_confirmed: "2026-07-16",
          confidence: "high",
        },
      ]);
      await fs.outputFile(legacyPath, populated);

      // STEP 1: the exact fleet-upgrade path — skipGitCheck triggers
      // shouldSkipAgentEmitDuringPostinstall.
      const first = await createLisa({ skipGitCheck: true }).apply();

      expect(first.success).toBe(true);
      // The new ledger holds the MOVED entries — never an empty seed.
      expect(await fs.readFile(ledgerPath, "utf8")).toBe(populated);
      // The raw-injected legacy path is gone.
      expect(await fs.pathExists(legacyPath)).toBe(false);

      // STEP 2: idempotent — a second bootstrap apply changes nothing and never
      // resurrects the both-exist stranding.
      const second = await createLisa({ skipGitCheck: true }).apply();

      expect(second.success).toBe(true);
      expect(await fs.readFile(ledgerPath, "utf8")).toBe(populated);
      expect(await fs.pathExists(legacyPath)).toBe(false);
    });

    it("rejects a configured learnings seed whose parent symlink escapes the host project", async () => {
      await createTypeScriptProject(destDir);
      const externalDir = path.join(tempDir, "external-ledger");
      await fs.ensureDir(externalDir);
      createSymlink(externalDir, path.join(destDir, "data"), "dir");
      await fs.writeJson(path.join(destDir, LISA_CONFIG_JSON), {
        harness: "claude",
        learnings: { file: "data/PROJECT_LEARNINGS.md" },
      });

      const result = await createLisa().apply();

      expect(result.success).toBe(false);
      expect(result.errors).toEqual([
        expect.stringMatching(/parent escapes project root/i),
      ]);
      expect(
        await fs.pathExists(path.join(externalDir, PROJECT_LEARNINGS))
      ).toBe(false);
    });

    it("negative control: copy-overwrite registration clobbers populated learnings", async () => {
      await createTypeScriptProject(destDir);
      const createOnlySource = path.join(
        lisaDir,
        "all",
        CREATE_ONLY,
        LISA_STATE_DIR,
        PROJECT_LEARNINGS
      );
      const overwriteSource = path.join(
        lisaDir,
        "all",
        COPY_OVERWRITE,
        ".claude",
        "rules",
        PROJECT_LEARNINGS
      );
      await fs.outputFile(overwriteSource, renderLearningsFile([]));
      await fs.remove(createOnlySource);
      const destination = path.join(
        destDir,
        ".claude",
        "rules",
        PROJECT_LEARNINGS
      );
      await fs.outputFile(destination, "persisted sentinel\n");

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(await fs.readFile(destination, "utf8")).toBe(
        renderLearningsFile([])
      );
    });
  });
});
