import * as path from "node:path";
import * as fse from "fs-extra";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const LISA_CONFIG = ".lisa.config.json";
const WIKI_CONFIG = path.join("wiki", "lisa-wiki.config.json");
const DEFAULT_WIKI_ROOT = "wiki";

/**
 * Minimal shape of `.lisa.config.json` for this migration.
 */
interface LisaConfig {
  readonly wiki?: { readonly source?: unknown; readonly [k: string]: unknown };
  readonly [key: string]: unknown;
}

/**
 * Resolved state needed to decide and perform the declaration.
 */
interface WikiSourceState {
  readonly configPath: string;
  readonly config: LisaConfig | null;
  readonly wikiRoot: string;
}

/**
 * Migration: when a project carries a local LLM Wiki (`wiki/lisa-wiki.config.json`
 * exists) but its `.lisa.config.json` does not declare `wiki.source`, write the
 * explicit default pointer `wiki.source.path = <wikiRoot>` (the path the wiki's
 * own config reports, default `wiki`).
 *
 * Resolving the wiki is implicit local mode without this — the declaration just
 * makes "this project has a wiki here" self-documenting in the project config,
 * and is the consumer-side hook the remote-wiki story builds on. Idempotent:
 * skips when `wiki.source` already exists, preserves all other config keys and
 * any sibling `wiki` keys. Creates `.lisa.config.json` if absent (the project is
 * already Lisa-managed by virtue of carrying a lisa-wiki).
 */
export class EnsureWikiSourceDeclaredMigration implements Migration {
  readonly name = "ensure-wiki-source-declared";
  readonly description =
    "Declare wiki.source.path in .lisa.config.json when the project has a local wiki";

  /**
   * Gather the config + wiki root, or null when the project has no local wiki.
   * @param projectDir - Destination project directory
   * @returns Resolved state, or null when there is no local lisa-wiki
   */
  private async readState(projectDir: string): Promise<WikiSourceState | null> {
    const wikiCfgPath = path.join(projectDir, WIKI_CONFIG);
    if (!(await fse.pathExists(wikiCfgPath))) {
      return null;
    }
    const wikiCfg = await readJsonOrNull<{ wikiRoot?: string }>(wikiCfgPath);
    const configPath = path.join(projectDir, LISA_CONFIG);
    const config = await readJsonOrNull<LisaConfig>(configPath);
    return {
      configPath,
      config,
      wikiRoot: wikiCfg?.wikiRoot ?? DEFAULT_WIKI_ROOT,
    };
  }

  /**
   * Applies when a local wiki exists and `wiki.source` is not yet declared.
   * @param ctx - Migration context
   * @returns True when there is work to do
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const state = await this.readState(ctx.projectDir);
    return state !== null && state.config?.wiki?.source === undefined;
  }

  /**
   * Write `wiki.source.path` into `.lisa.config.json`, preserving existing keys.
   * @param ctx - Migration context
   * @returns Result describing the action taken
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const state = await this.readState(ctx.projectDir);
    if (state === null || state.config?.wiki?.source !== undefined) {
      return { name: this.name, action: "noop" };
    }
    const { configPath, config, wikiRoot } = state;
    const merged = {
      ...(config ?? {}),
      wiki: { ...(config?.wiki ?? {}), source: { path: wikiRoot } },
    };

    const message = `Declared wiki.source.path="${wikiRoot}" in ${LISA_CONFIG}`;
    if (ctx.dryRun) {
      ctx.logger.dry(`Would declare wiki.source.path="${wikiRoot}"`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [LISA_CONFIG],
        message,
      };
    }

    await writeJson(configPath, merged);
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [LISA_CONFIG],
      message,
    };
  }
}
