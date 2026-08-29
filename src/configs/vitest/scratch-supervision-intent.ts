/** Exact IPC validation for immutable scratch run-root intents. */
import * as path from "node:path";

import type { ScratchRunRootIntentV1 } from "./scratch.js";
import type { ScratchPathIdentity } from "./scratch-owner.js";

/**
 * Whether an object has exactly the declared own string keys.
 * @param value - Candidate object
 * @param keys - Required exact keys
 * @returns Whether the keys match exactly
 */
function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[]
): boolean {
  const actual = Object.keys(value).sort((left, right) =>
    left.localeCompare(right)
  );
  const expected = [...keys].sort((left, right) => left.localeCompare(right));
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

/**
 * Whether a value contains an ASCII control code.
 * @param value - Candidate string
 * @returns Whether a control code is present
 */
function hasControlCode(value: string): boolean {
  return [...value].some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

/**
 * Whether one value is a bounded, control-free direct basename.
 * @param value - Candidate basename
 * @returns Whether the basename is inert and bounded
 */
function validBasename(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value !== "" &&
    value !== "." &&
    value !== ".." &&
    path.basename(value) === value &&
    !value.includes("/") &&
    !value.includes("\\") &&
    Buffer.byteLength(value, "utf8") <= 1_024 &&
    !hasControlCode(value)
  );
}

/**
 * Whether one namespace identity has exact bounded fields.
 * @param value - Candidate identity
 * @returns Whether the identity is exact and typed
 */
function validNamespaceIdentity(value: unknown): value is ScratchPathIdentity {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.hasOwn(candidate, "uid")
    ? ["canonicalPath", "dev", "ino", "uid"]
    : ["canonicalPath", "dev", "ino"];
  return (
    hasExactKeys(candidate, keys) &&
    typeof candidate["canonicalPath"] === "string" &&
    path.isAbsolute(candidate["canonicalPath"]) &&
    Number.isSafeInteger(candidate["dev"]) &&
    Number.isSafeInteger(candidate["ino"]) &&
    (!Object.hasOwn(candidate, "uid") || Number.isSafeInteger(candidate["uid"]))
  );
}

/**
 * Whether the scalar and collection fields of one root intent are valid.
 * @param intent - Candidate intent object
 * @param prefixes - Candidate prefix registry
 * @returns Whether every field is bounded and typed
 */
function validIntentFields(
  intent: Readonly<Record<string, unknown>>,
  prefixes: unknown
): boolean {
  return (
    Number.isSafeInteger(intent["pid"]) &&
    (intent["pid"] as number) > 0 &&
    typeof intent["processBirthFingerprint"] === "string" &&
    intent["processBirthFingerprint"] !== "" &&
    Buffer.byteLength(intent["processBirthFingerprint"], "utf8") <= 256 &&
    typeof intent["createdAt"] === "string" &&
    !Number.isNaN(Date.parse(intent["createdAt"])) &&
    typeof intent["token"] === "string" &&
    /^[a-f0-9]{32}$/u.test(intent["token"]) &&
    typeof intent["suiteLabel"] === "string" &&
    intent["suiteLabel"] !== "" &&
    Buffer.byteLength(intent["suiteLabel"], "utf8") <= 256 &&
    Array.isArray(prefixes) &&
    prefixes.length <= 64 &&
    prefixes.every(validBasename)
  );
}

/**
 * Validate an inert scratch-root intent received over IPC.
 * @param value - Candidate intent
 * @returns Schema-validated intent
 */
export function validateScratchRunRootIntent(
  value: unknown
): ScratchRunRootIntentV1 {
  if (typeof value !== "object" || value === null) {
    throw new Error("Scratch root intent must be an object");
  }
  const intent = value as Record<string, unknown>;
  const authority = intent["authority"] as Record<string, unknown> | undefined;
  const namespace = authority?.["namespace"];
  const validAuthority =
    authority !== undefined &&
    hasExactKeys(authority, ["baseCanonicalPath", "namespace"]) &&
    typeof authority["baseCanonicalPath"] === "string" &&
    validNamespaceIdentity(namespace);
  const validPath =
    validAuthority &&
    validBasename(intent["basename"]) &&
    typeof intent["rootPath"] === "string" &&
    intent["rootPath"] ===
      path.join(
        (namespace as ScratchPathIdentity).canonicalPath,
        intent["basename"]
      );
  if (
    intent["schema"] !== 1 ||
    !hasExactKeys(intent, [
      "schema",
      "authority",
      "basename",
      "rootPath",
      "pid",
      "processBirthFingerprint",
      "createdAt",
      "token",
      "suiteLabel",
      "registeredPrefixes",
    ]) ||
    !validPath ||
    !validIntentFields(intent, intent["registeredPrefixes"])
  ) {
    throw new Error("Invalid scratch root intent schema");
  }
  return value as ScratchRunRootIntentV1;
}
