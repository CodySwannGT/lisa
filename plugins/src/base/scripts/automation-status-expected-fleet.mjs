#!/usr/bin/env node
/**
 * Shared automation-status expected-fleet helpers.
 *
 * This module resolves the same naming, queue arguments, cadence, and
 * exploratory support decisions documented by `/lisa:setup-automations`, so
 * automation-status and later runtime adapters do not invent a second source of
 * truth.
 */

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
};

export const EXPLORATORY_QA_STACK_PRIORITY = ["expo", "rails", "harper-fabric"];

const GITHUB_REMOTE_PATTERNS = [
  /github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+?)(?:\.git)?$/,
  /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/.]+?)(?:\.git)?$/,
];

/**
 * @typedef {{
 *   readonly id: string
 *   readonly automationId: string
 *   readonly expectedCadence: string
 *   readonly expectedRRule: string
 *   readonly expectedCommand: string
 *   readonly group: "core" | "exploratory"
 * }} ExpectedAutomationEntry
 *
 * @typedef {{
 *   readonly id: string
 *   readonly automationId: string
 *   readonly group: "core" | "exploratory"
 *   readonly reason: string
 *   readonly expectedCadence: string
 *   readonly expectedRRule: string
 * }} UnsupportedAutomationEntry
 */

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
 * }} input
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
  const detectedTypes = input.detectedTypes ?? [];

  const tracker = config.tracker;
  const source = resolvePrdSource(config);
  const prdQueue = resolvePrdQueueArgument(config, source);
  const buildQueue = resolveBuildQueueArgument(config, tracker);
  const repairQueue = resolveRepairQueueArgument(config, source, tracker);

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
        "This repository does not ship an exploratory-qa command surface."
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
 * @param {"core" | "exploratory"} group
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
  };
}

/**
 * @param {{ readonly automationPrefix: string }} identity
 * @param {string} id
 * @param {string} reason
 * @returns {UnsupportedAutomationEntry}
 */
function createUnsupportedEntry(identity, id, reason) {
  const cadence = AUTOMATION_EXPECTED_CADENCES[id];
  return {
    id,
    automationId: `${identity.automationPrefix}${id}`,
    expectedCadence: cadence.human,
    expectedRRule: cadence.rrule,
    group: "exploratory",
    reason,
  };
}

/**
 * @param {Record<string, any>} config
 * @param {string | undefined} source
 * @returns {string}
 */
function resolvePrdQueueArgument(config, source) {
  switch (source) {
    case "github":
      requireGithubRepo(config);
      return "github intake_mode=prd";
    case "linear":
      requireLinearWorkspace(config);
      return "linear";
    case "notion": {
      const databaseId = config.notion?.prdDatabaseId;
      if (!databaseId) {
        throw new Error(
          "Unable to resolve the PRD queue: notion.prdDatabaseId is required when source=notion."
        );
      }
      return databaseId;
    }
    case "confluence": {
      const parentPageId = config.confluence?.parentPageId;
      const spaceKey = config.confluence?.spaceKey;
      if (!parentPageId && !spaceKey) {
        throw new Error(
          "Unable to resolve the PRD queue: confluence.parentPageId or confluence.spaceKey is required when source=confluence."
        );
      }
      return parentPageId ?? spaceKey;
    }
    case "jira": {
      const project = config.jira?.project;
      if (!project) {
        throw new Error(
          "Unable to resolve the PRD queue: jira.project is required when source=jira."
        );
      }
      return project;
    }
    default:
      throw new Error(
        "Unable to resolve the PRD queue from config. Set source or use tracker=github self-host with github.org/github.repo."
      );
  }
}

/**
 * @param {Record<string, any>} config
 * @param {string | undefined} tracker
 * @returns {string}
 */
function resolveBuildQueueArgument(config, tracker) {
  switch (tracker) {
    case "github":
      requireGithubRepo(config);
      return "github intake_mode=build";
    case "linear":
      requireLinearWorkspace(config);
      return "linear";
    case "jira": {
      const project = config.jira?.project;
      if (!project) {
        throw new Error(
          "Unable to resolve the build queue: jira.project is required when tracker=jira."
        );
      }
      return project;
    }
    default:
      throw new Error(
        "Unable to resolve the build queue from config. tracker must be github, linear, or jira."
      );
  }
}

/**
 * @param {Record<string, any>} config
 * @param {string | undefined} source
 * @param {string | undefined} tracker
 * @returns {string}
 */
function resolveRepairQueueArgument(config, source, tracker) {
  if (tracker === "github" && source === "github") {
    requireGithubRepo(config);
    return "github intake_mode=both";
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
    return "github intake_mode=both";
  }

  throw new Error(
    `Unable to resolve a single repair-intake queue for tracker=${String(tracker)} and source=${String(source)} without guessing.`
  );
}

/**
 * @param {Record<string, any>} config
 * @returns {string | undefined}
 */
function resolvePrdSource(config) {
  if (typeof config.source === "string" && config.source.length > 0) {
    return config.source;
  }

  if (
    config.tracker === "github" &&
    config.github?.org &&
    config.github?.repo
  ) {
    return "github";
  }

  return undefined;
}

/**
 * @param {Record<string, any>} config
 * @param {string | undefined} gitRemoteUrl
 * @returns {{ readonly owner: string, readonly repo: string } | null}
 */
function resolveGithubRepoRef(config, gitRemoteUrl) {
  const owner = config.github?.org;
  const repo = config.github?.repo;

  if (owner && repo) {
    return { owner, repo };
  }

  if (!gitRemoteUrl) {
    return null;
  }

  for (const pattern of GITHUB_REMOTE_PATTERNS) {
    const match = gitRemoteUrl.match(pattern);
    if (match?.groups?.owner && match.groups.repo) {
      return {
        owner: match.groups.owner,
        repo: match.groups.repo,
      };
    }
  }

  return null;
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
