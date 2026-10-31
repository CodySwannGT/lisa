/**
 * The GitHub fetches behind the session-manager `queue` subcommand, split out
 * of cli-queue.mjs to keep it under the line budget (#4555): the Ready tier
 * ({@link fetchGithubQueue}) and the backlog tier ({@link fetchGithubBacklog}).
 * Both read with `gh api --paginate --slurp`, so every page is read or the
 * command fails, and both run gh with the scrubbed worker env.
 * @module session-manager/queue-github
 */
import { normalizeGithubIssue } from "../../../scripts/ready-queue-order.mjs";
import { resolveRole } from "../../../scripts/resolve-lifecycle-role.mjs";
import { CliError, mustRun } from "./cli-runtime.mjs";
import { parseJson } from "./json-input.mjs";
import { scrubWorkerEnv } from "./workers.mjs";

const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/;

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
        ...stringLeaves(labels?.build),
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
  return {
    items: rows
      .map(row => normalizeGithubIssue(row, { repo }))
      .filter(Boolean)
      .filter(
        item => !item.labels.some(label => lifecycle.has(label.toLowerCase()))
      ),
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
    items: rows.map(row => normalizeGithubIssue(row, { repo })).filter(Boolean),
    pages: Array.isArray(pages) ? pages.length : 0,
  };
}
