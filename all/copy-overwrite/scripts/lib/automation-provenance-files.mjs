// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Descriptor-backed readers reject aliases and growth before proof bytes gain authority. */
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
} from "node:fs";
import { requireProof } from "./github-attestation-verifier.mjs";

/** Only native ENOENT establishes absence; dangling aliases and query errors refuse. */
export function fileAbsent(file) {
  try {
    lstatSync(file);
    return false;
  } catch (error) {
    if (error.code === "ENOENT") return true;
    throw error;
  }
}

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
