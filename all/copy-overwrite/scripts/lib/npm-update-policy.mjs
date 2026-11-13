// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Fixed npm policy validation shares the optional signed runtime contract without cycles. */
import { keys, required } from "./npm-update-invariants.mjs";
import { railsRuntime } from "./npm-update-rails-runtime-contract.mjs";
import { validDirectory } from "./automation-provenance-contract.mjs";

export const NAME = /^(?:@[a-z0-9][a-z0-9_.-]*\/)?[a-z0-9][a-z0-9_.-]*$/;
export const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[A-Za-z0-9.-]+)?$/;

/** Configured tracking and an explicit owner are prerequisites, never inferred. */
export function validatePolicy(value, config) {
  keys(value, [
    "version",
    "repository",
    "directory",
    "target",
    "maintainer",
    "packages",
    "lisaOwner",
    ...(Object.hasOwn(value ?? {}, "runtime") ? ["runtime"] : []),
  ]);
  railsRuntime(value);
  required(
    value.version === 1 &&
      validDirectory(value.directory) &&
      value.target === "main",
    "only a committed npm directory on main is supported"
  );
  required(
    value.directory === "." ||
      (value.lisaOwner === "absent" && !Object.hasOwn(value, "runtime")),
    "a subdirectory npm project has no Lisa owner or runtime profile"
  );
  required(
    config.tracker === "github" &&
      value.repository === `${config.github?.org}/${config.github?.repo}`,
    "configured repository/tracker differs"
  );
  required(
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository),
    "invalid repository"
  );
  required(
    typeof value.maintainer === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(value.maintainer),
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
