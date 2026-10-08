/** Synthetic provider/certificate fixtures establish closed cancellation semantics, never hosted authority. */
import { describe, expect, it } from "vitest";
import {
  assertManualCancellation,
  assertCancellationAttestation,
  assertRecordedCancellation,
  CANCELLATION_PREDICATE,
  validateCancellation,
} from "../../../all/copy-overwrite/scripts/lib/npm-update-cancellation-proof.mjs";
import {
  assertVerifiedAttestation,
  PROPOSAL_PREDICATE,
  RECOVERY_PREDICATE,
} from "../../../all/copy-overwrite/scripts/lib/github-attestation-verifier.mjs";
import { assertRecoveryAttestation } from "../../../all/copy-overwrite/scripts/lib/github-attestation-recovery.mjs";
import { selectSupersession } from "../../../all/copy-overwrite/scripts/lib/npm-update-supersession.mjs";
import { assertOriginTransport } from "../../../all/copy-overwrite/scripts/lib/npm-update-cancel-origin.mjs";

const sha = (digit: string, length = 64) => digit.repeat(length);
const ORIGINAL_POSTED_AT = "2026-10-07T00:01:00Z";
const LATER_EVIDENCE_AT = "2026-10-07T00:09:00Z";
const FUTURE_EVIDENCE_AT = "2026-10-07T00:11:01Z";
const policy = {
  repository: "acme/widgets",
  repositoryId: "12",
  ownerId: "34",
  signerWorkflow: "CodySwannGT/lisa/.github/workflows/npm-updater.yml",
  signerDigest: sha("a", 40),
  callerWorkflow: "acme/widgets/.github/workflows/npm.yml",
  allowedTriggers: ["workflow_dispatch"],
  maxAgeSeconds: 3600,
};
const proposal = {
  parent: sha("2", 40),
  key: sha("b"),
  selectionKey: sha("c"),
};
const request = { number: 42, proposalKey: sha("d"), parent: proposal.parent };
const run = {
  id: 700,
  run_attempt: 1,
  event: "workflow_dispatch",
  status: "in_progress",
  head_sha: proposal.parent,
  head_branch: "main",
  path: ".github/workflows/npm.yml",
  head_repository: { id: 12 },
  triggering_actor: { id: 56, login: "maintainer", type: "User" },
  referenced_workflows: [
    { path: policy.signerWorkflow, sha: policy.signerDigest },
  ],
};
const permission = {
  permission: "write",
  user: { id: 56, login: "maintainer", type: "User" },
};
const invocation = { runId: "700", runAttempt: "1" };
const cancellationSubject = "cancellation.json";

/** Exact synthetic statements mirror the official verified result shape. */
function attestation(predicate: string, name: string, digest: string) {
  return [
    {
      verificationResult: {
        statement: {
          _type: "https://in-toto.io/Statement/v1",
          predicateType: predicate,
          subject: [{ name, digest: { sha256: digest } }],
        },
        signature: {
          certificate: {
            issuer: "https://token.actions.githubusercontent.com",
            buildSignerURI: `https://github.com/${policy.signerWorkflow}@${policy.signerDigest}`,
            buildSignerDigest: policy.signerDigest,
            buildConfigURI: `https://github.com/${policy.callerWorkflow}@refs/heads/main`,
            buildConfigDigest: proposal.parent,
            sourceRepositoryURI: `https://github.com/${policy.repository}`,
            sourceRepositoryDigest: proposal.parent,
            sourceRepositoryRef: "refs/heads/main",
            sourceRepositoryIdentifier: policy.repositoryId,
            sourceRepositoryOwnerIdentifier: policy.ownerId,
            runInvocationURI: `https://github.com/${policy.repository}/actions/runs/700/attempts/1`,
            runnerEnvironment: "github-hosted",
            buildTrigger: "workflow_dispatch",
          },
        },
        verifiedTimestamps: [
          {
            type: "Tlog",
            uri: "https://timestamp.invalid",
            timestamp: new Date().toISOString(),
          },
        ],
      },
    },
  ];
}

describe("explicit stale cancellation intent", () => {
  it.each([
    [56, 56],
    [56, "56"],
    ["56", 56],
  ])(
    "accepts the same configured operator across native ID representations: %j",
    (actorId, permissionId) => {
      expect(
        assertManualCancellation(
          {
            ...run,
            triggering_actor: { ...run.triggering_actor, id: actorId },
          },
          { ...permission, user: { ...permission.user, id: permissionId } },
          policy,
          "maintainer",
          proposal,
          request,
          invocation
        )
      ).toBe("56");
    }
  );

  it.each([
    { event: "schedule" },
    { event: "pull_request" },
    { head_sha: sha("3", 40) },
    { head_branch: "feature" },
    { path: ".github/workflows/foreign.yml" },
    { head_repository: { id: 99 } },
    { status: "completed" },
    { id: 701 },
    { run_attempt: 2 },
    { triggering_actor: { id: 56, login: "other", type: "User" } },
    { triggering_actor: { id: 56, login: "maintainer", type: "Bot" } },
    {
      referenced_workflows: [
        { path: policy.signerWorkflow, sha: sha("f", 40) },
      ],
    },
  ])("refuses a substituted invocation before cancellation: %j", changed => {
    expect(() =>
      assertManualCancellation(
        { ...run, ...changed },
        permission,
        policy,
        "maintainer",
        proposal,
        request,
        invocation
      )
    ).toThrow();
  });

  it.each([
    { ...permission, permission: "read" },
    { ...permission, user: { ...permission.user, id: 99 } },
    { ...permission, user: { ...permission.user, id: "056" } },
    { ...permission, user: { ...permission.user, id: ["56"] } },
    { ...permission, user: { ...permission.user, id: null } },
    { ...permission, user: { ...permission.user, id: true } },
    { ...permission, user: { ...permission.user, login: "other" } },
    { ...permission, user: { ...permission.user, type: "Bot" } },
  ])("refuses missing/foreign current repository authority: %j", changed => {
    expect(() =>
      assertManualCancellation(
        run,
        changed,
        policy,
        "maintainer",
        proposal,
        request,
        invocation
      )
    ).toThrow();
  });

  it("requires exact complete intent and cannot cancel against another main", () => {
    for (const changed of [
      { ...request, number: 0 },
      { ...request, proposalKey: "marker" },
      { ...request, parent: sha("3", 40) },
      { ...request, extra: true },
    ])
      expect(() =>
        assertManualCancellation(
          run,
          permission,
          policy,
          "maintainer",
          proposal,
          changed,
          invocation
        )
      ).toThrow();
  });
});

describe("three immutable signing purposes", () => {
  const identity = { parent: proposal.parent, runId: "700", runAttempt: "1" };
  const digest = sha("e");

  it("bounds recorded signatures by observation for active runs and completion for finished runs", () => {
    const now = Date.parse("2026-10-07T00:10:00Z");
    const chronology = {
      status: "in_progress",
      run_started_at: "2026-10-07T00:00:00Z",
      updated_at: ORIGINAL_POSTED_AT,
    };
    const proof = attestation(
      CANCELLATION_PREDICATE,
      cancellationSubject,
      digest
    );
    proof[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
      LATER_EVIDENCE_AT;
    const verify = (changed = {}, observed = now) =>
      assertRecordedCancellation(
        proof,
        identity,
        digest,
        policy,
        { ...chronology, ...changed },
        observed
      );
    expect(() => verify()).not.toThrow();
    for (const changed of [
      { status: "completed" },
      { status: "queued" },
      { status: "failure" },
      { status: undefined },
      { updated_at: "invalid" },
      { updated_at: "2026-10-06T23:59:00Z" },
      { updated_at: FUTURE_EVIDENCE_AT },
    ])
      expect(() => verify(changed)).toThrow();
    expect(() => verify({}, Number.NaN)).toThrow();
    proof[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
      FUTURE_EVIDENCE_AT;
    expect(() => verify()).toThrow();
    proof[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
      "2026-10-06T23:58:59Z";
    expect(() => verify()).toThrow();
  });

  it("accepts only the exact cancellation subject and predicate", () => {
    expect(() =>
      assertCancellationAttestation(
        attestation(CANCELLATION_PREDICATE, cancellationSubject, digest),
        identity,
        digest,
        policy
      )
    ).not.toThrow();
  });

  it("refuses proposal and recovery proofs as cancellation", () => {
    for (const [predicate, name] of [
      [PROPOSAL_PREDICATE, "descriptor.json"],
      [RECOVERY_PREDICATE, "recovery.json"],
    ]) {
      expect(() =>
        assertCancellationAttestation(
          attestation(predicate!, name!, digest),
          identity,
          digest,
          policy
        )
      ).toThrow();
    }
  });

  it("cannot use cancellation authority for a commit or recovery", () => {
    const proof = attestation(
      CANCELLATION_PREDICATE,
      cancellationSubject,
      digest
    );
    expect(() =>
      assertVerifiedAttestation(proof, identity, digest, policy)
    ).toThrow();
    expect(() =>
      assertRecoveryAttestation(proof, identity, digest, policy)
    ).toThrow();
  });

  it("rejects subject/digest substitution and expired authority", () => {
    for (const proof of [
      attestation(CANCELLATION_PREDICATE, "descriptor.json", digest),
      attestation(CANCELLATION_PREDICATE, cancellationSubject, sha("f")),
    ])
      expect(() =>
        assertCancellationAttestation(proof, identity, digest, policy)
      ).toThrow();
    const expired = attestation(
      CANCELLATION_PREDICATE,
      cancellationSubject,
      digest
    );
    expired[0]!.verificationResult.verifiedTimestamps[0]!.timestamp =
      "2000-01-01T00:00:00Z";
    expect(() =>
      assertCancellationAttestation(expired, identity, digest, policy)
    ).toThrow();
  });
});

describe("closed cancellation record", () => {
  const expected = {
    version: 1,
    purpose: "cancel-stale-prepublication-npm-proposal",
    repository: policy.repository,
    repositoryId: policy.repositoryId,
    ownerId: policy.ownerId,
    selectionKey: proposal.selectionKey,
    workItem: `${policy.repository}#42`,
    oldProposalKey: request.proposalKey,
    oldParent: sha("1", 40),
    parent: proposal.parent,
    proposalKey: proposal.key,
    proposalHashes: { "package.json": sha("a"), "package-lock.json": sha("b") },
    originDescriptorSha256: sha("a"),
    originCheckpointSha256: sha("b"),
    claimCommentId: "77",
    claimSha256: sha("c"),
    leafBodySha256: sha("d"),
    policySha256: sha("e"),
    npmPolicySha256: sha("f"),
    maintainer: "maintainer",
    operatorId: "56",
    runId: "700",
    runAttempt: "1",
    destination: {
      branch: `lisa/npm-${request.proposalKey}`,
      expectedBranchHead: null,
      prNumber: null,
    },
  };

  it("preserves the exact origin and authorizes only the new parent-bound bytes", () => {
    expect(validateCancellation(structuredClone(expected), expected)).toEqual(
      expected
    );
  });

  it("binds a dual-lock cancellation to all three exact proposal hashes", () => {
    const dual = {
      ...expected,
      proposalHashes: { ...expected.proposalHashes, "bun.lock": sha("c") },
    };
    expect(validateCancellation(structuredClone(dual), dual)).toEqual(dual);
    for (const hashes of [
      expected.proposalHashes,
      { ...dual.proposalHashes, "bun.lock": sha("d") },
      { ...dual.proposalHashes, "foreign.lock": sha("c") },
    ])
      expect(() =>
        validateCancellation({ ...dual, proposalHashes: hashes }, dual)
      ).toThrow();
    expect(() => validateCancellation(dual, expected)).toThrow();
  });

  it("refuses changed scope/identity, unexpected fields and same-parent cancellation", () => {
    for (const changed of [
      { ...expected, repository: "acme/foreign" },
      { ...expected, oldParent: proposal.parent },
      { ...expected, proposalKey: request.proposalKey },
      { ...expected, originDescriptorSha256: sha("f") },
      {
        ...expected,
        destination: {
          ...expected.destination,
          expectedBranchHead: sha("1", 40),
        },
      },
      { ...expected, destination: { ...expected.destination, prNumber: 2 } },
      { ...expected, extra: "authority" },
    ])
      expect(() => validateCancellation(changed, expected)).toThrow();
  });
});

describe("authenticated supersession topology", () => {
  const first = {
    number: 42,
    state: "closed",
    state_reason: "not_planned",
    key: sha("d"),
    parent: sha("1", 40),
  };
  const second = {
    number: 43,
    state: "open",
    key: proposal.key,
    parent: proposal.parent,
  };
  const cancellation = {
    oldProposalKey: first.key,
    proposalKey: proposal.key,
    parent: proposal.parent,
    proposalHashes: { file: "hash" },
  };
  const current = { ...proposal, hashes: cancellation.proposalHashes };

  it("admits one fresh leaf only after the exact verified cancellation and otherwise reuses its active successor", () => {
    expect(
      selectSupersession([first], new Map([[42, cancellation]]), current).status
    ).toBe("new");
    expect(
      selectSupersession(
        [first, second],
        new Map([[42, cancellation]]),
        current
      ).status
    ).toBe("existing");
  });

  it("does not treat ordinary closure, a bare marker or a changed replacement as authorization", () => {
    for (const records of [
      new Map(),
      new Map([[42, { ...cancellation, parent: sha("3", 40) }]]),
    ]) {
      expect(() => selectSupersession([first], records, current)).toThrow();
    }
    expect(() =>
      selectSupersession(
        [{ ...first, state_reason: "completed" }],
        new Map([[42, cancellation]]),
        current
      )
    ).toThrow();
  });

  it("refuses forks, disconnected records, duplicate keys and multiple active leaves", () => {
    const third = { ...second, number: 44, key: sha("e") };
    for (const issues of [
      [first, second, third],
      [first, { ...second, key: sha("e") }],
      [first, { ...second, key: first.key }],
    ]) {
      expect(() =>
        selectSupersession(issues, new Map([[42, cancellation]]), current)
      ).toThrow();
    }
  });
});

describe("original checkpoint transport provenance", () => {
  const chronology = {
    status: "completed",
    run_started_at: "2026-10-07T00:00:00Z",
    updated_at: "2026-10-07T00:05:00Z",
  };
  const digest = sha("a");
  const comment = {
    body: `[lisa-npm-checkpoint] v1 ${digest} complete\ntransport`,
    user: { type: "Bot", id: 99 },
    created_at: ORIGINAL_POSTED_AT,
    updated_at: ORIGINAL_POSTED_AT,
  };
  const originPolicy = { claimActorId: "99" };
  it("accepts later active-run transport only up to the finite observation and refuses invalid provider chronology", () => {
    const now = Date.parse("2026-10-07T00:10:00Z");
    const posted = {
      ...comment,
      created_at: LATER_EVIDENCE_AT,
      updated_at: LATER_EVIDENCE_AT,
    };
    const verify = (changed = {}, observed = now) =>
      assertOriginTransport(
        [posted],
        digest,
        originPolicy,
        { ...chronology, status: "in_progress", ...changed },
        observed
      );
    expect(() => verify()).not.toThrow();
    for (const changed of [
      { status: "completed" },
      { status: "queued" },
      { status: "failure" },
      { status: undefined },
      { updated_at: "2026-10-06T23:59:00Z" },
      { updated_at: FUTURE_EVIDENCE_AT },
    ])
      expect(() => verify(changed)).toThrow();
    expect(() => verify({}, Number.NaN)).toThrow();
    expect(() => verify({}, now - 120_000)).not.toThrow();
    expect(() => verify({}, now - 120_001)).toThrow();
  });
  it("accepts the original Bot's unedited posts within the witnessed origin run", () => {
    expect(() =>
      assertOriginTransport([comment], digest, originPolicy, chronology)
    ).not.toThrow();
  });
  it.each([
    { user: { type: "User", id: 99 } },
    { user: { type: "Bot", id: 100 } },
    { updated_at: "2026-10-07T00:02:00Z" },
    { created_at: "2026-10-08T00:01:00Z", updated_at: "2026-10-08T00:01:00Z" },
  ])("refuses edited/foreign/later copied transport: %j", changed => {
    expect(() =>
      assertOriginTransport(
        [{ ...comment, ...changed }],
        digest,
        originPolicy,
        chronology
      )
    ).toThrow();
  });
  it("does not infer an original receipt from absence or invalid chronology", () => {
    expect(() =>
      assertOriginTransport([], digest, originPolicy, chronology)
    ).toThrow();
    expect(() =>
      assertOriginTransport([comment], digest, originPolicy, {
        ...chronology,
        updated_at: "invalid",
      })
    ).toThrow();
  });
});
