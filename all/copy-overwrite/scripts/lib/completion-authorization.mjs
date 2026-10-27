/** Shared terminal precondition for GitHub direct/sweep and Linear direct. */
import {
  CompletionProofError,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_BYTES,
  declaredScope,
  sha256,
  requireProof,
  primarySpecProjection,
  isDigest,
  isId,
  isTime,
  isOid,
} from "./completion-proof-shape.mjs";
import { githubProofTransport } from "./completion-proof-github.mjs";
import {
  readTrustedRecord,
  recordFingerprint,
  locatorHistoryFingerprint,
} from "./completion-proof-reader.mjs";
import {
  validateTypedBytes,
  validateVerdict,
  validateManifest,
  validateObligations,
  validateVerifyUsage,
} from "./completion-proof-content.mjs";
import {
  validateSource,
  validateFrontier,
  validateDelivery,
} from "./completion-proof-source.mjs";
import { validateConformance } from "./completion-proof-conformance.mjs";

/** Stable user-facing next action, without declaring merely pending delivery failed. */
const NEXT =
  "Run canonical Verify/evidence, publish the accepted completion proof, then retry completion.";

/** Fetch each native attachment positively; missing or wrong-type bytes refuse. */
function validateAttachments(record, transport) {
  let total = 0;
  const evidence = new Map();
  for (const item of record.evidence) {
    requireProof(
      typeof item.evidence_id === "string" &&
        !evidence.has(item.evidence_id) &&
        isId(item.asset_id) &&
        isDigest(item.sha256) &&
        isTime(item.captured_at) &&
        isOid(item.artifact_head_sha) &&
        Number.isSafeInteger(item.bytes) &&
        item.bytes > 0,
      "A typed proof attachment has an ambiguous identity, digest, capture time or byte count."
    );
    const asset = transport.asset(
      item.asset_id,
      Math.min(MAX_ATTACHMENT_BYTES, MAX_TOTAL_BYTES - total)
    );
    total += asset.bytes.length;
    requireProof(
      asset.bytes.length === item.bytes && sha256(asset.bytes) === item.sha256,
      `Evidence ${item.evidence_id} has changed bytes or an incomplete attachment.`
    );
    validateTypedBytes(item.kind, asset.bytes, item.evidence_id);
    evidence.set(item.evidence_id, item);
  }
  const verdicts = [];
  for (const item of record.verdicts) {
    requireProof(
      isId(item.asset_id) && isDigest(item.sha256),
      "A required verdict has no native immutable attachment."
    );
    const asset = transport.asset(
      item.asset_id,
      Math.min(MAX_ATTACHMENT_BYTES, MAX_TOTAL_BYTES - total)
    );
    total += asset.bytes.length;
    requireProof(
      sha256(asset.bytes) === item.sha256 && asset.bytes.length === item.bytes,
      "The required verification verdict's bytes do not match its accepted digest."
    );
    try {
      verdicts.push({
        value: JSON.parse(asset.bytes.toString("utf8")),
        role: item.role,
      });
    } catch {
      throw new CompletionProofError(
        "invalid-proof",
        "The required verification verdict is malformed JSON."
      );
    }
  }
  return { evidence, verdicts };
}

/** Complete evaluation of exact native requirements, not an advisory local stop. */
export function evaluateAcceptedRecord(chosen, context, subject, transport) {
  const { record } = chosen;
  requireProof(
    record.state !== "revoked",
    "The latest trusted completion proof was revoked."
  );
  requireProof(
    record.state === "accepted-for-completion",
    "Delivery/runtime verification proof is still pending.",
    "pending-proof"
  );
  requireProof(
    record.environment === context.environment &&
      record.branch === context.branch &&
      record.spec_sha256 === sha256(primarySpecProjection(subject.body)),
    "The accepted proof does not match the current full primary specification or target environment."
  );
  const scope = declaredScope(subject.body, context.environment);
  const { evidence, verdicts } = validateAttachments(record, transport);
  const claims = new Map();
  for (const { value: verdict, role } of verdicts) {
    requireProof(
      ["remote", "quality"].includes(role) &&
        verdict.artifact?.repository === context.repository,
      "The verdict has an unknown role or was captured for another repository."
    );
    if (role === "remote")
      requireProof(
        verdict.artifact.environment === context.environment &&
          verdict.artifact.head_sha === record.source.delivered_sha,
        "Remote verification was not captured against the accepted delivered source/environment."
      );
    else
      requireProof(
        [record.source.tested_head, record.source.pr_head].includes(
          verdict.artifact.head_sha
        ),
        "The quality verdict does not identify its actual reconciled tested execution head."
      );
    for (const [id, claim] of validateVerdict(
      verdict,
      evidence,
      scope.runtime
    )) {
      requireProof(
        !claims.has(id),
        `Required claim ${id} is ambiguous across verdicts.`
      );
      claims.set(id, { ...claim, verification_role: role });
    }
  }
  validateManifest(record, subject.body, evidence);
  validateObligations(record, scope, claims);
  validateConformance(record, context, subject, transport);
  for (const obligation of Object.values(record.obligations)) {
    if (obligation.evidence_refs)
      requireProof(
        obligation.evidence_refs.every(id => evidence.has(id)),
        "A required completion obligation cites an unattached evidence record."
      );
  }
  validateVerifyUsage(
    [subject.body, ...(subject.comments ?? []).map(row => row.body)],
    context.ref,
    record.obligations.usage.entry_ids,
    context
  );
  const primary = validateSource(record, context, transport);
  requireProof(
    context.hasBacklink(subject, primary.html_url),
    "The exact primary PR has no verified native or managed work-item backlink."
  );
  validateDelivery(record, context, transport);
  validateFrontier(record, context, transport);
  return { primary, scope };
}

/** Fresh checks run after byte validation and before any terminal mutation. */
export function authorizeCompletion(context) {
  try {
    let subject = context.readSubject();
    if ((subject.comments ?? []).length > 0)
      subject = { ...subject, comments: context.readComments() };
    const hints = subject.comments ?? [];
    if (
      !hints.some(row =>
        row.body?.startsWith("[lisa-completion-authorization]\n")
      )
    ) {
      return {
        category: "pending-proof",
        applied: false,
        native: subject,
        reason: `Required delivery/runtime verification and accepted evidence proof are pending. ${NEXT}`,
      };
    }
    const transport = githubProofTransport(
      context.run,
      context.repository,
      context.policy
    );
    const chosen = readTrustedRecord(context, subject, transport);
    requireProof(
      chosen,
      `Accepted delivery/runtime evidence proof is absent or has no eligible publisher. ${NEXT}`,
      "pending-proof"
    );
    // Full native comments include canonical usage and the complete locator history.
    subject = { ...subject, comments: context.readComments() };
    const evaluated = evaluateAcceptedRecord(
      chosen,
      context,
      subject,
      transport
    );
    validateSource(chosen.record, context, transport);
    validateDelivery(chosen.record, context, transport);
    validateFrontier(chosen.record, context, transport);
    const current = readTrustedRecord(context, subject, transport);
    requireProof(
      current && recordFingerprint(current) === recordFingerprint(chosen),
      "Completion proof changed while it was being verified; run canonical Verify/evidence again.",
      "pending-proof"
    );
    // All slow source, delivery, asset and issuer reads precede these final
    // native reads. No provider read intervenes between local final checks and
    // the caller's lifecycle-policy check/first terminal write.
    const comments = context.readComments();
    const fresh = { ...context.readSubject(), comments };
    requireProof(
      locatorHistoryFingerprint(comments) === current.history,
      "The native completion locator history changed before the terminal write; retry canonical verification.",
      "pending-proof"
    );
    requireProof(
      sha256(primarySpecProjection(fresh.body)) === chosen.record.spec_sha256,
      "Work-item requirements changed before the terminal write; fresh verification proof is pending.",
      "pending-proof"
    );
    validateVerifyUsage(
      [fresh.body, ...comments.map(row => row.body)],
      context.ref,
      chosen.record.obligations.usage.entry_ids,
      context
    );
    requireProof(
      context.hasBacklink(fresh, evaluated.primary.html_url),
      "The primary pull-request backlink changed before the terminal write; restore canonical linkage.",
      "pending-proof"
    );
    return {
      category: "authorized",
      applied: false,
      native: fresh,
      record: chosen.record,
      primary: chosen.record.source.pull_request,
    };
  } catch (error) {
    if (!(error instanceof CompletionProofError)) throw error;
    return {
      category: error.category,
      applied: false,
      reason: `${error.message} ${NEXT}`,
    };
  }
}

/** The same outcome vocabulary is consumed by direct CLI and workflow summaries. */
export function completionDenial(ref, result) {
  const prefix =
    result.category === "pending-proof"
      ? "work-item pending-proof"
      : "work-item NOT completed";
  return {
    ...result,
    terminal: null,
    merged: [],
    report: `${prefix}: ${ref} [${result.category}]\n${result.reason}`,
  };
}
