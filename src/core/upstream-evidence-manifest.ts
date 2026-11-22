/**
 * @file upstream-evidence-manifest.ts
 * @description Loads the hash-pinned allowlist of public upstream evidence into
 * the frozen records the upstream-attribution boundary reads.
 *
 * The data lives in `upstream-evidence-manifest.json`, written by
 * `scripts/generate-upstream-evidence-manifest.mjs` (`bun run
 * build:upstream-evidence-manifest`). It is data, not source: one entry per
 * line keeps the per-entry diff and the merge driver's pointwise merge, and as
 * JSON it answers to no source-file length budget. This module validates every
 * entry once at load and freezes the result, so the security boundary that
 * consumes it never sees a malformed or mutable allowlist.
 * @module core/upstream-evidence-manifest
 */
import manifestDocument from "./upstream-evidence-manifest.json" with { type: "json" };

/** A lower-case hex sha256 digest. */
const SHA256 = /^[a-f0-9]{64}$/u;

/**
 * Read one named record of the manifest document.
 * @param name - The record to read
 * @returns The record's entries
 * @throws {Error} When the record is missing or not an object
 */
function recordEntries(name: string): readonly (readonly [string, unknown])[] {
  const document: unknown = manifestDocument;
  const record: unknown =
    typeof document === "object" && document !== null
      ? (document as Record<string, unknown>)[name]
      : undefined;
  if (typeof record !== "object" || record === null || Array.isArray(record)) {
    throw new Error(`upstream-evidence-manifest.json has no ${name} record`);
  }
  return Object.entries(record);
}

/**
 * Validate and freeze a record mapping each path to its sha256 digest.
 * @param name - The record to read
 * @returns The frozen record
 * @throws {Error} When an entry is not a sha256 digest
 */
function readDigestRecord(name: string): Readonly<Record<string, string>> {
  const entries = recordEntries(name).map(([key, digest]) => {
    if (typeof digest !== "string" || !SHA256.test(digest)) {
      throw new Error(
        `upstream-evidence-manifest.json ${name} entry ${key} is not a sha256 digest`
      );
    }
    return [key, digest] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}

/**
 * Validate and freeze a record of exact members, each marked `true`.
 * @param name - The record to read
 * @returns The frozen record
 * @throws {Error} When an entry is not marked `true`
 */
function readMemberRecord(name: string): Readonly<Record<string, true>> {
  const entries = recordEntries(name).map(([key, member]) => {
    if (member !== true) {
      throw new Error(
        `upstream-evidence-manifest.json ${name} entry ${key} is not marked true`
      );
    }
    return [key, member] as const;
  });
  return Object.freeze(Object.fromEntries(entries));
}

/** Packaged public evidence files, each pinned to its sha256 digest. */
export const UPSTREAM_EVIDENCE_MANIFEST: Readonly<Record<string, string>> =
  readDigestRecord("UPSTREAM_EVIDENCE_MANIFEST");

/** Exact paths tracked by the public Lisa repository at generation time. */
export const UPSTREAM_SURFACE_MANIFEST: Readonly<Record<string, true>> =
  readMemberRecord("UPSTREAM_SURFACE_MANIFEST");

/** Full commit SHAs reachable from public origin refs when this package was built. */
export const UPSTREAM_PUBLIC_COMMITS: Readonly<Record<string, true>> =
  readMemberRecord("UPSTREAM_PUBLIC_COMMITS");
