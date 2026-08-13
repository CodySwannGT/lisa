/**
 * `lisa doctor` check: is the learnings union merge driver actually registered?
 *
 * A merge driver has two halves in two places. The `merge=lisa-learnings`
 * mapping is committed in `.gitattributes`; the driver COMMAND is machine-local,
 * because git refuses to run a command a repository supplied. So any clone that
 * never ran `lisa apply` — a fresh CI checkout, a teammate who cloned without
 * installing, a worktree created before the migration ran — silently falls back
 * to git's built-in text merge for the ledger.
 *
 * That degradation is far less catastrophic than it sounds: the text merge
 * leaves conflict markers, which the budget gate diagnoses, rather than
 * resolving the ledger to empty. What it is not is visible. Nothing tells an
 * operator that the union protecting the ledger is not registered here — and
 * invisibility is precisely what let one fleet project lose 19 captured
 * learnings. This check is the missing sentence.
 * @module cli/doctor-learnings-merge-driver
 */
import { isLearningsMergeDriverEnabled } from "../core/learnings-merge-driver-config.js";
import {
  isLearningsPathMappedToDriver,
  probeLearningsMergeDriverRegistration,
} from "../core/learnings-merge-driver-install.js";
import { LEARNINGS_MERGE_DRIVER_NAME } from "../core/learnings-merge-driver.js";
import {
  readProjectConfig,
  resolveProjectLearningsFile,
} from "../core/project-config.js";

/** Name of the merge-driver check as doctor reports it. */
export const LEARNINGS_MERGE_DRIVER_CHECK_NAME =
  "Learnings merge driver registered?";

/** Git config key holding the driver command. */
const DRIVER_KEY = `merge.${LEARNINGS_MERGE_DRIVER_NAME}.driver`;

/** Shape of one doctor check result (structurally identical to doctor's). */
interface MergeDriverCheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/**
 * Build one check result under this check's name.
 * @param status - Reported status
 * @param detail - Operator-readable explanation
 * @returns Doctor check result
 */
function result(status: "ok" | "warn", detail: string): MergeDriverCheckResult {
  return { name: LEARNINGS_MERGE_DRIVER_CHECK_NAME, status, detail };
}

/**
 * Report whether this checkout can actually run the ledger's union merge.
 *
 * Warn, never fail: an unregistered driver degrades to a merge that conflicts
 * loudly instead of one that loses content, so reddening a CI checkout over it
 * would trade a real signal for noise. The states that are genuinely fine — a
 * host that opted out, a directory that is not a git repository, a repository
 * with nothing mapped to the driver — report ok and say which one they are,
 * rather than sharing one indistinguishable "skipped".
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkLearningsMergeDriver(
  targetPath: string
): Promise<MergeDriverCheckResult> {
  try {
    if (!(await isLearningsMergeDriverEnabled(targetPath))) {
      return result(
        "ok",
        "Host opted out via learnings.mergeDriver: false; no driver expected"
      );
    }
    const registration =
      await probeLearningsMergeDriverRegistration(targetPath);
    if (registration === "not-a-repository") {
      return result(
        "ok",
        "Not a git repository, so merge-driver registration does not apply"
      );
    }
    if (registration === "git-unavailable") {
      return result(
        "warn",
        `git executable not found, so ${DRIVER_KEY} could not be verified — install git, then re-run \`lisa doctor\``
      );
    }
    const ledger = resolveProjectLearningsFile(
      await readProjectConfig(targetPath)
    );
    if (!(await isLearningsPathMappedToDriver(targetPath, ledger))) {
      return result(
        "ok",
        `Nothing maps ${ledger} to the ${LEARNINGS_MERGE_DRIVER_NAME} driver, so there is nothing to register (run \`lisa apply\` to ship the .gitattributes mapping)`
      );
    }
    if (registration === "registered") {
      return result("ok", `${DRIVER_KEY} is registered for ${ledger}`);
    }
    return result(
      "warn",
      `.gitattributes maps ${ledger} to the ${LEARNINGS_MERGE_DRIVER_NAME} merge driver, but ${DRIVER_KEY} is not registered in this checkout — git silently falls back to its built-in text merge, which leaves conflict markers in the ledger instead of unioning entries by id. Fix it with \`lisa install-merge-driver\` (or any \`lisa apply\`) run here. Hosts that do not want the driver set learnings.mergeDriver: false in .lisa.config.json.`
    );
  } catch (error) {
    return result(
      "warn",
      `Could not inspect the ${LEARNINGS_MERGE_DRIVER_NAME} merge driver: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
