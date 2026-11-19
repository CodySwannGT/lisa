/**
 * The commits, trees and files of the in-memory hosting platform
 * (CodySwannGT/lisa#4997).
 *
 * A canary commit is built on the platform through its object API, so the
 * stand-in has to hold objects the way a real one does: a file is a blob, a
 * folder is a tree naming its blobs and trees, and a commit names one tree.
 * An id is a digest of what the object holds, so the same content always
 * gets the same id and a case can compare two of them.
 * @module tests/unit/controls/support/fake-git-objects
 */
import { createHash } from "node:crypto";

/** One item of a tree. */
export interface TreeItem {
  readonly path: string;
  readonly mode: string;
  readonly type: "blob" | "tree";
  readonly sha: string;
}

/** One change a new tree makes to the tree it is based on. */
export interface TreeChange {
  readonly path: string;
  readonly mode: string;
  /** `null` removes the file. */
  readonly sha: string | null;
}

/** A commit as the platform holds it. */
export interface StoredCommit {
  readonly tree: string;
  readonly parents: readonly string[];
  readonly message: string;
}

/** A file's mode and blob. */
interface FileEntry {
  readonly mode: string;
  readonly sha: string;
}

/** Every file of a tree, by its path from the repository root. */
type FlatTree = ReadonlyMap<string, FileEntry>;

/** Everything the platform holds. */
export interface GitObjects {
  readonly blobs: Map<string, string>;
  readonly trees: Map<string, readonly TreeItem[]>;
  readonly commits: Map<string, StoredCommit>;
}

/** The length of an object id, in hexadecimal digits. */
const ID_LENGTH = 40;

/**
 * The id of an object.
 * @param kind - What it is
 * @param content - What it holds
 * @returns Forty hexadecimal digits
 */
function idOf(kind: string, content: string): string {
  return createHash("sha256")
    .update(`${kind}\n${content}`)
    .digest("hex")
    .slice(0, ID_LENGTH);
}

/**
 * Build an empty object store.
 * @returns The store
 */
export function gitObjects(): GitObjects {
  return { blobs: new Map(), trees: new Map(), commits: new Map() };
}

/**
 * List every file of a tree.
 * @param objects - The store
 * @param sha - The tree, or nothing for an empty one
 * @param prefix - The path of the tree from the root, ending in `/`, or `""`
 * @returns Each file by its path
 */
function flatten(
  objects: GitObjects,
  sha: string | undefined,
  prefix = ""
): FlatTree {
  const items = sha === undefined ? [] : (objects.trees.get(sha) ?? []);
  return new Map(
    items.flatMap((item): [string, FileEntry][] => {
      const name = `${prefix}${item.path}`;
      return item.type === "tree"
        ? [...flatten(objects, item.sha, `${name}/`)]
        : [[name, { mode: item.mode, sha: item.sha }]];
    })
  );
}

/**
 * Store a tree, and the trees of its folders, from a list of files.
 * @param objects - The store
 * @param flat - Each file by its path
 * @returns The tree's id
 */
function storeTree(objects: GitObjects, flat: FlatTree): string {
  const files = [...flat].filter(([name]) => !name.includes("/"));
  const folders = [
    ...new Set(
      [...flat.keys()]
        .filter(name => name.includes("/"))
        .map(name => name.slice(0, name.indexOf("/")))
    ),
  ];
  const items: readonly TreeItem[] = [
    ...files.map(
      ([name, file]): TreeItem => ({ path: name, type: "blob", ...file })
    ),
    ...folders.map((folder): TreeItem => {
      const inside = [...flat]
        .filter(([name]) => name.startsWith(`${folder}/`))
        .map(([name, file]) => [name.slice(folder.length + 1), file] as const);
      return {
        path: folder,
        mode: "040000",
        type: "tree",
        sha: storeTree(objects, new Map(inside)),
      };
    }),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const sha = idOf("tree", JSON.stringify(items));
  objects.trees.set(sha, items);
  return sha;
}

/**
 * Store a file.
 * @param objects - The store
 * @param base64 - The file's content
 * @returns The blob's id
 */
export function addBlob(objects: GitObjects, base64: string): string {
  const sha = idOf("blob", base64);
  objects.blobs.set(sha, base64);
  return sha;
}

/**
 * Store a tree made of another tree and some changes.
 * @param objects - The store
 * @param base - The tree to start from, or nothing for an empty one
 * @param changes - The files to add, replace or remove
 * @returns The new tree's id
 */
export function addTree(
  objects: GitObjects,
  base: string | undefined,
  changes: readonly TreeChange[]
): string {
  const removed = new Set(
    changes.filter(change => change.sha === null).map(change => change.path)
  );
  const kept = [...flatten(objects, base)].filter(
    ([name]) => !removed.has(name)
  );
  const added = changes.flatMap((change): [string, FileEntry][] =>
    change.sha === null
      ? []
      : [[change.path, { mode: change.mode, sha: change.sha }]]
  );
  return storeTree(objects, new Map([...kept, ...added]));
}

/**
 * Store a commit.
 * @param objects - The store
 * @param commit - The commit
 * @returns Its id
 */
export function addCommit(objects: GitObjects, commit: StoredCommit): string {
  const sha = idOf("commit", JSON.stringify(commit));
  objects.commits.set(sha, commit);
  return sha;
}

/**
 * Read every file of a commit as text.
 * @param objects - The store
 * @param commit - The commit
 * @returns Each file's text by its path
 */
export function filesAt(
  objects: GitObjects,
  commit: string
): ReadonlyMap<string, string> {
  const flat = flatten(objects, objects.commits.get(commit)?.tree);
  return new Map(
    [...flat].map(([name, file]) => [
      name,
      Buffer.from(objects.blobs.get(file.sha) ?? "", "base64").toString("utf8"),
    ])
  );
}

/**
 * Read the mode of every file of a commit.
 * @param objects - The store
 * @param commit - The commit
 * @returns Each file's mode by its path
 */
export function modesAt(
  objects: GitObjects,
  commit: string
): ReadonlyMap<string, string> {
  const flat = flatten(objects, objects.commits.get(commit)?.tree);
  return new Map([...flat].map(([name, file]) => [name, file.mode]));
}

/**
 * Store a first commit holding some files.
 * @param objects - The store
 * @param files - Each file's text, by its path; a path ending in `*` is
 *   stored without the star and may be run
 * @returns The commit's id
 */
export function seedCommit(
  objects: GitObjects,
  files: Readonly<Record<string, string>>
): string {
  const tree = addTree(
    objects,
    undefined,
    Object.entries(files).map(([name, text]) => ({
      path: name.replace(/\*$/u, ""),
      mode: name.endsWith("*") ? "100755" : "100644",
      sha: addBlob(objects, Buffer.from(text, "utf8").toString("base64")),
    }))
  );
  return addCommit(objects, { tree, parents: [], message: "Seed" });
}
