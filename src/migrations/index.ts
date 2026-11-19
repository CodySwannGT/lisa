import { CorrectLisaCoderabbitLabelingMigration } from "./correct-lisa-coderabbit-labeling.js";
import { DelegateLegacyTestScriptsMigration } from "./delegate-legacy-test-scripts.js";
import { EnsureDeployOutcomeGuardMigration } from "./ensure-deploy-outcome-guard.js";
import { EnsureJestRnMockAccessibilityManagerMigration } from "./ensure-jest-rn-mock-accessibility-manager.js";
import { EnsureLearningsGitattributesMigration } from "./ensure-learnings-gitattributes.js";
import { EnsureLearningsMergeDriverMigration } from "./ensure-learnings-merge-driver.js";
import { EnsureLighthouseCollectOptionsMigration } from "./ensure-lighthouse-collect-options.js";
import { EnsureNightlyE2EWorkflowPinsMigration } from "./ensure-nightly-e2e-workflow-pins.js";
import { EnsureLisaPostinstallMigration } from "./ensure-lisa-postinstall.js";
import { EnsureOxlintBaseConfigsMigration } from "./ensure-oxlint-base-configs.js";
import { EnsurePinnedReusableWorkflowRefsMigration } from "./ensure-pinned-reusable-workflow-refs.js";
import { EnsurePlaywrightDedicatedCallerMigration } from "./ensure-playwright-dedicated-caller.js";
import { EnsurePushDefaultSafeMigration } from "./ensure-push-default-safe.js";
import { EnsureQualityCallerScopesMigration } from "./ensure-quality-caller-scopes.js";
import { EnsureSeededGatesMigration } from "./ensure-seeded-gates.js";
import { EnsureRequiredHistorySecretGateMigration } from "./ensure-required-history-secret-gate.js";
import { EnsureSonarExcludesLisaHarnessMigration } from "./ensure-sonar-excludes-lisa-harness.js";
import { EnsureThirdPartyActionPinsMigration } from "./ensure-third-party-action-pins.js";
import { EnsureTsconfigLocalFilesFallbackMigration } from "./ensure-tsconfig-local-files-fallback.js";
import { EnsureKnowledgeRoleMigration } from "./ensure-knowledge-role.js";
import { EnsureTsconfigLocalIncludesMigration } from "./ensure-tsconfig-local-includes.js";
import { PruneRetiredClaudeDenyRulesMigration } from "./prune-retired-claude-deny-rules.js";
import { PruneRetiredClaudeStackPluginKeysMigration } from "./prune-retired-claude-stack-plugin-keys.js";
import { PruneRetiredThirdPartyPluginsMigration } from "./prune-retired-third-party-plugins.js";
import { PruneRetiredEntireHooksMigration } from "./prune-retired-entire-hooks.js";
import { PreserveVerificationOptInsMigration } from "./preserve-verification-opt-ins.js";
import { ReconcileClaudeStackPluginsMigration } from "./reconcile-claude-stack-plugins.js";
import { UntrackCodexMarketplaceMigration } from "./untrack-codex-marketplace.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

export type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

/**
 * Registry that runs applicable migrations against a destination project
 */
export class MigrationRegistry {
  private readonly migrations: readonly Migration[];

  /**
   * Initialize registry with provided or default migrations
   * @param migrations - Optional array of migrations (uses defaults if omitted)
   */
  constructor(migrations?: readonly Migration[]) {
    this.migrations = migrations ?? [
      new EnsureTsconfigLocalIncludesMigration(),
      new EnsureTsconfigLocalFilesFallbackMigration(),
      new EnsureDeployOutcomeGuardMigration(),
      new EnsureJestRnMockAccessibilityManagerMigration(),
      new EnsureLearningsGitattributesMigration(),
      new EnsureLearningsMergeDriverMigration(),
      new EnsureLighthouseCollectOptionsMigration(),
      new EnsureNightlyE2EWorkflowPinsMigration(),
      new EnsureLisaPostinstallMigration(),
      new DelegateLegacyTestScriptsMigration(),
      new EnsureOxlintBaseConfigsMigration(),
      new EnsurePlaywrightDedicatedCallerMigration(),
      new EnsurePushDefaultSafeMigration(),
      new EnsureQualityCallerScopesMigration(),
      new EnsureSeededGatesMigration(),
      new EnsureRequiredHistorySecretGateMigration(),
      new PreserveVerificationOptInsMigration(),
      new EnsureSonarExcludesLisaHarnessMigration(),
      new EnsureThirdPartyActionPinsMigration(),
      new EnsureKnowledgeRoleMigration(),
      new PruneRetiredClaudeDenyRulesMigration(),
      new PruneRetiredEntireHooksMigration(),
      new ReconcileClaudeStackPluginsMigration(),
      // After reconcile: a successor it adds retires its predecessor at once.
      new PruneRetiredClaudeStackPluginKeysMigration(),
      new PruneRetiredThirdPartyPluginsMigration(),
      new UntrackCodexMarketplaceMigration(),
      new CorrectLisaCoderabbitLabelingMigration(),
      // Last: every other workflow migration has finished editing caller files,
      // so the pin this writes is the one that survives the apply.
      new EnsurePinnedReusableWorkflowRefsMigration(),
    ];
  }

  /**
   * Get all registered migrations
   * @returns All migrations in registration order
   */
  getAll(): readonly Migration[] {
    return this.migrations;
  }

  /**
   * Invoke the optional `beforeStrategies` hook on every registered migration.
   * Used to snapshot project state that strategies will subsequently overwrite.
   * @param ctx - Migration context
   */
  async runBeforeStrategies(ctx: MigrationContext): Promise<void> {
    for (const migration of this.migrations) {
      if (migration.beforeStrategies) {
        await migration.beforeStrategies(ctx);
      }
    }
  }

  /**
   * Run every migration whose `applies` returns true
   * @param ctx - Migration context
   * @returns Aggregated results from every registered migration
   */
  async runAll(ctx: MigrationContext): Promise<readonly MigrationResult[]> {
    const results: MigrationResult[] = [];
    for (const migration of this.migrations) {
      const shouldRun = await migration.applies(ctx);
      if (!shouldRun) {
        results.push({ name: migration.name, action: "skipped" });
        continue;
      }
      const result = await migration.apply(ctx);
      results.push(result);
    }
    return results;
  }
}

/**
 * Create the default migration registry
 * @returns New MigrationRegistry with all default migrations registered
 */
export function createMigrationRegistry(): MigrationRegistry {
  return new MigrationRegistry();
}
