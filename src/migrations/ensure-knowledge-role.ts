import * as path from "node:path";
import { DEFAULT_KNOWLEDGE_BACKEND } from "../core/knowledge-role.js";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const LISA_CONFIG = ".lisa.config.json";

/** Minimal shape of `.lisa.config.json` for this migration. */
type LisaConfig = Readonly<Record<string, unknown>>;

/**
 * Migration: declare the required `knowledge` role and drop the retired
 * `wiki` key.
 *
 * The wiki used to be optional — selected when `wiki/lisa-wiki.config.json`
 * existed or a `wiki` key pointed at a local path or a remote repo to mirror.
 * Every project now owns its own wiki at `wiki/`, chosen by the `knowledge`
 * role, so the `wiki` key has nothing left to say. Only a project that already
 * has `.lisa.config.json` is touched; idempotent, and preserves every other key.
 *
 * The file is a reviewed, checked-in declaration, so an install
 * (`postinstallSafe`) declines and reports rather than writing; an explicit
 * `lisa apply` makes the change. The removed `wiki` value is echoed in the
 * result so a remote or custom location is never dropped silently.
 */
export class EnsureKnowledgeRoleMigration implements Migration {
  readonly name = "ensure-knowledge-role";
  readonly description =
    "Declare the knowledge role and remove the retired wiki key from .lisa.config.json";

  /**
   * Read the project config, or null when the project has none.
   * @param projectDir - Destination project directory
   * @returns Parsed config, or null
   */
  private async readConfig(projectDir: string): Promise<LisaConfig | null> {
    const parsed = await readJsonOrNull<unknown>(
      path.join(projectDir, LISA_CONFIG)
    );
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as LisaConfig)
      : null;
  }

  /**
   * Whether a config still needs the role declared or the retired key removed.
   * @param config - Parsed project config, or null
   * @returns True when there is work to do
   */
  private needsWork(config: LisaConfig | null): config is LisaConfig {
    return (
      config !== null &&
      (config.knowledge === undefined || config.wiki !== undefined)
    );
  }

  /**
   * Applies when the config lacks `knowledge` or still carries `wiki`.
   * @param ctx - Migration context
   * @returns True when there is work to do
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    return this.needsWork(await this.readConfig(ctx.projectDir));
  }

  /**
   * Write `knowledge` (keeping any existing value) and remove `wiki`.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const config = await this.readConfig(ctx.projectDir);
    if (!this.needsWork(config)) {
      return { name: this.name, action: "noop" };
    }
    if (ctx.postinstallSafe === true) {
      const message =
        `Left ${LISA_CONFIG} unchanged: an install must not rewrite a ` +
        "checked-in file. Run `lisa apply .` to declare the required " +
        "knowledge role and remove the retired wiki key.";
      ctx.logger.warn(message);
      return { name: this.name, action: "skipped", changedFiles: [], message };
    }
    const { wiki: retired, ...rest } = config;
    const merged = {
      ...rest,
      knowledge: config.knowledge ?? DEFAULT_KNOWLEDGE_BACKEND,
    };
    const removed =
      retired === undefined
        ? ""
        : ` and removed the retired wiki key (was ${JSON.stringify(retired)}; every repo now keeps its wiki at wiki/ and links related repos from it)`;
    const message = `Declared knowledge="${String(merged.knowledge)}"${removed} in ${LISA_CONFIG}`;
    if (ctx.dryRun) {
      ctx.logger.dry(message);
    } else {
      await writeJson(path.join(ctx.projectDir, LISA_CONFIG), merged);
      ctx.logger.success(message);
    }
    return {
      name: this.name,
      action: "applied",
      changedFiles: [LISA_CONFIG],
      message,
    };
  }
}
