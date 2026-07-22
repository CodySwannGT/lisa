/* eslint-disable max-lines -- Main orchestrator class with apply/validate operations */
import * as fse from "fs-extra";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import * as path from "node:path";
import pc from "picocolors";
import type { IPrompter } from "../cli/prompts.js";
import { getPackageVersion } from "../cli/version.js";
import { installAgentsMd } from "../codex/agents-md-installer.js";
import { installCodexProjectOverlay } from "../codex/project-overlay.js";
import { installAgyPlugin } from "../agy/plugin-installer.js";
import {
  collectLisaMcpServers,
  installAgyMcpConfig,
  resolveAgyMcpConfigPath,
} from "../agy/mcp-installer.js";
import { installCopilotPlugin } from "../copilot/plugin-installer.js";
import { installCopilotInstructions } from "../copilot/copilot-instructions-installer.js";
import {
  readManagedManifest as readOpencodeManifest,
  writeManagedManifest as writeOpencodeManifest,
} from "../opencode/manifest.js";
import { installSkills as installOpencodeSkills } from "../opencode/skills-installer.js";
import { installHooks as installOpencodeHooks } from "../opencode/hooks-installer.js";
import { installSettings as installOpencodeSettings } from "../opencode/settings-installer.js";
import {
  installOpencodeMcpConfig,
  resolveOpencodeConfigPath,
} from "../opencode/mcp-installer.js";
import { discoverAndInstallAgents as installOpencodeAgents } from "../opencode/agent-installer.js";
import { discoverAndInstallCommands as installOpencodeCommands } from "../opencode/command-installer.js";
import { installClaudeMd } from "../claude/claude-md-installer.js";
import { DetectorRegistry } from "../detection/index.js";
import { isLisaSourceRepo } from "./self-apply.js";
import {
  DestinationNotDirectoryError,
  DestinationNotFoundError,
  UserAbortedError,
} from "../errors/index.js";
import type { ILogger } from "../logging/index.js";
import {
  MigrationRegistry,
  type MigrationContext,
  type MigrationResult,
} from "../migrations/index.js";
import { StrategyRegistry, type StrategyContext } from "../strategies/index.js";
import type { IBackupService } from "../transaction/index.js";
import { listFilesRecursive } from "../utils/file-operations.js";
import { resolvePrimaryWorktreeRoot } from "../utils/linked-worktree.js";
import {
  loadIgnorePatterns,
  type IgnorePatterns,
} from "../utils/ignore-patterns.js";
import {
  getLisaDistDir,
  hashFile,
  isRunningAsTrampoline,
  regenerateLockfilesInProcess,
  scheduleReconciliationChild,
  shouldSchedulePostinstallReconciliation,
} from "../utils/postinstall-trampoline.js";
import type {
  CopyStrategy,
  DeletionsConfig,
  FileOperationResult,
  LisaConfig,
  LisaResult,
  OperationCounters,
  ProjectType,
} from "./config.js";
import {
  COPY_STRATEGIES,
  createInitialCounters,
  harnessIncludesAgent,
} from "./config.js";
import {
  migrateInstructionFiles,
  relocateProjectLearningsLedger,
} from "./instruction-files-migration.js";
import {
  assertSafeLearningParents,
  resolveSafeLearningTarget,
} from "./learnings-file-safety.js";
import type { IGitService } from "./git-service.js";
import {
  readProjectConfig,
  resolveLegacyProjectLearningsFile,
  resolveProjectLearningsFile,
} from "./project-config.js";
import {
  decideTemplateOwnership,
  templateSkipDescription,
} from "./template-ownership.js";

/**
 * Log fragment used when a create-only instruction file already exists and is
 * therefore left untouched (the host owns it).
 */
const HOST_OWNED_LABEL = "already present (host-owned)";
const CREATE_ONLY_STRATEGY = "create-only" as const;
const PROJECT_LEARNINGS_TEMPLATE_PATH = path.join(
  ".lisa",
  "PROJECT_LEARNINGS.md"
);

/**
 * Dependencies for Lisa operations
 */
export interface LisaDependencies {
  readonly logger: ILogger;
  readonly prompter: IPrompter;
  readonly backupService: IBackupService;
  readonly detectorRegistry: DetectorRegistry;
  readonly strategyRegistry: StrategyRegistry;
  readonly gitService: IGitService;
  readonly migrationRegistry: MigrationRegistry;
}

/**
 * Shape of the promisified exec function used for Claude CLI plugin commands.
 */
type PluginExecAsync = (
  cmd: string,
  opts: Record<string, unknown>
) => Promise<unknown>;

/**
 * Main Lisa orchestrator
 */
export class Lisa {
  private counters: OperationCounters = createInitialCounters();
  private detectedTypes: ProjectType[] = [];
  private ignorePatterns: IgnorePatterns = {
    patterns: [],
    shouldIgnore: () => false,
  };
  /**
   * Paths marked for deletion by any detected project type's deletions.json.
   * Used to skip creating files that would just be deleted moments later (e.g.,
   * CDK inherits jest.* files from typescript but its own deletions.json removes
   * them — without this gate, Lisa creates then immediately deletes the files,
   * causing ENOENT races for any concurrent linter/file-watcher).
   */
  private pendingDeletions: Set<string> = new Set();
  /**
   * Maps each relative path shipped by any type's `create-only/` tree to the
   * single type that "owns" it (most-specific wins). Computed once before
   * strategies run; consulted while processing `create-only` to suppress
   * parent-type sources for paths that a child type also ships.
   *
   * Motivating case: CDK projects detect as both `typescript` and `cdk`.
   * Both ship `.github/workflows/ci.yml` under their `create-only/` trees.
   * Without this map, typescript's bun-mode ci.yml runs first and creates
   * the file; cdk's npm-mode + determine_environment ci.yml then sees the
   * file already exists and is silently skipped — producing a CDK project
   * wired to use bun, which fails immediately in CI because CDK projects
   * have `engines.bun = "please-use-npm"` and only a `package-lock.json`.
   */
  private createOnlyOwnership: Map<string, string> = new Map();
  /**
   * Maps each relative path shipped by any type's `copy-overwrite/` tree to the
   * single type that "owns" it (most-specific wins). Computed once before
   * strategies run; consulted while processing `copy-overwrite` to suppress
   * parent-type sources for paths that a child type also ships.
   *
   * Why this exists — crash safety: `copy-overwrite` always overwrites, so the
   * per-type outer loop in `processConfigurations` naturally lets the child win
   * by writing the parent's version first and then overwriting it. But that
   * leaves a window in which the destination holds the parent (typescript)
   * version of an overlapping path (e.g. `tsconfig.json`, `eslint.config.ts`)
   * before the child (expo/cdk/nestjs) phase overwrites it. If the process is
   * killed in that window — which is exactly what bun's lifecycle-script
   * handling did during postinstall — the project is left with TypeScript
   * configs clobbering the child stack's (Expo getting the typescript
   * `include` glob in tsconfig.json instead of its own).
   * That was the bug fixed by removing the postinstall apply in #318.
   *
   * Resolving ownership up front and writing each path exactly once (by its
   * most-specific type) eliminates the intermediate write entirely: a kill at
   * any point leaves either the pre-existing file or the correct final file,
   * never the parent-clobbered intermediate. This is the symmetric counterpart
   * to `createOnlyOwnership` (which exists for the opposite reason — create-only
   * skips existing files, so without help the parent would win).
   */
  private copyOverwriteOwnership: Map<string, string> = new Map();
  /** Destination selected by the host project's projectRulesFile setting. */
  private projectLearningsFile = PROJECT_LEARNINGS_TEMPLATE_PATH;
  /** Whether the canonical all/create-only learnings source is registered. */
  private projectLearningsTemplateRegistered = false;
  /**
   * True when a populated legacy ledger exists and the new `.lisa/` destination
   * does not yet — the create-only strategy must NOT seed an empty ledger over
   * it, or the pending relocation would collide (both-exist no-clobber) and
   * strand the real entries at the raw-injected legacy path.
   */
  private suppressLearningsSeedForRelocation = false;
  private readonly separator = "========================================";
  private readonly lisaignoreSuffix = "(.lisaignore)";

  /**
   * True when the destination is the Lisa source repo itself. A self-apply
   * skips deletions, template application, and postinstall injection while
   * still applying package.lisa.json dependency governance. See {@link isLisaSourceRepo}.
   */
  private selfApply = false;

  /**
   * Initialize Lisa orchestrator
   * @param config - Configuration for the apply operation
   * @param deps - Injected service dependencies
   */
  constructor(
    private readonly config: LisaConfig,
    private readonly deps: LisaDependencies
  ) {}

  /**
   * Postinstall applies are intentionally narrow: they refresh governance
   * templates that must track dependency updates, but they must not regenerate
   * project-scoped agent surfaces. Agent trees are large, committed outputs and
   * are updated through an explicit `lisa apply` or cross-pollinate run. A
   * self-apply against the Lisa source repo also skips emit — those agent
   * surfaces are built from `plugins/src`, not regenerated by apply.
   * @returns True when the current apply should avoid agent-surface writes.
   */
  private shouldSkipAgentEmitDuringPostinstall(): boolean {
    return this.config.skipGitCheck || this.selfApply;
  }

  /**
   * Initialize services
   */
  private async initServices(): Promise<void> {
    const { backupService } = this.deps;

    if (!this.config.dryRun) {
      await backupService.init(this.config.destDir);
    }
  }

  /**
   * Detect and confirm project types
   */
  private async detectTypes(): Promise<void> {
    const { detectorRegistry, prompter } = this.deps;

    const rawTypes = await detectorRegistry.detectAll(this.config.destDir);
    this.detectedTypes = detectorRegistry.expandAndOrderTypes(rawTypes);
    this.detectedTypes = [
      ...(await prompter.confirmProjectTypes(this.detectedTypes)),
    ];
  }

  /**
   * Detect whether this apply targets the Lisa source repo itself and, if so,
   * announce the narrowed behavior. A self-apply skips deletions, template
   * application, and agent-surface emit, but still applies package.lisa.json
   * dependency governance so Lisa's own deps track the floors it forces
   * downstream. See {@link isLisaSourceRepo}.
   */
  private async detectSelfApply(): Promise<void> {
    this.selfApply = await isLisaSourceRepo(this.config.destDir);
    if (this.selfApply) {
      this.deps.logger.info(
        pc.yellow(
          "Detected Lisa source repo — self-apply mode: applying only " +
            "package.lisa.json dependency governance (skipping template " +
            "application, deletions, postinstall injection, and agent emit)."
        )
      );
    }
  }

  /**
   * Process all configurations
   */
  private async processConfigurations(): Promise<void> {
    const { logger } = this.deps;

    // Load ignore patterns from destination project
    this.ignorePatterns = await loadIgnorePatterns(this.config.destDir);
    if (this.ignorePatterns.patterns.length > 0) {
      logger.info(
        `Loaded .lisaignore with ${this.ignorePatterns.patterns.length} pattern(s)`
      );
    }

    logger.info("Processing common configurations (all/)...");
    await this.processProjectType("all");

    for (const type of this.detectedTypes) {
      const typeDir = path.join(this.config.lisaDir, type);
      if (await fse.pathExists(typeDir)) {
        logger.info(`Processing ${type} configurations...`);
        await this.processProjectType(type);
      } else {
        logger.warn(`No configuration directory found for type: ${type}`);
      }
    }
  }

  /**
   * Pre-compute the set of paths marked for deletion across "all" and every
   * detected project type. This runs before strategy processing so the copy
   * strategies can skip creating files that are about to be deleted anyway.
   *
   * Motivating case: CDK inherits typescript/create-only, which ships
   * `jest.config.local.ts` + `jest.thresholds.json`. CDK's own `deletions.json`
   * then removes them. Without this gate, Lisa would create them and delete
   * them in the same apply, which causes ENOENT errors for any concurrent
   * file-watcher/linter that observed the briefly-existing files.
   *
   * The `keep` list in a deletions.json (e.g., expo keeps
   * `zap-baseline-expo.yml`) is honored — paths in `keep` are not treated as
   * pending-deletions, so they will still be created by upstream strategies.
   * @returns Promise that resolves once pending deletions have been collected
   */
  private async loadPendingDeletions(): Promise<void> {
    const pending = new Set<string>();
    for (const type of ["all", ...this.detectedTypes]) {
      const paths = await this.readPendingDeletionsForType(type);
      for (const p of paths) {
        pending.add(path.normalize(p));
      }
    }
    this.pendingDeletions = pending;
  }

  /**
   * Resolve the host-owned learnings destination before template ownership is
   * computed. The canonical source stays at its stable package path while its
   * destination follows the configured project-rules directory.
   */
  private async loadProjectLearningsFile(): Promise<void> {
    const config = await readProjectConfig(this.config.destDir);
    const relativeFile = resolveProjectLearningsFile(config);
    const { root, target } = resolveSafeLearningTarget(
      this.config.destDir,
      relativeFile
    );
    await assertSafeLearningParents(root, path.dirname(target));
    this.projectLearningsFile = path.normalize(relativeFile);
    // Belt-and-braces against the fleet-upgrade defect: if a populated legacy
    // ledger exists and the destination does not, the create-only strategy must
    // not seed an empty ledger here — the relocation (which runs even on the
    // bootstrap/skip path) moves the real file into place instead.
    const legacyRelative = resolveLegacyProjectLearningsFile(config);
    this.suppressLearningsSeedForRelocation =
      legacyRelative !== relativeFile &&
      (await fse.pathExists(path.join(this.config.destDir, legacyRelative))) &&
      !(await fse.pathExists(target));
  }

  /**
   * Pre-compute, for every relative path shipped by any type's `create-only/`
   * directory, which single type "owns" it. The owner is the most-specific
   * detected type — i.e., the last entry in [all, ...detectedTypes] (already
   * canonically ordered parent-before-child by `expandAndOrderTypes`).
   *
   * Why this is needed: the `create-only` strategy intentionally does nothing
   * when the destination file already exists. Combined with the per-type
   * outer loop in `processConfigurations`, that means the *first* type to
   * ship a `create-only/<path>` creates the file and every later type's
   * version is silently skipped. For paths that overlap between a parent
   * stack (typescript) and a child stack (cdk/expo/nestjs/npm-package), this
   * lets the parent win — the exact opposite of the rest of Lisa's
   * "child overrides parent" semantics. See `copy-overwrite` for comparison:
   * because it always overwrites, the per-type ordering naturally lets
   * children win. `create-only` needs explicit help.
   *
   * The fix: the orchestrator pre-computes this ownership map and, while
   * processing `create-only`, skips any source whose owning type isn't the
   * current one. The result is that exactly one source wins per path — the
   * most-specific detected type.
   * @returns Promise that resolves once ownership has been resolved
   */
  private async loadCreateOnlyOwnership(): Promise<void> {
    const ownership = new Map<string, string>();
    for (const type of ["all", ...this.detectedTypes]) {
      const createOnlyDir = path.join(
        this.config.lisaDir,
        type,
        CREATE_ONLY_STRATEGY
      );
      if (!(await fse.pathExists(createOnlyDir))) {
        continue;
      }
      const files = await listFilesRecursive(createOnlyDir);
      for (const file of files) {
        const sourceRelativePath = path.relative(createOnlyDir, file);
        const relativePath = this.resolveTemplateDestination(
          sourceRelativePath,
          CREATE_ONLY_STRATEGY,
          type
        );
        // Later types overwrite earlier ones, so child wins over parent.
        ownership.set(relativePath, type);
      }
    }
    const canonicalSource = path.join(
      this.config.lisaDir,
      "all",
      CREATE_ONLY_STRATEGY,
      PROJECT_LEARNINGS_TEMPLATE_PATH
    );
    this.projectLearningsTemplateRegistered =
      await fse.pathExists(canonicalSource);
    if (this.projectLearningsTemplateRegistered) {
      // Durable project memory is a single contract, not a stack override.
      ownership.set(this.projectLearningsFile, "all");
    }
    this.createOnlyOwnership = ownership;
  }

  /**
   * Pre-compute, for every relative path shipped by any type's `copy-overwrite/`
   * directory, which single type "owns" it — the most-specific detected type
   * (last entry in [all, ...detectedTypes], already ordered parent-before-child).
   *
   * Consumed by `shouldProcessFile` to skip non-owning sources so each path is
   * written exactly once, by its winning stack. See the `copyOverwriteOwnership`
   * field doc for the crash-safety rationale (eliminating the parent-then-child
   * overwrite window that left half-applied configs when the process was killed
   * mid-apply during postinstall — the bug behind #318).
   * @returns Promise that resolves once ownership has been resolved
   */
  private async loadCopyOverwriteOwnership(): Promise<void> {
    const ownership = new Map<string, string>();
    for (const type of ["all", ...this.detectedTypes]) {
      const copyOverwriteDir = path.join(
        this.config.lisaDir,
        type,
        "copy-overwrite"
      );
      if (!(await fse.pathExists(copyOverwriteDir))) {
        continue;
      }
      const files = await listFilesRecursive(copyOverwriteDir);
      for (const file of files) {
        const relativePath = path.relative(copyOverwriteDir, file);
        // Later types overwrite earlier ones, so child wins over parent.
        ownership.set(relativePath, type);
      }
    }
    this.copyOverwriteOwnership = ownership;
  }

  /**
   * Read the set of paths a single type's deletions.json will delete,
   * filtered by the type's `keep` list. Returns an empty array when the file
   * is missing or malformed — a bad file cannot block strategy processing;
   * any validation errors are surfaced later by processDeletions itself.
   * @param type - Project type (e.g., "all", "cdk", "typescript")
   * @returns Array of relative paths marked for deletion
   */
  private async readPendingDeletionsForType(
    type: string
  ): Promise<readonly string[]> {
    const deletionsPath = path.join(
      this.config.lisaDir,
      type,
      "deletions.json"
    );
    if (!(await fse.pathExists(deletionsPath))) {
      return [];
    }

    try {
      const content = await readFile(deletionsPath, "utf-8");
      const deletions: DeletionsConfig = JSON.parse(content);
      if (!Array.isArray(deletions.paths)) {
        return [];
      }
      const keepSet = new Set(deletions.keep ?? []);
      return deletions.paths.filter(p => !keepSet.has(p));
    } catch {
      return [];
    }
  }

  /**
   * Process deletions from deletions.json files
   */
  private async processDeletions(): Promise<void> {
    const { logger } = this.deps;

    // Process deletions for "all" and each detected type
    const typesToProcess = ["all", ...this.detectedTypes];

    for (const type of typesToProcess) {
      const deletionsPath = path.join(
        this.config.lisaDir,
        type,
        "deletions.json"
      );

      if (await fse.pathExists(deletionsPath)) {
        logger.info(`Processing deletions for ${type}...`);
        await this.processDeletionsFile(deletionsPath);
      }
    }
  }

  /**
   * Process a single deletions.json file
   * @param deletionsPath - Path to the deletions.json file
   */
  private async processDeletionsFile(deletionsPath: string): Promise<void> {
    const { logger } = this.deps;

    try {
      const content = await readFile(deletionsPath, "utf-8");
      const deletions: DeletionsConfig = JSON.parse(content);

      if (!Array.isArray(deletions.paths)) {
        logger.warn(`Invalid deletions.json format: paths must be an array`);
        return;
      }

      const keepSet = new Set(deletions.keep ?? []);

      for (const relativePath of deletions.paths) {
        if (keepSet.has(relativePath)) {
          logger.info(`Kept (protected): ${relativePath}`);
          continue;
        }
        await this.processSingleDeletion(relativePath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to process deletions file: ${message}`);
    }
  }

  /**
   * Process a single deletion path
   * @param relativePath - Relative path to delete
   */
  private async processSingleDeletion(relativePath: string): Promise<void> {
    const { logger } = this.deps;
    const normalizedRelativePath = path.normalize(relativePath);
    if (
      this.projectLearningsTemplateRegistered &&
      normalizedRelativePath === this.projectLearningsFile
    ) {
      logger.info(`Kept (host-owned project learnings): ${relativePath}`);
      this.counters.skipped++;
      return;
    }
    const targetPath = path.join(this.config.destDir, relativePath);

    const resolvedTarget = path.resolve(targetPath);
    const resolvedDest = path.resolve(this.config.destDir);

    // Explicit guard: disallow deleting the project root itself
    if (resolvedTarget === resolvedDest) {
      logger.warn(
        `Skipping deletion of project root directory: ${relativePath || "."}`
      );
      return;
    }

    // Safety check: only allow paths strictly inside destDir
    if (!resolvedTarget.startsWith(resolvedDest + path.sep)) {
      logger.warn(
        `Skipping deletion outside project directory: ${relativePath}`
      );
      return;
    }

    if (this.ignorePatterns.shouldIgnore(relativePath)) {
      logger.info(`Kept ${this.lisaignoreSuffix}: ${relativePath}`);
      this.counters.ignored++;
      return;
    }

    if (!(await fse.pathExists(targetPath))) {
      return;
    }

    if (this.config.dryRun) {
      logger.dry(`Would delete: ${relativePath}`);
      this.counters.deleted++;
    } else {
      await fse.remove(targetPath);
      logger.success(`Deleted: ${relativePath}`);
      this.counters.deleted++;
    }
  }

  /**
   * Invoke pre-strategy migration hooks so migrations can snapshot project state
   * before strategies overwrite or delete managed files.
   */
  private async runMigrationsBeforeStrategies(): Promise<void> {
    const { logger, migrationRegistry } = this.deps;

    const ctx: MigrationContext = {
      projectDir: this.config.destDir,
      lisaDir: this.config.lisaDir,
      detectedTypes: this.detectedTypes,
      dryRun: this.config.dryRun,
      logger,
    };

    await migrationRegistry.runBeforeStrategies(ctx);
  }

  /**
   * Run all applicable migrations against the destination project
   */
  private async processMigrations(): Promise<void> {
    const { logger, migrationRegistry } = this.deps;

    const ctx: MigrationContext = {
      projectDir: this.config.destDir,
      lisaDir: this.config.lisaDir,
      detectedTypes: this.detectedTypes,
      dryRun: this.config.dryRun,
      logger,
    };

    logger.info("Running migrations...");
    const results = await migrationRegistry.runAll(ctx);
    this.updateMigrationCounters(results);
  }

  /**
   * Update migration counters from aggregated migration results
   * @param results - Migration results to aggregate into counters
   */
  private updateMigrationCounters(results: readonly MigrationResult[]): void {
    for (const result of results) {
      if (result.action === "applied") {
        this.counters.migrationsApplied++;
      } else {
        this.counters.migrationsSkipped++;
      }
    }
  }

  /* v8 ignore start -- calls external CLI, covered by integration tests */
  /**
   * Register plugins from merged settings.json with Claude Code at project scope
   */
  private async registerPlugins(): Promise<void> {
    const { logger } = this.deps;

    if (this.config.dryRun) {
      return;
    }

    const settingsPath = path.join(
      this.config.destDir,
      ".claude",
      "settings.json"
    );

    if (!(await fse.pathExists(settingsPath))) {
      return;
    }

    const settings = await readFile(settingsPath, "utf-8")
      .then(content => JSON.parse(content) as Record<string, unknown>)
      .catch(() => null);

    if (!settings?.enabledPlugins) {
      return;
    }

    const plugins = Object.keys(
      settings.enabledPlugins as Record<string, boolean>
    );

    if (plugins.length === 0) {
      return;
    }

    const { exec: execCb } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(execCb);

    try {
      await execAsync("command -v claude", { shell: "/bin/sh" });
    } catch {
      logger.info("Claude CLI not found, skipping plugin registration");
      return;
    }

    await this.installPluginsAndUpdateMarketplace(execAsync, plugins);
  }

  /**
   * Install each plugin and refresh the Lisa marketplace cache.
   *
   * Version-gated (perf): `claude plugin marketplace update` is a network git
   * pull of the Lisa repo and every `claude plugin install` spawns the Claude
   * CLI (seconds each); re-running all of it on every apply made a single
   * `bun add` cost minutes across the repeated apply passes. A full sync
   * (marketplace refresh + install every plugin) still runs whenever the
   * installed Lisa version differs from the `.claude/.lisa-plugins-synced`
   * marker; between version changes only plugins missing for this project are
   * installed, so the self-heal property (a removed plugin comes back on the
   * next install) survives at the cost of one `claude plugin list` call.
   * @param execAsync - Promisified exec function for running shell commands
   * @param plugins - Plugin identifiers from enabledPlugins (e.g. "lisa@lisa")
   */
  private async installPluginsAndUpdateMarketplace(
    execAsync: PluginExecAsync,
    plugins: readonly string[]
  ): Promise<void> {
    const { logger } = this.deps;
    const validPluginName = /^[\w@./-]+$/;
    const { fullSync, toInstall, version, isLinkedWorktree } =
      await this.computePluginSyncPlan(execAsync, plugins);

    if (!fullSync && toInstall.length === 0) {
      if (isLinkedWorktree) {
        // Record the settled state on the worktree's own marker so repeat
        // applies (and health's root-confined marker probe) do not have to
        // re-derive it from the primary checkout.
        await this.writePluginSyncMarker(version);
      }
      logger.info(
        pc.gray(`Plugins already in sync for Lisa ${version}; skipping`)
      );
      return;
    }

    logger.info("Registering plugins with Claude Code (project scope)...");

    if (fullSync) {
      // Best-effort cache refresh. Individual plugin installs below will still
      // report whether the marketplace entry is available.
      await this.updateLisaMarketplace(execAsync, false);
    }

    for (const plugin of toInstall) {
      if (!validPluginName.test(plugin)) {
        logger.warn(`Skipping invalid plugin name: ${plugin}`);
        continue;
      }
      await this.installPlugin(execAsync, plugin);
    }

    // Post-install refresh must run whenever installs happened: installing can
    // register the marketplace for the first time, and without a refresh newly
    // added skills are not discovered ("Unknown skill" in nightly CI — #320).
    await this.updateLisaMarketplace(execAsync, true);

    if (fullSync) {
      // Always the project's OWN marker (destDir): a full sync run from a
      // linked worktree only reinstalled plugins for the worktree's
      // projectPath, so recording it against the primary checkout would let
      // the primary skip the forced reinstall it still needs after a
      // version bump.
      await this.writePluginSyncMarker(version);
    }
  }

  /**
   * Decide whether this apply needs a full plugin sync and which plugins to
   * install.
   *
   * Linked worktrees inherit the primary checkout's sync state: the marker is
   * gitignored (it records this machine's `~/.claude` plugin state), so a
   * fresh agent worktree is always marker-less and would otherwise pay the
   * full sync — marketplace pulls plus a Claude CLI spawn per plugin — on
   * every ticket. When the primary checkout is already synced for this Lisa
   * version, the worktree has nothing left to do: the marketplace cache is
   * machine-global and per-worktree plugin registration is handled by the
   * coding agent's own startup (Claude Code auto-installs the committed
   * `enabledPlugins` for a new projectPath; Codex uses the project-local
   * `.codex-plugin` pointer instead of Claude project-scope registrations).
   * The #320 defense (refresh marketplace whenever installs happened) holds:
   * the skip path performs no installs.
   * @param execAsync - Promisified exec function for running shell commands
   * @param plugins - Plugin identifiers from enabledPlugins
   * @returns Sync plan: fullSync (version changed), plugins to install, the
   *   current Lisa version, and whether destDir is a linked worktree
   */
  private async computePluginSyncPlan(
    execAsync: PluginExecAsync,
    plugins: readonly string[]
  ): Promise<{
    readonly fullSync: boolean;
    readonly toInstall: readonly string[];
    readonly version: string;
    readonly isLinkedWorktree: boolean;
  }> {
    const version = getPackageVersion();
    const primaryRoot = await resolvePrimaryWorktreeRoot(this.config.destDir);
    const isLinkedWorktree = primaryRoot !== null;
    const readMarker = async (markerPath: string): Promise<string | null> =>
      readFile(markerPath, "utf-8")
        .then(content => content.trim())
        .catch(() => null);
    const ownMarker = await readMarker(this.pluginSyncMarkerPath());
    const syncedVersion =
      ownMarker === version || primaryRoot === null
        ? ownMarker
        : await readMarker(
            path.join(primaryRoot, ".claude", ".lisa-plugins-synced")
          );
    const fullSync = syncedVersion !== version;
    if (isLinkedWorktree && !fullSync) {
      // Skip the `claude plugin list` probe too — registration for this
      // worktree's projectPath is deferred to the coding agent's startup.
      return { fullSync: false, toInstall: [], version, isLinkedWorktree };
    }
    const installed = fullSync
      ? null
      : await this.readInstalledPluginIds(execAsync);
    const toInstall =
      installed === null
        ? plugins
        : plugins.filter(plugin => !installed.has(plugin));
    return { fullSync, toInstall, version, isLinkedWorktree };
  }

  /**
   * Refresh the cached Lisa marketplace via the Claude CLI.
   * @param execAsync - Promisified exec function for running shell commands
   * @param announce - Whether to log the outcome (silent for the pre-install
   *   best-effort refresh)
   * @returns Promise that resolves when the refresh attempt completes
   */
  private async updateLisaMarketplace(
    execAsync: PluginExecAsync,
    announce: boolean
  ): Promise<void> {
    const { logger } = this.deps;
    try {
      await execAsync(
        "claude plugin marketplace update lisa",
        this.pluginExecOptions()
      );
      if (announce) {
        logger.success("Updated marketplace: lisa");
      }
    } catch {
      if (announce) {
        logger.warn("Could not update marketplace: lisa");
      }
    }
  }

  /**
   * Install a single plugin at project scope via the Claude CLI.
   * @param execAsync - Promisified exec function for running shell commands
   * @param plugin - Plugin identifier (already validated)
   * @returns Promise that resolves when the install attempt completes
   */
  private async installPlugin(
    execAsync: PluginExecAsync,
    plugin: string
  ): Promise<void> {
    const { logger } = this.deps;
    try {
      await execAsync(
        `claude plugin install ${plugin} --scope project`,
        this.pluginExecOptions()
      );
      logger.success(`Registered plugin: ${plugin}`);
    } catch {
      logger.warn(`Could not register plugin: ${plugin}`);
    }
  }

  /**
   * Exec options shared by all Claude CLI plugin commands.
   * @returns Options object with the project cwd and POSIX shell
   */
  private pluginExecOptions(): Record<string, unknown> {
    return { cwd: this.config.destDir, shell: "/bin/sh" };
  }

  /**
   * Absolute path of the plugin sync marker recording the last fully-synced
   * Lisa version for this project. Shared with install-claude-plugins.sh.
   * @returns Marker path under the project's .claude directory
   */
  private pluginSyncMarkerPath(): string {
    return path.join(this.config.destDir, ".claude", ".lisa-plugins-synced");
  }

  /**
   * Absolute path of the host project's package.json.
   * @returns package.json path under the destination directory
   */
  private hostPackageJsonPath(): string {
    return path.join(this.config.destDir, "package.json");
  }

  /**
   * Read the plugin ids already installed for this project via
   * `claude plugin list --json`.
   * @param execAsync - Promisified exec function for running shell commands
   * @returns Set of installed plugin ids, or null when the list cannot be
   *   obtained (older CLI, parse failure) so callers fall back to installing
   *   everything — the pre-existing behavior
   */
  private async readInstalledPluginIds(
    execAsync: PluginExecAsync
  ): Promise<ReadonlySet<string> | null> {
    try {
      const result = (await execAsync("claude plugin list --json", {
        cwd: this.config.destDir,
        shell: "/bin/sh",
      })) as { stdout?: unknown };
      const parsed: unknown = JSON.parse(String(result.stdout ?? ""));
      if (!Array.isArray(parsed)) {
        return null;
      }
      const destPath = path.resolve(this.config.destDir);
      const ids = parsed
        .filter(
          (entry): entry is { id: string; projectPath: string } =>
            typeof (entry as { id?: unknown }).id === "string" &&
            (entry as { projectPath?: unknown }).projectPath === destPath
        )
        .map(entry => entry.id);
      return new Set(ids);
    } catch {
      return null;
    }
  }

  /**
   * Record the Lisa version whose plugin set was last fully synced.
   * @param version - Lisa package version to record
   * @returns Promise that resolves when the marker is written (best-effort)
   */
  private async writePluginSyncMarker(version: string): Promise<void> {
    try {
      await fse.ensureDir(path.join(this.config.destDir, ".claude"));
      await fse.writeFile(this.pluginSyncMarkerPath(), `${version}\n`, "utf-8");
    } catch {
      // Best-effort: a missing marker only costs a redundant full sync next run.
    }
  }
  /* v8 ignore stop */

  /**
   * Finalize operation
   * @returns Promise that resolves when finalization is complete
   */
  private async finalize(): Promise<void> {
    const { backupService } = this.deps;

    if (!this.config.dryRun) {
      await backupService.cleanup();
    }
  }

  /**
   * Create success result
   * @returns Success result with operation counters and detected types
   */
  private getSuccessResult(): LisaResult {
    const mode = this.config.validateOnly ? "validate" : "apply";
    return {
      success: true,
      counters: { ...this.counters },
      detectedTypes: [...this.detectedTypes],
      mode,
      errors: [],
    };
  }

  /**
   * Handle apply error and rollback
   * @param error Error that occurred during apply
   * @returns Error result
   */
  private async handleApplyError(error: unknown): Promise<LisaResult> {
    const { backupService } = this.deps;
    if (!this.config.dryRun) {
      try {
        await backupService.rollback();
      } catch {
        // Rollback error already logged
      }
    }

    const mode = this.config.validateOnly ? "validate" : "apply";
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      counters: { ...this.counters },
      detectedTypes: [...this.detectedTypes],
      mode,
      errors: [message],
    };
  }

  /**
   * Apply Lisa configurations to the destination project
   * @returns Result of the apply operation
   */
  async apply(): Promise<LisaResult> {
    try {
      await this.validateDestination();
      await this.validateGitState();
      this.printHeader();
      await this.initServices();
      await this.detectTypes();
      await this.detectSelfApply();
      await this.loadProjectLearningsFile();
      await this.processLearningsRelocation();
      await this.loadPendingDeletions();
      await this.loadCreateOnlyOwnership();
      await this.loadCopyOverwriteOwnership();
      // Captured BEFORE any mutation (migrations included): the hash gates both
      // the detached trampoline and the in-process lockfile reconcile, and
      // before-strategies migrations can wire scripts.postinstall — a change the
      // package manager's end-of-command rewrite would clobber (#383).
      const prePackageJsonHash = hashFile(this.hostPackageJsonPath());
      await this.runMigrationsBeforeStrategies();
      await this.processConfigurations();
      if (this.selfApply) {
        this.deps.logger.info(
          pc.gray(
            "Self-apply (Lisa source repo): skipped deletions.json processing"
          )
        );
      } else {
        await this.processDeletions();
      }
      await this.processMigrations();
      await this.processCodexEmit();
      await this.processClaudeEmit();
      await this.processAgyEmit();
      await this.processCopilotEmit();
      await this.processOpencodeEmit();
      await this.processInstructionFilesMigration();
      await this.registerPlugins();
      await this.finalize();
      this.printSummary();
      await this.printMigrationNotices(this.config.destDir);
      await this.schedulePostinstallReconciliation(prePackageJsonHash);
      await this.reconcileLockfilesInProcess(prePackageJsonHash);
      return this.getSuccessResult();
    } catch (error) {
      return this.handleApplyError(error);
    }
  }

  /**
   * Sync lockfiles to package.json in-process when the postinstall trampoline
   * will not run.
   *
   * The trampoline only fires when Lisa is invoked as a package-manager
   * lifecycle script (postinstall, prepare, etc.). When users invoke Lisa
   * manually after `npm install -D @codyswann/lisa@latest` — the recommended
   * flow on plain-npm projects, where Lisa's postinstall is not auto-run —
   * the trampoline never schedules and any package.json changes Lisa just
   * made (e.g., adding `oxlint-tsgolint` via package.lisa.json merge) leave
   * package-lock.json out of sync. The next `npm ci` in CI then fails with
   * "lockfile out of sync".
   *
   * This method closes that gap by running the same lockfile-regeneration
   * commands the trampoline child would have run, but synchronously in the
   * current process. We skip when the trampoline IS scheduled (it will
   * regenerate on its own after the parent PM exits) and when running as the
   * trampoline child itself (the trampoline has its own regen step at the end).
   * @param prePackageJsonHash - Hash of package.json captured before apply ran (null if file did not exist)
   */
  private async reconcileLockfilesInProcess(
    prePackageJsonHash: string | null
  ): Promise<void> {
    if (this.config.dryRun) return;
    if (isRunningAsTrampoline()) return;
    if (shouldSchedulePostinstallReconciliation(this.config.dryRun)) return;
    const pkgPath = this.hostPackageJsonPath();
    const postHash = hashFile(pkgPath);
    if (
      prePackageJsonHash === null ||
      postHash === null ||
      prePackageJsonHash === postHash
    ) {
      return;
    }
    this.deps.logger.info(
      pc.cyan("Syncing lockfiles to match updated package.json...")
    );
    await regenerateLockfilesInProcess(this.config.destDir);
  }

  /**
   * Emit Codex-targeted artifacts (agents, hooks, settings) when the host
   * project's harness includes Codex (`codex` or `fleet`). No-op for `claude`
   * (default).
   *
   * Lisa writes the complete Codex surface and a filtered repository
   * marketplace into the host. No user-wide plugin activation participates.
   * Ownership is tracked via `.codex/.lisa-managed.json` so updates remove
   * stale stack artifacts without touching host customizations.
   */
  private async processCodexEmit(): Promise<void> {
    const { harness } = this.config;
    if (!harnessIncludesAgent(harness, "codex")) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("Codex emit: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("Codex emit: skipped (dry-run mode)"));
      return;
    }

    const result = await installCodexProjectOverlay(
      this.config.lisaDir,
      this.config.destDir,
      this.detectedTypes
    );
    const totalStale =
      result.staleAgentCount +
      result.staleHookRuleCount +
      result.staleSkillCount;
    this.deps.logger.info(
      pc.cyan(
        `Codex emit: ${result.agentCount} agents, plugin-bundled hooks, ${result.modelVisibleSkillCount} native skills from ${result.marketplacePluginCount} project plugins, ${result.mcpServerCount} MCP servers, settings ${result.settingsCreated ? "created" : "merged"}${
          totalStale > 0
            ? ` (${result.staleAgentCount} stale agents, ${result.staleHookRuleCount} stale hook/rule files, ${result.staleSkillCount} stale skills removed)`
            : ""
        }`
      )
    );
  }

  /**
   * Emit Claude-Code-targeted artifacts when the harness includes Claude.
   *
   * Claude's primary distribution is the GitHub marketplace; the per-project
   * artifacts Lisa writes are the canonical `AGENTS.md` and a thin `CLAUDE.md`
   * that `@AGENTS.md`-imports it (Claude Code doesn't read AGENTS.md natively).
   * Both are create-only and host-owned from creation onward. Skipped in dry-run
   * mode and on harness modes that don't include Claude.
   */
  private async processClaudeEmit(): Promise<void> {
    const { harness } = this.config;
    if (!harnessIncludesAgent(harness, "claude")) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("Claude emit: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("Claude emit: skipped (dry-run mode)"));
      return;
    }
    // Ensure the canonical AGENTS.md exists first — it is the import target of
    // the CLAUDE.md pointer.
    const agentsResult = await installAgentsMd(this.config.destDir);
    const result = await installClaudeMd(this.config.destDir);
    this.deps.logger.info(
      pc.cyan(
        `Claude emit: AGENTS.md ${agentsResult.created ? "created" : HOST_OWNED_LABEL}, CLAUDE.md ${result.created ? "created (pointer → AGENTS.md)" : HOST_OWNED_LABEL}`
      )
    );
  }

  /**
   * Emit Antigravity-targeted artifacts when the harness includes agy.
   *
   * Runtime probes of agy 1.0.3 (ticket-1054) established how agy consumes each
   * surface, so each is delivered the way agy actually reads it:
   *   1. `agy plugin install` Lisa's variant from `plugins/lisa-agy/` (when agy
   *      is on PATH). This installs the variant into
   *      `~/.gemini/config/plugins/<variant>/`.
   *   2. Hooks → PLUGIN-BUNDLED. agy loads a plugin's hooks from a `hooks.json`
   *      at the installed plugin ROOT, so the hooks config + agy-protocol script
   *      are emitted into the variant at BUILD time by
   *      generate-agy-plugin-artifacts.mjs and ride along with the plugin
   *      install above — nothing is written here. Only `block-no-verify`
   *      (PreToolUse) maps; SessionStart hooks aren't supported by agy.
   *   3. MCP → USER-GLOBAL. agy ignores plugin-bundled MCP and only auto-loads
   *      `~/.gemini/config/mcp_config.json`, so `installAgyMcpConfig` writes
   *      there (servers collected from the built plugin `.mcp.json` files via
   *      `collectLisaMcpServers`, translated to agy's `serverUrl` shape,
   *      tagged-merge preserving host entries). Cross-project caveat: the most
   *      recent `lisa apply` carrying MCP wins globally.
   *   4. Instruction file → the canonical create-only `AGENTS.md` (the same file
   *      every other agent reads), plus a bounded project-learnings bridge
   *      reconciled by `processInstructionFilesMigration`. Lisa does not bake
   *      eager rule bodies into AGENTS.md: a giant generated file is not worth
   *      carrying just to polyfill agy's headless (`-p`) mode, where SessionStart
   *      hooks don't fire. In interactive mode it still receives Lisa's plugin
   *      (skills/agents/MCP) above.
   */
  private async processAgyEmit(): Promise<void> {
    const { harness } = this.config;
    if (!harnessIncludesAgent(harness, "agy")) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("agy emit: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("agy emit: skipped (dry-run mode)"));
      return;
    }

    const pluginRoot = path.join(this.config.lisaDir, "plugins");
    // Install the base variant plus the matching variant for each detected
    // stack so agy reaches parity with Claude/Codex on stack-specific plugins.
    const variantNames = [
      "lisa-agy",
      ...this.perAgentStackVariants(pluginRoot, "agy"),
    ];
    const pluginResults = [];
    for (const variant of variantNames) {
      pluginResults.push(await installAgyPlugin(pluginRoot, variant));
    }

    // MCP: agy ignores plugin-bundled MCP AND only auto-loads the USER-GLOBAL
    // config (~/.gemini/config/mcp_config.json) — the project-scope
    // `.agents/mcp_config.json` is never read by the agy CLI (verified-by-run,
    // ticket-1054). So collect Lisa's servers from the built plugin .mcp.json
    // files (base + detected stacks) and install them into the user-scope
    // aggregate (translated to agy's serverUrl shape, tagged-merge preserving
    // host entries). Caveat: this is shared across projects — the most recent
    // `lisa apply` carrying MCP servers wins globally; host-authored entries are
    // preserved by the _lisaManaged tagged-merge. Skip when no stack ships MCP.
    const lisaMcpServers = collectLisaMcpServers(
      pluginRoot,
      this.detectedTypes
    );
    // Always call installAgyMcpConfig — even when lisaMcpServers is empty —
    // so the tagged-merge logic strips any previously-written _lisaManaged
    // entries. Skipping on empty would leave stale managed entries behind
    // from a previous `lisa apply` for a project that had MCP servers.
    const mcpResult = await installAgyMcpConfig(
      lisaMcpServers,
      resolveAgyMcpConfigPath({ scope: "user" })
    );
    const mcpServerCount = mcpResult.lisaEntryCount;

    // Hooks: delivered as a plugin-bundled root hooks.json inside the installed
    // agy variant (emitted at build time by generate-agy-plugin-artifacts.mjs,
    // installed via `agy plugin install` above) — NOT written here at apply time.

    // Instruction file: the canonical, create-only AGENTS.md. The bounded
    // project-learnings bridge is reconciled after all emit paths run.
    const agentsMdResult = await installAgentsMd(this.config.destDir);

    const attempted = pluginResults.some(r => r.attempted);
    const installedCount = pluginResults.filter(r => r.installed).length;
    const pluginMessage = attempted
      ? `${installedCount}/${variantNames.length} variants installed`
      : "skipped (agy not on PATH)";
    // Only mention MCP when servers were actually written.
    const mcpMessage =
      mcpServerCount > 0
        ? `, ${mcpServerCount} MCP server(s) → ~/.gemini/config/mcp_config.json`
        : "";

    this.deps.logger.info(
      pc.cyan(
        `agy emit: ${pluginMessage}, AGENTS.md ${
          agentsMdResult.created ? "created" : HOST_OWNED_LABEL
        }${mcpMessage}`
      )
    );
  }

  /**
   * Per-agent stack variant directory names for the detected project types
   * that have a built variant. Filters by on-disk existence so a detected type
   * without a stack plugin (e.g. `npm-package`) is naturally skipped.
   * @param pluginRoot - Absolute path to the `plugins/` directory.
   * @param agent - Per-agent variant suffix (`agy` | `copilot` | `cursor`).
   * @returns Variant directory names like `lisa-typescript-agy`.
   */
  private perAgentStackVariants(pluginRoot: string, agent: string): string[] {
    return this.detectedTypes
      .map(type => `lisa-${type}-${agent}`)
      .filter(name => existsSync(path.join(pluginRoot, name)));
  }

  /**
   * Emit GitHub-Copilot-targeted artifacts when the harness includes copilot.
   *
   * Three per-project actions:
   *   1. `copilot plugin install lisa@CodySwannGT/lisa` (with local-path
   *      fallback when the marketplace path fails — currently does, pending
   *      the marketplace.json pluginRoot fix gated on Wave 2 spec step 8).
   *   2. Ensure the canonical `AGENTS.md` exists (Copilot reads it natively).
   *   3. Create-only write of `.github/copilot-instructions.md`.
   */
  private async processCopilotEmit(): Promise<void> {
    const { harness } = this.config;
    if (!harnessIncludesAgent(harness, "copilot")) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("Copilot emit: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("Copilot emit: skipped (dry-run mode)"));
      return;
    }

    const pluginRoot = path.join(this.config.lisaDir, "plugins");
    // Base variant plus the matching variant for each detected stack.
    const variantNames = [
      "lisa-copilot",
      ...this.perAgentStackVariants(pluginRoot, "copilot"),
    ];
    const pluginResults = [];
    for (const variant of variantNames) {
      pluginResults.push(await installCopilotPlugin(pluginRoot, variant));
    }
    // Copilot reads AGENTS.md natively at session start, so ensure the
    // canonical file exists; copilot-instructions.md stays a thin host-owned
    // file that points at it.
    const copilotAgentsResult = await installAgentsMd(this.config.destDir);
    const instructionsResult = await installCopilotInstructions(
      this.config.destDir
    );

    const attempted = pluginResults.some(r => r.attempted);
    const installedCount = pluginResults.filter(r => r.installed).length;
    const via = pluginResults.find(r => r.installed)?.via ?? "local";
    const pluginMessage = attempted
      ? `${installedCount}/${variantNames.length} variants installed via ${via}`
      : "skipped (copilot not on PATH)";

    this.deps.logger.info(
      pc.cyan(
        `Copilot emit: ${pluginMessage}, AGENTS.md ${
          copilotAgentsResult.created ? "created" : HOST_OWNED_LABEL
        }, copilot-instructions ${
          instructionsResult.created ? "created" : HOST_OWNED_LABEL
        }`
      )
    );
  }

  /**
   * Emit OpenCode-targeted artifacts when the harness includes OpenCode.
   *
   * OpenCode reads the open Agent Skills format, native agents
   * (`.opencode/agents/`), native commands (`.opencode/commands/`), and
   * `AGENTS.md` natively (opencode.ai/docs/skills, /docs/agents, /docs/commands,
   * /docs/rules), so Lisa needs no transformed plugin variant. It writes:
   *   - skills (bundled + command-derived) into `.opencode/skills/lisa/`,
   *   - agents (Markdown, `lisa-` prefixed) into `.opencode/agents/`,
   *   - commands (Markdown, `lisa-` prefixed) into `.opencode/commands/`,
   * and ensures the canonical `AGENTS.md` exists. Ownership of skills/agents/
   * commands is tracked via `.opencode/.lisa-managed.json` so updates clean up
   * stale artifacts without touching host customizations. Skipped in dry-run
   * mode and on harness modes that don't include OpenCode.
   */
  private async processOpencodeEmit(): Promise<void> {
    const { harness } = this.config;
    if (!harnessIncludesAgent(harness, "opencode")) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      this.deps.logger.info(
        pc.gray("OpenCode emit: skipped during postinstall-safe apply")
      );
      return;
    }
    if (this.config.dryRun) {
      this.deps.logger.info(pc.gray("OpenCode emit: skipped (dry-run mode)"));
      return;
    }

    const previous = await readOpencodeManifest(this.config.destDir);
    const skillsResult = await installOpencodeSkills(
      this.config.lisaDir,
      this.config.destDir,
      previous.files
    );
    // Hooks: block-no-verify maps to opencode.json `permission.bash`; the
    // runtime-behavior hooks ship as `.opencode/plugin/lisa-*.ts` modules.
    const hooksResult = await installOpencodeHooks(
      this.config.lisaDir,
      this.config.destDir,
      this.detectedTypes,
      previous.files
    );
    // OpenCode reads agents (`.opencode/agents/`) and commands
    // (`.opencode/commands/`) natively. Emit both from Lisa's plugin sources.
    // Each installer scopes its own stale cleanup to its `lisa-` namespace, so
    // passing the full previous manifest to all installers is safe.
    const opencodeAgentsResult = await installOpencodeAgents(
      this.config.lisaDir,
      this.config.destDir,
      previous.files
    );
    const commandsResult = await installOpencodeCommands(
      this.config.lisaDir,
      this.config.destDir,
      previous.files
    );
    // OpenCode reads AGENTS.md natively; ensure the canonical file exists. It is
    // create-only and host-owned afterward, so it's not tracked in the manifest.
    const agentsMdResult = await installAgentsMd(this.config.destDir);
    await writeOpencodeManifest(this.config.destDir, [
      ...skillsResult.managedFiles,
      ...hooksResult.managedFiles,
      ...opencodeAgentsResult.managedFiles,
      ...commandsResult.managedFiles,
    ]);

    // Config-level delivery (host-preserving merges into the project
    // `opencode.json`, NOT tracked in the manifest — deleting a merged host file
    // would be data loss). The hooks installer above already merged the
    // `permission.bash` deny rules; settings + MCP merge their own keys and
    // preserve everything else, so the three writers compose into one file.
    //   1. Settings: force `share: "disabled"` so applying the fleet config can
    //      never publish a host's sessions via OpenCode's default-on, public
    //      share URLs. Other host keys are preserved.
    //   2. MCP wrap: OpenCode ignores plugin-bundled MCP, so collect Lisa's
    //      servers from the built plugin `.mcp.json` files (base + detected
    //      stacks) and write them into the `mcp` key, translated to OpenCode's
    //      `type:"local"|"remote"` shape. Called unconditionally so stale
    //      `_lisaManaged` entries are stripped when a project drops MCP.
    await installOpencodeSettings(this.config.destDir);
    const pluginRoot = path.join(this.config.lisaDir, "plugins");
    const lisaMcpServers = collectLisaMcpServers(
      pluginRoot,
      this.detectedTypes
    );
    const mcpResult = await installOpencodeMcpConfig(
      lisaMcpServers,
      resolveOpencodeConfigPath(this.config.destDir)
    );
    const mcpMessage =
      mcpResult.lisaEntryCount > 0
        ? `, ${mcpResult.lisaEntryCount} MCP server(s)`
        : "";
    const staleCount =
      skillsResult.deleted.length +
      hooksResult.deleted.length +
      opencodeAgentsResult.deleted.length +
      commandsResult.deleted.length;

    // The hooks installer is the first writer, so its `configCreated` flag
    // reflects whether `opencode.json` existed before this emit.
    this.deps.logger.info(
      pc.cyan(
        `OpenCode emit: ${skillsResult.installed.length} skills, ${hooksResult.pluginCount} plugin hooks, ${opencodeAgentsResult.installed.length} agents, ${commandsResult.installed.length} commands${
          staleCount > 0 ? ` (${staleCount} stale removed)` : ""
        }, AGENTS.md ${
          agentsMdResult.created ? "created" : HOST_OWNED_LABEL
        }, opencode.json ${
          hooksResult.configCreated ? "created" : "merged"
        }${mcpMessage}`
      )
    );
  }

  /**
   * Relocate a legacy `.claude/rules/PROJECT_LEARNINGS.md` ledger to the new
   * cold `.lisa/PROJECT_LEARNINGS.md` BEFORE the create-only strategy would
   * seed an empty ledger at the new path — otherwise both would exist and the
   * real entries would be stranded at the legacy location.
   *
   * Runs even on the postinstall/bootstrap skip path: that guard exists to
   * suppress agent-surface EMISSIONS, but moving machine-managed state under
   * `.lisa/` is not an agent emission and is safe headless. Skipping it there
   * was the exact defect that stranded populated legacy ledgers on the fleet
   * upgrade path (create-only still seeds an empty `.lisa/` ledger, so every
   * later run then hits the both-exist no-clobber warning). Only dry-run is
   * exempt. Idempotent; logs one line on a move and one warning when both exist.
   */
  private async processLearningsRelocation(): Promise<void> {
    if (this.config.dryRun) {
      return;
    }
    const result = await relocateProjectLearningsLedger(this.config.destDir);
    if (result.action !== undefined) {
      this.deps.logger.info(pc.cyan(`Learnings ledger: ${result.action}`));
    }
    if (result.warning !== undefined) {
      this.deps.logger.warn(`Learnings ledger: ${result.warning}`);
    }
  }

  /**
   * Reconcile the project's agent instruction files onto Lisa's canonical
   * pattern after the per-harness emits run.
   *
   * The per-agent emits write `AGENTS.md` / `CLAUDE.md` create-only, so they
   * can't repair files that already exist from older Lisa versions. This step
   * runs the same non-destructive migration `lisa doctor` uses — stripping the
   * legacy agy baked-rules block from an existing `AGENTS.md` and adding the
   * `@AGENTS.md` import to an existing `CLAUDE.md`. Without it, updating an
   * existing project would create a canonical `AGENTS.md` that its stale
   * `CLAUDE.md` never imports.
   *
   * Harness-aware: a `CLAUDE.md` pointer is only *created* when the harness
   * includes Claude, so a codex/cursor/copilot/agy-only project never gets a
   * stray `CLAUDE.md`. An existing host-authored `CLAUDE.md` still gets the
   * import regardless. Skipped in dry-run mode.
   */
  private async processInstructionFilesMigration(): Promise<void> {
    if (this.config.dryRun) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      return;
    }
    const result = await migrateInstructionFiles(this.config.destDir, {
      createClaudePointer: harnessIncludesAgent(this.config.harness, "claude"),
      // apply already relocated the ledger in processLearningsRelocation (an
      // earlier phase); skip it here so a both-exist conflict warns only once.
      relocateLearnings: false,
    });
    if (result.changed) {
      this.deps.logger.info(
        pc.cyan(`Instruction files: ${result.actions.join("; ")}`)
      );
    }
  }

  /**
   * Schedule a reconciliation re-run when Lisa is invoked as a package-manager
   * lifecycle script. Works around the fact that `bun add` (and similar
   * package-manager mutations) cache package.json in memory at the start of
   * the command and rewrite it at the end, clobbering any changes made by
   * postinstall scripts.
   *
   * The trampoline is always fully detached so the package manager can exit
   * normally; the child then detects the exit and re-runs Lisa. See
   * utils/postinstall-trampoline.ts for details.
   *
   * Skipped when this apply did not mutate package.json: the trampoline exists
   * solely to redo package.json changes that the parent package manager's
   * end-of-command rewrite clobbers (#383). With no mutation there is nothing
   * to clobber — the rewrite restores identical content — and scheduling a
   * detached re-apply (plus its lockfile regen) is pure waste. File-based
   * template writes are not clobbered and need no reconciliation.
   * @param prePackageJsonHash - Hash of package.json captured before apply mutated anything (null if the file did not exist)
   * @returns Promise that resolves immediately after the detached child is spawned
   */
  private async schedulePostinstallReconciliation(
    prePackageJsonHash: string | null
  ): Promise<void> {
    const postHash = hashFile(this.hostPackageJsonPath());
    if (prePackageJsonHash === postHash) {
      this.deps.logger.info(
        pc.gray(
          "Postinstall reconciliation skipped: package.json unchanged by this apply"
        )
      );
      return;
    }
    if (!shouldSchedulePostinstallReconciliation(this.config.dryRun)) {
      return;
    }
    try {
      const lisaDistDir = getLisaDistDir(import.meta.url);
      await scheduleReconciliationChild(
        this.config.destDir,
        lisaDistDir,
        process.ppid
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger.warn(
        `Could not schedule postinstall reconciliation: ${message}`
      );
    }
  }

  /**
   * Validate compatibility without applying changes
   * @returns Result of the validate operation
   */
  async validate(): Promise<LisaResult> {
    // Validate mode is essentially a dry run
    return this.apply();
  }

  /**
   * Process all files for a given project type
   * @param type Project type to process
   */
  private async processProjectType(type: string): Promise<void> {
    const { logger, strategyRegistry } = this.deps;

    for (const strategy of COPY_STRATEGIES) {
      // Self-apply (Lisa source repo) applies ONLY dependency governance via the
      // package-lisa strategy — every other strategy would overwrite Lisa's own
      // hand-authored source with the templates it ships.
      if (this.selfApply && strategy !== "package-lisa") {
        continue;
      }
      const srcDir = path.join(this.config.lisaDir, type, strategy);

      if (await fse.pathExists(srcDir)) {
        logger.info(`Processing ${type}/${strategy}...`);
        await this.processDirectory(
          srcDir,
          strategyRegistry.get(strategy),
          type
        );
      }
    }
  }

  /**
   * Process all files in a directory with the given strategy
   * @param srcDir Source directory
   * @param strategy Strategy to apply
   * @param strategy.name Strategy name
   * @param strategy.apply Apply function
   * @param currentType Project type (e.g. "all", "typescript", "cdk") supplying these files
   */
  private async processDirectory(
    srcDir: string,
    strategy: {
      name: CopyStrategy;
      apply: (
        s: string,
        d: string,
        r: string,
        c: StrategyContext
      ) => Promise<FileOperationResult>;
    },
    currentType: string
  ): Promise<void> {
    const allFiles = await listFilesRecursive(srcDir);
    const files = allFiles
      .map(srcFile => {
        const sourceRelativePath = path.relative(srcDir, srcFile);
        return {
          srcFile,
          relativePath: this.resolveTemplateDestination(
            sourceRelativePath,
            strategy.name,
            currentType
          ),
        };
      })
      .filter(({ relativePath }) =>
        this.shouldProcessFile(relativePath, strategy.name, currentType)
      );

    const context: StrategyContext = {
      config: this.config,
      backupFile: async absolutePath => {
        await this.deps.backupService.backup(absolutePath);
        await this.deps.backupService.persistentBackup(absolutePath);
      },
      promptOverwrite: async (relativePath, sourcePath, destPath) => {
        return this.handleOverwritePrompt(relativePath, sourcePath, destPath);
      },
    };

    for (const { srcFile, relativePath } of files) {
      const destFile = path.join(this.config.destDir, relativePath);

      const result = await strategy.apply(
        srcFile,
        destFile,
        relativePath,
        context
      );
      this.updateCounters(result);
      this.logResult(result);
    }
  }

  /**
   * Map the stable canonical learnings source to the project's configured
   * sibling path. No other template source is redirected.
   * @param sourceRelativePath - Path relative to the strategy source directory
   * @param strategyName - Strategy delivering the source file
   * @param currentType - Project type that owns the source directory
   * @returns Destination path relative to the host project
   */
  private resolveTemplateDestination(
    sourceRelativePath: string,
    strategyName: CopyStrategy,
    currentType: string
  ): string {
    if (
      currentType === "all" &&
      strategyName === CREATE_ONLY_STRATEGY &&
      sourceRelativePath === PROJECT_LEARNINGS_TEMPLATE_PATH
    ) {
      return this.projectLearningsFile;
    }
    return sourceRelativePath;
  }

  /**
   * Decide whether a candidate source file should be passed to its strategy.
   * Centralizes three independent skip rules that all need to short-circuit
   * before a strategy ever sees the file:
   *
   * 1. `.lisaignore` patterns from the destination project
   * 2. Pending deletions from any detected type's `deletions.json`
   *    (avoids the create-then-delete ENOENT race)
   * 3. Create-only ownership conflicts (parent stack ships a path that a
   *    child stack also ships under create-only — child wins)
   * 4. Cross-strategy ownership conflicts (a child stack ships a create-only
   *    path that a parent stack ships under copy-overwrite — child wins before
   *    the parent can overwrite a host-owned or soon-to-be-created child file)
   * 5. Copy-overwrite ownership conflicts (parent and child both ship a path
   *    under copy-overwrite — only the most-specific stack writes it, so there
   *    is no parent-then-child overwrite window; see copyOverwriteOwnership)
   * @param relativePath - Path relative to the strategy's source directory
   * @param strategyName - Name of the strategy that would apply the file
   * @param currentType - Project type currently being processed
   * @returns True if the strategy should apply the file, false to skip
   */
  private shouldProcessFile(
    relativePath: string,
    strategyName: CopyStrategy,
    currentType: string
  ): boolean {
    const decision = decideTemplateOwnership({
      relativePath,
      strategy: strategyName,
      currentType,
      orderedTypes: ["all", ...this.detectedTypes],
      ignored: this.ignorePatterns.shouldIgnore(relativePath),
      pendingDeletion: this.pendingDeletions.has(relativePath),
      projectLearningsPath: this.projectLearningsTemplateRegistered
        ? this.projectLearningsFile
        : undefined,
      suppressLearningsSeed: this.suppressLearningsSeedForRelocation,
      createOnlyOwner: this.createOnlyOwnership.get(relativePath),
      copyOverwriteOwner: this.copyOverwriteOwnership.get(relativePath),
    });
    if (decision.process) return true;
    if (decision.reason === "ignored") {
      this.counters.ignored++;
      this.logSkip("ignored", relativePath, "Ignored");
      return false;
    }
    this.counters.skipped++;
    const reason = templateSkipDescription(decision);
    this.logSkip(reason, relativePath, `Skipped (${reason})`);
    return false;
  }

  /**
   * Emit a "would skip"/"skipped" log line in a single place so all the skip
   * branches in `shouldProcessFile` stay symmetric.
   * @param dryReason - Reason text for dry-run mode
   * @param relativePath - Path being skipped
   * @param applyMessage - Message to log when not in dry-run mode
   */
  private logSkip(
    dryReason: string,
    relativePath: string,
    applyMessage: string
  ): void {
    const { logger } = this.deps;
    if (this.config.dryRun) {
      logger.dry(`Would skip (${dryReason}): ${relativePath}`);
    } else {
      logger.info(`${applyMessage}: ${relativePath}`);
    }
  }

  /**
   * Handle overwrite prompt for conflicting files
   * @param relativePath Relative path of the file
   * @param sourcePath Source file path
   * @param destPath Destination file path
   * @returns True if user approves overwrite
   */
  private async handleOverwritePrompt(
    relativePath: string,
    sourcePath: string,
    destPath: string
  ): Promise<boolean> {
    const { logger, prompter } = this.deps;

    const decision = await prompter.promptOverwrite(relativePath);

    if (decision === "diff") {
      // Show diff and re-prompt
      await this.showDiff(sourcePath, destPath);
      return this.handleOverwritePrompt(relativePath, sourcePath, destPath);
    }

    if (decision === "yes") {
      logger.info(
        `Auto-accepting overwrite (non-interactive): ${relativePath}`
      );
      return true;
    }

    return false;
  }

  /**
   * Show diff between two files
   * @param sourcePath Source file path
   * @param destPath Destination file path
   */
  private async showDiff(sourcePath: string, destPath: string): Promise<void> {
    const { spawn } = await import("node:child_process");

    return new Promise(resolve => {
      console.log("--- Differences ---");
      const diff = spawn("diff", [destPath, sourcePath], { stdio: "inherit" });
      diff.on("close", () => {
        console.log("-------------------");
        resolve();
      });
    });
  }

  /**
   * Update counters based on operation result
   * @param result Operation result to count
   */
  private updateCounters(result: FileOperationResult): void {
    switch (result.action) {
      case "copied":
      case "created":
        this.counters.copied++;
        break;
      case "skipped":
        this.counters.skipped++;
        break;
      case "overwritten":
        this.counters.overwritten++;
        break;
      case "appended":
        this.counters.appended++;
        break;
      case "merged":
        this.counters.merged++;
        break;
    }
  }

  /**
   * Log a message using appropriate logger method
   * @param dryMsg Message for dry run mode
   * @param successMsg Message for success mode
   */
  private logMessage(dryMsg: string, successMsg: string): void {
    const { logger } = this.deps;
    this.config.dryRun ? logger.dry(dryMsg) : logger.success(successMsg);
  }

  /**
   * Log operation result
   * @param result Result to log
   */
  private logResult(result: FileOperationResult): void {
    switch (result.action) {
      case "copied":
        this.logMessage(
          `Would copy: ${result.relativePath}`,
          `Copied: ${result.relativePath}`
        );
        break;
      case "created":
        this.logMessage(
          `Would create: ${result.relativePath}`,
          `Created: ${result.relativePath}`
        );
        break;
      case "skipped":
        // Silent for skipped files
        break;
      case "overwritten":
        this.logMessage(
          `Would prompt to overwrite: ${result.relativePath}`,
          `Overwritten: ${result.relativePath}`
        );
        break;
      case "appended": {
        const msg = `Appended ${result.linesAdded} lines to: ${result.relativePath}`;
        this.logMessage(`Would ${msg}`, msg);
        break;
      }
      case "merged":
        this.logMessage(
          `Would merge: ${result.relativePath}`,
          `Merged: ${result.relativePath}`
        );
        break;
    }
  }

  /**
   * Validate destination directory exists and is a directory
   */
  private async validateDestination(): Promise<void> {
    const { destDir } = this.config;

    if (!(await fse.pathExists(destDir))) {
      throw new DestinationNotFoundError(destDir);
    }

    const stats = await stat(destDir);
    if (!stats.isDirectory()) {
      throw new DestinationNotDirectoryError(destDir);
    }
  }

  /**
   * Check for uncommitted git changes and prompt user if dirty
   */
  private async validateGitState(): Promise<void> {
    const { gitService, prompter, logger } = this.deps;
    const { destDir } = this.config;

    // Skip git check if not a git repository
    if (!(await gitService.isRepository(destDir))) {
      return;
    }

    // Skip git check when requested (e.g. during postinstall where lockfile is always dirty)
    if (this.config.skipGitCheck) {
      return;
    }

    // Check for uncommitted changes
    if (!(await gitService.isDirty(destDir))) {
      return;
    }

    const status = await gitService.getStatus(destDir);
    logger.warn("Git working directory has uncommitted changes");

    // Always prompt for dirty git, even in yesMode
    const proceed = await prompter.confirmDirtyGit(status);
    if (!proceed) {
      throw new UserAbortedError(
        "Aborted: please commit or stash your changes before running Lisa"
      );
    }
  }

  /**
   * Print header banner
   */
  private printHeader(): void {
    const { logger } = this.deps;

    console.log("");
    console.log(pc.blue(this.separator));

    if (this.config.validateOnly) {
      console.log(pc.blue("    Lisa Project Bootstrapper (VALIDATE)"));
    } else if (this.config.dryRun) {
      console.log(pc.blue("    Lisa Project Bootstrapper (DRY RUN)"));
    } else {
      console.log(pc.blue("    Lisa Project Bootstrapper"));
    }

    console.log(pc.blue(this.separator));
    console.log("");

    if (this.config.validateOnly) {
      logger.info("Validate mode - checking project compatibility");
    } else if (this.config.dryRun) {
      logger.warn("Dry run mode - no changes will be made");
    }

    logger.info(`Lisa directory: ${this.config.lisaDir}`);
    logger.info(`Destination:    ${this.config.destDir}`);
    console.log("");
  }

  /**
   * Print summary header with mode
   */
  private printSummaryHeader(): void {
    console.log("");
    console.log(pc.green(this.separator));

    if (this.config.validateOnly) {
      console.log(pc.green("    Lisa Validation Complete"));
    } else if (this.config.dryRun) {
      console.log(pc.green("    Lisa Dry Run Complete"));
    } else {
      console.log(pc.green("    Lisa Installation Complete!"));
    }

    console.log(pc.green(this.separator));
    console.log("");
  }

  /**
   * Print a single stat line with color
   * @param label - Stat label
   * @param value - Stat value
   * @param color - Color function from picocolors
   * @param suffix - Optional suffix after the count
   */
  private printStatLine(
    label: string,
    value: number,
    color: (s: string) => string,
    suffix = ""
  ): void {
    const suffixText = suffix ? ` ${suffix}` : "";
    console.log(
      `  ${color(label)} ${String(value).padStart(3)} files${suffixText}`
    );
  }

  /**
   * Print summary statistics for validate mode
   */
  private printValidateStats(): void {
    const { copied, skipped, overwritten, appended, merged, deleted, ignored } =
      this.counters;
    this.printStatLine("Compatible files:   ", copied, pc.green);
    this.printStatLine("Already present:    ", skipped, pc.blue);
    this.printStatLine("Would conflict:     ", overwritten, pc.yellow);
    this.printStatLine("Would append:       ", appended, pc.blue);
    this.printStatLine("Would merge:        ", merged, pc.green);
    this.printStatLine("Would delete:       ", deleted, pc.red);
    if (ignored > 0) {
      this.printStatLine(
        "Ignored:            ",
        ignored,
        pc.magenta,
        this.lisaignoreSuffix
      );
    }
  }

  /**
   * Print summary statistics for dry-run mode
   */
  private printDryRunStats(): void {
    const { copied, skipped, overwritten, appended, merged, deleted, ignored } =
      this.counters;
    this.printStatLine("Would copy:     ", copied, pc.green);
    this.printStatLine(
      "Would skip:     ",
      skipped,
      pc.blue,
      "(identical or create-only)"
    );
    this.printStatLine("Would prompt:   ", overwritten, pc.yellow, "(differ)");
    this.printStatLine(
      "Would append:   ",
      appended,
      pc.blue,
      "(copy-contents)"
    );
    this.printStatLine("Would merge:    ", merged, pc.green, "(JSON)");
    this.printStatLine("Would delete:   ", deleted, pc.red);
    if (ignored > 0) {
      this.printStatLine(
        "Would ignore:   ",
        ignored,
        pc.magenta,
        this.lisaignoreSuffix
      );
    }
  }

  /**
   * Print summary statistics for apply mode
   */
  private printApplyStats(): void {
    const { copied, skipped, overwritten, appended, merged, deleted, ignored } =
      this.counters;
    this.printStatLine("Copied:     ", copied, pc.green);
    this.printStatLine(
      "Skipped:    ",
      skipped,
      pc.blue,
      "(identical or create-only)"
    );
    this.printStatLine(
      "Overwritten:",
      overwritten,
      pc.yellow,
      "(user approved)"
    );
    this.printStatLine("Appended:   ", appended, pc.blue, "(copy-contents)");
    this.printStatLine("Merged:     ", merged, pc.green, "(JSON merged)");
    this.printStatLine("Deleted:    ", deleted, pc.red);
    if (ignored > 0) {
      this.printStatLine(
        "Ignored:    ",
        ignored,
        pc.magenta,
        this.lisaignoreSuffix
      );
    }
  }

  /**
   * Print summary statistics
   */
  private printSummaryStats(): void {
    if (this.config.validateOnly) {
      this.printValidateStats();
    } else if (this.config.dryRun) {
      this.printDryRunStats();
    } else {
      this.printApplyStats();
    }

    const { migrationsApplied } = this.counters;
    if (migrationsApplied > 0) {
      this.printStatLine("Migrations: ", migrationsApplied, pc.cyan, "applied");
    }
  }

  /**
   * Print project types
   */
  private printProjectTypes(): void {
    console.log("");

    const allAndDetected =
      this.detectedTypes.length > 0
        ? `all ${this.detectedTypes.join(" ")}`
        : "all";

    console.log(`Project types: ${pc.green(allAndDetected)}`);

    console.log("");
  }

  /**
   * Print validation result
   */
  private printValidationResult(): void {
    if (!this.config.validateOnly) return;

    const { logger } = this.deps;
    const { overwritten } = this.counters;

    if (overwritten > 0) {
      logger.warn(
        `Validation found ${overwritten} file(s) that would conflict`
      );
      console.log("Run without --validate to apply changes interactively");
    } else {
      logger.success("Project is compatible with Lisa configurations");
    }
  }

  /**
   * Print summary
   */
  private printSummary(): void {
    this.printSummaryHeader();
    this.printSummaryStats();
    this.printProjectTypes();
    this.printValidationResult();
  }

  /**
   * Read a file's contents, returning null if the file does not exist or cannot be read.
   * Used for optional file checks that should not interrupt the main flow on failure.
   * @param filePath - Absolute path to the file to read
   * @returns File contents as a string, or null if unavailable
   */
  private async tryReadFile(filePath: string): Promise<string | null> {
    try {
      return await readFile(filePath, "utf-8");
    } catch {
      return null;
    }
  }

  /**
   * Print migration notices when the project's ci.yml or deploy.yml still reference
   * local quality/release workflows instead of the canonical Lisa repo versions.
   * Printed after the update summary so users see it as a post-update action item.
   * @param projectDir - The destination project directory to inspect
   */
  private async printMigrationNotices(projectDir: string): Promise<void> {
    const ciPath = path.join(projectDir, ".github", "workflows", "ci.yml");
    const deployPath = path.join(
      projectDir,
      ".github",
      "workflows",
      "deploy.yml"
    );

    const [ciContent, deployContent] = await Promise.all([
      this.tryReadFile(ciPath),
      this.tryReadFile(deployPath),
    ]);

    const isRailsProject = this.detectedTypes.includes("rails");

    const notices = [
      ciContent?.includes("uses: ./.github/workflows/quality.yml") &&
      !isRailsProject
        ? "  .github/workflows/ci.yml — change:\n    uses: ./.github/workflows/quality.yml\n    → uses: CodySwannGT/lisa/.github/workflows/quality.yml@main"
        : null,
      ciContent?.includes("uses: ./.github/workflows/quality.yml") &&
      isRailsProject
        ? "  .github/workflows/ci.yml — change:\n    uses: ./.github/workflows/quality.yml\n    → uses: CodySwannGT/lisa/.github/workflows/quality-rails.yml@main"
        : null,
      deployContent?.includes("uses: ./.github/workflows/release.yml") &&
      !isRailsProject
        ? "  .github/workflows/deploy.yml — change:\n    uses: ./.github/workflows/release.yml\n    → uses: CodySwannGT/lisa/.github/workflows/release.yml@main"
        : null,
      deployContent?.includes("uses: ./.github/workflows/release.yml") &&
      isRailsProject
        ? "  .github/workflows/deploy.yml — change:\n    uses: ./.github/workflows/release.yml\n    → uses: CodySwannGT/lisa/.github/workflows/release-rails.yml@main"
        : null,
    ].filter((n): n is string => n !== null);

    if (notices.length === 0) {
      return;
    }

    console.log("");
    console.log(
      pc.yellow(
        "⚠️  Action required: Update your CI/Deploy workflows to call the Lisa repo directly."
      )
    );
    console.log("");
    console.log(notices.join("\n\n"));
    console.log("");
    console.log(
      "  After this one-time change, quality/release workflow updates will be automatic."
    );
    console.log("");
  }
}
/* eslint-enable max-lines -- Main orchestrator class with apply/validate operations */
