/**
 * File one ticket in the configured tracker, from a file, for a session with
 * no ticket bound (CodySwannGT/lisa#5198).
 *
 * The task-readiness guard refuses every tracker write while no ticket is
 * bound, so a session asked to "fix this" could not file the ticket the work
 * needs first. This is the one write it may make: the guard admits exactly
 * `node <owner> --tracker-create --input-file <file>`, the file sits outside
 * every repository (an agent's shell has no stdin), and this owner always
 * files into the configured repository, team or project. The input cannot
 * name another one.
 *
 * The readiness declaration `block-direct-issue-create` demands is enforced
 * here as well, so this path is never a way around it. The input says which
 * of the three it is, and the body has to agree:
 *
 * - `build-ready`: this owner applies the configured ready role itself (the
 *   GitHub label, or the Linear/Jira workflow state);
 * - `human-gate`: the body declares a `[lisa-human-gate]` hold;
 * - `container`: the body carries the canonical container line and the item
 *   names no by-design leaf type.
 * @module task-tracker-create
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { AccessFailure, plainObject } from "./config-layers.mjs";
import { readTaskConfig } from "./surfaces.mjs";
import { failure } from "./task-readiness.mjs";
import { outsideEveryRepository } from "./task-unbound.mjs";
import { selectedAccess } from "./task-intake-read.mjs";
import { githubEnvironment } from "./task-github.mjs";
import { jiraApi, linearRequest } from "./task-tracker-intake.mjs";
import { configuredIssueRepository } from "../../lisa-github-read-issue/read-contract.mjs";
import { markdownToAdf } from "../../lisa-atlassian-access/scripts/markdown-to-adf.mjs";
import { bodyDeclaresHold } from "../../../scripts/intake-blocker-reprobe.mjs";
import {
  OUTCOMES,
  resolveRole,
} from "../../../scripts/resolve-lifecycle-role.mjs";

/** The code every refusal of this command's own rules carries. */
export const REFUSED = "tracker-create-refused";
const READINESS = ["build-ready", "human-gate", "container"];
const FIELDS = ["title", "body", "labels", "readiness", "issue_type"];
const CONTAINER =
  /None\s*[—–-]\s*container:\s*state\s+rolls\s+up\s+from\s+children/iu;
const LEAF_TYPES = ["bug", "task", "sub-task", "subtask", "improvement"];
const MAX_BODY = 65536;
const MAX_TITLE = 256;

/** A refusal of this command's own rules, said in words the agent can act on. */
class CreateRefusal extends Error {}

const refuse = reason => {
  throw new CreateRefusal(reason);
};

/**
 * Validate the input file's object. Unknown fields are refused, so the input
 * cannot carry a repository, team or project of its own.
 * @param {unknown} input Parsed input file.
 * @returns {{title: string, body: string, labels: string[], readiness: string, issueType: string|undefined}} The request.
 */
export function createRequest(input) {
  if (!plainObject(input)) refuse("the input file must hold one JSON object.");
  const unknown = Object.keys(input).filter(key => !FIELDS.includes(key));
  if (unknown.length)
    refuse(
      `unknown field ${unknown.join(", ")}; the fields are ${FIELDS.join(", ")}. The ticket is always filed in this project's configured tracker.`
    );
  const { title, body, labels = [], readiness, issue_type: issueType } = input;
  if (
    typeof title !== "string" ||
    !title.trim() ||
    title.length > MAX_TITLE ||
    /[\r\n]/u.test(title)
  )
    refuse(`"title" must be one line of 1 to ${MAX_TITLE} characters.`);
  if (typeof body !== "string" || !body.trim() || body.length > MAX_BODY)
    refuse(
      `"body" must be the ticket's full text, up to ${MAX_BODY} characters.`
    );
  if (
    !Array.isArray(labels) ||
    labels.length > 50 ||
    !labels.every(
      label =>
        typeof label === "string" &&
        label.trim() === label &&
        label.length > 0 &&
        label.length <= 100 &&
        !label.includes(",")
    )
  )
    refuse(
      `"labels" must be a list of label names, each without commas or surrounding spaces.`
    );
  if (
    issueType !== undefined &&
    (typeof issueType !== "string" ||
      !/^[A-Za-z][\w -]{0,40}$/u.test(issueType))
  )
    refuse(`"issue_type" must be a plain issue type name, such as "Task".`);
  if (!READINESS.includes(readiness))
    refuse(
      `the filing declares no readiness. Set "readiness" to "build-ready" (complete enough to build), "human-gate" (a person must perform an act the agent cannot; the body must declare the [lisa-human-gate] hold), or "container" (an Epic whose state rolls up from its children). A filing without one is never picked up.`
    );
  return {
    title,
    body,
    labels: [...new Set(labels)],
    readiness,
    issueType,
  };
}

/**
 * Check that the body and labels agree with the declared readiness.
 * @param {ReturnType<typeof createRequest>} request The request.
 * @param {string} readyLabel GitHub's configured ready label, else "".
 * @returns {void}
 */
export function checkDeclaration(request, readyLabel = "") {
  const { body, labels, readiness, issueType } = request;
  const hold = bodyDeclaresHold(body);
  const container = CONTAINER.test(body);
  const leaf =
    LEAF_TYPES.includes(String(issueType ?? "").toLowerCase()) ||
    labels.some(label =>
      LEAF_TYPES.some(type => label.toLowerCase() === `type:${type}`)
    );
  const ready = readyLabel !== "" && labels.includes(readyLabel);
  if (readiness === "build-ready" && (hold || container))
    refuse(
      `"build-ready" contradicts the body, which declares ${hold ? "a [lisa-human-gate] hold" : "a container"}.`
    );
  if (readiness === "human-gate" && (!hold || container || ready))
    refuse(
      hold
        ? `a held ticket cannot also be ${container ? "a container" : `in the ready lane (${readyLabel})`}.`
        : `"human-gate" needs a body line that declares the hold, such as "<!-- [lisa-human-gate] reason=<short-slug> -->", after a sentence naming the act a person must perform.`
    );
  if (readiness === "container" && (!container || hold || leaf || ready))
    refuse(
      container
        ? "a container cannot carry a hold, the ready role, or a by-design leaf type (Bug, Task, Sub-task, Improvement)."
        : `"container" needs the body line "None — container: state rolls up from children" under "## Target Backend Environment".`
    );
}

/** The configured build-ready role for a state-based tracker, or a refusal. */
function readyState(cfg, vendor) {
  const resolved = resolveRole({
    role: "ready",
    vendor,
    intent: "write",
    local: {},
    global: cfg.effective,
  });
  if (resolved.outcome !== OUTCOMES.CONFIGURED || !resolved.value)
    refuse(
      `${vendor}.workflow.ready is not configured, so there is no ready state to file a build-ready ticket into.`
    );
  return resolved.value;
}

function createGithub(cfg, request) {
  const repo = configuredIssueRepository(cfg.effective?.github);
  if (!repo) throw new AccessFailure("config-invalid");
  const ready = cfg.effective.github?.labels?.build?.ready || "status:ready";
  checkDeclaration(request, ready);
  const labels =
    request.readiness === "build-ready"
      ? [...new Set([...request.labels, ready])]
      : request.labels;
  const env = githubEnvironment(selectedAccess(cfg, repo));
  let raw;
  try {
    raw = execFileSync(
      "gh",
      [
        "issue",
        "create",
        "--repo",
        repo,
        "--title",
        request.title,
        "--body-file",
        "-",
        ...labels.flatMap(label => ["--label", label]),
      ],
      {
        env,
        input: request.body,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 60000,
      }
    );
  } catch (error) {
    throw new AccessFailure(
      error.code === "ENOENT" ? "tool-missing" : "capability-unreachable"
    );
  }
  const url = raw.trim().split("\n").at(-1);
  const number = new RegExp(
    `^https://github\\.com/${repo}/issues/(\\d+)$`,
    "u"
  ).exec(url)?.[1];
  if (!number) throw new AccessFailure("capability-unreachable");
  return { ref: `${repo}#${number}`, url };
}

const linearTeam =
  "query($key:String!){teams(filter:{key:{eq:$key}}){nodes{id key states{nodes{id name}}}}}";
const linearLabels =
  "query($names:[String!]!){issueLabels(first:250,filter:{name:{in:$names}}){nodes{id name team{key}}}}";
const linearCreate =
  "mutation($input:IssueCreateInput!){issueCreate(input:$input){success issue{identifier url team{key}}}}";

/** Exactly one match, or a refusal naming what was looked for. */
function only(matches, what) {
  if (matches.length !== 1)
    refuse(
      `${what} matched ${matches.length} entries in the configured Linear team; it must match exactly one.`
    );
  return matches[0];
}

function createLinear(cfg, request) {
  checkDeclaration(request);
  const teamKey = cfg.effective.linear?.teamKey;
  const teams = linearRequest(cfg, linearTeam, { key: teamKey })?.data?.teams
    ?.nodes;
  if (!Array.isArray(teams)) throw new AccessFailure("capability-unreachable");
  const team = only(
    teams.filter(node => node.key === teamKey),
    `team ${teamKey}`
  );
  const input = {
    teamId: team.id,
    title: request.title,
    description: request.body,
  };
  if (request.readiness === "build-ready") {
    const name = readyState(cfg, "linear");
    input.stateId = only(
      (team.states?.nodes ?? []).filter(state => state.name === name),
      `ready state "${name}"`
    ).id;
  }
  if (request.labels.length) {
    const found = linearRequest(cfg, linearLabels, { names: request.labels })
      ?.data?.issueLabels?.nodes;
    if (!Array.isArray(found))
      throw new AccessFailure("capability-unreachable");
    input.labelIds = request.labels.map(
      name =>
        only(
          found.filter(
            label =>
              label.name === name && (!label.team || label.team.key === teamKey)
          ),
          `label "${name}"`
        ).id
    );
  }
  const created = linearRequest(cfg, linearCreate, { input })?.data
    ?.issueCreate;
  const issue = created?.issue;
  if (
    created?.success !== true ||
    issue?.team?.key !== teamKey ||
    !new RegExp(`^${teamKey}-[1-9]\\d*$`, "u").test(issue.identifier ?? "")
  )
    throw new AccessFailure("capability-unreachable");
  return { ref: issue.identifier, url: issue.url };
}

function createJira(cfg, request) {
  const project = cfg.effective.jira?.project;
  if (typeof project !== "string" || !/^[A-Z][A-Z0-9]*$/u.test(project))
    throw new AccessFailure("config-invalid");
  checkDeclaration(request);
  if (request.labels.some(label => /\s/u.test(label)))
    refuse("Jira labels cannot contain spaces.");
  const ready =
    request.readiness === "build-ready" ? readyState(cfg, "jira") : null;
  const api = jiraApi(cfg);
  if (api.unavailable) throw new AccessFailure(api.unavailable);
  const created = api.call("/issue", "POST", {
    fields: {
      project: { key: project },
      summary: request.title,
      description: markdownToAdf(request.body),
      issuetype: { name: request.issueType ?? "Task" },
      ...(request.labels.length ? { labels: request.labels } : {}),
    },
  });
  const key = created?.key;
  if (!new RegExp(`^${project}-[1-9]\\d*$`, "u").test(key ?? ""))
    throw new AccessFailure("capability-unreachable");
  const site = cfg.effective.atlassian?.site;
  const filed = {
    ref: key,
    url: site
      ? `${new URL(site.includes("://") ? site : `https://${site}`).origin}/browse/${key}`
      : null,
  };
  if (ready) moveJira(api, filed, ready);
  return filed;
}

/** Jira sets no status at creation, so a build-ready ticket is moved after. */
function moveJira(api, filed, ready) {
  const endpoint = `/issue/${filed.ref}`;
  if (api.call(`${endpoint}?fields=status`)?.fields?.status?.name === ready)
    return;
  const moves = (api.call(`${endpoint}/transitions`)?.transitions ?? []).filter(
    transition => transition.to?.name === ready
  );
  if (moves.length !== 1)
    throw Object.assign(
      new CreateRefusal(
        `${filed.ref} was created, but it has no single transition into the ready state "${ready}", so it is not in the ready lane yet. Do not file it again; move it to "${ready}" through lisa-atlassian-access.`
      ),
      { filed }
    );
  api.call(`${endpoint}/transitions`, "POST", {
    transition: { id: moves[0].id },
  });
}

const creators = {
  github: createGithub,
  linear: createLinear,
  jira: createJira,
};

/**
 * Run `--tracker-create --input-file <file>` and print the filed ticket.
 * @param {string[]} [args] Arguments after the script.
 * @returns {void}
 */
export function runTrackerCreate(args = process.argv.slice(2)) {
  let cfg, tracker;
  try {
    cfg = readTaskConfig();
    tracker = cfg.effective?.tracker;
    const [mode, flag, file] = args;
    if (
      args.length !== 3 ||
      mode !== "--tracker-create" ||
      flag !== "--input-file"
    )
      refuse("run exactly: --tracker-create --input-file <absolute path>.");
    if (!outsideEveryRepository(file, cfg.projectRoot))
      refuse(
        "the input file must be an absolute path outside every git repository, such as a scratch file."
      );
    if (!Object.hasOwn(creators, tracker ?? ""))
      throw new AccessFailure("config-invalid");
    let input;
    try {
      input = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      refuse("the input file could not be read as JSON.");
    }
    const filed = creators[tracker](cfg, createRequest(input));
    console.log(JSON.stringify({ code: "tracker-created", ...filed }));
  } catch (error) {
    if (error instanceof CreateRefusal) {
      if (error.filed)
        console.log(
          JSON.stringify({ code: "tracker-created", ...error.filed })
        );
      console.error(`${REFUSED}: ${error.message}`);
    } else {
      const owner = {
        github: undefined,
        linear: "lisa-linear-access",
        jira: "lisa-atlassian-access",
      }[tracker];
      const diagnostic = failure(
        error instanceof AccessFailure ? error.code : "config-invalid",
        {
          cfg,
          name:
            {
              linear: "LINEAR_API_KEY",
              jira: "ATLASSIAN_API_TOKEN",
            }[tracker] ?? "GH_TOKEN",
          ...(owner ? { owner } : { tool: "gh" }),
        }
      );
      console.error(`${diagnostic.code}: ${diagnostic.action}`);
    }
    process.exitCode = 2;
  }
}
