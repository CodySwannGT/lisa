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
 * covers other branches, requires nothing there and is left out. One whose
 * reach could not be worked out is left out too, and kept apart
 * ({@link unsettled}): what it requires is not known to be required on the
 * branch, and not known not to be.
 * @module controls/protect-live
 */
import { ACTIONS_INTEGRATION_ID } from "../health/ruleset-inspection.js";
import { compareCodeUnits } from "./canonical-json.js";
import type { DerivedCheck } from "./protect-derive.js";
import { rulesetsBlock } from "./protect-derive.js";
import type { PinOrigin } from "./protect-held.js";
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
  /**
   * How many rulesets the platform listed, the ones for tags and pushes
   * included. Creating one makes the list this much plus one.
   */
  readonly listed: number;
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
      listed: live.listed,
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
  return rulesets.filter(ruleset => {
    const reach = reachOf(ruleset, branch, defaultBranch, modules);
    return reach.verdict === "governs" && reach.matched.includes(branch);
  });
}

/**
 * Ask the shipped matcher what one ruleset covers.
 * @param ruleset - A ruleset as the platform returned it
 * @param branch - The branch
 * @param defaultBranch - The repository's default branch, when known
 * @param modules - The shipped scripts
 * @returns The matcher's answer
 */
function reachOf(
  ruleset: unknown,
  branch: string,
  defaultBranch: string | null,
  modules: ProtectionModules
): ReturnType<ProtectionModules["reach"]["rulesetReach"]> {
  return modules.reach.rulesetReach({
    ruleset,
    branches:
      defaultBranch === null ? [branch] : [...new Set([branch, defaultBranch])],
    defaultBranch: defaultBranch ?? undefined,
  });
}

/** A ruleset that may or may not be enforced on the branch. */
export interface UnsettledRuleset {
  /** The ruleset's name, or `""` when it has none that could be read. */
  readonly name: string;
  /** Why it could not be worked out whether it covers the branch. */
  readonly reason: string;
  /** The check names it would require there. */
  readonly checks: readonly string[];
}

/**
 * Find the rulesets whose reach could not be worked out.
 *
 * {@link governing} leaves such a ruleset out, because nothing shows that it
 * is enforced on the branch. Nothing shows that it is not, either. So a
 * check it requires is neither "required" nor "not required" there: it is
 * not known, and this is where that is kept from being lost.
 * @param rulesets - Rulesets as the platform returned them
 * @param branch - The branch
 * @param defaultBranch - The repository's default branch, when known
 * @param modules - The shipped scripts
 * @returns Each such ruleset with the checks it holds
 */
export function unsettled(
  rulesets: readonly LiveRuleset[],
  branch: string,
  defaultBranch: string | null,
  modules: ProtectionModules
): readonly UnsettledRuleset[] {
  return rulesets.flatMap(ruleset => {
    const reach = reachOf(ruleset, branch, defaultBranch, modules);
    if (reach.verdict !== "undetermined") return [];
    return [
      {
        name: reach.name,
        reason: reach.reason,
        // Read as if it were enforced: the question is what it would
        // require if it does cover the branch.
        checks: modules.reconcile
          .liveContexts([{ ...ruleset, enforcement: "active" }])
          .map(context => context.context),
      },
    ];
  });
}

/**
 * Say which checks a ruleset of unknown reach may already require.
 * @param names - The check names in question
 * @param doubtful - The rulesets whose reach could not be worked out
 * @returns For each such check, the ruleset that holds it and why its reach
 *   is not known
 */
export function possiblyRequired(
  names: readonly string[],
  doubtful: readonly UnsettledRuleset[]
): ReadonlyMap<string, UnsettledRuleset> {
  return new Map(
    names.flatMap(name => {
      const holder = doubtful.find(ruleset => ruleset.checks.includes(name));
      return holder === undefined ? [] : [[name, holder] as const];
    })
  );
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
 * Tell whether two declarations are about the same check in the same place.
 * @param left - One declaration
 * @param right - Another
 * @returns Whether both name the same check and the same ruleset, or none
 */
function samePair(left: CheckRecord, right: CheckRecord): boolean {
  return left.context === right.context && left.ruleset === right.ruleset;
}

/**
 * Count an awaited check that declares no app as required wherever an
 * enforced ruleset requires its name, whatever app that ruleset pins it to.
 *
 * The reconciler compares an awaited check that names no app with an
 * unpinned check in the ruleset it would write to, and calls anything else
 * missing. That is right for a tool that rewrites a ruleset to match a
 * declaration. It is wrong here: the platform's own settings page pins a
 * check to an app by default, so a host that already requires the check
 * read as not requiring it, and the repair replaced the host's pinned check
 * with one any source may report. A declaration that names no app has no
 * opinion about the app, so the name is the whole comparison, and a check
 * found this way is in no change.
 * @param drift - The reconciler's comparison
 * @param awaitedRecords - The awaited declarations that were compared
 * @param liveNames - Every check name an enforced ruleset requires
 * @returns The comparison, with those checks moved from missing to matched
 */
function requiredByName(
  drift: ContextDrift,
  awaitedRecords: readonly CheckRecord[],
  liveNames: ReadonlySet<string>
): ContextDrift {
  const anyApp = awaitedRecords.filter(
    record => record.integration_id === undefined
  );
  const missingRecords = drift.missingRecords.filter(
    record =>
      !(
        record.integration_id === undefined &&
        liveNames.has(record.context) &&
        anyApp.some(awaited => samePair(awaited, record))
      )
  );
  const stillMissing = new Set(missingRecords.map(record => record.context));
  const found = drift.missing.filter(name => !stillMissing.has(name));
  return {
    ...drift,
    missingRecords,
    missing: drift.missing.filter(name => stillMissing.has(name)),
    matched: [...drift.matched, ...found].sort(compareCodeUnits),
  };
}

/**
 * Say which app the change would require a missing check from.
 *
 * This is the reconciler's own rule for writing a check, restated so that
 * it can be known before a change is planned: the app a declaration names;
 * else none for a check another app reports; else GitHub Actions, which is
 * what reports a check a pipeline job runs.
 *
 * Which of the three it was is answered too, because it decides what an
 * operator can do when the check turns out to be reported by something else
 * ({@link PinOrigin}): an awaited check is opened to any source by leaving
 * its app out, a check placed under a ruleset's required checks is not, and
 * for a check a pipeline job reports there is nothing to declare.
 * @param record - One declaration the platform does not satisfy
 * @param requirement - The derived checks
 * @param awaitedRecords - The awaited declarations that were compared
 * @returns The app's id, or `null` when any source may report the check,
 *   and how it came to be chosen
 */
export function appToRequire(
  record: CheckRecord,
  requirement: Requirement,
  awaitedRecords: readonly CheckRecord[]
): { readonly appId: number | null; readonly origin: PinOrigin } {
  const awaited = awaitedRecords.some(
    candidate =>
      candidate.context === record.context &&
      (candidate.ruleset === undefined ||
        record.ruleset === undefined ||
        candidate.ruleset === record.ruleset)
  );
  const named =
    record.integration_id ??
    (record.ruleset === undefined
      ? { ...requirement.configured.pins, ...requirement.awaitedPins }[
          record.context
        ]
      : undefined);
  if (named !== undefined) {
    return { appId: named, origin: awaited ? "awaited" : "entry" };
  }
  if (awaited) return { appId: null, origin: "awaited" };
  // No app is declared and no gate awaits this record. A name some gate does
  // await got here through an entry under another ruleset's required checks,
  // and that entry is what leaves it to GitHub Actions.
  return {
    appId: ACTIONS_INTEGRATION_ID,
    origin: requirement.awaited.includes(record.context) ? "entry" : "pipeline",
  };
}

/**
 * Compare the requirement with the rulesets enforced on the branch.
 *
 * An awaited check that names its app is compared in the ruleset the
 * reconciler would write it to, with that app, exactly as
 * `lisa-reconcile-policy.mjs` does. One that names no app is satisfied by
 * its name in any enforced ruleset ({@link requiredByName}), and so is a
 * check a pipeline job reports.
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
  const live = reconcile.liveContexts(enforced);
  return {
    drift: requiredByName(
      reconcile.reconcileContexts({
        declared: requirement.declared,
        live,
        homes: configured.homes,
        pins: configured.pins,
        records: configured.records,
        awaited: awaitedRecords,
      }),
      awaitedRecords,
      new Set(live.map(context => context.context))
    ),
    awaitedRecords,
    awaitedHomes:
      home === null
        ? {}
        : Object.fromEntries(
            requirement.awaited.map(context => [context, home] as const)
          ),
  };
}
