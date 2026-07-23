import {
  canInstallLearningsMergeDriver,
  installLearningsMergeDriver,
} from "../core/learnings-merge-driver-install.js";
import { LEARNINGS_MERGE_DRIVER_NAME } from "../core/learnings-merge-driver.js";
import { isLearningsMergeDriverEnabled } from "../core/learnings-merge-driver-config.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

/**
 * Migration: register the project-learnings union merge driver locally.
 *
 * Every learner pass runs on its own `learning/<fingerprint>` branch in its own
 * worktree, so concurrent passes produce concurrent pull requests that each
 * rewrite the same JSONL block. Git's default line merge turns that into
 * conflict markers inside the ledger, and a merge that "succeeds" by taking one
 * side silently discards the other branch's consolidation
 * (CodySwannGT/lisa#1995).
 *
 * The `.gitattributes` half of the fix is committed and ships through the
 * template pipeline, but git refuses to read a merge-driver COMMAND from a
 * repository — a committed command would execute arbitrary code on `git merge`
 * in any clone. The command is therefore machine-local, and this migration is
 * what writes it, on every `lisa apply`, for host projects and Lisa's own
 * repository alike.
 *
 * Degrading safely is the design point: without registration git falls back to
 * its built-in text merge, which is exactly today's behavior. Nothing regresses
 * in an unregistered checkout — it simply loses the union.
 *
 * Because `lisa apply` runs from `postinstall`, this registration happens on an
 * ordinary `npm install` with no separate operator step. That is convenient but
 * it does persist an executable hook in `.git/config` that fires on ordinary
 * git operations, outside npm's lifecycle — so hosts can decline it by setting
 * `learnings.mergeDriver: false` in `.lisa.config.json`.
 */
export class EnsureLearningsMergeDriverMigration implements Migration {
  readonly name = "ensure-learnings-merge-driver";
  readonly description = `Register the ${LEARNINGS_MERGE_DRIVER_NAME} git merge driver so concurrent learning branches union by entry id instead of conflicting`;

  /**
   * Applies inside any git working tree. Registration itself is idempotent, so
   * this only has to exclude directories where git config cannot exist.
   * @param ctx - Migration context
   * @returns True when there is work to do
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    if (!(await isLearningsMergeDriverEnabled(ctx.projectDir))) {
      return false;
    }
    return canInstallLearningsMergeDriver(ctx.projectDir);
  }

  /**
   * Register the merge driver in the project's local git config.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    if (!(await isLearningsMergeDriverEnabled(ctx.projectDir))) {
      return { name: this.name, action: "noop" };
    }
    if (!(await canInstallLearningsMergeDriver(ctx.projectDir))) {
      return { name: this.name, action: "noop" };
    }
    if (ctx.dryRun) {
      ctx.logger.dry(
        `Would register the ${LEARNINGS_MERGE_DRIVER_NAME} git merge driver`
      );
      return { name: this.name, action: "applied" };
    }
    const result = await installLearningsMergeDriver(ctx.projectDir);
    if (result.kind !== "installed") {
      return { name: this.name, action: "noop" };
    }
    ctx.logger.success(result.detail);
    return { name: this.name, action: "applied", message: result.detail };
  }
}
