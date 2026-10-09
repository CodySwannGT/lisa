// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Fixed npm policy validation shares the optional signed runtime contract without cycles. */
import { keys, required } from "./npm-update-invariants.mjs";
import { railsRuntime } from "./npm-update-rails-runtime-contract.mjs";

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
    value.version === 1 && value.directory === "." && value.target === "main",
    "only root npm on main is supported"
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
