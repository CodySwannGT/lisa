/**
 * Load the gate registry the report is derived from.
 *
 * Deliberately the running Lisa package's copy rather than the project's
 * `scripts/lisa-gates.mjs`, for the reason `doctor-skip-jobs-migration` already
 * gives: both are the same file in a healthy repository, but a stale project
 * copy answers with a table describing a workflow that is no longer there. It
 * matters twice over here — this repository's own `scripts/` holds neither
 * shipped script, so a report that read the project copy would report nothing
 * at all when run against Lisa itself.
 * @module cli/gate-report-registry
 */
import { existsSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Package-relative location of the shipped registry. */
const REGISTRY_RELATIVE = path.join(
  "all",
  "copy-overwrite",
  "scripts",
  "lisa-gates.mjs"
);

/** One gate as the shipped registry defines it. */
export interface RegistryGate {
  readonly label: string;
  readonly summary: string;
  readonly task?: string;
  readonly taskAt?: Readonly<Record<string, string>>;
  readonly moments: readonly string[];
  readonly work?: string;
  readonly costly?: boolean;
  readonly mayRewrite?: boolean;
}

/** One gate as `resolveMoment` returns it. */
export interface ResolvedGate {
  readonly id: string;
  readonly level: string;
  readonly mode: string;
  readonly awaits: string | null;
  readonly task: string | null;
  readonly command: string | null;
  readonly label: string;
}

/** One `skip_jobs` token's migration. */
export interface SkipJobResolution {
  readonly token: string;
  readonly status: string;
  readonly gate: string | null;
  readonly declaration: string | null;
}

/** The config `readGates` parses out of `.lisa.config.json`. */
export interface ParsedGateConfig {
  readonly runner: string;
  readonly gates: Record<string, unknown>;
}

/** The slice of the shipped registry this report calls. */
export interface GateRegistryModule {
  readonly REGISTRY: Readonly<Record<string, RegistryGate>>;
  readonly MOMENTS: readonly string[];
  readonly MOMENT_FAMILIES: readonly string[];
  readonly INTERCEPTORS: Readonly<Record<string, string>>;
  readonly QUALITY_JOB_GATES: Readonly<Record<string, string>>;
  readonly DEFAULT_RUNNER: string;
  readonly readGates: (cwd: string) => ParsedGateConfig;
  readonly validateGates: (gates: Record<string, unknown>) => string[];
  readonly resolveMoment: (options: {
    gates: Record<string, unknown>;
    moment: string;
    runner?: string;
    includeOff?: boolean;
  }) => ResolvedGate[];
  readonly contextsFor: (
    gates: Record<string, unknown>,
    options?: { moment?: string; workflowName?: string }
  ) => string[];
  readonly isMoment: (moment: string) => boolean;
  readonly momentFamily: (moment: string) => string;
  readonly skipJobMigration: (
    token: string,
    moment: string
  ) => SkipJobResolution;
}

/**
 * Walk parents until a package-root-relative file exists.
 * @param startDir - Directory to start searching from
 * @param relativePath - Path under the package root
 * @returns Absolute path, or null when no ancestor holds it
 */
function walkForPackageFile(
  startDir: string,
  relativePath: string
): string | null {
  const candidate = path.join(startDir, relativePath);
  if (existsSync(candidate)) return candidate;
  const parent = path.dirname(startDir);
  return parent === startDir ? null : walkForPackageFile(parent, relativePath);
}

/**
 * Locate the shipped registry inside the running Lisa package.
 * @returns Absolute path, or null when it cannot be found
 */
export function resolveGateRegistryPath(): string | null {
  const fromPackageRoot = path.join(__dirname, "..", "..", REGISTRY_RELATIVE);
  if (existsSync(fromPackageRoot)) return fromPackageRoot;
  return walkForPackageFile(__dirname, REGISTRY_RELATIVE);
}

/**
 * Import the shipped registry.
 * @returns The registry module, or null when it is not installed
 */
export async function loadGateRegistry(): Promise<GateRegistryModule | null> {
  const script = resolveGateRegistryPath();
  if (script === null) return null;
  return (await import(
    pathToFileURL(script).href
  )) as unknown as GateRegistryModule;
}
