import { retireNativeSafetyNet } from "../core/native-safety-net-retirement.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

/** Retire only the native target, including direct reduced-core apply callers. */
export class RetireNativeSafetyNetMigration implements Migration {
  readonly name = "retire-native-safety-net";
  readonly description = "Disable retired Lisa-native safety-net handlers";

  /**
   * The common reconciler detects absent and already retired files itself.
   * @returns Whether to inspect the target-only retirement surface
   */
  async applies(): Promise<boolean> {
    return true;
  }

  /**
   * Keep every non-target file, registration and operator field intact.
   * @param ctx - Apply context, including reduced mode and dry run
   * @returns Exact retirement results
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const decisions = await retireNativeSafetyNet(ctx.projectDir, ctx.dryRun);
    for (const decision of decisions) {
      if (decision.status.startsWith("preserved"))
        ctx.logger.warn(`Safety-net ${decision.status}: ${decision.path}`);
    }
    const changedFiles = decisions
      .filter(
        item => item.status === "retired" || item.status === "would-retire"
      )
      .map(item => item.path);
    if (ctx.dryRun && changedFiles.length > 0)
      ctx.logger.dry(
        `Would retire ${changedFiles.length} native safety-net handler(s)`
      );
    return {
      name: this.name,
      action: changedFiles.length > 0 ? "applied" : "noop",
      changedFiles,
    };
  }
}
