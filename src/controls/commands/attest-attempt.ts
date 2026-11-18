/**
 * The part of `lisa controls attest` that runs the proofs and prints
 * nothing: one attempt at every proof of a repository, the one pair of
 * options it refuses before starting, and what a finished attempt hands over
 * to be written down.
 * @module controls/commands/attest-attempt
 */
import type { AttestationToRecord } from "../attest-record.js";
import { resolveRepositoryRoot } from "../audit-report-file.js";
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
       * The commit the proofs were run against: the one the run's copy was
       * made from. Left out when no copy was made.
       */
      readonly commit?: string;
    }
  | { readonly problems: readonly string[]; readonly summary: string };

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
  try {
    return {
      problems: null,
      ...(opening.commit === undefined ? {} : { commit: opening.commit }),
      // Commit and push are exercised here; the pull-request moment is the
      // hosting platform's to answer (`../pull-request-settle.ts`).
      run: await settlePullRequests(
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
      ),
    };
  } finally {
    await opening.close();
  }
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
 * @param attempted - The run's results, and the commit they are about
 * @param now - The current time
 * @returns What the writer takes
 */
export function toRecord(
  named: string,
  attempted: Extract<Attempt, { readonly problems: null }>,
  now: Date
): AttestationToRecord {
  const { run, commit } = attempted;
  return {
    named,
    run,
    now,
    // The commit that was cloned, not the one the repository is at now.
    ...(commit === undefined ? {} : { commit }),
    // What the hosting platform said about the pull-request moment; none
    // when the register has no pull-request entry.
    batches: pullRequestBatches(run, { root: named, now }),
  };
}
