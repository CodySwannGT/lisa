/**
 * Report a seeded workflow whose ownership banner contradicts its lane (#3582).
 *
 * Lisa ships two ownership headers and they are OPPOSITE CONTRACTS.
 * `copy-overwrite` says "managed by Lisa and IS replaced on each `lisa` run";
 * `create-only` says "Seeded by Lisa on first setup — this file is YOURS. Lisa
 * will not overwrite it." Which header a TEMPLATE carries is enforced repo-wide
 * by `tests/unit/templates/template-ownership-header.test.ts`. Nothing checked
 * the copy sitting in an already-seeded consumer.
 *
 * The caller templates moved from copy-overwrite to create-only — on
 * `origin/main`, `cdk/create-only/.github/workflows/` holds `ci.yml` and
 * `deploy.yml` while `cdk/copy-overwrite/.github/workflows/` holds only a
 * `.keep`. Every consumer seeded before that move still carries the old banner,
 * which now says the opposite of what is true.
 *
 * ## The harm is a false belief, and it points the dangerous way
 *
 * MEASURED in the report: a repository had pinned its reusable-workflow refs to
 * immutable SHAs. Reading the stale banner, a reviewer concluded those pins
 * would be erased on the next apply and nearly reverted them to a moving
 * `@main` ref, AND excluded those files from the guard that enforces pinning —
 * on the reasoning that a pin there would convert a required check into a
 * recurring merge outage. The reasoning was sound and the premise was false. It
 * survived five rounds of review by two independent parties, because the banner
 * is the natural place to look for the ownership contract and nothing
 * contradicts it locally.
 *
 * ## Why this REPORTS rather than rewrites
 *
 * The alternative is a migration that corrects the banner in place, and the
 * precedent chain for that is explicit (`ensure-deploy-outcome-guard.ts` makes
 * the argument in its own header, citing `ensure-nightly-e2e-workflow-pins`).
 * It is the wrong instrument here, for three reasons:
 *
 *  1. It would have Lisa write into the very file whose new banner promises
 *     Lisa will not write into it. A consumer who diffs that apply has been
 *     handed the evidence not to believe the new sentence either.
 *  2. Those precedents restore a GUARD the consumer needs — Lisa reinstating
 *     its own enforcement. This content is a STATEMENT ABOUT OWNERSHIP of a
 *     file the consumer owns and may have edited, which is a different act.
 *  3. The failure directions are asymmetric. A stale banner makes a reader too
 *     conservative — a cost, but never data loss. A banner-rewriting migration
 *     can clobber a header a consumer customised, which is.
 *
 * ## One direction only, and why the inverse is not checked here
 *
 * This reports a workflow claiming `managed` when its template has moved to
 * create-only. It does NOT report the inverse — a copy-overwrite asset wearing
 * a create-only banner — and the rejection controls assert that a `seeded`
 * claim is passed rather than flagged.
 *
 * The inverse needs something this check does not have: the LANE, which is a
 * property of the consumer's stack rather than of the file. `ci.yml` ships
 * create-only on five stacks and copy-overwrite on two, so the same filename
 * carrying the same banner is correct in one consumer and stale in the next.
 * Reading a banner cannot distinguish them, and a check that guessed would put
 * its most dangerous answer on the guess.
 *
 * ## What cannot be known from here, and is therefore not claimed
 *
 * How many consumers are affected is UNKNOWABLE from this repository. Lisa
 * cannot see consumer checkouts, so this check answers only for the tree it is
 * pointed at. Any fleet-wide number would be an estimate wearing a measurement's
 * clothes.
 *
 * The consumer's LANE for a given workflow is unknowable here for the same
 * reason, and that bounds what the warning may assert. It reports the banner it
 * found; the reassurance it offers is true for the stacks whose `ci.yml` is
 * create-only and would be false for the two whose `ci.yml` Lisa replaces. That
 * gap is real and is tracked separately — it is not closed by this module.
 * @module cli/doctor-ownership-banner-drift
 */
import { readdir, readFile } from "node:fs/promises";
import * as path from "node:path";

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
 *
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
 *
 * @param targetPath - Repository root to inspect
 * @returns A doctor check row
 */
export async function checkOwnershipBannerDrift(
  targetPath: string
): Promise<DoctorCheck> {
  const name = "Workflow ownership banner";
  const stale = await managedClaims(targetPath);
  if (stale.length === 0) {
    return {
      name,
      status: "ok",
      detail:
        "No workflow claims Lisa replaces it on every run. Nothing here is " +
        "telling a reader their edits will be erased.",
    };
  }
  return {
    name,
    status: "warn",
    detail:
      `${stale.length} workflow(s) carry the old "managed by Lisa, IS replaced ` +
      `on each run" banner: ${stale.join(", ")}. Lisa now ships its workflow ` +
      `callers on the create-only lane, so it will NOT overwrite them — your ` +
      `edits to these files are safe and survive every upgrade. The banner is ` +
      `stale, not the contract. Correct or delete those two header lines by ` +
      `hand when you next touch the file; an apply cannot do it for you, ` +
      `because a create-only file is exactly the thing apply skips. Read the ` +
      `banner as history, and the template lane as the contract.`,
  };
}
