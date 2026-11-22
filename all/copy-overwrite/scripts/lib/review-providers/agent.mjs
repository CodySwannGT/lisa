// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
// Managed by Lisa. Authenticated PR review objects, never issue-comment markers.
import { createHash } from "node:crypto";
import { submittedReview } from "./native-evidence.mjs";

/** The posted report's exact-head, first-line discriminator. */
export const agentMarker = head =>
  `<!-- lisa:review provider="agent" head="${head}" -->`;

/** Parse a substantive, independently authored agent review packet. */
export function agentPacket(review, head) {
  const [first, ...rest] = String(review.body ?? "").split("\n");
  if (first.replace(/\r$/, "") !== agentMarker(head)) return null;
  let packet;
  try {
    packet = JSON.parse(rest.join("\n"));
  } catch {
    return null;
  }
  const valid =
    packet?.schema_version === 1 &&
    packet.provider === "agent" &&
    packet.head_sha === head &&
    packet.status === "completed" &&
    typeof packet.reviewer_session === "string" &&
    packet.reviewer_session.trim().length > 0 &&
    typeof packet.source_session === "string" &&
    packet.source_session.trim().length > 0 &&
    packet.reviewer_session.trim() !== packet.source_session.trim() &&
    Array.isArray(packet.scope) &&
    packet.scope.length > 0 &&
    packet.scope.every(
      file => typeof file === "string" && file.trim() !== ""
    ) &&
    typeof packet.review === "string" &&
    packet.review.trim().length >= 80 &&
    Array.isArray(packet.findings) &&
    packet.findings.every(
      finding =>
        finding &&
        typeof finding.evidence === "string" &&
        finding.evidence.length > 0 &&
        ["fixed", "pushed-back", "non-blocking"].includes(finding.disposition)
    ) &&
    packet.review_sha256 ===
      createHash("sha256").update(packet.review).digest("hex");
  return valid ? packet : null;
}

/** Only an authenticated repository writer's submitted PR review grants credit. */
export function agentEvidence({ reviews, head, canWrite, settings = {} }) {
  return reviews
    .filter(
      review =>
        review.commit_id === head &&
        ["COMMENTED", "APPROVED"].includes(review.state) &&
        submittedReview(review) &&
        (settings.actorId === undefined ||
          review.user.id === settings.actorId) &&
        canWrite(review.user.login) &&
        agentPacket(review, head) !== null
    )
    .map(review => ({
      provider: "agent",
      actor: String(review.user.id),
      evidence: `review:${review.id}`,
      head,
    }));
}
