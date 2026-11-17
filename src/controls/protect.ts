/**
 * Make the hosting platform require the checks the control register derives,
 * or hand that change to an administrator.
 *
 * A check only becomes a gate when the platform refuses the merge without it.
 * Whether Lisa may change that setting is the repository owner's decision, so
 * the safe result is the default:
 *
 * - Without `--apply` the run reads the platform, compares, and writes the
 *   handover file. It can send reads only.
 * - With `--apply` it sends a change only after a read of the repository has
 *   said the signed-in account administers it. Permission alone is never
 *   enough, and neither is the flag.
 * - On any platform other than github.com it sends nothing at all.
 *
 * After a change it reads the settings back, and reports `wired` only when
 * what it reads agrees with what it derived.
 *
 * Nothing about a ruleset is decided here: deriving, comparing, planning and
 * writing are the shipped ruleset scripts (`./protect-modules.ts`).
 * @module controls/protect
 */
import { checkStates } from "./protect-derive.js";
import { examine, type Finding } from "./protect-examine.js";
import { syncHandover } from "./protect-handover-file.js";
import { renderHandover } from "./protect-handover.js";
import { PERMISSION_NOT_READ } from "./protect-live.js";
import {
  prepare,
  type Prepared,
  type ProtectDependencies,
  type ProtectOptions,
} from "./protect-prepare.js";
import {
  PROTECT_RESULT_SCHEMA_VERSION,
  type ProtectResult,
  type ProtectSummary,
} from "./protect-types.js";
import { allRequired, differencesOf, entryOutcome } from "./protect-wording.js";

export type { ProtectDependencies, ProtectOptions } from "./protect-prepare.js";

/** The result document, or one line per reason there is none. */
export type ProtectRun =
  | { readonly problems: null; readonly result: ProtectResult }
  | { readonly problems: readonly string[] };

/** Said when the register asks nothing of merge protection. */
const NOTHING_TO_REQUIRE =
  "The control register holds no rule that is authoritative and required on a pull request, so there is nothing for the hosting platform to require.";

/** Said in the handover when each open check carries its own reason. */
const SEE_TABLE =
  "The table below says, for each check, why it cannot safely be required yet.";

/**
 * Turn what was found into the result document and the handover file.
 *
 * The handover file is written exactly when a derived check is not known to
 * be required, and removed otherwise.
 * @param prepared - What is known about the repository
 * @param finding - What asking the platform concluded, or `null` when the
 *   register asks nothing of merge protection and the platform was not asked
 * @returns The result, or why the handover file could not be kept
 */
async function report(
  prepared: Prepared,
  finding: Finding | null
): Promise<ProtectRun> {
  const { derived, platform, options } = prepared;
  const branch = finding?.branch ?? null;
  const runReason = finding?.runReason ?? "";
  const checks = checkStates(derived.checks, finding?.required ?? null);
  const entries = derived.entries.map(entry =>
    entryOutcome(entry, checks, branch, runReason)
  );
  const blocked = entries.find(entry => entry.outcome === "blocked");
  const open = checks.some(check => check.state !== "required");
  const synced = await syncHandover(
    prepared.root,
    open
      ? renderHandover({
          platform,
          branch,
          reason: runReason === "" ? SEE_TABLE : runReason,
          checks,
          entries: derived.entries,
        })
      : null
  );
  if (synced.problem !== null) return { problems: [synced.problem] };
  const settled: ProtectSummary =
    finding === null ? "nothing-to-require" : "wired";
  const settledReason =
    finding === null
      ? NOTHING_TO_REQUIRE
      : allRequired(branch, finding.changed);
  const blockedReason = runReason === "" ? blocked?.reason : runReason;
  return {
    problems: null,
    result: {
      schema_version: PROTECT_RESULT_SCHEMA_VERSION,
      mode: options.apply === true ? "apply" : "read-only",
      outcome: blocked === undefined ? settled : "blocked",
      reason: blocked === undefined ? settledReason : (blockedReason ?? ""),
      platform,
      branch,
      permission: finding?.permission ?? PERMISSION_NOT_READ,
      required_checks: checks,
      differences: differencesOf(checks, branch),
      requests: prepared.log.requests(),
      handover: synced.handover,
      entries,
    },
  };
}

/**
 * Compare a repository's merge protection with its control register and,
 * when asked and allowed, change it.
 * @param root - Real path of the repository
 * @param options - The command's options
 * @param dependencies - Replaceable collaborators
 * @returns The result document, or one line per reason there is none
 */
export async function protectRepository(
  root: string,
  options: ProtectOptions = {},
  dependencies: ProtectDependencies = {}
): Promise<ProtectRun> {
  try {
    const preparation = await prepare(root, options, dependencies);
    if (preparation.problems !== null) return preparation;
    const { prepared } = preparation;
    return await report(
      prepared,
      prepared.derived.entries.length === 0 ? null : await examine(prepared)
    );
  } catch (error) {
    return {
      problems: [error instanceof Error ? error.message : String(error)],
    };
  }
}
