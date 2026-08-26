#!/usr/bin/env node
/**
 * Publish a newly emitted remote-agent AWS bootstrap bundle to the configured
 * secrets provider without creating a silent split brain.
 *
 * Infrastructure owns the IAM access key and usually emits the complete bundle
 * to AWS Secrets Manager. Remote coding environments cannot use that store as
 * their bootstrap provider: reading it already requires AWS credentials. The
 * provider configured by lisa-secrets-access therefore needs the same bundle,
 * and a manual copy leaves two ways for a rotation to stop halfway.
 *
 * This command makes that handoff one fail-closed operation:
 *
 * 1. prove the existing provider record is writable with a no-op write;
 * 2. validate the candidate and assume every declared role with it;
 * 3. replace the provider value;
 * 4. read the value back exactly and assume every role again; and
 * 5. restore the previous provider value if a post-write check fails.
 *
 * The candidate arrives on stdin so it never appears in a shell command or a
 * temporary file. No credential value is written to stdout or stderr.
 *
 * Usage:
 *   aws secretsmanager get-secret-value ... --query SecretString --output text \
 *     | publish-aws-bootstrap.mjs publish
 *   publish-aws-bootstrap.mjs verify
 *   publish-aws-bootstrap.mjs preflight
 * @module publish-aws-bootstrap
 */

import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BOOTSTRAP_KEY,
  parseBootstrap,
  readProfiles,
} from "./aws-bootstrap.mjs";
import { fetchAll, writeSecret } from "./providers.mjs";
import { readConfig } from "./surfaces.mjs";

import { boundedChildOutput } from "../../lisa-setup-workstation/scripts/bounded-child.mjs";

const PROFILE_NAME = /^[\w.@-]+$/;
const ROLE_ARN =
  /^arn:(?:aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[\w+=,.@/-]+$/;

/**
 * Validate and normalize one complete bundle without changing its serialized
 * representation.
 * @param {string} raw Candidate JSON from stdin or the provider.
 * @returns {{raw: string, bundle: object, profiles: Array<{name: string, roleArn: string, region: string}>}}
 *   Validated candidate and its role entries.
 */
export function validateAwsBootstrap(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error(
      `${BOOTSTRAP_KEY} is empty; refusing to replace a working credential with nothing`
    );
  }

  // AWS CLI's text output ends with one newline. It is transport framing, not
  // part of the SecretString, so do not make every publication differ by one
  // invisible byte from the value AWS emitted.
  const normalized = raw.trim();
  const bundle = parseBootstrap(normalized);
  if (!bundle || Array.isArray(bundle)) {
    throw new Error(`${BOOTSTRAP_KEY} is not a JSON object`);
  }

  const accessKeyId = bundle.accessKeyId ?? bundle.aws_access_key_id;
  const secretAccessKey =
    bundle.secretAccessKey ?? bundle.aws_secret_access_key;
  for (const [field, value] of [
    ["accessKeyId", accessKeyId],
    ["secretAccessKey", secretAccessKey],
    ["externalId", bundle.externalId],
    ["roleName", bundle.roleName],
  ]) {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`${BOOTSTRAP_KEY}.${field} must be a non-empty string`);
    }
  }

  const entries = Object.entries(readProfiles(bundle));
  if (entries.length === 0) {
    throw new Error(`${BOOTSTRAP_KEY}.profiles must declare at least one role`);
  }

  const profiles = entries.map(([name, entry]) => {
    if (!PROFILE_NAME.test(name)) {
      throw new Error(`AWS bootstrap profile name is not safe: ${name}`);
    }
    const roleArn = entry?.roleArn ?? entry?.role_arn;
    if (typeof roleArn !== "string" || !ROLE_ARN.test(roleArn)) {
      throw new Error(`AWS bootstrap profile ${name} has an invalid roleArn`);
    }
    if (typeof entry?.region !== "string" || !entry.region.trim()) {
      throw new Error(`AWS bootstrap profile ${name} has no region`);
    }
    return { name, roleArn, region: entry.region };
  });

  return { raw: normalized, bundle, profiles };
}

/**
 * Build the isolated environment used to prove one candidate. Ambient AWS
 * variables are removed so a green result cannot come from the host identity.
 * @param {object} bundle Validated bundle.
 * @returns {NodeJS.ProcessEnv} Child environment containing only this identity.
 */
export function candidateAwsEnvironment(bundle) {
  const env = { ...process.env };
  for (const key of [
    "AWS_PROFILE",
    "AWS_DEFAULT_PROFILE",
    "AWS_SESSION_TOKEN",
    "AWS_SECURITY_TOKEN",
  ]) {
    delete env[key];
  }
  env.AWS_ACCESS_KEY_ID = String(
    bundle.accessKeyId ?? bundle.aws_access_key_id
  );
  env.AWS_SECRET_ACCESS_KEY = String(
    bundle.secretAccessKey ?? bundle.aws_secret_access_key
  );
  env.AWS_PAGER = "";
  return env;
}

/**
 * Prove that the candidate authenticates and can assume every declared role.
 * Captures all child output so account ids and credential metadata never reach
 * a shared log.
 * @param {{bundle: object, profiles: Array<object>}} candidate Validated bundle.
 * @param {(bin: string, args: string[], options: object) => string} [run]
 *   Injectable child runner for tests.
 */
export function verifyAwsBootstrap(candidate, run = boundedChildOutput) {
  const env = candidateAwsEnvironment(candidate.bundle);
  for (const profile of candidate.profiles) {
    const sessionName = `lisa-publish-${profile.name}`
      .replace(/[^A-Za-z0-9_+=,.@-]/g, "-")
      .slice(0, 64);
    try {
      run(
        "aws",
        [
          "sts",
          "assume-role",
          "--role-arn",
          profile.roleArn,
          "--role-session-name",
          sessionName,
          "--external-id",
          String(candidate.bundle.externalId),
          "--region",
          profile.region,
          "--query",
          "Credentials.Expiration",
          "--output",
          "text",
        ],
        { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }
      );
    } catch (error) {
      const status =
        typeof error === "object" &&
        error !== null &&
        Number.isInteger(error.status)
          ? ` exited ${error.status}`
          : " could not be executed";
      throw new Error(
        `AWS bootstrap profile ${profile.name} failed STS verification: aws sts assume-role${status}`
      );
    }
  }
  return candidate.profiles.map(profile => profile.name);
}

/**
 * Locate the provider record that owns the bundle.
 * @param {object} cfg Resolved lisa-secrets-access configuration.
 * @param {(cfg: object) => Map<string, object>} fetch Provider reader.
 * @returns {{id: string, value: string}} Writable provider entry.
 */
function currentEntry(cfg, fetch) {
  const entry = fetch(cfg).get(BOOTSTRAP_KEY);
  if (!entry) {
    throw new Error(
      `${BOOTSTRAP_KEY} is not available through the configured provider boundary`
    );
  }
  if (!entry.id) {
    throw new Error(
      `${BOOTSTRAP_KEY} has no provider identifier, so it cannot be published`
    );
  }
  return { id: entry.id, value: entry.value };
}

/**
 * Exercise the exact provider write permission without changing its value.
 * @param {object} cfg Resolved configuration.
 * @param {object} [operations] Injectable provider operations for tests.
 * @returns {{id: string, value: string}} Current provider entry.
 */
export function preflightAwsBootstrap(cfg, operations = {}) {
  const fetch = operations.fetch ?? fetchAll;
  const write = operations.write ?? writeSecret;
  const entry = currentEntry(cfg, fetch);
  try {
    write(cfg, entry.id, entry.value);
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(
      `no write access to ${BOOTSTRAP_KEY}: ${reason}\n` +
        `Refusing to continue because a rotated key that cannot be published would strand every remote session.`
    );
  }
  return entry;
}

/**
 * Restore the previous provider value and prove the restoration.
 * @param {object} cfg Resolved configuration.
 * @param {{id: string, value: string}} previous Previous entry.
 * @param {Function} fetch Provider reader.
 * @param {Function} write Provider writer.
 * @returns {string} Human-readable rollback outcome with no secret material.
 */
function rollback(cfg, previous, fetch, write) {
  try {
    write(cfg, previous.id, previous.value);
    const restored = currentEntry(cfg, fetch);
    if (restored.value !== previous.value) {
      return "the previous provider value could not be verified after rollback";
    }
    return "the previous provider value was restored";
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.split("\n")[0] : String(error);
    return `rollback failed: ${reason}`;
  }
}

/**
 * Publish, read back, and verify a candidate. Any failure after the candidate
 * write triggers a restoration of the previous provider value.
 * @param {string} raw Candidate JSON.
 * @param {object} cfg Resolved configuration.
 * @param {object} [operations] Injectable provider/AWS operations for tests.
 * @returns {{changed: boolean, profiles: string[]}} Publication outcome.
 */
export function publishAwsBootstrap(raw, cfg, operations = {}) {
  const fetch = operations.fetch ?? fetchAll;
  const write = operations.write ?? writeSecret;
  const verify = operations.verify ?? verifyAwsBootstrap;
  const previous = preflightAwsBootstrap(cfg, { fetch, write });
  const candidate = validateAwsBootstrap(raw);

  // Verify before the write. A candidate that cannot assume one of its roles
  // never becomes the value every new remote session receives.
  verify(candidate);

  if (candidate.raw === previous.value) {
    return {
      changed: false,
      profiles: candidate.profiles.map(profile => profile.name),
    };
  }

  try {
    write(cfg, previous.id, candidate.raw);
    const stored = currentEntry(cfg, fetch);
    if (stored.value !== candidate.raw) {
      throw new Error("provider read-back did not match the candidate exactly");
    }
    const storedCandidate = validateAwsBootstrap(stored.value);
    verify(storedCandidate);
    return {
      changed: true,
      profiles: storedCandidate.profiles.map(profile => profile.name),
    };
  } catch (error) {
    const reason =
      error instanceof Error ? error.message.split("\n")[0] : String(error);
    const rollbackOutcome = rollback(cfg, previous, fetch, write);
    throw new Error(
      `${BOOTSTRAP_KEY} publication failed: ${reason}; ${rollbackOutcome}`
    );
  }
}

/** Read a candidate from stdin without ever placing it in argv. */
function readCandidate() {
  return readFileSync(0, "utf8");
}

function main() {
  const [operation] = process.argv.slice(2);
  const cfg = readConfig();

  if (operation === "preflight") {
    const current = preflightAwsBootstrap(cfg);
    const candidate = validateAwsBootstrap(current.value);
    const profiles = verifyAwsBootstrap(candidate);
    console.log(
      `${BOOTSTRAP_KEY}: provider write path and ${profiles.length} AWS profile(s) verified; no value changed`
    );
    return;
  }

  if (operation === "verify") {
    const current = currentEntry(cfg, fetchAll);
    const candidate = validateAwsBootstrap(current.value);
    const profiles = verifyAwsBootstrap(candidate);
    console.log(`${BOOTSTRAP_KEY}: ${profiles.length} AWS profile(s) verified`);
    return;
  }

  if (operation === "publish") {
    const result = publishAwsBootstrap(readCandidate(), cfg);
    console.log(
      `${BOOTSTRAP_KEY}: ${result.changed ? "published" : "already current"}; ` +
        `${result.profiles.length} AWS profile(s) verified`
    );
    return;
  }

  throw new Error("usage: publish-aws-bootstrap.mjs preflight|verify|publish");
}

function invokedAsScript(moduleUrl, argv1 = process.argv[1]) {
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

if (invokedAsScript(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
