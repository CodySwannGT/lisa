/**
 * Asking the hosting platform what it requires and, when the run was told to
 * and a read has said it may, changing it.
 *
 * The order is fixed, and each step can only narrow what the run may do:
 *
 * 1. A platform this command does not reach is never asked anything.
 * 2. The repository is read. A read that fails ends the run with nothing
 *    compared and nothing changed.
 * 3. The settings are compared with the derived checks. When nothing is
 *    missing, nothing more is asked and nothing is sent.
 * 4. Each missing check must be shown to have been reported. One the
 *    platform shows no result for, or could not be asked about, is held back
 *    and is in no write (`./protect-reported.ts`).
 * 5. A change is sent only with `--apply` and only when the read in step 2
 *    said the signed-in account administers the repository.
 * 6. After a change the settings are read back and compared again. What is
 *    reported is what was read back, never what was sent.
 * @module controls/protect-examine
 */
import { planChange, sendChange } from "./protect-apply.js";
import {
  neverReported,
  reportingNotRead,
  type HeldBack,
} from "./protect-held.js";
import {
  PERMISSION_NOT_READ,
  compareWithLive,
  governing,
  readLiveState,
  type LiveState,
  type Requirement,
} from "./protect-live.js";
import type { Prepared } from "./protect-prepare.js";
import { readReported } from "./protect-reported.js";
import { readRulesetsBack } from "./protect-requests.js";
import type { PermissionProbe } from "./protect-types.js";
import {
  NOT_ASKED_TO_APPLY,
  READ_BACK_DIFFERS,
  branchName,
  couldNotRead,
  writeRefused,
} from "./protect-wording.js";

/** What asking the platform concluded. */
export interface Finding {
  readonly branch: string | null;
  readonly permission: PermissionProbe;
  /** The derived checks the platform requires, or `null` when not read. */
  readonly required: ReadonlySet<string> | null;
  /** Why this run did not require what is missing; empty when nothing is. */
  readonly runReason: string;
  /** Whether a change was sent. */
  readonly changed: boolean;
  /** The checks held back because nothing shows them reported, with why. */
  readonly unreported: ReadonlyMap<string, HeldBack>;
}

/** No check was held back for want of a report. */
const NONE_UNREPORTED: ReadonlyMap<string, HeldBack> = new Map();

/** The missing checks, sorted into the ones that may be sent and the rest. */
interface Proved {
  /** The requirement without the checks that are held back. */
  readonly requirement: Requirement;
  /** Whether any missing check is left to send. */
  readonly sendable: boolean;
  readonly unreported: ReadonlyMap<string, HeldBack>;
}

/**
 * Hold back every missing check the platform does not show as reported.
 * @param prepared - What is known about the repository
 * @param repository - `owner/name`
 * @param branch - The branch to protect
 * @param missing - The derived checks the branch does not require
 * @returns The requirement that may be sent, and what was held back
 */
function proveReported(
  prepared: Prepared,
  repository: string,
  branch: string,
  missing: readonly string[]
): Proved {
  const { requirement, modules, log } = prepared;
  const proof = readReported(repository, branch, missing, log.read, modules);
  const on = branchName(branch);
  const heldBack = missing.filter(name => !proof.reported.has(name));
  const held = new Set(heldBack);
  return {
    requirement: {
      ...requirement,
      declared: requirement.declared.filter(name => !held.has(name)),
      awaited: requirement.awaited.filter(name => !held.has(name)),
    },
    sendable: heldBack.length < missing.length,
    unreported: new Map(
      heldBack.map(name => [
        name,
        proof.unread === null
          ? neverReported(on)
          : reportingNotRead(on, proof.unread),
      ])
    ),
  };
}

/**
 * Send the change and read the settings back.
 * @param prepared - What is known about the repository
 * @param requirement - The checks that may be made required
 * @param live - The platform as it was read before the change
 * @param branch - The branch to protect
 * @returns What the read-back found
 */
async function applyChange(
  prepared: Prepared,
  requirement: Requirement,
  live: LiveState,
  branch: string
): Promise<Pick<Finding, "required" | "runReason" | "changed">> {
  const { modules, options, log } = prepared;
  const repository = prepared.platform.repository ?? "";
  const rulesetName = options.ruleset ?? null;
  const enforced = governing(
    live.rulesets,
    branch,
    live.defaultBranch,
    modules
  );
  const comparison = compareWithLive(
    requirement,
    enforced,
    rulesetName,
    modules
  );
  const plan = planChange({
    comparison,
    requirement,
    rulesets: live.rulesets,
    enforced,
    branch,
    defaultBranch: live.defaultBranch,
    rulesetName,
    policy: prepared.policy,
    modules,
  });
  if (plan.blockers.length > 0) {
    return {
      required: new Set(comparison.drift.matched),
      runReason: `${plan.blockers.join(" ")} Nothing was changed.`,
      changed: false,
    };
  }
  const failures = sendChange(repository, log.write, plan.actions, modules);
  const back = await readRulesetsBack(log.read, repository, prepared.root);
  if (!back.ok) {
    return {
      required: null,
      runReason: `The change was sent, but the settings could not be read back (${back.reason}), so it is not confirmed.`,
      changed: true,
    };
  }
  const after = compareWithLive(
    requirement,
    governing(back.rulesets, branch, live.defaultBranch, modules),
    rulesetName,
    modules
  );
  const unconfirmed =
    failures.length > 0 ? writeRefused(failures) : READ_BACK_DIFFERS;
  return {
    required: new Set(after.drift.matched),
    runReason: after.drift.missing.length === 0 ? "" : unconfirmed,
    changed: true,
  };
}

/**
 * Compare one branch with the derived checks and, when allowed, change it.
 * @param prepared - What is known about the repository
 * @param repository - `owner/name`
 * @param live - The platform as it was read
 * @param branch - The branch to protect
 * @returns What was found
 */
async function examineBranch(
  prepared: Prepared,
  repository: string,
  live: LiveState,
  branch: string
): Promise<Finding> {
  const { options, modules, requirement } = prepared;
  const comparison = compareWithLive(
    requirement,
    governing(live.rulesets, branch, live.defaultBranch, modules),
    options.ruleset ?? null,
    modules
  );
  const found = {
    branch,
    permission: live.permission,
    required: new Set(comparison.drift.matched),
    changed: false,
    unreported: NONE_UNREPORTED,
    runReason: "",
  };
  const { missing } = comparison.drift;
  if (missing.length === 0) return found;
  const proved = proveReported(prepared, repository, branch, missing);
  const held = { ...found, unreported: proved.unreported };
  if (!proved.sendable) return held;
  if (options.apply !== true) {
    return { ...held, runReason: NOT_ASKED_TO_APPLY };
  }
  return live.permission.can_change === true
    ? {
        ...held,
        ...(await applyChange(prepared, proved.requirement, live, branch)),
      }
    : { ...held, runReason: `${live.permission.detail} Nothing was changed.` };
}

/**
 * Ask the platform what it requires and, when allowed, change it.
 * @param prepared - What is known about the repository
 * @returns What was found
 */
export async function examine(prepared: Prepared): Promise<Finding> {
  const { platform, options, modules, log } = prepared;
  const unread = {
    branch: options.branch ?? null,
    permission: PERMISSION_NOT_READ,
    required: null,
    changed: false,
    unreported: NONE_UNREPORTED,
  };
  if (!platform.reachable || platform.repository === null) {
    return { ...unread, runReason: platform.note ?? "" };
  }
  const read = readLiveState(platform.repository, log.read, modules);
  if (!read.ok) return { ...unread, runReason: couldNotRead(read.reason) };
  const live = read.state;
  const branch = options.branch ?? live.defaultBranch;
  return branch === null
    ? {
        ...unread,
        permission: live.permission,
        runReason:
          "The platform did not name the repository's default branch, so nothing was compared. Say which branch to protect with --branch <name>.",
      }
    : examineBranch(prepared, platform.repository, live, branch);
}
