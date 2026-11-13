// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Closed canonical schemas and committed npm policy remain independent of local proof IO. */
import { posix } from "node:path";
import { requireProof } from "./github-attestation-verifier.mjs";

const MANIFEST = "package.json";
const NPM_LOCK = "package-lock.json";
const BUN_LOCK = "bun.lock";
const FILES = [NPM_LOCK, MANIFEST];
const DESCRIPTOR_KEYS = [
  "author",
  "claimCommentId",
  "claimSha256",
  "committer",
  "files",
  "messageSha256",
  "parent",
  "policySha256",
  "proposalKey",
  "queue",
  "runAttempt",
  "runId",
  "tree",
  "updates",
  "version",
  "workItem",
];
const HEX = /^[0-9a-f]{64}$/;
const SEGMENT = "[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}";
const DIRECTORY = new RegExp(`^${SEGMENT}(?:/${SEGMENT}){0,7}$`);
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Only an explicit original Bun digest extends the unchanged npm-only schema. */
export function optionalLockFields(value) {
  if (!Object.hasOwn(value, "bunLockSha256")) return [];
  requireProof(
    typeof value.bunLockSha256 === "string" && HEX.test(value.bunLockSha256),
    "invalid original Bun lock digest"
  );
  return ["bunLockSha256"];
}

/** Optional runtime authority is a digest, never an unsigned executable profile. */
export function optionalRuntimeFields(value) {
  if (!Object.hasOwn(value, "runtimeSha256")) return [];
  requireProof(
    typeof value.runtimeSha256 === "string" && HEX.test(value.runtimeSha256),
    "invalid original Rails runtime digest"
  );
  return ["runtimeSha256"];
}

/**
 * A committed npm project directory is "." or a short, normalized relative
 * path. Dot segments, absolute paths and installed trees can never name one,
 * so a policy entry cannot point the updater outside the repository.
 */
export function validDirectory(value) {
  return (
    typeof value === "string" &&
    value.length <= 200 &&
    (value === "." ||
      (DIRECTORY.test(value) &&
        posix.normalize(value) === value &&
        !value.split("/").includes("node_modules")))
  );
}

/** A proposal or descriptor without a directory is the historical root project. */
export function directoryOf(value) {
  const directory = Object.hasOwn(value, "directory") ? value.directory : ".";
  requireProof(validDirectory(directory), "invalid npm project directory");
  return directory;
}

/** Repository path of one npm file in the value's project directory. */
export function npmPath(value, file) {
  const directory = directoryOf(value);
  return directory === "." ? file : `${directory}/${file}`;
}

/**
 * Raw committed entry for one directory; the legacy single object is a one-entry list.
 * More than one match is refused, so the hook never disagrees with selectPolicy.
 */
export function policyEntry(config, directory) {
  const raw = config?.npmUpdater;
  const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw];
  const matches = list.filter(entry => entry?.directory === directory);
  requireProof(matches.length <= 1, "duplicate npm updater directory");
  return matches[0];
}

/** Caller must pass a config already validated by selectPolicy. */
export function proposalPolicy(config, value) {
  const entry = policyEntry(config, directoryOf(value));
  requireProof(
    entry !== undefined,
    "directory is not a committed npm updater selection"
  );
  return entry;
}

/**
 * Only a subdirectory is signed: root descriptors keep their historical key
 * set byte for byte, so an explicit "." stays an undeclared extra field.
 * Subdirectories are npm-only, so they never carry an original Bun digest.
 */
export function optionalDirectoryFields(value) {
  if (!Object.hasOwn(value, "directory") || value.directory === ".") return [];
  requireProof(
    directoryOf(value) !== "." && !Object.hasOwn(value, "bunLockSha256"),
    "a subdirectory npm proposal cannot bind a Bun lock"
  );
  return ["directory"];
}

/**
 * One exact optional projection preserves historical keys at producer and verifier boundaries.
 * @param {Record<string, any>} value - A proposal, descriptor or optional-field set.
 * @returns {{ bunLockSha256?: string, runtimeSha256?: string, directory?: string }} Present signed optional fields only.
 */
export function signedProposalFields(value) {
  return Object.fromEntries(
    [
      ...optionalLockFields(value),
      ...optionalRuntimeFields(value),
      ...optionalDirectoryFields(value),
    ].map(name => [name, value[name]])
  );
}

/** Sorted repository paths of the cohort the signed optional fields select; Bun stays root-only. */
function cohortNames(value) {
  optionalDirectoryFields(value);
  return [
    ...(optionalLockFields(value).length ? [BUN_LOCK] : []),
    ...FILES.map(file => npmPath(value, file)),
  ];
}

/** Signed original presence selects one closed two- or three-file cohort. */
export function proposalFileNames(value) {
  const files = cohortNames(value);
  exactKeys(value.files, files, "proposal files");
  return files;
}

/** The root install's inputs plus the proposal's own files must all survive the ordinary install unchanged. */
export function installInputs(value) {
  return [...new Set([...FILES, ...cohortNames(value)])];
}

/** Committed history paths in their historical order; the root command string never changes. */
export function historyPaths(value) {
  return [
    npmPath(value, MANIFEST),
    npmPath(value, NPM_LOCK),
    ...(optionalLockFields(value).length ? [BUN_LOCK] : []),
  ];
}

/** A subdirectory is npm-only: its own Bun lock must be absent, and the root one is outside its scope. */
export function directoryBunAbsent(value, git, absent) {
  if (directoryOf(value) === ".") return false;
  const lock = npmPath(value, BUN_LOCK);
  requireProof(
    git(["ls-tree", "HEAD", "--", lock]) === "" && absent(lock),
    "subdirectory Bun lock is unsupported"
  );
  return true;
}

/** The closed cohort a recorded hash map must have: root two/three files or one directory's two. */
export function hashCohort(hashes) {
  const lock = Object.keys(hashes ?? {}).find(name => name.endsWith(NPM_LOCK));
  const directory =
    lock === undefined || lock === NPM_LOCK
      ? "."
      : lock.slice(0, -(NPM_LOCK.length + 1));
  const bun = Object.hasOwn(hashes ?? {}, BUN_LOCK);
  return proposalFileNames({
    directory,
    files: hashes,
    ...(bun ? { bunLockSha256: "0".repeat(64) } : {}),
  });
}

/** Canonical bytes are shared by allocator and consumer, not inferred hashes. */
export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  requireProof(
    ["string", "boolean", "number"].includes(typeof value) || value === null,
    "unsupported canonical value"
  );
  requireProof(
    typeof value !== "number" || Number.isFinite(value),
    "invalid canonical number"
  );
  return JSON.stringify(value);
}

/** Exact keys prevent an unsigned path/command override hiding in a descriptor. */
export function exactKeys(value, keys, subject) {
  requireProof(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${subject} is not an object`
  );
  requireProof(
    Object.keys(value).sort().join("\n") === [...keys].sort().join("\n"),
    `${subject} fields differ`
  );
}

/** Policy is committed at the actual proposal base, never a local/env override. */
export function trustedConfiguration(git) {
  const config = JSON.parse(git(["show", "HEAD:.lisa.config.json"]));
  const policy = config.automationProvenance;
  requireProof(
    policy?.enabled === true && policy.version === 1,
    "trusted automation policy is absent"
  );
  requireProof(
    typeof policy.repository === "string" &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(policy.repository),
    "invalid policy repository"
  );
  requireProof(
    [policy.repositoryId, policy.ownerId, policy.claimActorId].every(value =>
      /^[1-9]\d*$/.test(value)
    ),
    "invalid policy identity"
  );
  requireProof(
    typeof policy.signerWorkflow === "string" &&
      policy.signerWorkflow.endsWith("/.github/workflows/npm-updater.yml") &&
      OBJECT_ID.test(policy.signerDigest),
    "invalid trusted signer"
  );
  requireProof(
    typeof policy.callerWorkflow === "string" &&
      policy.callerWorkflow.startsWith(
        `${policy.repository}/.github/workflows/`
      ) &&
      policy.callerWorkflow.endsWith(".yml"),
    "invalid caller workflow"
  );
  requireProof(
    Array.isArray(policy.allowedTriggers) &&
      policy.allowedTriggers.length > 0 &&
      policy.allowedTriggers.every(value =>
        ["push", "schedule", "workflow_dispatch"].includes(value)
      ),
    "invalid trigger policy"
  );
  requireProof(
    Number.isInteger(policy.maxAgeSeconds) &&
      policy.maxAgeSeconds > 0 &&
      policy.maxAgeSeconds <= 86400,
    "invalid authorization age"
  );
  requireProof(HEX.test(policy.ghSha256), "missing official verifier identity");
  return { config, policy };
}

/** Updates must be exactly the declared direct npm version changes. */
export function npmProposal(descriptor, git) {
  const manifest = npmPath(descriptor, MANIFEST);
  const before = JSON.parse(git(["show", `HEAD:${manifest}`]));
  const after = JSON.parse(git(["show", `:${manifest}`]));
  const lock = JSON.parse(git(["show", `:${npmPath(descriptor, NPM_LOCK)}`]));
  requireProof(
    [2, 3].includes(lock.lockfileVersion) && lock.packages?.[""],
    "unsupported npm lock"
  );
  requireProof(
    Array.isArray(descriptor.updates) &&
      descriptor.updates.length > 0 &&
      descriptor.updates.length <= 64,
    "invalid update set"
  );
  const seen = new Set();
  for (const update of descriptor.updates) {
    exactKeys(update, ["name", "section", "from", "to"], "npm update");
    requireProof(
      typeof update.name === "string" &&
        update.name.length <= 214 &&
        /^(?:@[a-z0-9][a-z0-9_.-]*\/)?[a-z0-9][a-z0-9_.-]*$/.test(update.name),
      "invalid npm package name"
    );
    requireProof(
      ["dependencies", "devDependencies", "optionalDependencies"].includes(
        update.section
      ),
      "unsupported npm section"
    );
    requireProof(
      [update.from, update.to].every(
        value =>
          typeof value === "string" &&
          /^[~^]?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value)
      ) && update.from !== update.to,
      "unsupported npm version change"
    );
    requireProof(
      !seen.has(`${update.section}/${update.name}`) &&
        before[update.section]?.[update.name] === update.from,
      "duplicate/stale npm update"
    );
    seen.add(`${update.section}/${update.name}`);
    before[update.section][update.name] = update.to;
    requireProof(
      lock.packages[""][update.section]?.[update.name] === update.to &&
        lock.packages[`node_modules/${update.name}`]?.version ===
          update.to.replace(/^[~^]/, ""),
      "manifest/lock version differs"
    );
  }
  requireProof(
    canonicalJson(before) === canonicalJson(after),
    "manifest changes undeclared fields"
  );
  requireProof(
    lock.name === after.name && lock.version === after.version,
    "lock root identity differs"
  );
}

export { FILES, DESCRIPTOR_KEYS, HEX, OBJECT_ID };
