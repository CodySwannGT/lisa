/**
 * The fleet census: how many checkouts resolve enforcement, re-derived on
 * every run.
 *
 * The per-session staleness notice reports **this** checkout to **this**
 * session, and it is right to do so — it keeps running while stale, and it
 * prints once per session rather than per call, both deliberately. The gap it
 * leaves is that nobody was looking at the fleet, so the only fleet-wide number
 * that ever existed was hand-taken and frozen in a code comment
 * (CodySwannGT/lisa#3490).
 *
 * Two rules shape everything below, and both are learned from that notice:
 *
 *   - **Report, do not gate.** No finding about the fleet may change the exit
 *     status. Reddening a build because someone else's checkout is stale would
 *     be a worse control than the one it replaces, and it would be routed
 *     around — and a guard routed around protects nothing.
 *   - **"Resolves nothing" and "resolves something old" are different
 *     findings.** They have different remedies, and folding them into one "N
 *     stale" number loses the serious half — which is exactly how *15 of 27
 *     checkouts resolve no guard at all* stayed easy to miss. They are separate
 *     fields here, and `countStale` is defined over the resolving set alone, so
 *     folding them takes a code change that a named test refuses.
 *
 * Nothing in this module stores a count. The roster names where to look, the
 * checkouts on disk answer, and the reference version is a maximum over the
 * evidence found during the same run. A census that restated today's number in
 * a different file would go stale exactly the way the comment did.
 * @module core/enforcement-census
 */
import { createHash } from "node:crypto";
import { readdir, realpath } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { CheckoutCoverage } from "./enforcement-coverage.js";
import {
  applyReference,
  collectCheckoutCoverage,
  isOlderVersion,
  versionEvidence,
} from "./enforcement-coverage.js";
import { readJsonOrNull } from "../utils/json-utils.js";
import { pathExists } from "../utils/file-operations.js";

/** Where a checkout on the roster came from. */
export type RosterSource = "roster" | "scan" | "argument";

/** One checkout the census intends to look at. */
export interface RosterEntry {
  /** Operator-facing label. */
  readonly label: string;
  /** Absolute path to look at. */
  readonly checkoutPath: string;
  /** How this entry reached the roster. */
  readonly source: RosterSource;
}

/**
 * The disjoint classes a fleet falls into.
 *
 * `unreadable`, `unguarded`, `partial` and `full` partition the roster — they
 * sum to `total` by construction. `behind`, `undateable` and `current`
 * partition the *resolving* subset only, and never see an unguarded or
 * unreadable checkout.
 */
export interface FleetCensusSummary {
  /** Checkouts the census set out to look at. */
  readonly total: number;
  /** Checkouts it could not look into. Never counted as covered. */
  readonly unreadable: number;
  /** Checkouts that resolve NO guard. Not stale — unenforced. */
  readonly unguarded: number;
  /** Checkouts that resolve some guards but not all six. */
  readonly partial: number;
  /** Checkouts that resolve all six guards. */
  readonly full: number;
  /** Checkouts resolving at least one guard. */
  readonly resolving: number;
  /** Resolving checkouts whose governing copy is behind the reference. */
  readonly behind: number;
  /** Resolving checkouts whose governing copy cannot be dated at all. */
  readonly undateable: number;
  /** Resolving checkouts whose governing copy is current. */
  readonly current: number;
  /** Resolving checkouts carrying no apply receipt. */
  readonly withoutReceipt: number;
  /** Checkouts whose installed Lisa is behind the version they declare. */
  readonly installBehindDeclared: number;
  /** All six guards, current copy, apply receipt present. */
  readonly covered: number;
}

/** One complete census run. */
export interface FleetCensus {
  /** When the census ran. */
  readonly measuredAt: string;
  /** Newest Lisa the run could point at, and what proved it. */
  readonly reference: string | null;
  /** Where the reference came from, in the operator's language. */
  readonly referenceSource: string;
  /** Where the roster came from. */
  readonly rosterOrigin: string;
  /** One record per checkout, in roster order. */
  readonly checkouts: readonly CheckoutCoverage[];
  /** The disjoint classes. */
  readonly summary: FleetCensusSummary;
}

/** The fleet roster `scripts/lisa-update-local.sh` already maintains. */
export const DEFAULT_ROSTER_FILE = ".lisa.workspaces.json";

/**
 * Expand a leading `~` the way the roster's other reader does.
 * @param value - A path that may start with `~`
 * @returns The expanded path
 */
function expandHome(value: string): string {
  return value.startsWith("~")
    ? path.join(os.homedir(), value.slice(1))
    : value;
}

/**
 * Read a fleet roster file.
 *
 * The primary shape is the one already on disk: an object mapping checkout path
 * to target branch, which `scripts/lisa-update-local.sh` reads. An array of
 * paths is accepted too, so a census can be pointed at an ad-hoc list without
 * inventing a branch for each entry.
 * @param rosterPath - Path to the roster file
 * @returns The checkouts it names, or null when it cannot be read
 */
export async function readFleetRoster(
  rosterPath: string
): Promise<readonly RosterEntry[] | null> {
  const parsed = await readJsonOrNull<unknown>(rosterPath);
  if (parsed === null || typeof parsed !== "object") return null;
  const raw = Array.isArray(parsed)
    ? parsed.filter((entry): entry is string => typeof entry === "string")
    : Object.keys(parsed as Record<string, unknown>);
  return raw.map(entry => ({
    label: entry,
    checkoutPath: path.resolve(expandHome(entry)),
    source: "roster" as const,
  }));
}

/**
 * Find checkouts under a directory, without a roster.
 *
 * Discovery exists because a hand-maintained roster can go stale the same way
 * the frozen comment did: a checkout nobody added is a checkout the census
 * cannot see, and an unseen checkout reads as coverage it does not have. A
 * candidate is any directory containing a `.git` entry, found no deeper than
 * `depth` levels so the walk stays bounded on a large disk.
 * @param root - Directory to search
 * @param depth - How many levels below `root` to descend
 * @returns The checkouts found, in listing order
 */
export async function scanForCheckouts(
  root: string,
  depth: number
): Promise<readonly RosterEntry[]> {
  const resolved = path.resolve(expandHome(root));
  if (depth < 0 || !(await pathExists(resolved))) return [];
  if (await pathExists(path.join(resolved, ".git"))) {
    return [{ label: resolved, checkoutPath: resolved, source: "scan" }];
  }
  const entries = await readdir(resolved, { withFileTypes: true }).catch(
    () => []
  );
  const children = entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith("."))
    .filter(entry => entry.name !== "node_modules")
    .map(entry => path.join(resolved, entry.name));
  const found = await Promise.all(
    children.map(child => scanForCheckouts(child, depth - 1))
  );
  return found.flat();
}

/**
 * Collapse entries that name the same checkout twice.
 *
 * Two roster spellings of one directory, or a roster entry a scan also found,
 * would otherwise be counted twice — inflating both the numerator and the
 * denominator and making the census disagree with itself.
 * @param entries - Entries from every source
 * @returns One entry per distinct checkout, first spelling wins
 */
export async function dedupeRoster(
  entries: readonly RosterEntry[]
): Promise<readonly RosterEntry[]> {
  const keyed = await Promise.all(
    entries.map(async entry => ({
      entry,
      key: await realpath(entry.checkoutPath).catch(() => entry.checkoutPath),
    }))
  );
  return keyed
    .filter(
      (candidate, index) =>
        keyed.findIndex(other => other.key === candidate.key) === index
    )
    .map(candidate => candidate.entry);
}

/**
 * Count the resolving checkouts whose governing copy is behind.
 *
 * Defined over the resolving set on purpose, and named so that folding the
 * unguarded class into it is a visible edit rather than an accident. A checkout
 * that resolves nothing has no copy to be behind: calling it stale describes a
 * guard that would refuse things, and there is none.
 * @param checkouts - Every record in the run
 * @returns How many resolving checkouts are behind the reference
 */
export function countStale(checkouts: readonly CheckoutCoverage[]): number {
  return checkouts.filter(
    entry =>
      (entry.resolution === "partial" || entry.resolution === "full") &&
      entry.vintage === "behind"
  ).length;
}

/**
 * Reduce a run to its disjoint classes.
 * @param checkouts - Every record in the run
 * @returns The summary
 */
export function summarizeFleetCensus(
  checkouts: readonly CheckoutCoverage[]
): FleetCensusSummary {
  const resolving = checkouts.filter(
    entry => entry.resolution === "partial" || entry.resolution === "full"
  );
  const count = (
    list: readonly CheckoutCoverage[],
    predicate: (entry: CheckoutCoverage) => boolean
  ): number => list.filter(predicate).length;
  return {
    total: checkouts.length,
    unreadable: count(checkouts, entry => entry.resolution === "unreadable"),
    unguarded: count(checkouts, entry => entry.resolution === "none"),
    partial: count(checkouts, entry => entry.resolution === "partial"),
    full: count(checkouts, entry => entry.resolution === "full"),
    resolving: resolving.length,
    behind: countStale(checkouts),
    undateable: count(resolving, entry => entry.vintage === "undateable"),
    current: count(resolving, entry => entry.vintage === "current"),
    withoutReceipt: count(resolving, entry => !entry.receipt.present),
    installBehindDeclared: count(checkouts, entry =>
      isInstallBehindDeclared(entry)
    ),
    covered: count(
      checkouts,
      entry =>
        entry.resolution === "full" &&
        entry.vintage === "current" &&
        entry.receipt.present
    ),
  };
}

/**
 * Whether a checkout's installed Lisa is older than the one it declares.
 *
 * The comparison is against the range's own floor, read as a plain version once
 * the usual range punctuation is stripped. A range this cannot parse yields
 * `false` — absence of proof never becomes proof of drift.
 * @param coverage - One record
 * @returns Whether the installed copy is behind the declared one
 */
export function isInstallBehindDeclared(coverage: CheckoutCoverage): boolean {
  const { declared, installed } = coverage.install;
  if (declared === null || installed === null) return false;
  // Bounded quantifiers rather than `\d+`: a range string arrives from a
  // manifest this repository does not own, and an unbounded pattern over
  // untrusted input is the shape that backtracks pathologically.
  const floor = /(\d{1,9}\.\d{1,9}\.\d{1,9})/u.exec(declared)?.[1];
  return floor !== undefined && isOlderVersion(installed, floor);
}

/**
 * Resolve the newest Lisa this run can point at.
 *
 * A maximum over evidence found on the same disk during the same run, never a
 * network lookup and never a nominated authority. A copy is reported behind
 * only when something newer can actually be pointed at, so the worst case is
 * silence rather than a fleet-wide false alarm.
 * @param checkouts - Records collected with no reference
 * @param seed - A version the caller can vouch for, such as its own manifest
 * @returns The reference version and what proved it
 */
export function resolveReference(
  checkouts: readonly CheckoutCoverage[],
  seed: string | null
): { readonly version: string | null; readonly source: string } {
  const candidates = checkouts.flatMap(entry =>
    versionEvidence(entry).map(version => ({
      version,
      source: entry.label,
    }))
  );
  const all =
    seed === null
      ? candidates
      : [
          { version: seed, source: "this checkout's own manifest" },
          ...candidates,
        ];
  const best = all.reduce<{ version: string; source: string } | null>(
    (winner, candidate) =>
      winner === null || isOlderVersion(winner.version, candidate.version)
        ? candidate
        : winner,
    null
  );
  return best === null
    ? { version: null, source: "no Lisa version could be found on this disk" }
    : best;
}

/** Everything a census run needs. */
export interface FleetCensusOptions {
  /** Checkouts to look at, already deduped. */
  readonly roster: readonly RosterEntry[];
  /** Where that roster came from, for the report header. */
  readonly rosterOrigin: string;
  /** A version the caller can vouch for, folded into the reference. */
  readonly seedVersion?: string | null;
  /** An explicit reference, which suppresses the maximum entirely. */
  readonly reference?: string | null;
  /** Clock seam, so the report is reproducible under test. */
  readonly now?: () => Date;
}

/**
 * Run the census.
 *
 * Never throws for a fleet finding and never returns a status: the caller
 * prints this and exits 0. The only thing that can fail here is the census
 * itself, and a checkout it cannot read comes back as `unreadable` rather than
 * as an exception, because one unreachable directory must not stop the other
 * twenty-six from being measured.
 * @param options - Roster and reference inputs
 * @returns The measured fleet
 */
export async function runFleetCensus(
  options: FleetCensusOptions
): Promise<FleetCensus> {
  const undated = await Promise.all(
    options.roster.map(entry =>
      collectCheckoutCoverage({
        label: entry.label,
        checkoutPath: entry.checkoutPath,
        reference: null,
      })
    )
  );
  const resolved =
    options.reference != null && options.reference !== ""
      ? { version: options.reference, source: "supplied by the caller" }
      : resolveReference(undated, options.seedVersion ?? null);
  const checkouts = undated.map(entry =>
    applyReference(entry, resolved.version)
  );
  return {
    measuredAt: (options.now?.() ?? new Date()).toISOString(),
    reference: resolved.version,
    referenceSource: resolved.source,
    rosterOrigin: options.rosterOrigin,
    checkouts,
    summary: summarizeFleetCensus(checkouts),
  };
}

/**
 * A stable, path-free label for a checkout.
 *
 * The census names real local checkouts, and those paths embed client and
 * product names that must never reach a public issue or PR. Redaction keeps the
 * counts and the per-checkout rows — which is all a fleet finding needs — while
 * making the report safe to paste. It is derived from the path, so the same
 * checkout carries the same label between runs and can still be discussed.
 * @param checkoutPath - The real path
 * @returns A stable anonymous label
 */
export function redactedLabel(checkoutPath: string): string {
  return `checkout-${createHash("sha256")
    .update(checkoutPath)
    .digest("hex")
    .slice(0, 8)}`;
}
