/**
 * The GitHub fetches behind the session-manager `queue` subcommand, split out
 * of cli-queue.mjs to keep it under the line budget (#4555): the Ready tier
 * ({@link fetchGithubQueue}) and the backlog tier ({@link fetchGithubBacklog}).
 * Both read with `gh api --paginate --slurp`, so every page is read or the
 * command fails, and both run gh with the scrubbed worker env.
 * @module session-manager/queue-github
 */
import {
  labelNames,
  normalizeGithubIssue,
} from "../../../scripts/ready-queue-order.mjs";
import {
  idComparableValues,
  releaseComparableValues,
  parseIdEntries,
} from "../../../scripts/operator-id-kinds.mjs";
import { resolveRole } from "../../../scripts/resolve-lifecycle-role.mjs";
import {
  landedDoneRoles,
  terminalDoneRoles,
} from "../../../scripts/stale-blocker-edges.mjs";
import { CliError, mustRun, run } from "./cli-runtime.mjs";
import { parseJson } from "./json-input.mjs";
import {
  blockerReader,
  hasBlockers,
  withBlockers,
} from "./stale-links-github.mjs";
import { scrubWorkerEnv } from "./workers.mjs";

const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/;

/**
 * Resolve configured GitHub logins to provider account IDs for hold releases.
 * A failed or mismatched lookup authorizes nobody for that entry.
 * @param {object} ctx - CLI context
 * @param {unknown} entries - Configured release identities
 * @returns {string[]} Account IDs to compare with native comment authorship
 */
export function githubReleaserIds(ctx, entries) {
  const logins = new Set(
    parseIdEntries(entries)
      .filter(
        entry => entry.kind === "login" && /^[A-Za-z0-9_-]+$/u.test(entry.value)
      )
      .map(entry => entry.value.toLowerCase())
  );
  // Relay accounts are named by account id only (`relay:<id>`), so they need
  // no login lookup and pass straight through to the release check.
  const ids = releaseComparableValues(entries);
  const env = scrubWorkerEnv(ctx.env);
  for (const login of logins) {
    const endpoint = `users/${login}`;
    const result = run("gh", ["api", endpoint], { env });
    if (result.status !== 0) continue;
    try {
      const account = parseJson(result.stdout, endpoint);
      if (
        account?.type === "User" &&
        typeof account.login === "string" &&
        account.login.toLowerCase() === login &&
        Number.isSafeInteger(account.id) &&
        account.id > 0
      ) {
        ids.push(String(account.id));
      }
    } catch {
      // An unreadable account does not authorize a release.
    }
  }
  return ids;
}

/**
 * The GitHub repo to read: `--github-repo`, else github.org/github.repo.
 * @param {object} ctx - CLI context
 * @param {{global?: object, local?: object}} project - Loaded project
 * @returns {string} `owner/repo`
 */
function githubRepo(ctx, project) {
  const merged = { ...project.global?.github, ...project.local?.github };
  const repo =
    ctx.values["github-repo"] ??
    (merged.org && merged.repo ? `${merged.org}/${merged.repo}` : "");
  if (!OWNER_REPO.test(repo)) {
    throw new CliError(
      "No GitHub repo: set github.org and github.repo, or pass --github-repo <owner/repo>.",
      2
    );
  }
  return repo;
}

/**
 * Normalize REST rows with their blockers attached, so the queue judges a
 * blocker by the same rule as intake and the stale-link sweep (#5065).
 * Only rows that name a blocker, and that `keep` retains, cost any extra
 * read: a row the caller will drop anyway is dropped before enrichment.
 * @param {object} ctx - CLI context
 * @param {{global?: object, local?: object}} project - Loaded project
 * @param {string} repo - `owner/repo`
 * @param {object[]} rows - REST issues
 * @param {(row: object) => boolean} [keep] - Raw-row filter, applied first
 * @returns {object[]} Normalized items
 */
function normalizeRows(ctx, project, repo, rows, keep = () => true) {
  const config = {
    tracker: "github",
    global: project.global,
    local: project.local,
  };
  const doneRoles = terminalDoneRoles(config);
  const landedRoles = landedDoneRoles(config);
  const blocker = blockerReader(ctx);
  return rows
    .filter(row => !row.pull_request && keep(row))
    .map(row =>
      hasBlockers(row, repo) ? enrichOrHold(ctx, repo, row, blocker) : row
    )
    .map(row => normalizeGithubIssue(row, { repo, doneRoles, landedRoles }))
    .filter(Boolean);
}

/**
 * Attach one row's blockers. A failed blocker read holds THAT row only: the
 * rest of the queue is still offered.
 * @param {object} ctx - CLI context
 * @param {string} repo - `owner/repo`
 * @param {Record<string, any>} row - REST issue
 * @param {(ref: string) => object | null} blocker - Body-ref reader
 * @returns {Record<string, any>} The enriched row, or the row marked unreadable
 */
function enrichOrHold(ctx, repo, row, blocker) {
  try {
    return withBlockers(ctx, repo, row, blocker);
  } catch {
    // probe-direction: fail-closed — an item whose blockers could not be read
    // is held (`blockersUnreadable`), never released as unblocked.
    return { ...row, blockersUnreadable: true };
  }
}

/**
 * Every string leaf of an object (label names, including env-keyed `done`).
 * @param {unknown} value - Config subtree
 * @returns {string[]} Leaves
 */
function stringLeaves(value) {
  if (typeof value === "string") return value ? [value] : [];
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap(stringLeaves);
}

/**
 * The build label map without `wrongly_escalated`: that label is a ruling
 * left on an item for good (CodySwannGT/lisa#4657), not a lane or a hold,
 * so it must not hide a released item from the backlog tier.
 * @param {unknown} build - `github.labels.build`
 * @returns {unknown} The map minus the ruling label
 */
export function withoutRuling(build) {
  if (!build || typeof build !== "object") return build;
  const { wrongly_escalated: _ruling, ...rest } = build;
  return rest;
}

/**
 * Fetch every open GitHub issue carrying no lifecycle label (build or PRD),
 * all pages: the GitHub backlog tier.
 * @param {object} ctx - CLI context
 * @param {{global?: object, local?: object}} project - Loaded project
 * @returns {{ items: object[], pages: number }} Normalized items
 */
export function fetchGithubBacklog(ctx, project) {
  const repo = githubRepo(ctx, project);
  const lifecycle = new Set(
    [project.global?.github?.labels, project.local?.github?.labels]
      .flatMap(labels => [
        ...stringLeaves(withoutRuling(labels?.build)),
        ...stringLeaves(labels?.prd),
      ])
      .map(label => label.toLowerCase())
  );
  const stdout = mustRun(
    "gh",
    [
      "api",
      "--paginate",
      "--slurp",
      `repos/${repo}/issues?state=open&per_page=100`,
    ],
    { env: scrubWorkerEnv(ctx.env) }
  );
  const pages = parseJson(stdout, "gh api output");
  const rows = Array.isArray(pages) ? pages.flat() : [];
  // The lifecycle test reads labels exactly as `normalizeGithubIssue` does,
  // and runs on the raw rows so an excluded issue costs no blocker read.
  const unlabelled = row =>
    !labelNames(row.labels).some(label => lifecycle.has(label.toLowerCase()));
  return {
    items: normalizeRows(ctx, project, repo, rows, unlabelled),
    pages: Array.isArray(pages) ? pages.length : 0,
  };
}

/**
 * Fetch every open GitHub issue carrying the ready label, all pages.
 * @param {object} ctx - CLI context
 * @param {{global?: object, local?: object}} project - Loaded project
 * @returns {{ items: object[], pages: number }} Normalized items
 */
export function fetchGithubQueue(ctx, project) {
  const repo = githubRepo(ctx, project);
  const role = resolveRole({
    role: "ready",
    vendor: "github",
    intent: "read",
    local: project.local,
    global: project.global,
  });
  const label = ctx.values.label ?? role.value;
  if (!label) throw new CliError(role.message, 2);
  const endpoint =
    `repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}` +
    `&per_page=100`;
  const stdout = mustRun("gh", ["api", "--paginate", "--slurp", endpoint], {
    env: scrubWorkerEnv(ctx.env),
  });
  const pages = parseJson(stdout, "gh api output");
  const rows = Array.isArray(pages) ? pages.flat() : [];
  return {
    items: normalizeRows(ctx, project, repo, rows),
    pages: Array.isArray(pages) ? pages.length : 0,
  };
}
