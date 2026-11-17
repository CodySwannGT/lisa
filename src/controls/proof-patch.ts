/**
 * Reading a proof's patch file, and planting the change it holds.
 *
 * A patch file is content somebody committed, so it is handled as untrusted
 * input twice over.
 *
 * Reading: the file must be an ordinary file under `.lisa/controls/proofs/`
 * in the repository, reached through ordinary folders. A link anywhere on
 * the way is not followed, because it could lead to any file on the machine.
 *
 * Planting: `git apply` does the work, in the folder it is given and nowhere
 * else. Git itself refuses a path that climbs out of that folder, a path
 * into `.git`, and a path that goes through a link, including a link the
 * same patch creates. It applies all of a patch or none of it, and exits
 * non-zero with its reason when it applies none. Three things are done here
 * so that those guarantees hold wherever this runs:
 *
 * - The variables git exports to its hooks are removed for this one start.
 *   They name the repository the operator is working in, and settings to
 *   apply there. The git this was written against kept to its own folder
 *   even with them set; removing them means that does not rest on one
 *   version's behaviour.
 * - Git is told not to look above the folder for a repository, so a folder
 *   that happens to sit inside one is still treated as the top.
 * - The machine's own git settings are left out, so the same patch applies
 *   the same way on every machine.
 *
 * The patch is handed over on standard input and never as a path, and it is
 * never applied with an option that loosens any of this.
 * @module controls/proof-patch
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { devNull } from "node:os";
import path from "node:path";

import { pathKind } from "./audit-report-file.js";
import type { PatchOutcome } from "./proof-types.js";

/** The folder every proof file lives in, from the repository root. */
export const PROOF_FOLDER = ".lisa/controls/proofs";

/**
 * The program that starts git with a changed environment.
 *
 * `env` is how a command is started with some variables removed and others
 * set, without this process reading its own environment to rebuild it. It is
 * named by its fixed place on Linux and macOS rather than looked up, and it
 * is `env` that then finds git on the operator's `PATH`, as a git hook does.
 */
const ENV_PROGRAM = "/usr/bin/env";

/** How long one `git apply` may take, in milliseconds. */
const APPLY_BUDGET_MS = 60_000;

/** The most of git's own words that are kept, in bytes. */
const APPLY_OUTPUT_BYTES = 1024 * 1024;

/** The most of git's reason that is quoted, in characters. */
const REASON_LIMIT = 600;

/**
 * The variables that point git at a repository other than the one in the
 * folder it is started in. This is the list `git rev-parse --local-env-vars`
 * prints.
 */
const REPOSITORY_VARIABLES = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_CONFIG",
  "GIT_CONFIG_COUNT",
  "GIT_CONFIG_PARAMETERS",
  "GIT_DIR",
  "GIT_GRAFT_FILE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_NAMESPACE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_OBJECT_DIRECTORY",
  "GIT_PREFIX",
  "GIT_REPLACE_REF_BASE",
  "GIT_SHALLOW_FILE",
  "GIT_WORK_TREE",
] as const;

/** A patch file's content, or why there is none to plant. */
export type ProofPatchRead =
  | { readonly kind: "text"; readonly text: string }
  /** No file is there: this half of the proof does not exist. */
  | { readonly kind: "missing" }
  /** Something is there and was not read. */
  | { readonly kind: "unreadable"; readonly problem: string };

/**
 * Tell whether a path names a file under the proofs folder, written the one
 * way the declaration accepts.
 * @param file - The path, from the repository root
 * @returns Whether it does
 */
function isProofPath(file: string): boolean {
  const segments = file.split("/");
  return (
    file.startsWith(`${PROOF_FOLDER}/`) &&
    segments.every(
      segment => segment !== "" && segment !== "." && segment !== ".."
    )
  );
}

/**
 * Read one of a proof's patch files from the repository.
 * @param root - Real path of the repository
 * @param file - The patch file, from the repository root
 * @returns Its content, that it is missing, or why it was not read
 */
export async function readProofPatch(
  root: string,
  file: string
): Promise<ProofPatchRead> {
  if (!isProofPath(file)) {
    return {
      kind: "unreadable",
      problem: `${JSON.stringify(file)} is not a file under ${PROOF_FOLDER}/, so it was not read. A proof file is a patch in that folder.`,
    };
  }
  const segments = file.split("/");
  const steps = segments.map((_, index) =>
    segments.slice(0, index + 1).join("/")
  );
  const kinds = await Promise.all(
    steps.map(step => pathKind(path.join(root, step)))
  );
  const folders = steps.slice(0, -1);
  const blocked = folders.find(
    (_, index) => kinds[index] !== "folder" && kinds[index] !== "missing"
  );
  if (blocked !== undefined) {
    return {
      kind: "unreadable",
      problem: `${blocked} is not an ordinary folder (it may be a link), so nothing in it was read. Replace it with an ordinary folder.`,
    };
  }
  const kind = kinds.at(-1);
  if (kinds.includes("missing")) return { kind: "missing" };
  return kind === "file"
    ? { kind: "text", text: await readFile(path.join(root, file), "utf8") }
    : {
        kind: "unreadable",
        problem: `${file} is not an ordinary file (it may be a link), so it was not read. Replace it with the patch file itself.`,
      };
}

/**
 * Put git's reason on one line, short enough to quote.
 * @param text - What git printed
 * @returns The reason
 */
function oneLine(text: string): string {
  const line = text.trim().replaceAll(/\s+/gu, " ");
  return line.length > REASON_LIMIT ? `${line.slice(0, REASON_LIMIT)}…` : line;
}

/**
 * Plant a patch in a folder, or take it back out.
 * @param directory - Real path of the folder to work in
 * @param patch - The content of the patch file
 * @param options - How to apply it
 * @param options.reverse - Take the change back out instead of planting it
 * @returns No problem when all of it was applied; otherwise git's reason,
 *   and nothing was changed
 */
export function applyProofPatch(
  directory: string,
  patch: string,
  options: { readonly reverse?: boolean } = {}
): PatchOutcome {
  const child = spawnSync(
    ENV_PROGRAM,
    [
      ...REPOSITORY_VARIABLES.flatMap(name => ["-u", name]),
      `GIT_CEILING_DIRECTORIES=${path.dirname(directory)}`,
      `GIT_CONFIG_GLOBAL=${devNull}`,
      "GIT_CONFIG_NOSYSTEM=1",
      "LC_ALL=C",
      "git",
      "apply",
      "--whitespace=nowarn",
      ...(options.reverse === true ? ["--reverse"] : []),
      "-",
    ],
    {
      cwd: directory,
      encoding: "utf8",
      input: patch,
      maxBuffer: APPLY_OUTPUT_BYTES,
      timeout: APPLY_BUDGET_MS,
    }
  );
  if (child.error !== undefined) {
    return {
      problem: `git could not be run to apply the patch (${oneLine(child.error.message)}).`,
    };
  }
  if (child.status === 0) return { problem: null };
  const said = oneLine(child.stderr + child.stdout);
  const reason = said === "" ? `git exited ${String(child.status)}` : said;
  return {
    problem: `git did not apply the patch, so nothing was changed: ${reason}`,
  };
}
