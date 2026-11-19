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
 * Read every open issue with a blocker, ready for `planStaleLinkSweep`.
 * @param {object} ctx - CLI context
 * @param {string} repo - `owner/repo`
 * @returns {{ items: object[] }}
 */
export function collectGithubStaleLinkInput(ctx, repo) {
  const own = repo.toLowerCase();
  const rows = listAll(ctx, `repos/${repo}/issues?state=open&per_page=100`)
    .filter(row => !row.pull_request)
    .filter(
      row => hasNativeBlockers(row) || parseBlockedByRefs(row.body, own).length
    );
  const cache = new Map();
  const blocker = ref => {
    if (!cache.has(ref)) cache.set(ref, readIssue(ctx, ref));
    return cache.get(ref);
  };
  const items = rows.map(row => {
    const number = row.number;
    const nativeBlockers = hasNativeBlockers(row)
      ? listAll(
          ctx,
          `repos/${repo}/issues/${number}/dependencies/blocked_by?per_page=100`
        )
      : [];
    const bodyBlockers = Object.fromEntries(
      parseBlockedByRefs(row.body, own).map(ref => [ref, blocker(ref)])
    );
    return {
      repo: own,
      number,
      body: row.body ?? "",
      labels: row.labels ?? [],
      nativeBlockers,
      bodyBlockers,
      // Every candidate can hold a stale link, so its comments are read
      // for the marker dedupe; issues with no blocker are never read.
      comments: listAll(
        ctx,
        `repos/${repo}/issues/${number}/comments?per_page=100`
      ),
    };
  });
  return { items };
}
