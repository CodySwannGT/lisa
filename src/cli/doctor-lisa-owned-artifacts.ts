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
import { listFilesRecursive } from "../utils/file-operations.js";
import {
  matchesAnyPattern,
  parseIgnorePatterns,
} from "../utils/ignore-patterns.js";

const CHECK_NAME = "Lisa enforcement artifacts current?";
const COPY_OVERWRITE = "copy-overwrite";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  const results = await Promise.all(
    [...shipped].map(async ([destination, sources]) => {
      if (matchesAnyPattern(destination, ignorePatterns)) return undefined;
      const installed = await readFile(
        path.join(targetPath, destination)
      ).catch(() => undefined);
      if (installed === undefined) return undefined;
      return (await matchesAnyShipped(installed, sources))
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
