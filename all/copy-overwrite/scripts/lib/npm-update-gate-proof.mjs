// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Complete private proof transport; the ordinary verifier still authenticates every byte. */
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { required } from "./npm-update-contract.mjs";
import { readBytes, writeJson } from "./npm-update-process.mjs";

/** Optional recovery is always a pair, never silently downgraded to origin authority. */
export function validateGateProof(proof) {
  required(
    (proof.recovery !== undefined) === (proof.recoveryBundle !== undefined),
    "partial gate recovery proof"
  );
  for (const [name, maximum] of [
    ["bundle", 1_048_576],
    ["recovery", 65_536],
    ["recoveryBundle", 1_048_576],
  ]) {
    const bytes = proof[name];
    required(
      (name !== "bundle" && bytes === undefined) ||
        (Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maximum),
      "invalid bounded gate proof bytes"
    );
  }
}

/** Dangling aliases are present invalid inputs, never an absent recovery slot. */
function present(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

/** Read all fixed slots before any attributed checkout operation. */
export function readGateProof(directory) {
  const recovery = join(directory, "recovery.json");
  const recoveryBundle = join(directory, "recovery-bundle.json");
  required(
    present(recovery) === present(recoveryBundle),
    "partial gate recovery proof"
  );
  const proof = {
    bundle: readBytes(join(directory, "bundle.json"), 1_048_576),
    recovery: present(recovery) ? readBytes(recovery, 65_536) : undefined,
    recoveryBundle: present(recoveryBundle)
      ? readBytes(recoveryBundle, 1_048_576)
      : undefined,
  };
  validateGateProof(proof);
  return proof;
}

/** Exclusive writes preserve original and recovery proof bytes; no transport grants verification. */
export function writeGateProof(directory, descriptor, proof) {
  validateGateProof(proof);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  required(
    stat.isDirectory() &&
      !stat.isSymbolicLink() &&
      realpathSync(directory) === resolve(directory) &&
      stat.uid === process.getuid() &&
      (stat.mode & 0o077) === 0,
    "gate proof directory is aliased or public"
  );
  writeJson(join(directory, "descriptor.json"), descriptor);
  for (const [key, file] of [
    ["bundle", "bundle.json"],
    ["recovery", "recovery.json"],
    ["recoveryBundle", "recovery-bundle.json"],
  ])
    if (proof[key] !== undefined)
      writeFileSync(join(directory, file), proof[key], {
        mode: 0o600,
        flag: "wx",
      });
}

/** Resolve the real Git control path and preserve the complete private proof and message. */
export async function installGateProof(context, root, git) {
  const control = (await git(["rev-parse", "--git-common-dir"])).stdout
    .toString()
    .trim();
  writeGateProof(
    resolve(context.cwd, control, "lisa/automation-provenance"),
    context.preview.descriptor,
    context
  );
  const message = join(root, "message");
  writeFileSync(message, context.preview.message, { mode: 0o600, flag: "wx" });
  return message;
}
