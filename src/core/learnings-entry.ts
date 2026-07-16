/** Strict validation for the seven-field project learning schema. */
import {
  LEARNINGS_CONTRACT,
  LEARNING_CONFIDENCE_VALUES,
  type LearningConfidence,
  type LearningEntry,
} from "./learnings-contract.js";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const STABLE_ID = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
/** Field names in the executable seven-field contract. */
type EntryField = (typeof LEARNINGS_CONTRACT.fields)[number];

/**
 * Validate an untrusted entry and return a normalized immutable copy.
 * @param candidate - Value to validate against the executable contract
 * @returns Validated learning entry
 */
export function validateLearningEntry(candidate: unknown): LearningEntry {
  const descriptors = requireEntryDescriptors(candidate);
  const value = (field: EntryField): unknown =>
    readDataProperty(descriptors, field);
  const id = requireStableId(value("id"));
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
    rule,
    why,
    provenance: Object.freeze(provenance),
    first_learned: firstLearned,
    last_confirmed: lastConfirmed,
    confidence,
  });
}

/**
 * Require an object with exactly seven accessor-free own fields.
 * @param candidate - Untrusted candidate object
 * @returns Exact own-property descriptor map
 */
function requireEntryDescriptors(candidate: unknown): PropertyDescriptorMap {
  if (
    candidate === null ||
    typeof candidate !== "object" ||
    Array.isArray(candidate)
  ) {
    throw new Error("Invalid learning entry: expected an object");
  }
  const descriptors = Object.getOwnPropertyDescriptors(candidate);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.some(key => typeof key !== "string")) {
    throw new Error(
      "Invalid learning entry fields: symbol keys are not allowed"
    );
  }
  if (
    ownKeys.length !== LEARNINGS_CONTRACT.fields.length ||
    LEARNINGS_CONTRACT.fields.some(field => descriptors[field] === undefined)
  ) {
    throw new Error(
      `Invalid learning entry fields: expected exactly ${LEARNINGS_CONTRACT.fields.join(", ")}`
    );
  }
  return descriptors;
}

/**
 * Read one exact-schema field without invoking an accessor.
 * @param descriptors - Candidate descriptor map
 * @param field - Required contract field
 * @returns Stored data value
 */
function readDataProperty(
  descriptors: PropertyDescriptorMap,
  field: EntryField
): unknown {
  const descriptor = descriptors[field];
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
  assertUtf8Budget(id, "id");
  if (!STABLE_ID.test(id)) {
    throw new Error(
      "Invalid learning id: use lowercase letters, numbers, dots, underscores, or hyphens"
    );
  }
  return id;
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
 * @param value - Untrusted provenance value
 * @returns Valid provenance references
 */
function requireProvenance(value: unknown): readonly string[] {
  if (!Array.isArray(value)) {
    throw new Error("Invalid provenance: expected an array of references");
  }
  const descriptors = Object.getOwnPropertyDescriptors(
    value
  ) as unknown as PropertyDescriptorMap;
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 1 ||
    length > LEARNINGS_CONTRACT.maxProvenanceReferences
  ) {
    throw new Error(
      `Invalid provenance: expected 1-${LEARNINGS_CONTRACT.maxProvenanceReferences} references`
    );
  }
  const provenance = Array.from({ length }, (_unused, index) =>
    requireProvenanceItem(descriptors, index)
  );
  if (new Set(provenance).size !== provenance.length) {
    throw new Error("Invalid provenance: duplicate references are not allowed");
  }
  return provenance;
}

/**
 * Read and bound one accessor-free provenance element.
 * @param descriptors - Provenance array descriptors
 * @param index - Reference index
 * @returns Valid provenance reference
 */
function requireProvenanceItem(
  descriptors: PropertyDescriptorMap,
  index: number
): string {
  const descriptor = descriptors[String(index)];
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
 * Require a real calendar date in ISO date form.
 * @param value - Untrusted date value
 * @param field - Field name for errors
 * @returns Valid ISO date
 */
function requireIsoDate(value: unknown, field: string): string {
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
