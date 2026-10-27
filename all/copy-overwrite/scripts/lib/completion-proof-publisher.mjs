/** Publish accepted/pending/revoked proof without performing a terminal transition. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PROOF_KIND,
  PROOF_MARKER,
  MAX_RECORD_BYTES,
  sha256,
  primarySpecProjection,
  requireProof,
  validateRecordShape,
  parseLocator,
  isId,
} from "./completion-proof-shape.mjs";
import { githubProofTransport } from "./completion-proof-github.mjs";
import { completionRecordId } from "./completion-proof-reader.mjs";
import { evaluateAcceptedRecord } from "./completion-authorization.mjs";

/** Recover the monotonic native index without treating old malformed proof as valid. */
function previousLocator(
  context,
  comments,
  transport,
  repositoryId,
  recordId,
  trackerActor
) {
  const candidates = [];
  for (const comment of comments) {
    if (!comment.body?.startsWith(`${PROOF_MARKER}\n`)) continue;
    const actor = comment.user ?? comment.author;
    if (
      context.provider === "github"
        ? !transport.eligibleCommentAuthor(actor, repositoryId)
        : String(actor?.id) !== trackerActor
    )
      continue;
    let locator;
    try {
      locator = parseLocator(comment.body);
    } catch {
      continue;
    }
    if (
      locator.repository === context.repository &&
      locator.record_id === recordId
    )
      candidates.push(locator);
  }
  candidates.sort((left, right) => right.revision - left.revision);
  return candidates[0] ?? null;
}

/** A candidate bot id is only a hint until native upload metadata confirms it. */
function publisherIdentity(context, input, transport, repository) {
  try {
    const actor = JSON.parse(transport.call(["api", "user"]));
    requireProof(
      isId(actor.id) && actor.type === "User",
      "The native publisher identity is unsupported."
    );
    return actor.id;
  } catch (error) {
    const id = input.producer?.github_actor_id;
    requireProof(
      (context.policy.automationPublishers ?? []).some(
        row =>
          row.user_id === id &&
          row.repository_id === repository.id &&
          row.type === "Bot"
      ),
      "The publisher identity is unreadable and no explicit repository automation identity was configured.",
      "read-error"
    );
    return id;
  }
}

/** Strict immutable publication, followed by exact native readback and locator. */
export function publishCompletionProof(context, input) {
  const transport = githubProofTransport(
    context.run,
    context.repository,
    context.policy
  );
  const repository = transport.json(transport.root);
  const subject = {
    ...context.readSubject(),
    comments: context.readComments(),
  };
  const publisher = publisherIdentity(context, input, transport, repository);
  const trackerActor = context.trackerActor(publisher);
  requireProof(
    trackerActor && trackerActor !== "undefined",
    "The native tracker publisher identity could not be established."
  );
  const identity = {
    provider: context.provider,
    ref: context.ref,
    scope: context.scope,
    native_id: subject.native_id,
  };
  const recordId = completionRecordId(identity);
  const previous = previousLocator(
    context,
    subject.comments,
    transport,
    repository.id,
    recordId,
    trackerActor
  );
  const record = {
    ...input,
    schema_version: 1,
    kind: PROOF_KIND,
    record_id: recordId,
    revision: previous ? previous.revision + 1 : 1,
    supersedes: previous?.sha256 ?? null,
    captured_at: new Date().toISOString(),
    subject: identity,
    producer: {
      ...input.producer,
      github_actor_id: publisher,
      tracker_actor_id: trackerActor,
    },
    repository: { name: context.repository, id: repository.id },
    environment: context.environment,
    branch: context.branch,
    spec_sha256: sha256(primarySpecProjection(subject.body)),
  };
  validateRecordShape(record);
  if (record.state === "accepted-for-completion")
    evaluateAcceptedRecord({ record }, context, subject, transport);
  const bytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`);
  requireProof(
    bytes.length <= MAX_RECORD_BYTES,
    "The completion record exceeds its bounded publication size."
  );
  const digest = sha256(bytes);
  const name = `${recordId}-r${record.revision}-${digest}.json`;
  const temporary = mkdtempSync(join(tmpdir(), "lisa-completion-proof-"));
  try {
    mkdirSync(temporary, { recursive: true });
    const file = join(temporary, name);
    writeFileSync(file, bytes);
    const uploaded = context.run(
      "gh",
      ["release", "upload", "pr-assets", file, "--repo", context.repository],
      { allowFailure: true }
    );
    requireProof(
      uploaded.status === 0 && !uploaded.error,
      "Immutable completion-proof upload failed; no acceptance locator was published.",
      "write-error"
    );
    const release = transport.json(`${transport.root}/releases/tags/pr-assets`);
    const pages = transport.json(
      `${transport.root}/releases/${release.id}/assets?per_page=100`,
      true
    );
    requireProof(
      pages.every(Array.isArray),
      "The native completion-asset listing is incomplete.",
      "read-error"
    );
    const matching = pages.flat().filter(asset => asset.name === name);
    requireProof(
      matching.length === 1,
      "The uploaded completion asset cannot be uniquely read back.",
      "read-error"
    );
    const stored = transport.asset(matching[0].id, MAX_RECORD_BYTES);
    requireProof(
      stored.bytes.equals(bytes) &&
        sha256(stored.bytes) === digest &&
        stored.metadata.uploader?.id === publisher,
      "The native uploaded acceptance bytes or publisher differ from the producer's record."
    );
    const publisherState = transport.trustedPublisher(stored.metadata, record, {
      publishing: true,
    });
    // Recheck native scope after upload; do not publish acceptance for changed requirements.
    const fresh = {
      ...context.readSubject(),
      comments: context.readComments(),
    };
    requireProof(
      sha256(primarySpecProjection(fresh.body)) === record.spec_sha256,
      "Requirements changed during proof publication; no locator was written.",
      "pending-proof"
    );
    if (record.state === "accepted-for-completion")
      evaluateAcceptedRecord({ record }, context, fresh, transport);
    const locator = {
      schema_version: 1,
      record_id: recordId,
      revision: record.revision,
      repository: context.repository,
      asset_id: stored.metadata.id,
      sha256: digest,
    };
    const body = `${PROOF_MARKER}\n${JSON.stringify(locator)}`;
    const comment = context.postLocator(body, subject.native_id);
    const readback = context
      .readComments()
      .find(row => String(row.id) === String(comment.id));
    requireProof(
      readback?.body === body &&
        String((readback.user ?? readback.author)?.id) === trackerActor,
      "The native completion locator or publisher did not read back exactly.",
      "write-error"
    );
    const deferredProducer = !publisherState.ready;
    return {
      category: deferredProducer ? "published/pending-producer" : "published",
      record_id: recordId,
      revision: record.revision,
      asset_id: stored.metadata.id,
      sha256: digest,
      comment_id: comment.id,
      ref: context.ref,
      terminal_mutation: false,
    };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
