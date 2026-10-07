// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Fixed bounded provider reads distinguish historical origin from current authority. */
import { boundedSpawnSync } from "./bounded-spawn.mjs";
import {
  ghJson,
  requireProof,
  sha256,
  assertPinnedVerifier,
} from "./github-attestation-verifier.mjs";

const API = "api";
const HOST_FLAG = "--hostname";
const PUBLIC_HOST = "github.com";

/** Provider identity never treats unavailable state as an absent scope. */
function repositoryState(read, policy, parent) {
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
    main.ref === "refs/heads/main" && main.object?.sha === parent,
    "provider main base differs"
  );
}

/** Private role selection is fixed by separate exported ordinary/historical entry points. */
function runState(read, policy, descriptor, historical) {
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
      (historical
        ? ["in_progress", "completed"].includes(run.status)
        : run.status === "in_progress"),
    "stale/cancelled provider run"
  );
  requireProof(
    String(run.head_repository?.id) === policy.repositoryId &&
      policy.allowedTriggers.includes(run.event),
    "fork/unapproved provider run"
  );
  requireProof(
    Array.isArray(run.referenced_workflows) &&
      run.referenced_workflows.some(
        workflow =>
          workflow.path?.split("@")[0] === policy.signerWorkflow &&
          workflow.sha === policy.signerDigest
      ),
    "actual reusable workflow differs"
  );
  return run;
}

/** A current exact Bot claim remains required even when origin is historical. */
function claimState(read, policy, descriptor) {
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
  return comment;
}

/** Every role shares bounded pinned reads and immutable repository identity. */
function providerOrigin(policy, descriptor, historical, execute) {
  const read = endpoint =>
    ghJson(policy, [API, HOST_FLAG, PUBLIC_HOST, endpoint], execute);
  repositoryState(read, policy, descriptor.parent);
  return {
    run: runState(read, policy, descriptor, historical),
    claim: claimState(read, policy, descriptor),
  };
}

/** Prove the trusted human remains assignable using the actual documented status. */
export function verifyAssignable(
  policy,
  maintainer,
  execute = boundedSpawnSync
) {
  requireProof(
    typeof maintainer === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(maintainer),
    "invalid trusted maintainer"
  );
  assertPinnedVerifier(policy);
  const result = execute(
    policy.ghExecutable,
    [
      API,
      HOST_FLAG,
      PUBLIC_HOST,
      "--include",
      `repos/${policy.repository}/assignees/${maintainer}`,
    ],
    {
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 65_536,
      env: { ...process.env, GH_HOST: PUBLIC_HOST },
    }
  );
  requireProof(
    !result.error &&
      !result.signal &&
      result.status === 0 &&
      typeof result.stdout === "string" &&
      Buffer.byteLength(result.stdout) <= 65_536 &&
      /^HTTP\/\S+ 204\b/.test(result.stdout),
    "trusted maintainer is not assignable"
  );
}

/** Current v1 authorization always requires its own live run. */
export function verifyCurrentProvider(
  policy,
  descriptor,
  execute = boundedSpawnSync
) {
  return providerOrigin(policy, descriptor, false, execute);
}

/** Historical origin returns qualified provider chronology, never current authority. */
export function verifyHistoricalProvider(
  policy,
  descriptor,
  execute = boundedSpawnSync
) {
  return providerOrigin(policy, descriptor, true, execute);
}

/** Fresh permission checks its own invocation and the exact observed destination. */
export function verifyRecoveryProvider(
  policy,
  descriptor,
  recovery,
  maintainer,
  execute = boundedSpawnSync
) {
  verifyCurrentProvider(
    policy,
    { ...descriptor, runId: recovery.runId, runAttempt: recovery.runAttempt },
    execute
  );
  const read = endpoint =>
    ghJson(policy, [API, HOST_FLAG, PUBLIC_HOST, endpoint], execute);
  const number = descriptor.workItem.slice(
    descriptor.workItem.lastIndexOf("#") + 1
  );
  const issue = read(`repos/${policy.repository}/issues/${number}`);
  requireProof(
    issue.state === "open" &&
      !issue.pull_request &&
      sha256(issue.body) === recovery.leafBodySha256 &&
      Array.isArray(issue.assignees) &&
      issue.assignees.length === 1 &&
      issue.assignees[0].login === maintainer &&
      issue.assignees[0].type === "User",
    "current recovery leaf or owner differs"
  );
  const refs = read(
    `repos/${policy.repository}/git/matching-refs/heads/${recovery.branch}`
  );
  requireProof(
    Array.isArray(refs) && refs.length <= 1,
    "ambiguous recovery branch"
  );
  const head = refs.length ? refs[0].object?.sha : null;
  requireProof(
    !refs.length || refs[0].ref === `refs/heads/${recovery.branch}`,
    "foreign recovery ref"
  );
  requireProof(
    head === recovery.expectedBranchHead,
    "recovery destination changed"
  );
  const pulls = [];
  for (let page = 1; page <= 20; page++) {
    const values = read(
      `repos/${policy.repository}/pulls?state=all&head=${encodeURIComponent(`${policy.repository.split("/")[0]}:${recovery.branch}`)}&per_page=100&page=${page}`
    );
    requireProof(
      Array.isArray(values) && values.length <= 100,
      "invalid recovery PR page"
    );
    pulls.push(...values);
    if (values.length < 100) break;
    requireProof(page < 20, "incomplete recovery PR pages");
  }
  requireProof(pulls.length <= 1, "ambiguous recovery PR");
  if (!pulls.length)
    requireProof(
      recovery.prNumber === null && recovery.expectedPrHead === null,
      "missing expected recovery PR"
    );
  else
    requireProof(
      pulls[0].number === recovery.prNumber &&
        pulls[0].state === "open" &&
        pulls[0].head?.sha === recovery.expectedPrHead &&
        pulls[0].head?.ref === recovery.branch &&
        pulls[0].head?.repo?.full_name === policy.repository &&
        pulls[0].base?.ref === "main" &&
        pulls[0].base?.repo?.full_name === policy.repository,
      "foreign/closed/changed recovery PR"
    );
}
