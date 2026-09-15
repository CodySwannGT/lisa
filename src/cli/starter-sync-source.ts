import type { StarterTemplate } from "../core/project-config-starter.js";
import { isJsonObject } from "../sync/json-path.js";
import {
  captureCommand,
  readGitHubStarter,
  validateStarterRepo,
  type CaptureCommand,
} from "./starter-provenance.js";

/** Exact regular-file or link bytes at one immutable starter revision. */
export interface StarterFile {
  readonly bytes: Buffer;
  readonly mode: string;
}

/** A path changed between the recorded baseline and the pinned tracked head. */
export interface StarterChange {
  readonly path: string;
  readonly before?: StarterFile;
  readonly after?: StarterFile;
}

/** A complete, read-only diff suitable for one independently tracked starter. */
export interface StarterChanges {
  readonly sha: string;
  readonly changes: readonly StarterChange[];
}

/** A pinned tree entry before its contents are needed. */
interface TreeFile {
  readonly sha: string;
  readonly mode: string;
}

/**
 * Require a pinned Git object before putting it into a remote endpoint.
 * @param value - Supplied or returned object identifier.
 * @returns Validated identifier.
 */
function objectId(value: string): string {
  if (!/^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(value)) {
    throw new Error("Starter revision is not a valid Git object identifier");
  }
  return value;
}

/**
 * Keep Git paths relative without rejecting colon-scoped agent commands.
 * @param value - Repository path or configured scope.
 * @returns Validated path, with a scope's trailing slash removed.
 */
export function starterRelativePath(value: string): string {
  const normalized = value.replace(/\/$/, "");
  if (
    !normalized ||
    /[\\\u0000-\u001f]/u.test(normalized) ||
    /^[a-z]:/iu.test(normalized) ||
    normalized.split("/").some(part => !part || part === "." || part === "..")
  ) {
    throw new Error(`Invalid starter path: ${value}`);
  }
  return normalized;
}

/**
 * Decode a file entry while leaving directory entries to the recursive tree.
 * @param entry - Untrusted GitHub tree entry.
 * @returns Zero or one validated file tuple.
 */
function treeEntry(entry: unknown): readonly (readonly [string, TreeFile])[] {
  if (!isJsonObject(entry))
    throw new Error("Starter returned an invalid tree entry");
  if (entry.type === "tree") return [];
  if (
    typeof entry.path !== "string" ||
    typeof entry.sha !== "string" ||
    typeof entry.mode !== "string"
  ) {
    throw new Error("Starter returned an invalid tree entry");
  }
  return [
    [
      starterRelativePath(entry.path),
      { sha: objectId(entry.sha), mode: entry.mode },
    ],
  ];
}

/**
 * Read a complete tree; an API limit must never look like deleted files.
 * @param endpoint - Validated repository API endpoint.
 * @param tree - Pinned tree object.
 * @param capture - Read-only command runner.
 * @returns Files indexed by their exact repository paths.
 */
async function readTree(
  endpoint: string,
  tree: string,
  capture: CaptureCommand
): Promise<ReadonlyMap<string, TreeFile>> {
  const data: unknown = JSON.parse(
    await capture("gh", [
      "api",
      `${endpoint}/git/trees/${objectId(tree)}?recursive=1`,
    ])
  );
  if (!isJsonObject(data) || !Array.isArray(data.tree)) {
    throw new Error("Starter returned an invalid Git tree");
  }
  if (data.truncated !== false) {
    throw new Error("Starter Git tree is truncated or completeness is unknown");
  }
  const entries = data.tree.flatMap(treeEntry);
  const files = new Map(entries);
  if (files.size !== entries.length)
    throw new Error("Starter returned duplicate tree paths");
  return files;
}

/**
 * Decode a pinned blob without trimming whitespace or executable metadata.
 * @param endpoint - Validated repository API endpoint.
 * @param file - File from the complete tree, or an absent side of the diff.
 * @param capture - Read-only command runner.
 * @returns Exact bytes and Git mode, or undefined when absent.
 */
async function readBlob(
  endpoint: string,
  file: TreeFile | undefined,
  capture: CaptureCommand
): Promise<StarterFile | undefined> {
  if (file === undefined) return undefined;
  if (!["100644", "100755", "120000"].includes(file.mode)) {
    throw new Error("Starter change has an unsupported Git file mode");
  }
  const data: unknown = JSON.parse(
    await capture("gh", ["api", `${endpoint}/git/blobs/${file.sha}`])
  );
  if (
    !isJsonObject(data) ||
    data.encoding !== "base64" ||
    typeof data.content !== "string"
  ) {
    throw new Error("Starter returned an invalid Git blob");
  }
  const bytes = Buffer.from(data.content, "base64");
  if (data.size !== bytes.length)
    throw new Error("Starter blob size does not match its contents");
  return { bytes, mode: file.mode };
}

/**
 * Diff the actual recorded tree against one pinned head, never a merge base.
 * @param template - Independently tracked starter and optional path scopes.
 * @param capture - Bounded read-only GitHub metadata/content runner.
 * @param accepts - Applicable ownership filter, applied before reading contents.
 * @returns Complete scoped changes and the exact revision they describe.
 */
export async function readStarterChanges(
  template: StarterTemplate,
  capture: CaptureCommand = captureCommand,
  accepts: (name: string) => boolean = () => true
): Promise<StarterChanges> {
  const endpoint = `repos/${validateStarterRepo(template.repo)}`;
  const baseline = objectId(template.lastSync.sha);
  const scopes = template.paths?.map(starterRelativePath);
  const head = await readGitHubStarter(template.repo, template.ref, capture);
  const sha = head.template.lastSync.sha;
  if (sha === baseline) return { sha, changes: [] };
  const baseTree = await capture("gh", [
    "api",
    `${endpoint}/git/commits/${baseline}`,
    "--jq",
    ".tree.sha",
  ]);
  const before = await readTree(endpoint, baseTree, capture);
  const after = await readTree(endpoint, head.tree, capture);
  const paths = [...new Set([...before.keys(), ...after.keys()])]
    .sort((left, right) => left.localeCompare(right))
    .filter(name => inScope(name, scopes))
    .filter(accepts)
    .filter(
      name =>
        before.get(name)?.sha !== after.get(name)?.sha ||
        before.get(name)?.mode !== after.get(name)?.mode
    );
  // Read serially so a large starter never creates an unbounded request burst.
  const changes = await paths.reduce<Promise<readonly StarterChange[]>>(
    async (pending, name) => {
      const completed = await pending;
      const oldBytes = await readBlob(endpoint, before.get(name), capture);
      const newBytes = await readBlob(endpoint, after.get(name), capture);
      return [
        ...completed,
        {
          path: name,
          ...(oldBytes === undefined ? {} : { before: oldBytes }),
          ...(newBytes === undefined ? {} : { after: newBytes }),
        },
      ];
    },
    Promise.resolve([])
  );
  return { sha, changes };
}

/**
 * Match exact files or directory boundaries, rather than similar prefixes.
 * @param name - Changed repository path.
 * @param scopes - Validated optional configuration scopes.
 * @returns Whether this path belongs to the requested diff.
 */
function inScope(name: string, scopes: readonly string[] | undefined): boolean {
  return (
    scopes === undefined ||
    scopes.some(scope => name === scope || name.startsWith(`${scope}/`))
  );
}
