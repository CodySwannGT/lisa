/**
 * Per-project Lisa configuration persisted in `.lisa.config.json` at the
 * destination project root. Tracks settings that need to survive across
 * `lisa` invocations — e.g. which harness(es) the project targets.
 *
 * The file is intended to be checked into the host project's git history,
 * since the harness choice is part of the project's contract with Lisa.
 * @module project-config
 */
import * as fse from "fs-extra";
import { readFile, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  ACCEPTED_HARNESS_INPUTS,
  DEFAULT_HARNESS,
  HARNESS_ALIASES,
  HARNESS_VALUES,
  LEGACY_HARNESS_ALIASES,
  type Harness,
} from "./config.js";
import { PROJECT_LEARNINGS_FILENAME } from "./learnings-location.js";
import {
  type LearningsConfig,
  validateLearningsConfig,
} from "./project-config-learnings.js";
import { validateSafeRelativeMarkdownPath } from "./project-config-markdown-path.js";
import {
  validateVerificationConfig,
  type VerificationConfig,
} from "./project-config-kane.js";

export {
  AUTO_LOADED_RULES_DIR_PREFIXES,
  DEFAULT_PROJECT_LEARNINGS_FILE,
  PROJECT_LEARNINGS_FILENAME,
} from "./learnings-location.js";

export {
  resolveLearningsSettings,
  resolveProjectLearningsFile,
  type LearningsConfig,
  type ResolvedLearningsSettings,
} from "./project-config-learnings.js";

export type {
  BrowserVerificationConfig,
  KaneBrowserConfig,
  VerificationConfig,
} from "./project-config-kane.js";

/** Filename of the per-project config, relative to the destination root */
export const PROJECT_CONFIG_FILENAME = ".lisa.config.json";

/**
 * Canonical, agent-neutral directory for **host-authored** operating rules.
 * One directory, every agent; Lisa never writes rule bodies into it.
 *
 * Deliberately NOT a native auto-load tree for any runtime, so every agent
 * reaches it through exactly one surface — the Lisa-managed pointer block in
 * `AGENTS.md` — and none double-loads host rules. Fixed rather than
 * configurable: it is already reserved in `AUTO_LOADED_RULES_DIR_PREFIXES`
 * (`./learnings-location.js`), which keeps the learnings ledger from ever
 * resolving inside it.
 */
export const HOST_RULES_DIR = ".agents/rules";

/**
 * The retired single-file rules destination, superseded by
 * {@link HOST_RULES_DIR}. Migration-only, never a serving default: it locates a
 * ledger older releases wrote beside it, and names a host's surviving legacy
 * file in the pointer block so that content stays reachable. Reclassifying it
 * is human-gated work.
 */
export const LEGACY_PROJECT_RULES_FILE = ".claude/rules/PROJECT_RULES.md";

/**
 * Schema of `.lisa.config.json`. Additional fields may be added in future
 * versions; unknown fields are preserved on round-trip.
 */
export interface ProjectConfig {
  /** Target harness(es) for emitted artifacts */
  readonly harness?: Harness;
  /**
   * @deprecated Retired in favour of the fixed {@link HOST_RULES_DIR}. Still
   * parsed and preserved on round-trip so an installed project's config keeps
   * working, and still consulted by the migration paths that need to know where
   * a pre-directory release put things. Nothing serves rules from it.
   */
  readonly projectRulesFile?: string;
  /** Optional overrides for the machine-managed learnings ledger. */
  readonly learnings?: LearningsConfig;
  /** Optional empirical verification provider configuration. */
  readonly verification?: VerificationConfig;
}

/**
 * Resolve where a pre-directory release would have kept this project's
 * single-file rules: the deprecated `projectRulesFile` override when one is
 * persisted, else {@link LEGACY_PROJECT_RULES_FILE}.
 *
 * Migration-only. Callers use it to find a ledger written beside the old file
 * and to name a surviving legacy file in the `AGENTS.md` pointer — never to
 * decide where rules should be read from today ({@link HOST_RULES_DIR} answers
 * that, and it is not configurable).
 * @param config - Parsed project configuration
 * @returns Safe project-relative Markdown path
 */
export function resolveLegacyProjectRulesFile(config: ProjectConfig): string {
  const configured = config.projectRulesFile ?? LEGACY_PROJECT_RULES_FILE;
  return validateProjectRulesFile(configured, PROJECT_CONFIG_FILENAME);
}

/**
 * Resolve the machine-managed learnings ledger path. A validated
 * `learnings.file` override wins; otherwise the `.lisa/PROJECT_LEARNINGS.md`
 * default is used. The path is intentionally independent of `projectRulesFile`:
 * the ledger is cold state, not a rules sibling.
 * @param config - Parsed project configuration
 * @returns Safe project-relative learnings Markdown path
 */
/**
 * Resolve the ledger's LEGACY location — the sibling of the retired single-file
 * rules path, where releases before the `.lisa/` relocation kept it. Used only
 * by the apply/doctor relocation so an existing file can be found and moved to
 * the new canonical path; never a serving path.
 * @param config - Parsed project configuration
 * @returns Legacy project-relative learnings Markdown path
 */
export function resolveLegacyProjectLearningsFile(
  config: ProjectConfig
): string {
  const dir = path.posix.dirname(resolveLegacyProjectRulesFile(config));
  return path.posix.join(dir, PROJECT_LEARNINGS_FILENAME);
}

/**
 * Read `.lisa.config.json` from a destination project, returning {} if absent.
 *
 * Throws if the file exists but is invalid JSON or contains an invalid harness
 * value, since silently ignoring a malformed config would mask user mistakes.
 * @param destDir - Absolute path to the destination project root
 * @returns Parsed project config (empty object if file is absent)
 */
export async function readProjectConfig(
  destDir: string
): Promise<ProjectConfig> {
  const configPath = path.join(destDir, PROJECT_CONFIG_FILENAME);
  if (!(await fse.pathExists(configPath))) {
    return {};
  }
  const raw = await readFile(configPath, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return validateProjectConfig(parsed, configPath);
}

/**
 * Write `.lisa.config.json` to a destination project, merging into any
 * existing content so unknown fields written by future Lisa versions are
 * preserved on round-trip.
 *
 * Rejects an existing file whose root is not a JSON object (e.g., array,
 * string, number) — `readProjectConfig` already enforces this on read, and
 * silently coercing such a file via `{...(value as object), ...updates}`
 * would persist a corrupted config (indexed-key object) that the next read
 * would then reject.
 * @param destDir - Absolute path to the destination project root
 * @param updates - Partial config to merge into the existing file
 */
export async function writeProjectConfig(
  destDir: string,
  updates: ProjectConfig
): Promise<void> {
  const configPath = path.join(destDir, PROJECT_CONFIG_FILENAME);
  const existing = await readRawObject(configPath);
  const merged = { ...existing, ...updates };
  await writeFile(configPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

/**
 * Whether a `.lisa.config.json` file exists at the destination project root.
 *
 * Distinct from `readProjectConfig`, which returns `{}` both when the file is
 * absent and when it exists but declares no recognized keys — callers that
 * need to know whether the file physically exists (e.g. to backfill a missing
 * one) must use this.
 * @param destDir - Absolute path to the destination project root
 * @returns True when the config file is present on disk
 */
export async function projectConfigExists(destDir: string): Promise<boolean> {
  return fse.pathExists(path.join(destDir, PROJECT_CONFIG_FILENAME));
}

/**
 * Decide whether `apply` should write `.lisa.config.json`.
 *
 * Policy: every applied project must carry a `.lisa.config.json`, so a missing
 * file is always backfilled (with the resolved harness — the default when no
 * `--harness` flag was passed). An existing file is only rewritten when the
 * user supplied `--harness` and it actually changes the persisted value, so
 * routine applies don't churn a project's committed config.
 * @param params - File presence and resolved/declared harness values
 * @param params.fileExists - Whether `.lisa.config.json` already exists on disk
 * @param params.flagHarness - Harness from the `--harness` CLI flag, if passed
 * @param params.existingHarness - Harness currently persisted in the config
 * @param params.resolvedHarness - Effective harness resolved for this run
 * @returns True when the config should be (re)written
 */
export function shouldPersistProjectConfig(params: {
  readonly fileExists: boolean;
  readonly flagHarness: Harness | undefined;
  readonly existingHarness: Harness | undefined;
  readonly resolvedHarness: Harness;
}): boolean {
  if (!params.fileExists) {
    return true;
  }
  return (
    params.flagHarness !== undefined &&
    params.existingHarness !== params.resolvedHarness
  );
}

/**
 * Read `.lisa.config.json` and return its raw parsed object, preserving
 * unknown fields. Unlike `readProjectConfig`, this does NOT strip the
 * result down to the recognized `ProjectConfig` keys — used by
 * `writeProjectConfig` so round-trips don't drop fields a future Lisa
 * version added.
 *
 * Returns `{}` when the file is absent. Throws on invalid JSON or
 * non-object root, matching `readProjectConfig`'s strictness.
 * @param configPath - Absolute path to the JSON file
 * @returns The parsed object as a generic record (empty if file is absent)
 */
async function readRawObject(
  configPath: string
): Promise<Record<string, unknown>> {
  if (!(await fse.pathExists(configPath))) {
    return {};
  }
  const parsed = JSON.parse(await readFile(configPath, "utf8")) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid ${PROJECT_CONFIG_FILENAME} at ${configPath}: expected JSON object`
    );
  }
  return parsed as Record<string, unknown>;
}

/**
 * Resolve the effective harness from CLI flag, project config, and default,
 * in that precedence order.
 * @param flagValue - Value from `--harness` CLI flag (undefined if not passed)
 * @param projectConfig - Parsed `.lisa.config.json` content
 * @returns The effective harness to use for this run
 */
export function resolveHarness(
  flagValue: Harness | undefined,
  projectConfig: ProjectConfig
): Harness {
  if (flagValue !== undefined) {
    return flagValue;
  }
  if (projectConfig.harness !== undefined) {
    return projectConfig.harness;
  }
  return DEFAULT_HARNESS;
}

/**
 * Type-guard validator for raw parsed config. Throws on invalid harness value.
 * @param parsed - Raw value parsed from JSON (untrusted shape)
 * @param configPath - Absolute path to the source file (used in error messages)
 * @returns A typed ProjectConfig with only the keys we recognize
 */
export function validateProjectConfig(
  parsed: unknown,
  configPath: string
): ProjectConfig {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Invalid ${PROJECT_CONFIG_FILENAME} at ${configPath}: expected JSON object`
    );
  }
  const obj = parsed as Record<string, unknown>;
  const harness = validateOptionalHarness(obj.harness, configPath);
  const projectRulesFile =
    obj.projectRulesFile === undefined
      ? undefined
      : validateProjectRulesFile(obj.projectRulesFile, configPath);
  const learnings = validateLearningsConfig(obj.learnings, configPath);
  const verification = validateVerificationConfig(obj.verification, configPath);
  return {
    ...(harness === undefined ? {} : { harness }),
    ...(projectRulesFile === undefined ? {} : { projectRulesFile }),
    ...(learnings === undefined ? {} : { learnings }),
    ...(verification === undefined ? {} : { verification }),
  };
}

/**
 * Validate the optional harness while preserving an absent value.
 * @param value - Raw harness value
 * @param configPath - Config source for errors
 * @returns Normalized harness or undefined
 */
function validateOptionalHarness(
  value: unknown,
  configPath: string
): Harness | undefined {
  if (value === undefined) {
    return undefined;
  }
  // A persisted, retired legacy value (e.g. "both") is migrated to its
  // canonical form rather than rejected — apply rewrites the file (see
  // detectLegacyHarnessMigration). This keeps pre-fleet projects applying
  // instead of hard-failing every run on a value newer Lisa versions removed.
  const legacy =
    typeof value === "string" ? LEGACY_HARNESS_ALIASES[value] : undefined;
  const normalized =
    legacy ?? (typeof value === "string" ? normalizeHarness(value) : undefined);
  if (normalized !== undefined) {
    return normalized;
  }
  const allowed = ACCEPTED_HARNESS_INPUTS.join(" | ");
  throw new Error(
    `Invalid harness in ${configPath}: expected ${allowed}, got ${JSON.stringify(value)}`
  );
}

/**
 * Validate the configurable rules destination as a safe Markdown path, and
 * reject the reserved learnings filename so a rules file can never collide with
 * the machine-managed ledger.
 * @param value - Raw configured path
 * @param source - Config source for errors
 * @returns Validated project-relative path
 */
function validateProjectRulesFile(value: unknown, source: string): string {
  const safe = validateSafeRelativeMarkdownPath(
    value,
    source,
    "projectRulesFile"
  );
  if (
    path.posix.basename(safe).toLowerCase() ===
    PROJECT_LEARNINGS_FILENAME.toLowerCase()
  ) {
    throw new Error(
      `Invalid projectRulesFile in ${source}: ${PROJECT_LEARNINGS_FILENAME} is reserved for machine-managed learnings`
    );
  }
  return safe;
}

/**
 * Narrow an unknown value to the Harness type
 * @param value - Untrusted value to test
 * @returns True if value is one of the canonical Harness strings
 */
export function isHarness(value: unknown): value is Harness {
  return (
    typeof value === "string" &&
    (HARNESS_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Normalize a raw user-supplied harness string to its canonical Harness,
 * resolving input aliases (e.g. `all` → `fleet`). Returns undefined when the
 * value is neither a canonical harness nor an advertised alias, so callers can
 * raise a single consistent validation error.
 *
 * Retired legacy values (e.g. `both`) are intentionally NOT resolved here: the
 * CLI (`--harness`) stays strict so a user typing a removed value is steered to
 * the current one. Persisted legacy values in `.lisa.config.json` are migrated
 * separately on read (see {@link validateProjectConfig} /
 * {@link detectLegacyHarnessMigration}).
 * @param value - Raw harness string from the CLI flag or `.lisa.config.json`
 * @returns The canonical Harness, or undefined if unrecognized
 */
export function normalizeHarness(value: string): Harness | undefined {
  const canonical = HARNESS_ALIASES[value] ?? value;
  return isHarness(canonical) ? canonical : undefined;
}

/**
 * Inspect a project's persisted `.lisa.config.json` for a retired legacy
 * harness value (e.g. `both`) that apply should silently migrate to its
 * canonical form and rewrite back to disk.
 *
 * Only {@link LEGACY_HARNESS_ALIASES} values trigger a migration — the friendly
 * `all` alias is a valid, advertised input and is intentionally left as-is so
 * routine applies don't churn a project's committed config. Returns undefined
 * when the file is absent, unreadable, or its harness is already canonical.
 * @param destDir - Absolute path to the destination project root
 * @returns The `{ from, to }` migration mapping, or undefined when none applies
 */
export async function detectLegacyHarnessMigration(
  destDir: string
): Promise<{ readonly from: string; readonly to: Harness } | undefined> {
  const configPath = path.join(destDir, PROJECT_CONFIG_FILENAME);
  if (!(await fse.pathExists(configPath))) {
    return undefined;
  }
  const raw = await readRawObject(configPath);
  if (typeof raw.harness !== "string") {
    return undefined;
  }
  const to = LEGACY_HARNESS_ALIASES[raw.harness];
  return to === undefined ? undefined : { from: raw.harness, to };
}
