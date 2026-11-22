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
 *
 * ## Which paths a patch touches
 *
 * {@link patchPaths} asks git to read the patch, not to apply it, and to
 * list every path it names. The patch is read forwards and backwards: read
 * forwards, a rename is listed under its new name only, and read backwards
 * under its old one. Nothing is asked of the index, so a path git would
 * leave out of a commit because the repository ignores it is listed like
 * any other. {@link ignoredPaths} then says which of some paths those are.
 * @module controls/proof-patch
 */
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { devNull } from "node:os";
import path from "node:path";

import { pathKind } from "./audit-report-file.js";
import { compareCodeUnits } from "./canonical-json.js";
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
export const ENV_PROGRAM = "/usr/bin/env";

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
export const REPOSITORY_VARIABLES = [
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

/** The settings that keep git from leaving housekeeping running behind it. */
const NO_HOUSEKEEPING: readonly (readonly [string, string])[] = [
  ["maintenance.auto", "false"],
  ["gc.auto", "0"],
];

/**
 * The start of a git command that works in one folder and nowhere else.
 *
 * The program and the arguments that come before git's own: the variables
 * that would point git at another repository are removed, git is told not to
 * look above the folder for one, the machine's own git settings are left out,
 * and no background housekeeping is started. Whatever is started with it must
 * be started in that folder.
 * @param directory - Real path of the folder the command will be started in
 * @returns The program, then every argument up to and including `git`
 */
export function isolatedGit(directory: string): readonly string[] {
  return [
    ENV_PROGRAM,
    ...REPOSITORY_VARIABLES.flatMap(name => ["-u", name]),
    `GIT_CEILING_DIRECTORIES=${path.dirname(directory)}`,
    `GIT_CONFIG_GLOBAL=${devNull}`,
    "GIT_CONFIG_NOSYSTEM=1",
    // `git commit` and `git fetch` would otherwise start `git maintenance run
    // --auto --detach`, which keeps writing in `.git/objects` after the
    // command has returned, while the copy is being reset or removed
    // (CodySwannGT/lisa#5100).
    `GIT_CONFIG_COUNT=${String(NO_HOUSEKEEPING.length)}`,
    ...NO_HOUSEKEEPING.flatMap(([key, value], index) => [
      `GIT_CONFIG_KEY_${String(index)}=${key}`,
      `GIT_CONFIG_VALUE_${String(index)}=${value}`,
    ]),
    "LC_ALL=C",
    "git",
  ];
}

/** What git printed and how it ended, for one start with input. */
interface GitWithInput {
  /** The exit status; `null` when git could not be started or was stopped. */
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Why git could not be started, when it could not. */
  readonly failure: string | null;
}

/**
 * Start the isolated git in a folder with text on its standard input.
 * @param directory - Real path of the folder to work in
 * @param args - Arguments to git
 * @param input - What git reads on standard input
 * @returns What it printed and how it ended
 */
function gitWithInput(
  directory: string,
  args: readonly string[],
  input: string
): GitWithInput {
  const [program = ENV_PROGRAM, ...git] = isolatedGit(directory);
  const child = spawnSync(program, [...git, ...args], {
    cwd: directory,
    encoding: "utf8",
    input,
    maxBuffer: APPLY_OUTPUT_BYTES,
    timeout: APPLY_BUDGET_MS,
  });
  return {
    failure: child.error === undefined ? null : oneLine(child.error.message),
    status: child.status,
    stderr: child.stderr ?? "",
    stdout: child.stdout ?? "",
  };
}

/** Some paths, or why git could not name them. */
export type PathsRead =
  | { readonly problem: null; readonly paths: readonly string[] }
  | { readonly problem: string };

/** What a path is written behind so that git reads it as a name. */
const FROM_HERE = "./";

/** One line of `git apply --numstat -z`: two counts, then the path. */
const NUMSTAT_RECORD = /^(?:\d+|-)\t(?:\d+|-)\t([\s\S]*)$/u;

/**
 * Read the paths out of what `git apply --numstat -z` printed.
 *
 * Each record is two counts and a path, ended by a NUL. Where the path is
 * empty the record is a rename, and the next two NUL-ended names are the old
 * path and the new one.
 * @param printed - Git's output
 * @returns Every path named, in git's order
 */
function numstatPaths(printed: string): readonly string[] {
  return printed
    .split("\0")
    .filter(record => record !== "")
    .map(record => NUMSTAT_RECORD.exec(record)?.[1] ?? record)
    .filter(name => name !== "");
}

/**
 * List every path a patch touches, read from the patch itself.
 *
 * Nothing is applied and the index is not asked, so the answer does not
 * depend on what git would stage: a path the repository ignores is listed
 * with the rest. A renamed file is listed under both of its names, and a
 * deleted one under the name it had.
 * @param directory - Real path of the folder the patch belongs to
 * @param patch - The content of the patch file
 * @returns The paths, from the repository root, each once and in order; or
 *   why git could not read the patch
 */
export function patchPaths(directory: string, patch: string): PathsRead {
  const read = (extra: readonly string[]): PathsRead => {
    const child = gitWithInput(
      directory,
      ["apply", "--numstat", "-z", ...extra, "-"],
      patch
    );
    if (child.failure !== null) {
      return { problem: `git could not be run (${child.failure})` };
    }
    return child.status === 0
      ? { problem: null, paths: numstatPaths(child.stdout) }
      : {
          problem:
            oneLine(child.stderr + child.stdout) ||
            `git exited ${String(child.status)}`,
        };
  };
  const forwards = read([]);
  if (forwards.problem !== null) return forwards;
  const backwards = read(["--reverse"]);
  if (backwards.problem !== null) return backwards;
  return {
    problem: null,
    paths: [...new Set([...forwards.paths, ...backwards.paths])].sort(
      compareCodeUnits
    ),
  };
}

/**
 * Say which of some paths a repository ignores.
 *
 * Git is asked the way `git add` asks: a path that is already tracked is
 * not ignored, whatever an ignore file says, and a path that is not tracked
 * is ignored when an ignore file of the repository as it stands right now
 * names it. Each path is handed over behind `./`, so one that begins the
 * way a pattern's options do is still read as a name.
 * @param directory - Real path of the repository, or of a copy of it
 * @param paths - Paths from the repository root
 * @returns The ignored ones, in the order given; or why git could not say
 */
export function ignoredPaths(
  directory: string,
  paths: readonly string[]
): PathsRead {
  if (paths.length === 0) return { problem: null, paths: [] };
  const child = gitWithInput(
    directory,
    ["check-ignore", "-z", "--stdin"],
    paths.map(name => `${FROM_HERE}${name}\0`).join("")
  );
  if (child.failure !== null) {
    return { problem: `git could not be run (${child.failure})` };
  }
  // Exit 0: at least one is ignored. Exit 1: none is. Anything else: git
  // could not answer.
  if (child.status !== 0 && child.status !== 1) {
    return {
      problem:
        oneLine(child.stderr + child.stdout) ||
        `git exited ${String(child.status)}`,
    };
  }
  const ignored = new Set(child.stdout.split("\0"));
  return {
    problem: null,
    paths: paths.filter(name => ignored.has(`${FROM_HERE}${name}`)),
  };
}

/**
 * Plant a patch in a folder, or take it back out.
 * @param directory - Real path of the folder to work in
 * @param patch - The content of the patch file
 * @param options - How to apply it
 * @param options.reverse - Take the change back out instead of planting it
 * @param options.cached - Apply the patch to the index alone
 * @param options.check - Check if the patch can apply without writing
 * @returns No problem when all of it was applied; otherwise git's reason,
 *   and nothing was changed
 */
export function applyProofPatch(
  directory: string,
  patch: string,
  options: {
    readonly reverse?: boolean;
    readonly cached?: boolean;
    readonly check?: boolean;
  } = {}
): PatchOutcome {
  const [program = ENV_PROGRAM, ...git] = isolatedGit(directory);
  const child = spawnSync(
    program,
    [
      ...git,
      "apply",
      "--whitespace=nowarn",
      ...(options.reverse === true ? ["--reverse"] : []),
      ...(options.cached === true ? ["--cached"] : []),
      ...(options.check === true ? ["--check"] : []),
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

/**
 * Stage the proof against the baseline and apply it to the prepared files.
 * @param directory - The disposable, prepared repository
 * @param patch - The proof change
 * @param restore - Restore the baseline index and prepared files after a partial failure
 * @returns The patch outcome and any restoration problem
 */
export function applyPreparedProofPatch(
  directory: string,
  patch: string,
  restore: () => PatchOutcome
): PatchOutcome {
  const checked = applyProofPatch(directory, patch, { check: true });
  if (checked.problem !== null) return checked;
  const staged = applyProofPatch(directory, patch, { cached: true });
  if (staged.problem !== null) return staged;
  const planted = applyProofPatch(directory, patch);
  if (planted.problem === null) return planted;
  const restored = restore();
  return {
    problem:
      restored.problem === null
        ? `${planted.problem} The staged proof was removed and preparation was restored.`
        : `${planted.problem} ${restored.problem}`,
  };
}
