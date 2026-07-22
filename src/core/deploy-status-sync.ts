/**
 * Deploy-status-sync ladder resolution and config schema (DSS-1).
 *
 * Pure, fs-free helpers that turn a parsed `.lisa.config.json` value into the
 * ordered environment ladder (env → deploy branch → tracker done status) the
 * deploy-status-sync flows walk, plus the validator for the optional
 * `deployStatusSync` section. The default done vocabularies live here — and
 * are consumed by `src/sync/registry.ts` — so the ladder resolver and the
 * sync registry share one source of truth without a runtime module cycle
 * (registry → project-config → this module would cycle if this module
 * imported the registry).
 * @module core/deploy-status-sync
 */
import {
  getAtPath,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "../sync/json-path.js";
import { optionalString } from "./config-field-validation.js";

/** Tracker vendors whose done vocabulary can bind a deploy ladder. */
export type Tracker = "jira" | "github" | "linear";

/** One environment step of the deploy ladder. */
export interface DeployLadderRung {
  /** Environment name as configured (e.g. `dev`, `prod`) */
  readonly env: string;
  /** Git branch that deploys to this environment */
  readonly branch: string;
  /** Tracker status/label a work item earns when deployed here */
  readonly doneStatus: string;
}

/** The resolved promotion ladder, ordered lowest environment first. */
export interface DeployLadder {
  /** Ordered rungs (lowest environment first) */
  readonly rungs: readonly DeployLadderRung[];
  /** True when the ladder collapsed to a single terminal rung */
  readonly terminalOnly: boolean;
  /**
   * Highest-ranked env of the configured universe (post-alias), even when its
   * rung was skipped. Consumers gate terminal native closure on this — a
   * lower rung must never close items just because higher rungs were skipped.
   * Absent only when `deploy.branches` is empty.
   */
  readonly terminalEnv?: string;
}

/** Optional machine-written `deployStatusSync` section of the config. */
export interface DeployStatusSyncConfig {
  /** Provisioning tier chosen at setup time */
  readonly tier?: string;
  /** Provisioned tracker artifact ids, keyed by artifact name */
  readonly provisioned?: Readonly<Record<string, string>>;
  /** How Linear deploy statuses are represented */
  readonly linearBinding?: "labels" | "states";
  /** ISO-8601 UTC timestamp of the last successful verification */
  readonly verifiedAt?: string;
}

/**
 * Default env-keyed done labels for label-driven trackers (GitHub, Linear).
 * Mirrored into the sync registry's `github.labels` / `linear.labels`
 * defaults — keep value-identical with what `lisa sync` populates.
 */
export const ENV_DONE_LABEL_DEFAULTS = {
  dev: "status:on-dev",
  staging: "status:on-stg",
  production: "status:done",
} as const;

/**
 * Default env-keyed done statuses for JIRA workflows. Mirrored into the sync
 * registry's `jira.workflow` default — keep value-identical with what
 * `lisa sync` populates.
 */
export const JIRA_DONE_STATUS_DEFAULTS = {
  dev: "On Dev",
  staging: "On Stg",
  production: "Done",
} as const;

/** Config dot-path of each tracker's env-keyed done vocabulary. */
const DONE_MAP_PATHS: Readonly<Record<Tracker, string>> = {
  github: "github.labels.build.done",
  linear: "linear.labels.build.done",
  jira: "jira.workflow.done",
};

/**
 * Config dot-path of a tracker's env-keyed done vocabulary. Exposed so
 * consumers (e.g. the transition engine's explanatory no-ops) can name the
 * exact missing config key without duplicating the vocabulary source map.
 * @param tracker - Tracker whose done map applies
 * @returns Dot-path inside `.lisa.config.json`
 */
export function doneMapPath(tracker: Tracker): string {
  return DONE_MAP_PATHS[tracker];
}

/** Default done vocabulary per tracker, used when config has no entry. */
const DONE_DEFAULTS: Readonly<
  Record<Tracker, Readonly<Record<string, string>>>
> = {
  github: ENV_DONE_LABEL_DEFAULTS,
  linear: ENV_DONE_LABEL_DEFAULTS,
  jira: JIRA_DONE_STATUS_DEFAULTS,
};

/** Canonical promotion rank when `deploy.order` is absent (lowest first). */
const CANONICAL_ENV_RANKS: Readonly<Record<string, number>> = {
  dev: 0,
  staging: 1,
  production: 2,
};

/**
 * Keep only the string-valued entries of a JSON object record.
 * @param value - JSON object record
 * @returns Record of the string-valued entries
 */
function stringRecord(value: JsonObject): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

/**
 * Read `deploy.branches` as an env → branch map, ignoring non-string values.
 * @param config - Parsed config value
 * @returns Env-to-branch record (empty when the section is absent)
 */
function readBranches(config: JsonValue): Readonly<Record<string, string>> {
  const branches = getAtPath(config, "deploy.branches");
  return isJsonObject(branches) ? stringRecord(branches) : {};
}

/** The configured done vocabulary: an env-keyed map or a terminal string. */
interface ConfiguredDone {
  readonly map?: Readonly<Record<string, string>>;
  readonly terminal?: string;
}

/**
 * Read the tracker's configured done vocabulary from config, if any.
 * @param config - Parsed config value
 * @param tracker - Tracker whose vocabulary path applies
 * @returns Configured env-keyed map, terminal string, or neither
 */
function readConfiguredDone(
  config: JsonValue,
  tracker: Tracker
): ConfiguredDone {
  const done = getAtPath(config, DONE_MAP_PATHS[tracker]);
  if (typeof done === "string") return { terminal: done };
  if (!isJsonObject(done)) return {};
  return { map: stringRecord(done) };
}

/**
 * Drop done-map entries whose value is EXACTLY the default table's value
 * for that env. `lisa sync` materializes the default map into config, so
 * such entries are not operator intent — they are invisible for ALL
 * purposes: stripped before the env-key union is computed, they never
 * block the sole `prod` ↔ `production` alias and never error. Only a
 * value that DIFFERS from the default is deliberate configuration.
 * @param doneMap - Configured env-keyed done map
 * @param defaults - Tracker default done vocabulary
 * @returns The done map without materialized-default entries
 */
function stripMaterializedDefaults(
  doneMap: Readonly<Record<string, string>>,
  defaults: Readonly<Record<string, string>>
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(doneMap).filter(([env, status]) => status !== defaults[env])
  );
}

/**
 * Reject a configured done entry whose environment has no deploy branch.
 * Materialized defaults are already stripped by the time this runs, so
 * every remaining entry is deliberate operator intent.
 * @param doneMap - Configured env-keyed done map (defaults stripped)
 * @param branchEnvs - Environments present in `deploy.branches`
 * @param source - Config source shown in errors
 */
function assertDoneEnvsHaveBranches(
  doneMap: Readonly<Record<string, string>>,
  branchEnvs: readonly string[],
  source: string
): void {
  for (const [env, status] of Object.entries(doneMap)) {
    if (!branchEnvs.includes(env)) {
      throw new Error(
        `Invalid deploy configuration in ${source}: a done status ("${status}") is configured for environment "${env}", but deploy.branches has no "${env}" entry. Add deploy.branches.${env} (the git branch that deploys to ${env}) or remove "${env}" from the done map.`
      );
    }
  }
}

/**
 * Read `deploy.order` as a string array, if present. A non-string entry is a
 * decision-ready error, never silently dropped — dropping one would silently
 * change the promotion order.
 * @param config - Parsed config value
 * @param source - Config source shown in errors
 * @returns Ordered env names (lowest first), or undefined when absent
 */
function readOrder(
  config: JsonValue,
  source: string
): readonly string[] | undefined {
  const order = getAtPath(config, "deploy.order");
  if (!Array.isArray(order)) return undefined;
  return order.map(entry => {
    if (typeof entry !== "string") {
      throw new Error(
        `Invalid deploy.order in ${source}: every entry must be an environment name string; found ${JSON.stringify(entry)}.`
      );
    }
    return entry;
  });
}

/**
 * Require `deploy.order` to name exactly the `deploy.branches` env set, with
 * no duplicate entries — a duplicate would otherwise survive set comparison
 * and produce duplicate rungs.
 * @param order - Configured order
 * @param branchEnvs - Environments present in `deploy.branches` (dupe-free)
 * @param source - Config source shown in errors
 */
function assertOrderMatchesBranches(
  order: readonly string[],
  branchEnvs: readonly string[],
  source: string
): void {
  const orderSet = new Set(order);
  const matches =
    orderSet.size === order.length &&
    orderSet.size === branchEnvs.length &&
    branchEnvs.every(env => orderSet.has(env));
  if (!matches) {
    throw new Error(
      `Invalid deploy.order in ${source}: its environment names must exactly match the keys of deploy.branches. deploy.order has [${order.join(", ")}]; deploy.branches has [${branchEnvs.join(", ")}].`
    );
  }
}

/**
 * Order the configured environments lowest-first. `deploy.order` wins when
 * present; otherwise the canonical `dev < staging < production` rank applies
 * and any unrankable custom name (with more than one env) is a
 * decision-ready error rather than a guess.
 * @param branchEnvs - Environments present in `deploy.branches`
 * @param order - Configured `deploy.order`, if any
 * @param canonical - Alias-aware canonical name resolver
 * @param source - Config source shown in errors
 * @returns Environments ordered lowest first
 */
function orderEnvironments(
  branchEnvs: readonly string[],
  order: readonly string[] | undefined,
  canonical: (env: string) => string,
  source: string
): readonly string[] {
  if (order !== undefined) {
    assertOrderMatchesBranches(order, branchEnvs, source);
    return order;
  }
  if (branchEnvs.length <= 1) return branchEnvs;
  const ranked = branchEnvs.map(env => {
    const rank = CANONICAL_ENV_RANKS[canonical(env)];
    if (rank === undefined) {
      throw new Error(
        `Invalid deploy configuration in ${source}: cannot order environment "${env}". Set deploy.order (environments listed lowest first, e.g. ["dev","staging","production"]) so Lisa knows the promotion order.`
      );
    }
    return { env, rank };
  });
  return [...ranked].sort((a, b) => a.rank - b.rank).map(entry => entry.env);
}

/**
 * Join ordered environments with their branch and done status. An env whose
 * done status resolves nowhere (possible only for custom names outside the
 * default tables) is skipped — a branch-only env is a deploy target without
 * tracker vocabulary, not an error.
 * @param orderedEnvs - Environments ordered lowest first
 * @param branches - Env-to-branch record
 * @param done - Configured done vocabulary
 * @param defaults - Tracker default done vocabulary
 * @param canonical - Alias-aware canonical name resolver
 * @param terminalEnv - Highest-ranked env of the configured universe
 * @returns The joined rungs, lowest environment first
 */
function buildRungs(
  orderedEnvs: readonly string[],
  branches: Readonly<Record<string, string>>,
  done: ConfiguredDone,
  defaults: Readonly<Record<string, string>>,
  canonical: (env: string) => string,
  terminalEnv: string | undefined
): readonly DeployLadderRung[] {
  return orderedEnvs.flatMap(env => {
    const branch = branches[env];
    const terminal = env === terminalEnv ? done.terminal : undefined;
    const doneStatus = done.map?.[env] ?? terminal ?? defaults[canonical(env)];
    return doneStatus === undefined || branch === undefined
      ? []
      : [{ env, branch, doneStatus }];
  });
}

/**
 * Resolve the deploy promotion ladder for a tracker from parsed config.
 *
 * The env universe is the keys of `deploy.branches`, joined with the
 * tracker's done vocabulary (configured entries win over the default
 * tables). `prod` ↔ `production` alias as one env iff exactly one spelling
 * appears across the configured surfaces (branches, done map, order); the
 * rung reports the configured spelling. Absent or empty `deploy` yields an
 * empty ladder, never an error.
 * @param config - Parsed `.lisa.config.json` value
 * @param tracker - Tracker whose done vocabulary binds the ladder
 * @param source - Config source shown in errors
 * @returns The ordered ladder with its terminal-only collapse flag
 */
export function resolveDeployLadder(
  config: JsonValue,
  tracker: Tracker,
  source: string
): DeployLadder {
  const branches = readBranches(config);
  const branchEnvs = Object.keys(branches);
  if (branchEnvs.length === 0) return { rungs: [], terminalOnly: false };
  const raw = readConfiguredDone(config, tracker);
  // Materialized defaults are invisible everywhere: strip them BEFORE the
  // union so they can never block the sole alias or raise an error.
  const doneMap =
    raw.map === undefined
      ? undefined
      : stripMaterializedDefaults(raw.map, DONE_DEFAULTS[tracker]);
  const done: ConfiguredDone = {
    ...(doneMap === undefined ? {} : { map: doneMap }),
    ...(raw.terminal === undefined ? {} : { terminal: raw.terminal }),
  };
  const order = readOrder(config, source);
  const union = new Set([
    ...branchEnvs,
    ...Object.keys(doneMap ?? {}),
    ...(order ?? []),
  ]);
  const soleProdAlias = union.has("prod") && !union.has("production");
  const canonical = (env: string): string =>
    soleProdAlias && env === "prod" ? "production" : env;
  if (doneMap !== undefined) {
    assertDoneEnvsHaveBranches(doneMap, branchEnvs, source);
  }
  const ordered = orderEnvironments(branchEnvs, order, canonical, source);
  const terminalEnv = ordered.at(-1);
  const rungs = buildRungs(
    ordered,
    branches,
    done,
    DONE_DEFAULTS[tracker],
    canonical,
    terminalEnv
  );
  // terminalOnly guards DSS-2's native closure: a sole surviving LOWER rung
  // (skip-collapsed ladder) must never be treated as the terminal env.
  const terminalOnly =
    rungs.length === 1 &&
    rungs[0] !== undefined &&
    rungs[0].env === terminalEnv;
  return {
    rungs,
    terminalOnly,
    ...(terminalEnv === undefined ? {} : { terminalEnv }),
  };
}

/** Strict ISO-8601 UTC timestamp (`Z` suffix, optional milliseconds). */
const ISO_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;

/**
 * Validate the optional provisioned-artifact id map.
 * @param value - Untrusted field value
 * @param source - Config source shown in errors
 * @returns Valid id record or undefined
 */
function validateProvisioned(
  value: unknown,
  source: string
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) {
    throw new Error(
      `Invalid deployStatusSync.provisioned in ${source}: expected an object`
    );
  }
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, id]) => {
      const valid = optionalString(
        id,
        source,
        `deployStatusSync.provisioned.${key}`
      );
      return valid === undefined ? [] : [[key, valid] as const];
    })
  );
}

/**
 * Validate the optional Linear binding mode.
 * @param value - Untrusted field value
 * @param source - Config source shown in errors
 * @returns Valid binding or undefined
 */
function validateLinearBinding(
  value: unknown,
  source: string
): "labels" | "states" | undefined {
  if (value === undefined) return undefined;
  if (value !== "labels" && value !== "states") {
    throw new Error(
      `Invalid deployStatusSync.linearBinding in ${source}: expected "labels" or "states"`
    );
  }
  return value;
}

/**
 * Validate the optional verification timestamp as strict ISO-8601 UTC.
 * @param value - Untrusted field value
 * @param source - Config source shown in errors
 * @returns Valid timestamp or undefined
 */
function validateVerifiedAt(
  value: unknown,
  source: string
): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== "string" ||
    !ISO_UTC_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error(
      `Invalid deployStatusSync.verifiedAt in ${source}: expected an ISO-8601 UTC timestamp (e.g. 2026-01-01T00:00:00Z)`
    );
  }
  return value;
}

/**
 * Validate the optional `deployStatusSync` config section. Unknown fields
 * inside the section are ignored in the typed view; the raw JSON round-trip
 * preserves them.
 * @param value - Untrusted section value
 * @param source - Config source shown in errors
 * @returns Typed section, or undefined when absent
 */
export function validateDeployStatusSyncConfig(
  value: unknown,
  source: string
): DeployStatusSyncConfig | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) {
    throw new Error(
      `Invalid deployStatusSync in ${source}: expected an object`
    );
  }
  const tier = optionalString(value.tier, source, "deployStatusSync.tier");
  const provisioned = validateProvisioned(value.provisioned, source);
  const linearBinding = validateLinearBinding(value.linearBinding, source);
  const verifiedAt = validateVerifiedAt(value.verifiedAt, source);
  return {
    ...(tier === undefined ? {} : { tier }),
    ...(provisioned === undefined ? {} : { provisioned }),
    ...(linearBinding === undefined ? {} : { linearBinding }),
    ...(verifiedAt === undefined ? {} : { verifiedAt }),
  };
}
