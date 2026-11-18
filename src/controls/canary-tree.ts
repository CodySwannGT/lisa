/**
 * Making the commit a canary carries: the head of the protected branch with
 * one proof patch applied, and nothing else.
 *
 * The commit is built on the hosting platform through its object API and
 * never pushed from a checkout, for two reasons. The canary is then exactly
 * "the branch as the platform has it, plus the patch", whatever the
 * operator's own checkout holds. And every step is a request that goes
 * through the canary door, so the request log shows all of it.
 *
 * The patch is applied by git, the same way a commit or push proof plants it
 * (`./proof-patch.ts`), in a scratch folder that holds only the files the
 * patch names, fetched from the platform at the base commit. Git refuses a
 * path that climbs out of the folder, and a name the patch gives is checked
 * here before anything is written for it.
 *
 * Known limit: a patch that renames a file needs the file under its old
 * name, which is not fetched, so git refuses it and the half is reported
 * with git's reason.
 * @module controls/canary-tree
 */
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { fieldOf, textOf, type CanaryDoor } from "./canary-door.js";
import { applyProofPatch, isolatedGit } from "./proof-patch.js";

/** The commit a canary is built on. */
export interface CanaryBase {
  /** The head of the protected branch. */
  readonly sha: string;
  /** That commit's tree. */
  readonly tree: string;
}

/** The canary commit, or why there is none. */
export type CanaryCommit =
  | { readonly ok: true; readonly sha: string }
  | {
      readonly ok: false;
      /** `patch-not-applied`: the patch. `not-started`: the platform. */
      readonly reason: "patch-not-applied" | "not-started";
      readonly problem: string;
    };

/** One file as a tree names it. */
interface TreeFile {
  readonly mode: string;
  readonly sha: string;
}

/** The modes of an ordinary file. Anything else is not patched. */
const FILE_MODES: ReadonlySet<string> = new Set(["100644", "100755"]);

/** The mode of a file anyone may run. */
const EXECUTABLE = "100755";

/** How long git may take to list a patch's files, in milliseconds. */
const LIST_BUDGET_MS = 60_000;

/** A commit or tree id. */
const OBJECT_ID = /^[0-9a-f]{40,64}$/u;

/**
 * Say that there is no canary commit because of the patch.
 * @param problem - Why
 * @returns The answer
 */
function notApplied(problem: string): CanaryCommit {
  return { ok: false, reason: "patch-not-applied", problem };
}

/**
 * Say that there is no canary commit because of the platform.
 * @param problem - Why
 * @returns The answer
 */
function notStarted(problem: string): CanaryCommit {
  return { ok: false, reason: "not-started", problem };
}

/**
 * Read the commit a branch points at.
 * @param door - The canary door
 * @param branch - The branch name
 * @returns The commit id, or `null` when it could not be read
 */
export function readHead(door: CanaryDoor, branch: string): string | null {
  const ref = door.get(`git/ref/heads/${branch}`);
  const sha = ref.ok ? textOf(ref.value, "object", "sha") : "";
  return OBJECT_ID.test(sha) ? sha : null;
}

/**
 * Read the commit and tree a canary is built on.
 * @param door - The canary door
 * @param branch - The protected branch
 * @returns The base, or why it could not be read
 */
export function readBase(
  door: CanaryDoor,
  branch: string
):
  | { readonly ok: true; readonly base: CanaryBase }
  | { readonly ok: false; readonly problem: string } {
  const sha = readHead(door, branch);
  if (sha === null) {
    return {
      ok: false,
      problem: `The head of ${branch} could not be read from the hosting platform.`,
    };
  }
  const commit = door.get(`git/commits/${sha}`);
  const tree = commit.ok ? textOf(commit.value, "tree", "sha") : "";
  return OBJECT_ID.test(tree)
    ? { ok: true, base: { sha, tree } }
    : {
        ok: false,
        problem: `The commit at the head of ${branch} could not be read from the hosting platform.`,
      };
}

/**
 * Tell whether a name a patch gives is safe to write under a folder.
 * @param name - The file name, from the repository root
 * @returns Whether every part of it is an ordinary name
 */
function isSafeName(name: string): boolean {
  return (
    name !== "" &&
    !name.includes("\\") &&
    name
      .split("/")
      .every(part => ![".", "..", ".git", ""].includes(part.toLowerCase()))
  );
}

/**
 * List the files a patch names, as git reads it.
 * @param scratch - An empty folder to start git in
 * @param patch - The content of the patch file
 * @returns The file names, or why git could not read the patch
 */
function patchFiles(
  scratch: string,
  patch: string
): readonly string[] | { readonly problem: string } {
  const [program = "", ...git] = isolatedGit(scratch);
  const listed = spawnSync(program, [...git, "apply", "--numstat", "-z", "-"], {
    cwd: scratch,
    encoding: "utf8",
    input: patch,
    timeout: LIST_BUDGET_MS,
  });
  if (listed.error !== undefined || listed.status !== 0) {
    const said = `${listed.stderr}${listed.stdout}`
      .trim()
      .replaceAll(/\s+/gu, " ");
    return {
      problem: `git could not read the patch: ${said === "" ? (listed.error?.message ?? "no reason was given") : said}`,
    };
  }
  // Each record is "added<TAB>deleted<TAB>name", ended by a NUL.
  const names = listed.stdout
    .split("\0")
    .filter(record => record !== "")
    .map(record => record.split("\t").slice(2).join("\t"));
  const unsafe = names.find(name => !isSafeName(name));
  return unsafe === undefined
    ? names
    : {
        problem: `The patch names ${JSON.stringify(unsafe)}, which is not a file inside the repository.`,
      };
}

/**
 * Find one file in a tree, one folder at a time.
 * @param door - The canary door
 * @param tree - The tree to look in
 * @param parts - The file name, split at `/`
 * @returns The file; `null` when the tree has no ordinary file there; or
 *   why the tree could not be read
 */
function fileAt(
  door: CanaryDoor,
  tree: string,
  parts: readonly string[]
): TreeFile | null | { readonly problem: string } {
  const read = door.get(`git/trees/${tree}`);
  if (!read.ok) return { problem: read.reason };
  const [name, ...rest] = parts;
  const items = fieldOf(read.value, "tree");
  const item = (Array.isArray(items) ? items : []).find(
    (candidate: unknown) => textOf(candidate, "path") === name
  ) as unknown;
  const sha = textOf(item, "sha");
  if (item === undefined || sha === "") return null;
  if (rest.length > 0) {
    return textOf(item, "type") === "tree" ? fileAt(door, sha, rest) : null;
  }
  const mode = textOf(item, "mode");
  return FILE_MODES.has(mode) ? { mode, sha } : null;
}

/**
 * Fetch the files a patch names from the base commit into a folder.
 * @param door - The canary door
 * @param base - The commit the canary is built on
 * @param names - The file names
 * @param scratch - The folder to write them in
 * @returns Why a file could not be fetched, or `null`
 */
function fetchFiles(
  door: CanaryDoor,
  base: CanaryBase,
  names: readonly string[],
  scratch: string
): string | null {
  const problems = names.flatMap(name => {
    const found = fileAt(door, base.tree, name.split("/"));
    if (found === null) return [];
    if ("problem" in found) return [found.problem];
    const blob = door.get(`git/blobs/${found.sha}`);
    if (!blob.ok) return [blob.reason];
    const target = path.join(scratch, name);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(
      target,
      Buffer.from(textOf(blob.value, "content"), "base64"),
      { mode: found.mode === EXECUTABLE ? 0o755 : 0o644 }
    );
    return [];
  });
  return problems[0] ?? null;
}

/**
 * List every file under a folder.
 * @param folder - The folder
 * @param prefix - The name of the folder from the top, or `""`
 * @returns Each file's name from the top, with `/` between parts
 */
function filesUnder(folder: string, prefix = ""): readonly string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap(item => {
    const name = prefix === "" ? item.name : `${prefix}/${item.name}`;
    return item.isDirectory()
      ? filesUnder(path.join(folder, item.name), name)
      : [name];
  });
}

/**
 * Send the patched files to the platform and make the commit.
 * @param door - The canary door
 * @param base - The commit the canary is built on
 * @param scratch - The folder holding the patched files
 * @param fetched - The files that were there before the patch
 * @param message - The commit message
 * @returns The commit, or why the platform did not make it
 */
function sendCommit(
  door: CanaryDoor,
  base: CanaryBase,
  scratch: string,
  fetched: readonly string[],
  message: string
): CanaryCommit {
  const failed = notStarted;
  const present = filesUnder(scratch);
  const odd = present.find(
    name => !lstatSync(path.join(scratch, name)).isFile()
  );
  if (odd !== undefined) {
    return notApplied(
      `The patch makes ${odd} something other than an ordinary file, which a canary does not carry.`
    );
  }
  const blobs = present.map(name => {
    const file = path.join(scratch, name);
    const sent = door.send("POST", "git/blobs", {
      content: readFileSync(file).toString("base64"),
      encoding: "base64",
    });
    const executable = (lstatSync(file).mode & 0o111) !== 0;
    return {
      path: name,
      mode: executable ? EXECUTABLE : "100644",
      type: "blob",
      sha: sent.ok ? textOf(sent.value, "sha") : "",
      problem: sent.ok ? null : sent.reason,
    };
  });
  const refused = blobs.find(blob => blob.sha === "");
  if (refused !== undefined) {
    return failed(refused.problem ?? "The platform did not store a file.");
  }
  const removed = fetched
    .filter(name => !present.includes(name))
    .map(name => ({ path: name, mode: "100644", type: "blob", sha: null }));
  const tree = door.send("POST", "git/trees", {
    base_tree: base.tree,
    tree: [
      ...blobs.map(({ problem: _problem, ...entry }) => entry),
      ...removed,
    ],
  });
  if (!tree.ok) return failed(tree.reason);
  const commit = door.send("POST", "git/commits", {
    message,
    tree: textOf(tree.value, "sha"),
    parents: [base.sha],
  });
  const sha = commit.ok ? textOf(commit.value, "sha") : "";
  return sha === ""
    ? failed(
        commit.ok ? "The platform did not name the commit." : commit.reason
      )
    : { ok: true, sha };
}

/**
 * Make the commit a canary carries: the base commit with one patch applied.
 * @param door - The canary door
 * @param base - The commit the canary is built on
 * @param patch - The content of the patch file
 * @param message - The commit message
 * @returns The commit, or why there is none
 */
export function buildCanaryCommit(
  door: CanaryDoor,
  base: CanaryBase,
  patch: string,
  message: string
): CanaryCommit {
  const scratch = realpathSync(
    mkdtempSync(path.join(tmpdir(), "lisa-attest-canary-"))
  );
  try {
    const names = patchFiles(scratch, patch);
    if ("problem" in names) return notApplied(names.problem);
    const unfetched = fetchFiles(door, base, names, scratch);
    if (unfetched !== null) return notStarted(unfetched);
    const fetched = filesUnder(scratch);
    const applied = applyProofPatch(scratch, patch);
    return applied.problem === null
      ? sendCommit(door, base, scratch, fetched, message)
      : notApplied(applied.problem);
  } finally {
    rmSync(scratch, { force: true, recursive: true });
  }
}
