/**
 * `lisa doctor`: can the registered learnings merge driver actually RUN here?
 *
 * Being registered is not the same as working (CodySwannGT/lisa#4640). Before
 * that fix, `lisa apply` registered `'<runtime>' '<entry>'` of whichever
 * checkout ran it, into `.git/config` — which every linked worktree shares.
 * When that checkout is removed, git reports a conflict on every learnings
 * merge and leaves the ledger as our side only, with NO conflict markers, so
 * staging it silently drops the other branch's learnings. The key is still
 * set, so a set-or-unset check reports it fine.
 *
 * This is the one merge-driver state doctor reports as `fail`: unlike an
 * unregistered driver, which degrades to a loud text merge, a dangling one
 * loses content without a marker to show for it.
 * @module cli/doctor-learnings-driver-command
 */
import { access } from "node:fs/promises";
import * as path from "node:path";

import { classifyLearningsDriverCommand } from "../core/learnings-merge-driver-command.js";
import { readLearningsMergeDriverRegistration } from "../core/learnings-merge-driver-install.js";
import { LEARNINGS_MERGE_DRIVER_NAME } from "../core/learnings-merge-driver.js";

/** A finding about the learnings driver's command. */
export interface LearningsDriverCommandFinding {
  readonly status: "warn" | "fail";
  readonly detail: string;
}

const KEY = `merge.${LEARNINGS_MERGE_DRIVER_NAME}.driver`;
const REMEDY =
  "Re-register it with `lisa install-merge-driver` (or any `lisa apply`) run here, which writes a command that resolves Lisa inside whichever worktree is merging.";

/**
 * Whether a path exists.
 * @param target - Path to test
 * @returns True when it exists
 */
async function exists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * Judge a pre-#4640 absolute-path command.
 * @param paths - Absolute paths the command names
 * @returns Fail when one is gone, otherwise warn
 */
async function judgeAbsolute(
  paths: readonly string[]
): Promise<LearningsDriverCommandFinding> {
  const present = await Promise.all(paths.map(exists));
  const missing = paths.filter((_, index) => !present[index]);
  if (missing.length > 0) {
    return {
      status: "fail",
      detail: `${KEY} runs ${missing.join(", ")}, which does not exist — every learnings merge in every worktree now reports a conflict and keeps only our side, with no conflict markers, so staging it silently drops the other branch's learnings. ${REMEDY}`,
    };
  }
  return {
    status: "warn",
    detail: `${KEY} names absolute paths into one checkout (${paths.join(", ")}). Every linked worktree shares this setting, so learnings merges everywhere break the day that checkout is removed. ${REMEDY}`,
  };
}

/**
 * Inspect the registered learnings driver command in this checkout.
 * @param targetPath - Project path to inspect
 * @returns A finding, or undefined when the command can run (or cannot be judged)
 */
export async function inspectLearningsDriverCommand(
  targetPath: string
): Promise<LearningsDriverCommandFinding | undefined> {
  const registration = await readLearningsMergeDriverRegistration(targetPath);
  if (registration === undefined) {
    return undefined;
  }
  const shape = classifyLearningsDriverCommand(registration.command);
  if (shape.kind === "absolute") {
    return judgeAbsolute(shape.paths);
  }
  if (
    shape.kind === "portable" &&
    !(await exists(path.resolve(registration.worktreeTop, shape.entry)))
  ) {
    return {
      status: "warn",
      detail: `${KEY} runs ${shape.entry} relative to this worktree, but it is not installed here — learnings merges in this worktree stop with conflict markers holding both sides instead of unioning. Install dependencies here (or build Lisa, in its own repository).`,
    };
  }
  return undefined;
}
