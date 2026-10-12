/**
 * The `queue` subcommand of the session-manager CLI: the Ready queue, mine
 * first, paged to completion.
 *
 * "Page to completion" is executable here rather than prose. GitHub is
 * fetched by this module with `gh api --paginate --slurp`, so every page is
 * read or the command fails. Jira and Linear are fetched by their vendor
 * skills (a script cannot reach them), which write an envelope
 * `{complete, pages, items}`; anything but a literal `complete: true` is
 * refused with exit 2, because ordering a partial queue would dispatch the
 * wrong item with full confidence.
 * @module session-manager/cli-queue
 */
import { readFileSync } from "node:fs";

import {
  assertPagedToCompletion,
  normalizeGithubIssue,
  normalizeJiraIssue,
  normalizeLinearIssue,
  orderReadyQueue,
} from "../../../scripts/ready-queue-order.mjs";
import { resolveRole } from "../../../scripts/resolve-lifecycle-role.mjs";
import {
  CliError,
  asSetupError,
  loadProject,
  mustRun,
  validOrAbsent,
} from "./cli-runtime.mjs";
import { readLedger } from "./ledger.mjs";
import { scrubWorkerEnv } from "./workers.mjs";

const NORMALIZERS = { jira: normalizeJiraIssue, linear: normalizeLinearIssue };

const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/;

/**
 * Parse JSON, or exit 2 naming the source.
 * @param {string} text - JSON text
 * @param {string} source - Where it came from
 * @returns {any} Parsed value
 */
export function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new CliError(`${source} is not valid JSON: ${error.message}`, 2);
  }
}

/**
 * Read a JSON file named by a flag, or exit 2.
 * @param {string} file - Path
 * @returns {any} Parsed value
 */
export function readJsonFile(file) {
  const text = asSetupError(() => readFileSync(file, "utf8"));
  return parseJson(text, file);
}

/**
 * Fetch every open GitHub issue carrying the ready label, all pages.
 * @param {object} ctx - CLI context
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @returns {{ items: object[], pages: number }} Normalized items
 */
function fetchGithubQueue(ctx, project) {
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

/**
 * Read a vendor-skill envelope and normalize its raw issues.
 * @param {object} ctx - CLI context
 * @param {"jira"|"linear"} tracker - Vendor
 * @returns {{ items: object[], pages: unknown }} Normalized items
 */
function readEnvelopeQueue(ctx, tracker) {
  const file = ctx.values.input;
  if (!file) {
    throw new CliError(`queue --tracker ${tracker} needs --input <file>.`, 2);
  }
  const envelope = readJsonFile(file);
  asSetupError(() => assertPagedToCompletion(envelope));
  if (!Array.isArray(envelope.items)) {
    throw new CliError(`${file}: items must be an array.`, 2);
  }
  return {
    items: envelope.items.map(NORMALIZERS[tracker]),
    pages: envelope.pages ?? null,
  };
}

/**
 * `queue --tracker <github|jira|linear>`: the Ready queue, mine first.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>} `{tracker,me,total,pages,ordered,excluded}`
 */
export async function queue(ctx) {
  const tracker = ctx.values.tracker;
  if (tracker !== "github" && !Object.hasOwn(NORMALIZERS, tracker ?? "")) {
    throw new CliError("--tracker must be github, jira or linear.", 2);
  }
  const project = loadProject(ctx.root);
  const config = validOrAbsent(project);
  const { items, pages } =
    tracker === "github"
      ? fetchGithubQueue(ctx, project)
      : readEnvelopeQueue(ctx, tracker);
  const me = ctx.values.me ?? (await readLedger(ctx.root)).control.me ?? null;
  const order = orderReadyQueue(items, {
    me,
    trustedAuthorIds: config?.trustedAuthorIds ?? undefined,
  });
  return { json: { tracker, me, total: items.length, pages, ...order } };
}
