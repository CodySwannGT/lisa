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
import * as fse from "fs-extra";

import { PROJECT_TYPE_ORDER } from "../core/config.js";
import {
  classifyHostCopy,
  mayRefreshLisaOwned,
} from "../core/lisa-owned-provenance.js";
import type { HashLedger } from "../core/lisa-owned-provenance.js";
import { isLisaOwnedTemplate } from "../core/lisa-owned-templates.js";
import { isLisaSourceRepo } from "../core/self-apply.js";
import { listFilesRecursive } from "../utils/file-operations.js";
import {
  matchesAnyPattern,
  parseIgnorePatterns,
} from "../utils/ignore-patterns.js";

const CHECK_NAME = "Lisa enforcement artifacts current?";
const COPY_OVERWRITE = "copy-overwrite";
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

/** One shipped Lisa-owned artifact and the destination it installs to. */
type ShippedArtifact = readonly [destination: string, source: string];

/**
 * Resolve the installed Lisa package root, mirroring how apply resolves it.
 * @returns Absolute path to the Lisa package root
 */
function defaultLisaRoot(): string {
  return path.resolve(__dirname, "..", "..");
}

/**
 * List the Lisa-owned artifacts one stack's copy-overwrite tree ships.
 * @param lisaRoot - Installed Lisa package root
 * @param type - Stack directory name
 * @returns Destination/source pairs shipped by that stack
 */
async function shippedByStack(
  lisaRoot: string,
  type: string
): Promise<readonly ShippedArtifact[]> {
  const directory = path.join(lisaRoot, type, COPY_OVERWRITE);
  if (!(await fse.pathExists(directory))) return [];
  return (await listFilesRecursive(directory))
    .map(
      source =>
        [
          path.relative(directory, source).split(path.sep).join("/"),
          source,
        ] as const
    )
    .filter(([destination]) => isLisaOwnedTemplate(destination));
}

/**
 * Collect every shipped Lisa-owned artifact, keyed by its destination path.
 *
 * A destination can be shipped by more than one stack; all shipped variants are
 * kept so the comparison can accept whichever one the project actually has,
 * rather than guessing which stack won at apply time.
 * @param lisaRoot - Installed Lisa package root
 * @returns Destination path to the shipped source files that produce it
 */
async function shippedArtifacts(
  lisaRoot: string
): Promise<ReadonlyMap<string, readonly string[]>> {
  const shipped = (
    await Promise.all(
      ["all", ...PROJECT_TYPE_ORDER].map(async type =>
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
 * Only artifacts the project already has are considered: a missing one means
 * the stack does not apply here, not that something drifted.
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
  const shipped = await shippedArtifacts(lisaRoot);
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

  const results = await Promise.all(
    [...shipped].map(async ([destination, sources]) => {
      if (matchesAnyPattern(destination, ignorePatterns)) return undefined;
      const installedPath = path.join(targetPath, destination);
      const installed = await readFile(installedPath).catch(() => undefined);
      if (installed === undefined) return undefined;
      if (await matchesAnyShipped(installed, sources)) return undefined;
      if (
        selfHost &&
        reExportsShippedTemplate(installed, installedPath, sources)
      )
        return undefined;
      const outdated = await isProvablyStale(
        installed,
        destination,
        sources,
        ledger
      );
      return [destination, outdated ? "stale" : "modified"] as const;
    })
  );
  return summarise(
    results.filter(
      (item): item is readonly [string, Finding] => item !== undefined
    )
  );
}

/** Which of the two findings an artifact produced. */
type Finding = "stale" | "modified";

/**
 * Turn the per-artifact findings into one doctor line.
 * @param findings - Destination paths paired with what was found
 * @returns Doctor check result
 */
function summarise(
  findings: readonly (readonly [string, Finding])[]
): ArtifactCheck {
  const pick = (wanted: Finding): string[] =>
    findings
      .filter(([, finding]) => finding === wanted)
      .map(([destination]) => destination)
      .sort((left, right) => left.localeCompare(right));

  const stale = pick("stale");
  const modified = pick("modified");
  if (stale.length === 0 && modified.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "Enforcement guards match the installed Lisa version",
    };
  }

  const parts = [
    stale.length > 0
      ? `Outdated Lisa-owned guards (run \`npx lisa apply .\` to refresh): ${stale.join(", ")}`
      : "",
    modified.length > 0
      ? `Lisa-owned guards edited in this project, so apply will keep yours rather than overwrite them: ${modified.join(", ")}`
      : "",
  ].filter(part => part.length > 0);
  return { name: CHECK_NAME, status: "warn", detail: parts.join(". ") };
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
