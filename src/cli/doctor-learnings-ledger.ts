/**
 * `lisa doctor` check: is there exactly ONE project-learnings ledger?
 *
 * The ledger used to be scaffolded into `.claude/rules/`. Projects upgraded
 * across the move to the cold `.lisa/` path can end up with two files, and
 * nothing ever noticed: one fleet project kept capturing into the rules-tree
 * copy until a merge resolved it to empty and destroyed 19 entries, in silence.
 * The write path now refuses an eager-tree ledger outright; this check covers
 * the files that already exist, because a guard added today cannot un-strand
 * yesterday's captures.
 * @module cli/doctor-learnings-ledger
 */
import {
  findStrayLearningsLedgers,
  type StrayLearningsLedger,
} from "../core/learnings-stray-ledger.js";

/** Name of the ledger check as doctor reports it. */
export const LEARNINGS_LEDGER_CHECK_NAME = "Single learnings ledger?";

/** Shape of one doctor check result (structurally identical to doctor's). */
interface LedgerCheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/**
 * Describe one stray in a single operator-readable clause.
 * @param stray - Stray ledger found by the scan
 * @returns Path plus what is stranded in it
 */
function describeStray(stray: StrayLearningsLedger): string {
  if (stray.entryCount === undefined) {
    return `${stray.path} (unreadable format — entry count unknown)`;
  }
  const plural = stray.entryCount === 1 ? "entry" : "entries";
  return `${stray.path} (${stray.entryCount} ${plural})`;
}

/**
 * Report whether a project has a second learnings ledger outside its
 * configured path, with the repair steps spelled out.
 *
 * An empty stray warns: it is residue with nothing to lose, and failing on it
 * would redden every project that carries a leftover placeholder. A stray with
 * entries — or one whose entries cannot be counted — fails, because content is
 * stranded outside the ledger every Lisa flow reads and one bad merge deletes
 * it with no error.
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkLearningsLedger(
  targetPath: string
): Promise<LedgerCheckResult> {
  try {
    const { canonicalFile, strays } =
      await findStrayLearningsLedgers(targetPath);
    if (strays.length === 0) {
      return {
        name: LEARNINGS_LEDGER_CHECK_NAME,
        status: "ok",
        detail: `One ledger only (${canonicalFile})`,
      };
    }
    const atRisk = strays.some(stray => stray.entryCount !== 0);
    return {
      name: LEARNINGS_LEDGER_CHECK_NAME,
      status: atRisk ? "fail" : "warn",
      detail: `Found ${strays.length} learnings ledger(s) outside the configured path: ${strays
        .map(describeStray)
        .join(
          "; "
        )}. The canonical ledger is ${canonicalFile} — copy any entries worth keeping into it, then delete the stray file(s). A ledger inside an auto-loaded rules tree is also read raw into every agent session, which is what the cold ${canonicalFile} location exists to avoid.`,
    };
  } catch (error) {
    return {
      name: LEARNINGS_LEDGER_CHECK_NAME,
      status: "fail",
      detail: `Could not inspect learnings ledgers: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
