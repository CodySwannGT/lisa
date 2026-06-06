import * as path from "node:path";
import * as fse from "fs-extra";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const TSCONFIG_LOCAL = "tsconfig.local.json";

/**
 * Minimal shape of a tsconfig file for the `files` fallback manipulation
 */
interface TsconfigLike {
  readonly files?: readonly string[];
  readonly [key: string]: unknown;
}

/**
 * Migration: add an empty `files` array to tsconfig.local.json.
 *
 * Background: the stack tsconfig.local.json templates declare
 * `include: ["src/**\/*"]`. A source-less repo (e.g. a SOC2 / infra-config
 * project that ships only root-level *.config.ts and no `src/`) has an
 * `include` that matches zero files, so `tsc --noEmit` aborts with
 * `error TS18003: No inputs were found in config file`. That failure trips
 * the lisa-managed typecheck pre-commit hook and blocks every commit, even
 * though there is genuinely nothing to type-check.
 *
 * TypeScript treats an explicit (even empty) `files` array as an intentional
 * file list and therefore does NOT raise TS18003. Crucially, when `include`
 * also matches real sources the compiled program is the UNION of `files` and
 * the `include` matches — so an empty `files` is a no-op for projects that
 * have sources (they are still fully type-checked) and a graceful success for
 * source-less ones. This is a posture change for empty-input tolerance, NOT a
 * relaxation of any check.
 *
 * The key is injected only when absent, so a project that intentionally pins a
 * non-empty `files` list keeps it.
 */
export class EnsureTsconfigLocalFilesFallbackMigration implements Migration {
  readonly name = "ensure-tsconfig-local-files-fallback";
  readonly description =
    "Add an empty `files` array to tsconfig.local.json so source-less projects pass tsc (TS18003) without disabling typechecking";

  /**
   * Check whether this migration should run on the project
   * @param ctx - Migration context
   * @returns True when tsconfig.local.json exists but has no `files` key
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const tsconfigLocalPath = path.join(ctx.projectDir, TSCONFIG_LOCAL);
    const existing = await readJsonOrNull<TsconfigLike>(tsconfigLocalPath);
    if (!existing) {
      return false;
    }
    return existing.files === undefined;
  }

  /**
   * Apply the migration, injecting an empty `files` array when absent
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const tsconfigLocalPath = path.join(ctx.projectDir, TSCONFIG_LOCAL);
    const existing = await readJsonOrNull<TsconfigLike>(tsconfigLocalPath);
    if (!existing || existing.files !== undefined) {
      return { name: this.name, action: "noop" };
    }

    const patched: TsconfigLike = { ...existing, files: [] };
    const message =
      "Added empty `files` array to tsconfig.local.json (TS18003 fallback)";

    if (ctx.dryRun) {
      ctx.logger.dry(`Would add empty \`files\` array to ${TSCONFIG_LOCAL}`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [TSCONFIG_LOCAL],
        message,
      };
    }

    await fse.ensureDir(path.dirname(tsconfigLocalPath));
    await writeJson(tsconfigLocalPath, patched);
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [TSCONFIG_LOCAL],
      message,
    };
  }
}
