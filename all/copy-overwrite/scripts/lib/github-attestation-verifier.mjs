// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Bounded official verification followed by exact authorization policy. */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { boundedSpawnSync } from "./bounded-spawn.mjs";

export const ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";
export const PROPOSAL_PREDICATE =
  "https://lisa.dev/attestations/npm-proposal/v1";
export const RECOVERY_PREDICATE =
  "https://lisa.dev/attestations/npm-recovery/v1";

/** Hash exact bytes; never an estimated identifier. */
export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Require a predicate, hiding potentially sensitive provider output. */
export function requireProof(condition, reason) {
  if (!condition) throw new Error(`Invalid automation provenance: ${reason}`);
}

/** Run only the trusted, hash-pinned official executable with bounded output. */
export function assertPinnedVerifier(policy) {
  requireProof(
    isAbsolute(policy.ghExecutable ?? ""),
    "official gh executable is not pinned"
  );
  const stat = lstatSync(policy.ghExecutable);
  requireProof(
    stat.isFile() && stat.size <= 150_000_000,
    "invalid official gh file"
  );
  requireProof(
    sha256(readFileSync(policy.ghExecutable)) === policy.ghSha256,
    "official gh bytes differ"
  );
}

/** Run only the already pinned verifier/provider reader under fixed bounds. */
export function ghJson(policy, args, execute = boundedSpawnSync) {
  assertPinnedVerifier(policy);
  const result = execute(policy.ghExecutable, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 1_048_576,
    env: { ...process.env, GH_HOST: "github.com" },
  });
  requireProof(
    !result.error && !result.signal && result.status === 0,
    "official verifier/provider request failed"
  );
  requireProof(
    typeof result.stdout === "string" &&
      Buffer.byteLength(result.stdout) <= 1_048_576,
    "oversize verifier result"
  );
  return JSON.parse(result.stdout);
}

/** Strictly match fields from a successfully verified certificate. */
function matchCertificate(certificate, descriptor, policy) {
  const expected = {
    issuer: ACTIONS_ISSUER,
    buildSignerURI: `https://github.com/${policy.signerWorkflow}@${policy.signerDigest}`,
    buildSignerDigest: policy.signerDigest,
    buildConfigURI: `https://github.com/${policy.callerWorkflow}@refs/heads/main`,
    buildConfigDigest: descriptor.parent,
    sourceRepositoryURI: `https://github.com/${policy.repository}`,
    sourceRepositoryDigest: descriptor.parent,
    sourceRepositoryRef: "refs/heads/main",
    sourceRepositoryIdentifier: policy.repositoryId,
    sourceRepositoryOwnerIdentifier: policy.ownerId,
    runInvocationURI: `https://github.com/${policy.repository}/actions/runs/${descriptor.runId}/attempts/${descriptor.runAttempt}`,
    runnerEnvironment: "github-hosted",
  };
  for (const [key, value] of Object.entries(expected)) {
    requireProof(
      typeof value === "string" && value !== "" && certificate?.[key] === value,
      `certificate ${key} differs`
    );
  }
  requireProof(
    policy.allowedTriggers.includes(certificate.buildTrigger),
    "unapproved workflow trigger"
  );
}

/** Only authenticated observer times count; current-time-only is insufficient. */
export function matchSigningTime(timestamps, policy, now) {
  requireProof(
    Array.isArray(timestamps) &&
      timestamps.length > 0 &&
      timestamps.length <= 8,
    "missing signing timestamp"
  );
  for (const time of timestamps) {
    const milliseconds = Date.parse(time.timestamp);
    requireProof(
      ["Tlog", "TimestampAuthority"].includes(time.type),
      "unsigned/current signing time"
    );
    requireProof(
      typeof time.uri === "string" && time.uri.startsWith("https://"),
      "missing timestamp authority"
    );
    requireProof(
      Number.isFinite(milliseconds) && milliseconds <= now + 60_000,
      "future/invalid signing time"
    );
    requireProof(
      now - milliseconds <= policy.maxAgeSeconds * 1000,
      "proposal authorization expired"
    );
  }
}

/** Fixed role matching never accepts a caller-selected expiry or predicate waiver. */
export function verifiedRole(
  results,
  descriptor,
  digest,
  policy,
  predicate,
  name
) {
  requireProof(
    Array.isArray(results) && results.length === 1,
    "ambiguous/missing attestation"
  );
  const result = results[0].verificationResult;
  requireProof(
    result?.statement?._type === "https://in-toto.io/Statement/v1",
    "unsupported statement"
  );
  requireProof(
    result.statement.predicateType === predicate,
    "wrong predicate type"
  );
  const subjects = result.statement.subject;
  requireProof(
    Array.isArray(subjects) && subjects.length === 1,
    "ambiguous subject"
  );
  requireProof(
    subjects[0].name === name && subjects[0].digest?.sha256 === digest,
    "proof subject differs"
  );
  matchCertificate(result.signature?.certificate, descriptor, policy);
  return result;
}

/** Ordinary v1 remains short-lived current authorization. */
export function assertVerifiedAttestation(
  results,
  descriptor,
  digest,
  policy,
  now = Date.now()
) {
  const result = verifiedRole(
    results,
    descriptor,
    digest,
    policy,
    PROPOSAL_PREDICATE,
    "descriptor.json"
  );
  matchSigningTime(result.verifiedTimestamps, policy, now);
  return result.signature.certificate;
}

/** Shared literal argv does not replace official verification or authorization policy. */
export function officialArguments(policy, identity, file, bundle, predicate) {
  return [
    "attestation",
    "verify",
    file,
    "--bundle",
    bundle,
    "--repo",
    policy.repository,
    "--signer-workflow",
    policy.signerWorkflow,
    "--signer-digest",
    policy.signerDigest,
    "--source-digest",
    identity.parent,
    "--source-ref",
    "refs/heads/main",
    "--predicate-type",
    predicate,
    "--cert-oidc-issuer",
    ACTIONS_ISSUER,
    "--deny-self-hosted-runners",
    "--format",
    "json",
  ];
}

/** The three explicit entry points select fixed official verification roles. */
export function officialResult(
  policy,
  identity,
  file,
  bundle,
  predicate,
  execute
) {
  return ghJson(
    policy,
    officialArguments(policy, identity, file, bundle, predicate),
    execute
  );
}

/** Invoke official signature/root/timestamp verification before applying policy. */
export function verifyDescriptorAttestation(
  policy,
  descriptor,
  paths,
  digest,
  execute = boundedSpawnSync
) {
  return assertVerifiedAttestation(
    officialResult(
      policy,
      descriptor,
      paths.descriptor,
      paths.bundle,
      PROPOSAL_PREDICATE,
      execute
    ),
    descriptor,
    digest,
    policy
  );
}

// Compatibility exports retain ordinary callers without top-level provider work.
export { verifyCurrentProvider } from "./github-attestation-provider.mjs";
