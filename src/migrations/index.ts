import { EnsureAuditIgnoreLocalExclusionsMigration } from "./ensure-audit-ignore-local-exclusions.js";
import { EnsureJestRnMockAccessibilityManagerMigration } from "./ensure-jest-rn-mock-accessibility-manager.js";
import { EnsureLearningsGitattributesMigration } from "./ensure-learnings-gitattributes.js";
import { EnsureLearningsMergeDriverMigration } from "./ensure-learnings-merge-driver.js";
import { EnsureLisaPostinstallMigration } from "./ensure-lisa-postinstall.js";
import { EnsureSonarExcludesLisaHarnessMigration } from "./ensure-sonar-excludes-lisa-harness.js";
import { EnsureTsconfigLocalFilesFallbackMigration } from "./ensure-tsconfig-local-files-fallback.js";
import { EnsureWikiSourceDeclaredMigration } from "./ensure-wiki-source-declared.js";
import { EnsureTsconfigLocalIncludesMigration } from "./ensure-tsconfig-local-includes.js";
import { ReconcileClaudeStackPluginsMigration } from "./reconcile-claude-stack-plugins.js";
import { UntrackCodexMarketplaceMigration } from "./untrack-codex-marketplace.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

export type {
  Migration,
  MigrationAction,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";
export { EnsureAuditIgnoreLocalExclusionsMigration } from "./ensure-audit-ignore-local-exclusions.js";
export { EnsureJestRnMockAccessibilityManagerMigration } from "./ensure-jest-rn-mock-accessibility-manager.js";
export { EnsureLearningsGitattributesMigration } from "./ensure-learnings-gitattributes.js";
export { EnsureLearningsMergeDriverMigration } from "./ensure-learnings-merge-driver.js";
export { EnsureLisaPostinstallMigration } from "./ensure-lisa-postinstall.js";
export { EnsureSonarExcludesLisaHarnessMigration } from "./ensure-sonar-excludes-lisa-harness.js";
export { EnsureTsconfigLocalFilesFallbackMigration } from "./ensure-tsconfig-local-files-fallback.js";
export { EnsureWikiSourceDeclaredMigration } from "./ensure-wiki-source-declared.js";
export { EnsureTsconfigLocalIncludesMigration } from "./ensure-tsconfig-local-includes.js";
export { ReconcileClaudeStackPluginsMigration } from "./reconcile-claude-stack-plugins.js";
export { UntrackCodexMarketplaceMigration } from "./untrack-codex-marketplace.js";

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
      new EnsureAuditIgnoreLocalExclusionsMigration(),
      new EnsureJestRnMockAccessibilityManagerMigration(),
      new EnsureLearningsGitattributesMigration(),
      new EnsureLearningsMergeDriverMigration(),
      new EnsureLisaPostinstallMigration(),
      new EnsureSonarExcludesLisaHarnessMigration(),
      new EnsureWikiSourceDeclaredMigration(),
      new ReconcileClaudeStackPluginsMigration(),
      new UntrackCodexMarketplaceMigration(),
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
