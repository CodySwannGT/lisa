import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * An unrelated nonzero exit must never satisfy the old-key reproduction.
 * @param observation Actual frozen-step streams and precondition readbacks.
 * @param oracles Independent original failure requirements.
 * @returns Classified observation without converting setup failure into RED.
 */
export function classifyBaseline(observation, oracles) {
  const text = `${observation.stdout}\n${observation.stderr}`;
  const invalid = new RegExp(oracles.invalid_error_pattern, "iu").test(text);
  const missingKey = new RegExp(oracles.required_failure_pattern, "u").test(
    text
  );
  const imported = new RegExp(oracles.required_import_log_pattern, "iu").test(
    text
  );
  const reachedRepository = text.includes("https://dl.k6.io/deb");
  const genuine =
    observation.exitCode === oracles.expected_exit &&
    missingKey &&
    imported &&
    reachedRepository &&
    !invalid &&
    observation.preconditionsVerified === true &&
    observation.frozenInputsVerified === true &&
    observation.originalFingerprintVerified === true &&
    observation.k6AbsentAfter === true &&
    observation.timedOut === false;
  return {
    outcome: genuine
      ? "genuine-red"
      : invalid || observation.timedOut
        ? "invalid-reproduction"
        : "not-reproduced",
    actualExit: observation.exitCode,
    exactMissingKeyObserved: missingKey,
    successfulOriginalKeyImportObserved: imported,
    targetRepositoryReached: reachedRepository,
    originalFingerprintVerified: observation.originalFingerprintVerified,
    k6AbsentAfter: observation.k6AbsentAfter,
    invalidSetupOrNetworkErrorObserved: invalid,
    timedOut: observation.timedOut,
    hostedEvidence: false,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [observationPath, oraclesPath] = process.argv.slice(2);
  const observation = JSON.parse(readFileSync(observationPath, "utf8"));
  const oracles = JSON.parse(readFileSync(oraclesPath, "utf8"));
  console.log(JSON.stringify(classifyBaseline(observation, oracles), null, 2));
}
