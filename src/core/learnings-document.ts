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

/**
 * Git's conflict markers, anchored to the start of a line.
 *
 * Seven characters is only the DEFAULT width. Git's `conflict-marker-size`
 * attribute is real and widens every marker, and a `.gitattributes` setting it
 * survives `lisa apply` because copy-contents preserves host lines outside the
 * managed block — so a fixed `{7}` quantifier silently stops recognizing
 * corruption in exactly the repositories that configured it. `{7,}` matches any
 * legal width. The trailing class also admits `\r` so a CRLF checkout's
 * `>>>>>>>\r` is still seen.
 *
 * Only the opener (`<<<<<<<`), the diff3 base separator (`|||||||`), and the
 * closer (`>>>>>>>`) are matched. A bare `=======` is deliberately NOT a signal
 * on its own: a row of equals signs is ordinary prose punctuation, so matching
 * it would make a legitimate document undiagnosable. Every real git conflict
 * emits an opener and a closer around it, so anchoring on those loses no
 * detection power while removing the ambiguity.
 */
const CONFLICT_MARKER = /^(?:<{7,}|\|{7,}|>{7,})(?:[ \t\r]|$)/u;

/**
 * Stable diagnosis prefix. Shared so the CI gate can recognize this specific
 * failure and attach merge-driver remediation without re-implementing the scan.
 */
export const CONFLICT_MARKER_DIAGNOSIS =
  "Project learnings file contains a git conflict marker";

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
  // Diagnose concurrent-write corruption BEFORE the byte budget. A conflicted
  // merge duplicates the whole JSONL block, so a nearly-full ledger lands over
  // budget and would otherwise report "exceeds maxTokens" — advice that sends
  // an operator off deleting good learnings when the real fix is recompaction.
  const conflictLine = findConflictMarkerLine(content);
  if (conflictLine !== undefined) {
    throw conflictMarkerError(conflictLine);
  }
  if (estimateLearningTokens(content) > LEARNINGS_CONTRACT.maxTokens) {
    throw new Error(
      `Project learnings payload exceeds maxTokens ${LEARNINGS_CONTRACT.maxTokens}`
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
 * Locate the first line git left a conflict marker on.
 *
 * The fs-level write lock cannot prevent this corruption: each learner pass
 * runs on its own `learning/<fingerprint>` branch in its own worktree, so a
 * path-scoped lock never sees the other writer and the collision surfaces at
 * merge time.
 *
 * Detection is exact because of the render contract: entries are serialized one
 * `JSON.stringify` object per line and that escapes every newline, so no stored
 * field value can ever begin a line. Every line of a canonical document starts
 * with `#`, `<!--`, a backtick fence, `{`, or is empty — so a line STARTING
 * with a seven-character git marker is unambiguously foreign to the format and
 * cannot be legitimate content.
 * @param content - Untrusted learnings document
 * @returns One-based line number of the first marker, or undefined when clean
 */
export function findConflictMarkerLine(content: string): number | undefined {
  const index = content
    .split("\n")
    .findIndex(line => CONFLICT_MARKER.test(line));
  return index === -1 ? undefined : index + 1;
}

/**
 * Build the one canonical conflict diagnosis every reader throws.
 *
 * Shared because the readers each apply a file-SIZE guard before handing bytes
 * to the parser, and a real conflicted ledger is roughly double size — so the
 * size guard would otherwise win the race and tell an operator to "shorten or
 * remove entries" on a file whose actual problem is duplication. Each reader
 * scans its bounded prefix and throws THIS error instead.
 * @param line - One-based line number of the first marker
 * @returns Error carrying the shared diagnosis and remediation
 */
export function conflictMarkerError(line: number): Error {
  return new Error(
    `${CONFLICT_MARKER_DIAGNOSIS} on line ${line}: the ledger was corrupted by concurrent writers merging separate learning branches. Recompact it by keeping every distinct entry id from both sides, then re-run.`
  );
}

/**
 * Scan a possibly-truncated UTF-8 prefix for a conflict marker.
 *
 * Decoded leniently on purpose: the buffer is cut at a fixed byte ceiling and
 * may split a multi-byte character, which a strict decoder would reject. A
 * replacement character cannot forge or hide a marker, since markers are ASCII
 * anchored at line start.
 * @param prefix - Bounded bytes read from the head of a candidate ledger
 * @returns One-based line number of the first marker, or undefined when clean
 */
export function findConflictMarkerInBytes(
  prefix: Uint8Array
): number | undefined {
  return findConflictMarkerLine(new TextDecoder("utf-8").decode(prefix));
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
