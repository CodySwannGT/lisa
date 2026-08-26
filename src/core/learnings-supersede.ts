/**
 * @file learnings-supersede.ts
 * @description Plans exact stamped supersedes without mutating shared state
 * @module core/learnings-supersede
 */
import {
  LEARNINGS_CONTRACT,
  MAX_STABLE_TOKEN_BYTES,
  type LearningEntry,
} from "./learnings-contract.js";
import { validateLearningEntry } from "./learnings-entry.js";

const STABLE_TOKEN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const EXACT_STAMP_ERROR =
  "Invalid supersede stamp: expected exactly {id, fingerprint}";

/** Exact identity and content version a caller observed before consolidation. */
export interface LearningEntryStamp {
  /** Stable public identity expected in the locked ledger. */
  readonly id: string;
  /** Content fingerprint expected at that identity. */
  readonly fingerprint: string;
}

/** Why an observed supersede stamp no longer authorizes replacement. */
export type StaleSupersedeReason = "absent" | "fingerprint-mismatch";

/** One target whose locked state differs from the caller's snapshot. */
export interface StaleSupersedeTarget {
  /** Exact identity and fingerprint the caller observed. */
  readonly expected: LearningEntryStamp;
  /** Current fingerprint; absent when the identity no longer exists. */
  readonly actualFingerprint?: string;
  /** Whether the identity disappeared or now names different content. */
  readonly reason: StaleSupersedeReason;
}

/** Immutable plan produced from the state read inside the writer lock. */
export interface LearningSupersedePlan {
  /** Entry to append or replace, carrying the stable primary id when exact. */
  readonly entry: LearningEntry;
  /** Existing entries retained byte-for-byte. */
  readonly retained: readonly LearningEntry[];
  /** Exact targets removed together; empty on any stale target. */
  readonly removed: readonly LearningEntry[];
  /** Stale targets that forced a safe append instead of replacement. */
  readonly stale: readonly StaleSupersedeTarget[];
}

/**
 * Validate caller-supplied version stamps before any filesystem work.
 * @param stamps - Possibly untrusted supersede option
 * @returns Frozen, id-unique stamps in caller order
 */
export function validateLearningEntryStamps(
  stamps: readonly LearningEntryStamp[] | undefined
): readonly LearningEntryStamp[] {
  if (stamps === undefined) {
    return [];
  }
  if (!Array.isArray(stamps)) {
    throw new Error(
      "Invalid supersede option: expected learning {id, fingerprint} stamps"
    );
  }
  const validated = validateStampArray(stamps);
  if (new Set(validated.map(stamp => stamp.id)).size !== validated.length) {
    throw new Error("Invalid supersede option: duplicate stamped ids");
  }
  return Object.freeze(validated);
}

/**
 * Read a dense, expando-free supersede array entirely through own descriptors.
 * Native iteration methods invoke indexed getters and skip sparse holes, which
 * lets hostile containers change the target set while validation is running.
 * The ledger cap bounds descriptor traversal before any member is inspected.
 * @param stamps - Array already established by Array.isArray
 * @returns Frozen validated stamps in exact index order
 */
function validateStampArray(
  stamps: readonly LearningEntryStamp[]
): readonly LearningEntryStamp[] {
  const lengthDescriptor = Object.getOwnPropertyDescriptor(stamps, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new Error("Invalid supersede array: expected a dense array");
  }
  const length = lengthDescriptor.value;
  if (length > LEARNINGS_CONTRACT.maxEntries) {
    throw new Error(
      `Invalid supersede array exceeds maxEntries ${LEARNINGS_CONTRACT.maxEntries}`
    );
  }
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length }, (_unused, index) => String(index)),
  ]);
  const ownKeys = Reflect.ownKeys(stamps);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some(key => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    throw new Error(
      "Invalid supersede array: expected dense indexed values without extra or symbol fields"
    );
  }
  return Object.freeze(
    Array.from({ length }, (_unused, index) => {
      const descriptor = Object.getOwnPropertyDescriptor(stamps, String(index));
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new Error(
          "Invalid supersede array: indexed accessors are not allowed"
        );
      }
      return validateStamp(descriptor.value);
    })
  );
}

/**
 * Plan an all-or-nothing stamped replacement against locked current state.
 *
 * Fingerprint collision is checked first because it is the durable dedupe
 * boundary. An exact target set is removed together and the lexicographically
 * first target id becomes the stable primary. Any missing or changed target
 * makes the whole request a safe append: no target is removed and no alias is
 * claimed.
 * @param entries - Current validated entries read inside the lock
 * @param candidate - New validated content composed by the caller
 * @param expected - Validated version stamps from the caller's snapshot
 * @returns Deterministic append-or-replace plan
 */
export function planLearningSupersede(
  entries: readonly LearningEntry[],
  candidate: LearningEntry,
  expected: readonly LearningEntryStamp[]
): LearningSupersedePlan {
  const stale = expected.flatMap(stamp => staleTarget(entries, stamp));
  const targetIds = new Set(expected.map(stamp => stamp.id));
  const removed = sortLearningEntries(
    entries.filter(entry => targetIds.has(entry.id))
  );
  const primary = removed[0];
  const retained = entries.filter(entry => !targetIds.has(entry.id));
  if (entries.some(entry => entry.fingerprint === candidate.fingerprint)) {
    throw new Error(`Duplicate learning fingerprint: ${candidate.fingerprint}`);
  }
  if (stale.length > 0 || expected.length === 0) {
    if (entries.some(entry => entry.id === candidate.id)) {
      throw new Error(`Duplicate learning id: ${candidate.id}`);
    }
    return {
      entry: candidate,
      retained: entries,
      removed: [],
      stale,
    };
  }

  if (primary === undefined) {
    throw new Error("Invalid supersede plan: exact target set was empty");
  }
  return {
    entry: validateLearningEntry({ ...candidate, id: primary.id }),
    retained,
    removed,
    stale: [],
  };
}

/**
 * Validate one inert, exact two-field stamp.
 * @param candidate - Untrusted stamp value
 * @returns Frozen exact stamp
 */
function validateStamp(candidate: unknown): LearningEntryStamp {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    throw new Error(EXACT_STAMP_ERROR);
  }
  const keys = Reflect.ownKeys(candidate);
  if (
    keys.length !== 2 ||
    keys.some(
      key => typeof key !== "string" || (key !== "id" && key !== "fingerprint")
    ) ||
    !Object.hasOwn(candidate, "id") ||
    !Object.hasOwn(candidate, "fingerprint")
  ) {
    throw new Error(EXACT_STAMP_ERROR);
  }
  const idDescriptor = Object.getOwnPropertyDescriptor(candidate, "id");
  const fingerprintDescriptor = Object.getOwnPropertyDescriptor(
    candidate,
    "fingerprint"
  );
  if (idDescriptor === undefined || fingerprintDescriptor === undefined) {
    throw new Error(EXACT_STAMP_ERROR);
  }
  const id = readStampToken(idDescriptor, "id");
  const fingerprint = readStampToken(fingerprintDescriptor, "fingerprint");
  return Object.freeze({ id, fingerprint });
}

/**
 * Read one accessor-free stable token from a stamp descriptor.
 * @param descriptor - Own field descriptor
 * @param field - Stamp field being validated
 * @returns Validated stable token
 */
function readStampToken(
  descriptor: PropertyDescriptor,
  field: "id" | "fingerprint"
): string {
  if (!("value" in descriptor) || typeof descriptor.value !== "string") {
    throw new Error(`Invalid supersede stamp ${field}: expected a data string`);
  }
  const value = descriptor.value;
  if (Buffer.byteLength(value, "utf8") > MAX_STABLE_TOKEN_BYTES) {
    throw new Error(
      `Invalid supersede stamp ${field}: ${field} exceeds max stable token bytes ${MAX_STABLE_TOKEN_BYTES}`
    );
  }
  if (value.trim() !== value || !STABLE_TOKEN.test(value)) {
    throw new Error(
      `Invalid supersede stamp ${field}: expected a stable token`
    );
  }
  return value;
}

/**
 * Describe a target that no longer matches its exact stamp.
 * @param entries - Current entries inside the writer lock
 * @param expected - Caller-observed target stamp
 * @returns Empty for an exact match, otherwise one stale diagnosis
 */
function staleTarget(
  entries: readonly LearningEntry[],
  expected: LearningEntryStamp
): readonly StaleSupersedeTarget[] {
  const actual = entries.find(entry => entry.id === expected.id);
  if (actual === undefined) {
    return [{ expected, reason: "absent" }];
  }
  if (actual.fingerprint !== expected.fingerprint) {
    return [
      {
        expected,
        actualFingerprint: actual.fingerprint,
        reason: "fingerprint-mismatch",
      },
    ];
  }
  return [];
}

/**
 * Compare tokens for locale-independent primary selection.
 * @param left - First token
 * @param right - Second token
 * @returns Negative, zero, or positive ordering result
 */
function compareTokens(left: string, right: string): number {
  return left === right ? 0 : left < right ? -1 : 1;
}

/**
 * Sort entries by stable id without mutating shared state.
 * @param entries - Entries in arbitrary order
 * @returns New deterministically ordered array
 */
function sortLearningEntries(
  entries: readonly LearningEntry[]
): readonly LearningEntry[] {
  return entries.reduce<readonly LearningEntry[]>((ordered, entry) => {
    const insertion = ordered.findIndex(
      current => compareTokens(entry.id, current.id) < 0
    );
    return insertion === -1
      ? [...ordered, entry]
      : [...ordered.slice(0, insertion), entry, ...ordered.slice(insertion)];
  }, []);
}
