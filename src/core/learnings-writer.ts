/** Deterministic persistence for project-local learnings. */
import * as fse from "fs-extra";
import { rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import {
  LEARNINGS_CONTRACT,
  estimateLearningTokens,
  type LearningEntry,
} from "./learnings-contract.js";
import { validateLearningEntry } from "./learnings-entry.js";
import {
  assertSafeLearningParents,
  readExistingLearnings,
  resolveSafeLearningTarget,
} from "./learnings-file-safety.js";
import { withLearningTargetLock } from "./learnings-lock.js";
import {
  readProjectConfig,
  resolveProjectLearningsFile,
} from "./project-config.js";

const FILE_HEADER = `# Project Learnings

<!-- lisa-learnings-contract:v${LEARNINGS_CONTRACT.version} -->

`;
const JSON_FENCE_START = "```jsonl\n";
const JSON_FENCE_END = "\n```\n";

/**
 * Persist one already-selected learning without generating or truncating it.
 * @param projectRoot - Absolute path to the host project root
 * @param candidate - Untrusted seven-field learning entry
 * @returns Absolute path to the persisted learnings file
 */
export async function persistLearningEntry(
  projectRoot: string,
  candidate: unknown
): Promise<string> {
  const entry = validateLearningEntry(candidate);
  const initialDocument = buildNextDocument([], entry);
  const config = await readProjectConfig(projectRoot);
  const relativeFile = resolveProjectLearningsFile(config);
  const { root, target } = resolveSafeLearningTarget(projectRoot, relativeFile);
  await assertSafeLearningParents(root, path.dirname(target));
  await fse.ensureDir(path.dirname(target));
  return withLearningTargetLock(target, async () => {
    await assertSafeLearningParents(root, path.dirname(target));
    const existing = await readExistingLearnings(target);
    const entries = existing === undefined ? [] : parseLearningsFile(existing);
    const rendered =
      existing === undefined
        ? initialDocument
        : buildNextDocument(entries, entry);
    const temporary = path.join(
      path.dirname(target),
      `.${path.basename(target)}.${process.pid}.${crypto.randomUUID()}.tmp`
    );
    try {
      await writeFile(temporary, rendered, { encoding: "utf8", flag: "wx" });
      await assertSafeLearningParents(root, path.dirname(target));
      await rename(temporary, target);
    } finally {
      await fse.remove(temporary);
    }
    return target;
  });
}

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
  if (
    !content.startsWith(`${FILE_HEADER}${JSON_FENCE_START}`) ||
    !content.endsWith(JSON_FENCE_END)
  ) {
    throw new Error("Invalid project learnings file format");
  }
  const jsonStart = FILE_HEADER.length + JSON_FENCE_START.length;
  const jsonEnd = content.length - JSON_FENCE_END.length;
  const entries = parseJsonLines(content.slice(jsonStart, jsonEnd)).map(
    validateLearningEntry
  );
  if (new Set(entries.map(entry => entry.id)).size !== entries.length) {
    throw new Error("Invalid project learnings payload: duplicate ids");
  }
  assertDocumentBudget(content, entries.length, "Project learnings payload");
  return entries;
}

export { validateLearningEntry } from "./learnings-entry.js";

/**
 * Build and budget-check the next canonical document.
 * @param entries - Existing validated entries
 * @param entry - New validated entry
 * @returns Next canonical document
 */
function buildNextDocument(
  entries: readonly LearningEntry[],
  entry: LearningEntry
): string {
  if (entries.some(current => current.id === entry.id)) {
    throw new Error(`Duplicate learning id: ${entry.id}`);
  }
  const nextEntries = [...entries, entry].sort((left, right) =>
    left.id.localeCompare(right.id)
  );
  const rendered = renderLearningsFile(nextEntries);
  assertDocumentBudget(rendered, nextEntries.length, "Learnings file");
  return rendered;
}

/**
 * Enforce the shared entry-count and model-agnostic token upper bounds.
 * @param content - Canonical document
 * @param entryCount - Number of entries in the document
 * @param context - Error-message prefix
 */
function assertDocumentBudget(
  content: string,
  entryCount: number,
  context: string
): void {
  if (entryCount > LEARNINGS_CONTRACT.maxEntries) {
    throw new Error(
      `${context} exceeds maxEntries ${LEARNINGS_CONTRACT.maxEntries}`
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
