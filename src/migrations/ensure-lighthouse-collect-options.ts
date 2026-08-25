import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as fse from "fs-extra";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const CONFIG_FILE = "lighthouserc.js";

/**
 * The exact collect block shipped before project-specific discovery options
 * were forwarded. Matching the complete block keeps this create-only retrofit
 * from rewriting a host-diverged configuration.
 */
export const STALE_COLLECT_BLOCK = `    collect: {
      staticDistDir: collect.staticDistDir,
      numberOfRuns: collect.numberOfRuns,
      chromePath: process.env.CHROME_PATH || undefined,
    },`;

/** The current template block. */
export const CURRENT_COLLECT_BLOCK = `    collect: {
      ...collect,
      chromePath: process.env.CHROME_PATH || collect.chromePath || undefined,
    },`;

/**
 * Retrofit the exact create-only Lighthouse configuration Lisa used to seed.
 *
 * Editing a create-only template reaches new projects but never repairs an
 * existing checkout. This migration closes that delivery gap while refusing a
 * file whose collect block carries host changes Lisa cannot interpret safely.
 */
export class EnsureLighthouseCollectOptionsMigration implements Migration {
  readonly name = "ensure-lighthouse-collect-options";
  readonly description =
    "Forward project-specific Lighthouse static discovery options";

  /**
   * Decide whether the exact stale collect block can be upgraded safely.
   *
   * @param ctx - Migration context
   * @returns True only for an Expo project carrying the exact stale block
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    if (!ctx.detectedTypes.includes("expo")) return false;
    const file = path.join(ctx.projectDir, CONFIG_FILE);
    if (!(await fse.pathExists(file))) return false;
    return (await readFile(file, "utf8")).includes(STALE_COLLECT_BLOCK);
  }

  /**
   * Replace the stale block while preserving every other host-owned byte.
   *
   * @param ctx - Migration context
   * @returns The applied or no-op result
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const file = path.join(ctx.projectDir, CONFIG_FILE);
    if (!(await fse.pathExists(file))) {
      return { name: this.name, action: "noop" };
    }

    const before = await readFile(file, "utf8");
    if (!before.includes(STALE_COLLECT_BLOCK)) {
      return { name: this.name, action: "noop" };
    }

    const message =
      "Forwarded project-specific Lighthouse static discovery options";
    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${CONFIG_FILE}`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [CONFIG_FILE],
        message,
      };
    }

    await writeFile(
      file,
      before.replace(STALE_COLLECT_BLOCK, CURRENT_COLLECT_BLOCK)
    );
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [CONFIG_FILE],
      message,
    };
  }
}
