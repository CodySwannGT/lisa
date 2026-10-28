// This file is managed by Lisa and IS replaced on each `lisa` run.
// Do not edit directly — durable changes belong upstream in Lisa.

/** Discover immutable proof through native, attributable locator revisions. */
import {
  CompletionProofError,
  PROOF_MARKER,
  MAX_RECORD_BYTES,
  sha256,
  parseLocator,
  requireProof,
  validateRecordShape,
  isObject,
} from "./completion-proof-shape.mjs";

/** Stable identity cannot be reset to replay a revoked item's older record. */
export function completionRecordId(subject) {
  return `completion-${sha256([subject.provider, subject.scope, subject.ref].join("\0"))}`;
}

/** Native timestamps and identifiers, not caller-supplied capture times. */
function order(comment) {
  const time = Date.parse(
    comment.updated_at ??
      comment.updatedAt ??
      comment.created_at ??
      comment.createdAt
  );
  requireProof(
    Number.isFinite(time),
    "A native completion locator has no usable revision timestamp."
  );
  return time;
}

/** A marker alone, an anonymous comment or an issue edit is never authority. */
export function readTrustedRecord(context, subject, transport) {
  const comments = context
    .readComments()
    .filter(row => row.body?.startsWith(`${PROOF_MARKER}\n`));
  const repository = transport.json(transport.root);
  const observations = [];
  const trustedLinearActors = new Set();
  for (const comment of comments) {
    const actor = comment.user ?? comment.author;
    const trustedNativeActor =
      context.provider === "github"
        ? transport.eligibleCommentAuthor(actor, repository.id)
        : false;
    if (context.provider === "github" && !trustedNativeActor) continue;
    let observation;
    let locator;
    try {
      locator = parseLocator(comment.body);
      requireProof(
        locator.repository === context.repository,
        "The proof locator selected another implementation repository."
      );
      const asset = transport.asset(locator.asset_id, MAX_RECORD_BYTES);
      requireProof(
        sha256(asset.bytes) === locator.sha256,
        "The accepted record's actual bytes no longer match its locator digest."
      );
      let record;
      try {
        record = JSON.parse(asset.bytes.toString("utf8"));
      } catch {
        throw new CompletionProofError(
          "invalid-proof",
          "The completion record attachment is not readable JSON."
        );
      }
      requireProof(
        isObject(record) &&
          isObject(record.producer) &&
          record.producer.github_actor_id === asset.metadata.uploader?.id,
        "The completion record publisher differs from the asset's native uploader."
      );
      transport.trustedPublisher(
        asset.metadata,
        { ...record, repository },
        { identityOnly: true }
      );
      if (context.provider === "linear") {
        if (String(record.producer.tracker_actor_id) !== String(actor?.id))
          continue;
        trustedLinearActors.add(String(actor.id));
      } else
        requireProof(
          record.producer.github_actor_id === actor.id,
          "The managed locator was not published by the record's native publisher."
        );
      validateRecordShape(record);
      transport.trustedPublisher(asset.metadata, record);
      requireProof(
        record.subject.provider === context.provider &&
          record.subject.ref === context.ref &&
          String(record.subject.native_id) === String(subject.native_id) &&
          record.subject.scope === context.scope &&
          record.record_id === completionRecordId(record.subject) &&
          record.repository.id === repository.id &&
          record.repository.name === context.repository &&
          record.revision === locator.revision &&
          record.record_id === locator.record_id,
        "The accepted proof belongs to another work item, native scope, repository or revision."
      );
      observation = { comment, locator, record, metadata: asset.metadata };
    } catch (error) {
      observation = { comment, locator, error };
    }
    observations.push(observation);
  }
  const trusted = observations.filter(
    row =>
      context.provider === "github" ||
      trustedLinearActors.has(
        String((row.comment.user ?? row.comment.author)?.id)
      )
  );
  trusted.sort(
    (left, right) =>
      order(right.comment) - order(left.comment) ||
      (right.locator?.revision ?? 0) - (left.locator?.revision ?? 0) ||
      Number(right.comment.id || 0) - Number(left.comment.id || 0)
  );
  if (trusted.length === 0) return null;
  const chosen = trusted[0];
  if (chosen.error) throw chosen.error;
  const older = trusted.slice(1).filter(row => row.locator);
  requireProof(
    !older.some(
      row =>
        row.locator.revision > chosen.record.revision ||
        (row.locator.revision === chosen.record.revision &&
          row.locator.sha256 !== chosen.locator.sha256)
    ),
    "The latest trusted locator attempts to roll back or conflict with a newer proof revision."
  );
  if (chosen.record.revision > 1)
    requireProof(
      older.some(
        row =>
          row.locator.revision === chosen.record.revision - 1 &&
          row.locator.sha256 === chosen.record.supersedes
      ),
      "The completion proof revision does not extend its trusted immutable predecessor."
    );
  return { ...chosen, history: locatorHistoryFingerprint(comments) };
}

/** Detect a concurrent locator edit locally after the final authoritative read. */
export function locatorHistoryFingerprint(comments) {
  const markers = comments
    .filter(row => row.body?.startsWith(`${PROOF_MARKER}\n`))
    .map(row => ({
      id: String(row.id),
      body: row.body,
      actor: (row.user ?? row.author)?.id,
      updated:
        row.updated_at ?? row.updatedAt ?? row.created_at ?? row.createdAt,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return sha256(JSON.stringify(markers));
}

/** A native pointer revision is re-read independently before the first write. */
export function recordFingerprint(chosen) {
  return JSON.stringify({
    id: chosen.comment.id,
    updated: order(chosen.comment),
    asset: chosen.locator.asset_id,
    sha256: chosen.locator.sha256,
    revision: chosen.record.revision,
  });
}
