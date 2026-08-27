/**
 * Doctor check: is this project running the enforcement guards it shipped with,
 * or an older copy?
 *
 * Apply now refreshes Lisa-owned artifacts on a version bump, so in the normal
 * case this check is quiet. It exists because the fleet had no way to notice the
 * abnormal case. Before the apply fix, a project could sit for months on a guard
 * with a known fail-open hole and nothing anywhere said so — not the apply
 * summary, not doctor, not CI. It can still happen: a project that pinned an old
 * Lisa, or listed the path in `.lisaignore`, or never re-applied after upgrading,
 * keeps whatever it has. This turns that silence into one warn line naming the
 * files.
 *
 * Warn, not fail: a stale guard is a real hole, but the remedy is one command,
 * and failing doctor would redden CI in every repo mid-upgrade.
 * @module cli/doctor-lisa-owned-artifacts
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { ProjectType } from "../core/config.js";
import {
  classifyHostCopy,
  mayRefreshLisaOwned,
} from "../core/lisa-owned-provenance.js";
import type { HashLedger } from "../core/lisa-owned-provenance.js";
import { isLisaSourceRepo } from "../core/self-apply.js";
import { DetectorRegistry } from "../detection/index.js";
import {
  matchesAnyPattern,
  parseIgnorePatterns,
} from "../utils/ignore-patterns.js";
import {
  describeResolvableCopies,
  type MultiCopyArtifact,
} from "./doctor-lisa-owned-artifact-copies.js";
import {
  shippedByStack,
  UNIVERSAL_STACK,
  universalDestinations,
} from "./doctor-lisa-owned-universal.js";

const CHECK_NAME = "Lisa enforcement artifacts current?";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Quoted relative module specifiers — `import`/`export from`, `require()`, and
 * a shell `source`/`.` of a sibling path all spell the target the same way.
 * Bounded quantifier keeps the scan linear on large files.
 */
const RELATIVE_SPECIFIER = /["'`](\.\.?\/[^"'`\n]{1,4096})["'`]/g;

/** One doctor check result, structurally identical to `DoctorCheck`. */
interface ArtifactCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/** Per-destination assessment before it is folded into one doctor line. */
interface ArtifactAssessment {
  readonly finding?: readonly [string, Finding];
  readonly multiCopy?: MultiCopyArtifact;
}

/**
 * Resolve the installed Lisa package root, mirroring how apply resolves it.
 * @returns Absolute path to the Lisa package root
 */
function defaultLisaRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

/**
 * Collect every shipped Lisa-owned artifact, keyed by its destination path.
 *
 * A destination can be shipped by more than one stack; all shipped variants are
 * kept so the comparison can accept whichever one the project actually has,
 * rather than guessing which stack won at apply time.
 * @param lisaRoot - Installed Lisa package root
 * @param activeTypes - Detected project stacks whose artifacts apply here
 * @returns Destination path to the shipped source files that produce it
 */
async function shippedArtifacts(
  lisaRoot: string,
  activeTypes: readonly ProjectType[]
): Promise<ReadonlyMap<string, readonly string[]>> {
  const shipped = (
    await Promise.all(
      [UNIVERSAL_STACK, ...activeTypes].map(async type =>
        shippedByStack(lisaRoot, type)
      )
    )
  ).flat();
  const destinations = [
    ...new Set(shipped.map(([destination]) => destination)),
  ];
  return new Map(
    destinations.map(destination => [
      destination,
      shipped
        .filter(([candidate]) => candidate === destination)
        .map(([, source]) => source),
    ])
  );
}

/**
 * Whether the installed file matches any shipped variant of that artifact.
 * @param installed - Bytes currently installed in the project
 * @param sources - Absolute paths of the shipped variants
 * @returns True when the project is running a shipped version
 */
async function matchesAnyShipped(
  installed: Buffer,
  sources: readonly string[]
): Promise<boolean> {
  const shipped = await Promise.all(
    sources.map(async source => readFile(source))
  );
  return shipped.some(candidate => installed.equals(candidate));
}

/**
 * Whether the installed file is a trampoline that re-exports the shipped
 * template instead of copying it.
 *
 * Lisa's own repository is the one host that cannot hold a byte copy of a file
 * it also ships: the working copy and the template would be two editable
 * originals of the same guard, free to diverge. It keeps a few-line entrypoint
 * that re-exports the template, so its hooks and CI run the exact bytes the
 * fleet gets. Byte comparison necessarily calls that drift; it is the opposite.
 *
 * Proof, not pattern-match: the specifier is resolved against the installed
 * file's own directory and must land exactly on a shipped variant of this same
 * destination. A stub pointing anywhere else is still drift.
 * @param installed - Bytes currently installed in the project
 * @param installedPath - Absolute path of the installed file
 * @param sources - Absolute paths of the shipped variants
 * @returns True when the installed file defers to a shipped variant
 */
function reExportsShippedTemplate(
  installed: Buffer,
  installedPath: string,
  sources: readonly string[]
): boolean {
  const shipped = new Set(sources.map(source => path.resolve(source)));
  const directory = path.dirname(installedPath);
  return [...installed.toString("utf8").matchAll(RELATIVE_SPECIFIER)].some(
    match => shipped.has(path.resolve(directory, match[1] ?? ""))
  );
}

/**
 * Report Lisa-owned enforcement artifacts that differ from what Lisa ships.
 *
 * Two different findings, deliberately not merged. An *outdated* copy is fixed
 * by running apply. A *modified* copy is one apply will now refuse to touch, so
 * telling the operator to run apply would send them round a loop that never
 * terminates and make the protection look like a bug. Both still warn — a guard
 * nobody can account for is worth a line either way, and staying silent about a
 * downstream edit would let a project quietly swap a guard for a stub.
 *
 * A third finding covers absence, but only for the universal tree. A missing
 * stack-specific artifact means that stack does not apply here, which is not
 * drift. A missing universal one means apply has not run, and the CI gate that
 * calls it is not running at all.
 * @param targetPath - Project path to inspect
 * @param lisaRoot - Installed Lisa package root (injected by tests)
 * @param ledger - Known-good hashes, defaulting to Lisa's shipping history
 * @returns Doctor check result
 */
export async function checkLisaOwnedArtifacts(
  targetPath: string,
  lisaRoot: string = defaultLisaRoot(),
  ledger?: HashLedger
): Promise<ArtifactCheck> {
  const detectors = new DetectorRegistry();
  const activeTypes = detectors.expandAndOrderTypes(
    await detectors.detectAll(targetPath)
  );
  const shipped = await shippedArtifacts(lisaRoot, activeTypes);
  const universal = await universalDestinations(lisaRoot);
  if (shipped.size === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "No Lisa-owned enforcement artifacts are shipped",
    };
  }

  const ignoreText = await readFile(
    path.join(targetPath, ".lisaignore"),
    "utf8"
  ).catch(() => "");
  const ignorePatterns = parseIgnorePatterns(ignoreText);
  // Gating the trampoline exemption on self-host keeps this check byte-for-byte
  // unchanged for every real host project: the branch below is unreachable
  // unless the target's package.json is Lisa itself. A host must not be able to
  // swap a guard for a thin re-export and have doctor call it current.
  const selfHost = await isLisaSourceRepo(targetPath);

  const results: readonly (ArtifactAssessment | undefined)[] =
    await Promise.all(
      [...shipped].map(async ([destination, sources]) =>
        assessArtifact(
          targetPath,
          lisaRoot,
          destination,
          sources,
          ignorePatterns,
          selfHost,
          universal.has(destination),
          ledger
        )
      )
    );
  const assessments = results.filter(
    (item): item is ArtifactAssessment => item !== undefined
  );
  return summarise(
    assessments
      .map(item => item.finding)
      .filter((item): item is readonly [string, Finding] => item !== undefined),
    assessments
      .map(item => item.multiCopy)
      .filter((item): item is MultiCopyArtifact => item !== undefined)
  );
}

/**
 * Assess one installed Lisa-owned artifact destination.
 * @param targetPath - Project path to inspect
 * @param lisaRoot - Installed Lisa package root
 * @param destination - Project-relative artifact destination
 * @param sources - Absolute shipped package variants
 * @param ignorePatterns - Parsed .lisaignore patterns
 * @param selfHost - Whether the target is Lisa's own source repository
 * @param universal - Whether every project receives this destination
 * @param ledger - Known-good hashes, defaulting to Lisa's shipping history
 * @returns Per-artifact assessment, or undefined when nothing is reportable
 */
async function assessArtifact(
  targetPath: string,
  lisaRoot: string,
  destination: string,
  sources: readonly string[],
  ignorePatterns: readonly string[],
  selfHost: boolean,
  universal: boolean,
  ledger?: HashLedger
): Promise<ArtifactAssessment | undefined> {
  const installedPath = path.join(targetPath, destination);
  const installed = await readFile(installedPath).catch(() => undefined);
  const ignored = matchesAnyPattern(destination, ignorePatterns);
  if (installed === undefined) {
    return assessAbsent(destination, ignored, universal, selfHost);
  }
  const multiCopy = await describeResolvableCopies(
    lisaRoot,
    destination,
    installed,
    sources
  );
  if (ignored) return withMultiCopy([destination, "ignored"], multiCopy);
  if (await matchesAnyShipped(installed, sources)) {
    return multiCopy === undefined ? undefined : { multiCopy };
  }
  if (selfHost && reExportsShippedTemplate(installed, installedPath, sources)) {
    return undefined;
  }
  const outdated = await isProvablyStale(
    installed,
    destination,
    sources,
    ledger
  );
  return withMultiCopy(
    [destination, outdated ? "stale" : "modified"],
    multiCopy
  );
}

/**
 * Assess a Lisa-owned artifact the project does not have.
 *
 * An absent stack-specific artifact means that stack does not apply here, which
 * is not drift — that exemption is why absence used to report nothing at all.
 * It over-reached: a universal artifact has no stack it does not apply to, so
 * its absence means apply never ran and the CI gate that calls it is not
 * running. Measured on `scripts/lisa-floor-collisions.mjs` (#2731), whose job
 * exited 0 on the missing script — green, having examined nothing, with doctor
 * silent too. Fixing only the job turns a silent pass into a red nobody has
 * been told how to clear.
 *
 * Never for Lisa's own repository: it is the source of these artifacts, not a
 * consumer, and installs only the few it runs on itself, so "apply never ran"
 * is a category error there.
 * @param destination - Project-relative artifact destination
 * @param ignored - Whether .lisaignore names this destination
 * @param universal - Whether every project receives this destination
 * @param selfHost - Whether the target is Lisa's own source repository
 * @returns Per-artifact assessment, or undefined when absence proves nothing
 */
function assessAbsent(
  destination: string,
  ignored: boolean,
  universal: boolean,
  selfHost: boolean
): ArtifactAssessment | undefined {
  if (ignored) {
    return { finding: [destination, "ignored"] as const };
  }
  return universal && !selfHost
    ? { finding: [destination, "missing"] as const }
    : undefined;
}

/**
 * Attach optional multi-copy provenance without materialising undefined fields.
 * @param finding - Artifact finding tuple
 * @param multiCopy - Optional multi-copy provenance
 * @returns Artifact assessment
 */
function withMultiCopy(
  finding: readonly [string, Finding],
  multiCopy: MultiCopyArtifact | undefined
): ArtifactAssessment {
  return multiCopy === undefined ? { finding } : { finding, multiCopy };
}

/** Which finding an artifact produced. */
type Finding = "stale" | "modified" | "ignored" | "missing";

/**
 * Turn the per-artifact findings into one doctor line.
 * @param findings - Destination paths paired with what was found
 * @param multiCopies - Provenance for artifacts reachable from multiple paths
 * @returns Doctor check result
 */
function summarise(
  findings: readonly (readonly [string, Finding])[],
  multiCopies: readonly MultiCopyArtifact[]
): ArtifactCheck {
  const pick = (wanted: Finding): string[] =>
    findings
      .filter(([, finding]) => finding === wanted)
      .map(([destination]) => destination)
      .sort((left, right) => left.localeCompare(right));

  const stale = pick("stale");
  const modified = pick("modified");
  const ignored = pick("ignored");
  const missing = pick("missing");
  const copyDisagreements = multiCopies.filter(copy => copy.disagrees);
  const copyReports = renderCopyReports(multiCopies);
  const warningFree =
    stale.length === 0 &&
    modified.length === 0 &&
    missing.length === 0 &&
    copyDisagreements.length === 0;
  if (warningFree) {
    // Named rather than folded into the pass. A guard excluded by
    // `.lisaignore` was never compared, so claiming it matches asserts
    // something no comparison established — and the file it most often hides
    // is a fork the project has stopped noticing.
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: renderOkDetail(ignored, copyReports),
    };
  }

  const parts = [
    ignored.length > 0
      ? `${ignored.length} not assessed (.lisaignore): ${ignored.join(", ")}`
      : "",
    missing.length > 0
      ? `Lisa-owned guards every project receives are not installed, so the CI gates that call them run against nothing (run \`npx lisa apply .\` to install them): ${missing.join(", ")}`
      : "",
    stale.length > 0
      ? `Outdated Lisa-owned guards (run \`npx lisa apply .\` to refresh): ${stale.join(", ")}`
      : "",
    modified.length > 0
      ? `Lisa-owned guards edited in this project, so apply will keep yours rather than overwrite them: ${modified.join(", ")}`
      : "",
    copyDisagreements.length > 0
      ? `Resolvable Lisa-owned artifact copies disagree: ${renderCopyReports(copyDisagreements, false)}`
      : "",
  ].filter(part => part.length > 0);
  return { name: CHECK_NAME, status: "warn", detail: parts.join(". ") };
}

/**
 * Render the OK detail while preserving the ignored-is-unassessed wording.
 * @param ignored - Paths skipped by .lisaignore
 * @param copyReports - Rendered multi-copy provenance
 * @returns Doctor detail text
 */
function renderOkDetail(
  ignored: readonly string[],
  copyReports: string
): string {
  const suffix = copyReports.length > 0 ? `; ${copyReports}` : "";
  if (ignored.length > 0) {
    return `Enforcement guards match the installed Lisa version; ${ignored.length} not assessed (.lisaignore): ${ignored.join(", ")}${suffix}`;
  }
  return `Enforcement guards match the installed Lisa version${suffix}`;
}

/**
 * Render copy provenance in one operator-readable fragment.
 * @param multiCopies - Multi-copy artifact reports
 * @param includeHeading - Include the generic provenance heading
 * @returns Detail text for multi-copy provenance
 */
function renderCopyReports(
  multiCopies: readonly MultiCopyArtifact[],
  includeHeading = true
): string {
  if (multiCopies.length === 0) return "";
  const reports = multiCopies
    .map(
      artifact =>
        `${artifact.destination} governed by ${artifact.copies.find(copy => copy.governs)?.location ?? "unknown"} first (${artifact.copies
          .map(
            copy =>
              `${copy.location}@${copy.version}${copy.governs ? " governs" : ""}`
          )
          .join(", ")})`
    )
    .join("; ");
  return includeHeading
    ? `Resolvable Lisa-owned artifact copies: ${reports}`
    : reports;
}

/**
 * Whether a differing installed guard is genuinely behind Lisa's.
 *
 * Doctor and apply have to agree, or the operator gets contradictory
 * instructions: doctor telling somebody to run `lisa apply .` to fix a file
 * apply will then deliberately refuse to touch is a loop with no exit, and it
 * reads as a broken tool rather than as the protection it is. So a copy apply
 * would preserve is not reported here either — it is not outdated, and calling
 * it outdated invites the operator to discard their own hardening.
 * @param installed - Bytes currently installed in the project
 * @param destination - Repo-relative destination path
 * @param sources - Absolute paths of the shipped variants
 * @param ledger - Known-good hashes, defaulting to Lisa's shipping history
 * @returns True when every shipped variant considers the installed copy stale
 */
async function isProvablyStale(
  installed: Buffer,
  destination: string,
  sources: readonly string[],
  ledger?: HashLedger
): Promise<boolean> {
  const shipped = await Promise.all(
    sources.map(async source => readFile(source))
  );
  return shipped.every(candidate =>
    mayRefreshLisaOwned(
      classifyHostCopy(destination, installed, candidate, ledger)
    )
  );
}
