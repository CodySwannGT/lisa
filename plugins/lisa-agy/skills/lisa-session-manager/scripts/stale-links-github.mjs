/**
 * The GitHub reads behind `stale-links-plan --tracker github`
 * (CodySwannGT/lisa#5065): every open issue, the native `blocked_by`
 * dependencies of those that have any, the issue each `Blocked by` body line
 * names, and the comments of every issue with a blocker (for the marker
 * dedupe). Every read goes through `gh`, GitHub's access layer, with
 * the scrubbed worker env. A blocker that cannot be read is passed on as
 * null, so the plan reports it as inaccessible instead of guessing.
 * @module session-manager/stale-links-github
 */
import { parseBlockedByRefs } from "../../../scripts/stale-blocker-edges.mjs";
import { CliError, mustRun, run } from "./cli-runtime.mjs";
import { parseJson } from "./json-input.mjs";
import { scrubWorkerEnv } from "./workers.mjs";

/**
 * Every page of one paginated `gh api` list, flattened.
 * @param {object} ctx - CLI context
 * @param {string} endpoint
 * @returns {object[]}
 */
function listAll(ctx, endpoint) {
  const stdout = mustRun("gh", ["api", "--paginate", "--slurp", endpoint], {
    env: scrubWorkerEnv(ctx.env),
  });
  const pages = parseJson(stdout, `gh api ${endpoint}`);
  return Array.isArray(pages) ? pages.flat() : [];
}

/**
 * One issue by canonical ref, or null when it cannot be read.
 *
 * probe-direction: fail-closed — a null blocker is judged inaccessible, so its
 * link is kept and reported, never removed; a failed read can only shrink what
 * the sweep clears.
 * @param {object} ctx - CLI context
 * @param {string} ref - `owner/repo#n`
 * @returns {object | null}
 */
function readIssue(ctx, ref) {
  const [repo, number] = ref.split("#");
  const result = run("gh", ["api", `repos/${repo}/issues/${number}`], {
    env: scrubWorkerEnv(ctx.env),
  });
  if (result.missing) throw new CliError("gh is not on PATH.", 1);
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/**
 * Whether an issue has any native blocker, open or closed.
 * @param {Record<string, any>} row - REST issue
 * @returns {boolean}
 */
const hasNativeBlockers = row =>
  Number(row?.issue_dependencies_summary?.total_blocked_by ?? 0) > 0;

/**
 * A cached reader for blocker issues, so a blocker named by several items is
 * read once per command.
 * @param {object} ctx - CLI context
 * @returns {(ref: string) => object | null}
 */
export function blockerReader(ctx) {
  const cache = new Map();
  return ref => {
    if (!cache.has(ref)) cache.set(ref, readIssue(ctx, ref));
    return cache.get(ref);
  };
}

/**
 * Whether a REST issue names any blocker, natively or in its body.
 * @param {Record<string, any>} row - REST issue
 * @param {string} repo - `owner/repo`
 * @returns {boolean}
 */
export const hasBlockers = (row, repo) =>
  hasNativeBlockers(row) ||
  parseBlockedByRefs(row?.body, repo.toLowerCase()).length > 0;

/**
 * The REST issue with its blockers attached, in the shape the shared rule
 * reads (`nativeBlockers`, `bodyBlockers`). An issue with no blocker gets
 * empty ones without a single read.
 * @param {object} ctx - CLI context
 * @param {string} repo - `owner/repo`
 * @param {Record<string, any>} row - REST issue
 * @param {(ref: string) => object | null} blocker - From {@link blockerReader}
 * @returns {Record<string, any>}
 */
export function withBlockers(ctx, repo, row, blocker) {
  const own = repo.toLowerCase();
  const nativeBlockers = hasNativeBlockers(row)
    ? listAll(
        ctx,
        `repos/${repo}/issues/${row.number}/dependencies/blocked_by?per_page=100`
      )
    : [];
  const bodyBlockers = Object.fromEntries(
    parseBlockedByRefs(row.body, own).map(ref => [ref, blocker(ref)])
  );
  return { ...row, nativeBlockers, bodyBlockers };
}

/**
 * One issue with its blockers and comments, as the plan reads it.
 * @param {object} ctx - CLI context
 * @param {string} repo - `owner/repo`
 * @param {Record<string, any>} row - REST issue
 * @param {(ref: string) => object | null} blocker - From {@link blockerReader}
 * @returns {Record<string, any>}
 */
function staleLinkItem(ctx, repo, row, blocker) {
  const enriched = readOrUnreadable(() =>
    withBlockers(ctx, repo, row, blocker)
  );
  const comments = readOrUnreadable(() =>
    listAll(ctx, `repos/${repo}/issues/${row.number}/comments?per_page=100`)
  );
  // probe-direction: fail-closed — a candidate whose dependency list or
  // comments could not be read gets `nativeBlockers: null`, which the plan
  // reads as "blocker list not read": it is reported and nothing of it is
  // removed (without its comments, a link a person put back could not be
  // told apart). Every other candidate is still planned.
  const unreadable = enriched === null || comments === null;
  return {
    repo: repo.toLowerCase(),
    number: row.number,
    // Carried so confirm can skip an issue closed since the plan, and the
    // ready claim can apply the queue's own container rule.
    state: row.state ?? "",
    sub_issues_summary: row.sub_issues_summary ?? null,
    body: row.body ?? "",
    labels: row.labels ?? [],
    nativeBlockers: unreadable ? null : enriched.nativeBlockers,
    bodyBlockers: unreadable ? {} : enriched.bodyBlockers,
    // Every candidate can hold a stale link, so its comments are read for
    // the marker dedupe; issues with no blocker are never read.
    comments: comments ?? [],
  };
}

/**
 * Run one read, or return null when it fails (the caller decides what an
 * unread result means; here it always holds the candidate back).
 * @template T
 * @param {() => T} read
 * @returns {T | null}
 */
function readOrUnreadable(read) {
  try {
    return read();
  } catch {
    // probe-direction: fail-closed — see staleLinkItem: null means "not
    // read", which removes nothing.
    return null;
  }
}

/**
 * Read every open issue with a blocker, ready for `planStaleLinkSweep`.
 * @param {object} ctx - CLI context
 * @param {string} repo - `owner/repo`
 * @returns {{ items: object[] }}
 */
export function collectGithubStaleLinkInput(ctx, repo) {
  const blocker = blockerReader(ctx);
  const items = listAll(ctx, `repos/${repo}/issues?state=open&per_page=100`)
    .filter(row => !row.pull_request && hasBlockers(row, repo))
    .map(row => staleLinkItem(ctx, repo, row, blocker));
  return { items };
}

/**
 * Re-read one issue, every blocker it names and its comments, right before
 * the writes (`stale-links-confirm`).
 * @param {object} ctx - CLI context
 * @param {string} repo - `owner/repo`
 * @param {number} number - Issue number
 * @returns {Record<string, any>}
 */
export function readGithubStaleLinkItem(ctx, repo, number) {
  const row = readIssue(ctx, `${repo}#${number}`);
  if (!row) {
    throw new CliError(
      `Could not read ${repo}#${number} to confirm the plan.`,
      1
    );
  }
  return staleLinkItem(ctx, repo, row, blockerReader(ctx));
}
