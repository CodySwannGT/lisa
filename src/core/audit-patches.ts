import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { gt, prerelease, satisfies, valid } from "semver";
import { AuditCaptureError } from "./audit-capture.js";
import { installedCopies } from "./audit-installed-copies.js";
import { type PublishedVersions, registryVersions } from "./audit-registry.js";
import { auditRecord } from "./audit-exclusions.js";
import {
  patchedPathProblem,
  patchTargets,
  regressionProblems,
} from "./audit-patch-proof.js";
import type {
  AuditCopy,
  AuditFinding,
  AuditManager,
  AuditVerdict,
} from "./audit-types.js";

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
 * The header is only a claim. The audit executes it (see audit-patch-proof):
 * every hashed file must be one the patch changes, inside the package, and
 * the regression test must pass on every installed copy and fail on the same
 * package with the patch reversed.
 *
 * Patches are found through Bun's native declaration, `patchedDependencies`
 * in package.json, and credited only when the audit runs for Bun. npm and
 * Yarn classic ignore that field, so on them the patch was never applied:
 * decidePatchedFindings leaves the finding undecided and audit-patch-hints
 * names the real fix instead of asking for a reinstall that cannot work.
 */

/** One declared patch that names at least one advisory. */
export interface AdvisoryPatch {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  readonly advisories: readonly string[];
  readonly regressionTest: string;
  readonly files: readonly { readonly path: string; readonly sha256: string }[];
  /** Header claims that fail on their face, such as a hash of an unchanged file. */
  readonly problems: readonly string[];
}

export type { PublishedVersions };

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

/**
 * Read the header lines above the first diff of a patch file.
 * @param text - Complete patch file text
 * @returns Each `Lisa-<Key>: value` pair, in order
 */
export function headerPairs(
  text: string
): readonly (readonly [string, string])[] {
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
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  const pairs = headerPairs(text);
  const targets = patchTargets(text);
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
  const problems = files.flatMap(entry => {
    const problem = patchedPathProblem(entry.path, targets);
    return problem ? [`${file}: ${problem}`] : [];
  });
  return { name, version, file, advisories, regressionTest, files, problems };
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
    const headerProblems = patch.problems;
    const copies = installed.filter(copy => copy.version === version);
    if (!copies.length)
      return [
        ...headerProblems,
        `${finding.name}@${version} is not installed, so ${patch.file} cannot be verified; install dependencies first`,
      ];
    if (!patch.files.length)
      return [
        ...headerProblems,
        `${patch.file} declares no Lisa-Patched-File hash`,
      ];
    const mismatched = copies.flatMap(copy =>
      patch.files
        .filter(file => sha256(join(copy.dir, file.path)) !== file.sha256)
        .map(file => `${copy.dir.split(sep).join("/")}/${file.path}`)
    );
    return mismatched.length
      ? [
          ...headerProblems,
          `installed files do not match ${patch.file}: ${mismatched.join(", ")}; reinstall so the patch is applied`,
        ]
      : headerProblems;
  });
}

/**
 * Run each patch's regression test against the installed copies it covers.
 * @param root - Project root
 * @param finding - The advisory being decided
 * @param patches - The patches naming this advisory for this package
 * @param versions - The vulnerable versions, each with a verified patch
 * @returns One message per patch whose test does not prove the fix
 */
async function executedProof(
  root: string,
  finding: AuditFinding,
  patches: readonly AdvisoryPatch[],
  versions: readonly string[]
): Promise<readonly string[]> {
  const installed = installedCopies(root, finding.name);
  const results = await Promise.all(
    patches
      .filter(patch => versions.includes(patch.version))
      .map(patch =>
        regressionProblems(
          root,
          patch,
          installed
            .filter(copy => copy.version === patch.version)
            .map(copy => copy.dir)
        )
      )
  );
  return results.flat().map(problem => `${finding.ids[0]}: ${problem}`);
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
  const outOfRange = patches
    .filter(patch => !vulnerable(patch.version))
    .map(
      patch =>
        `${id}: ${patch.file} names ${id} for ${patch.name}@${patch.version}, which is outside the advisory's vulnerable range ${range}`
    );
  const versions = [
    ...new Set([
      ...copies
        .filter(copy => copy.name === finding.name)
        .map(copy => copy.version),
      ...installedCopies(root, finding.name).map(copy => copy.version),
    ]),
  ].filter(vulnerable);
  if (!versions.length)
    return {
      passed: false,
      messages: [
        ...outOfRange,
        `${id}: no locked or installed ${finding.name} is in the vulnerable range ${range}, so there is no copy ${patches[0]?.file} can be verified against`,
      ],
    };
  const local = [
    ...outOfRange,
    ...localProblems(root, finding, patches, versions).map(
      problem => `${id}: ${problem}`
    ),
  ];
  const proof = local.length
    ? local
    : await executedProof(root, finding, patches, versions);
  if (proof.length) return { passed: false, messages: proof };
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
 * Only Bun applies `patchedDependencies`, so on any other manager no patch is
 * credited and every finding is left undecided.
 * @param root - Project root
 * @param manager - Package manager the audit runs for
 * @param findings - Normalized high/critical advisories
 * @param copies - Reads the resolved lockfile copies, only when a patch applies
 * @param options - Registry lookup override
 * @returns Undecided findings and the verdicts of decided ones
 */
export async function decidePatchedFindings(
  root: string,
  manager: AuditManager,
  findings: readonly AuditFinding[],
  copies: () => readonly AuditCopy[],
  options: AuditPatchOptions = {}
): Promise<PatchedFindings> {
  if (manager !== "bun") return { remaining: findings, verdicts: [] };
  const patches = readAdvisoryPatches(root);
  const claiming = (finding: AuditFinding) =>
    patches.filter(patch =>
      patch.advisories.some(id => finding.ids.includes(id))
    );
  const verdicts = await Promise.all(
    findings
      .filter(finding => claiming(finding).length > 0)
      .map(finding => {
        const foreign = claiming(finding).filter(
          patch => patch.name !== finding.name
        );
        return foreign.length
          ? Promise.resolve({
              passed: false,
              messages: foreign.map(
                patch =>
                  `${finding.ids[0]}: ${patch.file} names ${finding.ids[0]}, an advisory for ${finding.name}, but patches ${patch.name}`
              ),
            })
          : decidePatched(
              root,
              finding,
              claiming(finding),
              copies(),
              options.publishedVersions ?? registryVersions
            );
      })
  );
  return {
    remaining: findings.filter(finding => claiming(finding).length === 0),
    verdicts,
  };
}
