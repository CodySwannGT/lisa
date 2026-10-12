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
 * 1. acquire a provider-backed lock for the exact bundle record;
 * 2. re-read and prove the record is writable with a no-op write;
 * 3. validate the candidate and assume every declared role with it;
 * 4. replace the provider value;
 * 5. read the value back exactly and assume every role again;
 * 6. restore the previous value if a post-write check fails; and
 * 7. release the lock only after publication or rollback is complete.
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

import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  BOOTSTRAP_KEY,
  parseBootstrap,
  readProfiles,
} from "./aws-bootstrap.mjs";
import {
  COORDINATION_KEY_PREFIX,
  createCoordinationRecord,
  fetchAll,
  fetchRaw as providerFetchRaw,
  removeCoordinationRecord,
  writeSecret,
} from "./providers.mjs";
import { readConfig } from "./surfaces.mjs";

import { boundedChildOutput } from "../../lisa-setup-workstation/scripts/bounded-child.mjs";

const PROFILE_NAME = /^[\w.@-]+$/;
const ROLE_ARN =
  /^arn:(?:aws|aws-us-gov|aws-cn):iam::\d{12}:role\/[\w+=,.@/-]+$/;
const PUBLICATION_COORDINATION_SCOPE = "AWS_BOOTSTRAP_";
const PUBLICATION_LOCK_TTL_MS = 30 * 60 * 1000;
// Every provider and AWS child has its own 30-second deadline. Stop starting
// target mutations five minutes before another publisher may reap this lock,
// leaving ample room for the in-flight child to finish. This is a monotonic
// duration budget, not a wall clock used to order or expire provider records.
const PUBLICATION_CRITICAL_SECTION_BUDGET_MS = 25 * 60 * 1000;

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
  // STS verification must reach AWS, not an endpoint inherited from the host.
  // A redirected endpoint could otherwise answer the probe and turn a green
  // result into evidence about a local emulator or an attacker-controlled URL.
  env.AWS_IGNORE_CONFIGURED_ENDPOINT_URLS = "true";
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
 * @returns {{id: string, value: string, projectId: string|null}} Writable provider entry.
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
  return {
    id: entry.id,
    value: entry.value,
    projectId: entry.projectId ?? null,
  };
}

function firstLine(error) {
  return (error instanceof Error ? error.message : String(error)).split(
    "\n"
  )[0];
}

function lockPrefix(targetId) {
  return `${COORDINATION_KEY_PREFIX}${PUBLICATION_COORDINATION_SCOPE}${targetId}_`;
}

function deleteCoordination(cfg, row, fetchRaw, remove) {
  remove(cfg, row.id);
  if (fetchRaw(cfg).some(candidate => candidate.id === row.id)) {
    throw new Error(
      `publication lock ${row.id} is still present after deletion`
    );
  }
}

function writeProviderValue(cfg, id, value, write) {
  try {
    write(cfg, id, value);
  } catch (error) {
    const status =
      typeof error === "object" &&
      error !== null &&
      Number.isInteger(error.status)
        ? ` (exit ${error.status})`
        : "";
    // `bws secret edit` has no stdin form, so the value is present in argv and
    // therefore in Node's child-process error message. Never propagate that
    // message: doing so would print the credential this command protects.
    throw new Error(`provider write command failed${status}`);
  }
}

function publicationBudgetGuard(startedAt, monotonicNow) {
  return () => {
    const elapsed = monotonicNow() - startedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0) {
      throw new Error(
        "publication lock monotonic timer became invalid; refusing further provider mutation"
      );
    }
    if (elapsed >= PUBLICATION_CRITICAL_SECTION_BUDGET_MS) {
      throw new Error(
        "publication lock execution budget exceeded; refusing further provider mutation"
      );
    }
  };
}

/**
 * Enter the provider election for one AWS bootstrap record.
 *
 * Every publisher creates a unique contender. The provider's creation time,
 * with its immutable id as a tie-breaker, elects exactly one oldest active
 * contender. Unlike a read-then-create mutex, no participant can overwrite or
 * mistake another participant's record for its own.
 * @param {object} cfg Resolved configuration.
 * @param {{id: string, projectId: string|null}} target Target provider entry.
 * @param {object} [operations] Injectable provider operations for tests.
 * @returns {object} The winning coordination row.
 */
export function acquirePublicationLock(cfg, target, operations = {}) {
  if (!target.projectId) {
    throw new Error(
      `${BOOTSTRAP_KEY} has no provider project identifier, so publication cannot be serialized`
    );
  }

  const create = operations.createCoordination ?? createCoordinationRecord;
  const fetchRaw = operations.fetchRaw ?? providerFetchRaw;
  const remove = operations.removeCoordination ?? removeCoordinationRecord;
  const holderId = (operations.holderId ?? randomUUID)();
  const prefix = lockPrefix(target.id);
  const key = `${prefix}${holderId}`;
  let contender;

  try {
    contender = create(
      cfg,
      key,
      target.projectId,
      "Lisa AWS bootstrap publication contender; expires after 30 minutes"
    );
  } catch (error) {
    throw new Error(`publication lock creation failed: ${firstLine(error)}`);
  }

  if (!contender?.id || contender.key !== key) {
    if (contender?.id) {
      try {
        deleteCoordination(cfg, contender, fetchRaw, remove);
      } catch {
        // The validation failure below remains the actionable root cause.
      }
    }
    throw new Error("provider returned an invalid publication lock contender");
  }

  let rows;
  try {
    rows = fetchRaw(cfg).filter(
      row =>
        row.projectId === target.projectId &&
        typeof row.key === "string" &&
        row.key.startsWith(prefix)
    );
  } catch (error) {
    try {
      deleteCoordination(cfg, contender, fetchRaw, remove);
    } catch (cleanupError) {
      throw new Error(
        `publication lock read failed: ${firstLine(error)}; contender cleanup failed: ${firstLine(cleanupError)}`
      );
    }
    throw new Error(`publication lock read failed: ${firstLine(error)}`);
  }

  const visible = rows.find(row => row.id === contender.id);
  if (!visible) {
    try {
      deleteCoordination(cfg, contender, fetchRaw, remove);
    } catch (cleanupError) {
      throw new Error(
        `the publication lock contender could not be observed after creation; contender cleanup failed: ${firstLine(cleanupError)}`
      );
    }
    throw new Error(
      "the publication lock contender could not be observed after creation"
    );
  }

  const providerNow = Date.parse(visible.creationDate ?? "");
  if (!Number.isFinite(providerNow)) {
    try {
      deleteCoordination(cfg, contender, fetchRaw, remove);
    } catch (cleanupError) {
      throw new Error(
        `the publication lock contender has no valid provider creation time; contender cleanup failed: ${firstLine(cleanupError)}`
      );
    }
    throw new Error(
      "the publication lock contender has no valid provider creation time"
    );
  }

  const active = [];
  for (const row of rows) {
    const createdAt = Date.parse(row.creationDate ?? "");
    if (!Number.isFinite(createdAt)) {
      try {
        deleteCoordination(cfg, contender, fetchRaw, remove);
      } catch (cleanupError) {
        throw new Error(
          `publication lock ${row.id ?? "without an id"} has no valid provider creation time; contender cleanup failed: ${firstLine(cleanupError)}`
        );
      }
      throw new Error(
        `publication lock ${row.id ?? "without an id"} has no valid provider creation time`
      );
    }
    // Compare provider time with provider time. A remote host whose wall clock
    // is skewed must not be able to expire another host's active publication.
    if (createdAt <= providerNow - PUBLICATION_LOCK_TTL_MS) {
      try {
        deleteCoordination(cfg, row, fetchRaw, remove);
      } catch (error) {
        let contenderCleanup = "";
        try {
          deleteCoordination(cfg, contender, fetchRaw, remove);
        } catch (cleanupError) {
          contenderCleanup = `; contender cleanup failed: ${firstLine(cleanupError)}`;
        }
        throw new Error(
          `expired publication lock cleanup failed: ${firstLine(error)}` +
            contenderCleanup
        );
      }
      continue;
    }
    active.push({ row, createdAt });
  }

  active.sort(
    (left, right) =>
      left.createdAt - right.createdAt ||
      String(left.row.id).localeCompare(String(right.row.id))
  );
  if (active[0]?.row.id !== contender.id) {
    try {
      deleteCoordination(cfg, contender, fetchRaw, remove);
    } catch (error) {
      throw new Error(
        `another publisher holds the provider lock; contender cleanup failed: ${firstLine(error)}`
      );
    }
    throw new Error("another publisher holds the provider lock");
  }

  return { ...visible, targetId: target.id };
}

/**
 * Delete a publication contender and prove the provider no longer lists it.
 * @param {object} cfg Resolved configuration.
 * @param {{id: string}} lock Acquired coordination row.
 * @param {object} [operations] Injectable provider operations for tests.
 */
export function releasePublicationLock(cfg, lock, operations = {}) {
  const fetchRaw = operations.fetchRaw ?? providerFetchRaw;
  const remove = operations.removeCoordination ?? removeCoordinationRecord;
  deleteCoordination(cfg, lock, fetchRaw, remove);
}

/**
 * Hold the provider lock around an entire publication or preflight operation.
 * The target is deliberately refreshed after acquisition so a pre-lock
 * snapshot can never overwrite a publication that finished while this process
 * was entering the election.
 */
function withPublicationLock(cfg, operations, task, completedMessage) {
  const fetch = operations.fetch ?? fetchAll;
  const acquire = operations.acquireLock ?? acquirePublicationLock;
  const release = operations.releaseLock ?? releasePublicationLock;
  const monotonicNow = operations.monotonicNow ?? (() => performance.now());
  const startedAt = monotonicNow();
  const assertWithinBudget = publicationBudgetGuard(startedAt, monotonicNow);
  const target = currentEntry(cfg, fetch);
  const lock = acquire(cfg, target, operations);
  let result;
  let taskError;

  try {
    assertWithinBudget();
    const current = currentEntry(cfg, fetch);
    if (current.id !== target.id || current.projectId !== target.projectId) {
      throw new Error(
        `${BOOTSTRAP_KEY} moved after publication lock acquisition; retry from the new provider record`
      );
    }
    assertWithinBudget();
    result = task(current, assertWithinBudget);
    assertWithinBudget();
  } catch (error) {
    taskError = error;
  }

  try {
    release(cfg, lock, operations);
  } catch (releaseError) {
    const releaseReason = `publication lock release failed: ${firstLine(releaseError)}`;
    if (taskError) {
      throw new Error(`${firstLine(taskError)}; ${releaseReason}`);
    }
    throw new Error(
      `${completedMessage}; ${releaseReason}; remove the coordination record before the next publication`
    );
  }

  if (taskError) throw taskError;
  return result;
}

function preflightUnderLock(cfg, entry, write, assertWithinBudget) {
  try {
    assertWithinBudget();
    writeProviderValue(cfg, entry.id, entry.value, write);
  } catch (error) {
    throw new Error(
      `no write access to ${BOOTSTRAP_KEY}: ${firstLine(error)}\n` +
        `Refusing to continue because a rotated key that cannot be published would strand every remote session.`
    );
  }
  return entry;
}

/**
 * Exercise the exact provider write permission without changing its value.
 * @param {object} cfg Resolved configuration.
 * @param {object} [operations] Injectable provider operations for tests.
 * @returns {{id: string, value: string}} Current provider entry.
 */
export function preflightAwsBootstrap(cfg, operations = {}) {
  const write = operations.write ?? writeSecret;
  return withPublicationLock(
    cfg,
    operations,
    (entry, assertWithinBudget) =>
      preflightUnderLock(cfg, entry, write, assertWithinBudget),
    "preflight completed"
  );
}

/**
 * Restore the previous provider value and prove the restoration.
 * @param {object} cfg Resolved configuration.
 * @param {{id: string, value: string}} previous Previous entry.
 * @param {string} candidateRaw Exact value written by this publication.
 * @param {Function} fetch Provider reader.
 * @param {Function} write Provider writer.
 * @returns {string} Human-readable rollback outcome with no secret material.
 */
function rollback(
  cfg,
  previous,
  candidateRaw,
  fetch,
  write,
  assertWithinBudget
) {
  try {
    const current = currentEntry(cfg, fetch);
    if (current.value !== candidateRaw) {
      return "rollback skipped because the provider changed after this publication";
    }
    assertWithinBudget();
    writeProviderValue(cfg, previous.id, previous.value, write);
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
  const candidate = validateAwsBootstrap(raw);
  return withPublicationLock(
    cfg,
    operations,
    (previous, assertWithinBudget) => {
      preflightUnderLock(cfg, previous, write, assertWithinBudget);

      // Verify before the write. A candidate that cannot assume one of its roles
      // never becomes the value every new remote session receives.
      verify(candidate);
      assertWithinBudget();

      if (candidate.raw === previous.value) {
        return {
          changed: false,
          profiles: candidate.profiles.map(profile => profile.name),
        };
      }

      try {
        assertWithinBudget();
        writeProviderValue(cfg, previous.id, candidate.raw, write);
        const stored = currentEntry(cfg, fetch);
        if (stored.value !== candidate.raw) {
          throw new Error(
            "provider read-back did not match the candidate exactly"
          );
        }
        const storedCandidate = validateAwsBootstrap(stored.value);
        verify(storedCandidate);
        assertWithinBudget();
        return {
          changed: true,
          profiles: storedCandidate.profiles.map(profile => profile.name),
        };
      } catch (error) {
        const rollbackOutcome = rollback(
          cfg,
          previous,
          candidate.raw,
          fetch,
          write,
          assertWithinBudget
        );
        throw new Error(
          `${BOOTSTRAP_KEY} publication failed: ${firstLine(error)}; ${rollbackOutcome}`
        );
      }
    },
    "publication completed"
  );
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
