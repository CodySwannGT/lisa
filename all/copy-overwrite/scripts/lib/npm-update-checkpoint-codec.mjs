// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/**
 * @file npm-update-checkpoint-codec.mjs
 * @description Reduce serial public writes without extending signed authorization freshness.
 * @module npm-updater
 */
import { TextDecoder } from "node:util";
import { deflateSync, inflateSync } from "node:zlib";
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { keys, required } from "./npm-update-contract.mjs";
import { sha256 } from "./github-attestation-verifier.mjs";

const HEX = /^[a-f0-9]{64}$/;

export const PAYLOAD_MAXIMUM = 4_194_304;
export const TRANSPORT_MAXIMUM = 4_194_304;

/** Closed public payloads contain no bearer token or executable extension field. */
export function checkpointPayloadBytes(payload) {
  keys(payload, ["version", "proposal", "allocation", "preview", "bundle"]);
  required(
    payload.version === 1 && typeof payload.bundle === "string",
    "invalid public checkpoint payload"
  );
  const bytes = Buffer.from(`${canonicalJson(payload)}\n`);
  required(bytes.length <= PAYLOAD_MAXIMUM, "checkpoint payload exceeds bound");
  required(
    !/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(
      payload.bundle
    ),
    "bearer JWT cannot be retained"
  );
  return bytes;
}

/** The fixed codec changes transport only; signed subjects and canonical payloads stay intact. */
export function encodeCheckpointBytes(bytes, version) {
  required(
    version === 1 || version === 2,
    "unknown checkpoint transport version"
  );
  const encoded = version === 1 ? bytes : deflateSync(bytes, { level: 6 });
  required(
    encoded.length <= TRANSPORT_MAXIMUM,
    "checkpoint transport exceeds bound"
  );
  return encoded;
}

/** An independent output ceiling and exact stream consumption refuse bombs and appended streams. */
export function decodeCheckpointBytes(transport, version) {
  required(
    (version === 1 || version === 2) &&
      transport.length > 0 &&
      transport.length <= TRANSPORT_MAXIMUM,
    "checkpoint transport bounds or version differ"
  );
  const inflated =
    version === 2
      ? inflateSync(transport, { info: true, maxOutputLength: PAYLOAD_MAXIMUM })
      : undefined;
  required(
    !inflated || inflated.engine.bytesWritten === transport.length,
    "checkpoint compressed stream has trailing bytes"
  );
  const bytes = inflated ? inflated.buffer : transport;
  required(
    bytes.length <= PAYLOAD_MAXIMUM,
    "checkpoint decoded payload exceeds bound"
  );
  const payload = JSON.parse(
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes)
  );
  required(
    checkpointPayloadBytes(payload).equals(bytes),
    "checkpoint is noncanonical or duplicate-keyed"
  );
  return { payload, bytes };
}

/** Bind decoded bytes independently from the compressed stream and each numbered comment. */
export function manifestFor(bytes, transport, chunks, digest, version) {
  return {
    version,
    ...(version === 2
      ? {
          encoding: "deflate",
          transportSha256: sha256(transport),
          transportBytes: transport.length,
        }
      : {}),
    originDescriptorSha256: digest,
    payloadSha256: sha256(bytes),
    bytes: bytes.length,
    chunks: chunks.map((chunk, index) => ({ index, sha256: sha256(chunk) })),
  };
}

/** The unique canonical completion independently declares encoded and decoded aggregate ceilings. */
export function completionManifest(body, digest, version) {
  const text = body.split("\n").slice(1).join("\n");
  const manifest = JSON.parse(text);
  keys(manifest, [
    "version",
    "originDescriptorSha256",
    "payloadSha256",
    "bytes",
    "chunks",
    ...(version === 2 ? ["encoding", "transportSha256", "transportBytes"] : []),
  ]);
  required(
    canonicalJson(manifest) === text &&
      manifest.version === version &&
      manifest.originDescriptorSha256 === digest &&
      typeof manifest.payloadSha256 === "string" &&
      HEX.test(manifest.payloadSha256),
    "checkpoint manifest differs"
  );
  required(
    Number.isSafeInteger(manifest.bytes) &&
      manifest.bytes > 0 &&
      manifest.bytes <= PAYLOAD_MAXIMUM &&
      Array.isArray(manifest.chunks) &&
      manifest.chunks.length > 0 &&
      manifest.chunks.length <= 256,
    "checkpoint manifest bounds differ"
  );
  required(
    version === 1 ||
      (manifest.encoding === "deflate" &&
        typeof manifest.transportSha256 === "string" &&
        HEX.test(manifest.transportSha256) &&
        Number.isSafeInteger(manifest.transportBytes) &&
        manifest.transportBytes > 0 &&
        manifest.transportBytes <= TRANSPORT_MAXIMUM),
    "checkpoint encoded manifest differs"
  );
  return manifest;
}
