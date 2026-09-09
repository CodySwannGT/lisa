/**
 * The two filesystem reads the stale-banner check depends on, and the rule
 * that both obey: an answer the filesystem declined to give is not an answer.
 *
 * Kept separate from `doctor-stale-managed-banner.ts` for the max-lines budget,
 * the same way the Lisa-owned artifact fixtures are split. The distinction it
 * encodes is the load-bearing one: `fs-extra`'s `pathExists` and a bare
 * `catch { return [] }` both resolve a permission denial into the same shape as
 * an empty directory, and this check's whole job is to tell "found nothing"
 * apart from "could not look" (CodySwannGT/lisa#3703).
 * @module cli/doctor-stale-banner-scan
 */
import { open, readdir } from "node:fs/promises";
import * as path from "node:path";

import { COPY_STRATEGIES, PROJECT_TYPE_ORDER } from "../core/config.js";
import type { ShippedTemplateStrategy } from "../core/stale-managed-banner.js";

/**
 * Errno codes that answer the question rather than refusing it: the path is
 * genuinely not there. Anything else — a permission denial, an I/O error, a
 * symlink loop — means the probe could not look, which is a different answer
 * and must not be spelled the same way.
 */
const ABSENT_CODES = new Set(["ENOENT", "ENOTDIR", "ENAMETOOLONG"]);

/**
 * How many leading bytes of a host file are read to recover its header.
 *
 * A header is four lines at most (`core/ownership-header`), and the population
 * scanned includes repository roots that hold lockfiles measured in megabytes.
 * Reading whole files to look at their first two lines would make the check
 * cost proportional to the repository rather than to the question.
 */
const HEADER_PREFIX_BYTES = 1024;

/** The seeding strategy, whose claim any other strategy outranks. */
const CREATE_ONLY = "create-only";

/** The lane directories a Lisa package ships templates under. */
const TEMPLATE_LANES = ["all", ...PROJECT_TYPE_ORDER] as const;

/** One entry of a directory listing, reduced to what the scan needs. */
export interface DirectoryEntry {
  /** Base name of the entry within its directory. */
  readonly name: string;
  /** Whether the entry is a regular file. Symlinks are deliberately not. */
  readonly isFile: boolean;
}

/** How the scan reaches the filesystem, so tests can make it refuse. */
export interface BannerScanDeps {
  /**
   * List one directory, REJECTING when the filesystem declines to say and
   * resolving to an empty list only when the directory is provably absent.
   */
  readonly readDirectory?: (
    absolute: string
  ) => Promise<readonly DirectoryEntry[]>;
}

/**
 * The errno code of a rejected filesystem call, when it carries one.
 * @param error - Value thrown by a filesystem call
 * @returns The errno code, or undefined when the value carries none
 */
function errnoCode(error: unknown): string | undefined {
  const code: unknown =
    typeof error === "object" && error !== null
      ? (error as { code?: unknown }).code
      : undefined;
  return typeof code === "string" ? code : undefined;
}

/**
 * List a directory, distinguishing "not there" from "could not look".
 * @param absolute - Absolute directory path
 * @returns Its entries, or an empty list when it is provably absent
 * @throws {Error} When the filesystem cannot answer
 */
export async function listDirectory(
  absolute: string
): Promise<readonly DirectoryEntry[]> {
  try {
    const entries = await readdir(absolute, { withFileTypes: true });
    return entries.map(entry => ({
      isFile: entry.isFile(),
      name: entry.name,
    }));
  } catch (error) {
    const code = errnoCode(error);
    if (code !== undefined && ABSENT_CODES.has(code)) return [];
    throw new Error(`could not read ${absolute}: ${code ?? String(error)}`, {
      cause: error,
    });
  }
}

/**
 * Read the leading bytes of a file, distinguishing absence from refusal.
 * @param absolute - Absolute file path
 * @returns Its leading bytes as text, or undefined when it is provably absent
 * @throws {Error} When the filesystem cannot answer
 */
export async function readHeaderPrefix(
  absolute: string
): Promise<string | undefined> {
  try {
    const handle = await open(absolute, "r");
    try {
      const buffer = Buffer.alloc(HEADER_PREFIX_BYTES);
      const { bytesRead } = await handle.read(
        buffer,
        0,
        HEADER_PREFIX_BYTES,
        0
      );
      return buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = errnoCode(error);
    if (code !== undefined && ABSENT_CODES.has(code)) return undefined;
    throw new Error(`could not read ${absolute}: ${code ?? String(error)}`, {
      cause: error,
    });
  }
}

/**
 * The strategy bucket a template directory name falls into.
 * @param strategy - Strategy directory name under a lane
 * @returns The bucket the banner classifier acts on
 */
function bucket(strategy: string): ShippedTemplateStrategy {
  if (strategy === "copy-overwrite" || strategy === CREATE_ONLY) {
    return strategy;
  }
  return "other";
}

/** One destination path paired with the strategy of the lane shipping it. */
type ShippedPair = readonly [
  destination: string,
  strategy: ShippedTemplateStrategy,
];

/**
 * Walk one lane/strategy tree, collecting every destination it ships.
 * @param root - Absolute path of the lane/strategy directory
 * @param prefix - Repo-relative destination prefix accumulated so far
 * @param strategy - Strategy the lane ships these destinations under
 * @returns Destination/strategy pairs found beneath `root`
 * @throws {Error} When a directory cannot be read
 */
async function walkTree(
  root: string,
  prefix: string,
  strategy: ShippedTemplateStrategy
): Promise<readonly ShippedPair[]> {
  const entries = await listDirectory(root);
  const found = await Promise.all(
    entries.map(async (entry): Promise<readonly ShippedPair[]> => {
      const destination =
        prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isFile
        ? [[destination, strategy] as const]
        : walkTree(path.join(root, entry.name), destination, strategy);
    })
  );
  return found.flat();
}

/**
 * Every destination path the installed package ships, across every lane.
 *
 * Deliberately not scoped to the stacks this project detects as. A template
 * that ships only under one stack is still shipped, and an index built from
 * detected stacks would report every stack-specific artifact in a repository as
 * retired the moment detection shifted — the same false accusation this check
 * exists to end, arriving through the detector instead of the package.
 * @param lisaRoot - Installed Lisa package root
 * @returns Destination path to the strategy that ships it
 * @throws {Error} When a template directory cannot be read
 */
export async function shippedDestinations(
  lisaRoot: string
): Promise<ReadonlyMap<string, ShippedTemplateStrategy>> {
  const lanes = await Promise.all(
    TEMPLATE_LANES.flatMap(lane =>
      COPY_STRATEGIES.map(async strategy =>
        walkTree(path.join(lisaRoot, lane, strategy), "", bucket(strategy))
      )
    )
  );
  const pairs = lanes.flat();
  // A destination can be shipped by more than one lane, and the strategies can
  // disagree — `create-only` in one stack, `copy-overwrite` in another. Seeds
  // are laid down first so a non-seed claim, arriving later, wins the Map. That
  // is the conservative direction: a disagreement makes the banner read as
  // accurate rather than overstated, producing silence rather than a finding
  // nobody can act on.
  return new Map([
    ...pairs.filter(([, strategy]) => strategy === CREATE_ONLY),
    ...pairs.filter(([, strategy]) => strategy !== CREATE_ONLY),
  ]);
}
