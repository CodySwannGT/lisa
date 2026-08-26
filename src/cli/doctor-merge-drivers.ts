/**
 * `lisa doctor` check: are this checkout's merge drivers actually registered?
 *
 * A merge driver has two halves in two places. The `merge=<name>` mapping is
 * committed in `.gitattributes`; the driver COMMAND is machine-local, because
 * git refuses to run a command a repository supplied. So any clone that never
 * ran the registration step silently falls back to git's built-in text merge —
 * a fresh CI checkout, a teammate who cloned without installing, a worktree
 * created before the migration ran.
 *
 * That degradation is far less catastrophic than it sounds: the text merge
 * leaves conflict markers, which downstream gates diagnose, rather than
 * resolving a file to empty. What it is not is visible. Nothing tells an
 * operator that the driver they believe is protecting a path is not registered
 * here — and invisibility is precisely what let one fleet project lose 19
 * captured learnings. This check is the missing sentence.
 *
 * ## The roster is derived, not named
 *
 * This check used to name `lisa-learnings` and only `lisa-learnings`. That
 * shape has a scheduled failure: Lisa's SECOND merge driver
 * (`lisa-generated-artifact`, CodySwannGT/lisa#3084) would have been uncovered
 * until somebody remembered to widen the check — which is the same
 * "declared, and inert" defect family the driver itself exists to close.
 * The roster now comes from `.gitattributes`, so a driver is covered the day
 * its mapping lands rather than the day someone remembers.
 *
 * Per-driver knowledge is reduced to the one thing that genuinely differs: the
 * remedy sentence, and the learnings driver's documented host opt-out.
 * @module cli/doctor-merge-drivers
 */
import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { mergeDriversInAttributes } from "../core/gitattributes-merge-drivers.js";
import { probeLearningsMergeDriverRegistration } from "../core/learnings-merge-driver-install.js";
import { LEARNINGS_MERGE_DRIVER_NAME } from "../core/learnings-merge-driver.js";
import { probeMergeDriverRegistration } from "../core/merge-driver-registration.js";
import { readProjectConfig } from "../core/project-config.js";
import { resolveLearningsSettings } from "../core/project-config-learnings.js";

/** Name of the merge-driver check as doctor reports it. */
export const MERGE_DRIVERS_CHECK_NAME = "Merge drivers registered?";

/** Shape of one doctor check result (structurally identical to doctor's). */
interface MergeDriverCheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

/**
 * Build one check result under this check's name.
 * @param status - Reported status
 * @param detail - Operator-readable explanation
 * @returns Doctor check result
 */
function result(status: "ok" | "warn", detail: string): MergeDriverCheckResult {
  return { name: MERGE_DRIVERS_CHECK_NAME, status, detail };
}

/**
 * The remedy that registers one driver.
 *
 * Only the learnings driver rides on `lisa apply`; the generated-artifact
 * driver is registered from Lisa's own `postinstall`, because apply is
 * self-restricted in the source repository and would never reach it.
 * @param driver - Merge-driver name
 * @returns One-sentence repair instruction
 */
function remedyFor(driver: string): string {
  if (driver === LEARNINGS_MERGE_DRIVER_NAME) {
    return "Fix it with `lisa install-merge-driver` (or any `lisa apply`) run here. Hosts that do not want the driver set learnings.mergeDriver: false in .lisa.config.json.";
  }
  return "Fix it by running your package manager's install here, which registers it from postinstall.";
}

/**
 * The sentence naming one mapped-but-unregistered driver.
 * @param driver - Merge-driver name
 * @returns Operator-readable detail
 */
function unregisteredDetail(driver: string): string {
  return `.gitattributes maps a path to the ${driver} merge driver, but merge.${driver}.driver is not registered in this checkout — git silently falls back to its built-in text merge, so those paths conflict on every merge as if the mapping did not exist. ${remedyFor(driver)}`;
}

/**
 * Read the merge drivers this checkout's `.gitattributes` asks for.
 *
 * The file is read directly rather than confirmed through `git check-attr`,
 * and the imprecision runs in the safe direction: a pattern git would not
 * actually apply yields one spurious warn, never a missed one, and this check
 * warns rather than fails. The INSTALLER
 * (`scripts/install-generated-artifact-merge-driver.mjs`) does confirm through
 * git, because it writes config and must not act on a mapping git disagrees
 * with.
 * @param targetPath - Project path to inspect
 * @returns Driver names, empty when there is no `.gitattributes`
 */
async function mappedDrivers(targetPath: string): Promise<readonly string[]> {
  try {
    return mergeDriversInAttributes(
      await readFile(path.join(targetPath, ".gitattributes"), "utf8")
    );
  } catch {
    return [];
  }
}

/**
 * The drivers this checkout maps but cannot run.
 *
 * Probed in parallel: the roster is small, and one sequential `git config` per
 * driver would put doctor's cost on a curve nobody expects it to be on.
 * @param targetPath - Project path to inspect
 * @param drivers - Driver names expected to be registered here
 * @returns The subset with no resolvable command
 */
async function unregisteredAmong(
  targetPath: string,
  drivers: readonly string[]
): Promise<readonly string[]> {
  const states = await Promise.all(
    drivers.map(driver => probeMergeDriverRegistration(targetPath, driver))
  );
  return drivers.filter((_, index) => states[index] !== "registered");
}

/**
 * The "everything is fine" sentence, which says WHICH fine it is.
 * @param expected - Drivers this checkout is expected to have registered
 * @param optedOut - Drivers a host config has declined
 * @returns Operator-readable detail
 */
function satisfiedDetail(
  expected: readonly string[],
  optedOut: readonly string[]
): string {
  const optOut =
    optedOut.length === 0
      ? ""
      : ` (${optedOut.join(", ")} opted out via learnings.mergeDriver: false)`;
  return expected.length === 0
    ? `No merge driver is expected in this checkout${optOut}`
    : `Every mapped merge driver is registered here: ${expected.join(", ")}${optOut}`;
}

/**
 * Report whether this checkout can actually run the merge drivers it maps.
 *
 * Warn, never fail: an unregistered driver degrades to a merge that conflicts
 * loudly instead of one that loses content, so reddening a CI checkout over it
 * would trade a real signal for noise. The states that are genuinely fine — a
 * host that opted out, a directory that is not a git repository, a repository
 * with nothing mapped — report ok and say which one they are, rather than
 * sharing one indistinguishable "skipped".
 * @param targetPath - Project path to inspect
 * @returns Doctor check result
 */
export async function checkMergeDrivers(
  targetPath: string
): Promise<MergeDriverCheckResult> {
  try {
    // Any driver answers the repository/git question; the learnings probe is
    // reused because it already distinguishes a missing git binary from a real
    // non-repository, and reporting "not a git repository" about a directory
    // that plainly is one is the failure that probe exists to prevent.
    const repository = await probeLearningsMergeDriverRegistration(targetPath);
    if (repository === "not-a-repository") {
      return result(
        "ok",
        "Not a git repository, so merge-driver registration does not apply"
      );
    }
    if (repository === "git-unavailable") {
      return result(
        "warn",
        "git executable not found, so merge-driver registration could not be verified — install git, then re-run `lisa doctor`"
      );
    }
    const drivers = await mappedDrivers(targetPath);
    if (drivers.length === 0) {
      return result(
        "ok",
        "Nothing in .gitattributes maps a path to a custom merge driver, so there is nothing to register"
      );
    }
    const config = await readProjectConfig(targetPath);
    const optedOut = resolveLearningsSettings(config).mergeDriverEnabled
      ? []
      : [LEARNINGS_MERGE_DRIVER_NAME];
    const expected = drivers.filter(driver => !optedOut.includes(driver));
    const unregistered = await unregisteredAmong(targetPath, expected);
    return unregistered.length === 0
      ? result("ok", satisfiedDetail(expected, optedOut))
      : result("warn", unregistered.map(unregisteredDetail).join(" "));
  } catch (error) {
    return result(
      "warn",
      `Could not inspect this checkout's merge drivers: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}
