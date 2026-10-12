// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-checkpoint.mjs
 * @description Bounded compressed public storage is data only, never provenance authority.
 * @module npm-updater
 */
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { keys, required } from "./npm-update-contract.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";
import {
  checkpointPayloadBytes,
  encodeCheckpointBytes,
  decodeCheckpointBytes,
  manifestFor,
  completionManifest,
} from "./npm-update-checkpoint-codec.mjs";

const CHUNK = 16_384;
const PREFIX = "[lisa-npm-checkpoint]";
const HEX = /^[a-f0-9]{64}$/;

/** Recognize closed wire versions, rejecting mixed or unknown formats for the same digest. */
function relevant(comments, digest) {
  required(
    typeof digest === "string" && HEX.test(digest),
    "invalid checkpoint digest"
  );
  required(
    Array.isArray(comments) && comments.length <= 2000,
    "checkpoint comment inventory exceeds bound"
  );
  const bodies = comments
    .filter(comment => {
      const match = /^\[lisa-npm-checkpoint\] (\S+) ([a-f0-9]{64})(?: |$)/.exec(
        comment.body ?? ""
      );
      return match?.[2] === digest;
    })
    .map(comment => {
      required(
        Buffer.byteLength(comment.body) <= 24_576,
        "checkpoint comment exceeds bound"
      );
      return comment.body;
    });
  const versions = new Set(bodies.map(body => body.split(" ")[1]));
  required(
    versions.size <= 1 &&
      [...versions].every(version => version === "v1" || version === "v2"),
    "checkpoint transport version is unknown or mixed"
  );
  return bodies;
}

/** New writes compress; an explicitly selected legacy retry preserves its original wire bytes. */
export function checkpointComments(payload, originDigest, version = 2) {
  required(
    typeof originDigest === "string" && HEX.test(originDigest),
    "invalid checkpoint origin"
  );
  const bytes = checkpointPayloadBytes(payload);
  const transport = encodeCheckpointBytes(bytes, version);
  const count = Math.ceil(transport.length / CHUNK);
  required(count > 0 && count <= 256, "checkpoint chunk count exceeds bound");
  const chunks = Array.from({ length: count }, (_, index) =>
    transport.subarray(index * CHUNK, (index + 1) * CHUNK)
  );
  return [
    ...chunks.map(
      (chunk, index) =>
        `${PREFIX} v${version} ${originDigest} chunk ${index}/${count} ${sha256(chunk)}\n${chunk.toString("base64")}`
    ),
    `${PREFIX} v${version} ${originDigest} complete\n${canonicalJson(manifestFor(bytes, transport, chunks, originDigest, version))}`,
  ];
}

/** Each chunk is canonical, bounded and byte-bound before any decompression. */
function decodedChunks(bodies, digest, version, expectedCount) {
  const chunks = new Map();
  let count = expectedCount;
  for (const body of bodies) {
    const match =
      /^\[lisa-npm-checkpoint\] v([12]) ([a-f0-9]{64}) chunk (0|[1-9]\d*)\/([1-9]\d*) ([a-f0-9]{64})\n([A-Za-z0-9+/]+=*)$/.exec(
        body
      );
    required(
      match && Number(match[1]) === version && match[2] === digest,
      "checkpoint chunk shape differs"
    );
    count ??= Number(match[4]);
    const index = Number(match[3]);
    const bytes = Buffer.from(match[6], "base64");
    required(
      count > 0 &&
        count <= 256 &&
        Number(match[4]) === count &&
        index < count &&
        bytes.length > 0 &&
        bytes.length <= CHUNK &&
        bytes.toString("base64") === match[6] &&
        sha256(bytes) === match[5],
      "checkpoint chunk bytes differ"
    );
    required(
      !chunks.has(index) || chunks.get(index).equals(bytes),
      "differing duplicate checkpoint chunk"
    );
    chunks.set(index, bytes);
  }
  required(
    count > 0 && chunks.size === count,
    "checkpoint missing or reordered chunk"
  );
  return Array.from({ length: count }, (_, index) => chunks.get(index));
}

/** Decode bounded canonical public storage; signatures are always required separately. */
export function decodeCheckpoint(comments, digest) {
  const bodies = relevant(comments, digest);
  if (!bodies.length) return undefined;
  const version = Number(bodies[0].split(" ")[1].slice(1));
  const complete = bodies.filter(body =>
    body.startsWith(`${PREFIX} v${version} ${digest} complete\n`)
  );
  required(complete.length === 1, "checkpoint incomplete or ambiguous");
  const manifest = completionManifest(complete[0], digest, version);
  const chunks = decodedChunks(
    bodies.filter(body => body !== complete[0]),
    digest,
    version,
    manifest.chunks.length
  );
  manifest.chunks.forEach((entry, index) => {
    keys(entry, ["index", "sha256"]);
    required(
      entry.index === index && sha256(chunks[index]) === entry.sha256,
      "checkpoint missing or reordered chunk"
    );
  });
  const transport = Buffer.concat(chunks);
  required(
    version === 1 ||
      (transport.length === manifest.transportBytes &&
        sha256(transport) === manifest.transportSha256),
    "checkpoint encoded aggregate differs"
  );
  const { payload, bytes } = decodeCheckpointBytes(transport, version);
  required(
    bytes.length === manifest.bytes && sha256(bytes) === manifest.payloadSha256,
    "checkpoint aggregate differs"
  );
  return payload;
}

/** Complete chunk material retains its observed encoding instead of depending on recompression equality. */
function partialCompletion(comments, digest) {
  const bodies = relevant(comments, digest);
  required(
    bodies.length > 0,
    "partial checkpoint has missing original material"
  );
  const version = Number(bodies[0].split(" ")[1].slice(1));
  const chunks = decodedChunks(bodies, digest, version);
  const transport = Buffer.concat(chunks);
  const { payload, bytes } = decodeCheckpointBytes(transport, version);
  const completion = `${PREFIX} v${version} ${digest} complete\n${canonicalJson(manifestFor(bytes, transport, chunks, digest, version))}`;
  return { payload, completion };
}

/** Missing completion is recoverable data, never a successful durable authorization. */
export function recoverPartialCheckpoint(comments, digest) {
  const recovered = partialCompletion(comments, digest);
  return decodeCheckpoint(
    [...comments, { body: recovered.completion }],
    digest
  );
}

/** Exact retries preserve observed versions; alternate valid compression is retained when all chunks exist. */
function writeBodies(payload, digest, existing) {
  const observed = relevant(existing, digest);
  if (!observed.length) return checkpointComments(payload, digest);
  const version = Number(observed[0].split(" ")[1].slice(1));
  const complete = observed.some(body =>
    body.startsWith(`${PREFIX} v${version} ${digest} complete\n`)
  );
  if (complete) {
    required(
      canonicalJson(decodeCheckpoint(existing, digest)) ===
        canonicalJson(payload),
      "checkpoint retry payload differs"
    );
    return [...new Set(observed)].sort((left, right) => {
      const index = body =>
        body.includes(" complete\n")
          ? Infinity
          : Number(body.split(" ")[4].split("/")[0]);
      return index(left) - index(right);
    });
  }
  const expected = checkpointComments(payload, digest, version);
  if (observed.every(body => expected.includes(body))) return expected;
  const recovered = partialCompletion(existing, digest);
  required(
    canonicalJson(recovered.payload) === canonicalJson(payload),
    "checkpoint retry payload differs"
  );
  return [...new Set(observed), recovered.completion];
}

/** Every write still requires current authority and immediate exact provider readback. */
export async function persistCheckpoint(
  api,
  number,
  payload,
  digest,
  authorize
) {
  const endpoint = `repos/${api.policy.repository}/issues/${number}/comments`;
  const issueUrl = `https://api.github.com/repos/${api.policy.repository}/issues/${number}`;
  await authorize();
  let existing = await api.list(endpoint);
  const bodies = writeBodies(payload, digest, existing);
  for (const body of bodies) {
    const selected = relevant(existing, digest);
    required(
      new Set(selected).size === selected.length &&
        selected.every(value => bodies.includes(value)),
      "checkpoint retry transport differs"
    );
    let matches = existing.filter(comment => comment.body === body);
    required(matches.length <= 1, "duplicate checkpoint write state");
    if (matches.length) continue;
    // Existing exact bodies require no mutation. Missing bodies always renew live authority
    // and inventory first, including when completion is the sole remaining legacy write.
    await authorize();
    existing = await api.list(endpoint);
    const refreshed = relevant(existing, digest);
    required(
      new Set(refreshed).size === refreshed.length &&
        refreshed.every(value => bodies.includes(value)),
      "checkpoint retry transport differs"
    );
    matches = existing.filter(comment => comment.body === body);
    required(matches.length <= 1, "duplicate checkpoint write state");
    if (/ complete\n/.test(body)) {
      const projected = matches.length ? existing : [...existing, { body }];
      required(
        canonicalJson(decodeCheckpoint(projected, digest)) ===
          canonicalJson(payload),
        "checkpoint chunks must read back before completion"
      );
    }
    if (!matches.length) {
      const created = await api.request(endpoint, "POST", { body });
      required(
        created.issue_url === issueUrl,
        "checkpoint write scope differs"
      );
      required(
        created.body === body &&
          Number.isSafeInteger(created.id) &&
          created.id > 0,
        "checkpoint write readback differs"
      );
      const read = await api.request(
        `repos/${api.policy.repository}/issues/comments/${created.id}`
      );
      required(
        read.issue_url === issueUrl,
        "checkpoint immediate readback scope differs"
      );
      required(
        read.id === created.id && read.body === body,
        "checkpoint immediate readback differs"
      );
    }
  }
  const restored = decodeCheckpoint(await api.list(endpoint), digest);
  required(
    canonicalJson(restored) === canonicalJson(payload),
    "durable complete checkpoint differs"
  );
  return { originDescriptorSha256: digest, complete: true };
}
