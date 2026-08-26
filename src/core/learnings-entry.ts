/** Strict validation for current and compatibility project-learning schemas. */
import {
  LEGACY_LEARNING_ENTRY_FIELDS,
  LEARNINGS_CONTRACT,
  LEARNING_CONFIDENCE_VALUES,
  MAX_STABLE_TOKEN_BYTES,
  type LearningConfidence,
  type LearningEntry,
} from "./learnings-contract.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
/** Field names accepted by either persisted contract version. */
type EntryField =
  | (typeof LEARNINGS_CONTRACT.fields)[number]
  | (typeof LEGACY_LEARNING_ENTRY_FIELDS)[number];
/** Candidate fields captured without inheriting from an ordinary object map. */
type EntryDescriptor = readonly [EntryField, PropertyDescriptor];
/** Exact descriptor sequence retained for one validated source version. */
type EntryDescriptors = readonly EntryDescriptor[];

/**
 * Validate an untrusted entry and return a normalized immutable copy.
 * @param candidate - Value to validate against the executable contract
 * @returns Validated learning entry
 */
export function validateLearningEntry(candidate: unknown): LearningEntry {
  const descriptors = requireEntryDescriptors(
    candidate,
    LEARNINGS_CONTRACT.fields
  );
  const value = (field: EntryField): unknown =>
    readDataProperty(descriptors, field);
  const id = requireStableId(value("id"));
  const fingerprint = requireFingerprint(value("fingerprint"));
  return buildLearningEntry(descriptors, id, fingerprint);
}

/**
 * Validate a v1 entry and normalize its accidental version token explicitly.
 *
 * v1 used `id` both as public identity and as the content fingerprint. The
 * compatibility reader preserves that fact as `fingerprint = id`; it never
 * invents a new token during a read.
 * @param candidate - Value parsed from a v1 learnings document
 * @returns Frozen current-schema entry carrying the legacy id as fingerprint
 */
export function validateLegacyLearningEntry(candidate: unknown): LearningEntry {
  const descriptors = requireEntryDescriptors(
    candidate,
    LEGACY_LEARNING_ENTRY_FIELDS
  );
  const id = requireStableId(readDataProperty(descriptors, "id"));
  return buildLearningEntry(descriptors, id, id);
}

/**
 * Validate the fields shared by both schema versions and build v2 shape.
 * @param descriptors - Exact accessor-free source field descriptors
 * @param id - Valid stable public identity
 * @param fingerprint - Valid stable content-version token
 * @returns Frozen normalized learning entry
 */
function buildLearningEntry(
  descriptors: EntryDescriptors,
  id: string,
  fingerprint: string
): LearningEntry {
  const value = (field: EntryField): unknown =>
    readDataProperty(descriptors, field);
  const rule = requireRule(value("rule"));
  const why = requireWhy(value("why"));
  const provenance = requireProvenance(value("provenance"));
  const firstLearned = requireIsoDate(value("first_learned"), "first_learned");
  const lastConfirmed = requireIsoDate(
    value("last_confirmed"),
    "last_confirmed"
  );
  const confidence = requireConfidence(value("confidence"));
  if (lastConfirmed < firstLearned) {
    throw new Error("Invalid dates: last_confirmed precedes first_learned");
  }
  return Object.freeze({
    id,
    fingerprint,
    rule,
    why,
    provenance: Object.freeze(provenance),
    first_learned: firstLearned,
    last_confirmed: lastConfirmed,
    confidence,
  });
}

/**
 * Require an object with exactly the selected version's accessor-free fields.
 * Inspect the candidate itself and retain descriptors in a prototype-free
 * tuple sequence: an ordinary descriptor-map object inherits Object.prototype,
 * so pollution under a missing field could impersonate a candidate descriptor.
 * @param candidate - Untrusted candidate object
 * @param fields - Exact field vocabulary for the source contract version
 * @returns Exact own-property descriptor sequence
 */
function requireEntryDescriptors(
  candidate: unknown,
  fields: readonly string[]
): EntryDescriptors {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    throw new Error("Invalid learning entry: expected an object");
  }
  const ownKeys = Reflect.ownKeys(candidate);
  if (ownKeys.some(key => typeof key !== "string")) {
    throw new Error(
      "Invalid learning entry fields: symbol keys are not allowed"
    );
  }
  if (
    ownKeys.length !== fields.length ||
    fields.some(field => !Object.hasOwn(candidate, field))
  ) {
    throw new Error(
      `Invalid learning entry fields: expected exactly ${fields.join(", ")}`
    );
  }
  return fields.map(field => {
    const descriptor = Object.getOwnPropertyDescriptor(candidate, field);
    if (descriptor === undefined) {
      throw new Error(
        `Invalid learning entry fields: expected exactly ${fields.join(", ")}`
      );
    }
    return [field as EntryField, descriptor] as const;
  });
}

/**
 * Read one exact-schema field without invoking an accessor.
 * @param descriptors - Candidate descriptor map
 * @param field - Required contract field
 * @returns Stored data value
 */
function readDataProperty(
  descriptors: EntryDescriptors,
  field: EntryField
): unknown {
  const descriptor = descriptors.find(([key]) => key === field)?.[1];
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new Error(`Invalid ${field}: accessors are not allowed`);
  }
  return descriptor.value as unknown;
}

/**
 * Require and bound a stable learning id.
 * @param value - Untrusted id value
 * @returns Valid stable id
 */
function requireStableId(value: unknown): string {
  const id = requireNonEmptyString(value, "id");
  assertStableTokenBudget(id, "id");
  if (!STABLE_ID.test(id)) {
    throw new Error(
      "Invalid learning id: use lowercase letters, numbers, dots, underscores, or hyphens"
    );
  }
  return id;
}

/**
 * Require a stable persisted content-version token.
 * @param value - Untrusted fingerprint value
 * @returns Valid stable fingerprint
 */
function requireFingerprint(value: unknown): string {
  const fingerprint = requireNonEmptyString(value, "fingerprint");
  assertStableTokenBudget(fingerprint, "fingerprint");
  if (!STABLE_ID.test(fingerprint)) {
    throw new Error(
      "Invalid learning fingerprint: use lowercase letters, numbers, dots, underscores, or hyphens"
    );
  }
  return fingerprint;
}

/**
 * Bound machine identity keys independently from prose and document capacity.
 * This limit is what makes every accepted v1 id safe to duplicate into a v2
 * fingerprint without opening an unbounded migration expansion.
 * @param value - Stable-token candidate
 * @param field - `id` or `fingerprint`
 */
function assertStableTokenBudget(value: string, field: string): void {
  if (Buffer.byteLength(value, "utf8") > MAX_STABLE_TOKEN_BYTES) {
    throw new Error(
      `${field} exceeds max stable token bytes ${MAX_STABLE_TOKEN_BYTES}`
    );
  }
}

/**
 * Require a rule within both hard character and line caps.
 * @param value - Untrusted rule value
 * @returns Valid bounded rule
 */
function requireRule(value: unknown): string {
  const rule = requireNonEmptyString(value, "rule");
  if (rule.length > LEARNINGS_CONTRACT.maxRuleCharacters) {
    throw new Error(
      `rule exceeds maxRuleCharacters ${LEARNINGS_CONTRACT.maxRuleCharacters}`
    );
  }
  const ruleLines = rule
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\u0085", "\n")
    .replaceAll("\u2028", "\n")
    .replaceAll("\u2029", "\n")
    .split("\n").length;
  if (ruleLines > LEARNINGS_CONTRACT.maxRuleLines) {
    throw new Error(
      `rule exceeds maxRuleLines ${LEARNINGS_CONTRACT.maxRuleLines}`
    );
  }
  return rule;
}

/**
 * Require bounded explanatory text.
 * @param value - Untrusted why value
 * @returns Valid bounded explanation
 */
function requireWhy(value: unknown): string {
  const why = requireNonBlankText(value, "why");
  assertUtf8Budget(why, "why");
  return why;
}

/**
 * Validate a dense, accessor-free provenance list with bounded allocation.
 * Exact own keys keep sparse holes from resolving through inherited numeric
 * properties and prevent expandos from carrying unvalidated caller data.
 * @param value - Untrusted provenance value
 * @returns Valid provenance references
 */
function requireProvenance(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid provenance: expected an array of references");
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    lengthDescriptor === undefined ||
    !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 1 ||
    lengthDescriptor.value > LEARNINGS_CONTRACT.maxProvenanceReferences
  ) {
    throw new Error(
      `Invalid provenance: expected 1-${LEARNINGS_CONTRACT.maxProvenanceReferences} references`
    );
  }
  const length = lengthDescriptor.value;
  const expectedKeys = new Set([
    "length",
    ...Array.from({ length }, (_unused, index) => String(index)),
  ]);
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== expectedKeys.size ||
    ownKeys.some(key => typeof key !== "string" || !expectedKeys.has(key))
  ) {
    throw new Error(
      "Invalid provenance array: expected dense own indexed values without extra or symbol fields"
    );
  }
  const provenance = Array.from({ length }, (_unused, index) =>
    requireProvenanceItem(value, index)
  );
  if (new Set(provenance).size !== provenance.length) {
    throw new Error("Invalid provenance: duplicate references are not allowed");
  }
  return provenance;
}

/**
 * Read and bound one accessor-free provenance element.
 * @param provenance - Provenance array already checked for exact own keys
 * @param index - Reference index
 * @returns Valid provenance reference
 */
function requireProvenanceItem(
  provenance: readonly unknown[],
  index: number
): string {
  const descriptor = Object.getOwnPropertyDescriptor(provenance, String(index));
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new Error(`Invalid provenance[${index}]: accessors are not allowed`);
  }
  const reference = requireNonEmptyString(
    descriptor.value,
    `provenance[${index}]`
  );
  assertUtf8Budget(reference, `provenance[${index}]`);
  return reference;
}

/**
 * Require one of the persisted confidence values.
 * @param value - Untrusted confidence value
 * @returns Valid confidence
 */
function requireConfidence(value: unknown): LearningConfidence {
  if (
    typeof value !== "string" ||
    !(LEARNING_CONFIDENCE_VALUES as readonly string[]).includes(value)
  ) {
    throw new Error(
      `Invalid confidence: expected ${LEARNING_CONFIDENCE_VALUES.join(" | ")}`
    );
  }
  return value as LearningConfidence;
}

/**
 * Require a trimmed, non-empty, control-character-free string.
 * @param value - Untrusted string value
 * @param field - Field name for errors
 * @returns Valid non-empty string
 */
function requireNonEmptyString(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    containsForbiddenTextControl(value)
  ) {
    throw new Error(`Invalid ${field}: expected a trimmed non-empty string`);
  }
  return value;
}

/**
 * Require non-blank text and normalize its outer whitespace.
 * @param value - Untrusted text value
 * @param field - Field name for errors
 * @returns Normalized non-blank text
 */
function requireNonBlankText(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    containsForbiddenTextControl(value)
  ) {
    throw new Error(`Invalid ${field}: expected non-blank text`);
  }
  return value.trim();
}

/**
 * Require a real calendar date in ISO date form. Exported so the surgical
 * `last_confirmed` writer can validate a caller-supplied date up front instead
 * of duplicating the calendar check.
 * @param value - Untrusted date value
 * @param field - Field name for errors
 * @returns Valid ISO date
 */
export function requireIsoDate(value: unknown, field: string): string {
  const result = requireNonEmptyString(value, field);
  const date = new Date(`${result}T00:00:00.000Z`);
  if (
    !ISO_DATE.test(result) ||
    Number.isNaN(date.valueOf()) ||
    date.toISOString().slice(0, 10) !== result
  ) {
    throw new Error(`Invalid ${field}: expected a real YYYY-MM-DD date`);
  }
  return result;
}

/**
 * Bound individual untrusted fields before document rendering allocates them.
 * @param value - Valid string value
 * @param field - Field name for errors
 */
function assertUtf8Budget(value: string, field: string): void {
  if (Buffer.byteLength(value, "utf8") > LEARNINGS_CONTRACT.maxTokens) {
    throw new Error(
      `${field} exceeds maxTokens ${LEARNINGS_CONTRACT.maxTokens}`
    );
  }
}

/**
 * Reject non-whitespace controls while allowing rule line separators.
 * @param value - Entry text
 * @returns True when a forbidden control is present
 */
function containsForbiddenTextControl(value: string): boolean {
  return Array.from(value).some(character => {
    const code = character.charCodeAt(0);
    return (
      code <= 8 ||
      code === 11 ||
      code === 12 ||
      (code >= 14 && code <= 31) ||
      code === 127
    );
  });
}
