/**
 * The four checks that ask what Lisa SEEDED into this repository, and whether
 * what it seeded still says what it meant.
 *
 * They are grouped because they are one operator question asked four ways, and
 * because each of them exists for the same structural reason: the write path
 * that could have prevented the defect is reached exactly once, before the file
 * exists. A repository that received the template earlier therefore has no
 * signal of any kind — the seeding postinstall is skipped under CI, the file is
 * untracked, and the tool the file disables reports only that it found nothing.
 * A fix on the write path reaches the NEXT adoption; these four are how an
 * existing one finds itself.
 *
 * `doctor-lisa-owned-artifacts` is the inverse and deliberately stays where it
 * is: it walks the templates Lisa SHIPS and asks whether this project's copies
 * are current. A template removed upstream leaves that loop entirely, which is
 * why `checkStaleManagedBanner` below walks the other direction — the files on
 * disk that CLAIM Lisa manages them, asking which of those claims the installed
 * package still backs.
 * @module cli/doctor-seeded-artifacts
 */
import { checkCdkPresetAdoption } from "./doctor-cdk-preset-adoption.js";
import { checkConfigShadowing } from "./doctor-config-shadowing.js";
import { checkRailsDeployIntent } from "./doctor-rails-deploy-intent.js";
import { checkStaleManagedBanner } from "./doctor-stale-managed-banner.js";
import type { DoctorCheck } from "./doctor.js";

/**
 * Run every seeded-artifact check, in the order an operator reads them.
 *
 * Sequential rather than concurrent, matching the surrounding checks: they
 * share a target directory and the report is read top to bottom, so a stable
 * order is worth more here than the milliseconds.
 * @param targetPath - Repository root to inspect
 * @returns One check row per question, in report order
 */
export async function checkSeededArtifacts(
  targetPath: string
): Promise<readonly DoctorCheck[]> {
  return [
    // Whether a file Lisa seeded is OUTRANKING one the project wrote itself
    // (CodySwannGT/lisa#3858).
    await checkConfigShadowing(targetPath),
    // Whether a file Lisa is FORBIDDEN to refresh still reads as deliberate.
    // The seed fix reaches new adoptions only and the apply path will not
    // rewrite a host-owned workflow (CodySwannGT/lisa#3779).
    await checkRailsDeployIntent(targetPath),
    // Whether a whole stack preset was delivered to a repository that never
    // qualified for it. The detection fix reaches the next decision only, and
    // the dead-code gate it skewed reports SUCCESS (CodySwannGT/lisa#3711).
    await checkCdkPresetAdoption(targetPath),
    // Which "Lisa manages this file" banners the installed package still
    // backs. A proposal to remove one such orphaned workflow was declined on
    // the strength of the false banner (CodySwannGT/lisa#3703).
    await checkStaleManagedBanner(targetPath),
  ];
}
