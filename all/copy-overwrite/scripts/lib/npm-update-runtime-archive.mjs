// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Bounded archive bytes and the complete OCI graph are checked without host extraction. @module npm-updater */
import { createHash } from "node:crypto";
import { openSync, closeSync, fstatSync, constants, readSync } from "node:fs";
import { Transform, Writable, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { required } from "./npm-update-contract.mjs";
import { validateArchiveGraph } from "./npm-update-runtime-graph.mjs";
export { validateArchiveGraph } from "./npm-update-runtime-graph.mjs";
const MAXIMUM = 1_500_000_000;

/** Duplicate member names, alias records and unsigned trailing payloads are never extracted. */
function tarHeader(bytes) {
  const number = field => {
    required(/^[0-7]+$/.test(field), "invalid archive numeric field");
    return parseInt(field, 8);
  };
  const text = field => {
    const end = field.indexOf(0);
    return field.subarray(0, end < 0 ? field.length : end).toString("ascii");
  };
  const checksum = number(text(bytes.subarray(148, 156)).trim());
  let actual = 0;
  for (let i = 0; i < 512; i++) actual += i >= 148 && i < 156 ? 32 : bytes[i];
  required(
    checksum === actual && bytes.subarray(345, 500).every(value => value === 0),
    "archive header checksum or prefix differs"
  );
  const name = text(bytes.subarray(0, 100));
  const size = number(text(bytes.subarray(124, 136)).trim());
  const type = bytes[156];
  const directory = type === 53 && ["blobs/", "blobs/sha256/"].includes(name);
  required(
    (directory && size === 0) ||
      ([0, 48].includes(type) &&
        /^(?:index\.json|manifest\.json|oci-layout|blobs\/sha256\/[a-f0-9]{64})$/.test(
          name
        )),
    "archive contains foreign member or alias"
  );
  required(
    bytes.subarray(157, 257).every(value => value === 0) && size <= MAXIMUM,
    "archive alias or member size differs"
  );
  return {
    name,
    size,
    directory,
    left: size,
    padding: (512 - (size % 512)) % 512,
    hash: createHash("sha256"),
    chunks: [],
  };
}

function completeMember(state) {
  const member = state.member;
  const digest = member.hash.digest("hex");
  if (!member.directory && member.name.startsWith("blobs/sha256/"))
    required(member.name.slice(13) === digest, "archive blob digest differs");
  if (!member.directory)
    state.members.set(member.name, {
      size: member.size,
      sha256: digest,
      bytes: member.size <= 1_048_576 ? Buffer.concat(member.chunks) : null,
    });
  state.member = null;
}

/** Streaming state keeps large layer bodies out of memory and checks padding and terminators. */
function consumeTar(state, chunk) {
  state.total += chunk.length;
  required(state.total <= MAXIMUM, "archive expanded size exceeds bound");
  state.buffer = Buffer.concat([state.buffer, chunk]);
  while (state.buffer.length) {
    if (state.end) {
      required(
        state.buffer.every(value => value === 0),
        "archive trailing payload differs"
      );
      state.zeros += state.buffer.length;
      state.buffer = Buffer.alloc(0);
      return;
    }
    if (!state.member) {
      if (state.buffer.length < 512) return;
      const header = state.buffer.subarray(0, 512);
      state.buffer = state.buffer.subarray(512);
      if (header.every(value => value === 0)) {
        state.end = true;
        state.zeros = 512;
        continue;
      }
      state.member = tarHeader(header);
      required(
        ++state.count <= 256 && !state.names.has(state.member.name),
        "archive duplicate or excessive members"
      );
      state.names.add(state.member.name);
    }
    const member = state.member;
    if (member.left) {
      const length = Math.min(member.left, state.buffer.length);
      const bytes = state.buffer.subarray(0, length);
      member.hash.update(bytes);
      if (member.size <= 1_048_576) member.chunks.push(Buffer.from(bytes));
      member.left -= length;
      state.buffer = state.buffer.subarray(length);
      if (member.left) return;
    }
    if (state.buffer.length < member.padding) return;
    required(
      state.buffer.subarray(0, member.padding).every(value => value === 0),
      "archive padding differs"
    );
    state.buffer = state.buffer.subarray(member.padding);
    completeMember(state);
  }
}

/** One caller owns descriptor closure even when pipeline rejects a malformed archive. */
async function* archiveChunks(fd) {
  const buffer = Buffer.alloc(65_536);
  let length;
  while ((length = readSync(fd, buffer, 0, buffer.length, null)) > 0)
    yield Buffer.from(buffer.subarray(0, length));
}

/** Whole compressed bytes are bound before this data can become a daemon-load input. */
export async function inspectRuntimeArchive(file, expected) {
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    required(
      stat.isFile() &&
        stat.uid === process.getuid() &&
        stat.nlink === 1 &&
        (stat.mode & 0o077) === 0 &&
        stat.size === expected.bytes &&
        stat.size > 0 &&
        stat.size < 1_000_000_000,
      "runtime archive is not bounded private data"
    );
    const hash = createHash("sha256");
    const state = {
      buffer: Buffer.alloc(0),
      member: null,
      members: new Map(),
      names: new Set(),
      total: 0,
      count: 0,
      end: false,
      zeros: 0,
    };
    let compressed = 0;
    const guard = new Transform({
      transform(chunk, encoding, callback) {
        try {
          compressed += chunk.length;
          required(compressed <= stat.size, "runtime archive grew");
          hash.update(chunk);
          callback(null, chunk);
        } catch (error) {
          callback(error);
        }
      },
    });
    const sink = new Writable({
      write(chunk, encoding, callback) {
        try {
          consumeTar(state, chunk);
          callback();
        } catch (error) {
          callback(error);
        }
      },
    });
    await pipeline(
      Readable.from(archiveChunks(fd)),
      guard,
      createGunzip(),
      sink
    );
    required(
      compressed === stat.size &&
        hash.digest("hex") === expected.sha256 &&
        state.total === expected.uncompressedBytes,
      "runtime archive complete byte identity differs"
    );
    required(
      state.end &&
        state.zeros >= 1024 &&
        !state.member &&
        state.buffer.length === 0,
      "runtime archive is truncated"
    );
    return validateArchiveGraph(state.members, expected);
  } finally {
    closeSync(fd);
  }
}
