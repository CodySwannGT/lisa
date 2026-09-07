#!/usr/bin/env node
/**
 * Deterministic gate that nothing disappears from a SHIPPED surface without a
 * record a consumer can act on (CodySwannGT/lisa#3849).
 *
 * ## Why removal is structurally harder than addition here
 *
 * `deepMergeWithArrayUnion` unions arrays and the copy lanes overwrite; none of
 * them delete. A template edit can therefore ADD to a consumer's tree, and can
 * never remove from it. The only mechanisms that reach an installed base are a
 * `deletions.json` entry and a migration under `src/migrations/`. So a removal
 * made upstream with neither is not a partial fix - downstream it does nothing
 * at all, silently, while looking complete in the diff.
 *
 * That asymmetry has two failure shapes and this gate covers both.
 *
 * ### 1. A shipped FILE vanishes upstream
 *
 * Every host that ever applied a release carrying it keeps it, at its
 * destination path, forever. No later upgrade removes it.
 *
 * ### 2. A shipped script's PUBLIC SURFACE shrinks
 *
 * This is the one that was actually reported, and the ticket's first diagnosis
 * of it was wrong in a way worth recording. `SNAPSHOT_MAX_AGE_DAYS` was dropped
 * from `typescript/copy-overwrite/scripts/check-skipped-required-checks.mjs`
 * (commit `f13bb00`, released in v4.31.0) and a consumer's own
 * `scripts/check-required-checks-baseline.mjs` imported it. That importer was
 * never a Lisa file - `git rev-list --all --objects` finds no such path in this
 * repository's entire history - so a shipped-to-shipped import scan would not
 * have caught it, and a deletions entry would have made it WORSE by propagating
 * a removal into a host that had wired the thing to three npm scripts, a
 * workflow, and a test.
 *
 * A missing NAMED export is not a syntax error in either file. It fails only
 * when the module graph is linked, so it passes anything that lints or
 * type-checks the files one at a time and then surfaces in whichever job runs
 * the importer first - in the reported case `lint`, which points nowhere near
 * the export.
 *
 * ## The two dispositions, and why one manifest could not carry both
 *
 * Before declaring any shipped path for deletion the question is not "does
 * upstream still need it" but "could a consumer have wired this into their own
 * scripts?" - and for an executable under `scripts/` the answer is usually yes.
 * Those two answers need opposite handling, and `deletions.json` makes no such
 * distinction:
 *
 *   - PROPAGATE - a `deletions.json` entry, for a path no host could have bound
 *     to. Nothing further is required; the manifest IS the record.
 *   - RETAIN AND NOTIFY - an entry in the removal ledger, for a consumer-
 *     bindable executable and for every removed export. Deletion would break a
 *     working host capability, so the removal is recorded with a consumer-
 *     facing note instead.
 *
 * A consumer-bindable executable may still be propagated, but only with a
 * `force` reason in its `deletions.json` - the same override that already
 * exists for overriding workflow ownership, reused rather than reinvented.
 *
 * ## Both arms, or it is not a gate
 *
 * A removal WITH a correct record passes, an ordinary addition passes, and a
 * healthy import pair passes. A check that flagged every deletion would be
 * disabled inside a week, and this repository has a live precedent for exactly
 * that failure of proportion.
 *
 * ## Baseline
 *
 * The window is `baseline..HEAD`, where `baseline` is a tag pinned in the
 * ledger (the first tag of the supported major line). Advancing it retires
 * obligations, so it is deliberately a one-line, reviewable edit in the ledger
 * diff rather than something derived from the clock. The gate verifies the tag
 * exists and is an ancestor of HEAD; a baseline it cannot resolve is exit 2,
 * never a quiet pass.
 *
 * ## Determinism guarantees
 *
 *   - zero third-party dependencies (Node built-ins only),
 *   - no network access,
 *   - no `Date` / `Math.random`,
 *   - the file lists come from `git ls-tree`, so the gate compares what a
 *     release actually carried rather than whatever is loose in a worktree.
 *
 * Discovering zero shipped files is exit 2, not a clean pass. A gate that
 * passes because it could not look is the failure mode this file exists to
 * prevent.
 *
 * CLI:
 *   node scripts/check-shipped-surface-removals.mjs [--root <dir>] [--since <ref>] [--json]
 *
 * Exit codes:
 *   0 - every removal from a shipped surface is governed.
 *   1 - at least one ungoverned removal, mis-propagated executable, unresolved
 *       shipped-to-shipped named import, or self-contradicting ledger entry.
 *   2 - operational error: unknown flag, `--root` absent or not a git
 *       repository, git unavailable, an unreadable ledger or deletions
 *       manifest, an unresolvable baseline, or zero shipped files discovered.
 *
 * @module scripts/check-shipped-surface-removals
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DELIVERY_LANES,
  UsageError,
  ancestryChain,
  destinationPath,
  effectiveDeletions,
  matchDeletion,
} from "./check-delivery-deletion-conflicts.mjs";
import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  hasUsableNote,
  indexRemovals,
  isConsumerBindable,
  parseNamedExports,
  parseRelativeNamedImports,
  removalKey,
  resolveRelative,
} from "./lib/shipped-surface.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/** The removal ledger, relative to the repository root. */
export const LEDGER_PATH = "shipped-removals.json";

/** Extensions whose export surface this gate reads. */
const MODULE_EXTENSIONS = Object.freeze([".cjs", ".js", ".mjs"]);

/** Max bytes of git output (the full tree listing is ~0.3 MB today). */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Run one git command under the shared timeout, turning any failure into a
 * `UsageError` so an unverifiable state exits 2 rather than scanning nothing.
 *
 * @param {string} root - repository root.
 * @param {readonly string[]} args - git arguments after `-C root`.
 * @param {string} what - short description, for the error message.
 * @returns {string} stdout.
 */
function git(root, args, what) {
  try {
    return boundedExecFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    throw new UsageError(`${what}: ${error.message}`);
  }
}

/**
 * Split a repo-relative path into its stack, lane, and lane-relative parts,
 * or null when it is not inside a delivery lane.
 *
 * @param {string} file - repo-relative path.
 * @returns {{ stack: string, lane: string, relative: string } | null} the parts.
 */
export function shippedParts(file) {
  const [stack, lane, ...rest] = file.split("/");
  if (rest.length === 0 || !DELIVERY_LANES.includes(lane)) return null;
  return { lane, relative: rest.join("/"), stack };
}

/**
 * Every tracked file inside a delivery lane at `ref`, keyed by repo path.
 *
 * @param {string} root - repository root.
 * @param {string} ref - a git ref.
 * @returns {Map<string, { stack: string, lane: string, destination: string }>} shipped files.
 */
export function shippedFilesAt(root, ref) {
  const stdout = git(
    root,
    ["ls-tree", "-r", "-z", "--name-only", ref],
    `could not list the tree at ${ref}`
  );
  const shipped = new Map();
  for (const file of stdout.split("\0")) {
    const parts = file === "" ? null : shippedParts(file);
    if (parts === null) continue;
    shipped.set(file, {
      destination: destinationPath(parts.lane, parts.relative),
      lane: parts.lane,
      stack: parts.stack,
    });
  }
  return shipped;
}

/**
 * Effective deletion set and `force` reasons for every stack at HEAD.
 *
 * @param {string} root - repository root.
 * @returns {Map<string, { deleted: Set<string>, force: Map<string, string> }>} per stack.
 */
export function readDeletionManifests(root) {
  const manifests = new Map();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const label = `${entry.name}/deletions.json`;
    const absolute = path.join(root, label);
    if (!fs.existsSync(absolute)) continue;
    const parsed = parseJson(absolute, label);
    const force = parsed.force ?? {};
    if (force === null || typeof force !== "object" || Array.isArray(force)) {
      throw new UsageError(`${label}: "force" must be an object`);
    }
    manifests.set(entry.name, {
      deleted: effectiveDeletions(parsed, label),
      force: new Map(Object.entries(force)),
    });
  }
  return manifests;
}

/**
 * Read and parse a JSON file, turning any failure into a `UsageError`.
 *
 * @param {string} absolute - absolute path.
 * @param {string} label - repo-relative path, for error messages.
 * @returns {Record<string, unknown>} the parsed object.
 */
function parseJson(absolute, label) {
  let raw;
  try {
    raw = fs.readFileSync(absolute, "utf8");
  } catch (error) {
    throw new UsageError(`${label}: could not read - ${error.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`${label}: could not parse - ${error.message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(`${label}: expected a JSON object`);
  }
  return parsed;
}

/**
 * Load and validate the removal ledger.
 *
 * @param {string} root - repository root.
 * @returns {{ baseline: string, removals: Array<Record<string, unknown>> }} the ledger.
 */
export function loadLedger(root) {
  const parsed = parseJson(path.join(root, LEDGER_PATH), LEDGER_PATH);
  const { baseline, removals } = parsed;
  if (typeof baseline !== "string" || baseline.trim() === "") {
    throw new UsageError(`${LEDGER_PATH}: "baseline" must be a non-empty ref`);
  }
  if (!Array.isArray(removals)) {
    throw new UsageError(`${LEDGER_PATH}: "removals" must be an array`);
  }
  for (const entry of removals) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      throw new UsageError(`${LEDGER_PATH}: every removal must be an object`);
    }
    if (typeof entry.path !== "string" || entry.path === "") {
      throw new UsageError(`${LEDGER_PATH}: every removal needs a "path"`);
    }
    if (entry.export !== undefined && typeof entry.export !== "string") {
      throw new UsageError(
        `${LEDGER_PATH}: "export" on ${entry.path} must be a string`
      );
    }
  }
  return { baseline, removals };
}

/** A release tag, as this repository spells one. */
const RELEASE_TAG = /^v\d+\.\d+\.\d+$/u;

/**
 * Whether a commit is an ancestor of HEAD, which is what makes `ref..HEAD` a
 * release history rather than an arbitrary pair of commits.
 *
 * @param {string} root - repository root.
 * @param {string} rev - the revision to test.
 * @returns {boolean} true when `rev` is reachable from HEAD.
 */
function isAncestorOfHead(root, rev) {
  try {
    boundedExecFileSync(
      "git",
      ["-C", root, "merge-base", "--is-ancestor", rev, "HEAD"],
      { stdio: "ignore" }
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * The OLDEST release tag reachable from HEAD, or null when there is none.
 *
 * Oldest, not newest, and the difference decides whether this gate proves
 * anything. Measured on this repository the day the configured baseline came
 * detached: 1779 tags exist, 141 are reachable, the newest reachable is the
 * release commit HEAD itself sits on — so a newest-first rule yields a window
 * of ZERO commits and a confident pass over nothing examined. The oldest
 * reachable tag yields 1030. A baseline is an anchor, so when the configured
 * anchor is gone the honest substitute is the earliest one still standing, not
 * the nearest.
 *
 * `--merged HEAD` is the ancestry filter, so every candidate is already a legal
 * baseline; ordering only decides how much history the window covers.
 *
 * @param {string} root - repository root.
 * @returns {string | null} the tag name, or null when no release tag is reachable.
 */
export function oldestReachableReleaseTag(root) {
  const listed = git(
    root,
    ["tag", "--merged", "HEAD", "--sort=creatordate"],
    "could not list tags reachable from HEAD"
  );
  const tags = listed
    .split("\n")
    .map(line => line.trim())
    .filter(line => RELEASE_TAG.test(line));
  return tags[0] ?? null;
}

/**
 * Resolve the baseline ref, refusing anything this gate cannot compare against.
 *
 * The configured baseline is used verbatim whenever it is reachable, and this
 * function behaves then exactly as it always has. It gained a fallback because
 * a history rewrite detached the pinned tag: `v4.0.0` still resolves to a
 * commit and is no longer an ancestor of `main`, so every invocation threw and
 * `test-correctness` — a required PUSH gate — refused every branch in the
 * repository. The gate was not wrong about anything; it could not run.
 * CodySwannGT/lisa#4047, and CodySwannGT/lisa#3719 records the same rewrite
 * breaking a different ancestry-walking gate.
 *
 * The fallback does not loosen the gate. Three ways it stays strict:
 *
 *   - it substitutes only when the configured baseline is UNREACHABLE, never
 *     when it merely produces findings;
 *   - a substituted baseline is named in the report, with the ref it replaced,
 *     so a reader is never told a window they did not ask for is the one they
 *     configured; and
 *   - an EMPTY window is refused. A baseline equal to HEAD compares nothing,
 *     and "nothing examined" must never render as "nothing wrong" — that is
 *     the failure this gate exists to prevent, one level up.
 *
 * Re-anchoring the tag is deliberately not the fix. Moving a published tag
 * breaks every consumer pinned at a commit that belonged to it
 * (CodySwannGT/lisa#3488, CodySwannGT/lisa#3893).
 *
 * @param {string} root - repository root.
 * @param {string} ref - the requested baseline.
 * @param {boolean} [mayFallBack] - true only for the ledger's configured pin.
 *   An explicit `--since` never falls back: a stale pin is nobody's decision
 *   and a typed argument is somebody's, so answering a different window than
 *   the one asked for would be answering a different question. This repository
 *   drives the gate to a finding by reaching back past the supported major with
 *   `--since`, and a fallback there silently turned the bite arm green — caught
 *   by that arm, which is the whole reason it exists.
 * @returns {{ sha: string, ref: string, requested: string, substituted: boolean }}
 *   the resolved baseline and whether it is the one that was asked for.
 */
/**
 * Refuse a baseline whose window holds no commits.
 *
 * Shared by both paths out of `resolveBaseline` on purpose. The condition is
 * one thing — the endpoints are the same commit, so the scan compares nothing —
 * and it is reachable two ways: a `--since` that names HEAD, and a fallback tag
 * that turns out to be HEAD. Guarding only the second left the first reporting
 * `OK ... every removal from a shipped surface is governed` over zero commits.
 *
 * @param {string} root - repository root.
 * @param {string} ref - the baseline as the caller named it, for the message.
 * @param {string} sha - the commit that baseline resolved to.
 * @throws {UsageError} When `sha..HEAD` contains no commits.
 */
function assertNonEmptyWindow(root, ref, sha) {
  const span = git(
    root,
    ["rev-list", "--count", `${sha}..HEAD`],
    `could not measure the window ${ref}..HEAD`
  ).trim();
  if (span === "0") {
    throw new UsageError(
      `baseline ${ref} is HEAD itself, so the window is empty - refusing ` +
        `rather than reporting a clean scan of nothing`
    );
  }
}

export function resolveBaseline(root, ref, mayFallBack = false) {
  const sha = git(
    root,
    ["rev-parse", "--verify", `${ref}^{commit}`],
    `baseline ${ref} does not resolve to a commit`
  ).trim();
  if (isAncestorOfHead(root, sha)) {
    // A reachable baseline can still be HEAD itself, and then the window holds
    // no commits at all. The scan reads nothing and reports every removal
    // governed, which is a confident pass over nothing examined — the failure
    // this gate exists to prevent, produced by the gate. The fallback branch
    // below already refuses that; an explicit `--since` reached the same state
    // by a different route and did not, so the check belongs on every path out
    // of here rather than on one of them.
    assertNonEmptyWindow(root, ref, sha);
    return { ref, requested: ref, sha, substituted: false };
  }
  if (!mayFallBack) {
    throw new UsageError(
      `baseline ${ref} is not an ancestor of HEAD, so the window is not a ` +
        `release history this gate can read`
    );
  }
  const fallback = oldestReachableReleaseTag(root);
  if (fallback === null) {
    throw new UsageError(
      `baseline ${ref} is not an ancestor of HEAD, and no release tag is ` +
        `reachable from HEAD either, so there is no window this gate can ` +
        `read - refusing rather than reporting a clean scan`
    );
  }
  const fallbackSha = git(
    root,
    ["rev-parse", "--verify", `${fallback}^{commit}`],
    `fallback baseline ${fallback} does not resolve to a commit`
  ).trim();
  const span = git(
    root,
    ["rev-list", "--count", `${fallbackSha}..HEAD`],
    `could not measure the window ${fallback}..HEAD`
  ).trim();
  if (span === "0") {
    throw new UsageError(
      `baseline ${ref} is not an ancestor of HEAD, and the oldest reachable ` +
        `release tag ${fallback} is HEAD itself, so the window is empty - ` +
        `refusing rather than reporting a clean scan of nothing`
    );
  }
  return { ref: fallback, requested: ref, sha: fallbackSha, substituted: true };
}

/**
 * The release a path's removal shipped in, so the report can name the reach of
 * the consequence rather than only the file.
 *
 * @param {string} root - repository root.
 * @param {string} baseline - the baseline sha.
 * @param {string} file - the removed repo path.
 * @param {string} [symbol] - the removed export; when given, the commit is
 *   found by pickaxe on that symbol rather than by last touch of the file, so
 *   an unrelated later edit does not get the blame.
 * @returns {string} a tag name, or a description of why there is none.
 */
export function removalRelease(root, baseline, file, symbol) {
  const pickaxe = symbol === undefined ? [] : [`-S${symbol}`];
  const sha = git(
    root,
    ["log", "-1", "--format=%H", ...pickaxe, `${baseline}..HEAD`, "--", file],
    `could not date the removal of ${file}`
  ).trim();
  if (sha === "") return "an unidentified commit";
  try {
    const described = boundedExecFileSync(
      "git",
      ["-C", root, "describe", "--contains", "--match", "v*", sha],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
    );
    return described.trim().split("~")[0].split("^")[0];
  } catch {
    return `${sha.slice(0, 9)} (not yet released)`;
  }
}

/**
 * Whether some stack active alongside `stack` deletes `destination` for every
 * consumer of it, and whether that deletion carries a `force` reason.
 *
 * @param {string} stack - the stack whose lane shipped the path.
 * @param {string} destination - the path in the consumer's tree.
 * @param {Map<string, { deleted: Set<string>, force: Map<string, string> }>} manifests
 *   per-stack deletion manifests.
 * @returns {{ by: string, forced: boolean } | null} the governing deletion.
 */
export function findGoverningDeletion(stack, destination, manifests) {
  for (const candidate of ancestryChain(stack)) {
    const manifest = manifests.get(candidate);
    if (manifest === undefined) continue;
    if (matchDeletion(destination, manifest.deleted) === null) continue;
    return { by: candidate, forced: manifest.force.has(destination) };
  }
  return null;
}

/**
 * Findings for shipped FILES that existed at the baseline and are gone at HEAD.
 *
 * @param {{ root: string, baseline: string, before: Map<string, object>, after: Map<string, object>, manifests: Map<string, object>, ledger: Map<string, object> }} input
 *   the resolved scan inputs.
 * @returns {Array<Record<string, unknown>>} one row per ungoverned removal.
 */
export function findRemovedPaths(input) {
  const rows = [];
  for (const [file, meta] of input.before) {
    if (input.after.has(file)) continue;
    const deletion = findGoverningDeletion(
      meta.stack,
      meta.destination,
      input.manifests
    );
    const noted = hasUsableNote(input.ledger.get(removalKey(file)));
    const verdict = classifyRemovedPath(meta.destination, deletion, noted);
    if (verdict === null) continue;
    rows.push({
      destination: meta.destination,
      kind: verdict.kind,
      path: file,
      reason: verdict.reason,
      release: removalRelease(input.root, input.baseline, file),
    });
  }
  return rows.sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * The verdict on one removed shipped file.
 *
 * @param {string} destination - the path in the consumer's tree.
 * @param {{ by: string, forced: boolean } | null} deletion - the governing deletion.
 * @param {boolean} noted - whether the ledger records the removal.
 * @returns {{ kind: string, reason: string } | null} the finding, or null when governed.
 */
export function classifyRemovedPath(destination, deletion, noted) {
  const bindable = isConsumerBindable(destination);
  if (bindable && deletion !== null && !deletion.forced) {
    return {
      kind: "propagated-bindable",
      reason:
        `${deletion.by}/deletions.json propagates this removal, but a host may ` +
        `have wired ${destination} into its own package.json - deleting it ` +
        `takes away a working capability. Move the entry to "keep" and record ` +
        `the removal in ${LEDGER_PATH}, or give it a "force" reason saying why ` +
        `the removal overrides host wiring.`,
    };
  }
  if (deletion !== null) return null;
  if (noted) return null;
  return bindable
    ? {
        kind: "unrecorded-bindable",
        reason:
          `A host may have wired ${destination} into its own package.json, so ` +
          `this must NOT be propagated as a deletion. Record it in ` +
          `${LEDGER_PATH} with a consumer-facing note instead.`,
      }
    : {
        kind: "unrecorded",
        reason:
          `No deletions manifest active for this stack removes ${destination}, ` +
          `and ${LEDGER_PATH} does not record it. The copy lanes overwrite and ` +
          `never delete, so every host that applied a release carrying this ` +
          `path keeps it at ${destination} and no later upgrade removes it.`,
      };
}

/**
 * Findings for named EXPORTS present at the baseline and gone at HEAD.
 *
 * @param {{ root: string, baseline: string, before: Map<string, object>, after: Map<string, object>, ledger: Map<string, object>, importers: Map<string, number> }} input
 *   the resolved scan inputs.
 * @returns {Array<Record<string, unknown>>} one row per unrecorded export removal.
 */
export function findRemovedExports(input) {
  const rows = [];
  for (const file of changedModules(input.root, input.baseline)) {
    if (!input.before.has(file) || !input.after.has(file)) continue;
    const was = parseNamedExports(showFile(input.root, input.baseline, file));
    const now = parseNamedExports(showFile(input.root, "HEAD", file));
    for (const name of [...was.names].sort()) {
      if (now.names.has(name)) continue;
      if (hasUsableNote(input.ledger.get(removalKey(file, name)))) continue;
      rows.push({
        export: name,
        importers: input.importers.get(file) ?? 0,
        kind: "unrecorded-export",
        path: file,
        release: removalRelease(input.root, input.baseline, file, name),
      });
    }
  }
  return rows;
}

/**
 * Shipped module files that changed between the baseline and HEAD. Comparing
 * only these keeps the export scan to a handful of blob reads rather than one
 * per shipped script.
 *
 * @param {string} root - repository root.
 * @param {string} baseline - the baseline sha.
 * @returns {string[]} repo-relative paths.
 */
function changedModules(root, baseline) {
  const stdout = git(
    root,
    ["diff", "--name-only", "-z", `${baseline}..HEAD`],
    "could not diff the baseline against HEAD"
  );
  return stdout
    .split("\0")
    .filter(
      file =>
        file !== "" &&
        shippedParts(file) !== null &&
        MODULE_EXTENSIONS.includes(path.posix.extname(file))
    );
}

/**
 * Read one blob at a ref.
 *
 * @param {string} root - repository root.
 * @param {string} ref - a git ref.
 * @param {string} file - repo-relative path.
 * @returns {string} the file contents.
 */
function showFile(root, ref, file) {
  return git(root, ["show", `${ref}:${file}`], `could not read ${file}@${ref}`);
}

/**
 * The delivery view a consumer of `stack` sees: destination path to repo path,
 * more specific stacks winning over their ancestors.
 *
 * @param {string} stack - the leaf stack.
 * @param {Map<string, { stack: string, destination: string }>} shipped - files at HEAD.
 * @returns {Map<string, string>} destination path to repo path.
 */
export function deliveryView(stack, shipped) {
  const chain = ancestryChain(stack);
  const view = new Map();
  for (const specificity of [...chain].reverse()) {
    for (const [file, meta] of shipped) {
      if (meta.stack === specificity) view.set(meta.destination, file);
    }
  }
  return view;
}

/**
 * Every named export a destination offers in one delivery view, following
 * `export *` re-exports so a legitimate indirection is not read as a miss.
 *
 * @param {string} destination - the target's path in the consumer's tree.
 * @param {Map<string, string>} view - destination path to repo path.
 * @param {(file: string) => string} read - reads a repo path at HEAD.
 * @param {Set<string>} [seen] - cycle guard.
 * @returns {Set<string> | null} the names, or null when nothing ships there.
 */
export function viewExports(destination, view, read, seen = new Set()) {
  const file = view.get(destination);
  if (file === undefined || seen.has(destination)) return null;
  seen.add(destination);
  const parsed = parseNamedExports(read(file));
  for (const specifier of parsed.starFrom) {
    const inherited = viewExports(
      resolveRelative(destination, specifier),
      view,
      read,
      seen
    );
    if (inherited !== null)
      for (const name of inherited) parsed.names.add(name);
  }
  return parsed.names;
}

/**
 * Findings for shipped-to-shipped named imports that do not resolve.
 *
 * A specifier that resolves to nothing shipped is NOT a finding: the consumer's
 * own tree may provide it, and this repository cannot see that. What is a
 * finding is a target that IS shipped and does not export the requested name -
 * the shape that fails at module link time with "does not provide an export
 * named X".
 *
 * @param {{ shipped: Map<string, object>, read: (file: string) => string }} input
 *   files at HEAD and a blob reader.
 * @returns {Array<Record<string, unknown>>} one row per missing name.
 */
export function findUnresolvedImports(input) {
  const rows = new Map();
  for (const stack of new Set([...input.shipped.values()].map(m => m.stack))) {
    const view = deliveryView(stack, input.shipped);
    for (const [destination, file] of view) {
      if (!MODULE_EXTENSIONS.includes(path.posix.extname(file))) continue;
      for (const request of parseRelativeNamedImports(input.read(file))) {
        const target = resolveRelative(destination, request.specifier);
        const offered = viewExports(target, view, input.read);
        if (offered === null) continue;
        for (const name of request.names) {
          if (offered.has(name)) continue;
          const row = {
            export: name,
            path: file,
            stack,
            target: view.get(target),
          };
          rows.set(`${file} ${name} ${stack}`, row);
        }
      }
    }
  }
  return [...rows.values()].sort((left, right) =>
    `${left.path} ${left.export}`.localeCompare(`${right.path} ${right.export}`)
  );
}

/**
 * Ledger entries contradicted by HEAD: a path or symbol recorded as removed
 * that is in fact still shipped. Left unchecked, these accumulate and start
 * pre-authorising removals nobody reviewed.
 *
 * Entries that match no removal inside the window are NOT reported - they are
 * the historical record, and are meant to outlive the baseline.
 *
 * @param {{ removals: ReadonlyArray<Record<string, unknown>>, shipped: Map<string, object>, read: (file: string) => string }} input
 *   the ledger and files at HEAD.
 * @returns {Array<Record<string, unknown>>} one row per contradicted entry.
 */
export function findContradictedLedger(input) {
  const rows = [];
  for (const entry of input.removals) {
    const present = input.shipped.has(entry.path);
    if (entry.export === undefined) {
      if (present) rows.push({ kind: "still-shipped", path: entry.path });
      continue;
    }
    if (!present) continue;
    if (!parseNamedExports(input.read(entry.path)).names.has(entry.export))
      continue;
    rows.push({
      export: entry.export,
      kind: "still-exported",
      path: entry.path,
    });
  }
  return rows;
}

/**
 * Assemble the machine-readable report.
 *
 * @param {{ paths: Array<object>, exports: Array<object>, imports: Array<object>, ledger: Array<object> }} findings
 *   every detector's rows.
 * @param {{ root: string, baseline: string, shipped: number, recorded: number }} opts
 *   resolved options plus scan size.
 * @returns {{ baseline: string, findings: object, root: string, schemaVersion: number, summary: { contradictedLedgerEntries: number, recordedRemovals: number, shippedFiles: number, unresolvedImports: number, ungovernedExports: number, ungovernedPaths: number, violations: number } }} the report object.
 */
export function buildReport(findings, opts) {
  const total =
    findings.paths.length +
    findings.exports.length +
    findings.imports.length +
    findings.ledger.length;
  return {
    baseline: opts.baseline,
    // The ref the ledger asked for, when it is NOT the one that was used. Null
    // on every ordinary run, so a reader who sees it knows the window moved.
    baselineReplaced: opts.replaced ?? null,
    findings,
    root: opts.root,
    schemaVersion: 1,
    summary: {
      contradictedLedgerEntries: findings.ledger.length,
      recordedRemovals: opts.recorded,
      shippedFiles: opts.shipped,
      unresolvedImports: findings.imports.length,
      ungovernedExports: findings.exports.length,
      ungovernedPaths: findings.paths.length,
      violations: total,
    },
  };
}

/**
 * Render the human-readable report. Each line names the surface that changed
 * and the consequence for a host, because "removal governance failed" is not
 * something an operator can act on.
 *
 * @param {Record<string, unknown>} report - the report object.
 * @returns {string} the rendered report.
 */
export function humanReport(report) {
  const { findings, summary } = report;
  // Printed on BOTH arms. A window that is not the configured one changes what
  // a pass and a failure each mean, so a reader must not have to reach the JSON
  // to find out which window they are reading.
  const substitution =
    report.baselineReplaced === null || report.baselineReplaced === undefined
      ? []
      : [
          `  NOTE baseline ${report.baselineReplaced} is not an ancestor of ` +
            `HEAD, so the oldest reachable release tag ${report.baseline} was ` +
            `used instead. Re-pin ${LEDGER_PATH} rather than moving the tag.`,
        ];
  if (summary.violations === 0) {
    return [
      `OK ${summary.shippedFiles} shipped file(s) since ${report.baseline}:`,
      `  every removal from a shipped surface is governed`,
      `  (${summary.recordedRemovals} removal(s) recorded in ${LEDGER_PATH})`,
      ...substitution,
    ].join("\n");
  }
  return [
    ...substitution,
    ...findings.paths.map(
      row =>
        `FAIL ${row.path}\n` +
        `    removed in ${row.release}; destination ${row.destination}\n` +
        `    ${row.reason}`
    ),
    ...findings.exports.map(
      row =>
        `FAIL ${row.path} no longer exports ${row.export}\n` +
        `    removed in ${row.release}; ${row.importers} shipped importer(s) ` +
        `remain, and host importers cannot be counted from here\n` +
        `    A host importing ${row.export} fails at module link time with ` +
        `"does not provide an export named '${row.export}'", in whichever job ` +
        `runs the importer first. Record it in ${LEDGER_PATH} with a note ` +
        `saying what a host should do instead.`
    ),
    ...findings.imports.map(
      row =>
        `FAIL ${row.path} imports ${row.export} from ${row.target}\n` +
        `    which does not export it (delivery view of stack ${row.stack})`
    ),
    ...findings.ledger.map(
      row =>
        `FAIL ${LEDGER_PATH} records ${removalKey(row.path, row.export)} as ` +
        `removed, but it is still shipped at HEAD`
    ),
    "",
    `${summary.violations} ungoverned change(s) to a shipped surface.`,
    "The copy lanes overwrite and never delete, so a removal made here reaches",
    "an installed base only through a deletions manifest or a migration. A",
    "removal with neither does nothing downstream, silently, while looking",
    "complete in the diff.",
  ].join("\n");
}

/**
 * Parse argv into resolved options. Throws `UsageError` on a bad invocation.
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @returns {{ root: string, since: string | null, json: boolean }} options.
 */
export function parseArgs(argv) {
  let root = null;
  let since = null;
  let json = false;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg !== "--root" && arg !== "--since") {
      throw new UsageError(`unknown argument: ${arg}`);
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      throw new UsageError(`${arg} requires a value`);
    }
    if (arg === "--root") root = next;
    else since = next;
    index += 1;
  }
  return { json, root: path.resolve(root ?? REPO_ROOT), since };
}

/**
 * Count, per shipped module, how many DISTINCT other shipped modules import
 * from it.
 *
 * Distinct by importer path, not by resolution: a module reachable from
 * several stack views would otherwise be counted once per view, and the number
 * printed in a finding has to mean "files", because that is how a reader will
 * read it.
 *
 * @param {Map<string, { destination: string, stack: string }>} shipped - files at HEAD.
 * @param {(file: string) => string} read - reads a repo path at HEAD.
 * @returns {Map<string, number>} repo path to importer count.
 */
export function countImporters(shipped, read) {
  const importers = new Map();
  for (const stack of new Set([...shipped.values()].map(meta => meta.stack))) {
    const view = deliveryView(stack, shipped);
    for (const [destination, file] of view) {
      if (!MODULE_EXTENSIONS.includes(path.posix.extname(file))) continue;
      for (const request of parseRelativeNamedImports(read(file))) {
        const target = view.get(
          resolveRelative(destination, request.specifier)
        );
        if (target === undefined || target === file) continue;
        if (!importers.has(target)) importers.set(target, new Set());
        importers.get(target).add(file);
      }
    }
  }
  return new Map([...importers].map(([file, set]) => [file, set.size]));
}

/**
 * Run every detector against a resolved repository.
 *
 * @param {{ root: string, since: string | null }} opts - resolved options.
 * @returns {Record<string, unknown>} the report object.
 */
export function scan(opts) {
  const ledger = loadLedger(opts.root);
  const resolved = resolveBaseline(
    opts.root,
    opts.since ?? ledger.baseline,
    opts.since === null || opts.since === undefined
  );
  const baseline = resolved.sha;
  const before = shippedFilesAt(opts.root, baseline);
  const after = shippedFilesAt(opts.root, "HEAD");
  if (after.size === 0) {
    throw new UsageError(
      `no shipped files found under ${opts.root} - refusing to report a clean ` +
        `scan of a tree this gate could not read`
    );
  }
  const read = file => showFile(opts.root, "HEAD", file);
  const index = indexRemovals(ledger.removals);
  const findings = {
    exports: findRemovedExports({
      after,
      baseline,
      before,
      importers: countImporters(after, read),
      ledger: index,
      root: opts.root,
    }),
    imports: findUnresolvedImports({ read, shipped: after }),
    ledger: findContradictedLedger({
      read,
      removals: ledger.removals,
      shipped: after,
    }),
    paths: findRemovedPaths({
      after,
      baseline,
      before,
      ledger: index,
      manifests: readDeletionManifests(opts.root),
      root: opts.root,
    }),
  };
  return buildReport(findings, {
    baseline: resolved.ref,
    recorded: ledger.removals.length,
    replaced: resolved.substituted ? resolved.requested : null,
    root: opts.root,
    shipped: after.size,
  });
}

/**
 * Run the gate. Returns the process exit code (does not call `exit`).
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @param {{ stdout?: { write(s: string): void }, stderr?: { write(s: string): void } }} [io]
 *   injectable streams (defaults to process streams).
 * @returns {number} exit code (0 clean, 1 finding, 2 usage/unverifiable).
 */
export function main(argv, io = {}) {
  const out = io.stdout ?? process.stdout;
  const err = io.stderr ?? process.stderr;
  let report;
  try {
    const opts = parseArgs(argv);
    if (!fs.existsSync(opts.root) || !fs.statSync(opts.root).isDirectory()) {
      throw new UsageError(`--root ${opts.root} is not a directory`);
    }
    report = scan(opts);
  } catch (error) {
    if (error instanceof UsageError) {
      err.write(`check-shipped-surface-removals: ${error.message}\n`);
      return 2;
    }
    throw error;
  }
  const rendered = argv.includes("--json")
    ? JSON.stringify(report, null, 2)
    : humanReport(report);
  out.write(`${rendered}\n`);
  return report.summary.violations === 0 ? 0 : 1;
}

if (invokedAsScript(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
