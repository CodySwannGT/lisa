/**
 * Shared paths, vocabulary, and readers for the dependency-ownership
 * integration contract (#1891, closing PRD #1741).
 *
 * The constants here are the layer's shared vocabulary — the six trust classes,
 * the nine record fields, the seven confidence-rebuild evidence types. They live
 * in one module precisely because the point of the integration tests is that
 * DEP-1..DEP-5 speak the SAME words; two copies of these lists would let the
 * assertions drift apart while still passing.
 *
 * @module tests/unit/strategies/dependency-ownership-helpers
 */
import { readFileSync } from "node:fs";
import path from "node:path";

/** DEP-1: the scaffold every host project receives, create-only. */
export const SCAFFOLD = "all/create-only/.lisa/DEPENDENCY_DECISIONS.md";
/** DEP-4: Lisa's own filled-in copy of that scaffold. */
export const SEED = ".lisa/DEPENDENCY_DECISIONS.md";
/** The path a host project's record always lives at. */
export const RECORD_PATH = ".lisa/DEPENDENCY_DECISIONS.md";
/** The planning surface all three rules wire into. */
export const DECOMPOSITION =
  "plugins/src/base/skills/lisa-task-decomposition/SKILL.md";
/** DEP-3: the manifest-authoritative duplicate-version detector. */
export const DUPLICATE_CHECK = "scripts/check-duplicate-versions.mjs";
/** The operator walkthrough this layer is documented by (#1891 §4). */
export const OPERATOR_DOC =
  "wiki/playbooks/dependency-ownership-operator-guide.md";
/** The canonical dependency manifest's filename. */
export const MANIFEST = "package.json";

/**
 * The pointer section the shipped scaffold carries. AC scenario 2 names "a host
 * project using Lisa's updated templates", and a host operator never sees
 * `wiki/`, `plugins/src/`, or `tests/fixtures/` — those are Lisa-repository
 * paths absent from a host checkout. The scaffold is the one file `lisa apply`
 * guarantees them, so it has to be the self-contained entry point to all five
 * surfaces.
 */
export const POINTER_HEADING = "## The rest of the dependency-ownership layer";

/**
 * Where a host project's copy of the governed rules actually lives — inside the
 * installed package, since `plugins` is in the published `files[]`. Verified by
 * running `lisa apply` into a fresh project.
 */
export const HOST_RULES_DIR =
  "node_modules/@codyswann/lisa/plugins/lisa/rules/reference";

/**
 * How a host operator runs the duplicate-version detector. The published
 * package ships the script (`scripts` is in `files[]`) but wires no
 * `check:duplicate-versions` entry into the host's manifest, so this direct
 * invocation is the only route that works there.
 */
export const HOST_DETECTOR_INVOCATION =
  "node node_modules/@codyswann/lisa/scripts/check-duplicate-versions.mjs --root . --scan .";

/** Work-item legs, reused from the per-story fixtures rather than duplicated. */
export const ADDITION_TICKET =
  "tests/fixtures/dependency-trust-classes/dependency-addition-ticket.md";
export const INTERNALIZATION_TICKET =
  "tests/fixtures/dependency-internalization-kit/dependency-internalization-ticket.md";
export const BUMP_TICKET =
  "tests/fixtures/dependency-internalization-kit/version-bump-ticket.md";

/** Record + host-project legs, new for the tie-together. */
export const ADDITION_PROJECT = "tests/fixtures/dependency-ownership/addition";
export const INTERNALIZATION_PROJECT =
  "tests/fixtures/dependency-ownership/internalization";

/** Rule-pair basenames carried by every agent surface with a rules tree. */
export const RULES = [
  "dependency-decision-records",
  "dependency-trust-classes",
  "dependency-internalization-kit",
] as const;

/** Each rule pair's H1 title, shared by its eager head and reference body. */
export const RULE_TITLES: Readonly<Record<(typeof RULES)[number], string>> = {
  "dependency-decision-records": "Dependency Decisions",
  "dependency-internalization-kit": "Dependency Internalization Kit",
  "dependency-trust-classes": "Dependency Trust Classes",
};

/**
 * The six trust classes, spelled exactly as the taxonomy names them. This
 * vocabulary is what makes the layer one layer: a class named on a work item has
 * to be the same string the record's trust basis resolves to and the same string
 * the seed uses, or the surfaces are only nominally connected.
 */
export const TRUST_CLASSES = [
  "mature ecosystem primitive",
  "fast-moving standard implementation",
  "build/development tool",
  "runtime-critical service client",
  "thin wrapper suitable for in-house ownership",
  "temporary/experimental dependency",
] as const;

/** The nine record fields, in the order the scaffold fixes. */
export const FIELD_LABELS = [
  "**Why we keep it:**",
  "**What it is (dependency):**",
  "**What it does for us (owned capability):**",
  "**Why we believe it's safe (trust basis):**",
  "**What breaks if this is compromised (exposure):**",
  "**What it would take to replace (replacement cost):**",
  "**What would catch a bad update (detection evidence):**",
  "**Who owns this and how often we recheck (owner / review cadence):**",
  "**Last reviewed:**",
] as const;

/** The seven confidence-rebuild evidence types (DEP-5). */
export const KIT_CRITERIA = [
  "Real corpus",
  "Conformance fixtures",
  "Negative fixtures",
  "Coverage as a gap detector",
  "Provenance and license review",
  "Migration and update plan",
  "Rollback or replacement criteria",
] as const;

/** One `### ` record entry, split into its heading and flattened body. */
export interface RecordEntry {
  readonly heading: string;
  readonly body: string;
}

/**
 * Read a repo-relative file.
 *
 * @param relativePath - Path relative to the repository root.
 * @returns The file's UTF-8 contents.
 */
export const read = (relativePath: string): string =>
  readFileSync(path.resolve(relativePath), "utf8");

/**
 * Collapse markdown soft-wrapping so prose assertions survive reflowing. The
 * contract is the sentence, not where the line happened to break.
 *
 * @param text - Raw markdown source.
 * @returns The same text with every whitespace run collapsed to one space.
 */
export const flat = (text: string): string => text.replace(/\s+/gu, " ");

/**
 * Read a fixture host project's decision record.
 *
 * @param project - Repo-relative fixture project root.
 * @returns The record's contents.
 */
export const readRecord = (project: string): string =>
  read(path.join(project, RECORD_PATH));

/**
 * Split a record's trailing `## Records` section into its entries. Every `###`
 * heading inside that section is an entry and never guidance — the scaffold
 * guarantees it, which is what makes the section mechanically parseable.
 *
 * @param record - The record file's contents.
 * @returns One entry per `###` heading, bodies flattened for phrase matching.
 */
export const readEntries = (record: string): readonly RecordEntry[] =>
  record
    .slice(record.indexOf("\n## Records"))
    .split(/^### /mu)
    .slice(1)
    .map(block => {
      const newline = block.indexOf("\n");

      return {
        body: flat(block.slice(newline)),
        heading: block.slice(0, newline),
      };
    });

/**
 * Case-insensitive alphabetical comparator, so assertions that sort detector
 * output do not depend on the detector's traversal order.
 *
 * @param left - First value.
 * @param right - Second value.
 * @returns Standard comparator result.
 */
export const byName = (left: string, right: string): number =>
  left.localeCompare(right);
