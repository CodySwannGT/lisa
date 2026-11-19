/**
 * Reading what the hosting platform requires before a merge, for the
 * entries of a control register that are enforced on pull requests.
 *
 * This is the reading half of `lisa controls protect`, and nothing else. The
 * checks an entry is proved by come from `deriveRequiredChecks`, the platform
 * is found by `detectPlatform`, the settings are read by `readLiveState` and
 * compared by `compareWithLive` — the same functions, called the same way.
 * What is left out is everything `protect` does after reading: no check is
 * asked about on other pull requests, no handover file is written, and no
 * change is ever planned or sent.
 *
 * Every request goes through the recording door in `./protect-requests.ts`,
 * and only its `read` side is used here. That side refuses anything that is
 * not a read without sending it, so this module cannot create or change
 * anything on the platform whatever it is handed.
 * @module controls/pull-request-observe
 */
import {
  compareWithLive,
  governing,
  possiblyRequired,
  readLiveState,
  unsettled,
  type UnsettledRuleset,
} from "./protect-live.js";
import {
  prepare,
  type Prepared,
  type ProtectDependencies,
} from "./protect-prepare.js";
import {
  UNKNOWN_PLATFORM,
  isBranchName,
  type PlatformFacts,
  type SentRequest,
} from "./protect-types.js";
import type { ProofEntryReason } from "./proof-types.js";
import { platformNotReached } from "./pull-request-wording.js";
import type { ControlRegister } from "./register-types.js";

/** Why the settings say nothing about any entry. */
interface Unread {
  readonly reason: Extract<
    ProofEntryReason,
    "merge-protection-unread" | "platform-not-reached"
  >;
  /** The same, as a sentence for the operator. */
  readonly detail: string;
}

/** What one read of the platform's merge protection showed. */
export interface Observation {
  readonly platform: PlatformFacts;
  /** The branch whose settings were compared, when one is known. */
  readonly branch: string | null;
  /**
   * The check names the platform requires on the branch, of the ones the
   * register derives; `null` when the settings were not read.
   */
  readonly required: ReadonlySet<string> | null;
  /** Why the settings were not read, or `null` when they were. */
  readonly unread: Unread | null;
  /**
   * The apps the platform's settings pin each required check to, by check
   * name. A check with no entry here may be reported by any source.
   */
  readonly pins: ReadonlyMap<string, readonly number[]>;
  /**
   * The checks it is not known to be required or not: each reads as not
   * required, while a ruleset whose reach could not be worked out requires
   * it. By check name, with that ruleset.
   */
  readonly unsettled: ReadonlyMap<string, UnsettledRuleset>;
  /**
   * The checks that prove an entry on a pull request.
   * @param entryId - The register entry's identifier
   * @returns The check names, which may be none; `undefined` when they are
   *   not known, or the register does not ask the platform to stop a merge
   *   for the entry
   */
  readonly checksOf: (entryId: string) => readonly string[] | undefined;
  /** Every request made so far, in order. */
  readonly requests: () => readonly SentRequest[];
  /** What was gathered before the platform was asked, when it could be. */
  readonly prepared: Prepared | null;
}

/**
 * Put what went wrong in words.
 * @param error - What was thrown
 * @returns Its message
 */
function said(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The part of an observation that comes from reading the settings. */
type SettingsRead = Pick<
  Observation,
  "branch" | "required" | "unread" | "pins" | "unsettled"
>;

/** No check is known to be pinned to an app. */
const NO_PINS: ReadonlyMap<string, readonly number[]> = new Map();

/** No check is of unknown standing. */
const NONE_UNSETTLED: ReadonlyMap<string, UnsettledRuleset> = new Map();

/**
 * Say that the settings were not read.
 * @param detail - Why
 * @returns The part of an observation that says so
 */
function notRead(detail: string): SettingsRead {
  return {
    branch: null,
    required: null,
    unread: { reason: "merge-protection-unread", detail },
    pins: NO_PINS,
    unsettled: NONE_UNSETTLED,
  };
}

/**
 * The observation of a repository nothing could be gathered about.
 * @param problem - Why
 * @returns The observation
 */
function unprepared(problem: string): Observation {
  return {
    platform: {
      name: UNKNOWN_PLATFORM,
      repository: null,
      detected_from: "none",
      reachable: false,
      note: problem,
    },
    ...notRead(problem),
    checksOf: () => undefined,
    requests: () => [],
    prepared: null,
  };
}

/**
 * Read the settings of a repository the platform can be asked about.
 * @param prepared - What is known about the repository
 * @param repository - `owner/name`
 * @returns The branch and the checks it requires, or why they were not read
 */
function readRequired(prepared: Prepared, repository: string): SettingsRead {
  const { modules, log, derived, requirement } = prepared;
  const read = readLiveState(repository, log.read, modules);
  if (!read.ok) return notRead(read.reason);
  const { defaultBranch, rulesets } = read.state;
  if (defaultBranch === null) {
    return notRead(
      "the platform did not name the repository's default branch."
    );
  }
  // The name goes into request paths when canaries are opened, so it gets
  // the check an operator's own --branch gets.
  if (!isBranchName(defaultBranch)) {
    return notRead(
      `the platform names ${JSON.stringify(defaultBranch)} as the repository's default branch, which is not a branch name that can be put in a request.`
    );
  }
  const enforced = governing(rulesets, defaultBranch, defaultBranch, modules);
  const compared = compareWithLive(requirement, enforced, null, modules);
  // A check the comparison leaves out, because this repository holds it
  // back, is still required when the platform's settings name it.
  const live = modules.reconcile.liveContexts(enforced);
  const named = new Set(live.map(context => context.context));
  const held = derived.checks
    .filter(check => check.held !== null && named.has(check.context))
    .map(check => check.context);
  const pinsOf = (name: string): readonly number[] => [
    ...new Set(
      live.flatMap(context =>
        context.context === name && context.integration_id !== null
          ? [context.integration_id]
          : []
      )
    ),
  ];
  return {
    branch: defaultBranch,
    required: new Set([...compared.drift.matched, ...held]),
    unread: null,
    pins: new Map([...named].map(name => [name, pinsOf(name)])),
    // A check that reads as not required while a ruleset of unknown reach
    // requires it is not known to be either.
    unsettled: possiblyRequired(
      compared.drift.missing,
      unsettled(rulesets, defaultBranch, defaultBranch, modules)
    ),
  };
}

/**
 * Read what the hosting platform requires for a register's pull-request
 * entries. Sends reads only, and none at all for a repository that is not on
 * github.com.
 * @param root - Real path of the repository
 * @param register - The control register
 * @param dependencies - Replaceable collaborators
 * @returns What the settings showed
 */
export async function observeMergeProtection(
  root: string,
  register: ControlRegister,
  dependencies: ProtectDependencies = {}
): Promise<Observation> {
  try {
    const preparation = await prepare(
      root,
      {},
      {
        ...dependencies,
        generate: () => Promise.resolve({ problems: null, register, text: "" }),
      }
    );
    if (preparation.problems !== null) {
      return unprepared(preparation.problems.join(" "));
    }
    const { prepared } = preparation;
    const { platform, derived, log } = prepared;
    const checks = new Map(
      derived.entries.map(({ entry, checks: names }) => [entry.id, names])
    );
    const shared = {
      platform,
      checksOf: (entryId: string) => checks.get(entryId),
      requests: log.requests,
      prepared,
    };
    // Nothing the register asks the platform to enforce: nothing to read.
    const unasked = {
      branch: null,
      required: null,
      pins: NO_PINS,
      unsettled: NONE_UNSETTLED,
    };
    if (derived.entries.length === 0) {
      return { ...shared, ...unasked, unread: null };
    }
    if (!platform.reachable || platform.repository === null) {
      return {
        ...shared,
        ...unasked,
        unread: {
          reason: "platform-not-reached",
          detail: platformNotReached(platform),
        },
      };
    }
    try {
      return { ...shared, ...readRequired(prepared, platform.repository) };
    } catch (error) {
      // What was sent before the read failed is still part of the record.
      return { ...shared, ...notRead(said(error)) };
    }
  } catch (error) {
    return unprepared(said(error));
  }
}
