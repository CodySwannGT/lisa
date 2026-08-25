#!/usr/bin/env node
/**
 * Assert that every package path a workflow references exists in the RELEASED
 * package, not merely in this source tree (issue #2960).
 *
 * Consumers reference the reusable workflow at `@main`, so a workflow edit
 * reaches them immediately. Consumers also version-pin `@codyswann/lisa`, so
 * the package on their disk is whatever release they last upgraded to. Every
 * consumer therefore runs TODAY'S workflow against an OLDER package, and any
 * workflow step resolving a path under `node_modules/@codyswann/lisa/` is
 * making a claim about the layout of a *released* package.
 *
 * Nothing verified that claim. #2951 proved the cost: a prover moved between
 * directories 72 minutes after a release, the workflow was updated to the new
 * path in the same commit as the move — correct against the source tree,
 * correct against the *next* release, wrong against every consumer already
 * installed — and the gate then failed closed fleet-wide on clean trees.
 *
 * Lisa's own CI could not have caught it, and that is structural rather than an
 * oversight: **Lisa is the one repository where the host-relative candidate
 * resolves**, so its own run of that step found the prover in its checkout no
 * matter what the package contained. Every test that asked "does this gate pass
 * here?" answered yes throughout. Only a released tarball can answer the
 * question this script asks, which is why it reads one.
 *
 * ## What counts as satisfied
 *
 * Paths are grouped **by workflow step**, and a step passes a release when AT
 * LEAST ONE of its package paths exists there. That is the transition escape
 * hatch, and it is deliberately the only one: a deliberate layout change is
 * expressed by referencing both locations across the move, which is what #2951
 * ended up doing by hand. There is no allowlist and no override flag — an
 * override is a way to record that you know, and this gate wants you to record
 * it in the workflow, where the next reader sees it.
 *
 * HOST-relative candidates in the same step (`scripts/foo.mjs`) do not count
 * and are never extracted. A host-relative fallback is exactly what made #2951
 * invisible here, so it cannot be what rescues a step from this check.
 *
 * ## Existence is not the contract (#2982)
 *
 * Existence is necessary and NOT sufficient. A file can keep its path and
 * change its contract: greening the path in #2951 produced a prover that
 * scanned zero tracked files and reported success, which was strictly worse
 * than the red it replaced. Only the PATH is legible from a workflow, so the
 * contract needs a DECLARATION — which #2960 said it did not have and would not
 * invent, and which #2982 added alongside the floor in the same file.
 *
 * Every package path a step resolves now declares what the artifact there is.
 * `reference` means the step does not run it (a directory named in error
 * prose), and existence is the whole claim. `executed` means the step runs it,
 * and carries at least one probe: an invocation of the RELEASED artifact — out
 * of the tarball, never this checkout, because running the local copy
 * reproduces exactly the blindness #2951 had — plus a signal that proves the
 * run was not vacuous. An undeclared path FAILS, so a new one forces a decision
 * instead of inheriting silence. See `scripts/lib/workflow-contract-probe.mjs`
 * for the two probe shapes and what each one's count means.
 *
 * ## Refusing to pass on nothing
 *
 * Discovering zero workflows, extracting zero package paths, or — wherever
 * released artifacts are available to run — executing zero contract probes is
 * exit 2 and never a clean pass. So is a registry it could not reach, and so is
 * a probe killed at its deadline, because a killed child returns empty streams
 * and would otherwise read as an artifact that emitted no signal. A gate that
 * passes because it did nothing is the failure this file exists to prevent, and
 * it would be perverse to reproduce it here. Every run prints how many paths it
 * examined and how many probes it executed.
 *
 * CLI:
 *   node scripts/check-workflow-package-paths.mjs [--root <dir>]
 *        [--releases <n>] [--listing <file>] [--extracted <dir>] [--json]
 *
 * With no flags it reads the floor declared in
 * `.github/workflow-package-floor.json`, the latest release, and one midpoint
 * between them. `--releases <n>` reads the most recent n instead, which is an
 * ad-hoc sweep rather than the promise CI enforces.
 *
 * `--listing` supplies release file listings from a JSON file instead of the
 * registry (`{ "<version>": ["package/a", ...] }`). It drives the path half
 * offline and supplies no artifacts, so it runs no probes. `--extracted <dir>`
 * supplies already-unpacked releases at `<dir>/<version>/package/...` and drives
 * BOTH halves offline. The networked path is what CI runs, and it always
 * probes.
 *
 * Exit codes:
 *   0 — every step's package paths resolve, and every released artifact a step
 *       executes still honours its declared contract.
 *   1 — a step has no resolvable package path in some release, a resolved path
 *       declares no contract, a declaration names a path nothing references, or
 *       a released artifact violated its declared contract.
 *   2 — operational: unknown flag, a flag missing its value, `--root` absent or
 *       not a git repository, git unavailable, zero workflows discovered, zero
 *       package paths extracted, a malformed declaration, a probe killed at its
 *       deadline, zero probes executed where artifacts were available, or the
 *       registry could not be read.
 *
 * @module scripts/check-workflow-package-paths
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { boundedExecFileSync } from "./lib/bounded-spawn.mjs";
import { invokedAsScript } from "./lib/invoked-as-script.mjs";
import {
  declarationGaps,
  probeReleases,
  readContractDeclaration,
} from "./lib/workflow-contract-probe.mjs";

/** The package whose released layout a workflow may make claims about. */
const PACKAGE_NAME = "@codyswann/lisa";

/** How a workflow spells a path inside the installed package. */
const PACKAGE_PREFIX = `node_modules/${PACKAGE_NAME}/`;

/**
 * Where the compatibility floor is declared.
 * @remarks
 * A COUNT of recent releases answers nothing here. Measured 2026-08-23: this
 * package published ~15 releases a day and 365 in thirty days, so "the last 3"
 * spans about five hours. Downloading thirty days of tarballs is ~3.6 GB, so a
 * true window is not affordable either. What is affordable, and what the
 * question actually needs, is a DECLARED floor — the oldest release the
 * workflows promise to keep working against. That is a decision, recorded where
 * the next person can read and argue with it, rather than a number nobody
 * chose.
 */
const FLOOR_CONFIG = path.join(".github", "workflow-package-floor.json");

/** Every path literal, file or directory, that names something in the package. */
const PATH_LITERAL = new RegExp(
  `${PACKAGE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[A-Za-z0-9_@./-]*`,
  "g"
);

/** A trailing segment that names a file rather than a directory or an ellipsis. */
const FILE_SEGMENT = /^[A-Za-z0-9_@-]+(?:\.[A-Za-z0-9]+)+$/;

/** Exit code for an operational failure — including "I could not look". */
const EXIT_OPERATIONAL = 2;

/**
 * Print usage guidance and exit.
 * @param {string} message - Why the invocation was rejected
 * @returns {never}
 */
function usage(message) {
  process.stderr.write(
    `${message}\n\nUsage: node scripts/check-workflow-package-paths.mjs [--root <dir>] [--releases <n>] [--listing <file>] [--extracted <dir>] [--json]\n`
  );
  process.exit(EXIT_OPERATIONAL);
}

/**
 * Parse argv into options.
 * @param {readonly string[]} argv - Arguments after the script name
 * @returns {{root: string, releases: number|null, listing: string|null, extracted: string|null, json: boolean}}
 */
function parseArgs(argv) {
  const options = {
    root: process.cwd(),
    releases: null,
    listing: null,
    extracted: null,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--json") {
      options.json = true;
      continue;
    }
    const value = argv[index + 1];
    if (
      flag === "--root" ||
      flag === "--releases" ||
      flag === "--listing" ||
      flag === "--extracted"
    ) {
      if (value === undefined) usage(`${flag} needs a value`);
      index += 1;
      if (flag === "--root") options.root = path.resolve(value);
      if (flag === "--listing") options.listing = path.resolve(value);
      if (flag === "--extracted") options.extracted = path.resolve(value);
      if (flag === "--releases") {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isInteger(parsed) || parsed < 1) {
          usage(`--releases needs a positive integer, got ${value}`);
        }
        options.releases = parsed;
      }
      continue;
    }
    usage(`Unknown flag: ${flag}`);
  }
  return options;
}

/**
 * Tracked workflow files, so the scan sees exactly what a release would carry.
 * @param {string} root - Repository root
 * @returns {readonly string[]} Repo-relative workflow paths
 */
function trackedWorkflows(root) {
  const output = boundedExecFileSync(
    "git",
    ["-C", root, "ls-files", ".github/workflows"],
    { encoding: "utf8" }
  );
  return output
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.endsWith(".yml") || line.endsWith(".yaml"));
}

/**
 * Every package path literal in a chunk of workflow text.
 * @remarks
 * A candidate whose last segment is not a filename and which does not end in
 * `/` is prose — `node_modules/@codyswann/lisa/...` appears in a comment
 * explaining the hazard, and treating that as a claim about the package would
 * make the gate's first act a false alarm.
 * @param {string} text - Workflow source or a step's serialised body
 * @returns {readonly string[]} Deduped package paths, order preserved
 */
export function extractPackagePaths(text) {
  const found = (text.match(PATH_LITERAL) ?? [])
    .map(literal => literal.slice(PACKAGE_PREFIX.length))
    .map(rest => rest.replace(/["'\\]+$/, ""))
    .filter(rest => rest.length > 0)
    .filter(rest => {
      if (rest.endsWith("/")) return true;
      const last = rest.slice(rest.lastIndexOf("/") + 1);
      return FILE_SEGMENT.test(last);
    });
  return [...new Set(found)];
}

/**
 * Split a workflow into step-sized chunks of text.
 * @remarks
 * Grouping is by step because that is the unit a transition is expressed in: a
 * `for candidate in "<new>" "<old>"` loop lives inside one step, and the step is
 * satisfied when either resolves. Deliberately textual rather than YAML-aware —
 * a parse that silently dropped a step would under-report, and under-reporting
 * is the failure mode this gate exists to remove. Anything the split fails to
 * attribute is still caught by the whole-file sweep, which is reconciled
 * against the per-step totals.
 * @param {string} source - Workflow file contents
 * @returns {readonly {label: string, text: string}[]} One entry per step
 */
export function splitIntoSteps(source) {
  const lines = source.split("\n");
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s{4,}-\s+(name|uses|run|id):/.test(line))
    .map(({ index }) => index);
  if (starts.length === 0) return [{ label: "whole file", text: source }];
  return starts.map((start, position) => {
    const end = starts[position + 1] ?? lines.length;
    const text = lines.slice(start, end).join("\n");
    const named = /^\s*-\s+name:\s*(.+)$/.exec(lines[start]);
    return {
      label: (named?.[1] ?? `line ${start + 1}`)
        .trim()
        .replace(/^["']|["']$/g, ""),
      text,
    };
  });
}

/**
 * Every step in every tracked workflow that references a package path.
 * @param {string} root - Repository root
 * @returns {{groups: readonly object[], workflowCount: number, pathCount: number, unattributed: readonly string[]}}
 */
export function collectClaims(root) {
  const workflows = trackedWorkflows(root);
  const groups = [];
  const unattributed = [];
  for (const workflow of workflows) {
    const source = readFileSync(path.join(root, workflow), "utf8");
    const wholeFile = new Set(extractPackagePaths(source));
    if (wholeFile.size === 0) continue;
    const attributed = new Set();
    for (const step of splitIntoSteps(source)) {
      const paths = extractPackagePaths(step.text);
      if (paths.length === 0) continue;
      for (const found of paths) attributed.add(found);
      groups.push({ workflow, step: step.label, paths });
    }
    for (const found of wholeFile) {
      if (!attributed.has(found)) unattributed.push(`${workflow}: ${found}`);
    }
  }
  const pathCount = new Set(groups.flatMap(group => group.paths)).size;
  return {
    groups,
    workflowCount: workflows.length,
    pathCount,
    unattributed,
  };
}

/**
 * The published stable versions, oldest first.
 * @returns {readonly string[]} Stable versions in publish order
 */
function publishedVersions() {
  const versions = JSON.parse(
    boundedExecFileSync("npm", ["view", PACKAGE_NAME, "versions", "--json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    })
  );
  return versions.filter(version => !version.includes("-"));
}

/**
 * Choose which releases to read.
 * @remarks
 * The floor and the latest release are the two ends of the promise, and the
 * midpoint is one interior sample — cheap insurance against a path that
 * vanished and came back inside the range, which the two ends alone would miss.
 * Three tarballs, cached, rather than the hundreds a real time window would
 * cost.
 * @param {readonly string[]} versions - Stable versions in publish order
 * @param {string} floor - The declared compatibility floor
 * @param {number|null} recent - Override: read the most recent N instead
 * @returns {readonly string[]} Versions to read
 * @throws {Error} When the floor is not a published version
 */
function chooseReleases(versions, floor, recent) {
  if (recent !== null) return versions.slice(-recent);
  const start = versions.indexOf(floor);
  if (start === -1) {
    throw new Error(
      `${FLOOR_CONFIG} declares floor ${floor}, which is not a published version of ${PACKAGE_NAME}`
    );
  }
  const range = versions.slice(start);
  const midpoint = range[Math.floor((range.length - 1) / 2)];
  return [...new Set([range[0], midpoint, range[range.length - 1]])];
}

/**
 * Read the declaration that governs this check: the floor and the contracts.
 * @remarks
 * One file, two properties of the same promise. #2960 declared how far back the
 * workflows keep working; #2982 declared what the artifacts there must still
 * do. Splitting them into two files would give one property two declaration
 * surfaces, which is this repository's recurring defect.
 * @param {string} root - Repository root
 * @returns {{floor: string, contracts: Record<string, object>, fixtures: Record<string, object>}}
 * @throws {Error} When the declaration is missing or malformed
 */
function readDeclaration(root) {
  const file = path.join(root, FLOOR_CONFIG);
  if (!existsSync(file)) {
    throw new Error(
      `${FLOOR_CONFIG} is missing. It declares the oldest release these workflows promise to keep working against, and what each artifact they resolve must still do; without it this check would be guessing, and a guessed floor is how a gate ends up measuring nothing.`
    );
  }
  const declared = JSON.parse(readFileSync(file, "utf8"));
  if (typeof declared.floor !== "string" || declared.floor.length === 0) {
    throw new Error(`${FLOOR_CONFIG} has no string "floor"`);
  }
  const { contracts, fixtures } = readContractDeclaration(declared);
  return { floor: declared.floor, contracts, fixtures };
}

/**
 * Every file under a directory, as `/`-separated paths relative to it.
 * @param {string} root - Directory to walk
 * @param {string} prefix - Accumulated relative prefix
 * @returns {readonly string[]} Relative file paths
 */
function walkFiles(root, prefix = "") {
  return readdirSync(path.join(root, prefix), { withFileTypes: true }).flatMap(
    entry => {
      const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      return entry.isDirectory()
        ? walkFiles(root, relative)
        : [`package/${relative}`];
    }
  );
}

/**
 * Read already-unpacked releases from `<dir>/<version>/package/`.
 * @param {string} dir - Directory holding one subdirectory per version
 * @returns {Record<string, {entries: readonly string[], root: string|null}>}
 */
function readExtractedReleases(dir) {
  return Object.fromEntries(
    readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => {
        const packageRoot = path.join(dir, entry.name, "package");
        return [
          entry.name,
          { entries: walkFiles(packageRoot), root: packageRoot },
        ];
      })
  );
}

/**
 * Download and unpack each chosen release, memoising both.
 * @remarks
 * The tarball is UNPACKED, not merely listed, because a contract probe has to
 * run the released artifact. Measured 2026-08-24: three releases in the current
 * window are ~30 MB compressed and ~175 MB unpacked, downloaded once and cached
 * — the same order of cost #2960 already paid for the listings alone.
 * @param {readonly string[]} chosen - Versions to read
 * @param {string} cacheDir - Where releases are memoised
 * @returns {Record<string, {entries: readonly string[], root: string}>}
 */
function fetchReleases(chosen, cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  const releases = {};
  for (const version of chosen) {
    const unpacked = path.join(cacheDir, version, "package");
    const cached = path.join(cacheDir, `${version}.json`);
    if (existsSync(cached) && existsSync(unpacked)) {
      releases[version] = {
        entries: JSON.parse(readFileSync(cached, "utf8")),
        root: unpacked,
      };
      continue;
    }
    const staging = mkdtempSync(path.join(tmpdir(), "lisa-release-"));
    boundedExecFileSync(
      "npm",
      ["pack", `${PACKAGE_NAME}@${version}`, "--pack-destination", staging],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    const tarball = readdirSync(staging).find(entry => entry.endsWith(".tgz"));
    if (tarball === undefined) {
      throw new Error(`npm pack produced no tarball for ${version}`);
    }
    const archive = path.join(staging, tarball);
    const entries = boundedExecFileSync("tar", ["-tzf", archive], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    })
      .split("\n")
      .filter(Boolean);
    const destination = path.join(cacheDir, version);
    mkdirSync(destination, { recursive: true });
    boundedExecFileSync("tar", ["-xzf", archive, "-C", destination], {
      timeout: 300_000,
    });
    if (!existsSync(unpacked) || !statSync(unpacked).isDirectory()) {
      throw new Error(`unpacking ${version} produced no package/ directory`);
    }
    writeFileSync(cached, JSON.stringify(entries));
    releases[version] = { entries, root: unpacked };
  }
  return releases;
}

/**
 * Does a release contain this package path?
 * @param {readonly string[]} entries - Tarball entries, all `package/`-prefixed
 * @param {string} candidate - Package-relative path, `/`-suffixed for a directory
 * @returns {boolean} True when the release carries it
 */
export function releaseContains(entries, candidate) {
  const target = `package/${candidate}`;
  return candidate.endsWith("/")
    ? entries.some(entry => entry.startsWith(target) && entry !== target)
    : entries.some(entry => entry === target || entry === `${target}/`);
}

/**
 * Judge every step against every release in the window.
 * @param {readonly object[]} groups - Step claims from {@link collectClaims}
 * @param {Record<string, readonly string[]>} listings - Version to entry list
 * @returns {readonly string[]} One operator-readable line per failure
 */
export function findBreakages(groups, listings) {
  return Object.entries(listings).flatMap(([version, entries]) =>
    groups
      .filter(group => !group.paths.some(p => releaseContains(entries, p)))
      .map(
        group =>
          `${version}: ${group.workflow} step "${group.step}" resolves ${group.paths
            .map(p => `${PACKAGE_PREFIX}${p}`)
            .join(
              " or "
            )}, and release ${version} contains none of them. Merging this breaks every consumer still on ${version}.`
      )
  );
}

/**
 * Run the check.
 * @returns {void}
 */
function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(path.join(options.root, ".git"))) {
    usage(`--root is not a git repository: ${options.root}`);
  }

  const claims = collectClaims(options.root);
  if (claims.workflowCount === 0) {
    usage("No tracked workflows found — a scan of nothing is not a pass");
  }
  if (claims.pathCount === 0) {
    usage(
      `No ${PACKAGE_PREFIX} paths found in ${claims.workflowCount} workflows — a scan that examined nothing is not a pass`
    );
  }

  let declaration;
  let releases;
  try {
    declaration = readDeclaration(options.root);
    releases = readReleases(options, declaration.floor);
  } catch (error) {
    usage(
      `Could not read released package layouts: ${error.message}. Refusing to report a clean scan that never ran.`
    );
  }

  const listings = Object.fromEntries(
    Object.entries(releases).map(([version, release]) => [
      version,
      release.entries,
    ])
  );
  const gaps = declarationGaps(claims.groups, declaration.contracts);
  const probeable = Object.entries(releases).filter(
    ([, release]) => release.root !== null
  );
  const contracts =
    gaps.undeclared.length > 0
      ? {
          executed: 0,
          violations: [],
          deferred: [],
          operational: [],
          probed: [],
        }
      : probeReleases({
          groups: claims.groups,
          releases: probeable.map(([version, release]) => ({
            version,
            root: release.root,
            contains: candidate => releaseContains(release.entries, candidate),
          })),
          contracts: declaration.contracts,
          fixtures: declaration.fixtures,
          workRoot: mkdtempSync(path.join(tmpdir(), "lisa-contract-probe-")),
        });

  const breakages = [
    ...findBreakages(claims.groups, listings),
    ...gaps.undeclared,
    ...gaps.stale,
    ...contracts.violations,
  ];
  const report = {
    workflowsExamined: claims.workflowCount,
    packagePathsExamined: claims.pathCount,
    stepsExamined: claims.groups.length,
    releasesExamined: Object.keys(listings),
    contractProbesExecuted: contracts.executed,
    contractProbesDeferred: contracts.deferred,
    contractProbesRun: contracts.probed,
    unattributed: claims.unattributed,
    breakages,
  };

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `Examined ${report.packagePathsExamined} package path(s) across ${report.stepsExamined} step(s) in ${report.workflowsExamined} workflow(s), against release(s) ${report.releasesExamined.join(", ")}. Executed ${report.contractProbesExecuted} contract probe(s).\n`
    );
    for (const line of contracts.deferred)
      process.stdout.write(`  · ${line}\n`);
    for (const line of breakages) process.stdout.write(`  ✗ ${line}\n`);
  }

  if (contracts.operational.length > 0) {
    usage(
      `Contract probes could not be performed:\n  ${contracts.operational.join("\n  ")}`
    );
  }
  if (
    probeable.length > 0 &&
    contracts.executed === 0 &&
    breakages.length === 0
  ) {
    usage(
      `Released artifacts were available and ZERO contract probes ran. An empty inspection and a satisfied contract look identical from here, so this is a failure rather than a pass. Declare a probe on the executed paths in ${FLOOR_CONFIG}.`
    );
  }

  process.exit(breakages.length === 0 ? 0 : 1);
}

/**
 * Resolve the releases to judge against, from whichever source was requested.
 * @param {{listing: string|null, extracted: string|null, releases: number|null, root: string}} options - Parsed flags
 * @param {string} floor - The declared compatibility floor
 * @returns {Record<string, {entries: readonly string[], root: string|null}>} Releases
 */
function readReleases(options, floor) {
  if (options.extracted !== null)
    return readExtractedReleases(options.extracted);
  if (options.listing !== null) {
    const listing = JSON.parse(readFileSync(options.listing, "utf8"));
    return Object.fromEntries(
      Object.entries(listing).map(([version, entries]) => [
        version,
        { entries, root: null },
      ])
    );
  }
  return fetchReleases(
    chooseReleases(publishedVersions(), floor, options.releases),
    path.join(options.root, "node_modules", ".cache", "lisa-releases")
  );
}

if (invokedAsScript(import.meta.url)) {
  main();
}
