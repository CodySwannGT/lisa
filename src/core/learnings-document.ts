/** Pure parsing and rendering for the canonical project-learnings document. */
import {
  LEARNINGS_CONTRACT,
  estimateLearningTokens,
  type LearningEntry,
} from "./learnings-contract.js";
import { validateLearningEntry } from "./learnings-entry.js";

const FILE_HEADER = `# Project Learnings

<!-- lisa-learnings-contract:v${LEARNINGS_CONTRACT.version} -->

`;
const JSON_FENCE_START = "```jsonl\n";
const JSON_FENCE_END = "\n```\n";
const CONFLICT_MARKER_PATTERN = /^(<<<<<<<|=======|>>>>>>>)(?: .*)?$/mu;

/**
 * Render the complete file in one stable, machine-readable Markdown form.
 * @param entries - Validated entries to serialize
 * @returns Canonical Markdown plus JSONL document
 */
export function renderLearningsFile(entries: readonly LearningEntry[]): string {
  const lines = entries.map(entry => JSON.stringify(entry)).join("\n");
  return `${FILE_HEADER}${JSON_FENCE_START}${lines}${JSON_FENCE_END}`;
}

/**
 * Parse and revalidate an existing file before it participates in a write.
 * @param content - Existing learnings document
 * @returns Revalidated entries from the document
 */
export function parseLearningsFile(content: string): LearningEntry[] {
  if (estimateLearningTokens(content) > LEARNINGS_CONTRACT.maxTokens) {
    throw new Error(
      `Project learnings payload exceeds maxTokens ${LEARNINGS_CONTRACT.maxTokens}`
    );
  }
  if (CONFLICT_MARKER_PATTERN.test(content)) {
    throw new Error(
      "Project learnings ledger corrupted by concurrent write: embedded conflict markers found; restore or recompact the ledger before writing"
    );
  }
  if (
    !content.startsWith(`${FILE_HEADER}${JSON_FENCE_START}`) ||
    !content.endsWith(JSON_FENCE_END)
  ) {
    throw new Error("Invalid project learnings file format");
  }
  const jsonStart = FILE_HEADER.length + JSON_FENCE_START.length;
  const jsonEnd = content.length - JSON_FENCE_END.length;
  const entries = parseJsonLines(content.slice(jsonStart, jsonEnd)).map(
    validateParsedLearningEntry
  );
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) {
    throw new Error("Invalid project learnings payload: duplicate ids");
  }
  assertDocumentBudget(content, entries.length, "Project learnings payload");
  return entries;
}

/**
 * Enforce the shared entry-count and model-agnostic token upper bounds.
 * @param content - Canonical document
 * @param entryCount - Number of entries in the document
 * @param context - Error-message prefix
 */
export function assertDocumentBudget(
  content: string,
  entryCount: number,
  context: string
): void {
  if (entryCount > LEARNINGS_CONTRACT.maxEntries) {
    throw new Error(
      `${context} exceeds maxEntries: measured ${entryCount}, allowed ${LEARNINGS_CONTRACT.maxEntries}`
    );
  }
  const estimatedTokens = estimateLearningTokens(content);
  if (estimatedTokens > LEARNINGS_CONTRACT.maxTokens) {
    throw new Error(
      `${context} exceeds maxTokens ${LEARNINGS_CONTRACT.maxTokens} (measured ${estimatedTokens})`
    );
  }
}

/**
 * Add a stable entry identifier to validation failures.
 * @param candidate - Parsed JSONL value
 * @param index - Zero-based JSONL entry index
 * @returns Validated learning entry
 */
function validateParsedLearningEntry(
  candidate: unknown,
  index: number
): LearningEntry {
  try {
    return validateLearningEntry(candidate);
  } catch (error) {
    const id = readDiagnosticEntryId(candidate);
    // Single-quote the id rather than JSON.stringify it: the message is later
    // rendered through a JSON-body escaper for terminal safety, which would
    // double-escape embedded double quotes into `\"id\"`. Single quotes read
    // cleanly and are not re-escaped, while control-character neutralization
    // still happens downstream.
    const label = id === undefined ? `entry ${index + 1}` : `entry '${id}'`;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid learning ${label}: ${detail}`);
  }
}

/**
 * Read a parsed entry id only when it is an inert own data property.
 * @param candidate - Parsed JSONL value
 * @returns Safe diagnostic id, when present
 */
function readDiagnosticEntryId(candidate: unknown): string | undefined {
  if (candidate === null || typeof candidate !== "object") {
    return undefined;
  }
  const descriptor = Object.getOwnPropertyDescriptor(candidate, "id");
  return descriptor !== undefined &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

/**
 * Parse the strict JSONL payload with a stable, user-facing error.
 * @param payload - JSONL payload
 * @returns Parsed unknown entry values
 */
function parseJsonLines(payload: string): unknown[] {
  if (payload === "") {
    return [];
  }
  try {
    return payload.split("\n").map(line => JSON.parse(line) as unknown);
  } catch {
    throw new Error("Invalid project learnings JSONL payload");
  }
}
