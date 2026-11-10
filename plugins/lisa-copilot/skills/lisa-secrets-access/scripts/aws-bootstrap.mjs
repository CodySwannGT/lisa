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
 * THE canonical AWS profile naming scheme — one tenant, one set of names.
 *
 *     profile:        <namespace>-agent-<stage>
 *     source profile: <namespace>-agent-bootstrap
 *
 * Two Lisa writers put profiles into the shared, untenanted `~/.aws` files:
 * this module (via `materialize-secrets.mjs`) and the remote-agent setup script
 * (`scripts/remote-agent-aws-setup.sh`). They must emit the SAME names for the
 * same bundle and namespace, or a tenant's profile names depend on which
 * writer ran last. The shell script cannot import this module, so it carries a
 * byte-for-byte equivalent of `stageOf` and the two are pinned together by a
 * test that runs both writers against one bundle.
 *
 * `<stage>` is the bundle key with at most ONE leading `agent-` removed. Infra
 * kits publish keys that already say `agent-` (`agent-dev`), and others publish
 * bare stages (`dev`); both must land on `<namespace>-agent-dev`. Prefixing
 * without normalizing is what produced `acme-agent-agent-production`.
 *
 * There are no bare aliases. An earlier version also wrote the bundle's keys
 * unprefixed (`agent-dev`, assuming from a bare `lisa-bootstrap`) as a
 * deprecation window. A bare name is one slot per machine, so the first tenant
 * claimed it and every other tenant's `--profile agent-dev` silently reached
 * the first tenant's accounts (CodySwannGT/lisa#4768). That window is closed:
 * nothing here emits a name that is not owned.
 */
const STAGE_PREFIX = "agent-";

/** The tail of the emitted source profile, after `<namespace>-`. */
const SOURCE_PROFILE_SUFFIX = "agent-bootstrap";

/**
 * The stage a bundle key names, with one leading `agent-` removed.
 * @param {string} key A bundle profile key such as `agent-dev` or `dev`.
 * @returns {string} The stage, e.g. `dev`.
 */
export function stageOf(key) {
  return key.startsWith(STAGE_PREFIX) ? key.slice(STAGE_PREFIX.length) : key;
}

/**
 * The profile name a bundle key is emitted under for one namespace.
 * @param {string} namespace Validated owner / namespace.
 * @param {string} key The bundle profile key.
 * @returns {string} `<namespace>-agent-<stage>`.
 */
export function canonicalProfileName(namespace, key) {
  return `${namespace}-${STAGE_PREFIX}${stageOf(key)}`;
}

/**
 * The source profile this writer emits for one owner — the only name that
 * holds the key pair and is assumed FROM.
 *
 * Owned rather than one fixed name, because one fixed name is one shared slot:
 * two tenants both writing `[lisa-bootstrap]` meant the second key pair replaced
 * the first.
 * @param {string} owner Validated owner.
 * @returns {string} `<owner>-agent-bootstrap`.
 */
export function emitSourceProfileFor(owner) {
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
 * Every name is owned, per the canonical scheme above. The bundle's keys name a
 * stage and nothing else, and the kit deliberately keeps role names identical
 * across accounts so profiles differ only by account id — correct within one
 * tenant, and the removal of the only distinguishing feature across two.
 * Prefixing makes the wrong resolution impossible rather than merely
 * detectable, and it is the same scheme the remote-agent writer emits.
 * @param {object} bundle Parsed bootstrap bundle.
 * @param {string} owner Tenant these profiles belong to.
 * @returns {{credentials: string, config: string, profiles: string[], sourceProfile: string}|null}
 *   Rendered file contents, the profile names and the source profile; or null
 *   when the bundle is unusable.
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
  const sourceProfile = emitSourceProfileFor(scope);
  const profiles = readProfiles(bundle);

  const credentials = [
    `[${sourceProfile}]`,
    `aws_access_key_id = ${accessKeyId}`,
    `aws_secret_access_key = ${secretAccessKey}`,
    "",
  ].join("\n");

  const sections = [];
  const names = [];
  const keyFor = new Map();
  for (const [key, entry] of Object.entries(profiles)) {
    const roleArn = entry?.roleArn ?? entry?.role_arn;
    if (!roleArn) continue;
    // `agent-` alone names no stage; writing `<owner>-agent-` would be a
    // profile nobody can mean.
    if (stageOf(key) === "") continue;
    // `<owner>-agent-bootstrap` is the source profile; a stage of that name
    // would overwrite the key pair's section name with a role profile.
    if (stageOf(key) === "bootstrap") {
      throw new Error(
        `bootstrap key "${key}" names the stage "bootstrap", which is ` +
          `reserved for the source profile. Rename it; nothing was changed.`
      );
    }

    assertDeclaredAccount(key, entry, roleArn);

    const name = canonicalProfileName(scope, key);
    // A name is only usable if it can be written as an ini section header and
    // read back as the same string. Anything with a bracket or newline would
    // either truncate or inject extra lines into ~/.aws/config, and a config
    // file this corrupts is worse than one it never wrote. Checked on the FULL
    // name, since that is the string that becomes the header.
    if (!/^[\w.@-]+$/.test(name)) continue;

    // `dev` and `agent-dev` are one stage. Writing both would be a duplicate
    // section, and AWS resolves only one of a duplicated name — silently.
    const clash = keyFor.get(name);
    if (clash !== undefined) {
      throw new Error(
        `bootstrap keys "${clash}" and "${key}" both name the profile ` +
          `"${name}". Remove one from the bundle; nothing was changed.`
      );
    }
    keyFor.set(name, key);

    sections.push(
      `${profileSection(name, roleArn, sourceProfile, bundle, entry)}\n`
    );
    // Collected here, where the name is already in scope. Recovering it by
    // re-parsing the rendered text made the header format load-bearing: a
    // change to it would silently corrupt every returned name.
    names.push(name);
  }

  return {
    credentials,
    config: sections.join("\n"),
    profiles: names,
    sourceProfile,
  };
}

/**
 * One `[profile …]` section.
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
  // shouting it, and it is what makes `--profile <owner>-agent-staging` behave exactly
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
