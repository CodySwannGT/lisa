// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Fixed npm policy validation shares the optional signed runtime contract without cycles. */
import { keys, operatorRefusal, required } from "./npm-update-invariants.mjs";
import { railsRuntime } from "./npm-update-rails-runtime-contract.mjs";
import { validDirectory } from "./automation-provenance-contract.mjs";
import {
  DEFAULT_TARGET,
  validBranchName,
} from "./github-attestation-verifier.mjs";

export const NAME = /^(?:@[a-z0-9][a-z0-9_.-]*\/)?[a-z0-9][a-z0-9_.-]*$/;
export const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[A-Za-z0-9.-]+)?$/;

/** Each tracker names its maintainer by its own identifier: GitHub login, Jira accountId, Linear user id. */
const MAINTAINER = {
  github: /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/,
  jira: /^[A-Za-z0-9][A-Za-z0-9:-]{0,127}$/,
  linear: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};
const KEY = /^[A-Z][A-Z0-9]{1,9}$/;

/**
 * GitHub keeps its exact original check. Jira and Linear hosts still publish to
 * the configured GitHub code host, so a configured GitHub repository must match;
 * their own work items live in the configured project or team.
 */
function trackerScope(value, config) {
  if (config.tracker !== "jira" && config.tracker !== "linear") {
    required(
      config.tracker === "github" &&
        value.repository === `${config.github?.org}/${config.github?.repo}`,
      "configured repository/tracker differs"
    );
    return;
  }
  const key =
    config.tracker === "jira" ? config.jira?.project : config.linear?.teamKey;
  required(
    typeof key === "string" &&
      KEY.test(key.trim().toUpperCase()) &&
      (config.tracker === "jira" ||
        (typeof config.linear?.workspace === "string" &&
          config.linear.workspace.trim().length > 0)),
    "configured tracker lacks its project, team or workspace"
  );
  required(
    !config.github?.org ||
      value.repository === `${config.github.org}/${config.github.repo}`,
    "configured repository/tracker differs"
  );
}

export { DEFAULT_TARGET, validBranchName };

/**
 * The branch every updater step reads, compares and opens its pull request
 * against. An omitted target keeps main, so an existing policy's digest never moves.
 */
export function policyTarget(policy) {
  return Object.hasOwn(policy ?? {}, "target") ? policy.target : DEFAULT_TARGET;
}

/**
 * A non-main target must be a configured deploy branch: without that mapping the
 * leaf's Target Backend Environment and Branch Plan cannot be derived. main keeps
 * its historical check, which the leaf contract applies when it derives the env.
 */
function validateTarget(value, config) {
  const target = policyTarget(value);
  if (target === DEFAULT_TARGET) return;
  required(validBranchName(target), "invalid npm updater target branch");
  const allowed = [
    ...new Set(
      Object.values(config.deploy?.branches ?? {}).filter(validBranchName)
    ),
  ];
  if (!allowed.includes(target))
    throw operatorRefusal(
      "npm updater target is not a configured deploy branch",
      `npmUpdater target "${target}" is not a .lisa.config.json deploy.branches value; allowed branches: ${allowed.join(", ") || "(none configured)"}.`
    );
}

/** Configured tracking and an explicit owner are prerequisites, never inferred. */
export function validatePolicy(value, config) {
  keys(value, [
    "version",
    "repository",
    "directory",
    ...(Object.hasOwn(value ?? {}, "target") ? ["target"] : []),
    "maintainer",
    "packages",
    "lisaOwner",
    ...(Object.hasOwn(value ?? {}, "runtime") ? ["runtime"] : []),
  ]);
  railsRuntime(value);
  required(
    value.version === 1 &&
      validDirectory(value.directory) &&
      typeof policyTarget(value) === "string",
    "only a committed npm directory on main is supported"
  );
  validateTarget(value, config);
  required(
    value.directory === "." ||
      (value.lisaOwner === "absent" && !Object.hasOwn(value, "runtime")),
    "a subdirectory npm project has no Lisa owner or runtime profile"
  );
  trackerScope(value, config);
  required(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository),
    "invalid repository"
  );
  required(
    typeof value.maintainer === "string" &&
      MAINTAINER[config.tracker].test(value.maintainer),
    "explicit assignable maintainer required"
  );
  required(
    ["absent", "verified-local-full-apply"].includes(value.lisaOwner),
    "Lisa requires a verified local full-apply owner"
  );
  required(
    Array.isArray(value.packages) &&
      value.packages.length > 0 &&
      value.packages.length <= 64,
    "invalid package selection"
  );
  const names = new Set();
  for (const selection of value.packages) {
    keys(selection, ["name", "version"]);
    required(
      typeof selection.name === "string" &&
        selection.name.length <= 214 &&
        NAME.test(selection.name),
      "invalid npm name"
    );
    required(
      typeof selection.version === "string" && VERSION.test(selection.version),
      "exact registry version required"
    );
    required(
      !names.has(selection.name) && selection.name !== "@codyswann/lisa",
      "duplicate selection or Lisa version-only update"
    );
    names.add(selection.name);
  }
  return structuredClone(value);
}

/**
 * One run updates one committed directory. The legacy single object is a
 * one-entry list, so a root-only policy keeps its exact digest; every entry is
 * validated even when another directory is selected, and directories are unique.
 */
export function selectPolicy(config, directory) {
  const raw = config.npmUpdater;
  const list = Array.isArray(raw) ? raw : [raw];
  required(
    list.length >= 1 && list.length <= 8 && !list.some(Array.isArray),
    "invalid npm updater directory list"
  );
  const policies = list.map(entry => validatePolicy(entry, config));
  required(
    new Set(policies.map(policy => policy.directory)).size === policies.length,
    "duplicate npm updater directory"
  );
  const matches = policies.filter(policy => policy.directory === directory);
  required(
    matches.length === 1,
    "directory is not a committed npm updater selection"
  );
  return matches[0];
}
