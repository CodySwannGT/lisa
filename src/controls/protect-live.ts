/**
 * What a repository's merge protection says now, compared with what the
 * control register derives.
 *
 * Reading is one pass of the shipped reconciler's `readLivePolicy`: the
 * rulesets, each ruleset's detail, and the repository itself. That last read
 * carries the two other facts the command needs — the default branch, and
 * whether the signed-in account administers the repository — so permission is
 * learned by reading, never by trying a write and seeing it fail.
 *
 * Comparing is the reconciler's `reconcileContexts`, over the rulesets that
 * are actually enforced on the branch. A ruleset that is disabled, or that
 * covers other branches, requires nothing there and is left out.
 * @module controls/protect-live
 */
import type { DerivedCheck } from "./protect-derive.js";
import { rulesetsBlock } from "./protect-derive.js";
import type {
  CheckRecord,
  ContextDrift,
  GhRunner,
  LiveRuleset,
  ProtectionModules,
} from "./protect-modules.js";
import type { PermissionProbe } from "./protect-types.js";

/** One successful read of the repository on the platform. */
export interface LiveState {
  /** Every branch ruleset, in full. */
  readonly rulesets: readonly LiveRuleset[];
  /** The repository's default branch, when the platform named it. */
  readonly defaultBranch: string | null;
  readonly permission: PermissionProbe;
}

/** A read of the platform, or the reason there is none. */
export type LiveRead =
  | { readonly ok: true; readonly state: LiveState }
  | { readonly ok: false; readonly reason: string };

/** The derived checks, as the reconciler's comparison takes them. */
export interface Requirement {
  /** The names that may be required as things stand. */
  readonly declared: readonly string[];
  /** Checks the configuration places in a named ruleset, with any pin. */
  readonly configured: {
    readonly homes: Readonly<Record<string, string>>;
    readonly pins: Readonly<Record<string, number>>;
    readonly records: readonly CheckRecord[];
  };
  /** The names another app reports. */
  readonly awaited: readonly string[];
  /** The app each awaited check is pinned to, where the declaration says. */
  readonly awaitedPins: Readonly<Record<string, number>>;
}

/** The comparison, and what it was made of. */
export interface Comparison {
  readonly drift: ContextDrift;
  /** The awaited checks with the ruleset each one belongs in. */
  readonly awaitedRecords: readonly CheckRecord[];
  /** That ruleset by check name, for routing a change. */
  readonly awaitedHomes: Readonly<Record<string, string>>;
}

/** The permission answer when no read of the repository succeeded. */
export const PERMISSION_NOT_READ: PermissionProbe = {
  can_change: null,
  detail:
    "The repository was not read, so it is not known whether the signed-in account may change its settings.",
};

/**
 * Say whether the signed-in account may change merge protection.
 *
 * Only an explicit `admin: true` counts. An answer with no permission block —
 * an anonymous read of a public repository gives one — is `null`, and `null`
 * is never treated as yes.
 * @param settings - The repository as the platform returned it
 * @returns The probe's answer
 */
export function permissionOf(
  settings: Readonly<Record<string, unknown>>
): PermissionProbe {
  const permissions = settings.permissions;
  const admin =
    permissions !== null && typeof permissions === "object"
      ? (Reflect.get(permissions, "admin") as unknown)
      : undefined;
  if (admin === true) {
    return {
      can_change: true,
      detail:
        "The platform reports that the signed-in account has administrator access to this repository.",
    };
  }
  return admin === false
    ? {
        can_change: false,
        detail:
          "The platform reports that the signed-in account does not have administrator access to this repository, which changing merge protection needs.",
      }
    : {
        can_change: null,
        detail:
          "The platform did not say what the signed-in account may do (is the gh command signed in?), so it is treated as not allowed to change settings.",
      };
}

/**
 * Read a repository's merge protection, default branch and permission.
 * @param repository - `owner/name`
 * @param gh - A runner that only reads
 * @param modules - The shipped scripts
 * @returns The state, or why it could not be read
 */
export function readLiveState(
  repository: string,
  gh: GhRunner,
  modules: ProtectionModules
): LiveRead {
  const live = modules.reconcile.readLivePolicy({ repo: repository, gh });
  if (!live.ok) {
    return {
      ok: false,
      reason: `${live.unproven.reason}: ${live.unproven.detail}`.replaceAll(
        /\s+/gu,
        " "
      ),
    };
  }
  const branch = live.settings.default_branch;
  return {
    ok: true,
    state: {
      rulesets: live.rulesets,
      defaultBranch:
        typeof branch === "string" && branch !== "" ? branch : null,
      permission: permissionOf(live.settings),
    },
  };
}

/**
 * Keep the rulesets that are enforced on one branch.
 * @param rulesets - Rulesets as the platform returned them
 * @param branch - The branch
 * @param defaultBranch - The repository's default branch, when known
 * @param modules - The shipped scripts
 * @returns The rulesets that are active and cover the branch
 */
export function governing<T>(
  rulesets: readonly T[],
  branch: string,
  defaultBranch: string | null,
  modules: ProtectionModules
): readonly T[] {
  const branches =
    defaultBranch === null ? [branch] : [...new Set([branch, defaultBranch])];
  return rulesets.filter(ruleset => {
    const reach = modules.reach.rulesetReach({
      ruleset,
      branches,
      defaultBranch: defaultBranch ?? undefined,
    });
    return reach.verdict === "governs" && reach.matched.includes(branch);
  });
}

/**
 * Put the derived checks in the form the reconciler compares.
 * @param checks - The derived checks
 * @param config - The parsed `.lisa.config.json`, or nothing
 * @param modules - The shipped scripts
 * @returns The requirement
 */
export function requirementOf(
  checks: readonly DerivedCheck[],
  config: Readonly<Record<string, unknown>> | undefined,
  modules: ProtectionModules
): Requirement {
  const requirable = checks.filter(check => check.held === null);
  const declared = requirable.map(check => check.context);
  const placed = rulesetsBlock(config)?.requiredChecks;
  const ours = Object.fromEntries(
    Object.entries(
      placed !== null && typeof placed === "object" ? placed : {}
    ).map(([ruleset, entries]) => [
      ruleset,
      Array.isArray(entries)
        ? entries.filter(
            (entry: unknown) =>
              entry !== null &&
              typeof entry === "object" &&
              declared.includes(String(Reflect.get(entry, "context")))
          )
        : [],
    ])
  );
  const awaited = requirable.filter(check => check.awaited);
  return {
    declared,
    configured: modules.reconcile.declaredChecks(ours),
    awaited: awaited.map(check => check.context),
    awaitedPins: Object.fromEntries(
      awaited.flatMap(check =>
        check.appId === null ? [] : [[check.context, check.appId] as const]
      )
    ),
  };
}

/**
 * Compare the requirement with the rulesets enforced on the branch.
 *
 * An awaited check is compared in the ruleset the reconciler would write it
 * to, with its declared pin, exactly as `lisa-reconcile-policy.mjs` does; a
 * check a pipeline job reports is satisfied by any enforced ruleset.
 * @param requirement - The derived checks
 * @param enforced - The rulesets enforced on the branch
 * @param rulesetName - The ruleset the operator named, or `null`
 * @param modules - The shipped scripts
 * @returns The comparison
 */
export function compareWithLive(
  requirement: Requirement,
  enforced: readonly LiveRuleset[],
  rulesetName: string | null,
  modules: ProtectionModules
): Comparison {
  const { reconcile } = modules;
  const { configured } = requirement;
  const home = reconcile.awaitedHome({ rulesets: enforced }, rulesetName);
  const awaitedRecords = requirement.awaited
    .map(
      (context): CheckRecord => ({
        context,
        ...(home === null ? {} : { ruleset: home }),
        ...(requirement.awaitedPins[context] === undefined
          ? {}
          : { integration_id: requirement.awaitedPins[context] }),
      })
    )
    .filter(
      record =>
        !configured.records.some(
          explicit =>
            explicit.context === record.context &&
            explicit.ruleset === record.ruleset
        )
    );
  return {
    drift: reconcile.reconcileContexts({
      declared: requirement.declared,
      live: reconcile.liveContexts(enforced),
      homes: configured.homes,
      pins: configured.pins,
      records: configured.records,
      awaited: awaitedRecords,
    }),
    awaitedRecords,
    awaitedHomes:
      home === null
        ? {}
        : Object.fromEntries(
            requirement.awaited.map(context => [context, home] as const)
          ),
  };
}
