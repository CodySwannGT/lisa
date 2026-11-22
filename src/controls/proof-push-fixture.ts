/** Prepare a commit for a proof's real push in the isolated repository. */
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { auditRecord } from "../core/audit-exclusions.js";
import { readAuditCopies } from "../core/audit-lockfile.js";
import { detectAuditManager } from "../core/audit-manager.js";
import { copyGit, gitSaid } from "./proof-copy-git.js";
import type { ProofCopy } from "./proof-copy.js";
import {
  notCommittedDetail,
  proofPushCommitMessage,
} from "./proof-copy-wording.js";
import type { ProofTools } from "./proof-tools.js";
import type { ProofHalf, ProofTrigger } from "./proof-types.js";

const MANIFEST = "package.json";
const LOCK = "bun.lock";
const DEPENDENCY = "semver";
const LISA_PACKAGE = "@codyswann/lisa";
// The negative version is covered by GHSA-c2qf-rxjj-qqgw. Neither case installs
// or runs the dependency. The production audit examines the actual lockfile.
const VERSIONS = { violation: "7.5.1", clean: "7.8.6" } as const;
const GROUPS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "resolutions",
  "overrides",
] as const;

/** Read the disposable package manifest as an object.
 * @param root - The repository's root.
 * @returns The parsed manifest, or null when it isn't an object.
 */
function readManifest(root: string): Record<string, unknown> | null {
  const manifest: unknown = JSON.parse(
    readFileSync(join(root, MANIFEST), "utf8")
  );
  return auditRecord(manifest) ? manifest : null;
}

/** Find the manifest of a Bun host where Lisa brings in a transitive dependency.
 * @param root - The repository to examine.
 * @returns The manifest when its lockfile and existing pins allow the proof.
 */
function bunAuditManifest(root: string): Record<string, unknown> | null {
  try {
    if (
      !lstatSync(join(root, MANIFEST)).isFile() ||
      !lstatSync(join(root, LOCK)).isFile() ||
      existsSync(join(root, "bun.lockb")) ||
      detectAuditManager(root) !== "bun"
    )
      return null;
    const manifest = readManifest(root);
    if (
      manifest === null ||
      !auditRecord(manifest.dependencies) ||
      !Object.hasOwn(manifest.dependencies, LISA_PACKAGE)
    )
      return null;
    const canOverride = GROUPS.every(group => {
      const declarations = manifest[group];
      return (
        declarations === undefined ||
        (auditRecord(declarations) && !Object.hasOwn(declarations, DEPENDENCY))
      );
    });
    const resolved =
      canOverride &&
      readAuditCopies(root, "bun").some(
        candidate =>
          candidate.path === DEPENDENCY && candidate.name === DEPENDENCY
      );
    return resolved ? manifest : null;
  } catch {
    return null;
  }
}

/** Check that the shipped audit proof fits a host without changing its direct dependencies.
 * @param root - The repository to examine.
 * @returns True when the host already resolves the proof's transitive dependency.
 */
export function canPlantBunAuditFixture(root: string): boolean {
  return bunAuditManifest(root) !== null;
}

/** Stage the lockfile only, then verify the exact resolved copy the gate will audit.
 * @param copy - The disposable copy and its private scratch folder.
 * @param tools - The bounded process runner.
 * @param half - The selected fixture.
 * @param timeoutMs - The proof's process budget.
 * @returns The reason preparation failed, or null.
 */
function stageAuditFixture(
  copy: ProofCopy,
  tools: ProofTools,
  half: ProofHalf,
  timeoutMs: number
): string | null {
  const prior = bunAuditManifest(copy.clone);
  if (prior === null)
    return "The Bun audit fixture needs a text lockfile and the transitive dependency from Lisa.";
  const version = VERSIONS[half];
  // Change the version of a dependency already used by the application.
  // Adding another direct dependency would separately fail the dead-code gate.
  const expected = {
    ...prior,
    overrides: {
      ...(auditRecord(prior.overrides) ? prior.overrides : {}),
      [DEPENDENCY]: version,
    },
  };
  writeFileSync(
    join(copy.clone, MANIFEST),
    `${JSON.stringify(expected, null, 2)}\n`
  );
  if (
    tools.start(
      [
        "bun",
        "install",
        "--lockfile-only",
        "--ignore-scripts",
        `--cache-dir=${join(copy.folder, "audit-registry-cache")}`,
      ],
      { cwd: copy.clone, timeoutMs }
    ).code !== 0
  )
    return "Bun could not prepare the disposable audit lockfile.";
  try {
    if (!isDeepStrictEqual(readManifest(copy.clone), expected))
      return "Bun changed the disposable manifest while resolving the audit lockfile.";
    const resolved = readAuditCopies(copy.clone, "bun").find(
      candidate => candidate.path === DEPENDENCY
    );
    if (resolved?.name !== DEPENDENCY || resolved.version !== version)
      return "The audit fixture resolved a different registry version.";
  } catch {
    return "The resolved audit fixture could not be read from the Bun lockfile.";
  }
  return copyGit(copy.clone)(["add", "--", MANIFEST, LOCK]).code === 0
    ? null
    : "The disposable audit manifest and lockfile could not be staged.";
}

/** Create the disposable commit that carries the proof into the real push hook.
 * @param copy - The disposable copy.
 * @param tools - The bounded process runner.
 * @param request - The requested push proof.
 * @returns The preparation failure, or null once the commit exists.
 */
export function preparePushProof(
  copy: ProofCopy,
  tools: ProofTools,
  request: ProofTrigger
): string | null {
  if (
    request.entry.gate === "dependency-vulnerability" &&
    request.auditFixture !== undefined
  ) {
    const problem = stageAuditFixture(
      copy,
      tools,
      request.auditFixture,
      request.timeoutMs
    );
    if (problem !== null) return problem;
  }
  // The push hook is the subject. Creating this commit only prepares its input.
  const committed = copyGit(copy.clone)([
    "-c",
    `core.hooksPath=${copy.noHooks}`,
    "commit",
    "--quiet",
    "-m",
    proofPushCommitMessage(request, copy.source.commitTrailers),
  ]);
  return committed.code === 0 ? null : notCommittedDetail(gitSaid(committed));
}
