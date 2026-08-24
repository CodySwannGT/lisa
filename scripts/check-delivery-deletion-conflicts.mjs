#!/usr/bin/env node
/**
 * Deterministic gate that no path is both DELIVERED by a copy strategy and
 * DELETED by a `deletions.json` that runs in the same `lisa apply` (#2714).
 *
 * Lisa decides what a consumer's tree should contain from two manifests that
 * are authored independently and were never compared with each other:
 *
 *   - delivery lanes — `<stack>/create-only/`, `<stack>/copy-overwrite/`,
 *     `<stack>/copy-contents/`, `<stack>/merge/`, `<stack>/tagged-merge/`,
 *     `<stack>/package-lisa/`;
 *   - deletion manifests — `<stack>/deletions.json`, effective set being
 *     `paths` minus `keep`.
 *
 * When one path lands in both, `apply` creates it and then destroys it in the
 * same run — `processConfigurations()` precedes `processDeletions()` in
 * `src/core/lisa.ts`, and the deletion is unconditional. Nothing errors and
 * nothing warns; the operator sees a file that will not stay put.
 *
 * The class is not hypothetical. Scanning every released tag for this exact
 * shape found 9 distinct conflicts spanning 52 tags, among them
 * `all/copy-overwrite/.claude/rules/coding-philosophy.md` against
 * `all/deletions.json` across v1.67.0..v1.76.6 — `all` is active for every
 * project, so that one shipped to everyone for 32 releases. Each was found by
 * hand, later, by someone who noticed a file behaving oddly.
 *
 * ## Which directions are wrong
 *
 * Two stacks can only collide when both are active in one apply, which means
 * one is an ancestor of the other (`all` is the implicit root; `typescript` is
 * the parent of `cdk`, `expo`, `nestjs`, `phaser`, `harper-fabric`,
 * `npm-package`). The direction decides the verdict, and only two of the four
 * are defects:
 *
 *   - SELF — one stack ships and deletes the same path. A manifest
 *     contradicting itself has no correct reading. Always a finding.
 *   - ANCESTOR-DELETES — a less specific stack deletes what a more specific
 *     one ships. Deletions run last and unconditionally, so the ancestor
 *     destroys a file the child deliberately installed. Always a finding.
 *   - DESCENDANT-DELETES — a more specific stack deletes what an ancestor
 *     ships. This is the DESIGNED child-overrides-parent override, documented
 *     on `loadPendingDeletions()` with the CDK-drops-inherited-jest case as
 *     its worked example. Reported, never a finding.
 *   - UNRELATED — two stacks with no ancestry relation (siblings such as
 *     `expo` and `cdk`). Reported, never a finding. Detection has no mutual
 *     exclusion (`detectAll` pushes every matching detector), so these are a
 *     genuine latent hazard, but resolving them is a design decision about
 *     which test runner wins in a mixed repo rather than an authoring slip.
 *     Deliberately out of this gate's scope; see #2714 "Out of scope".
 *
 * ## Directory entries count
 *
 * `deletions.json` may name a directory (`.claude/skills/jira-create`). The
 * runtime pre-pass compares by exact string, so it does NOT suppress delivery
 * of a file nested under a deleted directory — but `processDeletions()` still
 * removes the whole tree afterwards. That is the same create-then-destroy
 * defect wearing a different spelling, so this gate matches nested paths too
 * and labels them `under-dir`.
 *
 * ## Determinism guarantees
 *
 *   - zero third-party dependencies (Node built-ins only),
 *   - no network access,
 *   - no `Date` / `Math.random`,
 *   - the file list comes from `git ls-files`, so the gate sees exactly what a
 *     release would carry rather than whatever is loose in the working tree.
 *
 * Discovering zero stacks is exit 2, not a clean pass, and a `deletions.json`
 * that will not parse is exit 2 rather than the runtime's silent empty set. A
 * gate that passes because it could not look is the failure mode this file
 * exists to prevent, and reproducing it here would be perverse.
 *
 * CLI:
 *   node scripts/check-delivery-deletion-conflicts.mjs [--root <dir>] [--json]
 *
 * Exit codes (mirroring the sibling parity scripts):
 *   0 — no path is delivered and deleted by stacks active in the same apply.
 *   1 — ≥1 SELF or ANCESTOR-DELETES conflict.
 *   2 — operational/usage error: unknown flag, a flag missing its value,
 *       `--root` absent or not a git repository, git unavailable, zero stacks
 *       discovered, or an unparseable/ill-typed deletions manifest.
 *
 * @module scripts/check-delivery-deletion-conflicts
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

/**
 * Parent of each stack directory. The implicit root `all` is not listed: it is
 * the ancestor of everything and has no parent of its own.
 *
 * Mirrors `PROJECT_TYPE_HIERARCHY` in `src/core/config.ts`. The unit test
 * asserts the two agree, so adding a stack there without adding it here fails
 * a test rather than silently narrowing this gate's reach.
 */
export const STACK_PARENT = Object.freeze({
  cdk: "typescript",
  expo: "typescript",
  "harper-fabric": "typescript",
  nestjs: "typescript",
  "npm-package": "typescript",
  phaser: "typescript",
  rails: undefined,
  typescript: undefined,
});

/** The implicit root stack, processed for every project regardless of type. */
export const ROOT_STACK = "all";

/**
 * Delivery lanes, i.e. every copy strategy that writes a file at a destination
 * path. Mirrors `COPY_STRATEGIES` in `src/core/config.ts`; the unit test
 * asserts the two agree.
 */
export const DELIVERY_LANES = Object.freeze([
  "copy-contents",
  "copy-overwrite",
  "create-only",
  "merge",
  "package-lisa",
  "tagged-merge",
]);

/**
 * `package-lisa` is the one lane whose source filename differs from its
 * destination: `package.lisa.json` governs `package.json`.
 */
const PACKAGE_LISA_SOURCE = "package.lisa.json";
const PACKAGE_LISA_DEST = "package.json";

/** Max bytes of `git ls-files` output (7k+ tracked paths is ~0.3 MB today). */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * Usage error — thrown for an invalid invocation or an unverifiable state so
 * `main` can distinguish it (exit 2) from a finding (exit 1).
 */
export class UsageError extends Error {}

/**
 * The chain of stacks active alongside `stack` in one apply, most specific
 * first, always ending at the implicit root.
 *
 * @param {string} stack - a stack directory name.
 * @returns {string[]} `stack`, its ancestors, and `all`.
 */
export function ancestryChain(stack) {
  const chain = [stack];
  let parent = STACK_PARENT[stack];
  while (parent !== undefined) {
    chain.push(parent);
    parent = STACK_PARENT[parent];
  }
  if (stack !== ROOT_STACK) chain.push(ROOT_STACK);
  return chain;
}

/**
 * Classify one delivered/deleted pair by the ancestry relation between the
 * stack that ships the path and the stack that deletes it.
 *
 * @param {string} shipper - stack whose delivery lane carries the path.
 * @param {string} deleter - stack whose deletions.json removes the path.
 * @returns {"self" | "ancestor-deletes" | "descendant-deletes" | "unrelated"}
 *   the relation; the first two are findings.
 */
export function classifyRelation(shipper, deleter) {
  if (shipper === deleter) return "self";
  if (ancestryChain(shipper).includes(deleter)) return "ancestor-deletes";
  if (ancestryChain(deleter).includes(shipper)) return "descendant-deletes";
  return "unrelated";
}

/** The two relations that make a conflict a defect rather than a design. */
const FORBIDDEN_RELATIONS = Object.freeze(["ancestor-deletes", "self"]);

/**
 * The destination path a lane source file governs. Identity for every lane
 * except `package-lisa`, whose `package.lisa.json` governs `package.json`.
 *
 * @param {string} lane - the delivery lane directory name.
 * @param {string} sourceRelative - path relative to the lane directory.
 * @returns {string} the destination path in the consumer's tree.
 */
export function destinationPath(lane, sourceRelative) {
  return lane === "package-lisa" && sourceRelative === PACKAGE_LISA_SOURCE
    ? PACKAGE_LISA_DEST
    : sourceRelative;
}

/**
 * The set of paths a deletions manifest actually removes: `paths` minus
 * `keep`. Mirrors `pendingDeletionPaths` in `src/core/template-ownership.ts`,
 * except that a manifest this gate cannot read is an error rather than an
 * empty set — see the module remarks.
 *
 * @param {unknown} manifest - the parsed deletions.json value.
 * @param {string} label - the manifest path, for error messages.
 * @returns {Set<string>} paths that will be deleted.
 */
export function effectiveDeletions(manifest, label) {
  if (manifest === null || typeof manifest !== "object") {
    throw new UsageError(`${label}: expected a JSON object`);
  }
  const paths = manifest.paths;
  if (!Array.isArray(paths) || paths.some(entry => typeof entry !== "string")) {
    throw new UsageError(`${label}: "paths" must be an array of strings`);
  }
  const keep = manifest.keep ?? [];
  if (!Array.isArray(keep) || keep.some(entry => typeof entry !== "string")) {
    throw new UsageError(`${label}: "keep" must be an array of strings`);
  }
  const kept = new Set(keep);
  return new Set(paths.filter(entry => !kept.has(entry)));
}

/**
 * How `deleted` covers `delivered`, if at all.
 *
 * @param {string} delivered - a destination path a lane writes.
 * @param {ReadonlySet<string>} deleted - the effective deletion set.
 * @returns {{ kind: "exact" } | { kind: "under-dir", entry: string } | null}
 *   the match, or null when the path survives.
 */
export function matchDeletion(delivered, deleted) {
  if (deleted.has(delivered)) return { kind: "exact" };
  for (const entry of deleted) {
    if (delivered.startsWith(`${entry}/`)) return { entry, kind: "under-dir" };
  }
  return null;
}

/**
 * List every tracked file in `root`, relative to it. Throws `UsageError` when
 * git is unavailable or `root` is not a repository.
 *
 * @param {string} root - the repository root.
 * @returns {string[]} tracked paths, relative to `root`.
 */
function listTrackedFiles(root) {
  let stdout;
  try {
    stdout = boundedExecFileSync("git", ["-C", root, "ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    throw new UsageError(
      `could not list tracked files in ${root}: ${error.message}`
    );
  }
  return stdout.split("\0").filter(entry => entry !== "");
}

/**
 * Group tracked files into per-stack delivery maps and deletion manifests.
 *
 * A stack is any top-level directory carrying a delivery lane or a
 * `deletions.json` — discovered, never listed, so a new stack directory
 * inherits this gate with nobody remembering to register it.
 *
 * @param {readonly string[]} tracked - repo-relative tracked paths.
 * @param {string} root - the repository root, for reading manifests.
 * @returns {{ delivered: Map<string, Map<string, string>>, deletions: Map<string, Set<string>>, stacks: Set<string> }}
 *   delivery maps keyed stack → destination path → lane, effective deletion
 *   sets keyed by stack, and every discovered stack.
 */
export function collectManifests(tracked, root) {
  const delivered = new Map();
  const deletions = new Map();
  const stacks = new Set();
  for (const file of tracked) {
    const segments = file.split("/");
    if (segments.length < 2) continue;
    const [stack, second, ...rest] = segments;
    if (second === "deletions.json" && rest.length === 0) {
      const parsed = readManifest(path.join(root, file), file);
      deletions.set(stack, effectiveDeletions(parsed, file));
      stacks.add(stack);
    } else if (DELIVERY_LANES.includes(second) && rest.length > 0) {
      if (!delivered.has(stack)) delivered.set(stack, new Map());
      delivered.get(stack).set(destinationPath(second, rest.join("/")), second);
      stacks.add(stack);
    }
  }
  return { deletions, delivered, stacks };
}

/**
 * Read and parse one deletions manifest, turning any failure into a
 * `UsageError` so the gate exits 2 instead of scanning an empty set.
 *
 * @param {string} absolute - absolute path to the manifest.
 * @param {string} label - repo-relative path, for error messages.
 * @returns {unknown} the parsed value.
 */
function readManifest(absolute, label) {
  let raw;
  try {
    raw = fs.readFileSync(absolute, "utf8");
  } catch (error) {
    throw new UsageError(`${label}: could not read — ${error.message}`);
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new UsageError(`${label}: could not parse — ${error.message}`);
  }
}

/**
 * Every delivered path covered by some stack's deletion manifest, classified.
 *
 * @param {{ delivered: Map<string, Map<string, string>>, deletions: Map<string, Set<string>> }} manifests
 *   the collected manifests.
 * @returns {Array<Record<string, string>>} one row per conflict, sorted for a
 *   stable report.
 */
export function findConflicts(manifests) {
  const rows = [];
  for (const [deleter, deleted] of manifests.deletions) {
    for (const [shipper, lanes] of manifests.delivered) {
      for (const [destination, lane] of lanes) {
        const match = matchDeletion(destination, deleted);
        if (match === null) continue;
        rows.push({
          deleter,
          destination,
          lane,
          match: match.kind === "exact" ? "exact" : `under-dir(${match.entry})`,
          relation: classifyRelation(shipper, deleter),
          shipper,
        });
      }
    }
  }
  return rows.sort((left, right) =>
    `${left.shipper}/${left.lane}/${left.destination}/${left.deleter}`.localeCompare(
      `${right.shipper}/${right.lane}/${right.destination}/${right.deleter}`
    )
  );
}

/**
 * Assemble the machine-readable report.
 *
 * @param {ReadonlyArray<Record<string, string>>} rows - every classified conflict.
 * @param {{ root: string, stacks: number, delivered: number }} opts - resolved
 *   options plus scan size.
 * @returns {Record<string, unknown>} the report object.
 */
export function buildReport(rows, opts) {
  const violations = rows.filter(row =>
    FORBIDDEN_RELATIONS.includes(row.relation)
  );
  return {
    conflicts: rows,
    root: opts.root,
    schemaVersion: 1,
    summary: {
      allowed: rows.length - violations.length,
      delivered: opts.delivered,
      stacks: opts.stacks,
      violations: violations.length,
    },
    violations,
  };
}

/**
 * Render the human-readable report.
 *
 * @param {Record<string, unknown>} report - the report object.
 * @returns {string} the rendered report.
 */
function humanReport(report) {
  const { summary } = report;
  if (summary.violations === 0) {
    return [
      `✓ ${summary.delivered} delivered path(s) across ${summary.stacks} stack(s):`,
      `  no path is both shipped and deleted by stacks active in the same apply`,
      `  (${summary.allowed} deliberate override(s) reported and allowed)`,
    ].join("\n");
  }
  const lines = report.violations.map(
    row =>
      `✗ ${row.shipper}/${row.lane}/${row.destination}\n` +
      `    deleted by ${row.deleter}/deletions.json [${row.match}] — ${row.relation}`
  );
  return [
    ...lines,
    "",
    `${summary.violations} path(s) are both delivered and deleted in the same apply.`,
    "Deletions run after every delivery lane and are unconditional, so each of",
    "these is created and then destroyed in one run, with no error and no",
    "warning — the operator sees a file that will not stay put.",
    "",
    "Fix by choosing one side: drop the file from the delivery lane, or drop",
    "the entry from deletions.json (or move it into that manifest's `keep`).",
    "",
    "A child stack deleting a path its PARENT ships is the deliberate override",
    "and is not reported here. What is reported is a stack contradicting itself,",
    "or a less specific stack destroying what a more specific one installed.",
  ].join("\n");
}

/**
 * Parse argv into resolved options. Throws `UsageError` on a bad invocation.
 *
 * @param {readonly string[]} argv - arguments (without node/script prefix).
 * @returns {{ root: string, json: boolean }} options.
 */
export function parseArgs(argv) {
  let root = null;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--root") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new UsageError("--root requires a value");
      }
      root = next;
      i += 1;
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  return { json, root: path.resolve(root ?? REPO_ROOT) };
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
  let opts;
  let manifests;
  try {
    opts = parseArgs(argv);
    if (!fs.existsSync(opts.root) || !fs.statSync(opts.root).isDirectory()) {
      throw new UsageError(`--root is not a directory: ${opts.root}`);
    }
    manifests = collectManifests(listTrackedFiles(opts.root), opts.root);
    if (manifests.stacks.size === 0) {
      // Finding nothing to check is a broken invocation, not conformance.
      throw new UsageError(
        `no stack directories found under ${opts.root} — expected paths like ` +
          "typescript/create-only/... or all/deletions.json. Refusing to " +
          "report a clean run for a scan that examined nothing."
      );
    }
  } catch (error) {
    err.write(`error: ${error.message}\n`);
    return 2;
  }

  let delivered = 0;
  for (const lanes of manifests.delivered.values()) delivered += lanes.size;
  const report = buildReport(findConflicts(manifests), {
    delivered,
    root: opts.root,
    stacks: manifests.stacks.size,
  });
  out.write(
    `${opts.json ? JSON.stringify(report, null, 2) : humanReport(report)}\n`
  );
  return report.summary.violations === 0 ? 0 : 1;
}

if (invokedAsScript(import.meta.url)) {
  // exitCode (not process.exit): when stdout is a pipe, writes are async and
  // process.exit() truncates the report mid-flush.
  process.exitCode = main(process.argv.slice(2));
}
