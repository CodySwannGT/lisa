import { existsSync } from "node:fs";
import * as path from "node:path";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const SETTINGS_REL_PATH = path.join(".claude", "settings.json");
const RETIRED_COMMANDS: ReadonlySet<string> = new Set(
  [
    "post-task",
    "post-todo",
    "pre-task",
    "session-end",
    "session-start",
    "stop",
    "user-prompt-submit",
  ].map(
    verb =>
      `command -v entire >/dev/null 2>&1 && entire hooks claude-code ${verb} || true`
  )
);

/** A surgical hook projection, including whether an emptied group survives. */
interface HookProjection {
  readonly value: unknown;
  readonly removed: number;
  readonly keep: boolean;
}

/**
 * Identify JSON objects without interpreting malformed host hook values.
 * @param value - Untrusted JSON value
 * @returns Whether own keys can be inspected as a record
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Match only command hooks carrying a historically shipped exact command.
 * @param value - Host hook entry
 * @returns Whether Lisa owns this retired registration
 */
function isRetiredHook(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "command" &&
    typeof value.command === "string" &&
    RETIRED_COMMANDS.has(value.command)
  );
}

/**
 * Preserve group metadata and order, dropping only groups made empty by pruning.
 * @param value - Hook group, including unrecognized host shapes
 * @returns Surgical group projection
 */
function pruneGroup(value: unknown): HookProjection {
  if (!isRecord(value) || !Array.isArray(value.hooks)) {
    return { value, removed: 0, keep: true };
  }
  const hooks = value.hooks.filter(entry => !isRetiredHook(entry));
  const removed = value.hooks.length - hooks.length;
  return {
    value: removed === 0 ? value : { ...value, hooks },
    removed,
    keep: removed === 0 || hooks.length > 0,
  };
}

/**
 * Project one event while leaving non-array event values untouched.
 * @param value - Event registrations
 * @returns Preserved or pruned event value
 */
function pruneEvent(value: unknown): HookProjection {
  if (!Array.isArray(value)) return { value, removed: 0, keep: true };
  const groups = value.map(pruneGroup);
  return {
    value: groups.filter(group => group.keep).map(group => group.value),
    removed: groups.reduce((count, group) => count + group.removed, 0),
    keep: true,
  };
}

/**
 * Compute the settings change without mutating the parsed host file.
 * @param settings - Parsed host JSON object
 * @returns Settings and exact number of removed registrations
 */
function pruneSettings(settings: Record<string, unknown>): {
  readonly settings: Record<string, unknown>;
  readonly removed: number;
} {
  if (!isRecord(settings.hooks)) return { settings, removed: 0 };
  const events = Object.entries(settings.hooks).map(([name, value]) => ({
    name,
    projection: pruneEvent(value),
  }));
  const removed = events.reduce(
    (count, event) => count + event.projection.removed,
    0
  );
  const hooks = Object.fromEntries(
    events.map(event => [event.name, event.projection.value])
  );
  return {
    settings: removed === 0 ? settings : { ...settings, hooks },
    removed,
  };
}

/**
 * Read host settings without accepting an unrecognized root JSON shape.
 * @param projectDir - Destination root
 * @returns JSON object or null when absent/malformed
 */
async function readSettings(
  projectDir: string
): Promise<Record<string, unknown> | null> {
  const value = await readJsonOrNull<unknown>(
    path.join(projectDir, SETTINGS_REL_PATH)
  );
  return isRecord(value) ? value : null;
}

/**
 * Retire Lisa's automatic Entire registrations after array-union merge.
 * Removing template entries alone cannot remove commands already installed.
 * Only the seven historical command identities are pruned. A reviewed host
 * wrapper has a different identity and survives; user/local settings and
 * third-party session stores are never read or changed.
 */
export class PruneRetiredEntireHooksMigration implements Migration {
  readonly name = "prune-retired-entire-hooks";
  readonly description =
    "Remove retired automatic Entire command hooks while preserving host-owned hooks";

  /**
   * Find retired registrations and report malformed files without writing.
   * @param ctx - Original migration context
   * @returns Whether any historical registration needs removal
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const settings = await readSettings(ctx.projectDir);
    if (settings === null) {
      if (existsSync(path.join(ctx.projectDir, SETTINGS_REL_PATH))) {
        ctx.logger.warn(
          `Could not parse ${SETTINGS_REL_PATH}; leaving it unchanged (${this.name})`
        );
      }
      return false;
    }
    return pruneSettings(settings).removed > 0;
  }

  /**
   * Remove only retired registrations, honoring dry-run and idempotence.
   * @param ctx - Original migration context
   * @returns Exact changed-file and removal summary
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const settings = await readSettings(ctx.projectDir);
    if (settings === null) return { name: this.name, action: "noop" };
    const projection = pruneSettings(settings);
    if (projection.removed === 0) return { name: this.name, action: "noop" };
    const message = `Removed ${projection.removed} retired automatic Entire hook registrations from ${SETTINGS_REL_PATH}`;
    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${SETTINGS_REL_PATH}: ${message}`);
    } else {
      await writeJson(
        path.join(ctx.projectDir, SETTINGS_REL_PATH),
        projection.settings
      );
      ctx.logger.success(message);
    }
    return {
      name: this.name,
      action: "applied",
      changedFiles: [SETTINGS_REL_PATH],
      message,
    };
  }
}
