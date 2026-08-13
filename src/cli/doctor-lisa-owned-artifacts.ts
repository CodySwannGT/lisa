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
 * Report Lisa-owned enforcement artifacts the project has an outdated copy of.
 *
 * Only artifacts the project already has are considered: a missing one means
 * the stack does not apply here, not that something drifted.
 * @param targetPath - Project path to inspect
 * @param lisaRoot - Installed Lisa package root (injected by tests)
 * @returns Doctor check result
 */
export async function checkLisaOwnedArtifacts(
  targetPath: string,
  lisaRoot: string = defaultLisaRoot()
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
      return selfHost &&
        reExportsShippedTemplate(installed, installedPath, sources)
        ? undefined
        : destination;
    })
  );
  const stale = results
    .filter((item): item is string => item !== undefined)
    .sort((left, right) => left.localeCompare(right));

  return stale.length === 0
    ? {
        name: CHECK_NAME,
        status: "ok",
        detail: "Enforcement guards match the installed Lisa version",
      }
    : {
        name: CHECK_NAME,
        status: "warn",
        detail: `Outdated Lisa-owned guards (run \`npx lisa apply .\` to refresh): ${stale.join(", ")}`,
      };
}
