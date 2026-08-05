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

/** Selects which environment's role a session assumes. */
const PROFILE = "AWS_PROFILE";

/** The bundle that carries the agent's identity. */
export const BOOTSTRAP_KEY = "LISA_AWS_BOOTSTRAP_JSON";

/**
 * The profile that holds the bootstrap key pair and is assumed FROM.
 *
 * Named rather than `default` so it can never be picked up by accident: this
 * identity can assume roles and do nothing else, so a call that silently ran as
 * it would fail with a permissions error far from its cause.
 */
export const SOURCE_PROFILE = "lisa-bootstrap";

/**
 * Read the bundle's `profiles`, which may be an object OR a JSON string.
 *
 * The real bundle stores it double-encoded — a string containing JSON — so a
 * plain `typeof === "object"` check silently yields zero profiles and every
 * environment quietly disappears. Failing that way is worse than throwing:
 * everything still "works", as the assume-only identity, with no permissions.
 * @param {object|null} bundle Parsed bootstrap bundle.
 * @returns {Record<string, {roleArn?: string, region?: string}>} Profiles by name.
 */
export function readProfiles(bundle) {
  const raw = bundle?.profiles;
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  if (typeof raw !== "string") return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Render `~/.aws/credentials` and `~/.aws/config` from the bundle.
 *
 * The bundle carries a `profiles` map — one entry per environment, each a
 * `roleArn` in a DIFFERENT account — plus the `externalId` those roles require.
 * Nothing consumed any of it, so `--profile agent-dev` failed with "profile not
 * found" and every call fell back to the bootstrap identity in the shared
 * account. That identity can assume roles and nothing else, which is why
 * `aws sts get-caller-identity` could succeed while real work had no
 * permissions anywhere: a green check that proved only the first link.
 *
 * Writing the pair here rather than exporting it is deliberate. Exported
 * environment credentials OUTRANK `AWS_PROFILE`, so a session that exports them
 * ignores whichever profile it selects — the profiles would exist and never be
 * used.
 * @param {object} bundle Parsed bootstrap bundle.
 * @returns {{credentials: string, config: string, profiles: string[]}|null}
 *   Rendered file contents and the profile names, or null when unusable.
 */
export function renderAwsProfiles(bundle) {
  if (!bundle) return null;

  const accessKeyId = bundle.accessKeyId ?? bundle.aws_access_key_id;
  const secretAccessKey =
    bundle.secretAccessKey ?? bundle.aws_secret_access_key;
  if (!accessKeyId || !secretAccessKey) return null;

  const profiles = readProfiles(bundle);

  const credentials = [
    `[${SOURCE_PROFILE}]`,
    `aws_access_key_id = ${accessKeyId}`,
    `aws_secret_access_key = ${secretAccessKey}`,
    "",
  ].join("\n");

  const sections = [];
  for (const [name, entry] of Object.entries(profiles)) {
    const roleArn = entry?.roleArn ?? entry?.role_arn;
    if (!roleArn) continue;

    const lines = [`[profile ${name}]`, `role_arn = ${roleArn}`];
    lines.push(`source_profile = ${SOURCE_PROFILE}`);
    if (bundle.externalId) lines.push(`external_id = ${bundle.externalId}`);
    if (entry.region) lines.push(`region = ${entry.region}`);
    sections.push(`${lines.join("\n")}\n`);
  }

  return {
    credentials,
    config: sections.join("\n"),
    profiles: sections.map(s => s.slice(9, s.indexOf("]"))),
  };
}

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

  // The key pair is deliberately NOT exported.
  //
  // It used to be, to out-shout the ambient pair a cloud container injects. That
  // worked and cost more than it bought: exported environment credentials
  // outrank `AWS_PROFILE`, so every call ran as the bootstrap identity — which
  // can assume roles and do nothing else. `aws sts get-caller-identity`
  // succeeded while real work had no permissions in any environment account,
  // because each environment is a SEPARATE account reached by assuming a role.
  //
  // The pair now lives in ~/.aws/credentials as the source profile, and the
  // session selects an environment instead. The ambient pair is unset by the
  // shell profile rather than overridden — removing the poison beats out-
  // shouting it, and it is what makes `--profile agent-staging` behave exactly
  // as it does on a developer's machine.
  const names = Object.keys(readProfiles(bundle));
  if (names.length > 0 && !selected.has(PROFILE)) {
    // Never production by default. An implicit production profile is one
    // careless command away from a bad afternoon; that one must be typed.
    const preferred =
      names.find(name => /dev/i.test(name)) ??
      names.find(name => !/prod/i.test(name)) ??
      names[0];

    derived.set(PROFILE, {
      value: preferred,
      note:
        `Derived from ${BOOTSTRAP_KEY} by lisa-secrets-access. Selects the ` +
        `environment whose role this session assumes, via ~/.aws/config. ` +
        `Defaults to a non-production profile deliberately — reach production ` +
        `by naming it (\`--profile ${names.find(n => /prod/i.test(n)) ?? "…"}\`). ` +
        `The bootstrap key pair is NOT exported: environment credentials ` +
        `outrank AWS_PROFILE, so exporting them would ignore this selection ` +
        `and run everything as the assume-only identity.`,
    });
  }

  const region = bundle.region ?? bundle.defaultRegion;
  if (region && !selected.has(REGION)) {
    derived.set(REGION, {
      value: String(region),
      note: `Derived from ${BOOTSTRAP_KEY} by lisa-secrets-access.`,
    });
  }
  return derived;
}
