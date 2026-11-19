/**
 * Binding evidence to the content of what defines the checks.
 *
 * A verdict says the checks worked when they were proved. Read later, in a
 * repository that has moved on, it needs one more answer: are the checks
 * that were proved the checks that are here? That is asked of content and
 * never of history. An attest run takes one digest over everything that
 * defines the checks and stores it, with the list of what it covers, in the
 * evidence file. `lisa controls attest --check` takes the same digest from
 * the repository as it is and compares the two.
 *
 * Nothing here starts git or reads a commit, so the answer is the same in a
 * shallow clone, after a squash or rebase merge has replaced the commit the
 * proofs ran on, and in a checkout another user owns.
 *
 * ## What defines the checks
 *
 * - The `gates` block of `.lisa.config.json`, in canonical form. The rest of
 *   that file is settings of other things, and a change to one of them is
 *   not a change to a check.
 * - Every file under `.lisa/controls/proofs/`: the changes the proofs plant.
 * - `.lisa/controls/carriers.json`, the record of the files Lisa placed,
 *   every file it lists, and every file under `.lisa/hooks/`.
 * - The gate runner under `scripts/` and every file it loads.
 * - The repository's own hook files that hold Lisa's marked call
 *   (`.husky/pre-commit`, a hooks folder the repository commits, a hook
 *   manager's configuration), as the read-only carrier check names them.
 *
 * ## Where each is read when a run records them
 *
 * The proofs run in a disposable copy: a clone of the last commit, with the
 * files that describe the checks taken from the working copy and the
 * carriers installed by the run (`./proof-copy.ts`). The digest is of what
 * the proofs ran against, so each file is read **in that copy**. Which files
 * are covered is decided by the repository: a file the copy holds only
 * because the run installed it there, in a repository that has no carriers
 * of its own, is the run's equipment and not part of what the repository
 * defines.
 *
 * So, read later in the repository:
 *
 * - a file that is as the copy had it matches;
 * - a file that differs from the copy's does not. That includes a carrier
 *   the run's install brought up to date in the copy while the repository
 *   still holds the older one, and a file changed in the working copy that
 *   the copy took from the last commit;
 * - a file the repository gained since (carriers installed after the run)
 *   or lost since does not.
 *
 * The repository's own hook files are the exception: they are read in the
 * repository, because they are what starts the checks there and not in the
 * copy. Git copies no hook setting into a clone, so the copy is wired by its
 * own install.
 *
 * ## What is not covered
 *
 * - **The checked tool's own configuration**: a linter's rule file, a test
 *   runner's settings, the scripts in `package.json`. They are the
 *   project's, and there is no list of them. A rule switched off there is
 *   not seen here; running the proofs again sees it.
 * - **A hook in git's own folder, and the `core.hooksPath` setting.**
 *   Neither is committed and no clone has either, so a digest that covered
 *   them could never match anywhere else. Whether a checkout is wired is
 *   what `lisa controls install-carriers --check` and `lisa controls
 *   reconcile` say.
 * - **A file's permission to be started, and the target of a link.** Only
 *   content is read. A link where a file should be is covered as a link,
 *   whatever it points at.
 * - **A file the operating system drops into a folder**: `.DS_Store`,
 *   `Thumbs.db` and `desktop.ini`, by exactly those names, wherever they
 *   are. A file manager writes one into any folder a person opens, git is
 *   told to ignore them on most machines, and no clone has one; and since
 *   nothing here starts git, it cannot be asked what is ignored. Covered,
 *   one of them in `.lisa/hooks/` would fail the check straight after the
 *   run that recorded the digest, and one beside the proofs would pass
 *   where it was recorded and fail in every clone. So none is covered,
 *   when a digest is recorded or when it is taken again. Nothing runs a
 *   file by one of these names unless a covered file starts it.
 * @module controls/checks-binding
 */
import { createHash } from "node:crypto";
import { readlink } from "node:fs/promises";
import path from "node:path";

import { isJsonObject } from "../sync/json-path.js";
import { canonicalText, compareCodeUnits } from "./canonical-json.js";
import { blockedFolder, fileState } from "./carrier-edits.js";
import { readRecordedFiles } from "./carrier-owned-files.js";
import { runnerFiles } from "./carrier-runner-files.js";
import { findMarkedBlock } from "./carrier-script.js";
import {
  CARRIER_HOOKS_FOLDER,
  CARRIER_RECORD_PATH,
  CARRIER_RUNNER_FOLDER,
} from "./carrier-types.js";
import { installCarriers } from "./carriers.js";
import type { ChecksBinding, CoveredCheckFile } from "./evidence-types.js";
import { GATES_DECLARATION_PATH } from "./gates-declaration.js";
import { isPlainPath, ordinaryFiles } from "./proof-copy-files.js";
import { PROOF_FOLDER } from "./proof-patch.js";

/** The algorithm of every digest here. */
export const CHECKS_DIGEST_ALGORITHM = "sha256";

/** The key of the declaration the digest covers. */
const GATES_KEY = "gates";

/** What stands in for the content of something that is not a file. */
const NOT_A_FILE = "lisa:not-an-ordinary-file";

/** How many files a line names before it counts the rest. */
const NAMED_FILES = 8;

/**
 * The names of the files an operating system drops into a folder: the
 * Finder's on macOS, and Explorer's two on Windows. None is ever covered.
 */
const DROPPED_BY_SYSTEM: readonly string[] = [
  ".DS_Store",
  "Thumbs.db",
  "desktop.ini",
];

/** What a binding is taken from. */
export interface BindingSources {
  /**
   * Real path of the repository. Which files are covered is decided here.
   */
  readonly repository: string;
  /**
   * Real path of the copy the proofs ran in, where each covered file is
   * read. The repository itself when left out.
   */
  readonly copy?: string;
  /**
   * Names the repository's own hook files that hold Lisa's marked call.
   * Left out, none is looked for: reading them needs git, and a check of a
   * committed verdict uses none.
   */
  readonly hostHooks?: (repository: string) => Promise<readonly string[]>;
  /**
   * Paths to read beside the ones the repository names: the ones an earlier
   * binding covered.
   */
  readonly also?: readonly string[];
}

/** How a binding taken now differs from one that was recorded. */
export interface BindingDifferences {
  /** Covered then and now, with different content. */
  readonly changed: readonly string[];
  /** Covered then, and not there now. */
  readonly gone: readonly string[];
  /** There now, and not covered then. */
  readonly added: readonly string[];
}

/**
 * The SHA-256 digest of some bytes.
 * @param content - Text or bytes
 * @returns The digest, in lower-case hexadecimal
 */
function sha256(content: string | Buffer): string {
  return createHash(CHECKS_DIGEST_ALGORITHM).update(content).digest("hex");
}

/**
 * The digest a list of covered files adds up to.
 * @param covered - The files and their digests, ordered by path
 * @returns The digest of the list's canonical text
 */
export function digestOfCovered(covered: readonly CoveredCheckFile[]): string {
  return sha256(canonicalText(covered));
}

/**
 * The digest of the `gates` block of a declaration.
 * @param content - The declaration file's bytes
 * @returns The digest of the block in canonical form, so that neither a
 *   change to another key nor a change of layout shows; the digest of the
 *   bytes when the file is not a JSON object, so that any change shows
 */
function gatesDigest(content: Buffer): string {
  try {
    const parsed = JSON.parse(content.toString("utf8")) as unknown;
    return isJsonObject(parsed)
      ? sha256(canonicalText({ [GATES_KEY]: parsed[GATES_KEY] ?? null }))
      : sha256(content);
  } catch {
    return sha256(content);
  }
}

/**
 * The digest of what is at one path.
 * @param root - Real path of the folder the path is read in
 * @param file - The path, from that folder
 * @returns The digest; `null` when nothing is there
 */
async function contentDigest(
  root: string,
  file: string
): Promise<string | null> {
  const absolute = path.join(root, file);
  // A link on the way could lead anywhere, so nothing is read through one.
  if ((await blockedFolder(root, file)) !== null) return sha256(NOT_A_FILE);
  const state = await fileState(absolute);
  if (state.kind === "missing") return null;
  if (state.content === null) {
    const target = await readlink(absolute).catch(() => null);
    return sha256(target === null ? NOT_A_FILE : `${NOT_A_FILE}:${target}`);
  }
  return file === GATES_DECLARATION_PATH
    ? gatesDigest(state.content)
    : sha256(state.content);
}

/**
 * The gate runner's files in a repository: the ones the running Lisa
 * package places, and the ones the repository's own runner loads.
 * @param root - Real path of the repository
 * @returns The paths, from the repository root
 */
async function runnerPaths(root: string): Promise<readonly string[]> {
  const listed = async (folder?: string): Promise<readonly string[]> => {
    try {
      return (await runnerFiles(folder)).map(file => file.path);
    } catch {
      // No runner there, or one that cannot be followed: it names nothing.
      return [];
    }
  };
  const [shipped, own] = await Promise.all([
    listed(),
    listed(path.join(root, CARRIER_RUNNER_FOLDER)),
  ]);
  return [...shipped, ...own];
}

/**
 * Every ordinary file under a folder that is reached without a link.
 * @param root - Real path of the repository
 * @param folder - The folder, from the repository root
 * @returns The files, from the repository root
 */
async function filesUnder(
  root: string,
  folder: string
): Promise<readonly string[]> {
  return (await blockedFolder(root, `${folder}/any`)) === null
    ? ordinaryFiles(root, folder)
    : [];
}

/**
 * Name every path of a repository that defines its checks, whether or not
 * anything is there.
 * @param root - Real path of the repository
 * @returns The paths, from the repository root, each once
 */
async function definingPaths(root: string): Promise<readonly string[]> {
  const [proofs, hooks, recorded, runner] = await Promise.all([
    filesUnder(root, PROOF_FOLDER),
    filesUnder(root, CARRIER_HOOKS_FOLDER),
    readRecordedFiles(root),
    runnerPaths(root),
  ]);
  return [
    ...new Set([
      GATES_DECLARATION_PATH,
      ...proofs,
      CARRIER_RECORD_PATH,
      // A record that cannot be read names nothing; the record itself is
      // still covered. A path that leads out of the repository is not read.
      ...(recorded.problem === null
        ? recorded.files.filter(file => isPlainPath(file))
        : []),
      ...hooks,
      ...runner,
    ]),
  ];
}

/**
 * Tell whether a path is one a digest may cover: inside the repository,
 * and not a file the operating system dropped there.
 * @param file - The path, from the repository root
 * @returns Whether it may be covered
 */
function isCoverable(file: string): boolean {
  return (
    isPlainPath(file) && !DROPPED_BY_SYSTEM.includes(path.posix.basename(file))
  );
}

/**
 * Read the digest of each of some paths.
 * @param root - Real path of the folder they are read in
 * @param paths - The paths, from that folder
 * @returns One entry per path that has something at it
 */
async function digestsOf(
  root: string,
  paths: readonly string[]
): Promise<readonly CoveredCheckFile[]> {
  const digests = await Promise.all(
    paths.map(file => contentDigest(root, file))
  );
  return paths.flatMap((file, index) => {
    const digest = digests[index];
    return typeof digest === "string" ? [{ path: file, sha256: digest }] : [];
  });
}

/**
 * Take the digest of what defines a repository's checks.
 * @param sources - The repository, and the copy the proofs ran in if any
 * @returns The digest, and everything it covers
 */
export async function bindChecks(
  sources: BindingSources
): Promise<ChecksBinding> {
  const { repository, copy = repository, also = [] } = sources;
  const named = [
    ...new Set([...(await definingPaths(repository)), ...also]),
  ].filter(file => isCoverable(file));
  // Covered: what the repository itself holds. Read: where the proofs ran.
  const held = await digestsOf(repository, named);
  const fromCopy =
    copy === repository
      ? held
      : await digestsOf(
          copy,
          held.map(file => file.path)
        );
  const hooks = await digestsOf(
    repository,
    sources.hostHooks === undefined ? [] : await sources.hostHooks(repository)
  );
  const hookPaths = new Set(hooks.map(file => file.path));
  const covered = [
    ...fromCopy.filter(file => !hookPaths.has(file.path)),
    ...hooks,
  ].sort((left, right) => compareCodeUnits(left.path, right.path));
  return { covered, digest: digestOfCovered(covered) };
}

/**
 * Name the repository's own hook files that hold Lisa's marked call.
 *
 * The read-only carrier check says which file holds the call at commit and
 * at push for whoever owns the repository's hooks. A file is named when it
 * is inside the repository, outside git's own folder, and holds the marked
 * lines. A run whose carrier check gives no result names none.
 * @param root - Real path of the repository
 * @param check - The read-only carrier check; replaceable in a test
 * @returns The files, from the repository root, each once
 */
export async function hostHookFiles(
  root: string,
  check: typeof installCarriers = installCarriers
): Promise<readonly string[]> {
  const run = await check(root, { check: true }).catch(() => null);
  if (run === null || run.problems !== null) return [];
  const points = run.result.enforcement_points.flatMap(point =>
    point.kind === "git-hook" && point.path !== null && isPlainPath(point.path)
      ? [{ file: point.path, moment: point.moment }]
      : []
  );
  const holds = await Promise.all(
    points.map(async ({ file, moment }) => {
      if ((await blockedFolder(root, file)) !== null) return false;
      const { content } = await fileState(path.join(root, file));
      if (content === null) return false;
      const block = findMarkedBlock(
        content.toString("utf8").split("\n"),
        moment
      );
      return block.problem === null && block.found;
    })
  );
  return [
    ...new Set(
      points.filter((_, index) => holds[index] === true).map(({ file }) => file)
    ),
  ];
}

/**
 * Compare a binding taken now with one that was recorded.
 * @param recorded - The binding in the evidence file
 * @param current - The binding of the repository as it is
 * @returns What changed, what is gone and what is new, each in path order
 */
export function bindingDifferences(
  recorded: ChecksBinding,
  current: ChecksBinding
): BindingDifferences {
  const then = new Map(recorded.covered.map(file => [file.path, file.sha256]));
  const now = new Map(current.covered.map(file => [file.path, file.sha256]));
  return {
    added: [...now.keys()].filter(file => !then.has(file)),
    changed: [...then.keys()].filter(
      file => now.has(file) && now.get(file) !== then.get(file)
    ),
    gone: [...then.keys()].filter(file => !now.has(file)),
  };
}

/**
 * Name a covered thing the way a person reads it.
 * @param file - The path, from the repository root
 * @returns The path; for the declaration, with the part of it that counts
 */
function shown(file: string): string {
  return file === GATES_DECLARATION_PATH
    ? `the ${GATES_KEY} block of ${file}`
    : file;
}

/**
 * Name some covered things in a sentence, counting the ones left out.
 * @param files - The paths, in order
 * @returns For example `a, b and 3 more`
 */
function named(files: readonly string[]): string {
  const listed = files.slice(0, NAMED_FILES).map(shown).join(", ");
  const more = files.length - NAMED_FILES;
  return more > 0 ? `${listed} and ${String(more)} more` : listed;
}

/**
 * Say how the repository differs from what the proofs ran against.
 * @param recorded - The binding in the evidence file
 * @param current - The binding of the repository as it is
 * @returns One line per kind of difference; none when the two agree
 */
export function bindingDifferenceLines(
  recorded: ChecksBinding,
  current: ChecksBinding
): readonly string[] {
  const about =
    "The verdict is about the checks as they were proved, so it does not describe what is here.";
  if (recorded.digest !== digestOfCovered(recorded.covered)) {
    return [
      `The evidence file's own account of what defines the checks does not add up: its digest is not the digest of the files it lists. It was not written this way by a run.`,
    ];
  }
  const { changed, gone, added } = bindingDifferences(recorded, current);
  return [
    ...(changed.length === 0
      ? []
      : [
          `What defines the checks is not what the proofs ran against. Changed since: ${named(changed)}. ${about}`,
        ]),
    ...(gone.length === 0
      ? []
      : [
          `What defines the checks is not what the proofs ran against. No longer here: ${named(gone)}. ${about}`,
        ]),
    ...(added.length === 0
      ? []
      : [
          `What defines the checks is not what the proofs ran against. Here now and not there then: ${named(added)}. ${about}`,
        ]),
  ];
}
