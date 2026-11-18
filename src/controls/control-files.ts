/**
 * Reading and writing the files the attest step keeps under
 * `.lisa/controls/`, without ever following a link.
 *
 * The evidence file and the verdict are read back and trusted by other
 * commands, and written into a repository the operator named. A link in
 * place of the folder or of a file could make either one read from, or write
 * to, somewhere else on the machine. So every step on the way to a file must
 * be an ordinary folder and the file itself an ordinary file, and anything
 * else is reported and left alone.
 *
 * A file is written only when its content would change, so running the
 * attest step twice on the same inputs leaves the second run with nothing to
 * write.
 *
 * These files are committed, so {@link writeControlFile} is also the last
 * check that none of them holds a secret's value: content with something
 * shaped like a credential in it is refused, naming the file and the place
 * and never the value. Everything that reaches a file has been refused or
 * had its values taken out where it came in, so this only stops a way in
 * that nothing else covers. A step that writes a new file here gets the
 * check by writing it with this function.
 * @module controls/control-files
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { pathKind } from "./audit-report-file.js";
import { credentialProblemIn } from "./secret-scan-json.js";

/** What reading one of the files found. */
export type ControlFileRead =
  | { readonly kind: "text"; readonly text: string }
  /** No file is there. */
  | { readonly kind: "missing" }
  /** Something is in the way, and nothing was read. */
  | { readonly kind: "blocked"; readonly problem: string };

/** Whether a file was written, or why it was not. */
export type ControlFileWrite =
  | { readonly problem: null; readonly wrote: boolean }
  | { readonly problem: string };

/**
 * Find anything on the way to a file that is not an ordinary folder.
 * @param root - Real path of the repository
 * @param file - The file, from the repository root
 * @returns The one-line problem, or `null` when the way is clear
 */
async function folderProblem(
  root: string,
  file: string
): Promise<string | null> {
  const segments = path.posix.dirname(file).split("/");
  const folders = segments.map((_, index) =>
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
 * Read one of the attest step's files.
 * @param root - Real path of the repository
 * @param file - The file, from the repository root
 * @returns Its content, that it is missing, or what is in the way
 */
export async function readControlFile(
  root: string,
  file: string
): Promise<ControlFileRead> {
  const blocked = await folderProblem(root, file);
  if (blocked !== null) return { kind: "blocked", problem: blocked };
  const target = path.join(root, file);
  const kind = await pathKind(target);
  if (kind === "missing") return { kind: "missing" };
  return kind === "file"
    ? { kind: "text", text: await readFile(target, "utf8") }
    : {
        kind: "blocked",
        problem: `${file} is not an ordinary file (it may be a link), so it was not read.`,
      };
}

/**
 * Write one of the attest step's files, unless it already holds the content.
 * @param root - Real path of the repository
 * @param file - The file, from the repository root
 * @param text - The content to write
 * @returns Whether the file was written, or the one-line reason it was not
 */
export async function writeControlFile(
  root: string,
  file: string,
  text: string
): Promise<ControlFileWrite> {
  const read = await readControlFile(root, file);
  if (read.kind === "blocked") {
    return {
      problem: read.problem.replace(
        "so it was not read.",
        "so nothing was written to it. Remove it, then run this again."
      ),
    };
  }
  // The last check before a write: these files are committed, so one that
  // would hold something shaped like a credential is not written at all.
  const secret = credentialProblemIn(file, text);
  if (secret !== null) return { problem: secret };
  if (read.kind === "text" && read.text === text) {
    return { problem: null, wrote: false };
  }
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, text);
  return { problem: null, wrote: true };
}
