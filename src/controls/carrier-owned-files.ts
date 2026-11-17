/**
 * The files `lisa controls install-carriers` places and may replace, and the
 * record that says which they are.
 *
 * The command places whole files in a repository it does not own: the gate
 * runner under `scripts/` and its own hook scripts. A later run has to tell
 * those from the repository's own files, so every path it wrote is listed in
 * `.lisa/controls/carriers.json`. The rule that follows is short. A file
 * that is missing is created. A file that is already byte for byte what
 * would be written is left alone. A file that differs is replaced only when
 * the record lists it. Anything else belongs to the repository, and the run
 * stops without writing a thing.
 *
 * The record holds nothing that differs between two checkouts of the same
 * commit, so it can be committed: the files, and what a new checkout needs.
 * @module controls/carrier-owned-files
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { pathKind } from "./audit-report-file.js";
import { canonicalize, compareCodeUnits } from "./canonical-json.js";
import { blockedFolder, fileEdit, fileState } from "./carrier-edits.js";
import {
  CARRIER_HOOKS_FOLDER,
  CARRIER_RECORD_PATH,
  CARRIER_SCHEMA_VERSION,
  INSTALL_CARRIERS_INVOCATION,
  type CarrierCloneSetup,
  type FileEdit,
  type PlacedFile,
} from "./carrier-types.js";

/** What every checkout needs beyond the committed files. */
export const EACH_CHECKOUT: CarrierCloneSetup = {
  check: `${INSTALL_CARRIERS_INVOCATION} --check`,
  command: INSTALL_CARRIERS_INVOCATION,
  why: `Git does not copy hook settings into a new clone. Where nothing else owns the hooks, the command sets core.hooksPath to ${CARRIER_HOOKS_FOLDER} in that checkout; until it has run there, git runs no carrier.`,
};

/**
 * The record's content for a set of files.
 * @param files - Every file the command placed, from the repository root
 * @returns The record, key-ordered, ending with a newline
 */
export function carrierRecordText(files: readonly string[]): string {
  const record = {
    each_checkout: { ...EACH_CHECKOUT, hooks_path: CARRIER_HOOKS_FOLDER },
    files: [...files].sort(compareCodeUnits),
    schema_version: CARRIER_SCHEMA_VERSION,
  };
  return `${JSON.stringify(canonicalize(record), null, 2)}\n`;
}

/** The files an earlier run recorded, or why the record cannot be used. */
export type RecordedFiles =
  | { readonly problem: null; readonly files: readonly string[] }
  | { readonly problem: string };

/**
 * Read which files an earlier run placed.
 * @param root - Real path of the repository
 * @returns The recorded paths; none when there is no record yet
 */
export async function readRecordedFiles(root: string): Promise<RecordedFiles> {
  const file = path.join(root, CARRIER_RECORD_PATH);
  const kind = await pathKind(file);
  if (kind === "missing") return { problem: null, files: [] };
  const unusable = `${CARRIER_RECORD_PATH} is not a record this command wrote, so it cannot tell which files are its own. Remove the file, then run this again.`;
  if (kind !== "file") return { problem: unusable };
  try {
    const record = JSON.parse(await readFile(file, "utf8")) as {
      readonly files?: unknown;
    } | null;
    const files = record?.files;
    return Array.isArray(files) &&
      files.every((item): item is string => typeof item === "string")
      ? { problem: null, files }
      : { problem: unusable };
  } catch {
    return { problem: unusable };
  }
}

/** The writes that place a set of files, or why none may be made. */
export type OwnedFilePlan =
  | { readonly problem: null; readonly edits: readonly FileEdit[] }
  | { readonly problem: string };

/** One file's write, that it needs none, or what is in its way. */
type OwnedFileStep =
  | { readonly inTheWay: null; readonly edit: FileEdit | null }
  | { readonly inTheWay: string };

/**
 * Decide what to do about one file.
 * @param root - Real path of the repository
 * @param file - The file as it should be
 * @param recorded - The paths an earlier run placed
 * @returns The write, or the path that is in the way
 */
async function ownedFileStep(
  root: string,
  file: PlacedFile,
  recorded: ReadonlySet<string>
): Promise<OwnedFileStep> {
  const folder = await blockedFolder(root, file.path);
  if (folder !== null) return { inTheWay: folder };
  const absolute = path.join(root, file.path);
  const state = await fileState(absolute);
  const edit = fileEdit({ ...file, absolute }, state);
  const ours = state.kind === "missing" || recorded.has(file.path);
  if (edit !== null && (!ours || state.kind === "other")) {
    return { inTheWay: file.path };
  }
  return { inTheWay: null, edit };
}

/**
 * Plan the writes that place a set of files, refusing to replace one the
 * command did not write.
 * @param root - Real path of the repository
 * @param files - The files as they should be
 * @param recorded - The paths an earlier run placed
 * @returns The writes, or one sentence naming what is in the way
 */
export async function planOwnedFiles(
  root: string,
  files: readonly PlacedFile[],
  recorded: readonly string[]
): Promise<OwnedFilePlan> {
  const known = new Set(recorded);
  const steps = await Promise.all(
    files.map(file => ownedFileStep(root, file, known))
  );
  const inTheWay = [
    ...new Set(
      steps.flatMap(step => (step.inTheWay === null ? [] : [step.inTheWay]))
    ),
  ];
  if (inTheWay.length > 0) {
    const many = inTheWay.length > 1;
    return {
      problem: `${inTheWay.join(", ")} ${many ? "are" : "is"} already in this repository and ${many ? "were" : "was"} not written by this command, so ${many ? "they were" : "it was"} left untouched and nothing was written. Move or remove ${many ? "them" : "it"}, then run this again.`,
    };
  }
  return {
    problem: null,
    edits: steps.flatMap(step =>
      step.inTheWay === null && step.edit !== null ? [step.edit] : []
    ),
  };
}
