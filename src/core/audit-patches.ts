import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { gt, prerelease, satisfies, valid } from "semver";
import { AuditCaptureError } from "./audit-capture.js";
import { auditRecord } from "./audit-exclusions.js";
import type { AuditCopy, AuditFinding, AuditVerdict } from "./audit-types.js";

/**
 * A vulnerable dependency can be accepted without an exclusion only when the
 * project patched it itself and the patch proves it. The proof lives in the
 * patch file's own header, above the first `diff --git` line, so the mapping
 * from patch to advisory can never drift into a separate ignore list:
 *
 *   Lisa-Advisory: GHSA-xxxx-xxxx-xxxx
 *   Lisa-Regression-Test: .lisa/patches/<name>.regression.mjs
 *   Lisa-Patched-File: lib/parse.js sha256:<hex of the file after patching>
 *
 * Patches are found through the package manager's native declaration: Bun's
 * `patchedDependencies` in package.json. npm and Yarn classic have no native
 * patch mechanism, so a project on them gets no patch credit and the advisory
 * stays a finding.
 */

/** One declared patch that names at least one advisory. */
export interface AdvisoryPatch {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  readonly advisories: readonly string[];
  readonly regressionTest: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
}

/** How the audit learns which versions the registry has published. */
export type PublishedVersions = (name: string) => Promise<readonly string[]>;

/** Knobs for patch verification; tests replace the registry lookup. */
export interface AuditPatchOptions {
  readonly publishedVersions?: PublishedVersions;
}

/** Findings no patch decided, plus the verdicts of the ones a patch did. */
export interface PatchedFindings {
  readonly remaining: readonly AuditFinding[];
  readonly verdicts: readonly AuditVerdict[];
}

const PATCHED_FILE = /^(\S+)\s+sha256:([0-9a-f]{64})$/u;
const REGISTRY = "https://registry.npmjs.org";

/**
 * Read the header lines above the first diff of a patch file.
 * @param text - Complete patch file text
 * @returns Each `Lisa-<Key>: value` pair, in order
 */
function headerPairs(text: string): readonly (readonly [string, string])[] {
  const lines = text.split(/\r?\n/u);
  const end = lines.findIndex(line => line.startsWith("diff --git "));
  return (end < 0 ? [] : lines.slice(0, end)).flatMap(line => {
    const colon = line.indexOf(":");
    return line.startsWith("Lisa-") && colon > 0
      ? [[line.slice(5, colon), line.slice(colon + 1).trim()] as const]
      : [];
  });
}

/**
 * Parse one declared patch; a patch that names no advisory is not a security patch.
 * @param root - Project root the declaration is relative to
 * @param spec - The `name@version` key from patchedDependencies
 * @param file - The patch file path from patchedDependencies
 * @returns The advisory patch, or undefined when it names no advisory
 */
function readAdvisoryPatch(
  root: string,
  spec: string,
  file: string
): AdvisoryPatch | undefined {
  const at = spec.lastIndexOf("@");
  const name = spec.slice(0, at);
  const version = spec.slice(at + 1);
  const path = resolve(root, file);
  const pairs = existsSync(path) ? headerPairs(readFileSync(path, "utf8")) : [];
  const values = (key: string) =>
    pairs.filter(([found]) => found === key).map(([, value]) => value);
  const advisories = values("Advisory");
  if (!advisories.length) return undefined;
  if (at <= 0 || valid(version) === null)
    throw new Error(`patchedDependencies key ${spec} is not name@version`);
  const files = values("Patched-File").map(value => {
    const match = PATCHED_FILE.exec(value);
    if (!match)
      throw new Error(
        `${file}: Lisa-Patched-File "${value}" is not "<path> sha256:<hex>"`
      );
    return { path: match[1] ?? "", sha256: match[2] ?? "" };
  });
  const [regressionTest = ""] = values("Regression-Test");
  return { name, version, file, advisories, regressionTest, files };
}

/**
 * Every declared patch that names an advisory.
 * @param root - Project root containing package.json
 * @returns The advisory patches the project declares
 */
export function readAdvisoryPatches(root: string): readonly AdvisoryPatch[] {
  const manifest: unknown = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8")
  );
  const declared = auditRecord(manifest)
    ? manifest.patchedDependencies
    : undefined;
  if (declared === undefined) return [];
  if (!auditRecord(declared))
    throw new Error("package.json patchedDependencies is not an object");
  return Object.entries(declared).flatMap(([spec, file]) => {
    if (typeof file !== "string")
      throw new Error(`patchedDependencies.${spec} is not a path`);
    const patch = readAdvisoryPatch(root, spec, file);
    return patch ? [patch] : [];
  });
}

/**
 * Child node_modules directories of one node_modules directory, including
 * the isolated stores Bun and pnpm keep under `.bun` and `.pnpm`.
 * @param modules - A node_modules directory
 * @returns The node_modules directories nested one level below it
 */
function nestedModules(modules: string): readonly string[] {
  return readdirSync(modules, { withFileTypes: true }).flatMap(entry => {
    if (!entry.isDirectory()) return [];
    const base = join(modules, entry.name);
    const children =
      entry.name.startsWith("@") || [".bun", ".pnpm"].includes(entry.name)
        ? readdirSync(base, { withFileTypes: true })
            .filter(child => child.isDirectory())
            .map(child => join(base, child.name))
        : [base];
    return children
      .map(child => join(child, "node_modules"))
      .filter(child => existsSync(child) && lstatSync(child).isDirectory());
  });
}

/**
 * Every real (non-symlinked) installed directory of a package, at any depth.
 * @param root - Project root whose node_modules is searched
 * @param name - Package name
 * @returns Each installed directory with the version its manifest declares
 */
export function installedCopies(
  root: string,
  name: string
): readonly { readonly dir: string; readonly version: string }[] {
  const start = join(root, "node_modules");
  const walk = (
    queue: readonly string[],
    seen: ReadonlySet<string>
  ): readonly string[] => {
    const fresh = queue.filter(dir => !seen.has(dir));
    if (!fresh.length) return [...seen];
    const next = new Set([...seen, ...fresh]);
    return walk(fresh.flatMap(nestedModules), next);
  };
  const modules = existsSync(start) ? walk([start], new Set()) : [];
  return modules.flatMap(dir => {
    const pkg = join(dir, ...name.split("/"));
    const manifest = join(pkg, "package.json");
    if (!existsSync(manifest) || lstatSync(pkg).isSymbolicLink()) return [];
    const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
    return auditRecord(parsed) &&
      parsed.name === name &&
      typeof parsed.version === "string"
      ? [{ dir: pkg, version: parsed.version }]
      : [];
  });
}

/**
 * The registry's published versions of a package.
 * @param name - Package name
 * @returns Every published version
 */
const registryVersions: PublishedVersions = async name => {
  const url = `${REGISTRY}/${name.replace("/", "%2f")}`;
  const response = await fetch(url, {
    headers: { accept: "application/vnd.npm.install-v1+json" },
  });
  if (!response.ok)
    throw new Error(`registry answered ${response.status} for ${name}`);
  const body: unknown = await response.json();
  if (!auditRecord(body) || !auditRecord(body.versions))
    throw new Error(`registry returned no versions for ${name}`);
  return Object.keys(body.versions);
};

/**
 * The SHA-256 of a file, or undefined when it is missing.
 * @param file - File path
 * @returns Hex digest
 */
function sha256(file: string): string | undefined {
  return existsSync(file)
    ? createHash("sha256").update(readFileSync(file)).digest("hex")
    : undefined;
}

/**
 * Problems that keep the patches from proving the vulnerable copies are fixed.
 * @param root - Project root
 * @param finding - The advisory being decided
 * @param patches - The patches naming this advisory for this package
 * @param versions - Every vulnerable version in the lockfile or node_modules
 * @returns One message per unmet condition
 */
function localProblems(
  root: string,
  finding: AuditFinding,
  patches: readonly AdvisoryPatch[],
  versions: readonly string[]
): readonly string[] {
  const installed = installedCopies(root, finding.name);
  return versions.flatMap(version => {
    const patch = patches.find(candidate => candidate.version === version);
    if (!patch)
      return [
        `${finding.name}@${version} is vulnerable and no patch names ${finding.ids[0]} for it`,
      ];
    const test = patch.regressionTest;
    const testProblem =
      test && existsSync(resolve(root, test))
        ? []
        : [
            `${patch.file} names regression test "${test}", which does not exist`,
          ];
    const copies = installed.filter(copy => copy.version === version);
    if (!copies.length)
      return [
        ...testProblem,
        `${finding.name}@${version} is not installed, so ${patch.file} cannot be verified; install dependencies first`,
      ];
    if (!patch.files.length)
      return [
        ...testProblem,
        `${patch.file} declares no Lisa-Patched-File hash`,
      ];
    const mismatched = copies.flatMap(copy =>
      patch.files
        .filter(file => sha256(join(copy.dir, file.path)) !== file.sha256)
        .map(file => `${copy.dir.split(sep).join("/")}/${file.path}`)
    );
    return mismatched.length
      ? [
          ...testProblem,
          `installed files do not match ${patch.file}: ${mismatched.join(", ")}; reinstall so the patch is applied`,
        ]
      : testProblem;
  });
}

/**
 * Fixed versions published after the patched ones, which retire the patch.
 * @param finding - The advisory being decided
 * @param versions - The patched vulnerable versions
 * @param published - Every version the registry publishes
 * @returns The published versions outside the vulnerable range
 */
function upstreamFixes(
  finding: AuditFinding,
  versions: readonly string[],
  published: readonly string[]
): readonly string[] {
  const range = finding.range ?? "";
  return published.filter(
    version =>
      valid(version) !== null &&
      prerelease(version) === null &&
      versions.some(patched => gt(version, patched)) &&
      !satisfies(version, range)
  );
}

/**
 * Decide one finding that at least one declared patch names.
 * @param root - Project root
 * @param finding - The advisory being decided
 * @param patches - The patches naming this advisory for this package
 * @param copies - Resolved lockfile copies
 * @param publishedVersions - Registry lookup
 * @returns The verdict for this finding
 */
async function decidePatched(
  root: string,
  finding: AuditFinding,
  patches: readonly AdvisoryPatch[],
  copies: readonly AuditCopy[],
  publishedVersions: PublishedVersions
): Promise<AuditVerdict> {
  const id = finding.ids[0];
  const range = finding.range;
  if (!range)
    return {
      passed: false,
      messages: [
        `${id}: cannot verify ${patches[0]?.file} without the advisory's vulnerable range`,
      ],
    };
  const vulnerable = (version: string) =>
    satisfies(version, range, { includePrerelease: true });
  const versions = [
    ...new Set([
      ...copies
        .filter(copy => copy.name === finding.name)
        .map(copy => copy.version),
      ...installedCopies(root, finding.name).map(copy => copy.version),
    ]),
  ].filter(vulnerable);
  const local = localProblems(root, finding, patches, versions);
  if (local.length)
    return {
      passed: false,
      messages: local.map(problem => `${id}: ${problem}`),
    };
  const published = await publishedVersions(finding.name).catch(
    (error: unknown) => {
      throw new AuditCaptureError(
        `${id}: cannot confirm that no fixed ${finding.name} is published (${(error as Error).message}); a patch is accepted only while upstream has no fix`
      );
    }
  );
  const fixed = upstreamFixes(finding, versions, published);
  const files = patches
    .filter(patch => versions.includes(patch.version))
    .map(patch => patch.file);
  return fixed.length
    ? {
        passed: false,
        messages: [
          `${id}: ${finding.name}@${fixed.join(", ")} is published outside the vulnerable range ${range}; upgrade ${finding.name} and delete ${files.join(", ")}`,
        ],
      }
    : {
        passed: true,
        messages: [
          `patched ${id} in ${finding.name}@${versions.join(", ")} (${files.join(", ")}); no fixed ${finding.name} is published`,
        ],
      };
}

/**
 * Decide every finding a declared patch names; leave the rest to exclusions.
 * @param root - Project root
 * @param findings - Normalized high/critical advisories
 * @param copies - Reads the resolved lockfile copies, only when a patch applies
 * @param options - Registry lookup override
 * @returns Undecided findings and the verdicts of decided ones
 */
export async function decidePatchedFindings(
  root: string,
  findings: readonly AuditFinding[],
  copies: () => readonly AuditCopy[],
  options: AuditPatchOptions = {}
): Promise<PatchedFindings> {
  const patches = readAdvisoryPatches(root);
  const naming = (finding: AuditFinding) =>
    patches.filter(
      patch =>
        patch.name === finding.name &&
        patch.advisories.some(id => finding.ids.includes(id))
    );
  const verdicts = await Promise.all(
    findings
      .filter(finding => naming(finding).length > 0)
      .map(finding =>
        decidePatched(
          root,
          finding,
          naming(finding),
          copies(),
          options.publishedVersions ?? registryVersions
        )
      )
  );
  return {
    remaining: findings.filter(finding => naming(finding).length === 0),
    verdicts,
  };
}
