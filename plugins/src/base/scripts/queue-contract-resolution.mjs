#!/usr/bin/env node
/**
 * Shared queue-contract resolution helpers for queue-facing Lisa operator
 * surfaces. These helpers intentionally mirror the same config-resolution
 * defaults that `intake`, `repair-intake`, and future queue-status runtime
 * adapters need, so repo/source/tracker detection does not drift.
 */

const GITHUB_REMOTE_PATTERNS = [
  /github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+?)(?:\.git)?$/,
  /^git@github\.com:(?<owner>[^/]+)\/(?<repo>[^/.]+?)(?:\.git)?$/,
];

const DEFAULT_GITHUB_BUILD_DONE = {
  dev: "status:on-dev",
  staging: "status:on-stg",
  production: "status:done",
};

const DEFAULT_JIRA_BUILD_DONE = {
  dev: "On Dev",
  staging: "On Stg",
  production: "Done",
};

const DEFAULT_GITHUB_LINEAR_PRD_ROLES = {
  draft: "prd-draft",
  ready: "prd-ready",
  in_review: "prd-in-review",
  blocked: "prd-blocked",
  ticketed: "prd-ticketed",
  shipped: "prd-shipped",
  verified: "prd-verified",
  sentinel: "prd-intake-feedback",
};

const DEFAULT_NOTION_PRD_ROLES = {
  draft: "Draft",
  ready: "Ready",
  in_review: "In Review",
  blocked: "Blocked",
  ticketed: "Ticketed",
  shipped: "Shipped",
  verified: "Verified",
};

const DEFAULT_CONFLUENCE_PARENT_ROLES = {
  draft: null,
  ready: null,
  in_review: null,
  blocked: null,
  ticketed: null,
  shipped: null,
  verified: null,
};

/**
 * Resolve the current repo short name per config-resolution's repo-scoping
 * ladder: explicit `.repo`, then `github.repo`, then the origin remote basename.
 *
 * @param {{
 *   readonly config?: Record<string, any>
 *   readonly gitRemoteUrl?: string
 * }} input
 * @returns {string | null}
 */
export function resolveCurrentRepo(input = {}) {
  const config = input.config ?? {};

  if (typeof config.repo === "string" && config.repo.trim().length > 0) {
    return config.repo.trim();
  }

  const githubRef = resolveGithubRepoRef(config, input.gitRemoteUrl);
  if (githubRef?.repo) {
    return githubRef.repo;
  }

  return resolveRepoNameFromRemote(input.gitRemoteUrl);
}

/**
 * Resolve the repo's configured build tracker.
 *
 * @param {Record<string, any>} config
 * @returns {string}
 */
export function resolveBuildTracker(config = {}) {
  if (typeof config.tracker === "string" && config.tracker.trim().length > 0) {
    return config.tracker.trim();
  }

  throw new Error(
    "Unable to resolve the build tracker from config. tracker must be github, linear, or jira."
  );
}

/**
 * Resolve the repo's configured PRD source. Self-hosted GitHub falls back to
 * `github` when `tracker=github` and a GitHub repo identity is configured.
 *
 * @param {Record<string, any>} config
 * @returns {string}
 */
export function resolvePrdSource(config = {}) {
  if (typeof config.source === "string" && config.source.trim().length > 0) {
    return config.source.trim();
  }

  if (
    config.tracker === "github" &&
    config.github?.org &&
    config.github?.repo
  ) {
    return "github";
  }

  throw new Error(
    "Unable to resolve the PRD source from config. Set source explicitly or use tracker=github self-host with github.org/github.repo."
  );
}

/**
 * Resolve the PRD queue argument shape Lisa batch skills expect.
 *
 * @param {Record<string, any>} config
 * @param {string} [source]
 * @returns {string}
 */
export function resolvePrdQueueArgument(
  config = {},
  source = resolvePrdSource(config)
) {
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
    default:
      throw new Error(
        `Unable to resolve the PRD queue from config. source=${String(source)} is not a supported Lisa PRD source.`
      );
  }
}

/**
 * Resolve the build queue argument shape Lisa batch skills expect.
 *
 * @param {Record<string, any>} config
 * @param {string} [tracker]
 * @returns {string}
 */
export function resolveBuildQueueArgument(
  config = {},
  tracker = resolveBuildTracker(config)
) {
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
 * Resolve the PRD lifecycle roles for the configured source vendor.
 *
 * @param {Record<string, any>} config
 * @param {string} [source]
 * @returns {Record<string, any>}
 */
export function resolvePrdLifecycleRoles(
  config = {},
  source = resolvePrdSource(config)
) {
  switch (source) {
    case "github":
      return {
        vendor: "github",
        kind: "labels",
        roles: resolveObjectRoles(
          config.github?.labels?.prd,
          DEFAULT_GITHUB_LINEAR_PRD_ROLES,
          { allowNull: false }
        ),
      };
    case "linear":
      return {
        vendor: "linear",
        kind: "labels",
        roles: resolveObjectRoles(
          config.linear?.labels?.prd,
          DEFAULT_GITHUB_LINEAR_PRD_ROLES,
          { allowNull: false }
        ),
      };
    case "notion":
      return {
        vendor: "notion",
        kind: "status",
        statusProperty: config.notion?.statusProperty || "Status",
        roles: resolveObjectRoles(
          config.notion?.values,
          DEFAULT_NOTION_PRD_ROLES,
          { allowNull: false }
        ),
      };
    case "confluence":
      return {
        vendor: "confluence",
        kind: "parent-pages",
        roles: resolveObjectRoles(
          config.confluence?.parents,
          DEFAULT_CONFLUENCE_PARENT_ROLES,
          { allowNull: true }
        ),
      };
    default:
      throw new Error(
        `Unable to resolve PRD lifecycle roles. source=${String(source)} is not a supported Lisa PRD source.`
      );
  }
}

/**
 * Resolve the build lifecycle roles for the configured tracker vendor.
 *
 * @param {Record<string, any>} config
 * @param {string} [tracker]
 * @returns {Record<string, any>}
 */
export function resolveBuildLifecycleRoles(
  config = {},
  tracker = resolveBuildTracker(config)
) {
  switch (tracker) {
    case "github":
      return {
        vendor: "github",
        kind: "labels",
        roles: {
          ready: config.github?.labels?.build?.ready || "status:ready",
          claimed:
            config.github?.labels?.build?.claimed || "status:in-progress",
          blocked: config.github?.labels?.build?.blocked || "status:blocked",
          done:
            config.github?.labels?.build?.done ||
            structuredClone(DEFAULT_GITHUB_BUILD_DONE),
        },
      };
    case "linear":
      return {
        vendor: "linear",
        kind: "labels",
        roles: {
          ready: config.linear?.labels?.build?.ready || "status:ready",
          claimed:
            config.linear?.labels?.build?.claimed || "status:in-progress",
          review: config.linear?.labels?.build?.review || "status:code-review",
          blocked: config.linear?.labels?.build?.blocked || "status:blocked",
          done:
            config.linear?.labels?.build?.done ||
            structuredClone(DEFAULT_GITHUB_BUILD_DONE),
        },
      };
    case "jira":
      return {
        vendor: "jira",
        kind: "workflow",
        roles: {
          ready: config.jira?.workflow?.ready || "Ready",
          claimed: config.jira?.workflow?.claimed || "In Progress",
          review: config.jira?.workflow?.review || "Code Review",
          blocked: config.jira?.workflow?.blocked || "Blocked",
          done:
            config.jira?.workflow?.done ||
            structuredClone(DEFAULT_JIRA_BUILD_DONE),
        },
      };
    default:
      throw new Error(
        `Unable to resolve build lifecycle roles. tracker=${String(tracker)} is not a supported Lisa build tracker.`
      );
  }
}

/**
 * Resolve the repo-scoped queue contract queue-status should report against.
 *
 * @param {{
 *   readonly config?: Record<string, any>
 *   readonly gitRemoteUrl?: string
 * }} input
 * @returns {{
 *   readonly currentRepo: string | null
 *   readonly source: string
 *   readonly tracker: string
 *   readonly prdQueue: { readonly argument: string } & Record<string, any>
 *   readonly buildQueue: { readonly argument: string } & Record<string, any>
 * }}
 */
export function resolveQueueContract(input = {}) {
  const config = input.config ?? {};
  const source = resolvePrdSource(config);
  const tracker = resolveBuildTracker(config);

  return {
    currentRepo: resolveCurrentRepo(input),
    source,
    tracker,
    prdQueue: {
      argument: resolvePrdQueueArgument(config, source),
      ...resolvePrdLifecycleRoles(config, source),
    },
    buildQueue: {
      argument: resolveBuildQueueArgument(config, tracker),
      ...resolveBuildLifecycleRoles(config, tracker),
    },
  };
}

/**
 * @param {Record<string, any> | undefined} values
 * @param {Record<string, any>} defaults
 * @param {{ readonly allowNull?: boolean }} [options]
 * @returns {Record<string, any>}
 */
function resolveObjectRoles(values, defaults, options = {}) {
  const resolved = { ...defaults };

  for (const [key, value] of Object.entries(values ?? {})) {
    if (typeof value === "string" && value.trim().length > 0) {
      resolved[key] = value;
      continue;
    }

    if (options.allowNull === true && value === null) {
      resolved[key] = value;
    }
  }

  return resolved;
}

/**
 * @param {Record<string, any>} config
 * @param {string | undefined} gitRemoteUrl
 * @returns {{ readonly owner: string, readonly repo: string } | null}
 */
export function resolveGithubRepoRef(config = {}, gitRemoteUrl) {
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
 * @param {string | undefined} gitRemoteUrl
 * @returns {string | null}
 */
function resolveRepoNameFromRemote(gitRemoteUrl) {
  if (!gitRemoteUrl || typeof gitRemoteUrl !== "string") {
    return null;
  }

  const trimmed = gitRemoteUrl.trim();
  if (!trimmed) {
    return null;
  }

  const basename = trimmed.split(/[/:]/).pop();
  if (!basename) {
    return null;
  }

  return basename.replace(/\.git$/i, "") || null;
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
