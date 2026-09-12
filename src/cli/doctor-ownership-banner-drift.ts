/**
 * Report managed workflow banners that contradict the detected template lane.
 *
 * Ownership depends on the stack: ci.yml is create-only for some stacks and
 * copy-overwrite for others. A managed variant takes precedence over a seeded
 * parent, and an unknown lane never earns a promise that edits are safe.
 *
 * Report rather than rewrite: these are consumer files that may have customized
 * headers. The inverse (a managed template carrying a seeded banner) remains
 * outside this check's scope.
 * @module cli/doctor-ownership-banner-drift
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { DetectorRegistry } from "../detection/index.js";
import { pathExists } from "../utils/index.js";

import {
  LISA_MANAGED_MARKER,
  LISA_SEEDED_MARKER,
} from "../core/workflow-deletion-ownership.js";

import type { DoctorCheck } from "./doctor.js";

/** Where GitHub Actions reads workflow definitions from. */
const WORKFLOWS_DIR = path.join(".github", "workflows");

/**
 * How many leading lines count as the ownership header.
 *
 * Bounded for the reason `workflow-deletion-ownership` bounds its own read: a
 * whole-file search would let a step name or a passing comment mentioning Lisa
 * classify the file. Every shipped template puts its header on the first two
 * lines; four covers a leading document marker or a blank.
 */
const HEADER_LINES = 4;

/** The lane a file's banner claims, or null when it carries no Lisa banner. */
type Claimed = "managed" | "seeded" | null;

/** The installed package owns its template directories in source and dist. */
const LISA_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/**
 * Resolve a workflow's ownership from the templates for the detected stacks.
 * A managed variant wins over a create-only parent or another detected stack.
 * @param lisaRoot - Installed template root.
 * @param types - Expanded detected stacks.
 * @param filename - Workflow basename.
 * @returns The supported ownership claim, or null when it cannot be established.
 */
async function workflowLane(
  lisaRoot: string,
  types: readonly string[],
  filename: string
): Promise<Claimed> {
  if (types.length === 0) return null;
  const variants = await Promise.all(
    ["all", ...types].flatMap(type =>
      ["copy-overwrite", "merge", "create-only"].map(async lane =>
        (await pathExists(
          path.join(lisaRoot, type, lane, WORKFLOWS_DIR, filename)
        ))
          ? lane
          : null
      )
    )
  );
  if (variants.includes("copy-overwrite") || variants.includes("merge"))
    return "managed";
  return variants.includes("create-only") ? "seeded" : null;
}

/**
 * Which ownership contract a file's header claims.
 *
 * The two markers are imported rather than re-spelled. The banner TEXT is
 * duplicated into every template Lisa ships — it is literal bytes in each
 * file's first lines, with no generator — so a checker that re-typed the
 * sentence would be a third copy to keep in step. The detection vocabulary is
 * single-source even though the emitted text is not.
 * @param source - Full text of a workflow file
 * @returns The lane the header claims, or null
 */
export function claimedOwnership(source: string): Claimed {
  const header = String(source).split("\n").slice(0, HEADER_LINES).join("\n");
  if (header.includes(LISA_MANAGED_MARKER)) return "managed";
  if (header.includes(LISA_SEEDED_MARKER)) return "seeded";
  return null;
}

/**
 * Workflow filenames in one directory, sorted, or none when it cannot be read.
 *
 * probe-direction: fail-closed — an unreadable or missing directory yields no
 * CLAIMS, so the check reports nothing rather than reporting drift it never
 * saw. It cannot manufacture a warning from a directory it could not open, and
 * a missing `.github/workflows` is the ordinary case for many checkouts.
 * @param dir - Absolute path to the workflows directory
 * @returns Workflow filenames, sorted for a deterministic report
 */
async function workflowNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(entry => entry.name)
      .filter(name => name.endsWith(".yml") || name.endsWith(".yaml"))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}

/**
 * Workflow files whose banner claims Lisa manages and replaces them.
 * @param targetPath - Repository root to inspect
 * @returns Workflow filenames claiming the copy-overwrite contract
 */
async function managedClaims(targetPath: string): Promise<string[]> {
  const dir = path.join(targetPath, WORKFLOWS_DIR);
  const names = await workflowNames(dir);
  const claims = await Promise.all(
    names.map(async name => {
      try {
        const source = await readFile(path.join(dir, name), "utf8");
        return claimedOwnership(source) === "managed" ? name : null;
      } catch {
        // probe-direction: fail-closed — same reasoning one level down: a file
        // this cannot read contributes no claim.
        return null;
      }
    })
  );
  return claims.filter((name): name is string => name !== null);
}

/**
 * Report workflows whose banner contradicts the lane they now ship on.
 * @param targetPath - Repository root to inspect
 * @param lisaRoot - Installed package root containing the templates.
 * @returns A doctor check row
 */
export async function checkOwnershipBannerDrift(
  targetPath: string,
  lisaRoot: string = LISA_ROOT
): Promise<DoctorCheck> {
  const name = "Workflow ownership banner";
  const claims = await managedClaims(targetPath);
  const detectors = new DetectorRegistry();
  const types = detectors.expandAndOrderTypes(
    await detectors.detectAll(targetPath)
  );
  const resolved = await Promise.all(
    claims.map(async filename => ({
      filename,
      lane: await workflowLane(lisaRoot, types, filename),
    }))
  );
  const stale = resolved
    .filter(item => item.lane === "seeded")
    .map(item => item.filename);
  const unknown = resolved
    .filter(item => item.lane === null)
    .map(item => item.filename);
  if (stale.length === 0 && unknown.length === 0) {
    return {
      name,
      status: "ok",
      detail: "No managed workflow banner contradicts the detected templates.",
    };
  }
  return {
    name,
    status: "warn",
    detail: [
      stale.length > 0
        ? `${stale.join(", ")}: the managed banner is stale; the detected templates ship these files create-only. Correct the ownership header when you next edit the file. Applying Lisa cannot update a create-only header.`
        : "",
      unknown.length > 0
        ? `Lisa could not determine the ownership lane for ${unknown.join(", ")}. Check the applicable template before editing; the banner alone does not establish whether Lisa will overwrite it.`
        : "",
    ]
      .filter(Boolean)
      .join(" "),
  };
}
