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
 *
 * With `sessionManager.backlogPickup` on, `queue` also ranks the backlog tier
 * (open leaves in no lifecycle role) as `backlogOrdered`, under the same
 * paging rule. The manager walks it only after the whole Ready queue.
 * @module session-manager/cli-queue
 */
import { readFileSync } from "node:fs";

import {
  assertPagedToCompletion,
  normalizeGithubIssue,
  normalizeJiraIssue,
  normalizeLinearIssue,
  orderBacklogQueue,
  orderReadyQueue,
} from "../../../scripts/ready-queue-order.mjs";
import { resolveRole } from "../../../scripts/resolve-lifecycle-role.mjs";
import {
  CliError,
  asSetupError,
  humanNeededLabel,
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
 * The GitHub repo to read: `--github-repo`, else github.org/github.repo.
 * @param {object} ctx - CLI context
 * @param {ReturnType<typeof loadProject>} project - Loaded project
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
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @returns {{ items: object[], pages: number }} Normalized items
 */
function fetchGithubBacklog(ctx, project) {
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
 * @param {ReturnType<typeof loadProject>} project - Loaded project
 * @returns {{ items: object[], pages: number }} Normalized items
 */
function fetchGithubQueue(ctx, project) {
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

/**
 * Check one paged envelope and normalize its raw issues.
 * @param {unknown} envelope - `{complete, pages, items}`
 * @param {string} where - Where it came from, for messages
 * @param {"jira"|"linear"} tracker - Vendor
 * @returns {{ items: object[], pages: unknown }} Normalized items
 */
function normalizeEnvelope(envelope, where, tracker) {
  asSetupError(() => assertPagedToCompletion(envelope));
  if (!Array.isArray(envelope.items)) {
    throw new CliError(`${where}: items must be an array.`, 2);
  }
  return {
    items: envelope.items.map(NORMALIZERS[tracker]),
    pages: envelope.pages ?? null,
  };
}

/**
 * Read a vendor-skill envelope and normalize its raw issues. With
 * `withBacklog`, the envelope must also carry `backlog`, a second
 * `{complete, pages, items}` envelope held to the same paging rule.
 * @param {object} ctx - CLI context
 * @param {"jira"|"linear"} tracker - Vendor
 * @param {boolean} withBacklog - Whether the backlog tier is required
 * @returns {{ items: object[], pages: unknown, backlog: { items: object[], pages: unknown } | null }} Normalized items
 */
function readEnvelopeQueue(ctx, tracker, withBacklog) {
  const file = ctx.values.input;
  if (!file) {
    throw new CliError(`queue --tracker ${tracker} needs --input <file>.`, 2);
  }
  const envelope = readJsonFile(file);
  const ready = normalizeEnvelope(envelope, file, tracker);
  if (!withBacklog) return { ...ready, backlog: null };
  if (!envelope.backlog) {
    throw new CliError(
      `${file}: sessionManager.backlogPickup is on, so the input needs a ` +
        `"backlog" envelope {complete:true,pages,items} of open leaf items ` +
        `in no lifecycle role.`,
      2
    );
  }
  return {
    ...ready,
    backlog: normalizeEnvelope(envelope.backlog, `${file} backlog`, tracker),
  };
}

/**
 * Refs waiting on a human: every ledger item with a pending question.
 * @param {{items: Record<string, {pendingQuestion?: unknown}>}} ledger - Ledger
 * @returns {Set<string>} Refs
 */
function pendingRefs(ledger) {
  return new Set(
    Object.entries(ledger.items)
      .filter(([, item]) => item.pendingQuestion)
      .map(([ref]) => ref)
  );
}

/**
 * Move items waiting on a human out of `ordered` into `excluded` with reason
 * `pending-question` (#4555). The item stays marked for its human; every
 * other item is still dispatched, so one question never stalls the queue.
 * @param {{ordered: {ref: string}[], excluded: {ref: string, reason: string}[]}} order - Ordered tier
 * @param {Set<string>} waiting - Refs with a pending question
 * @returns {{ordered: {ref: string}[], excluded: {ref: string, reason: string}[]}} Filtered tier
 */
function withoutPending(order, waiting) {
  return {
    ...order,
    ordered: order.ordered.filter(item => !waiting.has(item.ref)),
    excluded: [
      ...order.excluded,
      ...order.ordered
        .filter(item => waiting.has(item.ref))
        .map(item => ({ ref: item.ref, reason: "pending-question" })),
    ],
  };
}

/**
 * `queue --tracker <github|jira|linear>`: the Ready queue, the operator's
 * items first (`sessionManager.operatorIds`), then mine, then unassigned.
 * @param {object} ctx - CLI context
 * With `sessionManager.backlogPickup` on it also returns the backlog tier,
 * ordered the same way and always dispatched after every Ready item.
 * @param {object} ctx - CLI context
 * @returns {Promise<{ json: object }>}
 *   `{tracker,me,operators,total,pages,ordered,excluded,backlogPickup[,
 *   backlogTotal,backlogPages,backlogOrdered,backlogExcluded]}`
 */
export async function queue(ctx) {
  const tracker = ctx.values.tracker;
  if (tracker !== "github" && !Object.hasOwn(NORMALIZERS, tracker ?? "")) {
    throw new CliError("--tracker must be github, jira or linear.", 2);
  }
  const project = loadProject(ctx.root);
  const config = validOrAbsent(project);
  const backlogPickup = config?.backlogPickup === true;
  const { items, pages, backlog } =
    tracker === "github"
      ? {
          ...fetchGithubQueue(ctx, project),
          backlog: backlogPickup ? fetchGithubBacklog(ctx, project) : null,
        }
      : readEnvelopeQueue(ctx, tracker, backlogPickup);
  const ledger = await readLedger(ctx.root);
  const me = ctx.values.me ?? ledger.control.me ?? null;
  const operators = config?.operatorIds ?? [];
  const policy = {
    me,
    operators,
    trustedAuthorIds: config?.trustedAuthorIds ?? undefined,
    humanNeededLabel: humanNeededLabel(project, tracker),
  };
  const waiting = pendingRefs(ledger);
  const order = withoutPending(orderReadyQueue(items, policy), waiting);
  const json = {
    tracker,
    me,
    operators,
    total: items.length,
    pages,
    ...order,
    backlogPickup,
  };
  if (!backlog) return { json };
  // An item both Ready and in the backlog fetch is Ready work; never twice.
  const readyRefs = new Set(items.map(item => item.ref));
  const backlogItems = backlog.items.filter(item => !readyRefs.has(item.ref));
  const tier = withoutPending(
    orderBacklogQueue(backlogItems, {
      ...policy,
      validationFailures: ledger.validationFailures,
    }),
    waiting
  );
  return {
    json: {
      ...json,
      backlogTotal: backlogItems.length,
      backlogPages: backlog.pages,
      backlogOrdered: tier.ordered,
      backlogExcluded: tier.excluded,
    },
  };
}
