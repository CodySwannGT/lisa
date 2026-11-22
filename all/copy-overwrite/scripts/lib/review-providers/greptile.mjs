// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.
// Managed by Lisa. No universal status context or app ID is assumed.
import { submittedReview } from "./native-evidence.mjs";
export const provider = "greptile";

/**
 * Submitted GitHub reviews carry commit_id; edited general comments do not.
 * Summary-only comments cannot prove the head and deliberately grant no credit.
 */
export function reviewEvidence({ reviews, head, settings = {} }) {
  if (!Number.isSafeInteger(settings.actorId) || settings.actorId <= 0)
    return [];
  return reviews
    .filter(
      review =>
        review.commit_id === head &&
        review.user?.id === settings.actorId &&
        review.user?.type === "Bot" &&
        (review.state === "APPROVED" ||
          (review.state === "COMMENTED" &&
            typeof review.body === "string" &&
            !/\b(?:review skipped|rate limited|review queued|review in progress|not reviewed)\b/iu.test(
              review.body
            ) &&
            (settings.proof ?? []).some(
              proof => proof.trim() === review.body.trim()
            ))) &&
        submittedReview(review)
    )
    .map(review => ({
      provider,
      actor: String(review.user.id),
      evidence: `review:${review.id}`,
      head,
    }));
}
