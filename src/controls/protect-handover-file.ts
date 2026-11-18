/**
 * Keeping the administrator handover file in step with what was found.
 *
 * The file is this command's own. It is written when a change is left for an
 * administrator, left alone when it already says exactly that, and removed
 * when nothing is left to hand over — a file that still asks for a change
 * that has been made would send someone to do it twice. It is the only path
 * the command ever writes in the repository.
 * @module controls/protect-handover-file
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { pathKind } from "./audit-report-file.js";
import {
  MERGE_PROTECTION_CHANGE_PATH,
  type HandoverOutcome,
} from "./protect-types.js";
import { redactCredentials } from "./secret-scan.js";

/** The folder the handover lives in, from the repository root. */
const HANDOVER_FOLDER = path.posix.dirname(MERGE_PROTECTION_CHANGE_PATH);

/** What became of the file, or the one-line reason nothing was done. */
export type HandoverSync =
  | { readonly problem: null; readonly handover: HandoverOutcome }
  | { readonly problem: string };

/**
 * Find anything on the way to the file that is not an ordinary folder.
 *
 * A link there could lead outside the repository, and this command writes
 * nowhere else.
 * @param root - Real path of the repository
 * @returns The one-line problem, or `null` when the way is clear
 */
async function folderProblem(root: string): Promise<string | null> {
  const folders = HANDOVER_FOLDER.split("/").map((_, index, segments) =>
    segments.slice(0, index + 1).join("/")
  );
  const kinds = await Promise.all(
    folders.map(folder => pathKind(path.join(root, folder)))
  );
  const blocked = folders.find(
    (_, index) => kinds[index] !== "missing" && kinds[index] !== "folder"
  );
  return blocked === undefined
    ? null
    : `${blocked} is not an ordinary folder (it may be a link), so nothing in it was read or written. Replace it with an ordinary folder.`;
}

/**
 * Write, keep or remove the handover file.
 * @param root - Real path of the repository
 * @param text - The content the file should have, or `null` for no file
 * @returns What became of the file, or why nothing was done
 */
export async function syncHandover(
  root: string,
  text: string | null
): Promise<HandoverSync> {
  const blocked = await folderProblem(root);
  if (blocked !== null) return { problem: blocked };
  const file = path.join(root, MERGE_PROTECTION_CHANGE_PATH);
  const kind = await pathKind(file);
  if (kind !== "missing" && kind !== "file") {
    return {
      problem: `${MERGE_PROTECTION_CHANGE_PATH} is not an ordinary file (it may be a link), so it was not touched. Remove it, then run this again.`,
    };
  }
  const done = (action: HandoverOutcome["action"]): HandoverSync => ({
    problem: null,
    handover: { path: MERGE_PROTECTION_CHANGE_PATH, action },
  });
  if (text === null) {
    if (kind === "missing") return done("none");
    await rm(file);
    return done("removed");
  }
  // The file is committed and sent to an administrator, and part of what it
  // says was read from outside: the remote address, the branch, the names
  // the hosting platform gave its checks. Anything shaped like a credential
  // is taken out here, before the text is compared or written.
  const safe = redactCredentials(text).text;
  if (kind === "file" && (await readFile(file, "utf8")) === safe) {
    return done("unchanged");
  }
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, safe);
  return done("written");
}
