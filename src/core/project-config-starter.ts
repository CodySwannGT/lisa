/** Persisted starter provenance and settings; no synchronization side effects. */
import { isJsonObject, type JsonObject } from "../sync/json-path.js";

/** One independently tracked starter template. */
export type StarterTemplate = {
  readonly repo: string;
  readonly ref: string;
  readonly lastSync: { readonly sha: string; readonly at: string };
  readonly paths?: string[];
};

/** Optional settings for the future starter synchronization engine. */
export type StarterSync = {
  readonly strategy?: "pull-request" | "direct-when-clean";
  readonly auto?: boolean;
  readonly upstreamProposals?: boolean;
  readonly proposalLabel?: string;
};

/** The project's own starter declarations. */
export type StarterConfig = {
  readonly templates?: StarterTemplate[];
  readonly sync?: StarterSync;
};

/** Proposals stay off until the classifier has been validated (PRD #1492). */
export const STARTER_SYNC_DEFAULTS = {
  strategy: "pull-request",
  auto: false,
  upstreamProposals: false,
  proposalLabel: "starter-upstream-proposal",
} as const;

/**
 * Require a JSON object at a named starter configuration path.
 * @param value - Supplied setting
 * @param key - Configuration path
 * @returns Valid object
 */
function requireObject(value: unknown, key: string): JsonObject {
  if (!isJsonObject(value)) throw new Error(`Invalid ${key}: expected object`);
  return value;
}

/**
 * Require a nonempty string without inventing repository or Git-ref semantics.
 * @param value - Supplied setting
 * @param key - Configuration path
 * @returns Valid string
 */
function requireString(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Invalid ${key}: expected nonempty string`);
  }
  return value;
}

/**
 * Validate one template while retaining its independent provenance.
 * @param value - Supplied template
 * @param index - Entry position for error reporting
 * @returns Valid template
 */
function validateTemplate(value: unknown, index: number): StarterTemplate {
  const key = `starter.templates.${index}`;
  const entry = requireObject(value, key);
  const lastSync = requireObject(entry.lastSync, `${key}.lastSync`);
  if (entry.paths !== undefined && !Array.isArray(entry.paths)) {
    throw new Error(`Invalid ${key}.paths: expected array`);
  }
  return {
    ...entry,
    repo: requireString(entry.repo, `${key}.repo`),
    ref: requireString(entry.ref, `${key}.ref`),
    lastSync: {
      ...lastSync,
      sha: requireString(lastSync.sha, `${key}.lastSync.sha`),
      at: requireString(lastSync.at, `${key}.lastSync.at`),
    },
    ...(entry.paths === undefined
      ? {}
      : {
          paths: entry.paths.map(value => requireString(value, `${key}.paths`)),
        }),
  };
}

/**
 * Validate the declared templates without guessing or stamping any origins.
 * @param value - Supplied array
 * @returns Valid independent entries
 */
export function validateStarterTemplates(value: unknown): StarterTemplate[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid starter.templates: expected array");
  }
  return value.map(validateTemplate);
}

/**
 * Validate supplied synchronization settings; population supplies defaults.
 * @param value - Supplied sync object
 * @returns Valid settings, including preserved extension keys
 */
export function validateStarterSync(value: unknown): StarterSync {
  const sync = requireObject(value, "starter.sync");
  if (
    sync.strategy !== undefined &&
    sync.strategy !== "pull-request" &&
    sync.strategy !== "direct-when-clean"
  ) {
    throw new Error(
      "Invalid starter.sync.strategy: expected pull-request or direct-when-clean"
    );
  }
  for (const key of ["auto", "upstreamProposals"]) {
    if (sync[key] !== undefined && typeof sync[key] !== "boolean") {
      throw new Error(`Invalid starter.sync.${key}: expected boolean`);
    }
  }
  if (sync.proposalLabel !== undefined) {
    requireString(sync.proposalLabel, "starter.sync.proposalLabel");
  }
  return sync as StarterSync;
}

/**
 * Resolve the optional starter block through the normal project config reader.
 * @param value - Supplied starter configuration
 * @returns Valid configuration or undefined
 */
export function validateStarterConfig(
  value: unknown
): StarterConfig | undefined {
  if (value === undefined) return undefined;
  const starter = requireObject(value, "starter");
  return {
    ...starter,
    ...(starter.templates === undefined
      ? {}
      : { templates: validateStarterTemplates(starter.templates) }),
    ...(starter.sync === undefined
      ? {}
      : { sync: validateStarterSync(starter.sync) }),
  };
}
