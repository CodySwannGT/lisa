/**
 * What enforcement one checkout actually resolves — measured, not remembered.
 *
 * `scripts/lisa-enforcement-fallback.sh` answers this question for the checkout
 * an agent is sitting in, once per session, to that session. Nobody was looking
 * at the fleet, so the only fleet-wide number that ever existed was taken by
 * hand and written into a comment in that file, where it recorded that most
 * checkouts resolved no guard and none that did was current. A number in a
 * comment is a measurement, not a
 * monitor — it was true on the day it was written and nothing re-takes it
 * (CodySwannGT/lisa#3490).
 *
 * This module is the re-derivation. Given a checkout root it reads the same
 * evidence the dispatcher reads, by the same rules, and returns what that
 * checkout resolves right now:
 *
 *   - Six guards, first-wins PER GUARD: `scripts/lisa-hooks/` (written into a
 *     host by `lisa apply`) shadows `plugins/lisa/hooks/` (the Lisa monorepo's
 *     own source) outright, and the shadowed copy never runs.
 *   - The aggregate takes the strongest refusal, so **the oldest resolved copy
 *     governs** (CodySwannGT/lisa#3205). "Which copy governs" is therefore the
 *     oldest tree in use, never the newest present.
 *   - A tree with no manifest beside it is *undateable*, which is reported as
 *     its own answer rather than folded into "current". Reading an undateable
 *     copy as current is exactly how a stale copy stays invisible.
 *
 * Two things are deliberately kept apart in the result, because folding them
 * together is the defect this exists to end. `resolution` says whether anything
 * is enforcing at all; `vintage` says how old the thing enforcing is. A
 * checkout resolving nothing has no vintage — it is not "very stale", it is
 * unprotected, and the two have different remedies.
 * @module core/enforcement-coverage
 */
import * as path from "node:path";
import { readApplyReceipt } from "./apply-receipt.js";
import { readJsonOrNull } from "../utils/json-utils.js";
import { pathExists } from "../utils/file-operations.js";

/**
 * The guards the dispatcher runs, in its own order.
 *
 * Kept as data rather than inferred from the directory listing: a census that
 * asks "which guard files are here" cannot notice a guard that is missing
 * everywhere, which is the case it most needs to report.
 */
export const ENFORCEMENT_GUARDS = [
  "block-no-verify",
  "parity-safety-net",
  "block-shell-json-parsing",
  "block-instruction-file-edits",
  "block-direct-issue-create",
  "block-managed-file-edits",
] as const;

/** Which of the two trees a resolved guard came from. */
export type GuardTree = "host" | "plugin";

/**
 * How much enforcement a checkout resolves.
 *
 * `unreadable` is a first-class answer and never a synonym for any of the
 * others: a checkout the census could not look into has not been shown to
 * resolve anything, and has not been shown to resolve nothing either.
 */
export type CoverageResolution = "unreadable" | "none" | "partial" | "full";

/**
 * How old the copy in force is.
 *
 * `not-applicable` belongs to checkouts that resolve nothing — they have no
 * copy to be old. That value is what makes it structurally impossible to count
 * an unguarded checkout as a stale one.
 */
export type CoverageVintage =
  | "current"
  | "behind"
  | "undateable"
  | "not-applicable";

/** One guard and the copy that would run for it, if any. */
export interface GuardResolution {
  /** Guard name, as the dispatcher spells it. */
  readonly guard: string;
  /** Tree the running copy comes from, or null when nothing resolved. */
  readonly tree: GuardTree | null;
  /** Absolute path of the copy that would run, or null. */
  readonly script: string | null;
  /** Whether a second copy exists that this one shadows. */
  readonly shadows: boolean;
}

/** One guard tree, and the evidence that dates it. */
export interface TreeVintage {
  /** Which tree this is. */
  readonly tree: GuardTree;
  /** Absolute path of the tree. */
  readonly root: string;
  /** Lisa version that produced it, or null when it cannot be dated. */
  readonly version: string | null;
  /** The file that dated it, or the file whose absence left it undateable. */
  readonly datedBy: string;
}

/** What `lisa apply` left behind, if anything. */
export interface ReceiptSummary {
  /** Whether a readable receipt exists. */
  readonly present: boolean;
  /** Lisa version that completed the apply. */
  readonly version: string | null;
  /** When that apply completed. */
  readonly appliedAt: string | null;
  /** Whether it was a full apply or the postinstall-safe subset. */
  readonly mode: string | null;
}

/**
 * What the checkout's own manifest asks for versus what is installed.
 *
 * Its own axis, because it fails in the affirmative: a checkout whose
 * `node_modules` is majors behind its `package.json` resolves guards, runs
 * them, and answers every question confidently about a version nobody is using.
 */
export interface InstallSummary {
  /** Range the checkout's manifest declares, or null when it declares none. */
  readonly declared: string | null;
  /** Version actually present under `node_modules`, or null. */
  readonly installed: string | null;
}

/** Everything one checkout resolves, right now. */
export interface CheckoutCoverage {
  /** Operator-facing label — the roster key, or the path when scanned. */
  readonly label: string;
  /** Absolute path of the checkout. */
  readonly checkoutPath: string;
  /** How much enforcement it resolves. */
  readonly resolution: CoverageResolution;
  /** Why it could not be read, when `resolution` is `unreadable`. */
  readonly unreadableReason: string | null;
  /** Per-guard resolution. Empty when the checkout could not be read. */
  readonly guards: readonly GuardResolution[];
  /** Guards no copy of which was found. */
  readonly unresolvedGuards: readonly string[];
  /** Every tree that contributes at least one running guard. */
  readonly trees: readonly TreeVintage[];
  /** The oldest tree in use — the copy that governs. Null when none is. */
  readonly governing: TreeVintage | null;
  /** Age of the governing copy against the reference version. */
  readonly vintage: CoverageVintage;
  /** The apply receipt, or its absence. */
  readonly receipt: ReceiptSummary;
  /** Declared versus installed Lisa in this checkout. */
  readonly install: InstallSummary;
}

/** The npm package every host checkout installs Lisa as. */
const LISA_PACKAGE = "@codyswann/lisa";

/**
 * Compare two dotted versions on their release fields only.
 *
 * Prerelease and build suffixes are ignored, and a field that is not a plain
 * number reads as 0, so a string this does not understand is never treated as
 * newer than one it does. That direction produces silence rather than a false
 * staleness claim — the same choice the dispatcher makes, for the same reason.
 * @param left - Candidate version
 * @param right - Version to compare against
 * @returns Whether `left` names an older Lisa than `right`
 */
export function isOlderVersion(left: string, right: string): boolean {
  const fields = (value: string): readonly number[] =>
    (value.split(/[-+]/u)[0] ?? "")
      .split(".")
      .slice(0, 3)
      .map(field => (/^\d+$/u.test(field) ? Number(field) : 0));
  const a = fields(left);
  const b = fields(right);
  const differing = [0, 1, 2].find(
    index => (a[index] ?? 0) !== (b[index] ?? 0)
  );
  return differing === undefined
    ? false
    : (a[differing] ?? 0) < (b[differing] ?? 0);
}

/**
 * Read the first top-level occurrence of a version-shaped key from a JSON file.
 * @param filePath - File to read
 * @param key - Key naming the version
 * @returns The version string, or null when the file or key is absent
 */
async function readVersionKey(
  filePath: string,
  key: string
): Promise<string | null> {
  const parsed = await readJsonOrNull<Record<string, unknown>>(filePath);
  const value = parsed?.[key];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/**
 * Resolve each guard to the copy that would actually run for it.
 * @param root - Checkout root
 * @returns One entry per guard, in dispatcher order
 */
async function resolveGuards(root: string): Promise<GuardResolution[]> {
  const hostTree = path.join(root, "scripts", "lisa-hooks");
  const pluginTree = path.join(root, "plugins", "lisa", "hooks");
  return Promise.all(
    ENFORCEMENT_GUARDS.map(async guard => {
      const hostScript = path.join(hostTree, `${guard}.sh`);
      const pluginScript = path.join(pluginTree, `${guard}.sh`);
      const [host, plugin] = await Promise.all([
        pathExists(hostScript),
        pathExists(pluginScript),
      ]);
      if (host) {
        return {
          guard,
          tree: "host" as const,
          script: hostScript,
          shadows: plugin,
        };
      }
      if (plugin) {
        return {
          guard,
          tree: "plugin" as const,
          script: pluginScript,
          shadows: false,
        };
      }
      return { guard, tree: null, script: null, shadows: false };
    })
  );
}

/**
 * Date one tree from the evidence that produced it.
 *
 * The host tree is dated by the apply receipt because the same `lisa apply` run
 * wrote both, so they cannot disagree. The plugin tree is dated by the plugin
 * manifest beside it, which the release bumps in lockstep with the package.
 * @param root - Checkout root
 * @param tree - Which tree to date
 * @returns The tree's vintage, dated or explicitly undateable
 */
async function dateTree(root: string, tree: GuardTree): Promise<TreeVintage> {
  if (tree === "host") {
    const datedBy = path.join(root, ".lisa", "apply-receipt.json");
    const receipt = await readApplyReceipt(root);
    return {
      tree,
      root: path.join(root, "scripts", "lisa-hooks"),
      version: receipt?.lisa_version ?? null,
      datedBy,
    };
  }
  const datedBy = path.join(
    root,
    "plugins",
    "lisa",
    ".claude-plugin",
    "plugin.json"
  );
  return {
    tree,
    root: path.join(root, "plugins", "lisa", "hooks"),
    version: await readVersionKey(datedBy, "version"),
    datedBy,
  };
}

/**
 * Pick the copy that governs: the oldest tree in use, undateable first.
 *
 * Undateable outranks any dated tree because a copy that cannot be shown
 * current must not be allowed to report the checkout as current — the whole
 * point of dating in the first place.
 * @param trees - Trees contributing at least one running guard
 * @returns The governing tree, or null when nothing is in use
 */
function pickGoverning(trees: readonly TreeVintage[]): TreeVintage | null {
  return trees.reduce<TreeVintage | null>((worst, candidate) => {
    if (worst === null) return candidate;
    if (worst.version === null) return worst;
    if (candidate.version === null) return candidate;
    return isOlderVersion(candidate.version, worst.version) ? candidate : worst;
  }, null);
}

/**
 * Classify the governing copy's age against the reference version.
 * @param governing - The copy in force, or null when there is none
 * @param reference - Newest Lisa the census can point at
 * @returns The vintage class
 */
function classifyVintage(
  governing: TreeVintage | null,
  reference: string | null
): CoverageVintage {
  if (governing === null) return "not-applicable";
  if (governing.version === null) return "undateable";
  if (reference !== null && isOlderVersion(governing.version, reference)) {
    return "behind";
  }
  return "current";
}

/**
 * Read what the checkout declares and what it has installed.
 * @param root - Checkout root
 * @returns Declared range and installed version, each null when absent
 */
async function readInstallSummary(root: string): Promise<InstallSummary> {
  const manifest = await readJsonOrNull<Record<string, unknown>>(
    path.join(root, "package.json")
  );
  const sections = ["dependencies", "devDependencies", "optionalDependencies"];
  const declared = sections.reduce<string | null>((found, section) => {
    if (found !== null) return found;
    const block = manifest?.[section];
    if (typeof block !== "object" || block === null) return null;
    const value = (block as Record<string, unknown>)[LISA_PACKAGE];
    return typeof value === "string" ? value : null;
  }, null);
  return {
    declared,
    installed: await readVersionKey(
      path.join(root, "node_modules", LISA_PACKAGE, "package.json"),
      "version"
    ),
  };
}

/** Everything the caller must supply to measure one checkout. */
export interface CoverageRequest {
  /** Operator-facing label for the checkout. */
  readonly label: string;
  /** Path to the checkout, already expanded and resolved. */
  readonly checkoutPath: string;
  /** Newest Lisa the census can point at, or null when nothing dates it. */
  readonly reference: string | null;
}

/**
 * The unreadable answer, built once so every caller reports it identically.
 * @param request - The checkout that could not be read
 * @param reason - Why it could not be read, in the operator's language
 * @returns A coverage record that is not, and cannot become, "covered"
 */
function unreadable(
  request: CoverageRequest,
  reason: string
): CheckoutCoverage {
  return {
    label: request.label,
    checkoutPath: request.checkoutPath,
    resolution: "unreadable",
    unreadableReason: reason,
    guards: [],
    unresolvedGuards: [],
    trees: [],
    governing: null,
    vintage: "not-applicable",
    receipt: { present: false, version: null, appliedAt: null, mode: null },
    install: { declared: null, installed: null },
  };
}

/**
 * Measure what one checkout resolves right now.
 *
 * Every failure to look is reported as a failure to look. A checkout that is
 * not there, or not readable, is never quietly dropped from the fleet and never
 * counted as covered: a census that reports better coverage than exists is
 * worse than no census, because it retires the question.
 * @param request - The checkout to measure
 * @returns What that checkout resolves
 */
export async function collectCheckoutCoverage(
  request: CoverageRequest
): Promise<CheckoutCoverage> {
  const root = request.checkoutPath;
  if (!(await pathExists(root))) {
    return unreadable(request, "path does not exist");
  }
  const attempt = await resolveGuards(root).then(
    guards => ({ guards, failure: null as string | null }),
    (error: unknown) => ({
      guards: null,
      failure: `could not read the guard trees: ${
        error instanceof Error ? error.message : String(error)
      }`,
    })
  );
  if (attempt.guards === null) {
    return unreadable(request, attempt.failure ?? "unknown read failure");
  }
  const guards = attempt.guards;
  const running = guards.filter(entry => entry.tree !== null);
  const usedTrees = (["host", "plugin"] as const).filter(tree =>
    running.some(entry => entry.tree === tree)
  );
  const trees = await Promise.all(usedTrees.map(tree => dateTree(root, tree)));
  const governing = pickGoverning(trees);
  const receipt = await readApplyReceipt(root);
  return {
    label: request.label,
    checkoutPath: root,
    resolution:
      running.length === 0
        ? "none"
        : running.length === ENFORCEMENT_GUARDS.length
          ? "full"
          : "partial",
    unreadableReason: null,
    guards,
    unresolvedGuards: guards
      .filter(entry => entry.tree === null)
      .map(entry => entry.guard),
    trees,
    governing,
    vintage: classifyVintage(governing, request.reference),
    receipt: {
      present: receipt !== null,
      version: receipt?.lisa_version ?? null,
      appliedAt: receipt?.applied_at ?? null,
      mode: receipt?.apply_mode ?? null,
    },
    install: await readInstallSummary(root),
  };
}

/**
 * Re-classify a record's vintage against a reference resolved later.
 *
 * The census cannot know the newest Lisa on the disk until it has read every
 * checkout, and the reference is a maximum over exactly that evidence. So
 * records are collected first with no reference and dated afterwards, rather
 * than the census guessing a reference up front and being wrong about the one
 * checkout that carries the newest copy.
 * @param coverage - A record collected with no reference
 * @param reference - Newest Lisa the census can point at
 * @returns The same record, dated
 */
export function applyReference(
  coverage: CheckoutCoverage,
  reference: string | null
): CheckoutCoverage {
  return {
    ...coverage,
    vintage: classifyVintage(coverage.governing, reference),
  };
}

/**
 * Every Lisa version this checkout proves exists somewhere on the disk.
 *
 * Used to build the reference the way the dispatcher builds its own: a maximum
 * over evidence on the same disk, never a nominated authority and never a
 * network lookup. A copy is behind only when something newer can be pointed at.
 * @param coverage - A collected record
 * @returns The versions it can vouch for
 */
export function versionEvidence(coverage: CheckoutCoverage): readonly string[] {
  return [
    coverage.install.installed,
    coverage.receipt.version,
    ...coverage.trees.map(tree => tree.version),
  ].filter((value): value is string => value !== null);
}
