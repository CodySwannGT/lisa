/**
 * What `lisa controls attest` is asked, what it needs from outside, and what
 * its exit code says.
 *
 * Kept apart from `./attest.ts` so the part that runs the proofs
 * (`./attest-attempt.ts`) and the part that prints them can both read these
 * without reading each other.
 * @module controls/commands/attest-options
 */
import type { ProofTools } from "../proof-tools.js";
import type { OpenProofWorkspace } from "../proof-workspace.js";
import type { PullRequestDependencies } from "../pull-request-settle.js";
import type { ControlRegisterGeneration } from "../register.js";

/** The subcommand's name under `lisa controls`. */
export const ATTEST_COMMAND = "attest";

/** What the command's exit code says. */
export const ATTEST_EXIT = {
  /** There is at least one entry and every entry passed. */
  PASSED: 0,
  /** The proofs ran and some entry did not pass, or there are no entries. */
  NOT_PASSED: 1,
  /** There are no results: no proof was run, or the run could not finish. */
  NOT_RUN: 2,
} as const;

/** The command's options. */
export interface AttestOptions {
  /**
   * A copy of the repository the operator made, to start each check's own
   * command in. Naming one makes the run a report: nothing is written.
   */
  readonly workspace?: string;
  /** Print the results as one JSON document instead of a table. */
  readonly json?: boolean;
  /** Run no proof: check the committed verdict against what produces it. */
  readonly check?: boolean;
  /**
   * Open canary pull requests on the hosting platform to exercise the
   * pull-request moment. Off by default: the platform is only read.
   */
  readonly pullRequestCanaries?: boolean;
  /** Let a proof that says it reaches outside the repository run. */
  readonly acknowledgeExternalEffects?: boolean;
  /**
   * Install nothing and write nothing: find the checks that exist and that
   * nothing enforces yet. See `./attest-before-enforce.ts`.
   */
  readonly beforeEnforce?: boolean;
  /** Import an independently signed pair from the checkout's hosting platform. */
  readonly importHostProof?: string;
  /** Path to the protected private key used to sign the attest receipt. */
  readonly hostProofSigningKey?: string;
}

/** What the command needs from outside, each replaceable in a test. */
export interface AttestDependencies {
  /** The directory the path arguments are resolved from. */
  readonly cwd?: string;
  /** Where the results go, one line per call. */
  readonly stdout?: (line: string) => void;
  /** Where problems and a failing summary go, one line per call. */
  readonly stderr?: (line: string) => void;
  /** The clock every time in the results is read from. */
  readonly clock?: () => Date;
  /** Generates the register of a repository. */
  readonly generate?: (root: string) => Promise<ControlRegisterGeneration>;
  /** Loads the gate runner's own parts. */
  readonly loadTools?: () => Promise<ProofTools>;
  /** Opens the workspace the changes are planted in. */
  readonly openWorkspace?: OpenProofWorkspace;
  /** What settling the pull-request moment needs from outside. */
  readonly pullRequests?: PullRequestDependencies;
}
