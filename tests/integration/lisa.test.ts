/* eslint-disable max-lines -- comprehensive integration tests for all Lisa stack types require extensive test cases */
import * as fs from "fs-extra";
import * as path from "node:path";
import type { LisaConfig } from "../../src/core/config.js";
import { NoOpGitService } from "../../src/core/git-service.js";
import { Lisa, type LisaDependencies } from "../../src/core/lisa.js";
import { AutoAcceptPrompter } from "../../src/cli/prompts.js";
import { DetectorRegistry } from "../../src/detection/index.js";
import { SilentLogger } from "../../src/logging/silent-logger.js";
import { MigrationRegistry } from "../../src/migrations/index.js";
import { StrategyRegistry } from "../../src/strategies/index.js";
import {
  parseLearningsFile,
  renderLearningsFile,
} from "../../src/core/learnings-writer.js";
import {
  BackupService,
  DryRunBackupService,
} from "../../src/transaction/index.js";
import {
  cleanupTempDir,
  countFiles,
  createCDKProject,
  createExpoProject,
  createHarperFabricProject,
  createMockLisaDir,
  createNestJSProject,
  createRailsProject,
  createTempDir,
  createTypeScriptProject,
} from "../helpers/test-utils.js";

const PACKAGE_JSON = "package.json";
const SETTINGS_JSON = "settings.json";
const TEST_TXT = "test.txt";
const TSCONFIG_BASE = "tsconfig.base.json";
const TSCONFIG_JSON = "tsconfig.json";
const LISAIGNORE = ".lisaignore";
const LEGACY_WORKFLOW = "legacy-workflow.yml";
const CREATE_ONLY = "create-only";
const COPY_OVERWRITE = "copy-overwrite";
const KNIP_JSON = "knip.json";
const LINT_STAGED_JSON = ".lintstagedrc.json";
const SAFETY_NET_JSON = ".safety-net.json";
const GITIGNORE = ".gitignore";
const ESLINT_IGNORE_CONFIG = "eslint.ignore.config.json";
const GITHUB_ACTIONS_MD = path.join(".github", "GITHUB_ACTIONS.md");
const HARPER_FABRIC_TYPE = "harper-fabric";
const HARPER_FABRIC_TXT = "harper-fabric.txt";
const JEST_CONFIG_LOCAL = "jest.config.local.ts";
const PACKAGE_LISA_DIR = "package-lisa";
const LISA_MANIFEST = ".lisa-manifest";
const PROJECT_LEARNINGS = "PROJECT_LEARNINGS.md";
const LISA_STATE_DIR = ".lisa";
const DEPENDENCY_DECISIONS = "DEPENDENCY_DECISIONS.md";
const LISA_CONFIG_JSON = ".lisa.config.json";
const TSC_BUILD_SCRIPT = "tsc -p tsconfig.build.json";
const WORKFLOWS_DIR = path.join(".github", "workflows");
const CLAUDE_PACKAGE_MANAGER_WORKFLOWS = [
  "claude-ci-auto-fix.yml",
  "claude-code-review-response.yml",
  "claude-deploy-auto-fix.yml",
  "claude-nightly-code-complexity.yml",
  "claude-nightly-test-coverage.yml",
  "claude-nightly-test-improvement.yml",
] as const;

describe("Lisa Integration Tests", () => {
  let tempDir: string;
  let lisaDir: string;
  let destDir: string;

  beforeEach(async () => {
    tempDir = await createTempDir();
    lisaDir = path.join(tempDir, "lisa");
    destDir = path.join(tempDir, "project");
    await createMockLisaDir(lisaDir);
  });

  afterEach(async () => {
    await cleanupTempDir(tempDir);
  });

  /**
   * Create a Lisa config for testing
   * @param overrides - Configuration overrides
   * @returns Lisa configuration with test defaults
   */
  function createConfig(overrides: Partial<LisaConfig> = {}): LisaConfig {
    return {
      lisaDir,
      destDir,
      dryRun: false,
      yesMode: true,
      validateOnly: false,
      skipGitCheck: false,
      harness: "claude",
      ...overrides,
    };
  }

  /**
   * Create Lisa dependencies for testing
   * @param config - Configuration to use for dependencies
   * @returns Lisa dependencies with test implementations
   */
  function createDeps(config: LisaConfig): LisaDependencies {
    const logger = new SilentLogger();
    return {
      logger,
      prompter: new AutoAcceptPrompter(),
      backupService: config.dryRun
        ? new DryRunBackupService()
        : new BackupService(logger),
      detectorRegistry: new DetectorRegistry(),
      strategyRegistry: new StrategyRegistry(),
      gitService: new NoOpGitService(),
      migrationRegistry: new MigrationRegistry(),
    };
  }

  /**
   * Create a Lisa instance with optional config overrides
   * @param overrides - Configuration overrides
   * @returns Lisa instance ready for apply/validate
   */
  function createLisa(overrides: Partial<LisaConfig> = {}): Lisa {
    const config = createConfig(overrides);
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
      await fs.symlink(externalDir, path.join(destDir, "data"), "dir");
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

    it("scaffolds TypeScript Claude callers with the bun package manager", async () => {
      await createTypeScriptProject(destDir);
      await fs.copy(
        path.join(process.cwd(), "typescript", CREATE_ONLY, WORKFLOWS_DIR),
        path.join(lisaDir, "typescript", CREATE_ONLY, WORKFLOWS_DIR)
      );

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      for (const workflow of CLAUDE_PACKAGE_MANAGER_WORKFLOWS) {
        const content = await fs.readFile(
          path.join(destDir, WORKFLOWS_DIR, workflow),
          "utf-8"
        );
        expect(content).toContain("package_manager: 'bun'");
      }

      const syncDownBranches = await fs.readFile(
        path.join(destDir, WORKFLOWS_DIR, "claude-sync-down-branches.yml"),
        "utf-8"
      );
      const claude = await fs.readFile(
        path.join(destDir, WORKFLOWS_DIR, "claude.yml"),
        "utf-8"
      );
      expect(syncDownBranches).not.toContain("package_manager:");
      expect(claude).not.toContain("package_manager:");
    });

    it("preserves host-owned config during postinstall-safe apply", async () => {
      await createTypeScriptProject(destDir);
      const guardedPostinstall =
        '[ -n "$CI" ] || LISA_BOOTSTRAP=1 node node_modules/@codyswann/lisa/dist/index.js --yes --skip-git-check . 2>/dev/null || true';
      const duplicatedPostinstall = `[ -n "$CI" ] || LISA_BOOTSTRAP=1 ${guardedPostinstall}`;
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
      await fs.writeJson(path.join(destDir, LINT_STAGED_JSON), hostLintStaged);
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

      const tsCopyOverwrite = path.join(lisaDir, "typescript", COPY_OVERWRITE);
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

      const result = await createLisa({ skipGitCheck: true }).apply();

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
    });

    it("does not regenerate committed agent trees during postinstall-safe apply", async () => {
      await createTypeScriptProject(destDir);
      const codexManagedPath = path.join(
        destDir,
        ".codex",
        ".lisa-managed.json"
      );
      const codexAgentPath = path.join(
        destDir,
        ".codex",
        "agents",
        "lisa",
        "bug-fixer.toml"
      );
      const opencodeManagedPath = path.join(
        destDir,
        ".opencode",
        ".lisa-managed.json"
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

    it("is a no-op on the second apply to an unchanged managed tree", async () => {
      await createTypeScriptProject(destDir);

      const auditConfig = "audit.ignore.config.json";
      const auditLocal = "audit.ignore.local.json";
      const tsCopyOverwrite = path.join(lisaDir, "typescript", COPY_OVERWRITE);
      await fs.writeJson(path.join(tsCopyOverwrite, auditConfig), {
        exclusions: [{ id: "LISA-OWNED", package: "pkg", reason: "template" }],
      });
      await fs.writeJson(path.join(destDir, auditConfig), {
        exclusions: [
          { id: "LISA-OWNED", package: "pkg", reason: "template" },
          { id: "PROJECT-LOCAL", package: "dep", reason: "host" },
        ],
      });

      const first = await createLisa().apply();
      expect(first.success).toBe(true);
      expect(first.counters.migrationsApplied).toBeGreaterThan(0);

      const second = await createLisa().apply();

      expect(second.success).toBe(true);
      expect(second.counters.overwritten).toBe(0);
      expect(second.counters.merged).toBe(0);
      expect(second.counters.migrationsApplied).toBe(0);
      expect(await fs.readJson(path.join(destDir, auditLocal))).toEqual({
        exclusions: [{ id: "PROJECT-LOCAL", package: "dep", reason: "host" }],
      });
    });

    it("applies configurations to Expo project", async () => {
      await createExpoProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("expo");
      expect(result.detectedTypes).toContain("typescript"); // Parent type
    });

    it("applies configurations to NestJS project", async () => {
      await createNestJSProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("nestjs");
      expect(result.detectedTypes).toContain("typescript");
    });

    it("applies configurations to CDK project", async () => {
      await createCDKProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("cdk");
      expect(result.detectedTypes).toContain("typescript");
    });

    it("applies configurations to Harper/Fabric project", async () => {
      await createHarperFabricProject(destDir);

      const harperDir = path.join(lisaDir, HARPER_FABRIC_TYPE, COPY_OVERWRITE);
      await fs.ensureDir(harperDir);
      await fs.writeFile(path.join(harperDir, HARPER_FABRIC_TXT), "ok\n");

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain(HARPER_FABRIC_TYPE);
      expect(result.detectedTypes).toContain("typescript");
      expect(await fs.pathExists(path.join(destDir, HARPER_FABRIC_TXT))).toBe(
        true
      );
    });

    it("ships Harper/Fabric deploy and ZAP workflow templates as create-only files", async () => {
      await createHarperFabricProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      const deployPath = path.join(
        destDir,
        ".github",
        "workflows",
        "deploy.yml"
      );
      const zapWorkflowPath = path.join(
        destDir,
        ".github",
        "workflows",
        "zap-baseline.yml"
      );
      const zapScriptPath = path.join(destDir, "scripts", "zap-baseline.sh");
      const zapConfigPath = path.join(destDir, ".zap", "baseline.conf");

      expect(await fs.pathExists(deployPath)).toBe(true);
      expect(await fs.pathExists(zapWorkflowPath)).toBe(true);
      expect(await fs.pathExists(zapScriptPath)).toBe(true);
      expect(await fs.pathExists(zapConfigPath)).toBe(true);

      const deployContent = await fs.readFile(deployPath, "utf-8");
      expect(deployContent).toContain("bun run build");
      expect(deployContent).toContain("harper deploy_component");
      expect(deployContent).toContain("bun run verify");

      const zapWorkflowContent = await fs.readFile(zapWorkflowPath, "utf-8");
      expect(zapWorkflowContent).toContain("scripts/zap-baseline.sh");
    });

    it("preserves existing Harper/Fabric deploy workflow customizations", async () => {
      await createHarperFabricProject(destDir);
      const deployPath = path.join(
        destDir,
        ".github",
        "workflows",
        "deploy.yml"
      );
      const customDeploy = "name: Custom Harper Deploy\n";
      await fs.ensureDir(path.dirname(deployPath));
      await fs.writeFile(deployPath, customDeploy);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      await createLisa().apply();
      const deployContent = await fs.readFile(deployPath, "utf-8");
      expect(deployContent).toBe(customDeploy);
    });

    it("removes an existing manifest file during apply", async () => {
      await createTypeScriptProject(destDir);
      const manifestPath = path.join(destDir, ".lisa-manifest");
      await fs.writeFile(manifestPath, "{}\n");

      await createLisa().apply();

      expect(await fs.pathExists(manifestPath)).toBe(false);
    });

    it("skips creating files a detected type's deletions.json will delete (CDK jest inheritance)", async () => {
      // Simulate the real-world CDK/typescript interaction: typescript ships a
      // jest config via create-only, CDK's deletions.json removes it. Without
      // the pending-deletion gate, Lisa creates-then-deletes, which races with
      // any concurrent file-watcher/linter.
      await createCDKProject(destDir);

      // Add a file to typescript/create-only that CDK's deletions.json removes
      const tsCreateOnly = path.join(lisaDir, "typescript", CREATE_ONLY);
      await fs.ensureDir(tsCreateOnly);
      await fs.writeFile(
        path.join(tsCreateOnly, JEST_CONFIG_LOCAL),
        "export default {};\n"
      );

      // Ensure CDK stack directory exists so detectedTypes picks it up
      const cdkDir = path.join(lisaDir, "cdk");
      await fs.ensureDir(cdkDir);
      await fs.writeJson(path.join(cdkDir, "deletions.json"), {
        paths: [JEST_CONFIG_LOCAL],
      });

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      // The file must NOT exist after apply (was never created, not
      // created-then-deleted).
      expect(await fs.pathExists(path.join(destDir, JEST_CONFIG_LOCAL))).toBe(
        false
      );
      // Verify the pending-deletion gate fired: the file must have been
      // *skipped* (never written to disk) rather than *deleted* (written then
      // removed).  If the gate were absent, deleted would be 1 and skipped
      // would be 0 for this file.
      expect(result.counters.skipped).toBeGreaterThan(0);
      expect(result.counters.deleted).toBe(0);
    });

    it("skips inherited Jest local config for Harper/Fabric projects", async () => {
      await createHarperFabricProject(destDir);

      const tsCreateOnly = path.join(lisaDir, "typescript", CREATE_ONLY);
      await fs.ensureDir(tsCreateOnly);
      await fs.writeFile(
        path.join(tsCreateOnly, JEST_CONFIG_LOCAL),
        "export default {};\n"
      );

      const harperDir = path.join(lisaDir, HARPER_FABRIC_TYPE);
      await fs.ensureDir(harperDir);
      await fs.writeJson(path.join(harperDir, "deletions.json"), {
        paths: [JEST_CONFIG_LOCAL],
      });

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(await fs.pathExists(path.join(destDir, JEST_CONFIG_LOCAL))).toBe(
        false
      );
      expect(result.counters.skipped).toBeGreaterThan(0);
      expect(result.counters.deleted).toBe(0);
    });

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

    it("registers plugins at project scope when settings.json has enabledPlugins", async () => {
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
    }, 15_000);

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

  describe("dry run", () => {
    it("does not modify files in dry run mode", async () => {
      await createTypeScriptProject(destDir);
      const beforeCount = await countFiles(destDir);

      const result = await createLisa({ dryRun: true }).apply();

      expect(result.success).toBe(true);
      const afterCount = await countFiles(destDir);
      expect(afterCount).toBe(beforeCount);
    });

    it("returns counters for what would be done", async () => {
      await createTypeScriptProject(destDir);

      const result = await createLisa({ dryRun: true }).apply();

      expect(result.counters.copied).toBeGreaterThan(0);
    });
  });

  describe("validate", () => {
    it("validates project compatibility", async () => {
      await createTypeScriptProject(destDir);

      const result = await createLisa({
        validateOnly: true,
        dryRun: true,
      }).validate();

      expect(result.success).toBe(true);
      expect(result.mode).toBe("validate");
    });

    it("does not modify files in validate mode", async () => {
      await createTypeScriptProject(destDir);
      const beforeCount = await countFiles(destDir);

      await createLisa({ validateOnly: true, dryRun: true }).validate();

      const afterCount = await countFiles(destDir);
      expect(afterCount).toBe(beforeCount);
    });
  });

  describe("idempotency", () => {
    it("running twice produces same result", async () => {
      await createTypeScriptProject(destDir);

      // First run
      const result1 = await createLisa().apply();

      expect(result1.success).toBe(true);

      // Second run
      const result2 = await createLisa().apply();

      expect(result2.success).toBe(true);
      // Second run should skip files since first run already applied them
      expect(result2.counters.skipped).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("fails with non-existent destination", async () => {
      const result = await createLisa({
        destDir: "/nonexistent/path",
      }).apply();

      expect(result.success).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe("Rails stack", () => {
    it("applies configurations to Rails project", async () => {
      await createRailsProject(destDir);

      const result = await createLisa().apply();

      expect(result.success).toBe(true);
      expect(result.detectedTypes).toContain("rails");
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
      expect(content).toContain("uses: ./.github/workflows/quality.yml");
      expect(content).toContain("secrets: inherit");
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
/* eslint-enable max-lines -- re-enable after integration test suite */
