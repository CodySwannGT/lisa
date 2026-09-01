/** Pure location rule for the learnings overflow sibling. */
import * as path from "node:path";

/** Suffix distinguishing the overflow from the ledger it belongs to. */
const OVERFLOW_SUFFIX = ".overflow";

/**
 * Derive the overflow path from a project's configured ledger path.
 *
 * This leaf has no package dependencies so source-only CI can resolve the
 * overflow without importing the writer, lock, or filesystem transaction
 * graph in a job that deliberately performs no dependency install.
 * @param learningsFile - Project-relative ledger path
 * @returns Project-relative overflow path
 */
export function resolveLearningsOverflowFile(learningsFile: string): string {
  const extension = path.posix.extname(learningsFile);
  const base = learningsFile.slice(0, learningsFile.length - extension.length);
  return `${base}${OVERFLOW_SUFFIX}${extension}`;
}
