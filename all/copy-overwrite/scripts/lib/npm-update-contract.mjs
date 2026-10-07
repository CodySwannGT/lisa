// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-contract.mjs
 * @description Closed data contracts prevent dependency artifacts selecting authority.
 * @module npm-updater
 */
import { required, keys } from "./npm-update-invariants.mjs";
export { UpdaterError, required, keys } from "./npm-update-invariants.mjs";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";

export const FILES = ["package-lock.json", "package.json"];
export const SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];
export const CLAIM =
  "[lisa-tracker-claim] Claimed by Lisa. Starting implementation.";
export const NAME = /^(?:@[a-z0-9][a-z0-9_.-]*\/)?[a-z0-9][a-z0-9_.-]*$/;
export const VERSION =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[A-Za-z0-9.-]+)?$/;
export const OBJECT = /^[a-f0-9]{40}$/;

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
  ]);
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

/** Host declarations are checked before npm or lifecycle execution. */
export function validateHost(before) {
  required(
    !before.workspaces &&
      (!before.packageManager ||
        /^npm@\d+\.\d+\.\d+$/.test(before.packageManager)),
    "unsupported workspace or package manager"
  );
  required(
    !["npm", "node"].some(name =>
      /please-use|do-not-use/.test(before.engines?.[name] ?? "")
    ),
    "engines forbid npm or Node"
  );
}

/** Script changes cannot hide in a dependency diff. */
export function validateManifest(before, after, updates, policy) {
  validateHost(before);
  const copy = structuredClone(before);
  const seen = new Set();
  required(
    Array.isArray(updates) && updates.length > 0 && updates.length <= 64,
    "empty or oversize update set"
  );
  for (const update of updates) {
    keys(update, ["name", "section", "from", "to"]);
    const selection = policy.packages.find(item => item.name === update.name);
    required(
      selection &&
        update.to === selection.version &&
        SECTIONS.includes(update.section),
      "update outside trusted selection"
    );
    required(
      typeof update.from === "string" &&
        VERSION.test(update.from.replace(/^[~^]/, "")) &&
        update.to !== update.from,
      "invalid or unchanged version"
    );
    required(
      !seen.has(update.name) &&
        copy[update.section]?.[update.name] === update.from,
      "duplicate or stale update"
    );
    seen.add(update.name);
    copy[update.section][update.name] = update.to;
  }
  required(
    canonicalJson(copy) === canonicalJson(after),
    "undeclared manifest changes"
  );
}

/** Public registry URLs cannot smuggle credentials or executable protocols. */
export function validateLock(lock, manifest, updates) {
  required(
    [2, 3].includes(lock.lockfileVersion) && lock.packages?.[""],
    "supported npm lock required"
  );
  required(
    lock.name === manifest.name && lock.version === manifest.version,
    "lock root differs"
  );
  for (const section of SECTIONS)
    required(
      canonicalJson(lock.packages[""][section] ?? {}) ===
        canonicalJson(manifest[section] ?? {}),
      "lock root dependency set differs"
    );
  for (const [name, item] of Object.entries(lock.packages)) {
    if (name === "") continue;
    required(
      name.startsWith("node_modules/") &&
        !name.split("/").includes("..") &&
        !item.link,
      "unsupported lock node"
    );
    const url = new URL(item.resolved);
    required(
      url.protocol === "https:" &&
        url.hostname === "registry.npmjs.org" &&
        !url.username &&
        !url.password &&
        !url.port &&
        !url.search &&
        !url.hash,
      "nonregistry or credential-bearing lock"
    );
    required(
      typeof item.integrity === "string" &&
        /^sha512-[A-Za-z0-9+/]+={0,2}$/.test(item.integrity) &&
        Buffer.from(item.integrity.slice(7), "base64").length === 64 &&
        Buffer.from(item.integrity.slice(7), "base64").toString("base64") ===
          item.integrity.slice(7),
      "registry integrity missing"
    );
  }
  for (const update of updates)
    required(
      lock.packages[`node_modules/${update.name}`]?.version === update.to,
      "lock target differs"
    );
}

/** Base-independent discovery prevents a main advance creating a duplicate leaf. */
export function selectionKey(policy, updates) {
  return sha256(
    canonicalJson({
      repository: policy.repository,
      target: "main",
      ecosystem: "npm",
      directory: ".",
      policySha256: sha256(canonicalJson(policy)),
      versions: updates
        .map(({ name, to }) => ({ name, version: to }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    })
  );
}

/** Recovery binds policy as well as versions; the hook's signed proposal key is separate. */
export function proposalFrom(policy, parent, before, files, updates) {
  required(OBJECT.test(parent), "unsupported Git parent or object format");
  keys(files, FILES);
  for (const value of Object.values(files))
    required(
      typeof value === "string" && Buffer.byteLength(value) <= 1_048_576,
      "oversize proposal file"
    );
  const after = JSON.parse(files["package.json"]);
  const lock = JSON.parse(files["package-lock.json"]);
  validateManifest(before, after, updates, policy);
  validateLock(lock, after, updates);
  const ordered = [...updates].sort((a, b) => a.name.localeCompare(b.name));
  const identity = {
    repository: policy.repository,
    target: policy.target,
    ecosystem: "npm",
    directory: ".",
    parent,
    policySha256: sha256(canonicalJson(policy)),
    updates: ordered,
  };
  return {
    version: 1,
    ...identity,
    selectionKey: selectionKey(policy, ordered),
    key: sha256(canonicalJson(identity)),
    bindingKey: sha256(
      canonicalJson({ repository: policy.repository, parent, updates: ordered })
    ),
    before,
    files,
    hashes: Object.fromEntries(FILES.map(file => [file, sha256(files[file])])),
  };
}

/** Recompute every candidate field rather than accepting its claimed digest. */
export function validateProposal(value, policy) {
  keys(value, [
    "version",
    "repository",
    "target",
    "ecosystem",
    "directory",
    "parent",
    "policySha256",
    "updates",
    "key",
    "selectionKey",
    "bindingKey",
    "before",
    "files",
    "hashes",
  ]);
  const expected = proposalFrom(
    policy,
    value.parent,
    value.before,
    value.files,
    value.updates
  );
  required(
    canonicalJson(value) === canonicalJson(expected),
    "proposal identity or bytes differ"
  );
  return expected;
}

export { validateRawCommit } from "./npm-update-object.mjs";
