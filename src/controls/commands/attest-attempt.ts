/**
 * The part of `lisa controls attest` that runs the proofs and prints
 * nothing: one attempt at every proof of a repository, the one pair of
 * options it refuses before starting, and what a finished attempt hands over
 * to be written down.
 * @module controls/commands/attest-attempt
 */
import type { AttestationToRecord } from "../attest-record.js";
import { resolveRepositoryRoot } from "../audit-report-file.js";
import { bindChecks, hostHookFiles } from "../checks-binding.js";
import type { ChecksBinding } from "../evidence-types.js";
import { GATES_DECLARATION_PATH } from "../gates-declaration.js";
import { proofRunOf, runPairedProofs } from "../proof-runner.js";
import { loadProofTools } from "../proof-tools.js";
import type { ProofRun } from "../proof-types.js";
import { pullRequestBatches } from "../pull-request-evidence.js";
import { settlePullRequests } from "../pull-request-settle.js";
import { generateControlRegister } from "../register.js";
import type { AttestDependencies, AttestOptions } from "./attest-options.js";
import { openAttestWorkspace } from "./attest-workspace.js";

/** The proofs' results, or one line per reason none was run. */
export type Attempt =
  | {
      readonly problems: null;
      readonly run: ProofRun;
      /**
       * The commit the run's copy was cloned from. Left out when no copy
       * was made.
       */
      readonly commit?: string;
      /**
       * What defined the checks in the copy the proofs ran in. Left out
       * when no copy was made.
       */
      readonly checks?: ChecksBinding;
    }
  | {
      readonly problems: readonly string[];
      readonly summary: string;
      /**
       * The proofs' results, when they were in before the failure. A run
       * that opened canary pull requests has to say what it left on the
       * hosting platform however it ends.
       */
      readonly run?: ProofRun;
    };

/**
 * Say what a failure was, in words.
 * @param failure - Whatever was thrown
 * @returns Its message
 */
function messageOf(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * Run the proofs, then close the workspace they ran in, on every way out.
 *
 * When closing fails after the proofs are in, their results are still
 * handed on with the reason: a run that opened canary pull requests has to
 * be able to say what it left on the hosting platform.
 * @param close - Removes whatever opening the workspace created
 * @param prove - Runs the proofs
 * @returns The results, and why the workspace could not be closed if it
 *   could not
 * @throws {Error} When the proofs themselves could not finish
 */
async function provedThenClosed(
  close: () => void | Promise<void>,
  prove: () => Promise<ProofRun>
): Promise<{ readonly run: ProofRun; readonly unremoved: string | null }> {
  const proved = await prove().then(
    run => ({ run, failure: null }),
    (failure: unknown) => ({ run: null, failure })
  );
  const unremoved = await Promise.resolve()
    .then(() => close())
    .then(
      () => null,
      (failure: unknown) => messageOf(failure)
    );
  if (proved.run === null) {
    // The failure itself is passed on, as it would be from a `finally`.
    throw proved.failure instanceof Error
      ? proved.failure
      : new Error(messageOf(proved.failure));
  }
  return { run: proved.run, unremoved };
}

/**
 * Run every proof of one repository, without printing anything.
 * @param named - Absolute path of the repository the operator named
 * @param workspace - Absolute path of the disposable copy, when one was named
 * @param dependencies - Replaceable collaborators
 * @param options - What the operator asked for
 * @returns The results, or why no proof was run
 */
export async function attempt(
  named: string,
  workspace: string | undefined,
  dependencies: AttestDependencies,
  options: AttestOptions = {}
): Promise<Attempt> {
  const root = await resolveRepositoryRoot(named);
  if (root === null) {
    return {
      problems: [`${named} is not a folder.`],
      summary: "Give the path of the repository whose controls to prove",
    };
  }
  const generated = await (dependencies.generate ?? generateControlRegister)(
    root
  );
  if (generated.problems !== null) {
    return {
      problems: generated.problems,
      summary: `The gates declaration in ${GATES_DECLARATION_PATH} was refused, so no proof was run. Fix the declaration, then run this again`,
    };
  }
  const { register } = generated;
  // Nothing to prove needs nowhere to prove it.
  if (register.entries.length === 0) {
    return { problems: null, run: proofRunOf([]) };
  }
  const tools = await (dependencies.loadTools ?? loadProofTools)();
  // With no folder named, this makes the run's own disposable copy and
  // removes it on every way out, a signal included; see ./attest-workspace.ts.
  const opening = await openAttestWorkspace(
    { root, named: workspace, tools },
    { open: dependencies.openWorkspace, notice: dependencies.stderr }
  );
  if (opening.problem !== null) {
    return {
      problems: [opening.problem],
      summary: "No disposable copy of the repository to run the proofs in",
    };
  }
  const asked = {
    acknowledgeExternalEffects: options.acknowledgeExternalEffects === true,
    ...(dependencies.clock === undefined ? {} : { clock: dependencies.clock }),
  };
  // Commit and push are exercised here; the pull-request moment is the
  // hosting platform's to answer (`../pull-request-settle.ts`).
  const { run, unremoved } = await provedThenClosed(opening.close, async () =>
    settlePullRequests(
      await runPairedProofs({
        register,
        root,
        workspace: opening.workspace,
        judge: tools.judge,
        ...asked,
      }),
      {
        root,
        register,
        canaries: options.pullRequestCanaries === true,
        ...asked,
      },
      dependencies.pullRequests
    )
  );
  return unremoved === null
    ? {
        problems: null,
        ...(opening.commit === undefined ? {} : { commit: opening.commit }),
        ...(opening.checks === undefined ? {} : { checks: opening.checks }),
        run,
      }
    : {
        problems: [unremoved],
        summary:
          "The proofs ran, but the run could not finish cleaning up, so nothing was written down and there is no verdict",
        run,
      };
}

/**
 * Refuse a report-only run that would also open pull requests.
 *
 * A run in a folder the operator named records nothing, so a canary opened
 * for it would be a real pull request on the hosting platform whose result
 * is thrown away.
 * @param options - What the operator asked for
 * @returns The refusal, or `null` when the two were not asked for together
 */
export function refusedPair(options: AttestOptions): Promise<Attempt> | null {
  if (options.workspace === undefined || options.pullRequestCanaries !== true) {
    return null;
  }
  return Promise.resolve({
    problems: [
      "--workspace cannot be combined with --pull-request-canaries: a run in a folder you named only reports and records nothing, so it opens no pull request.",
    ],
    summary: "Nothing was tried. Run it with one of the two",
  });
}

/**
 * What a run that proved the controls hands over to be written down.
 * @param named - Absolute path of the repository the operator named
 * @param attempted - The run's results, the commit its copy was cloned
 *   from, and what defined the checks there
 * @param now - The current time
 * @param bind - Takes the digest of what defines the checks in the
 *   repository itself, for a run that proved nothing in a copy
 * @returns What the writer takes
 */
export async function toRecord(
  named: string,
  attempted: Extract<Attempt, { readonly problems: null }>,
  now: Date,
  bind: (root: string) => Promise<ChecksBinding> = root =>
    bindChecks({ repository: root, hostHooks: hostHookFiles })
): Promise<AttestationToRecord> {
  const { run, commit } = attempted;
  const root = await resolveRepositoryRoot(named);
  const checks = attempted.checks ?? (await bind(root ?? named));
  return {
    named,
    run,
    now,
    // The commit that was cloned, not the one the repository is at now.
    ...(commit === undefined ? {} : { commit }),
    checks,
    // What the hosting platform said about the pull-request moment; none
    // when the register has no pull-request entry.
    batches: pullRequestBatches(run, {
      root: named,
      now,
      checksDigest: checks.digest,
    }),
  };
}
