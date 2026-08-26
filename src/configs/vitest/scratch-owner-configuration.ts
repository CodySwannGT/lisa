/** Validated suite attribution and bounded prefix registry for scratch owners. */
import { env } from "node:process";

import {
  SCRATCH_PREFIXES_ENV,
  SCRATCH_SUITE_ENV,
} from "./scratch-route-profile.js";

/** Maximum number of registered prefixes accepted from configuration. */
const MAX_REGISTERED_PREFIXES = 64;

/** Maximum bytes in one registered prefix or suite label. */
const MAX_LABEL_BYTES = 128;

/**
 * Parse registry JSON while preserving the public diagnostic.
 * @param raw - Serialized prefix registry
 * @returns Decoded unvalidated value
 */
function parsePrefixRegistry(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${SCRATCH_PREFIXES_ENV} must be a JSON array of prefixes`);
  }
}

/**
 * Read and validate the bounded pre-collection prefix registry.
 * @returns Sorted unique direct-child prefixes
 */
export function registeredScratchPrefixes(): readonly string[] {
  const raw = env[SCRATCH_PREFIXES_ENV];
  if (raw === undefined || raw === "") return [];
  const parsed = parsePrefixRegistry(raw);
  if (!Array.isArray(parsed) || parsed.length > MAX_REGISTERED_PREFIXES) {
    throw new Error(
      `${SCRATCH_PREFIXES_ENV} must contain at most ${String(MAX_REGISTERED_PREFIXES)} prefixes`
    );
  }
  const prefixes = parsed.map(value => {
    if (
      typeof value !== "string" ||
      value === "" ||
      Buffer.byteLength(value, "utf8") > MAX_LABEL_BYTES ||
      value.includes("/") ||
      value.includes("\\") ||
      value === "." ||
      value === ".."
    ) {
      throw new Error(`${SCRATCH_PREFIXES_ENV} contains an invalid prefix`);
    }
    return value;
  });
  return [...new Set(prefixes)].sort((left, right) =>
    left.localeCompare(right)
  );
}

/**
 * Whether a label contains a control code unsafe for diagnostics.
 * @param label - Candidate diagnostic label
 * @returns True when the label contains a control code
 */
function containsControlCode(label: string): boolean {
  return [...label].some(character => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || codePoint === 0x7f;
  });
}

/**
 * Read the opaque bounded suite label used for diagnostics and ownership.
 * @returns Valid suite label
 */
export function scratchSuiteLabel(): string {
  const label = env[SCRATCH_SUITE_ENV] ?? "vitest";
  if (
    label === "" ||
    Buffer.byteLength(label, "utf8") > MAX_LABEL_BYTES ||
    containsControlCode(label)
  ) {
    throw new Error(`${SCRATCH_SUITE_ENV} contains an invalid suite label`);
  }
  return label;
}
