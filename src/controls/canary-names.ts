/**
 * How a canary is named, and what a name says about whether it may be
 * removed.
 *
 * A canary is a branch and a pull request that `lisa controls attest` opens
 * on the hosting platform to see whether a required check stops a change. It
 * is the only thing the command ever creates there and the only thing it ever
 * deletes, so which branch counts as one is decided here, in one place, from
 * the name alone:
 *
 * ```
 * lisa-attest/<run>/<made>-<number>-<half>
 * ```
 *
 * - `lisa-attest/` is the reserved prefix. Nothing else may use it.
 * - `<run>` identifies the run that made it.
 * - `<made>` is when it was made, in UTC, to the second.
 * - `<number>` counts the run's canaries, and `<half>` is `violation` or
 *   `clean`.
 *
 * ## When a canary may be removed
 *
 * A run removes its own canaries as it goes. A run that is killed outright
 * cannot, so every run starts by sweeping what earlier runs left. The sweep
 * must never remove a canary another run is still using, and it must decide
 * that without guessing. It does so from the time in the name: no run keeps a
 * canary open longer than one half's time limit, which is at most thirty
 * minutes, so a canary older than {@link CANARY_LIFETIME_SECONDS} belongs to
 * no run that is still going. Anything younger is left alone, and so is any
 * branch under the prefix whose name does not say when it was made.
 *
 * The time in a name is read from the clock of the machine that made the
 * canary, and its age is judged by the clock of the machine that sweeps. The
 * rule therefore assumes the two clocks agree to within the difference
 * between the lifetime and the longest a canary is kept open: an hour and a
 * half. A name whose time is ahead of the sweeper's clock is never stale.
 * @module controls/canary-names
 */
import { randomBytes } from "node:crypto";

import type { ProofHalf } from "./proof-halves.js";

/** The prefix every canary branch starts with. Reserved for this command. */
export const CANARY_BRANCH_PREFIX = "lisa-attest/";

/** The word that marks a canary pull request's title and body. */
const CANARY_MARKER = "lisa-attest";

/**
 * How old a canary must be before a later run may remove it, in seconds.
 * Two hours: four times the longest any run keeps one open.
 */
export const CANARY_LIFETIME_SECONDS = 2 * 60 * 60;

/** A run identifier: lower-case letters and digits, safe in a branch name. */
const RUN_ID = /^[0-9a-z]{6,32}$/u;

/** A canary branch name, taken apart. */
const CANARY_BRANCH =
  /^lisa-attest\/([0-9a-z]{6,32})\/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z-(\d{1,4})-(violation|clean)$/u;

/** How many random bytes a generated run identifier is made of. */
const RUN_ID_BYTES = 6;

/** What a canary's name says. */
export interface CanaryName {
  /** The run that made it. */
  readonly runId: string;
  /** When it was made, to the second. */
  readonly createdAt: Date;
  /** Its number among the run's canaries, from 1. */
  readonly sequence: number;
  readonly half: ProofHalf;
}

/** What a canary pull request says about itself. */
export interface CanaryFacts {
  readonly runId: string;
  readonly createdAt: Date;
  /** The register entry the canary is a proof of. */
  readonly entryId: string;
  readonly half: ProofHalf;
}

/**
 * - `own`: this run made it.
 * - `stale`: another run made it longer ago than the lifetime, so no run is
 *   still using it and it may be removed.
 * - `live`: another run made it within the lifetime; it may still be in use.
 * - `unrecognised`: the name does not say who made it or when.
 */
export type CanaryStanding = "own" | "stale" | "live" | "unrecognised";

/**
 * Tell whether a text can be used as a run identifier.
 * @param value - The text
 * @returns Whether it is 6 to 32 lower-case letters and digits
 */
export function isRunId(value: string): boolean {
  return RUN_ID.test(value);
}

/**
 * Make a run identifier nobody else has.
 * @returns Twelve random hexadecimal digits
 */
export function newRunId(): string {
  return randomBytes(RUN_ID_BYTES).toString("hex");
}

/**
 * Write a time the way a canary's name carries it.
 * @param at - The time
 * @returns For example `20260304T050607Z`
 */
function stamp(at: Date): string {
  return `${at.toISOString().slice(0, 19).replaceAll(/[-:]/gu, "")}Z`;
}

/**
 * Name a canary branch.
 * @param name - The run, the time, the number and the half
 * @returns The branch name
 */
export function canaryBranch(name: CanaryName): string {
  return `${CANARY_BRANCH_PREFIX}${name.runId}/${stamp(name.createdAt)}-${String(name.sequence)}-${name.half}`;
}

/**
 * Read what a branch name says, when it is a canary's.
 * @param branch - The branch name, without `refs/heads/`
 * @returns The run, the time, the number and the half; `null` when the name
 *   is not exactly a canary's or its time is not a real time
 */
export function parseCanaryBranch(branch: string): CanaryName | null {
  const match = CANARY_BRANCH.exec(branch);
  if (match === null) return null;
  const [, runId = "", ...rest] = match;
  const [year, month, day, hour, minute, second, sequence] = rest
    .slice(0, 7)
    .map(Number);
  const createdAt = new Date(
    Date.UTC(
      year ?? 0,
      (month ?? 0) - 1,
      day ?? 0,
      hour ?? 0,
      minute ?? 0,
      second ?? 0
    )
  );
  const half = rest[7] === "violation" ? "violation" : "clean";
  const name = { runId, createdAt, sequence: sequence ?? 0, half } as const;
  // A month 13 or a day 40 rolls over into another date: not a real time.
  return canaryBranch(name) === branch ? name : null;
}

/**
 * Say whether a branch under the reserved prefix may be removed by a sweep.
 * @param branch - The branch name, without `refs/heads/`
 * @param context - The run doing the sweep, the time, and the lifetime
 * @param context.runId - The sweeping run's identifier
 * @param context.now - The time, from the run's clock
 * @param context.lifetimeSeconds - How old a canary must be to be removed
 * @returns Where the branch stands; only `stale` may be removed
 */
export function canaryStanding(
  branch: string,
  context: {
    readonly runId: string;
    readonly now: Date;
    readonly lifetimeSeconds: number;
  }
): CanaryStanding {
  const name = parseCanaryBranch(branch);
  if (name === null) return "unrecognised";
  if (name.runId === context.runId) return "own";
  const ageMs = context.now.getTime() - name.createdAt.getTime();
  return ageMs > context.lifetimeSeconds * 1000 ? "stale" : "live";
}

/**
 * The title of a canary pull request.
 * @param facts - The entry and the half
 * @returns The title
 */
export function canaryTitle(facts: CanaryFacts): string {
  return `[${CANARY_MARKER}] ${facts.entryId} ${facts.half} half (do not merge)`;
}

/**
 * The description of a canary pull request: what it is, in words a person
 * who finds it can act on, and one line a program can read.
 * @param facts - The run, the time, the entry and the half
 * @returns The description
 */
export function canaryBody(facts: CanaryFacts): string {
  return [
    "This pull request was opened by `lisa controls attest` to see whether a required check stops a change that breaks a rule.",
    "",
    "Do not merge it. It is closed and its branch is removed automatically, usually within a few minutes. If it is still open after two hours, the run that made it was interrupted; the next run that opens canaries removes it, and closing it by hand is safe.",
    "",
    `${CANARY_MARKER} run=${facts.runId} created=${facts.createdAt.toISOString()} entry=${facts.entryId} half=${facts.half}`,
  ].join("\n");
}
