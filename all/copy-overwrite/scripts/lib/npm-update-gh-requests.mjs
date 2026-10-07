// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Controller-derived literal GH requests narrow canonical parsing without replacing it. */
import { canonicalJson } from "../lisa-automation-provenance.mjs";
import { required, keys } from "./npm-update-contract.mjs";
import {
  githubIssueViewArgs,
  githubHierarchyArgs,
  pullRequestViewArgs,
  githubBacklinkListArgs,
} from "../lisa-work-item.mjs";
import {
  officialArguments,
  PROPOSAL_PREDICATE,
  RECOVERY_PREDICATE,
} from "./github-attestation-verifier.mjs";
const BACKLINK_PHASE = "publication-backlink";
const STAGE_PHASE = "stage-read";
const PHASES = [
  STAGE_PHASE,
  "hook-read",
  BACKLINK_PHASE,
  "publication-validate-pr",
];
const ID = /^[1-9]\d*$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9_.-]{1,100}$/;
const decimal = value => typeof value === "string" && ID.test(value);
const key = args => canonicalJson(args);
const api = endpoint => ["api", "--hostname", "github.com", endpoint];
import { recoveryPage } from "./npm-update-gh-grants.mjs";

/** Actual trusted allocation/config/proof bytes choose subject; requests cannot choose these fields. */
function checkedSubject(subject) {
  keys(subject, [
    "phase",
    "repository",
    "tracker",
    "issue",
    "branch",
    "parent",
    "origin",
    "claim",
    "recovery",
    "maintainer",
    "pr",
    "proofs",
  ]);
  required(
    PHASES.includes(subject.phase) &&
      REPO.test(subject.repository) &&
      REPO.test(subject.tracker) &&
      ![subject.repository, subject.tracker].some(value =>
        [".", ".."].includes(value.split("/")[1])
      ) &&
      decimal(subject.issue) &&
      decimal(subject.claim) &&
      /^lisa\/npm-[a-f0-9]{64}$/.test(subject.branch) &&
      /^[a-f0-9]{40}$/.test(subject.parent),
    "invalid closed GH subject"
  );
  keys(subject.origin, ["runId", "runAttempt"]);
  required(
    decimal(subject.origin.runId) && decimal(subject.origin.runAttempt),
    "invalid GH run identity"
  );
  if (subject.pr !== null) keys(subject.pr, ["number", "url"]);
  required(
    subject.pr === null ||
      (decimal(subject.pr.number) &&
        subject.pr.url ===
          `https://github.com/${subject.repository}/pull/${subject.pr.number}`),
    "invalid GH PR identity"
  );
  required(
    /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(subject.maintainer) &&
      Array.isArray(subject.proofs) &&
      subject.proofs.length <= 2 &&
      (subject.phase !== STAGE_PHASE || subject.proofs.length === 0),
    "invalid GH phase proof scope"
  );
  if (subject.recovery !== null) {
    keys(subject.recovery, ["runId", "runAttempt", "branch"]);
    required(
      decimal(subject.recovery.runId) &&
        decimal(subject.recovery.runAttempt) &&
        subject.recovery.branch === subject.branch,
      "invalid GH recovery identity"
    );
  }
}

/** Read families use the same literal constructors as the canonical shipped callers. */
function ordinaryRequests(subject) {
  const records = [
    { kind: "plain", args: ["--version"] },
    {
      kind: "plain",
      args: githubIssueViewArgs(subject.tracker, subject.issue),
    },
    {
      kind: "hierarchy",
      args: githubHierarchyArgs(
        { repository: subject.tracker },
        subject.issue,
        null
      ),
    },
  ];
  if (subject.phase !== STAGE_PHASE)
    records.push({
      kind: "plain",
      args: pullRequestViewArgs(
        subject.pr?.number,
        subject.branch,
        subject.repository
      ),
    });
  if (subject.phase === BACKLINK_PHASE)
    records.push({
      kind: "comments",
      args: githubBacklinkListArgs(subject.tracker, subject.issue),
    });
  return records;
}

/** Only hook verification receives attestation/provider reads; stage has no premature proof scope. */
function proofRequests(subject) {
  if (subject.phase !== "hook-read") return [];
  const repository = subject.repository;
  const endpoints = [
    `repos/${repository}`,
    `repos/${repository}/git/ref/heads/main`,
    `repos/${repository}/actions/runs/${subject.origin.runId}/attempts/${subject.origin.runAttempt}`,
    `repos/${subject.tracker}/issues/comments/${subject.claim}`,
  ];
  if (subject.recovery)
    endpoints.push(
      `repos/${repository}/actions/runs/${subject.recovery.runId}/attempts/${subject.recovery.runAttempt}`,
      `repos/${repository}/issues/${subject.issue}`,
      `repos/${repository}/git/matching-refs/heads/${subject.branch}`
    );
  const records = endpoints.map(endpoint => ({
    kind: "plain",
    args: api(endpoint),
  }));
  if (subject.recovery)
    records.push(
      { kind: "recovery-page", page: 1, args: recoveryPage(subject, 1) },
      {
        kind: "plain",
        args: [
          "api",
          "--hostname",
          "github.com",
          "--include",
          `repos/${repository}/assignees/${subject.maintainer}`,
        ],
      }
    );
  for (const proof of subject.proofs)
    records.push(proofRequest(subject, proof));
  return records;
}

function proofRequest(subject, proof) {
  keys(proof, [
    "file",
    "bundle",
    "predicate",
    "signerWorkflow",
    "signerDigest",
  ]);
  required(
    [proof.file, proof.bundle].every(
      value =>
        typeof value === "string" &&
        value.startsWith("/") &&
        !/[\0\n]/.test(value)
    ) &&
      [PROPOSAL_PREDICATE, RECOVERY_PREDICATE].includes(proof.predicate) &&
      /^[a-f0-9]{40}$/.test(proof.signerDigest) &&
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(
        proof.signerWorkflow
      ),
    "invalid fixed GH proof request"
  );
  return {
    kind: "plain",
    args: officialArguments(
      {
        repository: subject.repository,
        signerWorkflow: proof.signerWorkflow,
        signerDigest: proof.signerDigest,
      },
      subject,
      proof.file,
      proof.bundle,
      proof.predicate
    ),
  };
}

/** This finite subject catalogue grants no native execution or credentials. */
export function createGhRequests(subject) {
  checkedSubject(subject);
  const snapshot = JSON.parse(JSON.stringify(subject));
  const records = [...ordinaryRequests(snapshot), ...proofRequests(snapshot)];
  required(
    records.length <= 64 &&
      new Set(records.map(record => key(record.args))).size === records.length,
    "ambiguous GH request catalogue"
  );
  return { subject: snapshot, records };
}

export {
  createGhState,
  prepareGhRequest,
  observeGhResponse,
} from "./npm-update-gh-grants.mjs";
