/** Descriptor-based primitives for validating untrusted structured values. */
import { isProxy } from "node:util/types";

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MACHINE_ID = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/u;

/** Data-property descriptors keyed by a closed string vocabulary. */
export type StrictDescriptors<TField extends string> = Readonly<
  Record<TField, PropertyDescriptor>
>;

/**
 * Require an accessor-free plain object containing exactly the listed fields.
 * @param value - Untrusted candidate
 * @param fields - Exact allowed own-string fields
 * @param label - Operator-readable field label
 * @returns Data-property descriptors safe to read without invoking accessors
 */
export function requireStrictRecord<TField extends string>(
  value: unknown,
  fields: readonly TField[],
  label: string
): StrictDescriptors<TField> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value)
  ) {
    throw new Error(`Invalid ${label}: expected a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`Invalid ${label}: expected a plain object prototype`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor
  >;
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== fields.length ||
    keys.some(key => typeof key !== "string" || !fields.includes(key as TField))
  ) {
    throw new Error(
      `Invalid ${label} fields: expected exactly ${fields.join(", ")}`
    );
  }
  fields.forEach(field => {
    const descriptor = descriptors[field];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`Invalid ${label}.${field}: accessors are not allowed`);
    }
  });
  return descriptors as StrictDescriptors<TField>;
}

/**
 * Read a previously validated data-property descriptor.
 * @param descriptors - Strict descriptor record
 * @param field - Field to read
 * @returns Detached descriptor value
 */
export function readStrictProperty<TField extends string>(
  descriptors: StrictDescriptors<TField>,
  field: TField
): unknown {
  return descriptors[field].value as unknown;
}

/**
 * Require one string from a closed vocabulary.
 * @param value - Untrusted candidate
 * @param allowed - Closed string vocabulary
 * @param field - Operator-readable field label
 * @returns Validated vocabulary member
 */
export function requireClosedString<TValue extends string>(
  value: unknown,
  allowed: readonly TValue[],
  field: string
): TValue {
  if (typeof value !== "string" || !allowed.includes(value as TValue)) {
    throw new Error(`Invalid ${field}: expected ${allowed.join(" or ")}`);
  }
  return value as TValue;
}

/**
 * Require a stable, byte-bounded lowercase machine identifier.
 * @param value - Untrusted identifier candidate
 * @param field - Operator-readable field label
 * @param maximumBytes - Maximum UTF-8 byte length
 * @returns Validated identifier
 */
export function requireBoundedMachineId(
  value: unknown,
  field: string,
  maximumBytes: number
): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !MACHINE_ID.test(value) ||
    Buffer.byteLength(value, "utf8") > maximumBytes
  ) {
    throw new Error(`Invalid ${field}: expected a bounded machine identifier`);
  }
  return value;
}

/**
 * Require a canonical UTC timestamp with millisecond precision.
 * @param value - Untrusted timestamp candidate
 * @param field - Operator-readable field label
 * @returns Canonical timestamp
 */
export function requireCanonicalUtcTimestamp(
  value: unknown,
  field: string
): string {
  if (
    typeof value !== "string" ||
    !ISO_UTC.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(
      `Invalid ${field}: expected canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ`
    );
  }
  return value;
}

/**
 * Detect controls and bidirectional formatting characters in operator text.
 * @param value - Text candidate
 * @returns Whether unsafe operator-text characters are present
 */
export function hasUnsafeTextCharacter(value: string): boolean {
  return Array.from(value).some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    );
  });
}

/**
 * Read a dense, extra-free, accessor-free plain array without invoking values.
 * @param value - Untrusted candidate
 * @param minimum - Minimum accepted length
 * @param maximum - Maximum accepted length
 * @param label - Operator-readable field label
 * @returns Data-property values in index order
 */
export function readStrictDenseArray(
  value: unknown,
  minimum: number,
  maximum: number,
  label: string
): readonly unknown[] {
  if (isProxy(value) || !Array.isArray(value)) {
    throw new Error(`Invalid ${label}: expected ${minimum}-${maximum} entries`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error(`Invalid ${label}: expected a plain array prototype`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    string,
    PropertyDescriptor
  >;
  const length = descriptors.length?.value as unknown;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < minimum ||
    length > maximum
  ) {
    throw new Error(`Invalid ${label}: expected ${minimum}-${maximum} entries`);
  }
  const expectedKeys = [
    ...Array.from({ length }, (_unused, index) => String(index)),
    "length",
  ];
  const keys = Reflect.ownKeys(descriptors);
  if (
    keys.length !== expectedKeys.length ||
    keys.some(key => typeof key !== "string" || !expectedKeys.includes(key))
  ) {
    throw new Error(`Invalid ${label}: expected a dense extra-free array`);
  }
  return Array.from({ length }, (_unused, index) => {
    const descriptor = descriptors[String(index)];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new Error(`Invalid ${label}[${index}]: accessors are not allowed`);
    }
    return descriptor.value as unknown;
  });
}
