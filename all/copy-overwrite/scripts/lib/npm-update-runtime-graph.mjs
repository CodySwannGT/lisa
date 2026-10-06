// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** The complete tagless OCI closure binds distinct index, platform manifest and config identities. @module npm-updater */
import { required } from "./npm-update-contract.mjs";
const INDEX = "application/vnd.oci.image.index.v1+json";
const MANIFEST = "application/vnd.oci.image.manifest.v1+json";
const CONFIG = "application/vnd.oci.image.config.v1+json";
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAXIMUM = 1_500_000_000;

function jsonMember(members, path) {
  const member = members.get(path);
  required(
    member?.bytes && member.size <= 1_048_576,
    "archive metadata is absent or unbounded"
  );
  return JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(member.bytes)
  );
}

/** Every referenced descriptor is bound to the actual member digest and byte length. */
function descriptorMember(members, descriptor, seen) {
  required(
    descriptor &&
      DIGEST.test(descriptor.digest) &&
      Number.isSafeInteger(descriptor.size) &&
      descriptor.size > 0 &&
      descriptor.size <= MAXIMUM,
    "invalid archive OCI descriptor"
  );
  const path = `blobs/sha256/${descriptor.digest.slice(7)}`;
  const member = members.get(path);
  required(
    member?.sha256 === descriptor.digest.slice(7) &&
      member.size === descriptor.size,
    "archive OCI descriptor bytes differ"
  );
  required(
    !descriptor.annotations ||
      Object.keys(descriptor.annotations).every(key =>
        [
          "vnd.docker.reference.digest",
          "vnd.docker.reference.type",
          "in-toto.io/predicate-type",
        ].includes(key)
      ),
    "archive repository tag annotation is forbidden"
  );
  seen.add(path);
  return path;
}

function manifestMember(members, descriptor, seen) {
  required(
    descriptor.mediaType === MANIFEST,
    "unsupported archive manifest type"
  );
  const manifest = jsonMember(
    members,
    descriptorMember(members, descriptor, seen)
  );
  required(
    manifest.schemaVersion === 2 &&
      manifest.mediaType === MANIFEST &&
      manifest.config?.mediaType === CONFIG &&
      Array.isArray(manifest.layers) &&
      manifest.layers.length <= 128,
    "invalid archive OCI manifest"
  );
  descriptorMember(members, manifest.config, seen);
  for (const layer of manifest.layers) {
    required(
      [
        "application/vnd.oci.image.layer.v1.tar+gzip",
        "application/vnd.oci.image.layer.v1.tar",
        "application/vnd.in-toto+json",
      ].includes(layer.mediaType),
      "unsupported archive layer type"
    );
    descriptorMember(members, layer, seen);
  }
  return manifest;
}

/** Docker's index ID and config ID are distinct; both and every graph member must match. */
export function validateArchiveGraph(members, expected) {
  required(
    DIGEST.test(expected.image) &&
      DIGEST.test(expected.config) &&
      ["linux/arm64", "linux/amd64"].includes(expected.platform),
    "invalid archive expected identity"
  );
  required(
    jsonMember(members, "oci-layout").imageLayoutVersion === "1.0.0",
    "archive OCI layout differs"
  );
  const top = jsonMember(members, "index.json");
  required(
    top.schemaVersion === 2 &&
      top.mediaType === INDEX &&
      top.manifests?.length === 1 &&
      top.manifests[0].digest === expected.image &&
      top.manifests[0].mediaType === INDEX,
    "archive index identity differs"
  );
  const seen = new Set();
  const index = jsonMember(
    members,
    descriptorMember(members, top.manifests[0], seen)
  );
  required(
    index.schemaVersion === 2 &&
      index.mediaType === INDEX &&
      Array.isArray(index.manifests) &&
      index.manifests.length > 0 &&
      index.manifests.length <= 2,
    "archive image index differs"
  );
  const selected = index.manifests.filter(
    value =>
      `${value.platform?.os}/${value.platform?.architecture}` ===
      expected.platform
  );
  required(selected.length === 1, "archive platform is absent or ambiguous");
  let manifest;
  for (const entry of index.manifests) {
    const current = manifestMember(members, entry, seen);
    if (entry === selected[0]) manifest = current;
    else
      required(
        entry.platform?.os === "unknown" &&
          entry.platform?.architecture === "unknown" &&
          entry.annotations?.["vnd.docker.reference.type"] ===
            "attestation-manifest" &&
          entry.annotations?.["vnd.docker.reference.digest"] ===
            selected[0].digest,
        "archive contains a foreign platform image"
      );
  }
  required(
    manifest.config.digest === expected.config,
    "archive config identity differs"
  );
  const config = jsonMember(
    members,
    `blobs/sha256/${expected.config.slice(7)}`
  );
  required(
    `${config.os}/${config.architecture}` === expected.platform,
    "archive config platform differs"
  );
  legacyClosure(members, expected, manifest, seen);
  return {
    image: expected.image,
    config: expected.config,
    platform: expected.platform,
  };
}

/** A tagless legacy manifest must describe exactly the same referenced OCI image. */
function legacyClosure(members, expected, manifest, seen) {
  const legacy = jsonMember(members, "manifest.json");
  required(
    Array.isArray(legacy) && legacy.length === 1 && legacy[0].RepoTags === null,
    "archive repository tags are forbidden"
  );
  required(
    legacy[0].Config === `blobs/sha256/${expected.config.slice(7)}` &&
      JSON.stringify(legacy[0].Layers) ===
        JSON.stringify(
          manifest.layers.map(layer => `blobs/sha256/${layer.digest.slice(7)}`)
        ),
    "archive legacy config/layer graph differs"
  );
  required(
    [...members.keys()].every(
      path =>
        ["index.json", "manifest.json", "oci-layout"].includes(path) ||
        seen.has(path)
    ),
    "archive contains unreferenced blobs"
  );
}
