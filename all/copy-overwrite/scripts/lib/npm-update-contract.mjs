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
import {
  optionalLockFields,
  optionalRuntimeFields,
  proposalFileNames,
  signedProposalFields,
} from "./automation-provenance-contract.mjs";
export { proposalFileNames } from "./automation-provenance-contract.mjs";
import { runtimeBinding } from "./npm-update-rails-runtime-contract.mjs";

export const FILES = ["package-lock.json", "package.json"];
export const SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
];
export const CLAIM =
  "[lisa-tracker-claim] Claimed by Lisa. Starting implementation.";
export { NAME, VERSION, validatePolicy } from "./npm-update-policy.mjs";
import { VERSION } from "./npm-update-policy.mjs";
export const OBJECT = /^[a-f0-9]{40}$/;

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
    // A bundled dependency ships inside its parent's tarball, so npm records
    // no source or integrity of its own: the parent's registry integrity is
    // what covers its bytes. Accept it only nested under a parent this loop
    // also validates, and never when it claims a source of its own.
    if (item.inBundle === true) {
      required(
        item.resolved === undefined && item.integrity === undefined,
        "bundled lock node declares its own source"
      );
      const boundary = name.lastIndexOf("/node_modules/");
      const parent = boundary < 0 ? "" : name.slice(0, boundary);
      required(
        parent.startsWith("node_modules/") &&
          Object.hasOwn(lock.packages, parent),
        "bundled lock node has no registry parent"
      );
      continue;
    }
    required(typeof item.resolved === "string", "registry source missing");
    let url;
    try {
      url = new URL(item.resolved);
    } catch {
      required(false, "registry source unparseable");
    }
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
export function proposalFrom(
  policy,
  parent,
  before,
  files,
  updates,
  bunLockSha256
) {
  required(OBJECT.test(parent), "unsupported Git parent or object format");
  const optional = {
    ...(bunLockSha256 === undefined ? {} : { bunLockSha256 }),
    ...runtimeBinding(policy),
  };
  const names = proposalFileNames({ files, ...optional });
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
    ...optional,
  };
  return {
    version: 1,
    ...identity,
    selectionKey: selectionKey(policy, ordered),
    key: sha256(canonicalJson(identity)),
    bindingKey: sha256(
      canonicalJson({
        repository: policy.repository,
        parent,
        updates: ordered,
        ...signedProposalFields(optional),
      })
    ),
    before,
    files,
    hashes: Object.fromEntries(names.map(file => [file, sha256(files[file])])),
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
    ...optionalLockFields(value),
    ...optionalRuntimeFields(value),
  ]);
  const expected = proposalFrom(
    policy,
    value.parent,
    value.before,
    value.files,
    value.updates,
    value.bunLockSha256
  );
  required(
    canonicalJson(value) === canonicalJson(expected),
    "proposal identity or bytes differ"
  );
  return expected;
}

export { validateRawCommit } from "./npm-update-object.mjs";
