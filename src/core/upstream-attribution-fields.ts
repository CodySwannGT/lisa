/**
 * Field validators for the public upstream-attribution projection.
 *
 * Each validator turns one untrusted field into a value the public renderer
 * may print: an exact surface or evidence manifest member, a verified Lisa
 * excerpt, a public-origin commit, or a re-hashed occurrence fingerprint.
 * @module core/upstream-attribution-fields
 */
import { createHash } from "node:crypto";

import { EXCERPTS_FIELD, verifyExcerpt } from "./upstream-attribution-files.js";
import {
  assertDynamicTextSafe,
  assertTextControlsSafe,
  readValue,
  reject,
  requireAllowlistedRecord,
  requireAsciiString,
  requireDenseArray,
} from "./upstream-attribution-guards.js";
import {
  UPSTREAM_EVIDENCE_MANIFEST,
  UPSTREAM_PUBLIC_COMMITS,
  UPSTREAM_SURFACE_MANIFEST,
} from "./upstream-evidence-manifest.js";

const MAX_EXCERPT_BYTES = 16_384;
const MAX_AGGREGATE_EXCERPT_BYTES = 48_000;
const PACKAGE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SURFACE_PATH_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const FINGERPRINT_PATTERN = /^sll4-[a-f0-9]{12}$/;
const FINGERPRINT_FIELD = "occurrenceFingerprint";
const EXCERPT_FIELDS = Object.freeze(["file", "text"] as const);

/** One excerpt that must exist verbatim in a hash-pinned Lisa package file. */
export interface UpstreamAttributionExcerpt {
  readonly file: string;
  readonly text: string;
}

/** The two document kinds a filing can project to. */
export type UpstreamDocumentKind = "issue" | "occurrence";

/**
 * Require the closed document kind.
 * @param value - Untrusted `documentKind`
 * @returns `issue` or `occurrence`
 */
export function requireDocumentKind(value: unknown): UpstreamDocumentKind {
  if (value !== "issue" && value !== "occurrence") {
    return reject("documentKind", 'must be "issue" or "occurrence"');
  }
  return value;
}

/**
 * Require an exact member of the public Lisa surface manifest.
 * @param value - Untrusted `lisaSurface`
 * @returns The validated surface path
 */
export function requireLisaSurface(value: unknown): string {
  const surface = requireAsciiString(value, "lisaSurface", 200);
  assertDynamicTextSafe(surface, "lisaSurface");
  if (
    !isSafeSurfacePath(surface) ||
    !Object.hasOwn(UPSTREAM_SURFACE_MANIFEST, surface)
  ) {
    return reject(
      "lisaSurface",
      "must be an exact public Lisa surface manifest member"
    );
  }
  return surface;
}

/**
 * Require verified excerpts whose combined size stays within the public bound.
 * @param value - Untrusted `lisaOwnedExcerpts`
 * @returns The verified excerpts
 */
export function requireExcerpts(
  value: unknown
): readonly UpstreamAttributionExcerpt[] {
  const excerpts = requireDenseArray(value, EXCERPTS_FIELD, false).map(
    (entry, index) => requireExcerpt(entry, `${EXCERPTS_FIELD}[${index}]`)
  );
  const aggregateBytes = excerpts.reduce(
    (total, excerpt) => total + Buffer.byteLength(excerpt.text, "utf8"),
    0
  );
  if (aggregateBytes > MAX_AGGREGATE_EXCERPT_BYTES) {
    reject(EXCERPTS_FIELD, "exceeds the aggregate byte limit");
  }
  return excerpts;
}

/**
 * Require one excerpt record and prove its text against the package file.
 * @param entry - Untrusted excerpt record
 * @param field - Indexed field name reported on rejection
 * @returns The verified excerpt
 */
function requireExcerpt(
  entry: unknown,
  field: string
): UpstreamAttributionExcerpt {
  const record = requireAllowlistedRecord(entry, EXCERPT_FIELDS, field);
  const file = requireManifestPath(readValue(record, "file"));
  const text = requireExcerptText(readValue(record, "text"));
  verifyExcerpt(file, text);
  return { file, text };
}

/**
 * Require an exact member of the public evidence manifest.
 * @param value - Untrusted excerpt `file`
 * @returns The validated package-relative path
 */
function requireManifestPath(value: unknown): string {
  const member = requireAsciiString(value, EXCERPTS_FIELD, 500);
  assertDynamicTextSafe(member, EXCERPTS_FIELD);
  if (
    !isSafePackagePath(member) ||
    !Object.hasOwn(UPSTREAM_EVIDENCE_MANIFEST, member)
  ) {
    return reject(
      EXCERPTS_FIELD,
      "file must be an exact public Lisa evidence manifest member"
    );
  }
  return member;
}

/**
 * Require bounded, valid, control-free excerpt text with no reserved marker.
 * @param value - Untrusted excerpt `text`
 * @returns The validated text
 */
function requireExcerptText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return reject(EXCERPTS_FIELD, "text must be a non-empty string");
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_EXCERPT_BYTES) {
    return reject(EXCERPTS_FIELD, "text exceeds the per-excerpt byte limit");
  }
  if (Buffer.from(value, "utf8").toString("utf8") !== value) {
    return reject(EXCERPTS_FIELD, "text must be valid UTF-8");
  }
  assertTextControlsSafe(value, EXCERPTS_FIELD);
  assertDynamicTextSafe(value, EXCERPTS_FIELD);
  if (value.includes("[lisa-upstream-attribution")) {
    return reject(
      EXCERPTS_FIELD,
      "text must not contain a reserved upstream attribution marker"
    );
  }
  return value;
}

/**
 * Require full SHAs reachable from public origin refs.
 * @param value - Untrusted `upstreamCommitRefs`
 * @returns The validated commit SHAs
 */
export function requireCommitRefs(value: unknown): readonly string[] {
  return requireDenseArray(value, "upstreamCommitRefs", false).map(entry => {
    const sha = requireAsciiString(entry, "upstreamCommitRefs", 40);
    assertDynamicTextSafe(sha, "upstreamCommitRefs");
    if (
      !SHA_PATTERN.test(sha) ||
      !Object.hasOwn(UPSTREAM_PUBLIC_COMMITS, sha)
    ) {
      return reject(
        "upstreamCommitRefs",
        "must contain full SHAs reachable from public origin refs"
      );
    }
    return sha;
  });
}

/**
 * Require a fingerprint exactly when the document is an occurrence, and
 * re-hash it so the public comment never echoes the caller's value.
 * @param value - Untrusted `occurrenceFingerprint`
 * @param documentKind - Validated document kind
 * @returns The derived public fingerprint, or undefined for an issue
 */
export function requireFingerprintPairing(
  value: unknown,
  documentKind: UpstreamDocumentKind
): string | undefined {
  if (documentKind === "issue") {
    return value === undefined
      ? undefined
      : reject(FINGERPRINT_FIELD, "is valid only for occurrence events");
  }
  const fingerprint = requireAsciiString(value, FINGERPRINT_FIELD, 17);
  assertDynamicTextSafe(fingerprint, FINGERPRINT_FIELD);
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    return reject(
      FINGERPRINT_FIELD,
      "must be sll4- plus exactly 12 lowercase hex characters"
    );
  }
  return `sll4-${createHash("sha256")
    .update(fingerprint, "utf8")
    .digest("hex")
    .slice(0, 12)}`;
}

/**
 * Check a package-relative path has no empty, `.` or `..` segments.
 * @param value - Candidate path
 * @returns True when the path is safe to join under the package root
 */
function isSafePackagePath(value: string): boolean {
  return (
    PACKAGE_PATH_PATTERN.test(value) &&
    !value.includes("//") &&
    value.split("/").every(segment => segment !== "." && segment !== "..")
  );
}

/**
 * Check a surface path has no `.` or `..` segments.
 * @param value - Candidate surface path
 * @returns True when the surface path is well formed
 */
function isSafeSurfacePath(value: string): boolean {
  return (
    SURFACE_PATH_PATTERN.test(value) &&
    value.split("/").every(segment => segment !== "." && segment !== "..")
  );
}
