#!/usr/bin/env node
/**
 * Shared automation-status expected-fleet helpers.
 *
 * This module resolves the same naming, queue arguments, cadence, and
 * exploratory support decisions documented by `/lisa:setup-automations`, so
 * automation-status and later runtime adapters do not invent a second source of
 * truth.
 */

import {
  resolveBuildQueueArgument,
  resolveGithubQueueRepoRef,
  resolveGithubRepoRef,
  resolvePrdQueueArgument,
  resolvePrdSource,
} from "./queue-contract-resolution.mjs";

export const AUTOMATION_EXPECTED_CADENCES = {
  "intake-repair": {
    human: "every 60 minutes",
    rrule: "FREQ=HOURLY;INTERVAL=1",
  },
  "intake-prd": {
    human: "every 60 minutes",
    rrule: "FREQ=HOURLY;INTERVAL=1",
  },
  "intake-tickets": {
    human: "every 10 minutes",
    rrule: "FREQ=MINUTELY;INTERVAL=10",
  },
  "exploratory-bugs": {
    human: "once a day",
    rrule: "FREQ=DAILY;INTERVAL=1",
  },
  "exploratory-prds": {
    human: "once a day",
    rrule: "FREQ=DAILY;INTERVAL=1",
  },
  monitor: {
    human: "once a day",
    rrule: "FREQ=DAILY;INTERVAL=1",
  },
  "learnings-audit": {
    human: "once a week",
    rrule: "FREQ=WEEKLY;INTERVAL=1",
  },
};

export const EXPLORATORY_QA_STACK_PRIORITY = ["expo", "rails", "harper-fabric"];

/**
 * Directory (repo-relative) holding the checked-in per-loop runbooks scaffolded
 * by `/lisa:setup-automations` per the `automation-runbook-contract` rule.
 */
export const AUTOMATION_RUNBOOK_DIRECTORY = ".lisa/automations";

/**
 * Every fleet group, in render order, with the operator-facing title each one
 * carries in the status report. This is the single source of truth for group
 * membership: adapters bin entries with {@link createAutomationGroupBins} and
 * render with {@link renderAutomationGroups}, so adding a group here surfaces it
 * everywhere instead of silently dropping its entries.
 */
export const AUTOMATION_FLEET_GROUP_TITLES = {
  core: "Core automations",
  exploratory: "Exploratory automations",
  "opt-in": "Opt-in automations",
};

/**
 * Create one empty bin per known fleet group.
 *
 * @returns {Map<string, object[]>}
 */
export function createAutomationGroupBins() {
  return new Map(
    Object.keys(AUTOMATION_FLEET_GROUP_TITLES).map(group => [group, []])
  );
}

/**
 * Add a rendered status item to its group bin.
 *
 * Throws on an unknown group rather than dropping the item: a silently skipped
 * entry is indistinguishable from a healthy fleet, which is exactly how the
 * opt-in gardener went missing from both runtime adapters.
 *
 * @param {Map<string, object[]>} bins
 * @param {string} group
 * @param {object} item
 * @returns {void}
 */
export function assignToAutomationGroup(bins, group, item) {
  const bin = bins.get(group);
  if (!bin) {
    throw new Error(
      `Unknown automation fleet group "${group}" for ${item?.id ?? "an automation"}. Add it to AUTOMATION_FLEET_GROUP_TITLES so the status report can render it.`
    );
  }
  bin.push(item);
}

/**
 * Render the group bins as the numbered report groups, in declaration order.
 *
 * @param {Map<string, object[]>} bins
 * @returns {readonly { readonly id: string, readonly title: string, readonly items: readonly object[] }[]}
 */
export function renderAutomationGroups(bins) {
  return Object.entries(AUTOMATION_FLEET_GROUP_TITLES).map(
    ([group, title], index) => ({
      id: String(index + 1),
      title,
      items: bins.get(group) ?? [],
    })
  );
}

/**
 * @typedef {{
 *   readonly id: string
 *   readonly automationId: string
 *   readonly expectedCadence: string
 *   readonly expectedRRule: string
 *   readonly expectedCommand: string
 *   readonly group: "core" | "exploratory" | "opt-in"
 *   readonly runbookPath: string
 * }} ExpectedAutomationEntry
 *
 * @typedef {{
 *   readonly id: string
 *   readonly automationId: string
 *   readonly group: "core" | "exploratory" | "opt-in"
 *   readonly reason: string
 *   readonly expectedCadence: string
 *   readonly expectedRRule: string
 *   readonly runbookPath: string
 * }} UnsupportedAutomationEntry
 */

/**
 * Infer whether this project opted into the weekly gardener, from what is
 * actually registered on the scheduler.
 *
 * Membership is registration, not configuration: there is no config key to
 * read, so a read-only caller decides by looking for the registration itself.
 * Pass the result as `learningsAudit` to {@link resolveExpectedAutomationFleet}
 * so an opted-in project compares its gardener like any other loop instead of
 * reporting it `UNSUPPORTED` forever.
 *
 * @param {{
 *   readonly automationPrefix: string
 *   readonly observedAutomationIds?: readonly string[]
 * }} input
 * @returns {boolean}
 */
export function inferLearningsAuditRegistration(input) {
  const target = `${input.automationPrefix}learnings-audit`;
  return (input.observedAutomationIds ?? []).includes(target);
}

/**
 * Resolve the repo-relative runbook path for a loop id.
 *
 * @param {string} id
 * @returns {string}
 */
export function resolveAutomationRunbookPath(id) {
  return `${AUTOMATION_RUNBOOK_DIRECTORY}/${id}.runbook.md`;
}

/**
 * Resolve the stable project identifier and automation prefix used by
 * `/lisa:setup-automations`.
 *
 * @param {{
 *   readonly config?: Record<string, any>
 *   readonly gitRemoteUrl?: string
 * }} input
 * @returns {{ readonly owner: string, readonly repo: string, readonly project: string, readonly automationPrefix: string }}
 */
export function resolveAutomationProjectIdentity(input = {}) {
  const githubRef = resolveGithubRepoRef(
    input.config ?? {},
    input.gitRemoteUrl
  );

  if (!githubRef) {
    throw new Error(
      "Unable to resolve repo identity for automation naming. Configure github.org/github.repo or provide a GitHub origin remote."
    );
  }

  const project = slugifyProjectToken(`${githubRef.owner}-${githubRef.repo}`);

  return {
    ...githubRef,
    project,
    automationPrefix: `lisa-auto-${project}-`,
  };
}

/**
 * Resolve the expected Lisa automation fleet for the current repo.
 *
 * @param {{
 *   readonly config?: Record<string, any>
 *   readonly gitRemoteUrl?: string
 *   readonly detectedTypes?: readonly string[]
 *   readonly autoStartPrds?: boolean | string
 *   readonly autoStartTickets?: boolean | string
 *   readonly learningsAudit?: boolean | string
 * }} input
 *
 * `learningsAudit` has no config home by design — the gardener is opted into at
 * registration time, and membership is registration, not configuration. A
 * read-only caller (the status surface) therefore INFERS it: pass `true` when a
 * `<automationPrefix>learnings-audit` entry is observed on the runtime
 * scheduler. Without that inference an opted-in project would report the
 * gardener `UNSUPPORTED` forever instead of comparing it like any other loop.
 * @returns {{
 *   readonly owner: string
 *   readonly repo: string
 *   readonly project: string
 *   readonly automationPrefix: string
 *   readonly expected: readonly ExpectedAutomationEntry[]
 *   readonly unsupported: readonly UnsupportedAutomationEntry[]
 * }}
 */
export function resolveExpectedAutomationFleet(input = {}) {
  const config = input.config ?? {};
  const identity = resolveAutomationProjectIdentity(input);
  const autoStartPrds = normalizeBooleanFlag(input.autoStartPrds);
  const autoStartTickets = normalizeBooleanFlag(input.autoStartTickets);
  const learningsAudit = normalizeBooleanFlag(input.learningsAudit);
  const detectedTypes = input.detectedTypes ?? [];

  const tracker = config.tracker;
  const source = resolvePrdSource(config);
  const explicitGithubIdentity = `${identity.owner}/${identity.repo}`;
  const githubQueue =
    tracker === "github"
      ? resolveGithubQueueRepoRef(config, {
          gitRemoteUrl: input.gitRemoteUrl,
        })
      : null;
  const explicitGithubQueue = githubQueue
    ? `${githubQueue.owner}/${githubQueue.repo}`
    : undefined;
  const prdQueue =
    source === "github"
      ? `${explicitGithubIdentity} intake_mode=prd`
      : resolvePrdQueueArgument(config, source);
  const buildQueue = resolveBuildQueueArgument(config, tracker, {
    explicitQueue: tracker === "github" ? explicitGithubQueue : undefined,
    gitRemoteUrl: input.gitRemoteUrl,
  });
  const repairQueue = resolveRepairQueueArgument(
    config,
    source,
    tracker,
    explicitGithubIdentity,
    explicitGithubQueue,
    buildQueue
  );

  const expected = [
    createExpectedEntry(
      identity,
      "intake-repair",
      `/lisa:repair-intake ${repairQueue}`,
      "core"
    ),
    createExpectedEntry(
      identity,
      "intake-prd",
      `/lisa:intake ${prdQueue}`,
      "core"
    ),
    createExpectedEntry(
      identity,
      "intake-tickets",
      `/lisa:intake ${buildQueue}`,
      "core"
    ),
    createExpectedEntry(identity, "monitor", "/lisa:monitor", "core"),
    createExpectedEntry(
      identity,
      "exploratory-prds",
      `/lisa:project-ideation prd_ready=${String(autoStartPrds)}`,
      "exploratory"
    ),
  ];

  const exploratoryStack = resolveExploratoryQaStack(detectedTypes);
  const unsupported = [];

  if (exploratoryStack) {
    expected.push(
      createExpectedEntry(
        identity,
        "exploratory-bugs",
        `/lisa-${exploratoryStack}:exploratory-qa ready=${String(autoStartTickets)}`,
        "exploratory"
      )
    );
  } else {
    unsupported.push(
      createUnsupportedEntry(
        identity,
        "exploratory-bugs",
        "This project ships no exploratory-qa command, so there is nothing for this loop to run. No action needed unless the project adds one.",
        "exploratory"
      )
    );
  }

  if (learningsAudit) {
    expected.push(
      createExpectedEntry(
        identity,
        "learnings-audit",
        "/lisa:learnings:audit",
        "opt-in"
      )
    );
  } else {
    unsupported.push(
      createUnsupportedEntry(
        identity,
        "learnings-audit",
        "The weekly gardener loop is opt-in and this project has not opted in, so nobody is auditing its knowledge surfaces. Run /lisa:setup-automations learnings-audit=true to enable it.",
        "opt-in"
      )
    );
  }

  return {
    ...identity,
    expected,
    unsupported,
  };
}

/**
 * Return the supported exploratory-qa surface for the detected host stacks.
 *
 * @param {readonly string[]} detectedTypes
 * @returns {string | null}
 */
export function resolveExploratoryQaStack(detectedTypes = []) {
  for (const stack of EXPLORATORY_QA_STACK_PRIORITY) {
    if (detectedTypes.includes(stack)) {
      return stack;
    }
  }
  return null;
}

/**
 * @param {{ readonly automationPrefix: string }} identity
 * @param {string} id
 * @param {string} expectedCommand
 * @param {"core" | "exploratory" | "opt-in"} group
 * @returns {ExpectedAutomationEntry}
 */
function createExpectedEntry(identity, id, expectedCommand, group) {
  const cadence = AUTOMATION_EXPECTED_CADENCES[id];
  return {
    id,
    automationId: `${identity.automationPrefix}${id}`,
    expectedCadence: cadence.human,
    expectedRRule: cadence.rrule,
    expectedCommand,
    group,
    runbookPath: resolveAutomationRunbookPath(id),
  };
}

/**
 * @param {{ readonly automationPrefix: string }} identity
 * @param {string} id
 * @param {string} reason
 * @param {"core" | "exploratory" | "opt-in"} group
 * @returns {UnsupportedAutomationEntry}
 */
function createUnsupportedEntry(identity, id, reason, group) {
  const cadence = AUTOMATION_EXPECTED_CADENCES[id];
  return {
    id,
    automationId: `${identity.automationPrefix}${id}`,
    expectedCadence: cadence.human,
    expectedRRule: cadence.rrule,
    group,
    reason,
    runbookPath: resolveAutomationRunbookPath(id),
  };
}

/**
 * @param {Record<string, any>} config
 * @param {string | undefined} source
 * @param {string | undefined} tracker
 * @returns {string}
 */
function resolveRepairQueueArgument(
  config,
  source,
  tracker,
  explicitGithubIdentity,
  explicitGithubQueue,
  resolvedBuildQueue
) {
  if (tracker === "github" && source === "github") {
    requireGithubRepo(config);
    return `${explicitGithubIdentity} intake_mode=both build_queue=${explicitGithubQueue}`;
  }

  if (tracker === "linear" && source === "linear") {
    requireLinearWorkspace(config);
    return "linear";
  }

  if (tracker === "jira" && source === "jira") {
    const project = config.jira?.project;
    if (!project) {
      throw new Error(
        "Unable to resolve the repair queue: jira.project is required when tracker=jira and source=jira."
      );
    }
    return project;
  }

  if (tracker === "github" && source === undefined) {
    requireGithubRepo(config);
    return `${explicitGithubIdentity} intake_mode=both build_queue=${explicitGithubQueue}`;
  }

  return resolvedBuildQueue.includes("intake_mode=")
    ? resolvedBuildQueue
    : `${resolvedBuildQueue} intake_mode=build`;
}

/**
 * @param {Record<string, any>} config
 */
function requireGithubRepo(config) {
  if (!config.github?.org || !config.github?.repo) {
    throw new Error(
      "Unable to resolve the GitHub queue: github.org and github.repo are required."
    );
  }
}

/**
 * @param {Record<string, any>} config
 */
function requireLinearWorkspace(config) {
  if (!config.linear?.workspace) {
    throw new Error(
      "Unable to resolve the Linear queue: linear.workspace is required."
    );
  }
}

/**
 * @param {boolean | string | undefined} value
 * @returns {boolean}
 */
function normalizeBooleanFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return false;
}

/**
 * @param {string} value
 * @returns {string}
 */
function slugifyProjectToken(value) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
