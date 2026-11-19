/**
 * `stale-links-plan`: the session manager's per-cycle sweep for "blocked by"
 * links whose blocker is already finished (CodySwannGT/lisa#5065). The plan
 * writes nothing; the manager performs each action through the tracker's
 * access layer, reads it back, then posts the plan's comment.
 *
 * The judging lives in the shared `stale-blocker-sweep.mjs`, so any agent's
 * intake can run the same rule without this Claude Code-only manager.
 * @module session-manager/cli-stale-links
 */
import { resolveRole } from "../../../scripts/resolve-lifecycle-role.mjs";
import { confirmStaleLinkPlan } from "../../../scripts/stale-blocker-confirm.mjs";
import { terminalDoneRoles } from "../../../scripts/stale-blocker-edges.mjs";
import {
  planStaleLinkSweep,
  summarizeStaleLinkSweep,
} from "../../../scripts/stale-blocker-sweep.mjs";
import {
  CliError,
  asSetupError,
  intFlag,
  loadProject,
} from "./cli-runtime.mjs";
import { readJsonFile } from "./json-input.mjs";
import {
  collectGithubStaleLinkInput,
  readGithubStaleLinkItem,
} from "./stale-links-github.mjs";

/**
 * @param {unknown} value
 * @returns {string}
 */
const text = value => (typeof value === "string" ? value : "");

const TRACKERS = new Set(["github", "jira", "linear"]);
const OWNER_REPO = /^[\w.-]+\/[\w.-]+$/;

/**
 * The configured name of one lifecycle role, or "" when unset.
 * @param {ReturnType<typeof loadProject>} project
 * @param {string} tracker
 * @param {string} role
 * @returns {string}
 */
function roleValue(project, tracker, role) {
  return resolveRole({
    role,
    vendor: tracker,
    intent: "read",
    local: project.local,
    global: project.global,
  }).value;
}

/**
 * The GitHub repo to sweep: `--github-repo`, else github.org/github.repo.
 * @param {object} ctx - CLI context
 * @param {ReturnType<typeof loadProject>} project
 * @returns {string}
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
 * The raw items to judge: read from GitHub, or from the vendor skill's
 * envelope for Jira and Linear (paged to completion, like `queue`).
 * @param {object} ctx - CLI context
 * @param {string} tracker
 * @param {ReturnType<typeof loadProject>} project
 * @returns {object[]}
 */
function rawItems(ctx, tracker, project) {
  if (!ctx.values.input) {
    if (tracker === "github") {
      return collectGithubStaleLinkInput(ctx, githubRepo(ctx, project)).items;
    }
    throw new CliError(
      `stale-links-plan --tracker ${tracker} needs --input <file>.`,
      2
    );
  }
  const envelope = readJsonFile(ctx.values.input);
  if (envelope?.complete !== true || !Array.isArray(envelope.items)) {
    throw new CliError(
      `${ctx.values.input}: expected {"complete":true,"items":[...]} read to the last page.`,
      2
    );
  }
  return envelope.items;
}

/**
 * The tracker to sweep: `--tracker`, else the project's configured tracker.
 * @param {object} ctx - CLI context
 * @param {ReturnType<typeof loadProject>} project
 * @returns {"github" | "jira" | "linear"}
 */
function trackerOf(ctx, project) {
  const tracker =
    ctx.values.tracker ?? project.local?.tracker ?? project.global?.tracker;
  if (!TRACKERS.has(tracker ?? "")) {
    throw new CliError("--tracker must be github, jira or linear.", 2);
  }
  return tracker;
}

/**
 * The configured roles and done names every sweep judges against.
 * @param {ReturnType<typeof loadProject>} project
 * @param {string} tracker
 * @returns {{ doneRoles: string[], roles: { ready: string, blocked: string }, posterName: string }}
 */
function judgingContext(project, tracker) {
  return {
    doneRoles: terminalDoneRoles({
      tracker,
      global: project.global,
      local: project.local,
    }),
    roles: {
      ready: roleValue(project, tracker, "ready"),
      blocked: roleValue(project, tracker, "blocked"),
    },
    // The comment names the configured manager; the prefix stays the marker.
    posterName: text(project.config?.name),
  };
}

/**
 * `stale-links-plan --tracker <t> [--input <file>] [--max <n>]`.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{tracker,doneRoles,plans,deferred,report,summary}`
 */
export function staleLinksPlan(ctx) {
  const project = loadProject(ctx.root);
  const tracker = trackerOf(ctx, project);
  const max = intFlag(ctx.values.max, "--max");
  const items = rawItems(ctx, tracker, project);
  return {
    json: asSetupError(() => {
      const context = judgingContext(project, tracker);
      const plan = planStaleLinkSweep({
        tracker,
        items,
        ...context,
        ...(max === undefined ? {} : { max }),
      });
      return {
        tracker,
        doneRoles: context.doneRoles,
        ...plan,
        summary: summarizeStaleLinkSweep(plan.report),
      };
    }),
  };
}

/**
 * The item as it stands now: `--input`, or a fresh GitHub read.
 * @param {object} ctx - CLI context
 * @param {string} tracker
 * @param {{ ref?: string }} plan - The plan entry being confirmed
 * @returns {Record<string, any>}
 */
function freshItem(ctx, tracker, plan) {
  if (ctx.values.input) return readJsonFile(ctx.values.input);
  if (tracker !== "github") {
    throw new CliError(
      `stale-links-confirm --tracker ${tracker} needs --input <file>.`,
      2
    );
  }
  const [repo, number] = String(plan?.ref ?? "").split("#");
  return readGithubStaleLinkItem(ctx, repo, Number(number));
}

/**
 * `stale-links-confirm --tracker <t> --plan <file> [--input <file>]`: rebuild
 * one plan entry from a fresh read of the item and its blockers, right before
 * the writes. GitHub re-reads itself; Jira and Linear take the fresh raw item
 * (with each blocker's current status, and the comments) in `--input`.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{tracker,plan,skipped}`; plan is null when
 *   nothing is still safe to remove
 */
export function staleLinksConfirm(ctx) {
  const project = loadProject(ctx.root);
  const tracker = trackerOf(ctx, project);
  if (!ctx.values.plan) {
    throw new CliError("stale-links-confirm needs --plan <file>.", 2);
  }
  const plan = readJsonFile(ctx.values.plan);
  const fresh = freshItem(ctx, tracker, plan);
  return {
    json: asSetupError(() => ({
      tracker,
      ...confirmStaleLinkPlan({
        tracker,
        plan,
        fresh,
        ...judgingContext(project, tracker),
      }),
    })),
  };
}
