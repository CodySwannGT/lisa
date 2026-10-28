// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Native source/delivery reconciliation, independent of checkout credentials. */
import { requireProof, isOid } from "./completion-proof-shape.mjs";

const PENDING_PROOF = "pending-proof";

/** Full native compare pagination; absence/truncation is never clean ancestry. */
export function compareSource(transport, base, head) {
  requireProof(
    isOid(base) && isOid(head),
    "The source comparison has an invalid commit identity."
  );
  const pages = transport.json(
    `${transport.root}/compare/${base}...${head}?per_page=100`,
    true
  );
  requireProof(
    pages.length > 0 && pages.every(page => Array.isArray(page.commits)),
    "Native source comparison pages are incomplete."
  );
  const first = pages[0];
  const commits = pages.flatMap(page => page.commits);
  requireProof(
    ["ahead", "identical"].includes(first.status) &&
      first.merge_base_commit?.sha === base &&
      Number.isSafeInteger(first.total_commits) &&
      commits.length === first.total_commits &&
      new Set(commits.map(row => row.sha)).size === commits.length,
    "The accepted source is not a completely observed ancestor of the delivered branch."
  );
  return commits;
}

/** The primary PR and its declaring commits outrank related timeline links. */
export function validateSource(record, context, transport) {
  const source = record.source;
  const pr = transport.json(`${transport.root}/pulls/${source.pull_request}`);
  requireProof(
    pr.number === source.pull_request &&
      pr.merged === true &&
      pr.base?.ref === context.branch &&
      pr.merge_commit_sha === source.merge_sha &&
      pr.head?.sha === source.pr_head &&
      context.declares(pr.body ?? "", context.ref),
    "The accepted primary pull request does not declare this work item or match its merged production source."
  );
  if (context.suppliedPrUrl)
    requireProof(
      context.suppliedPrUrl === pr.html_url,
      "The supplied pull request is not the accepted record's primary pull request; related work cannot choose authorization."
    );
  const merge = transport.json(`${transport.root}/commits/${source.merge_sha}`);
  requireProof(
    merge.parents?.some(row => row.sha === source.pr_head),
    "The actual merge did not include the recorded primary PR head."
  );
  if (source.tested_head !== source.pr_head) {
    const tested = transport.json(
      `${transport.root}/commits/${source.tested_head}`
    );
    requireProof(
      tested.parents?.some(row => row.sha === source.pr_head),
      "The tested execution head has no native reconciliation to the primary PR head."
    );
  }
  for (const sha of source.declaring_commits) {
    const commit = transport.json(`${transport.root}/commits/${sha}`);
    requireProof(
      commit.sha === sha &&
        context.declares(commit.commit?.message ?? "", context.ref),
      "A primary source commit does not declare this exact work item."
    );
    compareSource(transport, sha, source.merge_sha);
  }
  compareSource(transport, source.merge_sha, source.delivered_sha);
  const afterDelivery = compareSource(
    transport,
    source.delivered_sha,
    source.production_snapshot_sha
  );
  requireProof(
    !afterDelivery.some(row =>
      context.declares(row.commit?.message ?? "", context.ref)
    ),
    "Newer source for this work item precedes the accepted snapshot but has no delivered verification proof.",
    PENDING_PROOF
  );
  return pr;
}

/** Later unrelated work is allowed; newer work for this item needs new proof. */
export function validateFrontier(record, context, transport) {
  const tip = transport.json(
    `${transport.root}/branches/${encodeURIComponent(context.branch)}`
  ).commit?.sha;
  const later = compareSource(
    transport,
    record.source.production_snapshot_sha,
    tip
  );
  requireProof(
    !later.some(row =>
      context.declares(row.commit?.message ?? "", context.ref)
    ),
    "Newer source for this work item is awaiting fresh remote verification and evidence.",
    PENDING_PROOF
  );
  return tip;
}

/** Actual declared delivery mechanism, never a convenient auxiliary green run. */
export function validateDelivery(record, context, transport) {
  const delivery = record.obligations.delivery;
  if (!delivery.required) return;
  const configured = context.policy.delivery?.[context.environment];
  requireProof(
    configured &&
      ["github-actions", "artifact", "external-deployment"].includes(
        configured.mechanism
      ),
    "The actual delivery mechanism is not declared in verification.completion.delivery; configure it and run canonical Verify/evidence.",
    PENDING_PROOF
  );
  requireProof(
    delivery.mechanism === configured.mechanism,
    "The accepted delivery mechanism differs from project configuration."
  );
  if (configured.mechanism !== "github-actions") {
    requireProof(
      Array.isArray(delivery.evidence_refs) &&
        delivery.evidence_refs.length > 0 &&
        delivery.verified_empirically === true,
      "The declared artifact/external delivery has no empirically verified reaching record."
    );
    return;
  }
  requireProof(
    Array.isArray(delivery.runs) &&
      delivery.runs.length > 0 &&
      typeof configured.workflow_path === "string" &&
      Array.isArray(configured.events),
    "The configured post-merge delivery workflow and run are missing."
  );
  for (const expected of delivery.runs) {
    const run = transport.json(
      `${transport.root}/actions/runs/${expected.run_id}`
    );
    requireProof(
      run.repository?.id === record.repository.id &&
        run.workflow_id === expected.workflow_id &&
        run.path === configured.workflow_path &&
        run.path === expected.workflow_path &&
        configured.events.includes(run.event) &&
        run.event === expected.event &&
        run.head_branch === context.branch &&
        run.head_sha === expected.head_sha &&
        run.run_attempt === expected.attempt,
      "The delivery run is not the configured post-merge workflow for this source and environment."
    );
    requireProof(
      run.status === "completed",
      "The required delivery workflow is still pending; finish canonical Verify/evidence.",
      PENDING_PROOF
    );
    requireProof(
      run.conclusion === "success",
      "The required whole delivery workflow did not succeed."
    );
    compareSource(transport, record.source.merge_sha, run.head_sha);
    compareSource(transport, run.head_sha, record.source.delivered_sha);
  }
}
