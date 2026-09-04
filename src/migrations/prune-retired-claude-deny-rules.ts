import { existsSync } from "node:fs";
import * as path from "node:path";
import { readJsonOrNull, writeJson } from "../utils/json-utils.js";
import type {
  Migration,
  MigrationContext,
  MigrationResult,
} from "./migration.interface.js";

const SETTINGS_REL_PATH = path.join(".claude", "settings.json");

/**
 * Deny rules Lisa's `merge/.claude/settings.json` templates once shipped and
 * have since retired. Only these exact strings are pruned — every other entry
 * in `permissions.deny`, and every entry in `allow` / `ask`, is host-owned and
 * left untouched.
 *
 * `Read(./.entire/metadata/**)` is written with a *relative* path. A relative
 * deny pattern cannot be statically matched against a Bash command shaped
 * `cd <dir> && <read a relative path>`, so Claude Code cannot prove the command
 * safe and escalates it to a human approval prompt. With agent fleets running,
 * that fires constantly.
 */
const RETIRED_DENY_RULES: ReadonlySet<string> = new Set([
  "Read(./.entire/metadata/**)",
]);

/** Minimal shape of the `permissions` block this migration reads. */
interface ClaudePermissions {
  readonly deny?: readonly unknown[];
  readonly [key: string]: unknown;
}

/** Minimal shape of a Claude `.claude/settings.json` for deny-rule pruning. */
interface ClaudeSettings {
  readonly permissions?: ClaudePermissions;
  readonly [key: string]: unknown;
}

/**
 * Read the project's `.claude/settings.json`, returning null when absent or
 * unparseable. The two cases are distinguished by the caller via
 * {@link settingsFileExists} so a malformed file can warn instead of passing
 * silently as "nothing to do".
 * @param projectDir - Destination project directory
 * @returns Parsed settings, or null when the file is missing or invalid JSON
 */
async function readClaudeSettings(
  projectDir: string
): Promise<ClaudeSettings | null> {
  return readJsonOrNull<ClaudeSettings>(
    path.join(projectDir, SETTINGS_REL_PATH)
  );
}

/**
 * Whether the project has a `.claude/settings.json` file on disk at all.
 * @param projectDir - Destination project directory
 * @returns True when the file exists, regardless of whether it parses
 */
function settingsFileExists(projectDir: string): boolean {
  return existsSync(path.join(projectDir, SETTINGS_REL_PATH));
}

/**
 * Extract the retired deny rules present in a settings object.
 *
 * Returns an empty list whenever `permissions.deny` is missing or is not an
 * array — a host that shaped it differently is left entirely alone.
 * @param settings - Parsed settings object
 * @returns The retired rule strings actually present, in file order
 */
function findRetiredDenyRules(settings: ClaudeSettings): readonly string[] {
  const deny = settings.permissions?.deny;
  if (!Array.isArray(deny)) {
    return [];
  }
  return deny.filter(
    (entry): entry is string =>
      typeof entry === "string" && RETIRED_DENY_RULES.has(entry)
  );
}

/**
 * Rebuild a settings object with the retired deny rules removed.
 *
 * Surgical by construction: every other key of `settings`, every other key of
 * `permissions`, and every surviving `deny` entry keep their original value and
 * relative order. `deny` is left in place as an empty array when the retired
 * rules were its only members — dropping the key would be a structural change
 * the host never asked for.
 * @param settings - Parsed settings object
 * @returns A new settings object without the retired deny rules
 */
function withoutRetiredDenyRules(settings: ClaudeSettings): ClaudeSettings {
  const permissions = settings.permissions ?? {};
  const deny = permissions.deny;
  if (!Array.isArray(deny)) {
    return settings;
  }
  return {
    ...settings,
    permissions: {
      ...permissions,
      deny: deny.filter(
        entry => !(typeof entry === "string" && RETIRED_DENY_RULES.has(entry))
      ),
    },
  };
}

/**
 * Migration: prune retired Lisa deny rules from `.claude/settings.json`.
 *
 * Lisa seeds `permissions.deny` by deep-merging each detected stack's
 * `merge/.claude/settings.json` template, and that merge unions arrays — it can
 * only ever *add* entries (`src/utils/json-utils.ts`, `deepMergeWithArrayUnion`).
 * So dropping a rule from the template stops fresh projects from receiving it
 * and does nothing at all for the projects that already have it: every host
 * seeded by an older Lisa keeps the entry in its own settings file forever.
 * Removing it needs an explicit migration, exactly as pruning a stale stack
 * plugin did (see `reconcile-claude-stack-plugins`).
 *
 * Runs after the merge strategies, so it removes the rule even in the window
 * where a template still contributes it.
 *
 * Scope is deliberately narrow: only the exact strings in
 * {@link RETIRED_DENY_RULES} are removed, and only from `permissions.deny`.
 * Host-authored deny rules, `allow`, `ask`, and every other setting are never
 * touched. A missing settings file is a silent no-op; an unparseable one is
 * left byte-for-byte alone with a warning, never rewritten.
 */
export class PruneRetiredClaudeDenyRulesMigration implements Migration {
  readonly name = "prune-retired-claude-deny-rules";
  readonly description =
    "Remove retired Lisa deny rules from .claude/settings.json that array-union merge cannot un-add";

  /**
   * Whether the project's settings carry any retired deny rule.
   * @param ctx - Migration context
   * @returns True when at least one retired rule is present
   */
  async applies(ctx: MigrationContext): Promise<boolean> {
    const settings = await readClaudeSettings(ctx.projectDir);
    if (settings === null) {
      if (settingsFileExists(ctx.projectDir)) {
        ctx.logger.warn(
          `Could not parse ${SETTINGS_REL_PATH}; leaving it unchanged (${this.name})`
        );
      }
      return false;
    }
    return findRetiredDenyRules(settings).length > 0;
  }

  /**
   * Remove the retired deny rules and write the result back.
   * @param ctx - Migration context
   * @returns Result naming the rules removed
   */
  async apply(ctx: MigrationContext): Promise<MigrationResult> {
    const settings = await readClaudeSettings(ctx.projectDir);
    if (settings === null) {
      return { name: this.name, action: "noop" };
    }

    const retired = findRetiredDenyRules(settings);
    if (retired.length === 0) {
      return { name: this.name, action: "noop" };
    }

    const message = `Removed retired deny ${retired.length === 1 ? "rule" : "rules"} from ${SETTINGS_REL_PATH}: ${retired.join(", ")}`;

    if (ctx.dryRun) {
      ctx.logger.dry(`Would update ${SETTINGS_REL_PATH}: ${message}`);
      return {
        name: this.name,
        action: "applied",
        changedFiles: [SETTINGS_REL_PATH],
        message,
      };
    }

    await writeJson(
      path.join(ctx.projectDir, SETTINGS_REL_PATH),
      withoutRetiredDenyRules(settings)
    );
    ctx.logger.success(message);
    return {
      name: this.name,
      action: "applied",
      changedFiles: [SETTINGS_REL_PATH],
      message,
    };
  }
}
