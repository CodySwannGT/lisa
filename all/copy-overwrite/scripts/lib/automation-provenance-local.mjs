// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Local proof snapshots and the genuine canonical resolver preserve exact final-read authority. */
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
import { resolveWorkItemContext, run } from "../lisa-work-item.mjs";
import { requireProof, sha256 } from "./github-attestation-verifier.mjs";
import { boundedSpawnSync } from "./bounded-spawn.mjs";
import {
  canonicalJson,
  exactKeys,
  FILES,
  DESCRIPTOR_KEYS,
  HEX,
  OBJECT_ID,
} from "./automation-provenance-contract.mjs";

/** Refuse aliases and oversize files; snapshots remain private, regular files. */
export function privateBytes(file, maximum, privateFile = true) {
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

/** Git reads always use the actual checkout and bounded shared runner. */
export function git(args) {
  return run("git", args, {
    timeout: 30_000,
    maxBuffer: 1_048_576,
  }).stdout.trim();
}

/** Alias and exact staged-blob checks run after descriptor metadata validation. */
function stagedFiles(descriptor) {
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

/** Match complete message and Git metadata before any network/proof acceptance. */
export function localDescriptor(descriptor, messageBytes, reference, policy) {
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
  stagedFiles(descriptor);
}

/** Snapshot only fixed private proof slots, refusing partial recovery before any authority checks. */
export function proofSnapshot() {
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
    recovery: resolve(directory, "recovery.json"),
    recoveryBundle: resolve(directory, "recovery-bundle.json"),
    descriptor: resolve(directory, "descriptor.json"),
    bundle: resolve(directory, "bundle.json"),
  };
  const optional = [paths.recovery, paths.recoveryBundle].map(file => {
    try {
      lstatSync(file);
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  });
  requireProof(optional[0] === optional[1], "partial recovery proof");
  const bytes = privateBytes(paths.descriptor, 65_536);
  const bundleBytes = privateBytes(paths.bundle, 1_048_576);
  const descriptor = JSON.parse(bytes.toString("utf8"));
  requireProof(
    bytes.toString("utf8") === `${canonicalJson(descriptor)}\n`,
    "noncanonical/duplicate descriptor fields"
  );

  return { paths, optional, bytes, bundleBytes, descriptor };
}

/** Reuse the shipped resolver and retain current canonical lifecycle requirements. */
export function canonicalContext(message, config, policy, descriptor) {
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

  return context;
}

/** Exact raw object prediction retains origin message, identities and epoch. */
export function predictedCommit(descriptor, messageBytes) {
  requireProof(
    Buffer.isBuffer(messageBytes) &&
      sha256(messageBytes) === descriptor.messageSha256,
    "origin message bytes differ"
  );
  const headers = `tree ${descriptor.tree}\nparent ${descriptor.parent}\nauthor ${descriptor.author}\ncommitter ${descriptor.committer}\n\n`;
  const raw = Buffer.concat([Buffer.from(headers), messageBytes]);
  const options = {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 128,
  };
  const format = boundedSpawnSync(
    "git",
    ["rev-parse", "--show-object-format"],
    options
  );
  requireProof(
    !format.error &&
      !format.signal &&
      format.status === 0 &&
      ["sha1\n", "sha256\n"].includes(format.stdout),
    "current Git object format is unavailable"
  );
  const width = format.stdout === "sha1\n" ? 40 : 64;
  requireProof(
    [descriptor.parent, descriptor.tree].every(
      value =>
        typeof value === "string" &&
        /^[a-f0-9]+$/.test(value) &&
        value.length === width
    ),
    "origin object format differs"
  );
  // Git computes its native identifier; without -w this writes no object.
  const result = boundedSpawnSync(
    "git",
    ["hash-object", "-t", "commit", "--stdin"],
    { ...options, input: raw }
  );
  requireProof(
    !result.error &&
      !result.signal &&
      result.status === 0 &&
      typeof result.stdout === "string" &&
      /^[a-f0-9]+\n$/.test(result.stdout) &&
      result.stdout.length === width + 1,
    "literal Git commit identity is unavailable"
  );
  return result.stdout.slice(0, -1);
}
