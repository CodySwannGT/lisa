/**
 * Proof that a check has actually been reported, read before it is required.
 *
 * A required check that nothing reports does not fail a pull request. The
 * platform holds the pull request at "waiting for status to be reported",
 * for ever, with no failure to read. So a derived check is only made required
 * once the platform shows a result under that exact name, from the source
 * the change would require it from.
 *
 * ## Where a result counts
 *
 * On the head of the protected branch, or on the head of a pull request that
 * was **merged** into it (a pipeline that runs only on pull requests never
 * reports on the branch itself). Nowhere else. An open pull request, one
 * that was closed without being merged, and one from a fork that never
 * landed all show what somebody proposed, not what the branch runs: counting
 * them would let a check become required on the branch while nothing on the
 * branch reports it, and every other pull request would wait for ever.
 *
 * ## Whose result counts
 *
 * A required check is a name and, where the change pins it, the one app
 * allowed to report it: GitHub Actions for a check a pipeline job runs, the
 * app the declaration names for one another app reports. A result under the
 * right name from anything else would not satisfy the requirement once it is
 * written, so it does not count here either. A commit status does not say
 * which app wrote it, so it never counts for a check the change pins. Only a
 * check the change leaves open to any source is satisfied by any check run
 * or commit status.
 *
 * Whether a name counts as reported among the results that qualify is decided
 * by `verifyContextsPosted` in the shipped gate registry. This module only
 * makes the reads. Every one is a `GET`.
 *
 * There are three answers, never two. A name that was seen is reported. A
 * name that was not seen after every read succeeded and was complete has not
 * run yet. A name that was not seen when a read failed, or returned only part
 * of its list, is not known — and a check that is not known to be reported is
 * not required either.
 * @module controls/protect-reported
 */
import type { GhRunner, ProtectionModules } from "./protect-modules.js";
import { isBranchName } from "./protect-types.js";

/** How many merged pull requests into the branch are looked at. */
export const RECENT_PULL_REQUESTS = 5;

/**
 * How many closed pull requests are listed to find the merged ones. Closed
 * ones that were never merged are in the same list, so more are asked for
 * than are looked at.
 */
export const CLOSED_PULL_REQUESTS = 30;

/** The largest page the platform returns; a longer list is incomplete. */
const PAGE_SIZE = 100;

/** One check the change would require, and from whom. */
export interface WantedCheck {
  /** The exact name the platform matches on. */
  readonly context: string;
  /** The one app that would have to report it, or `null` for any source. */
  readonly appId: number | null;
}

/** What the reads showed. */
export interface ReportedProof {
  /** The names a result was seen under, from the source that counts. */
  readonly reported: ReadonlySet<string>;
  /**
   * Why the names that were not seen cannot be called "never reported", or
   * `null` when every read succeeded and was complete.
   */
  readonly unread: string | null;
  /**
   * For each name that was seen only from a source that does not count:
   * who reported it, in words, for example `app 999` or `a commit status`.
   */
  readonly elsewhere: ReadonlyMap<string, readonly string[]>;
}

/** One check run a commit shows. */
interface SeenRun {
  readonly name: string;
  /** The app that reported it, or `null` when the platform named none. */
  readonly appId: number | null;
}

/** What has been seen so far, and the first reason a read was unreliable. */
interface Seen {
  readonly runs: readonly SeenRun[];
  /** The names of the commit statuses, which say nothing of an app. */
  readonly statuses: readonly string[];
  readonly unread: string | null;
}

/** One list out of one read, and why it may not be all of it. */
interface ListRead {
  readonly items: readonly unknown[];
  /** Why the list may be missing items, or `null` when it is whole. */
  readonly unread: string | null;
}

/**
 * Read a field of a document that may not be one.
 * @param value - The document
 * @param key - The field's name
 * @returns The field, or `undefined` when there is no such field
 */
function field(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object"
    ? (Reflect.get(value, key) as unknown)
    : undefined;
}

/**
 * Make one read and parse its answer.
 * @param gh - A runner that only reads
 * @param path - The API path, with its query
 * @returns The document, or why there is none
 */
function readJson(
  gh: GhRunner,
  path: string
):
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: string } {
  const answered = gh(["api", path]);
  if (!answered.ok) {
    const said = `${answered.stdout}\n${answered.stderr}`.trim();
    return {
      ok: false,
      reason: (said === "" ? `${path} could not be read` : said).replaceAll(
        /\s+/gu,
        " "
      ),
    };
  }
  try {
    return { ok: true, value: JSON.parse(answered.stdout) as unknown };
  } catch {
    return { ok: false, reason: `${path} did not answer with JSON` };
  }
}

/**
 * Read one named list out of a commit's document.
 * @param gh - A runner that only reads
 * @param path - The API path
 * @param list - The key that holds the list
 * @returns The items, and why the list is missing or incomplete
 */
function readList(gh: GhRunner, path: string, list: string): ListRead {
  const read = readJson(gh, path);
  if (!read.ok) return { items: [], unread: read.reason };
  const items = field(read.value, list);
  if (!Array.isArray(items)) {
    return {
      items: [],
      unread: `${path} did not answer with a ${list} list`,
    };
  }
  const total = field(read.value, "total_count");
  return {
    items,
    unread:
      typeof total === "number" && total > items.length
        ? `${path} returned ${String(items.length)} of ${String(total)} results, so the list is incomplete`
        : null,
  };
}

/**
 * Read the head commits of the pull requests most recently merged into a
 * branch.
 *
 * The platform is asked for the closed pull requests into the branch, and
 * each answer is checked again here: only one the platform says was merged,
 * into exactly this branch, is kept, whatever list came back.
 * @param gh - A runner that only reads
 * @param repository - `owner/name`
 * @param branch - The protected branch
 * @returns The commit ids, or why they could not be read
 */
function mergedPullHeads(
  gh: GhRunner,
  repository: string,
  branch: string
): { readonly heads: readonly string[]; readonly unread: string | null } {
  const read = readJson(
    gh,
    `repos/${repository}/pulls?state=closed&base=${encodeURIComponent(branch)}&sort=updated&direction=desc&per_page=${String(CLOSED_PULL_REQUESTS)}`
  );
  if (!read.ok) return { heads: [], unread: read.reason };
  if (!Array.isArray(read.value)) {
    return { heads: [], unread: "the pull request list was not a list" };
  }
  const heads = read.value.flatMap((pull: unknown) => {
    const mergedAt = field(pull, "merged_at");
    const merged = typeof mergedAt === "string" && mergedAt !== "";
    const sha = field(field(pull, "head"), "sha");
    return merged &&
      field(field(pull, "base"), "ref") === branch &&
      typeof sha === "string" &&
      /^[0-9a-f]{7,64}$/u.test(sha)
      ? [sha]
      : [];
  });
  return { heads: heads.slice(0, RECENT_PULL_REQUESTS), unread: null };
}

/**
 * Read the check runs of one commit, each with the app that reported it.
 * @param gh - A runner that only reads
 * @param base - The API path of the commit
 * @returns The runs, and why the list may be incomplete
 */
function checkRunsOf(
  gh: GhRunner,
  base: string
): Pick<Seen, "runs" | "unread"> {
  const read = readList(
    gh,
    `${base}/check-runs?per_page=${String(PAGE_SIZE)}`,
    "check_runs"
  );
  return {
    unread: read.unread,
    runs: read.items.flatMap((run: unknown): readonly SeenRun[] => {
      const name = field(run, "name");
      const app = field(field(run, "app"), "id");
      return typeof name === "string"
        ? [{ name, appId: typeof app === "number" ? app : null }]
        : [];
    }),
  };
}

/**
 * Read the names of the commit statuses of one commit.
 * @param gh - A runner that only reads
 * @param base - The API path of the commit
 * @returns The names, and why the list may be incomplete
 */
function statusesOf(
  gh: GhRunner,
  base: string
): Pick<Seen, "statuses" | "unread"> {
  const read = readList(
    gh,
    `${base}/status?per_page=${String(PAGE_SIZE)}`,
    "statuses"
  );
  return {
    unread: read.unread,
    statuses: read.items.flatMap((status: unknown) => {
      const context = field(status, "context");
      return typeof context === "string" ? [context] : [];
    }),
  };
}

/**
 * The names that qualify for a check required from one source.
 * @param seen - What has been seen
 * @param appId - The app that would have to report it, or `null` for any
 * @returns The names reported by that app; every name when any source counts
 */
function postedBy(seen: Seen, appId: number | null): readonly string[] {
  return appId === null
    ? [...seen.runs.map(run => run.name), ...seen.statuses]
    : seen.runs.filter(run => run.appId === appId).map(run => run.name);
}

/**
 * Say who reported each name that was seen only from a source that does not
 * count.
 * @param names - The names that were not seen from the right source
 * @param seen - Everything that was seen
 * @returns For each such name that was seen at all, who reported it
 */
function reportersOf(
  names: readonly string[],
  seen: Seen
): ReadonlyMap<string, readonly string[]> {
  return new Map(
    names.flatMap(name => {
      const apps = seen.runs
        .filter(run => run.name === name)
        .map(run =>
          run.appId === null
            ? "a check run that names no app"
            : `app ${String(run.appId)}`
        );
      const who = [
        ...new Set([
          ...apps,
          ...(seen.statuses.includes(name) ? ["a commit status"] : []),
        ]),
      ];
      return who.length === 0 ? [] : [[name, who] as const];
    })
  );
}

/** The answer when no read can be made for a branch name. */
const NOTHING_SEEN: ReadonlyMap<string, readonly string[]> = new Map();

/**
 * Read which of some checks the platform shows a result for, from the source
 * each would be required from.
 *
 * The protected branch's head is read first; the merged pull requests are
 * read only while a name is still unseen, so a repository whose pipeline
 * reports on the branch costs one request.
 * @param repository - `owner/name`
 * @param branch - The protected branch
 * @param wanted - The checks that would be made required, with their source
 * @param gh - A runner that only reads
 * @param modules - The shipped scripts
 * @returns The names seen, and whether the rest can be called never reported
 */
export function readReported(
  repository: string,
  branch: string,
  wanted: readonly WantedCheck[],
  gh: GhRunner,
  modules: ProtectionModules
): ReportedProof {
  const names = [...new Set(wanted.map(check => check.context))];
  if (!isBranchName(branch)) {
    return {
      reported: new Set(),
      unread: `${JSON.stringify(branch)} is not a branch name that can be put in a request`,
      elsewhere: NOTHING_SEEN,
    };
  }
  const apps = [...new Set(wanted.map(check => check.appId))];
  const unseenFrom = (seen: Seen, appId: number | null): readonly string[] =>
    modules.gates.verifyContextsPosted({
      derived: wanted
        .filter(check => check.appId === appId)
        .map(check => check.context),
      posted: postedBy(seen, appId),
    }).missing;
  const unseen = (seen: Seen): readonly string[] => [
    ...new Set(apps.flatMap(appId => unseenFrom(seen, appId))),
  ];
  const commit = (seen: Seen, ref: string): Seen => {
    if (unseen(seen).length === 0) return seen;
    const base = `repos/${repository}/commits/${ref}`;
    const runs = checkRunsOf(gh, base);
    const withRuns: Seen = {
      runs: [...seen.runs, ...runs.runs],
      statuses: seen.statuses,
      unread: seen.unread ?? runs.unread,
    };
    if (unseen(withRuns).length === 0) return withRuns;
    // Read even when every unseen check is pinned to an app, which a commit
    // status can never satisfy: it is what lets the result say that a name
    // was reported, only not by the source that counts.
    const statuses = statusesOf(gh, base);
    return {
      runs: withRuns.runs,
      statuses: [...withRuns.statuses, ...statuses.statuses],
      unread: withRuns.unread ?? statuses.unread,
    };
  };
  const onBranch = commit(
    { runs: [], statuses: [], unread: null },
    `heads/${branch}`
  );
  if (unseen(onBranch).length === 0) {
    return { reported: new Set(names), unread: null, elsewhere: NOTHING_SEEN };
  }
  const pulls = mergedPullHeads(gh, repository, branch);
  const everywhere = pulls.heads.reduce(commit, {
    ...onBranch,
    unread: onBranch.unread ?? pulls.unread,
  });
  const missing = unseen(everywhere);
  return {
    reported: new Set(names.filter(name => !missing.includes(name))),
    unread: missing.length === 0 ? null : everywhere.unread,
    elsewhere: reportersOf(missing, everywhere),
  };
}
