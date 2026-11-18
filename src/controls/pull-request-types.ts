/**
 * What `lisa controls attest` records about the pull-request moment.
 *
 * Whether a pull request is stopped is decided by the hosting platform, not
 * by anything that runs in a checkout. So the result of an entry's
 * pull-request enforcement point comes from the platform, in one of two ways
 * ({@link ProofRung}):
 *
 * - `observed` — the platform's merge-protection settings were read. This is
 *   the default, and it creates nothing.
 * - `exercised` — the operator asked for canaries: two real pull requests,
 *   one carrying each half of the entry's proof, whose merge eligibility the
 *   platform answered. A canary is never merged.
 *
 * ## Where the results go
 *
 * A proof run holds one result per register entry. That stays true:
 *
 * - An entry enforced on pull requests and **not** at commit or push gets
 *   its one result from here. In `entries` it carries `moment:
 *   "pull-request"` and a `rung`.
 * - An entry enforced at commit or push **and** on pull requests keeps the
 *   result its local proof gave it. What was learned about its pull-request
 *   point is an additional result, in `pull_request.points` only.
 *
 * `pull_request.points` holds one {@link PullRequestPoint} for every entry
 * that has a pull-request enforcement point, of either kind, each with its
 * own `rung`. `settles_entry` says which kind it is.
 * @module controls/pull-request-types
 */
import type { ProofEntryResult, ProofRun, ProofRung } from "./proof-types.js";
import type { PlatformFacts, SentRequest } from "./protect-types.js";

/** The moment these results stand for. */
export const PULL_REQUEST_POINT_MOMENT = "pull-request";

/** How the run was asked to learn about pull requests. */
export type PullRequestMode = "observed" | "canaries";

/**
 * What the platform's settings say about an entry's checks.
 *
 * - `required`: every check that proves the entry is required before a merge.
 * - `not-required`: at least one is not.
 * - `unknown`: the settings could not be read.
 * - `not-asked`: there was nothing to read them for. The register does not
 *   ask the platform to stop a merge for the entry, or the entry reports no
 *   check on a pull request.
 */
export type ObservedState =
  | "required"
  | "not-required"
  | "unknown"
  | "not-asked";

/** One check an entry is proved by on a pull request, as the settings stand. */
export interface ObservedCheck {
  /** The exact name the platform matches on. */
  readonly context: string;
  readonly state: Exclude<ObservedState, "not-asked">;
  /**
   * The apps the platform's settings pin the check to; empty when any
   * source may report it, and when the settings were not read.
   */
  readonly app_ids: readonly number[];
}

/** What the platform said about one canary pull request. */
export interface MergeEligibility {
  /** Whether the platform could merge it cleanly; `null` while it works it out. */
  readonly mergeable: boolean | null;
  /** The platform's own word for it, for example `blocked` or `draft`. */
  readonly mergeable_state: string | null;
  /** What each of the entry's checks concluded on the canary. */
  readonly checks: readonly {
    readonly context: string;
    /** For example `success` or `failure`; `null` when it never reported. */
    readonly conclusion: string | null;
  }[];
}

/** One canary: what was created, what the platform said, and its removal. */
export interface CanaryRecord {
  readonly entry_id: string;
  readonly half: "violation" | "clean";
  readonly branch: string;
  /** The pull request's number, or `null` when none was opened. */
  readonly pull_request: number | null;
  /**
   * Whether it was opened as a draft; `null` when none was opened. Only a
   * draft is ever read: `false` is a pull request the platform opened as an
   * ordinary one although a draft was asked for, closed without being read.
   */
  readonly draft: boolean | null;
  /** The canary commit, or `null` when none was made. */
  readonly head_sha: string | null;
  readonly created_at: string;
  /** The platform's answer, or `null` when it gave none. */
  readonly eligibility: MergeEligibility | null;
  /** Whether the pull request is closed. True when none was opened. */
  readonly closed: boolean;
  /** Whether the branch is gone. True when none was created. */
  readonly branch_removed: boolean;
  /**
   * Whether the platform says the pull request was merged, asked before it
   * was closed. It must never be `true`: this command merges nothing.
   * `null` when none was opened, or when the platform could not be asked.
   */
  readonly merged: boolean | null;
  /** Why something was left behind, or `null` when nothing was. */
  readonly cleanup_problem: string | null;
}

/** The result of one entry's pull-request enforcement point. */
export interface PullRequestPoint extends ProofEntryResult {
  readonly moment: typeof PULL_REQUEST_POINT_MOMENT;
  /** How the result was obtained. Always present. */
  readonly rung: ProofRung;
  /**
   * Whether this is the entry's one result in `entries` (true), or an
   * additional result for an entry its commit or push proof settled (false).
   */
  readonly settles_entry: boolean;
  /** What the merge-protection settings say about the entry's checks. */
  readonly observed: ObservedState;
  /** Each check that proves the entry on a pull request. */
  readonly checks: readonly ObservedCheck[];
  /** When the settings were read or the canaries finished, in UTC. */
  readonly completed_at: string;
}

/** What a sweep of earlier runs' canaries did. */
export interface CanarySweep {
  /** Branches removed: older than the lifetime, made by another run. */
  readonly removed: readonly string[];
  /** Branches under the prefix that were left alone, and why. */
  readonly kept: readonly {
    readonly branch: string;
    readonly why: "live" | "unrecognised";
  }[];
  /** What could not be listed or removed. */
  readonly problems: readonly string[];
}

/** The head of the protected branch around the canaries. */
export interface BaseHead {
  readonly before: string | null;
  readonly after: string | null;
  /** `null` when one of the two could not be read. */
  readonly unchanged: boolean | null;
}

/** Whether the signed-in account may create a branch and a pull request. */
export interface WriteProbe {
  /** `true` or `false` as the platform answered; `null` when it did not say. */
  readonly can_write: boolean | null;
  readonly detail: string;
}

/** Everything the run did and learned about the pull-request moment. */
export interface PullRequestSettlement {
  readonly mode: PullRequestMode;
  readonly platform: PlatformFacts;
  /** The branch whose merge protection was read, when one is known. */
  readonly branch: string | null;
  /** How old a canary must be before a later run removes it. */
  readonly canary_lifetime_seconds: number;
  /** This run's identifier. `null` unless canaries were asked for. */
  readonly run_id: string | null;
  /** The write-access probe. `null` unless canaries were asked for. */
  readonly permission: WriteProbe | null;
  /** `null` unless canaries were opened or swept. */
  readonly sweep: CanarySweep | null;
  /** `null` unless a canary was attempted. */
  readonly base_head: BaseHead | null;
  /** Every canary this run attempted, in order. */
  readonly canaries: readonly CanaryRecord[];
  /** Every request, in the order it was made. */
  readonly requests: readonly SentRequest[];
  /** One per register entry that has a pull-request enforcement point. */
  readonly points: readonly PullRequestPoint[];
}

/** A proof run with its pull-request moment settled. */
export interface SettledProofRun extends ProofRun {
  readonly pull_request: PullRequestSettlement;
}

/**
 * Read the pull-request part of a proof run, when it has one.
 * @param run - A proof run
 * @returns What was recorded about pull requests, or `null` when no entry of
 *   the register has a pull-request enforcement point
 */
export function pullRequestSettlementOf(
  run: ProofRun
): PullRequestSettlement | null {
  const settled = (run as Partial<SettledProofRun>).pull_request;
  return settled ?? null;
}

/**
 * Say how an entry's result was obtained.
 * @param entry - One result of a proof run
 * @returns Its rung; `exercised` for a commit or push result whose halves
 *   were run; `null` when nothing was obtained
 */
export function rungOf(entry: ProofEntryResult): ProofRung | null {
  if (entry.rung !== undefined) return entry.rung;
  return entry.halves.length > 0 ? "exercised" : null;
}
