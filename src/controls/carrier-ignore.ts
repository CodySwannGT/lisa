/**
 * Keeping a push from leaving the repository changed.
 *
 * At the push moment the gate runner records how long each check took, in a
 * new file under `.lisa/push-timing/`. In a repository Lisa was applied to,
 * that folder is already ignored. In any other repository it is not, and
 * every push would leave an untracked file behind.
 *
 * So the command asks git whether the folder is ignored, and only when it is
 * not adds one entry to the repository's `.gitignore`, between its markers:
 * a committed, visible line that a person can read and take out again.
 * @module controls/carrier-ignore
 */
import path from "node:path";

import { fileEdit, fileState } from "./carrier-edits.js";
import type { CarrierGit } from "./carrier-git.js";
import { withMarkedBlock } from "./carrier-script.js";
import type { FileEdit } from "./carrier-types.js";

/** The folder the runner writes push timings to, as an ignore entry. */
export const PUSH_TIMING_IGNORE_ENTRY = ".lisa/push-timing/";

/** The file the entry is added to, from the repository root. */
const IGNORE_FILE = ".gitignore";

/** What the marked block in the ignore file is called. */
const BLOCK_NAME = "ignore";

/** The write that adds the entry, that none is needed, or why it failed. */
export type IgnorePlan =
  | { readonly problem: null; readonly edit: FileEdit | null }
  | { readonly problem: string };

/**
 * Plan the ignore entry for the runner's push timings.
 * @param root - Real path of the repository
 * @param git - Git
 * @returns The write, or `null` when git already ignores the folder
 */
export async function planIgnore(
  root: string,
  git: CarrierGit
): Promise<IgnorePlan> {
  if (await git.isIgnored(root, `${PUSH_TIMING_IGNORE_ENTRY}timing.json`)) {
    return { problem: null, edit: null };
  }
  const absolute = path.join(root, IGNORE_FILE);
  const state = await fileState(absolute);
  if (state.kind !== "missing" && state.kind !== "file") {
    return {
      problem: `${IGNORE_FILE} is not an ordinary file (it may be a link), so the entry that keeps a push from leaving files behind could not be added and nothing was written. Replace it with an ordinary file, then run this again.`,
    };
  }
  const written = withMarkedBlock(
    state.content?.toString("utf8") ?? "",
    BLOCK_NAME,
    [
      "# The checks that run before a push record how long they took here.",
      PUSH_TIMING_IGNORE_ENTRY,
    ]
  );
  return written.problem === null
    ? {
        problem: null,
        edit: fileEdit(
          {
            absolute,
            content: written.text,
            executable: false,
            path: IGNORE_FILE,
          },
          state
        ),
      }
    : {
        problem: `In ${IGNORE_FILE}, ${written.problem}, so the entry this command wrote there cannot be found and nothing was written. Remove what is left of it, then run this again.`,
      };
}
