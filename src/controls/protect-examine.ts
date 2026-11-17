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
 *    missing, nothing is sent.
 * 4. A change is sent only with `--apply` and only when that read said the
 *    signed-in account administers the repository.
 * 5. After a change the settings are read back and compared again. What is
 *    reported is what was read back, never what was sent.
 * @module controls/protect-examine
 */
import { planChange, sendChange } from "./protect-apply.js";
import {
  PERMISSION_NOT_READ,
  compareWithLive,
  governing,
  readLiveState,
  type LiveState,
} from "./protect-live.js";
import type { Prepared } from "./protect-prepare.js";
import { readRulesetsBack } from "./protect-requests.js";
import type { PermissionProbe } from "./protect-types.js";
import {
  NOT_ASKED_TO_APPLY,
  READ_BACK_DIFFERS,
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
}

/**
 * Send the change and read the settings back.
 * @param prepared - What is known about the repository
 * @param live - The platform as it was read before the change
 * @param branch - The branch to protect
 * @returns What the read-back found
 */
async function applyChange(
  prepared: Prepared,
  live: LiveState,
  branch: string
): Promise<Pick<Finding, "required" | "runReason" | "changed">> {
  const { modules, requirement, options, log } = prepared;
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
 * Ask the platform what it requires and, when allowed, change it.
 * @param prepared - What is known about the repository
 * @returns What was found
 */
export async function examine(prepared: Prepared): Promise<Finding> {
  const { platform, options, modules, requirement, log } = prepared;
  const unread = {
    branch: options.branch ?? null,
    permission: PERMISSION_NOT_READ,
    required: null,
    changed: false,
  };
  if (!platform.reachable || platform.repository === null) {
    return { ...unread, runReason: platform.note ?? "" };
  }
  const read = readLiveState(platform.repository, log.read, modules);
  if (!read.ok) return { ...unread, runReason: couldNotRead(read.reason) };
  const live = read.state;
  const branch = options.branch ?? live.defaultBranch;
  if (branch === null) {
    return {
      ...unread,
      permission: live.permission,
      runReason:
        "The platform did not name the repository's default branch, so nothing was compared. Say which branch to protect with --branch <name>.",
    };
  }
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
  };
  if (comparison.drift.missing.length === 0) return { ...found, runReason: "" };
  if (options.apply !== true) {
    return { ...found, runReason: NOT_ASKED_TO_APPLY };
  }
  return live.permission.can_change === true
    ? { ...found, ...(await applyChange(prepared, live, branch)) }
    : {
        ...found,
        runReason: `${live.permission.detail} Nothing was changed.`,
      };
}
