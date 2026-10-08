/**
 * Retire a file Lisa itself put in a consumer's repository, but only while it
 * still holds bytes Lisa shipped.
 *
 * Two gates already stand between a `deletions.json` entry and `fse.remove`,
 * and both are right for the case they were written for. The workflow
 * ownership gate (`core/workflow-deletion-ownership`) refuses any workflow
 * carrying the create-only "this file is YOURS" header, because whatever is in
 * such a file may be entirely the consumer's work (CodySwannGT/lisa#3656). The
 * shipped-surface ledger (`shipped-removals.json`) keeps a removed `scripts/`
 * executable in place, because a host may have wired it into its own
 * `package.json` (CodySwannGT/lisa#3849).
 *
 * Neither can retire a file Lisa seeded and the consumer never touched. Every
 * seeded copy of a create-only workflow carries the YOURS header, so a manifest
 * entry retiring one is refused on every host it reaches; a removed script is
 * kept forever. CodySwannGT/lisa#4393 met both at once: the PAT-dependent
 * `lisa-update.yml` workflow and the `lisa-self-update.mjs` script it ran,
 * retired in #4337 and still present, byte for byte as seeded, in every host.
 *
 * ## Bytes are the proof the header cannot give
 *
 * The header says who was PROMISED the file. Its bytes say whether anyone has
 * exercised that promise. A copy whose sha256 equals a version Lisa shipped at
 * that path is provably unedited: there is no local work in it to lose, and
 * deleting it is Lisa removing its own artifact. A copy that matches no shipped
 * version may hold the consumer's work, and is kept with a notice saying so.
 *
 * Opting in is per path, in the manifest's `retireUnmodified` map, which lists
 * the shipped digests. For a path Lisa's hash ledger already tracks (the
 * copy-overwrite `scripts/` tree) the ledger's digests count too, so a script
 * entry needs no digest list of its own. Line endings are compared both as
 * stored and with CRLF normalised to LF, since a checkout with
 * `core.autocrlf` rewrites them without anyone editing the file.
 *
 * Bytes prove the file is unedited, not that nothing uses it. A consumer can
 * call an unedited script from its own `package.json` or a workflow, so a
 * referenced path is kept as well; `findHostReferences` reads those.
 * @module core/retire-unmodified
 */
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open, readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

import type { DeletionsConfig } from "./config.js";
import { LISA_OWNED_HASH_LEDGER } from "./lisa-owned-hash-ledger.js";

/** Lowercase hex sha256, the only digest form the manifest accepts. */
const SHA256 = /^[a-f0-9]{64}$/u;

/** Workflow file extensions GitHub Actions reads. */
const WORKFLOW_EXTENSIONS = new Set([".yml", ".yaml"]);

/**
 * Normalize a path for lookup: POSIX separators, no leading `./`.
 * @param value - Raw path from a manifest
 * @returns Comparable POSIX-style repo-relative path
 */
function normalizeRepoPath(value: string): string {
  const posix = value.split(path.sep).join("/").replaceAll("\\", "/");
  return posix.startsWith("./") ? posix.slice(2) : posix;
}

/**
 * Every digest of a version Lisa shipped at a path the manifest retires only
 * while unmodified, or null when the manifest does not retire it that way.
 *
 * An entry whose own list is malformed contributes nothing from that list; it
 * still counts as opted in, so a ledger-tracked path keeps working and a path
 * with no usable digest at all can only ever be kept.
 * @param config - The parsed deletions manifest
 * @param relativePath - Declared path, spelled as the manifest spells it
 * @param ledger - Shipped-hash ledger to consult (Lisa's own by default)
 * @returns The digests, or null when the path is not opted in
 */
export function retiredDigests(
  config: DeletionsConfig,
  relativePath: string,
  ledger: Readonly<Record<string, readonly string[]>> = LISA_OWNED_HASH_LEDGER
): ReadonlySet<string> | null {
  const declared = config.retireUnmodified?.[relativePath];
  if (declared === undefined) return null;
  const listed = Array.isArray(declared)
    ? declared.filter(
        (digest): digest is string =>
          typeof digest === "string" && SHA256.test(digest)
      )
    : [];
  return new Set([
    ...listed,
    ...(ledger[normalizeRepoPath(relativePath)] ?? []),
  ]);
}

/**
 * Whether file bytes are one of the shipped versions.
 * @param bytes - Raw bytes of the consumer's copy
 * @param digests - Digests of every shipped version
 * @returns True when the bytes, as stored or with CRLF normalised, match one
 */
export function isShippedVersion(
  bytes: Buffer,
  digests: ReadonlySet<string>
): boolean {
  const digest = (value: Buffer): string =>
    createHash("sha256").update(value).digest("hex");
  if (digests.has(digest(bytes))) return true;
  const text = bytes.toString("utf8");
  if (!text.includes("\r\n")) return false;
  return digests.has(digest(Buffer.from(text.replaceAll("\r\n", "\n"))));
}

/** What a byte proof was computed over: the bytes and the inode they came from. */
export interface RegularFileProof {
  readonly bytes: Buffer;
  readonly dev: number;
  readonly ino: number;
}

/**
 * Whether a path still holds exactly the file a proof was computed over.
 *
 * Checked immediately before removal, so a file replaced or edited after the
 * proof (while references were being read) is not deleted on the strength of
 * bytes it no longer has. A path-based unlink keeps a residual window between
 * this check and the removal; Node offers no unlink-by-descriptor to close it.
 * @param filePath - Absolute path
 * @param proof - The earlier proof
 * @returns True when the inode and bytes are unchanged
 */
export async function stillProved(
  filePath: string,
  proof: RegularFileProof
): Promise<boolean> {
  const now = await readRegularFile(filePath);
  return (
    now !== null &&
    now.dev === proof.dev &&
    now.ino === proof.ino &&
    now.bytes.equals(proof.bytes)
  );
}

/**
 * The bytes of a regular file at a path, read without following a symlink.
 *
 * The proof that a retired file is unedited has to be about the entry that
 * will be removed. Opening with `O_NOFOLLOW` and checking the type through the
 * same descriptor binds the check and the bytes to one inode, so a symlink, or
 * a regular file swapped for one between a check and a read, is unprovable.
 * @param filePath - Absolute path
 * @returns Its bytes and inode identity, or null when it is not a readable regular file
 */
export async function readRegularFile(
  filePath: string
): Promise<RegularFileProof | null> {
  const handle = await open(
    filePath,
    fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW
  ).catch(() => null);
  if (handle === null) return null;
  try {
    const entry = await handle.stat();
    if (!entry.isFile()) return null;
    return { bytes: await handle.readFile(), dev: entry.dev, ino: entry.ino };
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** A file that does not exist, as distinct from one that could not be read. */
const ABSENT = Symbol("absent");

/**
 * Whether an error means the path is simply not there.
 * @param error - A filesystem error
 * @returns True for ENOENT / ENOTDIR
 */
function isAbsence(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * Read a file's text, telling "absent" apart from "could not read".
 * @param filePath - Absolute path
 * @returns Its text, ABSENT when it does not exist, or null when unreadable
 */
async function readText(
  filePath: string
): Promise<string | typeof ABSENT | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    return isAbsence(error) ? ABSENT : null;
  }
}

/** Repo-relative name of the consumer's npm manifest. */
const PACKAGE_JSON = "package.json";

/**
 * Whether the consumer's `package.json` scripts name a path.
 * @param text - Raw `package.json` text, or null when there is none
 * @param target - Normalized repo-relative path
 * @returns True when a script names it
 */
function packageScriptsName(text: string, target: string): boolean {
  try {
    const scripts = (JSON.parse(text) as { scripts?: unknown }).scripts;
    return (
      scripts !== null &&
      typeof scripts === "object" &&
      Object.values(scripts).some(
        value => typeof value === "string" && value.includes(target)
      )
    );
  } catch {
    // An unparseable manifest proves nothing either way; its text still might.
    return text.includes(target);
  }
}

/**
 * Workflows under `.github/workflows/` whose text names a path.
 * @param projectDir - Absolute path to the consumer repository
 * @param target - Normalized repo-relative path
 * @returns Repo-relative workflow paths naming it, or null when any could not be read
 */
async function workflowsNaming(
  projectDir: string,
  target: string
): Promise<readonly string[] | null> {
  const workflowsDir = path.join(projectDir, ".github", "workflows");
  const entries = await readdir(workflowsDir, { withFileTypes: true }).catch(
    (error: unknown) => (isAbsence(error) ? [] : null)
  );
  if (entries === null) return null;
  const candidates = entries
    .filter(
      entry =>
        entry.isFile() && WORKFLOW_EXTENSIONS.has(path.extname(entry.name))
    )
    .map(entry => entry.name)
    .filter(name => `.github/workflows/${name}` !== target);
  const texts = await Promise.all(
    candidates.map(name => readText(path.join(workflowsDir, name)))
  );
  // probe-direction: fail-closed — an unreadable workflow makes the whole
  // answer unknown, and the caller keeps the file rather than guess.
  if (texts.some(text => text === null)) return null;
  return candidates
    .filter((_name, index) => {
      const text = texts[index];
      return typeof text === "string" && text.includes(target);
    })
    .map(name => `.github/workflows/${name}`);
}

/**
 * Where the consumer's own automation still names a path.
 *
 * Read are the `package.json` scripts and every workflow under
 * `.github/workflows/`, which is where a host wires a Lisa script into its own
 * automation. A workflow that is itself being retired by the same manifest is
 * still read: if it survives (because it was edited), what it calls has to
 * survive with it, and if it was deleted earlier in the same pass it is no
 * longer on disk to be read.
 * @param projectDir - Absolute path to the consumer repository
 * @param relativePath - Repo-relative path being retired
 * @returns Repo-relative paths of the files naming it, sorted, or null when
 *   one of them exists but could not be read (references are then unknown)
 */
export async function findHostReferences(
  projectDir: string,
  relativePath: string
): Promise<readonly string[] | null> {
  const target = normalizeRepoPath(relativePath);
  if (target === "") return [];
  const manifest = await readText(path.join(projectDir, PACKAGE_JSON));
  const workflows = await workflowsNaming(projectDir, target);
  // probe-direction: fail-closed — unknown references keep the file.
  if (manifest === null || workflows === null) return null;
  return [
    ...(manifest !== ABSENT && packageScriptsName(manifest, target)
      ? [PACKAGE_JSON]
      : []),
    ...workflows,
  ].sort((left, right) => left.localeCompare(right));
}
