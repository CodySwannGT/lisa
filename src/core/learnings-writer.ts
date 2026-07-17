/** Deterministic persistence for project-local learnings. */
import * as fse from "fs-extra";
import { rename, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { type LearningEntry } from "./learnings-contract.js";
import {
  assertDocumentBudget,
  parseLearningsFile,
  renderLearningsFile,
} from "./learnings-document.js";
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

export {
  parseLearningsFile,
  renderLearningsFile,
} from "./learnings-document.js";
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
