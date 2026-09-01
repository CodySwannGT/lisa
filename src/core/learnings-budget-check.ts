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
  PER_ENTRY_BYTE_ALLOWANCE,
  estimateLearningTokens,
} from "./learnings-contract.js";
import {
  CONFLICT_MARKER_DIAGNOSIS,
  conflictMarkerError,
  findConflictMarkerInBytes,
  parseLearningsDocument,
} from "./learnings-document.js";
import { validateLearningEntry } from "./learnings-entry.js";

/** A learnings file that satisfies every hard budget. */
export interface LearningsBudgetOk {
  readonly kind: "ok";
  readonly entryCount: number;
  readonly maxEntries: number;
  readonly measuredTokens: number;
  readonly maxTokens: number;
  /**
   * Operator-readable clause when the ledger is inside its budget but has no
   * room for a further learning, `undefined` when room remains.
   *
   * Deliberately a field on the SUCCESS result rather than a fourth result
   * kind. A new kind would have been silently mishandled by every consumer
   * whose branch order ends in "otherwise it passed" — the shipped
   * `check-learnings-budget` CLI subcommand is written exactly that way — so
   * adding one would have reproduced this defect in the consumers while
   * appearing to fix it in the core. Saturation is also genuinely NOT a
   * failure: see {@link describeLearningsSaturation}.
   */
  readonly saturation: string | undefined;
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

/** The learnings surface being judged, which owns its remediation language. */
export type LearningsBudgetSurface = "ledger" | "overflow";

/** Presentation policy for one budget check. Validation stays shared. */
export interface LearningsBudgetCheckOptions {
  /** Surface whose operator action should be named in diagnostics. */
  readonly surface?: LearningsBudgetSurface;
}

/**
 * Check one already-resolved absolute learnings path against the shared hard
 * budgets. Callers resolve the path (from config or an explicit argument) and
 * decide the exit policy from the returned discriminated union.
 * @param file - Absolute learnings file path
 * @param options - Surface-specific presentation policy
 * @returns Structured budget-check result
 */
export async function checkLearningsBudget(
  file: string,
  options: LearningsBudgetCheckOptions = {}
): Promise<LearningsBudgetResult> {
  const surface = options.surface ?? "ledger";
  try {
    const content = await readBoundedRegularFile(
      file,
      LEARNINGS_CONTRACT.maxTokens
    );
    const measuredTokens = estimateLearningTokens(content);
    const document = parseLearningsDocument(content);
    const entries = document.entries;
    for (const entry of entries) {
      validateLearningEntry(entry);
    }
    if (!document.canonicalSource) {
      throw new Error("non-canonical project learnings format");
    }
    return {
      kind: "ok",
      entryCount: entries.length,
      maxEntries: LEARNINGS_CONTRACT.maxEntries,
      measuredTokens,
      maxTokens: document.sourceMaxTokens,
      saturation: describeLearningsSaturation(
        entries.length,
        measuredTokens,
        document.sourceMaxTokens,
        surface
      ),
    };
  } catch (error) {
    const detail = formatErrorDetail(error);
    return isFileNotFound(error)
      ? { kind: "missing", detail }
      : {
          kind: "violation",
          detail: withRemediation(detail, file, surface),
        };
  }
}

/**
 * Describe a ledger that is inside its hard budget but has no room left for a
 * further learning, or `undefined` when room remains.
 *
 * ## Why saturation is a verdict at all
 *
 * Before this, the budget had exactly two states: `passed` up to the cap and
 * `exceeded` past it. This repository's own ledger sat at 20/20 entries and
 * 11924/12000 bytes and the check called it `passed`
 * (CodySwannGT/lisa#3089) — a control reporting health right up to the moment
 * it could no longer do its job. A gate that reads green at 100% gives an
 * operator no warning at all; the next agent to capture a learning is the one
 * who finds out, and the message they get tells them to shorten THEIR entry.
 *
 * The 20/20 `passed` was considered and rejected as the correct output. So was
 * the reflex fix of failing at the cap — see below — and so was raising the
 * cap, which silences the signal without doing the work the signal asks for and
 * puts the ledger back here with a higher ceiling.
 *
 * ## Why this is a warning and not a failure
 *
 * At exactly the cap nothing has overflowed yet: the document is valid, every
 * entry is serveable, and the projection works. Failing there converts a
 * working state into a red build.
 *
 * More importantly it fails the WRONG PERSON. The learnings ledger is a shared
 * document that fills up over weeks; the gate runs on every pull request. A
 * failure would stop whoever happens to be mid-change for a corpus their change
 * never touched, and retirement is not theirs to do — it is the gardener's
 * human-gated call (`/lisa:learnings:audit`). Blaming an unrelated change is
 * the CURRENT failure mode moved one step earlier, and it is the shape that
 * gets a guard disabled rather than obeyed. So saturation is loud in the output
 * and exit code 0.
 *
 * The hard caps still fail, unchanged. Nothing here weakens them.
 *
 * ## Why this boundary
 *
 * Not a percentage. Saturation is "the next capture does not fit", derived from
 * the same {@link PER_ENTRY_BYTE_ALLOWANCE} the byte budget itself is derived
 * from, so the warning band and the cap can no more contradict each other than
 * `maxTokens` and `maxEntries` can. A hand-picked 90% would drift the moment
 * either cap moved.
 *
 * Two independent ways to run out, because a ledger can hit either first:
 * every slot taken, or fewer than one average entry's bytes remaining.
 *
 * ## What happens if the warning is ignored
 *
 * Nothing is lost — the writer's overflow path (`learnings-overflow`) preserves
 * a rejected capture in a tracked `.overflow.md` beside the ledger and files a
 * `[lisa-ledger-saturated]` signal, so content survives a full ledger. That
 * path is reactive by construction: it runs only once a write has already
 * failed. This verdict is the same fact, said before anyone pays for it.
 * @param entryCount - Entries the document holds
 * @param measuredTokens - Measured document size under the contract's measure
 * @param maxTokens - Source-version byte ceiling used for saturation
 * @param surface - Learnings surface whose operator action should be named
 * @returns Single-line saturation clause, or undefined when room remains
 */
export function describeLearningsSaturation(
  entryCount: number,
  measuredTokens: number,
  maxTokens: number = LEARNINGS_CONTRACT.maxTokens,
  surface: LearningsBudgetSurface = "ledger"
): string | undefined {
  const averageEntryAllowance =
    maxTokens === LEARNINGS_CONTRACT.maxTokens
      ? PER_ENTRY_BYTE_ALLOWANCE
      : Math.floor(maxTokens / LEARNINGS_CONTRACT.maxEntries);
  const entriesFull = entryCount >= LEARNINGS_CONTRACT.maxEntries;
  const bytesFull = measuredTokens + averageEntryAllowance > maxTokens;
  if (!entriesFull && !bytesFull) {
    return undefined;
  }
  const reason = entriesFull
    ? `every one of the ${LEARNINGS_CONTRACT.maxEntries} entry slots is taken`
    : `fewer than ${averageEntryAllowance} bytes remain, less than one average entry`;
  if (surface === "overflow") {
    return `${reason}, so the next dropped learning cannot be preserved here. Drain the overflow with the gardener (\`lisa learnings-overflow\`); never trim the buffer by hand or raise the cap`;
  }
  return `${reason}, so the next learning captured here will be rejected. Retire or promote an entry with the gardener (\`/lisa:learnings:audit\`); raising the cap is not the remedy`;
}

/**
 * Render the one operator-facing verdict line for a within-budget document.
 *
 * Shared by the package script and the shipped CLI subcommand so the two
 * cannot report the same ledger differently — they previously carried the same
 * template string twice, which is how one of them would have kept saying
 * `passed` for a full ledger after the other stopped.
 * @param file - Absolute learnings file path
 * @param result - Successful budget-check result
 * @param options - Surface-specific presentation policy
 * @returns Single-line, terminal-safe verdict
 */
export function formatBudgetVerdict(
  file: string,
  result: LearningsBudgetOk,
  options: LearningsBudgetCheckOptions = {}
): string {
  const surface = options.surface ?? "ledger";
  const label =
    surface === "overflow" ? "learnings overflow budget" : "learnings budget";
  const counts = `(${result.entryCount}/${result.maxEntries} entries, ${result.measuredTokens}/${result.maxTokens} maxTokens)`;
  return result.saturation === undefined
    ? `${formatDiagnosticPath(file)}: ${label} passed ${counts}`
    : `${formatDiagnosticPath(file)}: ${label} saturated ${counts} — ${result.saturation}`;
}

/**
 * Append a terse, actionable remediation clause to a file-level budget breach
 * so an operator reading CI output learns the fix, not just the number. Only
 * the whole-file budgets (token ceiling, entry count, canonical format) are
 * augmented; per-entry validation failures already name the offending entry
 * and are left verbatim, as are non-budget filesystem errors.
 * @param detail - Terminal-safe diagnostic detail
 * @param file - Absolute learnings file path
 * @param surface - Learnings surface whose remediation should be named
 * @returns The detail, with a remediation clause when one applies
 */
function withRemediation(
  detail: string,
  file: string,
  surface: LearningsBudgetSurface
): string {
  if (detail.startsWith("Invalid learning entry") && surface === "ledger") {
    return detail;
  }
  const target = formatDiagnosticPath(file);
  // Checked before the budget clauses: a conflicted merge duplicates the JSONL
  // block, so this failure often ALSO breaches a budget, and "shorten entries"
  // is the wrong instruction for it.
  if (detail.includes(CONFLICT_MARKER_DIAGNOSIS)) {
    const repair = `${detail} — recompact ${target} from both conflicting versions, then register the union merge driver (\`lisa install-merge-driver\`) so concurrent learning branches merge instead of conflicting`;
    return surface === "overflow"
      ? `${repair}; after repair, drain the overflow with the gardener (\`lisa learnings-overflow\`)`
      : repair;
  }
  if (surface === "overflow") {
    return withOverflowRemediation(detail, target);
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
 * Add overflow-specific recovery without changing the shared violation.
 * @param detail - Terminal-safe diagnostic detail
 * @param target - Terminal-safe overflow path
 * @returns Detail with the appropriate overflow recovery action
 */
function withOverflowRemediation(detail: string, target: string): string {
  if (detail.includes("maxEntries") || detail.includes("maxTokens")) {
    return `${detail} — drain entries from ${target} with the gardener (\`lisa learnings-overflow\`); never hand-edit or trim the overflow, and do not raise the cap`;
  }
  return `${detail} — restore ${target} through the learnings writer, then drain it with the gardener (\`lisa learnings-overflow\`); never hand-edit or trim the overflow`;
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
