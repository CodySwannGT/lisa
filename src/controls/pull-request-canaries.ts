/**
 * Exercising the pull-request moment with canaries, when the operator asked
 * for it.
 *
 * A canary is a real branch and a real pull request, so this path is taken
 * only on request and only as far as each of these allows:
 *
 * 1. **The platform.** Canaries are opened on github.com only. Anywhere
 *    else nothing is asked and nothing is created, and every entry keeps
 *    the result it has at the `observed` rung.
 * 2. **Write access, learned by reading.** The repository is read and its
 *    answer says whether the signed-in account may write. Unless it says
 *    yes, nothing is created and the entries that would have been exercised
 *    are `unknown`, naming the access that is needed. Until then every
 *    request goes through a door that passes on reads only.
 * 3. **The sweep.** Canaries an earlier run left behind are removed, by the
 *    rule in `./canary-names.ts`.
 * 4. **The entries.** Only an entry that is enforced on pull requests and
 *    not at commit or push, and whose check the platform already requires,
 *    gets canaries. An entry proved at commit or push is not exercised a
 *    second time, and a check the platform does not require has already
 *    failed without one.
 *
 * Entries are exercised one at a time, the violating half first, and each
 * canary is removed before the next is opened. That is slower than opening
 * them all at once and keeps at most one stray pull request in the
 * repository at any moment.
 *
 * An exercised entry passes only when the platform would not let the
 * violating change through because the entry's own required check failed,
 * and the same check passed on the clean change.
 * @module controls/pull-request-canaries
 */
import { canaryDoor, fieldOf, type CanaryDoor } from "./canary-door.js";
import { runCanaryHalf, type CanaryRunContext } from "./canary-half.js";
import {
  canaryKeeper,
  removeOnStop,
  sweepCanaries,
  type Removal,
  type SignalSource,
} from "./canary-lifecycle.js";
import { CANARY_LIFETIME_SECONDS, isRunId, newRunId } from "./canary-names.js";
import {
  planCanaries,
  type CanaryPlan,
  type RunnableCanaries,
} from "./canary-plan.js";
import { readBase, readHead } from "./canary-tree.js";
import { entryVerdict } from "./proof-judgement.js";
import type { Observation } from "./pull-request-observe.js";
import type {
  BaseHead,
  CanaryRecord,
  CanarySweep,
  PullRequestPoint,
  WriteProbe,
} from "./pull-request-types.js";
import {
  MAY_NOT_WRITE,
  MAY_WRITE,
  WRITE_NOT_SAID,
  canaryVerdictDetail,
  permissionDetail,
} from "./pull-request-wording.js";
import type { ControlRegisterEntry } from "./register-types.js";

/** How long to pause between two looks at a canary, in seconds. */
export const CANARY_POLL_SECONDS = 15;

/** What a canary run needs from outside, each replaceable in a test. */
export interface CanaryDependencies {
  /** Names this run. Random by default. */
  readonly runId?: () => string;
  /** Pauses for some milliseconds. */
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Where termination signals come from. The process by default. */
  readonly signals?: SignalSource;
  /** Ends the process the way a signal would have. */
  readonly terminate?: (signal: NodeJS.Signals) => void;
}

/** What a canary run is given. */
export interface CanaryInputs {
  /** Real path of the repository the patch files are read from. */
  readonly root: string;
  /** What reading the merge-protection settings showed. */
  readonly observation: Observation;
  /** Every pull-request point, at the `observed` rung. */
  readonly points: readonly PullRequestPoint[];
  /** The register entry of each point, by identifier. */
  readonly entries: ReadonlyMap<string, ControlRegisterEntry>;
  readonly acknowledgeExternalEffects: boolean;
  readonly clock: () => Date;
}

/** What a canary run did. */
export interface CanaryOutcome {
  /** Every point, the exercised ones replaced. */
  readonly points: readonly PullRequestPoint[];
  readonly runId: string;
  readonly permission: WriteProbe | null;
  readonly sweep: CanarySweep | null;
  readonly baseHead: BaseHead | null;
  readonly canaries: readonly CanaryRecord[];
}

/** An entry canaries were asked for, and whether they can be opened. */
interface Planned {
  readonly point: PullRequestPoint;
  readonly plan: CanaryPlan;
}

/** An entry whose canaries can be opened. */
interface Runnable {
  readonly point: PullRequestPoint;
  readonly plan: RunnableCanaries;
}

/**
 * Ask the platform whether the signed-in account may write.
 * @param door - A door that only reads
 * @returns The probe's answer
 */
function probeWriteAccess(door: CanaryDoor): WriteProbe {
  const repository = door.get("");
  const push = repository.ok
    ? fieldOf(repository.value, "permissions", "push")
    : undefined;
  if (push === true) return { can_write: true, detail: MAY_WRITE };
  return push === false
    ? { can_write: false, detail: MAY_NOT_WRITE }
    : { can_write: null, detail: WRITE_NOT_SAID };
}

/**
 * Run both halves of one entry as canaries and say what they show.
 * @param runnable - The entry's point and its plan
 * @param index - The entry's position among the entries exercised
 * @param context - What the run shares
 * @returns The exercised point and the two canaries
 */
async function exercise(
  runnable: Runnable,
  index: number,
  context: CanaryRunContext
): Promise<{
  readonly point: PullRequestPoint;
  readonly canaries: readonly CanaryRecord[];
}> {
  const { point, plan } = runnable;
  const half = (name: "violation" | "clean", sequence: number) =>
    runCanaryHalf(
      {
        entryId: point.entry_id,
        half: name,
        patch: plan.patches[name],
        checks: point.checks.map(({ context, app_ids }) => ({
          context,
          app_ids,
        })),
        timeLimitSeconds: plan.timeLimitSeconds,
        sequence,
      },
      context
    );
  const violation = await half("violation", index * 2 + 1);
  const clean = await half("clean", index * 2 + 2);
  const verdict = entryVerdict(violation.half, clean.half);
  return {
    point: {
      ...point,
      ...verdict,
      detail: canaryVerdictDetail(
        verdict.reason,
        [violation.half, clean.half].find(shown => shown.outcome === "unknown")
      ),
      rung: "exercised",
      time_limit_seconds: plan.timeLimitSeconds,
      halves: [violation.half, clean.half],
      completed_at: clean.half.completed_at,
    },
    canaries: [violation.canary, clean.canary],
  };
}

/**
 * Open, read and remove the canaries of every runnable entry, one at a time.
 * @param runnable - The entries to exercise
 * @param door - A door that may write
 * @param inputs - What the run was given
 * @param dependencies - Replaceable collaborators
 * @param runId - This run's identifier
 * @returns The exercised points, the canaries and the branch head around them
 */
async function openCanaries(
  runnable: readonly Runnable[],
  door: CanaryDoor,
  inputs: CanaryInputs,
  dependencies: CanaryDependencies,
  runId: string
): Promise<Pick<CanaryOutcome, "points" | "canaries" | "baseHead">> {
  const branch = inputs.observation.branch ?? "";
  const based = readBase(door, branch);
  const keeper = canaryKeeper(door);
  const release = removeOnStop(
    keeper,
    dependencies.signals ?? {
      on: (signal, handler) => process.on(signal, handler),
      off: (signal, handler) => process.off(signal, handler),
    },
    dependencies.terminate ?? (signal => process.kill(process.pid, signal))
  );
  const context: CanaryRunContext = {
    door,
    keeper,
    base: based.ok ? based.base : { problem: based.problem },
    baseBranch: branch,
    runId,
    clock: inputs.clock,
    sleep:
      dependencies.sleep ??
      (milliseconds =>
        new Promise(resolve => {
          setTimeout(resolve, milliseconds);
        })),
    pollMs: CANARY_POLL_SECONDS * 1000,
  };
  const done = await runnable
    .reduce<Promise<Pick<CanaryOutcome, "points" | "canaries">>>(
      async (earlier, item, index) => {
        const sofar = await earlier;
        const exercised = await exercise(item, index, context);
        return {
          points: [...sofar.points, exercised.point],
          canaries: [...sofar.canaries, ...exercised.canaries],
        };
      },
      Promise.resolve({ points: [], canaries: [] })
    )
    .catch((error: unknown) => {
      keeper.removeAll();
      release();
      throw error;
    });
  try {
    // Whatever a half could not remove is tried once more, and its record
    // then says what this second try found, so that what is reported as
    // left behind is what is left behind.
    const retried = keeper.removeAll();
    const before = based.ok ? based.base.sha : null;
    const after = readHead(door, branch);
    return {
      points: done.points,
      canaries: done.canaries.map(canary => afterRetry(canary, retried)),
      baseHead: {
        before,
        after,
        unchanged: before === null || after === null ? null : before === after,
      },
    };
  } finally {
    release();
  }
}

/**
 * Bring a canary's record up to date with a second try at removing it.
 * @param canary - The record as the half wrote it
 * @param retried - What the second try did, for each canary it reached
 * @returns The record; unchanged when its canary was already removed
 */
function afterRetry(
  canary: CanaryRecord,
  retried: readonly Removal[]
): CanaryRecord {
  const again = retried.find(removal => removal.branch === canary.branch);
  return again === undefined
    ? canary
    : {
        ...canary,
        closed: again.closed,
        branch_removed: again.branchRemoved,
        // An answer the first try had is not lost to a second that had none.
        merged: again.merged ?? canary.merged,
        cleanup_problem: again.problem,
      };
}

/**
 * Plan the canaries of every entry that should get them: one that is
 * enforced only on pull requests and whose check the platform requires.
 * @param inputs - The points, the entries and the repository
 * @returns Each such entry's point with its plan
 */
async function planEntries(inputs: CanaryInputs): Promise<readonly Planned[]> {
  const planned = await Promise.all(
    inputs.points.map(async point => {
      const entry = inputs.entries.get(point.entry_id);
      const wanted =
        entry !== undefined &&
        point.settles_entry &&
        point.observed === "required";
      return wanted ? [{ point, plan: await planCanaries(entry, inputs) }] : [];
    })
  );
  return planned.flat();
}

/**
 * The result of a point no canary was opened for.
 * @param point - The point, at the `observed` rung
 * @param planned - The entries canaries were planned for
 * @param noAccess - What to say of an entry that only lacked write access
 * @returns The point as it was when no canary was planned for it; the
 *   plan's own result when its proof cannot be run; otherwise `unknown`
 */
function withoutCanaries(
  point: PullRequestPoint,
  planned: readonly Planned[],
  noAccess: string
): PullRequestPoint {
  const plan = planned.find(item => item.point === point)?.plan;
  if (plan === undefined) return point;
  if (!plan.run) {
    const { outcome, reason, detail } = plan;
    return { ...point, outcome, reason, detail };
  }
  return {
    ...point,
    outcome: "unknown",
    reason: "canary-permission-missing",
    detail: noAccess,
  };
}

/**
 * Exercise the pull-request moment with canaries, as far as is allowed.
 * @param inputs - What was observed, the points and the entries
 * @param dependencies - Replaceable collaborators
 * @returns The points, with the exercised ones replaced, and what was done
 */
export async function exerciseCanaries(
  inputs: CanaryInputs,
  dependencies: CanaryDependencies = {}
): Promise<CanaryOutcome> {
  const runId = (dependencies.runId ?? newRunId)();
  if (!isRunId(runId)) {
    throw new Error(
      `${JSON.stringify(runId)} cannot identify a run: it must be 6 to 32 lower-case letters and digits.`
    );
  }
  const { observation, points } = inputs;
  const { prepared, platform } = observation;
  const nothing = { runId, sweep: null, baseHead: null, canaries: [] };
  if (
    prepared === null ||
    !platform.reachable ||
    platform.repository === null
  ) {
    return { ...nothing, points, permission: null };
  }
  const { repository } = platform;
  const permission = probeWriteAccess(
    canaryDoor(prepared.log, repository, false)
  );
  const planned = await planEntries(inputs);
  const settledBy = (point: PullRequestPoint): PullRequestPoint =>
    withoutCanaries(
      point,
      planned,
      permissionDetail(repository, permission.detail)
    );
  if (permission.can_write !== true) {
    return { ...nothing, points: points.map(settledBy), permission };
  }
  const door = canaryDoor(prepared.log, repository, true);
  const sweep = sweepCanaries(door, {
    runId,
    now: inputs.clock(),
    lifetimeSeconds: CANARY_LIFETIME_SECONDS,
  });
  const runnable = planned.flatMap(item =>
    item.plan.run ? [{ point: item.point, plan: item.plan }] : []
  );
  if (runnable.length === 0) {
    return { ...nothing, points: points.map(settledBy), permission, sweep };
  }
  const opened = await openCanaries(
    runnable,
    door,
    inputs,
    dependencies,
    runId
  );
  return {
    runId,
    permission,
    sweep,
    baseHead: opened.baseHead,
    canaries: opened.canaries,
    points: points.map(
      point =>
        opened.points.find(done => done.entry_id === point.entry_id) ??
        settledBy(point)
    ),
  };
}
