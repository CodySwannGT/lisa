// This file is managed by Lisa. Durable changes belong upstream.
/** Bounded official verification followed by exact authorization policy. */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { boundedSpawnSync } from "./bounded-spawn.mjs";

export const ACTIONS_ISSUER = "https://token.actions.githubusercontent.com";
export const PROPOSAL_PREDICATE =
  "https://lisa.dev/attestations/npm-proposal/v1";

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
function matchSigningTime(timestamps, policy, now) {
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

/** Additional checks consume verified official output, never a decoded bundle. */
export function assertVerifiedAttestation(
  results,
  descriptor,
  digest,
  policy,
  now = Date.now()
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
    result.statement.predicateType === PROPOSAL_PREDICATE,
    "wrong predicate type"
  );
  const subjects = result.statement.subject;
  requireProof(
    Array.isArray(subjects) && subjects.length === 1,
    "ambiguous subject"
  );
  requireProof(
    subjects[0].name === "descriptor.json" &&
      subjects[0].digest?.sha256 === digest,
    "descriptor subject differs"
  );
  matchCertificate(result.signature?.certificate, descriptor, policy);
  matchSigningTime(result.verifiedTimestamps, policy, now);
  return result.signature.certificate;
}

/** Invoke official signature/root/timestamp verification before applying policy. */
export function verifyDescriptorAttestation(
  policy,
  descriptor,
  paths,
  digest,
  execute = boundedSpawnSync
) {
  const args = [
    "attestation",
    "verify",
    paths.descriptor,
    "--bundle",
    paths.bundle,
    "--repo",
    policy.repository,
    "--signer-workflow",
    policy.signerWorkflow,
    "--signer-digest",
    policy.signerDigest,
    "--source-digest",
    descriptor.parent,
    "--source-ref",
    "refs/heads/main",
    "--predicate-type",
    PROPOSAL_PREDICATE,
    "--cert-oidc-issuer",
    ACTIONS_ISSUER,
    "--deny-self-hosted-runners",
    "--format",
    "json",
  ];
  const result = ghJson(policy, args, execute);
  return assertVerifiedAttestation(result, descriptor, digest, policy);
}

/** Read current provider state without granting a write or accepting an outage. */
export function verifyCurrentProvider(
  policy,
  descriptor,
  execute = boundedSpawnSync
) {
  const read = endpoint =>
    ghJson(policy, ["api", "--hostname", "github.com", endpoint], execute);
  const repo = read(`repos/${policy.repository}`);
  requireProof(
    String(repo.id) === policy.repositoryId &&
      String(repo.owner?.id) === policy.ownerId,
    "provider repository identity differs"
  );
  requireProof(
    repo.full_name === policy.repository && repo.default_branch === "main",
    "provider main scope differs"
  );
  const main = read(`repos/${policy.repository}/git/ref/heads/main`);
  requireProof(
    main.ref === "refs/heads/main" && main.object?.sha === descriptor.parent,
    "provider main base differs"
  );
  const run = read(
    `repos/${policy.repository}/actions/runs/${descriptor.runId}/attempts/${descriptor.runAttempt}`
  );
  requireProof(
    String(run.id) === descriptor.runId &&
      String(run.run_attempt) === descriptor.runAttempt,
    "provider run differs"
  );
  requireProof(
    run.head_sha === descriptor.parent &&
      run.head_branch === "main" &&
      run.status === "in_progress",
    "stale/cancelled provider run"
  );
  requireProof(
    String(run.head_repository?.id) === policy.repositoryId &&
      policy.allowedTriggers.includes(run.event),
    "fork/unapproved provider run"
  );
  const comment = read(
    `repos/${descriptor.queue}/issues/comments/${descriptor.claimCommentId}`
  );
  const issueNumber = descriptor.workItem.slice(
    descriptor.workItem.lastIndexOf("#") + 1
  );
  requireProof(
    String(comment.id) === descriptor.claimCommentId &&
      comment.issue_url ===
        `https://api.github.com/repos/${descriptor.queue}/issues/${issueNumber}`,
    "claim scope differs"
  );
  requireProof(
    String(comment.user?.id) === policy.claimActorId &&
      comment.user?.type === "Bot",
    "claim actor differs"
  );
  requireProof(
    typeof comment.body === "string" &&
      sha256(comment.body) === descriptor.claimSha256,
    "claim announcement changed"
  );
}
