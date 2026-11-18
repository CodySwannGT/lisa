/**
 * Settling the pull-request moment of a proof run.
 *
 * The paired-proof runner exercises commit and push. An entry enforced only
 * on pull requests comes out of it `unproved`, because whether a pull
 * request is stopped is the hosting platform's to say. This step asks the
 * platform, and puts what it says into the run.
 *
 * By default it only reads: the merge-protection settings, through the same
 * functions `lisa controls protect` reads them with. It creates nothing.
 * With `canaries` it also opens two real pull requests per entry, one for
 * each half of the entry's proof, reads whether the platform would let each
 * through, and removes them (`./pull-request-canaries.ts`). A canary is
 * never merged.
 *
 * ## What it changes in the run
 *
 * - An entry the runner settled as `pull-request-moment` is replaced by the
 *   platform's result, with `moment: "pull-request"` and a `rung`.
 * - Every other entry is left exactly as the runner made it. One that is
 *   enforced at commit or push and also on pull requests keeps its one
 *   result, and gains an additional point in `pull_request.points`.
 * - `pull_request` is added to the run, holding every point, every canary
 *   and every request that was made.
 * - A run whose register has no pull-request entry is returned untouched,
 *   and the platform is asked nothing.
 *
 * See `./pull-request-types.ts` for the shapes and where `rung` lives.
 * @module controls/pull-request-settle
 */
import { CANARY_LIFETIME_SECONDS } from "./canary-names.js";
import { proofRunOf } from "./proof-runner.js";
import type { ProofRun } from "./proof-types.js";
import type { ProtectDependencies } from "./protect-prepare.js";
import {
  exerciseCanaries,
  type CanaryDependencies,
} from "./pull-request-canaries.js";
import { observeMergeProtection } from "./pull-request-observe.js";
import {
  entryResultOf,
  hasPullRequestPoint,
  observedPoint,
} from "./pull-request-points.js";
import type { SettledProofRun } from "./pull-request-types.js";
import type { ControlRegister } from "./register-types.js";

/** The runner's reason for an entry only the hosting platform can settle. */
const LEFT_TO_PLATFORM = "pull-request-moment";

/** What settling is given beside the run. */
export interface PullRequestInputs {
  /** Real path of the repository. */
  readonly root: string;
  /** The register the run proved. */
  readonly register: ControlRegister;
  /** Open canary pull requests. Off by default: nothing is created. */
  readonly canaries?: boolean;
  /** Whether proofs that say they reach outside the repository may run. */
  readonly acknowledgeExternalEffects?: boolean;
  /** The clock every time in the results is read from. */
  readonly clock?: () => Date;
}

/** What settling needs from outside, each replaceable in a test. */
export type PullRequestDependencies = Pick<
  ProtectDependencies,
  "gh" | "readRemoteUrl" | "loadModules"
> &
  CanaryDependencies;

/**
 * Put the hosting platform's answer about pull requests into a proof run.
 * @param run - What the paired-proof runner returned
 * @param inputs - The repository, the register, and what the operator asked
 * @param dependencies - Replaceable collaborators
 * @returns The run with its pull-request entries settled, or the same run
 *   when the register has none
 */
export async function settlePullRequests(
  run: ProofRun,
  inputs: PullRequestInputs,
  dependencies: PullRequestDependencies = {}
): Promise<ProofRun | SettledProofRun> {
  const enforced = inputs.register.entries.filter(hasPullRequestPoint);
  if (enforced.length === 0) return run;
  const clock = inputs.clock ?? (() => new Date());
  const observation = await observeMergeProtection(
    inputs.root,
    inputs.register,
    dependencies
  );
  const completedAt = clock().toISOString();
  const leftToPlatform = new Set(
    run.entries
      .filter(entry => entry.reason === LEFT_TO_PLATFORM)
      .map(entry => entry.entry_id)
  );
  const observed = enforced.map(entry =>
    observedPoint(entry, {
      observation,
      completedAt,
      settlesEntry: leftToPlatform.has(entry.id),
    })
  );
  const exercised =
    inputs.canaries === true
      ? await exerciseCanaries(
          {
            root: inputs.root,
            observation,
            points: observed,
            entries: new Map(enforced.map(entry => [entry.id, entry])),
            acknowledgeExternalEffects:
              inputs.acknowledgeExternalEffects === true,
            clock,
          },
          dependencies
        )
      : null;
  const points = exercised?.points ?? observed;
  const settled = new Map(
    points
      .filter(point => point.settles_entry)
      .map(point => [point.entry_id, entryResultOf(point)])
  );
  return {
    ...proofRunOf(
      run.entries.map(entry => settled.get(entry.entry_id) ?? entry)
    ),
    pull_request: {
      mode: inputs.canaries === true ? "canaries" : "observed",
      platform: observation.platform,
      branch: observation.branch,
      canary_lifetime_seconds: CANARY_LIFETIME_SECONDS,
      run_id: exercised?.runId ?? null,
      permission: exercised?.permission ?? null,
      sweep: exercised?.sweep ?? null,
      base_head: exercised?.baseHead ?? null,
      canaries: exercised?.canaries ?? [],
      requests: observation.requests(),
      points,
    },
  };
}
