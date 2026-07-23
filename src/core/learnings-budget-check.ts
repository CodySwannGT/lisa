/**
 * Reusable core check for the canonical project-learnings document and its hard
 * budgets.
 *
 * Extracted from the package-facing `scripts/check-learnings-budget.ts` so the
 * identical bounded-read, token-budget, per-entry validation, and canonical
 * format checks can be shared by every caller — the existing package script and
 * the `lisa check-learnings-budget` CLI subcommand that ships the gate into host
 * projects' CI. Every hardening property of the original script is preserved
 * here: a bounded regular-file read, an `O_NONBLOCK` open with TOCTOU stat
 * checks, and terminal-escape-safe diagnostic text. The function never throws
 * for an expected condition — a missing file is a distinct result and every
 * other failure is a `violation` carrying a single-line, terminal-safe detail —
 * so each caller owns its own exit policy.
 * @module learnings-budget-check
 */
import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import {
  LEARNINGS_CONTRACT,
  estimateLearningTokens,
} from "./learnings-contract.js";
import {
  CONFLICT_MARKER_DIAGNOSIS,
  conflictMarkerError,
  findConflictMarkerInBytes,
  parseLearningsFile,
  renderLearningsFile,
} from "./learnings-document.js";
import { validateLearningEntry } from "./learnings-entry.js";

/** A learnings file that satisfies every hard budget. */
export interface LearningsBudgetOk {
  readonly kind: "ok";
  readonly entryCount: number;
  readonly maxEntries: number;
  readonly measuredTokens: number;
  readonly maxTokens: number;
}

/** No learnings file exists at the resolved path — an expected, silent case. */
export interface LearningsBudgetMissing {
  readonly kind: "missing";
  readonly detail: string;
}

/** The learnings file breached a budget or is otherwise unsafe or invalid. */
export interface LearningsBudgetViolation {
  readonly kind: "violation";
  readonly detail: string;
}

/** Structured outcome of one budget check. */
export type LearningsBudgetResult =
  | LearningsBudgetOk
  | LearningsBudgetMissing
  | LearningsBudgetViolation;

/**
 * Check one already-resolved absolute learnings path against the shared hard
 * budgets. Callers resolve the path (from config or an explicit argument) and
 * decide the exit policy from the returned discriminated union.
 * @param file - Absolute learnings file path
 * @returns Structured budget-check result
 */
export async function checkLearningsBudget(
  file: string
): Promise<LearningsBudgetResult> {
  try {
    const content = await readBoundedRegularFile(
      file,
      LEARNINGS_CONTRACT.maxTokens
    );
    const measuredTokens = estimateLearningTokens(content);
    if (measuredTokens > LEARNINGS_CONTRACT.maxTokens) {
      throw new Error(
        `maxTokens exceeded: measured ${measuredTokens}, allowed ${LEARNINGS_CONTRACT.maxTokens}`
      );
    }
    const entries = parseLearningsFile(content);
    for (const entry of entries) {
      validateLearningEntry(entry);
    }
    if (renderLearningsFile(entries) !== content) {
      throw new Error("non-canonical project learnings format");
    }
    return {
      kind: "ok",
      entryCount: entries.length,
      maxEntries: LEARNINGS_CONTRACT.maxEntries,
      measuredTokens,
      maxTokens: LEARNINGS_CONTRACT.maxTokens,
    };
  } catch (error) {
    const detail = formatErrorDetail(error);
    return isFileNotFound(error)
      ? { kind: "missing", detail }
      : { kind: "violation", detail: withRemediation(detail, file) };
  }
}

/**
 * Append a terse, actionable remediation clause to a file-level budget breach
 * so an operator reading CI output learns the fix, not just the number. Only
 * the whole-file budgets (token ceiling, entry count, canonical format) are
 * augmented; per-entry validation failures already name the offending entry
 * and are left verbatim, as are non-budget filesystem errors.
 * @param detail - Terminal-safe diagnostic detail
 * @param file - Absolute learnings file path
 * @returns The detail, with a remediation clause when one applies
 */
function withRemediation(detail: string, file: string): string {
  if (detail.startsWith("Invalid learning entry")) {
    return detail;
  }
  const target = formatDiagnosticPath(file);
  // Checked before the budget clauses: a conflicted merge duplicates the JSONL
  // block, so this failure often ALSO breaches a budget, and "shorten entries"
  // is the wrong instruction for it.
  if (detail.includes(CONFLICT_MARKER_DIAGNOSIS)) {
    return `${detail} — recompact ${target} from both conflicting versions, then register the union merge driver (\`lisa install-merge-driver\`) so concurrent learning branches merge instead of conflicting`;
  }
  if (detail.includes("maxEntries")) {
    return `${detail} — consolidate or remove entries in ${target} to fit the learnings budget`;
  }
  if (detail.includes("maxTokens")) {
    return `${detail} — shorten or remove entries in ${target} to fit the learnings budget`;
  }
  if (detail.includes("canonical") || detail.includes("format")) {
    return `${detail} — re-generate ${target} with the learnings writer to restore the canonical format`;
  }
  return detail;
}

/**
 * Whether a caught failure is a "file does not exist" filesystem error, which
 * callers treat as an expected, silent condition rather than a violation.
 * @param error - Unknown thrown failure
 * @returns True when the error reports an absent path
 */
function isFileNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    readOwnString(error, "code") === "ENOENT"
  );
}

/**
 * Render a caught failure without allowing filesystem paths or control bytes
 * embedded in an Error message to forge additional terminal/CI output.
 * @param error - Unknown thrown failure
 * @returns Stable, single-line diagnostic detail
 */
export function formatErrorDetail(error: unknown): string {
  if (error !== null && typeof error === "object") {
    const code = readOwnString(error, "code");
    if (code !== undefined && /^[A-Z][A-Z0-9_]*$/u.test(code)) {
      const syscall = readOwnString(error, "syscall");
      return syscall === undefined
        ? `filesystem error ${code}`
        : `filesystem error ${code} during ${escapeDiagnosticText(syscall)}`;
    }
  }
  const message = error instanceof Error ? error.message : String(error);
  return escapeDiagnosticText(message);
}

/**
 * Read one inert own string property without invoking an accessor.
 * @param candidate - Object to inspect
 * @param key - Property name to read
 * @returns The own string value, or undefined
 */
function readOwnString(candidate: object, key: string): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(candidate, key);
  return descriptor !== undefined &&
    "value" in descriptor &&
    typeof descriptor.value === "string"
    ? descriptor.value
    : undefined;
}

/**
 * Escape terminal controls while retaining ordinary diagnostic wording.
 * @param value - Raw diagnostic text
 * @returns Terminal-safe, single-line text
 */
function escapeDiagnosticText(value: string): string {
  const jsonBody = JSON.stringify(value).slice(1, -1);
  return Array.from(jsonBody)
    .map(character => {
      const code = character.charCodeAt(0);
      const isForbidden =
        (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
      return isForbidden
        ? `\\u${code.toString(16).padStart(4, "0")}`
        : character;
    })
    .join("");
}

/**
 * Quote one path after applying terminal-safe JSON-style escaping.
 * @param file - Path to render in diagnostics
 * @returns Quoted, terminal-safe path
 */
export function formatDiagnosticPath(file: string): string {
  return `"${escapeDiagnosticText(file)}"`;
}

/**
 * Read at most one byte beyond the hard budget from one verified regular-file
 * handle. Non-blocking open prevents a FIFO path from stalling the gate.
 * @param file - Absolute candidate learnings path
 * @param maximumBytes - Shared executable maxTokens byte ceiling
 * @returns Strictly decoded UTF-8 content within the byte ceiling
 */
async function readBoundedRegularFile(
  file: string,
  maximumBytes: number
): Promise<string> {
  const handle = await open(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      throw new Error("unsafe input: expected a regular file");
    }

    // Read the bounded prefix BEFORE judging size. A git-conflicted ledger is
    // roughly double size, so the size guard used to win this race and report
    // "shorten or remove entries" for a file whose problem is duplication —
    // advice that has an operator deleting good learnings. The read is capped
    // by the buffer either way, so an oversized file is still never slurped.
    const buffer = Buffer.allocUnsafe(maximumBytes + 1);
    const bytesRead = await fillBuffer(handle, buffer, 0);
    const conflictLine = findConflictMarkerInBytes(
      buffer.subarray(0, bytesRead)
    );
    if (conflictLine !== undefined) {
      throw conflictMarkerError(conflictLine);
    }
    if (before.size > BigInt(maximumBytes)) {
      throw new Error(
        `maxTokens exceeded: measured ${before.size}, allowed ${maximumBytes}`
      );
    }
    if (bytesRead > maximumBytes) {
      throw new Error(
        `maxTokens exceeded: measured at least ${bytesRead}, allowed ${maximumBytes}`
      );
    }

    const after = await handle.stat({ bigint: true });
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeNs !== before.mtimeNs ||
      after.ctimeNs !== before.ctimeNs
    ) {
      throw new Error("unsafe input: file changed during bounded read");
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(
      buffer.subarray(0, bytesRead)
    );
  } finally {
    await handle.close();
  }
}

/**
 * Fill a fixed buffer from a handle via bounded recursion, returning the total
 * bytes read. Recursion (rather than a mutable accumulator) keeps the module
 * within the repository's immutability lint rules while preserving the
 * original loop's "stop at EOF or buffer end" semantics; depth is bounded by
 * the small fixed buffer, which a learnings file fills in one or two reads.
 * @param handle - Verified regular-file handle
 * @param buffer - Destination buffer sized to the byte ceiling plus one
 * @param offset - Bytes already read into the buffer
 * @returns Total bytes read into the buffer
 */
async function fillBuffer(
  handle: FileHandle,
  buffer: Buffer,
  offset: number
): Promise<number> {
  if (offset >= buffer.length) {
    return offset;
  }
  const result = await handle.read(
    buffer,
    offset,
    buffer.length - offset,
    null
  );
  if (result.bytesRead === 0) {
    return offset;
  }
  return fillBuffer(handle, buffer, offset + result.bytesRead);
}
