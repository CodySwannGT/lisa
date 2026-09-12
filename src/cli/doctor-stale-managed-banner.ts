/**
 * `lisa doctor` check: does a "managed by Lisa" banner in this project still
 * tell the truth?
 *
 * The banner is an instruction — "IS replaced on each `lisa` run. Do not edit
 * directly" — and a template removed upstream leaves it behind, still giving
 * that instruction, with nothing anywhere to contradict it. Apply cannot: it
 * iterates the templates it HAS, so a path it no longer ships is a path it
 * never visits again. The consequence is not cosmetic. In a consuming
 * repository a proposal to remove one of these orphaned workflows was closed
 * with the reason "Lisa-managed file", which was untrue, and any ownership
 * audit that trusts the banner reaches the opposite of the right answer
 * (CodySwannGT/lisa#3703).
 *
 * ## What it does, and the thing it must never do
 *
 * It reports. It does not strip banners, rewrite headers, or delete files. The
 * file under a false banner may be the host's only copy of that workflow, Lisa
 * has no template left to reconcile it against, and an automatic repair would
 * be Lisa editing a file in the same breath as proving it does not own it. The
 * remedy named is an edit to one sentence, made by someone with the context.
 *
 * ## Three states, and why the third is the one that matters
 *
 * `ok` means the package was read and every managed banner has a template.
 * A finding means the package was read and some banner does not. The third —
 * "could not determine" — covers a template tree that is unreadable or absent,
 * a directory that refuses to be listed, and an installed package OLDER than
 * the one that last applied here. Collapsing it into the second would report
 * every managed file in the repository as retired at once, which is precisely
 * the vacuous-probe failure the issue itself names: run the obvious "is this
 * path in the installed package?" check from a checkout with no dependencies
 * installed and every file answers no.
 * @module cli/doctor-stale-managed-banner
 */
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { lt, valid } from "semver";

import { readApplyReceipt } from "../core/apply-receipt.js";
import { isLisaSourceRepo } from "../core/self-apply.js";
import {
  classifyManagedBanner,
  describeStaleManagedBanners,
  type ShippedTemplateStrategy,
} from "../core/stale-managed-banner.js";
import {
  listDirectory,
  readHeaderPrefix,
  shippedDestinations,
  type BannerScanDeps,
} from "./doctor-stale-banner-scan.js";
import { getPackageVersion } from "./version.js";

/** Name of the stale-banner check as doctor reports it. */
export const STALE_MANAGED_BANNER_CHECK_NAME = "Managed-file banners true?";

/**
 * The installed Lisa package root, resolved the way apply resolves it.
 *
 * `dist/cli/<module>.js` sits two directories below the package root, which is
 * the same relationship `cli/doctor-lisa-owned-artifacts` relies on.
 */
const DEFAULT_LISA_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/** Shape of one doctor check result (structurally identical to doctor's). */
interface BannerCheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/**
 * The destination prefix used as the vacuity sentinel.
 *
 * A non-empty index is not enough on its own: a package root holding one stray
 * lane directory would satisfy it. Workflow templates are shipped by seven of
 * the lanes and are the population this defect was measured in, so a package
 * that indexes no workflow destination at all is not a template set this check
 * can reason from — it is an unread one, and the honest answer is that it could
 * not tell.
 */
const WORKFLOW_DESTINATION_PREFIX = ".github/workflows/";

/**
 * Build one "could not determine" result.
 *
 * Deliberately a `warn` rather than an `ok`. A probe that could not look has
 * not found a clean repository, and spelling the two the same way is the defect
 * this check exists to end.
 * @param reason - What could not be established, in operator terms
 * @returns The doctor result
 */
function indeterminate(reason: string): BannerCheckResult {
  return {
    detail: `Could not determine whether this project's managed-file banners are still true: ${reason}. Reported rather than passed: a probe that could not read the installed package would report every managed file as orphaned, which is this defect wearing the detector's hat`,
    name: STALE_MANAGED_BANNER_CHECK_NAME,
    status: "warn",
  };
}

/**
 * Whether the installed package is older than the one that last applied here.
 *
 * A downgrade inverts the question. A template the newer Lisa shipped and this
 * older one does not is absent because it has not arrived yet, not because it
 * was retired — and the banner on disk was stamped by the version that DID
 * ship it. Without this arm the check would tell an operator to take ownership
 * of files their next `lisa apply` will resume managing.
 * @param targetPath - Project path to inspect
 * @returns The receipt's version when this package is behind it, else undefined
 */
async function versionSkew(targetPath: string): Promise<string | undefined> {
  const receipt = await readApplyReceipt(targetPath);
  const applied = receipt === null ? null : valid(receipt.lisa_version);
  const installed = valid(getPackageVersion());
  if (applied === null || installed === null) return undefined;
  return lt(installed, applied) ? applied : undefined;
}

/**
 * Every repo-relative file that lives in a directory Lisa writes into.
 *
 * The population is derived from the shipped destinations rather than declared,
 * so a new template lane widens it automatically and a restated list cannot
 * drift out of step. Listing is one level deep per directory: the directories
 * themselves already come from the destination set, so recursing would only
 * add trees Lisa never writes to — including, at the repository root, the whole
 * repository.
 * @param targetPath - Project path to inspect
 * @param destinations - Destination index the directories are derived from
 * @param readDirectory - Directory lister that rejects rather than guessing
 * @returns Repo-relative paths of files Lisa does not ship
 * @throws {Error} When a directory cannot be read
 */
async function candidateFiles(
  targetPath: string,
  destinations: ReadonlyMap<string, ShippedTemplateStrategy>,
  readDirectory: typeof listDirectory
): Promise<readonly string[]> {
  const directories = new Set(
    [...destinations.keys()].map(destination => path.posix.dirname(destination))
  );
  const listings = await Promise.all(
    [...directories].map(async directory => {
      const entries = await readDirectory(path.join(targetPath, directory));
      return entries
        .filter(entry => entry.isFile)
        .map(entry =>
          directory === "." ? entry.name : `${directory}/${entry.name}`
        );
    })
  );
  return listings.flat();
}

/**
 * Report files whose managed banner the installed package no longer backs.
 * @param targetPath - Project path to inspect
 * @param lisaRoot - Installed Lisa package root (injected by tests)
 * @param deps - Filesystem seam, so a refusing directory can be exercised
 * @returns Doctor check result
 */
export async function checkStaleManagedBanner(
  targetPath: string,
  lisaRoot: string = DEFAULT_LISA_ROOT,
  deps: BannerScanDeps = {}
): Promise<BannerCheckResult> {
  try {
    // Lisa's own repository is the one host that AUTHORS the files it ships,
    // including reusable workflows that live only here and are called by
    // reference rather than copied. Every one of those is unshipped-by-
    // construction, so without this the check would report Lisa's own CI to
    // itself, every run, forever.
    if (await isLisaSourceRepo(targetPath)) {
      return {
        detail:
          "Lisa's own repository authors the files it ships; there is no installed package for its banners to be stale against",
        name: STALE_MANAGED_BANNER_CHECK_NAME,
        status: "ok",
      };
    }
    const destinations = await shippedDestinations(lisaRoot);
    if (
      ![...destinations.keys()].some(destination =>
        destination.startsWith(WORKFLOW_DESTINATION_PREFIX)
      )
    ) {
      return indeterminate(
        `the Lisa package at ${lisaRoot} indexes no workflow templates at all, so it could not be read as a template set`
      );
    }
    const skew = await versionSkew(targetPath);
    if (skew !== undefined) {
      return indeterminate(
        `this project last applied Lisa ${skew}, which is newer than the ${getPackageVersion()} installed here, so an absent template may simply not have arrived yet`
      );
    }
    return await report(targetPath, destinations, deps);
  } catch (error) {
    return indeterminate(
      error instanceof Error ? error.message : String(error)
    );
  }
}

/**
 * Classify every candidate file and fold the retired ones into one line.
 * @param targetPath - Project path to inspect
 * @param destinations - Destination index built from the installed package
 * @param deps - Filesystem seam
 * @returns Doctor check result
 * @throws {Error} When a directory or file cannot be read
 */
async function report(
  targetPath: string,
  destinations: ReadonlyMap<string, ShippedTemplateStrategy>,
  deps: BannerScanDeps
): Promise<BannerCheckResult> {
  const candidates = await candidateFiles(
    targetPath,
    destinations,
    deps.readDirectory ?? listDirectory
  );
  const verdicts = await Promise.all(
    candidates.map(async relativePath => {
      const header = await readHeaderPrefix(
        path.join(targetPath, relativePath)
      );
      // A file that vanished between the listing and the read is absent, which
      // is an answer: nothing on disk carries a false banner.
      if (header === undefined) return undefined;
      // `overstated` — a template that moved to create-only rather than being
      // removed — is a real finding with a different remedy and a different
      // population, and belongs to CodySwannGT/lisa#3582. The classifier
      // separates it here so that ticket has the mechanism; reporting it is
      // that ticket's call, not this one's.
      return classifyManagedBanner(relativePath, header, destinations).kind ===
        "retired"
        ? relativePath
        : undefined;
    })
  );
  const stale = verdicts.filter(
    (relativePath): relativePath is string => relativePath !== undefined
  );
  return stale.length === 0
    ? {
        detail:
          "Every file claiming Lisa manages it still has a template in the installed package",
        name: STALE_MANAGED_BANNER_CHECK_NAME,
        status: "ok",
      }
    : {
        detail: describeStaleManagedBanners(
          [...stale].sort((left, right) => left.localeCompare(right))
        ),
        name: STALE_MANAGED_BANNER_CHECK_NAME,
        status: "warn",
      };
}
