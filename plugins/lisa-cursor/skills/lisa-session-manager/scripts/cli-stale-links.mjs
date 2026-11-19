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
import { collectGithubStaleLinkInput } from "./stale-links-github.mjs";

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
 * `stale-links-plan --tracker <t> [--input <file>] [--max <n>]`.
 * @param {object} ctx - CLI context
 * @returns {{ json: object }} `{tracker,doneRoles,plans,deferred,report,summary}`
 */
export function staleLinksPlan(ctx) {
  const project = loadProject(ctx.root);
  const tracker =
    ctx.values.tracker ?? project.local?.tracker ?? project.global?.tracker;
  if (!TRACKERS.has(tracker ?? "")) {
    throw new CliError("--tracker must be github, jira or linear.", 2);
  }
  const max = intFlag(ctx.values.max, "--max");
  const items = rawItems(ctx, tracker, project);
  return {
    json: asSetupError(() => {
      const doneRoles = terminalDoneRoles({
        tracker,
        global: project.global,
        local: project.local,
      });
      const plan = planStaleLinkSweep({
        tracker,
        items,
        doneRoles,
        roles: {
          ready: roleValue(project, tracker, "ready"),
          blocked: roleValue(project, tracker, "blocked"),
        },
        ...(max === undefined ? {} : { max }),
      });
      return {
        tracker,
        doneRoles,
        ...plan,
        summary: summarizeStaleLinkSweep(plan.report),
      };
    }),
  };
}
