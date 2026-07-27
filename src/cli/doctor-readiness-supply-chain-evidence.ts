/**
 * Evidence builders for the dependencies/supply-chain readiness producer.
 * @module cli/doctor-readiness-supply-chain-evidence
 */
import {
  type DependencySpec,
  isFloatingSpec,
  LOCKFILES,
} from "./doctor-readiness-supply-chain-scan.js";
import type { WorkspaceMembers } from "./doctor-readiness-workspaces.js";

/** Package lifecycle scripts that execute during dependency installation. */
const INSTALL_TIME_SCRIPT_NAMES: ReadonlySet<string> = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
]);

/** One package manifest B5 inspects. */
export interface ManifestUnderAssessment {
  readonly manifestPath: string;
  readonly manifest: Record<string, unknown>;
}

/** Values already read from the repository for dependency-confidence evidence. */
interface DependencyConfidenceInputs {
  readonly auditGate: string | null;
  readonly lockfile: string | null;
  readonly lockfileInstallGate: string | null;
  readonly specs: readonly DependencySpec[];
  readonly workspaces: WorkspaceMembers;
}

/**
 * Render a bounded list for operator-facing evidence.
 * @param values - Values to render
 * @returns A comma-separated list
 */
function renderList(values: readonly string[]): string {
  const shown = values.slice(0, 5);
  const overflow = values.length - shown.length;
  return (
    shown.map(value => `\`${value}\``).join(", ") +
    (overflow > 0 ? `, and ${overflow} more` : "")
  );
}

/**
 * Build the evidence line for a manifest with no committed lockfile.
 * @param specCount - How many specs the manifest declares
 * @returns One evidence line
 */
function lockfileEvidence(specCount: number): string {
  return (
    `package manifest(s), starting with \`package.json\`, declare ${specCount} ` +
    `dependency spec(s) but no lockfile is committed (looked for ` +
    `${LOCKFILES.join(", ")}) — two installs can resolve to different trees, ` +
    "so what was validated is not provably what gets installed"
  );
}

/**
 * Whether a floating-looking spec is really a local workspace link.
 * @param spec - The declared spec
 * @param workspaces - What resolving the workspace members established
 * @returns True when the spec links to a workspace member
 */
function linksWorkspaceMember(
  spec: DependencySpec,
  workspaces: WorkspaceMembers
): boolean {
  if (!workspaces.declared) {
    return false;
  }
  return (
    workspaces.names.has(spec.name) ||
    (workspaces.names.size === 0 && spec.spec.trim() === "*")
  );
}

/**
 * Build evidence when a manifest declares install-time lifecycle scripts.
 * @param manifestPath - Repo-relative manifest path
 * @param manifest - Parsed package manifest
 * @returns Evidence line when install-time scripts exist
 */
function installTimeScriptEvidence(
  manifestPath: string,
  manifest: Record<string, unknown>
): string | null {
  const scripts = manifest.scripts;
  if (
    scripts === null ||
    typeof scripts !== "object" ||
    Array.isArray(scripts)
  ) {
    return null;
  }
  const scriptNames = Object.keys(scripts).filter(name =>
    INSTALL_TIME_SCRIPT_NAMES.has(name)
  );
  if (scriptNames.length === 0) {
    return null;
  }
  return (
    `\`${manifestPath}\` declares install-time lifecycle script(s) ` +
    `${renderList(scriptNames)}, so dependency installation executes project ` +
    "code before the normal test/audit surface; B5 needs an explicit confidence " +
    "decision for that install-time execution path"
  );
}

/** Package-manager fields that explicitly allow dependency build scripts. */
const BUILD_SCRIPT_ALLOWLIST_FIELDS: readonly string[] = [
  "trustedDependencies",
  "onlyBuiltDependencies",
];

/**
 * Read string values from a package-manager build-script allowlist.
 * @param value - Candidate manifest field
 * @returns Declared package names
 */
function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/**
 * Build evidence when package managers are configured to trust dependency build scripts.
 * @param manifestPath - Repo-relative manifest path
 * @param manifest - Parsed package manifest
 * @returns Evidence line when trusted dependency build scripts are declared
 */
function trustedDependencyEvidence(
  manifestPath: string,
  manifest: Record<string, unknown>
): string | null {
  const pnpm = manifest.pnpm;
  const names = [
    ...BUILD_SCRIPT_ALLOWLIST_FIELDS.flatMap(field =>
      stringArray(manifest[field])
    ),
    ...(pnpm !== null && typeof pnpm === "object" && !Array.isArray(pnpm)
      ? stringArray((pnpm as Record<string, unknown>).onlyBuiltDependencies)
      : []),
  ];
  if (names.length === 0) {
    return null;
  }
  return (
    `\`${manifestPath}\` marks ${renderList([...new Set(names)])} as ` +
    "trusted dependency build script(s) through `trustedDependencies` or " +
    "`onlyBuiltDependencies`, allowing third-party install-time scripts to run; " +
    "B5 needs a written confidence decision for each trusted package because " +
    "a clean audit gate alone does not explain that execution authority"
  );
}

/**
 * Collect B5 evidence for install-time execution surfaces.
 * @param manifests - Manifests under assessment
 * @returns Evidence lines for install-time execution surfaces
 */
export function installTimeExecutionViolations(
  manifests: readonly ManifestUnderAssessment[]
): readonly string[] {
  return manifests.flatMap(({ manifestPath, manifest }) =>
    [
      installTimeScriptEvidence(manifestPath, manifest),
      trustedDependencyEvidence(manifestPath, manifest),
    ].flatMap(evidence => (evidence === null ? [] : [evidence]))
  );
}

/**
 * Collect B5 violations from dependency specs, lockfiles, and audit gates.
 * @param inputs - Values already read from the repository
 * @param inputs.auditGate - Path to the dependency-audit gate, if found
 * @param inputs.lockfile - Path to the committed lockfile, if found
 * @param inputs.lockfileInstallGate - Path to the lockfile-enforcing install
 * @param inputs.specs - Declared dependency specs
 * @param inputs.workspaces - What resolving the workspace members established
 * @returns Evidence lines for dependency-confidence violations
 */
export function dependencyConfidenceViolations({
  auditGate,
  lockfile,
  lockfileInstallGate,
  specs,
  workspaces,
}: DependencyConfidenceInputs): readonly string[] {
  if (specs.length === 0) {
    return [];
  }
  const floating = specs.filter(
    spec => isFloatingSpec(spec.spec) && !linksWorkspaceMember(spec, workspaces)
  );
  return [
    ...(lockfile === null ? [lockfileEvidence(specs.length)] : []),
    ...(lockfile !== null && lockfileInstallGate === null
      ? [
          `lockfile \`${lockfile}\` is committed, but no CI or hook install ` +
            "step was found that enforces it with `npm ci`, " +
            "`bun install --frozen-lockfile`, `pnpm install --frozen-lockfile`, " +
            "or `yarn install --immutable`; a workflow can silently rewrite " +
            "or bypass the tree that was validated",
        ]
      : []),
    ...floating.map(
      spec =>
        `\`${spec.manifestPath}\` \`${spec.block}.${spec.name}\` is ` +
        `\`${spec.spec}\`, which resolves to whatever is newest at install ` +
        "time rather than to a version anything was ever validated against"
    ),
    ...(auditGate === null
      ? [
          "no dependency-audit gate covering the JavaScript tree was found " +
            "anywhere — no `npm`/`bun` audit step in `.github/workflows/*.yml`, " +
            "none in a git hook, and no `dependabot.yml` npm entry or " +
            "`renovate.json` — so a newly disclosed advisory in this tree " +
            "would never be noticed by anything",
        ]
      : []),
  ];
}

/**
 * Collect non-blocking observations from dependency-confidence evidence.
 * @param inputs - Values already read from the repository
 * @param inputs.auditGate - Path to the dependency-audit gate, if found
 * @param inputs.lockfile - Path to the committed lockfile, if found
 * @param inputs.lockfileInstallGate - Path to the lockfile-enforcing install
 * @param inputs.specs - Declared dependency specs
 * @returns Evidence lines for clean dependency-confidence signals
 */
export function dependencyConfidenceObservations({
  auditGate,
  lockfile,
  lockfileInstallGate,
  specs,
}: DependencyConfidenceInputs): readonly string[] {
  if (specs.length === 0) {
    return [];
  }
  return [
    ...(lockfile === null ? [] : [`Lockfile in use: \`${lockfile}\`.`]),
    ...(lockfileInstallGate === null
      ? []
      : [`Lockfile-enforcing install declared in \`${lockfileInstallGate}\`.`]),
    ...(auditGate === null
      ? []
      : [`Dependency-audit gate declared in \`${auditGate}\`.`]),
  ];
}
