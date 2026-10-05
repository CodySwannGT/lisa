// This file is managed by Lisa. Durable changes belong upstream.
/** Authenticated non-AI attribution supplements ordinary tracking and lint gates. */
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { resolveWorkItemContext, run } from "./lisa-work-item.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  assertPinnedVerifier,
  requireProof,
  sha256,
  verifyCurrentProvider,
  verifyDescriptorAttestation,
} from "./lib/github-attestation-verifier.mjs";

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

/** Refuse aliases and oversize files; snapshots remain private, regular files. */
function privateBytes(file, maximum, privateFile = true) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    requireProof(
      stat.isFile() &&
        stat.size <= maximum &&
        (!privateFile || (stat.mode & 0o077) === 0),
      "invalid regular bounded proof file"
    );
    const bytes = Buffer.alloc(maximum + 1);
    let count = 0;
    while (count < bytes.length) {
      const added = readSync(fd, bytes, count, bytes.length - count, null);
      if (added === 0) break;
      count += added;
    }
    requireProof(count <= maximum, "proof file grew beyond limit");
    return bytes.subarray(0, count);
  } finally {
    closeSync(fd);
  }
}

/** Exact keys prevent an unsigned path/command override hiding in a descriptor. */
function exactKeys(value, keys, subject) {
  requireProof(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${subject} is not an object`
  );
  requireProof(
    Object.keys(value).sort().join("\n") === [...keys].sort().join("\n"),
    `${subject} fields differ`
  );
}

/** A present but malformed reference is a failure, even with ordinary AI trailers. */
export function automationReference(message) {
  const lines = message
    .split(/\r?\n/)
    .filter(line => /^\s*Automation-Provenance\s*:/i.test(line));
  if (lines.length === 0) return undefined;
  requireProof(lines.length === 1, "ambiguous automation reference");
  const match =
    /^Automation-Provenance: actions\/([1-9]\d*)\/attempts\/([1-9]\d*)$/.exec(
      lines[0]
    );
  requireProof(Boolean(match), "malformed automation reference");
  return { runId: match[1], runAttempt: match[2] };
}

/** Git reads always use the actual checkout and bounded shared runner. */
function git(args) {
  return run("git", args, {
    timeout: 30_000,
    maxBuffer: 1_048_576,
  }).stdout.trim();
}

/** Policy is committed at the actual proposal base, never a local/env override. */
function trustedConfiguration() {
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

/** Match complete message and Git metadata before any network/proof acceptance. */
function localDescriptor(descriptor, messageBytes, reference, policy) {
  // Parsing never supplies the signed digest. Reject malformed UTF8 only on
  // this present-proof path; preserve any BOM as part of the actual message.
  const message = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(messageBytes);
  exactKeys(descriptor, DESCRIPTOR_KEYS, "descriptor");
  requireProof(
    descriptor.version === 1 &&
      descriptor.runId === reference.runId &&
      descriptor.runAttempt === reference.runAttempt,
    "run reference differs"
  );
  requireProof(
    [
      descriptor.messageSha256,
      descriptor.claimSha256,
      descriptor.proposalKey,
      descriptor.policySha256,
    ].every(value => typeof value === "string" && HEX.test(value)),
    "invalid descriptor digest"
  );
  requireProof(
    typeof descriptor.claimCommentId === "string" &&
      /^[1-9]\d*$/.test(descriptor.claimCommentId),
    "invalid claim reference"
  );
  requireProof(
    typeof descriptor.queue === "string" &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(descriptor.queue),
    "invalid tracker queue"
  );
  requireProof(
    descriptor.messageSha256 === sha256(messageBytes),
    "final commit message differs"
  );
  requireProof(
    !/^(?:Co-authored-by|AI-Agent|AI-Model|AI-Effort):/im.test(message),
    "automation proposal contains AI attribution"
  );
  requireProof(
    descriptor.policySha256 === sha256(canonicalJson(policy)),
    "trusted policy differs"
  );
  requireProof(
    descriptor.parent === git(["rev-parse", "HEAD"]),
    "proposal parent differs"
  );
  requireProof(
    OBJECT_ID.test(descriptor.tree) && descriptor.tree === git(["write-tree"]),
    "final staged tree differs"
  );
  requireProof(
    descriptor.author === git(["var", "GIT_AUTHOR_IDENT"]) &&
      descriptor.committer === git(["var", "GIT_COMMITTER_IDENT"]),
    "actual commit identity differs"
  );
  const changed = git(["diff", "--cached", "--name-only", "--no-renames"])
    .split("\n")
    .sort();
  requireProof(
    changed.join("\n") === FILES.join("\n"),
    "proposal changes foreign files"
  );
  exactKeys(descriptor.files, FILES, "proposal files");
  for (const file of FILES) {
    const entry = git(["ls-files", "--stage", "--", file]);
    requireProof(
      entry.startsWith("100644 ") && entry.split("\n").length === 1,
      "proposal file is not regular stage zero"
    );
    const bytes = run("git", ["show", `:${file}`], {
      timeout: 30_000,
      maxBuffer: 1_048_576,
    }).stdout;
    requireProof(
      descriptor.files[file] === sha256(bytes),
      "proposal blob differs"
    );
  }
}

/** Updates must be exactly the declared direct npm version changes. */
function npmProposal(descriptor) {
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

/** Verify fixed private proof against the final message, tree, binding and provider. */
export function verifyAutomationProvenance(messageFile) {
  const messageBytes = privateBytes(messageFile, 65_536, false);
  const message = messageBytes.toString("utf8");
  const reference = automationReference(message);
  if (!reference) return false;
  const { config, policy } = trustedConfiguration();
  const directory = resolve(
    git(["rev-parse", "--git-path", "lisa/automation-provenance"])
  );
  const stat = lstatSync(directory);
  requireProof(
    stat.isDirectory() && !stat.isSymbolicLink() && (stat.mode & 0o077) === 0,
    "invalid private proof directory"
  );
  requireProof(
    !lstatSync(dirname(directory)).isSymbolicLink(),
    "aliased proof parent"
  );
  const paths = {
    descriptor: resolve(directory, "descriptor.json"),
    bundle: resolve(directory, "bundle.json"),
  };
  const bytes = privateBytes(paths.descriptor, 65_536);
  privateBytes(paths.bundle, 1_048_576);
  const descriptor = JSON.parse(bytes.toString("utf8"));
  requireProof(
    bytes.toString("utf8") === `${canonicalJson(descriptor)}\n`,
    "noncanonical/duplicate descriptor fields"
  );
  localDescriptor(descriptor, messageBytes, reference, policy);
  npmProposal(descriptor);
  requireProof(
    descriptor.proposalKey ===
      sha256(
        canonicalJson({
          repository: policy.repository,
          parent: descriptor.parent,
          updates: descriptor.updates,
        })
      ),
    "deterministic proposal key differs"
  );
  assertPinnedVerifier(policy);
  const context = resolveWorkItemContext(message, {
    config,
    requireLive: true,
    execute: (command, args, options) =>
      run(command === "gh" ? policy.ghExecutable : command, args, {
        ...options,
        timeout: 30_000,
        maxBuffer: 1_048_576,
        env: { ...process.env, GH_HOST: "github.com" },
      }),
  });
  requireProof(
    context.provider === "github" &&
      context.ref === descriptor.workItem &&
      context.repository === descriptor.queue,
    "canonical tracker scope differs"
  );
  requireProof(
    context.issue.labels.some(
      label => label.name === context.lifecycle.claimed
    ),
    "canonical leaf is not claimed"
  );
  requireProof(
    !context.issue.labels.some(
      label =>
        context.lifecycle.roles.includes(label.name) &&
        label.name !== context.lifecycle.claimed
    ),
    "canonical leaf has a competing lifecycle role"
  );
  verifyDescriptorAttestation(policy, descriptor, paths, sha256(bytes));
  verifyCurrentProvider(policy, descriptor);
  requireProof(
    privateBytes(paths.descriptor, 65_536).equals(bytes),
    "descriptor changed during verification"
  );
  localDescriptor(
    descriptor,
    privateBytes(messageFile, 65_536, false),
    reference,
    policy
  );
  return true;
}

if (invokedAsScript(import.meta.url)) {
  try {
    const verified = verifyAutomationProvenance(process.argv[2]);
    process.exitCode = verified ? 0 : 10;
  } catch {
    console.error(
      "Invalid automation provenance: required proof, policy or provider evidence failed"
    );
    process.exitCode = 1;
  }
}
