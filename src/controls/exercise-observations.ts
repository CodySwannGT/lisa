/**
 * Read the current, independently adjudicated result for each declared target.
 * @module controls/exercise-observations
 */
import { lstat } from "node:fs/promises";
import path from "node:path";

import { isJsonObject } from "../sync/json-path.js";
import { readEnv } from "../utils/process-environment.js";
import { blockedFolder } from "./carrier-edits.js";
import { bindChecks } from "./checks-binding.js";
import { readControlFile } from "./control-files.js";
import type { ChecksBinding } from "./evidence-types.js";
import {
  EXERCISE_DECLARATION_PATH,
  EXERCISE_RESULTS_PATH,
  readExerciseDeclaration,
  type ExerciseTarget,
} from "./exercise-declaration.js";
import {
  acceptExercise,
  type AcceptedExercise,
  type ExerciseBinding,
} from "./exercise-result.js";
import { verifyHostProof } from "./host-proof-signature.js";
import {
  HOST_PROOF_TRUST_FILE,
  loadHostProofTrust,
  type HostProofTrust,
} from "./host-proof-trust.js";
import { readOriginUrl } from "./protect-platform.js";
import type { ControlRegister } from "./register-types.js";
import { digestOf } from "./verdict-digest.js";

/** One expected target, with either the verified observation or its omission. */
export interface ExerciseObservation {
  readonly target: ExerciseTarget;
  readonly result:
    | (AcceptedExercise & { readonly statementDigest: string })
    | null;
  readonly problem: string | null;
}

/** Result of reading the declaration and the evidence files. */
export interface ExerciseObservations {
  readonly targets: readonly ExerciseObservation[];
  readonly problems: readonly string[];
}

/** What ties the observations to this repository's current check definitions. */
interface ExerciseReadContext {
  readonly root: string;
  readonly register: ControlRegister;
  readonly checks: ChecksBinding;
  readonly now: Date;
}

/**
 * Confirm a scope is present without following a link out of the checkout.
 * @param root - Real repository path
 * @param scope - The declared target folder
 * @returns Whether all components are ordinary directories
 */
async function scopeExists(root: string, scope: string): Promise<boolean> {
  if (scope === ".") return true;
  if ((await blockedFolder(root, `${scope}/exercise`)) !== null) return false;
  try {
    return (await lstat(path.join(root, scope))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read the candidate signed envelopes from the fixed result file.
 * @param root - Real repository root
 * @returns A bounded list of candidates or an explanation
 */
async function exerciseStatements(
  root: string
): Promise<readonly unknown[] | string> {
  const file = await readControlFile(root, EXERCISE_RESULTS_PATH);
  if (file.kind === "missing")
    return "No independently signed exercise results are on record.";
  if (file.kind !== "text")
    return "The exercise result file could not be read.";
  try {
    const value: unknown = JSON.parse(file.text);
    return Array.isArray(value)
      ? value
      : "The exercise result file needs an array of signed statements.";
  } catch {
    return "The exercise result file is not valid JSON.";
  }
}

/**
 * Match the trusted and signed observation to one configured target.
 * @param target - A declared exercise
 * @param statements - Candidate envelopes indexed by their claimed target
 * @param trust - The externally administered review authority
 * @param binding - The current check definitions and time
 * @param root - Real path of the checkout containing the target scope
 * @returns The accepted observation or a reason it could not be accepted
 */
async function observeExercise(
  target: ExerciseTarget,
  statements: readonly unknown[],
  trust: HostProofTrust,
  binding: ExerciseBinding,
  root: string
): Promise<ExerciseObservation> {
  const missing = (problem: string): ExerciseObservation => ({
    target,
    result: null,
    problem,
  });
  if (!(await scopeExists(root, target.scope)))
    return missing("The declared scope is not an ordinary repository folder.");
  if (trust.adjudicator.id !== target.adjudicator)
    return missing(
      "The declared adjudicator is not authorized for this environment."
    );
  const related = statements.filter(
    statement =>
      isJsonObject(statement) &&
      isJsonObject(statement.body) &&
      statement.body.target_id === target.id
  );
  if (related.length !== 1)
    return missing(
      related.length === 0
        ? "There is no result for this target."
        : "There is more than one result for this target."
    );
  const signed = verifyHostProof(
    related[0],
    "artifact-exercise",
    trust.adjudicator.key
  );
  if (signed === null)
    return missing(
      "The exercise signature could not be verified with the authorized adjudicator key."
    );
  const result = acceptExercise(target, signed, binding);
  return typeof result === "string"
    ? missing(result)
    : {
        target,
        problem: null,
        result: { ...result, statementDigest: digestOf(signed) },
      };
}

/**
 * Independently revalidate scope, signatures, binding and result in attest and check.
 * @param context - The checkout, its current register and evidence binding
 * @returns Accepted and unresolved targets with fixed diagnostics
 */
export async function readExerciseObservations(
  context: ExerciseReadContext
): Promise<ExerciseObservations> {
  const { root, checks } = context;
  const declared = await readExerciseDeclaration(root);
  if (declared.problems !== null)
    return { targets: [], problems: declared.problems };
  const { declaration } = declared;
  if (declaration === null) return { targets: [], problems: [] };
  const unresolved = (problem: string): ExerciseObservations => ({
    targets: declaration.targets.map(target => ({
      target,
      result: null,
      problem,
    })),
    problems: [],
  });
  const statements = await exerciseStatements(root);
  if (typeof statements === "string") return unresolved(statements);
  const trust = await loadHostProofTrust(root, readEnv(HOST_PROOF_TRUST_FILE));
  if (
    trust === null ||
    trust.environment !== declaration.environment ||
    (await readOriginUrl(root)) !== trust.repository
  )
    return unresolved(
      "The external exercise trust file does not match this repository and environment."
    );
  const current = await bindChecks({
    repository: root,
    also: checks.covered.map(file => file.path),
  });
  if (
    current.digest !== checks.digest ||
    !current.covered.some(file => file.path === EXERCISE_DECLARATION_PATH)
  )
    return unresolved(
      "The exercise declaration or check definitions changed after the exercise was recorded."
    );
  const binding = {
    repository: trust.repository,
    environment: trust.environment,
    checksDigest: current.digest,
    now: context.now,
    register: context.register,
  };
  const targets = await Promise.all(
    declaration.targets.map(target =>
      observeExercise(target, statements, trust, binding, root)
    )
  );
  return { targets, problems: [] };
}
