import * as path from "node:path";
import type { ProjectType } from "../core/config.js";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const SETTINGS_REL_PATH = path.join(".claude", "settings.json");

/**
 * Project types that ship their own `lisa-<type>@lisa` stack plugin.
 *
 * `npm-package` is intentionally excluded: it has no dedicated plugin and is
 * represented by its `typescript` parent (see PROJECT_TYPE_HIERARCHY). Every
 * other detectable type ships a stack plugin whose enablement Lisa owns.
 */
const STACK_PLUGIN_TYPES: readonly ProjectType[] = [
  "typescript",
  "expo",
  "nestjs",
  "cdk",
  "harper-fabric",
  "phaser",
  "rails",
];

/**
 * The full set of `lisa-<type>@lisa` plugin keys that this migration manages.
 * Any key outside this set (e.g. `lisa@lisa`, `lisa-wiki@lisa`, third-party
 * marketplace plugins like `typescript-lsp@claude-plugins-official`) is left
 * untouched.
 */
const MANAGED_STACK_PLUGIN_KEYS: ReadonlySet<string> = new Set(
  STACK_PLUGIN_TYPES.map(type => stackPluginKey(type))
);

/**
 * Build the canonical enabledPlugins key for a stack plugin type.
 * @param type - Project type that ships a stack plugin
 * @returns The `lisa-<type>@lisa` enabledPlugins key
 */
function stackPluginKey(type: ProjectType): string {
  return `lisa-${type}@lisa`;
}

/**
 * Minimal shape of a Claude `.claude/settings.json` for plugin reconciliation.
 */
interface ClaudeSettings {
  readonly enabledPlugins?: Readonly<Record<string, boolean>>;
  readonly [key: string]: unknown;
}

/**
 * Outcome of reconciling the managed stack plugins against detected types.
 */
interface ReconcileResult {
  readonly enabledPlugins: Record<string, boolean>;
  readonly removed: readonly string[];
  readonly added: readonly string[];
}

/**
 * Compute the reconciled enabledPlugins map for the managed stack plugin keys.
 *
 * Rules (only the managed `lisa-<type>@lisa` keys are considered):
 * - A stack plugin whose type is detected stays; if it is missing entirely it
 *   is added (`true`). An explicit existing value (including `false`, a
 *   deliberate opt-out) is preserved.
 * - A stack plugin whose type is NOT detected is removed entirely — it does not
 *   apply to this project.
 *
 * All non-managed keys pass through unchanged.
 * @param enabledPlugins - Current enabledPlugins map
 * @param detectedTypes - Detected project types (already parent-expanded)
 * @returns The reconciled map plus the lists of removed and added keys
 */
function reconcileStackPlugins(
  enabledPlugins: Readonly<Record<string, boolean>>,
  detectedTypes: readonly ProjectType[]
): ReconcileResult {
  const desiredKeys = new Set(
    detectedTypes
      .filter(type => STACK_PLUGIN_TYPES.includes(type))
      .map(type => stackPluginKey(type))
  );

  const entries = Object.entries(enabledPlugins);
  const isStale = (key: string): boolean =>
    MANAGED_STACK_PLUGIN_KEYS.has(key) && !desiredKeys.has(key);

  const removed = entries.map(([key]) => key).filter(isStale);
  const kept = entries.filter(([key]) => !isStale(key));
  const keptKeys = new Set(kept.map(([key]) => key));
  const added = [...desiredKeys].filter(key => !keptKeys.has(key));

  const enabledPluginsNext = Object.fromEntries([
    ...kept,
    ...added.map(key => [key, true] as const),
  ]);

  return { enabledPlugins: enabledPluginsNext, removed, added };
}

/**
 * Read the project's `.claude/settings.json`, returning null when absent.
 * @param projectDir - Destination project directory
 * @returns Parsed settings or null when missing/invalid
 */
async function readClaudeSettings(
  projectDir: string
): Promise<ClaudeSettings | null> {
  return readJsonOrNull<ClaudeSettings>(
    path.join(projectDir, SETTINGS_REL_PATH)
  );
}

/**
 * Migration: reconcile Lisa stack plugins in `.claude/settings.json` against
 * the project's currently detected types.
 *
 * Lisa enables `lisa-<type>@lisa` stack plugins by deep-merging each detected
 * stack's `merge/.claude/settings.json` template. Because the merge only ever
 * adds keys, a stack plugin enabled by a past apply persists forever even after
 * the project's nature changes — e.g. a project that once detected as TypeScript
 * but is now Rails keeps a stale `lisa-typescript@lisa`, and a TS backend that
 * briefly looked like Nest keeps a stale `lisa-nestjs@lisa`. This migration runs
 * after the merge strategies and prunes any managed stack plugin whose type is
 * no longer detected, while ensuring the detected stacks' plugins are present.
 * Non-stack plugins (`lisa@lisa`, `lisa-wiki@lisa`) and third-party marketplace
 * plugins are never touched.
 */
export class ReconcileClaudeStackPluginsMigration implements Migration {
  readonly name = "reconcile-claude-stack-plugins";
  readonly description =
    "Prune stale Lisa stack plugins from .claude/settings.json that no longer match detected types";

  /**
   * Whether reconciliation would change any managed stack plugin key.
   * @param ctx - Migration context
   * @returns True when a managed stack plugin would be added or removed
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const settings = await readClaudeSettings(ctx.projectDir);
    if (!settings?.enabledPlugins) {
      return false;
    }
    const { removed, added } = reconcileStackPlugins(
      settings.enabledPlugins,
      ctx.detectedTypes
    );
    return removed.length > 0 || added.length > 0;
  }

  /**
   * Reconcile the managed stack plugins and write the result back.
   * @param ctx - Migration context
   * @returns Result describing the keys removed and added
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const settings = await readClaudeSettings(ctx.projectDir);
    if (!settings?.enabledPlugins) {
      return { name: this.name, action: "noop" };
    }

    const { enabledPlugins, removed, added } = reconcileStackPlugins(
      settings.enabledPlugins,
      ctx.detectedTypes
    );

    if (removed.length === 0 && added.length === 0) {
      return { name: this.name, action: "noop" };
    }

    const parts: string[] = [];
    if (removed.length > 0) {
      parts.push(`removed stale ${removed.join(", ")}`);
    }
    if (added.length > 0) {
      parts.push(`added ${added.join(", ")}`);
    }
    const message = `Reconciled stack plugins: ${parts.join("; ")}`;

    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${SETTINGS_REL_PATH}: ${message}`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [SETTINGS_REL_PATH],
        message,
      };
    }

    const nextSettings: ClaudeSettings = { ...settings, enabledPlugins };
    await writeJson(path.join(ctx.projectDir, SETTINGS_REL_PATH), nextSettings);
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [SETTINGS_REL_PATH],
      message,
    };
  }
}
