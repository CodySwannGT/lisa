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
  /** Why `task` does not resolve on every npm stack; absent when it does. */
  readonly declareOnly?: string;
  /** The script a template already ships for this concern, where one exists. */
  readonly shippedAs?: string;
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
  /**
   * The `shippedAs` substitution that produced `task`, or null.
   *
   * Non-null only when the concern-named default resolves to no script in this
   * project and the template's own prover does. Two scripts can back one gate,
   * so a caller reporting what ran has to be able to name both.
   */
  readonly alias?: { readonly from: string; readonly to: string } | null;
  /**
   * The caller chain this declaration named for itself, raw as declared.
   *
   * Optional because a consumer may hold an older copy of the shipped registry
   * that predates the field. Absent reads as "no override", which is what every
   * registry before it meant.
   */
  readonly callerChain?: readonly string[] | string | null;
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
  /**
   * Jobs that prove a gate another job carries the label for.
   *
   * Optional because a consumer may hold an older copy of the shipped registry
   * that predates it. Absent reads as "no secondary provers", which is what
   * every registry before this one meant.
   */
  readonly SECONDARY_PROVER_JOBS?: readonly string[];
  readonly DEFAULT_RUNNER: string;
  readonly readGates: (cwd: string) => ParsedGateConfig;
  readonly validateGates: (gates: Record<string, unknown>) => string[];
  readonly resolveMoment: (options: {
    gates: Record<string, unknown>;
    moment: string;
    runner?: string;
    includeOff?: boolean;
    /**
     * The project's `package.json` scripts. Omitted or `null` means UNKNOWN,
     * and an unknown manifest resolves exactly as it did before `shippedAs`
     * was consulted — silence must not change an answer.
     */
    scripts?: Readonly<Record<string, string>> | null;
  }) => ResolvedGate[];
  readonly contextsFor: (
    gates: Record<string, unknown>,
    options?: { moment?: string; workflowName?: string }
  ) => string[];
  /**
   * Join one declaration's own caller chain into the prefix its context takes.
   *
   * Optional for the same reason `callerChain` is, and its absence is never a
   * licence to join the chain at the call site: a second implementation of the
   * joining rule is how a rename lands in one derivation and not the other.
   */
  readonly callerPrefix?: (chain: readonly string[] | string) => string;
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
 * Locate the running Lisa package's root.
 *
 * Derived from the registry's own location rather than walked a second time.
 * Two walks would be two answers to "where is Lisa", and the one that went
 * stale would be the one nobody measured.
 * @returns Absolute package root, or null when the registry cannot be found
 */
export function resolveLisaPackageRoot(): string | null {
  const registry = resolveGateRegistryPath();
  if (registry === null) return null;
  // <root>/all/copy-overwrite/scripts/lisa-gates.mjs -> <root>
  return path.resolve(path.dirname(registry), "..", "..", "..");
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

/**
 * Join a declaration's own caller chain, or answer null when it named none.
 *
 * Null rather than a throw, unlike the drift comparator: this builds one cell
 * of a report an operator reads, and a whole report withheld over one gate is
 * worse than that gate's expected context reading as the caller-wide name.
 * The chain has already been refused at declaration time by `validateGates`,
 * and the drift comparator — the surface a ruleset is actually reconciled
 * against — still fails closed.
 * @param registry - The shipped registry
 * @param chain - The declared override, when there is one
 * @returns The joined prefix, or null
 */
export function declaredCallerPrefix(
  registry: GateRegistryModule,
  chain: readonly string[] | string | null | undefined
): string | null {
  if (chain === null || chain === undefined) return null;
  if (registry.callerPrefix === undefined) return null;
  try {
    return registry.callerPrefix(chain);
  } catch {
    return null;
  }
}
