// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Bounded read-only local Git validates exact protocol identities without granting publication authority. */
import { isAbsolute } from "node:path";
import { boundedSpawnSync } from "./bounded-spawn.mjs";
import { required } from "./npm-update-invariants.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";

/**
 * Git computes its own protocol identities without writing an object or running filters.
 * @param {string} cwd Original trusted publisher checkout.
 * @param {string} type Closed blob or commit object kind.
 * @param {Buffer} bytes Exact already bounded raw object contents.
 * @returns {string} The genuine SHA1 Git object identity.
 */
export function gitObjectId(cwd, type, bytes) {
  required(
    typeof cwd === "string" && isAbsolute(cwd),
    "trusted Git cwd required"
  );
  required(type === "blob" || type === "commit", "unsupported Git object kind");
  required(
    Buffer.isBuffer(bytes) &&
      bytes.length <= (type === "commit" ? 65_536 : 1_048_576),
    "bounded raw Git object required"
  );
  const options = {
    cwd,
    env: {
      PATH: process.env.PATH,
      HOME: "/nonexistent",
      GIT_TERMINAL_PROMPT: "0",
    },
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 128,
  };
  const format = boundedSpawnSync(
    "git",
    ["rev-parse", "--show-object-format"],
    options
  );
  required(
    format.status === 0 &&
      !format.error &&
      !format.signal &&
      format.stderr === "" &&
      format.stdout === "sha1\n",
    "publisher requires genuine sha1 Git object format"
  );
  const result = boundedSpawnSync(
    "git",
    ["hash-object", "-t", type, "--stdin"],
    { ...options, input: bytes }
  );
  required(
    result.status === 0 &&
      !result.error &&
      !result.signal &&
      result.stderr === "" &&
      /^[a-f0-9]{40}\n$/.test(result.stdout),
    "native Git object identity unavailable"
  );
  return result.stdout.slice(0, -1);
}

/** GitHub must recreate the actual raw object, including identity, time and message. */
export function validateRawCommit(bytes, descriptor, cwd) {
  required(
    Buffer.isBuffer(bytes) && bytes.length <= 65_536,
    "bounded raw commit required"
  );
  const text = new TextDecoder("utf-8", {
    fatal: true,
    ignoreBOM: true,
  }).decode(bytes);
  const split = text.indexOf("\n\n");
  required(split > 0, "invalid raw commit");
  const fields = text.slice(0, split).split("\n");
  required(
    fields.length === 4 &&
      fields[0] === `tree ${descriptor.tree}` &&
      fields[1] === `parent ${descriptor.parent}` &&
      fields[2] === `author ${descriptor.author}` &&
      fields[3] === `committer ${descriptor.committer}`,
    "raw commit metadata differs or signature is unsupported"
  );
  const message = text.slice(split + 2);
  required(
    sha256(Buffer.from(message)) === descriptor.messageSha256,
    "raw commit message differs"
  );
  const sha = gitObjectId(cwd, "commit", bytes);
  return {
    sha,
    message,
    author: identity(descriptor.author),
    committer: identity(descriptor.committer),
  };
}

/** UTC-only metadata avoids a provider rewriting timezone-sensitive raw bytes. */
function identity(value) {
  const match = /^([^\n<>]+) <([^\n<>]+)> ([1-9]\d*) \+0000$/.exec(value);
  required(Boolean(match), "publisher requires unsigned UTC Git identity");
  return {
    name: match[1],
    email: match[2],
    date: new Date(Number(match[3]) * 1000).toISOString(),
  };
}
