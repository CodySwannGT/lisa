/**
 * Validate the producer's independently reviewed result for one exercise.
 * @module controls/exercise-result
 */
import { isJsonObject } from "../sync/json-path.js";
import { isCanonicalUtc, isEvidenceFresh } from "./evidence.js";
import { isSha256 } from "./evidence-binding.js";
import { DEFAULT_FRESHNESS_SECONDS } from "./evidence-types.js";
import { isExerciseName, type ExerciseTarget } from "./exercise-declaration.js";
import { declaredFailureText } from "./proof-plan.js";
import { isRequiredBeyondTheAuthor } from "./register-tier-rule.js";
import type {
  ControlRegister,
  ControlRegisterEntry,
} from "./register-types.js";

/** The inputs attest can verify against the same signed statement later. */
export interface ExerciseBinding {
  readonly repository: string;
  readonly environment: string;
  readonly checksDigest: string;
  readonly now: Date;
  readonly register: ControlRegister;
}

/** What a valid result establishes without including any raw command log. */
export interface AcceptedExercise {
  readonly completedAt: string;
}

/** A versioned source locator names a file at an exact Git object. */
const IMMUTABLE_SOURCE = /^git:[0-9a-f]{40}(?:[0-9a-f]{24})?:[^\r\n]{1,160}$/u;

/** A verified principal can be a service name, email address, or provider role id. */
const PRINCIPAL = /^[a-zA-Z0-9][a-zA-Z0-9._@:/-]{0,159}$/u;

/**
 * Check the signed artifact's hash or immutable source locator.
 * @param artifact - The claimed result's immutable identity
 * @returns Whether it identifies immutable evidence
 */
function isImmutableArtifact(artifact: unknown): boolean {
  return (
    isJsonObject(artifact) &&
    Object.keys(artifact).length === 1 &&
    (isSha256(artifact.sha256) ||
      (typeof artifact.locator === "string" &&
        IMMUTABLE_SOURCE.test(artifact.locator)))
  );
}

/**
 * The control gate exercise must reach the real declaration and named scope.
 * @param target - The declared gate and moment to exercise
 * @param register - The repository's current control register
 * @returns Its authoritative entry for that scope and moment, if any
 */
function authoritativeGate(
  target: Extract<ExerciseTarget, { criterion: "AC5.5" }>,
  register: ControlRegister
): ControlRegisterEntry | undefined {
  return register.entries.find(
    entry =>
      entry.gate === target.gate &&
      entry.scope === target.scope &&
      entry.tier === "authoritative" &&
      isRequiredBeyondTheAuthor(
        entry.enforcement_points.filter(point => point.moment === target.moment)
      )
  );
}

/**
 * Validate the gate runner's refusal and the clean result when the gate declares one.
 * @param target - Gate identity and the expected moment
 * @param outcome - Signed observation from the authoritative gate runner
 * @param register - Current declaration-derived register
 * @returns Whether the observed results fit the declared failure
 */
function gateExercise(
  target: Extract<ExerciseTarget, { criterion: "AC5.5" }>,
  outcome: Record<string, unknown>,
  register: ControlRegister
): boolean {
  const entry = authoritativeGate(target, register);
  if (
    entry === undefined ||
    outcome.gate !== target.gate ||
    outcome.moment !== target.moment
  )
    return false;
  const { violation_exit, violation_output, clean_exit } = outcome;
  const declared = declaredFailureText(entry);
  const shape =
    declared.length === 0 ? [`required gate FAILED: ${entry.gate}`] : declared;
  if (
    typeof violation_exit !== "number" ||
    !Number.isInteger(violation_exit) ||
    violation_exit <= 0 ||
    violation_exit > 255 ||
    typeof violation_output !== "string" ||
    violation_output.length > 16_384 ||
    !shape.some(line => violation_output.includes(line))
  )
    return false;
  const paired = entry.proof.clean !== null || entry.proof.violation !== null;
  return paired || clean_exit !== undefined
    ? Object.keys(outcome).length === 5 && clean_exit === 0
    : Object.keys(outcome).length === 4;
}

/**
 * Verify the declared connection and execution surface with an identified principal.
 * @param target - The expected connection and surface
 * @param outcome - Signed identity check result
 * @returns Whether the result proves identity on that exact surface
 */
function credentialExercise(
  target: Extract<ExerciseTarget, { criterion: "AC6.4" }>,
  outcome: Record<string, unknown>
): boolean {
  return (
    Object.keys(outcome).length === 4 &&
    outcome.connection === target.connection &&
    outcome.surface === target.surface &&
    outcome.identity_verified === true &&
    typeof outcome.principal === "string" &&
    PRINCIPAL.test(outcome.principal)
  );
}

/**
 * Confirm that the documented incident exercise reached the restored generation.
 * @param target - The release track in the plan
 * @param outcome - Signed incident and rollback result
 * @param completed - When the full exercise finished
 * @returns Whether the result contains an ordered, verified recovery
 */
function rollbackExercise(
  target: Extract<ExerciseTarget, { criterion: "AC7.2" }>,
  outcome: Record<string, unknown>,
  completed: string
): boolean {
  const { detected_at, rolled_back_at, verified_at } = outcome;
  return (
    Object.keys(outcome).length === 11 &&
    outcome.release_track === target.release_track &&
    [
      outcome.incident,
      outcome.actor,
      outcome.finding,
      outcome.previous_generation,
      outcome.rolled_back_from,
    ].every(isExerciseName) &&
    outcome.restored_generation === outcome.previous_generation &&
    outcome.rolled_back_from !== outcome.previous_generation &&
    outcome.recovery_verified === true &&
    isCanonicalUtc(detected_at) &&
    isCanonicalUtc(rolled_back_at) &&
    isCanonicalUtc(verified_at) &&
    detected_at <= rolled_back_at &&
    rolled_back_at <= verified_at &&
    verified_at <= completed
  );
}

/**
 * Confirm independent shadow comparisons and adversarial staff qualification.
 * @param target - The declared role and minimum shadow period
 * @param outcome - Signed qualification result
 * @param completed - When the full exercise finished
 * @returns Whether the required period and both checks are present
 */
function staffExercise(
  target: Extract<ExerciseTarget, { criterion: "AC8.9" }>,
  outcome: Record<string, unknown>,
  completed: string
): boolean {
  const { shadow_started_at, shadow_completed_at, comparisons } = outcome;
  return (
    Object.keys(outcome).length === 9 &&
    outcome.role === target.role &&
    isExerciseName(outcome.actor) &&
    isSha256(outcome.roster_sha256) &&
    isCanonicalUtc(shadow_started_at) &&
    isCanonicalUtc(shadow_completed_at) &&
    shadow_completed_at <= completed &&
    Date.parse(shadow_completed_at) - Date.parse(shadow_started_at) >=
      target.minimum_shadow_seconds * 1000 &&
    typeof comparisons === "number" &&
    Number.isSafeInteger(comparisons) &&
    comparisons > 0 &&
    outcome.shadow_agreed === true &&
    outcome.adversarial_passed === true &&
    outcome.qualification === "qualified"
  );
}

/**
 * Apply the exact schema and completion test for the declared criterion.
 * @param target - The typed target from the repository's plan
 * @param outcome - The independently reviewed result fields
 * @param register - Current gate declaration and scope
 * @param completed - The signed completion timestamp
 * @returns Whether the exercise measured what its target requires
 */
function acceptedOutcome(
  target: ExerciseTarget,
  outcome: Record<string, unknown>,
  register: ControlRegister,
  completed: string
): boolean {
  switch (target.criterion) {
    case "AC5.5":
      return gateExercise(target, outcome, register);
    case "AC6.4":
      return credentialExercise(target, outcome);
    case "AC7.2":
      return rollbackExercise(target, outcome, completed);
    case "AC8.9":
      return staffExercise(target, outcome, completed);
  }
}

/**
 * Bind an authenticated result to the exact target, environment, and current checks.
 * @param target - The applicable criterion and declared surface
 * @param result - A statement whose signer has already been checked
 * @param binding - The current evidence context
 * @returns The result's durable identity and completion time, or a fixed refusal
 */
export function acceptExercise(
  target: ExerciseTarget,
  result: Readonly<Record<string, unknown>>,
  binding: ExerciseBinding
): AcceptedExercise | string {
  if (
    Object.keys(result).length !== 12 ||
    result.schema_version !== 1 ||
    result.repository !== binding.repository ||
    result.environment !== binding.environment ||
    result.checks_digest !== binding.checksDigest ||
    result.target_id !== target.id ||
    result.criterion !== target.criterion ||
    result.scope !== target.scope ||
    result.producer !== target.producer ||
    result.adjudicator !== target.adjudicator
  )
    return "The exercise is bound to a different target, environment, check definition, or authority.";
  const { artifact, completed_at: completed, outcome } = result;
  if (
    !isImmutableArtifact(artifact) ||
    !isCanonicalUtc(completed) ||
    !isJsonObject(outcome)
  )
    return "The exercise needs an immutable artifact identity, a UTC completion time, and a typed result.";
  if (
    !isEvidenceFresh(
      { completed_at: completed, freshness_seconds: DEFAULT_FRESHNESS_SECONDS },
      binding.now
    )
  )
    return "The exercise is outside its evidence lifetime.";
  return acceptedOutcome(target, outcome, binding.register, completed)
    ? { completedAt: completed }
    : "The result does not establish the declared exercise.";
}
