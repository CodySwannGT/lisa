/**
 * Hostile-input primitives for the public upstream-attribution projection.
 *
 * Every value the projection reads arrives from a host-project workflow and is
 * treated as untrusted: these guards accept only plain, dense, accessor-free
 * records and arrays, bounded printable text, and text free of control,
 * bidirectional-override, secret, and PII shapes. Each failure throws an
 * {@link UpstreamAttributionRejection} naming the field, never the value.
 * @module core/upstream-attribution-guards
 */
import { isProxy } from "node:util/types";

/** Most items any list field of a filing may carry. */
const MAX_LIST_ITEMS = 12;

/** Rejection detail for a getter/setter where a data property is required. */
const ACCESSORS_NOT_ALLOWED = "accessors are not allowed";

/** Largest public document the projection will emit. */
const MAX_PUBLIC_BODY_BYTES = 60_000;

/** Secret and PII shapes that must never reach a public filing. */
const PUBLIC_BODY_DENY_LIST = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_\w{20,}\b/,
  /\bxox[baprs]-[\w-]{10,}\b/,
  /\b(?:api[_-]?key|access[_-]?key|password|passwd|secret|token|credential)\s*=\s*[\w+./=-]{16,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
] as const;

/** A field-named, value-sanitized public projection rejection. */
export class UpstreamAttributionRejection extends Error {
  readonly field: string;

  /**
   * Name the rejected field without echoing its value.
   * @param field - Name of the rejected input field
   * @param detail - Value-free reason the field was rejected
   */
  constructor(field: string, detail: string) {
    super(`upstream-attribution: field "${field}": ${detail}`);
    this.name = "UpstreamAttributionRejection";
    this.field = field;
  }
}

/**
 * Throw the field-named rejection.
 * @param field - Name of the rejected input field
 * @param detail - Value-free reason the field was rejected
 * @throws {UpstreamAttributionRejection} Always
 */
export function reject(field: string, detail: string): never {
  throw new UpstreamAttributionRejection(field, detail);
}

/**
 * Require a plain, non-proxy object whose prototype is `Object.prototype`.
 * @param value - Untrusted value
 * @param field - Field name reported on rejection
 * @returns The value typed as a record
 */
export function requirePlainRecord(
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

/**
 * Reject any own key outside the allowlist, including symbol keys.
 * @param record - Plain record to inspect
 * @param allowed - Field names the record may carry
 * @param field - Field name reported for symbol keys
 */
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

/**
 * Reject getter/setter properties, which could answer differently per read.
 * @param record - Plain record to inspect
 * @param field - Field name reported for an empty key
 */
function rejectAccessors(record: Record<string, unknown>, field: string): void {
  for (const key of Object.keys(Object.getOwnPropertyDescriptors(record))) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    if (descriptor !== undefined && !("value" in descriptor)) {
      reject(key || field, ACCESSORS_NOT_ALLOWED);
    }
  }
}

/**
 * Require a plain record carrying only allowlisted, accessor-free fields.
 * @param value - Untrusted value
 * @param allowed - Field names the record may carry
 * @param field - Field name reported on rejection
 * @returns The validated record
 */
export function requireAllowlistedRecord(
  value: unknown,
  allowed: readonly string[],
  field: string
): Record<string, unknown> {
  const record = requirePlainRecord(value, field);
  rejectUnknownFields(record, allowed, field);
  rejectAccessors(record, field);
  return record;
}

/**
 * Read a required data property without invoking accessors.
 * @param record - Validated record
 * @param field - Field to read
 * @returns The stored value
 */
export function readValue(
  record: Record<string, unknown>,
  field: string
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  if (descriptor === undefined) {
    return reject(field, "is required");
  }
  if (!("value" in descriptor)) {
    return reject(field, ACCESSORS_NOT_ALLOWED);
  }
  return descriptor.value as unknown;
}

/**
 * Read an optional data property without invoking accessors.
 * @param record - Validated record
 * @param field - Field to read
 * @returns The stored value, or undefined when the field is absent
 */
export function readOptionalValue(
  record: Record<string, unknown>,
  field: string
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, field);
  if (descriptor === undefined) {
    return undefined;
  }
  if (!("value" in descriptor)) {
    return reject(field, ACCESSORS_NOT_ALLOWED);
  }
  return descriptor.value as unknown;
}

/**
 * Require a plain, dense, accessor-free, bounded array and copy its items.
 * @param value - Untrusted value
 * @param field - Field name reported on rejection
 * @param allowEmpty - Whether a zero-length array is acceptable
 * @returns The array's items, read through their descriptors
 */
export function requireDenseArray(
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

/**
 * Read an array's own `length` and require it within the list bound.
 * @param value - Plain array
 * @param field - Field name reported on rejection
 * @param allowEmpty - Whether a zero-length array is acceptable
 * @returns The validated length
 */
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

/**
 * Reject non-index properties and accessor-backed items on an array.
 * @param value - Plain array
 * @param length - Validated length
 * @param field - Field name reported on rejection
 */
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

/**
 * Require bounded, trimmed, printable ASCII text.
 * @param value - Untrusted value
 * @param field - Field name reported on rejection
 * @param maxLength - Longest accepted string
 * @returns The validated string
 */
export function requireAsciiString(
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

/**
 * Decode bytes as UTF-8, rejecting any sequence that does not round-trip.
 * @param bytes - Raw file bytes
 * @param field - Field name reported on rejection
 * @returns The decoded text
 */
export function decodeUtf8(bytes: Buffer, field: string): string {
  const decoded = bytes.toString("utf8");
  if (!Buffer.from(decoded, "utf8").equals(bytes)) {
    return reject(field, "must be valid UTF-8 text");
  }
  return decoded;
}

/**
 * Reject C0/C1 controls (other than tab and newlines) and bidi overrides.
 * @param value - Text to inspect
 * @param field - Field name reported on rejection
 */
export function assertTextControlsSafe(value: string, field: string): void {
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

/**
 * Reject a projected document that is too large or carries a denied shape.
 * @param value - Projected public Markdown
 */
export function assertPublicTextSafe(value: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_PUBLIC_BODY_BYTES) {
    reject("input", "projected document exceeds the public byte limit");
  }
  if (PUBLIC_BODY_DENY_LIST.some(pattern => pattern.test(value))) {
    reject("input", "projected document contains a denied secret or PII shape");
  }
}

/**
 * Reject one dynamic field value that carries a denied secret or PII shape.
 * @param value - Field text to inspect
 * @param field - Field name reported on rejection
 */
export function assertDynamicTextSafe(value: string, field: string): void {
  if (PUBLIC_BODY_DENY_LIST.some(pattern => pattern.test(value))) {
    reject(field, "contains a denied secret or PII shape");
  }
}
