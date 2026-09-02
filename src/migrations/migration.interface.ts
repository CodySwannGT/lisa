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

  /**
   * True when this apply is the reduced subset a package manager's install
   * lifecycle runs — the mode `--postinstall-safe` / `LISA_POSTINSTALL=1`
   * selects (see `core/apply-mode.ts`).
   *
   * A migration reads this to answer one question: "did an operator ask for
   * this, or did a dependency install?" Nobody types `bun install` meaning to
   * change what their repository requires of a push, so a migration that
   * rewrites a REVIEWED, checked-in declaration must decline here and report
   * instead. Migrations that only reconcile generated or ignored files have no
   * reason to read it.
   *
   * Optional, and absent means the full apply an operator invoked. That is the
   * safe default for the reading above — a context that never learned the
   * answer behaves as though a human is standing there, which is exactly the
   * case where writing is legitimate.
   */
  readonly postinstallSafe?: boolean;

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
   * Optional pre-strategy hook. Runs before the copy/deletion strategies so
   * the migration can snapshot files that will subsequently be overwritten.
   * Implementations must be idempotent and side-effect free beyond updating
   * their own in-memory state.
   * @param ctx Migration context
   */
  beforeStrategies?(ctx: MigrationContext): Promise<void>;

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
