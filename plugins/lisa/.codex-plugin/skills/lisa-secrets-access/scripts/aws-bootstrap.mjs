/**
 * Turn the AWS bootstrap bundle into environment variables the AWS SDKs obey.
 *
 * `LISA_AWS_BOOTSTRAP_JSON` carries the agent's AWS identity as one JSON blob.
 * Materializing it verbatim is not enough, because nothing reads that name:
 * every AWS SDK and the CLI look for `AWS_ACCESS_KEY_ID` and
 * `AWS_SECRET_ACCESS_KEY`, or for a profile.
 *
 * Writing profiles alone is also not enough, and that is the failure this
 * module exists for. A Claude cloud container ships its own
 * `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in the ambient environment, and
 * **environment variables outrank profile files in the credential chain**. So a
 * session with correctly written `~/.aws/credentials` still failed:
 *
 *     aws sts get-caller-identity
 *     InvalidClientTokenId: The security token included in the request is invalid.
 *
 * Deriving the pair into the materialized env file fixes it, because that file
 * is sourced into the session and the last export wins. Exporting over a
 * variable this project did not set is a real intrusion, so it is deliberate,
 * narrow, and never silent:
 *
 *   - only when the bundle actually parses and carries both halves
 *   - never over a value the secret store itself supplies under those names,
 *     which is a project stating an explicit intent
 *   - recorded in the notes file, so the override is discoverable by the same
 *     read-the-note path as any other credential
 * @module aws-bootstrap
 */

/** The names every AWS SDK and the CLI actually read. */
const ACCESS_KEY = "AWS_ACCESS_KEY_ID";
const SECRET_KEY = "AWS_SECRET_ACCESS_KEY";
const REGION = "AWS_DEFAULT_REGION";

/** The bundle that carries the agent's identity. */
export const BOOTSTRAP_KEY = "LISA_AWS_BOOTSTRAP_JSON";

/**
 * Read the bootstrap bundle, treating anything malformed as absent.
 *
 * A parse failure must not take materialization down with it: every other
 * secret in the run is still valid and still needed, and a session with most of
 * its credentials beats a session with none.
 * @param {string} raw Bundle contents.
 * @returns {object|null} Parsed bundle, or null.
 */
export function parseBootstrap(raw) {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Derive the AWS variables implied by an already-selected secret set.
 *
 * Returns only additions; the caller merges. Nothing here mutates its input,
 * so a caller can decide what to do with the result — including reporting it.
 * @param {Map<string, {value: string}>} selected Secrets by exact name.
 * @returns {Map<string, {value: string, note: string}>} Derived variables.
 */
export function deriveAwsEnvironment(selected) {
  const derived = new Map();
  const bundle = parseBootstrap(selected.get(BOOTSTRAP_KEY)?.value);
  if (!bundle) return derived;

  const accessKeyId = bundle.accessKeyId ?? bundle.aws_access_key_id;
  const secretAccessKey =
    bundle.secretAccessKey ?? bundle.aws_secret_access_key;
  // Both halves or neither. Half a credential is not a weaker credential, it is
  // a confusing failure — the SDK reports a signature error rather than a
  // missing one.
  if (!accessKeyId || !secretAccessKey) return derived;

  // A project that stores these under their own names has said something
  // explicit. Overriding that would be this module guessing against an operator.
  if (selected.has(ACCESS_KEY) || selected.has(SECRET_KEY)) return derived;

  const note =
    `Derived from ${BOOTSTRAP_KEY} by lisa-secrets-access. Exported ` +
    `deliberately so it overrides any ambient ${ACCESS_KEY} the host injects — ` +
    `environment variables outrank profile files in the AWS credential chain, ` +
    `so without this a stale host value wins and every call fails with ` +
    `InvalidClientTokenId. This is the assume-only bootstrap identity; real ` +
    `work assumes a role from it.`;

  derived.set(ACCESS_KEY, { value: String(accessKeyId), note });
  derived.set(SECRET_KEY, { value: String(secretAccessKey), note });

  const region = bundle.region ?? bundle.defaultRegion;
  if (region && !selected.has(REGION)) {
    derived.set(REGION, {
      value: String(region),
      note: `Derived from ${BOOTSTRAP_KEY} by lisa-secrets-access.`,
    });
  }
  return derived;
}
