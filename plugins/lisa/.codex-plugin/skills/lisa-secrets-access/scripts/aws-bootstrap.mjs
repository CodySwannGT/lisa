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

import { assertOwner } from "./owner.mjs";

/** The names every AWS SDK and the CLI actually read. */
const ACCESS_KEY = "AWS_ACCESS_KEY_ID";
const SECRET_KEY = "AWS_SECRET_ACCESS_KEY";
const REGION = "AWS_DEFAULT_REGION";

/** Selects which environment's role a session assumes. */
const PROFILE = "AWS_PROFILE";

/** The bundle that carries the agent's identity. */
export const BOOTSTRAP_KEY = "LISA_AWS_BOOTSTRAP_JSON";

/**
 * The tail of the profile that holds the key pair and is assumed FROM.
 *
 * Named rather than `default` so it can never be picked up by accident: this
 * identity can assume roles and do nothing else, so a call that silently ran as
 * it would fail with a permissions error far from its cause.
 *
 * A SUFFIX rather than the whole name, because one fixed name is one shared
 * slot. Two tenants on a workstation both wrote `[lisa-bootstrap]`, so the
 * second run's key pair replaced the first's and the first tenant's profiles
 * then assumed their roles from the second tenant's identity — which either
 * fails confusingly or, where a trust policy is permissive, succeeds.
 */
export const SOURCE_PROFILE_SUFFIX = "lisa-bootstrap";

/**
 * The exact name written before profiles were owned. **DEPRECATED.**
 *
 * Two jobs, and the second one is a temporary compatibility window.
 *
 * **Recognition.** A `source_profile` equal to this, with no owner in front of
 * it, marks a section left by a build that predates ownership. Identifying
 * legacy sections this way rather than by guessing from the profile name is
 * what keeps an operator's own sections out of it.
 *
 * **Compatibility.** Generators outside this repository emit the bare
 * `<stage>` profile family and this bare source profile independently, and
 * scripts and documentation in caller repositories name them directly. Nothing
 * co-ordinates a rename across those repositories, so switching this writer to
 * the owned names alone would leave the writer and its readers disagreeing: a
 * bare `[profile <stage>]` whose `source_profile = lisa-bootstrap` would point
 * at a section that no longer exists, and every call through it would fail to
 * resolve. So the owned names are emitted as canonical AND these bare names are
 * kept resolving beside them, both generated from one bundle in one pass.
 *
 * **The window is not a fix, and this comment must not read like one.** The
 * bare family is a single shared slot on a machine that may serve several
 * projects — which is precisely the collision the owned names remove. During
 * the window that collision is unfixed ON THE BARE NAMES ONLY: they are claimed
 * when unclaimed or already ours, and refused by name when another project
 * holds them, so the failure is loud rather than silent, but two projects still
 * cannot both have them. The owned names are always correct; the bare ones are
 * correct for at most one project per machine.
 *
 * **Removal condition.** Delete the compatibility half — and reduce this
 * constant to recognition only — once no caller repository emits or names the
 * bare family. A caller proves it has migrated by resolving only
 * `<namespace>-<stage>`; `LISA_SECRETS_NO_LEGACY_PROFILES=1` lets one opt out
 * ahead of the removal and take the isolation immediately.
 */
export const LEGACY_SOURCE_PROFILE = SOURCE_PROFILE_SUFFIX;

/**
 * The source profile for one owner.
 * @param {string} owner Validated owner.
 * @returns {string} The owner's source-profile name.
 */
export function sourceProfileFor(owner) {
  return `${owner}-${SOURCE_PROFILE_SUFFIX}`;
}

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
 *
 * Every name is prefixed with the OWNER. The bundle's keys name a stage and
 * nothing else, and the kit deliberately keeps role names identical across
 * accounts so profiles differ only by account id — correct within one tenant,
 * and the removal of the only distinguishing feature across two. Prefixing
 * makes the wrong resolution impossible rather than merely detectable, which is
 * the same fix #3440 applied to the sibling remote-agent writer; a workstation
 * carrying both now sees one convention instead of two.
 *
 * The `compat` half is rendered SEPARATELY, and returned rather than merged, so
 * the installer can drop it as a unit after looking at the filesystem — which
 * this function deliberately cannot see. See `LEGACY_SOURCE_PROFILE` for why
 * that half exists at all and when it goes away.
 * @param {object} bundle Parsed bootstrap bundle.
 * @param {string} owner Tenant these profiles belong to.
 * @returns {{credentials: string, config: string, profiles: string[], compat: {credentials: string, config: string, profiles: string[], sourceProfile: string}}|null}
 *   Rendered file contents, the profile names, and the deprecated
 *   bare-named half; or null when the bundle is unusable.
 */
export function renderAwsProfiles(bundle, owner) {
  if (!bundle) return null;

  const accessKeyId = bundle.accessKeyId ?? bundle.aws_access_key_id;
  const secretAccessKey =
    bundle.secretAccessKey ?? bundle.aws_secret_access_key;
  if (!accessKeyId || !secretAccessKey) return null;

  // Checked AFTER the bundle is known usable, so a surface with no bundle at
  // all still returns null rather than failing over a missing owner it was
  // never going to use.
  const scope = assertOwner(owner, "~/.aws");
  const sourceProfile = sourceProfileFor(scope);
  const profiles = readProfiles(bundle);

  const credentials = [
    `[${sourceProfile}]`,
    `aws_access_key_id = ${accessKeyId}`,
    `aws_secret_access_key = ${secretAccessKey}`,
    "",
  ].join("\n");

  const sections = [];
  const names = [];
  const compatSections = [];
  const compatNames = [];
  for (const [stage, entry] of Object.entries(profiles)) {
    const roleArn = entry?.roleArn ?? entry?.role_arn;
    if (!roleArn) continue;

    assertDeclaredAccount(stage, entry, roleArn);

    const name = `${scope}-${stage}`;
    // A name is only usable if it can be written as an ini section header and
    // read back as the same string. Anything with a bracket or newline would
    // either truncate or inject extra lines into ~/.aws/config, and a config
    // file this corrupts is worse than one it never wrote. Checked on the FULL
    // name, since that is the string that becomes the header.
    if (!/^[\w.@-]+$/.test(name)) continue;

    sections.push(
      `${profileSection(name, roleArn, sourceProfile, bundle, entry)}\n`
    );
    // Collected here, where the name is already in scope. Recovering it by
    // re-parsing the rendered text made the header format load-bearing: a
    // change to it would silently corrupt every returned name.
    names.push(name);

    // The deprecated twin, generated from the SAME bundle in the same pass.
    // Regenerating both from one source is what makes them incapable of
    // drifting apart; a hand-maintained second copy would be a new defect.
    if (!/^[\w.@-]+$/.test(stage)) continue;
    compatSections.push(
      `${profileSection(stage, roleArn, LEGACY_SOURCE_PROFILE, bundle, entry)}\n`
    );
    compatNames.push(stage);
  }

  return {
    credentials,
    config: sections.join("\n"),
    profiles: names,
    compat: {
      credentials: [
        `[${LEGACY_SOURCE_PROFILE}]`,
        `aws_access_key_id = ${accessKeyId}`,
        `aws_secret_access_key = ${secretAccessKey}`,
        "",
      ].join("\n"),
      config: compatSections.join("\n"),
      profiles: compatNames,
      sourceProfile: LEGACY_SOURCE_PROFILE,
    },
  };
}

/**
 * One `[profile …]` section.
 *
 * Shared by the canonical and the deprecated renderer so the two cannot differ
 * in anything but their names — the compat profile must reach the same role,
 * with the same external id and region, or it is not a compatibility shim but a
 * second, subtly different credential.
 * @param {string} name Section name.
 * @param {string} roleArn The role to assume.
 * @param {string} sourceProfile The profile holding the key pair.
 * @param {object} bundle The bundle, for `externalId`.
 * @param {object} entry The stage entry, for `region`.
 * @returns {string} The rendered section.
 */
function profileSection(name, roleArn, sourceProfile, bundle, entry) {
  const lines = [`[profile ${name}]`, `role_arn = ${roleArn}`];
  lines.push(`source_profile = ${sourceProfile}`);
  if (bundle.externalId) lines.push(`external_id = ${bundle.externalId}`);
  if (entry.region) lines.push(`region = ${entry.region}`);
  return lines.join("\n");
}

/**
 * Refuse a stage whose declared account contradicts its own role ARN.
 *
 * This writer never contacts AWS — it runs during container setup, before a
 * task exists and often before network policy would allow the call — so the
 * live `sts:GetCallerIdentity` comparison #3440 added is not available here.
 * What IS available is the bundle's own statement about itself: a stage may
 * declare `expectedAccountId`, and a declaration that disagrees with the
 * account embedded in the role ARN is a bundle that cannot be right either way.
 * Catching it before the write costs nothing and is the only identity assertion
 * this surface can make offline.
 * @param {string} stage The bundle key.
 * @param {object} entry The stage's entry.
 * @param {string} roleArn The role ARN about to be written.
 */
function assertDeclaredAccount(stage, entry, roleArn) {
  const declared = entry?.expectedAccountId;
  if (!declared) return;
  const inArn = String(roleArn).split(":")[4];
  if (String(declared) === inArn) return;
  throw new Error(
    `bootstrap stage "${stage}" declares expectedAccountId ${declared}, but ` +
      `its roleArn names account ${inArn}. Refusing to write a profile whose ` +
      `own bundle contradicts itself; nothing was changed.`
  );
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
 * Takes the owner for one reason: `AWS_PROFILE` must name a profile that was
 * actually written. Prefixing the written names without prefixing the derived
 * selection would set `AWS_PROFILE=agent-dev` against a config that now defines
 * `acme-agent-dev`, reintroducing the "profile not found" failure this module
 * exists to remove.
 * @param {Map<string, {value: string}>} selected Secrets by exact name.
 * @param {string} owner Tenant these secrets belong to.
 * @returns {Map<string, {value: string, note: string}>} Derived variables.
 */
export function deriveAwsEnvironment(selected, owner) {
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
  // Only profiles that actually get WRITTEN are candidates. Selecting a name
  // that ~/.aws/config never contains — an entry with no roleArn, or a name too
  // exotic to be an ini header — fails with "profile not found", which is the
  // exact failure this whole change removes.
  const names = renderAwsProfiles(bundle, owner)?.profiles ?? [];

  // No usable profiles is not a reason to hand back a session with NOTHING.
  //
  // The pair stops being exported only because a profile supersedes it. With no
  // profile to select, exporting it is the difference between a degraded
  // session (the assume-only identity, which at least authenticates) and a dead
  // one — and the managed shell block unsets the ambient pair, so nothing would
  // fill the gap.
  if (names.length === 0) {
    const note =
      `Derived from ${BOOTSTRAP_KEY} by lisa-secrets-access. The bundle ` +
      `declares no usable per-environment profile, so this falls back to the ` +
      `bootstrap identity. It can assume roles and little else — if AWS calls ` +
      `fail with permission errors, the bundle's "profiles" map is the thing ` +
      `to check.`;
    derived.set(ACCESS_KEY, { value: String(accessKeyId), note });
    derived.set(SECRET_KEY, { value: String(secretAccessKey), note });
  }

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
