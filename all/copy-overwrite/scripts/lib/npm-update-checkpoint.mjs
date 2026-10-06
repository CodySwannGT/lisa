// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Bounded public checkpoint storage is data only, never provenance authority. */
import { TextDecoder } from "node:util";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { keys, required } from "./npm-update-contract.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";

const MAXIMUM = 4_194_304;
const CHUNK = 16_384;
const PREFIX = "[lisa-npm-checkpoint]";
const HEX = /^[a-f0-9]{64}$/;

/** Closed public payloads contain no bearer token or executable extension field. */
function payloadBytes(payload) {
  keys(payload, ["version", "proposal", "allocation", "preview", "bundle"]);
  required(
    payload.version === 1 && typeof payload.bundle === "string",
    "invalid public checkpoint payload"
  );
  const bytes = Buffer.from(`${canonicalJson(payload)}\n`);
  required(bytes.length <= MAXIMUM, "checkpoint payload exceeds bound");
  required(
    !/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(
      payload.bundle
    ),
    "bearer JWT cannot be retained"
  );
  return bytes;
}

/** Numbered digest-checked chunks precede one exact completion manifest. */
export function checkpointComments(payload, originDigest) {
  required(
    typeof originDigest === "string" && HEX.test(originDigest),
    "invalid checkpoint origin"
  );
  const bytes = payloadBytes(payload);
  const count = Math.ceil(bytes.length / CHUNK);
  required(count > 0 && count <= 256, "checkpoint chunk count exceeds bound");
  const chunks = Array.from({ length: count }, (_, index) =>
    bytes.subarray(index * CHUNK, (index + 1) * CHUNK)
  );
  const manifest = {
    version: 1,
    originDescriptorSha256: originDigest,
    payloadSha256: sha256(bytes),
    bytes: bytes.length,
    chunks: chunks.map((chunk, index) => ({ index, sha256: sha256(chunk) })),
  };
  return [
    ...chunks.map(
      (chunk, index) =>
        `${PREFIX} v1 ${originDigest} chunk ${index}/${count} ${sha256(chunk)}\n${chunk.toString("base64")}`
    ),
    `${PREFIX} v1 ${originDigest} complete\n${canonicalJson(manifest)}`,
  ];
}

/** A strict marker locates data only; signatures are still required separately. */
function relevant(comments, digest) {
  required(
    Array.isArray(comments) && comments.length <= 2000,
    "checkpoint comment inventory exceeds bound"
  );
  return comments
    .filter(
      comment =>
        typeof comment.body === "string" &&
        comment.body.startsWith(`${PREFIX} v1 ${digest} `)
    )
    .map(comment => {
      required(
        Buffer.byteLength(comment.body) <= 24_576,
        "checkpoint comment exceeds bound"
      );
      return comment.body;
    });
}

/** The unique completion record independently bounds the declared aggregate. */
function completionManifest(body, digest) {
  const text = body.split("\n").slice(1).join("\n");
  const manifest = JSON.parse(text);
  keys(manifest, [
    "version",
    "originDescriptorSha256",
    "payloadSha256",
    "bytes",
    "chunks",
  ]);
  required(
    canonicalJson(manifest) === text &&
      manifest.version === 1 &&
      manifest.originDescriptorSha256 === digest &&
      HEX.test(manifest.payloadSha256),
    "checkpoint manifest differs"
  );
  required(
    Number.isSafeInteger(manifest.bytes) &&
      manifest.bytes > 0 &&
      manifest.bytes <= MAXIMUM &&
      Array.isArray(manifest.chunks) &&
      manifest.chunks.length > 0 &&
      manifest.chunks.length <= 256,
    "checkpoint manifest bounds differ"
  );
  return manifest;
}

/** Each numbered chunk is canonical, bounded and byte-bound before aggregation. */
function decodedChunks(bodies, digest, manifest) {
  const chunks = new Map();
  for (const body of bodies) {
    const match =
      /^\[lisa-npm-checkpoint\] v1 ([a-f0-9]{64}) chunk (0|[1-9]\d*)\/([1-9]\d*) ([a-f0-9]{64})\n([A-Za-z0-9+/]+=*)$/.exec(
        body
      );
    required(
      match &&
        match[1] === digest &&
        Number(match[3]) === manifest.chunks.length,
      "checkpoint chunk shape differs"
    );
    const index = Number(match[2]);
    const bytes = Buffer.from(match[5], "base64");
    required(
      index < manifest.chunks.length &&
        bytes.length <= CHUNK &&
        bytes.toString("base64") === match[5] &&
        sha256(bytes) === match[4],
      "checkpoint chunk bytes differ"
    );
    required(
      !chunks.has(index) || chunks.get(index).equals(bytes),
      "differing duplicate checkpoint chunk"
    );
    chunks.set(index, bytes);
  }
  return chunks;
}

/** Decode bounded canonical public storage; this function never authorizes recovery. */
export function decodeCheckpoint(comments, digest) {
  required(
    typeof digest === "string" && HEX.test(digest),
    "invalid checkpoint digest"
  );
  const bodies = relevant(comments, digest);
  if (!bodies.length) return undefined;
  const complete = bodies.filter(body =>
    body.startsWith(`${PREFIX} v1 ${digest} complete\n`)
  );
  required(complete.length === 1, "checkpoint incomplete or ambiguous");
  const manifest = completionManifest(complete[0], digest);
  const chunks = decodedChunks(
    bodies.filter(body => body !== complete[0]),
    digest,
    manifest
  );
  const ordered = manifest.chunks.map((entry, index) => {
    keys(entry, ["index", "sha256"]);
    const chunk = chunks.get(index);
    required(
      entry.index === index && chunk && sha256(chunk) === entry.sha256,
      "checkpoint missing or reordered chunk"
    );
    return chunk;
  });
  const bytes = Buffer.concat(ordered);
  required(
    bytes.length === manifest.bytes && sha256(bytes) === manifest.payloadSha256,
    "checkpoint aggregate differs"
  );
  const payload = JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  );
  required(
    payloadBytes(payload).equals(bytes),
    "checkpoint is noncanonical or duplicate-keyed"
  );
  return payload;
}

/** Readback before completion prevents a stored marker blessing missing bytes. */
export async function persistCheckpoint(
  api,
  number,
  payload,
  digest,
  authorize
) {
  const bodies = checkpointComments(payload, digest);
  const endpoint = `repos/${api.policy.repository}/issues/${number}/comments`;
  const issueUrl = `https://api.github.com/repos/${api.policy.repository}/issues/${number}`;
  for (const body of bodies) {
    await authorize();
    const existing = await api.list(endpoint);
    const matches = existing.filter(comment => comment.body === body);
    if (body.startsWith(`${PREFIX} v1 ${digest} complete\n`)) {
      const projected = matches.length ? existing : [...existing, { body }];
      required(
        canonicalJson(decodeCheckpoint(projected, digest)) ===
          canonicalJson(payload),
        "checkpoint chunks must read back before completion"
      );
    }
    required(matches.length <= 1, "duplicate checkpoint write state");
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
