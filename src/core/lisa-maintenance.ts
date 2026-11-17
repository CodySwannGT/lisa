/**
 * @file lisa-maintenance.ts
 * @description Migrations, learnings relocation, lockfile reconciliation, and host hooks. One layer of the `Lisa` orchestrator; each layer
 * extends the one below it so the apply pipeline reads as one class while no
 * single module carries the whole pipeline.
 * @module core
 */
import * as fse from "fs-extra";
import * as path from "node:path";
import pc from "picocolors";
import {
  ensureRailsHooks,
  RAILS_HOOK_INSTALL_COMMAND,
} from "../../scripts/lib/rails-hooks.mjs";
import { getPackageVersion } from "../cli/version.js";
import {
  RECONCILIATION_REPORT_SCHEMA_VERSION,
  recordReconciliationScheduled,
  recordReconciliationSpawnFailure,
  resolveReconciliationReportPath,
} from "./reconciliation-report.js";
import { repointSonarShims } from "../sonar/sonar-shim-repoint.js";
import { isPostinstallSafeApply } from "./apply-mode.js";
import {
  type MigrationContext,
  type MigrationResult,
} from "../migrations/index.js";
import {
  getLisaDistDir,
  hashFile,
  isRunningAsTrampoline,
  regenerateLockfilesInProcess,
  scheduleReconciliationChild,
  shouldSchedulePostinstallReconciliation,
} from "../utils/postinstall-trampoline.js";
import { harnessIncludesAgent } from "./config.js";
import {
  migrateInstructionFiles,
  relocateProjectLearningsLedger,
} from "./instruction-files-migration.js";
import {
  assertSafeLearningParents,
  resolveSafeLearningTarget,
} from "./learnings-file-safety.js";
import {
  dependencySettingsWarning,
  humanGateSettingsWarnings,
  readProjectConfig,
  resolveLegacyProjectLearningsFile,
  resolveProjectLearningsFile,
} from "./project-config.js";
import { LisaAgentEmitExtra } from "./lisa-agent-emit-extra.js";

/**
 * Migrations, learnings relocation, lockfile reconciliation, and host hooks.
 */
export abstract class LisaMaintenance extends LisaAgentEmitExtra {
  /**
   * Resolve the host-owned learnings destination before template ownership is
   * computed. The canonical source stays at its stable package path while its
   * destination follows the configured project-rules directory.
   */
  protected async loadProjectLearningsFile(): Promise<void> {
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
   * Warn when `humanGate` or `dependencies.humanSignOff` holds a value outside
   * its closed vocabulary. The value is treated as its default rather than
   * failing the apply (see `project-config-dependencies` and
   * `project-config-human-gate`), so this warning is the only
   * place the CLI says the project did not get the setting it typed.
   */
  protected async reportInvalidDependencySettings(): Promise<void> {
    const config = await readProjectConfig(this.config.destDir);
    // `humanGate` degrades the same way (CodySwannGT/lisa#4687): an invalid
    // mode resolves to "access-only", and this is where the CLI says so.
    for (const line of humanGateSettingsWarnings(config)) {
      this.deps.logger.warn(line);
    }
    const warning = dependencySettingsWarning(config);
    if (warning !== undefined) this.deps.logger.warn(warning);
  }

  /**
   * Invoke pre-strategy migration hooks so migrations can snapshot project state
   * before strategies overwrite or delete managed files.
   */
  protected async runMigrationsBeforeStrategies(): Promise<void> {
    const { logger, migrationRegistry } = this.deps;

    const ctx: MigrationContext = {
      projectDir: this.config.destDir,
      lisaDir: this.config.lisaDir,
      detectedTypes: this.detectedTypes,
      dryRun: this.config.dryRun,
      postinstallSafe: isPostinstallSafeApply(this.config),
      logger,
    };

    await migrationRegistry.runBeforeStrategies(ctx);
  }

  /**
   * Run all applicable migrations against the destination project
   */
  protected async processMigrations(): Promise<void> {
    const { logger, migrationRegistry } = this.deps;

    const ctx: MigrationContext = {
      projectDir: this.config.destDir,
      lisaDir: this.config.lisaDir,
      detectedTypes: this.detectedTypes,
      dryRun: this.config.dryRun,
      postinstallSafe: isPostinstallSafeApply(this.config),
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
  protected updateMigrationCounters(results: readonly MigrationResult[]): void {
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
  protected async processLearningsRelocation(): Promise<void> {
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
  protected async processInstructionFilesMigration(): Promise<void> {
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
   * Repoint `sonar integrate`-generated hook shims at Lisa's Sonar wrapper.
   *
   * CodySwannGT/lisa#4502. The vendor shim calls `sonar hook <event>` directly,
   * so an unauthenticated CLI blocks every prompt; the wrapper Lisa ships
   * resolves `SONARQUBE_CLI_TOKEN` and degrades that case to a warning. Only
   * shims at documented locations whose body is recognisably the vendor's are
   * rewritten, and only when the wrapper is present; comment-only edits to such
   * a shim are not preserved. Deliberately NOT gated on
   * `verification.sonar.enabled` or the CLI being on PATH: a shim committed
   * earlier still runs whenever a developer has the CLI installed.
   *
   * Skipped in dry-run mode, and for postinstall-safe and self-apply runs —
   * consistent with `processSonarIntegration`, which those runs also skip, so
   * agent surfaces are only touched by a full apply; the next full apply
   * repoints. A shim that cannot be rewritten, or that calls `sonar hook` in a
   * shape Lisa does not recognise, is reported as a warning and the apply
   * continues. Each shim is backed up before it is replaced, so a failure in
   * a later apply step restores it along with everything else.
   */
  protected async processSonarShimRepoint(): Promise<void> {
    if (this.config.dryRun) {
      return;
    }
    if (this.shouldSkipAgentEmitDuringPostinstall()) {
      return;
    }
    const { backupService, logger } = this.deps;
    // Back each shim up before it is replaced, so a later apply step failing
    // rolls it back together with the wrapper it now points at.
    const result = await repointSonarShims(this.config.destDir, {
      beforeWrite: absolute => backupService.backup(absolute),
    });
    if (result.repointed.length > 0) {
      logger.info(
        pc.cyan(
          `Sonar shims: repointed ${result.repointed.length} at the Lisa wrapper (${result.repointed.join(", ")})`
        )
      );
    }
    for (const failed of result.failed) {
      logger.warn(
        `Sonar shim ${failed} could not be repointed at the Lisa wrapper (not readable or writable, or reached through a symlinked folder outside the project); patch it by hand per lisa-setup-sonar §4a.`
      );
    }
    for (const stray of result.unrecognized) {
      logger.warn(
        `Sonar shim ${stray} calls \`sonar hook\` in a form Lisa does not recognise, so it was left untouched; patch it by hand per lisa-setup-sonar §4a.`
      );
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
  protected async reconcileLockfilesInProcess(
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
  protected async schedulePostinstallReconciliation(
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
    const lisaVersion = getPackageVersion();
    // Written BEFORE the spawn on purpose: a spawn that never produces a child
    // otherwise leaves nothing on disk at all, which is one of the two failure
    // modes #2750 could not tell apart from success.
    await recordReconciliationScheduled(this.config.destDir, lisaVersion);
    try {
      const lisaDistDir = getLisaDistDir(import.meta.url);
      await scheduleReconciliationChild(
        this.config.destDir,
        lisaDistDir,
        process.ppid,
        {
          reportPath: resolveReconciliationReportPath(this.config.destDir),
          reportSchemaVersion: RECONCILIATION_REPORT_SCHEMA_VERSION,
          lisaVersion,
          // The content the package manager resolved its lockfile from. The
          // child compares against THIS rather than against its own re-apply.
          baselinePackageJsonHash: prePackageJsonHash,
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await recordReconciliationSpawnFailure(
        this.config.destDir,
        lisaVersion,
        message
      );
      this.deps.logger.warn(
        `Could not schedule postinstall reconciliation: ${message}`
      );
    }
  }

  /**
   * Install Rails wrappers through their manager after a real apply.
   * Failure is reported without turning a usable agent checkout into a blocked
   * startup; doctor and health independently report its actual installation.
   * @returns Once the bounded installation attempt has settled
   */
  protected async installRailsGitHooks(): Promise<void> {
    if (
      this.config.dryRun ||
      this.config.validateOnly ||
      !this.detectedTypes.includes("rails")
    )
      return;
    try {
      const result = await ensureRailsHooks(this.config.destDir);
      if (result.status === "failed" && result.detail)
        this.deps.logger.warn(result.detail);
    } catch {
      this.deps.logger.warn(
        `Rails Git hooks could not be installed; run ${RAILS_HOOK_INSTALL_COMMAND}.`
      );
    }
  }
}
