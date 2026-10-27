/** Independent capture, verdict, conformance and acceptance data builders. */
import { type Fixture } from "./work-item-cli.js";
import {
  PUBLISHER,
  putAsset,
  digest,
  type ProofFacts,
} from "./work-item-proof-assets.js";
import { SPEC } from "./work-item-proof-spec.js";
const WORKFLOW = ".github/workflows/deploy.yml";
const GITHUB_ACTIONS = "github-actions";
const RUNTIME_EVIDENCE = "EV-runtime";
const CLI_OUTPUT = "cli-output";
/**
 * Actual source identities, with distinct tested, merge and delivered commits.
 * @param facts - Observed fixture Git and provider identities.
 * @returns Exact record source fields.
 */
function recordSource(facts: ProofFacts) {
  const { prHead, merge } = facts;
  return {
    pull_request: 7,
    pr_head: prHead,
    tested_head: prHead,
    merge_sha: merge,
    production_snapshot_sha: merge,
    delivered_sha: merge,
    declaring_commits: [prHead],
  };
}
/**
 * Stable native record identity and current full specification.
 * @param facts - Observed fixture Git and provider identities.
 * @returns Derived record identity fields.
 */
function identityFor(facts: ProofFacts) {
  const { repository, sourceRef, number, now, branch } = facts;
  const state = { id: `I_fixture${number}` };
  const identityDigest = digest(["github", repository, sourceRef].join("\0"));
  return {
    schema_version: 1,
    kind: "lisa-completion-authorization",
    record_id: `completion-${identityDigest}`,
    revision: 1,
    supersedes: null,
    state: "accepted-for-completion",
    captured_at: now,
    subject: {
      provider: "github",
      ref: sourceRef,
      native_id: state.id,
      scope: repository,
    },
    producer: {
      github_actor_id: PUBLISHER.id,
      tracker_actor_id: String(PUBLISHER.id),
    },
    repository: { name: repository, id: 881 },
    environment: "production",
    branch,
    spec_sha256: digest(SPEC),
  };
}
/**
 * Native whole-delivery and all seven explicit proof obligations.
 * @param conformance - Actual native conformance attachment pointer.
 * @param merge - Delivered fixture source identity.
 * @returns Complete closed obligation map.
 */
function obligationsFor(
  conformance: ReturnType<typeof putAsset>,
  merge: string
) {
  return {
    remote: { required: true, status: "pass", claim_ids: ["C-runtime"] },
    conformance: {
      required: true,
      status: "CONFORMS",
      requirement_ids: ["AC-1"],
      report: conformance,
    },
    typed_manifest: { required: true, status: "pass" },
    delivery: {
      required: true,
      status: "pass",
      mechanism: GITHUB_ACTIONS,
      runs: [
        {
          run_id: 31,
          workflow_id: 22,
          workflow_path: WORKFLOW,
          event: "push",
          attempt: 1,
          head_sha: merge,
        },
      ],
    },
    usage: { required: true, status: "pass", entry_ids: ["verify-42"] },
    linkage: { required: true, status: "pass" },
    acceptance: { required: true, status: "accepted-for-completion" },
  };
}
/**
 * Required empirical verdict captured against the delivered fixture source.
 * @param facts - Observed source and provider identities.
 * @param evidence - Actual immutable capture pointer and metadata.
 * @returns Canonical schema2 verdict payload.
 */
function runtimeVerdict(facts: ProofFacts, evidence: Record<string, unknown>) {
  const { repository, merge, now } = facts;
  return {
    schema_version: 2,
    status: "pass",
    not_established_reviewed: true,
    artifact: {
      repository,
      environment: "production",
      head_sha: merge,
      observed_at: now,
    },
    claims: [
      {
        claim_id: "C-runtime",
        boundary: "cli",
        required_for_gate: true,
        required_evidence_kinds: [CLI_OUTPUT],
        status: "established",
        evidence_refs: [RUNTIME_EVIDENCE],
        not_established: [],
      },
    ],
    evidence: [evidence],
    criteria: [
      {
        task: "Verify",
        criterion: "Observed feature is verified",
        status: "pass",
      },
    ],
  };
}
/**
 * Build byte-bound captures before the accepted record that refers to them.
 * @param fixture - Owned disposable repository.
 * @param facts - Actual fixture Git and provider identities.
 * @returns Coherent accepted proof input with native attachment pointers.
 */
export function makeProofRecord(fixture: Fixture, facts: ProofFacts) {
  const { sourceRef, merge, now } = facts;
  const capture = putAsset(fixture, 1, {
    command: ["synthetic-fixture-verifier", "observe"],
    stdout: "synthetic observed result",
    stderr: "",
    exit_code: 0,
  });
  const evidence = {
    ...capture,
    evidence_id: RUNTIME_EVIDENCE,
    kind: CLI_OUTPUT,
    captured_at: now,
    artifact_head_sha: merge,
  };
  const verdict = putAsset(fixture, 2, runtimeVerdict(facts, evidence));
  const requirements = [
    { requirement_id: "AC-1", operator: "all", claim_ids: ["C-runtime"] },
  ];
  const conformance = putAsset(fixture, 3, {
    verdict: "CONFORMS",
    spec_sha256: digest(SPEC),
    work_item: sourceRef,
    requirements: requirements.map(row => ({ ...row, status: "pass" })),
    scenario_names: ["Observed feature is verified"],
  });

  return {
    ...identityFor(facts),
    source: recordSource(facts),
    manifest: [
      {
        name: "delivered-behavior",
        kind: CLI_OUTPUT,
        evidence_id: RUNTIME_EVIDENCE,
      },
    ],
    evidence: [evidence],
    verdicts: [{ ...verdict, role: "remote" }],
    requirements,
    obligations: obligationsFor(conformance, merge),
  };
}
