// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Closed canonical schemas and committed npm policy remain independent of local proof IO. */
import { requireProof } from "./github-attestation-verifier.mjs";

const FILES = ["package-lock.json", "package.json"];
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
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

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
  const before = JSON.parse(git(["show", "HEAD:package.json"]));
  const after = JSON.parse(git(["show", ":package.json"]));
  const lock = JSON.parse(git(["show", ":package-lock.json"]));
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
