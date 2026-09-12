/**
 * Doctor check: name the files a local apply removed, and why.
 *
 * `lisa apply` legitimately retires files it owns, and that is not what this
 * check is about. What it is about is WHERE the removal is announced. A plain
 * `bun install` in a consumer worktree runs the apply through the bootstrap
 * postinstall, and every channel that apply speaks on is closed by the time it
 * speaks: package managers hide postinstall stdout, and the reconciliation
 * trampoline the same install schedules is spawned detached with `stdio:
 * "ignore"`. An operator who ran an install for an unrelated reason gets tracked
 * files removed and no sentence anywhere saying so — they find out from `git
 * status`, if they look, and the `D` does not say why (CodySwannGT/lisa#4071).
 *
 * The receipt already recorded the paths (#3656). Nothing read it. A record
 * nobody reads is the same shape of defect as the stream nobody hears, which is
 * why the fix here is not another writer but a reader.
 *
 * ## Why `warn` and not `fail`
 *
 * Every removal reported here may be entirely correct — most are, and two of
 * them are owner rulings against workflows that were actively harmful. The
 * finding is not "something is broken"; it is "something left, and here is what
 * and why, so you can tell whether it was yours". Failing on a correct removal
 * would train the fleet to ignore the one that was not.
 *
 * ## Why refusals are reported at `ok`
 *
 * A refusal is the fail-closed half of the same decision: Lisa was told to
 * remove a path, could not prove the file on disk was its own, and left it
 * alone. Nothing is missing, so it is not a warning — but a fail-closed branch
 * whose only account of itself goes to a stream nobody hears is
 * indistinguishable from one that never ran, so it is said here on the open
 * channel.
 * @module cli/doctor-apply-deletions
 */

import {
  APPLY_RECEIPT_DISPLAY_PATH,
  readApplyReceipt,
} from "../core/apply-receipt.js";

import type { DoctorCheck } from "./doctor.js";

const CHECK_NAME = "Files removed by apply";

/**
 * How many notices are spelled out before the detail defers to the receipt.
 *
 * A detail long enough to scroll pushes every other check off the screen, which
 * is the failure mode this check exists to end rather than relocate. The full
 * list is on disk at a named path either way.
 */
const MAX_LISTED_NOTICES = 5;

/**
 * Whether a recorded notice describes a removal rather than a refusal.
 *
 * The apply composes both on the same list and both begin with a verb it chose,
 * so the prefix is the classification rather than a guess about prose.
 * @param notice - One recorded notice line
 * @returns True when the line reports a file that went
 */
function isRemovalNotice(notice: string): boolean {
  return notice.startsWith("Deleted:") || notice.startsWith("Would delete:");
}

/**
 * Render the removal lines, falling back to the bare paths.
 *
 * A receipt written before `deletion_notices` existed still holds the paths, and
 * "which files" without "why" is worth more than silence — it is exactly what
 * #3656 recorded. So an older receipt degrades to naming them.
 * @param notices - Recorded removal and refusal lines
 * @param paths - Recorded removed paths
 * @returns Lines describing what went
 */
export function describeRemovals(
  notices: readonly string[],
  paths: readonly string[]
): readonly string[] {
  const removals = notices.filter(isRemovalNotice);
  if (removals.length > 0) return removals;
  return paths.map(p => `Deleted: ${p} (no reason recorded)`);
}

/**
 * Compose the operator-facing detail for a receipt that recorded removals.
 * @param lines - Rendered removal lines
 * @param when - When the removals happened, or null when unrecorded
 * @returns The detail string
 */
export function summariseRemovals(
  lines: readonly string[],
  when: string | null
): string {
  const shown = lines.slice(0, MAX_LISTED_NOTICES);
  const rest = lines.length - shown.length;
  const more =
    rest > 0 ? ` (+${rest} more in ${APPLY_RECEIPT_DISPLAY_PATH})` : "";
  const dated = when === null ? "" : ` on ${when}`;
  return (
    `A local apply removed files from this project${dated}. An install runs ` +
    `that apply with its output hidden, so this is where the removal is ` +
    `answerable: ${shown.join(" | ")}${more}. If any of them was yours, ` +
    `restore it from git and add its path to .lisaignore, which is checked ` +
    `before every deletion.`
  );
}

/**
 * Report the refusals a receipt recorded, when it removed nothing.
 * @param notices - Recorded notice lines
 * @returns The doctor check result
 */
function reportRefusalsOnly(notices: readonly string[]): DoctorCheck {
  const refusals = notices.filter(notice => !isRemovalNotice(notice));
  if (refusals.length === 0) {
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "The recorded apply removed nothing from this project",
    };
  }
  return {
    name: CHECK_NAME,
    status: "ok",
    detail:
      `The recorded apply removed nothing, and declined ${refusals.length} ` +
      `removal(s) it could not prove were Lisa's: ` +
      `${refusals.slice(0, MAX_LISTED_NOTICES).join(" | ")}`,
  };
}

/**
 * Report what the recorded apply removed from this project.
 * @param targetPath - Project root
 * @returns The doctor check result
 */
export async function checkApplyDeletions(
  targetPath: string
): Promise<DoctorCheck> {
  const receipt = await readApplyReceipt(targetPath);
  if (receipt === null) {
    // Absence of a receipt is already reported, loudly, by the apply-freshness
    // check. Repeating it here would double-count one finding.
    return {
      name: CHECK_NAME,
      status: "ok",
      detail: "No completed apply is recorded here to report removals from",
    };
  }

  if (receipt.deleted_paths.length === 0) {
    return reportRefusalsOnly(receipt.deletion_notices);
  }

  return {
    name: CHECK_NAME,
    status: "warn",
    detail: summariseRemovals(
      describeRemovals(receipt.deletion_notices, receipt.deleted_paths),
      receipt.deletions_recorded_at
    ),
  };
}
