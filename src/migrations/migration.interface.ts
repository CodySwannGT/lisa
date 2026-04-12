import type { ProjectType } from "../core/config.js";
import type { ILogger } from "../logging/index.js";

/**
 * Action performed by a migration run
 */
export type MigrationAction = "applied" | "skipped" | "noop";

/**
 * Context passed to migrations at runtime
 */
export interface MigrationContext {
  /** Destination project directory */
  readonly projectDir: string;

  /** Lisa installation directory (where templates live) */
  readonly lisaDir: string;

  /** Project types detected for the destination project */
  readonly detectedTypes: readonly ProjectType[];

  /** If true, describe what would change without modifying files */
  readonly dryRun: boolean;

  /** Logger for user-facing output */
  readonly logger: ILogger;
}

/**
 * Result of running a migration
 */
export interface MigrationResult {
  readonly name: string;
  readonly action: MigrationAction;
  readonly changedFiles?: readonly string[];
  readonly message?: string;
}

/**
 * One-time idempotent transform applied to an existing project
 */
export interface Migration {
  readonly name: string;
  readonly description: string;

  /**
   * Whether this migration should run on this project.
   * @param ctx Migration context
   */
  applies(ctx: MigrationContext): Promise<boolean>;

  /**
   * Apply the migration. Must be idempotent.
   * @param ctx Migration context
   */
  apply(ctx: MigrationContext): Promise<MigrationResult>;
}
