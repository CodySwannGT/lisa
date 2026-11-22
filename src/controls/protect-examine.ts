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
 *    missing, nothing more is asked and nothing is sent. A check that reads
 *    as missing while a ruleset of unknown reach requires it is not known to
 *    be missing: it is reported as not known and is in no write.
 * 4. Each missing check must be shown to have been reported, by the source
 *    the change would require it from. One the platform shows no such result
 *    for, or could not be asked about, is held back and is in no write
 *    (`./protect-reported.ts`).
 * 5. A change is sent only with `--apply` and only when the read in step 2
 *    said the signed-in account administers the repository. A change that
 *    would alter which app may satisfy a check that is already required is
 *    never sent (`./protect-apply.ts`).
 * 6. After a change the settings are read back and compared again. What is
 *    reported is what was read back, never what was sent.
 * @module controls/protect-examine
 */
import {
  RULESET_PAGE_SIZE,
  isWholeRulesetList,
} from "../health/ruleset-inspection.js";
import { planChange, plannedApps, sendChange } from "./protect-apply.js";
import {
  leastOpen,
  neverReported,
  reachNotKnown,
  reportedByAnother,
  reportingNotRead,
  type HeldBack,
} from "./protect-held.js";
import {
  PERMISSION_NOT_READ,
  appToRequire,
  compareWithLive,
  governing,
  possiblyRequired,
  readLiveState,
  unsettled,
  type Comparison,
  type LiveState,
  type Requirement,
} from "./protect-live.js";
import type { RepairAction } from "./protect-modules.js";
import type { Prepared } from "./protect-prepare.js";
import { readReported, type WantedCheck } from "./protect-reported.js";
import { readRulesetsBack } from "./protect-requests.js";
import { isBranchName, type PermissionProbe } from "./protect-types.js";
import {
  NOT_ASKED_TO_APPLY,
  READ_BACK_DIFFERS,
  branchName,
  couldNotBeReadBack,
  couldNotRead,
  unusableDefaultBranch,
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
  /**
   * The checks that were not made required, each with why: nothing shows it
   * reported by the source that counts, or it is not known whether it is
   * required already.
   */
  readonly heldBack: ReadonlyMap<string, HeldBack>;
  /**
   * The checks it is not known to be required or not, because a ruleset of
   * unknown reach holds them. They are never listed as a difference.
   */
  readonly unconfirmed: ReadonlySet<string>;
}

/** No check was held back. */
const NONE_HELD: ReadonlyMap<string, HeldBack> = new Map();

/** No check is of unknown standing. */
const NONE_UNCONFIRMED: ReadonlySet<string> = new Set();

/** The missing checks, sorted into the ones that may be sent and the rest. */
interface Proved {
  /** The requirement without the checks that are held back. */
  readonly requirement: Requirement;
  /** The checks that may be sent, each with the app it was proved from. */
  readonly wanted: readonly WantedCheck[];
  /** Whether any missing check is left to send. */
  readonly sendable: boolean;
  readonly unreported: ReadonlyMap<string, HeldBack>;
}

/**
 * Hold back every missing check the platform does not show as reported by
 * the source the change would require it from.
 * @param prepared - What is known about the repository
 * @param repository - `owner/name`
 * @param branch - The branch to protect
 * @param comparison - The comparison that found the checks missing
 * @returns The requirement that may be sent, and what was held back
 */
function proveReported(
  prepared: Prepared,
  repository: string,
  branch: string,
  comparison: Comparison
): Proved {
  const { requirement, modules, log } = prepared;
  const { missing } = comparison.drift;
  // Each missing check is asked about from the app the change would pin it
  // to, so that a name only another source reports is not made required.
  const wanted = comparison.drift.missingRecords.map(record => ({
    context: record.context,
    ...appToRequire(record, requirement, comparison.awaitedRecords),
  }));
  const proof = readReported(repository, branch, wanted, log.read, modules);
  const on = branchName(branch);
  const heldBack = missing.filter(name => !proof.reported.has(name));
  const held = new Set(heldBack);
  const whyHeld = (name: string): HeldBack => {
    if (proof.unread !== null) return reportingNotRead(on, proof.unread);
    const seen = proof.elsewhere.get(name);
    // Only a check pinned to an app can be seen and still not count, so the
    // declarations any source satisfies say nothing about what to do.
    const pinned = wanted.filter(
      check => check.context === name && check.appId !== null
    );
    return seen === undefined
      ? neverReported(on)
      : reportedByAnother(
          on,
          pinned.map(check => check.appId),
          seen,
          leastOpen(pinned.map(check => check.origin))
        );
  };
  return {
    requirement: withoutChecks(requirement, held),
    wanted: wanted.filter(check => !held.has(check.context)),
    sendable: heldBack.length < missing.length,
    unreported: new Map(heldBack.map(name => [name, whyHeld(name)])),
  };
}

/**
 * Find a check a planned change would require from an app it was not shown
 * to have been reported by.
 *
 * The app each missing check is asked about is worked out before the change
 * is planned ({@link appToRequire}), and the change is planned by the
 * reconciler. Should the two ever disagree, the proof would be about one app
 * and the write about another, so the disagreement stops the change.
 * @param actions - The planned steps
 * @param wanted - The checks that were shown to be reported, with their app
 * @returns One sentence per such check; empty when the plan matches the proof
 */
function unproved(
  actions: readonly RepairAction[],
  wanted: readonly WantedCheck[]
): readonly string[] {
  return plannedApps(actions)
    .filter(
      planned =>
        !wanted.some(
          check =>
            check.context === planned.context && check.appId === planned.appId
        )
    )
    .map(
      planned =>
        `The change would require \`${planned.context}\` ${planned.appId === null ? "from any source" : `from app ${String(planned.appId)}`}, and it was not confirmed that this source has ever reported it.`
    );
}

/**
 * Find a planned change whose result could not be read back.
 *
 * What is reported after a change is what was read back, and the ruleset
 * list is only taken for the whole list while it is shorter than a page. A
 * step that creates a ruleset makes the list longer. Sent on a repository
 * one short of a full page, it would be reported as not confirmed, and every
 * later run would then find a list it cannot read at all. So such a change
 * is not sent.
 * @param actions - The planned steps
 * @param listed - How many rulesets the platform listed before the change
 * @returns One sentence; empty when the change can be read back
 */
function unconfirmable(
  actions: readonly RepairAction[],
  listed: number
): readonly string[] {
  const created = actions.filter(
    action => action.rulesetId === null || action.rulesetId === undefined
  ).length;
  return created === 0 || isWholeRulesetList(listed + created)
    ? []
    : [couldNotBeReadBack(listed, RULESET_PAGE_SIZE)];
}

/**
 * Send the change and read the settings back.
 * @param prepared - What is known about the repository
 * @param proved - The checks that may be made required, each with the app
 *   it was shown to be reported by
 * @param live - The platform as it was read before the change
 * @param branch - The branch to protect
 * @returns What the read-back found
 */
async function applyChange(
  prepared: Prepared,
  proved: Proved,
  live: LiveState,
  branch: string
): Promise<Pick<Finding, "required" | "runReason" | "changed">> {
  const { modules, options, log } = prepared;
  const { requirement } = proved;
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
  const blockers =
    plan.blockers.length > 0
      ? plan.blockers
      : [
          ...unproved(plan.actions, proved.wanted),
          ...unconfirmable(plan.actions, live.listed),
        ];
  if (blockers.length > 0) {
    return {
      required: new Set(comparison.drift.matched),
      runReason: `${blockers.join(" ")} Nothing was changed.`,
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
  const { options, modules } = prepared;
  const enforced = governing(
    live.rulesets,
    branch,
    live.defaultBranch,
    modules
  );
  const compare = (requirement: Requirement): Comparison =>
    compareWithLive(requirement, enforced, options.ruleset ?? null, modules);
  // A check that reads as missing may be required by a ruleset whose reach
  // could not be worked out. It is not known to be missing, so it is taken
  // out of everything that follows and reported as not known.
  const doubtful = possiblyRequired(
    compare(prepared.requirement).drift.missing,
    unsettled(live.rulesets, branch, live.defaultBranch, modules)
  );
  const settled: Prepared = {
    ...prepared,
    requirement: withoutChecks(prepared.requirement, doubtful),
  };
  const comparison = compare(settled.requirement);
  const reachUnknown = new Map(
    [...doubtful].map(([name, ruleset]) => [
      name,
      reachNotKnown(branchName(branch), ruleset.name, ruleset.reason),
    ])
  );
  const found = {
    branch,
    permission: live.permission,
    required: new Set(comparison.drift.matched),
    changed: false,
    heldBack: reachUnknown,
    unconfirmed: new Set(doubtful.keys()),
    runReason: "",
  };
  if (comparison.drift.missing.length === 0) return found;
  const proved = proveReported(settled, repository, branch, comparison);
  const held = {
    ...found,
    heldBack: new Map([...reachUnknown, ...proved.unreported]),
  };
  if (!proved.sendable) return held;
  if (options.apply !== true) {
    return { ...held, runReason: NOT_ASKED_TO_APPLY };
  }
  return live.permission.can_change === true
    ? { ...held, ...(await applyChange(settled, proved, live, branch)) }
    : { ...held, runReason: `${live.permission.detail} Nothing was changed.` };
}

/**
 * Take some checks out of a requirement.
 * @param requirement - The derived checks
 * @param names - The checks to leave out, by name
 * @param names.has - Tells whether a name is one of them
 * @returns The requirement without them
 */
function withoutChecks(
  requirement: Requirement,
  names: { readonly has: (name: string) => boolean }
): Requirement {
  return {
    ...requirement,
    declared: requirement.declared.filter(name => !names.has(name)),
    awaited: requirement.awaited.filter(name => !names.has(name)),
  };
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
    heldBack: NONE_HELD,
    unconfirmed: NONE_UNCONFIRMED,
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
  // The operator's own --branch was checked before anything was asked. The
  // name the platform gives goes into the same request paths, so it gets the
  // same check before it is used.
  return isBranchName(branch)
    ? examineBranch(prepared, platform.repository, live, branch)
    : {
        ...unread,
        permission: live.permission,
        runReason: unusableDefaultBranch(branch),
      };
}
