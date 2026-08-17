/**
 * Copy provenance helpers for Lisa-owned doctor artifacts.
 * @module cli/doctor-lisa-owned-artifact-copies
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

/** A resolved Lisa-owned artifact copy. */
interface ResolvedArtifactCopy {
  readonly location: string;
  readonly version: string;
  readonly governs: boolean;
}

/** Provenance for an artifact that is reachable from more than one place. */
export interface MultiCopyArtifact {
  readonly destination: string;
  readonly copies: readonly ResolvedArtifactCopy[];
  readonly disagrees: boolean;
}

/**
 * Short content identity for a resolved artifact copy.
 * @param bytes - File contents
 * @returns Human-sized content version
 */
function artifactVersion(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex").slice(0, 12)}`;
}

/**
 * Report all resolvable copies for one installed Lisa-owned artifact.
 * @param lisaRoot - Installed Lisa package root
 * @param destination - Project-relative artifact destination
 * @param installed - Bytes currently installed in the project
 * @param sources - Absolute paths of shipped package variants
 * @returns Multi-copy provenance
 */
export async function describeResolvableCopies(
  lisaRoot: string,
  destination: string,
  installed: Buffer,
  sources: readonly string[]
): Promise<MultiCopyArtifact> {
  const shipped = await Promise.all(
    sources.map(async source => [source, await readFile(source)] as const)
  );
  const copies: ResolvedArtifactCopy[] = [
    {
      location: `project:${destination}`,
      version: artifactVersion(installed),
      governs: true,
    },
    ...shipped.map(([source, bytes]) => ({
      location: `package:${path.relative(lisaRoot, source).split(path.sep).join("/")}`,
      version: artifactVersion(bytes),
      governs: false,
    })),
  ];
  const versions = new Set(copies.map(copy => copy.version));
  return { destination, copies, disagrees: versions.size > 1 };
}
