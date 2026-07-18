/**
 * Runtime-safe JSON normalization for live-status probe results.
 * @module cli/ui-status-json
 */
import type { JsonValue } from "../sync/json-path.js";

/** Transport budgets prevent status probes from monopolizing the UI process. */
const MAX_JSON_DEPTH = 64;
const MAX_JSON_NODES = 10_000;

/** Mutable traversal budget shared by one detached result tree. */
interface JsonBudget {
  nodesRemaining: number;
}

/** A probe result that never conflates missing evidence with a real value. */
export type ProbeResult<T extends JsonValue = JsonValue> =
  | {
      readonly state: "value";
      readonly value: T;
      readonly reason?: never;
      readonly message?: never;
    }
  | {
      readonly state: "unknown";
      readonly reason: string;
      readonly message: string;
      readonly value?: never;
    }
  | {
      readonly state: "not-applicable";
      readonly value?: never;
      readonly reason?: never;
      readonly message?: never;
    };

/**
 * Require enumerable data without invoking accessors.
 * @param descriptor - Candidate property descriptor
 * @param message - Error text for an unsafe descriptor
 * @returns The descriptor's inert data value
 */
function requireData(
  descriptor: PropertyDescriptor | undefined,
  message: string
): unknown {
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !("value" in descriptor)
  ) {
    throw new TypeError(message);
  }
  return descriptor.value;
}

/**
 * Clone one JSON array without invoking accessors or custom hooks.
 * @param value - Candidate array
 * @param ancestors - Active recursion path
 * @param depth - Current tree depth
 * @param budget - Remaining traversal budget
 * @returns Detached JSON array
 */
function cloneArray(
  value: readonly unknown[],
  ancestors: readonly object[],
  depth: number,
  budget: JsonBudget
): JsonValue[] {
  if (value.length > budget.nodesRemaining) {
    throw new TypeError("Probe value exceeds the JSON node limit");
  }
  const allowedKeys = new Set([
    "length",
    ...Array.from({ length: value.length }, (_entry, index) => String(index)),
  ]);
  if (
    Reflect.ownKeys(value).some(
      key => typeof key !== "string" || !allowedKeys.has(key)
    )
  ) {
    throw new TypeError("Probe arrays must contain only indexed JSON data");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Array.from({ length: value.length }, (_entry, index) =>
    cloneJsonValue(
      requireData(
        descriptors[String(index)],
        "Probe arrays cannot contain holes or accessors"
      ),
      ancestors,
      depth,
      budget
    )
  );
}

/**
 * Clone one plain JSON object without invoking accessors or custom hooks.
 * @param value - Candidate object
 * @param ancestors - Active recursion path
 * @param depth - Current tree depth
 * @param budget - Remaining traversal budget
 * @returns Detached JSON object
 */
function cloneObject(
  value: object,
  ancestors: readonly object[],
  depth: number,
  budget: JsonBudget
): { readonly [key: string]: JsonValue } {
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Probe objects must use a plain object prototype");
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries = Reflect.ownKeys(value).map(key => {
    if (typeof key !== "string") {
      throw new TypeError("Probe objects cannot contain symbol properties");
    }
    return [
      key,
      cloneJsonValue(
        requireData(
          descriptors[key],
          "Probe objects cannot contain hidden properties or accessors"
        ),
        ancestors,
        depth,
        budget
      ),
    ] as const;
  });
  return Object.fromEntries(entries) as { readonly [key: string]: JsonValue };
}

/**
 * Clone a scalar supported by JSON.
 * @param value - Candidate scalar
 * @returns Valid JSON scalar
 */
function cloneScalar(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value as JsonValue;
  }
  throw new TypeError("Probe scalar is not finite or is not JSON data");
}

/**
 * Clone runtime input into a detached JSON data tree.
 * @param value - Candidate value
 * @param ancestors - Active recursion path
 * @param depth - Current tree depth
 * @param budget - Remaining traversal budget
 * @returns Detached JSON data
 */
function cloneJsonValue(
  value: unknown,
  ancestors: readonly object[] = [],
  depth = 0,
  budget: JsonBudget = { nodesRemaining: MAX_JSON_NODES }
): JsonValue {
  if (depth > MAX_JSON_DEPTH) {
    throw new TypeError("Probe value exceeds the JSON depth limit");
  }
  if (budget.nodesRemaining <= 0) {
    throw new TypeError("Probe value exceeds the JSON node limit");
  }
  // eslint-disable-next-line functional/immutable-data -- one private counter bounds a single traversal
  budget.nodesRemaining -= 1;
  if (typeof value !== "object" || value === null) {
    return cloneScalar(value);
  }
  if (ancestors.includes(value)) {
    throw new TypeError("Probe value is cyclic");
  }
  const next = [...ancestors, value];
  return Array.isArray(value)
    ? cloneArray(value, next, depth + 1, budget)
    : cloneObject(value, next, depth + 1, budget);
}

/**
 * Validate an exact set of own keys on a detached object.
 * @param value - Detached object
 * @param expected - Required unique keys
 * @returns True when no key is missing or extra
 */
function hasExactKeys(
  value: { readonly [key: string]: JsonValue },
  expected: readonly string[]
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === expected.length &&
    expected.every(key => Object.hasOwn(value, key))
  );
}

/**
 * Convert a detached JSON tree back into the strict result union.
 * @param value - Detached JSON tree
 * @returns Strict tri-state result
 */
function parseResult<T extends JsonValue>(value: JsonValue): ProbeResult<T> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new TypeError("Probe result must be a plain object");
  }
  if (value.state === "value" && hasExactKeys(value, ["state", "value"])) {
    return { state: "value", value: value.value as T };
  }
  if (
    value.state === "unknown" &&
    hasExactKeys(value, ["message", "reason", "state"]) &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0 &&
    typeof value.message === "string" &&
    value.message.trim().length > 0
  ) {
    return { state: "unknown", reason: value.reason, message: value.message };
  }
  if (value.state === "not-applicable" && hasExactKeys(value, ["state"])) {
    return { state: "not-applicable" };
  }
  throw new TypeError("Probe result does not match the tri-state contract");
}

/**
 * Detach and validate an entire probe result before transport.
 * @param result - Runtime probe output
 * @returns Safe tri-state result, or unknown for unsafe runtime data
 */
export function normalizeProbeResult<T extends JsonValue>(
  result: ProbeResult<T>
): ProbeResult<T> {
  try {
    return parseResult<T>(cloneJsonValue(result));
  } catch (error) {
    return {
      state: "unknown",
      reason: "non-serializable-value",
      message:
        error instanceof Error
          ? `Probe returned unsafe JSON data: ${error.message}`
          : "Probe returned unreadable data",
    };
  }
}
