/* eslint-disable max-lines, jsdoc/require-jsdoc, jsdoc/require-param-description, jsdoc/require-returns, functional/no-let, sonarjs/no-duplicate-string, code-organization/enforce-statement-order -- this security boundary is easier to audit as one ordered module */
/** Hash-pinned allowlist projection for public upstream Lisa filings. */
import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { isProxy } from "node:util/types";
import { fileURLToPath } from "node:url";

import {
  UPSTREAM_EVIDENCE_MANIFEST,
  UPSTREAM_PUBLIC_COMMITS,
  UPSTREAM_SURFACE_MANIFEST,
} from "./upstream-evidence-manifest.js";

const PACKAGE_ROOT = realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
);
const MAX_LIST_ITEMS = 12;
const MAX_SOURCE_BYTES = 1_000_000;
const MAX_EXCERPT_BYTES = 16_384;
const MAX_AGGREGATE_EXCERPT_BYTES = 48_000;
const MAX_PUBLIC_BODY_BYTES = 60_000;
const MAX_PACKAGE_JSON_BYTES = 64_000;
const PACKAGE_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SURFACE_PATH_PATTERN = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const FINGERPRINT_PATTERN = /^sll4-[a-f0-9]{12}$/;

const TOP_LEVEL_FIELDS = Object.freeze([
  "documentKind",
  "lisaSurface",
  "failureClass",
  "lisaOwnedExcerpts",
  "upstreamCommitRefs",
  "redactedPlaceholders",
  "occurrenceFingerprint",
] as const);
const EXCERPT_FIELDS = Object.freeze(["file", "text"] as const);

/** Closed, host-agnostic failure categories accepted in public filings. */
export const UPSTREAM_FAILURE_CLASSES = Object.freeze([
  "access-control-failure",
  "agent-parity-regression",
  "configuration-regression",
  "data-integrity-failure",
  "dependency-regression",
  "generated-artifact-regression",
  "installation-regression",
  "observability-gap",
  "pagination-truncation",
  "performance-regression",
  "public-data-exposure",
  "release-regression",
  "runtime-regression",
  "stale-artifact-overwrite",
  "test-coverage-gap",
  "validation-gap",
  "workflow-contract-violation",
] as const);
const FAILURE_CLASS_SET: ReadonlySet<string> = new Set(
  UPSTREAM_FAILURE_CLASSES
);

/** Fixed redaction tokens that can appear in public reproduction steps. */
export const UPSTREAM_REDACTED_PLACEHOLDERS = Object.freeze([
  "<host-project>",
  "<env-value>",
  "<credential>",
  "<connection-string>",
  "<pii>",
  "<host-payload>",
  "<path>",
  "<identifier>",
] as const);
const PLACEHOLDER_SET: ReadonlySet<string> = new Set(
  UPSTREAM_REDACTED_PLACEHOLDERS
);

const PUBLIC_BODY_DENY_LIST = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_\w{20,}\b/,
  /\bxox[baprs]-[\w-]{10,}\b/,
  /\b(?:api[_-]?key|access[_-]?key|password|passwd|secret|token|credential)\s*=\s*[\w+./=-]{16,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
] as const;

/** One generic category from the closed public-filing taxonomy. */
export type UpstreamFailureClass = (typeof UPSTREAM_FAILURE_CLASSES)[number];

/** One safe, fixed reproduction placeholder accepted by the public builder. */
export type UpstreamRedactedPlaceholder =
  (typeof UPSTREAM_REDACTED_PLACEHOLDERS)[number];

/** One excerpt that must exist verbatim in a hash-pinned Lisa package file. */
export interface UpstreamAttributionExcerpt {
  readonly file: string;
  readonly text: string;
}

interface CommonUpstreamAttributionInput {
  readonly lisaSurface: string;
  readonly failureClass: UpstreamFailureClass;
  readonly lisaOwnedExcerpts: readonly UpstreamAttributionExcerpt[];
  readonly upstreamCommitRefs: readonly string[];
  readonly redactedPlaceholders: readonly UpstreamRedactedPlaceholder[];
}

/** Typed issue event accepted by the public attribution builder. */
export interface UpstreamAttributionIssueInput extends CommonUpstreamAttributionInput {
  readonly documentKind: "issue";
}

/** Typed repeat-occurrence event accepted by the public attribution builder. */
export interface UpstreamAttributionOccurrenceInput extends CommonUpstreamAttributionInput {
  readonly documentKind: "occurrence";
  readonly occurrenceFingerprint: string;
}

/** Closed discriminated event accepted by the public attribution builder. */
export type UpstreamAttributionBodyInput =
  | UpstreamAttributionIssueInput
  | UpstreamAttributionOccurrenceInput;

interface ValidatedAttribution {
  readonly documentKind: "issue" | "occurrence";
  readonly lisaSurface: string;
  readonly failureClass: UpstreamFailureClass;
  readonly excerpts: readonly UpstreamAttributionExcerpt[];
  readonly upstreamCommitRefs: readonly string[];
  readonly redactedPlaceholders: readonly UpstreamRedactedPlaceholder[];
  readonly occurrenceFingerprint: string | undefined;
}

/** A field-named, value-sanitized public projection rejection. */
export class UpstreamAttributionRejection extends Error {
  readonly field: string;

  constructor(field: string, detail: string) {
    super(`upstream-attribution: field "${field}": ${detail}`);
    this.name = "UpstreamAttributionRejection";
    this.field = field;
  }
}

/**
 * Build one public issue body or repeat-occurrence comment from a closed event.
 * @param input - Untrusted event supplied by the host-project workflow
 * @returns Public Markdown safe to send verbatim to the upstream writer
 */
export function buildUpstreamAttributionIssueBody(
  input: UpstreamAttributionBodyInput
): string;
export function buildUpstreamAttributionIssueBody(input: unknown): string {
  const filing = validateAttribution(input);
  const rootCauseKey = `${filing.lisaSurface.toLowerCase()}#${filing.failureClass}`;
  const body =
    filing.documentKind === "occurrence"
      ? renderOccurrence(filing, rootCauseKey)
      : renderIssue(filing, rootCauseKey);
  assertPublicTextSafe(body);
  return body;
}

function renderIssue(
  filing: ValidatedAttribution,
  rootCauseKey: string
): string {
  return [
    `<!-- [lisa-upstream-attribution] key=${rootCauseKey} -->`,
    "",
    "## What failed for the operator",
    "",
    `A Lisa-managed surface produced a \`${filing.failureClass}\` failure, so the automated pipeline did not complete as intended. Host-project details are omitted from this public filing.`,
    "",
    "## What the harness did wrong",
    "",
    `Lisa's \`${filing.lisaSurface}\` surface did not prevent the \`${filing.failureClass}\` failure class. The evidence below contains only hash-pinned Lisa-owned text and public-origin commits.`,
    "",
    "## What to change",
    "",
    `Harden \`${filing.lisaSurface}\` against \`${filing.failureClass}\` and add a regression check using only the fixed redacted placeholders below.`,
    "",
    renderEvidence(filing),
    "",
    "_Body composed by `lisa file-upstream`; do not edit before filing._",
    "",
  ].join("\n");
}

function renderOccurrence(
  filing: ValidatedAttribution,
  rootCauseKey: string
): string {
  return [
    `<!-- [lisa-upstream-attribution-occurrence] key=${filing.occurrenceFingerprint ?? ""} -->`,
    "",
    "## Repeat encounter",
    "",
    `Another host project encountered root-cause key \`${rootCauseKey}\`. Host-project details are omitted; this comment contains only hash-pinned Lisa-owned evidence.`,
    "",
    renderEvidence(filing),
    "",
    "_Comment composed by `lisa file-upstream`; do not edit before posting._",
    "",
  ].join("\n");
}

function renderEvidence(filing: ValidatedAttribution): string {
  const excerpts = filing.excerpts
    .map(excerpt => `- \`${excerpt.file}\`:\n\n${indentAsCode(excerpt.text)}`)
    .join("\n\n");
  const references = filing.upstreamCommitRefs
    .map(reference => `- \`${reference}\``)
    .join("\n");
  const placeholders = filing.redactedPlaceholders
    .map(placeholder => `- \`${placeholder}\``)
    .join("\n");
  return [
    "## Evidence chain",
    "",
    `- Lisa surface: \`${filing.lisaSurface}\``,
    `- Failure class: \`${filing.failureClass}\``,
    "- Host-project issue: [OMITTED BY PUBLIC FILING POLICY]",
    "",
    "### Lisa-owned excerpts",
    "",
    excerpts,
    "",
    "### Public-origin commit references",
    "",
    references,
    "",
    "### Redacted reproduction placeholders",
    "",
    placeholders,
  ].join("\n");
}

function validateAttribution(input: unknown): ValidatedAttribution {
  assertRuntimeContract();
  const record = requirePlainRecord(input, "input");
  rejectUnknownFields(record, TOP_LEVEL_FIELDS, "input");
  rejectAccessors(record, "input");
  const documentKind = requireDocumentKind(readValue(record, "documentKind"));
  const occurrenceFingerprint = requireFingerprintPairing(
    readOptionalValue(record, "occurrenceFingerprint"),
    documentKind
  );
  const excerpts = requireExcerpts(readValue(record, "lisaOwnedExcerpts"));
  const aggregateBytes = excerpts.reduce(
    (total, excerpt) => total + Buffer.byteLength(excerpt.text, "utf8"),
    0
  );
  if (aggregateBytes > MAX_AGGREGATE_EXCERPT_BYTES) {
    reject("lisaOwnedExcerpts", "exceeds the aggregate byte limit");
  }
  return {
    documentKind,
    lisaSurface: requireLisaSurface(readValue(record, "lisaSurface")),
    failureClass: requireFailureClass(readValue(record, "failureClass")),
    excerpts,
    upstreamCommitRefs: requireCommitRefs(
      readValue(record, "upstreamCommitRefs")
    ),
    redactedPlaceholders: requirePlaceholders(
      readValue(record, "redactedPlaceholders")
    ),
    occurrenceFingerprint,
  };
}

function assertRuntimeContract(): void {
  if (
    Object.keys(UPSTREAM_EVIDENCE_MANIFEST).length === 0 ||
    Object.keys(UPSTREAM_SURFACE_MANIFEST).length === 0 ||
    Object.keys(UPSTREAM_PUBLIC_COMMITS).length === 0 ||
    !Object.isFrozen(UPSTREAM_EVIDENCE_MANIFEST) ||
    !Object.isFrozen(UPSTREAM_SURFACE_MANIFEST) ||
    !Object.isFrozen(UPSTREAM_PUBLIC_COMMITS)
  ) {
    throw new Error("Upstream evidence manifests are missing or mutable");
  }
  const packageBytes = readBoundedRegularFile(
    path.join(PACKAGE_ROOT, "package.json"),
    MAX_PACKAGE_JSON_BYTES,
    "package identity"
  );
  let packageJson: unknown;
  try {
    packageJson = JSON.parse(decodeUtf8(packageBytes, "package identity"));
  } catch {
    throw new Error("Invalid Lisa package identity");
  }
  if (
    packageJson === null ||
    typeof packageJson !== "object" ||
    isProxy(packageJson) ||
    Object.getPrototypeOf(packageJson) !== Object.prototype ||
    Object.getOwnPropertyDescriptor(packageJson, "name")?.value !==
      "@codyswann/lisa"
  ) {
    throw new Error("Invalid Lisa package identity");
  }
}

function requirePlainRecord(
  value: unknown,
  field: string
): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return reject(field, "must be a plain object");
  }
  if (isProxy(value)) {
    return reject(field, "proxies are not allowed");
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (Array.isArray(value) || prototype !== Object.prototype) {
    return reject(field, "must be a plain object");
  }
  return value as Record<string, unknown>;
}

function rejectUnknownFields(
  record: Record<string, unknown>,
  allowed: readonly string[],
  field: string
): void {
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string") {
      reject(field, "symbol fields are not allowlisted");
    }
    if (!allowed.includes(key)) {
      reject(key, "is not allowlisted");
    }
  }
}

function rejectAccessors(record: Record<string, unknown>, field: string): void {
  for (const key of Object.keys(Object.getOwnPropertyDescriptors(record))) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor !== undefined && !("value" in descriptor)) {
      reject(key || field, "accessors are not allowed");
    }
  }
}

function readValue(record: Record<string, unknown>, field: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  if (descriptor === undefined) {
    return reject(field, "is required");
  }
  if (!("value" in descriptor)) {
    return reject(field, "accessors are not allowed");
  }
  return descriptor.value as unknown;
}

function readOptionalValue(
  record: Record<string, unknown>,
  field: string
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  if (descriptor === undefined) {
    return undefined;
  }
  if (!("value" in descriptor)) {
    return reject(field, "accessors are not allowed");
  }
  return descriptor.value as unknown;
}

function requireDocumentKind(value: unknown): "issue" | "occurrence" {
  if (value !== "issue" && value !== "occurrence") {
    return reject("documentKind", 'must be "issue" or "occurrence"');
  }
  return value;
}

function requireLisaSurface(value: unknown): string {
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

function requireFailureClass(value: unknown): UpstreamFailureClass {
  const failureClass = requireAsciiString(value, "failureClass", 120);
  assertDynamicTextSafe(failureClass, "failureClass");
  if (!FAILURE_CLASS_SET.has(failureClass)) {
    return reject("failureClass", "is not in the closed failure taxonomy");
  }
  return failureClass as UpstreamFailureClass;
}

function requireExcerpts(
  value: unknown
): readonly UpstreamAttributionExcerpt[] {
  const entries = requireDenseArray(value, "lisaOwnedExcerpts", false);
  return entries.map((entry, index) => {
    const field = `lisaOwnedExcerpts[${index}]`;
    const record = requirePlainRecord(entry, field);
    rejectUnknownFields(record, EXCERPT_FIELDS, field);
    rejectAccessors(record, field);
    const file = requireManifestPath(readValue(record, "file"));
    const text = requireExcerptText(readValue(record, "text"));
    verifyExcerpt(file, text);
    return { file, text };
  });
}

function requireManifestPath(value: unknown): string {
  const member = requireAsciiString(value, "lisaOwnedExcerpts", 500);
  assertDynamicTextSafe(member, "lisaOwnedExcerpts");
  if (
    !isSafePackagePath(member) ||
    !Object.hasOwn(UPSTREAM_EVIDENCE_MANIFEST, member)
  ) {
    return reject(
      "lisaOwnedExcerpts",
      "file must be an exact public Lisa evidence manifest member"
    );
  }
  return member;
}

function requireExcerptText(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    return reject("lisaOwnedExcerpts", "text must be a non-empty string");
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > MAX_EXCERPT_BYTES) {
    return reject(
      "lisaOwnedExcerpts",
      "text exceeds the per-excerpt byte limit"
    );
  }
  if (Buffer.from(value, "utf8").toString("utf8") !== value) {
    return reject("lisaOwnedExcerpts", "text must be valid UTF-8");
  }
  assertTextControlsSafe(value, "lisaOwnedExcerpts");
  assertDynamicTextSafe(value, "lisaOwnedExcerpts");
  if (value.includes("[lisa-upstream-attribution")) {
    return reject(
      "lisaOwnedExcerpts",
      "text must not contain a reserved upstream attribution marker"
    );
  }
  return value;
}

function verifyExcerpt(file: string, excerpt: string): void {
  const absolutePath = path.join(PACKAGE_ROOT, file);
  if (realpathOrReject(absolutePath) !== absolutePath) {
    reject("lisaOwnedExcerpts", "file must not be a symlink");
  }
  const bytes = readBoundedRegularFile(
    absolutePath,
    MAX_SOURCE_BYTES,
    "lisaOwnedExcerpts"
  );
  const expectedHash = UPSTREAM_EVIDENCE_MANIFEST[file];
  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (expectedHash === undefined || actualHash !== expectedHash) {
    reject("lisaOwnedExcerpts", "file failed its manifest hash check");
  }
  const contents = decodeUtf8(bytes, "lisaOwnedExcerpts");
  assertTextControlsSafe(contents, "lisaOwnedExcerpts");
  if (!contents.includes(excerpt)) {
    reject(
      "lisaOwnedExcerpts",
      "text is not present verbatim in its Lisa file"
    );
  }
}

function requireCommitRefs(value: unknown): readonly string[] {
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

function requirePlaceholders(
  value: unknown
): readonly UpstreamRedactedPlaceholder[] {
  return requireDenseArray(value, "redactedPlaceholders", false).map(entry => {
    const placeholder = requireAsciiString(entry, "redactedPlaceholders", 64);
    assertDynamicTextSafe(placeholder, "redactedPlaceholders");
    if (!PLACEHOLDER_SET.has(placeholder)) {
      return reject("redactedPlaceholders", "is not in the fixed vocabulary");
    }
    return placeholder as UpstreamRedactedPlaceholder;
  });
}

function requireDenseArray(
  value: unknown,
  field: string,
  allowEmpty: boolean
): readonly unknown[] {
  if (value === null || typeof value !== "object") {
    return reject(field, "must be a plain array");
  }
  if (isProxy(value)) {
    return reject(field, "proxies are not allowed");
  }
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    return reject(field, "must be a plain array");
  }
  const length = requireArrayLength(value, field, allowEmpty);
  assertArrayProperties(value, length, field);
  return Array.from({ length }, (_unused, index) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (descriptor === undefined || !("value" in descriptor)) {
      return reject(field, "must be dense and accessor-free");
    }
    return descriptor.value as unknown;
  });
}

function requireArrayLength(
  value: readonly unknown[],
  field: string,
  allowEmpty: boolean
): number {
  const length = Object.getOwnPropertyDescriptor(value, "length")
    ?.value as unknown;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length > MAX_LIST_ITEMS ||
    (!allowEmpty && length === 0)
  ) {
    return reject(field, `must contain 1-${MAX_LIST_ITEMS} items`);
  }
  return length;
}

function assertArrayProperties(
  value: readonly unknown[],
  length: number,
  field: string
): void {
  const allowedIndices = new Set(
    Array.from({ length }, (_unused, index) => String(index))
  );
  for (const key of Reflect.ownKeys(value)) {
    if (
      typeof key !== "string" ||
      (key !== "length" && !allowedIndices.has(key))
    ) {
      reject(field, "must not contain non-index properties");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      reject(field, "must be dense and accessor-free");
    }
  }
}

function requireFingerprintPairing(
  value: unknown,
  documentKind: "issue" | "occurrence"
): string | undefined {
  if (documentKind === "issue") {
    return value === undefined
      ? undefined
      : reject("occurrenceFingerprint", "is valid only for occurrence events");
  }
  const fingerprint = requireAsciiString(value, "occurrenceFingerprint", 17);
  assertDynamicTextSafe(fingerprint, "occurrenceFingerprint");
  if (!FINGERPRINT_PATTERN.test(fingerprint)) {
    return reject(
      "occurrenceFingerprint",
      "must be sll4- plus exactly 12 lowercase hex characters"
    );
  }
  return `sll4-${createHash("sha256")
    .update(fingerprint, "utf8")
    .digest("hex")
    .slice(0, 12)}`;
}

function requireAsciiString(
  value: unknown,
  field: string,
  maxLength: number
): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.trim() !== value ||
    !Array.from(value).every(character => {
      const code = character.charCodeAt(0);
      return code >= 0x20 && code <= 0x7e;
    })
  ) {
    return reject(field, "must be bounded printable ASCII text");
  }
  return value;
}

function isSafePackagePath(value: string): boolean {
  return (
    PACKAGE_PATH_PATTERN.test(value) &&
    !value.includes("//") &&
    value.split("/").every(segment => segment !== "." && segment !== "..")
  );
}

function isSafeSurfacePath(value: string): boolean {
  return (
    SURFACE_PATH_PATTERN.test(value) &&
    value.split("/").every(segment => segment !== "." && segment !== "..")
  );
}

function realpathOrReject(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return reject(
      "lisaOwnedExcerpts",
      "file does not exist in this Lisa package"
    );
  }
}

function readBoundedRegularFile(
  filePath: string,
  maxBytes: number,
  field: string
): Buffer {
  const noFollow = constants.O_NOFOLLOW ?? 0;
  let descriptor: number;
  try {
    descriptor = openSync(
      filePath,
      constants.O_RDONLY | constants.O_NONBLOCK | noFollow
    );
  } catch {
    return reject(field, "must be a readable non-symlink file");
  }
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) {
      return reject(field, "must be a regular file");
    }
    if (before.size > maxBytes) {
      return reject(field, "exceeds its source byte limit");
    }
    const bytes = Buffer.alloc(before.size);
    const count = readFixedBytes(descriptor, bytes, 0);
    const after = fstatSync(descriptor);
    if (after.size !== before.size || count !== before.size) {
      return reject(field, "changed while being read");
    }
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function readFixedBytes(
  descriptor: number,
  buffer: Buffer,
  offset: number
): number {
  if (offset >= buffer.length) {
    return offset;
  }
  const count = readSync(
    descriptor,
    buffer,
    offset,
    buffer.length - offset,
    offset
  );
  return count === 0
    ? offset
    : readFixedBytes(descriptor, buffer, offset + count);
}

function decodeUtf8(bytes: Buffer, field: string): string {
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes)) {
    return reject(field, "must be valid UTF-8 text");
  }
  return decoded;
}

function assertTextControlsSafe(value: string, field: string): void {
  const unsafe = Array.from(value).some(character => {
    const code = character.codePointAt(0) ?? 0;
    const c0 = code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d;
    const c1 = code >= 0x7f && code <= 0x9f;
    const bidi =
      code === 0x061c ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    return c0 || c1 || bidi;
  });
  if (unsafe) {
    reject(
      field,
      "must not contain control or bidirectional override characters"
    );
  }
}

function indentAsCode(value: string): string {
  return value
    .split("\n")
    .map(line => `    ${line}`)
    .join("\n");
}

function assertPublicTextSafe(value: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_PUBLIC_BODY_BYTES) {
    reject("input", "projected document exceeds the public byte limit");
  }
  if (PUBLIC_BODY_DENY_LIST.some(pattern => pattern.test(value))) {
    reject("input", "projected document contains a denied secret or PII shape");
  }
}

function assertDynamicTextSafe(value: string, field: string): void {
  if (PUBLIC_BODY_DENY_LIST.some(pattern => pattern.test(value))) {
    reject(field, "contains a denied secret or PII shape");
  }
}

function reject(field: string, detail: string): never {
  throw new UpstreamAttributionRejection(field, detail);
}
/* eslint-enable max-lines, jsdoc/require-jsdoc, jsdoc/require-param-description, jsdoc/require-returns, functional/no-let, sonarjs/no-duplicate-string, code-organization/enforce-statement-order -- end cohesive security boundary */
