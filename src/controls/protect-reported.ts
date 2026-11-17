/**
 * Proof that a check has actually been reported, read before it is required.
 *
 * A required check that nothing reports does not fail a pull request. The
 * platform holds the pull request at "waiting for status to be reported",
 * for ever, with no failure to read. So a derived check is only made required
 * once the platform shows a result under that exact name: on the head of the
 * protected branch, or on the head of one of the most recent pull requests
 * into it (a pipeline that runs only on pull requests never reports on the
 * branch itself).
 *
 * Whether a name counts as reported is decided by `verifyContextsPosted` in
 * the shipped gate registry, from the two places it names: a commit's check
 * runs and its commit statuses. This module only makes those reads. Every one
 * is a `GET`.
 *
 * There are three answers, never two. A name that was seen is reported. A
 * name that was not seen after every read succeeded and was complete has not
 * run yet. A name that was not seen when a read failed, or returned only part
 * of its list, is not known — and a check that is not known to be reported is
 * not required either.
 * @module controls/protect-reported
 */
import type { GhRunner, ProtectionModules } from "./protect-modules.js";

/** How many recent pull requests into the branch are looked at. */
export const RECENT_PULL_REQUESTS = 5;

/** The largest page the platform returns; a longer list is incomplete. */
const PAGE_SIZE = 100;

/** What the reads showed. */
export interface ReportedProof {
  /** The names a result was seen under. */
  readonly reported: ReadonlySet<string>;
  /**
   * Why the names that were not seen cannot be called "never reported", or
   * `null` when every read succeeded and was complete.
   */
  readonly unread: string | null;
}

/**
 * The names one read returned, and why they may not be all of them. A name
 * that was returned has been seen whatever else went wrong; only the names
 * that were not returned are in doubt.
 */
interface NamesRead {
  readonly names: readonly string[];
  /** Why the list may be missing names, or `null` when it is whole. */
  readonly unread: string | null;
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
 * @param name - The key of each item that holds its name
 * @returns The names, or why the list is missing or incomplete
 */
function readNames(
  gh: GhRunner,
  path: string,
  list: string,
  name: string
): NamesRead {
  const read = readJson(gh, path);
  if (!read.ok) return { names: [], unread: read.reason };
  const document = read.value;
  const items =
    document !== null && typeof document === "object"
      ? (Reflect.get(document, list) as unknown)
      : undefined;
  if (!Array.isArray(items)) {
    return {
      names: [],
      unread: `${path} did not answer with a ${list} list`,
    };
  }
  const total: unknown = Reflect.get(document as object, "total_count");
  return {
    unread:
      typeof total === "number" && total > items.length
        ? `${path} returned ${String(items.length)} of ${String(total)} results, so the list is incomplete`
        : null,
    names: items.flatMap((item: unknown) => {
      const value: unknown =
        item !== null && typeof item === "object"
          ? Reflect.get(item, name)
          : undefined;
      return typeof value === "string" ? [value] : [];
    }),
  };
}

/**
 * Read the head commits of the most recent pull requests into a branch.
 * @param gh - A runner that only reads
 * @param repository - `owner/name`
 * @param branch - The protected branch
 * @returns The commit ids, or why they could not be read
 */
function recentPullHeads(
  gh: GhRunner,
  repository: string,
  branch: string
): NamesRead {
  const read = readJson(
    gh,
    `repos/${repository}/pulls?state=all&base=${encodeURIComponent(branch)}&sort=updated&direction=desc&per_page=${String(RECENT_PULL_REQUESTS)}`
  );
  if (!read.ok) return { names: [], unread: read.reason };
  if (!Array.isArray(read.value)) {
    return { names: [], unread: "the pull request list was not a list" };
  }
  return {
    unread: null,
    names: read.value.flatMap((pull: unknown) => {
      const head: unknown =
        pull !== null && typeof pull === "object"
          ? Reflect.get(pull, "head")
          : undefined;
      const sha: unknown =
        head !== null && typeof head === "object"
          ? Reflect.get(head, "sha")
          : undefined;
      return typeof sha === "string" && /^[0-9a-f]{7,64}$/u.test(sha)
        ? [sha]
        : [];
    }),
  };
}

/** What has been seen so far, and the first reason a read was unreliable. */
interface Seen {
  readonly names: readonly string[];
  readonly unread: string | null;
}

/**
 * Add one read's names to what has been seen.
 * @param seen - What was seen before
 * @param read - The read
 * @returns What has been seen now
 */
function withRead(seen: Seen, read: NamesRead): Seen {
  return {
    names: [...seen.names, ...read.names],
    unread: seen.unread ?? read.unread,
  };
}

/**
 * Read which of some check names the platform shows a result for.
 *
 * The protected branch's head is read first; the recent pull requests are
 * read only while a name is still unseen, so a repository whose pipeline
 * reports on the branch costs one request.
 * @param repository - `owner/name`
 * @param branch - The protected branch
 * @param names - The check names that would be made required
 * @param gh - A runner that only reads
 * @param modules - The shipped scripts
 * @returns The names seen, and whether the rest can be called never reported
 */
export function readReported(
  repository: string,
  branch: string,
  names: readonly string[],
  gh: GhRunner,
  modules: ProtectionModules
): ReportedProof {
  const unseen = (seen: Seen): readonly string[] =>
    modules.gates.verifyContextsPosted({ derived: names, posted: seen.names })
      .missing;
  const commit = (seen: Seen, ref: string): Seen => {
    if (unseen(seen).length === 0) return seen;
    const base = `repos/${repository}/commits/${ref}`;
    const runs = withRead(
      seen,
      readNames(
        gh,
        `${base}/check-runs?per_page=${String(PAGE_SIZE)}`,
        "check_runs",
        "name"
      )
    );
    return unseen(runs).length === 0
      ? runs
      : withRead(
          runs,
          readNames(
            gh,
            `${base}/status?per_page=${String(PAGE_SIZE)}`,
            "statuses",
            "context"
          )
        );
  };
  const onBranch = commit({ names: [], unread: null }, `heads/${branch}`);
  if (unseen(onBranch).length === 0 || names.length === 0) {
    return { reported: new Set(names), unread: null };
  }
  const pulls = recentPullHeads(gh, repository, branch);
  const everywhere = pulls.names.reduce(commit, {
    names: onBranch.names,
    unread: onBranch.unread ?? pulls.unread,
  });
  const missing = new Set(unseen(everywhere));
  return {
    reported: new Set(names.filter(name => !missing.has(name))),
    unread: missing.size === 0 ? null : everywhere.unread,
  };
}
