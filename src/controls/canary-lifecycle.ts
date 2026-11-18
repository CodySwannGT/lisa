/**
 * Keeping track of the canaries a run has open, so that every one of them is
 * removed however the run ends.
 *
 * A canary left behind is a stray pull request in somebody's repository, so
 * removal does not depend on the run getting to the end:
 *
 * - **A half finishes, or fails.** Its canary is removed in a `finally`,
 *   before the next half begins.
 * - **Something throws.** The run removes whatever is still tracked in an
 *   outer `finally`.
 * - **The process is told to stop** (Ctrl-C, `kill`, a closed terminal). A
 *   handler removes whatever is tracked and only then lets the signal end
 *   the process. Requests are synchronous, so the handler can finish its
 *   work before the process goes.
 * - **The process is killed outright**, or the machine stops. Nothing can
 *   run. The next run that opens canaries sweeps what is left, by the rule
 *   in `./canary-names.ts`.
 *
 * A branch is tracked before the request that creates it is sent, so there
 * is no moment at which a canary exists and nothing knows to remove it.
 * Removing a canary closes its pull request and deletes its branch. Deleting
 * the branch is tried even when closing failed or threw, because the
 * platform closes a pull request whose branch is gone. A canary stays
 * tracked until the platform has said its branch is gone, in so many words:
 * any other refusal is a failed removal, to be tried again.
 *
 * The sweep removes other runs' canaries, so it checks twice. It asks the
 * platform for the pull requests opened from a stale branch, and then closes
 * only the ones whose head is exactly that branch, whatever list came back.
 *
 * Known limit: if the request that creates a branch is cut off and the
 * platform creates the branch after this run has asked for it to be deleted,
 * the branch is left for a later run's sweep.
 * @module controls/canary-lifecycle
 */
import {
  fieldOf,
  textOf,
  type Answered,
  type CanaryDoor,
} from "./canary-door.js";
import { CANARY_BRANCH_PREFIX, canaryStanding } from "./canary-names.js";
import type { CanarySweep } from "./pull-request-types.js";

/** What became of one canary when it was removed. */
export interface Removal {
  readonly branch: string;
  /** Whether the pull request is closed. True when none was opened. */
  readonly closed: boolean;
  /** Whether the branch is gone. */
  readonly branchRemoved: boolean;
  /** Why something was left behind, or `null` when nothing was. */
  readonly problem: string | null;
}

/** The canaries a run has open. */
export interface CanaryKeeper {
  /**
   * Remember a branch that is about to be created.
   * @param branch - The canary branch
   */
  readonly track: (branch: string) => void;
  /**
   * Remember the pull request opened from a tracked branch.
   * @param branch - The canary branch
   * @param pullRequest - The pull request's number
   */
  readonly opened: (branch: string, pullRequest: number) => void;
  /**
   * Close a canary's pull request and delete its branch.
   * @param branch - The canary branch
   */
  readonly remove: (branch: string) => Removal;
  /** Remove every canary still tracked. Never throws. */
  readonly removeAll: () => readonly Removal[];
  /** The branches still tracked. */
  readonly open: () => readonly string[];
}

/** Where termination signals come from, replaceable in a test. */
export interface SignalSource {
  readonly on: (signal: NodeJS.Signals, handler: () => void) => void;
  readonly off: (signal: NodeJS.Signals, handler: () => void) => void;
}

/** The signals that ask a process to stop and can be answered. */
export const STOP_SIGNALS: readonly NodeJS.Signals[] = [
  "SIGINT",
  "SIGTERM",
  "SIGHUP",
];

/** How many refs or pull requests one page of a list holds. */
const PAGE_SIZE = 100;

/** The most pages of branches under the prefix that a sweep lists. */
const REF_PAGE_LIMIT = 10;

/**
 * What the platform says when asked to delete a branch that is not there.
 * Only this exact answer counts as "already gone"; any other refusal,
 * including a plain "Not Found", leaves the canary tracked.
 */
const ALREADY_GONE = /reference does not exist/iu;

/**
 * Send one request, turning a throw into a refusal, so that one failed step
 * of a removal never skips the next.
 * @param send - Sends the request
 * @returns What it answered
 */
function attempt(send: () => Answered): Answered {
  try {
    return send();
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Close a pull request and delete its branch.
 * @param door - The canary door
 * @param branch - The canary branch
 * @param pullRequests - The pull requests opened from it
 * @returns What became of it
 */
function removeCanary(
  door: CanaryDoor,
  branch: string,
  pullRequests: readonly number[]
): Removal {
  const closing = pullRequests.map(number =>
    attempt(() =>
      door.send("PATCH", `pulls/${String(number)}`, { state: "closed" })
    )
  );
  const deleted = attempt(() =>
    door.send("DELETE", `git/refs/heads/${branch}`)
  );
  const branchRemoved =
    deleted.ok || (!deleted.ok && ALREADY_GONE.test(deleted.reason));
  const notClosed = closing.flatMap(answer =>
    answer.ok ? [] : [answer.reason]
  );
  // A pull request whose branch is gone is closed by the platform, so a
  // close that failed only matters while the branch is still there.
  const problems = branchRemoved
    ? []
    : [...notClosed, ...(deleted.ok ? [] : [deleted.reason])];
  return {
    branch,
    closed: notClosed.length === 0 || branchRemoved,
    branchRemoved,
    problem: problems.length === 0 ? null : problems.join(" | "),
  };
}

/**
 * Start keeping track of a run's canaries.
 * @param door - The canary door
 * @returns The keeper
 */
export function canaryKeeper(door: CanaryDoor): CanaryKeeper {
  const state: {
    current: readonly {
      readonly branch: string;
      readonly pull: number | null;
    }[];
  } = { current: [] };
  const remove = (branch: string): Removal => {
    const tracked = state.current.filter(item => item.branch === branch);
    const removal = removeCanary(
      door,
      branch,
      tracked.flatMap(item => (item.pull === null ? [] : [item.pull]))
    );
    // A canary that could not be removed stays tracked, to be tried again.
    if (removal.problem === null) {
      state.current = state.current.filter(item => item.branch !== branch);
    }
    return removal;
  };
  return {
    track: branch => {
      state.current = [...state.current, { branch, pull: null }];
    },
    opened: (branch, pullRequest) => {
      state.current = state.current.map(item =>
        item.branch === branch ? { branch, pull: pullRequest } : item
      );
    },
    remove,
    removeAll: () =>
      state.current.map(item => {
        try {
          return remove(item.branch);
        } catch (error) {
          return {
            branch: item.branch,
            closed: false,
            branchRemoved: false,
            problem: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    open: () => state.current.map(item => item.branch),
  };
}

/**
 * Remove a run's canaries when the process is told to stop.
 * @param keeper - The run's canaries
 * @param signals - Where the signals come from
 * @param terminate - Ends the process the way the signal would have
 * @returns A function that stops listening; call it when the run is over
 */
export function removeOnStop(
  keeper: CanaryKeeper,
  signals: SignalSource,
  terminate: (signal: NodeJS.Signals) => void
): () => void {
  const listening: {
    current: readonly {
      readonly signal: NodeJS.Signals;
      readonly handler: () => void;
    }[];
  } = { current: [] };
  const release = (): void => {
    listening.current.forEach(({ signal, handler }) => {
      signals.off(signal, handler);
    });
    listening.current = [];
  };
  listening.current = STOP_SIGNALS.map(signal => ({
    signal,
    handler: () => {
      keeper.removeAll();
      // A second interrupt can kill the request that was removing a canary.
      // Whatever is still tracked is tried once more before the process goes.
      if (keeper.open().length > 0) keeper.removeAll();
      release();
      terminate(signal);
    },
  }));
  listening.current.forEach(({ signal, handler }) => {
    signals.on(signal, handler);
  });
  return release;
}

/**
 * List every branch under the reserved prefix.
 * @param door - The canary door
 * @param page - The page to read, from 1
 * @returns The branch names, or why the list could not be read
 */
function canaryBranches(
  door: CanaryDoor,
  page = 1
): readonly string[] | { readonly problem: string } {
  const read = door.get(
    `git/matching-refs/heads/${CANARY_BRANCH_PREFIX}?per_page=${String(PAGE_SIZE)}&page=${String(page)}`
  );
  if (!read.ok) return { problem: read.reason };
  const refs = Array.isArray(read.value) ? read.value : [];
  const names = refs.flatMap((ref: unknown) => {
    const name = textOf(ref, "ref");
    return name.startsWith("refs/heads/")
      ? [name.slice("refs/heads/".length)]
      : [];
  });
  // Bounded: a list that never ends must not keep the run from starting.
  if (refs.length < PAGE_SIZE || page >= REF_PAGE_LIMIT) return names;
  const more = canaryBranches(door, page + 1);
  return "problem" in more ? more : [...names, ...more];
}

/**
 * The open pull requests that were opened from one branch.
 *
 * The platform is asked for the pull requests of that head, and each answer
 * is checked again here: only one whose head is exactly the branch is
 * returned. A list that came back unfiltered must never get somebody's own
 * pull request closed.
 * @param door - The canary door
 * @param branch - The canary branch
 * @returns Their numbers
 */
function pullRequestsFrom(door: CanaryDoor, branch: string): readonly number[] {
  const [owner = ""] = door.repository.split("/");
  const head = encodeURIComponent(`${owner}:${branch}`);
  const pulls = door.get(
    `pulls?state=open&head=${head}&per_page=${String(PAGE_SIZE)}`
  );
  const listed: readonly unknown[] =
    pulls.ok && Array.isArray(pulls.value) ? pulls.value : [];
  return listed.flatMap((pull: unknown) => {
    const number = fieldOf(pull, "number");
    return typeof number === "number" && textOf(pull, "head", "ref") === branch
      ? [number]
      : [];
  });
}

/**
 * Remove the canaries earlier runs left behind.
 *
 * Only a branch whose name says another run made it longer ago than the
 * lifetime is removed. A younger one may belong to a run that is still
 * going, and a name that does not say is not this command's to judge.
 * @param door - The canary door
 * @param context - This run, the time and the lifetime
 * @param context.runId - This run's identifier
 * @param context.now - The time, from the run's clock
 * @param context.lifetimeSeconds - How old a canary must be to be removed
 * @returns What was removed, what was left, and what went wrong
 */
export function sweepCanaries(
  door: CanaryDoor,
  context: {
    readonly runId: string;
    readonly now: Date;
    readonly lifetimeSeconds: number;
  }
): CanarySweep {
  const listed = canaryBranches(door);
  if ("problem" in listed) {
    return { removed: [], kept: [], problems: [listed.problem] };
  }
  const branches = [...new Set(listed)];
  const stale = branches.filter(
    branch => canaryStanding(branch, context) === "stale"
  );
  const removals = stale.map(branch =>
    removeCanary(door, branch, pullRequestsFrom(door, branch))
  );
  return {
    removed: removals
      .filter(removal => removal.branchRemoved)
      .map(removal => removal.branch),
    kept: branches.flatMap(branch => {
      const standing = canaryStanding(branch, context);
      return standing === "stale"
        ? []
        : [
            {
              branch,
              why: standing === "unrecognised" ? standing : ("live" as const),
            },
          ];
    }),
    problems: removals.flatMap(removal =>
      removal.problem === null ? [] : [`${removal.branch}: ${removal.problem}`]
    ),
  };
}
