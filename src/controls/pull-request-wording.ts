/**
 * What a pull-request result says to the person reading it.
 *
 * Each sentence is read by whoever stands at the gate, so each one says in
 * plain words what the hosting platform was found to do, and what would
 * change it. Nothing here decides a result; it only words one.
 * @module controls/pull-request-wording
 */
import { CANARY_BRANCH_PREFIX } from "./canary-names.js";
import type { ProofEntryReason, ProofHalf } from "./proof-types.js";
import { HALF_NAMES } from "./proof-wording.js";
import { platformLabel } from "./protect-platform.js";
import {
  GITHUB_PLATFORM,
  UNKNOWN_PLATFORM,
  type PlatformFacts,
} from "./protect-types.js";
import type { ControlRegisterEntry } from "./register-types.js";

/** The option that asks for canary pull requests. */
export const CANARIES_FLAG = "--pull-request-canaries";

/** How every result that read the settings and ran nothing begins. */
const OBSERVED = "Observed, not exercised.";

/**
 * Quote check names in a sentence.
 * @param names - The check names
 * @returns Each in quotes, joined with `and`
 */
function quoted(names: readonly string[]): string {
  return names.map(name => JSON.stringify(name)).join(" and ");
}

/**
 * Name the branch in a sentence.
 * @param branch - The branch, or `null` when none is known
 * @returns For example `main`, or `the default branch`
 */
function on(branch: string | null): string {
  return branch ?? "the default branch";
}

/**
 * Say that the platform requires every check of an entry.
 * @param checks - The entry's checks
 * @param branch - The protected branch
 * @returns The sentence
 */
export function requiredDetail(
  checks: readonly string[],
  branch: string | null
): string {
  return `${OBSERVED} The hosting platform requires ${quoted(checks)} on ${on(branch)} before a pull request can be merged. No pull request was opened to show that the check turns a violating change away; run again with ${CANARIES_FLAG} to exercise it.`;
}

/**
 * Say that the platform does not require a check of an entry.
 * @param missing - The entry's checks the platform does not require
 * @param branch - The protected branch
 * @returns The sentence
 */
export function notRequiredDetail(
  missing: readonly string[],
  branch: string | null
): string {
  return `${OBSERVED} The hosting platform does not require ${quoted(missing)} on ${on(branch)}, so a pull request can be merged without it passing. Run lisa controls protect to see the change that would require it.`;
}

/**
 * Say that the settings could not be read.
 * @param why - What the read answered
 * @returns The sentence
 */
export function unreadDetail(why: string): string {
  return `It is not known whether the hosting platform requires this entry's check, because its merge-protection settings could not be read: ${why}`;
}

/**
 * Say that it is not known whether a check is required, because the ruleset
 * that requires it may or may not cover the branch.
 * @param check - The check
 * @param ruleset - The ruleset that requires it
 * @param ruleset.name - Its name
 * @param ruleset.reason - Why its reach could not be worked out
 * @param branch - The protected branch
 * @returns The sentence
 */
export function reachUnknownDetail(
  check: string,
  ruleset: { readonly name: string; readonly reason: string },
  branch: string | null
): string {
  return `It is not known whether the hosting platform requires ${quoted([check])} on ${on(branch)}. The ruleset ${JSON.stringify(ruleset.name)} requires it, and it could not be worked out whether that ruleset covers ${on(branch)}: ${ruleset.reason}. Look at that ruleset's branch conditions on the hosting platform.`;
}

/**
 * Say why a repository's platform was not asked anything.
 * @param platform - Where the repository is hosted
 * @returns The sentence
 */
export function platformNotReached(platform: PlatformFacts): string {
  if (platform.name === UNKNOWN_PLATFORM) {
    return "Nothing says where this repository is hosted (it has no origin remote on a known platform), so nothing was asked of any platform.";
  }
  return platform.name === GITHUB_PLATFORM
    ? (platform.note ?? "The repository on GitHub could not be identified.")
    : `This repository is hosted on ${platformLabel(platform.name)}. Merge protection is read, and canary pull requests are opened, on github.com only, so nothing was asked of the platform and nothing was created.`;
}

/**
 * Say that the register does not ask the platform to stop a merge.
 * @param entry - The entry
 * @returns The sentence
 */
export function notAskedDetail(entry: ControlRegisterEntry): string {
  const why =
    entry.tier === "authoritative"
      ? "it is optional on pull requests"
      : "its tier is advisory";
  return `No proof was run. The control register does not ask the hosting platform to stop a merge for this entry (${why}), so there is no setting to read and nothing to exercise.`;
}

/** Said of an entry that reports no check on a pull request. */
export const NO_CHECK_DETAIL =
  "No proof was run. No check name derives from this entry for pull requests, so there is nothing the hosting platform could require.";

/**
 * Say that canaries were asked for and the account may not create them.
 * @param repository - `owner/name`
 * @param probe - What the platform said about the signed-in account
 * @returns The sentence
 */
export function permissionDetail(repository: string, probe: string): string {
  return `No canary pull request was opened. Opening one needs write access to ${repository} (the push permission): it creates a branch under ${CANARY_BRANCH_PREFIX} and a pull request. ${probe}`;
}

/** What the platform said when the account may write. */
export const MAY_WRITE =
  "The platform reports that the signed-in account has write access to this repository.";

/** What the platform said when the account may not write. */
export const MAY_NOT_WRITE =
  "The platform reports that the signed-in account does not have write access to this repository.";

/** What is said when the platform did not answer about write access. */
export const WRITE_NOT_SAID =
  "The platform did not say what the signed-in account may do (is the gh command signed in?), so it is treated as not allowed to create anything.";

/** The sentence for each result two canary halves decide together. */
const CANARY_VERDICTS: Partial<Record<ProofEntryReason, string>> = {
  proved:
    "The hosting platform would not let the violating change through, because the entry's required check failed on it, and the same check passed on the clean change.",
  "violation-accepted":
    "The entry's required check did not stop the violating change on a pull request, so it does not stop what it is there to stop.",
  "clean-rejected":
    "The entry's required check failed on the clean change, so it stops changes that do not break the rule.",
  "violation-accepted-clean-rejected":
    "The entry's required check did not stop the violating change and failed on the clean change.",
};

/**
 * Say what the two canary halves of an entry showed together.
 * @param reason - The entry's reason
 * @param unanswered - The half that gave no answer, when the result is
 *   `unknown`
 * @param unanswered.half - Which half
 * @param unanswered.detail - Its sentence
 * @returns The sentence
 */
export function canaryVerdictDetail(
  reason: ProofEntryReason,
  unanswered?: { readonly half: ProofHalf; readonly detail: string }
): string {
  const sentence = CANARY_VERDICTS[reason];
  if (sentence !== undefined) return sentence;
  return unanswered === undefined
    ? "The canary pull requests gave no answer that can be relied on."
    : `The ${HALF_NAMES[unanswered.half]} change gave no answer that can be relied on. ${unanswered.detail}`;
}

/**
 * Write what each of an entry's checks concluded on a canary.
 * @param checks - The entry's checks with what each concluded
 * @returns For example `"Lint": failure; "Tests": no result`
 */
export function conclusionsText(
  checks: readonly {
    readonly context: string;
    readonly conclusion: string | null;
  }[]
): string {
  return checks
    .map(
      check =>
        `${JSON.stringify(check.context)}: ${check.conclusion ?? "no result"}`
    )
    .join("; ");
}
